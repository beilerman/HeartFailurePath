/**
 * Seeded sweeps for the round 10 rulings. Usage: `npx tsx scripts/engineReadinessR10Sweep.ts <mode> <firstSeed> <count> [paths]` (chunks of at most 5,000 patients per process).
 * Modes are the keys of R10_CHECKS (a1, a2 ...). Exits 1 on any exception or fault.
 */
import { gen3r } from './r3Generator';
import { clonePatient } from '../data/scenarios';
import { runEngine } from './engineReadinessR2Checks';
import { R10_CHECKS, R10_PREP, NO_OPTION_PATHS } from './engineReadinessR10Checks';
import type { Patient, SimulationOutput } from '../types';

const [mode = 'a1', firstArg = '30100000', countArg = '5000', pathsArg = ''] = process.argv.slice(2);
const first = Number(firstArg), count = Number(countArg);
if (!Number.isSafeInteger(first) || !Number.isSafeInteger(first + count) || !Number.isInteger(count) || count < 1 || count > 5000) {
    throw new Error('Supply an integer starting seed and a count between 1 and 5,000.');
}
const bad: Record<string, string[]> = {}; const counts: Record<string, number> = {};
const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const fail = (k: string, seed: number, msg: string) => { inc(`FAIL_${k}`); (bad[k] ??= []).length < 5 && bad[k].push(`seed ${seed}: ${msg.slice(0, 500)}`); };
const f = R10_CHECKS[mode]; if (!f) { console.error('unknown mode', mode); process.exit(2); }
for (let sd = first; sd < first + count; sd++) {
    const base = clonePatient(gen3r(sd).p as Patient); base.scope_conditions = new Set();
    const variants: Array<[string, Patient | null]> = [['full', R10_PREP[mode] ? R10_PREP[mode](base, sd) : base]];
    if (pathsArg === 'paths') for (const [pn, pf] of NO_OPTION_PATHS) { if (pn === 'full') continue; const q = R10_PREP[mode] ? R10_PREP[mode](clonePatient(base), sd) : clonePatient(base); if (q) { pf(q); variants.push([pn, q]); } }
    for (const [pn, p] of variants) {
        if (!p) continue;
        let o: SimulationOutput; try { o = runEngine(clonePatient(p)); } catch (e) { fail('exception', sd, String(e)); continue; }
        inc(`runs:${pn}`);
        for (const m of f(p, o, (k, n) => inc(pn === 'full' ? k : `${pn}:${k}`, n ?? 1))) fail(`${mode} ${pn} ${m.split(/[;:]/)[0].slice(0, 60)}`, sd, m);
    }
}
console.log(JSON.stringify({ mode, first, count, counts }, null, 1));
for (const [k, v] of Object.entries(bad)) { console.log(`EXCEPTIONS ${k}:`); v.forEach(x => console.log('  ', x)); }
process.exit(Object.keys(bad).length ? 1 : 0);
