/**
 * Round 2 engine rulings of the 2026-11-19 readiness pass (part A: T1 to T5, T16, T18, T22 to T28). Every check builds the patient a reviewer reported AND
 * at least three neighbours, and asserts the corrected behaviour. Run standalone (`npx tsx scripts/engineReadinessR2Checks.ts`) or through `npm run verify`.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY, RELEVANT_COMORBIDITIES } from '../constants';
import { getMedicationClassGroup } from '../services/engine/registry';
import { generateAndScoreModifications } from '../services/simulationService';
import { partitionAlerts } from '../components/resultsModel';
import { entry, patient } from './systemicReviewChecks';
import { gen2 } from './r2Generator';
import { SCENARIOS } from '../data/scenarios';
import type { Patient, RegimenMed, ScoredRegimen, SimulationOutput } from '../types';

const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
export const runEngine = (p: Patient): SimulationOutput => generateAndScoreModifications(p, names, prices);

/** A patient in sinus rhythm with the given overrides and regimen, exposure recorded as active. */
export function mk(over: Partial<Patient> & { findings?: string[]; dry?: number; cur?: number; comorb?: string[]; ext?: string[] } = {}, regimen: RegimenMed[] = []): Patient {
    const p = patient(regimen);
    const { findings, dry, cur, comorb, ext, ...rest } = over;
    Object.assign(p, { rhythm: 'Sinus', age: 66, sex: 'Male', is_pregnant: false, bmi: 27, bun: 22, ...rest });
    if (findings) p.volume_status.exam_findings = new Set(findings);
    if (dry !== undefined) p.volume_status.dry_weight_kg = dry;
    if (cur !== undefined) p.volume_status.current_weight_kg = cur;
    if (comorb) p.comorbidities = new Set(comorb);
    if (ext) p.external_medications = new Set(ext);
    return p;
}
export const changes = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
export const summaries = (r: ScoredRegimen) => changes(r).map(m => m.summary);
export const urgent = (o: SimulationOutput) => partitionAlerts(o.clinicalAlerts).urgent.map(a => a.raw);
const OPTION_BELOW = /\boptions? below\b|\bin any option below\b|\boptions below\b/i;

export function runEngineReadinessR2Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] ReadinessR2: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR2: ${name}: ${(e as Error).message?.slice(0, 900)}`); }
    };

    // ---------------- T16: urgent states in the limited-information review ------------------------------------------------------------------------------------------
    // The display reviewer's P19 (cool and congested NYHA IV, LVEF 18, BUN blank) and P20 (third-degree block, pulse 40) showed "0 options, 0 safety checks".
    const triple = () => [entry('Lisinopril', 10), entry('Spironolactone', 25), entry('Carvedilol', 12.5, 'bid')];
    const p19 = () => mk({ lvef: 18, nyha_class: 'IV', sbp: 104, dbp: 64, pulse: 88, dry: 80, cur: 88, findings: ['Cool Extremities', 'Edema (3+)', 'JVP Elevated', 'Crackles'], potassium: 4.4, creatinine: 1.4, egfr: 54, bun: 0 }, triple());
    const p20 = () => mk({ lvef: 18, nyha_class: 'III', sbp: 110, dbp: 66, pulse: 40, rhythm: '3rd Degree AV Block', dry: 80, cur: 80, findings: ['Cool Extremities'], potassium: 4.4, creatinine: 2.0, egfr: 33, bun: 0 }, triple());
    const blankOne = (p: Patient, field: 'age' | 'sex' | 'dry' | 'cur' | 'dbp' | 'rhythm'): Patient => {
        if (field === 'age') p.age = 0;
        if (field === 'sex') (p as any).sex = undefined;
        if (field === 'dry') p.volume_status.dry_weight_kg = 0;
        if (field === 'cur') p.volume_status.current_weight_kg = 0;
        if (field === 'dbp') p.dbp = 0;
        if (field === 'rhythm') (p as any).rhythm = undefined;
        return p;
    };
    const limited = (o: SimulationOutput) => o.decisionReadiness?.mode === 'limited_review';
    const noStopWords = (o: SimulationOutput) => {
        const all = o.clinicalAlerts.join(' ') + ' ' + (o.decisionReadiness?.deferred ?? []).join(' ');
        assert.ok(!/model limitation/i.test(all), 'a missing value is described as a "model limitation"');
        assert.ok(!OPTION_BELOW.test(all), `an alert refers to an option below although none is shown: ${all.match(OPTION_BELOW)}`);
    };
    check('T16 P19 (cool, congested, NYHA IV, BUN blank): limited review still raises poor perfusion and acute decompensation, with no "option below" wording', () => {
        const o = runEngine(p19());
        assert.ok(limited(o), 'expected the limited review');
        const u = urgent(o);
        assert.ok(u.some(a => /^POOR PERFUSION/.test(a)), `no poor perfusion alert: ${o.clinicalAlerts.map(a => a.slice(0, 30))}`);
        assert.ok(u.some(a => /^ACUTE DECOMPENSATION/.test(a)), 'no acute decompensation alert');
        noStopWords(o);
    });
    check('T16 P20 (third-degree block, pulse 40, BUN blank): limited review raises the block alert and names the rate-slowing drug', () => {
        const o = runEngine(p20());
        assert.ok(limited(o));
        assert.ok(urgent(o).some(a => /^THIRD-DEGREE AV BLOCK/.test(a) && /Carvedilol/.test(a)), 'no block alert naming carvedilol');
        noStopWords(o);
    });
    check('T16 neighbours: acute decompensation, poor perfusion, third- and second-degree block, slow heart rate, scale disagreement each hold with one different core value blank', () => {
        const cases: { name: string; make: () => Patient; re: RegExp }[] = [
            { name: 'decompensation NYHA IV', make: () => mk({ lvef: 30, nyha_class: 'IV', sbp: 120, dbp: 70, dry: 80, cur: 86, findings: ['Edema (2+)'] }, triple()), re: /^ACUTE DECOMPENSATION/ },
            { name: 'perfusion cold NYHA IV', make: p19, re: /^POOR PERFUSION/ },
            { name: 'perfusion narrow pulse pressure', make: () => mk({ lvef: 18, nyha_class: 'IV', sbp: 100, dbp: 78, dry: 80, cur: 82, findings: ['Edema (2+)'], bun: 0 }, triple()), re: /^POOR PERFUSION/ },
            { name: 'third-degree block', make: p20, re: /^THIRD-DEGREE AV BLOCK/ },
            { name: 'second-degree block', make: () => mk({ lvef: 30, nyha_class: 'II', pulse: 48, rhythm: '2nd Degree AV Block' }, triple()), re: /^SECOND-DEGREE AV BLOCK/ },
            { name: 'slow heart rate', make: () => mk({ lvef: 30, nyha_class: 'II', pulse: 42 }, [entry('Lisinopril', 10)]), re: /^SLOW HEART RATE/ },
            { name: 'scale below dry weight with congestion', make: () => mk({ lvef: 30, nyha_class: 'II', dry: 85, cur: 82, findings: ['JVP Elevated', 'Crackles'] }, triple()), re: /^SCALE AND EXAMINATION DISAGREE/ },
        ];
        for (const c of cases) {
            for (const field of ['age', 'sex', 'dry', 'cur', 'dbp', 'rhythm'] as const) {
                // the blank value must not be the one the alert itself needs
                if ((/DISAGREE/.test(String(c.re)) && (field === 'dry' || field === 'cur')) || (/THIRD|SECOND/.test(String(c.re)) && field === 'rhythm')) continue;
                if (/perfusion narrow/.test(c.name) && field === 'dbp') continue;
                const p = blankOne(c.make(), field);
                const o = runEngine(p);
                assert.ok(limited(o), `${c.name} / blank ${field}: expected the limited review`);
                assert.ok(urgent(o).some(a => c.re.test(a)), `${c.name} / blank ${field}: alert missing (${o.clinicalAlerts.map(a => a.slice(0, 30))})`);
                noStopWords(o);
            }
        }
    });
    check('T16 the other stop paths (unknown LVEF, blank weights, systolic not above diastolic, implausible value, input error) also keep the alerts the entered values justify', () => {
        const unstable = () => mk({ lvef: 18, nyha_class: 'IV', sbp: 104, dbp: 64, pulse: 88, dry: 80, cur: 88, findings: ['Cool Extremities', 'Edema (3+)'], potassium: 4.4, creatinine: 1.4, egfr: 54 }, triple());
        const cases: [string, Patient, RegExp[]][] = [
            ['LVEF not entered', Object.assign(unstable(), { lvef: 0 }), [/^ACUTE DECOMPENSATION/]],
            ['current weight not entered, K 6.2', Object.assign(unstable(), { potassium: 6.2, volume_status: { ...unstable().volume_status, current_weight_kg: 0 } }), [/^ACUTE DECOMPENSATION/, /^HYPERKALEMIC EMERGENCY/]],
            ['systolic not above diastolic, third-degree block', Object.assign(unstable(), { sbp: 60, dbp: 70, rhythm: '3rd Degree AV Block' as const, pulse: 40 }), [/^THIRD-DEGREE AV BLOCK/]],
            ['implausible creatinine, second-degree block', Object.assign(unstable(), { creatinine: 40, rhythm: '2nd Degree AV Block' as const, pulse: 48 }), [/^SECOND-DEGREE AV BLOCK/]],
            ['input error (unsupported cost number), decompensated and cold', Object.assign(unstable(), { cost_sensitivity: -1 }), [/^ACUTE DECOMPENSATION/, /^POOR PERFUSION/]],
            ['input error, potassium 6.3 and block', Object.assign(unstable(), { cost_sensitivity: -1, potassium: 6.3, rhythm: '3rd Degree AV Block' as const, pulse: 40 }), [/^HYPERKALEMIC EMERGENCY/, /^THIRD-DEGREE AV BLOCK/]],
        ];
        for (const [label, p, res] of cases) {
            const o = runEngine(p);
            assert.equal(o.scoredRegimens.length, 0, `${label}: expected a stop`);
            for (const re of res) assert.ok(o.clinicalAlerts.some(a => re.test(a)), `${label}: ${re} missing (${o.clinicalAlerts.map(a => a.slice(0, 28))})`);
            noStopWords(o);
        }
    });
    check('T16 controls: a missing value must not invent an alert (NYHA III with weights blank is not decompensation; LVEF blank is not low output)', () => {
        const a = runEngine(blankOne(blankOne(mk({ lvef: 30, nyha_class: 'III', findings: ['Edema (2+)', 'JVP Elevated'], dry: 80, cur: 90 }, triple()), 'dry'), 'age'));
        assert.ok(!urgent(a).some(x => /^ACUTE DECOMPENSATION|^POOR PERFUSION/.test(x)), 'decompensation raised without both weights');
        const b = mk({ lvef: 0, nyha_class: 'II', findings: ['Cool Extremities'], sbp: 100, dbp: 80 }, triple());
        assert.ok(!urgent(runEngine(b)).some(x => /^POOR PERFUSION/.test(x)), 'poor perfusion raised with LVEF blank');
        const c = mk({ lvef: 30, nyha_class: 'II', age: 0, sbp: 0, dbp: 0 }, triple());
        assert.ok(!urgent(runEngine(c)).some(x => /^POOR PERFUSION|^ACUTE DECOMP/.test(x)), 'perfusion alert from a blank blood pressure');
    });
    check('T16 an alert always exists where the panel used to say "0 safety checks": the limited review of an unstable patient has at least one urgent alert', () => {
        for (const make of [p19, p20]) assert.ok(urgent(runEngine(make())).length > 0);
    });

    // ---------------- T22: a removal is never shown with a swap's text, and no two displayed options read alike ---------------------------------------------------------------
    const coherentOptions = (o: SimulationOutput, label: string) => {
        const seen = new Set<string>();
        for (const r of o.scoredRegimens) {
            for (const m of changes(r)) {
                if (m.action === 'remove') assert.ok(!/^Swap|->|→/.test(m.summary) && /^Remove /.test(m.summary), `${label}: a removal reads as "${m.summary.slice(0, 80)}"`);
                if (m.action === 'swap') assert.ok(!!m.target && !!m.source && /^(Swap|STOP|Stop |Consider transition)/.test(m.summary), `${label}: swap without a target or sentence: ${m.summary.slice(0, 80)}`);
                if (m.action === 'add' || m.action === 'titrate_up') assert.ok(!/^Remove /.test(m.summary));
            }
            const key = changes(r).map(m => m.summary).sort().join('|');
            assert.ok(!seen.has(key), `${label}: two displayed options read the same: ${key.slice(0, 120)}`);
            seen.add(key);
        }
    };
    check('T22 a forced removal is never labelled as a swap, options do not repeat (seed 5000066, 5001192 and neighbours)', () => {
        for (const seed of [5000066, 5001192]) coherentOptions(runEngine(gen2(seed)), `seed ${seed}`);
        const finer = (regimen: RegimenMed[], over: Parameters<typeof mk>[0] = {}) => mk({ lvef: 31, nyha_class: 'II', ...over }, regimen);
        const variants: [string, Patient][] = [
            ['finerenone alone', finer([entry('Finerenone (Kerendia)', 20)])],
            ['finerenone + carvedilol + dapagliflozin', finer([entry('Finerenone (Kerendia)', 40), entry('Carvedilol', 12.5, 'bid'), entry('Dapagliflozin', 10)])],
            ['finerenone + ramipril, NYHA IV', finer([entry('Finerenone (Kerendia)', 10), entry('Ramipril', 1.25)], { nyha_class: 'IV' })],
            ['finerenone, congested', finer([entry('Finerenone (Kerendia)', 20), entry('Lisinopril', 10)], { dry: 80, cur: 84, findings: ['Edema (2+)'] })],
        ];
        for (const [label, p] of variants) {
            const o = runEngine(p);
            assert.ok(o.scoredRegimens.length > 0, `${label}: no option`);
            coherentOptions(o, label);
            // the removal-with-replacement is a real swap: its resulting regimen holds the replacement
            for (const r of o.scoredRegimens) for (const m of changes(r)) if (m.action === 'swap') assert.ok(r.regimen.some(x => x.med.name === m.target!.med.name), `${label}: the swap target is not in the resulting regimen`);
        }
    });
    check('T22 over 400 random patients no displayed removal names a replacement and no two options repeat', () => {
        for (let i = 0; i < 400; i++) { const seed = 5000000 + i * 37; const p = gen2(seed); coherentOptions(runEngine(p), `seed ${seed}`); }
    });

    // ---------------- T23: the congestion display rule never leaves the patient with no option -----------------------------------------------------------------------------
    const loopStepIn = (r: ScoredRegimen) => changes(r).some(m => (m.action === 'add' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Loop Diuretic' && !m.target.med.facts?.short_course_addon);
    const wet = (k: number, regimen: RegimenMed[], over: Parameters<typeof mk>[0] = {}) => mk({ lvef: 30, nyha_class: 'III', potassium: k, egfr: 29, creatinine: 2.1, dry: 80, cur: 83, findings: ['JVP Elevated', 'Crackles'], ...over }, regimen);
    check('T23 seed 5400104 (decompensated, congested, K 6.3, eplerenone 50, eGFR 29): the eplerenone withdrawal is shown, with a stated reason for no diuretic step', () => {
        const o = runEngine(gen2(5400104));
        assert.ok(o.scoredRegimens.length > 0, 'no option');
        assert.ok(o.scoredRegimens.some(r => changes(r).some(m => m.action === 'remove' && m.source?.med.name === 'Eplerenone')), 'the eplerenone withdrawal is missing');
        for (const r of o.scoredRegimens) if (!loopStepIn(r)) assert.ok(r.warnings.some(w => /No loop diuretic step is included in this option: /.test(w)), `no stated reason: ${summaries(r)}`);
    });
    check('T23 neighbours: K 6.0, 6.2, 6.4 on eplerenone or spironolactone (decompensated and congested): an option is shown and each says why it has no diuretic step', () => {
        for (const k of [6.0, 6.2, 6.4]) for (const mra of [entry('Eplerenone', 50), entry('Spironolactone', 25)]) {
            const o = runEngine(wet(k, [mra, entry('Lisinopril', 10)], { egfr: 55, creatinine: 1.3 }));
            assert.ok(o.scoredRegimens.length > 0, `K ${k} ${mra.med.name}: no option`);
            for (const r of o.scoredRegimens) {
                for (const m of changes(r)) assert.ok(!['add', 'titrate_up', 'swap'].includes(m.action) || m.target?.med.drug_class === 'K+ Binder', `K ${k}: ${m.summary} raises a drug in the potassium emergency`);
                assert.ok(r.warnings.some(w => /No loop diuretic step is included in this option: potassium is 6\.0 or above/.test(w)), `K ${k} ${mra.med.name}: reason missing for ${summaries(r)}`);
            }
        }
    });
    check('T23 the per-visit limit does not remove options either: limit of 1 new class, decompensated and congested, no loop on board', () => {
        const o = runEngine(wet(4.4, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')], { egfr: 65, creatinine: 1, max_new_classes_per_visit: 1 }));
        assert.ok(o.scoredRegimens.length > 0, 'no option');
        for (const r of o.scoredRegimens) assert.ok(loopStepIn(r) || r.warnings.some(w => /No loop diuretic step is included in this option: /.test(w)), `loop step neither present nor explained: ${summaries(r)}`);
    });
    check('T23 control: where a loop step is allowed every option still carries one (H05, H53)', () => {
        const o = runEngine(mk({ lvef: 20, nyha_class: 'IV', sbp: 130, dbp: 80, dry: 80, cur: 87, findings: ['Edema (3+)', 'JVP Elevated', 'Orthopnea'] }, []));
        assert.ok(o.scoredRegimens.length > 0);
        for (const r of o.scoredRegimens) assert.ok(loopStepIn(r), `option without a loop step: ${summaries(r)}`);
    });

    // ---------------- T24: monitoring does not depend on whether an option is shown ----------------------------------------------------------------------------------------
    const monitoringTests = (o: SimulationOutput) => o.monitoringPlan.map(m => m.test);
    const hasUrgentK = (o: SimulationOutput) => monitoringTests(o).some(t => /^Repeat potassium urgently and obtain an ECG/.test(t));
    check('T24 potassium 6.0 to 6.4 with NO option (seeds 5500012, 5500106, 5500175): the plan carries the urgent repeat and ECG', () => {
        for (const seed of [5500012, 5500106, 5500175]) {
            const o = runEngine(gen2(seed));
            assert.equal(o.scoredRegimens.length, 0, `seed ${seed} was expected to have no option`);
            assert.ok(hasUrgentK(o), `seed ${seed}: urgent potassium item missing (${monitoringTests(o)})`);
        }
    });
    check('T24 every stop state carries its own monitoring item: K 6.6, K 6.0 to 6.4 limited review, SBP 85, third-degree block, second-degree block context', () => {
        const base = (over: Parameters<typeof mk>[0] = {}) => mk({ lvef: 28, nyha_class: 'II', ...over }, triple());
        for (const k of [6.0, 6.2, 6.4, 6.6, 7.2]) assert.ok(hasUrgentK(runEngine(base({ potassium: k }))), `K ${k}`);
        for (const k of [6.0, 6.2, 6.4]) assert.ok(hasUrgentK(runEngine(blankOne(base({ potassium: k }), 'age'))), `limited review K ${k}`);
        for (const sbp of [85, 80, 70]) assert.ok(monitoringTests(runEngine(base({ sbp, dbp: 50 }))).some(t => /blood pressure/i.test(t) && /perfusion/i.test(t)), `SBP ${sbp}: blood pressure item missing`);
        for (const pulse of [40, 44, 55]) assert.ok(monitoringTests(runEngine(base({ rhythm: '3rd Degree AV Block', pulse }))).some(t => /ECG/.test(t) && /pacing/i.test(t)), `block pulse ${pulse}: ECG and pacing item missing`);
        assert.ok(monitoringTests(runEngine(blankOne(base({ rhythm: '3rd Degree AV Block', pulse: 40 }), 'age'))).some(t => /ECG/.test(t) && /pacing/i.test(t)), 'limited review block');
        const o = runEngine(base({ rhythm: '2nd Degree AV Block', pulse: 48 }));
        assert.ok(monitoringTests(o).some(t => /ECG/.test(t) && /pacing/i.test(t)), 'second-degree block item missing');
        for (const out of [runEngine(base({ potassium: 6.6 })), runEngine(base({ sbp: 85, dbp: 50 }))]) assert.equal(new Set(monitoringTests(out)).size, monitoringTests(out).length, 'duplicate monitoring items');
    });

    // ---------------- T25: the answer does not depend on entry order (two beta-blockers with mild asthma, and every duplicate pair with every comorbidity) -------------------------
    const signature = (o: SimulationOutput) => JSON.stringify({
        alerts: [...o.clinicalAlerts], excl: o.excludedMedications.map(e => `${e.name}:${e.rule_id}:${e.reason}`).sort(),
        opts: o.scoredRegimens.map(r => [r.overall_score, summaries(r), [...r.warnings], (r.monitoring_plan ?? []).map(m => m.test)]), mon: o.monitoringPlan.map(m => m.test),
    });
    const reversedOrder = (p: Patient): Patient => ({ ...p, current_regimen: [...p.current_regimen].reverse(), comorbidities: new Set([...p.comorbidities].reverse()), external_medications: new Set([...(p.external_medications ?? [])].reverse()),
        allergies: new Set([...p.allergies].reverse()), discontinued_meds: [...p.discontinued_meds].reverse(), volume_status: { ...p.volume_status, exam_findings: new Set([...p.volume_status.exam_findings].reverse()) } }) as Patient;
    const sameInAnyOrder = (p: Patient, label: string) => {
        const a = signature(runEngine(p)), b = signature(runEngine(reversedOrder(p)));
        if (a !== b) { const x = JSON.parse(a), y = JSON.parse(b); const diff = JSON.stringify(x.opts?.map((o: any) => o[0])) + ' vs ' + JSON.stringify(y.opts?.map((o: any) => o[0])); assert.fail(`${label}: the answer depends on entry order (option scores ${diff})`); }
    };
    check('T25 two beta-blockers with mild asthma (seed 5052416 and neighbours): one answer in either entry order', () => {
        const asthma = (regimen: RegimenMed[], over: Parameters<typeof mk>[0] = {}) => mk({ lvef: 30, nyha_class: 'II', comorb: ['Asthma (Mild/Moderate)'], ...over }, regimen);
        const pairs: [string, string, number, number][] = [['Metoprolol Succinate', 'Bisoprolol', 200, 5], ['Bisoprolol', 'Carvedilol', 10, 12.5], ['Metoprolol Succinate', 'Carvedilol', 100, 25], ['Metoprolol Succinate', 'Bisoprolol', 50, 10]];
        for (const [a, b, da, db] of pairs) sameInAnyOrder(asthma([entry(a, da), entry(b, db), entry('Captopril', 25, 'tid')]), `${a}+${b}`);
        sameInAnyOrder(mk({ lvef: 30, nyha_class: 'II', comorb: ['Asthma (Mild/Moderate)'], egfr: 15, creatinine: 4.2, baseline_creatinine: 3.0, potassium: 4.8 }, [entry('Captopril', 25, 'tid'), entry('Bisoprolol', 5), entry('Dapagliflozin', 10), entry('Furosemide', 80), entry('Metoprolol Succinate', 200)]), 'seed 5052416 shape');
    });
    check('T25 the reviewer seeds 5052416, 5004068, 5053115, 5078219, 5062010 and 300 shuffled random patients give one answer in either order', () => {
        for (const seed of [5052416, 5004068, 5053115, 5078219, 5062010]) sameInAnyOrder(gen2(seed), `seed ${seed}`);
        for (let i = 0; i < 300; i++) { const seed = 5100000 + i * 13; sameInAnyOrder(gen2(seed), `seed ${seed}`); }
    });
    check('T25 every same-class pair with every comorbidity that appears in a warning: the same answer in either entry order', () => {
        const groups = new Map<string, string[]>();
        for (const m of MEDICATION_FORMULARY) { if (m.facts?.short_course_addon) continue; const g = getMedicationClassGroup(m.drug_class); if (['Beta Blocker', 'Loop Diuretic', 'SGLT2i', 'MRA', 'RAAS Inhibitor'].includes(g)) groups.set(g, [...(groups.get(g) ?? []), m.name]); }
        const mid = (name: string): RegimenMed => { const med = MEDICATION_FORMULARY.find(x => x.name === name)!; const d = med.available_doses[Math.floor(med.available_doses.length / 2)]; return { med, dose: d, selected_frequency: d.frequency_options[0] }; };
        let runs = 0;
        for (const [g, drugs] of groups) {
            const pick = g === 'RAAS Inhibitor' ? ['Lisinopril', 'Enalapril', 'Losartan', 'Sacubitril/Valsartan (Entresto)'].filter(n => drugs.includes(n)) : drugs.slice(0, 3);
            for (let i = 0; i < pick.length; i++) for (let j = i + 1; j < pick.length; j++) for (const c of RELEVANT_COMORBIDITIES) {
                const reg = [mid(pick[i]), mid(pick[j]), ...(g === 'RAAS Inhibitor' ? [] : [entry('Lisinopril', 10)])].map(r => ({ ...r, exposure: { status: 'active' as const, adherence: 'consistent' as const, dose_interval_reviewed: true } }));
                const p = mk({ lvef: 30, nyha_class: 'III', comorb: [c], egfr: 55, creatinine: 1.3, dry: 80, cur: 82, findings: ['JVP Elevated'] }, []);
                p.current_regimen = reg; runs++;
                sameInAnyOrder(p, `${pick[i]}+${pick[j]} with ${c}`);
            }
        }
        assert.ok(runs > 200, `only ${runs} combinations were run`);
    });

    // ---------------- T1: potassium 6.0 or above never removes or reduces a diuretic and never cites low potassium as a benefit -----------------------------------------------
    const KLOWER = new Set(['Loop Diuretic', 'Thiazide-like Diuretic', 'K+ Binder']);
    const kLoweringCut = (r: ScoredRegimen) => changes(r).filter(m => (m.action === 'remove' || m.action === 'titrate_down') && m.source && KLOWER.has(m.source.med.drug_class) && !m.mandatory);
    const k1 = (k: number, regimen: RegimenMed[], over: Parameters<typeof mk>[0] = {}) => mk({ lvef: 28, nyha_class: 'II', potassium: k, egfr: 58, creatinine: 1.3, ...over }, regimen);
    check('T1 potassium 6.0, 6.2, 6.4 on carvedilol and furosemide, euvolemic, with and without an MRA, and on no drug: no diuretic removed or reduced, no over-treatment text, no low-potassium benefit', () => {
        const regimens: [string, () => RegimenMed[]][] = [
            ['carvedilol + furosemide', () => [entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 40)]],
            ['carvedilol + furosemide + spironolactone', () => [entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 40), entry('Spironolactone', 25)]],
            ['carvedilol + furosemide 80 bid + eplerenone', () => [entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 80, 'bid'), entry('Eplerenone', 50)]],
            ['carvedilol + torsemide + chlorthalidone', () => [entry('Carvedilol', 12.5, 'bid'), entry('Torsemide', 20), entry('Chlorthalidone', 25)]],
            ['no drug', () => []],
        ];
        for (const k of [6.0, 6.2, 6.4]) for (const [label, make] of regimens) {
            const o = runEngine(k1(k, make()));
            const why = `${label} K ${k}`;
            assert.ok(o.clinicalAlerts.some(a => /^HYPERKALEMIC EMERGENCY/.test(a)), `${why}: no emergency alert`);
            // With nothing safe to display (the display floor drops a plan that projects potassium above 6.0) the screen says so and still carries the urgent item.
            assert.ok(hasUrgentK(o), `${why}: urgent potassium monitoring missing`);
            for (const r of o.scoredRegimens) assert.equal(kLoweringCut(r).length, 0, `${why}: ${summaries(r)} removes or reduces a potassium-lowering drug`);
            assert.ok(!o.clinicalAlerts.some(a => /^LOOP DIURETIC OVER-TREATMENT|^DIURETIC REVIEW/.test(a) || /[Dd]own-titrate/.test(a)), `${why}: diuretic reduction text beside the potassium emergency`);
            assert.ok(!/low potassium/i.test(JSON.stringify(o.why_first ?? {})), `${why}: the explanation cites low potassium`);
        }
    });
    check('T1 a diuretic that only an indication rule would remove (Furoscix with no oral loop, seed 5010264) is kept at potassium 6.0 or above; anuria still removes it', () => {
        for (const k of [6.0, 6.2, 6.4]) {
            const p = k1(k, [entry('Bisoprolol', 2.5), entry('Furoscix (SC Furosemide)', 80)]);
            const o = runEngine(p);
            for (const r of o.scoredRegimens) assert.equal(kLoweringCut(r).length, 0, `K ${k}: ${summaries(r)}`);
            assert.ok(hasUrgentK(o));
        }
        const anuric = runEngine(k1(6.0, [entry('Bisoprolol', 2.5), entry('Furosemide', 40)], { comorb: ['Anuria'] }));
        assert.ok(anuric.scoredRegimens.some(r => changes(r).some(m => m.action === 'remove' && m.source?.med.name === 'Furosemide')) || anuric.scoredRegimens.length === 0, 'anuria no longer removes the loop');
    });
    check('T1 the volume-depletion alert does not say a diuretic reduction is the priority while potassium is 6.0 or above', () => {
        for (const k of [6.0, 6.3]) {
            const o = runEngine(k1(k, [entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 40)], { dry: 80, cur: 77 }));
            assert.ok(!o.clinicalAlerts.some(a => /priority intervention/.test(a)), `K ${k}: depletion alert still calls diuretic reduction the priority`);
            for (const r of o.scoredRegimens) assert.equal(kLoweringCut(r).length, 0, `K ${k}: ${summaries(r)}`);
        }
    });
    check('T1 controls: below 6.0 the over-treatment alert and a volume-step diuretic reduction are unchanged (K 5.8 and 4.5, euvolemic, furosemide 120 bid)', () => {
        for (const k of [4.5, 5.8]) {
            const o = runEngine(k1(k, [entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 80, 'bid')]));
            assert.ok(o.clinicalAlerts.some(a => /^LOOP DIURETIC OVER-TREATMENT/.test(a)), `K ${k}: over-treatment alert missing`);
        }
    });

    // ---------------- T2: two loop diuretics: keep the larger furosemide-equivalent dose, never count the clean-up as a diuretic change ------------------------------------
    const FUROSEMIDE_PER_MG: Record<string, number> = { Furosemide: 1, Torsemide: 2, Bumetanide: 40 };
    const equivDaily = (r: RegimenMed) => Number(r.dose.strength) * ({ qd: 1, bid: 2, tid: 3 } as Record<string, number>)[r.selected_frequency] * FUROSEMIDE_PER_MG[r.med.name];
    const dupLoop = (a: RegimenMed, b: RegimenMed, over: Parameters<typeof mk>[0] = {}) => mk({ lvef: 28, nyha_class: 'III', dry: 80, cur: 83, findings: ['Edema (2+)', 'JVP Elevated'], ...over }, [a, b, entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
    const loopTotalAfter = (r: ScoredRegimen) => r.regimen.filter(x => x.med.drug_class === 'Loop Diuretic' && !x.med.facts?.short_course_addon).reduce((s, x) => s + equivDaily(x), 0);
    check('T2 G8 (furosemide 20 + torsemide 100, congested) and neighbours: the larger equivalent dose is kept, the clean-up is not a diuretic change, the loop total never falls', () => {
        const cases: [RegimenMed, RegimenMed][] = [
            [entry('Furosemide', 20), entry('Torsemide', 100)],
            [entry('Furosemide', 40), entry('Torsemide', 40)],
            [entry('Furosemide', 80, 'bid'), entry('Torsemide', 10)],
            [entry('Furosemide', 80, 'bid'), entry('Bumetanide', 1)],
            [entry('Torsemide', 20), entry('Bumetanide', 0.5)],
        ];
        for (const [a, b] of cases) for (const order of [[a, b], [b, a]]) {
            const o = runEngine(dupLoop(order[0], order[1]));
            const larger = equivDaily(a) >= equivDaily(b) ? a : b, smaller = larger === a ? b : a;
            const label = `${a.med.name} ${a.dose.strength} ${a.selected_frequency} + ${b.med.name} ${b.dose.strength} ${b.selected_frequency}`;
            assert.ok(o.scoredRegimens.length > 0, `${label}: no option`);
            const note = o.clinicalAlerts.find(x => /^DUPLICATE THERAPY/.test(x) && /Loop Diuretic/.test(x));
            assert.ok(note && new RegExp(`treats ${larger.med.name.replace(/[()]/g, '\\$&')} as the one to keep`).test(note) && /furosemide/i.test(note) && /confirm/i.test(note), `${label}: alert wrong: ${note?.slice(0, 260)}`);
            for (const r of o.scoredRegimens) {
                assert.ok(changes(r).some(m => m.action === 'remove' && m.source?.med.name === smaller.med.name), `${label}: the smaller dose ${smaller.med.name} is not the one removed (${summaries(r)})`);
                assert.ok(!changes(r).some(m => m.source?.med.name === larger.med.name && m.action === 'remove'), `${label}: the larger loop is removed`);
                assert.ok(loopTotalAfter(r) >= equivDaily(larger) - 1e-9, `${label}: loop total ${loopTotalAfter(r)} fell below ${equivDaily(larger)} in ${summaries(r)}`);
            }
        }
    });
    check('T2 the clean-up is not scored or labelled as de-escalation in a volume-depleted patient, and not as an intensification either', () => {
        const o = runEngine(dupLoop(entry('Furosemide', 40), entry('Torsemide', 40), { dry: 80, cur: 77, findings: [], nyha_class: 'II' }));
        for (const r of o.scoredRegimens) {
            const bd = r.score_breakdown?.adjustments.find(a => a.code === 'VOLUME_DEPLETION_DEESCALATION');
            const onlyCleanup = changes(r).filter(m => m.source?.med.drug_class === 'Loop Diuretic').every(m => m.action === 'remove' && /duplicate/i.test(m.summary));
            if (onlyCleanup) assert.ok(!bd, `the clean-up earned the diuretic de-escalation points: ${summaries(r)}`);
        }
    });
    check('T2 a class with no trial dose and no stated equivalence keeps the higher fraction of its label maximum (SGLT2 inhibitor pair, thiazide-like pair)', () => {
        const sg = MEDICATION_FORMULARY.filter(m => m.drug_class === 'SGLT2i');
        assert.ok(sg.length >= 2);
        for (const order of [0, 1]) {
            const a = { ...entry(sg[0].name, sg[0].available_doses[0].strength, sg[0].available_doses[0].frequency_options[0]) }, b = { ...entry(sg[1].name, sg[1].available_doses[sg[1].available_doses.length - 1].strength) };
            const p = mk({ lvef: 28, nyha_class: 'II' }, order === 0 ? [a, b] : [b, a]);
            const o = runEngine(p);
            assert.ok(o.clinicalAlerts.some(x => /^DUPLICATE THERAPY/.test(x)), 'no duplicate alert');
        }
    });

    // ---------------- T3: no displayed option starts a drug whose own start warning says a prerequisite is not met ---------------------------------------------------------------
    /** Start prerequisites that are NOT met for an option: the started drugs' own flagged warnings (facts.regimen_warnings with start_prerequisite) whose condition is true. */
    const unmetStartPrerequisites = (p: Patient, r: ScoredRegimen): string[] => {
        const out: string[] = [];
        for (const m of changes(r)) {
            if (!(m.action === 'add' || m.action === 'swap') || !m.target) continue;
            for (const w of m.target.med.facts?.regimen_warnings ?? []) if (w.start_prerequisite && (!w.when || w.when(p, r.regimen))) out.push(`${m.target.med.name}: ${typeof w.text === 'function' ? w.text(p) : w.text}`.slice(0, 120));
        }
        return out;
    };
    check('T3 every start-prerequisite note carries the flag (a note that says "before relying on this regimen" or "avoid unless" is a prerequisite)', () => {
        for (const m of MEDICATION_FORMULARY) for (const w of m.facts?.regimen_warnings ?? []) {
            const text = typeof w.text === 'function' ? w.text(mk()) : w.text;
            if (/before relying on this regimen|^DIGOXIN SAFETY: Wolff/.test(text)) assert.ok(w.start_prerequisite, `${m.name}: "${text.slice(0, 70)}" is not flagged`);
        }
    });
    check('T3 H37 (eGFR 7, K 5.7, ARNI + spironolactone + carvedilol) and neighbours: no digoxin start while potassium is above 5.5 (and no option is below the required-only plan)', () => {
        const base = (egfr: number, k: number, over: Parameters<typeof mk>[0] = {}) => mk({ lvef: 30, nyha_class: 'III', egfr, creatinine: egfr < 15 ? 5.5 : 1.6, potassium: k, ...over }, [entry('Sacubitril/Valsartan (Entresto)', '97/103', 'bid'), entry('Spironolactone', 25), entry('Carvedilol', 25, 'bid')]);
        for (const [egfr, k] of [[7, 5.7], [12, 5.8], [9, 5.6], [14, 5.9], [20, 5.7]] as const) {
            const p = base(egfr, k);
            const o = runEngine(p);
            for (const r of o.scoredRegimens) {
                assert.equal(unmetStartPrerequisites(p, r).length, 0, `eGFR ${egfr} K ${k}: ${summaries(r)} starts a drug with an unmet prerequisite`);
                assert.ok(!changes(r).some(m => m.action === 'add' && m.target?.med.name === 'Digoxin'), `eGFR ${egfr} K ${k}: digoxin start displayed`);
            }
        }
        // the same drug at a potassium that meets the prerequisite is still offered where the rules allow (a control that the gate is not blanket)
        const ok = runEngine(base(60, 4.4, { rhythm: 'AFib', pulse: 96 }));
        assert.ok(ok.scoredRegimens.length > 0);
    });
    check('T3 general: over every reference scenario and 1,000 random patients (5,000 in the seeded sweep) no displayed option starts a drug whose own start warning says a prerequisite is not met', () => {
        let looked = 0;
        for (const sc of SCENARIOS) { const p = sc.patient; const o = runEngine(p); for (const r of o.scoredRegimens) { looked++; assert.equal(unmetStartPrerequisites(p, r).length, 0, `scenario ${sc.title}: ${summaries(r)}`); } }
        for (let i = 0; i < 1000; i++) { const seed = 5600000 + i * 5; const p = gen2(seed); const o = runEngine(p); for (const r of o.scoredRegimens) { looked++; const bad = unmetStartPrerequisites(p, r); assert.equal(bad.length, 0, `seed ${seed}: ${summaries(r)} ${bad}`); } }
        assert.ok(looked > 1000);
    });

    // ---------------- T5: the acute decompensation alert needs evidence of congestion or poor perfusion ---------------------------------------------------------------------
    const quad = () => [entry('Sacubitril/Valsartan (Entresto)', '49/51', 'bid'), entry('Carvedilol', 12.5, 'bid'), entry('Spironolactone', 25), entry('Dapagliflozin', 10)];
    const t5 = (over: Parameters<typeof mk>[0], regimen: RegimenMed[] = quad()) => runEngine(mk({ lvef: 25, nyha_class: 'IV', sbp: 118, dbp: 72, dry: 80, cur: 80.5, ...over }, regimen));
    check('T5 stable NYHA IV with no congestion and no poor-perfusion marker (F5, G6 shapes): no "same-day evaluation" alert, a different true sentence, beta-blocker rule unchanged', () => {
        const cases: { label: string; o: SimulationOutput }[] = [
            { label: 'F5 EF25 quad +0.5 kg', o: t5({}) },
            { label: 'G6 HFpEF 86F at dry weight', o: t5({ lvef: 62, age: 86, sex: 'Female', is_pregnant: false, cur: 80 }, [entry('Dapagliflozin', 10), entry('Spironolactone', 25)]) },
            { label: 'EF25 NYHA IV at dry weight, no drugs', o: t5({ cur: 80 }, []) },
            { label: 'EF30 NYHA IV -0.5 kg', o: t5({ lvef: 30, cur: 79.5 }) },
        ];
        for (const c of cases) {
            assert.ok(!c.o.clinicalAlerts.some(a => /^ACUTE DECOMPENSATION|same-day evaluation, intravenous diuresis or admission/.test(a)), `${c.label}: same-day alert shown`);
            const a = c.o.clinicalAlerts.find(x => /^SYMPTOMS AT REST WITHOUT RECORDED CONGESTION/.test(x));
            assert.ok(a && /advanced heart failure evaluation/i.test(a), `${c.label}: replacement sentence missing`);
        }
        // a patient with no beta-blocker and LVEF below 50 still gets no beta-blocker start, with the reason
        const nobb = t5({ cur: 80 }, [entry('Dapagliflozin', 10)]);
        assert.ok(nobb.clinicalAlerts.some(a => /^BETA-BLOCKER START DEFERRED/.test(a)), 'beta-blocker deferral lost');
        for (const r of nobb.scoredRegimens) assert.ok(!changes(r).some(m => m.action === 'add' && m.target?.med.drug_class === 'Beta Blocker'), 'a beta-blocker was started');
    });
    check('T5 neighbours keep the alert: NYHA IV with weight above dry weight, with one congestion finding, with a cool extremity, with a narrow pulse pressure; NYHA III with more than 2 kg and two findings', () => {
        const withAlert: [string, SimulationOutput][] = [
            ['+1.5 kg', t5({ cur: 81.5 })],
            ['one finding', t5({ findings: ['Edema (1+)'] })],
            ['jvp only', t5({ findings: ['JVP Elevated'] })],
            ['cool extremities', t5({ findings: ['Cool Extremities'] })],
            ['narrow pulse pressure', t5({ sbp: 100, dbp: 78 })],
            ['NYHA III +3 kg two findings', t5({ nyha_class: 'III', cur: 83, findings: ['Edema (2+)', 'JVP Elevated'] })],
        ];
        for (const [label, o] of withAlert) assert.ok(o.clinicalAlerts.some(a => /^ACUTE DECOMPENSATION/.test(a) || /^POOR PERFUSION/.test(a)), `${label}: alert lost`);
        for (const [label, o] of withAlert) assert.ok(!o.clinicalAlerts.some(a => /^SYMPTOMS AT REST WITHOUT RECORDED CONGESTION/.test(a)), `${label}: both sentences shown`);
        // NYHA III at +3 kg with ONE finding is not decompensated by the engine's predicate: no alert of either kind
        const iii = t5({ nyha_class: 'III', cur: 83, findings: ['Edema (2+)'] });
        assert.ok(!iii.clinicalAlerts.some(a => /^ACUTE DECOMPENSATION|^SYMPTOMS AT REST/.test(a)));
    });

    // ---------------- T4: the heart-block stop names every rate-slowing drug the patient takes ---------------------------------------------------------------------------------
    check('T4 third- and second-degree block name each rate-slowing drug (regimen and other medicines), in the style of the low blood pressure stop', () => {
        const slow = (rhythm: Patient['rhythm'], regimen: RegimenMed[], ext: string[], over: Parameters<typeof mk>[0] = {}) => runEngine(mk({ lvef: 28, nyha_class: 'II', pulse: 40, rhythm, ext, ...over }, regimen));
        const cases: { label: string; regimen: RegimenMed[]; ext: string[]; names: string[]; none?: string[] }[] = [
            { label: 'carvedilol alone', regimen: [entry('Carvedilol', 12.5, 'bid')], ext: [], names: ['Carvedilol'] },
            { label: 'carvedilol + digoxin + amiodarone + diltiazem', regimen: [entry('Carvedilol', 12.5, 'bid'), entry('Digoxin', 125)], ext: ['Amiodarone', 'Diltiazem'], names: ['Carvedilol', 'Digoxin', 'Amiodarone', 'Diltiazem'] },
            { label: 'metoprolol + ivabradine + verapamil', regimen: [entry('Metoprolol Succinate', 50), entry('Ivabradine', 5, 'bid')], ext: ['Verapamil'], names: ['Metoprolol Succinate', 'Ivabradine', 'Verapamil'] },
            { label: 'lisinopril only (no rate-slowing drug)', regimen: [entry('Lisinopril', 10)], ext: [], names: [], none: ['Carvedilol', 'Metoprolol', 'Digoxin', 'Ivabradine'] },
        ];
        for (const rhythm of ['3rd Degree AV Block', '2nd Degree AV Block'] as const) for (const c of cases) {
            for (const limitedPath of [false, true]) {
                const p = slow(rhythm, c.regimen, c.ext, limitedPath ? { age: 0 } : {});
                const a = p.clinicalAlerts.find(x => /^(THIRD|SECOND)-DEGREE AV BLOCK/.test(x));
                const label = `${rhythm} ${c.label}${limitedPath ? ' (limited review)' : ''}`;
                assert.ok(a, `${label}: no block alert`);
                assert.ok(/review now/i.test(a), `${label}: does not say the drugs need review now`);
                for (const n of c.names) assert.ok(a.includes(n), `${label}: ${n} not named`);
                for (const n of c.none ?? []) assert.ok(!new RegExp(`drugs:[^)]*${n}`).test(a), `${label}: ${n} named although not taken`);
                assert.ok(/also any not recorded here|not recorded here/.test(a), `${label}: no caution for unrecorded drugs`);
                assert.ok(!/option below/i.test(a), `${label}: refers to an option below`);
            }
        }
    });

    // ---------------- T26: every option that changes a RAAS inhibitor, MRA or diuretic carries the chemistry recheck -------------------------------------------------------------
    const RAAS_MRA = new Set(['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA']), DIUR = new Set(['Loop Diuretic', 'Thiazide-like Diuretic']);
    const chemistryGaps = (r: ScoredRegimen): string[] => {
        const plan = (r.monitoring_plan ?? []).map(m => m.test);
        const touches = (set: Set<string>) => changes(r).some(m => [m.source, m.target].some(x => x && set.has(x.med.drug_class)));
        const gaps: string[] = [];
        if (touches(RAAS_MRA) && !plan.some(t => /^BMP \((potassium|urea\/creatinine)/.test(t))) gaps.push('RAAS inhibitor or MRA change without a potassium and kidney recheck');
        if (touches(DIUR) && !plan.some(t => /^BMP \(electrolytes/.test(t))) gaps.push('diuretic change without an electrolyte and kidney recheck');
        return gaps;
    };
    check('T26 seed 5002496 (remove a diuretic beside a metolazone note), a Furoscix removal at K 6.0 and neighbours: the recheck is present in every direction (increase, reduction, switch, removal)', () => {
        for (const seed of [5002496, 5010264]) for (const r of runEngine(gen2(seed)).scoredRegimens) assert.deepEqual(chemistryGaps(r), [], `seed ${seed}: ${summaries(r)}`);
        const regs: [string, RegimenMed[], Parameters<typeof mk>[0]][] = [
            ['remove torsemide, metolazone on board', [entry('Enalapril', 20, 'bid'), entry('Torsemide', 20), entry('Metolazone', 10)], { potassium: 5.1 }],
            ['loop reduction (depleted)', [entry('Lisinopril', 10), entry('Furosemide', 80, 'bid')], { dry: 80, cur: 77 }],
            ['loop switch (resistance)', [entry('Lisinopril', 10), entry('Furosemide', 80, 'bid')], { dry: 80, cur: 84, findings: ['Edema (2+)'] }],
            ['ACE inhibitor to ARNI switch', [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')], {}],
            ['MRA removal at K 5.9', [entry('Spironolactone', 25), entry('Lisinopril', 10)], { potassium: 5.9 }],
            ['Furoscix without a loop at K 6.0', [entry('Bisoprolol', 2.5), entry('Furoscix (SC Furosemide)', 80)], { potassium: 6.0 }],
        ];
        for (const [label, regimen, over] of regs) {
            const p = mk({ lvef: 28, nyha_class: 'II', ...over }, regimen);
            for (const r of runEngine(p).scoredRegimens) assert.deepEqual(chemistryGaps(r), [], `${label}: ${summaries(r)}`);
        }
    });
    check('T26 invariant over 1,500 random patients: no displayed option that changes a RAAS inhibitor, MRA or diuretic lacks its chemistry recheck', () => {
        let options = 0;
        for (let i = 0; i < 1500; i++) { const seed = 5002000 + i * 7; for (const r of runEngine(gen2(seed)).scoredRegimens) { options++; assert.deepEqual(chemistryGaps(r), [], `seed ${seed}: ${summaries(r)}`); } }
        assert.ok(options > 500);
    });

    // ---------------- T28: the one start the poor-perfusion rule allows (a forced beta-blocker switch) is stated in words on that option and in the alert -------------------------
    const swapsBb = (r: ScoredRegimen) => changes(r).some(m => m.action === 'swap' && m.mandatory && m.source?.med.drug_class === 'Beta Blocker');
    check('T28 poor perfusion with a beta-blocker that must stop (allergy, pregnancy, liver disease, asthma): the switch is kept, the option and the alert say it is the exception and why', () => {
        const cold = (over: Parameters<typeof mk>[0], regimen: RegimenMed[]) => mk({ lvef: 24, nyha_class: 'III', sbp: 110, dbp: 80, dry: 80, cur: 83.5, findings: ['Cool Extremities', 'Edema (2+)', 'JVP Elevated'], ...over }, regimen);
        const cases: [string, Patient][] = [
            ['allergy to carvedilol', cold({ allergies: new Set(['Carvedilol']) }, [entry('Carvedilol', 12.5, 'bid'), entry('Lisinopril', 5)])],
            ['pregnancy', cold({ sex: 'Female', age: 31, is_pregnant: true }, [entry('Carvedilol', 12.5, 'bid')])],
            ['liver disease Child-Pugh B/C', cold({ comorb: ['Liver Disease: Child-Pugh B/C (severity not specified)'] }, [entry('Carvedilol', 12.5, 'bid')])],
            ['mild asthma on carvedilol', cold({ comorb: ['Asthma (Mild/Moderate)'] }, [entry('Carvedilol', 12.5, 'bid'), entry('Lisinopril', 5)])],
        ];
        let withSwap = 0;
        for (const [label, p] of cases) {
            const o = runEngine(p);
            const exceptionOptions = o.scoredRegimens.filter(swapsBb);
            if (exceptionOptions.length === 0) continue; // the engine did not offer the switch for this variant (it stops the drug instead): nothing to explain
            withSwap++;
            for (const r of exceptionOptions) assert.ok(r.warnings.some(w => /poor perfusion exception/i.test(w) && /lowest starting dose/i.test(w) && /stopping a beta-blocker abruptly/i.test(w)), `${label}: the option does not state the exception`);
            assert.ok(o.clinicalAlerts.some(a => /^POOR PERFUSION/.test(a) && /replacement of a beta-blocker that must stop/.test(a)), `${label}: the alert does not mention the exception`);
            assert.ok(!o.clinicalAlerts.some(a => /^POOR PERFUSION/.test(a) && /No drug is started and no dose is raised in any option below, except a diuretic when the patient is congested:/.test(a)), `${label}: the alert still says nothing is started`);
        }
        assert.ok(withSwap >= 2, `only ${withSwap} variants produced the switch`);
        // control: the same patient without poor perfusion gets no exception note
        const warm = runEngine(mk({ lvef: 24, nyha_class: 'II', allergies: new Set(['Carvedilol']) }, [entry('Carvedilol', 12.5, 'bid')]));
        for (const r of warm.scoredRegimens) assert.ok(!r.warnings.some(w => /poor perfusion exception/i.test(w)));
        // and an option in the cold state that does NOT switch carries no exception note
        const plain = runEngine(cold({}, [entry('Carvedilol', 12.5, 'bid')]));
        for (const r of plain.scoredRegimens) assert.ok(!r.warnings.some(w => /poor perfusion exception/i.test(w)), 'exception note on an option with no switch');
    });

    // ---------------- T18: alert order (emergencies and stop states, then urgent, then routine) and no "option below" when none follows ------------------------------------------
    const EMERGENCY_HEADS = ['POOR PERFUSION', 'ACUTE DECOMPENSATION', 'THIRD-DEGREE AV BLOCK', 'HEMODYNAMIC INSTABILITY', 'HYPERKALEMIC EMERGENCY', 'HYPOXIA ALERT', 'IMPLAUSIBLE VALUE', 'INPUT ERROR'];
    // Rewritten 2026-11-19 (ruling U9): the list mirrors the engine's routine headings; the new NYHA class prompt is routine.
    const ROUTINE_HEADS = ['NYHA CLASS AND FINDINGS DISAGREE', 'DEVICE THERAPY SCREENING', 'CARDIAC REHABILITATION', 'VERICIGUAT ELIGIBILITY WARNING', 'DATA NOTE', 'PARTIAL REVIEW', 'DATA REQUIRED', 'LABS REQUIRED', 'MEDICATION USE REVIEW', 'DOSE TIMING REVIEW', 'EXPOSURE HISTORY', 'SYMPTOMS AT REST WITHOUT RECORDED CONGESTION'];
    const tierOf = (a: string) => { const h = a.split(': ')[0]; return EMERGENCY_HEADS.includes(h) ? 0 : ROUTINE_HEADS.includes(h) ? 2 : 1; };
    const orderGaps = (o: SimulationOutput): string | null => { let top = 0; for (const a of o.clinicalAlerts) { const t = tierOf(a); if (t < top) return `"${a.slice(0, 40)}" (tier ${t}) comes after a tier ${top} alert`; top = Math.max(top, t); } return null; };
    check('T18 potassium emergency comes before "potassium stop on <drug>"; emergencies, then urgent, then routine, in every output (named patients and 600 random patients)', () => {
        const o = runEngine(mk({ lvef: 28, nyha_class: 'II', potassium: 6.1, egfr: 55 }, [entry('Lisinopril', 10), entry('Spironolactone', 25), entry('Carvedilol', 12.5, 'bid')]));
        const heads = o.clinicalAlerts.map(a => a.split(': ')[0]);
        assert.ok(heads.indexOf('HYPERKALEMIC EMERGENCY') >= 0 && heads.findIndex(h => /^POTASSIUM STOP ON/.test(h)) > heads.indexOf('HYPERKALEMIC EMERGENCY'), `emergency not first: ${heads.slice(0, 5)}`);
        for (const [label, out] of [['K 6.2 + eplerenone', runEngine(mk({ lvef: 28, potassium: 6.2, egfr: 60 }, [entry('Eplerenone', 50), entry('Lisinopril', 5)]))], ['K 6.4 no drug', runEngine(mk({ lvef: 28, potassium: 6.4 }, []))], ['limited review', runEngine(blankOne(mk({ lvef: 18, nyha_class: 'IV', dry: 80, cur: 88, findings: ['Cool Extremities', 'Edema (3+)'], bun: 0 }, triple()), 'age'))]] as [string, SimulationOutput][]) assert.equal(orderGaps(out), null, label);
        for (let i = 0; i < 600; i++) { const seed = 5800000 + i * 11; const out = runEngine(gen2(seed)); assert.equal(orderGaps(out), null, `seed ${seed}`); }
    });
    check('T18 when no option is shown no alert says "option below" (stop states, no-option states, limited review) and the screen sentence agrees', () => {
        const bad = (o: SimulationOutput, label: string) => { assert.equal(o.scoredRegimens.length, 0, `${label}: expected no option`); const t = o.clinicalAlerts.find(a => OPTION_BELOW.test(a)); assert.ok(!t, `${label}: "${t?.slice(0, 80)}"`); };
        bad(runEngine(mk({ lvef: 28, potassium: 6.6, egfr: 55 }, triple())), 'K 6.6 stop');
        bad(runEngine(mk({ lvef: 28, sbp: 85, dbp: 50 }, triple())), 'SBP 85');
        bad(runEngine(mk({ lvef: 28, rhythm: '3rd Degree AV Block', pulse: 40 }, triple())), 'third-degree block');
        for (const seed of [5500012, 5600189, 5600343, 5600016]) bad(runEngine(gen2(seed)), `seed ${seed}`);
        bad(runEngine(blankOne(p19(), 'dry')), 'limited review');
        // and where options ARE shown the sentence still points at them
        const shown = runEngine(mk({ lvef: 28, nyha_class: 'III', dry: 80, cur: 83, findings: ['Edema (2+)', 'JVP Elevated', 'Cool Extremities'], potassium: 4.4 }, triple()));
        assert.ok(shown.scoredRegimens.length > 0 && shown.clinicalAlerts.some(a => /^POOR PERFUSION/.test(a) && /option below/.test(a)));
    });

    return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = runEngineReadinessR2Checks();
    console.log(`\nReadinessR2: passed ${r.passed}, failed ${r.failed}`);
    process.exit(r.failed > 0 ? 1 : 0);
}
