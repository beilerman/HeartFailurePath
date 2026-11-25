/**
 * Round 5 engine rulings of the 2026-11-21 readiness pass (Y1 to Y13). Every check builds the patient a reviewer reported AND at least three neighbours, and asserts the corrected
 * behaviour. Run standalone (`npx tsx scripts/engineReadinessR5Checks.ts`) or through `npm run verify`.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY } from '../constants';
import { mk, runEngine, summaries } from './engineReadinessR2Checks';
import { entry } from './systemicReviewChecks';
import { gen3r } from './r3Generator';
import { generateAndScoreModifications, clonePatient as clonePt } from '../services/simulationService';
import { SCOPE_CONDITIONS } from '../services/engine/scopeGate';
import { renalCapExceeded, highestAllowedDose } from '../services/engine/regimenUtils';
import { evidenceFor, OUTCOME_EVIDENCE_TABLE, populationKeyFor, OUTCOME_KEYS, efBandFor, buildOutcomeEstimateViews } from '../services/engine/outcomeBenefit';
import { symptomRowFor, SYMPTOM_TABLE } from '../services/engine/symptomBenefit';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { CONGESTION_EXCESS_KG_ABOVE, LOW_OUTPUT } from '../services/engine/thresholds';
import { DECOMPENSATION_MIN_CONGESTION_FINDINGS } from '../services/clinicalPredicates';
import { urgent } from './engineReadinessR2Checks';
import { scoredCandidates } from './scoredCandidates';
import { PRICES as TIER_PRICES } from './r2Generator';
import { brokenDisplayFloors } from '../services/engine/selection';
import { TOO_CLOSE_TO_SEPARATE_POINTS } from '../services/engine/thresholds';
import { readFileSync } from 'node:fs';
import { nsMraFillsMraSlot } from '../services/engine/domains';
import { RULESET_VERSION } from '../services/rulesetVersion';
import type { Patient, SimulationOutput } from '../types';

export const headOf = (a: string): string => { const i = a.indexOf(': '); return i > 0 ? a.slice(0, i) : a.slice(0, 40); };
/** Every string an output shows: alerts, option summaries, the option explanations (everything the engine returns that a screen can print). */
export const allText = (o: SimulationOutput): string[] => {
    const out: string[] = [];
    const walk = (v: unknown, depth = 0) => {
        if (depth > 12 || v === null || v === undefined) return;
        if (typeof v === 'string') out.push(v);
        else if (Array.isArray(v)) v.forEach(x => walk(x, depth + 1));
        else if (v instanceof Set) [...v].forEach(x => walk(x, depth + 1));
        else if (typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (k !== 'med' && k !== 'source' && k !== 'target') walk(x, depth + 1);
    };
    walk(o.clinicalAlerts); walk(o.scoredRegimens.map(r => ({ s: summaries(r), n: r.modification_set?.modifications.map(m => m.summary), e: (r as unknown as { explanation?: unknown }).explanation })));
    walk(o.why_first); walk(o.monitoringPlan); walk(o.missingDataNotices); walk(o.decisionReadiness);
    return out;
};
/** A blank number printed as a measurement: "0 mmHg", "heart rate 0", "eGFR 0", "potassium 0". */
export const PRINTED_ZERO = /(?:\b(?:is|of|at|was|to|reads?) |\()0(?:\.0)? ?(?:mmHg|bpm|kg|%|mg|mEq\/L|mmol\/L|mL\/min|g\/dL|pg|ng)|(?:^|[^\d.])0 ?mmHg|\b(?:eGFR|potassium|LVEF|ejection fraction|creatinine|heart rate|pulse|oxygen saturation|SpO2|hemoglobin|weight|BUN|age|systolic(?: blood pressure)?) (?:is |of |was )?0(?:\.0)?(?![\d.])/i;
/** The urgent alerts that read a threshold on one numeric input. A blank input may never raise one that the same patient with a normal value does not. */
export const THRESHOLD_HEADS = ['HEMODYNAMIC INSTABILITY', 'HYPERKALEMIC EMERGENCY', 'HYPOXIA ALERT', 'POOR PERFUSION', 'LOW OUTPUT STATE', 'ACUTE DECOMPENSATION', 'BRADYCARDIA', 'SLOW HEART RATE', 'LOW KIDNEY FUNCTION ON A RAAS INHIBITOR', 'HYPOKALEMIA', 'LOW POTASSIUM'];

const BLANKS: Array<[string, unknown]> = [['0', 0], ['undefined', undefined], ['NaN', NaN], ['null', null]];
type MkOver = Parameters<typeof mk>[0];
const base = (extra: MkOver = {}, regimen = [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]) => mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, ...extra }, regimen);

export function runEngineReadinessR5Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] ReadinessR5: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR5: ${name}: ${(e as Error).message?.slice(0, 900)}`); }
    };

    // ---------------- Y1: a blank pressure is never a measurement -------------------------------------------------------------------------------------------------
    // r5-clinical B1: systolic pressure blank gave "Systolic blood pressure is 0 mmHg, below 90 ... this is an emergency" beside the input-error screen.
    check('Y1 reviewer cases BP_s0 / BP_both0 / BP_undef / BP_nan (and null): a blank systolic pressure raises no hemodynamic alert and prints no 0 mmHg', () => {
        for (const [label, v] of BLANKS) for (const dbp of [70, 0, undefined] as const) {
            const o = runEngine(base({ sbp: v as never, dbp: dbp as never }));
            const alerts = o.clinicalAlerts;
            assert.ok(!alerts.some(a => a.startsWith('HEMODYNAMIC INSTABILITY')), `sbp ${label} dbp ${dbp}: ${alerts.map(headOf).join(' | ')}`);
            assert.ok(!allText(o).some(t => PRINTED_ZERO.test(t)), `sbp ${label} dbp ${dbp}: prints a zero: ${allText(o).find(t => PRINTED_ZERO.test(t))?.slice(0, 160)}`);
            assert.ok(alerts.some(a => /Systolic blood pressure/i.test(a) && /not entered|waits for/i.test(a)) || allText(o).some(t => /systolic blood pressure/i.test(t) && /cannot be assessed/i.test(t)), `sbp ${label}: the screen text does not say the pressure was not entered and what cannot be assessed`);
        }
    });
    check('Y1 neighbours: a measured low systolic pressure still raises the alert; a blank one beside a real stop state keeps that state', () => {
        for (const sbp of [84, 89]) assert.ok(runEngine(base({ sbp, dbp: 50 })).clinicalAlerts.some(a => a.startsWith('HEMODYNAMIC INSTABILITY') && new RegExp(`${sbp} mmHg`).test(a)), `sbp ${sbp}`);
        assert.ok(!runEngine(base({ sbp: 90, dbp: 55 })).clinicalAlerts.some(a => a.startsWith('HEMODYNAMIC INSTABILITY')));
        const k = runEngine(base({ sbp: 0, potassium: 6.8 })).clinicalAlerts;
        assert.ok(k.some(a => a.startsWith('HYPERKALEMIC EMERGENCY')) && !k.some(a => a.startsWith('HEMODYNAMIC INSTABILITY')), k.map(headOf).join(' | '));
    });
    check('Y1 audit: every numeric input blank (0, undefined, NaN) on the full path and on the stop paths prints no zero and raises no threshold alert the same patient with a normal value does not', () => {
        const fields: Array<[keyof Patient, number]> = [['sbp', 120], ['dbp', 70], ['pulse', 78], ['potassium', 4.4], ['egfr', 70], ['creatinine', 1], ['lvef', 30], ['oxygen_saturation', 97], ['hemoglobin', 13], ['age', 66], ['bun', 22], ['nt_pro_bnp', 1500], ['bmi', 27], ['ferritin', 200], ['tsat', 25]];
        const paths: Array<[string, MkOver]> = [['full', {}], ['potassium stop', { potassium: 6.7 }], ['hypotension stop', { sbp: 84, dbp: 50 }], ['scope', { scope_conditions: new Set(['Dialysis']) }]];
        for (const [path, extra] of paths) for (const [f, normal] of fields) {
            if ((path === 'potassium stop' && f === 'potassium') || (path === 'hypotension stop' && (f === 'sbp' || f === 'dbp'))) continue;
            const ref = new Set(runEngine(base({ ...extra, [f]: normal })).clinicalAlerts.map(headOf));
            for (const [label, v] of BLANKS) {
                const o = runEngine(base({ ...extra, [f]: v as never }));
                const t = allText(o).find(x => PRINTED_ZERO.test(x));
                assert.ok(!t, `${path} ${String(f)} ${label}: prints a zero: ${t?.slice(0, 160)}`);
                const extraHeads = o.clinicalAlerts.map(headOf).filter(h => THRESHOLD_HEADS.includes(h) && !ref.has(h));
                assert.deepEqual(extraHeads, [], `${path} ${String(f)} ${label}: blank input raises ${extraHeads.join(', ')}`);
            }
        }
        // the weights: a blank dry or current weight is not "0 kg" and does not call the patient congested or depleted
        for (const [label, v] of BLANKS) for (const which of ['dry', 'cur'] as const) {
            const o = runEngine(base({ findings: [], [which]: v as never }));
            assert.ok(!allText(o).some(x => PRINTED_ZERO.test(x)), `${which} ${label}: prints a zero`);
        }
    });
    check('Y1 oxygen saturation above 100 is an implausible value, like the others; 100 and below are not', () => {
        for (const v of [101, 105, 150, 999]) {
            const o = runEngine(base({ oxygen_saturation: v }));
            assert.ok(o.clinicalAlerts.some(a => a.startsWith('IMPLAUSIBLE VALUE') && /oxygen saturation/i.test(a) && new RegExp(`${v}`).test(a)), `${v}: ${o.clinicalAlerts.map(headOf).join(' | ')}`);
            assert.equal(o.scoredRegimens.length, 0, `${v}: options shown on an implausible value`);
        }
        for (const v of [100, 99, 90, 85]) assert.ok(!runEngine(base({ oxygen_saturation: v })).clinicalAlerts.some(a => a.startsWith('IMPLAUSIBLE VALUE')), `${v}`);
    });

    // ---------------- Y2: a forced reduction names the rule that caused it -----------------------------------------------------------------------------------------
    // r5-clinical B2: carvedilol 50 mg twice daily at 85 kg or less was "reduced because of eGFR ... the renal maximum" although the cap is the label's body-weight rule.
    const carv = (dry: number, egfr: number, extra: MkOver = {}) => base({ dry, cur: dry, egfr, ...extra }, [entry('Carvedilol', 50, 'bid'), entry('Lisinopril', 10)]);
    check('Y2 reviewer cases CV1 to CV5: carvedilol 50 mg twice daily at 85 kg or less is reduced for the label body-weight rule, with the weight, and no kidney wording', () => {
        for (const dry of [50, 60, 70, 80, 85]) for (const egfr of [90, 60, 40, 20]) {
            const o = runEngine(carv(dry, egfr));
            const reds = o.scoredRegimens.flatMap(r => summaries(r)).filter(s => /^Reduce Carvedilol/.test(s));
            assert.ok(reds.length > 0, `dry ${dry} egfr ${egfr}: no reduction`);
            for (const s of reds) {
                assert.ok(new RegExp(`${dry} kg`).test(s) && /85 kg/.test(s) && /body weight/.test(s), `dry ${dry} egfr ${egfr}: ${s}`);
                assert.ok(!/eGFR|renal|kidney/i.test(s), `dry ${dry} egfr ${egfr}: kidney wording: ${s}`);
            }
            assert.ok(!allText(o).some(t => /Carvedilol/.test(t) && /renal maximum|dose limit for kidney function/i.test(t)), `dry ${dry} egfr ${egfr}: kidney wording elsewhere`);
        }
        for (const dry of [86, 95, 120]) assert.ok(!runEngine(carv(dry, 90)).scoredRegimens.flatMap(r => summaries(r)).some(s => /^Reduce Carvedilol/.test(s)), `dry ${dry}: reduced above the weight limit`);
    });
    check('Y2 generated over every drug with a dose cap: a kidney cap says kidney, with the eGFR; no other cap mentions the kidney (oracle: the same patient at 200 kg and the same eGFR still has the cap)', () => {
        let seen = 0;
        for (const med of MEDICATION_FORMULARY) {
            if (!med.renal_adjustment) continue;
            for (const dose of med.available_doses) for (const egfr of [90, 60, 44, 40, 29, 20]) for (const dry of [60, 85, 86, 120]) {
                if (typeof dose.strength !== 'number') continue;
                const reg = { med, dose, selected_frequency: dose.frequency_options[0] };
                const p = base({ dry, cur: dry, egfr }, [reg as never]);
                const hit = renalCapExceeded(reg as never, p);
                if (!hit) continue;
                const heavy = base({ dry: 200, cur: 200, egfr }, [reg as never]);
                const kidneyCap = renalCapExceeded(reg as never, heavy) !== null;
                const o = runEngine(p);
                const reds = o.scoredRegimens.flatMap(r => summaries(r)).filter(s => new RegExp(`^Reduce ${med.name.replace(/[()]/g, '\\$&')}`).test(s));
                for (const s of reds) { seen++; assert.equal(/eGFR|renal maximum|kidney/i.test(s), kidneyCap, `${med.name} ${dose.strength} egfr ${egfr} dry ${dry}: ${s}`); }
            }
        }
        assert.ok(seen >= 10, `only ${seen} forced reductions generated`);
    });
    check('Y2 the highest-dose sentence names the body-weight rule for carvedilol at 85 kg or less (with the weight) and the kidney only for a kidney cap', () => {
        const carvedilol = MEDICATION_FORMULARY.find(m => m.name === 'Carvedilol')!, ramipril = MEDICATION_FORMULARY.find(m => m.name === 'Ramipril')!;
        for (const dry of [60, 85]) for (const egfr of [90, 25]) {
            const t = highestAllowedDose(carvedilol, base({ dry, cur: dry, egfr }, []))?.cap?.text ?? '';
            assert.ok(/body weight/.test(t) && new RegExp(`${dry} kg`).test(t) && !/kidney|eGFR/i.test(t), `carvedilol ${dry} kg eGFR ${egfr}: ${t}`);
        }
        for (const dry of [86, 120]) assert.equal(highestAllowedDose(carvedilol, base({ dry, cur: dry, egfr: 90 }, []))?.cap, undefined, `carvedilol ${dry} kg has a cap`);
        for (const dry of [60, 120]) { const t = highestAllowedDose(ramipril, base({ dry, cur: dry, egfr: 25 }, []))?.cap?.text ?? ''; assert.ok(/kidney function \(eGFR 25\)/.test(t) && !/body weight/.test(t), `ramipril ${dry} kg: ${t}`); }
    });

    // ---------------- Y3: congestion on examination without a weight gain is explained ------------------------------------------------------------------------------
    // r5-clinical P1: 3+ edema, ascites, crackles and raised JVP at the dry weight, on no loop diuretic, got "No medication change" and no sentence about why no diuretic is offered.
    const FOUR = ['Edema (3+)', 'Ascites', 'Crackles', 'JVP Elevated'];
    const ONE_KG = String(CONGESTION_EXCESS_KG_ABOVE);
    const LOOP_REASON = new RegExp(`No loop diuretic start or increase is available today: a new loop diuretic is started only when the weight is more than ${ONE_KG} kg above dry weight`);
    const CONGEST_ALERT = /^CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN/;
    const SCALE_ALERT = /^SCALE AND EXAMINATION DISAGREE/;
    const cg = (excess: number, findings: string[], extra: MkOver = {}, regimen = [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]) =>
        base({ dry: 80, cur: Math.round((80 + excess) * 10) / 10, findings, ...extra }, regimen);
    const optionWarnings = (o: SimulationOutput) => o.scoredRegimens.map(r => r.warnings.join(' | '));
    check('Y3 reviewer case P1: four congestion findings at the dry weight, no loop diuretic: every option says why no diuretic is offered, and the alert asks for the dry weight to be checked', () => {
        const o = runEngine(cg(0, FOUR));
        assert.ok(o.scoredRegimens.length > 0);
        o.scoredRegimens.forEach((r, i) => assert.ok(LOOP_REASON.test(r.warnings.join(' | ')), `option ${i + 1} lacks the reason: ${r.warnings.join(' | ').slice(0, 200)}`));
        const a = urgent(o).find(x => CONGEST_ALERT.test(x));
        assert.ok(a, `no alert: ${urgent(o).map(headOf).join(' | ')}`);
        assert.ok(/dry weight/.test(a!) && /check|confirm|reassess/i.test(a!) && new RegExp(`more than ${ONE_KG} kg above`).test(a!) && /80(\.0)? kg/.test(a!), a);
        assert.ok(!urgent(o).some(x => SCALE_ALERT.test(x)), 'both alerts');
    });
    check('Y3 neighbours: the alert needs the decompensation count of findings, the sentence needs one; neither when a loop is offered, on a loop, or the weight is above the threshold', () => {
        const nearly = [FOUR[0]];
        // one finding: the option sentence, no alert
        let o = runEngine(cg(0, nearly));
        assert.ok(o.scoredRegimens.every(r => LOOP_REASON.test(r.warnings.join(' | '))), 'one finding: sentence missing');
        assert.ok(!urgent(o).some(x => CONGEST_ALERT.test(x)), 'one finding raised the alert');
        // exactly the engine count
        o = runEngine(cg(0, FOUR.slice(0, DECOMPENSATION_MIN_CONGESTION_FINDINGS)));
        assert.ok(urgent(o).some(x => CONGEST_ALERT.test(x)), 'the count of findings that meets decompensation did not raise it');
        // within the threshold above dry weight and a little below it: still held
        for (const ex of [0.5, 1, -0.5, -1]) {
            o = runEngine(cg(ex, FOUR));
            assert.ok(urgent(o).some(x => CONGEST_ALERT.test(x)) && !urgent(o).some(x => SCALE_ALERT.test(x)), `excess ${ex}: ${urgent(o).map(headOf).join(' | ')}`);
            assert.ok(o.scoredRegimens.every(r => LOOP_REASON.test(r.warnings.join(' | '))), `excess ${ex}: sentence missing`);
        }
        // above the threshold: the diuretic is offered, no alert, no "not available" sentence
        o = runEngine(cg(1.5, FOUR));
        assert.ok(!urgent(o).some(x => CONGEST_ALERT.test(x)) && !optionWarnings(o).some(w => LOOP_REASON.test(w)), 'raised although the weight is above the threshold');
        // below the scale threshold: the scale-disagreement alert only
        o = runEngine(cg(-1.5, FOUR));
        assert.ok(urgent(o).some(x => SCALE_ALERT.test(x)) && !urgent(o).some(x => CONGEST_ALERT.test(x)), `excess -1.5: ${urgent(o).map(headOf).join(' | ')}`);
        // already on a loop: no new loop is in question
        o = runEngine(cg(0, FOUR, {}, [entry('Lisinopril', 10), entry('Furosemide', 40)]));
        assert.ok(!urgent(o).some(x => CONGEST_ALERT.test(x)) && !optionWarnings(o).some(w => LOOP_REASON.test(w)), 'raised for a patient on a loop diuretic');
        // no congestion finding: nothing
        o = runEngine(cg(0, []));
        assert.ok(!urgent(o).some(x => CONGEST_ALERT.test(x)) && !optionWarnings(o).some(w => LOOP_REASON.test(w)), 'raised without a finding');
        // the weight is not the reason when every oral loop diuretic is excluded for another one (anuria, an allergy to all of them) or potassium is below 3.5: no statement about the weight
        for (const over of [{ comorb: ['Anuria'] }, { potassium: 3.2 }, { allergies: new Set(['Furosemide', 'Torsemide', 'Bumetanide']) }] as Array<NonNullable<MkOver>>) {
            o = runEngine(cg(0, FOUR, over));
            assert.ok(!urgent(o).some(x => CONGEST_ALERT.test(x)) && !optionWarnings(o).some(w => LOOP_REASON.test(w)), `${JSON.stringify(Object.keys(over ?? {}))}: statement about the weight although another rule excludes the loop diuretics`);
        }
        // an allergy to one loop diuretic leaves the others: the weight is still the reason
        o = runEngine(cg(0, FOUR, { allergies: new Set(['Furosemide']) }));
        assert.ok(urgent(o).some(x => CONGEST_ALERT.test(x)), 'one allergy removed the alert');
        // blank weights are not a measurement
        o = runEngine(cg(0, FOUR, { cur: 0 }));
        assert.ok(!urgent(o).some(x => CONGEST_ALERT.test(x)));
    });
    check('Y3 the alert is on every path: a stop state and the limited review raise it too, and no alert names an option, plan or recommendation', () => {
        for (const [label, extra] of [['hypotension stop', { sbp: 84, dbp: 50 }], ['potassium stop', { potassium: 6.7 }], ['limited review', { bun: 0, creatinine: 0, egfr: 0 }], ['scope', { scope_conditions: new Set(['Dialysis']) }]] as Array<[string, MkOver]>) {
            const o = runEngine(cg(0, FOUR, extra));
            const a = o.clinicalAlerts.find(x => CONGEST_ALERT.test(x));
            assert.ok(a, `${label}: ${o.clinicalAlerts.map(headOf).join(' | ')}`);
            if (o.scoredRegimens.length === 0) assert.ok(!/option|plan|recommend/i.test(a!), `${label}: ${a}`);
        }
    });

    // ---------------- Y4: poor-perfusion findings above the ejection-fraction limit ------------------------------------------------------------------------------------
    // r5-clinical P2: cool extremities, pulse pressure 18 and BUN 40 raise the low-output state at EF 19 and nothing at EF 25, 30 or 35, where two drugs are started.
    const PERFUSION_ALERT = /^POSSIBLE POOR PERFUSION/;
    const pf = (lvef: number, over: MkOver = {}) => base({ lvef, sbp: 100, dbp: 82, bun: 40, creatinine: 1.0, findings: ['Cool Extremities'], ...over });
    const LIMIT = String(LOW_OUTPUT.lvefBelow);
    check('Y4 reviewer case P2: three markers at EF 20, 25, 30, 35 and 55 raise the alert listing the findings, the limit from the constant and the ask to assess perfusion; at EF 19 the low-output state is raised instead', () => {
        for (const ef of [20, 25, 30, 35, 55]) {
            const o = runEngine(pf(ef));
            const a = urgent(o).find(x => PERFUSION_ALERT.test(x));
            assert.ok(a, `EF ${ef}: ${urgent(o).map(headOf).join(' | ')}`);
            assert.ok(/cool extremities/i.test(a!) && /pulse pressure 18/.test(a!) && /BUN to creatinine ratio 40/.test(a!), `EF ${ef}: findings: ${a}`);
            assert.ok(new RegExp(`below an ejection fraction of ${LIMIT}%`).test(a!) && new RegExp(`${ef}%`).test(a!) && /assess perfusion before starting or raising a drug/i.test(a!), `EF ${ef}: ${a}`);
            assert.ok(!o.clinicalAlerts.some(x => x.startsWith('LOW OUTPUT STATE')), `EF ${ef}: low output raised`);
        }
        const low = runEngine(pf(19));
        assert.ok(low.clinicalAlerts.some(x => x.startsWith('LOW OUTPUT STATE')) && !low.clinicalAlerts.some(x => PERFUSION_ALERT.test(x)), 'EF 19: both or neither');
    });
    check('Y4 neighbours: two of three markers raise it, one does not; the marker edges follow the engine constants; an invalid pressure or a blank ejection fraction does not', () => {
        const ids = (o: SimulationOutput) => o.clinicalAlerts.some(x => PERFUSION_ALERT.test(x));
        // two markers only (cool extremities + narrow pulse pressure; BUN normal)
        assert.ok(ids(runEngine(pf(30, { bun: 15 }))), 'cool + narrow pulse pressure');
        // cool + BUN, normal pulse pressure
        assert.ok(ids(runEngine(pf(30, { sbp: 120, dbp: 70 }))), 'cool + BUN ratio');
        // narrow pulse pressure + BUN, no cool extremities
        assert.ok(ids(runEngine(pf(30, { findings: [] }))), 'pulse pressure + BUN ratio');
        // one marker: none
        assert.ok(!ids(runEngine(pf(30, { bun: 15, sbp: 120, dbp: 70 }))), 'cool extremities only');
        assert.ok(!ids(runEngine(pf(30, { findings: [], sbp: 120, dbp: 70 }))), 'BUN ratio only');
        assert.ok(!ids(runEngine(pf(30, { findings: [], bun: 15 }))), 'pulse pressure only');
        // edges: pulse pressure exactly the limit is a marker, one more is not; the BUN ratio must be ABOVE its limit
        assert.ok(ids(runEngine(pf(30, { findings: [], sbp: 100 + 0, dbp: 100 - LOW_OUTPUT.pulsePressureMax, bun: 40 }))), 'pulse pressure at the limit');
        assert.ok(!ids(runEngine(pf(30, { findings: [], sbp: 100, dbp: 100 - LOW_OUTPUT.pulsePressureMax - 1, bun: 40 }))), 'pulse pressure one above the limit');
        assert.ok(!ids(runEngine(pf(30, { sbp: 120, dbp: 70, bun: 20, creatinine: 1.0 }))), 'ratio at its limit is not above it');
        // the ejection fraction is blank or the pressure is invalid: no alert (the other rules speak)
        assert.ok(!ids(runEngine(pf(0))), 'blank ejection fraction');
        assert.ok(!ids(runEngine(pf(30, { sbp: 80, dbp: 90 }))), 'systolic below diastolic');
        // poor perfusion with decompensation already says so: no second alert
        const cold = runEngine(pf(30, { nyha_class: 'IV' }));
        assert.ok(cold.clinicalAlerts.some(x => x.startsWith('POOR PERFUSION')) && !ids(cold), cold.clinicalAlerts.map(headOf).join(' | '));
    });
    check('Y4 on every path: a stop state and the scope screen raise it too, among the urgent alerts, with no option, plan or recommendation wording on a screen without options', () => {
        for (const [label, extra] of [['potassium stop', { potassium: 6.7 }], ['scope', { scope_conditions: new Set(['Dialysis']) }], ['unknown labs', { egfr: 0, creatinine: 0 }]] as Array<[string, MkOver]>) {
            const o = runEngine(pf(30, extra));
            const a = o.clinicalAlerts.find(x => PERFUSION_ALERT.test(x));
            assert.ok(a, `${label}: ${o.clinicalAlerts.map(headOf).join(' | ')}`);
            if (o.scoredRegimens.length === 0) assert.ok(!/option|plan|recommend/i.test(a!), `${label}: ${a}`);
        }
        const full = runEngine(pf(30));
        assert.ok(full.scoredRegimens.length > 0 && urgent(full).some(x => PERFUSION_ALERT.test(x)));
    });

    // ---------------- Y5: finerenone at LVEF 50 or above with a prior reduced EF uses the measured preserved rows ------------------------------------------------------------
    // r5-engine M5: the improved-EF patient on finerenone at LVEF 50 or above was valued by the rows extrapolated from steroidal MRA trials (0.73, 0.63); FINEARTS-HF enrolled from LVEF 40 upward.
    const FINERENONE = MEDICATION_FORMULARY.find(m => m.drug_class === 'nsMRA')!;
    const y5Patient = (lvef: number, prior?: number): Patient => {
        const p = clonePatient(SCENARIOS.find(x => x.title.startsWith('De-novo HFrEF'))!.patient);
        p.lvef = lvef; p.previous_lvef = prior as never; p.ever_lvef_le_40 = (prior !== undefined ? 'yes' : 'unknown') as never;
        return p;
    };
    const y5Ids = (p: Patient) => ({
        death: evidenceFor(OUTCOME_EVIDENCE_TABLE, FINERENONE, p, 'all_cause_death', populationKeyFor(FINERENONE, p)).id,
        hfh: evidenceFor(OUTCOME_EVIDENCE_TABLE, FINERENONE, p, 'hf_hospitalization', populationKeyFor(FINERENONE, p)).id,
        symptom: symptomRowFor(SYMPTOM_TABLE, FINERENONE, p).id,
    });
    check('Y5 finerenone, LVEF 15 to 70, with and without a prior reduced EF: reduced rows below 40 only; measured mildly-reduced rows at 40 to 49; measured preserved rows from 50, for both histories', () => {
        for (let l = 15; l <= 70; l++) for (const prior of [undefined, 30]) {
            const want = l < 40 ? { death: 'nsmra-reduced-death', hfh: 'nsmra-reduced-hfh', symptom: 'nsmra-reduced' }
                : l < 50 ? { death: 'nsmra-mildly-reduced-death', hfh: 'nsmra-mildly-reduced-hfh', symptom: 'nsmra-mildly_reduced' }
                    : { death: 'nsmra-preserved-death', hfh: 'nsmra-preserved-hfh', symptom: 'nsmra-preserved' };
            assert.deepEqual(y5Ids(y5Patient(l, prior)), want, `LVEF ${l} prior ${prior}`);
        }
        const rr = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)!.rr;
        assert.deepEqual([rr('nsmra-preserved-death'), rr('nsmra-preserved-hfh')], [0.94, 0.82]);
    });
    check('Y5 the explanatory note is shown for the improved-EF patient at 50 and above (the stated band is reduced) and not for a preserved-band patient; the figures used are 0.94 and 0.82', () => {
        const view = (l: number, prior?: number) => buildOutcomeEstimateViews([{ med: FINERENONE, dose: FINERENONE.available_doses[0], selected_frequency: FINERENONE.available_doses[0].frequency_options[0] } as never], y5Patient(l, prior))[0].contributors.find(c => c.drug_class === 'nsMRA')!;
        for (const l of [50, 55, 70]) {
            const c = view(l, 30);
            assert.equal(efBandFor(y5Patient(l, 30)), 'reduced');
            assert.equal(c.band_note, 'Finerenone figures are those measured from ejection fraction 40 upward (FINEARTS-HF), which is why they differ from the evidence band stated for this patient.', `LVEF ${l}`);
            assert.equal(c.rr_published, c.row_id.endsWith('death') ? 0.94 : 0.82, `LVEF ${l} ${c.row_id}`);
            assert.equal(view(l).band_note, undefined, `LVEF ${l} preserved band: note shown`);
        }
    });
    check('Y5 no other class changes: for every drug the row ids at LVEF 15 to 70, with and without a prior reduced EF, equal the plain band lookup except finerenone from 40 to 49 (band reduced) and from 50 with a prior reduced EF', () => {
        let compared = 0;
        for (let l = 15; l <= 70; l++) for (const prior of [undefined, 30]) {
            const p = y5Patient(l, prior);
            for (const m of MEDICATION_FORMULARY) for (const o of OUTCOME_KEYS) {
                const key = populationKeyFor(m, p), band = efBandFor(p);
                const cands = OUTCOME_EVIDENCE_TABLE.filter(r => r.outcome === o && r.ef_band === band && r.drugs.includes(m.name));
                const keyed = key === undefined ? [] : cands.filter(r => r.population_key === key);
                const oldRow = (keyed.length ? keyed : cands.filter(r => r.population_key === undefined || r.population_key === 'other'))[0];
                const now = evidenceFor(OUTCOME_EVIDENCE_TABLE, m, p, o, key);
                compared++;
                if (now.id !== oldRow.id) assert.ok(m.drug_class === 'nsMRA' && l >= 40 && band === 'reduced' && (l <= 49 || prior !== undefined), `${m.name} LVEF ${l} prior ${prior}: ${oldRow.id} became ${now.id}`);
            }
        }
        assert.ok(compared >= 7000, `${compared} comparisons`);
    });

    // ---------------- Y6: a screen with no ranked option speaks only of what is on it ---------------------------------------------------------------------------------------
    // r5-engine M3 / r5-screen S1: "removed in the options", "the plan reduces it", "excluded from all recommendations", "in any option" beside "none is shown".
    const NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));
    const PRICES = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
    const runRaw = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePt(p), NAMES, PRICES);
    /** option, plan and recommend in any form, at the start of a word. */
    const OPTION_WORDS = /\b(options?|plans?|planned|planning|recommend\w*)/i;
    // R10 A7 (rewritten): the three sentences that say no medication option is shown or proposed are the allowed use of the word, as the Z5 sentence is.
    // R11 B7a: the scope alert says "and no medication option is shown." (it said "regimen change"), a fourth sentence of the same kind.
    const ALLOWED_OPTION_SENTENCES = /No medication option is (?:shown for this patient today|proposed at this pressure|proposed until the rhythm is managed)\.|and no medication option is shown\./g;
    const withoutAllowed = (a: string) => a.replace(ALLOWED_OPTION_SENTENCES, '');
    const NO_OPTION_VARIANTS: Array<[string, (p: Patient) => void]> = [
        ['natural', () => { /* the generated patient */ }], ['input error', p => { p.cost_sensitivity = -1; }], ['limited review', p => { p.age = 0; }], ['systolic not above diastolic', p => { p.dbp = p.sbp + 5; }],
        ['implausible ejection fraction', p => { p.lvef = 250; }], ['potassium stop', p => { p.potassium = 6.8; }], ['hypotension stop', p => { p.sbp = 84; p.dbp = 50; }],
        ['heart block stop', p => { p.rhythm = '3rd Degree AV Block'; }], ['scope condition', p => { p.scope_conditions = new Set(['Dialysis']); }],
        ['scope and kidney', p => { p.scope_conditions = new Set(['Cardiac amyloidosis']); p.egfr = 10; p.creatinine = 3.5; p.pulse = 52; }], ['pregnant', p => { p.sex = 'Female'; p.age = 30; p.is_pregnant = true; p.cost_sensitivity = -1; }],
        ['low pressure and kidney', p => { p.sbp = 84; p.dbp = 50; p.egfr = 10; p.creatinine = 3.5; }], ['hypoxia and stop', p => { p.oxygen_saturation = 85; p.potassium = 6.6; }],
    ];
    const optionWordsOnScreenWithNone = (from: number, n: number): { runs: number; none: number; hits: string[] } => {
        let runs = 0, none = 0; const hits: string[] = [];
        for (let sd = from; sd < from + n; sd++) {
            const [vn, apply] = NO_OPTION_VARIANTS[sd % NO_OPTION_VARIANTS.length];
            const p = gen3r(sd).p as Patient; apply(p);
            const o = runRaw(p);
            runs++;
            if (o.scoredRegimens.length > 0) continue;
            none++;
            for (const a of o.clinicalAlerts) { const a2 = withoutAllowed(a); const m = OPTION_WORDS.exec(a2); if (m && hits.length < 8) hits.push(`seed ${sd} (${vn}) ${headOf(a)}: ...${a2.slice(Math.max(0, m.index - 50), m.index + 50)}...`); }
        }
        return { runs, none, hits };
    };
    check('Y6 reviewer patients: dialysis with spironolactone at eGFR 10, systolic 84 with eGFR 10 on spironolactone, and carvedilol at pulse 52 on a scope screen: no alert mentions an option, plan or recommendation', () => {
        const q21 = (over: MkOver = {}) => base({ egfr: 10, creatinine: 3.8, ...over }, [entry('Spironolactone', 25), entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        const cases: Array<[string, Patient]> = [
            ['Q21 dialysis', Object.assign(q21(), { scope_conditions: new Set(['Dialysis']) })],
            ['SBP 84 eGFR 10', q21({ sbp: 84, dbp: 50 })],
            ['carvedilol pulse 52 scope', Object.assign(base({ pulse: 52 }, [entry('Carvedilol', 6.25, 'bid'), entry('Lisinopril', 10)]), { scope_conditions: new Set(['Cardiac amyloidosis']) })],
            ['carvedilol lowest dose pulse 48 scope', Object.assign(base({ pulse: 48 }, [entry('Carvedilol', 3.125, 'bid'), entry('Lisinopril', 10)]), { scope_conditions: new Set(['Dialysis']) })],
            ['K 6.9 on spironolactone, eGFR 25', q21({ potassium: 6.9, egfr: 25, creatinine: 2.4 })],
            ['block 3 with eGFR 10', q21({ rhythm: '3rd Degree AV Block' })],
        ];
        for (const [label, p] of cases) {
            const o = runEngine(p);
            assert.equal(o.scoredRegimens.length, 0, `${label}: options shown`);
            const bad = o.clinicalAlerts.map(withoutAllowed).filter(a => OPTION_WORDS.test(a));
            assert.deepEqual(bad.map(a => `${headOf(a)}: ${a.slice(Math.max(0, (OPTION_WORDS.exec(a)?.index ?? 0) - 40), (OPTION_WORDS.exec(a)?.index ?? 0) + 40)}`), [], label);
        }
    });
    check('Y6 scan: 5,000 random patients over 13 no-option paths: no alert on a screen without options contains option, plan or recommend in any form', () => {
        let runs = 0, none = 0; const hits: string[] = [];
        for (let k = 0; k < 5; k++) { const r = optionWordsOnScreenWithNone(9710000 + k * 1000, 1000); runs += r.runs; none += r.none; hits.push(...r.hits); }
        assert.ok(runs >= 4900 && none >= 3000, `${runs} runs, ${none} without options`);
        assert.deepEqual(hits.slice(0, 6), []);
    });

    // cardiac rehabilitation and the rate-control paragraph
    const REHAB = /^CARDIAC REHABILITATION/, AF_ALERT = /^ATRIAL FIBRILLATION/;
    const heads = (o: SimulationOutput) => o.clinicalAlerts.map(headOf);
    check('Y6 cardiac rehabilitation ("for stable HF patients") is not shown beside acute decompensation, hypoxia, poor perfusion, a stop state or a scope condition; a stable patient still gets it', () => {
        const stable = (over: MkOver = {}) => base({ lvef: 30, nyha_class: 'III', ...over });
        assert.ok(runEngine(stable()).clinicalAlerts.some(a => REHAB.test(a)), 'a stable patient lost the prompt');
        const states: Array<[string, MkOver, string]> = [
            ['acute decompensation', { dry: 70, cur: 75, findings: ['JVP Elevated', 'Crackles', 'Edema (2+)'] }, 'ACUTE DECOMPENSATION'],
            ['hypoxia', { oxygen_saturation: 85 }, 'HYPOXIA ALERT'],
            ['poor perfusion with decompensation', { dry: 70, cur: 75, findings: ['JVP Elevated', 'Crackles', 'Cool Extremities'] }, 'POOR PERFUSION'],
            ['possible poor perfusion', { sbp: 100, dbp: 82, bun: 40, findings: ['Cool Extremities'] }, 'POSSIBLE POOR PERFUSION'],
            ['potassium stop', { potassium: 6.7 }, 'HYPERKALEMIC EMERGENCY'],
            ['potassium 6.2', { potassium: 6.2 }, 'HYPERKALEMIC EMERGENCY'],
            ['heart block', { rhythm: '3rd Degree AV Block' }, 'THIRD-DEGREE AV BLOCK'],
            ['implausible value', { bmi: 120 }, 'IMPLAUSIBLE VALUE'],
            ['input error', { cost_sensitivity: -1 }, 'INPUT ERROR'],
            ['scope condition', { scope_conditions: new Set(['Dialysis']) }, "OUTSIDE THE TOOL'S SCOPE"],
        ];
        for (const [label, over, head] of states) {
            const o = runEngine(stable(over));
            assert.ok(heads(o).includes(head), `${label}: the state alert ${head} is missing: ${heads(o).join(' | ')}`);
            assert.ok(!o.clinicalAlerts.some(a => REHAB.test(a)), `${label}: cardiac rehabilitation is shown beside ${head}`);
        }
    });
    check('Y6 rate-control paragraph: shown for atrial fibrillation in a stable HFrEF patient, not for a paced rhythm, not for sinus rhythm with only a history, not in a stop state; the anticoagulation sentence stays; no digoxin in a stop state', () => {
        const af = (over: MkOver = {}) => base({ lvef: 30, nyha_class: 'III', rhythm: 'AFib', pulse: 80, ...over }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        const alertOf = (o: SimulationOutput) => o.clinicalAlerts.find(a => AF_ALERT.test(a));
        const stableAlert = alertOf(runEngine(af()));
        // Rewritten in round 6 (ruling V9): the digoxin sentence is shown only above the lenient resting-rate target (110), so a stable rate of 80 keeps the beta-blocker paragraph without it.
        assert.ok(stableAlert && /Rate control: a beta-blocker is first line/.test(stableAlert) && !/digoxin should be considered/i.test(stableAlert), 'stable atrial fibrillation lost its rate-control paragraph');
        assert.ok(/digoxin should be considered/i.test(alertOf(runEngine(af({ pulse: 120 }))) ?? ''), 'a resting rate of 120 lost the digoxin sentence');
        const notShown: Array<[string, MkOver]> = [
            ['paced rhythm with a history', { rhythm: 'Paced', comorb: ['Atrial Fibrillation'] }],
            ['sinus rhythm with a history', { rhythm: 'Sinus', comorb: ['Atrial Fibrillation'] }],
            ['potassium stop', { potassium: 6.8 }], ['potassium 6.2', { potassium: 6.2 }], ['hypotension stop', { sbp: 85, dbp: 50 }], ['scope', { scope_conditions: new Set(['Dialysis']) }],
        ];
        for (const [label, over] of notShown) {
            const o = runEngine(af({ comorb: ['Atrial Fibrillation'], ...over }));
            const a = alertOf(o);
            assert.ok(a && /oral anticoagulation is Class I/i.test(a) && /confirm one is prescribed/.test(a), `${label}: the anticoagulation sentence is missing: ${a}`);
            assert.ok(!/Rate control:|digoxin|beta-blocker/i.test(a!), `${label}: rate-control wording: ${a}`);
        }
    });
    check('Y6 the scope alert says the atrial fibrillation alert is still shown only when it is', () => {
        for (const c of SCOPE_CONDITIONS) {
            const withAf = base({ rhythm: 'AFib', pulse: 80 }); withAf.scope_conditions = new Set([c.label]);
            const without = base({ rhythm: 'Sinus', pulse: 80 }); without.scope_conditions = new Set([c.label]);
            const history = base({ rhythm: 'Sinus', pulse: 80, comorb: ['Atrial Fibrillation'] }); history.scope_conditions = new Set([c.label]);
            const scopeText = (o: SimulationOutput) => o.clinicalAlerts.find(a => a.startsWith("OUTSIDE THE TOOL'S SCOPE"))!;
            for (const p of [withAf, history]) { const o = runEngine(p); assert.ok(/atrial fibrillation alert is still shown/i.test(scopeText(o)) && o.clinicalAlerts.some(a => AF_ALERT.test(a)), `${c.label}: AF alert not matched`); }
            const o = runEngine(without);
            assert.ok(!/atrial fibrillation/i.test(scopeText(o)) && !o.clinicalAlerts.some(a => AF_ALERT.test(a)), `${c.label}: ${scopeText(o).slice(-160)}`);
        }
    });

    // ---------------- Y7: one alert per finding ----------------------------------------------------------------------------------------------------------------------
    // r5-engine M2: the hyperkalemic emergency (949 of 15,000) and hemodynamic instability (864) were raised twice, in a short and a long wording, on the stop paths; systolic not above diastolic
    // gave two near-duplicate hemodynamic alerts plus the input error.
    /** Headings that can legitimately appear more than once on one screen because each alert is about a different drug, class, value or field. Every other heading appears once. */
    const PER_ITEM_HEADS = new Set(['INAPPROPRIATE REGIMEN', 'EXPOSURE HISTORY', 'AVOID', 'MEDICATION RECONCILIATION', 'PREGNANCY SAFETY REVIEW', 'DATA REQUIRED', 'DATA NOTE', 'DRUG REMOVED FOR KIDNEY FUNCTION',
        'INAPPROPRIATE THERAPY', 'DUPLICATE THERAPY', 'IMPLAUSIBLE VALUE', 'ALLERGY CONFLICT', 'ALLERGY NOTE', 'INTERACTION', 'DRUG INTERACTION', 'CONTRAINDICATED COMBINATION', 'MEDICATION USE REVIEW']);
    const duplicateFindings = (o: SimulationOutput): string[] => {
        const seen = new Map<string, string[]>(); const out: string[] = [];
        for (const a of o.clinicalAlerts) seen.set(headOf(a), [...(seen.get(headOf(a)) ?? []), a]);
        for (const [h, xs] of seen) {
            if (xs.length > 1 && !PER_ITEM_HEADS.has(h)) out.push(`${h} x${xs.length}`);
            if (new Set(xs).size !== xs.length) out.push(`${h}: identical text twice`);
        }
        return out;
    };
    check('Y7 reviewer cases: hyperkalemic emergency and hemodynamic instability once, in the fuller wording, on every path (input error, limited review, implausible value, systolic not above diastolic, stop states)', () => {
        const stopPaths: Array<[string, MkOver]> = [['input error', { cost_sensitivity: -1 }], ['limited review', { age: 0 }], ['implausible ejection fraction', { lvef: 250 }], ['implausible bmi', { bmi: 120 }],
            ['full path stop', {}], ['scope', { scope_conditions: new Set(['Dialysis']) }]];
        for (const [label, extra] of stopPaths) {
            const o = runEngine(base({ potassium: 6.8, sbp: 84, dbp: 50, ...extra }));
            const k = o.clinicalAlerts.filter(a => a.startsWith('HYPERKALEMIC EMERGENCY')), h = o.clinicalAlerts.filter(a => a.startsWith('HEMODYNAMIC INSTABILITY'));
            assert.equal(k.length, 1, `${label}: hyperkalemic emergency x${k.length}`);
            assert.equal(h.length, 1, `${label}: hemodynamic instability x${h.length}`);
            assert.ok(/IV calcium|ECG/i.test(k[0]) && /Assess for symptoms and signs of poor perfusion/.test(h[0]), `${label}: not the fuller wording: ${k[0].slice(0, 80)} || ${h[0].slice(0, 80)}`);
            assert.deepEqual(duplicateFindings(o), [], label);
        }
    });
    check('Y7 systolic not above diastolic: one input alert and no hemodynamic alert built on the unusable pressure, even when the systolic value is below 90; a blank diastolic keeps the measured systolic alert', () => {
        for (const [sbp, dbp] of [[80, 85], [88, 88], [120, 125], [84, 90]] as const) {
            const o = runEngine(base({ sbp, dbp }));
            assert.equal(o.clinicalAlerts.filter(a => a.startsWith('INPUT ERROR')).length, 1, `${sbp}/${dbp}: input alerts`);
            assert.ok(!o.clinicalAlerts.some(a => a.startsWith('HEMODYNAMIC INSTABILITY')), `${sbp}/${dbp}: hemodynamic alert on an unusable pressure`);
            assert.deepEqual(duplicateFindings(o), [], `${sbp}/${dbp}`);
        }
        const blankDbp = runEngine(base({ sbp: 84, dbp: 0 }));
        assert.equal(blankDbp.clinicalAlerts.filter(a => a.startsWith('HEMODYNAMIC INSTABILITY')).length, 1, 'a measured systolic 84 with a blank diastolic lost its alert');
        const potassium = runEngine(base({ sbp: 80, dbp: 85, potassium: 6.8 }));
        assert.equal(potassium.clinicalAlerts.filter(a => a.startsWith('HYPERKALEMIC EMERGENCY')).length, 1);
    });
    check('Y7 scan: 3,000 random patients over the no-option and ordinary paths: no heading repeats except those about different drugs or values, and no alert appears twice', () => {
        const bad: string[] = [];
        for (let sd = 9720000; sd < 9723000; sd++) {
            const [vn, apply] = NO_OPTION_VARIANTS[sd % NO_OPTION_VARIANTS.length];
            const p = gen3r(sd).p as Patient; apply(p);
            if (sd % 3 === 0) { p.sbp = 84; p.dbp = 50; p.potassium = 6.8; }
            const o = runRaw(p);
            const d = duplicateFindings(o);
            if (d.length && bad.length < 6) bad.push(`seed ${sd} (${vn}): ${d.join('; ')}`);
        }
        assert.deepEqual(bad, []);
    });

    // ---------------- Y8: an implausible or blank eGFR does not silence a potassium alert that depends only on potassium --------------------------------------------------------
    // r5-engine M4 (seed 9530254): potassium 5.8 on eplerenone with an implausible eGFR lost "POTASSIUM REDUCE ON EPLERENONE" because the blanked eGFR (0) made the drug look contraindicated.
    check('Y8 reviewer case (potassium 5.8 on eplerenone, implausible eGFR) and neighbours: the MRA potassium reduce and hold alerts are raised with an implausible, a zero and a missing eGFR; a real low eGFR keeps the removal wording instead', () => {
        const mra = (drug: string, k: number, egfr: number | undefined, creat = 1.0) => base({ potassium: k, egfr: egfr as number, creatinine: creat, lvef: drug === 'Finerenone (Kerendia)' ? 45 : 30 }, [drug === 'Finerenone (Kerendia)' ? entry(drug, 10) : entry(drug, 25), entry('Lisinopril', 10)]);
        for (const drug of ['Eplerenone', 'Spironolactone', 'Finerenone (Kerendia)']) {
            for (const egfr of [500, 151, 0, undefined]) {
                const red = runEngine(mra(drug, 5.8, egfr)).clinicalAlerts;
                assert.ok(red.some(a => a.startsWith(`POTASSIUM REDUCE ON ${drug.toUpperCase()}`)) || red.some(a => a.startsWith(`POTASSIUM HOLD ON ${drug.toUpperCase()}`)) || red.some(a => a.startsWith('POTASSIUM STOP ON')), `${drug} K 5.8 eGFR ${egfr}: ${red.map(headOf).join(' | ')}`);
            }
        }
        for (const egfr of [500, 0, undefined]) {
            const hold = runEngine(mra('Eplerenone', 5.2, egfr)).clinicalAlerts;
            assert.ok(hold.some(a => a.startsWith('POTASSIUM HOLD ON EPLERENONE')), `eplerenone K 5.2 eGFR ${egfr}: ${hold.map(headOf).join(' | ')}`);
        }
        // the same alerts as the patient with a normal eGFR raises (heading by heading), apart from the implausible-value alert itself
        const heads = (xs: string[]) => new Set(xs.map(headOf).filter(h => /^POTASSIUM/.test(h)));
        assert.deepEqual([...heads(runEngine(mra('Eplerenone', 5.8, 500)).clinicalAlerts)].sort(), [...heads(runEngine(mra('Eplerenone', 5.8, 70)).clinicalAlerts)].sort());
        // a measured eGFR of 25 is a contraindication for eplerenone: its own removal wording is raised, not the potassium reduce alert
        const real = runEngine(mra('Eplerenone', 5.8, 25, 2.4)).clinicalAlerts;
        assert.ok(!real.some(a => a.startsWith('POTASSIUM REDUCE ON EPLERENONE')) && real.some(a => a.startsWith('DRUG REMOVED FOR KIDNEY FUNCTION: Eplerenone')), real.map(headOf).join(' | '));
    });

    // ---------------- Y9: the tie sentence says when a plan above the budget scores higher ----------------------------------------------------------------------------------
    // r5-engine M1 (seed 9503665): "No option scores 1 point or more above no change" while carvedilol, $51 against a $50 budget, scored 50.99 against 38.75; only "More on why" named it.
    const runTierP = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePt(p), NAMES, (TIER_PRICES as Record<string, Record<string, number>>)[p.insurance_tier ?? 'cash']);
    const TIE = /^No option scores .* or more above leaving the regimen unchanged/;
    const visibleFirst = (o: SimulationOutput) => (o.why_first?.options[0]?.lines ?? []).filter(l => !l.detail).map(l => l.text);
    /** Independent recomputation: a scored, display-safe plan above the stated budget, not shown, that scores the tie threshold or more above the displayed no-change plan; the best by score. */
    const overBudgetHigher = (p: Patient, o: SimulationOutput) => {
        const nc = o.scoredRegimens.find(r => (r.modification_set?.modifications ?? []).every(m => m.action === 'keep'));
        if (!nc || !(typeof p.max_affordable_cost === 'number')) return undefined;
        const shown = new Set(o.scoredRegimens.map(r => JSON.stringify((r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => m.summary))));
        return scoredCandidates(p, NAMES, (TIER_PRICES as Record<string, Record<string, number>>)[p.insurance_tier ?? 'cash'])
            .filter(c => c.cost > p.max_affordable_cost && brokenDisplayFloors(c, p).length === 0 && (c.raw_score ?? 0) - (nc.raw_score ?? 0) >= TOO_CLOSE_TO_SEPARATE_POINTS
                && !shown.has(JSON.stringify((c.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => m.summary))))
            .sort((a, b) => (b.raw_score ?? 0) - (a.raw_score ?? 0))[0];
    };
    check('Y9 reviewer seed 9503665: the visible tie sentence says the comparison is among options within the stated budget, and names the plan above the budget that scores higher with its monthly cost', () => {
        const p = gen3r(9503665).p as Patient, o = runTierP(p);
        const first = visibleFirst(o);
        const tie = first.find(t => TIE.test(t));
        assert.ok(tie, first.join(' | '));
        assert.ok(/within the stated budget of \$50/.test(tie!) && /above (it|the stated budget)/.test(tie!) && /Carvedilol/.test(tie!) && /\$51 a month/.test(tie!) && /scores higher/.test(tie!), tie);
        assert.ok(!/\bhigher\b.*\bhigher\b/.test(tie!), 'repeats itself');
    });
    check('Y9 neighbours: over 2,500 seeds and four budgets the sentence names an over-budget plan exactly when an independent recomputation finds one scoring the threshold or more above no change; otherwise it is the plain tie sentence', () => {
        let ties = 0, named = 0; const bad: string[] = [];
        for (let sd = 9503000; sd < 9505500; sd++) for (const budget of [undefined, 5, 20, 50]) {
            const p = gen3r(sd).p as Patient; if (budget !== undefined) p.max_affordable_cost = budget;
            const o = runTierP(p);
            const tie = visibleFirst(o).find(t => TIE.test(t));
            if (!tie) continue;
            ties++;
            const expect = overBudgetHigher(p, o);
            const says = /scores higher/.test(tie);
            if (says) named++;
            if (!!expect !== says && bad.length < 5) bad.push(`seed ${sd} budget ${budget ?? p.max_affordable_cost}: expected ${!!expect}, said ${says}: ${tie.slice(0, 220)}`);
            if (says && expect) assert.ok(tie.includes(`$${Math.round(expect.cost)} a month`), `seed ${sd}: cost not named: ${tie}`);
        }
        assert.ok(ties >= 40 && named >= 3, `${ties} tie sentences, ${named} naming a plan`);
        assert.deepEqual(bad, []);
    });

    // ---------------- Y10: monitoring wording about starting belongs to an option that starts or raises something ----------------------------------------------------------------
    // r5-clinical minor: "At initiation and after any eGFR change" (renal dosing review) and "After starting or changing the dose" (digoxin level) appeared on options that start nothing.
    const START_WORDING = /\b(at initiation|after starting|after a start|at the start|within about \d+-?\d* days of starting)\b/i;
    const startsOrRaisesAnything = (r: SimulationOutput['scoredRegimens'][number]) => (r.modification_set?.modifications ?? []).some(m => m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up');
    check('Y10 scan: 2,500 random patients: no option that starts, swaps or raises nothing carries monitoring wording about initiation or starting', () => {
        let options = 0, nothing = 0; const bad: string[] = [];
        for (let sd = 9740000; sd < 9742500; sd++) {
            const p = gen3r(sd).p as Patient; const o = runRaw(p);
            for (const [i, r] of o.scoredRegimens.entries()) {
                options++;
                if (startsOrRaisesAnything(r)) continue;
                nothing++;
                for (const m of r.monitoring_plan ?? []) if (START_WORDING.test(`${m.test} | ${m.timing}`) && bad.length < 6) bad.push(`seed ${sd} option ${i + 1}: ${m.test} | ${m.timing.slice(0, 80)}`);
            }
        }
        assert.ok(options >= 3000 && nothing >= 700, `${options} options, ${nothing} that start nothing`);
        assert.deepEqual(bad, []);
    });
    check('Y10 neighbours: with digoxin kept the level row has the ongoing wording; a renal-cautioned drug kept gets "After any eGFR change", started it keeps "At initiation and after any eGFR change"', () => {
        const o = runEngine(base({ lvef: 30, rhythm: 'AFib', pulse: 72, egfr: 25, creatinine: 2.4 }, [entry('Digoxin', 62.5), entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid'), entry('Spironolactone', 25), entry('Dapagliflozin', 10)]));
        let sawKept = 0, sawStarted = 0;
        for (const r of o.scoredRegimens) {
            const digoxin = (r.monitoring_plan ?? []).filter(m => /digoxin concentration/i.test(m.test));
            assert.ok(digoxin.length === 1 && !START_WORDING.test(digoxin[0].timing) && /after any dose change/i.test(digoxin[0].timing), JSON.stringify(digoxin));
            const review = (r.monitoring_plan ?? []).find(m => /Renal dosing review/i.test(m.test));
            if (review && /^At initiation/.test(review.timing)) { sawStarted++; assert.ok(startsOrRaisesAnything(r), 'starting wording without a start'); }
            if (review && /^After any eGFR change/.test(review.timing)) sawKept++;
        }
        assert.ok(sawKept >= 1 && sawStarted >= 1, `kept ${sawKept}, started ${sawStarted}`);
    });

    // ---------------- Y13: the documents -----------------------------------------------------------------------------------------------------------------------------------
    const doc = (f: string) => readFileSync(new URL(`../docs/${f}`, import.meta.url), 'utf8');
    check('Y13 the evidence matrix: every rule id is unique; the matrix and the code agree on the rule set; HF-MRA-010 states the ejection fraction from which finerenone counts as the MRA pillar, as the code does', () => {
        const matrix = doc('evidence-matrix.md');
        const ids = matrix.split('\n').map(l => /^\|\s*(HF-[A-Z0-9]+-\d+)\s*\|/.exec(l)?.[1]).filter((x): x is string => !!x);
        assert.ok(ids.length > 150, `${ids.length} rows`);
        const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
        assert.deepEqual([...new Set(dup)], [], 'rule ids used twice');
        assert.ok(matrix.includes(`Describes rule set ${RULESET_VERSION},`), 'the matrix names a different rule set');
        const row = matrix.split('\n').find(l => l.startsWith('| HF-MRA-010 |'))!;
        assert.ok(/counts as the MRA pillar only from LVEF 41/.test(row), 'HF-MRA-010 does not state the pillar limit');
        const at = (lvef: number, prior?: number) => nsMraFillsMraSlot(y5Patient(lvef, prior));
        assert.deepEqual([at(40), at(41), at(49), at(55)], [false, true, true, true], 'the code no longer agrees with the stated limit');
        assert.equal(at(55, 30), false, 'improved EF never counts');
    });
    check('Y13 the scoring architecture note no longer names the removed ranking-coverage field except to say it was removed', () => {
        const lines = doc('scoring-architecture.md').split('\n').join(' ').split(/(?<=\.)\s+/).filter(t => /foundational_coverage/.test(t));
        assert.ok(lines.every(t => /removed/.test(t)), lines.join(' | '));
        assert.ok(!/Ranking ties: score, coverage/.test(doc('scoring-architecture.md')));
    });

    // ---------------- Z1: a dose limit that does not depend on the kidney is not skipped because kidney values are blank -------------------------------------------------------
    // r5 finding 4: carvedilol 50 mg twice daily at 70 kg with blank eGFR and creatinine kept 50 mg (the forced reduction returned early on blank kidney values).
    const KIDNEY_BLANKS: Array<[string, MkOver]> = [['eGFR 0 and creatinine 0', { egfr: 0, creatinine: 0 }], ['eGFR undefined and creatinine undefined', { egfr: undefined, creatinine: undefined }],
        ['eGFR 0, creatinine entered', { egfr: 0, creatinine: 1.0 }], ['eGFR entered, creatinine 0', { egfr: 70, creatinine: 0 }], ['eGFR NaN', { egfr: Number.NaN, creatinine: Number.NaN }]];
    const carvZ = (dry: number | undefined, over: MkOver, strength = 50) => base({ dry: dry as number, cur: dry as number, ...over }, [entry('Carvedilol', strength, 'bid'), entry('Lisinopril', 10)]);
    const carvReductions = (o: SimulationOutput) => o.scoredRegimens.flatMap(r => summaries(r)).filter(x => /^Reduce Carvedilol/.test(x));
    check('Z1 reviewer case: carvedilol 50 mg twice daily at 70 kg is reduced with blank kidney values, for the body-weight rule, with no kidney wording', () => {
        for (const [label, over] of KIDNEY_BLANKS) for (const dry of [50, 70, 85]) {
            const o = runEngine(carvZ(dry, over));
            const reds = carvReductions(o);
            assert.ok(o.scoredRegimens.length > 0 && reds.length > 0, `${label} ${dry} kg: no reduction (${o.scoredRegimens.length} options)`);
            for (const t of reds) assert.ok(new RegExp(`${dry} kg`).test(t) && /body weight/.test(t) && !/eGFR|renal|kidney|creatinine/i.test(t), `${label} ${dry} kg: ${t}`);
        }
    });
    check('Z1 neighbours: 86 and 95 kg and 25 mg twice daily at 70 kg with blank kidney values are unchanged; with the kidney values entered the behaviour is as before', () => {
        for (const [label, over] of KIDNEY_BLANKS) {
            for (const dry of [86, 95]) assert.equal(carvReductions(runEngine(carvZ(dry, over))).length, 0, `${label} ${dry} kg reduced`);
            assert.equal(carvReductions(runEngine(carvZ(70, over, 25))).length, 0, `${label}: 25 mg reduced`);
        }
        assert.ok(carvReductions(runEngine(carvZ(70, { egfr: 70, creatinine: 1.0 }))).length > 0, 'entered kidney values lost the reduction');
        assert.equal(carvReductions(runEngine(carvZ(95, { egfr: 70, creatinine: 1.0 }))).length, 0);
    });
    check('Z1 no start or increase reaches 50 mg twice daily at 85 kg or less with blank kidney values (highestAllowedDose and every offered option)', () => {
        const carvedilol = MEDICATION_FORMULARY.find(m => m.name === 'Carvedilol')!;
        for (const [label, over] of KIDNEY_BLANKS) {
            for (const dry of [60, 85]) {
                const top = highestAllowedDose(carvedilol, carvZ(dry, over, 25));
                assert.ok(top && top.daily <= 50 + 1e-9, `${label} ${dry} kg: highest allowed ${top?.daily}`);
                assert.ok(top?.cap && /body weight/.test(top.cap.text) && !/kidney|eGFR/i.test(top.cap.text), `${label} ${dry} kg: ${top?.cap?.text}`);
                const o = runEngine(carvZ(dry, over, 25));
                for (const t of o.scoredRegimens.flatMap(r => summaries(r))) assert.ok(!/Carvedilol.*→ 50mg|start Carvedilol 50mg|Add Carvedilol 50mg/i.test(t), `${label} ${dry} kg: ${t}`);
            }
            const heavy = highestAllowedDose(carvedilol, carvZ(95, over, 25));
            assert.ok(heavy && heavy.daily >= 100 - 1e-9, `${label} 95 kg: top ${heavy?.daily}`);
        }
        // a new start at 70 kg with blank kidney values never offers 50 mg
        for (const [label, over] of KIDNEY_BLANKS) for (const t of runEngine(base({ dry: 70, cur: 70, ...over }, [entry('Lisinopril', 10)])).scoredRegimens.flatMap(r => summaries(r))) assert.ok(!/Carvedilol 50mg/.test(t), `${label}: ${t}`);
    });
    check('Z1 limits that depend on the kidney keep their behaviour with blank kidney values: ramipril and eplerenone over their kidney caps are not forced down, and say nothing about the kidney', () => {
        for (const [label, over] of KIDNEY_BLANKS.slice(0, 2)) {
            const o = runEngine(base({ ...over }, [entry('Ramipril', 10), entry('Eplerenone', 50), entry('Carvedilol', 12.5, 'bid')]));
            const t = o.scoredRegimens.flatMap(r => summaries(r)).filter(x => /^Reduce (Ramipril|Eplerenone)/.test(x) && /renal maximum/.test(x));
            assert.deepEqual(t, [], `${label}: a kidney-cap reduction without kidney values`);
        }
    });

    check('Z1 audit: of every drug with a kidney dosing function, only carvedilol depends on anything but the eGFR, and its result carries the non-kidney reason (so no hidden non-kidney limit sits behind the blank-kidney early returns)', () => {
        const ref = base({ egfr: 120, creatinine: 1.0 });
        const variants: Array<(q: Patient) => void> = [q => { q.volume_status.dry_weight_kg = 60; }, q => { q.volume_status.dry_weight_kg = 120; }, q => { q.age = 85; }, q => { q.sex = 'Female'; }, q => { q.potassium = 5.8; }, q => { q.pulse = 45; },
            q => { q.nyha_class = 'IV'; }, q => { q.comorbidities = new Set(['Liver Disease (Child-Pugh B/C)']); }, q => { q.external_medications = new Set(['Ketoconazole']); }, q => { q.lvef = 55; }];
        const dependent: string[] = [];
        for (const m of MEDICATION_FORMULARY) {
            if (!m.renal_adjustment) continue;
            const r0 = JSON.stringify(m.renal_adjustment(120, ref));
            for (const f of variants) { const q = clonePt(ref); f(q); const out = m.renal_adjustment(120, q); if (JSON.stringify(out) !== r0) { dependent.push(m.name); assert.ok(out.max_dose_reason || JSON.parse(r0).max_dose_reason, `${m.name}: a non-kidney dependence with no stated reason`); } }
        }
        assert.deepEqual([...new Set(dependent)], ['Carvedilol']);
    });

    return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = runEngineReadinessR5Checks();
    console.log(`ReadinessR5: passed ${r.passed}, failed ${r.failed}`);
    process.exit(r.failed > 0 ? 1 : 0);
}
void gen3r;
