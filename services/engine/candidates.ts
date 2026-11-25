/** Current-regimen analysis and candidate-modification generation. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, Medication, RegimenMed, ModificationAction, RegimenModification, ModificationSet } from '../../types';
import { drugFacts } from './drugFacts';
import { valueUnknown, ivIronCreditTier, isBlackRace, isAcutelyDecompensated as isAcutelyDecompensatedPatient, congestionFindingCount, weightAboveDryKg, pulsePressureMmHg } from '../clinicalPredicates';
import { RAAS_CLASSES, getMedicationClassGroup, isDiureticClass } from './registry';
import { sortedByName, isCongestedAboveDryWeight, isLowOutputState, isColdState, weightBelowDryWeight, countVisitLimitChanges, renalContraindicationReason, isLoopDiureticResistant, adjacentTiers, hasCongestion, dailyCapFor, renalCapExceeded, dailyDose, dosesPerDay, eligibleDoses, frequenciesWithinMax, kUptitrationBlock, computeRedundantCurrentMeds, formatDose, getDoseTiers, hrContinuationAction, isTargetDoseForPatient, carryFrequency, kContinuationAction, pickPreferredFrequency, restrictToStartTiers } from './regimenUtils';
import { currentMedIntoleranceReason, deriveIntolerancePolicy, isRenalOnlyContraindication, MRA_POOL_CLASSES } from './intolerance';
import { assessCreatinineChange } from './renalChange';
import { UP_TITRATION_MAX_DAILY_FACTOR, BINDER_HOLD_REDUCTION_K, RAAS_EGFR_REVIEW_BELOW, CONGESTION_EXCESS_KG_ABOVE } from './thresholds';
import { regimenSatisfiesPillar, classifyPhenotype, isImprovedEF } from './domains';
import { contraindicationReasons } from './contraindications';
import { candidateHasMissingPrerequisite } from './decisionReadiness';
import { doseAnchorMg } from './doseCredit';
import { MEDICATION_FORMULARY } from '../../constants';
import { loopsExcludedForAnotherReason } from './urgentStates';

/**
 * R8 X11: the round 7 rule that refuses an option which starts a drug whose own contraindication check fails on the regimen the option produces. A switch inside a class does not re-apply a start-only
 * (trial-entry) criterion, and a forced switch whose replacement still cannot be started becomes a plain removal of the offending drug, so the rule can refuse a start but never empties the list.
 * `enabled` exists only so the counterfactual check can run the same patients with the rule off.
 */
export const START_RULE = { enabled: true };

export interface RegimenAnalysis {
    currentClassMap: Map<string, RegimenMed>;  // class group → current med+dose
    missingPillars: string[];                   // GDMT pillars not in current regimen
    titratableUp: { current: RegimenMed, options: RegimenMed[] }[];
    titratableDown: { current: RegimenMed, options: RegimenMed[] }[];
    swappable: { from: RegimenMed, candidates: RegimenMed[] }[];
    removable: RegimenMed[];
    addableAdjuncts: RegimenMed[];
    addablePillars: Map<string, RegimenMed[]>;  // missing pillar class group → candidate meds+doses
    /** Missing pillar class group → the label-start tier of EVERY drug in the group (not truncated). Pair, triple, quad and pillar+titration candidates are built over all of them, so the scorer, not formulary order, chooses the drug within a class (2026-11-16). */
    pillarStartTiers: Map<string, RegimenMed[]>;
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
    /** Why each contraindicated current drug must go, in plain words (the drug's own check text, or the kidney limit with the eGFR). Replaces the bare word "contraindicated" (S8). */
    contraindicationReasonByName: Map<string, string>;
    /** Duplicate agents of one class the patient arrived on: which is kept and why (S5). */
    duplicateNotes: { group: string; kept: RegimenMed; removed: RegimenMed[]; basis: string }[];
    /** Drugs an option would have started that the tool refused because its own check fails on the regimen the option produces (R8 X11c): name -> the check's reason. Filled while options are filtered; read after selection for the withheld list. */
    startRuleDrops: Map<string, string>;
    /** Unstable-state facts the generator and the output read (S1, S3). */
    unstable: UnstableInfo;
}

export interface UnstableInfo {
    /** Poor perfusion state (S1a): no option starts a drug or raises a dose except a diuretic when congested. */
    cold: boolean;
    /** Acute decompensation by the engine's own predicate (S1b). */
    decompensated: boolean;
    /** Congestion by the engine's predicate (weight criterion or an examination finding). */
    congested: boolean;
    /** Potassium 6.0 to 8.0 (S3): no option starts or raises any drug except a binder already on board. */
    potassiumEmergency: boolean;
    /** The loop diuretic step the congestion display rule puts in every option, when one is eligible. */
    loopStep?: { action: 'add' | 'titrate_up'; source?: RegimenMed; target: RegimenMed };
    /** Why no loop diuretic start or increase is available, when none is. */
    loopUnavailableReason?: string;
    /** R13 E3: set when only a held or completed loop record explains the missing loop step: the clause to append to `loopUnavailableReason` ONLY if the same patient with those records removed still has no oral loop step (the caller checks; analysis cannot). */
    loopNoStepClause?: string;
    /** True when the weight is the reason no new loop diuretic is offered (none on board, none excluded for another reason, the weight within the congestion threshold of dry weight) and the examination shows at least one congestion finding (R5 Y3). */
    loopHeldForWeightWithFindings?: boolean;
}

export function analyzeCurrentRegimen(
    patient: Patient,
    formulary: Medication[],
    medTiers: RegimenMed[],
    allBBExcluded = false,
    allRAASExcluded = false,
    unresolvedFoundationalClass = false
): RegimenAnalysis {
    const currentRegimen = patient.current_regimen || [];

    // Map current meds to class groups
    const currentClassMap = new Map<string, RegimenMed>();
    currentRegimen.forEach(r => {
        const group = getMedicationClassGroup(r.med.drug_class);
        currentClassMap.set(group, r);
    });

    // Determine which GDMT pillars apply based on HF phenotype
    // 2026 ESC (Table 5): HFrEF (LVEF < 50, improved EF, or a prior LVEF < 50) takes the four foundational therapies; HFpEF (LVEF >= 50, never < 50)
    // takes SGLT2i + MRA (both Class I). A RAAS inhibitor in HFpEF is Class IIb and is never added as a pillar.
    const isHFimpEF = isImprovedEF(patient);
    const isHFpEF = classifyPhenotype(patient) === 'HFpEF';
    const applicablePillars = isHFpEF
        ? ['SGLT2i', 'MRA']
        : ['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'];

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
    const pulsePressure = pulsePressureMmHg(patient);
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
    const fractionOfTargetSwapNames = new Set<string>(); // forced beta-blocker switches landed by fraction of target dose (pregnancy)
    const forcedReduceNames = new Map<string, string>();
    const kWithholdReasons = new Map<string, string>();
    const forcedReduceExactStep = new Set<string>();
    const renalDataUnknown = valueUnknown(patient.egfr) || valueUnknown(patient.creatinine);
    // Change from a baseline creatinine (optional input; renalChange.ts): 'reduce' halves a current RAAS inhibitor and MRA one step with no increase, 'stop' removes them
    // (the stop is also a contraindication check on every RAAS/MRA entry, so a new start and a swap within the class are blocked as well).
    const creatinineChange = assessCreatinineChange(patient);
    const raasOrMra = (cls: string) => RAAS_CLASSES.has(cls) || MRA_POOL_CLASSES.has(cls);
    // A diuretic is titrated to congestion. It is not INCREASED (and a contraindicated one is stopped, not replaced by another diuretic) when the patient is more
    // than 1 kg BELOW dry weight, or at or below dry weight with no congestion finding on examination. Engine policy (2026 ESC Supplementary Table S7: use the
    // lowest dose that maintains euvolaemia). Before 2026-11-12 a loop could be doubled in a patient 3 kg below dry weight and was reduced again on the next run.
    const noCongestion = diureticHeldForNoCongestion(patient);
    // Reducing or stopping a diuretic AS A VOLUME STEP needs weight at or below dry weight AND no congestion finding on examination (S2). A patient whose scale reads low but whose
    // examination shows congestion gets neither a reduction nor a removal of the diuretic as a volume step (the scale-and-examination alert says the two disagree); an INCREASE stays held.
    // T1: at potassium 6.0 or above a loop or thiazide-type diuretic (which LOWERS potassium) is never reduced or stopped as a volume step.
    const potassiumEmergencyNow = patient.potassium >= 6.0 && patient.potassium <= 8.0;
    const reduceAsVolumeStep = weightAboveDryKg(patient) <= 0 && congestionFindingCount(patient.volume_status.exam_findings) === 0 && !potassiumEmergencyNow;
    currentRegimen.forEach(r => {
        if (creatinineChange?.band === 'stop' && raasOrMra(r.med.drug_class)) {
            kWithholdReasons.set(r.med.name, `${creatinineChange.why}: ${RAAS_CLASSES.has(r.med.drug_class) ? 'stop' : 'withhold'} and seek specialist advice (2026 ESC Supplementary Tables S4/S5/S8)`);
        }
        // Potassium continuation rule (facts.k_continuation): >= withhold_at withholds the drug; the reduce band
        // is resolved with the dose tiers in the titration pass below.
        const kRule = kContinuationAction(r.med, patient);
        if (kRule?.action === 'withhold') kWithholdReasons.set(r.med.name, kRule.reason);
        // T1: at potassium 6.0 or above a loop or thiazide-type diuretic or a binder (which LOWER potassium) is not force-removed for a reason that can wait (an indication rule such as
        // "reserved for active congestion", or a kidney limit); it is removed only for a reason that cannot wait: a documented allergy or intolerance (handled below) or anuria.
        const keptForPotassium = potassiumEmergencyNow && ['Loop Diuretic', 'Thiazide-like Diuretic', 'K+ Binder'].includes(r.med.drug_class) && !patient.comorbidities.has('Anuria');
        if (keptForPotassium) {
            // fall through to the allergy and intolerance checks below, which still apply
        } else if (r.med.contraindications && r.med.contraindications(patient)) {
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
        // Pregnancy (2026 ESC heart failure guideline, Recommendation Table 27, Class I C): a non-selective beta-blocker is switched to a beta-1-selective
        // one. Routed through intolerableCurrentMeds so the forced cleanup SWAPS to an eligible beta-1-selective agent; flagged only when one is
        // available, so the beta-blocker is never simply stopped.
        if (patient.is_pregnant === true && r.med.drug_class === 'Beta Blocker' && !drugFacts(r.med).beta1_selective && !intolerableCurrentMeds.has(r.med.name)
            && formulary.some(m => m.drug_class === 'Beta Blocker' && drugFacts(m).beta1_selective)) {
            contraindicatedCurrentMeds.add(r.med.name);
            intolerableCurrentMeds.set(r.med.name, 'Pregnancy: switch to a beta-1-selective beta-blocker (2026 ESC heart failure guideline, Class I C); the suggested starting tier is not a dose equivalence; individualize the transition and reassess heart rate, blood pressure and tolerance');
            if (drugFacts(r.med).target_reference_dose !== undefined) fractionOfTargetSwapNames.add(r.med.name);
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
    // How two agents of one class are compared when the patient arrives on both (S5, T2). Doses of different drugs are never compared in milligrams. In order of preference:
    //   1. the fraction of each drug's OWN trial-achieved daily dose (data/doseEvidence.json);
    //   2. when the class has no trial dose for some member, the engine's verified furosemide-equivalent daily dose (the loop diuretics declare one each);
    //   3. otherwise the fraction of each drug's labelled maximum daily dose (facts.max_daily_dose);
    //   4. otherwise nothing is comparable and the drug listed first in the formulary is kept.
    // One measure is used for the whole class, so every pair in it is compared on the same scale, whatever order the drugs were typed in.
    const dupMembers = (r: RegimenMed) => currentRegimen.filter(x => !drugFacts(x.med).short_course_addon && getMedicationClassGroup(x.med.drug_class) === getMedicationClassGroup(r.med.drug_class));
    const daily = (r: RegimenMed) => dailyDose(r);
    type DupMeasure = { kind: 'trial' | 'equivalent' | 'label_max' | 'none'; value: (r: RegimenMed) => number | undefined };
    const dupMeasure = (r: RegimenMed): DupMeasure => {
        const ms = dupMembers(r);
        const anchored = (x: RegimenMed) => { const a = doseAnchorMg(x, patient); return a !== undefined && a > 0 && !Number.isNaN(daily(x)); };
        if (ms.every(anchored)) return { kind: 'trial', value: x => daily(x) / doseAnchorMg(x, patient)! };
        if (ms.every(x => drugFacts(x.med).verified_furosemide_equivalent_per_mg !== undefined && !Number.isNaN(daily(x)))) return { kind: 'equivalent', value: x => daily(x) * drugFacts(x.med).verified_furosemide_equivalent_per_mg! };
        if (ms.every(x => (drugFacts(x.med).max_daily_dose ?? 0) > 0 && !Number.isNaN(daily(x)))) return { kind: 'label_max', value: x => daily(x) / drugFacts(x.med).max_daily_dose! };
        return { kind: 'none', value: () => undefined };
    };
    const trialFraction = (r: RegimenMed): number | undefined => dupMeasure(r).value(r);
    const formularyOrder = (med: Medication) => { const i = MEDICATION_FORMULARY.findIndex(m => m.name === med.name); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    const redundantCurrentMeds = computeRedundantCurrentMeds(
        currentRegimen,
        med => contraindicatedCurrentMeds.has(med.name),
        { fraction: trialFraction, formularyOrder }
    );
    // Which duplicate was kept and why (S5): said on every option and in an alert asking the clinician to confirm which one the patient actually takes.
    const duplicateNotes: RegimenAnalysis['duplicateNotes'] = [];
    {
        const groups = new Map<string, RegimenMed[]>();
        currentRegimen.forEach(r => {
            if (drugFacts(r.med).short_course_addon) return;
            const g = getMedicationClassGroup(r.med.drug_class);
            if (g === 'RAAS Inhibitor' || g === 'MRA') return;
            groups.set(g, [...(groups.get(g) ?? []), r]);
        });
        [...groups.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).forEach(([group, members]) => {
            if (members.length < 2) return;
            const removed = members.filter(r => redundantCurrentMeds.has(r.med.name)).sort((a, b) => a.med.name < b.med.name ? -1 : 1);
            const kept = members.find(r => !redundantCurrentMeds.has(r.med.name));
            if (!kept || removed.length === 0) return;
            const measure = dupMeasure(kept);
            const kv = measure.value(kept), gv = removed.map(r => measure.value(r));
            const comparable = kv !== undefined && gv.every(x => x !== undefined);
            // R8 X1: shown to one decimal when the whole-number figures of the kept and a removed drug would read the same while the values differ.
            const sameWhole = (f: number | undefined, g: number | undefined) => f !== undefined && g !== undefined && Math.round(f * 100) === Math.round(g * 100);
            const decimals = comparable && gv.some(x => sameWhole(kv, x) && Math.abs(kv! - x!) > 1e-9);
            const pct = (f: number | undefined) => f === undefined ? undefined : decimals ? `${Math.round(f * 1000) / 10}%` : `${Math.round(f * 100)}%`;
            const mg = (x: number) => `${Math.round(x * 10) / 10}`;
            const dose = (r: RegimenMed) => `${r.med.name} ${mg(daily(r))} ${r.dose.unit} a day`;
            // The measure is only the reason when the kept drug really has the larger value. Where the values are EQUAL the choice is the tie-break (the drug listed first in the formulary among those that can
            // stay), and the sentence says so (R8 X1); when an unkeepable drug was set aside (it must go for its own reason) the basis says that.
            const strictlyLarger = comparable && gv.every(x => kv! > x! + 1e-9);
            const tied = comparable && !strictlyLarger && gv.every(x => kv! >= x! - 1e-9);
            const names = removed.map(r => r.med.name);
            const basis = !comparable || (!strictlyLarger && !tied)
                ? 'there is no common dose scale for these drugs (or the larger one must go for a safety reason stated on it), so the one that can stay and is listed first in the formulary is kept (doses of different drugs are not compared in milligrams)'
                : tied
                    ? (measure.kind === 'equivalent'
                        ? `the doses are equal in furosemide equivalents (${dose(kept)} is about ${mg(kv!)} mg of furosemide a day, ${removed.map((r, i) => `${dose(r)} about ${mg(gv[i]!)} mg`).join(' and ')}), so ${kept.med.name}, the one listed first in the formulary that can stay, is kept`
                        : `${kept.med.name} and ${names.join(', ')} are at the same share of ${measure.kind === 'trial' ? 'the daily dose reached in their trials' : 'their labelled maximum daily dose'} (${pct(kv)}), so ${kept.med.name}, the one listed first in the formulary that can stay, is kept (doses of different drugs are not compared in milligrams)`)
                : measure.kind === 'trial'
                    ? `${kept.med.name} is at ${pct(kv)} of the daily dose reached in its trials and ${removed.map((r, i) => `${r.med.name} at ${pct(gv[i])}`).join(', ')} (doses of different drugs are not compared in milligrams)`
                    : measure.kind === 'equivalent'
                        ? `it is the larger loop diuretic dose: ${dose(kept)} is about ${mg(kv!)} mg of furosemide a day, against ${removed.map((r, i) => `${dose(r)}, about ${mg(gv[i]!)} mg of furosemide a day`).join(' and ')} (furosemide equivalents from the drug labels)`
                        : `${kept.med.name} is at ${pct(kv)} of its labelled maximum daily dose and ${removed.map((r, i) => `${r.med.name} at ${pct(gv[i])}`).join(', ')} (doses of different drugs are not compared in milligrams)`;
            duplicateNotes.push({ group, kept, removed, basis });
        });
    }
    // Why each contraindicated current drug must go (S8): the drug's own check text, or the kidney limit with the patient's eGFR.
    const contraindicationReasonByName = new Map<string, string>();
    currentRegimen.forEach(r => {
        if (!contraindicatedCurrentMeds.has(r.med.name)) return;
        const hard = r.med.contraindications?.(patient) === true ? contraindicationReasons(r.med, patient) : [];
        // The kidney reason carries the patient's eGFR and the limit, so it leads when the drug's renal table is what removes it.
        const text = renalContraindicationReason(r.med, patient) ?? (hard.length > 0 ? hard.slice(0, 2).join('; ') : undefined);
        if (text) contraindicationReasonByName.set(r.med.name, text);
    });

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
        // Pregnancy: a non-selective beta-blocker that could not be switched (no beta-1-selective agent is eligible) is kept, never INCREASED
        // (2026 ESC Recommendation Table 27 asks for the switch; raising the dose of the agent to be replaced contradicts it).
        const pregnancyNonSelectiveBb = patient.is_pregnant === true && current.med.drug_class === 'Beta Blocker' && !drugFacts(current.med).beta1_selective;
        const isBBBlockedUp = (isAcutelyDecompensated && current.med.drug_class === 'Beta Blocker') || pregnancyNonSelectiveBb;
        const isBBForcedDown = forceDownBB && current.med.drug_class === 'Beta Blocker';
        // Forced ONE-STEP reduction: potassium 5.5-5.9 on an MRA (label rule), or a dose above an interaction cap.
        const kRule = kContinuationAction(current.med, patient);
        const cap = current.med.interaction_dose_cap?.(patient) ?? null;
        const aboveCap = cap !== null && Number(current.dose.strength) > cap.max_dose;
        // Arriving ABOVE the renal dose cap: compared with the total daily dose where the entry's cap is a daily maximum (facts.renal_cap_is_daily).
        const renalCapHit = renalCapExceeded(current, patient);
        // Heart-rate rule (beta-blockers, ivabradine): below facts.hr_continuation.reduce_below the drug drops ONE step
        // (withheld at the lowest dose); below no_uptitration_below it is not up-titrated. Never a removal at a higher dose.
        const hrRule = hrContinuationAction(current.med, patient);
        const reduceReason = (kRule?.action === 'reduce' ? kRule.reason : undefined)
            ?? (aboveCap ? `${cap!.reason}: current dose is above the maximum` : undefined)
            ?? (renalCapHit?.reason ? `${renalCapHit.reason}: dose ${renalCapHit.amount} ${current.dose.unit} is above the maximum of ${renalCapHit.cap} ${current.dose.unit}` : undefined)
            ?? (renalCapHit ? `eGFR ${patient.egfr}: ${renalCapHit.basis === 'daily' ? 'total daily dose' : 'dose'} ${renalCapHit.amount} ${current.dose.unit} is above the renal maximum of ${renalCapHit.cap} ${current.dose.unit}${renalCapHit.basis === 'daily' ? '/day' : ''}` : undefined)
            ?? (hrRule?.reduce ? hrRule.reduceReason : undefined)
            ?? (creatinineChange?.band === 'reduce' && raasOrMra(current.med.drug_class) ? `${creatinineChange.why}: halve the dose (one step), recheck in 1-2 weeks, no increase until stable (2026 ESC Supplementary Tables S4/S5/S8)` : undefined);

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

        const diureticHold = isDiureticClass(current.med.drug_class) && noCongestion;
        // Rule E20's counterpart for a drug in use: no RAAS inhibitor increase at a measured eGFR below 20 (the alert asks whether the fall is new).
        const renalUpHold = RAAS_CLASSES.has(current.med.drug_class) && patient.egfr > 0 && patient.egfr < RAAS_EGFR_REVIEW_BELOW;
        if (!isContraindicated && !isBBBlockedUp && reduceReason === undefined && !hrRule?.blockUp && !kUpBlock && !diureticHold && !renalUpHold) {
            // Sorted ASCENDING by dose index so consumers can rely on options[last] being the
            // highest tier (getDoseTiers construction order is [lowest, highest, middle, target],
            // which is NOT ascending — the compound add+titrate candidate previously picked a
            // middle/target tier while labeling it the maximal step).
            let higherDoses = withNeighbour(allTiers.filter(t => tierIdx(t) > currentIdx).map(t => carryFrequency(t, current, dailyCapFor(current.med, patient))), adjacent.up).filter(t => changesDaily(t, 1)).sort((a, b) => tierIdx(a) - tierIdx(b));
            // Dose-step cap (UP_TITRATION_MAX_DAILY_FACTOR): one visit at most doubles the total daily dose; the immediate next tier is always kept.
            // Compared on the LEADING component for a combination strength ("24/26" -> 24): Number("24/26") is NaN, which used to switch the cap off for
            // sacubitril/valsartan (24/26 -> 97/103 in one visit) and H/ISDN (adversarial review 2026-11-12).
            const currentDaily = comparableDailyDose(current);
            // The always-kept next tier is given at the FEWEST doses per day that still raises the daily dose, when its preferred frequency would more than
            // double it (furosemide 80 mg once daily -> 160 mg once... is not offered; 80 mg twice daily is the next step, not 160 mg twice daily).
            if (higherDoses.length > 0 && !Number.isNaN(currentDaily) && comparableDailyDose(higherDoses[0]) > currentDaily * UP_TITRATION_MAX_DAILY_FACTOR) {
                const gentler = smallestStepAbove(current, patient, currentDaily);
                if (gentler) higherDoses = [gentler, ...higherDoses.filter(t => comparableDailyDose(t) > comparableDailyDose(gentler))];
            }
            higherDoses = higherDoses.filter((t, i) => i === 0 || Number.isNaN(currentDaily) || !(comparableDailyDose(t) > currentDaily * UP_TITRATION_MAX_DAILY_FACTOR));
            // facts.titrate_one_step (weekly GLP-1 / GLP-1-GIP): only the NEXT labeled tier, never a jump past a step.
            if (drugFacts(current.med).titrate_one_step) higherDoses = higherDoses.slice(0, 1);
            if (higherDoses.length > 0 && !drugFacts(current.med).single_course_dose) {
                titratableUp.push({ current, options: higherDoses });
            }
        }

        // One visit offers the gentlest eligible reduction in TOTAL daily dose, including a frequency-only
        // reduction. Sampling strengths alone skipped 80 mg tid -> 80 mg bid and offered 40 mg bid (a 2/3 cut).
        // Required renal/interaction caps still constrain the destination; the exact heart-rate step below is retained.
        const gentlerDown = smallestStepBelow(current, patient);
        // A capped effect curve does not establish that a smaller loop dose is equally effective.
        // In ongoing congestion, do not offer an elective reduction solely within that modeled plateau:
        // it gained adherence points and immediately reversed a resistance switch on the next run.
        // Mandatory safety reductions are preserved; decongested patients can still step down.
        const plateauInCongestion = loopReductionHeldAtModeledPlateau(current, gentlerDown, patient);
        // Unquantified loss of benefit cannot justify reducing established therapy for a cheaper or simpler score.
        const reductionIndicated = reduceReason !== undefined || isBBForcedDown || (isDiureticClass(current.med.drug_class) && reduceAsVolumeStep);
        const lowerDoses = gentlerDown && reductionIndicated && !(plateauInCongestion && reduceReason === undefined) ? [gentlerDown] : [];
        // A one-time label course (facts.single_course_dose: ferric carboxymaltose) is not a titratable dose: no up/down candidates.
        // A potassium binder is not reduced while the potassium that calls for it persists (measured potassium at or above BINDER_HOLD_REDUCTION_K): lowering it
        // scored slightly better on the sodium note while raising projected potassium, so the tool lowered a binder it had added on the previous run.
        const binderStillNeeded = drugFacts(current.med).rescue_role?.kind === 'k_binder' && patient.potassium > 0 && patient.potassium >= BINDER_HOLD_REDUCTION_K;
        if (lowerDoses.length > 0 && !drugFacts(current.med).single_course_dose && !binderStillNeeded) {
            titratableDown.push({ current, options: lowerDoses });
            if (isBBForcedDown) {
                forcedBbDownTitrateNames.add(current.med.name);
            }
        }
        if (reduceReason !== undefined && !isContraindicated) {
            if (lowerDoses.length > 0) {
                forcedReduceNames.set(current.med.name, reduceReason);
                if (hrRule?.reduce && kRule?.action !== 'reduce' && !aboveCap && !renalCapHit) forcedReduceExactStep.add(current.med.name);
            } else if (kRule?.action === 'reduce') {
                // Already at the lowest dose: the label says withhold.
                kWithholdReasons.set(current.med.name, kRule.lowestDoseReason ?? kRule.reason);
                contraindicatedCurrentMeds.add(current.med.name);
            } else if (hrRule?.reduce) {
                // Already at the lowest dose and still bradycardic: withhold (carvedilol/metoprolol/ivabradine labels: reduce, and
                // for ivabradine stop at the lowest dose). The summary states the heart rate.
                kWithholdReasons.set(current.med.name, hrRule.withholdReason);
                contraindicatedCurrentMeds.add(current.med.name);
            }
        }
    });

    // S9: a switch inside a class must pass the SAFETY start limits of the drug switched to. The drug's own checks waive some start limits when any drug of the class is on board
    // (the SGLT2 kidney limit); here they are evaluated as if the class were not on board, so the waiver cannot carry a patient onto a drug whose limit they fail. Checks marked
    // `indication` (a trial-entry criterion such as body mass index for a GLP-1 drug) are not re-applied to a switch; `swapSummary` says so.
    const switchSafetyBlocks = (target: Medication, source: RegimenMed): string[] => {
        const asNew = { ...patient, current_regimen: currentRegimen.filter(r => r !== source) } as Patient;
        return (target.contraindication_checks ?? []).filter(c => !c.indication && c.when(asNew)).map(c => c.reason);
    };

    // Swap analysis: for each current med, find other meds in same class group.
    // Contraindicated current meds CAN be swapped to a non-contraindicated alternative
    // (preserves drug class coverage vs outright removal). Swap candidates that are
    // themselves contraindicated are filtered out.
    const swappable: RegimenAnalysis['swappable'] = [];
    const fluidExcess = weightAboveDryKg(patient);
    currentRegimen.forEach(current => {
        // A REDUNDANT duplicate (e.g. the second beta-blocker / loop diuretic) must be REMOVED, not
        // swapped to another agent in the same group — swapping would preserve the duplication. The
        // keeper covers the class; the duplicate is force-removed downstream.
        if (redundantCurrentMeds.has(current.med.name)) return;
        // A short-course add-on (Furoscix) sits BESIDE an oral loop: it is stopped, never "swapped" for a second oral loop.
        if (drugFacts(current.med).short_course_addon) return;
        // A drug WITHHELD by a potassium, heart-rate or kidney rule is stopped: the reason applies to its whole class, so it is not swapped for a sibling
        // (spironolactone withheld at potassium 5.5 was being swapped to eplerenone 25 mg, which the next run then withheld).
        if (kWithholdReasons.has(current.med.name)) return;
        // A contraindicated diuretic in a patient who is not congested is stopped, not replaced by another diuretic.
        if (isDiureticClass(current.med.drug_class) && noCongestion) return;
        const group = getMedicationClassGroup(current.med.drug_class);
        // For beta-blockers, MRAs, and SGLT2i, a lateral swap to a DIFFERENT agent in the same
        // class is not how therapy is escalated — you up-titrate the existing agent. Offer such a
        // swap ONLY when the current agent is contraindicated (then it must be replaced). Otherwise
        // skip the swap so dose escalation happens via titrate_up of the current agent. (RAAS keeps
        // swaps for the ACEi/ARB→ARNI guideline upgrade in HFrEF.) Loop diuretics join the set (2026-11-11): TRANSFORM-HF found no outcome
        // difference between torsemide and furosemide, so a loop is titrated to the volume response, not swapped; a loop-to-loop swap is offered only
        // when the current loop must go (allergy, intolerance, contraindication). A short-course add-on (Furoscix) is never a swap target.
        // GLP-1 Therapy joins the set (verified-sglt2-glp1-adjuncts.md): a new GLP-1 start begins at its lowest labeled tier, so a lateral swap to the
        // other agent mid-escalation (e.g. semaglutide 1.7 mg -> tirzepatide 2.5 mg) is not how therapy is escalated; swap only when the current agent must go.
        // 2026-11-12: the rule is now the DEFAULT for every class group except the RAAS pool (whose only non-forced swap is the ACEi/ARB -> ARNI upgrade below).
        // A lateral metolazone -> chlorthalidone or patiromer -> Lokelma swap was being offered, and ranked, as a treatment step.
        const TITRATE_NOT_SWAP = group !== 'RAAS Inhibitor';
        // Diuretic resistance (2026 ESC Supplementary Table S7: "consider switching furosemide to bumetanide or torasemide"): a loop may also be swapped when the patient
        // stays congested (more than 1 kg above dry weight) on a HIGH dose of the current loop, high dose = the entry's own alert level (facts.high_dose_threshold).
        // The switch is one-way, as the guideline states it: FROM furosemide (variable oral absorption; facts.resistance_switch_source) to bumetanide or torsemide.
        // Offered from any loop, the tool switched torsemide to furosemide and back on alternate visits (adversarial review 3, 2026-11-12).
        const loopResistant = isLoopDiureticResistant(patient, current) && drugFacts(current.med).resistance_switch_source === true;
        if (TITRATE_NOT_SWAP && !contraindicatedCurrentMeds.has(current.med.name) && !loopResistant) return;
        const sourceContraindicated = contraindicatedCurrentMeds.has(current.med.name);
        const groupTiers = (tiersByGroup.get(group) || []).filter(t => startTiers.includes(t));
        let candidates = groupTiers.filter(t =>
            t.med.name !== current.med.name &&
            !currentRegimen.some(r => r !== current && r.med.name === t.med.name) && // Don't swap TO a drug already on board (it would be listed twice)
            !contraindicatedCurrentMeds.has(t.med.name) && // Don't swap TO a contraindicated med
            !drugFacts(t.med).short_course_addon &&        // A short-course add-on (Furoscix, "not for chronic use") is never a standing replacement
            switchSafetyBlocks(t.med, current).length === 0 // A switch inside a class passes the kidney and other safety start limits of the drug switched to (S9)
        );
        // Within the RAAS group, a non-forced swap may only UPGRADE (ACEi/ARB → ARNI, the
        // guideline-preferred agent — PARADIGM-HF). Never recommend the reverse downgrade
        // (ARNI → ACEi/ARB) purely to reach a target dose — that loses the ARNI benefit; the ARNI
        // should be up-titrated instead. (A contraindicated source can still swap to any non-CI
        // alternative.)
        // The upgrade is a heart-failure-with-reduced-EF recommendation (2026 ESC Table 5: switch ACEi/ARB to ARNI, Class I B1, symptomatic HFrEF). In HFpEF a RAAS
        // inhibitor is Class IIb and any one of them is as good as another, so a non-forced swap is not offered there.
        if (group === 'RAAS Inhibitor' && !sourceContraindicated) {
            candidates = isHFpEF ? [] : candidates.filter(t => t.med.drug_class === 'ARNI' && current.med.drug_class !== 'ARNI');
        }
        // Forced pregnancy beta-blocker switch: the swap-in is the tier nearest (rounding down, never below the start tier) the SAME FRACTION OF THE TARGET DOSE
        // (facts.target_reference_dose, 2026 ESC Table 11 per-dose targets). ENGINE POLICY: no source gives a beta-blocker dose equivalence.
        if (current.med.drug_class === 'Beta Blocker') {
            const seen = new Set<string>();
            candidates = candidates.flatMap(t => {
                if (seen.has(t.med.name)) return [];
                seen.add(t.med.name);
                // The switch must not undo a reduction the patient's state calls for: with a heart rate below the current agent's reduce threshold the fraction is
                // taken from ONE STEP BELOW the current dose, and in a low-output state (or the forced reduction of acute decompensation with hypoperfusion) the
                // new agent lands on its starting tier. Before 2026-11-12 the pregnancy switch ignored both and could land on the full target dose at heart rate 52
                // with LVEF 15 (adversarial review 3).
                const idx = current.med.available_doses.findIndex(d => String(d.strength) === String(current.dose.strength));
                const stepDown = hrContinuationAction(current.med, patient)?.reduce === true && idx > 0
                    ? { ...current, dose: current.med.available_doses[idx - 1] } : current;
                const landed = fractionOfTargetTier(stepDown, t.med, patient, forceDownBB || isLowOutputState(patient));
                return landed ? [landed] : [t];
            });
        }
        // Forced loop-to-loop swap at an EQUIVALENT total daily dose (facts.verified_furosemide_equivalent_per_mg on both agents): the swap-in is the NEAREST
        // tier to the equivalent daily dose (not the new loop's lowest tier), never above the drug's declared daily maximum. An agent without a verified equivalence keeps its lowest tier.
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
            if (current.exposure?.status === 'active' && current.exposure?.adherence === 'consistent') swappable.push({ from: current, candidates: prioritizedCandidates });
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
        // Removal as a volume step also needs no congestion finding on examination (S2).
        const noFindings = congestionFindingCount(patient.volume_status.exam_findings) === 0;
        if (r.med.drug_class === 'Loop Diuretic' && fluidExcess < 0.5 && noFindings && !potassiumEmergencyNow) {
            removable.push(r);
        }
        if (r.med.drug_class === 'Thiazide-like Diuretic' && fluidExcess < 0.5 && noFindings && !potassiumEmergencyNow) {
            removable.push(r);
        }
    });

    // Addable pillars: meds for missing GDMT pillars
    const addablePillars = new Map<string, RegimenMed[]>();
    const pillarStartTiers = new Map<string, RegimenMed[]>();
    missingPillars.forEach(pillar => {
        const candidates = tiersByGroup.get(pillar) || [];
        const offered = safeSlice(candidates, 4).filter(t => startTiers.includes(t));
        if (offered.length > 0) {
            addablePillars.set(pillar, offered);
            // Root cause of the fixed-representative defect: `safeSlice(candidates, 4)` keeps the first four TIERS of the group (the first drug's ladder), so a later drug of the
            // class (eplerenone after spironolactone) never reached the pair/triple builders, which also read only element [0]. Every drug's start tier is kept here.
            pillarStartTiers.set(pillar, candidates.filter(t => startTiers.includes(t)));
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
    // Class-wide inability comes from actual exclusions, not missing data or deselected drugs.
    const raasOrUnable = hasRAASInCurrent || allRAASExcluded;
    const bbOrUnable = currentClasses.has('Beta Blocker') || (patient.pulse > 0 && allBBExcluded === true);
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

    // Digoxin (verified-rate-control.md rows 18-19; Lanoxin label; 2026 ESC Table 5: Class IIa, level B1, symptomatic HFrEF with LVEF 40 or below despite
    // optimal foundational therapy; 2022 AHA/ACC/HFSA Class 2b):
    //  - Any rhythm: symptomatic (NYHA II-IV) HFrEF with LVEF <= 40 that persists on maximally tolerated GDMT, defined from the engine's own concepts:
    //    no pillar is still addable and no pillar can still be titrated up (blocked or contraindicated pillars count as exhausted). A weak
    //    recommendation never competes with an open guideline pillar. Not offered above LVEF 40. (Before 2026-11-11: NYHA III-IV and non-AFib only.)
    //  - Atrial fibrillation: rate control is a labeled indication, offered once the beta-blocker is optimized (none
    //    addable, none titratable up). Offered for any LVEF.
    const GDMT_GROUPS = new Set(['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i']);
    // "Titratable" means below the patient's target dose with a higher tier on offer (a drug at target is not unfinished GDMT).
    const belowTargetAndTitratable = (t: { current: RegimenMed }) => !isTargetDoseForPatient(t.current, patient);
    const pillarTitratable = titratableUp.some(t => GDMT_GROUPS.has(getMedicationClassGroup(t.current.med.drug_class)) && belowTargetAndTitratable(t));
    const bbOptimized = (currentClasses.has('Beta Blocker') || allBBExcluded || isAcutelyDecompensated) && !addablePillars.has('Beta Blocker')
        && !titratableUp.some(t => t.current.med.drug_class === 'Beta Blocker' && belowTargetAndTitratable(t));
    const gdmtExhausted = patient.potassium > 0 && patient.egfr > 0 && patient.creatinine > 0 && patient.pulse > 0
        && !(patient.sex === 'Female' && patient.is_pregnant === undefined)
        && !unresolvedFoundationalClass && addablePillars.size === 0 && !pillarTitratable;
    const digoxinIndicated =
        (patient.rhythm === 'AFib' && bbOptimized) ||
        (patient.lvef <= 40 && patient.nyha_class !== 'I' && gdmtExhausted);
    if (digoxinIndicated) {
        const digTiers = medTiers.filter(r => r.med.drug_class === 'Inotrope');
        if (digTiers.length > 0 && !currentClasses.has('Inotrope')) {
            addableAdjuncts.push(digTiers[0]);
        }
    }

    // Diuretics if congested and not already on one (an oral loop is started; a short-course add-on is never the first loop)
    // R10 A1: Furoscix alone is not an oral loop on board, so a congested patient taking only Furoscix is offered the same oral loop start as one who takes none.
    const onAnyOralLoopForStart = currentRegimen.some(r => r.med.drug_class === 'Loop Diuretic' && !drugFacts(r.med).short_course_addon);
    if (isCongestedAboveDryWeight(patient) && !onAnyOralLoopForStart) {
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

    // nsMRA (finerenone) as the alternative MRA in HFpEF (FINEARTS-HF, LVEF >= 40; 2026 ESC Table 5: steroidal or non-steroidal MRA, Class I).
    // The steroidal MRA is offered by the pillar path (MRA is a foundational HFpEF therapy); finerenone is added here as a separate candidate.
    // In the former HFmrEF range (LVEF 41-49, now HFrEF) the steroidal MRA is the recommended agent and finerenone is not offered as an extra option.
    // getMedicationClassGroup groups nsMRA with MRA, preventing dual MRA in one regimen.
    if (isHFpEF && patient.lvef >= 40 && !currentClasses.has('MRA') && !currentClasses.has('nsMRA')) {
        const nsmraTiers = startTiers.filter(r => r.med.drug_class === 'nsMRA');
        if (nsmraTiers.length > 0) {
            // Begin at the drug's declared start tier (finerenone: 20 mg if eGFR >= 60, else 10 mg) when it has one.
            const startStrength = nsmraTiers[0].med.start_dose_for?.(patient);
            addableAdjuncts.push(nsmraTiers.find(t => String(t.dose.strength) === String(startStrength)) ?? nsmraTiers[0]);
        }
    }

    // GLP-1 if obese and LVEF above 40 (STEP-HFpEF, SUMMIT trials; 2026 ESC IIa B1 at LVEF 45 or higher — no evidence for LVEF 40 or lower or improved EF)
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

    // Unstable-state facts (S1, S3): the generator injects the congestion display rule's loop step and filters what a cold or potassium-emergency option may contain.
    const congested = hasCongestion(patient);
    const unstable: UnstableInfo = {
        cold: isColdState(patient), decompensated: isAcutelyDecompensatedPatient(patient), congested,
        potassiumEmergency: patient.potassium >= 6.0 && patient.potassium <= 8.0,
    };
    {
        const standing = [...titratableUp].sort((a, b) => a.current.med.name < b.current.med.name ? -1 : 1).find(t => t.current.med.drug_class === 'Loop Diuretic' && !drugFacts(t.current.med).short_course_addon);
        const startLoop = addableAdjuncts.find(a => a.med.drug_class === 'Loop Diuretic' && !drugFacts(a.med).short_course_addon);
        // A loop step is eligible only if the engine's own prerequisites let it through (confirmed use and dose interval for an increase, a measured potassium and kidney function).
        const passes = (action: 'add' | 'titrate_up', source: RegimenMed | undefined, target: RegimenMed) => !candidateHasMissingPrerequisite(patient, { modifications: [{ action, source, target, summary: '' }], resulting_regimen: [] });
        let blockedByPrerequisite = false;
        if (standing && passes('titrate_up', standing.current, standing.options[0])) unstable.loopStep = { action: 'titrate_up', source: standing.current, target: standing.options[0] };
        else if (!standing && startLoop && passes('add', undefined, startLoop)) unstable.loopStep = { action: 'add', target: startLoop };
        else if (standing || startLoop) blockedByPrerequisite = true;
        // R11 B1: a held or completed loop diuretic record (any loop, Furoscix included) stops every loop start or raise until its status is confirmed. When that record is what blocks the step, the note
        // says so, instead of saying a prerequisite of the active loop is missing. `otherPrerequisiteMissing` is true only when the step still fails with those records set aside.
        const loopRecordNames = [...new Set((patient.recorded_medication_exposures ?? []).filter(r => r.med.drug_class === 'Loop Diuretic' && !r.exposure?.restart_or_repeat_reviewed
            && (r.exposure?.status === 'held' || r.exposure?.status === 'completed')).map(r => r.med.name.replace(/\s*\(.*\)/, '')))].sort();
        const withoutLoopRecords: Patient = { ...patient, recorded_medication_exposures: (patient.recorded_medication_exposures ?? []).filter(r => r.med.drug_class !== 'Loop Diuretic') };
        const passesWithoutRecords = (action: 'add' | 'titrate_up', source: RegimenMed | undefined, target: RegimenMed) => !candidateHasMissingPrerequisite(withoutLoopRecords, { modifications: [{ action, source, target, summary: '' }], resulting_regimen: [] });
        const stepWithoutRecords = (standing && passesWithoutRecords('titrate_up', standing.current, standing.options[0])) || (!standing && !!startLoop && passesWithoutRecords('add', undefined, startLoop));
        const otherPrerequisiteMissing = blockedByPrerequisite && !stepWithoutRecords;
        const heldLoopCause = `a loop diuretic recorded as held or as a completed course (${loopRecordNames.join(', ')}) must be confirmed before any loop diuretic is started or raised`;
        if (!unstable.loopStep) {
            // The loop that stays (a duplicate entry being cleaned up is not the loop whose dose the plan sets, T2).
            const loopCurrent = sortedByName(currentRegimen).find(r => r.med.drug_class === 'Loop Diuretic' && !drugFacts(r.med).short_course_addon && !redundantCurrentMeds.has(r.med.name));
            const anuria = patient.comorbidities.has('Anuria');
            const maxed = !!loopCurrent && !adjacentTiers(loopCurrent, patient).up;
            // R6 V1: only an allergy that names a loop diuretic is offered as a cause of "every loop diuretic is excluded", so an unrelated allergy entry changes nothing.
            // R6 V15d: a recorded potassium below 3.5 is the reason (the hold is the engine's own rule), whether or not another prerequisite is also open.
            unstable.loopUnavailableReason = patient.potassium > 0 && patient.potassium < 3.5 && !patient.comorbidities.has('Anuria') ? 'potassium is below 3.5: correct it first'
                : blockedByPrerequisite && loopRecordNames.length > 0 && !otherPrerequisiteMissing ? heldLoopCause
                : blockedByPrerequisite && loopRecordNames.length > 0 ? `a prerequisite is missing for the oral loop diuretic (confirm the current dose, actual use and the dose interval, or enter the missing laboratory value: see the review prompts in the alerts); also, ${heldLoopCause}`
                : blockedByPrerequisite ? 'a prerequisite is missing for the oral loop diuretic (confirm the current dose, actual use and the dose interval, or enter the missing laboratory value: see the review prompts in the alerts)'
                : anuria ? 'anuria is a labeled contraindication to loop diuretics'
                : MEDICATION_FORMULARY.some(m => m.drug_class === 'Loop Diuretic' && patient.allergies.has(m.name)) && !formulary.some(m => m.drug_class === 'Loop Diuretic' && !drugFacts(m).short_course_addon) && !loopCurrent ? 'every loop diuretic is excluded for this patient (allergy, anuria or another rule: see the withheld drugs)'
                : weightBelowDryWeight(patient) ? 'the weight is more than 1 kg below the recorded dry weight'
                : patient.potassium > 0 && patient.potassium < 3.5 ? 'potassium is below 3.5: correct it first'
                : loopCurrent && maxed && !contraindicatedCurrentMeds.has(loopCurrent.med.name) ? 'the oral loop diuretic is already at the highest dose the tool offers'
                : !loopCurrent && !isCongestedAboveDryWeight(patient) ? `a new loop diuretic is started only when the weight is more than ${CONGESTION_EXCESS_KG_ABOVE} kg above dry weight`
                : loopRecordNames.length > 0 ? heldLoopCause // R13 E3: the "also, no step passed" clause (R12 D2) is added by the caller only when the patient without the records still has no loop step
                : "no oral loop diuretic step passed the tool's rules for this patient";
            if (loopRecordNames.length > 0 && unstable.loopUnavailableReason === heldLoopCause) unstable.loopNoStepClause = "; also, no oral loop diuretic step passed the tool's rules for this patient";
            unstable.loopHeldForWeightWithFindings = !loopCurrent && !blockedByPrerequisite && !weightBelowDryWeight(patient) && !isCongestedAboveDryWeight(patient) && !loopsExcludedForAnotherReason(patient) && congestionFindingCount(patient.volume_status.exam_findings) > 0;
        }
    }

    return {
        contraindicationReasonByName, duplicateNotes, unstable, startRuleDrops: new Map<string, string>(),
        currentClassMap,
        missingPillars,
        titratableUp,
        titratableDown,
        swappable,
        removable,
        addableAdjuncts,
        addablePillars,
        pillarStartTiers,
        contraindicatedCurrentMeds,
        intolerableCurrentMeds,
        forcedBbDownTitrateNames,
        redundantCurrentMeds,
        forcedReduceNames,
        forcedReduceExactStep,
        kWithholdReasons
    };
}

/** True when a diuretic is not increased for this patient: more than 1 kg below dry weight, or at or below dry weight with no congestion finding on examination. */
export function diureticHeldForNoCongestion(patient: Patient): boolean {
    const weightExcess = weightAboveDryKg(patient);
    return weightExcess < -1.0 || (weightExcess <= 0 && congestionFindingCount(patient.volume_status.exam_findings) === 0);
}

/** Total daily dose for ORDERING doses of one drug: a combination strength ("24/26", "37.5/20") is read by its leading component. */
export function comparableDailyDose(r: RegimenMed): number {
    return parseFloat(String(r.dose.strength)) * dosesPerDay(r.selected_frequency);
}

/**
 * The smallest increase in total daily dose available for a drug the patient takes: every eligible strength x allowed frequency (within the declared and renal
 * daily maxima) above the current daily dose, lowest first; a tie goes to fewer doses per day. Used when the next strength at its usual frequency would more
 * than double the dose. Null when no combination raises the dose.
 */
export function smallestStepAbove(current: RegimenMed, patient: Patient, currentDaily: number): RegimenMed | null {
    const cap = dailyCapFor(current.med, patient);
    const options: RegimenMed[] = [];
    eligibleDoses(current.med, patient).forEach(dose => {
        frequenciesWithinMax(current.med, dose.frequency_options, dose.strength).forEach(f => {
            const r = { med: current.med, dose, selected_frequency: f };
            const d = comparableDailyDose(r);
            if (d > currentDaily + 1e-9 && (cap === undefined || d <= cap)) options.push(r);
        });
    });
    if (options.length === 0) return null;
    return options.sort((a, b) => comparableDailyDose(a) - comparableDailyDose(b) || dosesPerDay(a.selected_frequency) - dosesPerDay(b.selected_frequency))[0];
}

/** A flat model above its calibration ceiling does not prove dose equivalence during ongoing congestion. */
export function loopReductionHeldAtModeledPlateau(current: RegimenMed, lower: RegimenMed | null, patient: Patient): boolean {
    return current.med.drug_class === 'Loop Diuretic' && lower !== null
        && hasCongestion(patient);
}

/** Engine sequencing policy: nearest lower allowed daily dose, never a higher strength; ties prefer
 * the current frequency, then fewer administrations. The same declared dose caps as increases apply.
 */
export function smallestStepBelow(current: RegimenMed, patient: Patient): RegimenMed | null {
    // eligibleDoses already applies per-dose caps. Only an explicitly DAILY renal cap limits frequency.
    const cap = drugFacts(current.med).renal_cap_is_daily ? dailyCapFor(current.med, patient) : undefined;
    const currentDaily = comparableDailyDose(current);
    const options = eligibleDoses(current.med, patient).flatMap(dose =>
        frequenciesWithinMax(current.med, dose.frequency_options, dose.strength).map(selected_frequency => ({ med: current.med, dose, selected_frequency }))
    ).filter(r => parseFloat(String(r.dose.strength)) <= parseFloat(String(current.dose.strength))
        && comparableDailyDose(r) < currentDaily - 1e-9 && (cap === undefined || comparableDailyDose(r) <= cap));
    return options.sort((a, b) => comparableDailyDose(b) - comparableDailyDose(a)
        || Number(b.selected_frequency === current.selected_frequency) - Number(a.selected_frequency === current.selected_frequency)
        || dosesPerDay(a.selected_frequency) - dosesPerDay(b.selected_frequency))[0] ?? null;
}

/**
 * Structural problems that make a regimen unprescribable whatever its score: the same drug listed twice, two agents of one class group (a short-course add-on
 * beside its oral loop is the one allowed pair), or a short-course add-on with no oral loop to sit beside. Every candidate is checked AFTER the forced edits,
 * so a combination of individually valid changes (swap X to Y + add Y) cannot reach the clinician (adversarial review 2026-11-12).
 */
export function structuralProblems(regimen: RegimenMed[]): string[] {
    const problems: string[] = [];
    const names = new Set<string>();
    const groups = new Map<string, string>();
    regimen.forEach(r => {
        if (names.has(r.med.name)) problems.push(`${r.med.name} listed twice`);
        names.add(r.med.name);
        if (drugFacts(r.med).short_course_addon) return;
        const g = getMedicationClassGroup(r.med.drug_class);
        if (groups.has(g) && groups.get(g) !== r.med.name) problems.push(`two ${g} agents (${groups.get(g)} and ${r.med.name})`);
        groups.set(g, r.med.name);
    });
    regimen.forEach(r => {
        if (!drugFacts(r.med).short_course_addon) return;
        const g = getMedicationClassGroup(r.med.drug_class);
        if (!regimen.some(o => o !== r && !drugFacts(o.med).short_course_addon && getMedicationClassGroup(o.med.drug_class) === g)) problems.push(`${r.med.name} without an oral ${g}`);
    });
    return problems;
}

/** Conservative switch proposal: start tier, never a claimed cross-drug dose equivalence.
 * An individualized transition/taper plan must be reviewed before implementation. */
export function fractionOfTargetTier(_from: RegimenMed, to: Medication, patient: Patient, _landAtStart = false): RegimenMed | null {
    const eligible = eligibleDoses(to, patient).filter(d => typeof d.strength === 'number').sort((a,b) => Number(a.strength)-Number(b.strength));
    const dose = eligible.find(d => Number(d.strength) === Number(to.start_dose_for?.(patient))) ?? eligible[0];
    return dose ? { med: to, dose, selected_frequency: pickPreferredFrequency(to, dose.frequency_options, patient, dose.strength) } : null;
}

/**
 * The tier of `to` NEAREST to the furosemide-equivalent TOTAL DAILY dose of `from` (both agents declare facts.verified_furosemide_equivalent_per_mg), at the
 * current dosing frequency where the tier allows it and never above the declared daily maximum (frequenciesWithinMax). A tie between two tiers goes to the
 * lower dose (the safer side). Null when `to` has no verified equivalence. (Before 2026-11-11: nearest at or above.)
 */
export function equivalentSwapTier(from: RegimenMed, to: Medication, patient: Patient, fromEquivalent: number): RegimenMed | null {
    const toEquivalent = drugFacts(to).verified_furosemide_equivalent_per_mg;
    const fromDaily = dailyDose(from);
    if (toEquivalent === undefined || Number.isNaN(fromDaily)) return null;
    const wantDaily = fromDaily * fromEquivalent / toEquivalent;
    const wantFreq = dosesPerDay(from.selected_frequency);
    // Every allowed dose x frequency combination (within the declared daily maximum) is a candidate; the nearest total daily dose wins, a tie goes to the lower
    // dose, then to the frequency closest to the current one.
    const options: RegimenMed[] = [];
    eligibleDoses(to, patient).forEach(dose => {
        frequenciesWithinMax(to, dose.frequency_options, dose.strength).forEach(f => options.push({ med: to, dose, selected_frequency: f }));
    });
    if (options.length === 0) return null;
    const daily = (r: RegimenMed) => dailyDose(r);
    return [...options].sort((a, b) => Math.abs(daily(a) - wantDaily) - Math.abs(daily(b) - wantDaily) || daily(a) - daily(b)
        || Math.abs(dosesPerDay(a.selected_frequency) - wantFreq) - Math.abs(dosesPerDay(b.selected_frequency) - wantFreq))[0];
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
        ? `Add ${adj.med.name} ${formatDose(adj)} as a short course beside the oral loop diuretic (label: not for chronic use); return to the oral diuretic when congestion resolves`
        : `Add ${adj.med.name} ${formatDose(adj)}`;
}

export function formatSwapSummary(from: RegimenMed, to: RegimenMed): string {
    if (from.med.drug_class === 'Beta Blocker' && to.med.drug_class === 'Beta Blocker') return `Consider transition from ${from.med.name} ${formatDose(from)} to ${to.med.name} ${formatDose(to)}; starting tier only, not dose equivalence. Confirm individualized taper/transition and reassessment before implementation`;
    if (from.med.drug_class === 'ACEi' && to.med.drug_class === 'ARNI') {
        return `Stop ${from.med.name}, wait 36 hours, then start ${to.med.name} ${formatDose(to)}`;
    }
    if (from.med.drug_class === 'ARNI' && to.med.drug_class === 'ACEi') {
        // Mirror rule (Zestril label 4): no ACEi within 36 hours of the last ARNI dose.
        return `Stop ${from.med.name}, wait 36 hours, then start ${to.med.name} ${formatDose(to)}`;
    }
    if (from.med.drug_class === 'Loop Diuretic' && to.med.drug_class === 'Loop Diuretic') {
        const fe = drugFacts(from.med).verified_furosemide_equivalent_per_mg, te = drugFacts(to.med).verified_furosemide_equivalent_per_mg;
        // Every non-add-on loop declares an equivalence (verify invariant), so an equivalent-dose summary is always available.
        if (fe !== undefined && te !== undefined) {
            // The sentence states BOTH the equivalent daily dose and the dose the swap actually lands on (the nearest schedule the tool offers), and says when the landing is below or above it (S13).
            const wanted = dailyDose(from) * fe / te, landed = dailyDose(to);
            const relation = Math.abs(landed - wanted) < 1e-9 ? '' : landed < wanted ? ', which is below the equivalent dose' : ', which is above the equivalent dose';
            return `Swap ${from.med.name} -> ${to.med.name} ${formatDose(to)} (approximate total daily conversion: ${dailyDose(from)} ${from.dose.unit}/day ${from.med.name} is about ${wanted} ${to.dose.unit}/day ${to.med.name}; the nearest schedule offered is ${landed} ${to.dose.unit}/day${relation}; reassess response)`;
        }
    }
    return `Swap ${from.med.name} -> ${to.med.name} ${formatDose(to)}`;
}

/**
 * The swap sentence plus, when the drug switched to has a trial-entry criterion (a check marked `indication`: body mass index or LVEF for a GLP-1 drug) that the patient
 * does not meet, a statement that the criterion was not re-applied because this is a switch inside the class (S9).
 */
export function swapSummary(from: RegimenMed, to: RegimenMed, patient: Patient): string {
    const asNew = { ...patient, current_regimen: (patient.current_regimen ?? []).filter(r => r.med.name !== from.med.name) } as Patient;
    const skipped = (to.med.contraindication_checks ?? []).filter(c => c.indication && c.when(asNew)).map(c => c.reason.split(' — ')[0]);
    const base = formatSwapSummary(from, to);
    return skipped.length > 0 ? `${base} (the starting criterion was not re-applied because this is a switch inside the class: ${skipped.join('; ')})` : base;
}

/**
 * R9 Z1: a forced switch states its reason beside the drug that must stop, never at the end of the line where it would read as a property of the drug being started. The reason goes right after the
 * name of the drug stopped (after its dose where the line gives one): "Stop Lisinopril (reason). Wait 36 hours. Then start ...", "Swap A (reason) -> B ...".
 */
export function reasonBesideSource(summary: string, from: RegimenMed, reason: string): string {
    const withDose = `${from.med.name} ${formatDose(from)}`;
    const at = summary.indexOf(withDose) >= 0 ? summary.indexOf(withDose) + withDose.length : summary.indexOf(from.med.name) + from.med.name.length;
    return `${summary.slice(0, at)} (${reason})${summary.slice(at)}`;
}

/**
 * The short reason a change line carries (R9 Z8). First every parenthetical inside the reason is dropped (a source or a pointer to the alert); where the reason is still long, each cause is cut before
 * its explanation (at the colon), the conditions ("if the patient is ...") are dropped, and at most two causes are kept. The alert and the withheld list carry the detail.
 */
export function shortLineReason(reason: string): string {
    let t = reason;
    for (let i = 0; i < 6 && /\([^()]*\)/.test(t); i++) t = t.replace(/\s*\([^()]*\)/g, '');
    t = t.replace(/\s+/g, ' ').replace(/\s+([;,])/g, '$1').trim();
    if (t.length <= 150) return t;
    const parts = t.split(/;\s+/).map(x => (x.length > 100 ? x.split(':')[0]! : x).trim()).filter(x => x && !/^(if |the suggested |individuali[sz]e )/i.test(x));
    return parts.slice(0, 2).join('; ').replace(/[.,;\s]+$/, '');
}
const EXEMPT_GROUPS = /^(approximate total daily conversion|the starting criterion)/;
/** R9 Z8: a change line keeps a short reason: any parenthetical group with a parenthesis inside it, or longer than 170 characters, is replaced by its short form (two exact-dose groups are kept whole). */
export function shortenChangeLine(summary: string): string {
    let out = '', i = 0;
    while (i < summary.length) {
        if (summary[i] !== '(') { out += summary[i++]; continue; }
        let depth = 0, j = i;
        for (; j < summary.length; j++) { if (summary[j] === '(') depth++; else if (summary[j] === ')' && --depth === 0) break; }
        if (j >= summary.length) { out += summary.slice(i); break; }
        const inner = summary.slice(i + 1, j);
        out += (!EXEMPT_GROUPS.test(inner) && (/[()]/.test(inner) || inner.length > 170)) ? `(${shortLineReason(inner)})` : summary.slice(i, j + 1);
        i = j + 1;
    }
    return out.replace(/\(\)/g, '').replace(/\s+$/, '');
}
export function generateCandidateModifications(analysis: RegimenAnalysis, patient: Patient): ModificationSet[] {
    return generateCandidateModificationsRaw(analysis, patient).map(c => ({ ...c, modifications: c.modifications.map(m => ({ ...m, summary: shortenChangeLine(m.summary) })) }));
}
function generateCandidateModificationsRaw(
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
                summary: `Titrate ${current.med.name} ${formatDose(current)} → ${formatDose(higher)}`
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
                summary: `Reduce ${current.med.name} ${formatDose(current)} → ${formatDose(lower)}`
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
                summary: swapSummary(from, to, patient)
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

    // Pair / triple / quad missing-pillar additions, over EVERY drug of each missing pillar (cartesian product; the scorer picks the drug within a class).
    const pillarEntries = Array.from(analysis.addablePillars.entries());
    const pillarLists = pillarEntries.map(([pillar]) => analysis.pillarStartTiers.get(pillar) ?? analysis.addablePillars.get(pillar) ?? []);
    const addAll = (picks: RegimenMed[]) => {
        const mods: RegimenModification[] = picks.map(m => ({ action: 'add' as const, target: m, summary: `Add ${m.med.name} ${formatDose(m)}` }));
        candidates.push({ modifications: mods, resulting_regimen: buildResultingRegimen(currentRegimen, mods) });
    };
    const product = (lists: RegimenMed[][], k: number, start = 0, chosen: RegimenMed[] = []): void => {
        if (chosen.length === k) { addAll(chosen); return; }
        for (let i = start; i < lists.length; i++) lists[i].forEach(m => product(lists, k, i + 1, [...chosen, m]));
    };
    if (pillarEntries.length >= 2 && maxNewPerVisit >= 2) {
        product(pillarLists, 2);
        if (pillarEntries.length >= 3 && maxNewPerVisit >= 3) product(pillarLists, 3);
        if (pillarEntries.length >= 4 && maxNewPerVisit >= 4) product(pillarLists, 4);
    }

    // Combine addition + titration. Every missing pillar's leading agents are paired with each available dose increase. Until 2026-11-12 only the FIRST
    // agent of the FIRST pillar was paired (the ARNI when available), so when that one agent was over budget no "start a pillar and raise a dose" option
    // existed at all, and making an unrelated drug unavailable changed the answer (adversarial review 3).
    if (pillarEntries.length > 0 && analysis.titratableUp.length > 0 && maxNewPerVisit >= 1) {
        const seenPair = new Set<string>();
        // "first two agents" = the first agent of each of the pillar's first two drug classes (ARNI and an ACE inhibitor or ARB), so two options never differ
        // only by a sibling of the same class.
        const firstPerClass = (meds: RegimenMed[]) => meds.filter((m, i) => meds.findIndex(x => x.med.drug_class === m.med.drug_class) === i);
        pillarEntries.forEach(([pillar, meds]) => (analysis.pillarStartTiers.get(pillar) ?? safeSlice(firstPerClass(meds), 2)).forEach(pillarMed => {
            analysis.titratableUp.forEach(({ current, options }) => {
                const bestHigher = options[options.length - 1]; // highest dose option (options sorted ascending by dose index in analyzeCurrentRegimen)
                const key = `${pillarMed.med.name}|${pillarMed.dose.strength}|${current.med.name}`;
                if (bestHigher && !seenPair.has(key)) {
                    seenPair.add(key);
                    const mods: RegimenModification[] = [
                        { action: 'add', target: pillarMed, summary: `Add ${pillarMed.med.name} ${formatDose(pillarMed)}` },
                        { action: 'titrate_up', source: current, target: bestHigher, summary: `Titrate ${current.med.name} ${formatDose(current)} → ${formatDose(bestHigher)}` }
                    ];
                    candidates.push({
                        modifications: mods,
                        resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                    });
                }
            });
        }));
    }

    // Combine swap + addition (over every drug of the first missing pillar, not only formulary element [0])
    if (analysis.swappable.length > 0 && pillarEntries.length > 0 && maxNewPerVisit >= 1) {
        const firstPillarMeds = pillarLists[0] ?? [];
        analysis.swappable.forEach(({ from, candidates: swapCandidates }) => {
            const bestSwap = swapCandidates[0];
            if (!bestSwap) return;
            firstPillarMeds.forEach(topPillarMed => {
                const mods: RegimenModification[] = [
                    { action: 'swap', source: from, target: bestSwap, summary: swapSummary(from, bestSwap, patient) },
                    { action: 'add', target: topPillarMed, summary: `Add ${topPillarMed.med.name} ${formatDose(topPillarMed)}` }
                ];
                candidates.push({
                    modifications: mods,
                    resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                });
            });
        });
    }

    // Combine adjunct + pillar addition or adjunct + titration (the pillar over every drug of the first missing pillar)
    if (analysis.addableAdjuncts.length > 0 && pillarEntries.length > 0 && maxNewPerVisit >= 2) {
        analysis.addableAdjuncts.forEach(adj => {
            (pillarLists[0] ?? []).forEach(topPillarMed => {
                const mods: RegimenModification[] = [
                    { action: 'add', target: topPillarMed, summary: `Add ${topPillarMed.med.name} ${formatDose(topPillarMed)}` },
                    { action: 'add', target: adj, summary: addSummary(adj) }
                ];
                candidates.push({
                    modifications: mods,
                    resulting_regimen: buildResultingRegimen(currentRegimen, mods)
                });
            });
        });
    }

    // Combine adjunct + swap
    if (analysis.addableAdjuncts.length > 0 && analysis.swappable.length > 0) {
        analysis.addableAdjuncts.forEach(adj => {
            analysis.swappable.forEach(({ from, candidates: swapCandidates }) => {
                const bestSwap = swapCandidates[0];
                if (bestSwap) {
                    const mods: RegimenModification[] = [
                        { action: 'swap', source: from, target: bestSwap, summary: swapSummary(from, bestSwap, patient) },
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
    // An empty regimen gets the "no change" option only in a state where nothing may be started (cold, potassium emergency), so the screen has an option that says why.
    if ((currentRegimen.length > 0 || analysis.unstable.cold || analysis.unstable.potassiumEmergency) && analysis.forcedBbDownTitrateNames.size === 0 && analysis.forcedReduceNames.size === 0) {
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
    const forcedReasons = new Map<string, string>();
    if (contraindicated.size > 0 || redundant.size > 0) {
        const forcedRemovals: RegimenModification[] = [];
        sortedByName(currentRegimen).forEach(r => {
            // A HARD contraindication (med.contraindications(patient) true, e.g. K+ > 5.5 on an
            // MRA) takes precedence over a historical intolerance — it gets the urgent
            // 'contraindicated' removal, never an elective-tolerability swap framing.
            // A check that fires only because a kidney value was not entered is no contraindication to state (V17): the real cause (an allergy or intolerance) is the reason.
            const hardContraindicated = r.med.contraindications?.(patient) === true && contraindicationReasons(r.med, patient).length > 0;
            const intoleranceReason = hardContraindicated ? undefined : analysis.intolerableCurrentMeds.get(r.med.name);
            // A current drug that must go is REPLACED whenever an eligible agent of the same class group exists, for a contraindication as for an intolerance:
            // otherwise options 2 and 3 offered the plain removal of a pillar (carvedilol with asthma) beside option 1's switch to a selective agent
            // (adversarial review item 14). `swappable` already excludes drugs withheld by a potassium, heart-rate or kidney rule, redundant duplicates and
            // diuretics without congestion, so those are still stopped, not replaced.
            const mustGo = contraindicated.has(r.med.name);
            // In the cold state and at potassium 6.0 or above no option starts a drug (S1a, S3): a drug that must go is stopped, not replaced.
            // Exception (S1a): a forced beta-blocker switch (pregnancy) lands on the new drug's starting tier, which is a dose reduction in effect, and stopping a beta-blocker outright
            // in this state is the harm the engine already avoids; it is the one forced switch kept in the cold state.
            // R10 A2: a loop diuretic that must stop is also replaced in the cold state when congestion is recorded (the same replacement as outside it).
            const coldBlocksSwap = analysis.unstable.cold && r.med.drug_class !== 'Beta Blocker' && !(r.med.drug_class === 'Loop Diuretic' && analysis.unstable.congested);
            const swapTarget = (intoleranceReason || mustGo) && !coldBlocksSwap && !analysis.unstable.potassiumEmergency
                ? analysis.swappable.find(s => s.from.med.name === r.med.name)?.candidates[0]
                : undefined;
            // The specific reason, the same in every option and in any entry order (S8): never the bare word "contraindicated".
            const specificReason = analysis.kWithholdReasons.get(r.med.name)
                ?? (hardContraindicated ? analysis.contraindicationReasonByName.get(r.med.name) : intoleranceReason ?? analysis.contraindicationReasonByName.get(r.med.name))
                ?? analysis.contraindicationReasonByName.get(r.med.name) ?? 'a safety rule applies to this patient';
            if ((intoleranceReason || mustGo) && swapTarget) {
                forcedReasons.set(r.med.name, intoleranceReason ?? specificReason);
                forcedRemovals.push({
                    action: 'swap',
                    source: r,
                    target: swapTarget,
                    mandatory: true,
                    forced_reason: intoleranceReason ?? specificReason,
                    summary: reasonBesideSource(swapSummary(r, swapTarget, patient), r, intoleranceReason ?? specificReason)
                });
            } else if (contraindicated.has(r.med.name)) {
                forcedReasons.set(r.med.name, specificReason);
                forcedRemovals.push({ action: 'remove', source: r, mandatory: true, ...(analysis.kWithholdReasons.has(r.med.name) ? { temporary_hold: true } : {}), summary: `Remove ${r.med.name} (${specificReason})` });
            } else if (redundant.has(r.med.name)) {
                const note = analysis.duplicateNotes.find(n => n.removed.some(x => x.med.name === r.med.name));
                const text = note
                    ? `duplicate ${note.group}: ${r.med.name} duplicates ${note.kept.med.name}, the one kept; the duplicate therapy alert gives the reason`
                    : `duplicate ${getMedicationClassGroup(r.med.drug_class)} therapy: deprescribe the duplicate`;
                forcedReasons.set(r.med.name, text);
                forcedRemovals.push({ action: 'remove', source: r, mandatory: true, duplicate_cleanup: true, summary: `Remove ${r.med.name} (${text})` });
            }
        });

        // A pregnancy switch from a non-selective beta-blocker always states its reason, including when the swap came from the generic swap candidates.
        candidates.forEach(c => c.modifications.forEach(m => {
            const why = m.action === 'swap' && m.source ? analysis.intolerableCurrentMeds.get(m.source.med.name) : undefined;
            if (why && why.startsWith('Pregnancy:') && !m.summary.includes(why)) m.summary = reasonBesideSource(m.summary, m.source!, why);
        }));

        candidates.forEach(c => {
            forcedRemovals.forEach(forced => {
                const alreadyRemoved = c.modifications.some(m =>
                    m.action === 'remove' && m.source?.med.name === forced.source!.med.name
                );
                const alreadySwapped = c.modifications.some(m =>
                    m.action === 'swap' && m.source?.med.name === forced.source!.med.name
                );
                if (alreadyRemoved && forced.action === 'swap' && forced.target) {
                    // A drug that must go is REPLACED whenever an eligible agent of its class exists (above), so a plain removal of it becomes that swap: same text, same reason,
                    // and the replacement is in the resulting regimen. Before 2026-11-19 the removal only took the swap's TEXT and showed a start the option did not contain (T22).
                    c.modifications = c.modifications.filter(m => !(m.action === 'add' && m.target?.med.name === forced.target!.med.name));
                    c.modifications[c.modifications.findIndex(m => m.action === 'remove' && m.source?.med.name === forced.source!.med.name)] = { ...forced };
                    if (!c.resulting_regimen.some(r => r.med.name === forced.target!.med.name)) c.resulting_regimen.push(forced.target);
                } else if (alreadyRemoved) {
                    const removal = c.modifications.find(m => m.action === 'remove' && m.source?.med.name === forced.source!.med.name)!;
                    removal.summary = forced.summary; // Preserve the specific mandatory reason, not an earlier generic removal label.
                    removal.mandatory = true;
                    if (forced.duplicate_cleanup) removal.duplicate_cleanup = true;
                    // The hold flag travels with the reason: a withhold for a changeable state is a temporary hold whichever way the removal was built (W8).
                    if (forced.temporary_hold) removal.temporary_hold = true;
                }
                if (alreadySwapped) {
                    // A swap built by the generic pass states the same specific reason as the forced one, in every option (S8).
                    const sw = c.modifications.find(m => m.action === 'swap' && m.source?.med.name === forced.source!.med.name)!;
                    const reason = forcedReasons.get(forced.source!.med.name);
                    if (reason && !sw.summary.includes(`(${reason})`) && !sw.summary.includes(reason)) sw.summary = reasonBesideSource(sw.summary, sw.source!, reason);
                    sw.mandatory = true;
                    if (reason) sw.forced_reason = reason;
                }
                if (!alreadyRemoved && !alreadySwapped) {
                    // Coherence: a med that is being force-removed must not also carry a
                    // titrate/keep modification in the same candidate (would render as the
                    // incoherent "down-titrate AND remove the same drug" in one visit).
                    c.modifications = c.modifications.filter(m =>
                        !((m.action === 'titrate_up' || m.action === 'titrate_down' || m.action === 'keep')
                            && m.source?.med.name === forced.source!.med.name)
                    );
                    // One instruction per drug (S6): a candidate that already ADDS the drug this forced swap lands on gives that instruction up to the swap, which carries the reason.
                    if (forced.action === 'swap' && forced.target) {
                        c.modifications = c.modifications.filter(m => !(m.action === 'add' && m.target?.med.name === forced.target!.med.name));
                    }
                    c.modifications.push({ ...forced });
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
                if (alreadyHandled) {
                    // A reduction already built by the generic titrate-down pass states the same reason as the injected one, whichever candidate survives (S8, B4).
                    c.modifications = c.modifications.map(m => (m.action === 'titrate_down' && m.source?.med.name === bbName && !m.summary.includes('acute decompensation with hypoperfusion')
                        ? { ...m, mandatory: true, temporary_hold: true, summary: `${m.summary} (acute decompensation with hypoperfusion)` } : m));
                    return;
                }
                // Drop any incoherent up-titration / keep of the same BB before injecting the cut.
                c.modifications = c.modifications.filter(m =>
                    !((m.action === 'titrate_up' || m.action === 'keep') && m.source?.med.name === bbName)
                );
                c.modifications.push({
                    action: 'titrate_down',
                    source: td.current,
                    target: lower,
                    mandatory: true,
                    temporary_hold: true,
                    summary: `Reduce ${bbName} ${formatDose(td.current)} → ${formatDose(lower)} (acute decompensation with hypoperfusion)`
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
                if (alreadyHandled) {
                    // A single reduction candidate built by the generic titrate-down pass has no reason in its summary: state the forced-reduction reason on it too (renal maximum,
                    // potassium, interaction cap, heart rate), so every displayed reduction says why.
                    c.modifications = c.modifications.map(m => (m.action === 'titrate_down' && m.source?.med.name === medName && !m.summary.includes(reason)
                        ? { ...m, mandatory: true, temporary_hold: true, summary: `${m.summary} (${reason})` } : m));
                    return;
                }
                c.modifications = c.modifications.filter(m =>
                    !((m.action === 'titrate_up' || m.action === 'keep') && m.source?.med.name === medName)
                );
                c.modifications.push({
                    action: 'titrate_down',
                    source: td.current,
                    target: lower,
                    mandatory: true,
                    temporary_hold: true,
                    summary: `Reduce ${medName} ${formatDose(td.current)} → ${formatDose(lower)} (${reason})`
                });
                c.resulting_regimen = c.resulting_regimen.map(r => (r.med.name === medName ? lower : r));
            });
        });
    }

    // --- f3) The congestion display rule (POLICY, not a ranking factor; S1): in acute decompensation or the cold state, when the patient is congested and a loop diuretic start or
    // increase is eligible, every option includes it. A candidate that already raises or starts a loop keeps its own step; one that reduces, removes or swaps the loop is left alone.
    // T23 (2026-11-19): the rule is a display rule and must never leave the patient with no option. The safety-required plan is built first; the loop step is added to a
    // copy of it, and the copy is used only if it is still allowed in the patient's state (potassium emergency, per-visit limit, structure). Otherwise the plan is shown
    // WITHOUT the step and says why (ModificationSet.loop_step_omitted).
    // R8 X11: the reason a drug that an option STARTS fails its own contraindication check on the regimen the option produces (null when it does not). A check that was already true for the arriving
    // patient is left to the eligibility stage; a start-only criterion (indication) is not re-applied to a switch inside a class (S9).
    const startBlockedOnProducedRegimen = (c: ModificationSet, m: RegimenModification): string | null => {
        if (!START_RULE.enabled || (m.action !== 'add' && m.action !== 'swap') || !m.target || !m.target.med.contraindications) return null;
        const med = m.target.med;
        try {
            if (med.contraindications!(patient)) return null;
            const produced = { ...patient, current_regimen: c.resulting_regimen.filter(r => r.med.name !== med.name) };
            const sameGroupSwap = m.action === 'swap' && !!m.source && getMedicationClassGroup(m.source.med.drug_class) === getMedicationClassGroup(med.drug_class);
            const checks = med.contraindication_checks;
            if (checks) return checks.find(ch => !(sameGroupSwap && ch.indication) && ch.when(produced))?.reason ?? null;
            return med.contraindications!(produced) ? 'a contraindication that applies to the regimen this option produces' : null;
        } catch { return null; }
    };
    // A forced switch whose replacement still cannot be started is a plain removal of the drug that must go, with the same stated reason: a forced removal is never lost (R8 X11a).
    candidates.forEach(c => {
        c.modifications = c.modifications.map(m => {
            if (m.action !== 'swap' || !m.mandatory || !m.source || !m.target) return m;
            const why = startBlockedOnProducedRegimen(c, m);
            if (why === null) return m;
            analysis.startRuleDrops.set(m.target.med.name, why);
            const reason = m.forced_reason ?? analysis.kWithholdReasons.get(m.source.med.name) ?? analysis.contraindicationReasonByName.get(m.source.med.name) ?? 'a safety rule applies to this patient';
            c.resulting_regimen = c.resulting_regimen.filter(r => r.med.name !== m.target!.med.name);
            return { action: 'remove', source: m.source, mandatory: true, ...(m.temporary_hold ? { temporary_hold: true } : {}), forced_reason: reason, summary: `Remove ${m.source.med.name} (${reason})` } as RegimenModification;
        });
    });

    // R9 Z11: a short-course add-on (Furoscix) is used only beside an oral drug of its group. When an option stops the last oral loop diuretic (a forced removal for an allergy, an intolerance or a
    // contraindication, or a forced switch that could not be made), the add-on goes with it, with that reason stated; otherwise the option would be structurally unsound and be dropped, and the
    // patient would be left with an empty screen although the offending drug has to stop.
    candidates.forEach(c => {
        // R10 A12: only an add-on the patient TAKES goes with the oral loop; a candidate that merely ADDS Furoscix beside a loop this option stops is structurally unsound and is dropped, as before round 9.
        c.resulting_regimen.filter(r => drugFacts(r.med).short_course_addon && currentRegimen.some(x => x.med.name === r.med.name)).forEach(addon => {
            const g = getMedicationClassGroup(addon.med.drug_class);
            if (c.resulting_regimen.some(o => o !== addon && !drugFacts(o.med).short_course_addon && getMedicationClassGroup(o.med.drug_class) === g)) return;
            c.modifications = c.modifications.filter(m => !(m.source?.med.name === addon.med.name && m.action !== 'remove') && !(m.action === 'add' && m.target?.med.name === addon.med.name));
            c.resulting_regimen = c.resulting_regimen.filter(r => r.med.name !== addon.med.name);
            if (!c.modifications.some(m => m.action === 'remove' && m.source?.med.name === addon.med.name)) {
                c.modifications.push({ action: 'remove', source: addon, mandatory: true, summary: `Remove ${addon.med.name} (Used only beside an oral loop diuretic, which this option stops)` });
            }
        });
    });

    const u = analysis.unstable;
    const isLoopStepMod = (m: RegimenModification) => (m.action === 'add' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Loop Diuretic' && !drugFacts(m.target.med).short_course_addon;
    const loopRule = (u.decompensated || u.cold) && u.congested && !!u.loopStep;
    const bases = candidates.map(c => ({ modifications: c.modifications.map(m => ({ ...m })), resulting_regimen: [...c.resulting_regimen] } as ModificationSet));
    const augmented: boolean[] = candidates.map(() => false);
    const touchesLoop: boolean[] = candidates.map(() => false);
    if (loopRule) {
        const step = u.loopStep!;
        candidates.forEach((c, i) => {
            if (c.modifications.some(isLoopStepMod)) return;
            // The clean-up of a duplicate loop entry is not a change to the loop dose (T2); any other reduction, stop or switch of the loop is.
            if (c.modifications.some(m => m.source?.med.drug_class === 'Loop Diuretic' && !drugFacts(m.source.med).short_course_addon && m.action !== 'keep' && !m.duplicate_cleanup)) { touchesLoop[i] = true; return; }
            augmented[i] = true;
            if (step.action === 'titrate_up') {
                c.modifications = c.modifications.filter(m => !(m.action === 'keep' && m.source?.med.name === step.source!.med.name));
                c.modifications.push({ action: 'titrate_up', source: step.source, target: step.target, summary: `Titrate ${step.source!.med.name} ${formatDose(step.source!)} → ${formatDose(step.target)}` });
                c.resulting_regimen = c.resulting_regimen.map(r => (r.med.name === step.source!.med.name ? step.target : r));
            } else {
                c.modifications.push({ action: 'add', target: step.target, summary: addSummary(step.target) });
                c.resulting_regimen = [...c.resulting_regimen, step.target];
            }
        });
    }
    // What an option may contain in the cold state (S1a) and at potassium 6.0 or above (S3): the engine's own forced reductions and withholds, a diuretic step when congested (cold),
    // and a potassium binder already on board (potassium emergency). Nothing else is started or raised.
    const stateAllows = (c: ModificationSet): boolean => c.modifications.every(m => {
        // T1: at potassium 6.0 or above an option holds only actions that lower potassium or leave it alone, so a loop or thiazide-type diuretic or a binder is never cut
        // (the safety-mandated removal of a drug the patient must not take, and the duplicate clean-up, are unaffected: they are marked mandatory).
        if (u.potassiumEmergency && (m.action === 'remove' || m.action === 'titrate_down') && m.source && ['Loop Diuretic', 'Thiazide-like Diuretic', 'K+ Binder'].includes(m.source.med.drug_class) && !m.mandatory) return false;
        if (m.action === 'keep' || m.action === 'titrate_down' || m.action === 'remove') return true;
        if (u.cold && u.congested && isLoopStepMod(m)) return true;
        // R10 A2: with congestion recorded, a loop diuretic that must stop is replaced by another oral loop in the cold state on the same terms as outside it (the scope page already allows a loop for recorded congestion).
        if (u.cold && u.congested && !u.potassiumEmergency && m.action === 'swap' && m.mandatory && m.source?.med.drug_class === 'Loop Diuretic' && m.target?.med.drug_class === 'Loop Diuretic' && !drugFacts(m.target.med).short_course_addon) return true;
        if (u.potassiumEmergency && m.action === 'titrate_up' && m.target?.med.drug_class === 'K+ Binder') return true;
        if (u.cold && !u.potassiumEmergency && m.action === 'swap' && m.mandatory && m.source?.med.drug_class === 'Beta Blocker') return true;
        return !(u.cold || u.potassiumEmergency);
    }) && (!(u.cold && u.potassiumEmergency) || c.modifications.every(m => !['add', 'titrate_up', 'swap'].includes(m.action) || (u.potassiumEmergency && m.target?.med.drug_class === 'K+ Binder')));
    // One instruction per drug (S6): when a candidate both adds a drug and swaps to it, the swap (which carries the reason) stands and the add is dropped; then identical options collapse.
    const normalizeOne = (c: ModificationSet) => {
        const swapTargets = new Set(c.modifications.filter(m => m.action === 'swap' && m.target).map(m => m.target!.med.name));
        c.modifications = c.modifications.filter(m => !(m.action === 'add' && m.target && swapTargets.has(m.target.med.name)));
        // Changes are listed in a fixed order of kind, then by drug name, and the resulting regimen in drug-name order, so the option and its warnings read the same whichever candidate survives de-duplication and whatever order the drugs were typed in.
        const kindOrder: string[] = ['swap', 'add', 'titrate_up', 'titrate_down', 'remove', 'keep'];
        const nameOf = (m: RegimenModification) => (m.target ?? m.source)?.med.name ?? '';
        c.modifications = [...c.modifications].sort((a, b) => kindOrder.indexOf(a.action) - kindOrder.indexOf(b.action) || (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0));
        c.resulting_regimen = sortedByName(c.resulting_regimen);
    };
    // Filter by max_new_classes_per_visit and the structural rules.
    const acceptable = (c: ModificationSet): boolean => {
        if (!stateAllows(c)) return false;
        // A forced BB dose-reduction (acute decompensation) is satisfied by EITHER a down-titration
        // OR a removal. Removal is the stronger reduction and is the correct action when the BB is
        // also contraindicated (e.g. decompensated HF + new bronchospasm). Without the `remove`
        // branch, such a patient would have every candidate filtered out → zero recommendations.
        const satisfiesForcedBbDownTitration =
            analysis.forcedBbDownTitrateNames.size === 0 ||
            Array.from(analysis.forcedBbDownTitrateNames).every(bbName =>
                c.modifications.some(m =>
                    // A forced SWITCH to another beta-blocker also satisfies it (the switch lands on the new agent's starting tier in this state). Without `swap`
                    // every candidate was filtered out and the page was empty with no reason (pregnancy or allergy on carvedilol with hypoperfusion; review 3).
                    (m.action === 'titrate_down' || m.action === 'remove' || m.action === 'swap') && m.source?.med.name === bbName
                )
            );
        const satisfiesForcedReduction = Array.from(analysis.forcedReduceNames.keys()).every(name =>
            c.modifications.some(m =>
                (m.action === 'titrate_down' || m.action === 'remove' || m.action === 'swap') && m.source?.med.name === name
            )
        );
        const newClassCount = countVisitLimitChanges(c, currentRegimen);
        const hasSteroidalMRA = c.resulting_regimen.some(r => r.med.drug_class === 'MRA');
        const hasNonSteroidalMRA = c.resulting_regimen.some(r => r.med.drug_class === 'nsMRA');
        const hasDualMRA = hasSteroidalMRA && hasNonSteroidalMRA;
        // M4: Structural block for dual RAAS (ACEi+ARB, ACEi+ARNI, etc.) — not just warning
        const raasInRegimen = c.resulting_regimen.filter(r => RAAS_CLASSES.has(r.med.drug_class));
        const hasDualRAAS = raasInRegimen.length > 1;
        // A candidate that is structurally unprescribable is dropped UNLESS the patient arrived that way and the candidate does not make it worse
        // (the duplicate-therapy cleanup above removes arriving duplicates; what is left here was built by combining changes).
        const structurallySound = structuralProblems(c.resulting_regimen).length === 0;
        // R7 W13b: a drug the option STARTS is judged on the regimen the option produces, not only on the regimen the patient arrives with. A contraindication that reads the regimen (finerenone is contraindicated
        // at an ejection fraction above 40 with an unknown EF history while the patient is on heart failure therapy) can become true once the option adds or removes other drugs (a RAAS inhibitor
        // started beside it); such an option is not shown. A check that was already true for the arriving patient is left to the eligibility stage as before.
        const regimenMakesItContraindicated = c.modifications.some(m => {
            const why = startBlockedOnProducedRegimen(c, m);
            if (why !== null) analysis.startRuleDrops.set(m.target!.med.name, why);
            return why !== null;
        });
        return satisfiesForcedBbDownTitration && satisfiesForcedReduction && newClassCount <= maxNewPerVisit && !hasDualMRA && !hasDualRAAS && structurallySound && !regimenMakesItContraindicated;
    };
    const whyNoLoopStep = (aug: ModificationSet): string =>
        u.potassiumEmergency ? 'potassium is 6.0 or above, so no drug is started or raised until it is controlled'
        : countVisitLimitChanges(aug, currentRegimen) > maxNewPerVisit ? `adding it would pass the limit of ${maxNewPerVisit} new drug class${maxNewPerVisit === 1 ? '' : 'es'} or switches per visit`
        : "adding it did not pass the tool's rules for this option";
    const collect = (pick: (c: ModificationSet, i: number) => ModificationSet | undefined): ModificationSet[] => {
        const seenOption = new Set<string>();
        const out: ModificationSet[] = [];
        candidates.forEach((c, i) => {
            const chosen = pick(c, i);
            if (!chosen) return;
            const key = chosen.modifications.map(m => m.summary).sort().join('|') + '#' + chosen.resulting_regimen.map(r => `${r.med.name} ${r.dose.strength} ${r.selected_frequency}`).sort().join('+');
            if (seenOption.has(key)) return;
            seenOption.add(key);
            out.push(chosen);
        });
        return out;
    };
    candidates.forEach(normalizeOne);
    // Normal rule: a plan is shown when it is acceptable WITH the loop step; a plan that reduces, stops or swaps the loop is not a decompensation plan.
    const withStep = collect((c, i) => (loopRule && touchesLoop[i] ? undefined : acceptable(c) ? c : undefined));
    if (withStep.length > 0 || !loopRule) return withStep;
    // Nothing survives with the step: show the safety-required plans without it, each saying why (T23).
    const withoutStep = collect((c, i) => {
        if (!augmented[i]) return undefined;
        const base = bases[i]; normalizeOne(base);
        return acceptable(base) ? { ...base, loop_step_omitted: whyNoLoopStep(c) } : undefined;
    });
    if (withoutStep.length > 0) return withoutStep;
    // Last resort: a plan that itself reduces, stops or replaces the loop for a stated safety reason is better than no option at all.
    return collect((c, i) => (touchesLoop[i] && acceptable(c) ? { ...c, loop_step_omitted: 'the loop diuretic is reduced, stopped or replaced in this option for a safety reason stated on it, so no further step is added' } : undefined));
}

// --- 1. Scoring Logic (The 6 Domains) ---
