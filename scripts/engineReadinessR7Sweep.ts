/**
 * Seeded sweeps for the round 7 rulings. Usage: `npx tsx scripts/engineReadinessR7Sweep.ts <mode> <firstSeed> <count>` (chunks of at most 5,000 patients per process).
 * Modes: templates (distinct alert sentences that speak of options, with counts; discovery for W2), w2 (every option-speaking alert sentence against the options shown), w1 (trade-off labels),
 *        w3 (adjunct lines), w4 (monitoring rows against drugs removed or excluded), w5 (no-option headings), w11 (three angioedema routes), w12 (hold and loop alerts).
 * Exits 1 on any exception and prints the first examples.
 */
import { gen3r } from './r3Generator';
import { clonePatient } from '../data/scenarios';
import { runEngine } from './engineReadinessR2Checks';
import { NO_OPTION_PATHS } from './r6Paths';
import { R7_CHECKS } from './engineReadinessR7Checks';
import type { Patient, SimulationOutput } from '../types';

const [mode = 'templates', firstArg = '10100000', countArg = '5000'] = process.argv.slice(2);
const first = Number(firstArg), count = Math.min(Number(countArg), 5000);
const bad: Record<string, string[]> = {}; const counts: Record<string, number> = {};
const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const fail = (k: string, seed: number, msg: string) => { inc(`FAIL_${k}`); (bad[k] ??= []).length < 5 && bad[k].push(`seed ${seed}: ${msg.slice(0, 400)}`); };
const patientOf = (sd: number, f?: (p: Patient) => void): Patient => { const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set(); f?.(p); return p; };
const templates = new Map<string, { n: number; ex: string }>();

for (let sd = first; sd < first + count; sd++) {
    let o: SimulationOutput;
    try { o = runEngine(patientOf(sd)); } catch (e) { fail('exception', sd, String(e)); continue; }
    inc('runs');
    if (mode === 'templates') {
        for (const a of o.clinicalAlerts) for (const sent of a.split(/(?<=[.;:]) /)) if (/\b(options?|plans?)\b|stays? at the current|stay unchanged|is kept\b/i.test(sent)) {
            const key = sent.replace(/\d+(\.\d+)?/g, '#').replace(/[A-Z][a-z]+( [a-z]+)?\s?\/?[A-Z]?[a-z]*(?= [#]| is | stays| and)/g, 'DRUG').slice(0, 160);
            const t = templates.get(key) ?? { n: 0, ex: `seed ${sd}: ${sent.slice(0, 220)}` }; t.n++; templates.set(key, t);
        }
    } else {
        const f = R7_CHECKS[mode]; if (!f) { console.error('unknown mode', mode); process.exit(2); }
        const v = f(patientOf(sd), o, (k: string, n?: number) => inc(k, n ?? 1)); v.forEach(m => fail(`${mode} ${m.split(/;| option \d/)[0].slice(0, 70)}`, sd, m));
        if (mode === 'w5') for (const [pn, pf] of NO_OPTION_PATHS) { if (pn === 'full') continue; const q = patientOf(sd, pf); let o2: SimulationOutput; try { o2 = runEngine(q); } catch { continue; } R7_CHECKS.w5(q, o2, (k: string, n?: number) => inc(`${pn}:${k}`, n ?? 1)).forEach(m => fail(`w5 ${pn} ${m.slice(0, 50)}`, sd, m)); }
    }
}
if (mode === 'templates') [...templates.entries()].sort((a, b) => b[1].n - a[1].n).forEach(([, v]) => console.log(String(v.n).padStart(5), '|', v.ex));
console.log(JSON.stringify({ mode, first, count, counts }, null, 1));
for (const [k, v] of Object.entries(bad)) { console.log(`EXCEPTIONS ${k}:`); v.forEach(x => console.log('  ', x)); }
process.exit(Object.keys(bad).length ? 1 : 0);
