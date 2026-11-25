import { buildTreatmentAssessment } from './treatmentAssessment';
/** Display/explanation builders: monitoring plan, qualitative projections, trade-offs, follow-up calendar. Moved verbatim from simulationService.ts (phase 4). */
import { withoutImplausibleValues } from './gates';
import { assessCreatinineChange } from './renalChange';
import { hasHistoricalHFrEF } from '../clinicalPredicates';
import { Patient, Medication, ScoredRegimen, ExcludedMedication, SimulationOutput, RegimenMed, ModificationSet, MonitoringPlanItem, QualitativeProjection, TradeOffLabel, TradeOffTone, DomainScores } from '../../types';
import { valueUnknown, hasUnknownHistoricalHFrEF, isIronDeficient, ivIronCreditTier } from '../clinicalPredicates';
import { DISEASE_MODIFYING_CLASSES, DIURETIC_CLASSES, RAAS_CLASSES, MRA_POOL_CLASSES, getMedicationClassGroup, isDiureticClass } from './registry';
import { CREATININE_RISE_ACCEPTABLE_PCT, EGFR_FLOOR_FOR_CREATININE_RISE, HYPOTENSION_SBP_BELOW, RAAS_START_K_CAUTION, MRA_START_K_CEILING } from './thresholds';
import { enteredValues, potassiumExposureContext, hypoxiaAlerts, LOOP_STEP_SENTENCE, takesRaasOrMra } from './urgentStates';
import { kUptitrationBlock, hasRelevantIntensification, hrContinuationAction, regimenDosesADay, fmtDosesADay, dedupeCurrentRegimen, loopDoseEffect, oralLoopFe } from './regimenUtils';
export { loopDoseEffect, oralLoopFe };
import { regimenSatisfiesPillar, classifyPhenotype } from './domains';
import { drugFacts } from './drugFacts';
import { smallestStepBelow } from './candidates';
import { SCORE_ADJUSTMENTS, sideEffectScore } from './scoreModel';
import { buildOutcomeEstimateViews } from './outcomeBenefit';
import { planCreditsFor } from './doseCredit';
import { symptomEstimateFor } from './symptomBenefit';
import { harmBurdenFor, HARM_TABLE } from './harmBurden';

/** Potassium 6.0 or above: the one statement the plan, the alerts and the draft note share (S3). */
export const URGENT_POTASSIUM_MONITORING: MonitoringPlanItem = {
    test: 'Repeat potassium urgently and obtain an ECG',
    timing: 'Now (same day)',
    details: 'Potassium is 6.0 mEq/L or higher. Confirm the value, record an ECG, and treat urgently (see the potassium emergency alert). Check kidney function and review potassium-raising drugs and supplements.',
};

/**
 * The monitoring item each urgent state carries WHETHER OR NOT an option is shown (T24): potassium 6.0 or above, systolic pressure below 90, a heart block without a
 * pacemaker, a heart rate below 50 with no rate-slowing drug, and oxygen saturation below 90. Read from the entered values only, so it also serves the limited review and the stop states.
 */
/** U11: the ECG for a slow heart rate: a rate below 50, or a rate-slowing drug reduced or withheld because of the rate. `drugs` names the reduced or withheld drugs, if any. */
const SLOW_RATE_BELOW = 50;
function slowRateEcgItem(pulse: number, drugs: string[]): MonitoringPlanItem {
    const why = [pulse > 0 && pulse < SLOW_RATE_BELOW ? `the resting heart rate is ${pulse} bpm, below ${SLOW_RATE_BELOW}` : '', drugs.length > 0 ? `${[...new Set(drugs)].sort().join(' and ')} is reduced or withheld because of the heart rate (resting rate ${pulse} bpm)` : ''].filter(Boolean).join('; and ');
    return { test: 'ECG for a slow heart rate', timing: 'At this visit', details: `Record an ECG: ${why}. Look for heart block or sinus node disease, and review every drug that slows the heart or the AV node.` };
}

export function urgentStateMonitoring(patient: Patient): MonitoringPlanItem[] {
    if (!patient || typeof patient !== 'object') return [];
    const p = withoutImplausibleValues(enteredValues(patient));
    const items: MonitoringPlanItem[] = [];
    if (p.pulse > 0 && p.pulse < SLOW_RATE_BELOW && p.rhythm !== '3rd Degree AV Block' && p.rhythm !== '2nd Degree AV Block') items.push(slowRateEcgItem(p.pulse, []));
    if (p.potassium >= 6.0) items.push(URGENT_POTASSIUM_MONITORING);
    // R8 X5b: potassium 5.5 to 5.9 with no renin-angiotensin drug or MRA (the caution asks for the value to be confirmed and the cause looked for): the plan says the same.
    if (p.potassium >= 5.5 && p.potassium < 6.0 && !takesRaasOrMra(p)) items.push({
        test: 'Repeat potassium and look for the cause',
        timing: 'Promptly',
        details: `Potassium is ${p.potassium.toFixed(1)} mEq/L and ${potassiumExposureContext(p)}. Confirm the value (a hemolyzed sample reads high) and look for the cause: potassium supplements or salt substitutes, potassium-sparing diuretics, NSAIDs, kidney function and acidosis.`,
    });
    // R8 X5c: a potassium below 3.5 carries its own row, with or without an option: correct it, find the cause, recheck it (the low potassium alert says the diuretic is withheld until then).
    if (p.potassium > 0 && p.potassium < 3.5) items.push({
        test: 'Correct potassium and recheck it',
        timing: 'Before any diuretic start or increase',
        details: `Potassium is ${p.potassium.toFixed(1)} mEq/L, below 3.5. Correct it, look for the cause (diuretic losses, low intake, vomiting or diarrhea, low magnesium) and recheck potassium; the tool withholds a new or higher diuretic dose until potassium is corrected and rechecked.`,
    });
    if (p.sbp > 0 && p.sbp < HYPOTENSION_SBP_BELOW) items.push({
        test: 'Recheck blood pressure and assess perfusion',
        timing: 'Now (same day)',
        details: `Systolic pressure is ${p.sbp} mmHg, below ${HYPOTENSION_SBP_BELOW}. Ask about dizziness, fainting, confusion and low urine output, examine for cool extremities, and review the blood-pressure-lowering drugs (see the low blood pressure alert).`,
    });
    if (p.rhythm === '3rd Degree AV Block') items.push({
        test: 'ECG and pacing evaluation',
        timing: 'Now (same day)',
        details: 'Third-degree AV block with no pacemaker recorded. Record a 12-lead ECG, arrange a pacing evaluation, and review every drug that slows the heart or the AV node (see the heart block alert).',
    });
    else if (p.rhythm === '2nd Degree AV Block') items.push({
        test: 'ECG and rhythm and pacing evaluation',
        timing: 'Promptly',
        details: 'Second-degree AV block with no pacemaker recorded. Review the ECG, arrange a rhythm and pacing evaluation, and review every drug that slows the heart or the AV node (see the heart block alert).',
    });
    if (hypoxiaAlerts(p).length > 0) items.push({
        test: 'Confirm oxygen saturation and assess oxygenation',
        timing: 'Now (same day)',
        details: `Recorded oxygen saturation is ${p.oxygen_saturation}%, below 90%. Confirm the measurement and assess for pulmonary edema (see the hypoxia alert).`,
    });
    return items;
}

/** Adds the items of `extra` whose test is not already in `plan` (the plan keeps its own order; urgent items come first). */
export function mergeUrgentMonitoring(plan: MonitoringPlanItem[], extra: MonitoringPlanItem[]): MonitoringPlanItem[] {
    const have = new Set(plan.map(x => x.test));
    return [...extra.filter(x => !have.has(x.test)), ...plan];
}

/**
 * R8 X5a / R9 Z4: the potassium row for potassium 5.0 to 5.9 on a RAAS inhibitor or MRA (the interval is the one the plan gives after a change to these drugs). Also read by the stop screens.
 * It says per drug what the tool does at this potassium, by each drug's own rule (`facts.k_uptitration_max`): an MRA is not raised until potassium is below 5.0, a RAAS inhibitor is not raised
 * while potassium is above 5.2. A drug the tool does not hold at this potassium is not named, so the row never forbids what an option on the same screen does.
 */
export const kRaiserRow = (patient: Patient, regimen: ReadonlyArray<RegimenMed>): MonitoringPlanItem => {
    const holds = [...regimen].sort((a, b) => (a.med.name < b.med.name ? -1 : 1)).filter(r => CHEMISTRY_CLASSES.has(r.med.drug_class)).filter(r => kUptitrationBlock(r.med, patient) !== null).map(r => {
        const rule = r.med.facts!.k_uptitration_max!;
        return `${r.med.name.replace(/\s*\(.*\)/, '')} until potassium is ${rule.below !== undefined ? `below ${rule.below.toFixed(1)}` : `${rule.above!.toFixed(1)} or lower`}`;
    });
    return {
        test: 'BMP (potassium, creatinine, eGFR) while potassium is 5.0 or higher on a RAAS inhibitor or MRA',
        timing: '1-2 weeks',
        details: `Potassium is 5.0 or higher and the patient takes a RAAS inhibitor or MRA. Recheck potassium and kidney function${holds.length ? `; do not raise the dose of ${holds.join(' or of ')}` : ''}.`,
    };
};
export const stopPathPotassiumMonitoring = (patient: Patient): MonitoringPlanItem[] => {
    const p = patient && typeof patient === 'object' ? withoutImplausibleValues(enteredValues(patient)) : undefined;
    return p && p.potassium >= 5.0 && p.potassium < 6.0 && takesRaasOrMra(p) ? [kRaiserRow(p, p.current_regimen)] : [];
};

const CHEMISTRY_CLASSES = new Set([...RAAS_CLASSES, 'MRA', 'nsMRA']);

export function buildMonitoringPlan(
    currentPatient: Patient,
    projectedPatient: Patient,
    modificationSet: ModificationSet
): MonitoringPlanItem[] {
    const plan: MonitoringPlanItem[] = [...urgentStateMonitoring(currentPatient)];
    // U11: a rate-slowing drug reduced or withheld because of a slow rate brings the ECG even when the rate is 50 or more (the label reduces carvedilol below 55).
    if (!plan.some(x => x.test === 'ECG for a slow heart rate')) {
        const reducedForRate = modificationSet.modifications.filter(m => (m.action === 'titrate_down' || m.action === 'remove') && m.source && hrContinuationAction(m.source.med, currentPatient)?.reduce).map(m => m.source!.med.name);
        if (reducedForRate.length > 0) plan.push(slowRateEcgItem(currentPatient.pulse, reducedForRate));
    }
    // The tool applies the change-from-baseline kidney rules only when the optional baseline creatinine is entered (renalChange.ts).
    const baselineNote = assessCreatinineChange(currentPatient) !== null
        ? 'The baseline creatinine is entered, so the tool applies these change-based rules (creatinine rise of 50% or more, or a derived eGFR fall over 30%: halve the RAAS inhibitor and MRA; rise over 100%, or 50% or more with eGFR below 20: stop them; see the kidney function alert).'
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
            details: `European consensus guidance (secondary source). Potassium above 5.5: reduce one dose step; 6.0 or above: stop (2026 ESC section 6.1; the MRA is reduced first when both are on board). A creatinine rise under ${CREATININE_RISE_ACCEPTABLE_PCT}% above baseline is acceptable while eGFR stays above ${EGFR_FLOOR_FOR_CREATININE_RISE} (2026 ESC; the former 30% figure was a rule set by this tool). A small early eGFR dip after starting a RAAS inhibitor, MRA or SGLT2 inhibitor is expected and is not a reason to stop. 2026 ESC Supplementary Tables S4/S5: an eGFR fall under 30% is acceptable; a larger persisting change halves the dose and is rechecked in 1-2 weeks; stop the ACEi/ARB and seek specialist advice if creatinine rises more than 100% or eGFR falls below 20. ${baselineNote}`
        });
    }
    if (hasRaasOrMraIntensification && higherRiskElectrolytes) {
        plan.push({
            test: 'Early potassium check',
            timing: '48-72 hours',
            details: 'A rule set by this tool for CKD and/or borderline potassium at baseline (no source gives this window).'
        });
    }

    const hasSglt2iIntensification = hasRelevantIntensification(modificationSet, new Set(['SGLT2i']));
    if (hasSglt2iIntensification) {
        plan.push({
            test: 'BMP (creatinine, eGFR)',
            timing: '2-4 weeks after SGLT2i initiation',
            details: 'An early hemodynamic eGFR change may occur after starting an SGLT2 inhibitor. Reassess measured renal function, volume and symptoms; do not automatically classify an individual decline as expected or reversible. Investigate substantial, progressive or symptomatic deterioration.'
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
        // A start-only note ("At initiation": a starting dose) belongs to an option that starts the drug, never to one that reduces or keeps it (S3).
        const startsDrug = modificationSet.modifications.some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.name === r.med.name);
        // A row about starting a drug ("after starting <drug>") belongs to an option that starts or raises it; for a drug already taken and left alone it is worded as ongoing monitoring, or left out (W7a).
        const startsOrRaises = startsDrug || modificationSet.modifications.some(m => m.action === 'titrate_up' && m.target?.med.name === r.med.name);
        drugFacts(r.med).monitoring_items?.forEach(raw => {
            if (/initiation/i.test(raw.timing) && !startsDrug) return;
            if (raw.when && !raw.when(currentPatient)) return;
            const item = raw.when_started && !startsOrRaises ? raw.ongoing : raw;
            if (!item) return;
            if (plan.some(x => x.test === item.test)) return;
            plan.push({ test: item.test, timing: item.timing, details: item.details });
        });
    });

    // Every option that changes a RAAS inhibitor, MRA or diuretic in ANY direction gets the chemistry recheck (S3). A reduction or withhold at potassium 5.5 to 5.9 states the
    // same 1-2 week interval as the potassium alert.
    const changed = modificationSet.modifications.filter(m => m.action !== 'keep');
    const touches = (classes: Set<string>) => changed.some(m => [m.source, m.target].some(x => x && classes.has(x.med.drug_class)));
    // The recheck is looked for by its own item (a test that starts "BMP (potassium..." or "BMP (urea/creatinine..." for a RAAS inhibitor or MRA, "BMP (electrolytes" for a diuretic), not by a
    // loose word match: an unrelated potassium or "Basic metabolic panel" note from another drug, or the urgent potassium item, used to count as the recheck and suppress it (T26).
    if (touches(CHEMISTRY_CLASSES) && !plan.some(x => /^BMP \((potassium|urea\/creatinine)/.test(x.test))) {
        plan.push({
            test: 'BMP (potassium, creatinine, eGFR) after a change to a RAAS inhibitor or MRA',
            timing: currentPatient.potassium >= 6.0 ? 'With the urgent repeat now, then within 1 week' : '1-2 weeks',
            // W4: "do not raise the dose again" is advice about a drug that stays; when every changed RAAS inhibitor or MRA is stopped there is no dose to raise.
            details: currentPatient.potassium >= 5.5
                ? 'Potassium and kidney function recheck at the interval the potassium alert states (1-2 weeks), earlier if symptoms or ECG changes.' + (modificationSet.resulting_regimen.some(r => CHEMISTRY_CLASSES.has(r.med.drug_class)) ? ' Do not raise the dose again until potassium is below 5.0.' : '')
                : 'Recheck potassium, creatinine and eGFR after any dose change, reduction or withhold of a RAAS inhibitor or MRA (a reduction can still change potassium and kidney function).',
        });
    }
    // R8 X5a: where the screen says to recheck potassium (the potassium hold alert at 5.0 to 5.4 on a RAAS inhibitor or MRA), the plan carries a potassium row even when the option changes neither drug.
    // The interval is the one the plan gives after a change to these drugs (1-2 weeks); no new number.
    if (currentPatient.potassium >= 5.0 && currentPatient.potassium < 6.0 && modificationSet.resulting_regimen.some(r => CHEMISTRY_CLASSES.has(r.med.drug_class)) && !plan.some(x => /^BMP \((potassium|urea\/creatinine)/.test(x.test))) {
        plan.push(kRaiserRow(currentPatient, modificationSet.resulting_regimen));
    }
    // R6 V8: an option that reduces or stops a loop diuretic is followed by weight and symptoms (fluid can return). The interval is the one this plan already gives after any diuretic change; no new number.
    // (A drug-level monitoring item cannot say this for a stopped drug: it is no longer in the resulting regimen.)
    // R7 W13f: the clean-up of a duplicate loop entry leaves the other loop at its dose, so it is not a reduction or a stop of the loop the patient takes and carries no such row.
    if (changed.some(m => (m.action === 'titrate_down' || m.action === 'remove') && m.source?.med.drug_class === 'Loop Diuretic' && !m.duplicate_cleanup)) {
        plan.push({
            test: 'Weight and symptoms after a loop diuretic reduction or stop',
            timing: '3-7 days after a diuretic change, and again at 1-2 weeks',
            details: 'Weigh daily and ask about breathlessness, orthopnea, swelling and reduced exercise tolerance: a lower dose or a stop can let fluid return. Restart or raise the diuretic if congestion returns.',
        });
    }
    if (touches(DIURETIC_CLASSES) && !plan.some(x => /^BMP \(electrolytes/.test(x.test))) {
        plan.push({
            test: 'BMP (electrolytes, creatinine) after a diuretic change',
            timing: '3-7 days after a diuretic change, and again at 1-2 weeks',
            details: 'Check electrolytes and kidney function after any diuretic increase, reduction or stop, and review weight and symptoms.',
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
            // "At initiation" only when the option starts, swaps in or raises one of these drugs (R5 Y10); otherwise the review is about the kidney function changing.
            const startsOrRaisesCautioned = modificationSet.modifications.some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && !!m.target && renalCautionMeds.includes(m.target.med.name));
            plan.push({
                test: 'Renal dosing review',
                timing: startsOrRaisesCautioned ? 'At initiation and after any eGFR change' : 'After any eGFR change',
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
    return annotateGdmtGapsWithFinerenone(computePhenotypePillars(patient)
        .filter(p => !regimenSatisfiesPillar(currentRegimen, p, patient))
        .map(p => PILLAR_LABELS[p] || p), patient);
}

/**
 * When rule E15 withheld a new MRA because potassium is 5.0 or higher, say so on the MRA GDMT gap (the gap list is built before
 * eligibility, from the current regimen alone). Decision 2026-11-11, verified-clinical-decisions-2026-11-11.md rows 1, 2a, 2c.
 */
export function annotateGdmtGapsWithMraPotassium(gaps: string[], excludedMeds: ExcludedMedication[]): string[] {
    const e15 = excludedMeds.find(m => m.rule_id === 'E15');
    if (!e15) return gaps;
    return gaps.map(g => (g === PILLAR_LABELS['MRA'] || g.startsWith(`${PILLAR_LABELS['MRA']} `)) ? `${g}${g === PILLAR_LABELS['MRA'] ? ' — ' : '; '}not started: ${e15.reason.charAt(0).toLowerCase()}${e15.reason.slice(1)}` : g);
}

/**
 * R8 X15f: a patient who takes finerenone but is listed as missing the MRA drug: the line says why (finerenone fills the MRA slot only at an ejection fraction of 41 or higher with no earlier
 * ejection fraction of 40 or lower, domains.ts nsMraFillsMraSlot).
 */
export function annotateGdmtGapsWithFinerenone(gaps: string[], patient: Patient): string[] {
    if (gaps.some(g => g.includes('is taken, but it fills the MRA slot'))) return gaps;
    const name = (patient.current_regimen ?? []).find(r => r.med.drug_class === 'nsMRA')?.med.name.replace(/\s*\(.*\)/, '');
    if (!name) return gaps;
    const label = PILLAR_LABELS['MRA'];
    return gaps.map(g => (g === label || g.startsWith(`${label} `)) ? `${g}${g.includes(' — ') ? '; ' : ' — '}${name.toLowerCase()} is taken, but it fills the MRA slot only at an ejection fraction of 41 or higher with no earlier ejection fraction of 40 or lower, and ${patient.lvef <= 40 ? 'the ejection fraction is 40 or lower' : hasHistoricalHFrEF(patient) ? 'an earlier ejection fraction of 40 or lower is recorded' : 'the earlier ejection fraction is not known, so the tool treats an earlier value of 40 or lower as possible until it is recorded'}` : g);
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
    details: 'A new ACE inhibitor, ARB or ARNI is withheld while potassium is above 5.2 (2026 ESC Supplementary Tables S4/S5: caution and specialist advice above 5.2; the tool applies it as a staged start). First stop potassium supplements, potassium-sparing diuretics, NSAIDs and high-potassium salt substitutes, then recheck potassium and start once it is 5.2 or lower. Potassium binders carry a Class 2b recommendation in the 2022 US guideline for hyperkalaemia that develops while on a RAAS inhibitor; the 2026 ESC guideline makes no recommendation for them, so the tool does not start a RAAS inhibitor together with a binder.',
};

/**
 * Staged monitoring for therapy deferred by rule E15 (new MRA) or E18 (new RAAS inhibitor); not specific to any one option. W4: a row advises starting only the drugs that rule alone is
 * holding (a drug excluded for another standing reason, such as the kidney limit of spironolactone, is never named), and each row names them.
 */
export function deferredTherapyMonitoring(excludedMeds: ExcludedMedication[], patient?: Patient): MonitoringPlanItem[] {
    const generic = (n: string) => n.replace(/\s*\(.*\)/, '');
    const taken = new Set((patient?.current_regimen ?? []).map(r => r.med.name));
    const takesMra = (patient?.current_regimen ?? []).some(r => MRA_POOL_CLASSES.has(r.med.drug_class));
    const named = (rule: string): string => [...new Set(excludedMeds.filter(m => m.rule_id === rule && !taken.has(m.name)).map(m => generic(m.name)))].sort().join(', ');
    // R8 X2: a drug the patient already takes is not "started": its row says not to raise it again until potassium is below 5.0, and no second drug of a class the patient takes is named.
    const e15Taken = [...new Set(excludedMeds.filter(m => m.rule_id === 'E15' && taken.has(m.name)).map(m => generic(m.name)))].sort().join(', ');
    const e15 = takesMra ? '' : named('E15'), e18 = named('E18');
    return [
        ...(e15 ? [{ ...MRA_POTASSIUM_STAGED_MONITORING, test: `Repeat potassium; start ${e15} once below 5.0`, details: MRA_POTASSIUM_STAGED_MONITORING.details.replace('A new MRA is withheld', `A new start of ${e15} is withheld`).replace('start the MRA once', 'start it once') }] : []),
        ...(e15Taken ? [{ test: `Repeat potassium; do not raise ${e15Taken} again until below 5.0`, timing: 'Before any MRA dose increase', details: `Potassium is 5.0 or higher and ${e15Taken} is reduced or withheld by the potassium rule. The dose is not raised again, and no other MRA is started, until potassium is below 5.0 (the labelled limit for raising an MRA). Recheck potassium. Whether potassium binders improve outcomes is uncertain in the 2022 US guideline; the 2026 ESC guideline makes no recommendation for them.` }] : []),
        ...(e18 ? [{ ...RAAS_POTASSIUM_STAGED_MONITORING, test: `Repeat potassium; start ${e18} if 5.2 or lower`, details: RAAS_POTASSIUM_STAGED_MONITORING.details.replace('A new ACE inhibitor, ARB or ARNI is withheld', `A new start of ${e18} is withheld`) }] : []),
    ];
}

export function buildMissingDataNotices(patient: Patient): string[] {
    const notices: string[] = [];
    if (patient.kccq_score === undefined) notices.push('KCCQ not measured — eligible medication decisions can still be reviewed. Functional scoring uses recorded NYHA/activity only; no KCCQ value or response is assumed.');
    if (valueUnknown(patient.bun)) notices.push('BUN not entered — the BUN/creatinine perfusion marker is unassessed, not normal.');
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
            notices.push('Hemoglobin not entered: a new ferric carboxymaltose dose is withheld because the label table depends on weight and hemoglobin. Obtain hemoglobin; a recorded existing course still needs prescribing review.');
        }
    }
    if (patient.daily_step_count === undefined) {
        notices.push(patient.kccq_score === undefined ? 'No activity / step data or KCCQ entered — functional scoring is based on recorded NYHA only.' : 'No activity / step data entered — functional status is based on NYHA and KCCQ only.');
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
        { test: 'Clinical review + relevant chemistry + BP/HR', timing: 'About 1 week; sooner if indicated', details: 'Review actual medication use, tolerance, volume and measured results. Apply drug-specific action thresholds. These are review prompts, not standing orders or an automatic dose schedule; urgent abnormalities need immediate clinical assessment.' },
        { test: 'BP/HR, congestion and laboratory review as indicated', timing: 'About 2 weeks', details: 'Assess readiness for the next decision. Confirm each medication-specific minimum time at dose, relevant repeat tests and tolerability before any increase; a follow-up visit alone does not authorize escalation.' },
        { test: 'Reassess remaining treatment gaps and tolerance', timing: 'About 4 weeks', details: 'Review the current measured state and appropriate drug-specific laboratory intervals. Continue, adjust or defer changes according to findings and the prescribing plan.' },
        { test: 'Review progress, residual gaps and referral needs', timing: 'About 6 weeks', details: 'Assess which indicated treatments are established and tolerated. Do not assume target doses or full treatment response have been reached; consider repeat biomarkers or other measurements when clinically indicated.' }

    ];
}

/** Compatibility helper: measurements alone cannot identify an individual treatment response. */
export function buildQualitativeProjections(_current: Patient, _projected: Patient, _hasMra: boolean): QualitativeProjection[] {
    return [{ label: 'Treatment response', direction: 'caution', detail: 'Individual response is not quantified. Use medication-specific considerations and measured reassessment.' }];
}

// Human label + evidence for a criteria-met adjunct, so guideline-indicated add-ons are surfaced
// even when they do not rank inside the top display picks (e.g. A-HeFT H/ISDN, SHIFT ivabradine).
export function describeAdjunct(m: Medication, patient?: Patient): string {
    switch (m.drug_class) {
        case 'Vasodilator': return 'Hydralazine + isosorbide dinitrate (H/ISDN) — A-HeFT: Class 1 add-on for self-identified Black patients with NYHA III to IV HFrEF who are on a RAAS inhibitor and a beta-blocker (or cannot take them), or (Class 2b) the alternative in HFrEF when RAAS inhibitors cannot be used (all contraindicated/intolerable).';
        case 'If Inhibitor': return 'Ivabradine — SHIFT: sinus rhythm, LVEF ≤ 35, HR ≥ 70 on maximally tolerated beta-blocker (or beta-blocker contraindicated); AHA/ACC 2022 Class 2a, ESC 2021 IIa.';
        case 'sGC Stimulator': return 'Vericiguat — VICTORIA: LVEF < 45 with a recent worsening event (HF hospitalization within 6 months or outpatient IV diuretics within 3 months) and NT-proBNP ≥ 1000 in sinus rhythm (≥ 1600 in atrial fibrillation); AHA/ACC 2022 Class 2b.';
        case 'Inotrope': {
            // The label says only what is true for this patient: "rate control" appears only when atrial fibrillation comes with a fast recorded rate (the engine's own
            // atrial-fibrillation alert uses a resting rate above 100); the symptomatic-HFrEF basis only when LVEF is 40 or below.
            const tail = ' Narrow therapeutic index: target serum concentration below 1.2 ng/mL.';
            const hfref = 'symptomatic HFrEF (LVEF 40 or below, NYHA II-IV) persisting on optimized GDMT (2026 ESC Class IIa B1; AHA/ACC 2022 Class 2b)';
            if (!patient) return `${m.name}: atrial fibrillation rate control, or ${hfref}.${tail}`;
            const af = patient.rhythm === 'AFib', fast = af && patient.pulse > 100, reduced = patient.lvef > 0 && patient.lvef <= 40 && patient.nyha_class !== 'I';
            const bases: string[] = [];
            if (fast) bases.push(`atrial fibrillation rate control (recorded heart rate ${patient.pulse} bpm)`);
            else if (af) bases.push(`atrial fibrillation with the beta-blocker optimized; this drug is a labeled rate-control option, but the recorded heart rate${patient.pulse > 0 ? ` (${patient.pulse} bpm)` : ''} shows no rate problem now`);
            if (reduced) bases.push(hfref);
            return `${m.name}: ${bases.length ? bases.join('; or ') : 'a weak-evidence add-on once the foundational drugs are used up'}.${tail}`;
        }
        case 'GLP-1 RA':
        case 'GLP-1/GIP RA': return `${m.name}: GLP-1 / GIP receptor agonist for symptoms in obesity (BMI ≥ 30) with HFpEF: semaglutide at LVEF ≥ 45 (STEP-HFpEF), tirzepatide at LVEF ≥ 50 (SUMMIT). No guideline recommendation; start at the lowest dose and titrate one step at a time.`;
        case 'IV Iron': return 'IV iron (ferric carboxymaltose) — iron deficiency in symptomatic HFrEF (LVEF below 50), NYHA II-III (AHA/ACC 2022 Class 2a; CONFIRM-HF, AFFIRM-AHF, IRONMAN, HEART-FID): improves exercise capacity and symptoms; dose by weight and hemoglobin.';
        case 'nsMRA': return 'Finerenone (nonsteroidal MRA) — FINEARTS-HF: LVEF 40 or higher (HFpEF and LVEF 41-49).';
        case 'MRA': return `${m.name} (mineralocorticoid receptor antagonist): adjunct per phenotype (TOPCAT in HFpEF).`;
        case 'Loop Diuretic':
            // W3: the short-course add-on is a different drug from the oral loop the patient takes, so the line names it (a price or a reason quoted below is about it, not about the class).
            if (drugFacts(m).short_course_addon) return `${m.name}: a short course beside the oral loop diuretic for congestion that persists; the label says it is not for chronic use.`;
            return `${m.name} (loop diuretic): symptomatic volume management; titrate to daily weights.`;
        case 'Thiazide-like Diuretic': return `${m.name} (thiazide-type add-on): sequential nephron blockade for diuretic resistance.`;
        default: return m.name;
    }
}

/** The eligible adjuncts as sentences, each with the class groups of the drugs it stands for, so a class that a displayed option starts can be taken off the list (W7b). */
export interface AdjunctEntry { label: string; groups: Set<string>; names: Set<string>; /** The line names one specific drug rather than a class (W3). */ specific: boolean }
export function buildEligibleAdjunctEntries(addableAdjuncts: RegimenMed[], patient?: Patient): AdjunctEntry[] {
    const out = new Map<string, AdjunctEntry>();
    addableAdjuncts.forEach(r => {
        const label = describeAdjunct(r.med, patient);
        if (!out.has(label)) out.set(label, { label, groups: new Set<string>(), names: new Set<string>(), specific: !!drugFacts(r.med).short_course_addon });
        out.get(label)!.groups.add(getMedicationClassGroup(r.med.drug_class));
        out.get(label)!.names.add(r.med.name);
    });
    return [...out.values()];
}

export function buildEligibleAdjuncts(addableAdjuncts: RegimenMed[], patient?: Patient): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    addableAdjuncts.forEach(r => {
        const label = describeAdjunct(r.med, patient);
        if (!seen.has(label)) { seen.add(label); out.push(label); }
    });
    return out;
}

export function buildTradeOffLabels(domain: DomainScores, regimen?: RegimenMed[], current?: RegimenMed[], money?: { cost: number; budget: number }): TradeOffLabel[] {
    const band = (s: number, good: string, mid: string, bad: string): { label: string; tone: TradeOffTone } =>
        s >= 80 ? { label: good, tone: 'good' } : s >= 50 ? { label: mid, tone: 'neutral' } : { label: bad, tone: 'bad' };
    // The cost domain measures cost against the STATED BUDGET, so the label says so: "Low cost" described a $953/month regimen under a large budget (review 2026-11-12).
    let cost = band(domain.cost, 'Well within budget', 'Near the budget limit', 'Over budget / financial-toxicity risk');
    // W1: the band of the cost SCORE can contradict the figures (a regimen 10 percent over the budget scores above 80 when cost sensitivity is low), so with the figures at hand the label states them.
    if (money && Number.isFinite(money.cost) && Number.isFinite(money.budget)) {
        const over = money.budget <= 0 ? money.cost > 0 : money.cost > money.budget;
        const figs = `$${Math.round(money.cost)} of $${Math.round(Math.max(0, money.budget))} a month`;
        cost = over ? { label: `Over budget (${figs})`, tone: 'bad' } : { label: `Within budget (${figs})`, tone: domain.cost >= 80 ? 'good' : 'neutral' };
    }
    const evidence = band(domain.guideline, 'Strong guideline concordance', 'Partial concordance', 'Limited concordance');
    // W1 (2026-11-21): the dosing-burden label is a comparison with what the patient takes now, from the same doses-a-day figures the "Why" sentences quote. It used to be a band of
    // the absolute score ("Lower dosing burden") and was printed beside options that raise the number of daily doses.
    let burden: { label: string; tone: TradeOffTone };
    if (regimen && current) {
        const now = regimenDosesADay(current), then = regimenDosesADay(regimen);
        const a = fmtDosesADay(then), b = fmtDosesADay(now);
        const moreDrugs = regimen.length > current.length;
        const tail = moreDrugs ? `, ${regimen.length - current.length === 1 ? 'one more drug' : `${regimen.length - current.length} more drugs`}` : '';
        burden = a === b ? { label: `Same doses a day as now (${a})${tail}`, tone: 'neutral' }
            : then < now ? { label: `Fewer doses a day than now (${a}, now ${b})${tail}`, tone: 'good' }
            : { label: `More doses a day than now (${a}, now ${b})${tail}`, tone: domain.adherence < 50 ? 'bad' : 'neutral' };
    } else burden = band(domain.adherence, 'Dosing burden score: low', 'Dosing burden score: moderate', 'Dosing burden score: high');
    return [
        { dimension: 'Cost', label: cost.label, tone: cost.tone },
        { dimension: 'Dosing burden', label: burden.label, tone: burden.tone },
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
        if (r.modification_set) r.monitoring_plan = buildMonitoringPlan(patient, r.projected_patient, r.modification_set);
        if (r.modification_set) r.treatment_assessment = buildTreatmentAssessment(patient, r.modification_set);
        r.outcome_estimates = buildOutcomeEstimateViews(r.regimen, patient, r.modification_set);
        r.symptom_estimate = symptomEstimateFor(r.regimen, patient, r.modification_set ? planCreditsFor(r.modification_set, patient).creditFn : undefined);
        { const hb = harmBurdenFor(HARM_TABLE, r.regimen, patient); r.harm_burden = { ...hb, score: sideEffectScore(hb.burden) }; }
        r.qualitative_projections = r.treatment_assessment?.considerations ?? [];
        r.trade_offs = buildTradeOffLabels(r.domain_scores, r.regimen, dedupeCurrentRegimen(patient.current_regimen).regimen, { cost: r.cost, budget: patient.max_affordable_cost });
        if (!Number.isFinite(r.cost) || !Number.isFinite(patient.max_affordable_cost)) {
            r.trade_offs = r.trade_offs.map(t => t.dimension === 'Cost' ? { dimension: 'Cost', label: 'Affordability not assessed', tone: 'neutral' } : t);
        }
    });

    // H2: Low-output state — still show recommendations but with mandatory warnings and capped scores.
    // NPs need guidance on current medication management, not a blank screen.
    let finalPicks = distinctPicks;
    if (lowOutput) {
        const lowOutputWarning =
            'LOW OUTPUT STATE: These options require hemodynamic stabilization first. ' +
            'Do not start new drugs until perfusion is restored; the exceptions the tool makes are a loop diuretic for recorded congestion and the replacement of a beta-blocker that must stop for a safety reason. ' +
            'If the patient is currently on a beta-blocker, do not stop it abruptly (Class III harm); reduce the dose if needed. ' +
            'Prioritize intravenous inotropes, hemodynamic monitoring and advanced heart failure consultation, then cautious oral guideline-directed therapy.';
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
            ...deferredTherapyMonitoring(excludedMeds, patient),
        ],
        gdmtGaps,
        eligibleAdjuncts,
        missingDataNotices,
        followUpCalendar: buildFollowUpCalendar(topPick.modification_set),
    };
}


/**
 * Alerts are raised before the options are built, and two of them say what "the plan" does to a named current drug (the heart-rate reduction and the pregnancy
 * beta-blocker switch). They are reconciled here against the options actually shown, so an alert never states an action the plan does not take: review 3
 * (2026-11-12) found "the plan reduces it one dose step; it is not removed" beside options that removed or replaced the drug, and "a switch is offered" beside
 * options that kept it. Pure text; changes no option.
 */
export function reconcilePlanAlerts(clinicalAlerts: string[], picks: ScoredRegimen[], patient: Patient): string[] {
    const modsOf = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
    const actsOn = (name: string): string[] => picks.map(r => modsOf(r).find(m => m.source?.med.name === name)?.action ?? 'keep');
    const actionsOn = (name: string): Set<string> => new Set(actsOn(name));
    const nameOfUpper = (upper: string): RegimenMed | undefined => (patient.current_regimen ?? []).find(r => r.med.name.toUpperCase() === upper);
    const loopEffect = (r: ScoredRegimen) => loopDoseEffect(patient, r);
    const reconciled = clinicalAlerts.map(alert => {
        if (alert.startsWith('LOOP DIURETIC OVER-TREATMENT') && alert.includes('Down-titrate to the lowest effective dose') && picks.length > 0) {
            // The alert is written before the options exist; the sentence is chosen from what EACH shown option does to the loop dose the patient takes (S13, W12c).
            const effects = picks.map(loopEffect);
            const n = effects.length;
            // R10 A9: "lowers its dose" is said only where the named drug's own dose is lowered; an option that only removes a duplicate loop lowers the total, not the named drug.
            const named = (patient.current_regimen ?? []).find(r => r.med.drug_class === 'Loop Diuretic' && alert.startsWith(`LOOP DIURETIC OVER-TREATMENT: Patient appears euvolemic on a high-dose loop diuretic (${r.med.name} `));
            const ownDoseLowered = (r: ScoredRegimen) => !named || modsOf(r).some(m => m.action === 'titrate_down' && m.source?.med.name === named.med.name);
            if (effects.every(e => e === 'lowers')) return alert;
            const sentence = effects.every(e => e === 'stops') ? (n === 1 ? 'The option shown stops the loop diuretic rather than lowering it; confirm it is not needed' : 'The options shown stop the loop diuretic rather than lower it; confirm it is not needed')
                : effects.every(e => e === 'unchanged') ? (n === 1 ? 'The option shown does not change the loop diuretic dose, so the high dose is not addressed; review whether it can be lowered' : 'No option shown changes the loop diuretic dose, so the high dose is not addressed; review whether it can be lowered')
                : effects.every(e => e === 'raises') ? (n === 1 ? 'The option shown raises the loop diuretic dose (the reason is in its drug note), so the high dose is not lowered; review whether it can be lowered instead' : 'The options shown raise the loop diuretic dose (the reason is in each option\'s drug note), so the high dose is not lowered; review whether it can be lowered instead')
                : `${effects.map((e, i) => `option ${i + 1} ${e === 'stops' ? 'stops the loop diuretic' : e === 'lowers' ? (ownDoseLowered(picks[i]!) ? 'lowers its dose' : 'lowers the total oral loop diuretic dose') : e === 'raises' ? 'raises its dose' : 'leaves its dose unchanged'}`).join(', ').replace(/^o/, 'O')}; where the dose is raised or left unchanged, review whether it can be lowered`;
            return alert.replace('Down-titrate to the lowest effective dose', sentence);
        }
        // W2 (kidney function alerts): "The tool removes them" and "Each is reduced one dose step" are said of the RAAS inhibitors and MRAs the patient takes; where an option stops one for another reason
        // (an allergy, a contraindication) or replaces it, the sentence says so.
        if (alert.startsWith('KIDNEY FUNCTION:') && picks.length > 0) {
            const onBoard = (patient.current_regimen ?? []).filter(r => RAAS_CLASSES.has(r.med.drug_class) || MRA_POOL_CLASSES.has(r.med.drug_class)).map(r => r.med.name);
            const actsAll = onBoard.flatMap(n => actsOn(n));
            const removesPhrase = 'The tool removes them from the plan and does not start a new one. ';
            if (alert.includes(removesPhrase) && actsAll.some(a => a !== 'remove')) return alert.replace(removesPhrase, 'Each option says on its change lines what it does with each of them, and none starts a new one. ');
            const reducePhrase = 'Each is reduced one dose step (';
            if (alert.includes(reducePhrase) && actsAll.some(a => a !== 'titrate_down' && a !== 'keep')) return alert.replace(reducePhrase, 'Each is reduced one dose step unless an option removes or replaces it for another reason stated on that option (');
        }
        // R8 X8c: the volume-depletion alert says diuretic reduction comes before adding new agents. Where an option adds, switches to or raises a non-diuretic drug, or does not reduce or stop a diuretic, the
        // sentence says what each option does instead of a priority that option does not follow.
        const PRIORITY = 'Diuretic reduction/discontinuation is the priority intervention before adding new agents.';
        if (alert.startsWith('VOLUME DEPLETION') && alert.includes(PRIORITY) && picks.length > 0) {
            const reducesDiuretic = (r: ScoredRegimen) => modsOf(r).some(m => (m.action === 'titrate_down' || m.action === 'remove') && !m.duplicate_cleanup && m.source && isDiureticClass(m.source.med.drug_class)) || ['lowers', 'stops'].includes(loopEffect(r)); // R10 A11a: Furoscix is a diuretic
            const addsAgent = (r: ScoredRegimen) => modsOf(r).filter(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target && !isDiureticClass(m.target.med.drug_class)).map(m => m.target!.med.name.replace(/\s*\(.*\)/, ''));
            if (picks.some(r => addsAgent(r).length > 0 || !reducesDiuretic(r))) {
                const per = picks.map((r, i) => { const a = [...new Set(addsAgent(r))]; return `option ${i + 1} ${reducesDiuretic(r) ? 'reduces or stops a diuretic' : 'does not reduce or stop a diuretic'}${a.length ? ` and adds or raises ${a.join(', ')}` : ''}`; });
                return alert.replace(PRIORITY, `Diuretic reduction or discontinuation is the priority intervention; what each option does: ${per.join('; ')}.`);
            }
        }
        // R8 X4: "every option includes a loop start or increase" is judged on the NET oral loop dose: a step that comes with the removal of a duplicate loop entry leaves the total unchanged.
        if (alert.includes(LOOP_STEP_SENTENCE) && picks.some(r => modsOf(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'Loop Diuretic' && !drugFacts(m.target.med).short_course_addon) && loopEffect(r) !== 'raises')) {
            return alert.replace(LOOP_STEP_SENTENCE, ' When the patient is congested and an oral loop diuretic start or increase is eligible, every option includes an oral loop diuretic step; where that step comes with the removal or lowering of another loop diuretic entry, the total loop dose is not raised and the option states the totals.');
        }
        // R8 X13: the severe-kidney alert is written before the options exist and says no loop dose increase is suggested because the patient is not congested; where an option does raise (or start)
        // a loop diuretic, the sentence says so and points at the option's own loop note, which gives the reason.
        if (alert.startsWith('SEVERE CKD DIURETIC ALERT') && alert.includes('so no dose increase is suggested') && picks.length > 0) {
            const raising = picks.map((r, i) => (loopEffect(r) === 'raises' || modsOf(r).some(m => m.action === 'add' && m.target?.med.drug_class === 'Loop Diuretic') ? i + 1 : 0)).filter(Boolean);
            if (raising.length > 0) {
                const which = raising.length === picks.length ? (picks.length === 1 ? 'The option shown raises' : 'Every option shown raises') : `Option${raising.length > 1 ? 's' : ''} ${raising.join(' and ')} ${raising.length > 1 ? 'raise' : 'raises'}`;
                return alert.replace('The patient is not congested, so no dose increase is suggested;', `No congestion is recorded, so the findings do not call for a dose increase, although ${which.charAt(0).toLowerCase()}${which.slice(1)} the loop diuretic (the drug note on ${raising.length > 1 ? 'each of them' : 'it'} gives the reason);`);
            }
        }
        // R9 Z7b: a potassium "reduce one dose step" alert is about a drug that an option may stop or replace for another reason (an allergy, an intolerance); where EVERY option does, it says so, as the hold alerts do.
        const reduce = /^POTASSIUM REDUCE ON ([^:]+): /.exec(alert);
        if (reduce && picks.length > 0) {
            const cur = nameOfUpper(reduce[1]);
            const phrase = 'reduce one dose step (withhold if already at the lowest dose)';
            if (cur && alert.includes(phrase) && actsOn(cur.med.name).every(a => a === 'remove' || a === 'swap')) return alert.replace(phrase, `${cur.med.name} is stopped or replaced in every option shown, for the reason stated on each option (${smallestStepBelow(cur, patient) === null ? 'at its lowest dose the potassium rule withholds it' : 'the potassium rule alone would reduce it one dose step'})`);
        }
        // W12a: a potassium hold says the drug stays at its dose; that is true only of an option that keeps it as it is.
        const hold = /^POTASSIUM HOLD ON ([^:]+): /.exec(alert);
        if (hold && picks.length > 0) {
            const cur = nameOfUpper(hold[1]);
            const phrase = cur ? `${cur.med.name} ${cur.dose.strength}${cur.dose.unit} stays at the current dose; recheck potassium before any increase` : '';
            if (cur && alert.includes(phrase)) {
                const acts = actsOn(cur.med.name);
                if (acts.every(a => a === 'keep')) return alert;
                const dose = `${cur.med.name} ${cur.dose.strength}${cur.dose.unit}`;
                const k = patient.potassium;
                const newStart = picks.some(r => modsOf(r).some(m => m.action === 'swap' && m.source?.med.name === cur.med.name && m.target
                    && ((RAAS_CLASSES.has(m.target.med.drug_class) && k > RAAS_START_K_CAUTION) || (MRA_POOL_CLASSES.has(m.target.med.drug_class) && k >= MRA_START_K_CEILING))));
                const replaced = acts.every(a => a === 'remove' || a === 'swap');
                const head = replaced ? `${dose} is stopped or replaced in every option shown, for the reason stated on each option; recheck potassium before any new start or increase`
                    : `${dose} is not raised in any option shown (what each option does with it, including a reduction or a stop for another reason, is on its change lines); recheck potassium before any increase`;
                const tail = newStart ? ` A renin-angiotensin drug or mineralocorticoid receptor antagonist started in its place is a new start at a potassium where the tool otherwise holds new starts: recheck potassium before and after it is started.` : '';
                const out = alert.replace(phrase, head);
                return tail ? out.replace(/ Basis: /, `${tail} Basis: `) : out;
            }
        }
        // W12: the potassium-emergency sentence says no option raises a drug; a potassium binder the patient already takes may be raised (S3).
        if (alert.includes('No option below starts or raises any drug:') && picks.some(r => modsOf(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'K+ Binder'))) {
            return alert.replace('No option below starts or raises any drug:', 'No option below starts or raises any drug except the potassium binder the patient already takes:');
        }
        // R10 A8: the poor-perfusion sentence names the same binder exception when an option raises a potassium binder the patient already takes.
        if (alert.startsWith('POOR PERFUSION') && alert.includes('in any option below, except ') && picks.some(r => modsOf(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'K+ Binder'))) {
            return alert.replace('in any option below, except ', 'in any option below, except the potassium binder the patient already takes, ');
        }
        const current = (patient.current_regimen ?? []).find(r => alert.startsWith(`BRADYCARDIA ON ${r.med.name.toUpperCase()}:`) || alert.startsWith(`PREGNANCY: ${r.med.name} is non-selective.`));
        if (!current || picks.length === 0) return alert;
        const acts = actionsOn(current.med.name);
        const all = (a: string) => acts.size === 1 && acts.has(a);
        if (alert.startsWith('BRADYCARDIA ON')) {
            const reduce = 'The plan reduces it one dose step; it is not removed. ';
            const withhold = 'The dose is already the lowest, so the plan withholds it (for a beta-blocker, taper over 1-2 weeks; do not stop abruptly). ';
            const stated = alert.includes(reduce) ? reduce : alert.includes(withhold) ? withhold : '';
            if (!stated) return alert;
            if ((stated === reduce && all('titrate_down')) || (stated === withhold && all('remove'))) return alert;
            const actual = all('swap') ? 'The options replace it with another agent for a separate reason stated on the option; the replacement dose is set one step lower for this heart rate. '
                : all('remove') ? 'The options stop it for a separate reason stated on the option (for a beta-blocker, taper over 1-2 weeks; do not stop abruptly). '
                : all('titrate_down') ? 'The options reduce it one dose step; it is not removed. '
                : all('keep') ? 'The options shown keep the dose unchanged: review the dose against this heart rate. '
                : 'What each option does with it (a reduction, a stop, a replacement or no change) is on its change lines; review the dose against this heart rate. ';
            return alert.replace(stated, actual);
        }
        const offered = '; a switch is offered.';
        if (alert.includes(offered) && !all('swap')) {
            return alert.replace(offered, acts.has('swap') ? '; a switch is offered in some options.' : '; no switch could be offered for this patient today (a new beta-blocker cannot be started in the current state: see the withheld drugs and other alerts), so the current agent is kept until it can be.');
        }
        return alert;
    });
    // W12a: a forced replacement of a renin-angiotensin drug or MRA the patient takes (allergy, angioedema history, intolerance, a duplicate) by a NEW one, at a potassium where the tool otherwise
    // holds new starts, is said plainly when no potassium hold alert for that drug already says it. (The forced-switch behaviour itself is unchanged.)
    const k = patient.potassium;
    const forced = new Map<string, Set<string>>();
    picks.forEach(r => modsOf(r).forEach(m => {
        if (m.action !== 'swap' || !m.mandatory || !m.source || !m.target) return;
        const t = m.target.med.drug_class;
        if ((RAAS_CLASSES.has(t) && k > RAAS_START_K_CAUTION) || (MRA_POOL_CLASSES.has(t) && k >= MRA_START_K_CEILING)) forced.set(m.source.med.name, (forced.get(m.source.med.name) ?? new Set()).add(m.target.med.name));
    }));
    const extra = [...forced.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).filter(([name]) => !reconciled.some(a => a.startsWith(`POTASSIUM HOLD ON ${name.toUpperCase()}:`)))
        .map(([name, targets]) => `REPLACEMENT AT HIGH POTASSIUM: ${name} must be replaced for the reason stated on the option, and where an option replaces it with ${[...targets].sort().join(' or ')} the replacement is a new start at a potassium (${k.toFixed(1)} mEq/L) where the tool otherwise holds new starts: recheck potassium before and after it is started.`);
    return [...reconciled, ...extra];
}
