/**
 * Checks for services/engine/harmBurden.ts (side-effect burden from a table of measured one-year harm rates). The table is a PARAMETER; these
 * checks use small SYNTHETIC tables (real formulary drugs, made-up rates) so they do not depend on the real rate file. Hand arithmetic is beside each check.
 * Weights are read from data/harmDefinitions.json (mild 0.5, moderate 1, serious 3, symptom 1.0), never copied.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { entry, patient } from './systemicReviewChecks';
import { harmBurdenFor as typedBurden, compareHarmBurden as typedCompare, HarmTableError, type HarmRow, type HarmMultiplier, type HarmTable, type HarmCondition } from '../services/engine/harmBurden';
import defs from '../data/harmDefinitions.json';
import type { Patient } from '../types';

const W = defs.method.severityWeights as { mild: number; moderate: number; serious: number };
const SYM = defs.method.symptomWeight.value;
// Checks read line fields by name across the harm/symptom union, so results are loosened to any here (the module itself is fully typed).
const harmBurdenFor = (...a: Parameters<typeof typedBurden>): any => typedBurden(...a);
const compareHarmBurden = (...a: Parameters<typeof typedCompare>): any => typedCompare(...a);
const near = (a: number, b: number, msg = '', tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);

const row = (id: string, drug_class: string, drugs: string[], effect: string, pct: number, over: Partial<HarmRow> = {}): HarmRow => ({
    id, drug_class, drugs, effect, layer: 'harmRow', one_year_excess_pct: pct, dose_related: null, level: 'drug',
    source: { trial: `SYN-${id}`, citation: `Synthetic ${id}` }, population: 'synthetic', control_type: 'placebo',
    definition_used: 'synthetic', verification: 'synthetic', quote: '', notes: '', ...over,
});
const sym = (id: string, cls: string, drugs: string[], effect: string, pct: number, over: Partial<HarmRow> = {}) => row(id, cls, drugs, effect, pct, { layer: 'symptomFigure', ...over });
const mult = (id: string, effect: string, classes: string[], condition: HarmCondition, ratio: number): HarmMultiplier => ({
    id, effect, applies_to_classes: classes, condition, ratio, level: 'drug', source: { trial: 'SYN', citation: 'Synthetic' }, quote: '', notes: '',
});
const T = (rows: HarmRow[], multipliers: HarmMultiplier[] = []): HarmTable => ({ rows, multipliers });
// Every drug in a regimen needs some row: a crossCheck row (never charged) satisfies "someone looked".
const xc = (cls: string, drugs: string[] = []) => row(`xc-${cls}-${drugs.join('+')}`, cls, drugs, 'discontinuationForAdverseEvent', 5, { layer: 'crossCheck' });
const LIS = () => entry('Lisinopril', 20), SPI = () => entry('Spironolactone', 25), CARV = () => entry('Carvedilol', 25), FURO = () => entry('Furosemide', 40, 'qd'), DAPA = () => entry('Dapagliflozin', 10);
const code = (f: () => unknown): string => { try { f(); return 'no error'; } catch (e) { return e instanceof HarmTableError ? e.code : `other: ${e}`; } };

export function runHarmBurdenChecks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] Harm burden: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] Harm burden: ${name}: ${e}`); }
    };
    const P = (over: Partial<Patient> = {}): Patient => Object.assign(patient(), over);

    check('1. burden is the weighted sum; score = max(0, 100 - burden); empty regimen is 0 / 100', () => {
        const t = T([row('a', 'ACEi', ['Lisinopril'], 'angioedema', 0.5)]); // serious: 0.5 x 3
        const r = harmBurdenFor(t, [LIS()], P());
        near(r.burden, 0.5 * W.serious, 'burden'); near(r.score, 100 - 0.5 * W.serious, 'score');
        const e = harmBurdenFor(t, [], P()); near(e.burden, 0); near(e.score, 100);
        const big = harmBurdenFor(T([row('b', 'ACEi', [], 'angioedema', 50)]), [LIS()], P());
        near(big.burden, 150); near(big.score, 0, 'score floors at 0');
        assert.deepEqual(Object.keys(r).sort(), ['burden', 'lines', 'multipliers_not_evaluated', 'not_charged', 'score', 'symptom_points', 'unknown_assumptions']);
    });

    check('2. held and completed drugs are not charged and need no row', () => {
        const t = T([row('a', 'ACEi', ['Lisinopril'], 'angioedema', 1)]);
        const held = { ...CARV(), exposure: { status: 'held' as const } }, done = { ...SPI(), exposure: { status: 'completed' as const } };
        const r = harmBurdenFor(t, [LIS(), held, done], P());
        near(r.burden, W.serious); assert.equal(r.lines.length, 1);
    });

    check('3a. drug-specific row beats class row for same class and effect', () => {
        const t = T([row('cls', 'ACEi', [], 'hyperkalemia', 2), row('drug', 'ACEi', ['Lisinopril'], 'hyperkalemia', 3)]);
        const r = harmBurdenFor(t, [LIS()], P());
        assert.equal(r.lines.length, 1); assert.equal(r.lines[0].row_id, 'drug'); near(r.burden, 3 * W.moderate);
        const r2 = harmBurdenFor(t, [entry('Enalapril', 10)], P());
        assert.equal(r2.lines[0].row_id, 'cls');
    });
    check('3b. two rows at the same specificity throw duplicate', () => {
        assert.equal(code(() => harmBurdenFor(T([row('a', 'ACEi', ['Lisinopril'], 'cough', 1, { layer: 'symptomFigure' }), row('b', 'ACEi', ['Lisinopril', 'Enalapril'], 'cough', 2, { layer: 'symptomFigure' })]), [LIS()], P())), 'duplicate');
        assert.equal(code(() => harmBurdenFor(T([row('a', 'ACEi', [], 'angioedema', 1), row('b', 'ACEi', [], 'angioedema', 2)]), [LIS()], P())), 'duplicate');
    });
    check('3c. a drug with no row of any layer throws missing, naming the drug', () => {
        const t = T([row('a', 'ACEi', [], 'angioedema', 1)]);
        let msg = ''; try { harmBurdenFor(t, [LIS(), SPI()], P()); } catch (e) { assert.ok(e instanceof HarmTableError); assert.equal(e.code, 'missing'); msg = e.message; }
        assert.match(msg, /Spironolactone/);
        near(harmBurdenFor(T([xc('MRA')]), [SPI()], P()).burden, 0, 'a crossCheck row counts as looked-at');
    });
    check('3d. an effect id not in harmDefinitions throws unknown_effect', () => {
        assert.equal(code(() => harmBurdenFor(T([row('a', 'ACEi', [], 'madeUpEffect', 1)]), [LIS()], P())), 'unknown_effect');
        assert.equal(code(() => harmBurdenFor(T([row('a', 'ACEi', [], 'angioedema', 1)], [mult('m', 'nope', ['ACEi'], { kind: 'has_gout' }, 2)]), [LIS()], P())), 'unknown_effect');
        assert.equal(code(() => harmBurdenFor(T([row('a', 'ACEi', [], 'cough', 1)]), [LIS()], P())), 'layer_mismatch');
    });

    check('4. a harm line carries drug, effect, measured/charged rate, severity, weight, points, level, upper_bound, row id, multipliers', () => {
        const t = T([row('a', 'MRA', ['Spironolactone'], 'hyperkalemiaSevere', 2, { level: 'extrapolated', upper_bound: true })]);
        const l = harmBurdenFor(t, [SPI()], P()).lines[0];
        assert.equal(l.drug, 'Spironolactone'); assert.equal(l.effect, 'hyperkalemiaSevere'); near(l.measured_rate, 2); near(l.charged_rate, 2);
        assert.equal(l.severity, 'serious'); near(l.weight, W.serious); near(l.points, 2 * W.serious);
        assert.equal(l.level, 'extrapolated'); assert.equal(l.upper_bound, true); assert.equal(l.row_id, 'a'); assert.deepEqual(l.multipliers, []);
    });

    check('5. negative excess is charged 0; the line keeps the measured figure', () => {
        const r = harmBurdenFor(T([row('a', 'SGLT2i', [], 'hypokalemia', -1.2)]), [DAPA()], P());
        near(r.burden, 0); near(r.lines[0].measured_rate, -1.2); near(r.lines[0].charged_rate, 0); near(r.lines[0].points, 0);
    });

    check('6. hyperkalemia split: moderate on (mod - severe), severe on severe; single row charged as is; never negative', () => {
        const both = T([row('m', 'MRA', [], 'hyperkalemia', 10), row('s', 'MRA', [], 'hyperkalemiaSevere', 3)]);
        const r = harmBurdenFor(both, [SPI()], P());
        const m = r.lines.find((l: any) => l.effect === 'hyperkalemia'), s = r.lines.find((l: any) => l.effect === 'hyperkalemiaSevere');
        near(m.charged_rate, 7); near(m.measured_rate, 10); near(m.points, 7 * W.moderate); near(s.charged_rate, 3); near(s.points, 3 * W.serious);
        near(r.burden, 7 * W.moderate + 3 * W.serious);
        near(harmBurdenFor(T([row('m', 'MRA', [], 'hyperkalemia', 10)]), [SPI()], P()).burden, 10 * W.moderate, 'moderate only');
        near(harmBurdenFor(T([row('s', 'MRA', [], 'hyperkalemiaSevere', 3)]), [SPI()], P()).burden, 3 * W.serious, 'severe only');
        near(harmBurdenFor(T([row('m', 'MRA', [], 'hyperkalemia', 2), row('s', 'MRA', [], 'hyperkalemiaSevere', 3)]), [SPI()], P()).lines.find((l: any) => l.effect === 'hyperkalemia').charged_rate, 0, 'floor at 0');
    });

    check('7. sex-specific rows charge only that sex; otherwise listed in not_charged with a reason', () => {
        const t = T([row('g', 'MRA', ['Spironolactone'], 'gynecomastia', 6, { population_sex: 'male' })]);
        const m = harmBurdenFor(t, [SPI()], P({ sex: 'Male' })), f = harmBurdenFor(t, [SPI()], P({ sex: 'Female' }));
        near(m.burden, 6 * W.moderate); assert.equal(m.not_charged.length, 0);
        near(f.burden, 0); assert.equal(f.lines.length, 0); assert.equal(f.not_charged.length, 1);
        assert.equal(f.not_charged[0].row_id, 'g'); assert.match(f.not_charged[0].reason, /male/i);
        // 2026-11-16: with the sex NOT recorded the row is charged (missing data never improves an option), flagged and listed in unknown_assumptions.
        const u = harmBurdenFor(t, [SPI()], P({ sex: undefined as any }));
        near(u.burden, 6 * W.moderate); assert.equal(u.not_charged.length, 0);
        assert.equal(u.unknown_assumptions.length, 1); assert.equal(u.unknown_assumptions[0].field, 'sex');
    });

    check('8. dose relation: linear between groups on the daily dose, flat outside; unmeasured flagged', () => {
        const groups = [{ daily_mg: 10, one_year_excess_pct: 2 }, { daily_mg: 40, one_year_excess_pct: 8 }];
        const t = T([row('d', 'ACEi', [], 'angioedema', 5, { dose_related: true, dose_groups: groups })]);
        const at = (mg: number) => harmBurdenFor(t, [entry('Lisinopril', mg)], P()).lines[0];
        near(at(20).charged_rate, 4, '20 mg: 2 + (10/30)*6'); near(at(10).charged_rate, 2, 'on group'); near(at(40).charged_rate, 8, 'on top group');
        near(at(5).charged_rate, 2, 'below, held flat'); near(at(2.5).charged_rate, 2);
        assert.equal(at(20).dose_relation_measured, true);
        // furosemide 40 mg bid = 80 mg/day uses the DAILY dose
        const t2 = T([row('d', 'Loop Diuretic', [], 'hyponatremia', 0, { dose_related: true, dose_groups: [{ daily_mg: 40, one_year_excess_pct: 1 }, { daily_mg: 120, one_year_excess_pct: 5 }] })]);
        near(harmBurdenFor(t2, [entry('Furosemide', 40, 'bid')], P()).lines[0].charged_rate, 3, '80 mg/day');
        near(harmBurdenFor(t2, [entry('Furosemide', 40, 'qd')], P()).lines[0].charged_rate, 1, '40 mg/day');
        const flat = harmBurdenFor(T([row('f', 'ACEi', [], 'angioedema', 5)]), [LIS()], P()).lines[0];
        assert.equal(flat.dose_relation_measured, false); near(flat.charged_rate, 5);
        near(harmBurdenFor(T([row('f', 'ACEi', [], 'angioedema', 5)]), [entry('Lisinopril', 2.5)], P()).lines[0].charged_rate, 5, 'same at every dose');
    });

    check('9. symptom figure: 100 x (1 - prod(1 - x/100)), floored per component, one line per drug, points x symptom weight', () => {
        const t = T([sym('c', 'ACEi', [], 'cough', 10), sym('d', 'ACEi', [], 'dizziness', 20), sym('f', 'ACEi', [], 'fatigue', -4), row('h', 'ACEi', [], 'angioedema', 1)]);
        const r = harmBurdenFor(t, [LIS()], P());
        const fig = 100 * (1 - 0.9 * 0.8); // 28
        const sl = r.lines.filter((l: any) => l.kind === 'symptom'); assert.equal(sl.length, 1);
        near(sl[0].figure, fig); near(sl[0].points, fig * SYM); near(r.symptom_points, fig * SYM);
        assert.deepEqual(sl[0].components.map((c: any) => c.effect), ['cough', 'dizziness', 'fatigue']);
        near(sl[0].components[2].measured_rate, -4); near(sl[0].components[2].charged_rate, 0);
        near(r.burden, fig * SYM + 1 * W.serious);
        near(harmBurdenFor(t, [LIS(), CARV()].slice(0, 1), P()).symptom_points, fig * SYM);
        // two drugs: separate figures, symptom_points sums
        const t2 = T([sym('c', 'ACEi', [], 'cough', 10), sym('d', 'Beta Blocker', [], 'dizziness', 20)]);
        const r2 = harmBurdenFor(t2, [LIS(), CARV()], P()); near(r2.symptom_points, 30 * SYM); assert.equal(r2.lines.length, 2);
        // dose interpolation applies inside the figure
        const t3 = T([sym('c', 'ACEi', [], 'cough', 0, { dose_related: true, dose_groups: [{ daily_mg: 10, one_year_excess_pct: 2 }, { daily_mg: 40, one_year_excess_pct: 8 }] })]);
        near(harmBurdenFor(t3, [entry('Lisinopril', 20)], P()).symptom_points, 4 * SYM);
    });

    check('10a. multiplier applies when effect, class and condition match; rate x ratio; recorded on the line', () => {
        const t = T([row('a', 'ACEi', [], 'angioedema', 1)], [mult('blk', 'angioedema', ['ACEi'], { kind: 'self_identified_black' }, 3)]);
        const b = harmBurdenFor(t, [LIS()], P({ race: 'Black' })).lines[0], w = harmBurdenFor(t, [LIS()], P({ race: 'White' })).lines[0];
        near(b.charged_rate, 3); near(b.measured_rate, 1); assert.deepEqual(b.multipliers.map((m: any) => m.id), ['blk']); near(b.points, 3 * W.serious);
        near(w.charged_rate, 1); assert.deepEqual(w.multipliers, []);
        const other = harmBurdenFor(T([row('a', 'ACEi', [], 'angioedema', 1), row('z', 'MRA', [], 'angioedema', 1)], [mult('blk', 'angioedema', ['ACEi'], { kind: 'self_identified_black' }, 3)]), [SPI()], P({ race: 'Black' }));
        near(other.lines[0].charged_rate, 1, 'class not listed');
        const sy = harmBurdenFor(T([sym('c', 'ACEi', [], 'cough', 10)], [mult('m', 'cough', ['ACEi'], { kind: 'sex', value: 'female' }, 2)]), [LIS()], P({ sex: 'Female' }));
        near(sy.symptom_points, 20 * SYM, 'multiplier inside the symptom figure');
    });
    check('10b. several applicable multipliers multiply and flag multipliers_combined', () => {
        const t = T([row('a', 'ACEi', [], 'angioedema', 1)], [mult('m1', 'angioedema', ['ACEi'], { kind: 'self_identified_black' }, 3), mult('m2', 'angioedema', ['ACEi'], { kind: 'age_at_least', value: 65 }, 1.5)]);
        const l = harmBurdenFor(t, [LIS()], P({ race: 'Black', age: 70 })).lines[0];
        near(l.charged_rate, 4.5); assert.equal(l.multipliers_combined, true);
        const one = harmBurdenFor(t, [LIS()], P({ race: 'Black', age: 50 })).lines[0]; assert.notEqual(one.multipliers_combined, true);
    });
    check('10c. every condition kind evaluates against the right patient field', () => {
        const base = (cond: HarmCondition, p: Partial<Patient>, comorb: string[] = []) => {
            const pt = P(p); pt.comorbidities = new Set(comorb);
            return harmBurdenFor(T([row('a', 'ACEi', [], 'angioedema', 1)], [mult('m', 'angioedema', ['ACEi'], cond, 2)]), [LIS()], pt).lines[0].multipliers.length === 1;
        };
        assert.equal(base({ kind: 'egfr_below', value: 60 }, { egfr: 59 }), true); assert.equal(base({ kind: 'egfr_below', value: 60 }, { egfr: 60 }), false);
        assert.equal(base({ kind: 'potassium_at_least', value: 5 }, { potassium: 5 }), true); assert.equal(base({ kind: 'potassium_at_least', value: 5 }, { potassium: 4.9 }), false);
        assert.equal(base({ kind: 'sbp_below', value: 100 }, { sbp: 99 }), true); assert.equal(base({ kind: 'sbp_below', value: 100 }, { sbp: 100 }), false);
        assert.equal(base({ kind: 'age_at_least', value: 75 }, { age: 75 }), true); assert.equal(base({ kind: 'age_at_least', value: 75 }, { age: 74 }), false);
        assert.equal(base({ kind: 'sex', value: 'male' }, { sex: 'Male' }), true); assert.equal(base({ kind: 'sex', value: 'male' }, { sex: 'Female' }), false);
        assert.equal(base({ kind: 'self_identified_black' }, { race: 'Black' }), true); assert.equal(base({ kind: 'self_identified_black' }, { race: 'Asian' }), false);
        assert.equal(base({ kind: 'has_diabetes' }, {}, ['Diabetes Mellitus Type 2']), true); assert.equal(base({ kind: 'has_diabetes' }, {}, ['Type 1 Diabetes Mellitus']), true); assert.equal(base({ kind: 'has_diabetes' }, {}, []), false);
        assert.equal(base({ kind: 'no_diabetes' }, {}, []), true); assert.equal(base({ kind: 'no_diabetes' }, {}, ['Diabetes Mellitus Type 2']), false);
        assert.equal(base({ kind: 'has_gout' }, {}, ['Gout']), true); assert.equal(base({ kind: 'has_gout' }, {}, []), false);
        const intol = P({}); intol.discontinued_meds = [{ med_name: 'x', reason: 'Gout / Hyperuricemia' } as any];
        assert.equal(harmBurdenFor(T([row('a', 'ACEi', [], 'angioedema', 1)], [mult('m', 'angioedema', ['ACEi'], { kind: 'has_gout' }, 2)]), [LIS()], intol).lines[0].multipliers.length, 1, 'gout via documented intolerance');
    });
    check('10d. a condition whose patient value is missing: a multiplier above 1 is applied as the higher-risk case, below 1 is not; either way it is listed with a reason', () => {
        const run = (cond: HarmCondition, p: Partial<Patient>) => harmBurdenFor(T([row('a', 'ACEi', [], 'angioedema', 1)], [mult('m', 'angioedema', ['ACEi'], cond, 2)]), [LIS()], P(p));
        for (const [cond, p] of [
            [{ kind: 'egfr_below', value: 60 }, { egfr: 0 }], [{ kind: 'potassium_at_least', value: 5 }, { potassium: 0 }], [{ kind: 'sbp_below', value: 100 }, { sbp: NaN }],
            [{ kind: 'age_at_least', value: 65 }, { age: undefined as any }], [{ kind: 'sex', value: 'male' }, { sex: undefined as any }], [{ kind: 'self_identified_black' }, { race: undefined as any }],
        ] as [HarmCondition, Partial<Patient>][]) {
            const r = run(cond, p);
            near(r.lines[0].charged_rate, 2, cond.kind); assert.equal(r.lines[0].multipliers.length, 1, cond.kind);   // ratio 2 (above 1): applied as the conservative case
            assert.equal(r.multipliers_not_evaluated.length, 1, cond.kind); assert.equal(r.multipliers_not_evaluated[0].applied, true);
            assert.ok(r.unknown_assumptions.length === 1 && r.unknown_assumptions[0].applied === true, cond.kind); assert.equal(r.multipliers_not_evaluated[0].multiplier_id, 'm'); assert.ok(r.multipliers_not_evaluated[0].reason.length > 0);
            assert.equal(r.multipliers_not_evaluated[0].drug, 'Lisinopril');
        }
        assert.equal(run({ kind: 'sex', value: 'male' }, {}).multipliers_not_evaluated.length, 0, 'known value: nothing listed');
    });

    check('11. crossCheck and caution rows are never charged; they appear in not_charged', () => {
        const t = T([row('x', 'Beta Blocker', [], 'discontinuationForAdverseEvent', 9, { layer: 'crossCheck' }), row('w', 'Beta Blocker', [], 'withdrawalRebound', 4, { layer: 'caution' })]);
        const r = harmBurdenFor(t, [CARV()], P());
        near(r.burden, 0); assert.equal(r.lines.length, 0);
        assert.deepEqual(r.not_charged.map((n: any) => [n.row_id, n.layer]).sort(), [['w', 'caution'], ['x', 'crossCheck']]);
        assert.ok(r.not_charged.every((n: any) => n.drug === 'Carvedilol' && n.reason));
    });

    check('12. the same harm from two drugs adds; burden = sum of harm points + symptom points', () => {
        const t = T([row('a', 'ACEi', [], 'hyperkalemia', 2), row('b', 'MRA', [], 'hyperkalemia', 4), sym('c', 'Beta Blocker', [], 'fatigue', 10), xc('Loop Diuretic')]);
        const r = harmBurdenFor(t, [LIS(), SPI(), CARV(), FURO()], P());
        assert.equal(r.lines.filter((l: any) => l.effect === 'hyperkalemia').length, 2);
        near(r.burden, 6 * W.moderate + 10 * SYM);
        near(r.burden, r.lines.reduce((s: number, l: any) => s + l.points, 0));
    });

    check('13. deterministic: same inputs, same output and line order (regimen order, then effect id)', () => {
        const t = T([row('1', 'MRA', [], 'hyperkalemia', 1), row('2', 'MRA', [], 'anemia', 1), row('3', 'ACEi', [], 'angioedema', 1), row('4', 'ACEi', [], 'syncope', 1), row('5', 'ACEi', [], 'cough', 3, { layer: 'symptomFigure' })]);
        const rows2 = [...t.rows].reverse();
        const a = harmBurdenFor(t, [SPI(), LIS()], P()), b = harmBurdenFor({ rows: rows2, multipliers: [] }, [SPI(), LIS()], P());
        assert.deepEqual(a, b); assert.deepEqual(a, harmBurdenFor(t, [SPI(), LIS()], P()));
        assert.deepEqual(a.lines.map((l: any) => `${l.drug}:${l.effect ?? 'symptoms'}`), ['Spironolactone:anemia', 'Spironolactone:hyperkalemia', 'Lisinopril:angioedema', 'Lisinopril:syncope', 'Lisinopril:symptoms']);
    });

    check('compareHarmBurden: difference in burden and the lines that changed', () => {
        const t = T([row('a', 'ACEi', [], 'angioedema', 1), row('b', 'MRA', [], 'hyperkalemia', 4), xc('Beta Blocker')]);
        const c = compareHarmBurden(t, [LIS(), SPI()], [LIS(), CARV()], P());
        near(c.candidate_burden, W.serious + 4 * W.moderate); near(c.current_burden, W.serious); near(c.burden_difference, 4 * W.moderate);
        assert.deepEqual(c.changed_lines.map((l: any) => [l.drug, l.effect, l.before_points, l.after_points]), [['Spironolactone', 'hyperkalemia', null, 4 * W.moderate]]);
        near(c.changed_lines[0].delta, 4 * W.moderate);
        const same = compareHarmBurden(t, [LIS()], [LIS()], P()); near(same.burden_difference, 0); assert.equal(same.changed_lines.length, 0);
    });

    return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = runHarmBurdenChecks(); console.log(result); process.exitCode = result.failed ? 1 : 0;
}
