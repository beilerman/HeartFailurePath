/**
 * Outcome benefit from trial relative risks (wired into the mortality and hf_hospitalization domains; this module is pure and deterministic).
 *
 * ENGINE POLICY: expected outcome benefit is scored from published relative risks (population averages), never by altering the patient's recorded
 * measurements. Each drug in a regimen carries a trial relative risk (RR) for a stated outcome in the patient's EF band; the regimen's expected
 * relative risk is the product of the counted drugs' DOSE-ADJUSTED relative risks, one per mechanism group:
 *
 *     dose-adjusted RR_i = rr_i ^ credit_i        (credit from outcomeDoseCredit, doseCredit.ts: c0 at the label starting dose, rising to 1.0 at the trial-achieved dose, proportionally less below the starting dose)
 *     ln RR_regimen      = sum_i credit_i * ln rr_i
 *     score              = clamp(100 * (1 - RR), 0, 100)      (percent risk reduction versus no disease-modifying therapy)
 *
 * The 95% interval is on the log scale and ASSUMES INDEPENDENT estimates (an approximation: pillars were trialled on top of one another, so true
 * joint uncertainty is not simply additive). se_i = (ln ci_high - ln ci_low) / 3.92, 0 when a row has no interval; var = sum (credit_i * se_i)^2;
 * bounds = exp(ln RR -/+ 1.96 sqrt(var)). Rows without an interval are reported, because their uncertainty is then understated.
 *
 * Everything here is deterministic and side-effect free. A missing evidence row throws (OutcomeEvidenceError): it must never silently become RR 1.0.
 */
import type { Medication, Patient, RegimenMed } from '../../types';
import { isImprovedEF } from './domains';
import { getMedicationClassGroup } from './registry';
import { outcomeDoseCredit, planCreditsFor } from './doseCredit';
import { hasCongestion } from './regimenUtils';
import { shrinkValue, tau2From, median } from './shrinkage';
import { valueUnknown, isBlackRace } from '../clinicalPredicates';
import { isActiveExposure } from './medicationExposure';
import type { OutcomeEstimateView, OutcomeContributorView } from '../../types';
import outcomeEvidenceJson from '../../data/outcomeEvidence.json';

export type OutcomeKey = 'all_cause_death' | 'hf_hospitalization';
export type EfBand = 'reduced' | 'mildly_reduced' | 'preserved';

export interface OutcomeEvidenceRow {
    id: string;
    drug_class: string;
    drugs: string[];
    ef_band: EfBand;
    outcome: OutcomeKey;
    rr: number;
    ci_low: number | null;
    ci_high: number | null;
    measure: 'HR' | 'RR' | 'OR' | 'rate_ratio';
    basis: 'trial' | 'meta_analysis' | 'extrapolated' | 'assumed_neutral';
    source: { trial: string; citation: string; pmid?: string };
    population: string;
    comparator: string;
    verification: string;
    quote: string;
    extrapolation: string;
    notes: string;
    population_key?: string;
}

/** The single evidence table the engine reads (data/outcomeEvidence.json, 108 rows). */
export const OUTCOME_EVIDENCE_TABLE: OutcomeEvidenceRow[] = outcomeEvidenceJson as unknown as OutcomeEvidenceRow[];

import type { CreditFn } from './doseCredit';

export { outcomeDoseCredit };
const fullCredit: CreditFn = () => 1;

export class OutcomeEvidenceError extends Error {
    constructor(public readonly code: 'missing' | 'duplicate', message: string) {
        super(message);
        this.name = 'OutcomeEvidenceError';
    }
}

/**
 * The EF band whose trial evidence applies to this patient.
 *   reduced:        LVEF <= 40, OR improved EF (isImprovedEF: prior LVEF <= 40, now higher).
 *   mildly_reduced: LVEF 41-49, OR LVEF >= 50 with a recorded prior LVEF of 41-49.
 *   preserved:      otherwise.
 * ENGINE POLICY: treating an improved EF at its EARLIER band is an extrapolation - the trials enrolled patients at the lower EF, and the
 * guideline-endorsed action after recovery is to CONTINUE therapy (2022 AHA/ACC/HFSA HFimpEF; 2026 ESC), so the earlier band's RRs are the best estimate.
 */
export function efBandFor(patient: Patient): EfBand {
    if (patient.lvef <= 40 || isImprovedEF(patient)) return 'reduced';
    const prior = valueUnknown(patient.previous_lvef) ? undefined : patient.previous_lvef!;
    if (patient.lvef <= 49 || (prior !== undefined && prior >= 41 && prior <= 49)) return 'mildly_reduced';
    return 'preserved';
}

/**
 * The single evidence row for a medication, the patient's EF band and an outcome. When rows carry `population_key`, the row equal to `populationKey`
 * wins; otherwise the row whose key is absent or "other". Throws OutcomeEvidenceError ('missing' / 'duplicate') unless exactly one row matches.
 */
export function evidenceFor(table: OutcomeEvidenceRow[], med: string | Medication, patient: Patient, outcome: OutcomeKey, populationKey?: string): OutcomeEvidenceRow {
    const name = typeof med === 'string' ? med : med.name;
    const band = efBandFor(patient);
    const candidates = table.filter(r => r.outcome === outcome && r.ef_band === band && r.drugs.includes(name));
    let chosen = populationKey === undefined ? [] : candidates.filter(r => r.population_key === populationKey);
    if (chosen.length === 0) chosen = candidates.filter(r => r.population_key === undefined || r.population_key === 'other');
    const where = `${name}, band ${band}, outcome ${outcome}${populationKey ? `, population ${populationKey}` : ''}`;
    if (chosen.length === 0) throw new OutcomeEvidenceError('missing', `No outcome-evidence row for ${where}`);
    if (chosen.length > 1) throw new OutcomeEvidenceError('duplicate', `${chosen.length} outcome-evidence rows for ${where}: ${chosen.map(r => r.id).join(', ')}`);
    return chosen[0];
}

export interface OutcomeContributor {
    medication: string;
    drug_class: string;
    class_group: string;
    row_id: string;
    /** The value USED for ranking: the published relative risk pulled toward no effect by its precision (shrinkage.ts). */
    rr: number;
    rr_published: number;
    ci_low_published: number | null;
    ci_high_published: number | null;
    /** B = tau2 / (tau2 + se^2); 1 = unchanged. */
    shrinkage_b: number;
    interval_imputed: boolean;
    ci_low: number | null;
    ci_high: number | null;
    credit: number;
    dose_adjusted_rr: number;
    basis: OutcomeEvidenceRow['basis'];
    trial: string;
    citation: string;
}
export interface OutcomeNotCounted extends OutcomeContributor { reason: string; counted_instead: string; }
export interface OutcomeEstimate {
    rr: number;
    ci_low: number;
    ci_high: number;
    /** Percent risk reduction versus no disease-modifying therapy, clamped to 0-100. */
    score: number;
    contributors: OutcomeContributor[];
    not_counted: OutcomeNotCounted[];
    /** Counted contributors whose row has no interval (their uncertainty is not in the interval). */
    contributors_without_interval: string[];
}
export interface OutcomeComparison { rr: number; ci_low: number; ci_high: number; }
export type PopulationKeyFor = (med: Medication, patient: Patient) => string | undefined;

const seOf = (row: { ci_low: number | null; ci_high: number | null }): number | null =>
    row.ci_low === null || row.ci_high === null ? null : (Math.log(row.ci_high) - Math.log(row.ci_low)) / 3.92;

// ---- precision weighting (shrinkage.ts): the value USED for ranking is the posterior mean under a prior centred on no effect ----
interface OutcomeStats { tau2: number; medianSe: number }
const OUTCOME_STATS = new WeakMap<OutcomeEvidenceRow[], OutcomeStats>();
const statRows = (table: OutcomeEvidenceRow[]) => {
    const seen = new Set<string>(), items: { x: number; se: number }[] = [];
    for (const r of table) {
        const se = seOf(r);
        if (!(r.basis === 'trial' || r.basis === 'meta_analysis') || se === null) continue;
        const key = `${r.rr}|${r.ci_low}|${r.ci_high}`;     // an identical figure copied across bands or drugs counts once
        if (seen.has(key)) continue;
        seen.add(key); items.push({ x: Math.log(r.rr), se });
    }
    return items;
};
/** tau2 (between-row variance of log relative risks) and the median se, both computed from the table. */
export function outcomeStats(table: OutcomeEvidenceRow[]): OutcomeStats {
    let st = OUTCOME_STATS.get(table);
    if (!st) {
        st = { tau2: tau2From(statRows(table)), medianSe: median(table.map(seOf).filter((x): x is number => x !== null && x > 0)) };
        OUTCOME_STATS.set(table, st);
    }
    return st;
}
export interface ShrunkOutcome { rr_used: number; se_used: number; B: number; imputed: boolean }
export function shrunkOutcomeRow(table: OutcomeEvidenceRow[], row: OutcomeEvidenceRow): ShrunkOutcome {
    const se = seOf(row);
    if (se === null && row.rr === 1) return { rr_used: 1, se_used: 0, B: 1, imputed: false };   // assumed neutral without an interval: stays 1.0
    const st = outcomeStats(table), u = shrinkValue(Math.log(row.rr), se, st.tau2, st.medianSe);
    return { rr_used: Math.exp(u.used), se_used: u.se_used, B: u.B, imputed: u.imputed };
}
const OUTCOME_ALL = outcomeStats(outcomeEvidenceJson as unknown as OutcomeEvidenceRow[]);
/** The engine's tau2 (all rows) and, for the record, the value without the congested loop-diuretic rows (no rule-based reason to exclude them, so the all-rows value is used). */
export const OUTCOME_TAU2: number = OUTCOME_ALL.tau2;
export const OUTCOME_TAU2_EXCL_CONGESTED_LOOP: number = tau2From(statRows((outcomeEvidenceJson as unknown as OutcomeEvidenceRow[]).filter(r => r.population_key !== 'congested')));

interface Counted { c: OutcomeContributor; se: number; }

/** One counted contributor per mechanism group (the lowest dose-adjusted RR wins; ties keep the first listed), plus the losers. */
function countedByGroup(table: OutcomeEvidenceRow[], regimen: RegimenMed[], patient: Patient, outcome: OutcomeKey, keyFor?: PopulationKeyFor, creditFn: CreditFn = outcomeDoseCredit, shrink = true): { groups: Map<string, Counted>; notCounted: OutcomeNotCounted[] } {
    // A drug recorded as held or completed earns no credit (the engine already removes them from current_regimen; this is defence in depth).
    const all: Counted[] = regimen.filter(isActiveExposure).map(r => {
        const row = evidenceFor(table, r.med, patient, outcome, keyFor?.(r.med, patient));
        const credit = creditFn(r, patient);
        // `shrink = false` is for the arithmetic checks of the calculation itself; the engine always shrinks.
        const u: ShrunkOutcome = shrink ? shrunkOutcomeRow(table, row) : { rr_used: row.rr, se_used: seOf(row) ?? 0, B: 1, imputed: false };
        return {
            se: u.se_used,
            c: { medication: r.med.name, drug_class: r.med.drug_class, class_group: getMedicationClassGroup(r.med.drug_class), row_id: row.id, rr: u.rr_used,
                rr_published: row.rr, ci_low_published: row.ci_low, ci_high_published: row.ci_high, shrinkage_b: u.B, interval_imputed: u.imputed,
                ci_low: row.ci_low, ci_high: row.ci_high, credit, dose_adjusted_rr: Math.pow(u.rr_used, credit), basis: row.basis,
                trial: row.source.trial, citation: row.source.citation },
        };
    });
    const groups = new Map<string, Counted>();
    for (const x of all) {
        const cur = groups.get(x.c.class_group);
        if (!cur || x.c.dose_adjusted_rr < cur.c.dose_adjusted_rr) groups.set(x.c.class_group, x);
    }
    const notCounted = all.filter(x => groups.get(x.c.class_group) !== x).map(x => ({
        ...x.c, reason: `same mechanism group (${x.c.class_group}); only the lowest dose-adjusted relative risk is counted`, counted_instead: groups.get(x.c.class_group)!.c.medication,
    }));
    return { groups, notCounted };
}

/** Expected relative risk of a regimen for an outcome, versus no disease-modifying therapy. See the file header for the arithmetic. */
export function regimenOutcomeEstimate(table: OutcomeEvidenceRow[], regimen: RegimenMed[], patient: Patient, outcome: OutcomeKey, populationKeyFor?: PopulationKeyFor, creditFn: CreditFn = outcomeDoseCredit, shrink = true): OutcomeEstimate {
    const { groups, notCounted } = countedByGroup(table, regimen, patient, outcome, populationKeyFor, creditFn, shrink);
    let lnRr = 0, variance = 0;
    const contributors: OutcomeContributor[] = [];
    for (const { c, se } of groups.values()) {
        lnRr += c.credit * Math.log(c.rr);
        variance += (c.credit * se) ** 2;
        contributors.push(c);
    }
    const rr = Math.exp(lnRr), half = 1.96 * Math.sqrt(variance);
    return {
        rr, ci_low: Math.exp(lnRr - half), ci_high: Math.exp(lnRr + half),
        score: Math.min(100, Math.max(0, 100 * (1 - rr))),
        contributors, not_counted: notCounted,
        contributors_without_interval: contributors.filter(c => c.ci_low === null || c.ci_high === null).map(c => c.medication),
    };
}

/**
 * Relative risk of a candidate regimen versus the current one (below 1 favors the candidate), with a 95% interval, assuming independent estimates.
 *   ln ratio = sum over mechanism groups of (c_new ln rr_new - c_old ln rr_old).
 * Variance per group: the SAME evidence row before and after (a dose change) -> ((c_new - c_old) se)^2, because the two terms share one estimate;
 * DIFFERENT rows (e.g. ACE inhibitor -> sacubitril/valsartan) -> (c_new se_new)^2 + (c_old se_old)^2; an unchanged group contributes nothing.
 */
export function compareOutcomeEstimate(table: OutcomeEvidenceRow[], candidate: RegimenMed[], current: RegimenMed[], patient: Patient, outcome: OutcomeKey, populationKeyFor?: PopulationKeyFor, candidateCredit: CreditFn = outcomeDoseCredit, currentCredit: CreditFn = outcomeDoseCredit, shrink = true): OutcomeComparison {
    const next = countedByGroup(table, candidate, patient, outcome, populationKeyFor, candidateCredit, shrink).groups;
    const prev = countedByGroup(table, current, patient, outcome, populationKeyFor, currentCredit, shrink).groups;
    let lnRatio = 0, variance = 0;
    for (const g of new Set([...next.keys(), ...prev.keys()])) {
        const n = next.get(g), o = prev.get(g);
        lnRatio += (n ? n.c.credit * Math.log(n.c.rr) : 0) - (o ? o.c.credit * Math.log(o.c.rr) : 0);
        if (n && o && n.c.row_id === o.c.row_id) variance += ((n.c.credit - o.c.credit) * n.se) ** 2;
        else variance += (n ? (n.c.credit * n.se) ** 2 : 0) + (o ? (o.c.credit * o.se) ** 2 : 0);
    }
    const half = 1.96 * Math.sqrt(variance);
    return { rr: Math.exp(lnRatio), ci_low: Math.exp(lnRatio - half), ci_high: Math.exp(lnRatio + half) };
}

/**
 * Which evidence population applies to a drug for this patient. Keyed classes: hydralazine/isosorbide dinitrate (Vasodilator) and the loop diuretics (congested / other). The Vasodilator note: A-HeFT enrolled
 * self-identified Black patients, while the benefit in other patients rests on a weaker, non-A-HeFT basis, so the table carries two rows. Uses the
 * shared isBlackRace predicate (self-identified race as entered); undefined for every other class.
 */
export const populationKeyFor: PopulationKeyFor = (med, patient) =>
    med.drug_class === 'Vasodilator' ? (isBlackRace(patient) ? 'self_identified_black' : 'other')
    // Loop diuretics: the randomized evidence (Cochrane 2012) enrolled patients with fluid retention, so the benefit row applies only to a patient who is congested by the engine's own predicate.
    : med.drug_class === 'Loop Diuretic' ? (hasCongestion(patient) ? 'congested' : 'other')
    : undefined;

export const OUTCOME_KEYS: readonly OutcomeKey[] = ['all_cause_death', 'hf_hospitalization'];
export const OUTCOME_LABELS: Record<OutcomeKey, string> = {
    all_cause_death: 'Death from any cause (trial average)',
    hf_hospitalization: 'Heart-failure hospitalization (trial average)',
};

/** Estimate for a resulting regimen using the engine's table and population keys. The `score` is the outcome domain score (0-100). `creditFn` defaults to today's dose (as prescribed); the ranking passes the option's plan credit. */
export const outcomeEstimateFor = (regimen: RegimenMed[], patient: Patient, outcome: OutcomeKey, creditFn: CreditFn = outcomeDoseCredit): OutcomeEstimate =>
    regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, regimen, patient, outcome, populationKeyFor, creditFn);

/** One-line breakdown text for an outcome domain (two decimals); `titrated` names the drugs valued as titrated to the trial-achieved dose (plan credit). */
export const describeOutcomeEstimate = (e: OutcomeEstimate, titrated: string[] = [], doseNotMeasured: string[] = []): string => {
    const pulled = e.contributors.filter(c => Math.abs(c.rr_published - c.rr) >= 0.01);
    return describeOutcomeCore(e, titrated, doseNotMeasured) + (pulled.length
        ? ` Pulled toward no effect because the trials are small or imprecise: ${pulled.map(c => `${c.medication} published ${c.rr_published.toFixed(2)}, used ${c.rr.toFixed(2)}`).join('; ')}.` : '');
};
const describeOutcomeCore = (e: OutcomeEstimate, titrated: string[] = [], doseNotMeasured: string[] = []): string =>
    `Relative risk ${e.rr.toFixed(2)} (95% interval ${e.ci_low.toFixed(2)} to ${e.ci_high.toFixed(2)}) versus no disease-modifying therapy; population average from randomized trials, not a prediction for this patient.` +
    (titrated.length ? ` Valued as titrated to the trial-achieved dose: ${titrated.join(', ')}.` : '') +
    (doseNotMeasured.length ? ` Dose relation not measured (valued at full credit at any dose): ${doseNotMeasured.join(', ')}.` : '');

const view = (c: OutcomeContributor, titrated: string[]): OutcomeContributorView => ({
    medication: c.medication, drug_class: c.drug_class, row_id: c.row_id, rr: c.rr, rr_published: c.rr_published, ci_low_published: c.ci_low_published, ci_high_published: c.ci_high_published,
    shrinkage_b: c.shrinkage_b, interval_imputed: c.interval_imputed, credit: c.credit, dose_adjusted_rr: c.dose_adjusted_rr,
    basis: c.basis, trial: c.trial, citation: c.citation, extrapolated: c.basis === 'extrapolated', assumed_neutral: c.basis === 'assumed_neutral',
    valued_as_titrated: titrated.includes(c.medication),
});

/**
 * Display artifact for the options returned: both outcomes, each with the comparison against the patient's current active regimen.
 * `rr`/`as_planned` is the RANKING value (the option valued as the plan it starts: new starts and increases at the trial-achieved dose, planCreditsFor); `as_prescribed` values every
 * drug at today's dose. `at_target` (every drug at credit 1) is kept as it was. Without `modSet` the plan equals the regimen as prescribed.
 */
export function buildOutcomeEstimateViews(resulting: RegimenMed[], patient: Patient, modSet?: { modifications: { action: string; source?: RegimenMed; target?: RegimenMed }[]; resulting_regimen: RegimenMed[] }): OutcomeEstimateView[] {
    const plan = modSet ? planCreditsFor(modSet, patient) : { creditFn: outcomeDoseCredit, titrated: [] as string[] };
    return OUTCOME_KEYS.map(outcome => {
        const e = outcomeEstimateFor(resulting, patient, outcome, plan.creditFn);
        const presc = outcomeEstimateFor(resulting, patient, outcome);
        const cmp = compareOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, resulting, patient.current_regimen ?? [], patient, outcome, populationKeyFor, plan.creditFn, outcomeDoseCredit);
        // Display only: the same regimen with every counted drug at full credit, alone and against the current regimen as dosed today.
        const tgt = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, resulting, patient, outcome, populationKeyFor, fullCredit);
        const tgtCmp = compareOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, resulting, patient.current_regimen ?? [], patient, outcome, populationKeyFor, fullCredit, outcomeDoseCredit);
        return {
            outcome, label: OUTCOME_LABELS[outcome], rr: e.rr, ci_low: e.ci_low, ci_high: e.ci_high,
            as_planned: { rr: e.rr, ci_low: e.ci_low, ci_high: e.ci_high },
            as_prescribed: { rr: presc.rr, ci_low: presc.ci_low, ci_high: presc.ci_high },
            vs_current: { rr: cmp.rr, ci_low: cmp.ci_low, ci_high: cmp.ci_high },
            at_target: { rr: tgt.rr, ci_low: tgt.ci_low, ci_high: tgt.ci_high },
            at_target_vs_current: { rr: tgtCmp.rr, ci_low: tgtCmp.ci_low, ci_high: tgtCmp.ci_high },
            contributors: e.contributors.map(c => view(c, plan.titrated)),
            not_counted: e.not_counted.map(c => ({ ...view(c, plan.titrated), reason: c.reason, counted_instead: c.counted_instead })),
            contributors_without_interval: e.contributors_without_interval,
        };
    });
}
