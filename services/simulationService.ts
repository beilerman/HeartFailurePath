import { Patient, SimulationOutput } from '../types';
import { runEligibilityStage } from './engine/eligibility';
import { getDoseTiers, clonePatient } from './engine/regimenUtils';
import { auditInputs, raiseClinicalAlerts, checkSafetyHardStops } from './engine/gates';
import { analyzeCurrentRegimen, generateCandidateModifications } from './engine/candidates';
import { buildScoringContext, scoreCandidates } from './engine/scoring';
import { selectDisplayPicks } from './engine/selection';
import { buildEligibleAdjuncts, assembleOutput } from './engine/explain';

// Public facade: every symbol this module exported before the phase-4 split is re-exported here,
// so nothing outside services/ needs an import change.
export { isTargetDoseForPatient, getTargetDosePatientContext, clonePatient } from './engine/regimenUtils';
export { isRenalOnlyContraindication, deriveIntolerancePolicy, currentMedIntoleranceReason } from './engine/intolerance';
export type { IntolerancePolicy } from './engine/intolerance';
export { MRA_POOL_CLASSES } from './engine/registry';
export {
    BNP_SCORE_TARGET, BNP_SCORE_CRITICAL, NYHA_SCORE_MAP, FUNCTIONAL_STEPS_FULL_CREDIT, VOLUME_SCORING,
    adherenceComplexityThreshold, calculateStructureScoreComponents, CONCORDANCE_TABLE, pillarKeyOf, classifyPhenotype,
    STRUCTURE_BLEND_WEIGHTS,
} from './engine/domains';
export type { PillarKey, PillarConcordance, Phenotype } from './engine/domains';
export { DISPLAY_FLOORS } from './engine/selection';

/**
 * THE engine entry point. Deterministic and side-effect free: given a patient (including
 * their current regimen), the set of formulary med names available for simulation, and a
 * price map, it:
 *   1. Audits inputs (missing critical data, implausible values, inappropriate arriving
 *      regimens) — hard-stopping with alerts-only output where computation would be unsafe
 *      (implausible values, unknown LVEF, SBP < 90, K+ >= 6.5, SBP <= DBP).
 *   2. Filters the formulary through allergy / intolerance-policy / contraindication /
 *      renal gates (recording every exclusion with its reason).
 *   3. Analyzes the current regimen (contraindicated / intolerable / redundant meds,
 *      titratable and swappable agents, missing pillars, eligible adjuncts).
 *   4. Generates candidate modification sets (add / titrate_up / titrate_down / swap /
 *      remove / keep) with forced cleanups injected, then simulates each candidate's
 *      MARGINAL delta from observed state and scores it across the 7 weighted domains
 *      (Neuro 20 / Func 15 / Vol 15 / Struct 10 / Cost 15 / Adhere 10 / Guideline 15)
 *      plus the GDMT-completeness bonus and safety penalties.
 *   5. Applies affordability + display-safety filters and returns <= 3 distinct picks with
 *      monitoring plans, qualitative projections, exclusions, alerts, and follow-up data.
 *
 * @param patient           Cloned internally — the caller's object is never mutated.
 * @param availableMedNames Formulary med names enabled for this simulation run (UI toggles).
 * @param prices            name → monthly cost map from pricingService.getDrugPrices.
 */
export function generateAndScoreModifications(
    patient: Patient,
    availableMedNames: Set<string>,
    prices: Record<string, number>
): SimulationOutput {

    const clinicalAlerts: string[] = [];
    patient = clonePatient(patient);

    // 1. Audit inputs: duplicates, missing/implausible data, unknown LVEF, SBP <= DBP (alerts-only hard stops).
    const audit = auditInputs(patient, clinicalAlerts);
    if (audit.stop) return audit.stop;
    const { dataAudit, gdmtGaps, missingDataNotices } = audit;

    // 2. Raise the alert-only gates (pregnancy, low output, referrals, volume depletion, ...).
    const flags = raiseClinicalAlerts(patient, dataAudit, clinicalAlerts);

    // 3. Hard safety stops: SBP < 90 or K+ >= 6.5 returns alerts only.
    const hardStop = checkSafetyHardStops(patient, clinicalAlerts, gdmtGaps, missingDataNotices);
    if (hardStop) return hardStop;

    // 4. Eligibility: numbered rules withhold drugs (allergy, intolerance, contraindication, renal) with a reason.
    const { formulary, excludedMeds, intolerancePolicy, allBBExcluded } =
        runEligibilityStage(patient, dataAudit.unknownRenal, availableMedNames, clinicalAlerts);

    // 5. Enumerate: dose tiers -> analyze the current regimen -> candidate modifications (add/titrate/swap/remove/keep).
    const medTiers = formulary.flatMap(m => getDoseTiers(m, patient));
    const analysis = analyzeCurrentRegimen(patient, formulary, medTiers, allBBExcluded);
    // Criteria-met adjuncts to surface regardless of whether they rank in the top picks —
    // prevents a guideline-indicated add-on (e.g. A-HeFT H/ISDN, SHIFT ivabradine) from being
    // silently absent just because the composite score favored other changes.
    const eligibleAdjuncts = buildEligibleAdjuncts(analysis.addableAdjuncts);
    const candidateSets = generateCandidateModifications(analysis, patient);

    // 6. Score: rescue appends -> simulate -> 7 domain scores -> weights + named adjustments -> ScoredRegimen.
    const scoringContext = buildScoringContext(patient, prices, intolerancePolicy, dataAudit, formulary, medTiers, analysis, flags);
    const results = scoreCandidates(candidateSets, scoringContext);

    // 7. Rank and select: affordability filter/fallback, display-safety floors, <= 3 distinct picks.
    const picks = selectDisplayPicks(results, patient, clinicalAlerts);
    if (picks.length === 0) return { scoredRegimens: [], excludedMedications: excludedMeds, clinicalAlerts, monitoringPlan: [], gdmtGaps, eligibleAdjuncts, missingDataNotices, followUpCalendar: [] };

    // 8. Explain: monitoring plan, projections, trade-offs, low-output cap, follow-up calendar.
    return assembleOutput(patient, picks, flags.lowOutput, { excludedMeds, clinicalAlerts, gdmtGaps, eligibleAdjuncts, missingDataNotices });
}
