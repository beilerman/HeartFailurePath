/**
 * Urgent-state alerts that depend only on values the clinician ENTERED. One definition each, called by the full path (gates.ts) and by the limited-information
 * review (decisionReadiness.ts), so a missing value may narrow what is offered but never hides an alert that the entered values justify (readiness T16).
 * The predicates these call ignore a value that is not entered (0, blank or NaN is "not measured", never a measurement).
 */
import { Patient } from '../../types';
import { isExamFinding, isAcutelyDecompensated, meetsDecompensationFindings, DECOMPENSATION_EXCESS_KG_ABOVE, DECOMPENSATION_MIN_CONGESTION_FINDINGS, congestionFindingCount, weightAboveDryKg, pulsePressureMmHg, kgText } from '../clinicalPredicates';
import { isColdState, isLowOutputState, scaleAndExamDisagree, hasCongestion, hasHypoperfusion, dedupeCurrentRegimen, congestionWithoutWeightGain, perfusionMarkersAboveEfLimit } from './regimenUtils';
import { isActiveExposure } from './medicationExposure';
import { LOW_OUTPUT, CONGESTION_EXCESS_KG_ABOVE, HYPOTENSION_SBP_BELOW } from './thresholds';
import { SCOPE_HEAD } from './scopeGate';
import { RAAS_CLASSES, MRA_POOL_CLASSES } from './registry';
import { MEDICATION_FORMULARY } from '../../constants';
import { expandAllergies } from './allergy';

const blankToZero = (v: number | undefined | null): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** The patient with every blank numeric field read as 0 (the engine's one "not entered" sentinel), so the predicates below can be asked of an unaudited patient. */
export function enteredValues(p: Patient): Patient {
    const vs = p.volume_status ?? { dry_weight_kg: 0, current_weight_kg: 0, exam_findings: new Set<string>() };
    // The regimen the full path reads: a drug entered twice resolved to one entry, and only the drugs actually taken (a held or completed course is not active therapy).
    const regimen = Array.isArray(p.current_regimen) ? dedupeCurrentRegimen(p.current_regimen.filter(r => r && r.med)).regimen.filter(isActiveExposure) : [];
    return {
        ...p, comorbidities: p.comorbidities instanceof Set ? p.comorbidities : new Set<string>(),
        sbp: blankToZero(p.sbp), dbp: blankToZero(p.dbp), pulse: blankToZero(p.pulse), potassium: Math.round(blankToZero(p.potassium) * 10) / 10,
        lvef: blankToZero(p.lvef), bun: blankToZero(p.bun), creatinine: blankToZero(p.creatinine), egfr: blankToZero(p.egfr),
        current_regimen: regimen, external_medications: p.external_medications instanceof Set ? p.external_medications : new Set<string>(),
        volume_status: { ...vs, dry_weight_kg: blankToZero(vs.dry_weight_kg), current_weight_kg: blankToZero(vs.current_weight_kg), exam_findings: new Set(vs.exam_findings instanceof Set ? [...vs.exam_findings].filter(isExamFinding) : []) },
    } as Patient;
}

// ---- The words that refer to the options that follow the alert. They are written before the options exist; settleOptionReferences() rewrites them when none is shown.
const WITH_OPTIONS = {
    perfusion: 'No drug is started and no dose is raised in any option below, except a loop diuretic when the patient is congested. An option may still lower or stop a drug, including a loop diuretic. Oral heart failure drugs wait until perfusion is restored.',
    decompensation: 'The options below apply only if the patient is judged well enough to stay an outpatient.',
    potassium: 'No option below starts or raises any drug: they contain only the reductions and withholds that lower potassium.',
} as const;
const WITHOUT_OPTIONS: Record<keyof typeof WITH_OPTIONS, string> = {
    perfusion: 'No drug should be started and no dose raised today, except a diuretic when the patient is congested. Oral heart failure drugs wait until perfusion is restored.',
    decompensation: 'No medication option is shown for this patient today.',
    potassium: 'No drug should be started or raised today: only reductions and withholds that lower potassium, and treatment of the potassium itself, are appropriate.',
};
export const OPTION_PHRASES = WITH_OPTIONS;
/** The decompensation alert's sentence about the options' loop diuretic step: true only where options exist (W4). */
export const LOOP_STEP_SENTENCE = ' When the patient is congested and an oral loop diuretic start or increase is eligible, every option includes one.';
/** The poor-perfusion sentence when an option holds the one start the rule allows: a beta-blocker that must stop for a safety reason is replaced, not stopped (T28). */
const PERFUSION_WITH_BB_EXCEPTION = 'No drug is started and no dose is raised in any option below, except a loop diuretic when the patient is congested and the replacement of a beta-blocker that must stop for a safety reason (it lands on the new drug\'s lowest starting dose and is stated on that option). An option may still lower or stop a drug, including a loop diuretic. Oral heart failure drugs wait until perfusion is restored.';
export const withPerfusionException = (alerts: string[]): string[] => alerts.map(a => (a.startsWith('POOR PERFUSION') ? a.split(WITH_OPTIONS.perfusion).join(PERFUSION_WITH_BB_EXCEPTION) : a));
/** Rewrites every sentence that points at "the options below" when no option is shown. Alerts without such a sentence are unchanged. */
export function settleOptionReferences(alerts: string[], optionsShown: boolean): string[] {
    if (optionsShown) return alerts;
    return alerts.map(a => (Object.keys(WITH_OPTIONS) as (keyof typeof WITH_OPTIONS)[]).reduce((t, k) => t.split(WITH_OPTIONS[k]).join(WITHOUT_OPTIONS[k]), a).split(LOOP_STEP_SENTENCE).join(''));
}

/**
 * Alert order (T18): emergencies and stop states first (the potassium emergency before "potassium stop on <drug>"), then every other urgent alert, then routine prompts. Stable within a
 * tier, so the order inside each tier is the order the rules raised them. `routineHeads` is the list of advisory headers the screen already uses (whyFirst.ADVISORY_ALERT_HEADS).
 */
const EMERGENCY_HEADS: readonly string[] = [SCOPE_HEAD, 'POOR PERFUSION', 'ACUTE DECOMPENSATION', 'THIRD-DEGREE AV BLOCK', 'HEMODYNAMIC INSTABILITY', 'HYPERKALEMIC EMERGENCY', 'HYPOXIA ALERT', 'IMPLAUSIBLE VALUE', 'INPUT ERROR'];
export function orderAlerts(alerts: string[], routineHeads: readonly string[]): string[] {
    const tier = (a: string) => { const sep = a.indexOf(': '); const head = sep > 0 ? a.slice(0, sep) : ''; return EMERGENCY_HEADS.includes(head) ? 0 : routineHeads.includes(head) ? 2 : 1; };
    return alerts.map((a, i) => ({ a, i, t: tier(a) })).sort((x, y) => x.t - y.t || x.i - y.i).map(x => x.a);
}

/**
 * Urgent alerts for the unstable states (S1). Returned first so they lead the alert list and the draft note.
 *  - Cold (poor perfusion with decompensation, or the low-output state): no option starts a drug or raises a dose (a diuretic is the one exception, when congested).
 *  - Acute decompensation (the engine's own predicate, isAcutelyDecompensated): same-day evaluation, intravenous diuresis or admission may be needed.
 */
export function unstableStateAlerts(patient: Patient): string[] {
    const alerts: string[] = [];
    const decompensated = isAcutelyDecompensated(patient);
    if (isColdState(patient)) {
        const signs: string[] = [];
        if (patient.volume_status.exam_findings.has('Cool Extremities')) signs.push('cool extremities');
        if (patient.dbp > 0 && patient.sbp > patient.dbp && pulsePressureMmHg(patient) <= LOW_OUTPUT.pulsePressureMax) signs.push(`a narrow pulse pressure (${pulsePressureMmHg(patient)} mmHg)`);
        // R8 X15a: every finding that makes the state cold is named (hasHypoperfusion also reads a systolic pressure below the hypotension limit); the list is never empty.
        if (patient.sbp > 0 && patient.sbp < HYPOTENSION_SBP_BELOW) signs.push(`a systolic pressure of ${patient.sbp} mmHg (below ${HYPOTENSION_SBP_BELOW})`);
        if (isLowOutputState(patient) && signs.length === 0) signs.push('a low output pattern (LVEF below 20 with a high urea to creatinine ratio)');
        if (signs.length === 0) signs.push('the findings recorded');
        alerts.push(
            `POOR PERFUSION: the patient shows signs of poor perfusion (${signs.join(', ')})${decompensated ? ' together with acute decompensation' : ''}. ` +
            'This patient may need same-day evaluation, intravenous therapy and admission. ' + WITH_OPTIONS.perfusion
        );
    }
    // The same-day alert needs evidence beside the symptom class (T5): weight above dry weight by the engine's congestion criterion, a congestion finding, or a sign of poor
    // perfusion. NYHA class IV alone is a symptom report; it keeps the engine's decompensation rules (no beta-blocker start, no ivabradine) but not this alert.
    const evidence = hasCongestion(patient) || hasHypoperfusion(patient);
    if (decompensated && !evidence) {
        const noBbStart = patient.lvef > 0 && patient.lvef < 50 && !(patient.current_regimen ?? []).some(r => r.med.drug_class === 'Beta Blocker');
        alerts.push(
            `SYMPTOMS AT REST WITHOUT RECORDED CONGESTION: the patient is in NYHA class IV (symptoms at rest), but no weight more than ${CONGESTION_EXCESS_KG_ABOVE} kg above the dry weight, no congestion finding and no sign of poor perfusion is recorded. Consider an advanced heart failure evaluation and review the symptoms (other causes, a stale dry weight, an unrecorded finding). ` +
            (noBbStart ? 'No beta-blocker is started today: 2022 AHA/ACC/HFSA says not to start one during decompensation, and 2026 ESC Supplementary Table S6 advises specialist advice in NYHA class IV and euvolemia first; start at a low dose once the patient is stable. ' : '') +
            'The tool still treats NYHA class IV as decompensation for the beta-blocker and ivabradine rules.'
        );
    }
    if (decompensated && evidence) {
        alerts.push(
            'ACUTE DECOMPENSATION: this patient may need same-day evaluation, intravenous diuresis or admission (the tool reads NYHA class IV, or NYHA class III with more than 2 kg above dry weight and at least two congestion findings, as acute decompensation). ' +
            WITH_OPTIONS.decompensation + LOOP_STEP_SENTENCE
        );
    }
    return alerts;
}

/**
 * The entered NYHA class (I or II) against weight and examination that meet the engine's own decompensation criteria (U9). A prompt only: it asks the clinician to confirm the class and
 * changes no option; the decompensation rules keep reading the entered class.
 */
export function classFindingsDisagreeAlerts(patient: Patient): string[] {
    if ((patient.nyha_class !== 'I' && patient.nyha_class !== 'II') || !meetsDecompensationFindings(patient)) return [];
    const excess = weightAboveDryKg(patient);
    const found = [...patient.volume_status.exam_findings].filter(f => f !== 'Cool Extremities').sort();
    return [`NYHA CLASS AND FINDINGS DISAGREE: the entered class is NYHA ${patient.nyha_class}, but the weight is ${kgText(excess)} kg above the dry weight (the tool's criterion for acute decompensation is more than ${DECOMPENSATION_EXCESS_KG_ABOVE} kg) and the examination shows congestion (${found.join(', ')}). Confirm the NYHA class. No option is changed by this prompt: the tool reads the class as entered.`];
}

/** Recorded oxygen saturation below 90% (the engine's existing threshold, also used by the volume score and the monitoring row): one builder for the full path and every stop path (W1). */
export const HYPOXIA_SPO2_BELOW = 90;
export function hypoxiaAlerts(p: { oxygen_saturation?: unknown }): string[] {
    const v = p.oxygen_saturation;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < HYPOXIA_SPO2_BELOW
        ? [`HYPOXIA ALERT: Recorded SpO2 ${v}% is below ${HYPOXIA_SPO2_BELOW}%. Confirm the measurement and promptly assess oxygenation and possible pulmonary edema; do not wait for the rest of this form.`] : [];
}

/** Low measured potassium: one builder for the full path and every stop path (W3). */
/**
 * R8 X5b: a potassium of 5.5 to 5.9 when the patient takes no renin-angiotensin drug and no MRA. The per-option hyperkalemia warning is shown only on an option that holds such a drug, so nothing else on the
 * screen reacts to this value; the caution asks for the value to be confirmed and the cause looked for. Alert only: no option changes.
 */
export const takesRaasOrMra = (patient: Patient): boolean => (patient.current_regimen ?? []).some(r => RAAS_CLASSES.has(r.med.drug_class) || MRA_POOL_CLASSES.has(r.med.drug_class));
export const potassiumExposureContext = (p: Patient): string => p.medication_list_incomplete
    ? 'the current medication list needs reconciliation' : 'the patient takes no renin-angiotensin drug or MRA';
export function elevatedPotassiumNoRaiserAlerts(patient: Patient): string[] {
    const k = Math.round(blankToZero(patient.potassium) * 10) / 10;
    if (!(k >= 5.5 && k < 6.0)) return [];
    if (takesRaasOrMra(patient)) return [];
    return [`ELEVATED POTASSIUM: potassium is ${k.toFixed(1)} mEq/L and ${potassiumExposureContext(patient)}. Confirm the value (a hemolyzed sample reads high) and look for the cause: potassium supplements or salt substitutes, potassium-sparing diuretics, NSAIDs, kidney function and acidosis. Recheck potassium.`];
}

/**
 * R10 A10: potassium 5.5 to 5.9 when the patient takes a renin-angiotensin drug or MRA and no alert already names the value (each per-drug potassium alert is skipped for a drug that every option
 * removes for another reason, and a no-option screen raises none). Says only what is always true; the alert changes no option.
 */
export function elevatedPotassiumOnRaiserAlerts(patient: Patient, existing: readonly string[]): string[] {
    const k = Math.round(blankToZero(patient.potassium) * 10) / 10;
    if (!(k >= 5.5 && k < 6.0) || !takesRaasOrMra(patient)) return [];
    if (existing.some(a => /potassium/i.test(a) && a.includes(k.toFixed(1)))) return [];
    const drugs = (patient.current_regimen ?? []).filter(r => RAAS_CLASSES.has(r.med.drug_class) || MRA_POOL_CLASSES.has(r.med.drug_class)).map(r => r.med.name).sort();
    return [`ELEVATED POTASSIUM: potassium is ${k.toFixed(1)} mEq/L and the patient takes ${drugs.join(', ')}, which raise${drugs.length === 1 ? 's' : ''} potassium. Confirm the value (a hemolyzed sample reads high), look for other causes (potassium supplements or salt substitutes, potassium-sparing diuretics, NSAIDs, kidney function, acidosis) and recheck potassium.`];
}

export function lowPotassiumAlerts(patient: Patient): string[] {
    // R13 E2-4: potassium is read to ONE decimal everywhere (auditInputs, the neighbouring alerts): 3.46 is 3.5 and raises no low-potassium alert, as every rule that holds a diuretic reads it.
    const k = Math.round(blankToZero(patient.potassium) * 10) / 10;
    return k > 0 && k < 3.5
        ? ['LOW POTASSIUM: New or intensified potassium-lowering diuretics are withheld until potassium is corrected and rechecked. A potassium-raising drug is not assumed to cancel this risk.'] : [];
}

/** The drugs that slow the heart or conduction through the AV node that the patient takes: heart failure drugs from the regimen, other medicines from the other-medication list (T4). Each list is sorted. */
export function rateSlowingDrugNames(patient: Patient): { hf: string[]; other: string[] } {
    const hf = (patient.current_regimen ?? []).filter(r => ['Beta Blocker', 'Inotrope', 'If Inhibitor'].includes(r.med.drug_class)).map(r => r.med.name).sort();
    const other = ['Amiodarone', 'Diltiazem', 'Verapamil'].filter(n => patient.external_medications?.has(n)).sort();
    return { hf, other };
}
const UNREADABLE_LIST_REVIEW = 'the medication list could not be fully read: reconcile it for rate-slowing drugs';
/** R12 D3: the rate-slowing drugs recorded as held, completed or of uncertain use, each in the words the AV-block alert uses; the slow-rate alert reads the same list. */
const rateSlowingNotTaken = (patient: Patient): string[] =>
    (patient.recorded_medication_exposures ?? patient.current_regimen ?? []).filter(r => ['Beta Blocker', 'Inotrope', 'If Inhibitor'].includes(r.med.drug_class) && !isActiveExposure(r))
        .sort((a, b) => (a.med.name < b.med.name ? -1 : 1)).map(r => `${r.med.name} is recorded as ${r.exposure!.status}: confirm it is not being taken`);
const rateSlowingReview = (patient: Patient): string => {
    // R11 B5: every record of a rate-slowing drug is read, not only the active ones: a drug recorded as held or completed is to be confirmed as not taken, a drug whose use is uncertain is marked, and an
    // unreadable medication list is said so. "None recorded here" is said only when nothing of the kind is recorded.
    const recorded = (patient.recorded_medication_exposures ?? patient.current_regimen ?? []).filter(r => ['Beta Blocker', 'Inotrope', 'If Inhibitor'].includes(r.med.drug_class));
    const taken = recorded.filter(isActiveExposure).map(r => `${r.med.name}${r.exposure?.status === 'unknown' || (r.exposure && r.exposure.adherence !== 'consistent') ? ' (use not confirmed)' : ''}`).sort();
    const notTaken = rateSlowingNotTaken(patient);
    const other = ['Amiodarone', 'Diltiazem', 'Verapamil'].filter(n => patient.external_medications?.has(n)).sort();
    const named = [taken.length ? `heart failure drugs: ${taken.join(', ')}` : '', other.length ? `other: ${other.join(', ')}` : '', ...notTaken, patient.medication_list_incomplete ? UNREADABLE_LIST_REVIEW : ''].filter(Boolean);
    return `Review now every drug that slows the heart or conduction through the AV node (${named.length ? `${named.join('; ')}; ` : 'none recorded here; '}also any not recorded here).`;
};

/** Third- and second-degree AV block without a pacemaker (S4, T4). */
export function conductionAlerts(patient: Patient): string[] {
    if (patient.rhythm === '3rd Degree AV Block') {
        return [`THIRD-DEGREE AV BLOCK: the recorded rhythm is third-degree (complete) AV block and no pacemaker is recorded. This needs urgent evaluation, and a pacing evaluation comes first. No medication option is proposed until the rhythm is managed. ${rateSlowingReview(patient)}`];
    }
    if (patient.rhythm === '2nd Degree AV Block') {
        return [`SECOND-DEGREE AV BLOCK: the recorded rhythm is second-degree AV block and no pacemaker is recorded. Review the ECG promptly and arrange a rhythm and pacing evaluation. Drugs that slow conduction (beta-blockers, ivabradine, digoxin) stay excluded. ${rateSlowingReview(patient)}`];
    }
    return [];
}

/** A slow resting rate with no rate-slowing drug on board needs its own prompt (conduction disease, other causes), not a stray warning on every option (S13). */
export function slowHeartRateAlerts(patient: Patient): string[] {
    if (patient.pulse > 0 && patient.pulse < 50 && patient.rhythm !== 'Paced') {
        const { hf, other } = rateSlowingDrugNames(patient);
        if (hf.length) return [];
        // R12 D3: a rate-slowing drug recorded as held, completed or uncertain is said in the AV-block alert's words, so the two alerts never disagree; "is taken" only when none is recorded at all.
        const notTaken = rateSlowingNotTaken(patient);
        const context = other.length ? `Review the recorded rate-slowing medication: ${other.join(', ')}.` : notTaken.length ? '' : patient.medication_list_incomplete ? 'Reconcile the medication list for drugs that slow the heart rate.' : '';
        const lead = notTaken.length && !other.length ? ` and no rate-slowing drug is recorded as taken (${[...notTaken, ...(patient.medication_list_incomplete ? [UNREADABLE_LIST_REVIEW] : [])].join('; ')}).` : context ? `. ${context}` : ' and no rate-slowing drug is taken.';
        return [`SLOW HEART RATE: the resting heart rate is ${patient.pulse} bpm${lead} Obtain an ECG to look for heart block or sinus node disease and review other causes (thyroid, medicines outside this tool). The tool does not start a beta-blocker or ivabradine at this rate.`];
    }
    return [];
}

/** The scale reads below the dry weight but the examination shows congestion: the two disagree (S2). Not volume depletion. */
export function scaleDisagreementAlerts(patient: Patient): string[] {
    if (!scaleAndExamDisagree(patient)) return [];
    const balance = weightAboveDryKg(patient);
    const found = [...patient.volume_status.exam_findings].filter(f => f !== 'Cool Extremities').sort().join(', ');
    return [
        `SCALE AND EXAMINATION DISAGREE: the weight is ${kgText(balance)} kg below the recorded dry weight, but the examination shows congestion (${found}). ` +
        'The recorded dry weight may be out of date, or the scale reading may be wrong. Reassess volume at the bedside and update the dry weight. The tool does not treat this as volume depletion: it does not propose reducing or stopping the diuretic as a volume step.',
    ];
}

/**
 * Congestion on examination without a weight gain (R5 Y3): the examination shows at least as many congestion findings as the engine counts for decompensation, but the weight is not more
 * than the congestion threshold above the recorded dry weight, and no loop diuretic is taken. Never raised with the scale-disagreement alert (that one needs the weight below the dry weight).
 */
/**
 * The statement "a new loop diuretic is started only when the weight is more than ... above dry weight" says the WEIGHT is why none is offered. It is not made when every oral loop diuretic is excluded
 * for another reason (anuria or another contraindication, an allergy to all of them) or potassium is below 3.5 (the hold).
 */
export function loopsExcludedForAnotherReason(patient: Patient): boolean {
    const allergic = expandAllergies(patient.allergies instanceof Set ? patient.allergies : new Set<string>(), MEDICATION_FORMULARY).expanded;
    const oralLoops = MEDICATION_FORMULARY.filter(m => m.drug_class === 'Loop Diuretic' && !m.facts?.short_course_addon);
    return oralLoops.every(m => allergic.has(m.name) || !!m.contraindications?.(patient)) || (patient.potassium > 0 && patient.potassium < 3.5);
}
export const CONGESTION_WITHOUT_WEIGHT_HEAD = 'CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN';
export function congestionWithoutWeightAlerts(patient: Patient): string[] {
    const found = congestionWithoutWeightGain(patient);
    if (!found || congestionFindingCount(patient.volume_status.exam_findings) < DECOMPENSATION_MIN_CONGESTION_FINDINGS) return [];
    if (loopsExcludedForAnotherReason(patient)) return [];
    const w = patient.volume_status.current_weight_kg, d = patient.volume_status.dry_weight_kg;
    return [
        `${CONGESTION_WITHOUT_WEIGHT_HEAD}: the examination shows congestion (${found.join(', ')}), but the weight (${w} kg) is not more than ${CONGESTION_EXCESS_KG_ABOVE} kg above the recorded dry weight (${d} kg). ` +
        'Check whether the recorded dry weight is out of date or the scale reading is wrong, and reassess volume at the bedside. ' +
        `The tool does not offer a new loop diuretic unless the weight is more than ${CONGESTION_EXCESS_KG_ABOVE} kg above the dry weight.`,
    ];
}

/**
 * Poor-perfusion findings at an ejection fraction at or above the low-output limit (R5 Y4): at least two of the low-output markers, but the low-output state applies only below the limit.
 * Not raised when the cold state already raises POOR PERFUSION (decompensation with the same signs). The definition of the low-output state is unchanged.
 */
export const POSSIBLE_POOR_PERFUSION_HEAD = 'POSSIBLE POOR PERFUSION';
export function perfusionAboveEfLimitAlerts(patient: Patient): string[] {
    const markers = perfusionMarkersAboveEfLimit(patient);
    if (!markers || isColdState(patient)) return [];
    return [
        `${POSSIBLE_POOR_PERFUSION_HEAD}: the findings recorded (${markers.join('; ')}) can indicate poor perfusion. The tool's low-output state applies only below an ejection fraction of ${LOW_OUTPUT.lvefBelow}%, and this patient's is ${patient.lvef}%, so it is not raised. ` +
        'Assess perfusion before starting or raising a drug.',
    ];
}

/** Used by the limited-information review: every urgent alert the full path raises from entered values, by the same functions. */
export function enteredUrgentStateAlerts(p: Patient): string[] {
    if (!p || typeof p !== 'object') return [];
    // An alert builder must never end a stop path with an exception: the entered values it cannot read are simply not evidence.
    try {
        const q = enteredValues(p);
        return [...unstableStateAlerts(q), ...conductionAlerts(q), ...slowHeartRateAlerts(q), ...scaleDisagreementAlerts(q), ...congestionWithoutWeightAlerts(q), ...perfusionAboveEfLimitAlerts(q)];
    } catch { return []; }
}
