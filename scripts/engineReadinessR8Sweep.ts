/**
 * Seeded sweeps for the round 8 rulings. Usage: `npx tsx scripts/engineReadinessR8Sweep.ts <mode> <firstSeed> <count>` (chunks of at most 5,000 patients per process).
 * Modes are the keys of R8_CHECKS (x1, x2, x3 ...); a mode may prepare the patient (R8_PREP, e.g. x11 gives the patient an allergy to a drug taken), and the stop-path modes run the 13 no-option paths too.
 * Exits 1 on any exception or fault and prints the first examples.
 */
import { gen3r } from './r3Generator';
import { clonePatient } from '../data/scenarios';
import { runEngine } from './engineReadinessR2Checks';
import { R8_CHECKS, R8_PREP, NO_OPTION_PATHS } from './engineReadinessR8Checks';
import type { Patient, SimulationOutput } from '../types';

const [mode = 'x1', firstArg = '20100000', countArg = '5000', pathsArg = ''] = process.argv.slice(2);
const first = Number(firstArg), count = Math.min(Number(countArg), 5000);
const bad: Record<string, string[]> = {}; const counts: Record<string, number> = {};
const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const fail = (k: string, seed: number, msg: string) => { inc(`FAIL_${k}`); (bad[k] ??= []).length < 5 && bad[k].push(`seed ${seed}: ${msg.slice(0, 500)}`); };
const f = R8_CHECKS[mode]; if (!f) { console.error('unknown mode', mode); process.exit(2); }
for (let sd = first; sd < first + count; sd++) {
    const base = clonePatient(gen3r(sd).p as Patient); base.scope_conditions = new Set();
    const variants: Array<[string, Patient | null]> = [['full', R8_PREP[mode] ? R8_PREP[mode](base, sd) : base]];
    if (pathsArg === 'paths') for (const [pn, pf] of NO_OPTION_PATHS) { if (pn === 'full') continue; const q = R8_PREP[mode] ? R8_PREP[mode](clonePatient(base), sd) : clonePatient(base); if (q) { pf(q); variants.push([pn, q]); } }
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
