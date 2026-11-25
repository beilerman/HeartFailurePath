import type { OutcomeEstimateView, Patient, RegimenMed, ScoredRegimen, RegimenModification } from '../../types';
import { compareOutcomeEstimate, OUTCOME_EVIDENCE_TABLE, populationKeyFor, outcomeDoseCredit, type OutcomeKey } from './outcomeBenefit';
import { symptomEstimateFor, SYMPTOM_TABLE } from './symptomBenefit';
import { compareHarmBurden, HARM_TABLE } from './harmBurden';
import { SIDE_EFFECT_BURDEN_DIVISOR } from './scoreModel';
import { buildFollowUpCalendar } from './explain';
import { TRIAL_EGFR_ENTRY_LOWEST, TRIAL_SBP_ENTRY_LOWEST } from './thresholds';

// The numbers behind an option's "expected effect" block, computed once from the engine's own functions. The screen, the draft note and the
// "why this is first" explanation all read this module, so the three can never disagree. All figures are trial population averages, never a
// prediction for the individual patient. (Moved from components/expectedEffectModel.ts so the engine can explain a ranking in the same units.)

/** A drug's name without its brand ("Sacubitril/Valsartan (Entresto)" -> "sacubitril/valsartan"), for comparing it with the drugs a source tested. */
export const drugKey = (name: string): string => name.split(' (')[0].trim().toLowerCase();
// A row of basis "conflicting" or "no outcome evidence" still names the drugs its source tested (semaglutide and liraglutide for the GLP-1 rows, hydrochlorothiazide for the thiazide rows), so a
// drug it did not test is "borrowed from" them (U12). Only a row that names no tested drug, or that was never measured, has nothing to borrow.
const NO_FIGURE_BASES = ['assumed_neutral', 'not_measured'];
const listWords = (xs: string[]): string => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
/** "borrowed from Spironolactone (TOPCAT)" when the row's source did not test `drug` (T8); null when the source tested it, does not name its drugs, or the row carries no figure to borrow. */
export function borrowedFrom(row: { tested_drugs?: string[] | null; tested_trial?: string; basis: string; source: { trial: string } }, drug: string): string | null {
    if (!row.tested_drugs || row.tested_drugs.length === 0 || NO_FIGURE_BASES.includes(row.basis)) return null;
    if (row.tested_drugs.some(t => drugKey(t) === drugKey(drug))) return null;
    return `borrowed from ${listWords(row.tested_drugs)} (${row.tested_trial || row.source.trial})`;
}

export const fmtRR = (x: number): string => x.toFixed(2);
export const fmtPoints = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
export const fmtSigned = (x: number): string => { const r = Math.round(x * 10) / 10; return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`; };

/** "35% lower", "12% higher", or "no measurable difference" when the difference rounds to 0%. */
export function relativeChangeWords(rr: number): { text: string; direction: 'lower' | 'higher' | 'same' } {
    const pct = Math.round(Math.abs(1 - rr) * 100);
    if (pct === 0) return { text: 'no measurable difference', direction: 'same' };
    return rr < 1 ? { text: `${pct}% lower`, direction: 'lower' } : { text: `${pct}% higher`, direction: 'higher' };
}

export const OUTCOME_SHORT: Record<OutcomeKey, string> = { all_cause_death: 'Death from any cause', hf_hospitalization: 'Heart-failure hospitalization' };

export const HARM_LABELS: Record<string, string> = {
    hyperkalemia: 'high potassium (above 5.5)', hyperkalemiaSevere: 'severe high potassium (6.0 or above)', hypokalemia: 'low potassium', creatinineRise: 'creatinine rise',
    renalSeriousEvent: 'serious kidney event', hyponatremia: 'low sodium', hyperuricemiaGout: 'gout attack', hyperglycemia: 'new diabetes', gynecomastia: 'breast enlargement or pain (men)',
    angioedema: 'angioedema', syncope: 'fainting', anemia: 'anemia', avBlockFirstDegree: 'first-degree heart block', avBlockAdvanced: 'advanced heart block',
    atrialFibrillation: 'atrial fibrillation', ketoacidosis: 'diabetic ketoacidosis', genitalMycoticInfection: 'genital fungal infection', amputation: 'limb amputation',
    hypoglycemiaSevere: 'severe low blood sugar', urinaryTractInfection: 'urinary tract infection', digoxinToxicityHospitalization: 'digoxin toxicity needing admission',
    ventricularArrhythmia: 'dangerous ventricular rhythm', pancreatitis: 'pancreatitis', gallbladderDisease: 'gallbladder disease', hypophosphatemia: 'low phosphate',
    hypersensitivitySerious: 'serious allergic or infusion reaction', hypomagnesemia: 'low magnesium', lupusLikeSyndrome: 'drug-induced lupus',
    hypotensionSymptomatic: 'symptomatic low blood pressure', dizziness: 'dizziness', bradycardiaSymptomatic: 'symptomatic slow heart rate', fatigue: 'fatigue', cough: 'cough',
    headache: 'headache', giUpset: 'stomach and bowel upset', constipation: 'constipation', volumeDepletion: 'volume depletion', urinaryFrequency: 'frequent urination',
    peripheralEdema: 'swelling', visualPhosphenes: 'visual disturbance', injectionSiteReaction: 'injection-site reaction', sexualDysfunction: 'sexual dysfunction',
    bronchospasm: 'wheeze or bronchospasm', muscleSpasm: 'muscle cramps', rash: 'rash or itching', symptoms: 'everyday symptoms (combined)',
};
export const harmLabel = (effect: string): string => HARM_LABELS[effect] ?? effect.replace(/([A-Z])/g, ' $1').toLowerCase();

// ---- the current regimen, reconstructed from the option's own modification set ----
const keyOf = (r: RegimenMed) => `${r.med.name}|${r.dose.strength}|${r.selected_frequency}`;
/** The regimen the patient takes today: the option's resulting regimen with each changed drug put back (sources of change/remove, minus targets of add/change). */
export function currentRegimenOf(option: ScoredRegimen): RegimenMed[] | undefined {
    const set = option.modification_set;
    if (!set) return undefined;
    const changed = set.modifications.filter(m => m.action !== 'keep');
    const targets = new Set(changed.filter(m => m.target).map(m => keyOf(m.target!)));
    return [...set.resulting_regimen.filter(r => !targets.has(keyOf(r))), ...changed.filter(m => m.source).map(m => m.source!)];
}
export const isNoChange = (option: ScoredRegimen): boolean => !(option.modification_set?.modifications ?? []).some(m => m.action !== 'keep');

// ---- the view ----
export interface OutcomeLine {
    outcome: OutcomeKey;
    label: string;
    /** Option (as planned) versus the current regimen, with the 95% interval. */
    rr: number; lo: number; hi: number;
    change: { text: string; direction: 'lower' | 'higher' | 'same' };
    /** True when the two ends of the interval round to the same figure: the interval is not printed. */
    noInterval: boolean;
    /** True when every change in the option is a dose step of a drug already taken (T7): the figure is estimated from the dose relationship and carries no interval of its own. */
    doseStepOnly: boolean;
    /** True when the only effect on this outcome would come from a loop diuretic dose change, removal or switch, which the model does not value: say so instead of a figure. */
    notModelled: boolean;
    /** Same comparison with every drug valued at today's dose; present only when it differs from the planned figure at the displayed precision. */
    todays?: { rr: number; lo: number; hi: number; change: { text: string; direction: 'lower' | 'higher' | 'same' }; noInterval: boolean };
}
export interface HarmContributor { drug: string; effect: string; label: string; delta: number }
export interface ExpectedEffectNote { kind: 'trial_range' | 'loop_not_modelled' | 'dose_side_effects' | 'temporary_hold' | 'dose_interval' | 'borrowed_evidence'; text: string }
export interface ExpectedEffectView {
    noChange: boolean;
    outcomes: OutcomeLine[];
    symptoms: { delta: number; todays?: number; notMeasured: string[] };
    sideEffects: { burdenChange: number; scoreChange: number; top: HarmContributor[]; /** Drugs whose dose goes up although the table has no dose-specific rate: their burden is the current dose's. */ doseNotMeasured: string[] };
    /** Sentences that limit what the figures above mean. Shown under the lines and carried into the draft note. */
    notes: ExpectedEffectNote[];
}

/** An option whose every change is a dose step (increase or decrease) of a drug already taken. */
export const isDoseStepOnly = (option: ScoredRegimen): boolean => {
    const mods = (option.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
    return mods.length > 0 && mods.every(m => m.action === 'titrate_up' || m.action === 'titrate_down');
};
const isLoop = (r: RegimenMed | undefined) => !!r && r.med.drug_class === 'Loop Diuretic';
/** A loop diuretic dose change, removal or switch (a start is valued; a dose change is not). */
const loopDoseChange = (m: RegimenModification) => (m.action === 'titrate_up' || m.action === 'titrate_down' || m.action === 'remove' || m.action === 'swap') && (isLoop(m.source) || isLoop(m.target));

export function buildExpectedEffect(option: ScoredRegimen): ExpectedEffectView | null {
    const views = option.outcome_estimates;
    const current = currentRegimenOf(option);
    if (!views || views.length === 0 || !current || !option.symptom_estimate || !option.harm_burden) return null;
    // The ejection-fraction band of the trial evidence is decided ONCE per patient, from the recorded values and the CURRENT regimen (U6): `isImprovedEF` reads the regimen when the
    // earlier ejection fraction is unknown, so an option that drops a RAAS inhibitor, beta-blocker or MRA must not move itself into another band.
    const patient: Patient = { ...option.projected_patient, current_regimen: current };
    const noChange = isNoChange(option);
    const mods = (option.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
    const loopChange = mods.some(loopDoseChange);
    const sameEnds = (lo: number, hi: number) => fmtRR(lo) === fmtRR(hi);
    const doseStepOnly = !noChange && isDoseStepOnly(option);
    const outcomes: OutcomeLine[] = views.map((v: OutcomeEstimateView) => {
        const change = relativeChangeWords(v.vs_current.rr);
        const line: OutcomeLine = {
            outcome: v.outcome, label: OUTCOME_SHORT[v.outcome], rr: v.vs_current.rr, lo: v.vs_current.ci_low, hi: v.vs_current.ci_high, change,
            noInterval: noChange || sameEnds(v.vs_current.ci_low, v.vs_current.ci_high), doseStepOnly, notModelled: loopChange && change.direction === 'same',
        };
        if (!noChange) {
            const t = compareOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, option.regimen, current, patient, v.outcome, populationKeyFor, outcomeDoseCredit, outcomeDoseCredit);
            if (fmtRR(t.rr) !== fmtRR(v.vs_current.rr)) line.todays = { rr: t.rr, lo: t.ci_low, hi: t.ci_high, change: relativeChangeWords(t.rr), noInterval: sameEnds(t.ci_low, t.ci_high) };
        }
        return line;
    });
    const nowSymptoms = symptomEstimateFor(current, patient).points;
    const delta = option.symptom_estimate.points - nowSymptoms;
    const todaysPts = symptomEstimateFor(option.regimen, patient).points - nowSymptoms;
    const cmp = compareHarmBurden(HARM_TABLE, option.regimen, current, patient);
    const top = cmp.changed_lines.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.drug + a.effect < b.drug + b.effect ? -1 : 1)).slice(0, 2)
        .map(l => ({ drug: l.drug, effect: l.effect, label: harmLabel(l.effect), delta: l.delta }));

    // A dose increase whose side-effect burden cannot change: the harm table has no dose-specific rate for that drug.
    const doseNotMeasured = [...new Set(mods.filter(m => m.action === 'titrate_up' && m.target && !isLoop(m.target))
        .map(m => m.target!.med.name)
        .filter(name => !option.harm_burden!.lines.some(l => l.drug === name && (l.kind === 'harm' ? l.dose_relation_measured : l.components.some(c => c.dose_relation_measured)))))].sort();

    const notes: ExpectedEffectNote[] = [];
    // Entered values below the range the trials enrolled (U8c): wording only, no score or option changes.
    if (patient.egfr > 0 && patient.egfr < TRIAL_EGFR_ENTRY_LOWEST) notes.push({ kind: 'trial_range', text: `Kidney function is below the trial range: the eGFR is ${patient.egfr}, and the SGLT2 inhibitor trials behind these figures enrolled patients with an eGFR of ${TRIAL_EGFR_ENTRY_LOWEST} or above at the lowest. The trials enrolled few or no patients with kidney function this low.` });
    if (patient.sbp > 0 && patient.sbp < TRIAL_SBP_ENTRY_LOWEST) notes.push({ kind: 'trial_range', text: `Systolic pressure is below the trial range: it is ${patient.sbp} mmHg, and the trials behind these figures enrolled patients with a systolic pressure of ${TRIAL_SBP_ENTRY_LOWEST} mmHg or above at the lowest. The trials enrolled few or no patients with a pressure this low.` });
    // A drug whose evidence row was measured in another drug of its class says so (T8): one line per drug, the same words as the drill-down and the evidence table.
    const borrowed = new Map<string, string>();
    for (const v of views) for (const c of v.contributors) { const row = OUTCOME_EVIDENCE_TABLE.find(r => r.id === c.row_id); const b = row ? borrowedFrom(row, c.medication) : null; if (b) borrowed.set(c.medication, b); }
    for (const c of option.symptom_estimate.contributors) { const row = SYMPTOM_TABLE.find(r => r.id === c.row_id); const b = row && !c.not_measured ? borrowedFrom(row, c.medication) : null; if (b && !borrowed.has(c.medication)) borrowed.set(c.medication, b); }
    if (borrowed.size > 0) notes.push({ kind: 'borrowed_evidence', text: `Borrowed evidence: ${[...borrowed.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, b]) => `${d} ${b}`).join('; ')}.` });
    if (loopChange) notes.push({ kind: 'loop_not_modelled', text: 'The effect of the loop diuretic dose on death and hospitalization is not modelled: the figures above do not include it.' });
    // A mixed option (a start, switch or removal beside a dose step): its interval carries the trials' uncertainty only, not that of the dose relationship (T7).
    const doseSteps = [...new Set(mods.filter(m => (m.action === 'titrate_up' || m.action === 'titrate_down') && m.target && !isLoop(m.target)).map(m => m.target!.med.name))].sort();
    if (!doseStepOnly && doseSteps.length > 0 && outcomes.some(o => !o.noInterval && !o.notModelled)) notes.push({ kind: 'dose_interval', text: `The interval does not include the uncertainty of the dose relationship for the dose step of ${doseSteps.join(' and ')}.` });
    if (doseNotMeasured.length > 0) notes.push({ kind: 'dose_side_effects', text: `Side effects at the higher dose were not measured separately; the burden shown for ${doseNotMeasured.join(' and ')} is that of the current dose.` });
    const holds = mods.filter(m => m.temporary_hold && m.source).map(m => m.source!.med.name);
    const worse = outcomes.some(o => !o.notModelled && o.change.direction === 'higher');
    if (holds.length > 0 && worse) {
        const when = buildFollowUpCalendar(option.modification_set)[0]?.timing;
        notes.push({ kind: 'temporary_hold', text: `The higher figures are the trial effect of not taking ${[...new Set(holds)].sort().join(' and ')} at all. Here it is a temporary hold or reduction for the safety reason stated in the change, not a permanent withdrawal. Reassess ${when ? `at the first follow-up (${when.charAt(0).toLowerCase()}${when.slice(1)})` : 'at the next review'}, and restore the drug when the stated reason has been rechecked and has resolved.` });
    }
    return {
        noChange,
        outcomes,
        symptoms: { delta, todays: fmtSigned(todaysPts) !== fmtSigned(delta) ? todaysPts : undefined, notMeasured: option.symptom_estimate.contributors.filter(c => c.not_measured).map(c => c.medication) },
        sideEffects: { burdenChange: cmp.burden_difference, scoreChange: -cmp.burden_difference / SIDE_EFFECT_BURDEN_DIVISOR, top, doseNotMeasured },
        notes,
    };
}
