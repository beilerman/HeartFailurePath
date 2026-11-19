import type { OutcomeContributorView, OutcomeEstimateView, RegimenMed, ScoredRegimen } from '../types';
import {
    compareOutcomeEstimate, OUTCOME_EVIDENCE_TABLE, populationKeyFor, outcomeDoseCredit, type OutcomeKey, type EfBand,
} from '../services/engine/outcomeBenefit';
import { symptomEstimateFor } from '../services/engine/symptomBenefit';
import { compareHarmBurden, HARM_TABLE, type HarmLevel } from '../services/engine/harmBurden';
import { SIDE_EFFECT_BURDEN_DIVISOR } from '../services/engine/scoreModel';

// Plain-language display model for the "Expected effect (trial averages)" block and its evidence drill-down.
// Every number comes from the engine's output or from the engine's own exported functions (nothing is re-derived here).
// All figures are population averages from trials, never a prediction for the individual patient.

export const POPULATION_AVERAGE_NOTE = 'Population averages from randomized trials, not a prediction for this patient. The patient\'s own response at follow-up replaces these estimates.';

// ---- number formats ----
export const fmtRR = (x: number): string => x.toFixed(2);
export const fmtInterval = (lo: number, hi: number): string => `95% interval ${fmtRR(lo)} to ${fmtRR(hi)}`;
/** Words for a relative-risk interval that spans 1: the trials cannot rule out no effect. */
export const intervalNoEffectNote = (lo: number, hi: number): string => (lo <= 1 && hi >= 1 ? '; the interval includes no effect' : '');
export const fmtPoints = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);
export const fmtSigned = (x: number): string => { const r = Math.round(x * 10) / 10; return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(1)}`; };
export const fmtPercent = (x: number): string => `${Math.round(x)}%`;

/** "35% lower", "12% higher", or "about the same" when the difference rounds to 0%. */
export function relativeChangeWords(rr: number): { text: string; direction: 'lower' | 'higher' | 'same' } {
    const pct = Math.round(Math.abs(1 - rr) * 100);
    if (pct === 0) return { text: 'about the same', direction: 'same' };
    return rr < 1 ? { text: `${pct}% lower`, direction: 'lower' } : { text: `${pct}% higher`, direction: 'higher' };
}

// ---- plain labels for evidence fields ----
export const OUTCOME_SHORT: Record<OutcomeKey, string> = { all_cause_death: 'Death from any cause', hf_hospitalization: 'Heart-failure hospitalization' };
export const EF_BAND_LABELS: Record<EfBand, string> = { reduced: 'Reduced EF', mildly_reduced: 'Mildly reduced EF', preserved: 'Preserved EF' };
export const MEASURE_LABELS: Record<string, string> = { HR: 'hazard ratio', RR: 'risk ratio', OR: 'odds ratio', rate_ratio: 'rate ratio' };

/** Outcome and symptom evidence basis, in words. */
export function basisLabel(basis: string): string {
    switch (basis) {
        case 'trial': return 'Randomized trial';
        case 'meta_analysis': return 'Pooled analysis of trials';
        case 'extrapolated': return 'Extrapolated (carried from another population or EF band)';
        case 'assumed_neutral': return 'Assumed no effect (no outcome trial)';
        case 'not_measured': return 'Not measured';
        default: return basis.replace(/_/g, ' ');
    }
}

/** Harm evidence level, in words. `upperBound` is the table's step-6 flag: no measurement for this drug, the largest measured excess of this harm elsewhere. */
export function harmLevelLabel(level: HarmLevel | string, upperBound = false): string {
    if (upperBound) return 'Upper bound (no measurement for this drug; uses the largest measured excess of this harm in any drug, so it probably overstates)';
    switch (level) {
        case 'drug': return 'Measured for this drug';
        case 'class': return 'Measured for the drug class';
        case 'extrapolated': return 'Extrapolated (different population, follow-up or control)';
        case 'siblingProxy': return 'Borrowed from a sibling class';
        default: return String(level);
    }
}

export const DOSE_LEVEL_LABELS: Record<string, string> = {
    drug: 'Measured for this drug', class: 'Measured for the drug class', siblingProxy: 'Borrowed from a sibling drug', not_measured: 'Not measured (the engine\'s own target dose is used)',
};

export const SEVERITY_LABELS: Record<string, string> = { mild: 'mild', moderate: 'moderate', serious: 'serious' };

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

/** Plain wording for a patient-value condition that could not be evaluated (engine reason text starts with the condition kind). */
export function multiplierGapWords(reason: string): string {
    const m = /: (.+)$/.exec(reason);
    return m ? m[1] : reason;
}

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
    /** Same comparison with every drug valued at today's dose; present only when it differs from the planned figure at the displayed precision. */
    todays?: { rr: number; lo: number; hi: number; change: { text: string; direction: 'lower' | 'higher' | 'same' } };
}
export interface HarmContributor { drug: string; effect: string; label: string; delta: number }
export interface ExpectedEffectView {
    noChange: boolean;
    outcomes: OutcomeLine[];
    symptoms: { delta: number; todays?: number; notMeasured: string[] };
    sideEffects: { burdenChange: number; scoreChange: number; top: HarmContributor[] };
}

export function buildExpectedEffect(option: ScoredRegimen): ExpectedEffectView | null {
    const views = option.outcome_estimates;
    const current = currentRegimenOf(option);
    if (!views || views.length === 0 || !current || !option.symptom_estimate || !option.harm_burden) return null;
    const patient = option.projected_patient;
    const noChange = isNoChange(option);
    const outcomes: OutcomeLine[] = views.map((v: OutcomeEstimateView) => {
        const line: OutcomeLine = { outcome: v.outcome, label: OUTCOME_SHORT[v.outcome], rr: v.vs_current.rr, lo: v.vs_current.ci_low, hi: v.vs_current.ci_high, change: relativeChangeWords(v.vs_current.rr) };
        if (!noChange) {
            const t = compareOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, option.regimen, current, patient, v.outcome, populationKeyFor, outcomeDoseCredit, outcomeDoseCredit);
            if (fmtRR(t.rr) !== fmtRR(v.vs_current.rr)) line.todays = { rr: t.rr, lo: t.ci_low, hi: t.ci_high, change: relativeChangeWords(t.rr) };
        }
        return line;
    });
    const nowSymptoms = symptomEstimateFor(current, patient).points;
    const delta = option.symptom_estimate.points - nowSymptoms;
    const todaysPts = symptomEstimateFor(option.regimen, patient).points - nowSymptoms;
    const cmp = compareHarmBurden(HARM_TABLE, option.regimen, current, patient);
    const top = cmp.changed_lines.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.drug + a.effect < b.drug + b.effect ? -1 : 1)).slice(0, 2)
        .map(l => ({ drug: l.drug, effect: l.effect, label: harmLabel(l.effect), delta: l.delta }));
    return {
        noChange,
        outcomes,
        symptoms: { delta, todays: fmtSigned(todaysPts) !== fmtSigned(delta) ? todaysPts : undefined, notMeasured: option.symptom_estimate.contributors.filter(c => c.not_measured).map(c => c.medication) },
        sideEffects: { burdenChange: cmp.burden_difference, scoreChange: -cmp.burden_difference / SIDE_EFFECT_BURDEN_DIVISOR, top },
    };
}

export const outcomeLineText = (o: OutcomeLine): string => `${o.label}: ${o.change.text} (relative risk ${fmtRR(o.rr)}, ${fmtInterval(o.lo, o.hi)}${intervalNoEffectNote(o.lo, o.hi)})`;
export const symptomsLineText = (delta: number): string => Math.abs(Math.round(delta * 10) / 10) === 0 ? 'Symptoms (KCCQ): about the same' : `Symptoms (KCCQ): ${delta > 0 ? 'gain' : 'loss'} of ${fmtPoints(Math.abs(delta))} points`;
export const burdenLineText = (change: number): string => Math.abs(Math.round(change * 10) / 10) === 0 ? 'Side-effect burden: about the same' : `Side-effect burden: ${fmtSigned(change)} points (${change > 0 ? 'more' : 'less'} measured harm)`;

/** The one sentence for the draft note: the same numbers the card shows, with the population-average caveat. Null when there is no estimate. */
export function expectedEffectSentence(option: ScoredRegimen): string | null {
    const v = buildExpectedEffect(option);
    if (!v) return null;
    if (v.noChange) return 'No medication change is proposed, so no change in expected effect versus the current regimen. Expected effects are population averages from randomized trials, not a prediction for this patient.';
    const [death, hosp] = v.outcomes;
    const sym = Math.abs(Math.round(v.symptoms.delta * 10) / 10) === 0 ? 'KCCQ about the same' : `KCCQ ${v.symptoms.delta > 0 ? '+' : '−'}${fmtPoints(Math.abs(v.symptoms.delta))} points`;
    const harm = Math.abs(Math.round(v.sideEffects.burdenChange * 10) / 10) === 0 ? 'side-effect burden about the same' : `side-effect burden ${fmtSigned(v.sideEffects.burdenChange)} points`;
    return `Versus the current regimen (population averages from randomized trials, not a prediction for this patient): death from any cause ${death.change.text} (relative risk ${fmtRR(death.rr)}, ${fmtInterval(death.lo, death.hi)}${intervalNoEffectNote(death.lo, death.hi)}); heart-failure hospitalization ${hosp.change.text} (relative risk ${fmtRR(hosp.rr)}, ${fmtInterval(hosp.lo, hosp.hi)}${intervalNoEffectNote(hosp.lo, hosp.hi)}); ${sym}; ${harm}.`;
}

// ---- drill-down helpers ----
/** Why a published figure moved: small or imprecise trials are pulled toward no effect. Null when it did not move at the displayed precision. */
export function movedReason(published: number, used: number, decimals = 2): string | null {
    return published.toFixed(decimals) === used.toFixed(decimals) ? null : 'Pulled toward no effect because the trials are small or imprecise.';
}
export const intervalText = (lo: number | null, hi: number | null, decimals = 2): string => (lo === null || hi === null ? 'no interval published' : `95% interval ${lo.toFixed(decimals)} to ${hi.toFixed(decimals)}`);
export const creditText = (c: OutcomeContributorView): string => `${Math.round(c.credit * 100)}% of the trial-achieved dose effect`;
