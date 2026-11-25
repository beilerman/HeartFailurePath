/** Report only (R8 X4): how many runs the congestion display rule counts a net-unchanged loop step (a duplicate clean-up) as a loop increase. Usage: tsx scripts/r8X4Report.ts <first> <count> */
import { gen3r } from './r3Generator';
import { clonePatient, SCENARIOS } from '../data/scenarios';
import { runEngine } from './engineReadinessR2Checks';
import { includesLoopIncrease } from '../services/engine/selection';
import { isCongestedAboveDryWeight, loopDoseEffect, dedupeCurrentRegimen } from '../services/engine/regimenUtils';
import { isActiveExposure } from '../services/engine/medicationExposure';
import type { Patient } from '../types';
const eff = (p: Patient) => ({ ...p, current_regimen: dedupeCurrentRegimen(p.current_regimen).regimen.filter(isActiveExposure) });
const tally = (label: string, ps: Patient[]) => {
    let runs = 0, congested = 0, rule = 0, firstSame = 0;
    for (const p of ps) { let o; try { o = runEngine(clonePatient(p)); } catch { continue; } runs++; if (!isCongestedAboveDryWeight(p) || o.scoredRegimens.length === 0) continue; congested++;
        const pp = eff(p); const counted = o.scoredRegimens.some(includesLoopIncrease); const net = o.scoredRegimens.some(r => loopDoseEffect(pp, r) === 'raises');
        if (counted && !net) { rule++; if (!includesLoopIncrease(o.scoredRegimens[0]) || loopDoseEffect(pp, o.scoredRegimens[0]) === 'unchanged') firstSame++; } }
    console.log(JSON.stringify({ label, runs, congestedWithOptions: congested, runsWhereTheRuleCountsOnlyANetUnchangedStep: rule, ofThoseOptionOneIsThatStep: firstSame }));
};
const first = Number(process.argv[2] ?? 20100000), count = Number(process.argv[3] ?? 5000);
tally('reference scenarios', SCENARIOS.map(s => s.patient));
tally(`random ${first}+${count}`, Array.from({ length: count }, (_, i) => { const p = clonePatient(gen3r(first + i).p as Patient); p.scope_conditions = new Set(); return p; }));
