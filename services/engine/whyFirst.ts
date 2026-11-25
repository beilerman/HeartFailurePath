import type { ExcludedMedication, Medication, Patient, ScoredRegimen } from '../../types';
import { buildOutcomeEstimateViews } from './outcomeBenefit';
import { symptomEstimateFor } from './symptomBenefit';
import { harmBurdenFor, HARM_TABLE } from './harmBurden';
import { planCreditsFor } from './doseCredit';
import { sideEffectScore, SCORE_ADJUSTMENTS, DOMAIN_KEYS, type ScoreDomainKey } from './scoreModel';
import { buildExpectedEffect, fmtRR, fmtSigned, isNoChange } from './effectView';
import { pillarFamilyOf, type PillarKey } from './domains';
import { countVisitLimitChanges, isColdState, hasCongestion, regimenDosesADay, fmtDosesADay } from './regimenUtils';
import { brokenDisplayFloors, byScoreThenCost, plansAreDistinct, includesDiureticIntensification, type SelectionTrace, type PlanFate } from './selection';
import { RAAS_REDUCE_K, RAAS_WITHHOLD_K, TOO_CLOSE_TO_SEPARATE_POINTS } from './thresholds';
import { isAcutelyDecompensated } from '../clinicalPredicates';
import { SCOPE_HEAD } from './scopeGate';
import { capitalizeSentence } from './textCase';
import { MEDICATION_FORMULARY } from '../../constants';

// "Why this is first": plain sentences that say why each displayed option holds its place, in the units a clinician uses (relative risk, KCCQ-equivalent
// points, percent of patients a year, dollars a month, doses a day). Every number is read from the engine's own score breakdown and estimates; nothing
// is typed per patient. Explanation only: this module changes no score, order, eligibility rule or alert.

/** Alert headers that are care-gap prompts rather than safety stops (shared with the results screen). Everything else is treated as urgent. */
export const ADVISORY_ALERT_HEADS: readonly string[] = [
    'DEVICE THERAPY SCREENING', 'CARDIAC REHABILITATION', 'VERICIGUAT ELIGIBILITY WARNING', 'DATA NOTE',
    'SYMPTOMS AT REST WITHOUT RECORDED CONGESTION', 'NYHA CLASS AND FINDINGS DISAGREE', 'PARTIAL REVIEW', 'DATA REQUIRED', 'LABS REQUIRED', 'MEDICATION USE REVIEW', 'DOSE TIMING REVIEW', 'EXPOSURE HISTORY',
];
const KEEP_UPPER = ['CKD', 'AV', 'HF', 'ECG', 'SBP', 'DBP', 'NYHA', 'LVEF', 'ICD', 'ARNI', 'ACE', 'RAAS', 'MRA', 'SGLT2', 'QTC', 'K+', 'NT-PROBNP', 'IV'];
/** "THIRD-DEGREE AV BLOCK" -> "Third-degree AV block" (abbreviations stay in capitals). */
const BRAND_WORDS: string[] = MEDICATION_FORMULARY.map(m => /\(([^)]+)\)/.exec(m.name)?.[1]).filter((b): b is string => !!b && /^[A-Z][a-z]+$/.test(b));
export function headWords(head: string): string {
    const lower = head.toLowerCase().replace(/[a-z0-9+-]+/g, w => (KEEP_UPPER.includes(w.toUpperCase()) ? w.toUpperCase() : w));
    // R9 Z8: a brand name keeps its capital in a heading ("Entresto"), on the screen and in the packet alike.
    return BRAND_WORDS.reduce((x, b) => x.replace(new RegExp(`\\b${b.toLowerCase()}\\b`, 'g'), b), lower.charAt(0).toUpperCase() + lower.slice(1));
}
/** Headers of the alerts that stop or withhold a run, as opposed to prompts raised beside the options. */
export const STOP_HEAD = /INSTABILITY|\bSTOP\b|AV BLOCK|EMERGENCY|IMPLAUSIBLE|INPUT ERROR|NO DISPLAY-SAFE|NO REGIMEN CHANGE SHOWN|SICK SINUS|ANURIA/;
/**
 * Cardiac rehabilitation is offered "for stable HF patients" (R5 Y6): it is not shown beside acute decompensation, hypoxia, poor perfusion (or possible poor perfusion), a low output
 * state, any stop-state alert or a scope condition, nor (R6 V6, V19b) beside the two prompts that say the findings do not fit a stable patient: the class and the findings disagree, or congestion on
 * examination without a weight gain, and (R7 W13e) beside "VERY HIGH RISK ... admission is generally advised" and "SCALE AND EXAMINATION DISAGREE". This is the one list of alerts that mean "not stable". One principle decides membership (R8 X15e): an alert that says the patient may need urgent or specialist evaluation before exercise training (advanced heart failure, very high risk, decompensation, poor perfusion), or reports a vital sign that is abnormal and unexplained (a slow rate, low oxygen), is on the list; an alert about a drug, a device or a missing value is not.
 */
const NOT_STABLE_HEADS: readonly string[] = ['ACUTE DECOMPENSATION', 'HYPOXIA ALERT', 'POOR PERFUSION', 'POSSIBLE POOR PERFUSION', 'LOW OUTPUT STATE', "OUTSIDE THE TOOL'S SCOPE", 'NYHA CLASS AND FINDINGS DISAGREE', 'CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN', 'VERY HIGH RISK', 'SCALE AND EXAMINATION DISAGREE', 'ADVANCED HEART FAILURE ALERT', 'SLOW HEART RATE'];
export function withoutRehabilitationBesideInstability(alerts: string[]): string[] {
    const head = (a: string): string => { const i = a.indexOf(': '); return i > 0 ? a.slice(0, i) : a.slice(0, 40); };
    const unstable = alerts.some(a => NOT_STABLE_HEADS.includes(head(a)) || STOP_HEAD.test(head(a)));
    return unstable ? alerts.filter(a => head(a) !== 'CARDIAC REHABILITATION') : alerts;
}
/** The headers of the urgent alerts, in plain case ("Potassium hold on spironolactone"). */
export function urgentAlertHeads(alerts: string[]): string[] {
    const heads: string[] = [];
    for (const a of alerts) {
        const sep = a.indexOf(': ');
        if (sep <= 0) continue;
        const head = a.slice(0, sep);
        if (ADVISORY_ALERT_HEADS.includes(head) || head !== head.toUpperCase()) continue;
        heads.push(headWords(head));
    }
    return [...new Set(heads)];
}

export interface WhyLine {
    kind: 'versus_other' | 'versus_no_change' | 'order' | 'class_not_started' | 'no_change_reason' | 'shown_by_rule';
    text: string;
    /** True for a line the screen puts under the "More on why" disclosure (the always-visible part is the comparison with option 2 and with no change). */
    detail?: boolean;
}
export interface WhyOption { rank: number; lines: WhyLine[] }
export interface WhyGap {
    gap: string;
    pillar: PillarKey | null;
    /** Every drug of the class that no rule withholds for this patient (the drugs the clinician could start). */
    eligible: string[];
    /** One entry per displayed option: null when that option starts a drug of the class (or the class is withheld entirely), else the real reason it does not. */
    reasons: (string | null)[];
}
export interface WhyFirst {
    options: WhyOption[];
    gaps: WhyGap[];
    /** Set when no option was produced: which state withheld everything (never mentions an option). */
    stop?: string;
}

/** R9 Z5: the one sentence every screen with no medication option carries. It is true in every case: the tool proposes no option, and the alerts may ask the clinician to withhold, reduce or review a drug. */
export const NO_OPTION_SENTENCE = 'This tool proposes no medication option today. The alerts say why, and may ask you to withhold, reduce or review a drug.';
export const NO_OPTION_LEAD = 'This tool proposes no medication option today';
/** R10 A11b: said where the clinician set the limit of new drug classes per visit to 0 and no option is shown. */
export const LIMIT_ZERO_SENTENCE = 'The limit of new drug classes per visit is set to 0, so no new drug class can be started.';
/** The sentence for an empty result: the alerts raised by the stage that stopped the run, named in plain words. */
export function stopSentence(newAlerts: string[], limitedReview = false): string {
    // The scope gate (policy, scopeGate.ts) is a stop that nothing the clinician can enter today resolves: it has its own sentence.
    if (newAlerts.some(a => a.startsWith(`${SCOPE_HEAD}:`))) return 'This tool proposes no medication option today: a condition recorded for this patient is outside what the trials behind the tool studied (see the first alert). Alerts about the current regimen still apply, and may ask you to withhold, reduce or review a drug.';
    const all = urgentAlertHeads(newAlerts);
    const stops = newAlerts.filter(a => STOP_HEAD.test(a.slice(0, Math.max(0, a.indexOf(': ')))));
    const heads = stops.length > 0 ? urgentAlertHeads(stops) : all;
    if (limitedReview) return 'This tool proposes no medication option today because information needed for a medication decision is missing, so only a focused review is shown. Complete the items listed under "Decisions waiting for information".';
    if (newAlerts.some(a => a.startsWith('NO REGIMEN CHANGE SHOWN') && a.includes(LIMIT_ZERO_SENTENCE))) return `This tool proposes no medication option today: ${LIMIT_ZERO_SENTENCE.charAt(0).toLowerCase()}${LIMIT_ZERO_SENTENCE.slice(1)} Nothing else passed the tool's rules for this patient; raise the limit to see options for new drugs. The alerts may ask you to withhold, reduce or review a drug.`;
    if (heads.length > 0) return `This tool proposes no medication option today because of ${heads.length === 1 ? 'this safety or data state' : 'these safety or data states'}: ${heads.join('; ')}. Resolve ${heads.length === 1 ? 'it' : 'them'} and run the review again. The alerts may ask you to withhold, reduce or review a drug.`;
    return 'This tool proposes no medication option today: no change to the regimen passed the tool\'s rules for this patient. This is a limit of the tool, not a statement that nothing should be done. The alerts may ask you to withhold, reduce or review a drug.';
}

export interface WhyContext {
    patient: Patient;
    /** Every scored candidate (displayed or not). */
    candidates: ScoredRegimen[];
    picks: ScoredRegimen[];
    /** Drugs that passed eligibility (the formulary the options were built from). */
    eligibleFormulary: Medication[];
    excludedMeds: ExcludedMedication[];
    gdmtGaps: string[];
    unconfirmedUse: string[];
    doseTimingReview: string[];
    urgentAlertHeads: string[];
    /** What the selection did with every scored plan (selection.ts): the explanation counts and names these, it never re-derives them. */
    selection: SelectionTrace;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// numbers for one option

interface Opt {
    r: ScoredRegimen;
    death: number; hosp: number; kccq: number; burden: number; cost: number; doses: number;
    /** Side-effect burden change versus the current regimen, in points: the figure the option card's burden line prints. */
    burdenChange: number;
    /** True when this option is the "no change" plan, whose own figures are the baseline (relative risk 1.00, 0.0 points) and which is not shown as an option card. */
    isBaseline: boolean;
    harm: Map<string, { points: number; rate: number; drugs: Set<string> }>;
    /** True when the patient's potassium is in the severe-high band: a lower low-potassium charge is then never a reason to prefer an option (T1). */
    hyperkalemic: boolean;
}

const estimateCache = new WeakMap<ScoredRegimen, ScoredRegimen>();
/** The display-only estimates exist only for the displayed options; build the same ones for any other candidate, with the same engine functions. */
function withEstimates(r: ScoredRegimen, patient: Patient): ScoredRegimen {
    if (r.outcome_estimates && r.symptom_estimate && r.harm_burden) return r;
    const hit = estimateCache.get(r);
    if (hit) return hit;
    const hb = harmBurdenFor(HARM_TABLE, r.regimen, patient);
    const full: ScoredRegimen = {
        ...r,
        outcome_estimates: r.outcome_estimates ?? buildOutcomeEstimateViews(r.regimen, patient, r.modification_set),
        symptom_estimate: r.symptom_estimate ?? symptomEstimateFor(r.regimen, patient, r.modification_set ? planCreditsFor(r.modification_set, patient).creditFn : undefined),
        harm_burden: r.harm_burden ?? { ...hb, score: sideEffectScore(hb.burden) },
    };
    estimateCache.set(r, full);
    return full;
}

const dosesPerDay = (r: ScoredRegimen): number => regimenDosesADay(r.regimen);
const fmtDoses = fmtDosesADay;
/** The same format as the option card's cost line ("$12.34/month estimated"), so a figure quoted here is the figure printed there. */
const money = (x: number): string => `$${x.toFixed(2)}`;

function optOf(r0: ScoredRegimen, patient: Patient): Opt | null {
    const r = withEstimates(r0, patient);
    const v = buildExpectedEffect(r);
    if (!v) return null;
    const harm = new Map<string, { points: number; rate: number; drugs: Set<string> }>();
    for (const l of r.harm_burden!.lines) {
        const effect = l.kind === 'harm' ? l.effect : 'symptoms';
        const cur = harm.get(effect) ?? { points: 0, rate: 0, drugs: new Set<string>() };
        cur.points += l.points; cur.rate += l.kind === 'harm' ? l.charged_rate : l.figure; cur.drugs.add(l.drug);
        harm.set(effect, cur);
    }
    return { r, death: v.outcomes[0].rr, hosp: v.outcomes[1].rr, kccq: v.symptoms.delta, burden: r.harm_burden!.burden, burdenChange: v.sideEffects.burdenChange, isBaseline: isNoChange(r), cost: r.cost, doses: dosesPerDay(r), harm, hyperkalemic: patient.potassium >= RAAS_REDUCE_K };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// one factor that separates two options

interface Factor {
    key: string;
    /** Weighted score points in favour of the FIRST option of the pair (negative: in favour of the second). */
    weighted: number;
    /** Sentence fragment when `fav` is the favoured side and `other` the other; null when the displayed figures do not differ (so the sentence would be empty). */
    phrase: (fav: Opt, other: Opt, favIsFirst: boolean) => { verb: 'has' | 'is' | ''; text: string } | null;
}

/** A displayed figure read back as a number (the same rounding the screen prints), so a direction word is never chosen from a figure the reader cannot see. */
const shown = (x: number): number => Number(fmtRR(x));
const shownPts = (x: number): number => Math.round(x * 10) / 10;

/** Relative-risk comparison in words that are true for the displayed figures: a larger reduction only when both are below 1, a smaller increase when both are above 1, and the mixed cases said as they are (T6a). */
function riskPhrase(noun: string, f: number, o: number, baseline: boolean): { verb: 'has'; text: string } | null {
    const a = shown(f), b = shown(o);
    if (!(a < b)) return null;
    const fig = `relative risk ${fmtRR(f)} against ${fmtRR(o)}`;
    if (b < 1) return { verb: 'has', text: `a larger expected reduction in ${noun} (${fig})` };
    if (a > 1) return { verb: 'has', text: `a smaller expected increase in ${noun} (${fig})` };
    if (a < 1) return { verb: 'has', text: `an expected reduction in ${noun} (${fig}${baseline && b === 1 ? '' : `; ${b === 1 ? 'no effect' : 'an increase'}`})` };
    return { verb: 'has', text: `no expected increase in ${noun} (${fig}; an increase)` };
}
/** Health-status comparison, the same rules for a gain and a loss. */
function statusPhrase(f: number, o: number, baseline = false): { verb: 'has'; text: string } | null {
    const a = shownPts(f), b = shownPts(o);
    if (!(a > b)) return null;
    const fig = `${fmtSigned(f)} against ${fmtSigned(o)} KCCQ-equivalent points`;
    if (b > 0) return { verb: 'has', text: `a larger expected gain in health status (${fig})` };
    if (a < 0) return { verb: 'has', text: `a smaller expected loss in health status (${fig})` };
    if (b < 0) return { verb: 'has', text: `${a > 0 ? 'an expected gain' : 'no expected loss'} in health status (${fig}; ${a > 0 ? 'a loss' : 'a loss'})` };
    return { verb: 'has', text: `an expected gain in health status (${fig}${baseline ? '' : '; no effect'})` };
}

const DOMAIN_FACTORS: Partial<Record<ScoreDomainKey, Factor['phrase']>> = {
    mortality: (f, o) => riskPhrase('death', f.death, o.death, o.isBaseline),
    hf_hospitalization: (f, o) => riskPhrase('heart-failure hospitalization', f.hosp, o.hosp, o.isBaseline),
    symptoms: (f, o) => statusPhrase(f.kccq, o.kccq, o.isBaseline),
    side_effects: (f, o) => {
        // A smaller charge for LOW potassium is never a benefit in a patient whose potassium is already high (T1): it is left out of the comparison.
        const skipLowK = f.hyperkalemic || o.hyperkalemic;
        const lowK = (x: Opt) => (skipLowK ? x.harm.get('hypokalemia')?.points ?? 0 : 0);
        if (!((f.burden - lowK(f)) < (o.burden - lowK(o))) || fmtSigned(f.burdenChange) === fmtSigned(o.burdenChange) || !(shownPts(f.burdenChange) < shownPts(o.burdenChange))) return null;
        return { verb: 'has', text: `fewer side effects (side-effect burden ${fmtSigned(f.burdenChange)} against ${fmtSigned(o.burdenChange)} points)` };
    },
    // The money figures are printed only when both options are displayed (the option card prints each one's monthly cost); against the no-change plan the sentence says so without a figure.
    cost: (f, o) => (Number.isFinite(f.cost) && Number.isFinite(o.cost) && o.cost - f.cost >= 0.5
        ? { verb: 'is', text: o.isBaseline || f.isBaseline ? 'cheaper each month' : `cheaper each month (${money(f.cost)} against ${money(o.cost)})` } : null),
    adherence: (f, o) => (fmtDoses(f.doses) !== fmtDoses(o.doses) && f.doses < o.doses ? { verb: 'has', text: 'a lighter dosing burden (fewer doses a day)' } : null),
};

const ADJ_WORDS: Record<string, { gain?: string; avoid?: string }> = {
    SPECIAL_FEATURES: { gain: 'replaces a drug that the safety rules require to be replaced' },
    VOLUME_DEPLETION_DEESCALATION: { gain: 'reduces a diuretic, which the tool favours when the patient appears volume depleted' },
    PROJECTED_SBP_LT_85: { avoid: 'a projected systolic pressure below 85' },
    PROJECTED_SBP_LT_90: { avoid: 'a projected systolic pressure below 90' },
    PROJECTED_SBP_LT_95: { avoid: 'a projected systolic pressure below 95' },
    PROJECTED_HR_LT_50: { avoid: 'a projected heart rate below 50' },
    PROJECTED_K_GT_5_5: { avoid: 'a projected potassium above 5.5' },
};

function adjustmentTotals(r: ScoredRegimen): Map<string, { points: number; count: number }> {
    const m = new Map<string, { points: number; count: number }>();
    const bd = r.score_breakdown;
    if (!bd) return m;
    for (const a of bd.adjustments) {
        const cur = m.get(a.code) ?? { points: 0, count: 0 };
        cur.points += a.points; cur.count += a.code === SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS.code ? (a.detail ? a.detail.split(' | ').length : Math.round(a.points / SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS.perUnit)) : 1;
        m.set(a.code, cur);
    }
    for (const o of bd.overrides ?? []) if (o.applies_to === 'raw_score') { const cur = m.get(o.code) ?? { points: 0, count: 0 }; cur.points += o.after - o.before; m.set(o.code, cur); }
    return m;
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n);

function factorsOf(a: Opt, b: Opt): Factor[] {
    const out: Factor[] = [];
    const da = a.r.score_breakdown, db = b.r.score_breakdown;
    if (!da || !db) return out;
    for (const key of DOMAIN_KEYS) {
        const phrase = DOMAIN_FACTORS[key];
        const x = da.domains.find(d => d.key === key), y = db.domains.find(d => d.key === key);
        if (!phrase || !x || !y) continue;
        out.push({ key, weighted: x.contribution - y.contribution, phrase });
    }
    const ta = adjustmentTotals(a.r), tb = adjustmentTotals(b.r);
    for (const code of new Set([...ta.keys(), ...tb.keys()])) {
        const pa = ta.get(code) ?? { points: 0, count: 0 }, pb = tb.get(code) ?? { points: 0, count: 0 };
        const weighted = pa.points - pb.points;
        if (code === SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS.code) {
            out.push({ key: code, weighted, phrase: (_f, _o, favIsFirst) => {
                const nf = (favIsFirst ? pa : pb).count, no = (favIsFirst ? pb : pa).count;
                // Two plain clauses, one for each option; {me} and {you} are replaced with the option names where the sentence is put together.
                const warn = (k: number): string => (k === 1 ? 'one unresolved safety warning' : `${countWord(k)} unresolved safety warnings`);
                return nf < no ? { verb: '', text: nf === 0 ? `carries no unresolved safety warning, while {you} carries ${warn(no)}` : `carries ${warn(nf)}, while {you} carries ${warn(no)}` } : null;
            } });
        } else {
            const words = ADJ_WORDS[code];
            out.push({ key: code, weighted, phrase: (_f, _o, favIsFirst) => {
                const mine = (favIsFirst ? pa : pb).points, theirs = (favIsFirst ? pb : pa).points;
                if (!words || mine <= theirs) return null;
                if (mine > 0) return words.gain ? { verb: '', text: words.gain } : null;
                return words.avoid ? { verb: '', text: `avoids ${words.avoid}` } : null;
            } });
        }
    }
    return out;
}

/** A factor is cited as a reason only if its weighted contribution to the score difference is at least this many points, or it is the single largest contribution (T6b). */
export const MIN_CITED_POINTS = 0.5;
type Phrase = { verb: 'has' | 'is' | ''; text: string };
/** The cited factors for each side, largest weighted effect first. */
interface Comparison { self: Phrase[]; other: Phrase[]; rawDiff: number }

/** The factors that separate `self` from `other`, largest weighted effect first (T6b: only those at least MIN_CITED_POINTS, or the single largest when the plans are separable). */
function compare(self: Opt, other: Opt): Comparison {
    const fs = factorsOf(self, other);
    const rawDiff = (self.r.raw_score ?? self.r.overall_score) - (other.r.raw_score ?? other.r.overall_score);
    const separable = Math.abs(rawDiff) >= TOO_CLOSE_TO_SEPARATE_POINTS;
    const largestAll = Math.max(...fs.map(f => Math.abs(f.weighted)), 0);
    const pick = (sorted: Factor[], fav: Opt, oth: Opt, favIsFirst: boolean): Phrase[] => {
        const withText = sorted.map(f => ({ f, p: f.phrase(fav, oth, favIsFirst) })).filter(x => x.p !== null);
        let chosen = withText.filter(x => Math.abs(x.f.weighted) >= MIN_CITED_POINTS);
        // Two options that differ by a point or more but whose difference is spread over many small factors: the single largest one is the reason.
        if (chosen.length === 0 && separable && withText.length > 0 && favIsFirst && Math.abs(withText[0].f.weighted) >= largestAll - 1e-9) chosen = [withText[0]];
        return chosen.map(x => x.p!);
    };
    const forSelf = fs.filter(f => f.weighted > 0).sort((a, b) => b.weighted - a.weighted);
    const forOther = fs.filter(f => f.weighted < 0).sort((a, b) => a.weighted - b.weighted);
    // For the other side the phrase is read from the other option's point of view: `favIsFirst` false.
    return { self: pick(forSelf, self, other, true), other: pick(forOther, other, self, false), rawDiff };
}

const joinPhrases = (name: string, you: string, ph: Phrase[]): string => `${name} ${ph.map((p, k) => (k > 0 && ph[k - 1].verb === p.verb ? p.text : `${p.verb ? `${p.verb} ` : ''}${p.text}`)).join(' and ')}`.split('{me}').join(name).split('{you}').join(you);
/** The always-visible sentence body: the largest reason for each side. */
const headline = (c: Comparison, selfName: string, otherName: string): string => [c.self.length ? joinPhrases(selfName, otherName, c.self.slice(0, 1)) : '', c.other.length ? joinPhrases(otherName, selfName, c.other.slice(0, 1)) : ''].filter(Boolean).join('; ');
/** Everything beyond the headline, for the "More on why" disclosure. */
const furtherPhrases = (c: Comparison, selfName: string, otherName: string): string => [c.self.length > 1 ? joinPhrases(selfName, otherName, c.self.slice(1)) : '', c.other.length > 1 ? joinPhrases(otherName, selfName, c.other.slice(1)) : ''].filter(Boolean).join('; ');

// ---------------------------------------------------------------------------------------------------------------------------------
// why this order

const ord = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').length;
/** The tie-break actually used, in a clinician's words and with no figures that the screen does not print. */
function orderReason(a: Opt, b: Opt, aName: string): string | null {
    if (byScoreThenCost(a.r, b.r) >= 0) return null;
    if (a.r.overall_score !== b.r.overall_score || Math.round((a.r.raw_score ?? 0) * 1e9) !== Math.round((b.r.raw_score ?? 0) * 1e9)) return `${aName} is listed first because its score is slightly higher`;
    if (a.cost !== b.cost) return `${aName} is listed first because it is cheaper`;
    if (ord(a.r) !== ord(b.r)) return `${aName} is listed first because it makes fewer changes to the current regimen`;
    return `${aName} is listed first because everything else is equal, so the drugs are put in alphabetical order`;
}

/** The sentences for `self` against `other` (at most two; any further reasons come back as `more`). `selfFirst`: self is listed ahead of other. Says so plainly when the two cannot be separated. */
function versusSentence(self: Opt, other: Opt, selfName: string, otherName: string, selfFirst: boolean): { text: string; more: string } {
    const c = compare(self, other);
    const parts: string[] = [];
    const lead = selfFirst ? self : other, trail = selfFirst ? other : self;
    const leadName = selfFirst ? selfName : otherName;
    const body = headline(c, selfName, otherName);
    const more = furtherPhrases(c, selfName, otherName);
    if (Math.abs(c.rawDiff) < TOO_CLOSE_TO_SEPARATE_POINTS) {
        const why = orderReason(lead, trail, leadName);
        parts.push(`${cap(selfName)} and ${otherName} are too close to separate${why ? `; ${why}` : ''}.`);
        // Only the figures that reach half a point are quoted; when none does the sentence above stands alone.
        if (body) parts.push(`Compared with ${otherName}: ${body}.`);
        return { text: parts.join(' '), more };
    }
    parts.push(body ? `Compared with ${otherName}: ${body}.` : `Compared with ${otherName}: no displayed figure differs.`);
    return { text: parts.join(' '), more };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// classes the option does not start

const modsOf = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
const startsPillar = (r: ScoredRegimen, p: PillarKey): string[] =>
    modsOf(r).filter(m => (m.action === 'add' || m.action === 'swap') && m.target && pillarFamilyOf(m.target.med.drug_class) === p).map(m => m.target!.med.name);
export const pillarOfGapLabel = (gap: string, pillarLabels: Record<PillarKey, string>): PillarKey | null =>
    (Object.keys(pillarLabels) as PillarKey[]).find(k => gap.startsWith(pillarLabels[k])) ?? null;

const FAMILY_WORDS: Record<PillarKey, string> = { RAAS: 'a RAAS inhibitor', BB: 'a beta-blocker', MRA: 'an MRA', SGLT2i: 'an SGLT2 inhibitor' };
const cap = (t: string): string => capitalizeSentence(t);
const list = (xs: string[]): string => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

const fateOf = (ctx: WhyContext, c: ScoredRegimen): PlanFate => ctx.selection.fates.get(c) ?? 'not_distinct';
/** The plan every other option is held against, in words: "making no change" when an exact no-change plan exists, else the plan that makes only the changes the safety rules require. */
const baselineWords = (ctx: WhyContext): string => (ctx.selection.baseline && ord(ctx.selection.baseline) === 0 ? 'making no change' : 'the plan that makes only the required changes');

/** The state of the patient that itself stops every start of this class today (the rule that excluded the plans), or null when none does. Only rules the engine really applies are named. */
export function startBlockReason(patient: Patient, p: PillarKey): string | null {
    if (isColdState(patient)) return 'no drug is started while the patient shows signs of poor perfusion';
    if (patient.potassium >= RAAS_WITHHOLD_K) return `no drug is started at a potassium of ${RAAS_WITHHOLD_K.toFixed(1)} or above`;
    if (p === 'BB' && isAcutelyDecompensated(patient)) return 'no beta-blocker is started during acute decompensation';
    return null;
}

/** One short reason that option `i` does not start class `p` (T19: one line per class, no figures for plans that are not displayed, T6e: a plan that is not displayed is said not to be). */
function classReason(ctx: WhyContext, i: number, p: PillarKey): string {
    const here = ctx.picks[i];
    const name = `option ${i + 1}`;
    const out: string[] = [];
    // the per-visit limit
    const limit = Math.max(0, Math.round(ctx.patient.max_new_classes_per_visit ?? 2));
    const current = ctx.patient.current_regimen ?? [];
    // R8 X8d: "adding it means dropping one" is said only where adding the class is otherwise possible; where a state stops the start (acute decompensation for a beta-blocker) the line gives that real reason alone.
    if (here.modification_set && countVisitLimitChanges(here.modification_set, current) >= limit && limit > 0 && !startBlockReason(ctx.patient, p)) {
        const counted = modsOf(here).filter(m => (m.action === 'add' || m.action === 'swap') && !m.mandatory && m.target).map(m => m.target!.med.name.replace(/\s*\([^)]*\)/g, ''));
        out.push(`${cap(name)} already uses the limit of ${limit} new drug class${limit === 1 ? '' : 'es'} (${list([...new Set(counted)])}); adding ${FAMILY_WORDS[p]} means dropping one.`);
    }
    // where it appears instead
    const elsewhere = ctx.picks.map((r, j) => ({ j, drugs: startsPillar(r, p) })).filter(x => x.j !== i && x.drugs.length > 0);
    if (elsewhere.length > 0) {
        out.push(`It appears in ${list(elsewhere.map(x => `option ${x.j + 1} (${list([...new Set(x.drugs)])})`))}.`);
        return out.join(' ');
    }
    const withClass = ctx.candidates.filter(c => startsPillar(c, p).length > 0).sort(byScoreThenCost);
    if (withClass.length === 0) {
        // Only a state that really stops the start is named; the advisory alerts (atrial fibrillation, advanced heart failure, device) block nothing.
        const rule = startBlockReason(ctx.patient, p);
        out.push(rule ? `Not started: ${rule}.` : `No plan that starts it passed the tool's safety checks today.`);
        return out.join(' ');
    }
    // The plan that starts the class and was best placed to be shown: among the plans no display-safety floor withheld, the best scoring. Its own fate is the reason (U7): a plan
    // is never called "lower scoring" unless it is, and a plan hidden because it repeats a shown option's step is said to be exactly that.
    const absent = (names: string) => `A plan that starts it (${names}) is not among the options shown`;
    const usable = withClass.filter(c => fateOf(ctx, c) !== 'unsafe');
    if (usable.length === 0) {
        const best = withClass[0];
        const floors = brokenDisplayFloors(best, ctx.patient);
        out.push(`${absent(list([...new Set(startsPillar(best, p))]))}: it projected ${floors.join(' or ')}.`);
        return out.join(' ');
    }
    const best = usable[0];
    const bestNames = list([...new Set(startsPillar(best, p))]);
    out.push(`${absent(bestNames)}: ${planFateReason(ctx, best)}.`);
    return out.join(' ');
}

/**
 * Why an eligible adjunct (a criteria-met add-on listed under "other eligible therapy") is not in any option shown (R6 V15a): the fate of the best-scoring plan that starts it, in the same words the class
 * reasons use. Null when an option shown starts it. The patient met the tool's own criteria, so the list entry must say why no option carries it.
 */
export function adjunctNotShownReason(ctx: WhyContext, drugNames: string[]): string | null {
    const startsIt = (c: ScoredRegimen) => modsOf(c).some(m => (m.action === 'add' || m.action === 'swap') && m.target && drugNames.includes(m.target.med.name));
    if (ctx.picks.some(startsIt)) return null;
    const plans = ctx.candidates.filter(startsIt).sort(byScoreThenCost);
    if (plans.length === 0) return "no plan that starts it passed the tool's safety checks today";
    const best = plans[0];
    const tie = Math.abs((best.raw_score ?? best.overall_score) - ((ctx.selection.baseline?.raw_score ?? ctx.selection.baseline?.overall_score) ?? Number.NaN)) < TOO_CLOSE_TO_SEPARATE_POINTS;
    const f = fateOf(ctx, best);
    // A plan within the tie threshold of no change is not separated from it: that, not its fate label, is the reason.
    if (tie && ctx.selection.baseline && ord(ctx.selection.baseline) === 0 && f !== 'unsafe' && f !== 'over_budget') return `the plan that starts it scores within ${TOO_CLOSE_TO_SEPARATE_POINTS === 1 ? 'one point' : `${TOO_CLOSE_TO_SEPARATE_POINTS} points`} of making no change, which is closer than the tool can separate, so it is not listed as an option`;
    if (f === 'over_budget' && typeof ctx.patient.max_affordable_cost === 'number' && Number.isFinite(best.cost)) {
        const fig = (x: number) => money(x).replace(/\.00$/, '');
        // W13c: when every option shown is over the budget too (the fallback), "over the stated budget" would say the shown options fit it: say what is true of both.
        const fallback = ctx.picks.some(pk => pk.warnings.some(w => w.startsWith('BUDGET EXCEEDED')));
        if (fallback) return `the plan that starts it costs ${fig(best.cost)} a month; nothing fits the stated budget of ${fig(ctx.patient.max_affordable_cost)}, and the options shown are the least costly`;
        return `the plan that starts it costs ${fig(best.cost)} a month, over the stated budget of ${fig(ctx.patient.max_affordable_cost)}`;
    }
    return planFateReason(ctx, best);
}

/** What became of a plan that is not displayed, in words that are true of that plan (U1, U7). */
function planFateReason(ctx: WhyContext, c: ScoredRegimen): string {
    const f = fateOf(ctx, c);
    switch (f) {
        case 'unsafe': return `it projected ${brokenDisplayFloors(c, ctx.patient).join(' or ')}`;
        case 'over_budget': {
            const b = ctx.patient.max_affordable_cost;
            if (typeof b !== 'number' || !Number.isFinite(c.cost) || !Number.isFinite(b)) return 'it is over the stated budget';
            const fig = (x: number) => money(x).replace(/\.00$/, '');
            return ctx.picks.some(pk => pk.warnings.some(w => w.startsWith('BUDGET EXCEEDED')))
                ? `its plan: ${fig(c.cost)} a month; nothing fits the budget`
                : `its plan costs ${fig(c.cost)} a month, over budget`;
        }
        case 'below_baseline': return `it scores below ${baselineWords(ctx)}`;
        case 'not_distinct': {
            const j = ctx.picks.findIndex(pk => !plansAreDistinct(c, pk));
            return j >= 0 ? `it differs from option ${j + 1} only in the drug or dose used` : 'it is not different enough from an option shown to be listed separately';
        }
        case 'beyond_limit': return 'it ranks below the three options shown';
        case 'displaced': return 'the congestion display rule used its place';
        default: return 'it is shown';
    }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the first option is "no medication change", or the only one shown

/** Headers of alerts that are advisories or prompts and stop nothing: never called a "safety alert in force" (T6d). */
const NOT_A_GATE_HEADS: readonly string[] = [...ADVISORY_ALERT_HEADS, 'ATRIAL FIBRILLATION', 'ADVANCED HEART FAILURE ALERT'];
const safetyAlertHeads = (ctx: WhyContext): string[] => ctx.urgentAlertHeads.filter(h => !NOT_A_GATE_HEADS.some(x => headWords(x) === h)).map(h => h.replace(/\s*\([^)]*\)/g, ''));

/** Reasons for a withheld class that come from missing information (also used when only one option is shown). */
function missingInfoReasons(ctx: WhyContext, familyLabel: (cls: string) => string): string[] {
    const out: string[] = [];
    // In a potassium emergency (U12) the iron information is not part of the explanation: nothing is started or raised, so what iron needs is not what the clinician is waiting on.
    const info = ctx.excludedMeds.filter(m => (m.rule_id === 'E12' || m.rule_id === 'E16') && !(m.drug_class === 'IV Iron' && ctx.patient.potassium >= RAAS_WITHHOLD_K));
    const byReason = new Map<string, Set<string>>();
    // R6 V7: a class is said to be withheld only when every drug of it is. When another drug of the class can still be started (an option may start it), the drugs that are withheld are named instead.
    const classStillOpen = (label: string) => ctx.eligibleFormulary.some(e => familyLabel(e.drug_class) === label);
    // R8 X15g: drugs and classes are named in clinical words, one way, read from the formulary (no drug name is written here): generic names in lower case, a brand-only entry (a short-course add-on such as
    // Furoscix) with its capital, and a class by the generic names of its drugs (digoxin, not "Inotrope").
    const plainName = (name: string) => { const m = MEDICATION_FORMULARY.find(x => x.name === name); const first = name.replace(/\s*\(.*\)/, ''); return m?.facts?.short_course_addon ? first : first.toLowerCase(); };
    const CLASS_WORDS: Record<string, string> = {};
    for (const cls of new Set(MEDICATION_FORMULARY.map(m => m.drug_class))) {
        const members = MEDICATION_FORMULARY.filter(m => m.drug_class === cls && !m.facts?.short_course_addon);
        if (members.length === 1) CLASS_WORDS[cls] = plainName(members[0].name);
    }
    Object.assign(CLASS_WORDS, { 'Thiazide-like Diuretic': 'thiazide-type diuretics', 'Loop Diuretic': 'loop diuretics', 'K+ Binder': 'potassium binders', 'IV Iron': 'IV iron', 'Vasodilator': 'hydralazine with isosorbide dinitrate', 'GLP-1 RA': 'GLP-1 receptor agonists', 'GLP-1/GIP RA': 'GLP-1/GIP receptor agonists' });
    for (const m of info) {
        const reason = m.reason.replace(/^Information required before starting:\s*/i, '').trim();
        if (!byReason.has(reason)) byReason.set(reason, new Set());
        const label = familyLabel(m.drug_class);
        byReason.get(reason)!.add(classStillOpen(label) ? plainName(m.name) : (CLASS_WORDS[label] ?? label));
    }
    for (const [reason, fams] of byReason) out.push(`Starting ${list([...fams])} is withheld because information is missing: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}.`);
    return out;
}

function noChangeReasons(ctx: WhyContext, familyLabel: (cls: string) => string): string[] {
    const out: string[] = [];
    const heads = safetyAlertHeads(ctx);
    if (heads.length > 0) out.push(`Safety alerts are in force (${list(heads)}); read them before any change.`);
    if (ctx.unconfirmedUse.length > 0) out.push(`The use and course history of ${list(ctx.unconfirmedUse)} is not confirmed, so no dose increase or substitution of ${ctx.unconfirmedUse.length === 1 ? 'it is' : 'them is'} offered until it is confirmed.`);
    if (ctx.doseTimingReview.length > 0) out.push(`The time at the current dose of ${list(ctx.doseTimingReview)} has not been reviewed, so no increase of ${ctx.doseTimingReview.length === 1 ? 'it is' : 'them is'} offered yet.`);
    out.push(...missingInfoReasons(ctx, familyLabel));
    return out;
}

/** Why only one option is shown: every other plan the tool scored, counted under what the selection did with it. The counts add up to the number of other plans scored (U1). */
function onlyOneReason(ctx: WhyContext): string {
    const others = ctx.candidates.filter(c => fateOf(ctx, c) !== 'shown');
    if (others.length === 0) return 'Only one option is shown: the tool built no other plan that passed its safety checks for this patient today.';
    const group = (f: PlanFate) => others.filter(c => fateOf(ctx, c) === f);
    const was = (n: number) => (n === 1 ? 'was' : 'were');
    const parts: string[] = [];
    const below = group('below_baseline'), unsafe = group('unsafe'), budget = group('over_budget'), same = group('not_distinct'), beyond = group('beyond_limit'), displaced = group('displaced');
    if (below.length > 0) parts.push(`${below.length} scored below ${baselineWords(ctx)}`);
    if (unsafe.length > 0) parts.push(`${unsafe.length} ${was(unsafe.length)} withheld because ${unsafe.length === 1 ? 'it' : 'they'} projected ${list([...new Set(unsafe.flatMap(c => brokenDisplayFloors(c, ctx.patient)))])}`);
    if (budget.length > 0) parts.push(`${budget.length} ${budget.length === 1 ? 'is' : 'are'} over the stated budget`);
    if (same.length > 0) parts.push(`${same.length} ${was(same.length)} not different enough from this option to be listed separately`);
    if (beyond.length > 0) parts.push(`${beyond.length} ranked below the options shown`);
    if (displaced.length > 0) parts.push(`${displaced.length} ${was(displaced.length)} replaced by the congestion display rule`);
    const n = others.length;
    return `Only one option is shown: of the ${n} other plan${n === 1 ? '' : 's'} scored, ${parts.join('; ')}.`;
}

// ---------------------------------------------------------------------------------------------------------------------------------

export function buildWhyFirst(ctx: WhyContext, pillarLabels: Record<PillarKey, string>, familyLabel: (cls: string) => string): WhyFirst | undefined {
    const { picks, patient } = ctx;
    if (picks.length === 0) return undefined;
    const cache = new Map<number, Opt | null>();
    const optOfRank = (j: number): Opt | null => { if (!cache.has(j)) cache.set(j, optOf(picks[j], patient)); return cache.get(j)!; };
    const noChange = ctx.candidates.find(c => ord(c) === 0);
    const options: WhyOption[] = picks.map((r, i) => {
        const lines: WhyLine[] = [];
        const me = optOfRank(i);
        const first = i === 0;
        if (r.shown_because) lines.push({ kind: 'shown_by_rule', text: `This option is shown under a display rule, not because it ranks next: ${r.shown_because}` });
        if (first) {
            if (me && picks.length > 1) {
                const second = optOfRank(1);
                if (second) { const v = versusSentence(me, second, 'option 1', isNoChange(picks[1]) ? 'option 2 (no medication change)' : 'option 2', true); lines.push({ kind: 'versus_other', text: v.text }); if (v.more) lines.push({ kind: 'versus_other', text: `Also against option 2: ${v.more}.`, detail: true }); }
            } else if (picks.length === 1) {
                lines.push({ kind: 'order', text: onlyOneReason(ctx) });
                // (when the one option is "no change", the same reasons are listed with the no-change reasons below)
                if (!isNoChange(r)) for (const t of missingInfoReasons(ctx, familyLabel)) lines.push({ kind: 'no_change_reason', text: t, detail: true });
            }
            // U15: said first; the tie rule was not applied (congestion is recorded and the best option raises or starts a diuretic).
            if (ctx.selection.congestionException && !isNoChange(r)) lines.unshift({ kind: 'order', text: 'This option is within one point of no change; it stays first because congestion is recorded and the tool does not model congestion relief from a diuretic, so the score cannot show that benefit.' });
            // Option 2 is itself "no medication change": the comparison above is that comparison; it is not printed a second time (W6d).
            if (me && noChange && !isNoChange(r) && !(picks.length > 1 && isNoChange(picks[1]))) {
                const nc = optOf(noChange, patient);
                if (nc) {
                    const c = compare(me, nc);
                    lines.push({ kind: 'versus_no_change', text: `Compared with making no medication change: ${headline(c, 'option 1', 'no change') || 'no displayed figure differs'}.`, ...(ctx.selection.congestionException ? { detail: true } : {}) });
                    const more = furtherPhrases(c, 'option 1', 'no change');
                    if (more) lines.push({ kind: 'versus_no_change', text: `Also against no change: ${more}.`, detail: true });
                }
            }
            if (isNoChange(r)) {
                const reasons = noChangeReasons(ctx, familyLabel);
                if (picks.length === 1) {
                    const others = ctx.candidates.filter(c => fateOf(ctx, c) !== 'shown' && ord(c) > 0);
                    if (others.length > 0) {
                        const best = [...others].sort(byScoreThenCost)[0];
                        reasons.unshift(`The best-scoring other plan (${modsOf(best).map(m => m.summary.split(' (')[0]).join('; ')}) is not among the options shown: ${planFateReason(ctx, best)}.`);
                    } else if (reasons.length === 0) reasons.push('No other change passed the tool\'s rules for this patient today.');
                }
                // U4: said first, before the comparison; the other reasons then go under "More on why" so the visible part stays at three sentences.
                const leadsByRule = ctx.selection.noChangeLeads;
                // W6b: "no change" leads (by the tie rule or by score) while congestion is recorded: the ranking cannot weigh congestion relief by a diuretic, and the clinician is told which option is the diuretic one.
                const congested = hasCongestion(patient);
                const dj = congested ? picks.findIndex((x, idx) => idx > 0 && includesDiureticIntensification(x)) : -1;
                const congestionClause = `the tool does not model congestion relief from a diuretic, so this ranking does not weigh it${dj >= 0 ? `; the option that adds or raises a diuretic is option ${dj + 1}` : ''}`;
                // One sentence (the always-visible part stays at three sentences): the tie statement, with the congestion clause inside it when both apply (W6a, W6b).
                // R5 Y9: a display-safe plan above the stated budget that scores the tie threshold or more above no change is named in the visible sentence, with its monthly cost: the comparison is among the options within the budget.
                const aboveBudget = leadsByRule ? ctx.candidates.filter(c => fateOf(ctx, c) === 'over_budget' && brokenDisplayFloors(c, patient).length === 0 && (c.raw_score ?? 0) - (r.raw_score ?? 0) >= TOO_CLOSE_TO_SEPARATE_POINTS)
                    .sort((a, b) => (b.raw_score ?? 0) - (a.raw_score ?? 0) || a.cost - b.cost)[0] : undefined;
                // R6 V4: in the over-budget fallback every shown option is above the budget, so "this compares only options within the budget" is false there: the sentence says nothing fits and the options shown are the least costly safe ones.
                const inFallback = r.warnings.some(w => w.startsWith('BUDGET EXCEEDED'));
                const aboveNamed = aboveBudget ? `${modsOf(aboveBudget).map(m => m.summary.split(' (')[0]).join('; ')}; $${Math.round(aboveBudget.cost)} a month` : '';
                const budgetClause = aboveBudget && typeof patient.max_affordable_cost === 'number'
                    ? (inFallback
                        ? `; nothing fits the stated budget of $${Math.round(patient.max_affordable_cost)}, so the options shown are the least costly safe ones, and ${aboveBudget.cost > r.cost ? 'a costlier plan' : 'another plan'} (${aboveNamed}) scores higher`
                        : ctx.candidates.some(c => !Number.isFinite(c.cost))
                            ? `; costs are incomplete, and a plan known to exceed the stated budget (${aboveNamed}) scores higher`
                            : `; this compares only options within the stated budget of $${Math.round(patient.max_affordable_cost)}, and a plan above it (${aboveNamed}) scores higher`)
                    : inFallback && typeof patient.max_affordable_cost === 'number' ? `; nothing fits the stated budget of $${Math.round(patient.max_affordable_cost)}, so the options shown are the least costly safe ones` : '';
                if (leadsByRule) lines.unshift({ kind: 'no_change_reason', text: `No option scores ${TOO_CLOSE_TO_SEPARATE_POINTS === 1 ? '1 point' : `${TOO_CLOSE_TO_SEPARATE_POINTS} points`} or more above leaving the regimen unchanged, which is closer than the tool can separate${congested ? `; ${congestionClause}` : ''}${budgetClause}${picks.length > 1 ? '; the alternatives below are shown for discussion' : ''}.` });
                else if (congested) lines.push({ kind: 'no_change_reason', text: `${cap(congestionClause)}.` });
                if (reasons.length === 0) reasons.push('No change is listed first because it scored at least as well as every other plan the tool considered.');
                // The first two reasons are always visible; any further reason is under "More on why".
                reasons.forEach((t, k) => lines.push({ kind: 'no_change_reason', text: t, ...(k >= (leadsByRule ? 0 : congested ? 1 : 2) ? { detail: true } : {}) }));
            }
        } else {
            const lead = optOfRank(0);
            if (me && lead) { const v = versusSentence(me, lead, `option ${i + 1}`, 'option 1', false); lines.push({ kind: 'versus_other', text: v.text }); if (v.more) lines.push({ kind: 'versus_other', text: `Also against option 1: ${v.more}.`, detail: true }); }
        }
        return { rank: i + 1, lines: lines.map(l => ({ ...l, text: cap(l.text) })) };
    });
    const gaps: WhyGap[] = ctx.gdmtGaps.map(gap => {
        const pillar = pillarOfGapLabel(gap, pillarLabels);
        const eligible = pillar ? [...new Set(ctx.eligibleFormulary.filter(m => pillarFamilyOf(m.drug_class) === pillar).map(m => m.name))] : [];
        const reasons = picks.map((r, i) => {
            if (!pillar || eligible.length === 0) return null;
            if (startsPillar(r, pillar).length > 0) return null;
            return classReason(ctx, i, pillar);
        });
        return { gap, pillar, eligible, reasons: reasons.map(t => (t ? cap(t) : t)) };
    });
    // Option 1's class lines go under "More on why", one short line per class (T19).
    gaps.forEach(g => { const t = g.reasons[0]; if (t && g.pillar) options[0].lines.push({ kind: 'class_not_started', text: `${g.gap.split(' (')[0]}: ${cap(t)}`, detail: true }); });
    return { options, gaps };
}
