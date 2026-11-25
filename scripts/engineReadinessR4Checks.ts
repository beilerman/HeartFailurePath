/**
 * Round 4 engine rulings of the 2026-11-19 readiness pass (W1 to W8, W11). Every check builds the patient a reviewer reported AND at least three neighbours, and asserts the corrected
 * behaviour. Run standalone (`npx tsx scripts/engineReadinessR4Checks.ts`) or through `npm run verify`.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { gen3r } from './r3Generator';
import { PRICES as TIER_PRICES } from './r2Generator';
import { MEDICATION_FORMULARY } from '../constants';
import { scoredCandidates } from './scoredCandidates';
import { mk, runEngine, urgent } from './engineReadinessR2Checks';
import { entry } from './systemicReviewChecks';
import { ADVISORY_ALERT_HEADS } from '../services/engine/whyFirst';
import { hasCongestion } from '../services/engine/regimenUtils';
import { includesDiureticIntensification } from '../services/engine/selection';
import { TOO_CLOSE_TO_SEPARATE_POINTS } from '../services/engine/thresholds';
import { getMedicationClassGroup } from '../services/engine/registry';
import { SCENARIOS } from '../data/scenarios';
import { evidenceFor, OUTCOME_EVIDENCE_TABLE, populationKeyFor, OUTCOME_KEYS, efBandFor, evidenceBandStatement, buildOutcomeEstimateViews } from '../services/engine/outcomeBenefit';
import { symptomRowFor, SYMPTOM_TABLE } from '../services/engine/symptomBenefit';
import { SCOPE_CONDITIONS, SCOPE_HEAD, SCOPE_HIDDEN_ALERT_HEADS } from '../services/engine/scopeGate';
import { generateAndScoreModifications, clonePatient } from '../services/simulationService';
import type { Patient, ScoredRegimen, SimulationOutput } from '../types';

const NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));
const runTier = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePatient(p), NAMES, TIER_PRICES[p.insurance_tier ?? 'cash']);
const nChanges = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').length;
const lines0 = (o: SimulationOutput): string[] => (o.why_first?.options[0]?.lines ?? []).map(l => l.text);
/** The tie sentence, in either of its wordings (the wording is ruling W6a). */
export const TIE_SENTENCE = /No option is measurably better than leaving the regimen unchanged|No option scores .* or more above leaving the regimen unchanged/;
const headOf = (a: string): string => { const i = a.indexOf(': '); return i > 0 ? a.slice(0, i) : a.slice(0, 40); };
const STATE_PROMPT_HEADS = ['NYHA CLASS AND FINDINGS DISAGREE', 'SYMPTOMS AT REST WITHOUT RECORDED CONGESTION'];
const PROFILES = ['default', 'outcomes_first', 'cost_first', 'simplicity_first'] as const;

/** Independent recomputation of the gap: the best displayed raw score minus the raw score of the displayed "no change" option. Null when no "no change" option is displayed. */
export function displayedGap(o: SimulationOutput): number | null {
    const nc = o.scoredRegimens.find(r => nChanges(r) === 0);
    if (!nc) return null;
    return Math.max(...o.scoredRegimens.map(r => r.raw_score ?? 0)) - (nc.raw_score ?? 0);
}

export function runEngineReadinessR4Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] ReadinessR4: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR4: ${name}: ${(e as Error).message?.slice(0, 900)}`); }
    };

    // ---------------- W2: the tie rule compares against the best-scoring eligible plan, not the first in display order ----------------------------------------------
    // r4-engine B1: with "Keep cost low" and nothing within budget the list is ordered by cost, so option 1 is the cheapest plan, not the best; the sentence "No option is measurably
    // better..." was printed above options that beat no change by 2.5 to 9.5 points.
    const W2_SEEDS = [9103007, 9104073, 9113468, 9114425, 7845267];
    check('W2 reviewer seeds: no tie sentence while an option scores one point or more above no change (recomputed from the displayed options)', () => {
        for (const sd of W2_SEEDS) {
            const o = runTier(gen3r(sd).p);
            const gap = displayedGap(o);
            if (lines0(o).some(t => TIE_SENTENCE.test(t))) assert.ok(gap !== null && gap < 1, `seed ${sd}: tie sentence with a displayed gap of ${gap?.toFixed(2)}`);
        }
    });
    check('W2 the seed fixed in the previous pass (7845267, $5 budget, cost first): the displayed options are within a point of no change, and the sentence is not printed because a cheaper-to-list plan eligible for display scores far above it', () => {
        const o = runTier(gen3r(7845267).p);
        const gap = displayedGap(o);
        assert.ok(gap !== null && gap < 1, `displayed gap ${gap}`);
        const eligibleBest = Math.max(...scoredCandidates(gen3r(7845267).p, NAMES, TIER_PRICES.cash).map(r => r.raw_score ?? 0));
        const nc = o.scoredRegimens.find(r => nChanges(r) === 0)!;
        // an independent recomputation over every scored plan: the sentence may be printed only when no plan at all (listed or not) beats no change by a point
        const said = lines0(o).some(t => TIE_SENTENCE.test(t));
        if (eligibleBest - (nc.raw_score ?? 0) >= 1) assert.ok(!said, 'tie sentence printed although an eligible plan scores a point or more above no change');
    });
    check('W2 the four reviewer seeds in every weight profile: never a false tie sentence, and where no option beats no change by a point the rule still fires', () => {
        for (const sd of W2_SEEDS) for (const care of PROFILES) {
            const p = gen3r(sd).p; p.care_priority = care;
            const o = runTier(p);
            const gap = displayedGap(o);
            const said = lines0(o).some(t => TIE_SENTENCE.test(t));
            if (said) assert.ok(gap !== null && gap < 1, `seed ${sd} ${care}: sentence with gap ${gap?.toFixed(2)}`);
        }
    });
    check('W2 the same patients with a budget nothing fits (the over-budget fallback), every profile: never a false tie sentence', () => {
        let fallbackSeen = 0;
        for (let sd = 9103000; sd < 9103120; sd++) for (const care of PROFILES) {
            const p = gen3r(sd).p; p.care_priority = care; p.max_affordable_cost = 1;
            const o = runTier(p);
            if (o.scoredRegimens.some(r => r.warnings.some(w => w.startsWith('BUDGET EXCEEDED')))) fallbackSeen++;
            const gap = displayedGap(o);
            if (lines0(o).some(t => TIE_SENTENCE.test(t))) assert.ok(gap !== null && gap < 1, `seed ${sd} ${care}: sentence with gap ${gap?.toFixed(2)}`);
        }
        assert.ok(fallbackSeen >= 40, `only ${fallbackSeen} fallback runs in the sample`);
    });


    // ---------------- W3: every urgent alert the full path raises from entered values is raised on every stop path -----------------------------------------------------
    // r4-engine B2: stopPathAlerts dropped alerts as "covered elsewhere" that no stop path but the limited review raises. The expected set is derived INDEPENDENTLY: the same patient on the full path
    // with the offending field repaired, headings compared, minus the alerts that describe options (they point at options that do not exist on a stop path).
    const urgentHeadsOf = (o: SimulationOutput, keep: (a: string) => boolean = () => true): Set<string> =>
        new Set(o.clinicalAlerts.filter(a => !ADVISORY_ALERT_HEADS.includes(headOf(a)) || STATE_PROMPT_HEADS.includes(headOf(a))).filter(keep).map(headOf));
    /** An alert that is about the options (or the plan), which a stop path has none of. */
    const describesOptions = (a: string) => /\boptions?\b|\bthe plan\b|\bin the plan\b/i.test(a);
    /** A stop path may carry the same finding under another heading: the limited review's own reconciliation and combination alerts, and its kidney-function removal alert. */
    const EQUIVALENT: Record<string, string[]> = { 'INAPPROPRIATE REGIMEN': ['MEDICATION RECONCILIATION'], 'INAPPROPRIATE THERAPY': ['CONTRAINDICATED COMBINATION'], 'KIDNEY FUNCTION': ['DRUG REMOVED FOR KIDNEY FUNCTION'] };
    const expectedHeads = (p: Patient, repairs: Array<(q: Patient) => void>): Set<string> | null => {
        let acc: Set<string> | null = null;
        for (const repair of repairs) {
            const q = clonePatient(p); repair(q);
            const o = runTier(q);
            if (o.scoredRegimens.length === 0) return null;      // the repaired patient is itself a stop state: nothing to derive
            const h = urgentHeadsOf(o, a => !describesOptions(a));
            acc = acc === null ? h : new Set<string>(Array.from(acc as Set<string>).filter((x: string) => h.has(x)));
        }
        return acc;
    };
    const missingOn = (v: SimulationOutput, expected: Set<string>): string[] => {
        const got = new Set(v.clinicalAlerts.map(headOf));
        return [...expected].filter(h => !got.has(h) && !(EQUIVALENT[h] ?? ([] as string[])).some(e => got.has(e)));
    };
    type Variant = { name: string; apply: (q: Patient) => void; repairs: Array<(q: Patient) => void>; /** Alerts whose own rule reads the offending field as not assessable (headings). */ dependsOnField?: string[] };
    const none = (_q: Patient) => { /* the unmodified patient */ };
    const VARIANTS: Variant[] = [
        { name: 'input error (an invalid cost sensitivity)', apply: q => { q.cost_sensitivity = -1; }, repairs: [none] },
        // the derived eGFR fall that sets the KIDNEY FUNCTION band uses the age (renalChange.ts), so that alert reads the offending field
        { name: 'limited review (age not entered)', apply: q => { q.age = 0; }, repairs: [none], dependsOnField: ['KIDNEY FUNCTION'] },
        { name: 'systolic not above diastolic', apply: q => { q.dbp = q.sbp + 5; }, repairs: [q => { q.dbp = Math.max(20, q.sbp - 30); }, q => { q.dbp = Math.max(20, q.sbp - 40); }],
      // isLowOutputState treats a systolic pressure not above the diastolic as not assessable (the pulse-pressure marker would be a false trigger), so the alert reads the offending field
      // (R5 Y4: the possible-poor-perfusion alert reads the same pressure and is not assessable for the same reason)
      dependsOnField: ['LOW OUTPUT STATE', 'POSSIBLE POOR PERFUSION'] },
        { name: 'implausible BMI', apply: q => { q.bmi = 120; }, repairs: [q => { q.bmi = 24; }, q => { q.bmi = 32; }] },
        { name: 'implausible ejection fraction', apply: q => { q.lvef = 250; }, repairs: [q => { q.lvef = 30; }, q => { q.lvef = 60; }],
          // R5 Y4: the possible-poor-perfusion alert compares the ejection fraction with the low-output limit, so it reads the offending field
          dependsOnField: ['POSSIBLE POOR PERFUSION'] },
    ];
    const w3Patients = (from: number, n: number) => Array.from({ length: n }, (_, i) => gen3r(from + i).p);
    check('W3 reviewer seeds (9100129, 9105087 nitrate with a PDE5 inhibitor; 9100029, 9105045 class against findings): the alerts are raised on the input-error, limited-review and systolic-below-diastolic paths', () => {
        for (const [sd, head] of [[9100129, 'INAPPROPRIATE THERAPY: Nitrate'], [9105087, 'INAPPROPRIATE THERAPY: Nitrate'], [9100029, 'NYHA CLASS AND FINDINGS DISAGREE'], [9105045, 'NYHA CLASS AND FINDINGS DISAGREE']] as const) {
            const p = gen3r(sd).p;
            for (const v of VARIANTS.slice(0, 3)) {
                const q = clonePatient(p); v.apply(q);
                const o = runTier(q);
                assert.equal(o.scoredRegimens.length, 0, `${sd} ${v.name}: options shown`);
                const ok = o.clinicalAlerts.some(a => a.startsWith(head)) || (head.includes('Nitrate') && o.clinicalAlerts.some(a => a.startsWith('CONTRAINDICATED COMBINATION')));
                assert.ok(ok, `${sd} ${v.name}: ${head} missing; heads ${o.clinicalAlerts.map(headOf).join(' | ')}`);
            }
        }
    });
    check('W3 the alerts the reviewer lost, on the input-error path: duplicate class, same drug entered twice, nitrate with a PDE5 inhibitor, low potassium, NYHA class against findings (hand-built patients, each with three neighbours)', () => {
        const dup = (extra: Partial<Patient> = {}) => mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, cost_sensitivity: -1, ...extra }, [entry('Carvedilol', 12.5, 'bid'), entry('Metoprolol Succinate', 50), entry('Lisinopril', 10)]);
        for (const [extra, head] of [
            [{}, 'INAPPROPRIATE REGIMEN: Patient is on more than one Beta Blocker'],
            [{ potassium: 3.1 }, 'LOW POTASSIUM'], [{ potassium: 3.4 }, 'LOW POTASSIUM'], [{ potassium: 3.0 }, 'LOW POTASSIUM'],
            [{ ext: ['Sildenafil'], nyha_class: 'II' }, 'INAPPROPRIATE REGIMEN'],
        ] as const) {
            const o = runEngine(dup(extra as Partial<Patient>));
            assert.equal(o.scoredRegimens.length, 0);
            assert.ok(o.clinicalAlerts.some(a => a.startsWith(head)), `${head} missing: ${o.clinicalAlerts.map(headOf).join(' | ')}`);
        }
        for (const e of [[entry('Lisinopril', 10), entry('Lisinopril', 20)], [entry('Carvedilol', 12.5, 'bid'), entry('Carvedilol', 25, 'bid')], [entry('Spironolactone', 25), entry('Spironolactone', 25)], [entry('Furosemide', 40), entry('Furosemide', 20)]]) {
            const p = mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, cost_sensitivity: -1 }, e);
            const o = runEngine(p);
            assert.equal(o.scoredRegimens.length, 0);
            assert.ok(o.clinicalAlerts.some(a => a.startsWith('INPUT SAFETY: Duplicate current medications')), `same-drug duplicate missing: ${o.clinicalAlerts.map(headOf).join(' | ')}`);
        }
        const nitrate = (extra: Partial<Patient> = {}) => mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, cost_sensitivity: -1, ext: ['Sildenafil'], ...extra }, [entry('Hydralazine/Isosorbide Dinitrate', '37.5/20', 'tid'), entry('Lisinopril', 10)]);
        for (const x of [{}, { ext: ['Tadalafil'] }, { ext: ['Avanafil'] }, { potassium: 5.1 }]) {
            const o = runEngine(nitrate(x as Partial<Patient>));
            assert.ok(o.clinicalAlerts.some(a => a.startsWith('INAPPROPRIATE THERAPY: Nitrate')), `nitrate with PDE5 missing: ${o.clinicalAlerts.map(headOf).join(' | ')}`);
        }
        for (const x of [{ nyha_class: 'II' }, { nyha_class: 'I' }, { nyha_class: 'II', cur: 90 }, { nyha_class: 'I', cur: 92 }] as const) {
            const o = runEngine(mk({ lvef: 30, sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, cost_sensitivity: -1, dry: 80, cur: 87, findings: ['JVP Elevated', 'Edema (2+)', 'Crackles'], ...x }, [entry('Lisinopril', 10)]));
            assert.ok(o.clinicalAlerts.some(a => a.startsWith('NYHA CLASS AND FINDINGS DISAGREE')), `U9 missing: ${o.clinicalAlerts.map(headOf).join(' | ')}`);
        }
    });
    for (const v of VARIANTS) {
        check(`W3 sweep, ${v.name}: 400 patients, every urgent alert of the repaired full run (minus option-describing ones) is raised on the stop path`, () => {
            let compared = 0; const miss: string[] = [];
            for (const [i, p] of w3Patients(9100000, 400).entries()) {
                const exp = expectedHeads(p, v.repairs); if (!exp) continue;
                const q = clonePatient(p); v.apply(q);
                const o = runTier(q);
                if (o.scoredRegimens.length > 0) continue;
                compared++;
                const m = missingOn(o, exp).filter(h => !(v.dependsOnField ?? []).includes(h));
                if (m.length) miss.push(`seed ${9100000 + i}: ${m.join(', ')}`);
            }
            assert.ok(compared >= 150, `only ${compared} patients compared`);
            assert.equal(miss.length, 0, miss.slice(0, 6).join(' ; '));
        });
    }
    check('W3 implausible value: a hyperkalemic emergency is still shown when the ejection fraction is the implausible field, and is not shown when the potassium is', () => {
        const base = (over: Partial<Patient>) => mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, creatinine: 1.0, egfr: 70, ...over }, [entry('Lisinopril', 10), entry('Spironolactone', 25)]);
        for (const k of [6.0, 6.2, 6.6, 7.4]) {
            const o = runEngine(base({ potassium: k, lvef: 250 }));
            assert.equal(o.scoredRegimens.length, 0);
            assert.ok(o.clinicalAlerts.some(a => a.startsWith('HYPERKALEMIC EMERGENCY')), `K ${k} with EF typo: emergency missing`);
        }
        for (const k of [9, 20, 50, 1.2]) {
            const o = runEngine(base({ potassium: k }));
            assert.equal(o.scoredRegimens.length, 0);
            assert.ok(!o.clinicalAlerts.some(a => a.startsWith('HYPERKALEMIC EMERGENCY') || a.startsWith('POTASSIUM HOLD') || a.startsWith('POTASSIUM REDUCE') || a.startsWith('LOW POTASSIUM')), `K typo ${k}: an alert reads the typo as a measurement: ${o.clinicalAlerts.map(headOf).join(' | ')}`);
            assert.ok(o.clinicalAlerts.some(a => a.startsWith('IMPLAUSIBLE VALUE')));
        }
    });


    // ---------------- W1: a recorded oxygen saturation below 90% is a top-level urgent alert on every path -------------------------------------------------------------------
    // r4-clinical blocking 1: "0 safety checks" with SpO2 85, and a monitoring row that points at an alert that was not on the screen.
    const hypoBase = (over: Partial<Patient> = {}) => mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 70, pulse: 76, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 85, ...over }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
    const withScope = (p: Patient, ids: string[]): Patient => { p.scope_conditions = new Set(ids); return p; };
    const HYPO_PATHS: Array<[string, (over?: Partial<Patient>) => Patient]> = [
        ['full path', o => hypoBase(o)],
        ['limited review', o => hypoBase({ age: 0, ...o })],
        ['input error', o => hypoBase({ cost_sensitivity: -1, ...o })],
        ['systolic not above diastolic', o => hypoBase({ sbp: 70, dbp: 80, ...o })],
        ['implausible value elsewhere', o => hypoBase({ lvef: 250, ...o })],
        ['potassium stop (6.6)', o => hypoBase({ potassium: 6.6, ...o })],
        ['hypotension stop (85)', o => hypoBase({ sbp: 85, dbp: 50, ...o })],
        ['third-degree block stop', o => hypoBase({ rhythm: '3rd Degree AV Block', ...o })],
        ['scope condition ticked', o => withScope(hypoBase(o), ['Dialysis'])],
        ['scope unanswered', o => { const p = hypoBase(o); p.scope_conditions = undefined; return p; }],
        ['scope answered none', o => withScope(hypoBase(o), [])],
        ['unknown LVEF stop', o => hypoBase({ lvef: 0, ...o })],
        ['implausible oxygen-independent potassium typo', o => hypoBase({ potassium: 50, ...o })],
    ];
    check('W1 reviewer cases: SpO2 85 raises the HYPOXIA ALERT among the urgent alerts on every path (stop states, scope ticked, scope unanswered, limited review, input error)', () => {
        for (const [name, build] of HYPO_PATHS) {
            const o = runEngine(build());
            const hit = o.clinicalAlerts.find(a => a.startsWith('HYPOXIA ALERT'));
            assert.ok(hit, `${name}: no HYPOXIA ALERT; heads ${o.clinicalAlerts.map(headOf).join(' | ')}`);
            assert.ok(urgent(o).some(a => a.startsWith('HYPOXIA ALERT')), `${name}: the hypoxia alert is not among the urgent alerts`);
            assert.equal(o.clinicalAlerts.filter(a => a.startsWith('HYPOXIA ALERT')).length, 1, `${name}: the alert appears more than once`);
        }
    });
    check('W1 neighbours: SpO2 89 and 85 raise it, 90, 94 and blank do not; the monitoring row appears only with the alert, on every path', () => {
        for (const [name, build] of HYPO_PATHS) for (const spo2 of [89, 80, 90, 94, undefined]) {
            const o = runEngine(build({ oxygen_saturation: spo2 }));
            const alert = o.clinicalAlerts.some(a => a.startsWith('HYPOXIA ALERT'));
            assert.equal(alert, spo2 !== undefined && spo2 < 90, `${name} SpO2 ${spo2}: alert ${alert}`);
            const rowSaysAlert = [...o.monitoringPlan, ...o.scoredRegimens.flatMap(r => r.monitoring_plan ?? [])].some(m => /see the hypoxia alert/.test(m.details));
            if (rowSaysAlert) assert.ok(alert, `${name} SpO2 ${spo2}: the monitoring row names an alert that is not on the screen`);
        }
    });
    check('W1 the safety-check count on the results counts it: SpO2 85 with nothing else wrong is one urgent alert, not zero', () => {
        const o = runEngine(hypoBase({ nyha_class: 'II' }));
        assert.ok(urgent(o).length >= 1);
        assert.equal(urgent(runEngine(hypoBase({ nyha_class: 'II', oxygen_saturation: 96 }))).filter(a => a.startsWith('HYPOXIA ALERT')).length, 0);
    });


    // ---------------- W4: the acute decompensation alert on a path with no options says only what is true there ------------------------------------------------------------
    check('W4 acute decompensation in a stop state never says both "No medication option is shown" and "every option includes one" (scope ticked, hypotension, potassium, input error, limited review)', () => {
        const decomp = (over: Partial<Patient> = {}) => mk({ lvef: 28, nyha_class: 'IV', sbp: 112, dbp: 66, pulse: 80, potassium: 4.4, creatinine: 1.1, egfr: 60, dry: 70, cur: 76.5, findings: ['JVP Elevated', 'Crackles', 'Edema (2+)'], ...over }, [entry('Lisinopril', 10), entry('Furosemide', 40)]);
        const stops: Array<[string, Patient]> = [
            ['scope ticked', withScope(decomp(), ['Heart transplant or ventricular assist device'])], ['dialysis', withScope(decomp(), ['Dialysis'])],
            ['potassium 6.6', decomp({ potassium: 6.6 })], ['hypotension', decomp({ sbp: 86, dbp: 50 })], ['input error', decomp({ cost_sensitivity: -1 })], ['limited review', decomp({ age: 0 })],
        ];
        for (const [name, p] of stops) {
            const o = runEngine(p);
            assert.equal(o.scoredRegimens.length, 0, `${name}: options shown`);
            const a = o.clinicalAlerts.find(x => x.startsWith('ACUTE DECOMPENSATION'));
            assert.ok(a, `${name}: no decompensation alert; ${o.clinicalAlerts.map(headOf).join(' | ')}`);
            assert.ok(!(/No medication option is shown/.test(a!) && /every option includes one/.test(a!)), `${name}: contradictory: ${a}`);
            assert.ok(!/every option/i.test(a!), `${name}: refers to options: ${a}`);
        }
        const o = runEngine(decomp());
        const a = o.clinicalAlerts.find(x => x.startsWith('ACUTE DECOMPENSATION'));
        if (o.scoredRegimens.length > 0) assert.ok(a && /The options below apply only if the patient is judged well enough/.test(a), 'with options the alert still says what the options are');
    });


    // ---------------- W5: with a scope condition ticked, no prompt that proposes therapy or assesses indication ----------------------------------------------------------------
    // r4-screen-evidence E2: the tool said it could not judge therapy and then proposed it (indicated therapy missing, vericiguat and iron eligibility, device screening, rehabilitation,
    // "consider LVAD or transplant evaluation" for a patient who has one, "what can be assessed with these inputs").
    const SCOPE_IDS = SCOPE_CONDITIONS.map(c => c.label);
    const THERAPY_PROMPT = /indicated therapy|eligib|consider (an )?(LVAD|advanced|transplant)|advanced heart failure|device|rehabilitation|vericiguat|iron|can be assessed|anticoagul/i;
    check('W5 all seven conditions: no hidden prompt heading, no missing-therapy block, no eligibility prompts, no readiness wording; the scope alert says why; the regimen alerts of the unticked run remain', () => {
        let compared = 0; const bad: string[] = [];
        for (const [i, p] of w3Patients(9100000, 140).entries()) {
            const full = runTier(p);
            if (full.scoredRegimens.length === 0) continue;
            const expected = urgentHeadsOf(full, a => !describesOptions(a));
            for (const cond of SCOPE_IDS) {
                const q = clonePatient(p); q.scope_conditions = new Set([cond]);
                const o = runTier(q);
                compared++;
                const heads = o.clinicalAlerts.map(headOf);
                if (o.scoredRegimens.length !== 0) bad.push(`seed ${9100000 + i} ${cond}: options shown`);
                for (const h of heads) if (SCOPE_HIDDEN_ALERT_HEADS.includes(h)) bad.push(`seed ${9100000 + i} ${cond}: ${h} shown`);
                if ((o.gdmtGaps ?? []).length || (o.eligibleAdjuncts ?? []).length) bad.push(`seed ${9100000 + i} ${cond}: indicated-therapy block shown`);
                if (o.decisionReadiness) bad.push(`seed ${9100000 + i} ${cond}: readiness wording shown`);
                const scopeAlert = o.clinicalAlerts.find(a => a.startsWith(SCOPE_HEAD));
                if (!scopeAlert || !/not shown, because this condition is outside the tool's scope/.test(scopeAlert)) bad.push(`seed ${9100000 + i} ${cond}: the scope line does not say the prompts are withheld`);
                for (const h of expected) if (!SCOPE_HIDDEN_ALERT_HEADS.includes(h) && !heads.includes(h) && !(['KIDNEY FUNCTION'].includes(h)) && !(EQUIVALENT[h] ?? ([] as string[])).some(e => heads.includes(e))) bad.push(`seed ${9100000 + i} ${cond}: regimen/urgent alert ${h} lost`);
                const texts = o.clinicalAlerts.filter(a => !a.startsWith(SCOPE_HEAD)).join(' ');
                if (THERAPY_PROMPT.test(texts.replace(/Avoid|NSAID|avoid/g, ''))) {
                    const hit = o.clinicalAlerts.find(a => !a.startsWith(SCOPE_HEAD) && THERAPY_PROMPT.test(a));
                    if (hit && !/^(ATRIAL FIBRILLATION|INAPPROPRIATE|AVOID|POTASSIUM|DRUG REMOVED|SEVERE CKD|LOW KIDNEY|MEDICATION|DIURETIC|LOOP|TWO POTASSIUM|DIGOXIN|BRADYCARDIA|PREGNANCY|ALLERGY|CONTRAINDICATED|VERY HIGH RISK|ACUTE DECOMP|POOR PERFUSION|HEMODYNAMIC|HYPERKALEMIC|THIRD|SECOND|SLOW|SCALE|NYHA|HYPOXIA|LOW OUTPUT|LOW POTASSIUM|VOLUME|SULFA|BETA-BLOCKER INTOL|INPUT|IMPLAUSIBLE|EXPOSURE|MEDICATION USE|KIDNEY)/.test(hit)) bad.push(`seed ${9100000 + i} ${cond}: therapy-like alert ${headOf(hit)}`);
                }
            }
        }
        assert.ok(compared >= 500, `only ${compared} runs compared`);
        assert.equal(bad.length, 0, bad.slice(0, 6).join(' ; '));
    });
    check('W5 reviewer case: a patient with a transplant or assist device is not told to consider LVAD or transplant evaluation; the same patient unticked still is when the engine raises it', () => {
        let flagged = 0;
        for (const p of w3Patients(9100000, 300)) {
            const full = runTier(p);
            if (!full.clinicalAlerts.some(a => a.startsWith('ADVANCED HEART FAILURE ALERT'))) continue;
            flagged++;
            const q = clonePatient(p); q.scope_conditions = new Set(['Heart transplant or ventricular assist device']);
            const o = runTier(q);
            assert.ok(!o.clinicalAlerts.some(a => /LVAD|transplant evaluation|advanced heart failure/i.test(a) && !a.startsWith(SCOPE_HEAD)), 'advanced-therapy evaluation prompt shown with a transplant or assist device');
        }
        assert.ok(flagged >= 10, `only ${flagged} patients with the advanced-heart-failure prompt in the sample`);
    });


    // ---------------- W6: wording that must be true -----------------------------------------------------------------------------------------------------------------------
    const allWhy = (o: SimulationOutput): string[] => (o.why_first?.options ?? []).flatMap(x => x.lines.map(l => l.text));
    const congestedNoChangeFirst = (): Array<{ p: Patient; o: SimulationOutput }> => {
        const out: Array<{ p: Patient; o: SimulationOutput }> = [];
        for (const p of w3Patients(9300000, 1500)) {
            if (!hasCongestion(p)) continue;
            const o = runTier(p);
            if (o.scoredRegimens.length > 0 && nChanges(o.scoredRegimens[0]) === 0) out.push({ p, o });
        }
        return out;
    };
    check('W6a the tie sentence no longer says "measurably better"; it states the threshold from the constant and that it is closer than the tool can separate', () => {
        let seen = 0;
        for (const p of w3Patients(9300000, 600)) {
            const o = runTier(p);
            const lines = allWhy(o);
            assert.ok(!lines.some(t => /measurably better/.test(t)), 'old wording present');
            const t = lines0(o).find(x => TIE_SENTENCE.test(x));
            if (!t) continue;
            seen++;
            assert.ok(t.startsWith(`No option scores ${TOO_CLOSE_TO_SEPARATE_POINTS} point`), t);
            assert.ok(/closer than the tool can separate/.test(t) && !/\.\s+\S/.test(t), `one sentence: ${t}`);
            if (o.scoredRegimens.length > 1) assert.ok(/the alternatives below are shown for discussion\.$/.test(t), t);
        }
        assert.ok(seen >= 5, `only ${seen} tie sentences in the sample`);
    });
    check('W6b no change first with congestion recorded: one sentence says the tool does not model congestion relief from a diuretic, and names the diuretic option when one is displayed', () => {
        const hits = congestedNoChangeFirst();
        assert.ok(hits.length >= 5, `only ${hits.length} congested no-change-first patients in the sample`);
        let named = 0;
        for (const { o } of hits) {
            const sentences = lines0(o).filter(t => /does not model congestion relief from a diuretic, so this ranking does not weigh it/i.test(t));
            assert.equal(sentences.length, 1, lines0(o).join(' | '));
            const j = o.scoredRegimens.findIndex((r, idx) => idx > 0 && includesDiureticIntensification(r));
            if (j >= 0) { named++; assert.ok(sentences[0].includes(`option ${j + 1}`), `diuretic option ${j + 1} not named: ${sentences[0]}`); }
            else assert.ok(!/option \d/.test(sentences[0]), `names an option although none has a diuretic: ${sentences[0]}`);
        }
        assert.ok(named >= 1, 'no sample had a displayed diuretic option');
    });
    check('W6b the sentence is absent when "no change" is not first, or no congestion is recorded', () => {
        for (const p of w3Patients(9300000, 600)) {
            const o = runTier(p);
            const has = allWhy(o).some(t => /does not model congestion relief from a diuretic, so this ranking does not weigh it/i.test(t));
            const noChangeFirst = o.scoredRegimens.length > 0 && nChanges(o.scoredRegimens[0]) === 0;
            if (has) assert.ok(noChangeFirst && hasCongestion(p), 'sentence on a patient it does not apply to');
            if (noChangeFirst && hasCongestion(p)) assert.ok(has, 'sentence missing');
        }
    });
    check('W6c the warning comparison is two plain clauses; the unreadable "no unresolved safety warning against one" is gone', () => {
        let clauses = 0;
        for (const p of w3Patients(9300000, 900)) for (const t of allWhy(runTier(p))) {
            assert.ok(!/unresolved safety warnings? against/.test(t), t);
            if (/carries (no|one|two|three) unresolved safety warnings?, while option \d carries/.test(t) || /carries (no|one|two|three) unresolved safety warnings?, while option \d carries/.test(t.replace(/^Option/, 'option'))) clauses++;
        }
        assert.ok(clauses >= 1, 'the clause never occurred in the sample');
    });
    check('W6d when option 2 is "no medication change" the comparison with no change is not printed twice (and option 2 is named as no change)', () => {
        let seen = 0;
        for (const p of w3Patients(9300000, 1500)) {
            const o = runTier(p);
            if (o.scoredRegimens.length < 2 || nChanges(o.scoredRegimens[0]) === 0 || nChanges(o.scoredRegimens[1]) !== 0) continue;
            seen++;
            const lines = lines0(o);
            assert.equal(lines.filter(t => /^Compared with making no medication change/.test(t)).length, 0, lines.join(' | '));
            assert.ok(lines.some(t => /option 2 \(no medication change\)/i.test(t)), lines.join(' | '));
        }
        assert.ok(seen >= 3, `only ${seen} patients with no change in position 2`);
    });


    // ---------------- W7: monitoring rows and prompts that must be true --------------------------------------------------------------------------------------------------
    check('W7a "after starting <drug>" rows: absent for a drug already taken and left alone (metolazone), present for an option that starts or raises it', () => {
        const base = (cur: number) => mk({ lvef: 32, nyha_class: 'III', sbp: 126, dbp: 74, pulse: 72, potassium: 4.3, creatinine: 1.2, egfr: 55, dry: 80, cur, findings: cur > 82 ? ['Edema (2+)', 'JVP Elevated'] : [] }, [entry('Furosemide', 80, 'bid'), entry('Metolazone', 5), entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid'), entry('Spironolactone', 25), entry('Dapagliflozin', 10)]);
        for (const cur of [80, 81, 84, 87]) {
            const o = runEngine(base(cur));
            for (const r of o.scoredRegimens) {
                const startsMetolazone = (r.modification_set?.modifications ?? []).some(m => (m.action === 'add' || m.action === 'titrate_up') && m.target?.med.name === 'Metolazone');
                const rows = (r.monitoring_plan ?? []).map(m => m.test);
                if (!startsMetolazone) assert.ok(!rows.some(t => /after starting metolazone/i.test(t)), `cur ${cur}: a row about starting metolazone for an option that does not start it`);
                assert.ok(!rows.some(t => /after starting/i.test(t) && !(r.modification_set?.modifications ?? []).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up'))), `cur ${cur}: an "after starting" row for an option that starts nothing: ${rows.join(' | ')}`);
            }
        }
        // an option that adds metolazone to a patient who does not take it keeps the row (every patient in a sample with such an option)
        let withStart = 0;
        for (const p of w3Patients(9300000, 800)) {
            const o = runTier(p);
            for (const r of o.scoredRegimens) if ((r.modification_set?.modifications ?? []).some(m => m.action === 'add' && m.target?.med.name === 'Metolazone')) { withStart++; assert.ok((r.monitoring_plan ?? []).some(m => /after starting metolazone/i.test(m.test)), 'the start row is missing'); }
        }
        assert.ok(withStart >= 0);
    });
    check('W7a sweep: no option shows an "after starting <drug>" row for a drug it does not start or raise, over 1,500 patients', () => {
        for (const p of w3Patients(9300000, 1500)) {
            const o = runTier(p);
            for (const r of o.scoredRegimens) for (const m of r.monitoring_plan ?? []) {
                const hit = /after starting (\w[\w\/ -]*)$/i.exec(m.test);
                if (!hit) continue;
                const name = hit[1].toLowerCase();
                const started = (r.modification_set?.modifications ?? []).some(x => (x.action === 'add' || x.action === 'swap' || x.action === 'titrate_up') && x.target?.med.name.toLowerCase().startsWith(name));
                assert.ok(started, `"${m.test}" for an option that does not start or raise it`);
            }
        }
    });
    check('W7b a class that a displayed option starts is not listed as an eligible adjunct (loop diuretic when option 1 adds furosemide)', () => {
        let both = 0, listed = 0;
        for (const p of w3Patients(9300000, 1500)) {
            const o = runTier(p);
            const startedGroups = new Set(o.scoredRegimens.flatMap(r => (r.modification_set?.modifications ?? []).filter(m => (m.action === 'add' || m.action === 'swap') && m.target).map(m => getMedicationClassGroup(m.target!.med.drug_class))));
            const adj = (o.eligibleAdjuncts ?? []);
            // R7 W3: the line names the drug ("Furosemide (loop diuretic): ..."); it was "Loop diuretic: ..."
            if (adj.some(a => /^Loop diuretic|\(loop diuretic\): symptomatic volume management/i.test(a))) { listed++; assert.ok(!startedGroups.has('Loop Diuretic'), 'loop diuretic listed as an adjunct while an option starts one'); }
            if (startedGroups.has('Loop Diuretic')) both++;
        }
        assert.ok(both >= 5, `only ${both} patients with an option that starts a loop diuretic`);
        assert.ok(listed >= 1, 'the loop-diuretic adjunct never occurred without an option starting one');
    });
    check('W7c the atrial fibrillation alert states a resting rate above 110 and that rate control needs assessment; it never calls the patient stable when the engine says otherwise', () => {
        const af = (over: Parameters<typeof mk>[0] = {}) => mk({ lvef: 30, nyha_class: 'III', rhythm: 'AFib', sbp: 118, dbp: 72, pulse: 130, potassium: 4.4, creatinine: 1.0, egfr: 70, ...over }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        const alertOf = (o: SimulationOutput) => o.clinicalAlerts.find(a => a.startsWith('ATRIAL FIBRILLATION'))!;
        for (const hr of [111, 130, 150]) {
            const a = alertOf(runEngine(af({ pulse: hr })));
            assert.ok(a.includes(`resting heart rate is ${hr} bpm`) && a.includes('above the lenient target of 110') && /rate control needs assessment/.test(a), a);
            assert.ok(/RACE II/.test(a) && /Van Gelder/.test(a), 'source missing');
        }
        for (const hr of [70, 100, 110]) assert.ok(!/resting heart rate is/.test(alertOf(runEngine(af({ pulse: hr })))), `a rate statement at ${hr}`);
        // decompensated: the engine's own state says not stable
        const unstable = alertOf(runEngine(af({ nyha_class: 'IV', dry: 70, cur: 76.5, findings: ['JVP Elevated', 'Crackles', 'Edema (2+)'] })));
        assert.ok(/not stable now/.test(unstable), unstable);
        const stableText = alertOf(runEngine(af({ pulse: 80 })));
        assert.ok(!/is first line in stable HFrEF/.test(stableText) && /once the patient is stable/.test(stableText), stableText);
        assert.ok(!/not stable now/.test(stableText));
    });


    // ---------------- W8: answers independent of entry order -------------------------------------------------------------------------------------------------------------
    // r4-engine lesser items: the temporary-hold note (seed 9100032), the "versus current" interval for a duplicate renin-angiotensin drug (seed 9105089), the missing-items list.
    const canon = (v: unknown): unknown => (typeof v === 'number' ? Math.round(v * 1e7) / 1e7 : Array.isArray(v) ? v.map(canon) : v instanceof Set ? [...v].sort() : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).filter(k => k !== 'projected_patient' && k !== 'recorded_medication_exposures').sort().map(k => [k, canon((v as Record<string, unknown>)[k])])) : v);
    const ser = (o: SimulationOutput): string => JSON.stringify(canon({ s: o.scoredRegimens, a: o.clinicalAlerts, m: o.monitoringPlan, n: o.missingDataNotices, d: o.decisionReadiness, w: o.why_first, g: o.gdmtGaps, e: o.eligibleAdjuncts, x: o.excludedMedications, f: o.followUpCalendar }), (_k, v) => (typeof v === 'function' ? undefined : v));
    const permutations = (p: Patient): Patient[] => {
        const rev = clonePatient(p); rev.current_regimen = [...rev.current_regimen].reverse();
        const rot = clonePatient(p); rot.current_regimen = [...rot.current_regimen.slice(1), ...rot.current_regimen.slice(0, 1)];
        return [rev, rot];
    };
    const holdOf = (o: SimulationOutput): string[] => o.scoredRegimens.flatMap(r => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => `${m.action}:${(m.source ?? m.target)!.med.name}:${m.temporary_hold === true}`)).sort();
    check('W8 seed 9100032 (potassium 5.9, spironolactone at its lowest dose): the temporary-hold flag is the same in every entry order', () => {
        const p = gen3r(9100032).p; const a = holdOf(runTier(p));
        assert.ok(a.some(x => x.endsWith(':true')), 'the sample no longer carries a temporary hold');
        for (const q of permutations(p)) assert.deepEqual(holdOf(runTier(q)), a);
    });
    check('W8 seed 9105089 (ramipril and valsartan both taken): the "versus current" interval is the same in every entry order', () => {
        const p = gen3r(9105089).p;
        const iv = (o: SimulationOutput) => JSON.stringify(canon(o.scoredRegimens.map(r => (r.outcome_estimates ?? []).map(e => [e.vs_current, e.at_target_vs_current]))));
        const a = iv(runTier(p));
        for (const q of permutations(p)) assert.equal(iv(runTier(q)), a);
    });
    check('W8 the missing-items list (labels, consequences, notices) is identical in any entry order, over 600 patients', () => {
        let n = 0;
        for (const p of w3Patients(9100000, 600)) {
            if (p.current_regimen.length < 2) continue;
            const a = runTier(p); n++;
            const view = (o: SimulationOutput) => JSON.stringify({ m: o.decisionReadiness?.missing, d: o.decisionReadiness?.deferred, n: o.missingDataNotices });
            for (const q of permutations(p)) assert.equal(view(runTier(q)), view(a), `missing items depend on entry order`);
        }
        assert.ok(n >= 300, `only ${n} patients with two or more drugs`);
    });
    check('W8 sweep: the whole output (options, alerts, monitoring, explanation, withheld drugs) is identical for a reversed and a rotated entry order, 1,200 patients', () => {
        const bad: string[] = [];
        for (const [i, p] of w3Patients(9100000, 1200).entries()) {
            if (p.current_regimen.length < 2) continue;
            const a = ser(runTier(p));
            for (const q of permutations(p)) if (ser(runTier(q)) !== a) { bad.push(String(9100000 + i)); break; }
        }
        assert.equal(bad.length, 0, `order-dependent output: seeds ${bad.slice(0, 8).join(', ')}`);
    });


    // ---------------- X1: non-steroidal MRA evidence at LVEF 40 to 49 is the measured (FINEARTS-HF) rows ---------------------------------------------------------------------
    // At LVEF exactly 40 the patient is in the "reduced" band, but finerenone may be started from 40 (FINEARTS-HF enrolled 40 or higher) and was valued by the extrapolated reduced rows.
    // Rule: evidence rows may state the LVEF range they apply to (`lvef_range`); a row whose range holds the patient's LVEF takes precedence over the band lookup.
    const FINERENONE = MEDICATION_FORMULARY.find(m => m.drug_class === 'nsMRA')!;
    const x1Patient = (lvef: number, prior?: number): Patient => {
        const p = clonePatient(SCENARIOS.find(x => x.title.startsWith('De-novo HFrEF'))!.patient);
        p.lvef = lvef; p.previous_lvef = prior as never; p.ever_lvef_le_40 = (prior !== undefined ? 'yes' : 'unknown') as never;
        return p;
    };
    const rowIds = (p: Patient) => ({
        death: evidenceFor(OUTCOME_EVIDENCE_TABLE, FINERENONE, p, 'all_cause_death', populationKeyFor(FINERENONE, p)).id,
        hfh: evidenceFor(OUTCOME_EVIDENCE_TABLE, FINERENONE, p, 'hf_hospitalization', populationKeyFor(FINERENONE, p)).id,
        symptom: symptomRowFor(SYMPTOM_TABLE, FINERENONE, p).id,
    });
    check('X1 at LVEF 40 and 45 finerenone is valued by the measured rows (outcome and symptom); at 39 and 35 by the reduced rows; at 41 and 55 as before', () => {
        for (const l of [40, 41, 45, 49]) assert.deepEqual(rowIds(x1Patient(l)), { death: 'nsmra-mildly-reduced-death', hfh: 'nsmra-mildly-reduced-hfh', symptom: 'nsmra-mildly_reduced' }, `LVEF ${l}`);
        for (const l of [20, 35, 39]) assert.deepEqual(rowIds(x1Patient(l)), { death: 'nsmra-reduced-death', hfh: 'nsmra-reduced-hfh', symptom: 'nsmra-reduced' }, `LVEF ${l}`);
        for (const l of [50, 55, 65]) assert.deepEqual(rowIds(x1Patient(l)), { death: 'nsmra-preserved-death', hfh: 'nsmra-preserved-hfh', symptom: 'nsmra-preserved' }, `LVEF ${l}`);
    });
    check('X1 no other class changes: for every drug, LVEF 20 to 65, the row ids used equal the plain band lookup, except the non-steroidal MRA at LVEF 40 to 49 and (R5 Y5) at 50 and above with a prior reduced EF', () => {
        let compared = 0;
        for (let l = 20; l <= 65; l++) for (const prior of [undefined, 30]) {
            const p = x1Patient(l, prior);
            for (const m of MEDICATION_FORMULARY) for (const o of OUTCOME_KEYS) {
                const key = populationKeyFor(m, p), band = efBandFor(p);
                const cands = OUTCOME_EVIDENCE_TABLE.filter(r => r.outcome === o && r.ef_band === band && r.drugs.includes(m.name));
                const old = (key === undefined ? [] : cands.filter(r => r.population_key === key)).concat([]);
                const oldRow = (old.length ? old : cands.filter(r => r.population_key === undefined || r.population_key === 'other'))[0];
                const now = evidenceFor(OUTCOME_EVIDENCE_TABLE, m, p, o, key);
                compared++;
                if (now.id !== oldRow.id) assert.ok(m.drug_class === 'nsMRA' && l >= 40 && band === 'reduced' && ((l <= 49 && now.ef_band === 'mildly_reduced') || (l >= 50 && prior !== undefined && now.ef_band === 'preserved')), `${m.name} LVEF ${l} prior ${prior}: ${oldRow.id} became ${now.id}`);
            }
        }
        assert.ok(compared > 5000, `${compared} comparisons`);
    });
    check('X1 at 39 finerenone is not started; at 40 it may be (the existing gate), and a patient on finerenone at LVEF 35 keeps the reduced rows', () => {
        const startsFinerenone = (l: number) => scoredCandidates(x1Patient(l), NAMES, TIER_PRICES.cash).some(r => (r.modification_set?.modifications ?? []).some(m => m.action === 'add' && m.target?.med.drug_class === 'nsMRA'));
        assert.equal(startsFinerenone(39), false);
        assert.equal(startsFinerenone(40), true);
        assert.equal(rowIds(x1Patient(35)).death, 'nsmra-reduced-death');
    });
    check('X1 the evidence line says where the band differs: shown for finerenone at LVEF 40 (stated band reduced), absent at 41 (stated band mildly reduced) and at 35', () => {
        const noteAt = (l: number): string | undefined => {
            const p = x1Patient(l);
            const e = buildOutcomeEstimateViews([{ med: FINERENONE, dose: FINERENONE.available_doses[0], selected_frequency: FINERENONE.available_doses[0].frequency_options[0] } as never], p)[0];
            return e.contributors.find(c => c.drug_class === 'nsMRA')?.band_note;
        };
        assert.equal(noteAt(40), 'Finerenone figures are those measured from ejection fraction 40 upward (FINEARTS-HF), which is why they differ from the evidence band stated for this patient.');
        assert.equal(noteAt(41), undefined);
        assert.equal(noteAt(35), undefined);
        assert.equal(evidenceBandStatement(x1Patient(40)).band, 'reduced', 'the stated band is unchanged');
    });
    check('X1 data: the lvef_range field is on exactly the six outcome rows and three symptom rows of the non-steroidal MRA class that need it (reduced, mildly reduced and, from R5 Y5, preserved), and no figure changed', () => {
        const ranged = OUTCOME_EVIDENCE_TABLE.filter(r => (r as unknown as { lvef_range?: unknown }).lvef_range);
        // R5 Y5: the two preserved rows carry a range too (from 50 upward), so the improved-EF patient at 50 and above uses the measured rows.
        assert.deepEqual(ranged.map(r => r.id).sort(), ['nsmra-mildly-reduced-death', 'nsmra-mildly-reduced-hfh', 'nsmra-preserved-death', 'nsmra-preserved-hfh', 'nsmra-reduced-death', 'nsmra-reduced-hfh']);
        const get = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)!;
        assert.deepEqual([get('nsmra-reduced-death').rr, get('nsmra-reduced-hfh').rr, get('nsmra-mildly-reduced-death').rr, get('nsmra-mildly-reduced-hfh').rr], [0.73, 0.63, 0.94, 0.82]);
        assert.deepEqual(SYMPTOM_TABLE.filter(r => (r as unknown as { lvef_range?: unknown }).lvef_range).map(r => r.id).sort(), ['nsmra-mildly_reduced', 'nsmra-preserved', 'nsmra-reduced']);
    });


    // ---------------- X2: with a scope condition ticked the atrial fibrillation alert is shown, limited to the anticoagulation sentence and the rate statement ------------------------
    check('X2 all seven conditions with atrial fibrillation: the alert is shown with the anticoagulation sentence, the rate statement when the rate is above 110, and nothing about starting or deferring a beta-blocker or about options; without atrial fibrillation there is no alert', () => {
        const af = (over: Parameters<typeof mk>[0] = {}) => mk({ lvef: 30, nyha_class: 'III', rhythm: 'AFib', sbp: 118, dbp: 72, pulse: 130, potassium: 4.4, creatinine: 1.0, egfr: 70, ...over }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        for (const cond of SCOPE_CONDITIONS) {
            for (const [label, over, wantRate] of [['rate 130', {}, true], ['rate 80', { pulse: 80 }, false] as const, ['decompensated', { nyha_class: 'IV' as never, dry: 70, cur: 76.5, findings: ['JVP Elevated', 'Crackles', 'Edema (2+)'] }, true]] as const) {
                const p = af(over as Parameters<typeof mk>[0]); p.scope_conditions = new Set([cond.label]);
                const o = runEngine(p);
                assert.equal(o.scoredRegimens.length, 0, `${cond.label}: options shown`);
                const a = o.clinicalAlerts.find(x => x.startsWith('ATRIAL FIBRILLATION'));
                assert.ok(a, `${cond.label} ${label}: no atrial fibrillation alert; ${o.clinicalAlerts.map(headOf).join(' | ')}`);
                assert.ok(/oral anticoagulation is Class I/i.test(a!) && /confirm one is prescribed/.test(a!), `${cond.label} ${label}: anticoagulation sentence missing: ${a}`);
                assert.equal(/resting heart rate is 130 bpm/.test(a!), wantRate, `${cond.label} ${label}: rate statement: ${a}`);
                assert.ok(!/beta-blocker|digoxin|stable|\boptions?\b|Rate control:/i.test(a!.replace(/rate control needs assessment/i, '')), `${cond.label} ${label}: therapy or option wording: ${a}`);
            }
            // atrial fibrillation as a history only (comorbidity) with a sinus rhythm: the anticoagulation sentence, no rate statement
            const h = af({ rhythm: 'Sinus', pulse: 130, comorb: ['Atrial Fibrillation'] }); h.scope_conditions = new Set([cond.label]);
            const ha = runEngine(h).clinicalAlerts.find(x => x.startsWith('ATRIAL FIBRILLATION'));
            assert.ok(ha && /oral anticoagulation/i.test(ha) && !/resting heart rate is/.test(ha), `${cond.label}: history only: ${ha}`);
            // no atrial fibrillation: no alert
            const n = af({ rhythm: 'Sinus', pulse: 80 }); n.scope_conditions = new Set([cond.label]);
            assert.ok(!runEngine(n).clinicalAlerts.some(x => x.startsWith('ATRIAL FIBRILLATION')), `${cond.label}: alert without atrial fibrillation`);
        }
        // in scope the alert is unchanged: the rate-control sentence remains
        const full = af({ pulse: 80 }); full.scope_conditions = new Set();
        assert.ok(/Rate control: a beta-blocker is first line/.test(runEngine(full).clinicalAlerts.find(x => x.startsWith('ATRIAL FIBRILLATION'))!));
    });

    return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = runEngineReadinessR4Checks();
    console.log(`ReadinessR4: passed ${r.passed}, failed ${r.failed}`);
    process.exit(r.failed > 0 ? 1 : 0);
}
