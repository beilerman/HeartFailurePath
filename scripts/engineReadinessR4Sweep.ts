/**
 * Round 4 seeded random sweep (rulings W1, W2, W3, W5, W8): `npx tsx scripts/engineReadinessR4Sweep.ts <count> <firstSeed> [out.json]`. Patients come from `r3Generator.ts`. Not part of the gate (it is long); the same
 * rules are asserted on the reviewers' patients and on small samples by `engineReadinessR4Checks.ts`. Run in chunks of at most 5,000 patients per process. Prints counts of what was checked and every exception.
 * Every expected value is recomputed here independently of the engine's own selection: gaps from the displayed raw scores and from every scored plan, expected alerts from the same patient on the full path with the
 * offending field repaired, order independence by comparing the whole output for reversed and rotated entry order.
 */
import { writeFileSync } from 'node:fs';
import { gen3r } from './r3Generator';
import { PRICES as TIER_PRICES } from './r2Generator';
import { MEDICATION_FORMULARY } from '../constants';
import { scoredCandidates } from './scoredCandidates';
import { generateAndScoreModifications, clonePatient } from '../services/simulationService';
import { brokenDisplayFloors } from '../services/engine/selection';
import { ADVISORY_ALERT_HEADS } from '../services/engine/whyFirst';
import { SCOPE_CONDITIONS, SCOPE_HEAD, SCOPE_HIDDEN_ALERT_HEADS } from '../services/engine/scopeGate';
import type { Patient, ScoredRegimen, SimulationOutput } from '../types';

const NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));
const run = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePatient(p), NAMES, TIER_PRICES[p.insurance_tier ?? 'cash']);
const n = Number(process.argv[2] ?? 1000), first = Number(process.argv[3] ?? 9300000), outFile = process.argv[4];
const nCh = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').length;
const head = (a: string) => { const i = a.indexOf(': '); return i > 0 ? a.slice(0, i) : a.slice(0, 40); };
const TIE = /No option scores .* or more above leaving the regimen unchanged|No option is measurably better/;
const STATE_PROMPTS = ['NYHA CLASS AND FINDINGS DISAGREE', 'SYMPTOMS AT REST WITHOUT RECORDED CONGESTION'];
const PROFILES = ['default', 'outcomes_first', 'cost_first', 'simplicity_first'] as const;

const counts: Record<string, number> = {
    patients: 0, W1_runs: 0, W1_missing_alert: 0, W1_row_without_alert: 0, W1_false_alert: 0,
    W2_runs: 0, W2_tie_sentences: 0, W2_false_tie: 0, W2_missed_tie_checked: 0, W2_missed_tie: 0,
    W3_runs: 0, W3_compared: 0, W3_missing: 0,
    W5_runs: 0, W5_therapy_prompt: 0, W5_scope_line_missing: 0, W5_options_shown: 0,
    W8_runs: 0, W8_order_dependent: 0,
};
const exceptions: string[] = [];
const bad = (key: string, seed: number, msg: string) => { counts[key]++; if (exceptions.length < 80) exceptions.push(`${key} seed ${seed}: ${msg}`); };

const urgentHeads = (o: SimulationOutput, keep: (a: string) => boolean = () => true) =>
    new Set(o.clinicalAlerts.filter(a => !ADVISORY_ALERT_HEADS.includes(head(a)) || STATE_PROMPTS.includes(head(a))).filter(keep).map(head));
const describesOptions = (a: string) => /\boptions?\b|\bthe plan\b|\bin the plan\b/i.test(a);
const EQUIV: Record<string, string[]> = { 'INAPPROPRIATE REGIMEN': ['MEDICATION RECONCILIATION'], 'INAPPROPRIATE THERAPY': ['CONTRAINDICATED COMBINATION'], 'KIDNEY FUNCTION': ['DRUG REMOVED FOR KIDNEY FUNCTION'] };
const canon = (v: unknown): unknown => (typeof v === 'number' ? Math.round(v * 1e7) / 1e7 : Array.isArray(v) ? v.map(canon) : v instanceof Set ? [...v].sort() : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).filter(k => k !== 'projected_patient' && k !== 'recorded_medication_exposures').sort().map(k => [k, canon((v as Record<string, unknown>)[k])])) : v);
const ser = (o: SimulationOutput): string => JSON.stringify(canon({ s: o.scoredRegimens, a: o.clinicalAlerts, m: o.monitoringPlan, n: o.missingDataNotices, d: o.decisionReadiness, w: o.why_first, g: o.gdmtGaps, e: o.eligibleAdjuncts, x: o.excludedMedications, f: o.followUpCalendar }), (_k, v) => (typeof v === 'function' ? undefined : v));

for (let i = 0; i < n; i++) {
    const seed = first + i;
    const p = gen3r(seed).p;
    counts.patients++;
    try {
        // ---- W1: oxygen saturation below 90 on every path
        const spo2 = 80 + (seed % 10);   // 80 to 89
        const paths: Array<[string, (q: Patient) => void]> = [
            ['full', () => { /* as generated */ }], ['limited', q => { q.age = 0; }], ['input error', q => { q.cost_sensitivity = -1; }],
            ['scope ticked', q => { q.scope_conditions = new Set([SCOPE_CONDITIONS[seed % 7].label]); }], ['sbp<dbp', q => { q.dbp = q.sbp + 5; }], ['typo EF', q => { q.lvef = 250; }],
        ];
        // two paths per patient, rotated by seed, so every path is covered many times over a sweep; one saturation below 90 and one control at 94
        for (const [name, f] of [paths[seed % 6], paths[(seed + 3) % 6]]) for (const value of [spo2, 94]) {
            const q = clonePatient(p); q.oxygen_saturation = value; f(q);
            const o = run(q); counts.W1_runs++;
            const alert = o.clinicalAlerts.filter(a => a.startsWith('HYPOXIA ALERT')).length;
            const row = [...o.monitoringPlan, ...o.scoredRegimens.flatMap(r => r.monitoring_plan ?? [])].some(m => /see the hypoxia alert/.test(m.details));
            if (value < 90 && alert !== 1) bad('W1_missing_alert', seed, `${name}: ${alert} hypoxia alerts`);
            if (value >= 90 && alert !== 0) bad('W1_false_alert', seed, `${name}: alert at SpO2 ${value}`);
            if (row && alert === 0) bad('W1_row_without_alert', seed, name);
        }
        // ---- W2: the tie sentence, in every weight profile, on the budget given and on a budget nothing fits
        // every weight profile on the patient's own budget, and a budget nothing fits for two profiles (cost first always, one more rotated)
        for (const [care, budget] of [...PROFILES.map(c => [c, undefined] as const), ['cost_first', 1] as const, [PROFILES[seed % 4], 1] as const]) {
            const q = clonePatient(p); q.care_priority = care; if (budget !== undefined) q.max_affordable_cost = budget;
            const o = run(q); counts.W2_runs++;
            const nc = o.scoredRegimens.find(r => nCh(r) === 0);
            const said = (o.why_first?.options[0]?.lines ?? []).some(l => TIE.test(l.text));
            const gap = nc ? Math.max(...o.scoredRegimens.map(r => r.raw_score ?? 0)) - (nc.raw_score ?? 0) : null;
            if (said) { counts.W2_tie_sentences++; if (gap === null || gap >= 1) bad('W2_false_tie', seed, `${care} budget ${budget ?? 'own'}: gap ${gap?.toFixed(2)}`); }
            // missed tie, checked where the budget is met and no plan is over it: an independent recount over every scored plan that passes the display floors and is not below no change
            if (budget === undefined && o.scoredRegimens.length > 1 && nc && !said && nCh(o.scoredRegimens[0]) !== 0 && !o.scoredRegimens.some(r => r.warnings.some(w => w.startsWith('BUDGET EXCEEDED') || w.startsWith('AFFORDABILITY UNASSESSED')))) {
                const scored = scoredCandidates(q, NAMES, TIER_PRICES[q.insurance_tier ?? 'cash']);
                const exact = scored.find(r => nCh(r) === 0);
                if (exact) {
                    const eligible = scored.filter(r => brokenDisplayFloors(r, q).length === 0 && r.cost <= q.max_affordable_cost && (r.raw_score ?? 0) >= (exact.raw_score ?? 0) - 1e-9);
                    counts.W2_missed_tie_checked++;
                    const widest = Math.max(...eligible.map(r => r.raw_score ?? 0)) - (exact.raw_score ?? 0);
                    const congestedDiuretic = false;   // the congestion exception is excluded by requiring a displayed first option with no diuretic step below
                    if (widest < 1 && !congestedDiuretic && !o.scoredRegimens[0].shown_because && !(o.why_first?.options[0]?.lines ?? []).some(l => /does not model congestion relief/.test(l.text))
                        && !o.scoredRegimens[0].modification_set?.modifications.some(m => (m.action === 'add' || m.action === 'titrate_up') && ['Loop Diuretic', 'Thiazide-like Diuretic'].includes(m.target?.med.drug_class ?? ''))) bad('W2_missed_tie', seed, `${care}: widest eligible gap ${widest.toFixed(2)} but no tie sentence`);
                }
            }
        }
        // ---- W3: urgent alerts on every stop path
        const full = run(p);
        if (full.scoredRegimens.length > 0) {
            const stopVariants: Array<[string, (q: Patient) => void, Array<(q: Patient) => void>, string[]]> = [
                ['input error', q => { q.cost_sensitivity = -1; }, [() => { /* none */ }], []],
                // The derived eGFR fall that sets the KIDNEY FUNCTION band is computed from the age (renalChange.ts), so that alert reads the offending field here.
                ['limited', q => { q.age = 0; }, [() => { /* none */ }], ['KIDNEY FUNCTION']],
                ['sbp<dbp', q => { q.dbp = q.sbp + 5; }, [q => { q.dbp = Math.max(20, q.sbp - 30); }, q => { q.dbp = Math.max(20, q.sbp - 40); }], ['LOW OUTPUT STATE']],
                ['typo BMI', q => { q.bmi = 120; }, [q => { q.bmi = 24; }, q => { q.bmi = 32; }], []],
                ['typo EF', q => { q.lvef = 250; }, [q => { q.lvef = 30; }, q => { q.lvef = 60; }], []],
            ];
            for (const [name, apply, repairs, dependsOn] of [stopVariants[seed % 5], stopVariants[(seed + 2) % 5]]) {
                counts.W3_runs++;
                let exp: Set<string> | null = null;
                for (const rp of repairs) {
                    const r = clonePatient(p); rp(r); const ro = run(r);
                    if (ro.scoredRegimens.length === 0) { exp = null; break; }
                    const h = urgentHeads(ro, a => !describesOptions(a));
                    exp = exp === null ? h : new Set<string>(Array.from(exp as Set<string>).filter((x: string) => h.has(x)));
                }
                if (!exp) continue;
                const q = clonePatient(p); apply(q); const o = run(q);
                if (o.scoredRegimens.length > 0) continue;
                counts.W3_compared++;
                const got = new Set(o.clinicalAlerts.map(head));
                const missing = Array.from(exp as Set<string>).filter(h => !got.has(h) && !(EQUIV[h] ?? []).some(e => got.has(e)) && !dependsOn.includes(h));
                if (missing.length) bad('W3_missing', seed, `${name}: ${missing.join(', ')}`);
            }
            // ---- W5: a scope condition ticked, every seventh patient with each condition
            for (const cond of SCOPE_CONDITIONS.filter((_, k) => k === seed % 7)) {
                const q = clonePatient(p); q.scope_conditions = new Set([cond.label]); const o = run(q); counts.W5_runs++;
                if (o.scoredRegimens.length > 0) bad('W5_options_shown', seed, cond.label);
                const hidden = o.clinicalAlerts.map(head).filter(h => SCOPE_HIDDEN_ALERT_HEADS.includes(h));
                if (hidden.length || (o.gdmtGaps ?? []).length || (o.eligibleAdjuncts ?? []).length || o.decisionReadiness) bad('W5_therapy_prompt', seed, `${cond.label}: ${hidden.join(', ') || 'block shown'}`);
                const sa = o.clinicalAlerts.find(a => a.startsWith(SCOPE_HEAD));
                if (!sa || !/not shown, because this condition is outside the tool's scope/.test(sa)) bad('W5_scope_line_missing', seed, cond.label);
            }
        }
        // ---- W8: entry order
        if (p.current_regimen.length >= 2) {
            const a = ser(full);
            const rev = clonePatient(p); rev.current_regimen = [...rev.current_regimen].reverse();
            const rot = clonePatient(p); rot.current_regimen = [...rot.current_regimen.slice(1), ...rot.current_regimen.slice(0, 1)];
            counts.W8_runs += 2;
            if (ser(run(rev)) !== a) bad('W8_order_dependent', seed, 'reversed');
            if (ser(run(rot)) !== a) bad('W8_order_dependent', seed, 'rotated');
        }
    } catch (e) { bad('W3_missing', seed, `THROW ${String(e).slice(0, 100)}`); }
}
console.log(JSON.stringify({ first, n, counts, exceptions }, null, 1));
if (outFile) writeFileSync(outFile, JSON.stringify({ first, n, counts, exceptions }, null, 1));
