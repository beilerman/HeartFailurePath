/** Display/explanation builders: monitoring plan, qualitative projections, trade-offs, follow-up calendar. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, Medication, ScoredRegimen, ExcludedMedication, SimulationOutput, RegimenMed, ModificationSet, MonitoringPlanItem, QualitativeProjection, TradeOffLabel, TradeOffTone, DomainScores } from '../../types';
import { valueUnknown, hasHistoricalHFrEF, hasUnknownHistoricalHFrEF } from '../clinicalPredicates';
import { DISEASE_MODIFYING_CLASSES, DIURETIC_CLASSES, RAAS_CLASSES } from './registry';
import { hasRelevantIntensification, shouldPreserveQuadForUnknownHistory } from './regimenUtils';
import { regimenSatisfiesPillar } from './domains';
import { SCORE_ADJUSTMENTS } from './scoreModel';

export function buildMonitoringPlan(
    currentPatient: Patient,
    projectedPatient: Patient,
    modificationSet: ModificationSet
): MonitoringPlanItem[] {
    const plan: MonitoringPlanItem[] = [];
    const hasRaasOrMraIntensification = hasRelevantIntensification(
        modificationSet,
        new Set([...RAAS_CLASSES, 'MRA', 'nsMRA'])
    );
    const hasDiureticIntensification = hasRelevantIntensification(modificationSet, DIURETIC_CLASSES);
    const higherRiskElectrolytes = currentPatient.egfr < 45 || currentPatient.potassium >= 5.0 || projectedPatient.potassium > 5.0;

    if (hasRaasOrMraIntensification) {
        plan.push({
            test: 'BMP (potassium, creatinine, eGFR)',
            timing: '3-7 days after RAAS/MRA change',
            details: 'Assess for early hyperkalemia or renal decline after initiation, swap, or up-titration.'
        });
        plan.push({
            test: 'BMP repeat before next titration',
            timing: '10-14 days after change',
            details: 'Hold/reduce and reassess if potassium >= 5.5 or creatinine rises >30% from baseline.'
        });
        if (higherRiskElectrolytes) {
            plan.push({
                test: 'Early potassium check',
                timing: '48-72 hours',
                details: 'Required due to CKD and/or borderline potassium at baseline.'
            });
        }
    }

    const hasSglt2iIntensification = hasRelevantIntensification(modificationSet, new Set(['SGLT2i']));
    if (hasSglt2iIntensification) {
        plan.push({
            test: 'BMP (creatinine, eGFR)',
            timing: '2-4 weeks after SGLT2i initiation',
            details: 'SGLT2i causes an expected hemodynamic eGFR dip of 5-10% (tubuloglomerular feedback). This is reversible and NOT a reason to discontinue. Recheck to confirm stabilization.'
        });
        if (currentPatient.egfr < 45) {
            plan.push({
                test: 'Urinalysis + volume status assessment',
                timing: '1-2 weeks after SGLT2i initiation',
                details: 'CKD patients: monitor for volume depletion from osmotic diuresis. Adjust concurrent loop diuretic dose if needed.'
            });
        }
    }

    if (hasDiureticIntensification) {
        plan.push({
            test: 'Daily weight, BP, orthostasis, dizziness',
            timing: 'Daily for 7 days',
            details: 'Flag over-diuresis if weight loss >1 kg/day, symptomatic hypotension, or presyncope.'
        });
        plan.push({
            test: 'BMP (electrolytes, creatinine)',
            timing: '3-7 days after diuretic increase',
            details: 'Screen for pre-renal AKI, hypokalemia, and hyponatremia after dose escalation.'
        });
    }

    // Honor the renal_adjustment `caution` / `start_dose_modifier` contract: surfaced as
    // MONITORING guidance (dose-adjustment context), not as ranking-penalized warnings.
    // ~15 formulary drugs declare these fields and they were previously silently ignored
    // (Entresto's eGFR<30 half-dose start was a complete no-op).
    if (!(valueUnknown(currentPatient.egfr) || valueUnknown(currentPatient.creatinine))) {
        const renalCautionMeds: string[] = [];
        const reducedStartMeds: string[] = [];
        modificationSet.resulting_regimen.forEach(r => {
            const adj = r.med.renal_adjustment ? r.med.renal_adjustment(currentPatient.egfr, currentPatient) : {};
            if (adj.caution) renalCautionMeds.push(r.med.name);
            if (adj.start_dose_modifier !== undefined &&
                modificationSet.modifications.some(m => m.action === 'add' && m.target?.med.name === r.med.name)) {
                reducedStartMeds.push(`${r.med.name} (start at ~${Math.round(adj.start_dose_modifier * 100)}% of the usual starting dose)`);
            }
        });
        if (renalCautionMeds.length > 0) {
            plan.push({
                test: 'Renal dosing review',
                timing: 'At initiation and after any eGFR change',
                details: `Renal dose caution at eGFR ${currentPatient.egfr}: ${renalCautionMeds.join(', ')} — confirm dosing against current renal function and monitor.`
            });
        }
        if (reducedStartMeds.length > 0) {
            plan.push({
                test: 'Reduced starting dose (renal)',
                timing: 'At initiation',
                details: `Begin at a reduced starting dose per label: ${reducedStartMeds.join('; ')}. Titrate cautiously with renal monitoring.`
            });
        }
    }

    return plan;
}

// --- Clinician-facing qualitative / categorical builders ------------------------------
// These are the deterministic, guideline-anchored outputs the tool can defend. They are
// independent of the composite score and of the false-precision projected biomarker values.

export const PILLAR_LABELS: Record<string, string> = {
    'RAAS Inhibitor': 'RAAS inhibitor (ARNI preferred for HFrEF)',
    'Beta Blocker': 'Evidence-based beta-blocker (carvedilol / metoprolol succinate / bisoprolol)',
    'MRA': 'Mineralocorticoid receptor antagonist (MRA)',
    'SGLT2i': 'SGLT2 inhibitor'
};

export function computePhenotypePillars(patient: Patient): string[] {
    const preserveQuadForUnknownHistory = shouldPreserveQuadForUnknownHistory(patient);
    const isHFimpEF = patient.lvef > 40 && (hasHistoricalHFrEF(patient) || preserveQuadForUnknownHistory);
    const isHFpEF = patient.lvef >= 50 && !isHFimpEF;
    return isHFpEF
        ? ['SGLT2i']
        : ['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'];
}

// Indicated-but-missing GDMT classes relative to the CURRENT regimen.
export function computeGdmtGaps(patient: Patient): string[] {
    const currentRegimen = patient.current_regimen || [];
    return computePhenotypePillars(patient)
        .filter(p => !regimenSatisfiesPillar(currentRegimen, p, patient))
        .map(p => PILLAR_LABELS[p] || p);
}

export function buildMissingDataNotices(patient: Patient): string[] {
    const notices: string[] = [];
    if (patient.lvedd === undefined && patient.lavi === undefined) {
        notices.push('No LVEDD or LAVI entered — chamber remodeling is not assessed. Structural inference is limited to LVEF alone.');
    }
    if (patient.ferritin === undefined && patient.tsat === undefined) {
        notices.push('No iron studies (ferritin / TSAT) entered — iron-deficiency therapy (IV iron) cannot be evaluated. Check iron studies in symptomatic HF.');
    } else if (patient.ferritin !== undefined && patient.ferritin >= 100 && patient.ferritin <= 300 && patient.tsat === undefined) {
        notices.push('Ferritin 100-300 with TSAT not entered — functional iron deficiency cannot be confirmed or excluded. Obtain TSAT.');
    }
    if (patient.daily_step_count === undefined) {
        notices.push('No activity / step data entered — functional status is based on NYHA and KCCQ only.');
    }
    if (patient.lvef > 40 && hasUnknownHistoricalHFrEF(patient)) {
        notices.push('Prior LVEF (ever ≤ 40%?) is undocumented — HFimpEF vs HFpEF classification is uncertain. Clarify prior echocardiograms before de-escalating.');
    }
    return notices;
}

export function buildFollowUpCalendar(modSet: ModificationSet | undefined): MonitoringPlanItem[] {
    if (!modSet) return [];
    const initiatesOrTitrates = modSet.modifications.some(m =>
        (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') &&
        m.target && DISEASE_MODIFYING_CLASSES.has(m.target.med.drug_class)
    );
    if (!initiatesOrTitrates) return [];
    return [
        { test: 'Clinical review + BMP (K+, creatinine, eGFR) + BP/HR', timing: 'Day 7 (±2)', details: 'STRONG-HF model: assess tolerance and labs within ~1 week of any GDMT initiation or up-titration. Hold/reduce if K+ ≥ 5.5 or creatinine rises > 30% from baseline.' },
        { test: 'BMP + BP/HR + congestion check; up-titrate if tolerated', timing: 'Week 2', details: 'Advance toward target doses if BP, HR, renal function and K+ permit. Reinforce daily-weight self-monitoring and adherence.' },
        { test: 'BMP + BP/HR; continue stepwise titration', timing: 'Week 4', details: 'Continue up-titration of each pillar toward guideline target / maximally tolerated dose.' },
        { test: 'NT-proBNP + clinical assessment; confirm target doses', timing: 'Week 6', details: 'Confirm quadruple therapy at target/maximally tolerated doses. Document residual gaps and any device/referral needs.' }
    ];
}

export function buildQualitativeProjections(baseline: Patient, projected: Patient, hasMraInRegimen: boolean): QualitativeProjection[] {
    const out: QualitativeProjection[] = [];

    const lvefDelta = projected.lvef - baseline.lvef;
    if (lvefDelta >= 3) out.push({ label: 'Reverse remodeling', direction: 'improve', detail: 'Meaningful EF improvement likely over months with disease-modifying therapy.' });
    else if (lvefDelta >= 1) out.push({ label: 'Reverse remodeling', direction: 'improve', detail: 'Modest EF improvement possible.' });
    else if (lvefDelta <= -2) out.push({ label: 'Reverse remodeling', direction: 'caution', detail: 'EF may decline if disease-modifying therapy is reduced or removed.' });
    else out.push({ label: 'Reverse remodeling', direction: 'stable', detail: 'EF expected to remain broadly stable.' });

    const baseExcess = baseline.volume_status.current_weight_kg - baseline.volume_status.dry_weight_kg;
    const projExcess = projected.volume_status.current_weight_kg - projected.volume_status.dry_weight_kg;
    if (projExcess < baseExcess - 1) out.push({ label: 'Congestion', direction: 'improve', detail: 'Decongestion expected; monitor for over-diuresis.' });
    else if (baseExcess > 1.5) out.push({ label: 'Congestion', direction: 'caution', detail: 'Residual volume overload — diuretic strategy may need adjustment.' });
    else out.push({ label: 'Congestion', direction: 'stable', detail: 'Near-euvolemic / stable volume status.' });

    if (projected.nt_pro_bnp < baseline.nt_pro_bnp * 0.85) out.push({ label: 'Neurohormonal stress', direction: 'improve', detail: 'Natriuretic-peptide burden expected to fall.' });
    else if (projected.nt_pro_bnp > baseline.nt_pro_bnp * 1.1) out.push({ label: 'Neurohormonal stress', direction: 'caution', detail: 'Natriuretic-peptide burden may rise — reassess.' });
    else out.push({ label: 'Neurohormonal stress', direction: 'stable', detail: 'Little change in natriuretic-peptide burden expected.' });

    // Conservative projected SBP (post safety change — compensation excluded from this value)
    if (projected.sbp < 95) out.push({ label: 'Blood pressure', direction: 'caution', detail: 'Hypotension risk — monitor BP and symptoms closely; consider staggered initiation.' });
    else if (projected.sbp < 105) out.push({ label: 'Blood pressure', direction: 'stable', detail: 'Mild BP reduction expected; generally tolerated.' });
    else out.push({ label: 'Blood pressure', direction: 'stable', detail: 'Minimal BP impact expected.' });

    if (!(projected.potassium > 0) || Number.isNaN(projected.potassium)) out.push({ label: 'Potassium', direction: 'caution', detail: 'Potassium not entered — obtain a BMP before RAAS / MRA changes.' });
    else if (projected.potassium > 5.5) out.push({ label: 'Potassium', direction: 'worsen', detail: 'Hyperkalemia risk — binder and close monitoring required.' });
    else if (projected.potassium > 5.0) out.push({ label: 'Potassium', direction: 'caution', detail: 'Borderline potassium — recheck BMP within ~1 week.' });
    else if (projected.potassium < 3.5) out.push({ label: 'Potassium', direction: 'caution', detail: 'Hypokalemia risk — replete and monitor (esp. with diuretics / digoxin).' });
    else if (hasMraInRegimen) out.push({ label: 'Potassium', direction: 'stable', detail: 'Potassium expected acceptable; routine MRA monitoring applies.' });
    else out.push({ label: 'Potassium', direction: 'stable', detail: 'Potassium expected stable.' });

    return out;
}

// Human label + evidence for a criteria-met adjunct, so guideline-indicated add-ons are surfaced
// even when they do not rank inside the top display picks (e.g. A-HeFT H/ISDN, SHIFT ivabradine).
export function describeAdjunct(m: Medication): string {
    switch (m.drug_class) {
        case 'Vasodilator': return 'Hydralazine + isosorbide dinitrate (H/ISDN) — A-HeFT: Class I add-on for Black patients NYHA III–IV on GDMT, or the alternative when RAAS inhibitors cannot be used (all contraindicated/intolerable).';
        case 'If Inhibitor': return 'Ivabradine — SHIFT: sinus rhythm with HR ≥ 70 on maximally-tolerated beta-blocker.';
        case 'sGC Stimulator': return 'Vericiguat — VICTORIA: worsening HFrEF (recent hospitalization / IV diuretics), NT-proBNP ≥ 1600.';
        case 'Inotrope': return 'Digoxin — rate control in AF and/or symptom reduction in HFrEF (narrow therapeutic index — monitor levels).';
        case 'GLP-1 RA':
        case 'GLP-1/GIP RA': return 'GLP-1 / GIP receptor agonist — obesity with HFpEF/HFmrEF (STEP-HFpEF, SUMMIT).';
        case 'IV Iron': return 'IV iron — iron deficiency in symptomatic HF (AFFIRM-AHF / IRONMAN): improves symptoms and reduces hospitalization.';
        case 'nsMRA': return 'Finerenone (nsMRA) — FINEARTS-HF: HFmrEF / HFpEF (LVEF ≥ 40).';
        case 'MRA': return 'Mineralocorticoid receptor antagonist — adjunct per phenotype (TOPCAT in HFpEF).';
        case 'Loop Diuretic': return 'Loop diuretic — symptomatic volume management; titrate to daily weights.';
        case 'Thiazide-like Diuretic': return 'Thiazide add-on — sequential nephron blockade for diuretic resistance.';
        default: return m.name;
    }
}

export function buildEligibleAdjuncts(addableAdjuncts: RegimenMed[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    addableAdjuncts.forEach(r => {
        const label = describeAdjunct(r.med);
        if (!seen.has(label)) { seen.add(label); out.push(label); }
    });
    return out;
}

export function buildTradeOffLabels(domain: DomainScores): TradeOffLabel[] {
    const band = (s: number, good: string, mid: string, bad: string): { label: string; tone: TradeOffTone } =>
        s >= 80 ? { label: good, tone: 'good' } : s >= 50 ? { label: mid, tone: 'neutral' } : { label: bad, tone: 'bad' };
    const cost = band(domain.cost, 'Low cost', 'Moderate cost', 'High cost / financial-toxicity risk');
    const burden = band(domain.adherence, 'Low pill burden', 'Moderate complexity', 'High complexity / adherence risk');
    const evidence = band(domain.guideline, 'Strong guideline concordance', 'Partial concordance', 'Limited concordance');
    return [
        { dimension: 'Cost', label: cost.label, tone: cost.tone },
        { dimension: 'Pill burden', label: burden.label, tone: burden.tone },
        { dimension: 'Evidence', label: evidence.label, tone: evidence.tone }
    ];
}

// --- Real-world robustness: incomplete data & inappropriate regimens -----------------

// valueUnknown now lives in services/clinicalPredicates.ts (shared with constants.ts).

/**
 * Pipeline stage 8 - assemble the final output: fill the display-only artifacts (monitoring plan,
 * qualitative projections, trade-offs) for the picks actually returned, apply the low-output cap,
 * and attach the categorical lists. Moved verbatim from generateAndScoreModifications.
 */
export function assembleOutput(
    patient: Patient,
    distinctPicks: ScoredRegimen[],
    lowOutput: boolean,
    parts: {
        excludedMeds: ExcludedMedication[];
        clinicalAlerts: string[];
        gdmtGaps: string[];
        eligibleAdjuncts: string[];
        missingDataNotices: string[];
    }
): SimulationOutput {
    const { excludedMeds, clinicalAlerts, gdmtGaps, eligibleAdjuncts, missingDataNotices } = parts;
    const topPick = distinctPicks[0];

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
