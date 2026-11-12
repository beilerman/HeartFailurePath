/** Display/explanation builders: monitoring plan, qualitative projections, trade-offs, follow-up calendar. Moved verbatim from simulationService.ts (phase 4). */
import { assessCreatinineChange } from './renalChange';
import { Patient, Medication, ScoredRegimen, ExcludedMedication, SimulationOutput, RegimenMed, ModificationSet, MonitoringPlanItem, QualitativeProjection, TradeOffLabel, TradeOffTone, DomainScores, RankingInfo } from '../../types';
import { valueUnknown, hasUnknownHistoricalHFrEF, isIronDeficient, ivIronCreditTier } from '../clinicalPredicates';
import { DISEASE_MODIFYING_CLASSES, DIURETIC_CLASSES, RAAS_CLASSES } from './registry';
import { CREATININE_RISE_ACCEPTABLE_PCT, EGFR_FLOOR_FOR_CREATININE_RISE } from './thresholds';
import { hasRelevantIntensification } from './regimenUtils';
import { regimenSatisfiesPillar, classifyPhenotype } from './domains';
import { drugFacts } from './drugFacts';
import { SCORE_ADJUSTMENTS } from './scoreModel';

export function buildMonitoringPlan(
    currentPatient: Patient,
    projectedPatient: Patient,
    modificationSet: ModificationSet
): MonitoringPlanItem[] {
    const plan: MonitoringPlanItem[] = [];
    // The tool applies the change-from-baseline kidney rules only when the optional baseline creatinine is entered (renalChange.ts).
    const baselineNote = assessCreatinineChange(currentPatient) !== null
        ? 'The baseline creatinine is entered, so the tool applies these change-based rules (creatinine rise of 50% or more, or a derived eGFR fall over 30%: halve the RAAS inhibitor and MRA; rise over 100%, or 50% or more with eGFR below 20: stop them; see the KIDNEY FUNCTION alert).'
        : 'The tool has no baseline creatinine or eGFR, so it cannot apply these change-based rules: at eGFR below 20 on a RAAS inhibitor it raises an alert and leaves the stop decision to the clinician.';
    const hasRaasOrMraIntensification = hasRelevantIntensification(
        modificationSet,
        new Set([...RAAS_CLASSES, 'MRA', 'nsMRA'])
    );
    const hasDiureticIntensification = hasRelevantIntensification(modificationSet, DIURETIC_CLASSES);
    const higherRiskElectrolytes = currentPatient.egfr < 45 || currentPatient.potassium >= 5.0 || projectedPatient.potassium > 5.0;

    // Timings follow the sources (verified-clinical-decisions-2026-11-11.md rows 6a, 6b): MRA start or increase - potassium within 1 week (Aldactone and Inspra
    // labels; guideline text, secondary) and about 4 weeks (Kerendia label: 4 weeks; Inspra: 1 month; guideline text: ~1 week then 4 weeks); ACEi/ARB/ARNI start
    // or increase - urea/creatinine/potassium 1-2 weeks after (ESC-derived consensus, secondary). The 48-72 hour check for higher-risk patients is ENGINE POLICY.
    const hasMraIntensification = hasRelevantIntensification(modificationSet, new Set(['MRA', 'nsMRA']));
    const hasRaasIntensification = hasRelevantIntensification(modificationSet, RAAS_CLASSES);
    if (hasMraIntensification) {
        plan.push({
            test: 'BMP (potassium, creatinine, eGFR) after MRA start or increase',
            timing: 'Within 1 week, again at about 4 weeks, 1-2 weeks after the final titration, then every 4-6 months',
            details: 'Labels: potassium within 1 week of starting or titrating (spironolactone, eplerenone) and at 4 weeks to 1 month (finerenone, eplerenone). 2026 ESC Supplementary Tables S7/S8: halve the dose if potassium rises above 5.5 or eGFR falls by more than 30%; interrupt at potassium above 6.0 and seek specialist advice; withhold if eGFR falls below 20. After that, recheck every 4-6 months (ESC; the 2022 US guideline says about every 6 months, the shorter interval is used).'
        });
    }
    if (hasRaasIntensification) {
        plan.push({
            test: 'BMP (urea/creatinine, eGFR, potassium) after ACEi/ARB/ARNI start or increase',
            timing: '1-2 weeks after starting, 1-2 weeks after the final titration, then every 4-6 months',
            details: `European consensus guidance (secondary source). Potassium above 5.5: reduce one dose step; 6.0 or above: stop (2026 ESC section 6.1; the MRA is reduced first when both are on board). A creatinine rise under ${CREATININE_RISE_ACCEPTABLE_PCT}% above baseline is acceptable while eGFR stays above ${EGFR_FLOOR_FOR_CREATININE_RISE} (2026 ESC; the former 30% figure was engine policy). A small early eGFR dip after starting a RAAS inhibitor, MRA or SGLT2 inhibitor is expected and is not a reason to stop. 2026 ESC Supplementary Tables S4/S5: an eGFR fall under 30% is acceptable; a larger persisting change halves the dose and is rechecked in 1-2 weeks; stop the ACEi/ARB and seek specialist advice if creatinine rises more than 100% or eGFR falls below 20. ${baselineNote}`
        });
    }
    if (hasRaasOrMraIntensification && higherRiskElectrolytes) {
        plan.push({
            test: 'Early potassium check',
            timing: '48-72 hours',
            details: 'Engine policy for CKD and/or borderline potassium at baseline (no source gives this window).'
        });
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
            timing: '3-7 days after a diuretic start or increase, and again at 1-2 weeks (2026 ESC Supplementary Table S7)',
            details: 'Screen for pre-renal AKI, hypokalemia, and hyponatremia after dose escalation.'
        });
    }

    // Drug-data monitoring items (facts.monitoring_items), once per distinct item whenever the drug is in the regimen.
    modificationSet.resulting_regimen.forEach(r => {
        drugFacts(r.med).monitoring_items?.forEach(item => {
            if (item.when && !item.when(currentPatient)) return;
            if (plan.some(x => x.test === item.test)) return;
            plan.push({ test: item.test, timing: item.timing, details: item.details });
        });
    });

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
    return classifyPhenotype(patient) === 'HFpEF'
        ? ['SGLT2i', 'MRA']
        : ['RAAS Inhibitor', 'Beta Blocker', 'MRA', 'SGLT2i'];
}

// Indicated-but-missing GDMT classes relative to the CURRENT regimen.
export function computeGdmtGaps(patient: Patient): string[] {
    const currentRegimen = patient.current_regimen || [];
    return computePhenotypePillars(patient)
        .filter(p => !regimenSatisfiesPillar(currentRegimen, p, patient))
        .map(p => PILLAR_LABELS[p] || p);
}

/**
 * When rule E15 withheld a new MRA because potassium is 5.0 or higher, say so on the MRA GDMT gap (the gap list is built before
 * eligibility, from the current regimen alone). Decision 2026-11-11, verified-clinical-decisions-2026-11-11.md rows 1, 2a, 2c.
 */
export function annotateGdmtGapsWithMraPotassium(gaps: string[], excludedMeds: ExcludedMedication[]): string[] {
    const e15 = excludedMeds.find(m => m.rule_id === 'E15');
    if (!e15) return gaps;
    return gaps.map(g => g === PILLAR_LABELS['MRA'] ? `${g} — not started: ${e15.reason.charAt(0).toLowerCase()}${e15.reason.slice(1)}` : g);
}

/** Monitoring item added when rule E15 fired (a new MRA was withheld because potassium is 5.0 or higher). */
export const MRA_POTASSIUM_STAGED_MONITORING: MonitoringPlanItem = {
    test: 'Repeat potassium; start MRA once below 5.0',
    timing: 'Before any MRA start',
    details: 'A new MRA is withheld while potassium is 5.0 or higher (2022 US guideline 7.3.3: potassium 5.0 or above is a contraindication to MRA initiation; 2026 ESC guideline: caution at 5.0 or above; the labels allow exactly 5.0, the guideline boundary is the stricter). Recheck potassium and start the MRA once it is below 5.0. Whether potassium binders improve outcomes is uncertain in the 2022 US guideline; the 2026 ESC guideline makes no recommendation for them.',
};

/** When rule E18 withheld a new RAAS inhibitor because potassium is above 5.2, say so on the RAAS GDMT gap (same pattern as the MRA gap). */
export function annotateGdmtGapsWithRaasPotassium(gaps: string[], excludedMeds: ExcludedMedication[]): string[] {
    const e18 = excludedMeds.find(m => m.rule_id === 'E18');
    if (!e18) return gaps;
    return gaps.map(g => g === PILLAR_LABELS['RAAS Inhibitor'] ? `${g} — not started: ${e18.reason.charAt(0).toLowerCase()}${e18.reason.slice(1)}` : g);
}

/** Monitoring item added when rule E18 fired (a new RAAS inhibitor was withheld because potassium is above 5.2). */
export const RAAS_POTASSIUM_STAGED_MONITORING: MonitoringPlanItem = {
    test: 'Repeat potassium; start RAAS inhibitor if 5.2 or lower',
    timing: 'Before any RAAS inhibitor start',
    details: 'A new ACE inhibitor, ARB or ARNI is withheld while potassium is above 5.2 (2026 ESC Supplementary Tables S4/S5: caution and specialist advice above 5.2; the engine applies it as a staged start). First stop potassium supplements, potassium-sparing diuretics, NSAIDs and high-potassium salt substitutes, then recheck potassium and start once it is 5.2 or lower. Potassium binders carry a Class 2b recommendation in the 2022 US guideline for hyperkalaemia that develops while on a RAAS inhibitor; the 2026 ESC guideline makes no recommendation for them, so the tool does not start a RAAS inhibitor together with a binder.',
};

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
    // IV iron (ferric carboxymaltose) evidence population: say why iron is not added automatically, and what the dose needs.
    if (isIronDeficient(patient)) {
        if (patient.hemoglobin !== undefined && patient.hemoglobin >= 15) {
            notices.push('Iron deficiency present but hemoglobin is 15 g/dL or higher: ferric carboxymaltose is held (the label has no data in that range).');
        } else if (ivIronCreditTier(patient) === null) {
            notices.push('Iron deficiency present, but IV iron is not added automatically: the evidence is in HFrEF (LVEF below 50) with NYHA II-III and a TSAT below 20% identifies the patients most likely to benefit. A clinician may still choose it (the label HF indication, NYHA II/III, has no LVEF limit).');
        } else if (patient.hemoglobin === undefined) {
            notices.push('Hemoglobin not entered: the ferric carboxymaltose dose (label table by weight and hemoglobin) is shown for both hemoglobin bands. Enter hemoglobin to fix the dose.');
        }
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
        { test: 'Clinical review + BMP (K+, creatinine, eGFR) + BP/HR', timing: 'Day 7 (±2)', details: 'STRONG-HF model: assess tolerance and labs within ~1 week of any GDMT initiation or up-titration. Reduce one step if K+ is above 5.5 (stop at 6.0 or above) or if creatinine rises 50% or more above baseline (2026 ESC; the former 30% was engine policy).' },
        { test: 'BMP + BP/HR + congestion check; up-titrate if tolerated', timing: 'Week 2', details: 'Advance toward target doses if BP, HR, renal function and K+ permit; up-titrate every 1-2 weeks (2026 ESC Table 5), and not faster than every 2 weeks without close monitoring (Supplementary Tables S4-S6, S8). Reinforce daily-weight self-monitoring and adherence.' },
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

    // Not stated when NT-proBNP was not entered (a blank value projects to the model's floor and read as a "rise").
    if (!(baseline.nt_pro_bnp > 0)) { /* no line */ }
    else if (projected.nt_pro_bnp < baseline.nt_pro_bnp * 0.85) out.push({ label: 'Neurohormonal stress', direction: 'improve', detail: 'Natriuretic-peptide burden expected to fall.' });
    else if (projected.nt_pro_bnp > Math.max(baseline.nt_pro_bnp * 1.1, 60)) out.push({ label: 'Neurohormonal stress', direction: 'caution', detail: 'Natriuretic-peptide burden may rise — reassess.' });
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
        case 'Vasodilator': return 'Hydralazine + isosorbide dinitrate (H/ISDN) — A-HeFT: Class 1 add-on for self-identified Black patients with NYHA III–IV HFrEF who are on a RAAS inhibitor and a beta-blocker (or cannot take them), or (Class 2b) the alternative in HFrEF when RAAS inhibitors cannot be used (all contraindicated/intolerable).';
        case 'If Inhibitor': return 'Ivabradine — SHIFT: sinus rhythm, LVEF ≤ 35, HR ≥ 70 on maximally tolerated beta-blocker (or beta-blocker contraindicated); AHA/ACC 2022 Class 2a, ESC 2021 IIa.';
        case 'sGC Stimulator': return 'Vericiguat — VICTORIA: LVEF < 45 with a recent worsening event (HF hospitalization within 6 months or outpatient IV diuretics within 3 months) and NT-proBNP ≥ 1000 in sinus rhythm (≥ 1600 in atrial fibrillation); AHA/ACC 2022 Class 2b.';
        case 'Inotrope': return 'Digoxin — AF rate control, or symptomatic HFrEF (LVEF 40 or below, NYHA II-IV) persisting on optimized GDMT (2026 ESC Class IIa B1; AHA/ACC 2022 Class 2b). Narrow therapeutic index: target serum concentration below 1.2 ng/mL.';
        case 'GLP-1 RA':
        case 'GLP-1/GIP RA': return 'GLP-1 / GIP receptor agonist for symptoms in obesity (BMI ≥ 30) with HFpEF: semaglutide at LVEF ≥ 45 (STEP-HFpEF), tirzepatide at LVEF ≥ 50 (SUMMIT). No guideline recommendation; start at the lowest dose and titrate one step at a time.';
        case 'IV Iron': return 'IV iron (ferric carboxymaltose) — iron deficiency in symptomatic HFrEF (LVEF below 50), NYHA II-III (AHA/ACC 2022 Class 2a; CONFIRM-HF, AFFIRM-AHF, IRONMAN, HEART-FID): improves exercise capacity and symptoms; dose by weight and hemoglobin.';
        case 'nsMRA': return 'Finerenone (nsMRA) — FINEARTS-HF: LVEF 40 or higher (HFpEF and LVEF 41-49).';
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
    // The cost domain measures cost against the STATED BUDGET, so the label says so: "Low cost" described a $953/month regimen under a large budget (review 2026-11-12).
    const cost = band(domain.cost, 'Well within budget', 'Near the budget limit', 'Over budget / financial-toxicity risk');
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
        ranking?: RankingInfo;
    }
): SimulationOutput {
    const { excludedMeds, clinicalAlerts, gdmtGaps, eligibleAdjuncts, missingDataNotices, ranking } = parts;
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
        monitoringPlan: [
            ...(topPick.monitoring_plan || []),
            ...(excludedMeds.some(m => m.rule_id === 'E15') ? [MRA_POTASSIUM_STAGED_MONITORING] : []),
            ...(excludedMeds.some(m => m.rule_id === 'E18') ? [RAAS_POTASSIUM_STAGED_MONITORING] : []),
        ],
        gdmtGaps,
        eligibleAdjuncts,
        missingDataNotices,
        followUpCalendar: buildFollowUpCalendar(topPick.modification_set),
        ...(ranking ? { ranking } : {}),
    };
}
