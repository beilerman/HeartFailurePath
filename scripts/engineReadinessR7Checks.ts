/**
 * Round 7 engine rulings of the 2026-11-21 readiness pass (W1 to W14). Every check builds the patient a reviewer reported AND at least three neighbours, and asserts the corrected
 * behaviour. Run standalone (`npx tsx scripts/engineReadinessR7Checks.ts`) or through `npm run verify`.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY } from '../constants';
import { mk, runEngine, summaries } from './engineReadinessR2Checks';
import { entry } from './systemicReviewChecks';
import { gen3r } from './r3Generator';
import { clonePatient } from '../data/scenarios';
import { allText } from './engineReadinessR5Checks';
import { plainText } from '../components/plainText';
import { NO_OPTION_PATHS } from './r6Paths';
import { resolveAllergy, expandAllergies } from '../services/engine/allergy';
import { classifyPhenotype } from '../services/engine/domains';
import { baselinePlan } from '../services/engine/selection';
import { scoredCandidates } from './scoredCandidates';
import { isActiveExposure } from '../services/engine/medicationExposure';
import { SCENARIOS } from '../data/scenarios';
import { regimenDosesADay, fmtDosesADay, dedupeCurrentRegimen, isColdState, hasCongestion } from '../services/engine/regimenUtils';
import { SCOPE_STATEMENT } from '../components/appStatements';
import type { Patient, RegimenMed, SimulationOutput } from '../types';

export { mk, runEngine, summaries, entry, gen3r, clonePatient, allText, MEDICATION_FORMULARY };
export type { Patient, RegimenMed, SimulationOutput };

/** Per-patient generated checks shared by `verify` (a few hundred patients) and the sweep script (thousands): each returns the faults found for one patient and its output. */
export const R7_CHECKS: Record<string, (p: Patient, o: SimulationOutput, count: (k: string, n?: number) => void) => string[]> = {};


// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W2 / W12: every alert sentence that speaks of what the options do, or of a drug staying, is tested against every displayed option
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
type Opt = SimulationOutput['scoredRegimens'][number];
const modsOfOpt = (r: Opt) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
const actionOn = (r: Opt, name: string): string => modsOfOpt(r).find(m => m.source?.med.name === name)?.action ?? 'keep';
const startsOrRaises = (r: Opt) => modsOfOpt(r).filter(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target);
const isOralLoop = (m: { drug_class: string; facts?: { short_course_addon?: boolean } }) => m.drug_class === 'Loop Diuretic' && !m.facts?.short_course_addon;
/** Furosemide-equivalent daily total of the oral loops of a regimen (the tool's own equivalents). */
export const loopTotal = (regimen: RegimenMed[]): number => regimen.filter(r => isOralLoop(r.med)).reduce((t, r) => t + Number(r.dose.strength) * ({ qd: 1, bid: 2, tid: 3, qid: 4 } as Record<string, number>)[r.selected_frequency] * ((r.med.facts as { verified_furosemide_equivalent_per_mg?: number } | undefined)?.verified_furosemide_equivalent_per_mg ?? 1), 0);

/** One sentence of an alert that says what the options do (or that a drug stays), and the test of it against one displayed option (null when true of that option). */
interface OptionSentence { kind: string; re: RegExp; ofOption: (p: Patient, a: string, r: Opt, m: RegExpExecArray) => string | null }
const NOT_BB_START = (r: Opt) => startsOrRaises(r).filter(m => m.target!.med.drug_class === 'Beta Blocker');
export const OPTION_SENTENCES: OptionSentence[] = [
    { kind: 'beta-blocker start deferred: no beta-blocker is started in any option', re: /^BETA-BLOCKER START DEFERRED/, ofOption: (_p, _a, r) => NOT_BB_START(r).length ? `starts ${NOT_BB_START(r)[0].target!.med.name}` : null },
    { kind: 'congestion display rule: every option includes a loop step', re: /every option includes one\./, ofOption: (p, _a, r) => !hasCongestion(p) ? null : modsOfOpt(r).some(m => (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') && m.target?.med.drug_class === 'Loop Diuretic') || r.warnings.some(w => /No (oral )?loop diuretic (step is included in this option|start or increase is available today)|leaves the patient without a loop diuretic although congestion is recorded/.test(w)) /* R10 A3/A5 (rewritten): a forced switch to another loop is a loop step; the no-loop warning is a note saying why */ ? null : 'no loop step and no note saying why' },
    { kind: 'poor perfusion: no drug is started and no dose is raised in any option below except a diuretic (and a forced beta-blocker replacement)', re: /^POOR PERFUSION.*in any option below, except a diuretic/, ofOption: (_p, a, r) => startsOrRaises(r).filter(m => !(m.target!.med.drug_class === 'Loop Diuretic' && (m.action === 'add' || m.action === 'titrate_up')) && !(/replacement of a beta-blocker/.test(a) && m.action === 'swap' && m.source?.med.drug_class === 'Beta Blocker')).map(m => m.summary)[0] ?? null },
    { kind: 'potassium emergency: no option below starts or raises any drug', re: /No option below starts or raises any drug/, ofOption: (_p, a, r) => startsOrRaises(r).filter(m => !(/except the potassium binder the patient already takes/.test(a) && m.action === 'titrate_up' && m.target!.med.drug_class === 'K+ Binder'))[0]?.summary ?? null },
];

R7_CHECKS.w2 = (p, o, count) => {
    const out: string[] = [];
    const picks = o.scoredRegimens;
    if (picks.length === 0) return out;
    for (const a of o.clinicalAlerts) {
        // drug named at the start of the sentence (hold, kidney-removal) is read from the alert itself
        const hold = /^POTASSIUM HOLD ON (.+?): .*?\. (.+?) \d[^;]*? stays at the current dose/.exec(a);
        if (hold) {
            const name = p.current_regimen.map(r => r.med.name).find(n => n.toUpperCase() === hold[1]) ?? hold[2];
            count('sentence:hold stays at the current dose');
            picks.forEach((r, i) => { const act = actionOn(r, name); if (act !== 'keep') out.push(`HOLD says ${name} stays at the current dose; option ${i + 1} does "${act}"`); });
        }
        const kid = /^DRUG REMOVED FOR KIDNEY FUNCTION: (.+?) is removed in the options/.exec(a);
        if (kid) { count('sentence:kidney removal in the options'); picks.forEach((r, i) => { if (actionOn(r, kid[1]) !== 'remove' && !modsOfOpt(r).some(m => m.source?.med.name === kid[1])) out.push(`KIDNEY says ${kid[1]} is removed in the options; option ${i + 1} does not`); }); }
        const dup = /^DUPLICATE THERAPY: .*The options keep (.+?) and remove (.+?) because/.exec(a);
        if (dup) { count('sentence:duplicate options keep'); picks.forEach((r, i) => { if (actionOn(r, dup[1]) !== 'keep') out.push(`DUPLICATE says the options keep ${dup[1]}; option ${i + 1} does "${actionOn(r, dup[1])}"`); }); }
        for (const s of OPTION_SENTENCES) if (s.re.test(a)) {
            count(`sentence:${s.kind}`);
            picks.forEach((r, i) => { const m = s.re.exec(a)!; const v = s.ofOption(p, a, r, m); if (v) out.push(`${s.kind}: option ${i + 1} ${v}`); });
        }
        // kidney function (creatinine change) alerts: what they say the options do with a RAAS inhibitor or MRA already taken, and that none is started
        if (/^KIDNEY FUNCTION:/.test(a)) {
            const onBoard = p.current_regimen.filter(r => r.exposure?.status !== 'held' && r.exposure?.status !== 'completed' && ['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA'].includes(r.med.drug_class)).map(r => r.med.name);
            const startsRaasOrMra = (r: Opt) => startsOrRaises(r).filter(m => ['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA'].includes(m.target!.med.drug_class)).map(m => m.summary)[0];
            if (/The tool removes them from the plan and does not start a new one/.test(a) || /Each option says on its change lines what it does with each of them, and none starts a new one/.test(a)) { count('sentence:kidney stop band removes them'); picks.forEach((r, i) => { for (const n of onBoard) if (/The tool removes them/.test(a) && actionOn(r, n) !== 'remove') out.push(`KIDNEY says the tool removes ${n}; option ${i + 1} does "${actionOn(r, n)}"`); const st = startsRaasOrMra(r); if (st) out.push(`KIDNEY says no new RAAS inhibitor or MRA; option ${i + 1} does "${st}"`); }); }
            if (/Each is reduced one dose step/.test(a)) { count('sentence:kidney reduce band reduces each'); picks.forEach((r, i) => { for (const n of onBoard) if (!/unless an option removes or replaces it/.test(a) && !['titrate_down', 'keep'].includes(actionOn(r, n))) out.push(`KIDNEY says each is reduced one step or kept at the lowest dose; option ${i + 1} does "${actionOn(r, n)}" to ${n}`); const st = startsRaasOrMra(r); if (st) out.push(`KIDNEY reduce band: option ${i + 1} does "${st}"`); }); }
            if (/No RAAS inhibitor or MRA is started\./.test(a)) { count('sentence:kidney no RAAS or MRA started'); picks.forEach((r, i) => { const st = startsRaasOrMra(r); if (st) out.push(`KIDNEY says no RAAS inhibitor or MRA is started; option ${i + 1} does "${st}"`); }); }
        }
        // bradycardia
        const br = /^BRADYCARDIA ON (.+?): .*?\. (The plan reduces it one dose step; it is not removed\.|The dose is already the lowest, so the plan withholds it|The options replace it with another agent|The options stop it for a separate reason|The options shown keep the dose unchanged)/.exec(a);
        if (br) {
            const name = p.current_regimen.map(r => r.med.name).find(n => n.toUpperCase() === br[1]) ?? br[1]; const claim = br[2];
            count(`sentence:bradycardia ${claim.slice(0, 30)}`);
            const want = /reduces it one/.test(claim) ? ['titrate_down'] : /withholds|stop it/.test(claim) ? ['remove'] : /replace/.test(claim) ? ['swap'] : ['keep'];
            picks.forEach((r, i) => { if (!want.includes(actionOn(r, name))) out.push(`BRADYCARDIA says "${claim.slice(0, 50)}" for ${name}; option ${i + 1} does "${actionOn(r, name)}"`); });
        }
        const sw = /^(?:PREGNANCY|BRADYCARDIA)[^]*; a switch is offered\./.exec(a);
        if (sw) { count('sentence:a switch is offered'); const name = p.current_regimen.map(r => r.med.name).find(n => a.includes(n)); if (name) picks.forEach((r, i) => { if (actionOn(r, name) !== 'swap') out.push(`"a switch is offered" for ${name}; option ${i + 1} does "${actionOn(r, name)}"`); }); }
        if (/^LOOP DIURETIC OVER-TREATMENT/.test(a)) {
            const active = p.current_regimen.filter(x => x.exposure?.status !== 'held' && x.exposure?.status !== 'completed');
            // a duplicate entry removed by the clean-up is not a change to the dose the patient takes; a short-course add-on is not an oral loop
            const cat = (r: Opt) => {
                const cleaned = new Set(modsOfOpt(r).filter(m => m.duplicate_cleanup && m.action === 'remove').map(m => m.source?.med.name));
                const before = loopTotal(active.filter(x => !cleaned.has(x.med.name))), after = loopTotal(r.regimen);
                return before === 0 ? 'unchanged' : after === 0 ? 'stops' : after < before - 1e-9 ? 'lowers' : 'unchanged';
            };
            const cats = picks.map(cat);
            if (/The options shown stop the loop diuretic rather than lower it/.test(a)) { count('sentence:loop all stop'); cats.forEach((c, i) => { if (c !== 'stops') out.push(`LOOP says the options stop the loop; option ${i + 1} ${c}`); }); }
            for (const m of a.matchAll(/[Oo]ption (\d+) (stops the loop diuretic|lowers its dose|leaves its dose unchanged)/g)) {
                count('sentence:loop per option');
                const i = Number(m[1]) - 1, want = m[2].startsWith('stops') ? 'stops' : m[2].startsWith('lowers') ? 'lowers' : 'unchanged';
                if (cats[i] !== want) out.push(`LOOP says option ${i + 1} ${m[2]}; it ${cats[i]}`);
            }
            if (/The option shown stops the loop diuretic/.test(a)) { count('sentence:loop single stops'); if (cats[0] !== 'stops') out.push(`LOOP says the option shown stops the loop; it ${cats[0]}`); }
            if (/The option shown does not change the loop diuretic dose/.test(a)) { count('sentence:loop single unchanged'); if (cats[0] !== 'unchanged') out.push(`LOOP says the option shown does not change the loop dose; it ${cats[0]}`); }
            if (/No option shown changes the loop diuretic dose/.test(a)) { count('sentence:loop none changes'); cats.forEach((c, i) => { if (c !== 'unchanged') out.push(`LOOP says no option changes the loop dose; option ${i + 1} ${c}`); }); }
        }
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W11: an angioedema history behaves identically by all three entry routes
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const ANGIO_ROUTES = ['comorbidity', 'intolerance', 'allergy'] as const;
export function angioPatient(p0: Patient, route: typeof ANGIO_ROUTES[number] | 'none'): Patient {
    const p = clonePatient(p0); p.scope_conditions = new Set(); p.allergies = new Set(); p.discontinued_meds = []; p.comorbidities.delete('History of Angioedema');
    const taken = new Set(p.current_regimen.map(r => r.med.name));
    if (route === 'comorbidity') p.comorbidities.add('History of Angioedema');
    if (route === 'intolerance') { const d = ['Lisinopril', 'Enalapril', 'Ramipril', 'Captopril'].find(n => !taken.has(n)); if (d) p.discontinued_meds = [{ name: d, drug_class: 'ACEi', reason: 'Angioedema' } as never]; }
    if (route === 'allergy') p.allergies = new Set(['angioedema']);
    return p;
}
/** What may legitimately differ by route: the allergy note itself, and the line that names the discontinued drug the intolerance route enters. */
export const angioSignature = (o: SimulationOutput, drop: string): string => JSON.stringify({
    opts: o.scoredRegimens.map(r => [summaries(r), r.warnings]),
    // R8 X15e: the rehabilitation prompt is not shown beside the advanced-heart-failure alert, so it differs by that same route.
    // the advanced-heart-failure alert counts a recorded stop of a foundational drug as a marker (known item 32), which only the intolerance route enters
    alerts: o.clinicalAlerts.filter(a => !/^(ALLERGY NOTE|ADVANCED HEART FAILURE ALERT|CARDIAC REHABILITATION)/.test(a) && !a.includes(drop)),
    excluded: o.excludedMedications.map(e => e.name).filter(n => n !== drop).sort(),
});
R7_CHECKS.w11 = (p, _o, count) => {
    const out: string[] = [];
    const sigs = ANGIO_ROUTES.map(r => { const q = angioPatient(p, r); const drop = q.discontinued_meds[0]?.name ?? '\u0000'; return { r, o: runEngine(q), drop }; });
    const base = sigs.find(x => x.r === 'comorbidity')!;
    for (const x of sigs) if (x.r !== 'comorbidity') {
        count('angioedema route runs');
        // the intolerance route must be compared without the line about the entered drug in both: drop that name from both signatures
        if (angioSignature(x.o, x.drop) !== angioSignature(base.o, x.drop)) {
            const a = angioSignature(x.o, x.drop), b = angioSignature(base.o, x.drop); let i = 0; while (a[i] === b[i]) i++;
            out.push(`route ${x.r} differs from the comorbidity route near: ${a.slice(Math.max(0, i - 60), i + 120)}  VS  ${b.slice(Math.max(0, i - 60), i + 120)}`);
        }
        // the caution on every option that holds an ARB
        for (const [i, r] of x.o.scoredRegimens.entries()) if (r.regimen.some(m => m.med.drug_class === 'ARB') && !r.warnings.some(w => w.startsWith('ANGIOEDEMA CAUTION'))) out.push(`route ${x.r}: option ${i + 1} has an ARB and no angioedema caution`);
        for (const [i, r] of x.o.scoredRegimens.entries()) { const c = r.warnings.find(w => w.startsWith('ANGIOEDEMA CAUTION')); if (!c) continue; count('angioedema cautions');
            const starts = (r.modification_set?.modifications ?? []).some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.drug_class === 'ARB');
            if (/Initiate in a monitored setting/.test(c) !== starts) out.push(`route ${x.r}: option ${i + 1} ${starts ? 'starts' : 'continues'} the ARB but the caution says: ${c.slice(0, 80)}`); }
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W12a: a forced replacement by a new renin-angiotensin drug or MRA at a potassium where the tool holds new starts is said plainly on the screen
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const RAAS_NAMES = ['Lisinopril', 'Enalapril', 'Ramipril', 'Captopril', 'Losartan', 'Valsartan', 'Candesartan'];
export function forcedSwapPatient(p0: Patient, k: number, kind: 'allergy' | 'angioedema' | 'cough'): Patient | null {
    const p = clonePatient(p0); p.scope_conditions = new Set(); p.potassium = k; p.egfr = Math.max(p.egfr, 50); p.creatinine = p.creatinine > 0 ? Math.min(p.creatinine, 1.4) : p.creatinine;
    const raas = p.current_regimen.find(r => RAAS_NAMES.includes(r.med.name)); if (!raas) return null;
    if (kind === 'allergy') p.allergies = new Set([...p.allergies, raas.med.name]);
    else if (kind === 'angioedema') p.allergies = new Set([...p.allergies, 'angioedema']);
    else p.discontinued_meds = [{ name: 'Captopril', drug_class: 'ACEi', reason: 'Cough' } as never];
    return p;
}
R7_CHECKS.w12 = (p0, _o, count) => {
    const out: string[] = [];
    for (const k of [5.3, 5.4]) for (const kind of ['allergy', 'angioedema', 'cough'] as const) {
        const p = forcedSwapPatient(p0, k, kind); if (!p) return out;
        const o = runEngine(p);
        const swaps = o.scoredRegimens.flatMap(r => modsOfOpt(r).filter(m => m.action === 'swap' && m.mandatory && m.target && m.source && (['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA'].includes(m.target.med.drug_class)) && ['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA'].includes(m.source.med.drug_class)));
        if (swaps.length === 0) continue;
        count(`forced RAAS or MRA swaps (${kind})`);
        const said = o.clinicalAlerts.some(a => /new start at a potassium[^w]*where the tool otherwise holds new starts/.test(a));
        if (!said) out.push(`K ${k} ${kind}: "${swaps[0].summary.slice(0, 80)}" is a forced new start and no alert says so`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W3: eligible-adjunct lines are about the drug they name, and every "Not in an option shown" reason is the actual cause
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const NAMES_ALL = new Set(MEDICATION_FORMULARY.map(m => m.name));
/** The formulary drugs an adjunct line stands for, read from the line's own opening words (independent of the engine's grouping). */
export function adjunctDrugs(line: string): string[] {
    const head = line.toLowerCase().slice(0, 70);
    if (/^hydralazine/.test(head)) return MEDICATION_FORMULARY.filter(m => m.drug_class === 'Vasodilator').map(m => m.name);
    const first = head.split(/[ (:]/)[0];
    const exact = MEDICATION_FORMULARY.filter(m => m.name.split(/[ (]/)[0].toLowerCase() === first).map(m => m.name);
    return exact.length ? exact : MEDICATION_FORMULARY.filter(m => head.includes(m.name.split(/[ (]/)[0].toLowerCase())).map(m => m.name);
}
R7_CHECKS.w3 = (p, o, count) => {
    const out: string[] = [];
    const lines = o.eligibleAdjuncts ?? [];
    if (lines.length === 0) return out;
    const takenClasses = new Set(p.current_regimen.filter(r => r.exposure?.status !== 'held' && r.exposure?.status !== 'completed').map(r => r.med.drug_class));
    const startsAny = (names: string[]) => o.scoredRegimens.some(r => modsOfOpt(r).some(m => (m.action === 'add' || m.action === 'swap') && m.target && names.includes(m.target.med.name)));
    const raisesClass = (cls: string) => o.scoredRegimens.some(r => modsOfOpt(r).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target?.med.drug_class === cls));
    let cands: ReturnType<typeof scoredCandidates> | undefined;
    for (const line of lines) {
        count('adjunct lines');
        const drugs = adjunctDrugs(line);
        // (a) a line about a class is not shown when the patient takes a drug of it or an option starts or raises one
        if (/^(Furosemide|Torsemide|Bumetanide) \(loop diuretic\):/.test(line)) {
            if (takenClasses.has('Loop Diuretic')) out.push(`oral loop line shown to a patient who takes a loop diuretic`);
            if (raisesClass('Loop Diuretic')) out.push(`oral loop line shown beside an option that starts or raises a loop diuretic`);
        }
        if (/^Furoscix/.test(line) && startsAny(['Furoscix (SC Furosemide)'])) out.push('Furoscix line shown beside an option that starts it');
        if (drugs.length === 0 && !/^IV iron/i.test(line)) { out.push(`line names no drug of the formulary: ${line.slice(0, 60)}`); continue; }
        const m = / Not in an option shown: (.+)$/.exec(line);
        if (!m) continue;
        const reason = m[1].replace(/\.$/, '');
        // (b) a line that quotes a price or a reason names the drug it is about: it opens with a formulary drug name (a class word alone names no drug)
        if (!/^(Hydralazine|Ivabradine|Vericiguat|IV iron)/.test(line) && !MEDICATION_FORMULARY.some(x => line.startsWith(x.name.split(/[ (]/)[0]))) out.push(`a reason is quoted on a line that names no drug: ${line.slice(0, 60)}`);
        cands ??= scoredCandidates(p, NAMES_ALL);
        const starting = cands.filter(c => (c.modification_set?.modifications ?? []).some(x => (x.action === 'add' || x.action === 'swap') && x.target && drugs.includes(x.target.med.name)));
        const budget = p.max_affordable_cost;
        const cost = /^the plan that starts it costs \$([\d.]+) a month, over the stated budget of \$([\d.]+)$/.exec(reason) ?? /^the plan that starts it costs \$([\d.]+) a month; nothing fits the stated budget of \$([\d.]+), and the options shown are the least costly$/.exec(reason);
        if (cost) {
            count('reason: over budget');
            const x = Number(cost[1]), y = Number(cost[2]);
            if (!(x > y)) out.push(`over-budget reason with ${x} not above ${y}`);
            if (Math.abs(y - budget) > 0.01) out.push(`over-budget reason quotes budget ${y}, the patient's is ${budget}`);
            if (!starting.some(c => Math.abs(c.cost - x) < 0.51)) out.push(`over-budget reason quotes ${x}, no plan starting ${drugs[0]} costs that (${starting.map(c => c.cost.toFixed(2)).slice(0, 4).join(', ')})`);
            if (/nothing fits/.test(reason) && !o.scoredRegimens.every(r => r.cost > budget)) out.push('fallback sentence but a shown option fits the budget');
            if (/^the plan that starts it costs [^;]*, over/.test(reason) && o.scoredRegimens.some(r => r.warnings.some(w => w.startsWith('BUDGET EXCEEDED')))) out.push('plain over-budget reason in the over-budget fallback');
        } else if (/^no plan that starts it passed/.test(reason)) {
            count('reason: no plan');
            if (starting.length > 0) out.push(`"no plan passed the safety checks" but ${starting.length} scored plans start it`);
        } else if (/^the plan that starts it scores within/.test(reason)) {
            count('reason: within a point');
            const base = baselinePlan(cands);
            if (!base || !starting.some(c => Math.abs((c.raw_score ?? c.overall_score) - (base.raw_score ?? base.overall_score)) < 1)) out.push('"within a point of no change" but no plan that starts it is');
        } else if (/^it scores below/.test(reason)) {
            count('reason: below no change');
            const base = baselinePlan(cands);
            if (!base || !starting.every(c => (c.raw_score ?? c.overall_score) < (base.raw_score ?? base.overall_score))) out.push('"scores below no change" but a plan that starts it does not');
        } else if (/^it ranks below the three options shown$/.test(reason)) {
            count('reason: ranks below the three');
            const topShown = Math.max(...o.scoredRegimens.map(r => r.raw_score ?? r.overall_score));
            if (!starting.every(c => (c.raw_score ?? c.overall_score) <= topShown + 1e-9) || o.scoredRegimens.length < 3) out.push(`"ranks below the three options shown" with ${o.scoredRegimens.length} options or a plan above them`);
        } else if (/^the congestion display rule used its place$/.test(reason)) {
            count('reason: congestion display rule');
            if (!hasCongestion(p)) out.push('"congestion display rule used its place" for a patient with no congestion');
        } else count(`reason: other: ${reason.replace(/\d+(\.\d+)?/g, '#').slice(0, 90)}`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W4: a monitoring row never advises starting, restarting or raising a drug the same output removes or excludes for another standing reason
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
R7_CHECKS.w4 = (_p, o, count) => {
    const out: string[] = [];
    const generic = (n: string) => n.replace(/\s*\(.*\)/, '');
    const staged = (row: { test: string }) => /^Repeat potassium; start (.+) (once below 5\.0|if 5\.2 or lower)$/.exec(row.test);
    const rowsOf: Array<[string, { test: string; details: string }[], Opt | undefined]> = [['plan', o.monitoringPlan, undefined], ...o.scoredRegimens.map((r, i) => [`option ${i + 1}`, r.monitoring_plan ?? [], r] as [string, { test: string; details: string }[], Opt])];
    for (const [where, rows, opt] of rowsOf) for (const row of rows) {
        const m = staged(row);
        if (m) {
            count('staged start rows');
            const rule = /once below 5\.0/.test(row.test) ? 'E15' : 'E18';
            for (const name of m[1].split(', ')) {
                const ex = o.excludedMedications.filter(e => generic(e.name) === name);
                if (ex.length === 0 || ex.some(e => e.rule_id !== rule)) out.push(`${where}: "${row.test}" names ${name}, held by ${ex.map(e => e.rule_id).join('/') || 'no rule'}`);
            }
        }
        if (/Do not raise the dose again/.test(row.details)) {
            count('do-not-raise rows');
            if (opt && !opt.regimen.some(r => ['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA'].includes(r.med.drug_class))) out.push(`${where}: "do not raise the dose again" but the option leaves no RAAS inhibitor or MRA`);
        }
        if (/start MRA once|start RAAS inhibitor if/.test(row.test)) out.push(`${where}: a staged row names a class, not the drug held`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W5: a no-option screen's own words agree with its alerts (an alert that says to withhold or reduce a drug is never beside "no medication change is proposed")
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** R9 Z5 (replaces the R7 two-variant rule): every no-option screen carries the one sentence that is true in all cases, and no sentence on it says no medication change is proposed or that no drug can be changed. */
R7_CHECKS.w5 = (_p, o, count) => {
    const out: string[] = [];
    if (o.scoredRegimens.length > 0) return out;
    const words = [o.why_first?.stop ?? '', ...(o.decisionReadiness?.available ?? [])];
    count('no-option outputs');
    for (const w of words) if (/no medication change is proposed|no drug can be (started|changed)/i.test(w)) out.push(`old no-change wording: "${w.slice(0, 90)}"`);
    if (!words.some(w => /This tool proposes no medication option today/.test(w))) out.push('no sentence says the tool proposes no medication option');
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W6: the beta-blocker specialist-advice note says what the record can tell (NYHA class IV, or a worsening recorded within 6 months), never "under 4 weeks" as if it were known
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
R7_CHECKS.w6 = (p, o, count) => {
    const out: string[] = [];
    for (const [i, r] of o.scoredRegimens.entries()) for (const w of r.warnings) {
        if (!/Table S6\): seek specialist advice before starting/.test(w)) continue;
        count('specialist advice notes');
        const iv = /in NYHA class IV/.test(w), worse = /recent exacerbation/.test(w);
        if (iv !== (p.nyha_class === 'IV')) out.push(`option ${i + 1}: note ${iv ? 'says' : 'omits'} NYHA class IV and the patient is class ${p.nyha_class}`);
        if (worse !== (p.recent_hf_worsening_within_6mo === 'yes')) out.push(`option ${i + 1}: note ${worse ? 'says' : 'omits'} a recent worsening and the record says ${p.recent_hf_worsening_within_6mo}`);
        if (worse && !/within the last 6 months/.test(w)) out.push(`option ${i + 1}: worsening note does not say 6 months`);
        if (/current or recent \(under 4 weeks\) exacerbation/.test(w)) out.push(`option ${i + 1}: old 4-week wording`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W7: small wording faults as classes: no arrow of any kind, never the word "engine", no capitalised eGFR/units, the low-output warning, the amyloid scope sentence, the perfusion alert on a stop screen, the switch clause
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const ARROWS = /[\u2190-\u21FF\u27F0-\u27FF\u2900-\u297F\u2B00-\u2BFF]|->|<-|=>/;
/** Every string a clinician can read from one output, as displayed (the display clean-up applied). */
export const displayedStrings = (o: SimulationOutput): string[] => {
    const raw: string[] = [...o.clinicalAlerts, ...(o.gdmtGaps ?? []), ...(o.eligibleAdjuncts ?? []), ...(o.missingDataNotices ?? []), ...o.monitoringPlan.flatMap(m => [m.test, m.timing, m.details]), ...allText(o),
        ...o.excludedMedications.flatMap(e => [e.reason, ...(e.why ?? [])]),
        ...o.scoredRegimens.flatMap(r => [...r.warnings, ...r.rationale, ...(r.trade_offs ?? []).map(t => `${t.dimension}: ${t.label}`), ...(r.qualitative_projections ?? []).map(q => `${q.label}: ${q.detail}`),
            ...(r.monitoring_plan ?? []).flatMap(m => [m.test, m.timing, m.details]), ...(r.modification_set?.modifications ?? []).map(m => m.summary)])];
    return [...new Set(raw)].map(plainText);
};
R7_CHECKS.w7 = (p, o, count) => {
    const out: string[] = [];
    for (const t of displayedStrings(o)) {
        if (ARROWS.test(t)) out.push(`arrow in: ${t.slice(Math.max(0, t.search(ARROWS) - 40), t.search(ARROWS) + 40)}`);
        if (/\bengines?\b/i.test(t)) out.push(`the word engine: ${t.slice(0, 100)}`);
        if (/\bEGFR\b/.test(t) && t !== t.toUpperCase() && !/^[A-Z0-9 ,'()\/+.:-]+$/.test(t.slice(0, t.indexOf(': ') > 0 ? t.indexOf(': ') : 0))) out.push(`EGFR capitalised: ${t.slice(0, 100)}`);
        if (/\bEGFR\b/.test(t.replace(/^[A-Z0-9 ,'()\/+.-]+: /, '')) && !/[a-z]{3}/.test(t.slice(0, 40)) === false) out.push(`EGFR in a sentence: ${t.slice(0, 100)}`);
        if (/Do NOT|NOT initiate/.test(t)) out.push(`shouted instruction: ${t.slice(0, 100)}`);
    }
    count('texts scanned', displayedStrings(o).length);
    const lo = o.scoredRegimens.flatMap(r => r.warnings).find(w => w.startsWith('LOW OUTPUT STATE'));
    if (lo) { count('low output warnings'); if (!/exceptions the tool makes are a loop diuretic for recorded congestion and the replacement of a beta-blocker that must stop/.test(lo)) out.push('low output warning does not name the loop diuretic exception'); }
    const scope = o.clinicalAlerts.find(a => a.startsWith("OUTSIDE THE TOOL'S SCOPE"));
    const af = o.clinicalAlerts.find(a => a.startsWith('ATRIAL FIBRILLATION'));
    if (scope && /still shown, limited to anticoagulation and/.test(scope)) {
        count('scope AF sentences');
        const says = /when the recorded resting heart rate is above (\d+) bpm/.exec(scope);
        if (!says || Number(says[1]) !== 110) out.push('scope sentence does not state the rate threshold');
        if (!af) out.push('scope sentence says the atrial fibrillation alert is shown but it is not');
        else if (/The recorded resting heart rate is \d+ bpm/.test(af) !== (p.rhythm === 'AFib' && p.pulse > 110)) out.push('atrial fibrillation alert rate text does not follow the stated threshold');
    }
    if (o.scoredRegimens.length === 0) { const pp = o.clinicalAlerts.find(a => a.startsWith('POSSIBLE POOR PERFUSION')); if (pp && /before starting or raising/.test(pp)) out.push('stop screen: perfusion alert still speaks of starting a drug'); }
    const hold = o.clinicalAlerts.find(a => a.startsWith('POTASSIUM HOLD ON') && /sacubitril\/valsartan/.test(a));
    if (hold) { count('hold alerts naming a switch'); if (classifyPhenotype(p) === 'HFpEF') out.push('HFpEF hold alert names a switch the tool does not offer'); }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W10: allergy entries written as sentences are read as the drug or class they visibly name; a combination product is checked against its component class
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const SENTENCES: Array<(w: string) => string> = [w => `allergic to ${w}`, w => `rash from ${w}`, w => `${w} - cough`, w => `swelling of lips with ${w}`, w => `${w} (hives)`, w => `Patient reports a reaction to ${w} years ago`];
const allergyWords = (): string[] => {
    const words = new Set<string>();
    for (const m of MEDICATION_FORMULARY) {
        words.add(m.name.replace(/\s*\(.*\)/, ''));
        const brand = m.name.match(/\(([^)]*)\)/)?.[1]; if (brand && !/^SC /.test(brand)) words.add(brand);
        (m.facts?.allergy_aliases ?? []).filter(a => a.length >= 5 && !/\s/.test(a)).forEach(a => words.add(a));
    }
    ['ACE inhibitors', 'beta blocker', 'ARB', 'SGLT2 inhibitor', 'loop diuretic'].forEach(w => words.add(w));
    return [...words];
};
export const ALLERGY_WORDS = allergyWords();
R7_CHECKS.w10c = (p0, _o, count) => {
    const out: string[] = [];
    const w = ALLERGY_WORDS[(Math.abs(Math.floor(p0.lvef * 7 + p0.age * 13 + p0.sbp)) + p0.current_regimen.length) % ALLERGY_WORDS.length];
    const sentence = SENTENCES[(p0.age + p0.sbp) % SENTENCES.length](w);
    const bare = clonePatient(p0); bare.scope_conditions = new Set(); bare.allergies = new Set([w]);
    const sent = clonePatient(p0); sent.scope_conditions = new Set(); sent.allergies = new Set([sentence]);
    const ob = runEngine(bare), os = runEngine(sent);
    count('sentence allergy runs');
    // R8 X6c: swelling of the lips beside a renin-angiotensin drug is now read as angioedema (a history, not only the drug): the output differs from the bare name by design; the R8 checks test it.
    if (/swelling of lips/.test(sentence) && expandAllergies(new Set([sentence]), MEDICATION_FORMULARY).expanded.has('angioedema')) { count('swelling sentences read as angioedema'); return out; }
    const sig = (o: SimulationOutput) => JSON.stringify({ opts: o.scoredRegimens.map(r => [summaries(r), r.warnings]), ex: o.excludedMedications.map(e => [e.name, e.rule_id]).sort() });
    if (sig(ob) !== sig(os)) out.push(`"${sentence}" differs from the bare "${w}"`);
    if (os.clinicalAlerts.some(a => /does not match a drug or drug class|do not match a drug or drug class/.test(a))) out.push(`"${sentence}" is called unmatched`);
    return out;
};

R7_CHECKS.w10a = (p0, _o, count) => {
    const out: string[] = [];
    for (const arb of ['Losartan', 'Candesartan']) {
        const p = clonePatient(p0); p.scope_conditions = new Set(); p.allergies = new Set([arb]);
        const o = runEngine(p);
        for (const [i, r] of o.scoredRegimens.entries()) {
            const startsArni = (r.modification_set?.modifications ?? []).some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.drug_class === 'ARNI');
            if (!startsArni) continue;
            count(`ARNI starts with a ${arb} allergy`);
            const check = r.warnings.find(w => w.startsWith('ALLERGY CHECK') && w.includes(arb));
            if (!check || !/contains valsartan, an angiotensin receptor blocker/.test(check)) out.push(`option ${i + 1} starts the ARNI with a ${arb} allergy and carries no check that names ${arb} and valsartan`);
        }
        // typing the class excludes the ARNI outright
        const q = clonePatient(p0); q.scope_conditions = new Set(); q.allergies = new Set(['ARB']);
        const oq = runEngine(q);
        for (const [i, r] of oq.scoredRegimens.entries()) if ((r.modification_set?.modifications ?? []).some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.drug_class === 'ARNI')) out.push(`class entry "ARB": option ${i + 1} starts the ARNI`);
    }
    return out;
};
// W10b is reported, not changed: an allergy to sacubitril/valsartan followed by a captopril start (the code applies no check: the ACE inhibitor class is not the ARNI class).

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// W13: allergy notes on screens that propose nothing; a started drug judged on the regimen the option produces; the over-budget ordering sentence; "not stable" alerts and the rehabilitation prompt;
// the loop weight row; the paced-rhythm note
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const NOT_STABLE_HEADS_CHECK = ['ACUTE DECOMPENSATION', 'HYPOXIA ALERT', 'POOR PERFUSION', 'POSSIBLE POOR PERFUSION', 'LOW OUTPUT STATE', "OUTSIDE THE TOOL'S SCOPE", 'NYHA CLASS AND FINDINGS DISAGREE', 'CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN', 'VERY HIGH RISK', 'SCALE AND EXAMINATION DISAGREE', 'HEMODYNAMIC INSTABILITY', 'HYPERKALEMIC EMERGENCY'];
R7_CHECKS.w13 = (p, o, count) => {
    const out: string[] = [];
    // (e) the rehabilitation prompt is never beside an alert that says the patient is not stable
    if (o.clinicalAlerts.some(a => a.startsWith('CARDIAC REHABILITATION'))) {
        count('rehabilitation prompts');
        const bad = o.clinicalAlerts.find(a => NOT_STABLE_HEADS_CHECK.some(h => a.startsWith(`${h}:`) || a.startsWith(`${h} `)));
        if (bad) out.push(`rehabilitation prompt beside ${bad.slice(0, 40)}`);
    }
    for (const [i, r] of o.scoredRegimens.entries()) {
        const mods = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
        // (f) the weight and symptom row follows a real reduction or stop of a loop, never the clean-up of a duplicate entry alone
        const row = (r.monitoring_plan ?? []).some(m => /^Weight and symptoms after a loop diuretic reduction or stop/.test(m.test));
        const realLoopCut = mods.some(m => (m.action === 'titrate_down' || m.action === 'remove') && m.source?.med.drug_class === 'Loop Diuretic' && !m.duplicate_cleanup);
        if (row !== realLoopCut) out.push(`option ${i + 1}: loop weight row ${row ? 'present' : 'absent'} but a real loop reduction or stop is ${realLoopCut ? 'present' : 'absent'}`);
        if (row) count('loop weight rows');
        // (b) a drug an option starts is not contraindicated on the regimen the option produces when it was not on the regimen the patient arrives with
        for (const m of mods) if ((m.action === 'add' || m.action === 'swap') && m.target?.med.contraindications) {
            const med = m.target.med;
            const before = med.contraindications!(clonePatient(p));
            const after = med.contraindications!({ ...clonePatient(p), current_regimen: r.regimen.filter(x => x.med.name !== med.name) });
            if (!before && after) out.push(`option ${i + 1} starts ${med.name} which its own contraindication check refuses on the regimen the option produces`);
        }
        // (g) a paced rhythm with a projected rate below 50: the warning is accompanied by the paced note, and the note appears only then
        const slow = r.warnings.some(w => w === 'Risk of Bradycardia (HR < 50)'), pacedNote = r.warnings.some(w => /the rhythm is recorded as paced/.test(w));
        if (pacedNote !== (slow && p.rhythm === 'Paced')) out.push(`option ${i + 1}: paced note ${pacedNote ? 'present' : 'absent'} with slow-rate warning ${slow} and rhythm ${p.rhythm}`);
        if (pacedNote) count('paced notes');
    }
    // (d) the over-budget ordering sentence is true of the order shown
    for (const [label, mod] of [['by score', (q: Patient) => { q.care_priority = undefined; }], ['cost first', (q: Patient) => { q.care_priority = 'cost_first' as never; }]] as Array<[string, (q: Patient) => void]>) {
        const q = clonePatient(p); q.scope_conditions = new Set(); q.max_affordable_cost = 1; mod(q);
        const oq = runEngine(q);
        if (oq.scoredRegimens.length < 2 || !oq.scoredRegimens.every(r => r.warnings.some(w => w.startsWith('BUDGET EXCEEDED')))) continue;
        count(`fallback orderings (${label})`);
        const w = oq.scoredRegimens[0].warnings.find(x => x.startsWith('BUDGET EXCEEDED'))!;
        const tieNote = /Making no change is listed first/.test(w), ruleNote = /keeps the place the rule gave it/.test(w);
        const scores = oq.scoredRegimens.map(r => r.overall_score), costs = oq.scoredRegimens.map(r => r.cost);
        const holds = label === 'cost first' ? costs.every((c, i) => i === 0 || costs[i - 1] <= c) : scores.every((s, i) => i === 0 || scores[i - 1] >= s);
        const noChangeFirst = (oq.scoredRegimens[0].modification_set?.modifications ?? []).every(m => m.action === 'keep');
        if (!holds && !tieNote && !ruleNote) out.push(`${label}: the stated order does not hold (scores ${scores.join(',')}, costs ${costs.join(',')}) and the sentence does not say why`);
        if (tieNote && !noChangeFirst) out.push(`${label}: tie note but no change is not first`);
        if (ruleNote && !oq.scoredRegimens.some(r => r.shown_because)) out.push(`${label}: display-rule note but no option says it was added by a rule`);
        if (holds && (tieNote || ruleNote)) out.push(`${label}: an order note on an order that holds`);
        if (ruleNote) count('fallback display-rule notes');
        if (tieNote) count('fallback tie notes');
    }
    return out;
};

/** Every fault in the trade-off labels of one output (dosing burden against the doses a day and the drug count now; cost against the figures). */
export const tradeOffFaults = (p: Patient, o: SimulationOutput): string[] => {
    const out: string[] = [];
    const now = dedupeCurrentRegimen(p.current_regimen).regimen.filter(isActiveExposure);
    for (const [i, r] of o.scoredRegimens.entries()) {
        const lab = (d: string) => r.trade_offs?.find(t => t.dimension === d)?.label ?? '';
        const burden = lab('Dosing burden'), cost = lab('Cost');
        const dn = fmtDosesADay(regimenDosesADay(now)), dr = fmtDosesADay(regimenDosesADay(r.regimen));
        const rises = Number(dr) > Number(dn) || r.regimen.length > now.length;
        if (/lower|lighter|fewer|simpl/i.test(burden) && rises && !/^Fewer doses a day than now/.test(burden)) out.push(`option ${i + 1}: "${burden}" but doses ${dn} to ${dr}, drugs ${now.length} to ${r.regimen.length}`);
        if (/^Fewer doses/.test(burden) && !(Number(dr) < Number(dn))) out.push(`option ${i + 1}: "${burden}" but doses ${dn} to ${dr}`);
        if (/^More doses/.test(burden) && !(Number(dr) > Number(dn))) out.push(`option ${i + 1}: "${burden}" but doses ${dn} to ${dr}`);
        if (/^Same doses/.test(burden) && dr !== dn) out.push(`option ${i + 1}: "${burden}" but doses ${dn} to ${dr}`);
        if (!/^(Fewer|Same|More) doses a day/.test(burden)) out.push(`option ${i + 1}: dosing label is not a comparison: "${burden}"`);
        if (/^Within budget/.test(cost) && Number.isFinite(r.cost) && p.max_affordable_cost > 0 && r.cost > p.max_affordable_cost) out.push(`option ${i + 1}: "${cost}" but costs ${r.cost} against ${p.max_affordable_cost}`);
        if (/^Over budget/.test(cost) && Number.isFinite(r.cost) && p.max_affordable_cost > 0 && r.cost <= p.max_affordable_cost) out.push(`option ${i + 1}: "${cost}" but costs ${r.cost} against ${p.max_affordable_cost}`);
        if (/Well within budget|Near the budget limit/.test(cost)) out.push(`option ${i + 1}: old band label "${cost}"`);
    }
    return out;
};

R7_CHECKS.w1 = (p, o, count) => { count('options', o.scoredRegimens.length); return tradeOffFaults(p, o); };

export function runEngineReadinessR7Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] ReadinessR7: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR7: ${name}: ${(e as Error).message?.slice(0, 900)}`); }
    };

    // ---------------- W14: the unstable-state statement matches what the options do -------------------------------------------------------------------------------------------
    check('W14 the scope statement says what is true: in a low-output or cold state only a loop diuretic for congestion and a forced beta-blocker replacement are started or raised; at potassium 6.0 or above nothing is, except a binder already taken', () => {
        assert.ok(!/in an unstable state \(poor perfusion, or potassium 6\.0 or higher\) no option starts a drug or raises a dose/.test(SCOPE_STATEMENT), 'the old sentence is still there');
        assert.ok(/low-output or cold state/.test(SCOPE_STATEMENT) && /loop diuretic for recorded congestion/.test(SCOPE_STATEMENT) && /potassium of 6\.0 or above no option starts a drug or raises a dose/.test(SCOPE_STATEMENT));
        let cold = 0, k6 = 0, loopSeen = 0;
        for (let sd = 10100000; sd < 10100400; sd++) for (const state of ['cold', 'k60'] as const) {
            const p = clonePatient(gen3r(sd, [state]).p as Patient); p.scope_conditions = new Set();
            const isCold = isColdState(p), emergency = p.potassium >= 6.0;
            if (!isCold && !emergency) continue;
            const o = runEngine(p);
            if (isCold) cold++; if (emergency) k6++;
            for (const r of o.scoredRegimens) for (const m of r.modification_set?.modifications ?? []) {
                if (!['add', 'titrate_up', 'swap'].includes(m.action)) continue;
                const cls = m.target?.med.drug_class;
                if (emergency) { assert.ok(cls === 'K+ Binder' && m.action === 'titrate_up', `seed ${sd}: at potassium ${p.potassium} an option does "${m.summary}"`); continue; }
                const loopForCongestion = cls === 'Loop Diuretic' && (m.action === 'add' || m.action === 'titrate_up');
                const forcedBeta = m.action === 'swap' && m.source?.med.drug_class === 'Beta Blocker' && !!m.mandatory;
                if (loopForCongestion) loopSeen++;
                assert.ok(loopForCongestion || forcedBeta, `seed ${sd}: in the cold state an option does "${m.summary}"`);
            }
        }
        assert.ok(cold >= 20 && k6 >= 20, `${cold} cold and ${k6} potassium patients seen`);
    });

    // ---------------- W1: trade-off labels are true of the option beside which they are printed -----------------------------------------------------------------------------------
    // r7-clinical B1: case 45 option "6 doses a day from 4 drugs (now 4 doses a day from 3 drugs)" carried "Dosing burden: Lower dosing burden". Cases 44, 10, 34 likewise.
    check('W1 trade-off labels: the dosing-burden label compares with the regimen now (fewer, the same, more doses a day) and never says lower or lighter beside an option that raises the doses or the drug count; the cost label states the figures and is true; 344 reference scenarios', () => {
        const bad: string[] = []; let compared = 0, more = 0, fewer = 0, withinOver = 0;
        for (const s of SCENARIOS) {
            const p = clonePatient(s.patient); const o = runEngine(clonePatient(p));
            const f = tradeOffFaults(p, o); if (f.length && bad.length < 5) bad.push(`${s.title}: ${f[0]}`);
            for (const r of o.scoredRegimens) { compared++; const l = r.trade_offs?.find(t => t.dimension === 'Dosing burden')?.label ?? ''; if (/^More/.test(l)) more++; if (/^Fewer/.test(l)) fewer++; if (/^(Within|Over) budget/.test(r.trade_offs?.find(t => t.dimension === 'Cost')?.label ?? '')) withinOver++; }
        }
        assert.deepEqual(bad, []);
        assert.ok(compared > 300 && more > 20 && fewer > 5 && withinOver > 100, `${compared} options, ${more} more, ${fewer} fewer, ${withinOver} cost labels`);
    });
    check('W1 trade-off labels over 400 random patients (seeds from 10,100,000); case-45 style patient (tolerance 2 of 10, four drugs on board)', () => {
        const bad: string[] = [];
        for (let sd = 10100000; sd < 10100400; sd++) {
            const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); const o = runEngine(clonePatient(p));
            const f = tradeOffFaults(p, o); if (f.length && bad.length < 5) bad.push(`seed ${sd}: ${f[0]}`);
        }
        assert.deepEqual(bad, []);
        const p = mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, complexity_tolerance: 2 } as Partial<Patient>, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid'), entry('Spironolactone', 25)]);
        const o = runEngine(clonePatient(p));
        assert.deepEqual(tradeOffFaults(p, o), []);
        assert.ok(o.scoredRegimens.some(r => /^More doses a day than now/.test(r.trade_offs?.find(t => t.dimension === 'Dosing burden')?.label ?? '')), 'no option with more doses a day in the case-45 style patient');
    });


    /** Runs a per-patient generated check over `n` generated patients from `first`; returns the faults and the counts. */
    const sweep = (mode: string, n: number, first = 10100000, patientOf?: (sd: number) => Patient) => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = first; sd < first + n; sd++) {
            const p = patientOf ? patientOf(sd) : (() => { const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); return q; })();
            const o = runEngine(clonePatient(p));
            for (const m of R7_CHECKS[mode](p, o, (k, c = 1) => { counts[k] = (counts[k] ?? 0) + c; })) if (faults.length < 5) faults.push(`seed ${sd}: ${m}`);
        }
        return { faults, counts };
    };
    const base = (extra: Parameters<typeof mk>[0] = {}, regimen: RegimenMed[] = []) => mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, ...extra }, regimen);

    // ---------------- W2 / W12b / W12c: alerts that speak of the options are true of every displayed option ----------------------------------------------------------------------
    check('W2 reviewer patient (EF 30, NYHA III, at dry weight, ARNI 97/103, carvedilol, spironolactone, dapagliflozin, bumetanide 1 mg and furosemide 20 mg): the duplicate-therapy alert does not say what "the options" do or that the total loop dose is unchanged, and every option-speaking sentence is true', () => {
        const p = base({ nyha_class: 'III', findings: [], dry: 80, cur: 80 }, [entry('Sacubitril/Valsartan (Entresto)', '97/103', 'bid'), entry('Carvedilol', 25, 'bid'), entry('Spironolactone', 50), entry('Dapagliflozin', 10), entry('Bumetanide', 1), entry('Furosemide', 20)]);
        const o = runEngine(clonePatient(p));
        const dup = o.clinicalAlerts.find(a => a.startsWith('DUPLICATE THERAPY'));
        assert.ok(dup, 'no duplicate alert'); assert.ok(!/The options keep|total loop dose is not lowered/.test(dup!), dup);
        assert.ok(!allText(o).some(t => /total loop dose is not lowered/.test(t)), 'the clause is still in an option line');
        assert.deepEqual(R7_CHECKS.w2(p, o, () => { }), []);
    });
    check('W2 seeds 10000003, 11600031, 11600091, 11600186 (duplicate where the "kept" drug is removed for another reason) and 10500013, 10500155, 10500623, 10500508 (loop alert): no sentence about the options is false', () => {
        for (const sd of [10000003, 11600031, 11600091, 11600186, 10500013, 10500155, 10500623, 10500508]) {
            const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); const o = runEngine(clonePatient(p));
            assert.deepEqual(R7_CHECKS.w2(p, o, () => { }), [], `seed ${sd}`);
        }
    });
    check('W2 generated: 400 random patients (first seed 10,100,000): every alert sentence about what the options do, or that a drug stays, is true of every displayed option', () => {
        const r = sweep('w2', 400); assert.deepEqual(r.faults, []); assert.ok((r.counts['sentence:hold stays at the current dose'] ?? 0) + (r.counts['sentence:beta-blocker start deferred: no beta-blocker is started in any option'] ?? 0) > 10, JSON.stringify(r.counts));
    });

    // ---------------- W3: eligible adjunct lines ---------------------------------------------------------------------------------------------------------------------------------------
    check('W3 seed 10009034 and neighbours (an oral loop taken, an option raises it, a budget the subcutaneous drug exceeds): no class line "Loop diuretic" is shown, the Furoscix line names Furoscix, and its reason is the plan\'s cost', () => {
        for (const sd of [10009034, 10000041, 10000328, 10000410, 10000656]) {
            const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); const o = runEngine(clonePatient(p));
            assert.deepEqual(R7_CHECKS.w3(p, o, () => { }), [], `seed ${sd}`);
            assert.ok(!(o.eligibleAdjuncts ?? []).some(a => /^Loop diuretic:/.test(a)), `seed ${sd}: a class line is shown`);
        }
        const hit = [...Array(400).keys()].map(i => 10100000 + i).map(sd => { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); return runEngine(p); }).filter(o => (o.eligibleAdjuncts ?? []).some(a => /^Furoscix/.test(a)));
        assert.ok(hit.length >= 3, `${hit.length} outputs with a Furoscix line`);
        assert.ok(hit.every(o => (o.eligibleAdjuncts ?? []).filter(a => /^Furoscix/.test(a)).every(a => !/^Loop diuretic/.test(a) && /Not in an option shown: /.test(a))));
    });
    check('W3 generated: 500 random patients: every adjunct line names its drug, a line about a class is absent when the patient takes the class or an option starts or raises it, and every "Not in an option shown" reason is the actual cause (over budget: that plan\'s cost against the patient\'s budget; no plan: none scored; within a point or below no change: the baseline comparison; below the three: no better than a shown option)', () => {
        const r = sweep('w3', 500); assert.deepEqual(r.faults, []); assert.ok((r.counts['adjunct lines'] ?? 0) > 50, JSON.stringify(r.counts));
    });

    // ---------------- W4 ---------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('W4 reviewer patient (EF 70, potassium 5.5, eGFR 28, spironolactone 25 mg: the kidney limit removes it): no monitoring row says to raise the dose again or names a drug held for another reason; 600 random patients', () => {
        const p = base({ lvef: 70, potassium: 5.5, egfr: 28, creatinine: 1.9 }, [entry('Spironolactone', 25)]);
        const o = runEngine(clonePatient(p));
        assert.deepEqual(R7_CHECKS.w4(p, o, () => { }), []);
        for (const r of o.scoredRegimens) if (!r.regimen.some(x => ['MRA', 'nsMRA'].includes(x.med.drug_class))) assert.ok(!(r.monitoring_plan ?? []).some(m => /Do not raise the dose again/.test(m.details)), 'do-not-raise row beside a stopped MRA');
        const r = sweep('w4', 600); assert.deepEqual(r.faults, []); assert.ok((r.counts['staged start rows'] ?? 0) > 5 && (r.counts['do-not-raise rows'] ?? 0) > 5, JSON.stringify(r.counts));
    });

    // ---------------- W5 ---------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('W5 (rewritten in round 9, Z5) every no-option path carries the one sentence and never says no medication change is proposed; 13 paths on 100 patients', () => {
        const faults: string[] = []; let withhold = 0;
        for (let sd = 10100000; sd < 10100100; sd++) for (const [pn, f] of NO_OPTION_PATHS) {
            const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); f(q);
            const o = runEngine(q);
            if (o.scoredRegimens.length > 0) continue;
            const c: Record<string, number> = {}; const v = R7_CHECKS.w5(q, o, (k, n = 1) => { c[k] = (c[k] ?? 0) + n; }); withhold += c['no-option outputs'] ?? 0;
            for (const m of v) if (faults.length < 5) faults.push(`seed ${sd} ${pn}: ${m}`);
        }
        assert.deepEqual(faults, []); assert.ok(withhold > 100, `${withhold} no-option outputs`);
    });

    // ---------------- W6 ---------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('W6 the specialist-advice note names NYHA class IV or a worsening recorded within 6 months (never "under 4 weeks" as if known): hand cases and 600 random patients', () => {
        const worse = base({ recent_hf_worsening_within_6mo: 'yes' as never }, [entry('Lisinopril', 10)]);
        const ow = runEngine(clonePatient(worse));
        const note = ow.scoredRegimens.flatMap(r => r.warnings).find(w => /Table S6\): seek specialist advice before starting/.test(w));
        assert.ok(note && /last 6 months/.test(note) && /4 weeks/.test(note) && !/current or recent \(under 4 weeks\) exacerbation/.test(note), note);
        assert.deepEqual(R7_CHECKS.w6(worse, ow, () => { }), []);
        const r = sweep('w6', 600); assert.deepEqual(r.faults, []); assert.ok((r.counts['specialist advice notes'] ?? 0) > 10, JSON.stringify(r.counts));
    });

    // ---------------- W7 ---------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('W7 wording classes over 300 random patients: no arrow of any kind, no "engine", no capitalised eGFR, the low-output warning names its exception, the amyloidosis sentence states the rate threshold, the perfusion alert on a stop screen speaks of no start, the hold alert names a switch only where the tool offers one', () => {
        const r = sweep('w7', 300); assert.deepEqual(r.faults, []); assert.ok((r.counts['texts scanned'] ?? 0) > 10000, JSON.stringify(r.counts));
    });
    check('W7 "eGFR not entered" keeps its case and a systolic 88 stop screen drops "before starting or raising"; amyloidosis with atrial fibrillation states the rate threshold', () => {
        const noEgfr = base({ egfr: 0, creatinine: 0 }, [entry('Lisinopril', 10)]);
        const o = runEngine(clonePatient(noEgfr));
        assert.ok(!allText(o).some(t => /\bEGFR not entered/.test(t)), 'EGFR capitalised');
        const stop = base({ sbp: 88, dbp: 50, findings: ['Cool Extremities'], lvef: 28 }, [entry('Lisinopril', 10)]);
        const os = runEngine(clonePatient(stop));
        assert.ok(!os.clinicalAlerts.some(a => /^POSSIBLE POOR PERFUSION/.test(a) && /before starting or raising/.test(a)), 'stop screen still speaks of starting');
        const am = base({ rhythm: 'AFib' as never, pulse: 70 }, [entry('Lisinopril', 10)]); am.scope_conditions = new Set(['Cardiac amyloidosis']);
        assert.deepEqual(R7_CHECKS.w7(am, runEngine(clonePatient(am)), () => { }), []);
    });

    // ---------------- W10 --------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('W10a an allergy to an ARB (losartan, candesartan) of unstated type: every option that starts sacubitril/valsartan carries an ALLERGY CHECK naming the ARB and saying it contains valsartan; "ARB" excludes it; 500 random patients', () => {
        const r = sweep('w10a', 500); assert.deepEqual(r.faults, []); assert.ok((r.counts['ARNI starts with a Losartan allergy'] ?? 0) > 10, JSON.stringify(r.counts));
    });
    check('W10c an allergy written as a sentence ("allergic to lisinopril", "rash from Lisinopril", "ACE inhibitors - cough", "swelling of lips with Entresto") is read as the drug or class it names, gives the same output as the bare name, and is not called unmatched; 500 random patients', () => {
        const r = sweep('w10c', 500); assert.deepEqual(r.faults, []);
        const f = MEDICATION_FORMULARY;
        assert.deepEqual([...resolveAllergy('allergic to lisinopril', f)], ['Lisinopril']); assert.deepEqual(resolveAllergy('swelling of lips with Entresto', f), ['Sacubitril/Valsartan (Entresto)']);
        assert.equal(resolveAllergy('ACE inhibitors - cough', f).length, 4); assert.deepEqual(resolveAllergy('low sodium diet', f), []); assert.deepEqual(resolveAllergy('xyzzy', f), []);
    });

    // ---------------- W11 --------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('W11 reviewer seed 10100002 and 300 random patients: an angioedema history entered as the comorbidity, a recorded intolerance or the word in the allergy box gives identical options, warnings and alerts (apart from the allergy note), the ARB caution on every option that holds an ARB, and "monitored setting" only on an option that starts the ARB', () => {
        const p = clonePatient(gen3r(10100002).p as Patient); const o = runEngine(clonePatient(p));
        assert.deepEqual(R7_CHECKS.w11(p, o, () => { }), []);
        const r = sweep('w11', 300); assert.deepEqual(r.faults, []); assert.ok((r.counts['angioedema cautions'] ?? 0) > 30, JSON.stringify(r.counts));
    });

    // ---------------- W12a -------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('W12a reviewer seeds 12400077, 12400122, 12400933, 10300620, 10300657 (a hold alert while every option removes or swaps the drug) and a forced replacement at potassium 5.3 and 5.4: no alert says a drug stays when an option removes it; the forced new start at a high potassium is said plainly; 300 random patients', () => {
        for (const sd of [12400077, 12400122, 12400933, 10300620, 10300657]) { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); const o = runEngine(clonePatient(p)); assert.deepEqual(R7_CHECKS.w2(p, o, () => { }), [], `seed ${sd}`); }
        const enal = base({ potassium: 5.3 }, [entry('Enalapril', 10, 'bid'), entry('Carvedilol', 12.5, 'bid')]);
        for (const route of ['comorbidity', 'allergy', 'intolerance'] as const) {
            const q = angioPatient(enal, route); const o = runEngine(clonePatient(q));
            assert.ok(o.clinicalAlerts.some(a => /new start at a potassium[^w]*where the tool otherwise holds new starts/.test(a)), `${route}: no plain statement`);
            assert.deepEqual(R7_CHECKS.w2(q, o, () => { }), [], route);
        }
        const r = sweep('w12', 300); assert.deepEqual(r.faults, []); assert.ok((r.counts['forced RAAS or MRA swaps (allergy)'] ?? 0) > 30, JSON.stringify(r.counts));
    });

    // ---------------- W13 --------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('W13a a typed allergy gets its note on input-error, limited-review, implausible-value and stop screens, worded for a screen that proposes nothing (no "offered", no "option"); 13 paths on 40 patients', () => {
        let seen = 0; const faults: string[] = [];
        for (let sd = 10100000; sd < 10100040; sd++) for (const [pn, f] of NO_OPTION_PATHS) {
            const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); q.allergies = new Set(['angioedema', 'xyzzy']); f(q);
            const o = runEngine(q);
            if (o.scoredRegimens.length > 0) continue;
            seen++;
            if (pn === 'scope_ticked') continue;
            const notes = o.clinicalAlerts.filter(a => a.startsWith('ALLERGY NOTE'));
            if (!notes.some(a => /"angioedema"/.test(a))) faults.push(`seed ${sd} ${pn}: no note for the angioedema entry`);
            if (!notes.some(a => /xyzzy/.test(a))) faults.push(`seed ${sd} ${pn}: no note for the unmatched entry`);
            if (notes.some(a => /\b(options?|offered|plans?)\b/i.test(a))) faults.push(`seed ${sd} ${pn}: option wording in ${notes.find(a => /\b(options?|offered|plans?)\b/i.test(a))!.slice(0, 80)}`);
        }
        assert.ok(seen >= 100, `${seen} no-option outputs`); assert.deepEqual(faults.slice(0, 5), []);
    });
    check('W13b seed 10002263 (finerenone beside a RAAS start at an unknown EF history): no option starts a drug that its own contraindication check refuses on the regimen the option produces', () => {
        const p = clonePatient(gen3r(10002263).p as Patient); p.scope_conditions = new Set(); const o = runEngine(clonePatient(p));
        assert.deepEqual(R7_CHECKS.w13(p, o, () => { }), []);
        assert.ok(!o.scoredRegimens.some(r => r.regimen.some(x => x.med.drug_class === 'nsMRA') && r.regimen.some(x => ['ARNI', 'ACEi', 'ARB'].includes(x.med.drug_class)) && !p.current_regimen.some(x => x.med.drug_class === 'nsMRA')), 'finerenone is still started beside a new RAAS inhibitor');
    });
    check('W13c to W13g over 500 random patients: the over-budget ordering sentence is true of the order shown, the rehabilitation prompt is not beside an alert that says the patient is not stable, the loop weight row follows a real reduction or stop, the paced rhythm note, and the contraindication check on the produced regimen', () => {
        const r = sweep('w13', 500); assert.deepEqual(r.faults, []); assert.ok((r.counts['fallback orderings (by score)'] ?? 0) > 50 && (r.counts['loop weight rows'] ?? 0) > 20, JSON.stringify(r.counts));
    });

    return { passed, failed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const r = runEngineReadinessR7Checks();
    console.log(`ReadinessR7: ${r.passed} passed, ${r.failed} failed`);
    process.exit(r.failed > 0 ? 1 : 0);
}
