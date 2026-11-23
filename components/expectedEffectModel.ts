import type { OutcomeContributorView, ScoredRegimen } from '../types';
import { MEDICATION_FORMULARY } from '../constants';
import type { EfBand } from '../services/engine/outcomeBenefit';
import type { HarmLevel } from '../services/engine/harmBurden';
import {
    fmtRR, fmtPoints, fmtSigned, relativeChangeWords, OUTCOME_SHORT, HARM_LABELS, harmLabel, currentRegimenOf, isNoChange, isDoseStepOnly, buildExpectedEffect, borrowedFrom, drugKey,
    type OutcomeLine, type HarmContributor, type ExpectedEffectView, type ExpectedEffectNote,
} from '../services/engine/effectView';

export { fmtRR, fmtPoints, fmtSigned, relativeChangeWords, OUTCOME_SHORT, HARM_LABELS, harmLabel, currentRegimenOf, isNoChange, isDoseStepOnly, buildExpectedEffect, borrowedFrom, drugKey };
export type { OutcomeLine, HarmContributor, ExpectedEffectView, ExpectedEffectNote };

// Plain-language display model for the "Expected effect (trial averages)" block and its evidence drill-down.
// Every number comes from the engine's output or from the engine's own exported functions (nothing is re-derived here).
// All figures are population averages from trials, never a prediction for the individual patient.

export const POPULATION_AVERAGE_NOTE = 'Population averages from randomized trials, not a prediction for this patient. The patient\'s own response at follow-up replaces these estimates.';

// ---- number formats ----
export const fmtInterval = (lo: number, hi: number): string => `95% interval ${fmtRR(lo)} to ${fmtRR(hi)}`;
/** Words for a relative-risk interval that spans 1: the trials cannot rule out no effect. */
export const intervalNoEffectNote = (lo: number, hi: number): string => (lo <= 1 && hi >= 1 ? '; the interval includes no effect' : '');
/** A rate in percent of patients: one decimal, or "under 0.1%" so a rate that rounds to 0.0 never sits beside a nonzero point value. */
export const fmtRate = (x: number): string => x === 0 ? '0%' : Math.abs(x) < 0.05 ? (x < 0 ? 'below zero' : 'under 0.1%') : `${fmtPoints(x)}%`;
/** Points with the same rule: "under 0.1" instead of 0.0 for a nonzero value. */
export const fmtSmall = (x: number): string => x === 0 ? '0.0' : Math.abs(x) < 0.05 ? 'under 0.1' : fmtPoints(x);
export const fmtPercent = (x: number): string => `${Math.round(x)}%`;

// ---- plain labels for evidence fields ----
/** The visible sentence for an evidence row that states the ejection fractions it is used for (R5 Y11), generated from its `lvef_range`; null for a row without one. */
export function efRangeText(row: { lvef_range?: { min?: number; max?: number; applies_to?: string } }): string | null {
    const r = row.lvef_range;
    if (!r || (r.min === undefined && r.max === undefined)) return null;
    const range = r.min !== undefined && r.max !== undefined ? `from ejection fraction ${r.min} to ${r.max}` : r.min !== undefined ? `from ejection fraction ${r.min} upward` : `below ejection fraction ${(r.max as number) + 1}`;
    return `Used ${range}${r.applies_to ? `, ${r.applies_to}` : ''}`;
}
export const EF_BAND_LABELS: Record<EfBand, string> = { reduced: 'Reduced EF', mildly_reduced: 'Mildly reduced EF', preserved: 'Preserved EF' };
export const MEASURE_LABELS: Record<string, string> = { HR: 'hazard ratio', RR: 'risk ratio', OR: 'odds ratio', rate_ratio: 'rate ratio' };

const INFERENCE_WORDS: Record<string, string> = {
    questionnaire: 'converted from another questionnaire', outcome_definition: 'converted from a different outcome definition', band: 'carried from another EF band',
    population: 'carried from another population', drug_class: 'carried from another drug class', arb_to_acei: 'carried from an ARB to ACE inhibitors',
    two_step: 'combined from two comparisons, one against another drug and one against placebo',
};
/** Outcome and symptom evidence basis, in words. A row that rests on more than one inference names every one of them (T13). */
export function basisLabel(basis: string, inferences?: string[]): string {
    const named = (inferences ?? []).map(c => INFERENCE_WORDS[c]).filter(Boolean);
    const joined = named.length > 0 ? `${named[0].charAt(0).toUpperCase()}${named[0].slice(1)}${named.slice(1).map((x, i, a) => `${i === a.length - 1 ? ' and ' : ', '}${x}`).join('')}` : '';
    switch (basis) {
        case 'trial': return 'Randomized trial';
        case 'meta_analysis': return 'Pooled analysis of trials';
        case 'subgroup': return 'Subgroup of a randomized trial';
        case 'indirect_comparison': return 'Indirect comparison through enalapril';
        case 'extrapolated': return joined || 'Extrapolated (carried from another population or EF band)';
        case 'conflicting': return 'Randomized evidence conflicts; no effect assumed';
        case 'no_outcome_evidence': return 'No outcome evidence; no effect assumed';
        case 'assumed_neutral': return 'Assumed no effect (no outcome trial)';
        case 'converted': return joined || 'Converted from another questionnaire';
        case 'combined': return 'Combined from two steps';
        case 'not_measured': return 'Not measured';
        default: return basis.replace(/_/g, ' ');
    }
}

/** What was checked against the source, in words (E14). The code is the row's `verification` field. */
export function verificationLabel(code: string): string {
    switch (code) {
        case 'abstract_quote': return 'Read in the abstract';
        case 'full_text_quote': return 'Read in the full text';
        case 'secondary_source_quote': return 'Quoted second-hand from a review; not read in the primary paper';
        case 'computed_from_verified': return 'Computed from figures read in the sources';
        case 'unverified': return 'Not verified: no readable source';
        case 'verified_label': return 'Read in the drug label';
        case 'verified_abstract': return 'Read in the abstract';
        case 'verified_fulltext': return 'Read in the full text';
        case 'verified_fulltext (secondary source)': return 'Read in the full text of a secondary source';
        case 'verified_image_table': return 'Read from a table in the source';
        case 'n/a': return 'No figure to check';
        case 'registry_quote': return 'Read in the ClinicalTrials.gov results entry';
        case 'label_quote': return 'Read in the drug label';
        case 'computed_from_secondary_source': return 'Computed from figures read in the sources and one figure quoted second-hand';
        case 'not_applicable': return 'No figure to check';
        case 'confirmed_secondary_text': return 'Read in a secondary source';
        case 'confirmed_single_secondary': return 'Read in one secondary source';
        case 'confirmed_single_secondary_plus_arithmetic': return 'Read in one secondary source, with arithmetic';
        case 'confirmed_two_sources': return 'Read in two sources';
        case 'confirmed_three_sources': return 'Read in three sources';
        case 'confirmed_two_secondary': return 'Read in two secondary sources';
        case 'confirmed_label_target_share_only': return 'Read in the drug label (the share on target only)';
        case 'confirmed_with_D5_clamp': return 'Read in two sources; the trial dose is above the highest marketed strength, so the highest strength is used';
        case 'conflict_unresolved': return 'Sources conflict; not resolved';
        case 'not_confirmed_achieved_dose': return 'Not verified: the dose achieved was not found';
        case 'not_confirmed_mean_target_confirmed': return 'The target dose was read; the mean achieved dose was not';
        default: return code.replace(/_/g, ' ');
    }
}

/** Heading of the symptom table and unit of every symptom figure (E3): the rows are not all the Kansas City questionnaire. */
export const SYMPTOM_HEADING = 'Health status, in KCCQ-equivalent points';
export const SYMPTOM_UNIT = 'KCCQ-equivalent points';

/** Who a keyed evidence row applies to, in words. */
export function populationKeyLabel(drugClass: string, key: string): string {
    if (key === 'atrial_fibrillation') return 'atrial fibrillation';
    if (key === 'congested') return 'a congested patient';
    if (key === 'self_identified_black') return 'patients who identify as Black';
    if (key === 'other') return drugClass === 'Beta Blocker' ? 'sinus rhythm and every other rhythm' : drugClass === 'Loop Diuretic' ? 'a patient without congestion' : drugClass === 'Vasodilator' ? 'patients who do not identify as Black' : 'all other patients';
    return key.replace(/_/g, ' ');
}

/** Harm evidence level, in words. `upperBound` is the table's step-6 flag: no measurement for this drug, the largest measured excess of this harm elsewhere. */
export function harmLevelLabel(level: HarmLevel | string, upperBound = false): string {
    if (upperBound) return 'Upper bound (no measurement for this drug; uses the largest measured excess of this harm in any drug, so it probably overstates)';
    switch (level) {
        case 'drug': return 'Measured for this drug';
        case 'class': return 'Measured for the drug class';
        case 'extrapolated': return 'Extrapolated (different population, follow-up or control)';
        case 'siblingProxy': return 'Borrowed from a sibling class';
        case 'notMeasured': return 'Not measured: no randomized incidence was found, so nothing is charged';
        default: return String(level);
    }
}

export const DOSE_LEVEL_LABELS: Record<string, string> = {
    drug: 'Measured for this drug', class: 'Measured for the drug class', siblingProxy: 'Borrowed from a sibling drug', not_measured: 'Not measured: no trial reported the dose reached',
};

export const SEVERITY_LABELS: Record<string, string> = { mild: 'mild', moderate: 'moderate', serious: 'serious' };


/** Plain wording for a patient-value condition that could not be evaluated (engine reason text starts with the condition kind). */
export function multiplierGapWords(reason: string): string {
    const m = /: (.+)$/.exec(reason);
    return m ? m[1] : reason;
}

const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
/** "relative risk 0.71, 95% interval ..." with no interval when it is not meaningful (no change, or both ends round to one figure). */
export const DOSE_ESTIMATE_WORDS = 'estimated from the dose relationship; no interval';
export const figureText = (rr: number, lo: number, hi: number, noInterval: boolean, doseStepOnly = false): string =>
    doseStepOnly ? `relative risk ${fmtRR(rr)}, ${DOSE_ESTIMATE_WORDS}` : `relative risk ${fmtRR(rr)}${noInterval ? '' : `, ${fmtInterval(lo, hi)}${intervalNoEffectNote(lo, hi)}`}`;
const NOT_MODELLED_WORDS = 'not modelled for a loop diuretic dose change (the effect of the dose on death and hospitalization is not modelled)';
export const outcomeLineText = (o: OutcomeLine): string => o.notModelled ? `${o.label}: ${NOT_MODELLED_WORDS}` : `${o.label}: ${o.change.text} (${figureText(o.rr, o.lo, o.hi, o.noInterval, o.doseStepOnly)})`;
export const symptomsLineText = (delta: number): string => Math.abs(Math.round(delta * 10) / 10) === 0 ? 'Health status (KCCQ-equivalent): about the same' : `Health status (KCCQ-equivalent): ${delta > 0 ? 'gain' : 'loss'} of ${fmtPoints(Math.abs(delta))} points`;
export const burdenLineText = (change: number, doseNotMeasured: string[] = []): string => Math.abs(Math.round(change * 10) / 10) === 0
    ? (doseNotMeasured.length > 0 ? 'Side-effect burden: not changed in the model, because side effects at the higher dose were not measured separately' : 'Side-effect burden: about the same')
    : `Side-effect burden: ${fmtSigned(change)} points (${change > 0 ? 'more' : 'less'} measured harm)`;

/** The one sentence for the draft note: the same numbers the card shows, with the population-average caveat. Null when there is no estimate. */
export function expectedEffectSentence(option: ScoredRegimen): string | null {
    const v = buildExpectedEffect(option);
    if (!v) return null;
    if (v.noChange) return 'No medication change is proposed, so no change in expected effect versus the current regimen. Expected effects are population averages from randomized trials, not a prediction for this patient.';
    const clause = (o: OutcomeLine) => o.notModelled ? `${lc(o.label)} ${NOT_MODELLED_WORDS}` : `${lc(o.label)} ${o.change.text} (${figureText(o.rr, o.lo, o.hi, o.noInterval, o.doseStepOnly)})`;
    const sym = Math.abs(Math.round(v.symptoms.delta * 10) / 10) === 0 ? 'health status (KCCQ-equivalent) about the same' : `health status (KCCQ-equivalent) ${v.symptoms.delta > 0 ? '+' : '−'}${fmtPoints(Math.abs(v.symptoms.delta))} points`;
    const harm = Math.abs(Math.round(v.sideEffects.burdenChange * 10) / 10) === 0
        ? (v.sideEffects.doseNotMeasured.length > 0 ? 'side-effect burden not changed in the model (side effects at the higher dose were not measured separately)' : 'side-effect burden about the same')
        : `side-effect burden ${fmtSigned(v.sideEffects.burdenChange)} points`;
    return `Versus the current regimen (population averages from randomized trials, not a prediction for this patient): ${v.outcomes.map(clause).join('; ')}; ${sym}; ${harm}.${v.notes.length ? ` ${v.notes.map(n => n.text).join(' ')}` : ''}`;
}

// ---- drill-down helpers ----
/** Why a published figure moved: small or imprecise trials are pulled toward no effect. Null when it did not move at the displayed precision. */
export function movedReason(published: number, used: number, decimals = 2): string | null {
    return published.toFixed(decimals) === used.toFixed(decimals) ? null : 'Pulled toward no effect because the trials are small or imprecise.';
}
/** Shown for a row whose data carry `conflicting_evidence: true` (basis `conflicting`: the two GLP-1 reduced-EF rows and the beta-blocker LVEF 50 and above death row): no interval beside 1.00. */
export const CONFLICT_NO_EFFECT_TEXT = 'No effect assumed (relative risk 1.00). Randomized evidence conflicts, so no interval is shown; the source figures are below.';
/** Which prior a row was weighted with and how much weight the trial figure got (change C3). `B` below 0.2 is marked "mostly prior" in words. A row that carries no trial estimate (no interval beside no effect, assumed no effect, or conflicting evidence) was not weighted at all, and says so (T10). */
export const NO_WEIGHTING_TEXT = 'No weighting applied: no trial estimate.';
export const priorText = (prior: 'death' | 'hospitalization' | 'symptom', tau2: number, B: number, noWeighting = false): string =>
    noWeighting ? NO_WEIGHTING_TEXT : `Weighted with the ${prior} prior (${tau2.toFixed(3)}); the trial figure gets weight ${B.toFixed(2)}.${B < 0.2 ? ' Mostly prior: the value used rests mostly on the assumption of no effect, not on this trial figure.' : ''}`;
/** True when an outcome row carries no trial estimate to weight: assumed no effect, no outcome evidence, conflicting evidence, or a value of no effect with no interval. */
export const outcomeRowUnweighted = (r: { basis: string; conflicting_evidence?: boolean; ci_low: number | null; ci_high: number | null; rr: number }): boolean =>
    r.conflicting_evidence === true || ['assumed_neutral', 'no_outcome_evidence', 'conflicting'].includes(r.basis) || ((r.ci_low === null || r.ci_high === null) && r.rr === 1);
/** Said on the option card and in the drill-down for a beta-blocker in a patient in atrial fibrillation (change C4). */
export const AFIB_BETA_BLOCKER_NOTE = 'For this patient in atrial fibrillation the beta-blocker figures are the atrial fibrillation ones: death is a subgroup of a pooled analysis of all beta-blockers studied, and hospitalization is an extrapolation from cardiovascular hospitalization. Neither shows a benefit that can be told from no effect. This is not a reason to stop a beta-blocker used for rate control.';
export const intervalText = (lo: number | null, hi: number | null, decimals = 2): string => (lo === null || hi === null ? 'no interval published' : `95% interval ${lo.toFixed(decimals)} to ${hi.toFixed(decimals)}`);
export const creditText = (c: OutcomeContributorView): string => `${Math.round(c.credit * 100)}% of the trial-achieved dose effect`;

/** The drugs of a symptom-table class (the table is keyed by class), by formulary name. */
export const drugsOfClass = (drugClass: string): string[] => [...new Set(MEDICATION_FORMULARY.filter(m => m.drug_class === drugClass || (drugClass === 'GLP-1 RA' && m.drug_class === 'GLP-1 RA')).map(m => m.name))];
/** One line per drug of a row that borrows it ("Eplerenone: borrowed from Spironolactone (TOPCAT)"); empty when no drug does. */
export function borrowedLines(row: { drug_class: string; drugs?: string[]; tested_drugs?: string[] | null; tested_trial?: string; basis: string; source: { trial: string } }): string[] {
    const drugs = row.drugs ?? drugsOfClass(row.drug_class);
    return drugs.flatMap(d => { const b = borrowedFrom(row, d); return b ? [`${d}: ${b}`] : []; });
}

// ---- the "Notes" of an evidence row (T9): everything an expert needs to judge it, in plain words, on the screen ----
interface NoteRow { caveats?: string[]; tested_note?: string; population?: string; level?: string; basis?: string }
/** The population the source studied, as a note. */
const populationNote = (population: string | undefined): string[] => (population && population.trim() ? [`Population studied: ${population.trim().replace(/[.]+$/, '')}.`] : []);
/** Notes for an outcome or symptom row: why it is borrowed, the population studied, and the row's caveats. */
export function evidenceRowNotes(row: NoteRow): string[] {
    return [...(row.tested_note ? [`${row.tested_note.replace(/[.]+$/, '')}.`] : []), ...populationNote(row.population), ...(row.caveats ?? [])];
}
/** Notes for a side-effect row: where a borrowed or extrapolated figure came from, then the row's caveats. */
export function harmRowNotes(row: { caveats?: string[]; level: string; population?: string; excess_window?: string; level_note?: string }): string[] {
    const provenance = row.level !== 'drug' ? populationNote(row.population).map(x => x.replace('Population studied:', 'Where this figure comes from:')) : [];
    return [...provenance, ...(row.caveats ?? [])];
}
/** Notes for a dose row, from the row's structured fields only (never its working notes): where the dose came from when it is not this drug's own trial, and the population it describes. */
export interface DoseLabelBasis { kind: 'target' | 'maximum' | 'none'; set_id: string; label: string; sentence: string }
export interface DoseNoteRow { level: string; drug_class?: string; dose_population?: string | null; full_credit_daily_mg: number | null; label_basis?: DoseLabelBasis }
/** The label of an intravenous iron product gives a dose per course, not a daily target (W9). The figures are the ones in the row's own label sentence (a check compares them). */
export const IV_IRON_PER_COURSE_TEXT = 'The label gives a per-course dose (750 mg twice, 1,500 mg total), not a daily target; full credit is given at any dose.';
/** What the "Evidence level" cell of a dose row says where no trial reported the dose reached (U14): the full-credit dose is the label's, or the label names none and credit is full at any dose. */
export function doseNotMeasuredText(a: DoseNoteRow): string | null {
    if (a.level !== 'not_measured') return null;
    if (a.label_basis?.kind === 'none') return a.drug_class === 'IV Iron' ? IV_IRON_PER_COURSE_TEXT : 'The label names no target dose, so full credit is given at any dose; the dose is not measured.';
    return `Full-credit dose is the label target dose; no trial reported the dose reached.${a.label_basis?.kind === 'maximum' ? ' Here the label gives a maximum recommended dose, and that is the dose used.' : ''}`;
}
export function doseRowNotes(a: DoseNoteRow): string[] {
    return [
        ...(a.level === 'siblingProxy' ? ['The dose reached was measured for another drug of the class (the trial column names it); it is used for this drug.'] : []),
        ...(a.level === 'not_measured' && a.label_basis ? [`Label: "${a.label_basis.sentence}" (${a.label_basis.label}; DailyMed set id ${a.label_basis.set_id}).`] : []),
        ...populationNote(a.dose_population ?? undefined),
    ];
}
/** The excess as the table prints it: per year unless the row covers a shorter window. */
export const excessText = (pct: number, window?: string): string => `${fmtPoints(pct)}%${window ? ` over ${window}` : ''}`;
