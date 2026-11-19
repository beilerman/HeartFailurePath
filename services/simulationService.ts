import { validateEngineInput } from './engine/inputContract';
import { isActiveExposure } from './engine/medicationExposure';
import { Patient, SimulationOutput } from '../types';
import { runEligibilityStage } from './engine/eligibility';
import { getDoseTiers, clonePatient } from './engine/regimenUtils';
import { auditInputs, raiseClinicalAlerts, checkSafetyHardStops, validatePhysiologicBounds } from './engine/gates';
import { assessDecisionReadiness, limitedInformationReview, knownUrgentFindings, needsDoseIntervalReview } from './engine/decisionReadiness';
import { analyzeCurrentRegimen, generateCandidateModifications } from './engine/candidates';
import { buildScoringContext, scoreCandidates, intensifiesRaasOrMra, labPrerequisiteBlank } from './engine/scoring';
import { selectWithRanking } from './engine/selection';
import { buildEligibleAdjuncts, assembleOutput, reconcilePlanAlerts, annotateGdmtGapsWithMraPotassium, annotateGdmtGapsWithRaasPotassium } from './engine/explain';

// Public facade: every symbol this module exported before the phase-4 split is re-exported here,
// so nothing outside services/ needs an import change.
export { isTargetDoseForPatient, getTargetDosePatientContext, clonePatient, hasCongestion } from './engine/regimenUtils';
export { isRenalOnlyContraindication, deriveIntolerancePolicy, currentMedIntoleranceReason } from './engine/intolerance';
export type { IntolerancePolicy } from './engine/intolerance';
export { MRA_POOL_CLASSES } from './engine/registry';
export {
    BNP_SCORE_TARGET, BNP_SCORE_CRITICAL, NYHA_SCORE_MAP, FUNCTIONAL_STEPS_FULL_CREDIT, VOLUME_SCORING,
    adherenceComplexityThreshold, calculateStructureScoreComponents, CONCORDANCE_TABLE, pillarKeyOf, pillarFamilyOf, classifyPhenotype,
    STRUCTURE_BLEND_WEIGHTS, DOMAIN_GOALS,
} from './engine/domains';
export type { PillarKey, PillarConcordance, Phenotype } from './engine/domains';
export { DISPLAY_FLOORS, resolveRankingMode } from './engine/selection';
export { assessDecisionReadiness, knownUrgentFindings } from './engine/decisionReadiness';
export { HYPOTENSION_SBP_BELOW, MRA_START_K_MAX, MRA_START_K_CEILING, HYPOKALEMIA_K_BELOW, BB_HR_BELOW, SEVERE_CKD_EGFR_BELOW, LOW_OUTPUT } from './engine/thresholds';

/**
 * THE engine entry point. Deterministic and side-effect free: given a patient (including
 * their current regimen), the set of formulary med names available for simulation, and a
 * price map, it:
 *   1. Separates invalid inputs from incomplete observations. Missing core observations
 *      yield a focused safety review; known urgent measurements remain visible. Full
 *      regimen generation still stops at implausible values, SBP < 90, K+ >= 6.5 or SBP <= DBP.
 *   2. Filters the formulary through allergy / intolerance-policy / contraindication /
 *      renal gates (recording every exclusion with its reason).
 *   3. Analyzes the current regimen (contraindicated / intolerable / redundant meds,
 *      titratable and swappable agents, missing pillars, eligible adjuncts).
 *   4. Generates candidate modification sets (add / titrate_up / titrate_down / swap /
 *      remove / keep) with forced cleanups injected, then simulates each candidate's
 *      MARGINAL delta from observed state and scores assessed domains using the selected
 *      eight-domain weight profile, plus named adjustments. Unassessed domains contribute
 *      no weight; the remaining weights are rescaled. No observation is imputed.
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

    const input = validateEngineInput(patient);
    if (input.errors.length > 0) return { scoredRegimens: [], excludedMedications: [], clinicalAlerts: [...knownUrgentFindings(patient), ...input.errors], monitoringPlan: [] };
    const clinicalAlerts: string[] = [];
    patient = clonePatient(patient);
    patient.recorded_medication_exposures = input.regimen;
    patient.current_regimen = input.regimen.filter(isActiveExposure);
    for (const r of input.regimen.filter(r => !isActiveExposure(r))) clinicalAlerts.push(`EXPOSURE HISTORY: ${r.med.name} is recorded as ${r.exposure!.status}. It is not counted as active therapy. Recorded physiology is preserved; no loss of benefit is back-calculated. Confirm the course or restart plan before a new dose.`);
    const unconfirmedUse = patient.current_regimen.filter(r => r.exposure?.status !== 'active' || r.exposure?.adherence !== 'consistent');
    if (unconfirmedUse.length) clinicalAlerts.push(`MEDICATION USE REVIEW: Confirm actual current dose and consistent use before increasing or substituting ${unconfirmedUse.map(r => r.med.name).join(', ')}. Safety-driven reductions/removals and unrelated eligible decisions remain assessable. Treatment duration and individual response are not inferred.`);
    if (patient.potassium > 0 && patient.potassium < 3.5) clinicalAlerts.push('LOW POTASSIUM: New or intensified potassium-lowering diuretics are withheld until potassium is corrected and rechecked. A potassium-raising drug is not assumed to cancel this risk.');
    const intervalUnreviewed = patient.current_regimen.filter(r => needsDoseIntervalReview(patient,r));
    if (intervalUnreviewed.length) clinicalAlerts.push(`DOSE TIMING REVIEW: Before increasing ${intervalUnreviewed.map(r=>r.med.name).join(', ')}, assess the drug-specific interval at the current dose and tolerance. Dates alone do not establish readiness; other eligible decisions remain available.`);
    const decisionReadiness = assessDecisionReadiness(patient);
    const withReadiness = (output: SimulationOutput): SimulationOutput => ({ ...output, decisionReadiness });
    if (decisionReadiness.mode === 'limited_review') {
        const review = limitedInformationReview(patient, decisionReadiness);
        review.clinicalAlerts.unshift(...clinicalAlerts, ...validatePhysiologicBounds(patient));
        return review;
    }

    // 1. Audit inputs: duplicates, missing/implausible data, unknown LVEF, SBP <= DBP (alerts-only hard stops).
    const audit = auditInputs(patient, clinicalAlerts);
    if (audit.stop) return withReadiness(audit.stop);
    const { dataAudit, missingDataNotices } = audit;
    let gdmtGaps = audit.gdmtGaps;

    // 2. Raise the alert-only gates (pregnancy, low output, referrals, volume depletion, ...).
    const flags = raiseClinicalAlerts(patient, dataAudit, clinicalAlerts);

    // 3. Hard safety stops: SBP < 90 or K+ >= 6.5 returns alerts only.
    const hardStop = checkSafetyHardStops(patient, clinicalAlerts, gdmtGaps, missingDataNotices);
    if (hardStop) return withReadiness(hardStop);

    // 4. Eligibility: numbered rules withhold drugs (allergy, intolerance, contraindication, renal) with a reason.
    const { formulary, excludedMeds, intolerancePolicy, allBBExcluded, allRAASExcluded, unresolvedFoundationalClass } =
        runEligibilityStage(patient, dataAudit.unknownRenal, availableMedNames, clinicalAlerts);

    gdmtGaps = annotateGdmtGapsWithRaasPotassium(annotateGdmtGapsWithMraPotassium(gdmtGaps, excludedMeds), excludedMeds);

    // 5. Enumerate: dose tiers -> analyze the current regimen -> candidate modifications (add/titrate/swap/remove/keep).
    const medTiers = formulary.flatMap(m => getDoseTiers(m, patient));
    const analysis = analyzeCurrentRegimen(patient, formulary, medTiers, allBBExcluded, allRAASExcluded, unresolvedFoundationalClass);
    // Criteria-met adjuncts to surface regardless of whether they rank in the top picks —
    // prevents a guideline-indicated add-on (e.g. A-HeFT H/ISDN, SHIFT ivabradine) from being
    // silently absent just because the composite score favored other changes.
    const eligibleAdjuncts = buildEligibleAdjuncts(analysis.addableAdjuncts);
    const candidateSets = generateCandidateModifications(analysis, patient);

    // Laboratory prerequisite (rule E16 + candidate drop): say once, not per candidate, that RAAS/MRA starts and
    // dose increases are withheld because potassium or renal function is blank.
    if (labPrerequisiteBlank(dataAudit) &&
        (excludedMeds.some(m => m.rule_id === 'E16') || candidateSets.some(intensifiesRaasOrMra))) {
        clinicalAlerts.push('LABS REQUIRED: potassium/renal function not entered — RAAS inhibitor and MRA starts and dose increases are withheld until a basic metabolic panel is available. Enter labs that reflect the patient\'s current medications and clinical state.');
    }

    // 6. Score: rescue appends -> simulate -> 8 domain scores -> weights + named adjustments -> ScoredRegimen.
    const scoringContext = buildScoringContext(patient, prices, intolerancePolicy, dataAudit, formulary, medTiers, analysis, flags);
    const results = scoreCandidates(candidateSets, scoringContext);

    // 7. Rank and select: affordability filter/fallback, display-safety floors, <= 3 distinct picks.
    const { picks, ranking } = selectWithRanking(results, patient, clinicalAlerts);
    // An empty result always states a reason. The display-floor case raises NO DISPLAY-SAFE in selection; every other route to "no options" is named here
    // (review 3: a forced beta-blocker switch in a low-output state left an empty page with only unrelated alerts).
    if (picks.length === 0 && !clinicalAlerts.some(a => a.startsWith('NO DISPLAY-SAFE') || a.startsWith('NO OPTION'))) {
        clinicalAlerts.push(`NO OPTION AVAILABLE: no change to the current regimen, and not the current regimen itself, passed this tool's rules for this patient (${candidateSets.length} candidate plans built, ${results.length} scored). ` +
            'This is a limit of the tool, not a statement that nothing should be done: review the alerts above and the withheld drugs with their reasons, and decide clinically.');
    }
    if (picks.length === 0) return withReadiness({ scoredRegimens: [], excludedMedications: excludedMeds, clinicalAlerts, monitoringPlan: [], gdmtGaps, eligibleAdjuncts, missingDataNotices, followUpCalendar: [], ranking });

    // 8. Explain: monitoring plan, projections, trade-offs, low-output cap, follow-up calendar.
    const reconciled = reconcilePlanAlerts(clinicalAlerts, picks, patient);
    clinicalAlerts.length = 0; clinicalAlerts.push(...reconciled);
    return withReadiness(assembleOutput(patient, picks, flags.lowOutput, { excludedMeds, clinicalAlerts, gdmtGaps, eligibleAdjuncts, missingDataNotices, ranking }));
}

export { medicationEffectContext } from './engine/treatmentAssessment';
