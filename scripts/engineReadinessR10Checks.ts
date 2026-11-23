/**
 * Round 10 engine rulings of the 2026-11-22 readiness pass (A1 to A12). Every check builds the patient a reviewer reported AND neighbours, and asserts the corrected behaviour.
 * Run standalone (`npx tsx scripts/engineReadinessR10Checks.ts`) or through `npm run verify`. Per-patient generated checks are `R10_CHECKS`, also run in chunks by
 * `scripts/engineReadinessR10Sweep.ts <mode> <firstSeed> <count>`.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mk, runEngine, summaries, entry, gen3r, clonePatient, MEDICATION_FORMULARY, NO_OPTION_PATHS, withDrug, coldPatient, modsOfOpt } from './engineReadinessR9Checks';
import type { Patient, SimulationOutput } from './engineReadinessR9Checks';
import { drugFacts } from '../services/engine/drugFacts';
import { expandAllergies } from '../services/engine/allergy';
import { generateAndScoreModifications } from '../services/simulationService';
import { PRICES as TIER_PRICES } from './r2Generator';
import { hasAngioedemaHistory } from '../services/engine/intolerance';
import { isColdState, hasCongestion, oralLoopFe as oralLoopTotal } from '../services/engine/regimenUtils';

export { mk, runEngine, summaries, entry, gen3r, clonePatient, MEDICATION_FORMULARY, NO_OPTION_PATHS, withDrug, coldPatient, modsOfOpt };
export type { Patient, SimulationOutput };

/** Per-patient generated checks (sweep modes): each returns the faults found for one patient and its output. */
export const R10_CHECKS: Record<string, (p: Patient, o: SimulationOutput, count: (k: string, n?: number) => void) => string[]> = {};
/** How a sweep mode prepares the generated patient. Returning null skips the seed. */
export const R10_PREP: Record<string, (p: Patient, sd: number) => Patient | null> = {};

export const isOralLoop = (m: { med: { drug_class: string } }) => m.med.drug_class === 'Loop Diuretic' && !drugFacts(m.med as never).short_course_addon;
export const isFuroscix = (m: { med: { drug_class: string } }) => m.med.drug_class === 'Loop Diuretic' && !!drugFacts(m.med as never).short_course_addon;
const generic = (n: string) => n.replace(/\s*\(.*\)/, '');
void generic;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A1: Furoscix alone is not an oral loop on board: a congested patient taking Furoscix and no oral loop gets the same oral loop start as the patient without Furoscix
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** The background patient made congested (dry weight 80, weight 84, three findings), with no oral loop, taking Furoscix; the second is the same patient with Furoscix deleted. */
export function congestedFuroscixPair(sd: number): { withF: Patient; without: Patient } {
    const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set();
    p.current_regimen = p.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic');
    p.volume_status.dry_weight_kg = 80; p.volume_status.current_weight_kg = 84 + (sd % 3); p.volume_status.exam_findings = new Set(['Edema (2+)', 'JVP Elevated', 'Crackles']);
    p.sbp = Math.max(p.sbp || 0, 100); if (!(p.potassium >= 3.5)) p.potassium = 4.2; if (p.potassium >= 5.0) p.potassium = 4.6;
    // A small monthly budget is a stated rule that may leave only the (cheapest) removal of Furoscix, so the generated patients are not budget-limited.
    p.max_affordable_cost = 100000;
    const without = clonePatient(p); withDrug(p, 'Furoscix (SC Furosemide)');
    return { withF: p, without };
}
const oralLoopSteps = (o: SimulationOutput): string[] => o.scoredRegimens.map(r => modsOfOpt(r).filter(m => (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') && m.target && isOralLoop(m.target)).map(m => `${m.target!.med.name} ${m.target!.dose.strength} ${m.target!.selected_frequency}`).sort().join('+'));
R10_PREP.a1 = (_p, sd) => congestedFuroscixPair(sd).withF;
R10_CHECKS.a1 = (p, o, count) => {
    const out: string[] = []; const pair = congestedFuroscixPair(Number((p as unknown as { __sd?: number }).__sd ?? 0)); void pair;
    const b = clonePatient(p); b.current_regimen = b.current_regimen.filter(r => !isFuroscix(r)); let ob: SimulationOutput;
    try { ob = runEngine(clonePatient(b)); } catch (e) { return [`exception ${String(e).slice(0, 120)}`]; }
    const a = new Set(oralLoopSteps(o).filter(Boolean)), bb = new Set(oralLoopSteps(ob).filter(Boolean));
    if (ob.scoredRegimens.length === 0) { count('baseline empty'); return out; }
    count('furoscix patients'); if (bb.size === 0) { count('baseline offers no oral loop step (not counted)'); return out; }
    count('baseline offers an oral loop step');
    if (o.scoredRegimens.length === 0) return [`empty screen with Furoscix, baseline has ${ob.scoredRegimens.length} options`];
    if (a.size === 0) out.push(`no option starts an oral loop; without Furoscix: ${[...bb].join(' / ')}; options with Furoscix: ${o.scoredRegimens.map(r => summaries(r).join(' ; ').slice(0, 100)).join(' || ')}`);
    else if ([...bb].some(x => !a.has(x)) || [...a].some(x => !bb.has(x))) out.push(`oral loop step differs: with Furoscix ${[...a].join(' / ')}; without ${[...bb].join(' / ')}`);
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A2: in the cold state a loop diuretic that must stop is replaced on the same terms as outside it (congestion recorded); nothing else is started or raised
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** A congested patient on one oral loop diuretic they are allergic to, in the cold state (cool extremities, narrow pulse pressure) and the same patient without the perfusion markers. */
export function coldLoopAllergyPair(sd: number): { cold: Patient; warm: Patient } {
    const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set();
    p.current_regimen = p.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic');
    const loop = ['Furosemide', 'Torsemide', 'Bumetanide'][sd % 3] as string; withDrug(p, loop);
    p.allergies = new Set([loop.toLowerCase()]); p.max_affordable_cost = 100000; p.comorbidities.delete('Anuria');
    p.volume_status.dry_weight_kg = 80; p.volume_status.current_weight_kg = 84 + (sd % 3); p.volume_status.exam_findings = new Set(['Edema (2+)', 'JVP Elevated', 'Crackles']);
    p.potassium = 4.4; p.sbp = 96; p.dbp = 74; p.pulse = 84; p.is_pregnant = false; p.egfr = Math.max(p.egfr || 60, 45); p.creatinine = Math.min(p.creatinine || 1.1, 1.4);
    const warm = clonePatient(p); warm.sbp = 112; warm.dbp = 66;
    const cold = clonePatient(p); cold.volume_status.exam_findings = new Set([...cold.volume_status.exam_findings, 'Cool Extremities']);
    return { cold, warm };
}
const loopSwaps = (o: SimulationOutput): string[] => o.scoredRegimens.flatMap(r => modsOfOpt(r).filter(m => m.action === 'swap' && m.source && isOralLoop(m.source) && m.target && isOralLoop(m.target)).map(m => `${m.source!.med.name} -> ${m.target!.med.name} ${m.target!.dose.strength} ${m.target!.selected_frequency}`)).filter((x, i, a) => a.indexOf(x) === i).sort();
R10_PREP.a2 = (_p, sd) => coldLoopAllergyPair(sd).cold;
R10_CHECKS.a2 = (p, o, count) => {
    const out: string[] = []; if (!isColdState(p)) { count('not in the cold state (skipped)'); return out; } count('cold loop-allergy patients');
    const allergic = [...p.allergies][0] as string; const oralNames = MEDICATION_FORMULARY.filter(m => isOralLoop({ med: m })).map(m => m.name);
    // Every option replaces the loop that must stop (the screen is not left with a plain removal while a replacement is eligible), and the replacement is the one the same patient without the perfusion markers is given when that drug is the only
    // oral loop left: same drug, same dose. (Which of two eligible replacements is ranked first may differ: the cold state ranks with no starts.)
    for (const [i, r] of o.scoredRegimens.entries()) {
        const sw = modsOfOpt(r).filter(m => m.action === 'swap' && m.source && isOralLoop(m.source) && m.target && isOralLoop(m.target));
        if (sw.length === 0) { out.push(`option ${i + 1} has no forced loop switch: ${summaries(r).join(' ; ').slice(0, 200)}`); continue; }
        for (const m of sw) {
            count('cold forced loop switches');
            const w = clonePatient(p); w.volume_status.exam_findings = new Set([...w.volume_status.exam_findings].filter(x => x !== 'Cool Extremities')); w.sbp = 112; w.dbp = 66;
            w.allergies = new Set([allergic, ...oralNames.filter(n => n !== m.target!.med.name && n.toLowerCase() !== allergic).map(n => n.toLowerCase().split(' ')[0] as string)]);
            let ow: SimulationOutput; try { ow = runEngine(w); } catch (e) { out.push(`exception ${String(e).slice(0, 100)}`); continue; }
            const same = loopSwaps(ow).includes(`${m.source!.med.name} -> ${m.target!.med.name} ${m.target!.dose.strength} ${m.target!.selected_frequency}`);
            if (!same) out.push(`cold switch ${m.source!.med.name} -> ${m.target!.med.name} ${m.target!.dose.strength} ${m.target!.selected_frequency} is not what the warm patient is given: ${JSON.stringify(loopSwaps(ow))}`);
        }
    }
    for (const [i, r] of o.scoredRegimens.entries()) for (const m of modsOfOpt(r)) if ((m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') && m.target && !(isOralLoop(m.target) || (m.action === 'swap' && m.mandatory && m.source?.med.drug_class === 'Beta Blocker'))) out.push(`option ${i + 1} starts or raises ${m.target.med.name} in the cold state`);
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A3: every option whose resulting regimen has no loop diuretic, for a patient with recorded congestion, carries the warning with the true cause; no other option carries it
// A5: the "no oral loop diuretic start or increase is available" note is never shown on an option that starts, switches to or raises a loop diuretic
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const NO_LOOP_WARNING = 'This option leaves the patient without a loop diuretic although congestion is recorded';
const LOOPS = ['furosemide', 'torsemide', 'bumetanide'];
/** Congested patients in the states that leave a congested patient without a loop diuretic (and the plain ones), by seed. */
export function congestedLoopState(sd: number): Patient {
    const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); p.max_affordable_cost = 100000; p.comorbidities.delete('Anuria');
    const strip = () => { p.current_regimen = p.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic'); };
    const lp = LOOPS[sd % 3] as string; const lname = lp[0]!.toUpperCase() + lp.slice(1);
    p.volume_status.dry_weight_kg = 80; p.volume_status.current_weight_kg = 80 + [0.5, 3, 4, 6][sd % 4]!; p.volume_status.exam_findings = new Set(['Edema (2+)', 'JVP Elevated', 'Crackles']);
    if (p.potassium >= 5.0 || !(p.potassium > 0)) p.potassium = 4.4;
    switch (Math.floor(sd / 3) % 10) {
        case 0: strip(); break;                                                                                  // no loop taken, congested
        case 1: strip(); withDrug(p, lname); p.allergies = new Set([lp]); p.current_regimen.forEach(r => { if (r.med.name === lname) r.exposure = { status: 'active', adherence: 'unknown' } as never; }); break; // allergic, use unconfirmed
        case 2: strip(); withDrug(p, lname); p.allergies = new Set([lp]); p.potassium = 3.2; break;                  // allergic, potassium below 3.5
        case 3: strip(); p.allergies = new Set(LOOPS); break;                                                     // allergic to every loop, none taken
        case 4: strip(); withDrug(p, lname); p.allergies = new Set(LOOPS); break;                                 // allergic to every loop, one taken
        case 5: strip(); withDrug(p, 'Furoscix (SC Furosemide)'); p.potassium = 3.2; break;                        // Furoscix only, potassium below 3.5
        case 6: strip(); withDrug(p, 'Furoscix (SC Furosemide)'); p.allergies = new Set(['torsemide', 'bumetanide']); break; // Furoscix only, other loops excluded
        case 7: strip(); withDrug(p, lname); p.allergies = new Set([lp]); p.sbp = 96; p.dbp = 74; p.volume_status.exam_findings.add('Cool Extremities'); break; // cold
        case 8: strip(); withDrug(p, 'Furosemide'); withDrug(p, 'Torsemide'); p.allergies = new Set([lp]); break;      // two loops, one allergen
        default: strip(); withDrug(p, lname); p.allergies = new Set([lp]); p.potassium = 6.2; break;               // allergic, potassium 6.0 or above
    }
    return p;
}
const noLoopOption = (r: SimulationOutput['scoredRegimens'][number]) => !r.regimen.some(x => x.med.drug_class === 'Loop Diuretic');
R10_PREP.a3 = (_p, sd) => congestedLoopState(sd);
R10_CHECKS.a3 = (p, o, count) => {
    const out: string[] = []; const congested = hasCongestion(p);
    for (const [i, r] of o.scoredRegimens.entries()) {
        const ws = r.warnings.filter(w => w.includes(NO_LOOP_WARNING)); const want = congested && noLoopOption(r);
        count(want ? 'options with no loop and congestion' : 'other options');
        if (ws.length > 1) out.push(`option ${i + 1} carries the warning ${ws.length} times`);
        if (want && ws.length === 0) { out.push(`option ${i + 1} has no loop diuretic with congestion recorded but no warning: ${summaries(r).join(' ; ').slice(0, 200)}`); continue; }
        if (!want && ws.length > 0) { out.push(`option ${i + 1} carries the warning although ${congested ? 'it has a loop diuretic' : 'no congestion is recorded'}: ${ws[0]!.slice(0, 200)}`); continue; }
        if (!want) continue;
        const w = ws[0]!; const cause = w.slice(w.indexOf(NO_LOOP_WARNING) + NO_LOOP_WARNING.length);
        if (!/^(: .+)?\.$/.test(cause)) out.push(`option ${i + 1}: the sentence ends oddly: "${cause}"`);
        const kind = cause === '.' ? 'undetermined' : /potassium is below 3\.5/.test(cause) ? 'k35' : /potassium is 6\.0 or above/.test(cause) ? 'k60' : /excluded by the recorded allergies/.test(cause) ? 'allergy' : /once it is confirmed whether the patient takes/.test(cause) ? 'unconfirmed' : 'other';
        count(`cause ${kind}`); if (kind === 'other') count(`other cause: ${cause.slice(0, 110)}`);
        if (kind === 'k35' && !(p.potassium > 0 && p.potassium < 3.5)) out.push(`option ${i + 1}: says potassium is below 3.5 but it is ${p.potassium}`);
        if (kind === 'k60' && !(p.potassium >= 6.0)) out.push(`option ${i + 1}: says potassium is 6.0 or above but it is ${p.potassium}`);
        if (kind === 'allergy' && !LOOPS.every(l => [...p.allergies].some(a => a.toLowerCase().includes(l)))) out.push(`option ${i + 1}: says every loop diuretic is excluded by allergy but the allergies are ${[...p.allergies].join(', ')}`);
        if (kind === 'unconfirmed') {
            const named = /takes (.+)\.$/.exec(cause)?.[1] ?? ''; const taken = p.current_regimen.find(x => x.med.name.replace(/\s*\(.*\)/, '').toLowerCase() === named.toLowerCase());
            if (!taken || (taken.exposure?.status === 'active' && taken.exposure?.adherence === 'consistent')) out.push(`option ${i + 1}: says use of "${named}" is not confirmed but ${taken ? 'it is' : 'the patient does not take it'}`);
            if (r.regimen.some(x => x.med.name === taken?.med.name)) out.push(`option ${i + 1}: names a loop that the option keeps`);
        }
        if (kind === 'allergy' && p.potassium < 3.5 && p.potassium > 0) { /* the potassium rule comes first: reported above as its own kind */ }
    }
    return out;
};
const NO_LOOP_NOTE = /No oral loop diuretic start or increase is available today/;
R10_PREP.a5 = (_p, sd) => (sd % 2 === 0 ? congestedLoopState(sd) : coldLoopAllergyPair(sd).warm);
R10_CHECKS.a5 = (_p, o, count) => {
    const out: string[] = [];
    for (const [i, r] of o.scoredRegimens.entries()) {
        const calls = modsOfOpt(r).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Loop Diuretic');
        const has = r.warnings.some(w => NO_LOOP_NOTE.test(w)); count(calls ? 'options that start, switch to or raise a loop' : 'other options'); if (has) count(calls ? 'WITH note on a loop option' : 'note on an option with no loop step');
        if (calls && has) out.push(`option ${i + 1} starts, switches to or raises a loop diuretic but says none is available: ${summaries(r).join(' ; ').slice(0, 220)}`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A4: a change line's reason never names a different action for the same drug (a Remove line never says "reduce one dose step"); the potassium reduce alert says what is true at the lowest dose
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** The reason of a change line is the text of its last parenthesis group that is not a dose conversion. Returns [verb, reason] pairs. */
export function lineVerbAndReason(summary: string): [string, string] | null {
    const verb = /^(Remove|Stop|Reduce|Increase|Start|Switch|Swap|Titrate|Add)\b/.exec(summary)?.[1]; if (!verb) return null;
    const groups = [...summary.matchAll(/\(([^()]*)\)/g)].map(m => m[1]!).filter(g => !/^approximate total daily conversion/.test(g));
    return groups.length ? [verb, groups.join('; ')] : null;
}
/** The action words a reason may not carry beside a verb: a removal reason never says reduce/lower; a reduction reason never says withheld, stopped or removed (except "not stopped"). "do not increase" is a hold, not an action. */
export function reasonNamesOtherAction(verb: string, reason: string): string | null {
    const r = reason.replace(/do not (?:increase|raise)[^;]*/gi, '').replace(/not stopped/gi, '').replace(/no increase until stable/gi, '').replace(/recheck[^;]*/gi, '');
    if (verb === 'Remove' || verb === 'Stop') { const m = /\b(reduce one dose step|one step down|reduce the dose|halve the dose|lower the dose)\b/i.exec(r); return m ? m[1]! : null; }
    if (verb === 'Reduce') { const m = /\b(withheld|withhold|stopped|removed|stop)\b/i.exec(r); return m ? m[1]! : null; }
    if (verb === 'Increase' || verb === 'Titrate' || verb === 'Start' || verb === 'Add') { const m = /\b(withheld|withhold|reduce one dose step|halve the dose)\b/i.exec(r); return m ? m[1]! : null; }
    return null;
}
R10_PREP.a4 = (p, sd) => { const q = clonePatient(p); q.potassium = [5.5, 5.6, 5.9, 4.3, 5.7, 5.8][sd % 6] as number; if (sd % 2 === 0) for (const r of q.current_regimen) { const lowest = r.med.available_doses[0]; if (lowest && /MRA|ACEi|ARB/.test(r.med.drug_class)) { r.dose = lowest; r.selected_frequency = lowest.frequency_options[0] as never; } } return q; };
R10_CHECKS.a4 = (p, o, count) => {
    const out: string[] = [];
    for (const [i, r] of o.scoredRegimens.entries()) for (const m of modsOfOpt(r)) {
        const vr = lineVerbAndReason(m.summary); if (!vr) continue; count(`lines ${vr[0]}`);
        const bad = reasonNamesOtherAction(vr[0], vr[1]); if (bad) { out.push(`option ${i + 1}: a ${vr[0]} line whose reason says "${bad}": ${m.summary.slice(0, 200)}`); count(`TEMPLATE ${vr[0]}: ${vr[1].replace(/[0-9.]+/g, '#').slice(0, 80)}`); }
    }
    // the potassium REDUCE alert at the lowest dose
    for (const a of o.clinicalAlerts.filter(x => /^POTASSIUM REDUCE ON/.test(x) && /is stopped or replaced in every option/.test(x))) {
        const name = /^POTASSIUM REDUCE ON ([^:]+):/.exec(a)![1]!; const cur = p.current_regimen.find(x => x.med.name.toUpperCase() === name); if (!cur) continue;
        const lowestDose = cur.med.available_doses[0]?.strength === cur.dose.strength; count('reduce alerts that say stopped or replaced');
        if (lowestDose && /the potassium rule alone would reduce it one dose step/.test(a)) out.push(`alert says the rule alone would reduce ${cur.med.name} at its lowest dose: ${a.slice(0, 200)}`);
        if (!lowestDose && /at its lowest dose the potassium rule withholds it/.test(a) && cur.med.available_doses.length > 1) count('lowest-dose wording on a dose that is not the first listed (a lower eligible tier may be absent)');
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A7: no alert on a no-option screen says a medication change is not proposed or not shown (the screen carries the one sentence that says no option is shown)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const NO_CHANGE_ALERT = /no medication changes? (?:is|are) (?:shown|proposed)|medication changes? (?:is|are) not (?:shown|proposed)|no drug (?:is|are) (?:changed|proposed)/i;
R10_CHECKS.a7 = (_p, o, count) => {
    const out: string[] = []; if (o.scoredRegimens.length > 0) return out; count('no-option screens');
    for (const a of o.clinicalAlerts) if (NO_CHANGE_ALERT.test(a)) out.push(`an alert on a no-option screen says a change is not proposed or shown: "${a.slice(Math.max(0, a.search(NO_CHANGE_ALERT) - 40), a.search(NO_CHANGE_ALERT) + 90)}"`);
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A8: the POOR PERFUSION sentence carries the binder exception (the potassium sentence's words) exactly when an option raises a potassium binder
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const BINDER_EXCEPTION = 'except the potassium binder the patient already takes';
R10_PREP.a8 = (p, sd) => { const q = coldPatient(p); q.potassium = [6.0, 6.2, 6.4, 5.4][sd % 4] as number; q.sbp = Math.max(q.sbp, 96); if (sd % 5 !== 4) { withDrug(q, ['Patiromer', 'Sodium Zirconium Cyclosilicate (Lokelma)'][sd % 2] as string); } return q; };
R10_CHECKS.a8 = (_p, o, count) => {
    const out: string[] = []; const a = o.clinicalAlerts.find(x => x.startsWith('POOR PERFUSION')); if (!a || o.scoredRegimens.length === 0) return out;
    const raisesBinder = o.scoredRegimens.some(r => modsOfOpt(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'K+ Binder'));
    count(raisesBinder ? 'cold screens where an option raises a binder' : 'cold screens, no binder raise');
    const says = a.includes(BINDER_EXCEPTION);
    if (raisesBinder && !says) out.push(`an option raises a binder but the POOR PERFUSION sentence has no binder exception: "${a.slice(a.search(/No drug is started/), a.search(/No drug is started/) + 200)}"`);
    if (!raisesBinder && says) out.push('the POOR PERFUSION sentence names a binder exception but no option raises a binder');
    for (const [i, r] of o.scoredRegimens.entries()) for (const m of modsOfOpt(r)) if ((m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') && m.target && !(m.target.med.drug_class === 'Loop Diuretic' || m.target.med.drug_class === 'K+ Binder' || (m.action === 'swap' && m.mandatory && m.source?.med.drug_class === 'Beta Blocker'))) out.push(`option ${i + 1} starts or raises ${m.target.med.name} beside the poor-perfusion sentence`);
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A9: the LOOP DIURETIC OVER-TREATMENT sentence says "lowers its dose" only of an option that lowers the named drug's own dose; otherwise it says the total oral loop dose is lowered
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** A euvolemic patient on a high dose of one loop (usually with a second loop entered as well): the states the over-treatment alert is raised in, with duplicate loop entries. */
R10_PREP.a9 = (p, sd) => {
    const q = clonePatient(p); q.volume_status.current_weight_kg = q.volume_status.dry_weight_kg = 80; q.volume_status.exam_findings = new Set(); q.comorbidities.delete('Anuria'); q.max_affordable_cost = 100000;
    q.current_regimen = q.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic');
    const names = ['Furosemide', 'Torsemide', 'Bumetanide'] as const; const a = names[sd % 3]!, b = names[(sd + 1 + (sd % 2)) % 3]!;
    for (const n of sd % 4 === 0 ? [a] : [a, b]) { withDrug(q, n); const r = q.current_regimen.find(x => x.med.name === n)!; const hi = r.med.available_doses[r.med.available_doses.length - 1 - (sd % 2)]!; r.dose = hi; r.selected_frequency = (hi.frequency_options[hi.frequency_options.length - 1] ?? hi.frequency_options[0]) as never; }
    return q;
};
R10_CHECKS.a9 = (p, o, count) => {
    const out: string[] = []; const a = o.clinicalAlerts.find(x => x.startsWith('LOOP DIURETIC OVER-TREATMENT')); if (!a || o.scoredRegimens.length === 0) return out;
    const named = p.current_regimen.find(r => r.med.drug_class === 'Loop Diuretic' && a.startsWith(`LOOP DIURETIC OVER-TREATMENT: Patient appears euvolemic on a high-dose loop diuretic (${r.med.name} `)); if (!named) { count('named drug not found'); return out; }
    for (const m of a.matchAll(/option (\d+) (lowers its dose|lowers the total oral loop diuretic dose)/g)) {
        const i = Number(m[1]) - 1, r = o.scoredRegimens[i]; if (!r) { out.push(`names option ${m[1]} that is not shown`); continue; }
        const own = modsOfOpt(r).some(x => x.action === 'titrate_down' && x.source?.med.name === named.med.name);
        count(`claims: ${m[2]}`);
        if (m[2] === 'lowers its dose' && !own) out.push(`option ${m[1]} is said to lower ${named.med.name}'s dose but its dose is not lowered: ${summaries(r).join(' ; ').slice(0, 160)}`);
        if (m[2] === 'lowers the total oral loop diuretic dose' && own) out.push(`option ${m[1]} lowers ${named.med.name}'s own dose but the sentence says only the total`);
        const before = oralLoopTotal(p.current_regimen.filter(x => x.exposure?.status !== 'held' && x.exposure?.status !== 'completed')), after = oralLoopTotal(r.regimen);
        if (!(after < before - 1e-9)) out.push(`option ${m[1]} is said to lower the loop dose but the totals are ${before} and ${after}`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A10: at potassium 5.5 to 5.9 on a renin-angiotensin drug or MRA, at least one alert names the potassium value, on every path with options and without
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
R10_PREP.a10 = (p, sd) => { const q = clonePatient(p); q.potassium = [5.5, 5.6, 5.7, 5.8, 5.9][sd % 5] as number; const cls = /ACEi|ARB|ARNI|MRA|nsMRA/; if (!q.current_regimen.some(r => cls.test(r.med.drug_class))) withDrug(q, ['Lisinopril', 'Spironolactone', 'Eplerenone', 'Candesartan', 'Finerenone (Kerendia)'][sd % 5] as string); return q; };
R10_CHECKS.a10 = (p, o, count) => {
    const out: string[] = []; const k = Math.round(p.potassium * 10) / 10;
    if (!(k >= 5.5 && k < 6.0) || !p.current_regimen.some(r => /^(ACEi|ARB|ARNI|MRA|nsMRA)$/.test(r.med.drug_class))) return out;
    if (p.potassium >= 6.5) return out;
    count(o.scoredRegimens.length ? 'screens with options' : 'screens without options');
    if (!o.clinicalAlerts.some(a => /potassium/i.test(a) && a.includes(k.toFixed(1)))) out.push(`no alert names potassium ${k.toFixed(1)} on ${p.current_regimen.map(r => r.med.name).join(', ')} (${o.scoredRegimens.length} options): ${o.clinicalAlerts.map(a => a.slice(0, 40)).join(' | ')}`);
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// A11a: the volume-depletion alert counts Furoscix as a diuretic: "does not reduce or stop a diuretic" is never said of an option that removes or lowers any diuretic
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
R10_PREP.a11a = (p, sd) => { const q = clonePatient(p); q.volume_status.dry_weight_kg = 80; q.volume_status.current_weight_kg = 77 - (sd % 3) * 0.5; q.volume_status.exam_findings = new Set(); q.comorbidities.delete('Anuria'); q.max_affordable_cost = 100000;
    q.current_regimen = q.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic'); withDrug(q, ['Furosemide', 'Torsemide', 'Bumetanide'][sd % 3] as string); if (sd % 3 !== 2) withDrug(q, 'Furoscix (SC Furosemide)'); return q; };
R10_CHECKS.a11a = (p, o, count) => {
    const out: string[] = []; const a = o.clinicalAlerts.find(x => x.startsWith('VOLUME DEPLETION') && /what each option does/.test(x)); if (!a) return out;
    for (const m of a.matchAll(/option (\d+) (reduces or stops a diuretic|does not reduce or stop a diuretic)/g)) {
        const r = o.scoredRegimens[Number(m[1]) - 1]; if (!r) { out.push(`names option ${m[1]} that is not shown`); continue; }
        const acts = modsOfOpt(r).some(x => (x.action === 'titrate_down' || x.action === 'remove') && !x.duplicate_cleanup && x.source && /Diuretic/.test(x.source.med.drug_class));
        const net = oralLoopTotal(r.regimen) < oralLoopTotal(p.current_regimen.filter(x => x.exposure?.status !== 'held' && x.exposure?.status !== 'completed')) - 1e-9;
        count(`claims: ${m[2]}${p.current_regimen.some(isFuroscix) ? ' (Furoscix taken)' : ''}`);
        if (m[2].startsWith('does not') && (acts || net)) out.push(`option ${m[1]} is said not to reduce or stop a diuretic but it does: ${summaries(r).join(' ; ').slice(0, 200)}`);
        if (m[2].startsWith('reduces') && !(acts || net)) out.push(`option ${m[1]} is said to reduce or stop a diuretic but does not: ${summaries(r).join(' ; ').slice(0, 200)}`);
    }
    return out;
};

export function runEngineReadinessR10Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] ReadinessR10: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR10: ${name}: ${(e as Error).message?.slice(0, 900)}`); }
    };
    const sweepChecks = (mode: string, from: number, n: number, prep?: (p: Patient, sd: number) => Patient | null) => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = from; sd < from + n; sd++) {
            let p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set();
            const q = prep ? prep(p, sd) : p; if (!q) continue; p = q;
            let o: SimulationOutput; try { o = runEngine(clonePatient(p)); } catch (e) { faults.push(`seed ${sd}: exception ${String(e).slice(0, 100)}`); continue; }
            for (const m of R10_CHECKS[mode](p, o, (k, c = 1) => { counts[k] = (counts[k] ?? 0) + c; })) if (faults.length < 6) faults.push(`seed ${sd}: ${m}`);
        }
        return { faults, counts };
    };

    // ---------------- A1 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('A1 reviewer patient A04 (congested, Furoscix, no oral loop): every option starts furosemide 20 mg exactly as for the same patient without Furoscix', () => {
        const mkA = (furo: boolean) => mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, creatinine: 1.1, egfr: 65, dry: 80, cur: 84, findings: ['Edema (3+)', 'Crackles', 'JVP Elevated', 'Orthopnea'] }, [...(furo ? [entry('Furoscix (SC Furosemide)', 80, 'qd')] : []), entry('Carvedilol', 12.5, 'bid')]);
        const wo = runEngine(mkA(false)); const wf = runEngine(mkA(true));
        assert.ok(wo.scoredRegimens.length > 0 && wf.scoredRegimens.length > 0);
        for (const [i, r] of wf.scoredRegimens.entries()) assert.ok(modsOfOpt(r).some(m => m.action === 'add' && m.target && isOralLoop(m.target)), `option ${i + 1} starts no oral loop: ${summaries(r).join(' ; ')}`);
        assert.deepEqual(oralLoopSteps(wf).filter(Boolean).sort().filter((x, i, a) => a.indexOf(x) === i), oralLoopSteps(wo).filter(Boolean).sort().filter((x, i, a) => a.indexOf(x) === i));
    });
    check('A1 generated: 300 congested (2,000 in the sweep script) patients taking Furoscix and no oral loop: the oral loop step equals that of the same patient without Furoscix', () => {
        const { faults, counts } = sweepChecks('a1', 40200000, 300, (_p, sd) => congestedFuroscixPair(sd).withF);
        assert.deepEqual(faults, []); assert.ok((counts['baseline offers an oral loop step'] ?? 0) > 100, JSON.stringify(counts));
    });
    check('A1 neighbours B04, D08, D10, B05 (eGFR 25 and 22; allergic to torsemide and bumetanide; allergic to furosemide): the oral loop step equals that of the patient without Furoscix', () => {
        let tested = 0;
        for (const egfr of [65, 25, 22]) for (const allergies of [[], ['torsemide', 'bumetanide'], ['furosemide'], ['bumetanide'], ['torsemide']]) {
            const mkA = (furo: boolean) => { const p = mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, creatinine: 1.1, egfr, dry: 80, cur: 84, findings: ['Edema (3+)', 'Crackles', 'JVP Elevated', 'Orthopnea'] }, [...(furo ? [entry('Furoscix (SC Furosemide)', 80, 'qd')] : []), entry('Carvedilol', 12.5, 'bid')]); p.allergies = new Set(allergies); return p; };
            const wo = runEngine(mkA(false)), wf = runEngine(mkA(true));
            const a = new Set(oralLoopSteps(wf).filter(Boolean)), b = new Set(oralLoopSteps(wo).filter(Boolean)); tested++;
            assert.ok(wf.scoredRegimens.length > 0, `egfr ${egfr} allergies ${allergies}: empty screen`);
            assert.deepEqual([...a].sort(), [...b].sort(), `egfr ${egfr} allergies ${allergies}`);
        }
        assert.equal(tested, 15);
    });
    check('A2 reviewer patient M05 (cold, decompensated, allergic to the furosemide taken): the forced switch to another loop is offered as for the warm patient; generated cold patients (2,000 in the sweep script)', () => {
        const { cold, warm } = coldLoopAllergyPair(3); const oc = runEngine(clonePatient(cold)), ow = runEngine(clonePatient(warm));
        assert.ok(loopSwaps(ow).length > 0, `warm patient is offered no loop switch: ${ow.scoredRegimens.map(r => summaries(r).join(' ; ')).join(' || ')}`);
        assert.ok(loopSwaps(oc).length > 0, 'cold patient offered no forced loop switch');
        const { faults, counts } = sweepChecks('a2', 40200000, 300, (_p, sd) => coldLoopAllergyPair(sd).cold);
        assert.deepEqual(faults, []); assert.ok((counts['cold forced loop switches'] ?? 0) > 60, JSON.stringify(counts));
    });
    check('A3 every option with no loop diuretic and congestion recorded carries the warning with a true cause; no other option does (1,500 patients here, 10,000 in the sweep script, plus the reviewer seed 30110113)', () => {
        const { faults, counts } = sweepChecks('a3', 40200000, 1500, (_p, sd) => congestedLoopState(sd));
        assert.deepEqual(faults, []); assert.ok((counts['options with no loop and congestion'] ?? 0) > 100, JSON.stringify(counts));
        for (const sd of [30110113]) { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); p.allergies = new Set(['bumex']); const o = runEngine(clonePatient(p)); assert.deepEqual(R10_CHECKS.a3(p, o, () => { }), []); }
    });
    check('A5 the "no oral loop diuretic start or increase" note is never on an option that starts, switches to or raises a loop diuretic (600 patients here, 4,000 in the sweep script)', () => {
        const { faults, counts } = sweepChecks('a5', 40200000, 600, (_p, sd) => (sd % 2 === 0 ? congestedLoopState(sd) : coldLoopAllergyPair(sd).warm));
        assert.deepEqual(faults, []); assert.ok((counts['options that start, switch to or raise a loop'] ?? 0) > 60, JSON.stringify(counts));
    });
    check('A4 the reviewer line: a removal at the lowest dose at potassium 5.6 says it is withheld because it is the lowest dose; a reduction says reduce; no line names another action (patients with potassium states)', () => {
        const mkK = (dose: number, k: number) => mk({ lvef: 30, nyha_class: 'III', sbp: 124, dbp: 74, pulse: 76, potassium: k, creatinine: 1.2, egfr: 62 }, [entry('Eplerenone', dose, 'qd'), entry('Carvedilol', 12.5, 'bid')]);
        const lowest = runEngine(mkK(25, 5.6)), higher = runEngine(mkK(50, 5.6));
        const lines = (o: SimulationOutput) => o.scoredRegimens.flatMap(r => summaries(r)).filter(x => /Eplerenone/.test(x) && /^(Remove|Reduce)/.test(x));
        assert.ok(lines(lowest).some(x => /^Remove Eplerenone \(potassium 5\.6 mEq\/L is 5\.5-5\.9: this is the lowest dose, so it is withheld; do not increase the dose again until potassium is below 5\.0\)/.test(x)), lines(lowest).join(' | '));
        assert.ok(lines(higher).some(x => /^Reduce Eplerenone .*reduce one dose step; do not increase/.test(x)), lines(higher).join(' | '));
        const al = lowest.clinicalAlerts.find(a => /^POTASSIUM REDUCE ON EPLERENONE/.test(a))!; assert.ok(!/would reduce it one dose step/.test(al) && /at its lowest dose the potassium rule withholds it/.test(al), al);
        const { faults, counts } = sweepChecks('a4', 40200000, 1200, (p, sd) => R10_PREP.a4!(p, sd));
        assert.deepEqual(faults, []); assert.ok((counts['lines Remove'] ?? 0) > 200, JSON.stringify(counts));
    });
    check('A7 no alert on a no-option screen says a medication change is not proposed or shown (every no-option path, decompensated and unstable states, 150 patients each)', () => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = 40200000; sd < 40200150; sd++) for (const [pn, pf] of NO_OPTION_PATHS) {
            const q = clonePatient(gen3r(sd).p as Patient); pf(q); if (sd % 2) { q.volume_status.current_weight_kg = q.volume_status.dry_weight_kg + 4; q.volume_status.exam_findings = new Set(['Edema (2+)', 'JVP Elevated', 'Crackles']); }
            let o: SimulationOutput; try { o = runEngine(q); } catch (e) { faults.push(`${pn} ${sd}: exception`); continue; }
            for (const m of R10_CHECKS.a7!(q, o, (k, c = 1) => { counts[k] = (counts[k] ?? 0) + c; })) if (faults.length < 6) faults.push(`${pn} seed ${sd}: ${m}`);
        }
        assert.deepEqual(faults, []); assert.ok((counts['no-option screens'] ?? 0) > 400, JSON.stringify(counts));
    });
    check('A8 the POOR PERFUSION sentence names the binder exception exactly when an option raises a potassium binder (cold patients, potassium 5.4 to 6.4, with and without a binder; 400 here)', () => {
        const { faults, counts } = sweepChecks('a8', 40200000, 400, (p, sd) => R10_PREP.a8!(p, sd));
        assert.deepEqual(faults, []); assert.ok((counts['cold screens where an option raises a binder'] ?? 0) > 10, JSON.stringify(counts));
    });
    check('A9 the over-treatment sentence says "lowers its dose" only of an option that lowers the named drug, and "lowers the total oral loop diuretic dose" of an option that only removes a duplicate (forced duplicate-loop states, 800 here)', () => {
        const { faults, counts } = sweepChecks('a9', 40010100, 800, (p, sd) => R10_PREP.a9!(p, sd));
        assert.deepEqual(faults, []); assert.ok((counts['claims: lowers the total oral loop diuretic dose'] ?? 0) > 0, JSON.stringify(counts));
    });
    check('A10 at potassium 5.5 to 5.9 on a renin-angiotensin drug or MRA an alert names the value, on the full path and every no-option path (reviewer seeds 40000003, 40880022, 40880256 and 600 generated here)', () => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        const seeds = [40000003, 40880022, 40880256, ...Array.from({ length: 600 }, (_, i) => 40200000 + i)];
        for (const sd of seeds) for (const [pn, pf] of NO_OPTION_PATHS) {
            if (sd >= 40200000 && sd % 4 !== 0 && pn !== 'full') continue;
            let q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); q = R10_PREP.a10!(q, sd)!; pf(q);
            if (['scope_ticked', 'scope_unanswered', 'input_error', 'limited_review', 'sbp_le_dbp', 'sbp_blank', 'implausible_lvef', 'implausible_egfr', 'stop_k68', 'stop_sbp84', 'stop_preg'].includes(pn) && pn !== 'full') { /* stop paths still raise the alert when the value is plausible */ }
            let o: SimulationOutput; try { o = runEngine(q); } catch (e) { faults.push(`${pn} ${sd}: exception`); continue; }
            if (q.potassium < 5.5 || q.potassium >= 6.0) continue;
            for (const m of R10_CHECKS.a10!(q, o, (k, c = 1) => { counts[`${pn}: ${k}`] = (counts[`${pn}: ${k}`] ?? 0) + c; })) if (faults.length < 6) faults.push(`${pn} seed ${sd}: ${m}`);
        }
        assert.deepEqual(faults, []);
    });
    check('A11a the volume-depletion alert counts Furoscix as a diuretic (depleted patients on an oral loop with and without Furoscix, 500 here)', () => {
        const { faults, counts } = sweepChecks('a11a', 40200000, 500, (p, sd) => R10_PREP.a11a!(p, sd));
        assert.deepEqual(faults, []); assert.ok((counts['claims: reduces or stops a diuretic (Furoscix taken)'] ?? 0) > 0, JSON.stringify(counts));
    });
    check('A11c the NYHA IV alert without congestion says "no weight more than 1 kg above the dry weight", for weights 0 to 1 kg above dry', () => {
        for (const w of [80, 80.5, 81]) {
            const o = runEngine(mk({ lvef: 25, nyha_class: 'IV', sbp: 110, dbp: 70, pulse: 76, potassium: 4.4, creatinine: 1.1, egfr: 65, dry: 80, cur: w }, [entry('Carvedilol', 12.5, 'bid')]));
            const a = o.clinicalAlerts.find(x => x.startsWith('SYMPTOMS AT REST WITHOUT RECORDED CONGESTION'))!; assert.ok(a, `weight ${w}: no alert`);
            assert.ok(a.includes('no weight more than 1 kg above the dry weight') && !a.includes('no weight above the dry weight'), a.slice(0, 200));
        }
    });
    check('A11d an allergy entry that states angioedema is not "recorded without the type of reaction" on the ALLERGY CHECK of a switch to another ARB or an ARNI', () => {
        let seen = 0;
        for (const al of ['angioedema with losartan', 'lisinopril angioedema', 'losartan; angioedema']) for (let sd = 40200000; sd < 40200120; sd++) {
            const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); p.allergies = new Set([al]); if (!p.current_regimen.some(r => /ARB|ACEi/.test(r.med.drug_class))) withDrug(p, al.includes('lisinopril') ? 'Lisinopril' : 'Losartan');
            const o = runEngine(clonePatient(p)); if (!hasAngioedemaHistory(p)) continue;
            for (const r of o.scoredRegimens) for (const w of r.warnings.filter(x => x.startsWith('ALLERGY CHECK'))) { seen++; assert.ok(!/without the type of reaction/.test(w), `${al}: ${w}`); }
        }
        assert.ok(seen > 0, 'no ALLERGY CHECK was produced by any generated patient');
    });
    check('A11f the duplicate-loop alert says "all three" for three loop entries (and "both" for two); the unchanged-total sentence says "oral loop dose"', () => {
        const three = mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, creatinine: 1.1, egfr: 65, dry: 80, cur: 83, findings: ['Edema (2+)', 'JVP Elevated'] }, [entry('Furosemide', 80, 'bid'), entry('Torsemide', 40, 'qd'), entry('Bumetanide', 2, 'bid'), entry('Carvedilol', 12.5, 'bid')]);
        const o = runEngine(three); const a = o.clinicalAlerts.find(x => x.startsWith('DUPLICATE THERAPY') && /total oral loop diuretic dose/.test(x));
        assert.ok(a && /Taking all three, the total oral loop diuretic dose/.test(a) && !/Taking both/.test(a), a?.slice(0, 300));
        const two = mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, creatinine: 1.1, egfr: 65, dry: 80, cur: 83, findings: ['Edema (2+)', 'JVP Elevated'] }, [entry('Furosemide', 80, 'bid'), entry('Torsemide', 40, 'qd'), entry('Carvedilol', 12.5, 'bid')]);
        const a2 = runEngine(two).clinicalAlerts.find(x => x.startsWith('DUPLICATE THERAPY') && /total oral loop diuretic dose/.test(x)); assert.ok(!a2 || /Taking both, /.test(a2), a2?.slice(0, 200));
        for (let sd = 40200000; sd < 40200300; sd++) { const p = congestedFuroscixPair(sd).withF; withDrug(p, 'Torsemide'); const oo = runEngine(clonePatient(p)); for (const r of oo.scoredRegimens) for (const w of [...r.warnings, ...summaries(r)]) assert.ok(!/total loop dose unchanged/.test(w), w.slice(0, 200)); for (const w of oo.clinicalAlerts) assert.ok(!/total loop dose unchanged/.test(w), w.slice(0, 200)); }
    });
    check('A11g no "nsMRA" in any displayed string; the Furoscix removal reason names furosemide only and the co-removal reason starts with a capital (seed 40000150 and generated)', () => {
        const strings = (o: SimulationOutput): string[] => [...o.clinicalAlerts, ...o.excludedMedications.flatMap(e => [e.reason, ...(e.why ?? [])]), ...o.scoredRegimens.flatMap(r => [...r.warnings, ...summaries(r)]), ...(o.gdmtGaps ?? []), ...(o.eligibleAdjuncts ?? []), ...(o.missingDataNotices ?? [])];
        const bad: string[] = [];
        for (const sd of [40000150, ...Array.from({ length: 150 }, (_, i) => 40200000 + i)]) for (const blank of [false, true]) {
            const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); if (blank) { p.lvef = 55; p.potassium = 0; p.creatinine = 0; p.egfr = 0; p.nyha_class = 'II'; }
            for (const s of strings(runEngine(p))) if (/\bnsMRA\b/.test(s) && bad.length < 4) bad.push(`seed ${sd}: ${s.slice(0, 160)}`);
        }
        assert.deepEqual(bad, []);
        const p = mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, creatinine: 1.1, egfr: 65, dry: 80, cur: 83, findings: ['Edema (2+)', 'JVP Elevated'] }, [entry('Furosemide', 40, 'bid'), entry('Furoscix (SC Furosemide)', 80, 'qd'), entry('Carvedilol', 12.5, 'bid')]); p.allergies = new Set(['furosemide']);
        const o = runEngine(p); const lines = o.scoredRegimens.flatMap(r => summaries(r)).filter(x => /^Remove Furoscix/.test(x));
        assert.ok(lines.length > 0 && lines.every(x => !/loop diuretic hypersensitivity/.test(x)), lines.join(' | '));
        const co = (o: SimulationOutput) => o.scoredRegimens.flatMap(r => summaries(r)).filter(x => /used only beside an oral loop/i.test(x));
        const p2 = mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, creatinine: 1.1, egfr: 65, dry: 80, cur: 83, findings: ['Edema (2+)', 'JVP Elevated'] }, [entry('Bumetanide', 2, 'bid'), entry('Furoscix (SC Furosemide)', 80, 'qd'), entry('Carvedilol', 12.5, 'bid')]); p2.allergies = new Set(['bumex']);
        for (const x of co(runEngine(p2))) assert.ok(/\(Used only beside an oral loop/.test(x), x);
    });
    check('A11h no-allergy phrases alone ("nil known", "none known", "n/a", "nothing", "no known drug allergy", "no allergy", "no allergies", and the earlier ones) change nothing and print no note; inside a longer entry a real allergy is never lost', () => {
        const F = MEDICATION_FORMULARY; const NONE = ['nil known', 'none known', 'n/a', 'N/A', 'nothing', 'no known drug allergy', 'no allergy', 'no allergies', 'NKDA', 'nka', 'none', 'nil', 'no known drug allergies', 'No known allergies.', 'None known.'];
        for (const ph of NONE) { const r = expandAllergies(new Set([ph]), F); assert.deepEqual([r.unmatched, r.readAs, [...r.expanded]], [[], [], [ph]], ph); }
        const base = (al: string[]) => { const p = mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, creatinine: 1.1, egfr: 65 }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid')]); p.allergies = new Set(al); return p; };
        const empty = runEngine(base([])); for (const ph of NONE) assert.deepEqual(runEngine(base([ph])).clinicalAlerts, empty.clinicalAlerts, ph);
        for (const ph of NONE) for (const shape of [`${ph} except lisinopril`, `${ph}; lisinopril`, `${ph}, cough with lisinopril`, `lisinopril; ${ph}`]) {
            const o = runEngine(base([shape])); assert.ok(o.clinicalAlerts.some(a => a.startsWith('ALLERGY CONFLICT: Lisinopril ')), `${shape}: the allergy to lisinopril was lost`);
        }
    });
    check('A12 a candidate that ADDS Furoscix beside an oral loop the option stops is dropped, not turned into a plain removal: the budget-fallback option list of the 40121150 shape equals the list without that candidate (allergic to the one loop taken, congested, budget 10)', () => {
        const mkB = () => { const p = mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.3, creatinine: 1.1, egfr: 65, dry: 80, cur: 84, findings: ['Edema (2+)', 'JVP Elevated'] }, [entry('Bumetanide', 1, 'bid'), entry('Vericiguat', 5, 'qd')]); p.allergies = new Set(['bumex']); p.max_affordable_cost = 10; p.current_regimen.forEach(r => { r.exposure = undefined; }); return p; };
        const o = generateAndScoreModifications(mkB(), new Set(MEDICATION_FORMULARY.map(m => m.name)), (TIER_PRICES as Record<string, Record<string, number>>).cash); const lines = o.scoredRegimens.map(r => summaries(r).join(' // '));
        assert.ok(lines.length === 3 && lines.some(l => /Add Lisinopril.*Add Spironolactone|Add Spironolactone.*Add Lisinopril/.test(l)), lines.join(' || '));
        assert.ok(!lines.some(l => /^Remove Bumetanide[^/]*$/.test(l)), `a plain removal took the place of the two-addition option: ${lines.join(' || ')}`);
        for (const r of o.scoredRegimens) assert.ok(!r.regimen.some(isFuroscix));
    });
    return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { const r = runEngineReadinessR10Checks(); process.exit(r.failed > 0 ? 1 : 0); }
