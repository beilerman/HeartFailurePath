/** Current-regimen analysis and candidate-modification generation. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, Medication, RegimenMed, ModificationAction, RegimenModification, ModificationSet } from '../../types';
import { drugFacts } from './drugFacts';
import { valueUnknown, hasHistoricalHFrEF, ivIronCreditTier, isBlackRace, isAcutelyDecompensated as isAcutelyDecompensatedPatient } from '../clinicalPredicates';
import { RAAS_CLASSES, getMedicationClassGroup } from './registry';
import { adjacentTiers, dailyCapFor, dailyDose, dosesPerDay, eligibleDoses, frequenciesWithinMax, kUptitrationBlock, computeRedundantCurrentMeds, countNewClassGroups, formatDose, getDoseTiers, hrContinuationAction, isTargetDoseForPatient, carryFrequency, kContinuationAction, pickPreferredFrequency, restrictToStartTiers, shouldPreserveQuadForUnknownHistory } from './regimenUtils';
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
    /** Current meds that must drop ONE dose step (potassium 5.5-5.9 on an MRA; dose above an interaction cap) -> reason. */
    forcedReduceNames: Map<string, string>;
    /** Subset of `forcedReduceNames` whose reduction is the EXACT next-lower strength on the drug's full dose ladder (heart-rate rule), not the highest sampled lower tier. */
    forcedReduceExactStep: Set<string>;
    /** Current meds withheld because of the potassium continuation rule (K+ >= 6.0, or 5.5-5.9 at the lowest dose) -> reason. */
    kWithholdReasons: Map<string, string>;
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
    const isAcutelyDecompensated = isAcutelyDecompensatedPatient(patient);
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
    // NEW-START tiers: a drug that declares start_dose_for never begins above its start dose. Applied where a new
    // start is built (pillar adds, swap-ins, MRA adjuncts), AFTER the existing candidate truncation, so it only
    // removes too-high starts and never reshuffles which agents are offered.
    const startTiers = restrictToStartTiers(medTiers, patient);
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
    const forcedReduceNames = new Map<string, string>();
    const kWithholdReasons = new Map<string, string>();
    const forcedReduceExactStep = new Set<string>();
    const renalDataUnknown = valueUnknown(patient.egfr) || valueUnknown(patient.creatinine);
    currentRegimen.forEach(r => {
        // Potassium continuation rule (facts.k_continuation): >= withhold_at withholds the drug; the reduce band
        // is resolved with the dose tiers in the titration pass below.
        const kRule = kContinuationAction(r.med, patient);
        if (kRule?.action === 'withhold') kWithholdReasons.set(r.med.name, kRule.reason);
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
        // Forced ONE-STEP reduction: potassium 5.5-5.9 on an MRA (label rule), or a dose above an interaction cap.
        const kRule = kContinuationAction(current.med, patient);
        const cap = current.med.interaction_dose_cap?.(patient) ?? null;
        const aboveCap = cap !== null && Number(current.dose.strength) > cap.max_dose;
        // Heart-rate rule (beta-blockers, ivabradine): below facts.hr_continuation.reduce_below the drug drops ONE step
        // (withheld at the lowest dose); below no_uptitration_below it is not up-titrated. Never a removal at a higher dose.
        const hrRule = hrContinuationAction(current.med, patient);
        const reduceReason = (kRule?.action === 'reduce' ? kRule.reason : undefined)
            ?? (aboveCap ? `${cap!.reason}: current dose is above the maximum` : undefined)
            ?? (hrRule?.reduce ? hrRule.reduceReason : undefined);

        const allTiers = getDoseTiers(current.med, patient);
        // Compare by dose-ORDER INDEX (available_doses are listed low→high), not Number(strength).
        // Combination products use string strengths like "24/26" or "37.5/20" where Number() is NaN,
        // which silently made every up/down comparison false — so ARNI and H/ISDN could never be
        // titrated. Index comparison handles both numeric and combination strengths.
        const doseOrder = current.med.available_doses;
        const currentIdx = doseOrder.findIndex(d => d.strength === current.dose.strength);
        const tierIdx = (t: RegimenMed) => doseOrder.findIndex(d => d.strength === t.dose.strength);

        const adjacent = adjacentTiers(current, patient);
        // Add the immediate neighbour tiers to the sampled ones (never skip the next step); ascending by ladder index.
        const withNeighbour = (sampled: RegimenMed[], extra: RegimenMed | undefined) => {
            const have = new Set(sampled.map(t => String(t.dose.strength)));
            return extra && !have.has(String(extra.dose.strength)) ? [...sampled, extra] : sampled;
        };
        // A "higher" / "lower" tier must change the TOTAL daily dose in that direction (ramipril 5 mg twice daily -> 10 mg once daily is no change).
        const changesDaily = (t: RegimenMed, dir: 1 | -1) => {
            const a = dailyDose(t), b = dailyDose(current);
            return Number.isNaN(a) || Number.isNaN(b) || (dir === 1 ? a > b : a < b);
        };
        // MRA potassium gate on INCREASING the dose (facts.k_uptitration_max): the dose is held, the alert states why.
        const kUpBlock = kUptitrationBlock(current.med, patient);

        if (!isContraindicated && !isBBBlockedUp && reduceReason === undefined && !hrRule?.blockUp && !kUpBlock) {
            // Sorted ASCENDING by dose index so consumers can rely on options[last] being the
            // highest tier (getDoseTiers construction order is [lowest, highest, middle, target],
            // which is NOT ascending — the compound add+titrate candidate previously picked a
            // middle/target tier while labeling it the maximal step).
            let higherDoses = withNeighbour(allTiers.filter(t => tierIdx(t) > currentIdx).map(t => carryFrequency(t, current, dailyCapFor(current.med, patient))), adjacent.up).filter(t => changesDaily(t, 1)).sort((a, b) => tierIdx(a) - tierIdx(b));
            // facts.titrate_one_step (weekly GLP-1 / GLP-1-GIP): only the NEXT labeled tier, never a jump past a step.
            if (drugFacts(current.med).titrate_one_step) higherDoses = higherDoses.slice(0, 1);
            if (higherDoses.length > 0 && !drugFacts(current.med).single_course_dose) {
                titratableUp.push({ current, options: higherDoses });
            }
        }

        const lowerDoses = withNeighbour(allTiers.filter(t => tierIdx(t) < currentIdx).map(t => carryFrequency(t, current, dailyCapFor(current.med, patient))), adjacent.down).filter(t => changesDaily(t, -1)).sort((a, b) => tierIdx(a) - tierIdx(b));
        // A one-time label course (facts.single_course_dose: ferric carboxymaltose) is not a titratable dose: no up/down candidates.
        if (lowerDoses.length > 0 && !drugFacts(current.med).single_course_dose) {
            titratableDown.push({ current, options: lowerDoses });
            if (isBBForcedDown) {
                forcedBbDownTitrateNames.add(current.med.name);
            }
        }
        if (reduceReason !== undefined && !isContraindicated) {
            if (lowerDoses.length > 0) {
                forcedReduceNames.set(current.med.name, reduceReason);
                if (hrRule?.reduce && kRule?.action !== 'reduce' && !aboveCap) forcedReduceExactStep.add(current.med.name);
            } else if (kRule?.action === 'reduce') {
                // Already at the lowest dose: the label says withhold.
                kWithholdReasons.set(current.med.name, kRule.reason);
                contraindicatedCurrentMeds.add(current.med.name);
            } else if (hrRule?.reduce) {
                // Already at the lowest dose and still bradycardic: withhold (carvedilol/metoprolol/ivabradine labels: reduce, and
                // for ivabradine stop at the lowest dose). The summary states the heart rate.
                kWithholdReasons.set(current.med.name, hrRule.withholdReason);
                contraindicatedCurrentMeds.add(current.med.name);
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
        // GLP-1 Therapy joins the set (verified-sglt2-glp1-adjuncts.md): a new GLP-1 start begins at its lowest labeled tier, so a lateral swap to the
        // other agent mid-escalation (e.g. semaglutide 1.7 mg -> tirzepatide 2.5 mg) is not how therapy is escalated; swap only when the current agent must go.
        const TITRATE_NOT_SWAP_GROUPS = new Set(['Beta Blocker', 'MRA', 'SGLT2i', 'GLP-1 Therapy']);
        if (TITRATE_NOT_SWAP_GROUPS.has(group) && !contraindicatedCurrentMeds.has(current.med.name)) return;
        const sourceContraindicated = contraindicatedCurrentMeds.has(current.med.name);
        const groupTiers = (tiersByGroup.get(group) || []).filter(t => startTiers.includes(t));
        let candidates = groupTiers.filter(t =>
            t.med.name !== current.med.name &&
            !contraindicatedCurrentMeds.has(t.med.name) && // Don't swap TO a contraindicated med
            !drugFacts(t.med).short_course_addon           // A short-course add-on (Furoscix, "not for chronic use") is never a standing replacement
        );
        // Within the RAAS group, a non-forced swap may only UPGRADE (ACEi/ARB → ARNI, the
        // guideline-preferred agent — PARADIGM-HF). Never recommend the reverse downgrade
        // (ARNI → ACEi/ARB) purely to reach a target dose — that loses the ARNI benefit; the ARNI
        // should be up-titrated instead. (A contraindicated source can still swap to any non-CI
        // alternative.)
        if (group === 'RAAS Inhibitor' && !sourceContraindicated) {
            candidates = candidates.filter(t => t.med.drug_class === 'ARNI' && current.med.drug_class !== 'ARNI');
        }
        // Loop-to-loop swap at an EQUIVALENT total daily dose (facts.verified_furosemide_equivalent_per_mg on both agents): the swap-in is the nearest
        // tier at or just above the equivalent daily dose, not the new loop's lowest tier. An agent without a verified equivalence keeps its lowest tier.
        const fromEquivalent = drugFacts(current.med).verified_furosemide_equivalent_per_mg;
        if (fromEquivalent !== undefined) {
            const equivalent = new Map<string, RegimenMed | null>();
            const emitted = new Set<string>();
            candidates = candidates.flatMap(t => {
                if (!equivalent.has(t.med.name)) equivalent.set(t.med.name, equivalentSwapTier(current, t.med, patient, fromEquivalent));
                const eq = equivalent.get(t.med.name);
                if (!eq) return [t];
                if (emitted.has(t.med.name)) return [];
                emitted.add(t.med.name);
                return [eq];
            });
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
            const prioritizedCandidates = [...firstTiers, ...candidates.filter(t => !firstTiers.includes(t))];
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
        const offered = safeSlice(candidates, 4).filter(t => startTiers.includes(t));
        if (offered.length > 0) {
            addablePillars.set(pillar, offered);
        }
    });

    // Addable adjuncts: criteria-gated
    const addableAdjuncts: RegimenMed[] = [];
    const currentClasses = new Set(currentRegimen.map(r => r.med.drug_class));
    const isBlack = isBlackRace(patient);
    const isNyhaIIIorIV = patient.nyha_class === 'III' || patient.nyha_class === 'IV';
    const isSinusRhythm = patient.rhythm === 'Sinus';
    const hasRAASInCurrent = currentClasses.has('ARNI') || currentClasses.has('ACEi') || currentClasses.has('ARB');

    // H/ISDN (verified-sglt2-glp1-adjuncts.md row 37): A-HeFT evidence is HFrEF-only (LVEF <= 40).
    //  - Class 1 (LOE A): self-identified Black patients, NYHA III-IV, who are receiving OPTIMAL therapy: a RAAS inhibitor AND a beta-blocker on
    //    board, or documented inability to take them (every agent of the class excluded from the formulary).
    //  - Class 2b (LOE C-LD): any race, when RAAS inhibitors cannot be taken (every ARNI/ACEi/ARB filtered from the formulary by
    //    contraindication/intolerance/allergy: intolerance, hypotension or renal insufficiency). Merely "not currently on RAAS" is NOT enough:
    //    a treatment-naive patient should get RAAS first, not have H/ISDN offered while ARNI is proposed as the missing pillar.
    const allRAASExcluded = !formulary.some(m => RAAS_CLASSES.has(m.drug_class));
    const raasOrUnable = hasRAASInCurrent || allRAASExcluded;
    const bbOrUnable = currentClasses.has('Beta Blocker') || allBBExcluded === true;
    const isHFrEFByEf = patient.lvef <= 40;
    const hisdnClass1 = isBlack && isNyhaIIIorIV && raasOrUnable && bbOrUnable;
    const hisdnClass2b = !hasRAASInCurrent && allRAASExcluded;
    if (isHFrEFByEf && (hisdnClass1 || hisdnClass2b)) {
        const hidralazineTiers = medTiers.filter(r => r.med.drug_class === 'Vasodilator');
        if (hidralazineTiers.length > 0 && !currentClasses.has('Vasodilator')) {
            addableAdjuncts.push(hidralazineTiers[0]);
        }
    }

    // Ivabradine: Sinus + HR >= 70 + LVEF <= 35 on a MAXIMALLY-TOLERATED beta-blocker, or with beta-blockers
    // contraindicated (SHIFT; Corlanor label; 2022 AHA/ACC/HFSA Class 2a, ESC 2021 IIa). The "max tolerated"
    // criterion matters: ivabradine is added only after the beta-blocker is optimized, never to a patient on a
    // starting BB dose that could still go up (it would crowd out the indicated BB up-titration). The label asks for
    // the maximally TOLERATED dose, not necessarily the target, so a beta-blocker counts when it is at target OR it
    // cannot be increased (no up-titration offered: heart rate below 60, a documented limiting intolerance such as
    // prior bradycardia or chronic hypotension, no higher tier, or it is being withdrawn), OR no beta-blocker can be
    // used at all (allBBExcluded). Initiation only: the HR >= 70 criterion is in the drug's contraindication checks.
    const bbMaxTolerated = currentRegimen.some(r =>
        r.med.drug_class === 'Beta Blocker' && (
            isTargetDoseForPatient(r, patient)
            || contraindicatedCurrentMeds.has(r.med.name)
            || !titratableUp.some(t => t.current.med.name === r.med.name)
            || intolerancePolicy.hasBbBradycardia
            || patient.comorbidities.has('Hypotension (Chronic)')
        )
    );
    const ivabradineEligible = isSinusRhythm && patient.pulse >= 70 && patient.lvef <= 35 &&
        (bbMaxTolerated || allBBExcluded === true);
    if (ivabradineEligible && !currentClasses.has('If Inhibitor')) {
        // New start at the label's starting tier (5 mg bid; 2.5 mg bid for conduction defects or bradycardia risk): the
        // ivabradine entry declares an EXACT start tier, so the start tiers hold exactly one.
        const ivabStart = startTiers.find(r => r.med.drug_class === 'If Inhibitor');
        if (ivabStart) addableAdjuncts.push(ivabStart);
    }

    // Vericiguat: the VICTORIA initiation criteria (NYHA II-IV, LVEF < 45, NT-proBNP >= 1000 sinus / >= 1600 AFib, qualifying worsening event)
    // and the riociguat contraindication are the drug's own initiation checks on its formulary entry: a drug that fails them is already out of
    // `formulary`, so every tier here is offerable. The new start is the entry's exact label start tier (5 mg, or 2.5 mg when at risk of hypotension).
    if (!currentClasses.has('sGC Stimulator')) {
        const verStart = startTiers.find(r => r.med.drug_class === 'sGC Stimulator');
        if (verStart) addableAdjuncts.push(verStart);
    }

    // Digoxin (verified-rate-control.md rows 18-19; Lanoxin label; 2022 AHA/ACC/HFSA Class 2b, LOE B-R):
    //  - Sinus rhythm: only for symptomatic HFrEF (LVEF <= 40, NYHA III-IV: engine policy for "symptomatic") that persists
    //    on maximally tolerated GDMT, defined from the engine's own concepts: no pillar is still addable and no pillar can
    //    still be titrated up (blocked or contraindicated pillars count as exhausted). A weak recommendation never competes
    //    with an open guideline pillar. Not offered at LVEF >= 50.
    //  - Atrial fibrillation: rate control is a labeled indication, offered once the beta-blocker is optimized (none
    //    addable, none titratable up). Offered for any LVEF.
    const GDMT_GROUPS = new Set(['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i']);
    // "Titratable" means below the patient's target dose with a higher tier on offer (a drug at target is not unfinished GDMT).
    const belowTargetAndTitratable = (t: { current: RegimenMed }) => !isTargetDoseForPatient(t.current, patient);
    const pillarTitratable = titratableUp.some(t => GDMT_GROUPS.has(getMedicationClassGroup(t.current.med.drug_class)) && belowTargetAndTitratable(t));
    const bbOptimized = !addablePillars.has('Beta Blocker')
        && !titratableUp.some(t => t.current.med.drug_class === 'Beta Blocker' && belowTargetAndTitratable(t));
    const gdmtExhausted = addablePillars.size === 0 && !pillarTitratable;
    const digoxinIndicated =
        (patient.rhythm === 'AFib' && bbOptimized) ||
        (patient.rhythm !== 'AFib' && patient.lvef <= 40 && isNyhaIIIorIV && gdmtExhausted);
    if (digoxinIndicated) {
        const digTiers = medTiers.filter(r => r.med.drug_class === 'Inotrope');
        if (digTiers.length > 0 && !currentClasses.has('Inotrope')) {
            addableAdjuncts.push(digTiers[0]);
        }
    }

    // Diuretics if congested and not already on one (an oral loop is started; a short-course add-on is never the first loop)
    if (fluidExcess > 1.0 && !currentClasses.has('Loop Diuretic')) {
        const loopTiers = medTiers.filter(r => r.med.drug_class === 'Loop Diuretic' && !drugFacts(r.med).short_course_addon);
        // New loop start: the LOWEST tier of the first loop agent (start low, titrate to the weight response). The sampled tier list is
        // [lowest, highest, ...], and its "highest" tier is a titration step, not a start (furosemide 160 mg, i.e. 2 x 80 mg twice daily).
        if (loopTiers.length > 0) {
            const first = loopTiers[0].med;
            const ladder = first.available_doses;
            const lowFirst = loopTiers.filter(r => r.med === first)
                .sort((a, b) => ladder.findIndex(d => d.strength === a.dose.strength) - ladder.findIndex(d => d.strength === b.dose.strength));
            addableAdjuncts.push(...safeSlice(lowFirst, 1));
        }
    }

    // Short-course add-on (Furoscix label: "not for chronic use"): worsening congestion (>= 2 kg above dry weight) on an ORAL loop already on board.
    // It is added beside the oral loop for a course and the oral loop is resumed/adjusted afterwards; never a swap.
    const onOralLoop = (patient.current_regimen || []).some(r => r.med.drug_class === 'Loop Diuretic' && !drugFacts(r.med).short_course_addon);
    if (fluidExcess >= 2.0 && onOralLoop && !(patient.current_regimen || []).some(r => drugFacts(r.med).short_course_addon)) {
        const addon = medTiers.find(r => drugFacts(r.med).short_course_addon);
        if (addon) addableAdjuncts.push(addon);
    }

    // Thiazide if severe congestion + already on loop
    if (fluidExcess > 4.0 && currentClasses.has('Loop Diuretic')) {
        const thiazTiers = medTiers.filter(r => r.med.drug_class === 'Thiazide-like Diuretic');
        if (thiazTiers.length > 0 && !currentClasses.has('Thiazide-like Diuretic')) {
            addableAdjuncts.push(thiazTiers[0]);
        }
    }

    // Iron if iron-deficient (ESC 2021 / IRONMAN / AFFIRM-AHF — see isIronDeficient) AND in the evidence population (ivIronCreditTier: LVEF < 50,
    // NYHA II/III, Hb < 15). New start = the label day-1 dose from the entry's exact start tier (500 mg when Hb > 14, else 1000 mg).
    if (ivIronCreditTier(patient) !== null && !currentClasses.has('IV Iron')) {
        const ironStart = startTiers.find(r => r.med.drug_class === 'IV Iron');
        if (ironStart) addableAdjuncts.push(ironStart);
    }

    // nsMRA (Finerenone) for HFpEF as adjunct — FINEARTS-HF, LVEF ≥ 40, FDA approved
    // In HFmrEF, nsMRA is already offered as a pillar option (grouped with MRA)
    // In HFpEF, MRA is NOT a pillar, so nsMRA must be added as adjunct
    if (isHFpEF && patient.lvef >= 40 && !currentClasses.has('MRA') && !currentClasses.has('nsMRA')) {
        const nsmraTiers = startTiers.filter(r => r.med.drug_class === 'nsMRA');
        if (nsmraTiers.length > 0) {
            // Begin at the drug's declared start tier (finerenone: 20 mg if eGFR >= 60, else 10 mg) when it has one.
            const startStrength = nsmraTiers[0].med.start_dose_for?.(patient);
            addableAdjuncts.push(nsmraTiers.find(t => String(t.dose.strength) === String(startStrength)) ?? nsmraTiers[0]);
        }
    }

    // Steroidal MRA for HFpEF — TOPCAT Americas, Class IIb (ACC/AHA 2022 §7.4)
    // Cost-effective alternative to Finerenone; offered alongside nsMRA as separate candidate
    // getMedicationClassGroup groups nsMRA→MRA, preventing dual MRA in same regimen
    if (isHFpEF && !currentClasses.has('MRA') && !currentClasses.has('nsMRA')) {
        const steroidalMraTiers = startTiers.filter(r => r.med.drug_class === 'MRA');
        if (steroidalMraTiers.length > 0) {
            addableAdjuncts.push(steroidalMraTiers[0]);
        }
    }

    // GLP-1 if obese + HFpEF/HFmrEF (STEP-HFpEF, SUMMIT trials — no evidence for HFrEF or HFimpEF)
    // HFimpEF is managed as HFrEF — GLP-1 not appropriate despite LVEF >= 40.
    // Boundary matches classifyPhenotype: LVEF exactly 40 is HFrEF (quad pathway), so the gate is
    // strictly > 40 — not >= 40, which wrongly made an LVEF-40 HFrEF patient GLP-1 eligible.
    // The trial-enrollment gates (BMI >= 30 for both; LVEF >= 45 semaglutide, >= 50 tirzepatide) are each drug's own initiation checks on its
    // formulary entry, so a drug that fails them is already out of `formulary`. Every remaining agent is offered at its exact label start tier
    // (the lowest: 0.25 mg / 2.5 mg), one candidate per agent: no cross-trial "best" pick (the KCCQ effects are now placebo-adjusted and similar).
    if (patient.lvef > 40 && !isHFimpEF && !currentClasses.has('GLP-1 RA') && !currentClasses.has('GLP-1/GIP RA')) {
        startTiers.filter(r => r.med.drug_class === 'GLP-1 RA' || r.med.drug_class === 'GLP-1/GIP RA')
            .forEach(r => addableAdjuncts.push(r));
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
        redundantCurrentMeds,
        forcedReduceNames,
        forcedReduceExactStep,
        kWithholdReasons
    };
}

/**
 * The tier of `to` nearest at or just above the furosemide-equivalent TOTAL DAILY dose of `from` (both agents declare
 * facts.verified_furosemide_equivalent_per_mg), at the current dosing frequency where the tier allows it and never above the declared daily
 * maximum. If no tier reaches the equivalent dose, the highest eligible one. Null when `to` has no verified equivalence.
 */
export function equivalentSwapTier(from: RegimenMed, to: Medication, patient: Patient, fromEquivalent: number): RegimenMed | null {
    const toEquivalent = drugFacts(to).verified_furosemide_equivalent_per_mg;
    const fromDaily = dailyDose(from);
    if (toEquivalent === undefined || Number.isNaN(fromDaily)) return null;
    const wantDaily = fromDaily * fromEquivalent / toEquivalent;
    const wantFreq = dosesPerDay(from.selected_frequency);
    const options: RegimenMed[] = [];
    eligibleDoses(to, patient).forEach(dose => {
        const allowed = frequenciesWithinMax(to, dose.frequency_options, dose.strength);
        if (allowed.length === 0) return;
        const notAbove = allowed.filter(f => dosesPerDay(f) <= wantFreq);
        const f = notAbove.length > 0 ? notAbove.sort((a, b) => dosesPerDay(b) - dosesPerDay(a))[0] : allowed.sort((a, b) => dosesPerDay(a) - dosesPerDay(b))[0];
        options.push({ med: to, dose, selected_frequency: f });
    });
    if (options.length === 0) return null;
    const daily = (r: RegimenMed) => dailyDose(r);
    const atOrAbove = options.filter(r => daily(r) >= wantDaily - 1e-9).sort((a, b) => daily(a) - daily(b));
    return atOrAbove[0] ?? options.sort((a, b) => daily(b) - daily(a))[0];
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

/** Summary for adding an adjunct. A short-course add-on (facts.short_course_addon) says so: label "not for chronic use", back to the oral loop afterwards. */
export function addSummary(adj: RegimenMed): string {
    return drugFacts(adj.med).short_course_addon
        ? `Add ${adj.med.name} ${formatDose(adj)} as a SHORT COURSE beside the oral loop diuretic (label: not for chronic use); return to the oral diuretic when congestion resolves`
        : `Add ${adj.med.name} ${formatDose(adj)}`;
}

export function formatSwapSummary(from: RegimenMed, to: RegimenMed): string {
    if (from.med.drug_class === 'ACEi' && to.med.drug_class === 'ARNI') {
        return `STOP ${from.med.name}. WAIT 36 hours. THEN start ${to.med.name} ${formatDose(to)}`;
    }
    if (from.med.drug_class === 'ARNI' && to.med.drug_class === 'ACEi') {
        // Mirror rule (Zestril label 4): no ACEi within 36 hours of the last ARNI dose.
        return `STOP ${from.med.name}. WAIT 36 hours. THEN start ${to.med.name} ${formatDose(to)}`;
    }
    if (from.med.drug_class === 'Loop Diuretic' && to.med.drug_class === 'Loop Diuretic') {
        const fe = drugFacts(from.med).verified_furosemide_equivalent_per_mg, te = drugFacts(to.med).verified_furosemide_equivalent_per_mg;
        if (fe !== undefined && te !== undefined) {
            return `Swap ${from.med.name} -> ${to.med.name} ${formatDose(to)} (equivalent total daily dose: ${dailyDose(from)} ${from.dose.unit}/day ${from.med.name} is about ${dailyDose(from) * fe / te} ${to.dose.unit}/day ${to.med.name}; nearest tier at or above)`;
        }
        return `Swap ${from.med.name} -> ${to.med.name} ${formatDose(to)} (no verified dose equivalence for this pair: the prescriber must convert the dose from ${dailyDose(from)} ${from.dose.unit}/day ${from.med.name}; the lowest tier is shown)`;
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
            summary: addSummary(adj)
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
                    { action: 'add', target: adj, summary: addSummary(adj) }
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
                        { action: 'add', target: adj, summary: addSummary(adj) }
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
    if (currentRegimen.length > 0 && analysis.forcedBbDownTitrateNames.size === 0 && analysis.forcedReduceNames.size === 0) {
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
                const label = analysis.kWithholdReasons.get(r.med.name)
                    ?? (hardContraindicated ? 'contraindicated' : intoleranceReason ?? 'contraindicated');
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

    // --- f2) Force-inject the ONE-STEP dose reduction required by the potassium continuation rule (MRA at
    // K+ 5.5-5.9) or by an interaction dose cap, into every candidate that does not already reduce/remove/swap
    // that drug. Same pattern as the beta-blocker reduction above: the drug steps down one tier (the HIGHEST
    // lower tier), and safe additions survive alongside it.
    if (analysis.forcedReduceNames.size > 0) {
        analysis.forcedReduceNames.forEach((reason, medName) => {
            const td = analysis.titratableDown.find(t => t.current.med.name === medName);
            if (!td || td.options.length === 0) return;
            let lower = td.options[td.options.length - 1];
            if (analysis.forcedReduceExactStep.has(medName)) {
                // Heart-rate rule: the EXACT next-lower strength on the full ladder (carvedilol 12.5 -> 6.25, not the sampled 3.125).
                const ladder = td.current.med.available_doses;
                const idx = ladder.findIndex(d => d.strength === td.current.dose.strength);
                if (idx > 0) lower = { med: td.current.med, dose: ladder[idx - 1], selected_frequency: pickPreferredFrequency(td.current.med, ladder[idx - 1].frequency_options, patient, ladder[idx - 1].strength) };
            }
            candidates.forEach(c => {
                const alreadyHandled = c.modifications.some(m =>
                    (m.action === 'titrate_down' || m.action === 'remove' || m.action === 'swap')
                    && m.source?.med.name === medName
                );
                if (alreadyHandled) return;
                c.modifications = c.modifications.filter(m =>
                    !((m.action === 'titrate_up' || m.action === 'keep') && m.source?.med.name === medName)
                );
                c.modifications.push({
                    action: 'titrate_down',
                    source: td.current,
                    target: lower,
                    summary: `Reduce ${medName} ${td.current.dose.strength}→${lower.dose.strength}${lower.dose.unit} ${lower.selected_frequency} (${reason})`
                });
                c.resulting_regimen = c.resulting_regimen.map(r => (r.med.name === medName ? lower : r));
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
        const satisfiesForcedReduction = Array.from(analysis.forcedReduceNames.keys()).every(name =>
            c.modifications.some(m =>
                (m.action === 'titrate_down' || m.action === 'remove' || m.action === 'swap') && m.source?.med.name === name
            )
        );
        const newClassCount = countNewClassGroups(c.resulting_regimen, currentRegimen);
        const hasSteroidalMRA = c.resulting_regimen.some(r => r.med.drug_class === 'MRA');
        const hasNonSteroidalMRA = c.resulting_regimen.some(r => r.med.drug_class === 'nsMRA');
        const hasDualMRA = hasSteroidalMRA && hasNonSteroidalMRA;
        // M4: Structural block for dual RAAS (ACEi+ARB, ACEi+ARNI, etc.) — not just warning
        const raasInRegimen = c.resulting_regimen.filter(r => RAAS_CLASSES.has(r.med.drug_class));
        const hasDualRAAS = raasInRegimen.length > 1;
        return satisfiesForcedBbDownTitration && satisfiesForcedReduction && newClassCount <= maxNewPerVisit && !hasDualMRA && !hasDualRAAS;
    });
}

// --- 1. Scoring Logic (The 6 Domains) ---
