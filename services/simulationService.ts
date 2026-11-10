import { Patient, ScoredRegimen, RegimenMed, RegimenModification, ModificationSet, SimulationOutput, DomainScores } from '../types';
import {
    DOMAIN_KEYS, DOMAIN_LABELS, DOMAIN_WEIGHTS, DEFAULT_WEIGHT_PROFILE, SCORE_ADJUSTMENTS, NON_PENALIZED_WARNING_MARKERS,
    ScoreBreakdown, ScoreBreakdownAdjustment, ScoreBreakdownDomainLine, ScoreBreakdownOverride, ScoreDomainKey,
} from './engine/scoreModel';
import { drugFacts } from './engine/drugFacts';
import { buildEligibilityContext, filterEligibleMedications, taggedDiscontinuedMeds } from './engine/eligibility';
import { hasUnknownHistoricalHFrEF, isIronDeficient } from './clinicalPredicates';
import { RAAS_CLASSES, VOLUME_SENSITIVE_INTENSIFICATION_CLASSES, getMedicationClassGroup } from './engine/registry';
import { clonePatient, countNewClassGroups, dedupeCurrentRegimen, formatDose, getDoseTiers, hasDiureticDeEscalation, hasRelevantIntensification, isLowOutputState, isTargetDoseForPatient, shouldPreserveQuadForUnknownHistory } from './engine/regimenUtils';
import { calculateAdherenceScore, calculateCostScore, calculateFunctionalScore, calculateGuidelineConcordanceScore, calculateNeurohormonalScore, calculateStructureScore, calculateVolumeScore, classifyPhenotype, describeConcordance } from './engine/domains';
import { auditCriticalData, detectInappropriateRegimen, validatePhysiologicBounds } from './engine/gates';
import { buildEligibleAdjuncts, buildFollowUpCalendar, buildMissingDataNotices, buildMonitoringPlan, buildQualitativeProjections, buildTradeOffLabels, computeGdmtGaps } from './engine/explain';
import { analyzeCurrentRegimen, generateCandidateModifications } from './engine/candidates';
import { simulateModificationEffect } from './engine/effects';

// Public facade: every symbol this module exported before the phase-4 split is re-exported here,
// so nothing outside services/ needs an import change.
export { isTargetDoseForPatient, getTargetDosePatientContext, clonePatient } from './engine/regimenUtils';
export { isRenalOnlyContraindication, deriveIntolerancePolicy, currentMedIntoleranceReason } from './engine/intolerance';
export type { IntolerancePolicy } from './engine/intolerance';
export { MRA_POOL_CLASSES } from './engine/registry';
export {
    BNP_SCORE_TARGET, BNP_SCORE_CRITICAL, NYHA_SCORE_MAP, FUNCTIONAL_STEPS_FULL_CREDIT, VOLUME_SCORING,
    adherenceComplexityThreshold, calculateStructureScoreComponents, CONCORDANCE_TABLE, pillarKeyOf, classifyPhenotype,
} from './engine/domains';
export type { PillarKey, PillarConcordance, Phenotype } from './engine/domains';

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

    const dedupedCurrent = dedupeCurrentRegimen(patient.current_regimen || []);
    if (dedupedCurrent.duplicateNames.length > 0) {
        patient.current_regimen = dedupedCurrent.regimen;
        clinicalAlerts.push(
            `INPUT SAFETY: Duplicate current medications removed (${dedupedCurrent.duplicateNames.join(', ')}). ` +
            'Duplicate entries can double-count hemodynamic effects.'
        );
    }

    // --- Real-world robustness: audit incomplete data and inappropriate arriving regimens ---
    const dataAudit = auditCriticalData(patient);
    clinicalAlerts.push(...dataAudit.alerts);
    const implausibleValueAlerts = validatePhysiologicBounds(patient);
    clinicalAlerts.push(...implausibleValueAlerts);
    clinicalAlerts.push(...detectInappropriateRegimen(patient));

    // Physiologically-impossible inputs are data-entry errors (unit confusion, transcription
    // slips). Every downstream decision — phenotype, contraindications, projections — would be
    // computed on garbage, so this is a hard stop, not a flag-and-proceed. (e.g. LVEF 99 would
    // otherwise classify as HFpEF and drive a confident SGLT2i pathway off a typo.)
    if (implausibleValueAlerts.length > 0) {
        return { scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: [], gdmtGaps: [], missingDataNotices: buildMissingDataNotices(patient), followUpCalendar: [] };
    }

    // LVEF is the axis the entire phenotype/pathway selection turns on. Without it the tool
    // cannot pick HFrEF vs HFmrEF vs HFpEF — fail safe with alerts only rather than guessing.
    if (dataAudit.unknownLvef) {
        return { scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: [], gdmtGaps: [], missingDataNotices: buildMissingDataNotices(patient), followUpCalendar: [] };
    }

    // Deterministic, guideline-anchored categorical outputs — independent of scoring.
    const gdmtGaps = computeGdmtGaps(patient);
    const missingDataNotices = buildMissingDataNotices(patient);

    if (patient.sbp <= patient.dbp) {
        clinicalAlerts.push(
            'INPUT ERROR: Systolic BP must be greater than diastolic BP (SBP > DBP). ' +
            'Correct blood pressure values before running recommendations.'
        );
        return { scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: [] };
    }

    // --- S4: Pregnancy safety alert ---
    if (patient.is_pregnant === true) {
        clinicalAlerts.push('PREGNANCY ALERT: ACEi, ARB, ARNI, MRA, and nsMRA (Finerenone) are contraindicated (Category X). SGLT2i excluded (Category C — insufficient human safety data). Vericiguat excluded (FDA BOXED WARNING — embryo-fetal toxicity) and Ivabradine excluded (fetal harm in animal studies). GLP-1 therapy excluded. These agents have been excluded from all recommendations.');
    }

    // --- S2: Hemodynamic instability — block pharmacologic optimization ---
    // Threshold raised to SBP < 90 (MAP ~65 mmHg): oral GDMT initiation requires adequate perfusion
    const lowOutput = isLowOutputState(patient);
    if (lowOutput) {
        clinicalAlerts.push(
            'LOW OUTPUT STATE: LVEF < 20% with hypoperfusion markers (cool extremities, narrow pulse pressure, or pre-renal azotemia). ' +
            'Consider inotropic support and Advanced HF consultation before oral GDMT initiation.'
        );
    }

    if (patient.sbp < 90) {
        clinicalAlerts.push(
            'HEMODYNAMIC INSTABILITY: SBP < 90 mmHg. Oral GDMT optimization is unsafe at current blood pressure. ' +
            'Stabilize hemodynamics first. Consider: IV inotropes (dobutamine/milrinone), hemodynamic monitoring (PA catheter), ' +
            'vasopressor support if needed, and Advanced Heart Failure consultation.'
        );
    }

    // --- S2b: Hyperkalemic emergency — baseline K+ 6.0-8.0 (values > 8.0 already hard-stop as
    // implausible/extreme in validatePhysiologicBounds). A medical emergency requiring ECG and
    // urgent treatment, not outpatient regimen optimization. For K+ >= 6.5 the engine returns
    // alerts only (parallel to the SBP < 90 gate below); for 6.0-6.4 it alerts and proceeds —
    // deprescribing the offending agent with binder rescue is still clinically useful there.
    const hyperkalemicEmergency = patient.potassium >= 6.0 && patient.potassium <= 8.0;
    if (hyperkalemicEmergency) {
        clinicalAlerts.push(
            'HYPERKALEMIC EMERGENCY: Serum K+ ' + patient.potassium.toFixed(1) + ' mEq/L (≥ 6.0). ' +
            'Obtain ECG immediately and treat urgently — IV calcium if ECG changes, insulin/glucose, ' +
            'K+ binder or dialysis — before oral GDMT optimization.'
        );
    }

    // --- S3: Advanced HF referral trigger ---
    const advancedHFCriteria = lowOutput ||
        (patient.lvef <= 20 && patient.sbp < 90) ||
        (patient.nyha_class === 'IV' && patient.nt_pro_bnp > 4000);
    if (advancedHFCriteria) {
        clinicalAlerts.push(
            'ADVANCED HEART FAILURE ALERT: This patient meets criteria for Advanced HF evaluation (INTERMACS 3-4). ' +
            'Consider: IV inotropic support, mechanical circulatory support (LVAD/Impella), heart transplant evaluation, ' +
            'CRT/ICD assessment, and palliative care discussion. Refer to Advanced HF specialist.'
        );
    }

    // --- D4: ICD/CRT device eligibility screening (ACC/AHA 2022 §7.3.5, Class I) ---
    const icdCrtEligible = patient.lvef <= 35 &&
        (patient.nyha_class === 'II' || patient.nyha_class === 'III') &&
        !advancedHFCriteria; // Advanced HF already triggers its own referral
    if (icdCrtEligible) {
        clinicalAlerts.push(
            'DEVICE THERAPY SCREENING: LVEF ≤ 35% with NYHA Class ' + patient.nyha_class + '. ' +
            'Evaluate for ICD (primary prevention of sudden cardiac death) after ≥ 3 months of optimized GDMT. ' +
            'If QRS ≥ 150ms with LBBB morphology, also evaluate for CRT (Class I, ACC/AHA 2022). ' +
            'Refer to electrophysiology if not already assessed.'
        );
    }

    // --- D5: Cardiac rehabilitation referral (ACC/AHA 2022 §7.3.4, Class I) ---
    const cardiacRehabEligible = patient.lvef <= 40 &&
        (patient.nyha_class === 'II' || patient.nyha_class === 'III') &&
        patient.sbp >= 90 && !advancedHFCriteria;
    if (cardiacRehabEligible) {
        clinicalAlerts.push(
            'CARDIAC REHABILITATION: HFrEF with NYHA Class ' + patient.nyha_class +
            '. Exercise-based cardiac rehab is Class I (ACC/AHA 2022) for stable HF patients — improves functional capacity, quality of life, and reduces HF hospitalization. Refer if not already enrolled.'
        );
    }

    // --- P5: Volume depletion alert ---
    const currentFluidBalance = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const isVolumeDepleted = currentFluidBalance < -1.0;
    const hasDiureticInCurrent = (patient.current_regimen || []).some(r =>
        r.med.drug_class === 'Loop Diuretic' || r.med.drug_class === 'Thiazide-like Diuretic'
    );
    if (isVolumeDepleted && hasDiureticInCurrent) {
        clinicalAlerts.push(
            'VOLUME DEPLETION: Patient is ' + Math.abs(currentFluidBalance).toFixed(1) + 'kg below dry weight while on diuretics. ' +
            'Diuretic reduction/discontinuation is the priority intervention before adding new agents. Risk of AKI and hemodynamic collapse.'
        );
    }

    if (!dataAudit.unknownRenal && patient.egfr < 20) {
        clinicalAlerts.push(
            'SEVERE CKD DIURETIC ALERT: eGFR < 20 may blunt oral loop diuretic response. Consider BID/TID loop dosing strategy, conversion to torsemide/bumetanide, and close daily weight/urine monitoring.'
        );
    }

    const historicalStatusUnknown = hasUnknownHistoricalHFrEF(patient);
    const preservingQuadForUnknownHistory = shouldPreserveQuadForUnknownHistory(patient);
    if (patient.lvef > 40 && historicalStatusUnknown) {
        if (preservingQuadForUnknownHistory) {
            clinicalAlerts.push(
                'HFimpEF STATUS UNKNOWN: Prior reduced EF is undocumented, but existing RAAS/BB/MRA therapy suggests possible HFimpEF. Recommendations preserve quad GDMT while prior records are clarified.'
            );
        } else {
            clinicalAlerts.push(
                'HFimpEF STATUS UNKNOWN: Cannot determine if this patient previously had LVEF <= 40%. If previously on quad GDMT, consider continuing RAAS/BB/MRA/SGLT2i until prior records are clarified.'
            );
        }
    }

    const vericiguatCoreEligible = (patient.nyha_class === 'II' || patient.nyha_class === 'III' || patient.nyha_class === 'IV') &&
        patient.nt_pro_bnp >= 1600 &&
        patient.lvef < 45;
    // M5: Only alert when worsening status is unknown — suppress when explicitly 'no' (patient
    // definitively ineligible). Coalesce: an absent field means the same as 'unknown' — both block
    // vericiguat via hasRecentWorseningHF, so both must prompt for documentation.
    if (vericiguatCoreEligible && (patient.recent_hf_worsening_within_6mo ?? 'unknown') === 'unknown') {
        clinicalAlerts.push(
            'VERICIGUAT ELIGIBILITY WARNING: Recent HF worsening status unknown. Document if hospitalization or IV diuretics occurred within 6 months — required before Vericiguat use.'
        );
    }

    if (patient.sbp < 90 || patient.potassium >= 6.5) {
        return {
            scoredRegimens: [],
            excludedMedications: taggedDiscontinuedMeds(patient),
            clinicalAlerts,
            monitoringPlan: [],
            gdmtGaps,
            eligibleAdjuncts: [],
            missingDataNotices,
            followUpCalendar: []
        };
    }

    // 1. Filter Formulary & Check Exclusions (same logic as before)
    // Eligibility stage: ordered, numbered rules (services/engine/eligibility.ts). Each exclusion
    // carries rule_id/rule_name. Discontinuations are listed first, then new exclusions.
    const eligibility = buildEligibilityContext(patient, dataAudit.unknownRenal);
    const intolerancePolicy = eligibility.intolerancePolicy;
    if (eligibility.hasSulfaAllergy) {
        clinicalAlerts.push('SULFA ALLERGY: Loop and thiazide diuretics are sulfonamide derivatives. Cross-reactivity is low but documented — monitor for rash/hypersensitivity. Ethacrynic acid is the sulfonamide-free loop alternative if a true reaction occurs.');
    }
    if (eligibility.excludeBB) {
        clinicalAlerts.push('BETA-BLOCKER INTOLERANCE: Prior bradycardia/AV block on a beta-blocker. New beta-blocker initiation is deferred; if a beta-blocker is essential, evaluate for pacing. An existing beta-blocker should be reduced, not abruptly stopped.');
    }
    const { formulary, excludedMeds } = filterEligibleMedications(eligibility, availableMedNames);
    // (Per-class exclusion tracking is derived from the filtered formulary where needed —
    // e.g. allBBExcluded below — rather than a parallel excludedClasses set, which drifted.)

    // Check if ALL beta blockers were excluded (not just one)
    const allBBExcluded = !formulary.some(m => m.drug_class === 'Beta Blocker');

    // 2. Build dose tiers for available formulary
    const medTiers = formulary.flatMap(m => getDoseTiers(m, patient));

    // 3. Analyze current regimen
    const analysis = analyzeCurrentRegimen(patient, formulary, medTiers, allBBExcluded);

    // Criteria-met adjuncts to surface regardless of whether they rank in the top picks —
    // prevents a guideline-indicated add-on (e.g. A-HeFT H/ISDN, SHIFT ivabradine) from being
    // silently absent just because the composite score favored other changes.
    const eligibleAdjuncts = buildEligibleAdjuncts(analysis.addableAdjuncts);

    // 4. Generate candidate modifications
    const binders = medTiers.filter(r => r.med.drug_class === 'K+ Binder');
    const candidateSets = generateCandidateModifications(analysis, patient);

    // 5. Score each candidate
    // H7: Binder rescue — prefer Patiromer, fallback to any available K+ binder (Lokelma)
    const rescueBinder = binders.find(b => drugFacts(b.med).rescue_role?.preferred) || binders[0];
    const ivIron = medTiers.find(r => r.med.drug_class === 'IV Iron');
    const ironDeficient = isIronDeficient(patient);
    const results: ScoredRegimen[] = [];
    const maxNewPerVisit = Math.max(0, Math.round(patient.max_new_classes_per_visit ?? 2));

    // --- GDMT completeness target -------------------------------------------------------
    // Standard of care is COMPLETE guideline therapy, rapidly sequenced — not the smallest
    // safe change. The weighted domains alone under-reward each added pillar (guideline 15% ×
    // 20 pts ≈ +3) while cost/adherence immediately penalize the extra drug, so partial
    // regimens out-rank complete ones and the 3-slot display drops the rest. This bonus rewards
    // each INDICATED, ACHIEVABLE therapy actually present, proportionally, with enough weight
    // that the complete safe regimen leads. "Achievable" excludes therapies the patient cannot
    // take (already filtered out of `formulary`), so a patient is never penalized for a
    // contraindicated pillar. It is applied BEFORE the hemodynamic/electrolyte penalties below,
    // so an unsafe projection still disqualifies the regimen regardless of completeness.
    const COMPLETENESS_MAX = SCORE_ADJUSTMENTS.GDMT_COMPLETENESS.max;
    const phenotype = classifyPhenotype(patient);
    const isReducedPhenotype = phenotype === 'HFrEF' || phenotype === 'HFmrEF';

    interface GdmtSlot { match: (cls: string) => boolean; }
    const completenessSlots: GdmtSlot[] = [];
    if (isReducedPhenotype) {
        completenessSlots.push(
            { match: (c) => RAAS_CLASSES.has(c) },
            { match: (c) => c === 'Beta Blocker' },
            { match: (c) => c === 'MRA' || (c === 'nsMRA' && phenotype === 'HFmrEF') },
            { match: (c) => c === 'SGLT2i' }
        );
    } else { // HFpEF
        completenessSlots.push(
            { match: (c) => c === 'SGLT2i' },
            { match: (c) => c === 'MRA' || c === 'nsMRA' } // TOPCAT / FINEARTS-HF adjunct
        );
    }
    // Eligible DISEASE-MODIFYING adjuncts also count toward completeness, sourced from the engine's
    // own eligibility (analysis.addableAdjuncts) so criteria (HR/rhythm for ivabradine, NT-proBNP +
    // worsening for vericiguat, BMI/EF for GLP-1, A-HeFT for H/ISDN, iron studies for IV iron) stay
    // in ONE place. Symptomatic-only adjuncts (loop/thiazide diuretics, digoxin) are excluded — they
    // are not guideline "completeness." Without this, adding an indicated adjunct earned no
    // completeness credit, so the bare pillar regimen out-ranked it and the adjunct fell out of the
    // 3-slot display (e.g. ivabradine in a SHIFT candidate, vericiguat in a VICTORIA candidate).
    const ADJUNCT_COMPLETENESS_CLASSES = new Set(['If Inhibitor', 'sGC Stimulator', 'Vasodilator', 'GLP-1 RA', 'GLP-1/GIP RA', 'IV Iron']);
    const eligibleAdjunctClasses = new Set<string>();
    analysis.addableAdjuncts.forEach(a => { if (ADJUNCT_COMPLETENESS_CLASSES.has(a.med.drug_class)) eligibleAdjunctClasses.add(a.med.drug_class); });
    (patient.current_regimen ?? []).forEach(r => { if (ADJUNCT_COMPLETENESS_CLASSES.has(r.med.drug_class)) eligibleAdjunctClasses.add(r.med.drug_class); });
    // GLP-1 RA and GLP-1/GIP RA are one therapeutic slot (either agent satisfies it).
    const hasGlp1Slot = [...eligibleAdjunctClasses].some(c => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA');
    eligibleAdjunctClasses.delete('GLP-1 RA');
    eligibleAdjunctClasses.delete('GLP-1/GIP RA');
    if (hasGlp1Slot) completenessSlots.push({ match: (c) => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA' });
    eligibleAdjunctClasses.forEach(cls => completenessSlots.push({ match: (c) => c === cls }));

    // Keep only slots the patient can actually attain (a non-excluded formulary med exists).
    const achievableSlots = completenessSlots.filter(s => formulary.some(m => s.match(m.drug_class)));

    candidateSets.forEach(modSet => {
        const requiresDiureticFirst = isVolumeDepleted && hasDiureticInCurrent;
        if (requiresDiureticFirst) {
            const hasUnsafeIntensification = hasRelevantIntensification(modSet, VOLUME_SENSITIVE_INTENSIFICATION_CLASSES);
            const hasPriorityDeEscalation = hasDiureticDeEscalation(modSet);
            if (hasUnsafeIntensification && !hasPriorityDeEscalation) {
                return;
            }
        }

        // Pre-simulation rescue appends are built FIRST, then the candidate is simulated ONCE.
        // Iron rescue depends only on patient-level invariants and the candidate's contents;
        // DIAMOND depends on BASELINE potassium — neither needs a prior simulation (previously
        // every candidate was simulated twice for iron-deficient patients, discarding the first
        // result). Only the reactive K+ > 5.3 binder rescue below needs the projected potassium.
        let activeModSet = modSet;

        // Iron rescue: auto-append IV iron when criteria met (clinic-administered, not competing with oral GDMT)
        if (ironDeficient && ivIron && !activeModSet.resulting_regimen.some(r => r.med.drug_class === 'IV Iron')) {
            const ironMod: RegimenModification = {
                action: 'add',
                target: ivIron,
                summary: `Add ${ivIron.med.name} ${formatDose(ivIron)} (iron deficiency)`
            };
            activeModSet = {
                modifications: [...activeModSet.modifications, ironMod],
                resulting_regimen: [...activeModSet.resulting_regimen, ivIron]
            };
        }

        // DIAMOND protocol: proactive binder co-prescription when initiating MRA at baseline K+ > 5.0
        const isMraAdd = activeModSet.modifications.some(m =>
            m.action === 'add' && m.target &&
            (m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA')
        );
        const alreadyHasBinder = activeModSet.resulting_regimen.some(r =>
            r.med.drug_class === 'K+ Binder'
        );
        if (isMraAdd && patient.potassium > 5.0 && rescueBinder && !alreadyHasBinder) {
            const diamondMod: RegimenModification = {
                action: 'add',
                target: rescueBinder,
                summary: `Add ${rescueBinder.med.name} ${formatDose(rescueBinder)} (DIAMOND protocol)`
            };
            activeModSet = {
                modifications: [...activeModSet.modifications, diamondMod],
                resulting_regimen: [...activeModSet.resulting_regimen, rescueBinder]
            };
        }

        let sim = simulateModificationEffect(patient, activeModSet, prices, intolerancePolicy);

        // H7+H8: Binder rescue: if K+ > 5.3, try adding K+ binder (Patiromer preferred, Lokelma fallback)
        // H8 fix: Use activeModSet (which includes iron if appended) not original modSet
        if (sim.projectedPatient.potassium > 5.3 && rescueBinder && !activeModSet.resulting_regimen.some(r => r.med.drug_class === 'K+ Binder')) {
            const rescueMod: RegimenModification = {
                action: 'add',
                target: rescueBinder,
                summary: `Add ${rescueBinder.med.name} ${formatDose(rescueBinder)}`
            };
            const rescuedModSet: ModificationSet = {
                modifications: [...activeModSet.modifications, rescueMod],
                resulting_regimen: [...activeModSet.resulting_regimen, rescueBinder]
            };
            const rescuedSim = simulateModificationEffect(patient, rescuedModSet, prices, intolerancePolicy);

            if (rescuedSim.projectedPatient.potassium < 5.3 && rescuedSim.projectedPatient.potassium > 3.5) {
                sim = rescuedSim;
                sim.warnings.push(`Binder Required: ${rescueBinder.med.name} added to manage Hyperkalemia.`);
                activeModSet = rescuedModSet;
            }
        }

        if (countNewClassGroups(activeModSet.resulting_regimen, patient.current_regimen || []) > maxNewPerVisit) {
            return;
        }

        const p = sim.projectedPatient;

        // Unknown baseline NT-proBNP → neutral 50, not a false 100 (it would otherwise
        // read as "perfect neurohormonal status" simply because the field was blank).
        const s_neuro = dataAudit.unknownBnp ? 50 : calculateNeurohormonalScore(p.nt_pro_bnp);
        const s_func = calculateFunctionalScore(p.nyha_class, p.kccq_score, p.daily_step_count);
        const s_vol = calculateVolumeScore(p.volume_status.dry_weight_kg, p.volume_status.current_weight_kg, p.volume_status.exam_findings, p.oxygen_saturation);
        const s_struc = calculateStructureScore(p.lvef, p.lvedd, p.lavi, patient.lvef, patient.lvedd, patient.lavi);
        const s_cost = calculateCostScore(sim.cost, patient.max_affordable_cost, patient.cost_sensitivity);
        const s_adhere = calculateAdherenceScore(sim.complexity, patient.complexity_tolerance);
        const s_guide = calculateGuidelineConcordanceScore(activeModSet.resulting_regimen, patient, phenotype);
        // Attach the evidence basis (recommendation class + trials) for the pillars present.
        sim.rationale = [...sim.rationale, ...describeConcordance(activeModSet.resulting_regimen, patient, phenotype)];

        // Weighted scoring: Clinical domains 60%, Patient factors 25%, Evidence 15%
        // Neuro 20% | Func 15% | Vol 15% | Struct 10% | Cost 15% | Adhere 10% | Guideline 15%
        // Computed from the DOMAIN_WEIGHTS table, accumulated left-to-right in DOMAIN_KEYS order
        // (identical float operation order to the original literal expression).
        const unroundedDomainScores: Record<ScoreDomainKey, number> = {
            neurohormonal: s_neuro, functional: s_func, volume: s_vol, structure: s_struc,
            cost: s_cost, adherence: s_adhere, guideline: s_guide,
        };
        const breakdownDomains: ScoreBreakdownDomainLine[] = DOMAIN_KEYS.map(key => ({
            key,
            label: DOMAIN_LABELS[key],
            score: unroundedDomainScores[key],
            weight: DOMAIN_WEIGHTS[key],
            contribution: unroundedDomainScores[key] * DOMAIN_WEIGHTS[key],
        }));
        let overall = breakdownDomains.reduce((sum, d) => sum + d.contribution, 0);
        const weightedSubtotal = overall;
        const breakdownAdjustments: ScoreBreakdownAdjustment[] = [];
        const breakdownOverrides: ScoreBreakdownOverride[] = [];
        const addAdjustment = (spec: { code: string; label: string }, points: number, detail?: string) => {
            overall += points;
            breakdownAdjustments.push(detail === undefined
                ? { code: spec.code, label: spec.label, points }
                : { code: spec.code, label: spec.label, points, detail });
        };

        // Special feature bonus (normalized by regimen size, capped +15)
        const regimenLength = activeModSet.resulting_regimen.length;
        const normalizedSFBonus = regimenLength > 0
            ? Math.max(SCORE_ADJUSTMENTS.SPECIAL_FEATURES.min, Math.min(SCORE_ADJUSTMENTS.SPECIAL_FEATURES.max, sim.specialFeatureBonus / regimenLength * SCORE_ADJUSTMENTS.SPECIAL_FEATURES.factor))
            : 0;
        addAdjustment(SCORE_ADJUSTMENTS.SPECIAL_FEATURES, normalizedSFBonus);

        // GDMT completeness bonus — rewards the share of indicated, achievable therapy attained.
        // DOSE-AWARE: a pillar present but below target earns PARTIAL credit, so up-titrating a
        // sub-target agent toward its target raises the score (otherwise a quad at starting doses
        // would look "complete" and the engine would prefer "keep" over titration — GDMT inertia).
        // A single-dose drug, or one already at target / at its maximum available dose, earns full
        // credit (it cannot be titrated further).
        const SUBTARGET_CREDIT = 0.6;
        const slotValue = (s: GdmtSlot): number => {
            const meds = activeModSet.resulting_regimen.filter(r => s.match(r.med.drug_class));
            if (meds.length === 0) return 0;
            const optimal = meds.some(r => {
                const doses = r.med.available_doses;
                if (doses.length === 1) return true;
                const atTarget = isTargetDoseForPatient(r, patient);
                const strengths = doses.map(d => Number(d.strength)).filter(n => !Number.isNaN(n));
                const atMax = strengths.length > 0 && Number(r.dose.strength) >= Math.max(...strengths);
                return atTarget || atMax;
            });
            return optimal ? 1.0 : SUBTARGET_CREDIT;
        };
        let gdmtCompleteness = 0;
        if (achievableSlots.length > 0) {
            const attained = achievableSlots.reduce((sum, s) => sum + slotValue(s), 0);
            gdmtCompleteness = attained / achievableSlots.length;
            addAdjustment(SCORE_ADJUSTMENTS.GDMT_COMPLETENESS, COMPLETENESS_MAX * gdmtCompleteness,
                `${(gdmtCompleteness * 100).toFixed(0)}% of ${achievableSlots.length} achievable indicated therapies`);
        }

        // P5: Volume depletion — boost diuretic removal candidates
        if (isVolumeDepleted) {
            const hasDiureticRemoval = hasDiureticDeEscalation(activeModSet);
            if (hasDiureticRemoval) addAdjustment(SCORE_ADJUSTMENTS.VOLUME_DEPLETION_DEESCALATION, SCORE_ADJUSTMENTS.VOLUME_DEPLETION_DEESCALATION.points);
        }

        // Graduated hemodynamic safety penalties for PROJECTED SBP.
        // The input SBP < 90 gate is a separate hard block for truly hypotensive patients, and the
        // display filter hides any regimen projecting SBP < 85 — those protect against real harm.
        // This RANKING penalty is therefore recalibrated to trial tolerability so it no longer
        // swamps guideline value: a projected SBP in the low-to-mid 90s is well within COPERNICUS
        // (enrolled ≥ 85) and PIONEER-HF (≥ 100) tolerability, and the projected value here is the
        // CONSERVATIVE pre-compensation estimate. The prior −60/−30 made hemodynamically-inert
        // drugs (e.g. digoxin) out-rank SGLT2i / full GDMT in de-novo patients starting near
        // SBP 100 — backwards. Disqualification at < 85 is retained.
        if (p.sbp < SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.threshold) {
            // Projected severe hypotension — disqualify (also display-filtered). Non-additive: recorded as an override.
            // NOTE: later adjustments (HR, K+, warnings, unknown-lab) still apply on top of this zeroed total.
            breakdownOverrides.push({
                code: SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.code,
                label: SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.label,
                applies_to: 'raw_score',
                before: overall,
                after: 0,
                detail: `projected SBP ${p.sbp}`,
            });
            overall = 0;
        }
        else if (p.sbp < SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90, SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.points, `projected SBP ${p.sbp}`);  // Caution; GDMT often still appropriate with monitoring
        else if (p.sbp < SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95, SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95.points, `projected SBP ${p.sbp}`);   // Mild; within trial tolerability for the conservative estimate
        if (p.pulse < SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50, SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.points, `projected HR ${p.pulse}`);
        if (p.potassium > SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5, SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.points, `projected K+ ${p.potassium}`);

        // "Binder Required" deliberately COUNTS here: a regimen that needs a rescue binder to
        // stay under the K+ ceiling carries residual hyperkalemia risk. The binder enables the
        // regimen to be considered (DIAMOND), but must not erase the risk in ranking — an
        // otherwise-equal regimen that needs no rescue should score above one that does.
        // Only TRUE safety warnings should reduce the score. Informational / procedural guidance
        // (titration cadence, elderly start-low-go-slow, routine monitoring) must NOT be penalized —
        // counting the "Titration Interval" guidance as a danger made titrating GDMT toward target
        // score LOWER than leaving it sub-target, defeating the point. NOTE: "Binder Required" is
        // deliberately NOT here — a regimen needing K+ binder rescue carries residual hyperkalemia
        // risk and should rank below an equal regimen that does not (DIAMOND enables, doesn't erase).
        // Marker list (NON_PENALIZED_WARNING_MARKERS) lives in services/engine/scoreModel.ts.
        const dangerousWarnings = sim.warnings.filter(w =>
            !NON_PENALIZED_WARNING_MARKERS.some(marker => w.includes(marker))
        );
        if (dangerousWarnings.length > 0) addAdjustment(SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS, dangerousWarnings.length * SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS.perUnit, dangerousWarnings.join(' | '));

        // Unknown baseline potassium: the projected-K+ hyperkalemia gate above is meaningless
        // when K+ was never entered (it computes from a 0 baseline and always looks "safe").
        // For any RAAS/MRA initiation or up-titration, apply an explicit caution penalty and
        // a mandatory pre-initiation check — never let blank data clear the gate. (Placed after
        // the dangerousWarnings penalty so the added warning is not double-counted.)
        if (dataAudit.unknownPotassium) {
            const initiatesRaasMra = activeModSet.modifications.some(m =>
                (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') &&
                m.target && (RAAS_CLASSES.has(m.target.med.drug_class) || m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA')
            );
            if (initiatesRaasMra) {
                addAdjustment(SCORE_ADJUSTMENTS.UNKNOWN_POTASSIUM, SCORE_ADJUSTMENTS.UNKNOWN_POTASSIUM.points);
                sim.warnings.push('POTASSIUM UNKNOWN: Baseline serum potassium was not entered. Obtain a BMP and confirm K+ ≤ 5.0 before initiating or up-titrating this RAAS inhibitor / MRA.');
            }
        }

        // Unknown renal function: same pattern as unknown potassium. Renal-gated current meds
        // are retained (not force-removed on blank data) and renal-gated new starts are withheld
        // with a data-required reason — but any candidate that UP-TITRATES a retained renal-gated
        // class must carry an explicit caution and ranking penalty until a BMP is obtained.
        if (dataAudit.unknownRenal) {
            const intensifiesRenalGated = activeModSet.modifications.some(m =>
                (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') &&
                m.target && (RAAS_CLASSES.has(m.target.med.drug_class) || m.target.med.drug_class === 'MRA'
                    || m.target.med.drug_class === 'nsMRA' || m.target.med.drug_class === 'SGLT2i')
            );
            if (intensifiesRenalGated) {
                addAdjustment(SCORE_ADJUSTMENTS.UNKNOWN_RENAL, SCORE_ADJUSTMENTS.UNKNOWN_RENAL.points);
                sim.warnings.push('RENAL FUNCTION UNKNOWN: eGFR/creatinine was not entered. Obtain a BMP before initiating or up-titrating RAAS / MRA / SGLT2i therapy — renal dosing and safety cannot be assessed.');
            }
        }

        const domainScores: DomainScores = {
            neurohormonal: Math.round(s_neuro),
            functional: Math.round(s_func),
            volume: Math.round(s_vol),
            structure: Math.round(s_struc),
            cost: Math.round(s_cost),
            adherence: Math.round(s_adhere),
            guideline: Math.round(s_guide)
        };
        const finalOverall = Math.round(Math.min(SCORE_ADJUSTMENTS.SCORE_CLAMP.max, Math.max(SCORE_ADJUSTMENTS.SCORE_CLAMP.min, overall)));
        const wasClamped = overall < SCORE_ADJUSTMENTS.SCORE_CLAMP.min || overall > SCORE_ADJUSTMENTS.SCORE_CLAMP.max;
        if (wasClamped) {
            breakdownOverrides.push({
                code: SCORE_ADJUSTMENTS.SCORE_CLAMP.code,
                label: SCORE_ADJUSTMENTS.SCORE_CLAMP.label,
                applies_to: 'overall_score',
                before: overall,
                after: finalOverall,
            });
        }
        const scoreBreakdown: ScoreBreakdown = {
            weight_profile: DEFAULT_WEIGHT_PROFILE,
            domains: breakdownDomains,
            weighted_subtotal: weightedSubtotal,
            adjustments: breakdownAdjustments,
            raw_score: overall,
            overall_score: finalOverall,
            clamped: wasClamped,
            ...(breakdownOverrides.length > 0 ? { overrides: breakdownOverrides } : {}),
        };
        results.push({
            regimen: activeModSet.resulting_regimen,
            projected_patient: p,
            baseline_lvef: patient.lvef,
            baseline_lvedd: patient.lvedd,
            baseline_lavi: patient.lavi,
            baseline_dry_weight_kg: patient.volume_status.dry_weight_kg,
            overall_score: finalOverall,
            raw_score: overall,
            score_breakdown: scoreBreakdown,
            domain_scores: domainScores,
            special_feature_bonus: Math.round(normalizedSFBonus),
            gdmt_completeness: gdmtCompleteness,
            cost: sim.cost,
            complexity: sim.complexity,
            rationale: sim.rationale,
            risks: [],
            warnings: sim.warnings,
            // Display-only artifacts (monitoring plan, qualitative projections, trade-off labels)
            // are populated AFTER distinctPicks selection — building them for every scored
            // candidate was pure waste since only ≤ 3 are ever returned.
            monitoring_plan: [],
            qualitative_projections: [],
            trade_offs: [],
            modification_set: activeModSet
        });
    });

    if (typeof process !== 'undefined' && process.env && process.env.DEBUG_CAND) {
        [...results].sort((a, b) => b.overall_score - a.overall_score || (b.gdmt_completeness ?? 0) - (a.gdmt_completeness ?? 0)).slice(0, 14).forEach(r => {
            const ch = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => `${m.action}:${(m.target ?? m.source)?.med.name} ${m.target?.dose?.strength ?? ''}`);
            console.log(`   [cand] ${r.overall_score} c${(r.gdmt_completeness ?? 0).toFixed(2)} :: ${ch.join(', ') || 'KEEP'}`);
        });
    }

    // 6. Affordability filter + distinct picks (same algorithm as before)
    // Ranking is completeness-aware: when overall scores tie (common once strong regimens clamp
    // at the 100 cap), the MORE guideline-complete regimen ranks first, so the option carrying an
    // indicated add-on (e.g. GLP-1 in obese HFpEF/HFmrEF) wins the display slot instead of an
    // equally-scored but less complete sibling. Score still dominates when it differs.
    // Once strong regimens clamp at the 100 cap, the displayed overall_score ties. Break ties by
    // GDMT completeness FIRST, so an indicated add-on (e.g. GLP-1 in obese HFpEF) wins a display
    // slot over a less-complete but raw-score-inflated sibling (e.g. SGLT2i + a symptomatic loop
    // diuretic). Among equally complete regimens, fall to the UNCAPPED raw score, which preserves
    // the evidence/special-feature differentiation the cap erased (e.g. SGLT2i over an MRA-only
    // pairing in HFmrEF). Cost is the FINAL tiebreaker — it ranks AFTER overall score, GDMT
    // completeness, and the uncapped raw score, so it can never override an evidence-based clinical
    // preference (those all decide first; cost is also already in the cost domain and the
    // affordability filter). It only breaks ties where two regimens are clinically indistinguishable
    // down to the raw score — there, recommending the cheaper one is the cost-effective choice
    // (maximize health benefit per dollar).
    const byScoreThenCompleteness = (a: ScoredRegimen, b: ScoredRegimen) =>
        b.overall_score - a.overall_score ||
        (b.gdmt_completeness ?? 0) - (a.gdmt_completeness ?? 0) ||
        (b.raw_score ?? 0) - (a.raw_score ?? 0) ||
        a.cost - b.cost;
    const affordableRegimens = results.filter(r => r.cost <= patient.max_affordable_cost);
    let outputRegimens: ScoredRegimen[] = [];

    if (affordableRegimens.length > 0) {
        outputRegimens = affordableRegimens.sort(byScoreThenCompleteness);
    } else if (results.length > 0) {
        // Nothing fits the budget. Surface the lowest-cost candidates (closest to affordable), but
        // order THEM by clinical value so the best-benefit near-affordable option leads — among
        // equal benefit the cheaper wins (byScoreThenCompleteness ends in cost). Pure cost-ascending
        // would lead with a thin monotherapy / symptomatic-only regimen over a higher-benefit
        // sibling at the same price.
        const cheapest = [...results].sort((a, b) => a.cost - b.cost).slice(0, 5).sort(byScoreThenCompleteness);
        const budgetMessage = patient.max_affordable_cost <= 0
            ? 'No zero-copay regimen found. Add covered medications or raise budget.'
            : 'Increase budget to find valid options.';
        outputRegimens = cheapest.map(r => ({
            ...r,
            warnings: [`BUDGET EXCEEDED: Cheapest option ($${r.cost}) displayed. ${budgetMessage}`, ...r.warnings]
        }));
    }

    // Display-safety floors mirror the graduated score penalties: penalties begin at SBP < 95,
    // K+ > 5.5, HR < 50; the more extreme floors below are hard display gates — a projected
    // state past them is never shown, regardless of how well the regimen scores elsewhere.
    const displaySafeRegimens = outputRegimens.filter(r =>
        r.projected_patient.sbp >= 85 && r.projected_patient.potassium <= 6.0 && r.projected_patient.pulse >= 45
    );
    if (outputRegimens.length > 0 && displaySafeRegimens.length === 0) {
        clinicalAlerts.push(
            'NO DISPLAY-SAFE REGIMEN: Candidate regimens projected severe hypotension (SBP < 85), severe hyperkalemia (K+ > 6.0), or severe bradycardia (HR < 45). ' +
            'Stabilize and reassess before oral intensification.'
        );
    }
    outputRegimens = displaySafeRegimens;

    const topPick = outputRegimens[0];
    if (!topPick) return { scoredRegimens: [], excludedMedications: excludedMeds, clinicalAlerts, monitoringPlan: [], gdmtGaps, eligibleAdjuncts, missingDataNotices, followUpCalendar: [] };

    // S2 note: the SBP < 90 hemodynamic-instability gate returns alerts-only near the top of this
    // function (search 'HEMODYNAMIC INSTABILITY') — do not re-add a duplicate check here; a second
    // copy of the same safety gate invites divergent edits.

    const distinctPicks: ScoredRegimen[] = [topPick];

    for (const r of outputRegimens) {
        if (distinctPicks.length >= 3) break;

        const isDistinct = distinctPicks.every(existing => {
            const costDiff = Math.abs(r.cost - existing.cost);
            const rNames = new Set(r.regimen.map(x => x.med.name));
            const eNames = new Set(existing.regimen.map(x => x.med.name));
            const distinctnessKeys = (reg: RegimenMed[]) => new Set(reg.map(x => drugFacts(x.med).pick_distinctness_key));
            const rKeys = distinctnessKeys(r.regimen);
            const eKeys = distinctnessKeys(existing.regimen);

            const intersection = [...rNames].filter(x => eNames.has(x)).length;
            const union = new Set([...rNames, ...eNames]).size;
            const similarity = intersection / union;

            const hasArniR = rKeys.has('ARNI');
            const hasArniE = eKeys.has('ARNI');

            const isGlp1 = (x: RegimenMed) => getMedicationClassGroup(x.med.drug_class) === 'GLP-1 Therapy';
            const hasGLPR = r.regimen.some(isGlp1);
            const hasGLPE = existing.regimen.some(isGlp1);

            if (hasArniR !== hasArniE) return true;
            if (hasGLPR !== hasGLPE) return true;
            if (costDiff > 30) return true;
            if (similarity < 0.7) return true;

            return false;
        });

        if (isDistinct) {
            distinctPicks.push(r);
        }
    }

    // Populate the deferred display-only artifacts for the ≤ 3 picks actually returned.
    distinctPicks.forEach(r => {
        const hasMra = r.regimen.some(x => x.med.drug_class === 'MRA' || x.med.drug_class === 'nsMRA');
        if (r.modification_set) r.monitoring_plan = buildMonitoringPlan(patient, r.projected_patient, r.modification_set);
        r.qualitative_projections = buildQualitativeProjections(patient, r.projected_patient, hasMra);
        r.trade_offs = buildTradeOffLabels(r.domain_scores);
    });

    // H2: Low-output state — still show recommendations but with mandatory warnings and capped scores.
    // NPs need guidance on current medication management, not a blank screen.
    let finalPicks = distinctPicks;
    if (lowOutput) {
        const lowOutputWarning =
            'LOW OUTPUT STATE: These recommendations require hemodynamic stabilization first. ' +
            'Do NOT initiate new agents until perfusion is restored. ' +
            'If patient is currently on beta-blocker, do NOT abruptly discontinue (Class III harm) — reduce dose if needed. ' +
            'Prioritize: IV inotropes → hemodynamic monitoring → Advanced HF consultation → then cautious oral GDMT.';
        const lowOutputCap = SCORE_ADJUSTMENTS.LOW_OUTPUT_CAP.max;
        finalPicks = distinctPicks.map(r => {
            const cappedScore = Math.min(r.overall_score, lowOutputCap); // Cap score to signal caution
            const bd = r.score_breakdown;
            const capped = bd && cappedScore !== r.overall_score
                ? {
                    ...bd,
                    overall_score: cappedScore,
                    overrides: [...(bd.overrides ?? []), {
                        code: SCORE_ADJUSTMENTS.LOW_OUTPUT_CAP.code,
                        label: SCORE_ADJUSTMENTS.LOW_OUTPUT_CAP.label,
                        applies_to: 'overall_score' as const,
                        before: r.overall_score,
                        after: cappedScore,
                    }],
                }
                : bd;
            return {
                ...r,
                overall_score: cappedScore,
                score_breakdown: capped,
                warnings: [lowOutputWarning, ...r.warnings]
            };
        });
    }

    return {
        scoredRegimens: finalPicks,
        excludedMedications: excludedMeds,
        clinicalAlerts,
        monitoringPlan: topPick.monitoring_plan || [],
        gdmtGaps,
        eligibleAdjuncts,
        missingDataNotices,
        followUpCalendar: buildFollowUpCalendar(topPick.modification_set)
    };
}
