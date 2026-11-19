/**
 * Side-effect burden from a table of MEASURED one-year harm rates (wired into the side_effects domain; this module is pure and deterministic).
 * The scale is fixed in data/harmDefinitions.json (read here, never copied): one burden scale for the regimen,
 *
 *     burden = sum over harm rows of  max(0, one-year excess %) x severity weight
 *            + sum over drugs of      symptom figure % x symptom weight,   symptom figure = 100 x (1 - prod(1 - max(0, x_i)/100))
 *     score  = max(0, 100 - burden)     (this module's own field; the side_effects domain and ScoredRegimen.harm_burden.score use sideEffectScore: 100 - burden / 2, scoreModel.ts)
 *
 * Rows are looked up per (drug, effect): a row naming the drug beats a class row (drugs empty) for the same class (`drug_class`) and effect; two rows
 * at the same specificity throw 'duplicate'; a drug with no row of ANY layer throws 'missing' (no drug is free because nobody looked); an effect id not
 * in the definitions throws 'unknown_effect'. The table is a parameter. Only active exposures count (the same isActiveExposure rule outcomeBenefit uses).
 *
 * Per row: rate = dose-interpolated one_year_excess_pct (daily dose, flat outside the groups), then multiplied by every applicable multiplier
 * (ASSUMPTION: several multipliers multiply together; the line is flagged), then floored at 0 for charging (the line keeps the measured figure).
 * Hyperkalemia split: when a drug has both rows, the moderate line is charged on max(0, hyperkalemia - hyperkalemiaSevere) (both after dose and
 * multipliers) so a severe event is not charged twice. A multiplier whose condition cannot be evaluated (missing patient value) is NOT applied and is listed.
 * Lines are ordered by regimen order, then effect id; each drug's single symptom line comes after its harm lines.
 */
import type { Patient, RegimenMed } from '../../types';
import { numericDailyDose } from './regimenUtils';
import { isActiveExposure } from './medicationExposure';
import { valueUnknown, isBlackRace, hasGoutHistory } from '../clinicalPredicates';
import harmDefinitionsJson from '../../data/harmDefinitions.json';
import harmEvidenceJson from '../../data/harmEvidence.json';
export type HarmLayer = 'harmRow' | 'symptomFigure' | 'crossCheck' | 'caution';
export type HarmLevel = 'drug' | 'class' | 'extrapolated' | 'siblingProxy';
export interface HarmRow {
    id: string; drug_class: string; drugs: string[]; effect: string; layer: HarmLayer;
    one_year_excess_pct: number; dose_related: boolean | null;
    dose_groups?: { daily_mg: number; one_year_excess_pct: number }[];
    level: HarmLevel; upper_bound?: boolean; population_sex?: 'male' | 'female';
    source: { trial: string; citation: string; pmid?: string };
    population: string; control_type: 'placebo' | 'active' | 'none';
    definition_used: string; verification: string; quote: string; notes: string;
}
export type HarmCondition =
    | { kind: 'egfr_below'; value: number } | { kind: 'potassium_at_least'; value: number }
    | { kind: 'sbp_below'; value: number } | { kind: 'age_at_least'; value: number }
    | { kind: 'sex'; value: 'male' | 'female' } | { kind: 'self_identified_black' }
    | { kind: 'has_diabetes' } | { kind: 'no_diabetes' } | { kind: 'has_gout' };
export interface HarmMultiplier {
    id: string; effect: string; applies_to_classes: string[]; condition: HarmCondition; ratio: number;
    level: HarmLevel; source: { trial: string; citation: string; pmid?: string }; quote: string; notes: string;
}
export interface HarmTable { rows: HarmRow[]; multipliers: HarmMultiplier[] }
/** The engine's harm table (data/harmEvidence.json: rows and multipliers). */
export const HARM_TABLE: HarmTable = { rows: (harmEvidenceJson as unknown as HarmTable).rows, multipliers: (harmEvidenceJson as unknown as HarmTable).multipliers };
export class HarmTableError extends Error {
    constructor(public readonly code: 'missing' | 'duplicate' | 'unknown_effect' | 'layer_mismatch', message: string) { super(message); this.name = 'HarmTableError'; }
}

interface Defs { effect: string; layer: HarmLayer; severity?: 'mild' | 'moderate' | 'serious' }
const DEFINITIONS = harmDefinitionsJson as unknown as {
    effects: Defs[];
    method: { severityWeights: { mild: number; moderate: number; serious: number }; symptomWeight: { value: number } };
};
const EFFECTS = new Map(DEFINITIONS.effects.map(e => [e.effect, e]));
export const SEVERITY_WEIGHTS = DEFINITIONS.method.severityWeights;
export const SYMPTOM_WEIGHT = DEFINITIONS.method.symptomWeight.value;

export interface AppliedMultiplier { id: string; ratio: number; level: HarmLevel; trial: string; assumed_because_unknown?: string }
export interface HarmLine {
    kind: 'harm';
    drug: string; drug_class: string; effect: string; row_id: string;
    measured_rate: number;   // dose-interpolated, before multipliers, may be negative
    adjusted_rate: number;   // after multipliers, before the floor
    charged_rate: number;    // max(0, adjusted_rate), or the hyperkalemia-split remainder
    severity: 'mild' | 'moderate' | 'serious'; weight: number; points: number;
    level: HarmLevel; upper_bound: boolean;
    dose_relation_measured: boolean;
    multipliers: AppliedMultiplier[]; multipliers_combined: boolean;
    /** Set when a value needed for this line was not recorded and the conservative (higher-risk) case was charged: the field(s) concerned, e.g. 'sex' or 'race'. */
    assumed_because_unknown?: string;
    split_from?: string;     // set on the moderate hyperkalemia line when the severe row was subtracted
}
export interface SymptomComponent {
    effect: string; row_id: string; measured_rate: number; adjusted_rate: number; charged_rate: number;
    level: HarmLevel; upper_bound: boolean; dose_relation_measured: boolean; multipliers: AppliedMultiplier[]; multipliers_combined: boolean;
    assumed_because_unknown?: string;
}
export interface SymptomLine { kind: 'symptom'; drug: string; drug_class: string; figure: number; weight: number; points: number; components: SymptomComponent[] }
export type BurdenLine = HarmLine | SymptomLine;
export interface NotCharged { drug: string; effect: string; row_id: string; layer: HarmLayer; reason: string }
export interface MultiplierNotEvaluated { multiplier_id: string; drug: string; effect: string; reason: string; /** True when the multiplier was applied as the higher-risk case (ratio above 1); false when it lowers risk and was not applied. */ applied: boolean }
/** Missing data never improves an option: every place the conservative case was charged because a value was not recorded (for the display: "sex not recorded: charged as the higher-risk case"). */
export interface UnknownAssumption { drug: string; effect: string; field: string; applied: boolean; text: string; multiplier_id?: string; row_id?: string }
export interface HarmBurden {
    burden: number; score: number; lines: BurdenLine[]; symptom_points: number;
    not_charged: NotCharged[]; multipliers_not_evaluated: MultiplierNotEvaluated[]; unknown_assumptions: UnknownAssumption[];
}

const KNOWN_DIABETES = ['Diabetes Mellitus Type 2', 'Type 1 Diabetes Mellitus'];
const RACES = ['White', 'Black', 'Asian', 'Hispanic', 'Other'];
const num = (v: unknown): number | undefined => (typeof v === 'number' && !valueUnknown(v) ? v : undefined);

/** true / false, or the reason the condition cannot be evaluated (patient value missing or unknown). */
function evaluateCondition(c: HarmCondition, p: Patient): boolean | { unknown: string } {
    const need = (field: string, v: number | undefined) => (v === undefined ? { unknown: `${field} is missing or unknown` } : undefined);
    switch (c.kind) {
        case 'egfr_below': { const v = num(p.egfr); return need('eGFR', v) ?? v! < c.value; }
        case 'potassium_at_least': { const v = num(p.potassium); return need('potassium', v) ?? v! >= c.value; }
        case 'sbp_below': { const v = num(p.sbp); return need('systolic blood pressure', v) ?? v! < c.value; }
        case 'age_at_least': { const v = num(p.age); return need('age', v) ?? v! >= c.value; }
        case 'sex': {
            if (p.sex !== 'Male' && p.sex !== 'Female') return { unknown: 'sex is missing or unknown' };
            return p.sex.toLowerCase() === c.value;
        }
        case 'self_identified_black': return RACES.includes(p.race) ? isBlackRace(p) : { unknown: 'race is missing or unknown' };
        case 'has_diabetes': case 'no_diabetes': {
            if (!(p.comorbidities instanceof Set)) return { unknown: 'comorbidity list is missing' };
            const has = KNOWN_DIABETES.some(d => p.comorbidities.has(d));
            return c.kind === 'has_diabetes' ? has : !has;
        }
        case 'has_gout': return p.comorbidities instanceof Set ? hasGoutHistory(p) : { unknown: 'comorbidity list is missing' };
    }
}

export const doseRate = (row: HarmRow, daily: number): { rate: number; measured: boolean } => {
    const g = [...(row.dose_groups ?? [])].sort((a, b) => a.daily_mg - b.daily_mg);
    if (g.length === 0) return { rate: row.one_year_excess_pct, measured: false };
    if (Number.isNaN(daily) || daily <= g[0].daily_mg) return { rate: g[0].one_year_excess_pct, measured: true };
    const last = g[g.length - 1];
    if (daily >= last.daily_mg) return { rate: last.one_year_excess_pct, measured: true };
    for (let i = 1; i < g.length; i++) {
        if (daily <= g[i].daily_mg) {
            const a = g[i - 1], b = g[i];
            return { rate: a.one_year_excess_pct + (b.one_year_excess_pct - a.one_year_excess_pct) * (daily - a.daily_mg) / (b.daily_mg - a.daily_mg), measured: true };
        }
    }
    return { rate: last.one_year_excess_pct, measured: true };
};

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Counts real validation passes (a table is validated once, not on every call). */
export const HARM_VALIDATION_RUNS = { count: 0 };
const VALIDATED = new WeakSet<HarmTable>();
function validate(table: HarmTable): void {
    if (VALIDATED.has(table)) return;
    VALIDATED.add(table);
    HARM_VALIDATION_RUNS.count++;
    for (const r of table.rows) {
        const d = EFFECTS.get(r.effect);
        if (!d) throw new HarmTableError('unknown_effect', `Row ${r.id}: effect "${r.effect}" is not in data/harmDefinitions.json`);
        if (d.layer !== r.layer) throw new HarmTableError('layer_mismatch', `Row ${r.id}: effect "${r.effect}" is a ${d.layer} in the definitions but the row says ${r.layer}`);
    }
    for (const m of table.multipliers) if (!EFFECTS.has(m.effect)) throw new HarmTableError('unknown_effect', `Multiplier ${m.id}: effect "${m.effect}" is not in data/harmDefinitions.json`);
}

interface Resolved { row: HarmRow; measured: number; adjusted: number; applied: HarmMultiplier[]; doseMeasured: boolean; assumed: string[]; appliedAssumed: Map<string, string> }
const CONDITION_FIELD: Record<HarmCondition['kind'], string> = {
    egfr_below: 'eGFR', potassium_at_least: 'potassium', sbp_below: 'systolic blood pressure', age_at_least: 'age', sex: 'sex', self_identified_black: 'race',
    has_diabetes: 'comorbidity list', no_diabetes: 'comorbidity list', has_gout: 'comorbidity list',
};

export function harmBurdenFor(table: HarmTable, regimen: RegimenMed[], patient: Patient): HarmBurden {
    validate(table);
    const lines: BurdenLine[] = [], notCharged: NotCharged[] = [], notEvaluated: MultiplierNotEvaluated[] = [], assumptions: UnknownAssumption[] = [];
    let burden = 0, symptomPoints = 0;
    const sexKey = patient.sex === 'Male' ? 'male' : patient.sex === 'Female' ? 'female' : undefined;
    for (const r of regimen.filter(isActiveExposure)) {
        const name = r.med.name, cls = r.med.drug_class;
        const matching = table.rows.filter(x => x.drug_class === cls && (x.drugs.length === 0 || x.drugs.includes(name)));
        if (matching.length === 0) throw new HarmTableError('missing', `No harm row of any layer for ${name} (class ${cls}): a drug is never free because nobody looked`);
        const daily = numericDailyDose(r);   // shared helper: combination strengths are numeric (sacubitril + valsartan; hydralazine component)
        const resolvedFor = (effect: string): Resolved | undefined => {
            const cands = matching.filter(x => x.effect === effect);
            // Missing data never makes a drug look safer: with the sex NOT recorded a sex-specific row is charged (both sexes' rows for the same drug and effect: the larger once).
            const usable = sexKey === undefined ? cands : cands.filter(x => x.population_sex === undefined || x.population_sex === sexKey);
            for (const x of cands) if (!usable.includes(x)) notCharged.push({ drug: name, effect, row_id: x.id, layer: x.layer, reason: `rate measured in ${x.population_sex === 'male' ? 'men' : 'women'} only; patient sex is ${sexKey ?? 'unknown'}, so not charged to this patient` });
            if (usable.length === 0) return undefined;
            const spec = (x: HarmRow) => (x.drugs.includes(name) ? 2 : 1);
            const top = Math.max(...usable.map(spec)), best = usable.filter(x => spec(x) === top);
            const assumedFields: string[] = [];
            // Multipliers are evaluated ONCE per drug and effect. A condition that cannot be evaluated is assumed in the conservative direction: applied when its ratio is above 1, not applied when it is below 1.
            const applied: HarmMultiplier[] = [], appliedAssumed = new Map<string, string>();
            for (const m of table.multipliers.filter(m => m.effect === effect && m.applies_to_classes.includes(cls)).sort(byId)) {
                const v = evaluateCondition(m.condition, patient);
                if (v === true) applied.push(m);
                else if (v !== false) {
                    const field = CONDITION_FIELD[m.condition.kind], apply = m.ratio > 1;
                    if (apply) { applied.push(m); appliedAssumed.set(m.id, field); if (!assumedFields.includes(field)) assumedFields.push(field); }
                    notEvaluated.push({ multiplier_id: m.id, drug: name, effect, reason: `${m.condition.kind}: ${v.unknown}`, applied: apply });
                    assumptions.push({ drug: name, effect, field, applied: apply, multiplier_id: m.id,
                        text: `${field} not recorded: ${apply ? 'charged as the higher-risk case (multiplier applied)' : 'a multiplier that lowers risk was not applied'}` });
                }
            }
            const rateOf = (row: HarmRow) => { const { rate, measured } = doseRate(row, daily); return { rate, measured, adjusted: applied.reduce((a, m) => a * m.ratio, rate) }; };
            let row: HarmRow;
            if (best.length > 1) {
                if (sexKey === undefined && best.every(x => x.population_sex !== undefined) && new Set(best.map(x => x.population_sex)).size === best.length) {
                    row = [...best].sort((x, y) => rateOf(y).adjusted - rateOf(x).adjusted || (x.id < y.id ? -1 : 1))[0];
                } else throw new HarmTableError('duplicate', `${best.length} harm rows at the same specificity for ${name}, effect ${effect}: ${best.map(x => x.id).join(', ')}`);
            } else row = best[0];
            if (sexKey === undefined && row.population_sex !== undefined) {
                assumedFields.unshift('sex');
                assumptions.push({ drug: name, effect, field: 'sex', applied: true, row_id: row.id, text: 'sex not recorded: charged as the higher-risk case' });
            }
            const { rate, measured, adjusted } = rateOf(row);
            return { row, measured: rate, adjusted, applied, doseMeasured: measured, assumed: assumedFields, appliedAssumed };
        };
        const view = (m: HarmMultiplier, assumedField?: string): AppliedMultiplier => ({ id: m.id, ratio: m.ratio, level: m.level, trial: m.source.trial, ...(assumedField ? { assumed_because_unknown: assumedField } : {}) });
        const effects = [...new Set(matching.map(x => x.effect))].sort();
        const harm: HarmLine[] = [], symptoms: SymptomComponent[] = [];
        const resolved = new Map<string, Resolved>();
        for (const effect of effects) {
            const layer = EFFECTS.get(effect)!.layer;
            if (layer === 'crossCheck' || layer === 'caution') {
                for (const x of matching.filter(x => x.effect === effect).sort(byId)) notCharged.push({ drug: name, effect, row_id: x.id, layer, reason: layer === 'crossCheck' ? 'cross-check only; would double-count the events charged elsewhere' : 'caution shown, not charged' });
                continue;
            }
            const res = resolvedFor(effect);
            if (res) resolved.set(effect, res);
        }
        for (const [effect, res] of resolved) {
            const d = EFFECTS.get(effect)!, base = { level: res.row.level, upper_bound: res.row.upper_bound === true, dose_relation_measured: res.doseMeasured, multipliers: res.applied.map(m => view(m, res.appliedAssumed.get(m.id))), multipliers_combined: res.applied.length > 1,
                ...(res.assumed.length ? { assumed_because_unknown: res.assumed.join(', ') } : {}) };
            if (d.layer === 'symptomFigure') {
                symptoms.push({ effect, row_id: res.row.id, measured_rate: res.measured, adjusted_rate: res.adjusted, charged_rate: Math.max(0, res.adjusted), ...base });
                continue;
            }
            const severity = d.severity!, weight = SEVERITY_WEIGHTS[severity];
            let charged = Math.max(0, res.adjusted), splitFrom: string | undefined;
            if (effect === 'hyperkalemia' && resolved.has('hyperkalemiaSevere')) {
                charged = Math.max(0, res.adjusted - Math.max(0, resolved.get('hyperkalemiaSevere')!.adjusted)); // moderate share only; the severe row carries the rest
                splitFrom = 'hyperkalemiaSevere';
            }
            harm.push({ kind: 'harm', drug: name, drug_class: cls, effect, row_id: res.row.id, measured_rate: res.measured, adjusted_rate: res.adjusted, charged_rate: charged, severity, weight, points: charged * weight, ...base, ...(splitFrom ? { split_from: splitFrom } : {}) });
        }
        for (const l of harm) { lines.push(l); burden += l.points; }
        if (symptoms.length > 0) {
            const figure = 100 * (1 - symptoms.reduce((a, c) => a * (1 - c.charged_rate / 100), 1));
            const points = figure * SYMPTOM_WEIGHT;
            lines.push({ kind: 'symptom', drug: name, drug_class: cls, figure, weight: SYMPTOM_WEIGHT, points, components: symptoms });
            burden += points; symptomPoints += points;
        }
    }
    return { burden, score: Math.max(0, 100 - burden), lines, symptom_points: symptomPoints, not_charged: notCharged, multipliers_not_evaluated: notEvaluated, unknown_assumptions: assumptions };
}

export interface ChangedLine { drug: string; effect: string; kind: 'harm' | 'symptom'; before_points: number | null; after_points: number | null; delta: number }
export interface HarmBurdenComparison { candidate_burden: number; current_burden: number; burden_difference: number; changed_lines: ChangedLine[] }

const keyed = (b: HarmBurden): Map<string, { drug: string; effect: string; kind: 'harm' | 'symptom'; points: number }> => {
    const m = new Map<string, { drug: string; effect: string; kind: 'harm' | 'symptom'; points: number }>();
    for (const l of b.lines) {
        const effect = l.kind === 'harm' ? l.effect : 'symptoms', key = `${l.drug}\u0000${effect}`, cur = m.get(key);
        m.set(key, { drug: l.drug, effect, kind: l.kind, points: (cur?.points ?? 0) + l.points });
    }
    return m;
};

/** Candidate minus current burden (positive = more harm) and the lines whose points changed, for the display later. */
export function compareHarmBurden(table: HarmTable, candidate: RegimenMed[], current: RegimenMed[], patient: Patient): HarmBurdenComparison {
    const c = harmBurdenFor(table, candidate, patient), u = harmBurdenFor(table, current, patient);
    const after = keyed(c), before = keyed(u), changed: ChangedLine[] = [];
    for (const key of new Set([...after.keys(), ...before.keys()])) {
        const a = after.get(key), b = before.get(key), delta = (a?.points ?? 0) - (b?.points ?? 0);
        if (a && b && Math.abs(delta) < 1e-12) continue;
        const ref = (a ?? b)!;
        changed.push({ drug: ref.drug, effect: ref.effect, kind: ref.kind, before_points: b ? b.points : null, after_points: a ? a.points : null, delta });
    }
    return { candidate_burden: c.burden, current_burden: u.burden, burden_difference: c.burden - u.burden, changed_lines: changed };
}
