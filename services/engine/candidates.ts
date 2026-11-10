/** Current-regimen analysis and candidate-modification generation. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, Medication, RegimenMed, ModificationAction, RegimenModification, ModificationSet } from '../../types';
import { drugFacts } from './drugFacts';
import { valueUnknown, hasHistoricalHFrEF, isIronDeficient, isBlackRace } from '../clinicalPredicates';
import { RAAS_CLASSES, getMedicationClassGroup } from './registry';
import { computeRedundantCurrentMeds, countNewClassGroups, formatDose, getDoseTiers, hasRecentWorseningHF, isTargetDoseForPatient, shouldPreserveQuadForUnknownHistory } from './regimenUtils';
import { currentMedIntoleranceReason, deriveIntolerancePolicy, isRenalOnlyContraindication } from './intolerance';
import { regimenSatisfiesPillar } from './domains';

export interface RegimenAnalysis {
    currentClassMap: Map<string, RegimenMed>;  // class group → current med+dose
    missingPillars: string[];                   // GDMT pillars not in current regimen
    titratableUp: { current: RegimenMed, options: RegimenMed[] }[];
    titratableDown: { current: RegimenMed, options: RegimenMed[] }[];
    swappable: { from: RegimenMed, candidates: RegimenMed[] }[];
    removable: RegimenMed[];
    addableAdjuncts: RegimenMed[];
    addablePillars: Map<string, RegimenMed[]>;  // missing pillar class group → candidate meds+doses
    contraindicatedCurrentMeds: Set<string>;     // names of current meds now contraindicated
    intolerableCurrentMeds: Map<string, string>; // current meds violating documented-intolerance policy → reason
    forcedBbDownTitrateNames: Set<string>;       // existing BBs that must be down-titrated in acute decomp
    redundantCurrentMeds: Set<string>;           // names of duplicate-class agents to deprescribe (dual RAAS/MRA)
}

export function analyzeCurrentRegimen(
    patient: Patient,
    formulary: Medication[],
    medTiers: RegimenMed[],
    allBBExcluded?: boolean
): RegimenAnalysis {
    const currentRegimen = patient.current_regimen || [];

    // Map current meds to class groups
    const currentClassMap = new Map<string, RegimenMed>();
    currentRegimen.forEach(r => {
        const group = getMedicationClassGroup(r.med.drug_class);
        currentClassMap.set(group, r);
    });

    // Determine which GDMT pillars apply based on HF phenotype
    // HFimpEF (ACC/AHA 2022): If LVEF was ≤40% and has improved, continue all 4 pillars
    const preserveQuadForUnknownHistory = shouldPreserveQuadForUnknownHistory(patient);
    const isHFimpEF = patient.lvef > 40 && (hasHistoricalHFrEF(patient) || preserveQuadForUnknownHistory);
    const isHFpEF = patient.lvef >= 50 && !isHFimpEF;
    const applicablePillars = isHFpEF
        ? ['SGLT2i']                                    // HFpEF: only SGLT2i is Class I
        : ['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'];  // HFrEF/HFmrEF/HFimpEF: full quad

    let missingPillars = applicablePillars.filter(p => !regimenSatisfiesPillar(currentRegimen, p, patient));

    // Acute decompensation gating: do NOT initiate BB (Class III harm — ACC/AHA 2022)
    // NYHA IV, or NYHA III with significant volume overload = acutely decompensated
    const acuteFluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const isAcutelyDecompensated = patient.nyha_class === 'IV' ||
        (patient.nyha_class === 'III' && acuteFluidExcess > 2.0 && patient.volume_status.exam_findings.size >= 2);
    if (isAcutelyDecompensated && !currentClassMap.has('Beta Blocker')) {
        missingPillars = missingPillars.filter(p => p !== 'Beta Blocker');
    }

    // H5: Force dose reduction of an existing beta-blocker ONLY when decompensation is accompanied
    // by hypoperfusion / low output ("cold-and-wet"). ACC/AHA 2022: in WARM-and-wet decompensation
    // (adequate perfusion) the beta-blocker is CONTINUED and the patient is diuresed — reducing it
    // is not indicated and worsens outcomes. Previously any NYHA III/IV congestion forced a BB cut,
    // which both de-escalated warm patients inappropriately AND (via the candidate filter below)
    // suppressed every safe guideline ADDITION (e.g. SGLT2i, which is beneficial in acute HF —
    // EMPULSE / SOLOIST-WHF). Abrupt discontinuation remains Class III harm — this is a dose
    // REDUCTION with taper guidance, never an abrupt stop.
    const pulsePressure = patient.sbp - patient.dbp;
    // NOTE: the sbp < 90 disjunct is defensive-only — generateAndScoreModifications returns
    // alerts-only before calling analyzeCurrentRegimen when input SBP < 90; it is kept in case
    // this function ever gains another caller.
    const hasHypoperfusion =
        patient.volume_status.exam_findings.has('Cool Extremities') ||
        patient.sbp < 90 ||
        pulsePressure <= 25;
    const forceDownBB = isAcutelyDecompensated && currentClassMap.has('Beta Blocker') && hasHypoperfusion;

    // Build a map of all available meds by class group for lookup
    const tiersByGroup = new Map<string, RegimenMed[]>();
    medTiers.forEach(r => {
        const group = getMedicationClassGroup(r.med.drug_class);
        if (!tiersByGroup.has(group)) tiersByGroup.set(group, []);
        tiersByGroup.get(group)!.push(r);
    });

    // Safety check: identify current meds that are now contraindicated
    // These must NOT be titrated up or kept — only down-titration, swap, or removal
    const intolerancePolicy = deriveIntolerancePolicy(patient);
    const contraindicatedCurrentMeds = new Set<string>();
    const intolerableCurrentMeds = new Map<string, string>();
    const renalDataUnknown = valueUnknown(patient.egfr) || valueUnknown(patient.creatinine);
    currentRegimen.forEach(r => {
        if (r.med.contraindications && r.med.contraindications(patient)) {
            // Blank renal data (0 sentinel) trips every `egfr < X` gate. Never force-remove
            // WORKING therapy on missing data — the DATA REQUIRED alert + the renal-unknown
            // caution penalty govern instead of a fabricated end-stage-CKD contraindication.
            if (!(renalDataUnknown && isRenalOnlyContraindication(r.med, patient))) {
                contraindicatedCurrentMeds.add(r.med.name);
            }
        } else if (!renalDataUnknown && r.med.renal_adjustment
            && r.med.renal_adjustment(patient.egfr, patient).contraindicated === true) {
            // Honor the renal_adjustment contract: `contraindicated: true` is a hard renal gate,
            // equivalent to contraindications() (belt-and-suspenders — affected meds currently
            // duplicate the eGFR cutoff there, but the contract must not silently no-op).
            contraindicatedCurrentMeds.add(r.med.name);
        }
        // Documented intolerance applies to meds the patient ARRIVED on, not just new starts —
        // a class excluded from the formulary must not survive inside the current regimen
        // (e.g. ACEi cough history while on a different ACEi; gynecomastia on spironolactone).
        // Flagged meds join contraindicatedCurrentMeds (blocks keep/titrate-up, enables swap) and
        // are tracked separately so the forced cleanup can SWAP to a tolerated same-group agent
        // instead of dropping the pillar outright.
        const intoleranceReason = currentMedIntoleranceReason(r.med, intolerancePolicy);
        if (intoleranceReason) {
            contraindicatedCurrentMeds.add(r.med.name);
            intolerableCurrentMeds.set(r.med.name, intoleranceReason);
        }
        // A current med matching a documented ALLERGY by name must not be kept or up-titrated.
        // The new-start formulary filter already excludes allergy names (D8), but the arriving
        // regimen was never cross-checked — a patient could arrive ON a drug they report an
        // allergy to and have it retained, pillar-credited, and offered for up-titration.
        // Routed through intolerableCurrentMeds so the forced cleanup prefers a tolerated
        // same-group SWAP over dropping the pillar. Placed after the checks above so a hard
        // contraindication / structured intolerance keeps labeling precedence.
        if ((patient.allergies?.has(r.med.name) ?? false) && !intolerableCurrentMeds.has(r.med.name)) {
            contraindicatedCurrentMeds.add(r.med.name);
            intolerableCurrentMeds.set(r.med.name, 'Patient-reported allergy — must not be continued');
        }
    });

    // Redundant same-class therapy the patient arrived on (dual RAAS / dual MRA). These must be
    // deprescribed — the engine synthesizes their removal into every candidate (below) so a
    // corrected regimen is produced rather than the whole regimen being filtered out. The keeper
    // must be a med the patient can actually STAY on — never the contraindicated/intolerable one.
    const redundantCurrentMeds = computeRedundantCurrentMeds(
        currentRegimen,
        med => contraindicatedCurrentMeds.has(med.name)
    );

    // Titration analysis: for each current med, find higher/lower dose tiers
    const titratableUp: RegimenAnalysis['titratableUp'] = [];
    const titratableDown: RegimenAnalysis['titratableDown'] = [];
    const forcedBbDownTitrateNames = new Set<string>();

    currentRegimen.forEach(current => {
        // Block titration UP and swaps for contraindicated OR redundant meds — they are being removed
        const isContraindicated = contraindicatedCurrentMeds.has(current.med.name) || redundantCurrentMeds.has(current.med.name);
        // Beta-blocker handling in acute decompensation, two tiers:
        //   - Up-titration is deferred in ANY acute decompensation (warm or cold) — practice is
        //     CONTINUE the current dose and diurese; up-titrate after euvolemia is restored.
        //   - Forced dose REDUCTION remains hypoperfusion-gated ("cold-and-wet" only, H5) —
        //     warm-and-wet patients keep their current BB dose.
        const isBBBlockedUp = isAcutelyDecompensated && current.med.drug_class === 'Beta Blocker';
        const isBBForcedDown = forceDownBB && current.med.drug_class === 'Beta Blocker';

        const allTiers = getDoseTiers(current.med, patient);
        // Compare by dose-ORDER INDEX (available_doses are listed low→high), not Number(strength).
        // Combination products use string strengths like "24/26" or "37.5/20" where Number() is NaN,
        // which silently made every up/down comparison false — so ARNI and H/ISDN could never be
        // titrated. Index comparison handles both numeric and combination strengths.
        const doseOrder = current.med.available_doses;
        const currentIdx = doseOrder.findIndex(d => d.strength === current.dose.strength);
        const tierIdx = (t: RegimenMed) => doseOrder.findIndex(d => d.strength === t.dose.strength);

        if (!isContraindicated && !isBBBlockedUp) {
            // Sorted ASCENDING by dose index so consumers can rely on options[last] being the
            // highest tier (getDoseTiers construction order is [lowest, highest, middle, target],
            // which is NOT ascending — the compound add+titrate candidate previously picked a
            // middle/target tier while labeling it the maximal step).
            const higherDoses = allTiers.filter(t => tierIdx(t) > currentIdx).sort((a, b) => tierIdx(a) - tierIdx(b));
            if (higherDoses.length > 0) {
                titratableUp.push({ current, options: higherDoses });
            }
        }

        const lowerDoses = allTiers.filter(t => tierIdx(t) < currentIdx).sort((a, b) => tierIdx(a) - tierIdx(b));
        if (lowerDoses.length > 0) {
            titratableDown.push({ current, options: lowerDoses });
            if (isBBForcedDown) {
                forcedBbDownTitrateNames.add(current.med.name);
            }
        }
    });

    // Swap analysis: for each current med, find other meds in same class group.
    // Contraindicated current meds CAN be swapped to a non-contraindicated alternative
    // (preserves drug class coverage vs outright removal). Swap candidates that are
    // themselves contraindicated are filtered out.
    const swappable: RegimenAnalysis['swappable'] = [];
    const fluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    currentRegimen.forEach(current => {
        // A REDUNDANT duplicate (e.g. the second beta-blocker / loop diuretic) must be REMOVED, not
        // swapped to another agent in the same group — swapping would preserve the duplication. The
        // keeper covers the class; the duplicate is force-removed downstream.
        if (redundantCurrentMeds.has(current.med.name)) return;
        const group = getMedicationClassGroup(current.med.drug_class);
        // For beta-blockers, MRAs, and SGLT2i, a lateral swap to a DIFFERENT agent in the same
        // class is not how therapy is escalated — you up-titrate the existing agent. Offer such a
        // swap ONLY when the current agent is contraindicated (then it must be replaced). Otherwise
        // skip the swap so dose escalation happens via titrate_up of the current agent. (RAAS keeps
        // swaps for the ACEi/ARB→ARNI guideline upgrade; loop diuretics keep swaps for diuretic
        // resistance / Furoscix.)
        const TITRATE_NOT_SWAP_GROUPS = new Set(['Beta Blocker', 'MRA', 'SGLT2i']);
        if (TITRATE_NOT_SWAP_GROUPS.has(group) && !contraindicatedCurrentMeds.has(current.med.name)) return;
        const sourceContraindicated = contraindicatedCurrentMeds.has(current.med.name);
        const groupTiers = tiersByGroup.get(group) || [];
        let candidates = groupTiers.filter(t =>
            t.med.name !== current.med.name &&
            !contraindicatedCurrentMeds.has(t.med.name) // Don't swap TO a contraindicated med
        );
        // Within the RAAS group, a non-forced swap may only UPGRADE (ACEi/ARB → ARNI, the
        // guideline-preferred agent — PARADIGM-HF). Never recommend the reverse downgrade
        // (ARNI → ACEi/ARB) purely to reach a target dose — that loses the ARNI benefit; the ARNI
        // should be up-titrated instead. (A contraindicated source can still swap to any non-CI
        // alternative.)
        if (group === 'RAAS Inhibitor' && !sourceContraindicated) {
            candidates = candidates.filter(t => t.med.drug_class === 'ARNI' && current.med.drug_class !== 'ARNI');
        }
        if (candidates.length > 0) {
            // AGENT DIVERSITY: tiersByGroup lists every dose tier in formulary order, so the
            // safeSlice(3) downstream would spend all slots on one agent's dose ladder (e.g.
            // three ARNI tiers) and never offer the cheaper/alternative agents in the group.
            // Reorder to one starting tier per DISTINCT agent first, remaining tiers after —
            // a swap to a new agent starts at the low tier and up-titrates anyway.
            const firstTierByMed = new Map<string, RegimenMed>();
            candidates.forEach(t => { if (!firstTierByMed.has(t.med.name)) firstTierByMed.set(t.med.name, t); });
            const firstTiers = [...firstTierByMed.values()];
            let prioritizedCandidates = [...firstTiers, ...candidates.filter(t => !firstTiers.includes(t))];
            // Ensure FUROSCIX is considered in worsening-congestion loop swaps instead of being truncated by safeSlice.
            if (current.med.drug_class === 'Loop Diuretic' && fluidExcess >= 2.0) {
                const furoscix = prioritizedCandidates.find(t => drugFacts(t.med).preferred_for_congestion);
                if (furoscix) {
                    prioritizedCandidates = [furoscix, ...prioritizedCandidates.filter(t => t !== furoscix)];
                }
            }
            swappable.push({ from: current, candidates: prioritizedCandidates });
        }
    });

    // Removable: diuretics when euvolemic, OR any contraindicated/redundant current med
    const removable: RegimenMed[] = [];
    currentRegimen.forEach(r => {
        // An intolerable med with a tolerated same-group replacement is SWAPPED, never offered as
        // a bare removal — a $0 "just stop it" candidate would survive the affordability filter
        // when every swap-carrying candidate dies, displaying an empty/pillar-less regimen.
        if (intolerableCurrentMeds.has(r.med.name) && swappable.some(s => s.from.med.name === r.med.name)) {
            return;
        }
        // Contraindicated or redundant (dual RAAS/MRA) current meds MUST be flagged for removal
        if (contraindicatedCurrentMeds.has(r.med.name) || redundantCurrentMeds.has(r.med.name)) {
            removable.push(r);
            return;
        }
        if (r.med.drug_class === 'Loop Diuretic' && fluidExcess < 0.5) {
            removable.push(r);
        }
        if (r.med.drug_class === 'Thiazide-like Diuretic' && fluidExcess < 0.5) {
            removable.push(r);
        }
    });

    // Addable pillars: meds for missing GDMT pillars
    const addablePillars = new Map<string, RegimenMed[]>();
    missingPillars.forEach(pillar => {
        const candidates = tiersByGroup.get(pillar) || [];
        if (candidates.length > 0) {
            addablePillars.set(pillar, safeSlice(candidates, 4));
        }
    });

    // Addable adjuncts: criteria-gated
    const addableAdjuncts: RegimenMed[] = [];
    const currentClasses = new Set(currentRegimen.map(r => r.med.drug_class));
    const isBlack = isBlackRace(patient);
    const isNyhaIIIorIV = patient.nyha_class === 'III' || patient.nyha_class === 'IV';
    const isSinusRhythm = patient.rhythm === 'Sinus';
    const hasRAASInCurrent = currentClasses.has('ARNI') || currentClasses.has('ACEi') || currentClasses.has('ARB');

    // H/ISDN: A-HeFT evidence is HFrEF-only — offer ONLY in reduced-EF phenotypes, never HFpEF.
    // Within reduced EF: Black + NYHA III-IV (A-HeFT Class I add-on, combinable with RAAS), or as
    // the RAAS ALTERNATIVE when RAAS is genuinely unattainable (every ARNI/ACEi/ARB filtered from
    // the formulary by contraindication/intolerance/allergy — ACC/AHA 2022 Class IIb). Merely "not
    // currently on RAAS" is NOT enough: a treatment-naive patient should get RAAS first, not have
    // H/ISDN offered while ARNI is simultaneously proposed as the missing pillar.
    const allRAASExcluded = !formulary.some(m => RAAS_CLASSES.has(m.drug_class));
    if (!isHFpEF && ((isBlack && isNyhaIIIorIV) || (!hasRAASInCurrent && allRAASExcluded))) {
        const hidralazineTiers = medTiers.filter(r => r.med.drug_class === 'Vasodilator');
        if (hidralazineTiers.length > 0 && !currentClasses.has('Vasodilator')) {
            addableAdjuncts.push(hidralazineTiers[0]);
        }
    }

    // Ivabradine: Sinus + HR >= 70 + LVEF <= 35 on a MAXIMALLY-TOLERATED beta-blocker (SHIFT;
    // ESC 2021 Class IIb). The "max tolerated" criterion matters: ivabradine is added only after
    // the beta-blocker is optimized — offering it to a patient on a starting BB dose (e.g.
    // carvedilol 3.125) is wrong and crowds out the indicated BB up-titration. Proxy for
    // "maximally tolerated": BB at its target dose, OR beta-blockers cannot be used at all
    // (allBBExcluded — the SHIFT-eligible "BB-intolerant" fallback).
    const bbAtTarget = currentRegimen.some(r =>
        r.med.drug_class === 'Beta Blocker' &&
        isTargetDoseForPatient(r, patient)
    );
    const ivabradineEligible = isSinusRhythm && patient.pulse >= 70 && patient.lvef <= 35 &&
        (bbAtTarget || allBBExcluded === true);
    if (ivabradineEligible) {
        const ivabTiers = medTiers.filter(r => r.med.drug_class === 'If Inhibitor');
        if (ivabTiers.length > 0 && !currentClasses.has('If Inhibitor')) {
            addableAdjuncts.push(ivabTiers[0]);
        }
    }

    // Vericiguat: NYHA II-IV + NT-proBNP >= 1600 + LVEF < 45 (VICTORIA trial enrolled NYHA II-IV)
    const isNyhaIIorHigher = patient.nyha_class === 'II' || patient.nyha_class === 'III' || patient.nyha_class === 'IV';
    const hasWorseningHf = hasRecentWorseningHF(patient);
    if (isNyhaIIorHigher && patient.nt_pro_bnp >= 1600 && patient.lvef < 45 && hasWorseningHf) {
        const verTiers = medTiers.filter(r => r.med.drug_class === 'sGC Stimulator');
        if (verTiers.length > 0 && !currentClasses.has('sGC Stimulator')) {
            addableAdjuncts.push(verTiers[0]);
        }
    }

    // Digoxin: AFib rate control (with or without BB) OR HFrEF symptom reduction (DIG trial)
    const digoxinIndicated =
        patient.rhythm === 'AFib' ||  // Rate control adjunct
        (patient.lvef <= 45 && isNyhaIIIorIV);  // DIG trial: symptomatic HFrEF
    if (digoxinIndicated) {
        const digTiers = medTiers.filter(r => r.med.drug_class === 'Inotrope');
        if (digTiers.length > 0 && !currentClasses.has('Inotrope')) {
            addableAdjuncts.push(digTiers[0]);
        }
    }

    // Diuretics if congested and not already on one
    if (fluidExcess > 1.0 && !currentClasses.has('Loop Diuretic')) {
        const loopTiers = medTiers.filter(r => r.med.drug_class === 'Loop Diuretic');
        if (loopTiers.length > 0) {
            let prioritizedLoopTiers = loopTiers;
            if (fluidExcess >= 3.0) {
                const furoscix = loopTiers.find(r => drugFacts(r.med).preferred_for_congestion);
                if (furoscix) {
                    prioritizedLoopTiers = [furoscix, ...loopTiers.filter(r => r !== furoscix)];
                }
            }
            addableAdjuncts.push(...safeSlice(prioritizedLoopTiers, 2));
        }
    }

    // Thiazide if severe congestion + already on loop
    if (fluidExcess > 4.0 && currentClasses.has('Loop Diuretic')) {
        const thiazTiers = medTiers.filter(r => r.med.drug_class === 'Thiazide-like Diuretic');
        if (thiazTiers.length > 0 && !currentClasses.has('Thiazide-like Diuretic')) {
            addableAdjuncts.push(thiazTiers[0]);
        }
    }

    // Iron if iron-deficient (ESC 2021 / IRONMAN / AFFIRM-AHF — see isIronDeficient)
    const needsIron = isIronDeficient(patient);
    if (needsIron && !currentClasses.has('IV Iron')) {
        const ironTiers = medTiers.filter(r => r.med.drug_class === 'IV Iron');
        if (ironTiers.length > 0) {
            addableAdjuncts.push(ironTiers[0]);
        }
    }

    // nsMRA (Finerenone) for HFpEF as adjunct — FINEARTS-HF, LVEF ≥ 40, FDA approved
    // In HFmrEF, nsMRA is already offered as a pillar option (grouped with MRA)
    // In HFpEF, MRA is NOT a pillar, so nsMRA must be added as adjunct
    if (isHFpEF && patient.lvef >= 40 && !currentClasses.has('MRA') && !currentClasses.has('nsMRA')) {
        const nsmraTiers = medTiers.filter(r => r.med.drug_class === 'nsMRA');
        if (nsmraTiers.length > 0) {
            addableAdjuncts.push(nsmraTiers[0]);
        }
    }

    // Steroidal MRA for HFpEF — TOPCAT Americas, Class IIb (ACC/AHA 2022 §7.4)
    // Cost-effective alternative to Finerenone; offered alongside nsMRA as separate candidate
    // getMedicationClassGroup groups nsMRA→MRA, preventing dual MRA in same regimen
    if (isHFpEF && !currentClasses.has('MRA') && !currentClasses.has('nsMRA')) {
        const steroidalMraTiers = medTiers.filter(r => r.med.drug_class === 'MRA');
        if (steroidalMraTiers.length > 0) {
            addableAdjuncts.push(steroidalMraTiers[0]);
        }
    }

    // GLP-1 if obese + HFpEF/HFmrEF (STEP-HFpEF, SUMMIT trials — no evidence for HFrEF or HFimpEF)
    // HFimpEF is managed as HFrEF — GLP-1 not appropriate despite LVEF >= 40.
    // Boundary matches classifyPhenotype: LVEF exactly 40 is HFrEF (quad pathway), so the gate is
    // strictly > 40 — not >= 40, which wrongly made an LVEF-40 HFrEF patient GLP-1 eligible.
    if (patient.bmi >= 30 && patient.lvef > 40 && !isHFimpEF && !currentClasses.has('GLP-1 RA') && !currentClasses.has('GLP-1/GIP RA')) {
        const glpTiers = medTiers.filter(r => r.med.drug_class === 'GLP-1 RA' || r.med.drug_class === 'GLP-1/GIP RA');
        if (glpTiers.length > 0) {
            // Pick best GLP-1 by KCCQ improvement
            const sorted = glpTiers.sort((a, b) => b.med.chf_effects(0).kccq_improvement - a.med.chf_effects(0).kccq_improvement);
            addableAdjuncts.push(sorted[0]);
        }
    }

    return {
        currentClassMap,
        missingPillars,
        titratableUp,
        titratableDown,
        swappable,
        removable,
        addableAdjuncts,
        addablePillars,
        contraindicatedCurrentMeds,
        intolerableCurrentMeds,
        forcedBbDownTitrateNames,
        redundantCurrentMeds
    };
}

export const safeSlice = (arr: RegimenMed[], n = 2) => arr.slice(0, n);

export function buildResultingRegimen(
    currentRegimen: RegimenMed[],
    modifications: RegimenModification[]
): RegimenMed[] {
    const result: RegimenMed[] = [];
    const modifiedSources = new Set<string>();

    modifications.forEach(mod => {
        if (mod.action === 'remove' && mod.source) {
            modifiedSources.add(mod.source.med.name);
        }
        if ((mod.action === 'titrate_up' || mod.action === 'titrate_down' || mod.action === 'swap') && mod.source) {
            modifiedSources.add(mod.source.med.name);
        }
        if (mod.action === 'add' && mod.target) {
            result.push(mod.target);
        }
        if ((mod.action === 'titrate_up' || mod.action === 'titrate_down') && mod.target) {
            result.push(mod.target);
        }
        if (mod.action === 'swap' && mod.target) {
            result.push(mod.target);
        }
    });

    // Keep all current meds that weren't touched by a modification
    currentRegimen.forEach(r => {
        if (!modifiedSources.has(r.med.name)) {
            result.push(r);
        }
    });

    return result;
}

export function formatSwapSummary(from: RegimenMed, to: RegimenMed): string {
    if (from.med.drug_class === 'ACEi' && to.med.drug_class === 'ARNI') {
        return `STOP ${from.med.name}. WAIT 36 hours. THEN start ${to.med.name} ${formatDose(to)}`;
    }
    return `Swap ${from.med.name} -> ${to.med.name} ${formatDose(to)}`;
}

export function generateCandidateModifications(
    analysis: RegimenAnalysis,
    patient: Patient
): ModificationSet[] {
    const currentRegimen = patient.current_regimen || [];
    const candidates: ModificationSet[] = [];

    // --- a) Single modifications ---

    // Add missing pillar meds
    analysis.addablePillars.forEach((meds, _pillar) => {
        meds.forEach(med => {
            const mods: RegimenModification[] = [{
                action: 'add',
                target: med,
                summary: `Add ${med.med.name} ${formatDose(med)}`
            }];
            candidates.push({
                modifications: mods,
                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
            });
        });
    });

    // Titrate up
    analysis.titratableUp.forEach(({ current, options }) => {
        options.forEach(higher => {
            const mods: RegimenModification[] = [{
                action: 'titrate_up',
                source: current,
                target: higher,
                summary: `Titrate ${current.med.name} ${current.dose.strength}→${higher.dose.strength}${higher.dose.unit} ${higher.selected_frequency}`
            }];
            candidates.push({
                modifications: mods,
                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
            });
        });
    });

    // Titrate down
    analysis.titratableDown.forEach(({ current, options }) => {
        options.forEach(lower => {
            const mods: RegimenModification[] = [{
                action: 'titrate_down',
                source: current,
                target: lower,
                summary: `Reduce ${current.med.name} ${current.dose.strength}→${lower.dose.strength}${lower.dose.unit} ${lower.selected_frequency}`
            }];
            candidates.push({
                modifications: mods,
                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
            });
        });
    });

    // Swaps
    analysis.swappable.forEach(({ from, candidates: swapCandidates }) => {
        safeSlice(swapCandidates, 3).forEach(to => {
            const mods: RegimenModification[] = [{
                action: 'swap',
                source: from,
                target: to,
                summary: formatSwapSummary(from, to)
            }];
            candidates.push({
                modifications: mods,
                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
            });
        });
    });

    // Removals
    analysis.removable.forEach(med => {
        const mods: RegimenModification[] = [{
            action: 'remove',
            source: med,
            summary: `Remove ${med.med.name} ${formatDose(med)}`
        }];
        candidates.push({
            modifications: mods,
            resulting_regimen: buildResultingRegimen(currentRegimen, mods)
        });
    });

    // Add adjuncts
    analysis.addableAdjuncts.forEach(adj => {
        const mods: RegimenModification[] = [{
            action: 'add',
            target: adj,
            summary: `Add ${adj.med.name} ${formatDose(adj)}`
        }];
        candidates.push({
            modifications: mods,
            resulting_regimen: buildResultingRegimen(currentRegimen, mods)
        });
    });

    // --- b) Compound modifications (2-3 changes) ---
    const maxNewPerVisit = Math.max(0, Math.round(patient.max_new_classes_per_visit ?? 2));

    // Pair missing-pillar additions
    const pillarEntries = Array.from(analysis.addablePillars.entries());
    if (pillarEntries.length >= 2 && maxNewPerVisit >= 2) {
        for (let i = 0; i < pillarEntries.length; i++) {
            for (let j = i + 1; j < pillarEntries.length; j++) {
                // Pick best candidate from each pillar (first one)
                const med1 = pillarEntries[i][1][0];
                const med2 = pillarEntries[j][1][0];
                if (med1 && med2) {
                    const mods: RegimenModification[] = [
                        { action: 'add', target: med1, summary: `Add ${med1.med.name} ${formatDose(med1)}` },
                        { action: 'add', target: med2, summary: `Add ${med2.med.name} ${formatDose(med2)}` }
                    ];
                    candidates.push({
                        modifications: mods,
                        resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                    });
                }
            }
        }

        // Triple pillar additions
        if (pillarEntries.length >= 3 && maxNewPerVisit >= 3) {
            for (let i = 0; i < pillarEntries.length; i++) {
                for (let j = i + 1; j < pillarEntries.length; j++) {
                    for (let k = j + 1; k < pillarEntries.length; k++) {
                        const med1 = pillarEntries[i][1][0];
                        const med2 = pillarEntries[j][1][0];
                        const med3 = pillarEntries[k][1][0];
                        if (med1 && med2 && med3) {
                            const mods: RegimenModification[] = [
                                { action: 'add', target: med1, summary: `Add ${med1.med.name} ${formatDose(med1)}` },
                                { action: 'add', target: med2, summary: `Add ${med2.med.name} ${formatDose(med2)}` },
                                { action: 'add', target: med3, summary: `Add ${med3.med.name} ${formatDose(med3)}` }
                            ];
                            candidates.push({
                                modifications: mods,
                                resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                            });
                        }
                    }
                }
            }
        }

        // Quad pillar additions
        if (pillarEntries.length >= 4 && maxNewPerVisit >= 4) {
            const med1 = pillarEntries[0][1][0];
            const med2 = pillarEntries[1][1][0];
            const med3 = pillarEntries[2][1][0];
            const med4 = pillarEntries[3][1][0];
            if (med1 && med2 && med3 && med4) {
                const mods: RegimenModification[] = [
                    { action: 'add', target: med1, summary: `Add ${med1.med.name} ${formatDose(med1)}` },
                    { action: 'add', target: med2, summary: `Add ${med2.med.name} ${formatDose(med2)}` },
                    { action: 'add', target: med3, summary: `Add ${med3.med.name} ${formatDose(med3)}` },
                    { action: 'add', target: med4, summary: `Add ${med4.med.name} ${formatDose(med4)}` }
                ];
                candidates.push({
                    modifications: mods,
                    resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                });
            }
        }
    }

    // Combine addition + titration
    if (pillarEntries.length > 0 && analysis.titratableUp.length > 0 && maxNewPerVisit >= 1) {
        const topPillarMed = pillarEntries[0][1][0];
        if (topPillarMed) {
            analysis.titratableUp.forEach(({ current, options }) => {
                const bestHigher = options[options.length - 1]; // highest dose option (options sorted ascending by dose index in analyzeCurrentRegimen)
                if (bestHigher) {
                    const mods: RegimenModification[] = [
                        { action: 'add', target: topPillarMed, summary: `Add ${topPillarMed.med.name} ${formatDose(topPillarMed)}` },
                        { action: 'titrate_up', source: current, target: bestHigher, summary: `Titrate ${current.med.name} ${current.dose.strength}→${bestHigher.dose.strength}${bestHigher.dose.unit}` }
                    ];
                    candidates.push({
                        modifications: mods,
                        resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                    });
                }
            });
        }
    }

    // Combine swap + addition
    if (analysis.swappable.length > 0 && pillarEntries.length > 0 && maxNewPerVisit >= 1) {
        const topPillarMed = pillarEntries[0][1][0];
        if (topPillarMed) {
            analysis.swappable.forEach(({ from, candidates: swapCandidates }) => {
                const bestSwap = swapCandidates[0];
                if (bestSwap) {
                    const mods: RegimenModification[] = [
                        { action: 'swap', source: from, target: bestSwap, summary: formatSwapSummary(from, bestSwap) },
                        { action: 'add', target: topPillarMed, summary: `Add ${topPillarMed.med.name} ${formatDose(topPillarMed)}` }
                    ];
                    candidates.push({
                        modifications: mods,
                        resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                    });
                }
            });
        }
    }

    // Combine adjunct + pillar addition or adjunct + titration
    if (analysis.addableAdjuncts.length > 0 && pillarEntries.length > 0 && maxNewPerVisit >= 2) {
        analysis.addableAdjuncts.forEach(adj => {
            const topPillarMed = pillarEntries[0][1][0];
            if (topPillarMed) {
                const mods: RegimenModification[] = [
                    { action: 'add', target: topPillarMed, summary: `Add ${topPillarMed.med.name} ${formatDose(topPillarMed)}` },
                    { action: 'add', target: adj, summary: `Add ${adj.med.name} ${formatDose(adj)}` }
                ];
                candidates.push({
                    modifications: mods,
                    resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                });
            }
        });
    }

    // Combine adjunct + swap
    if (analysis.addableAdjuncts.length > 0 && analysis.swappable.length > 0) {
        analysis.addableAdjuncts.forEach(adj => {
            analysis.swappable.forEach(({ from, candidates: swapCandidates }) => {
                const bestSwap = swapCandidates[0];
                if (bestSwap) {
                    const mods: RegimenModification[] = [
                        { action: 'swap', source: from, target: bestSwap, summary: formatSwapSummary(from, bestSwap) },
                        { action: 'add', target: adj, summary: `Add ${adj.med.name} ${formatDose(adj)}` }
                    ];
                    candidates.push({
                        modifications: mods,
                        resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                    });
                }
            });
        });
    }

    // --- c) "No change" baseline for comparison when current regimen exists ---
    if (currentRegimen.length > 0 && analysis.forcedBbDownTitrateNames.size === 0) {
        candidates.push({
            modifications: currentRegimen.map(r => ({
                action: 'keep' as ModificationAction,
                source: r,
                summary: `Keep ${r.med.name} ${formatDose(r)}`
            })),
            resulting_regimen: [...currentRegimen]
        });
    }

    // --- d) Binder rescue: for candidates projecting K+ > 5.3 ---
    // This will be handled during simulation, not at generation time

    // --- e) Force-remove (or force-swap) contraindicated AND redundant current meds from ALL candidates ---
    // Contraindicated: e.g. a patient on ACEi who becomes pregnant must not retain ACEi anywhere.
    // Redundant: a patient on dual RAAS / dual MRA must have the duplicate deprescribed in every
    // candidate — otherwise all candidates retain the duplicate and get filtered out (empty output).
    // Documented intolerance: SWAP to a tolerated same-group agent when one exists (ACEi cough →
    // ARB/ARNI, spironolactone gynecomastia → eplerenone) so the cleanup never costs the patient a
    // GDMT pillar; only when no tolerated alternative exists does it fall back to plain removal.
    const contraindicated = analysis.contraindicatedCurrentMeds;
    const redundant = analysis.redundantCurrentMeds;
    if (contraindicated.size > 0 || redundant.size > 0) {
        const forcedRemovals: RegimenModification[] = [];
        currentRegimen.forEach(r => {
            // A HARD contraindication (med.contraindications(patient) true, e.g. K+ > 5.5 on an
            // MRA) takes precedence over a historical intolerance — it gets the urgent
            // 'contraindicated' removal, never an elective-tolerability swap framing.
            const hardContraindicated = r.med.contraindications?.(patient) === true;
            const intoleranceReason = hardContraindicated ? undefined : analysis.intolerableCurrentMeds.get(r.med.name);
            const swapTarget = intoleranceReason
                ? analysis.swappable.find(s => s.from.med.name === r.med.name)?.candidates[0]
                : undefined;
            if (intoleranceReason && swapTarget) {
                forcedRemovals.push({
                    action: 'swap',
                    source: r,
                    target: swapTarget,
                    summary: `${formatSwapSummary(r, swapTarget)} (${intoleranceReason})`
                });
            } else if (contraindicated.has(r.med.name)) {
                const label = hardContraindicated ? 'contraindicated' : intoleranceReason ?? 'contraindicated';
                forcedRemovals.push({ action: 'remove', source: r, summary: `Remove ${r.med.name} (${label})` });
            } else if (redundant.has(r.med.name)) {
                forcedRemovals.push({ action: 'remove', source: r, summary: `Remove ${r.med.name} (redundant — deprescribe duplicate ${getMedicationClassGroup(r.med.drug_class)} therapy)` });
            }
        });

        candidates.forEach(c => {
            forcedRemovals.forEach(forced => {
                const alreadyRemoved = c.modifications.some(m =>
                    m.action === 'remove' && m.source?.med.name === forced.source!.med.name
                );
                const alreadySwapped = c.modifications.some(m =>
                    m.action === 'swap' && m.source?.med.name === forced.source!.med.name
                );
                if (!alreadyRemoved && !alreadySwapped) {
                    // Coherence: a med that is being force-removed must not also carry a
                    // titrate/keep modification in the same candidate (would render as the
                    // incoherent "down-titrate AND remove the same drug" in one visit).
                    c.modifications = c.modifications.filter(m =>
                        !((m.action === 'titrate_up' || m.action === 'titrate_down' || m.action === 'keep')
                            && m.source?.med.name === forced.source!.med.name)
                    );
                    c.modifications.push(forced);
                    c.resulting_regimen = c.resulting_regimen.filter(
                        r => r.med.name !== forced.source!.med.name
                    );
                    // A forced SWAP also introduces its replacement (unless already present).
                    if (forced.action === 'swap' && forced.target
                        && !c.resulting_regimen.some(r => r.med.name === forced.target!.med.name)) {
                        c.resulting_regimen.push(forced.target);
                    }
                }
            });
        });
    }

    // --- f) Force-inject the acute-decompensation BB dose REDUCTION into every candidate that
    // doesn't already reduce/remove/swap that beta-blocker. Without this, the only candidate that
    // satisfied the forced-reduction filter (below) was the bare "reduce BB" set — every guideline
    // ADDITION (add SGLT2i, add MRA) kept the BB at full dose and was filtered out, leaving a
    // cold-and-wet HFrEF patient with "reduce your beta-blocker and add nothing." Injecting the
    // reduction lets safe additions (esp. SGLT2i, beneficial in acute HF) survive alongside it.
    if (analysis.forcedBbDownTitrateNames.size > 0) {
        analysis.forcedBbDownTitrateNames.forEach(bbName => {
            const td = analysis.titratableDown.find(t => t.current.med.name === bbName);
            if (!td || td.options.length === 0) return;
            // ONE step down — the HIGHEST lower tier (options are sorted ascending by dose
            // index). For carvedilol 25 that is 12.5, an exact halving per standard practice.
            // The previous min-tier pick cut 25 → 3.125 (~87%), far beyond the intended
            // dose reduction, and used Number(strength) which is NaN for combination doses.
            const lower = td.options[td.options.length - 1];
            candidates.forEach(c => {
                const alreadyHandled = c.modifications.some(m =>
                    (m.action === 'titrate_down' || m.action === 'remove' || m.action === 'swap')
                    && m.source?.med.name === bbName
                );
                if (alreadyHandled) return;
                // Drop any incoherent up-titration / keep of the same BB before injecting the cut.
                c.modifications = c.modifications.filter(m =>
                    !((m.action === 'titrate_up' || m.action === 'keep') && m.source?.med.name === bbName)
                );
                c.modifications.push({
                    action: 'titrate_down',
                    source: td.current,
                    target: lower,
                    summary: `Reduce ${bbName} ${td.current.dose.strength}→${lower.dose.strength}${lower.dose.unit} ${lower.selected_frequency} (acute decompensation with hypoperfusion)`
                });
                c.resulting_regimen = c.resulting_regimen.map(r => (r.med.name === bbName ? lower : r));
            });
        });
    }

    // Filter by max_new_classes_per_visit
    return candidates.filter(c => {
        // A forced BB dose-reduction (acute decompensation) is satisfied by EITHER a down-titration
        // OR a removal. Removal is the stronger reduction and is the correct action when the BB is
        // also contraindicated (e.g. decompensated HF + new bronchospasm). Without the `remove`
        // branch, such a patient would have every candidate filtered out → zero recommendations.
        const satisfiesForcedBbDownTitration =
            analysis.forcedBbDownTitrateNames.size === 0 ||
            Array.from(analysis.forcedBbDownTitrateNames).every(bbName =>
                c.modifications.some(m =>
                    (m.action === 'titrate_down' || m.action === 'remove') && m.source?.med.name === bbName
                )
            );
        const newClassCount = countNewClassGroups(c.resulting_regimen, currentRegimen);
        const hasSteroidalMRA = c.resulting_regimen.some(r => r.med.drug_class === 'MRA');
        const hasNonSteroidalMRA = c.resulting_regimen.some(r => r.med.drug_class === 'nsMRA');
        const hasDualMRA = hasSteroidalMRA && hasNonSteroidalMRA;
        // M4: Structural block for dual RAAS (ACEi+ARB, ACEi+ARNI, etc.) — not just warning
        const raasInRegimen = c.resulting_regimen.filter(r => RAAS_CLASSES.has(r.med.drug_class));
        const hasDualRAAS = raasInRegimen.length > 1;
        return satisfiesForcedBbDownTitration && newClassCount <= maxNewPerVisit && !hasDualMRA && !hasDualRAAS;
    });
}

// --- 1. Scoring Logic (The 6 Domains) ---
