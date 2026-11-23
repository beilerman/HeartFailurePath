/**
 * Round 9 engine rulings of the 2026-11-22 readiness pass (Z1 to Z12). Every check builds the patient a reviewer reported AND at least three neighbours, and asserts the corrected
 * behaviour. Run standalone (`npx tsx scripts/engineReadinessR9Checks.ts`) or through `npm run verify`. Per-patient generated checks are `R9_CHECKS`, also run in chunks by
 * `scripts/engineReadinessR9Sweep.ts <mode> <firstSeed> <count>`.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY, RELEVANT_COMORBIDITIES, RELEVANT_EXTERNAL_MEDICATIONS } from '../constants';
import { mk, runEngine, summaries } from './engineReadinessR2Checks';
import { entry } from './systemicReviewChecks';
import { gen3r } from './r3Generator';
import { clonePatient } from '../data/scenarios';
import { NO_OPTION_PATHS } from './r6Paths';
import { plainText } from '../components/plainText';
import { oralLoopFe } from '../services/engine/regimenUtils';
import { structuralProblems, shortLineReason } from '../services/engine/candidates';
import type { Patient, RegimenMed, SimulationOutput } from '../types';

export { mk, runEngine, summaries, entry, gen3r, clonePatient, MEDICATION_FORMULARY, NO_OPTION_PATHS };
export type { Patient, RegimenMed, SimulationOutput };

/** Per-patient generated checks shared by `verify` (a few hundred patients) and the sweep script (thousands): each returns the faults found for one patient and its output. */
export const R9_CHECKS: Record<string, (p: Patient, o: SimulationOutput, count: (k: string, n?: number) => void) => string[]> = {};
/** How a sweep mode prepares the generated patient (default: as generated). Returning null skips the seed. */
export const R9_PREP: Record<string, (p: Patient, sd: number) => Patient | null> = {};

type Opt = SimulationOutput['scoredRegimens'][number];
export const modsOfOpt = (r: Opt) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
const generic = (n: string) => n.replace(/\s*\(.*\)/, '');

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Z11: a drug the patient takes and must not take (allergy, intolerance, contraindication) never empties the screen, with or without the drugs that depend on it or pair with it
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const med = (name: string) => MEDICATION_FORMULARY.find(m => m.name === name)!;
const first = <T,>(a: T[]): T => a[0] as T;
const ent = (name: string): RegimenMed => { const m = med(name); const dose = first(m.available_doses); return { med: m, dose, selected_frequency: first(dose.frequency_options), exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } } as RegimenMed; };
/** Adds a formulary drug at its first dose (active, reviewed) unless the patient already takes it. */
export function withDrug(p: Patient, name: string): void {
    if (!p.current_regimen.some(r => r.med.name === name)) p.current_regimen.push(ent(name));
    p.current_regimen.forEach(r => { if (r.med.name === name) r.exposure = { ...(r.exposure ?? {}), status: 'active', adherence: 'consistent', dose_interval_reviewed: true } as RegimenMed['exposure']; });
}
/**
 * Dependency rules read from the code itself (`structuralProblems`, the structural rules of `candidates.ts`): P depends on D when P alone is structurally unsound and P with D is sound
 * (Furoscix needs an oral loop diuretic); D and P pair when the two together are unsound (two agents of one class). No hand list.
 */
export function dependencyPartners(d: string): { dependents: string[]; needs: string[]; pairs: string[] } {
    const dependents: string[] = [], needs: string[] = [], pairs: string[] = [];
    for (const m of MEDICATION_FORMULARY) {
        if (m.name === d) continue;
        if (structuralProblems([ent(m.name)]).length > 0 && structuralProblems([ent(m.name), ent(d)]).length === 0) dependents.push(m.name);
        if (structuralProblems([ent(d)]).length > 0 && structuralProblems([ent(d), ent(m.name)]).length === 0) needs.push(m.name);
        if (structuralProblems([ent(d)]).length === 0 && structuralProblems([ent(m.name)]).length === 0 && structuralProblems([ent(d), ent(m.name)]).length > 0) pairs.push(m.name);
    }
    return { dependents, needs, pairs };
}
type Entry = { kind: 'allergy' | 'intolerance' | 'contraindication'; drug: string; apply: (p: Patient) => void; remove: (p: Patient) => void; forced: boolean; label: string };
/** Intolerance records (discontinued_meds rows) that force the drug out of an existing regimen, and two that govern new starts only (documented: a tolerated drug is kept). */
const INTOLERANCE_ROWS: Array<[string, { name: string; drug_class: string; reason: string }, boolean]> = [
    ['Lisinopril', { name: 'Ramipril', drug_class: 'ACEi', reason: 'Cough' }, true], ['Enalapril', { name: 'Ramipril', drug_class: 'ACEi', reason: 'Cough' }, true], ['Captopril', { name: 'Ramipril', drug_class: 'ACEi', reason: 'Cough' }, true],
    ['Ramipril', { name: 'Lisinopril', drug_class: 'ACEi', reason: 'Cough' }, true], ['Lisinopril', { name: 'Lisinopril', drug_class: 'ACEi', reason: 'Angioedema' }, true],
    ['Sacubitril/Valsartan (Entresto)', { name: 'Lisinopril', drug_class: 'ACEi', reason: 'Angioedema' }, true], ['Spironolactone', { name: 'Eplerenone', drug_class: 'MRA', reason: 'Hyperkalemia' }, true],
    ['Eplerenone', { name: 'Spironolactone', drug_class: 'MRA', reason: 'Hyperkalemia' }, true], ['Finerenone (Kerendia)', { name: 'Spironolactone', drug_class: 'MRA', reason: 'Hyperkalemia' }, true],
    ['Spironolactone', { name: 'Spironolactone', drug_class: 'MRA', reason: 'Gynecomastia' }, true], ['Carvedilol', { name: 'Metoprolol Succinate', drug_class: 'Beta Blocker', reason: 'Bronchospasm' }, false],
    ['Carvedilol', { name: 'Carvedilol', drug_class: 'Beta Blocker', reason: 'Bronchospasm' }, false], ['Semaglutide (Wegovy)', { name: 'Tirzepatide (Zepbound)', drug_class: 'GLP-1/GIP RA', reason: 'GI intolerance' }, false],
];
const neutralPatient = (): Patient => { const p = mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: 4.3, creatinine: 1.0, egfr: 70, oxygen_saturation: 97 }, [entry('Carvedilol', 12.5, 'bid')]); return p; };
let ENTRIES: Entry[] | undefined;
/** Every (drug, trigger) pair the formulary can produce: an allergy by name, each intolerance row, and every comorbidity or outside drug that makes the drug's own contraindication true (found by asking the drug). */
export function z11Entries(): Entry[] {
    if (ENTRIES) return ENTRIES;
    const out: Entry[] = [];
    for (const m of MEDICATION_FORMULARY) {
        out.push({ kind: 'allergy', drug: m.name, forced: true, label: `allergy ${generic(m.name).toLowerCase()}`, apply: p => { p.allergies = new Set([...(p.allergies ?? []), generic(m.name).toLowerCase()]); }, remove: p => { p.allergies = new Set([...(p.allergies ?? [])].filter(a => a !== generic(m.name).toLowerCase())); } });
        const triggers: Array<{ kind: 'com' | 'ext'; val: string }> = [...RELEVANT_COMORBIDITIES.map(v => ({ kind: 'com' as const, val: v })), ...RELEVANT_EXTERNAL_MEDICATIONS.map(v => ({ kind: 'ext' as const, val: v }))];
        for (const t of triggers) {
            const p = neutralPatient(); withDrug(p, m.name); let before = false, after = false;
            try { before = !!m.contraindications?.(p); const q = clonePatient(p); (t.kind === 'com' ? q.comorbidities : q.external_medications!).add(t.val); after = !!m.contraindications?.(q); } catch { /* a check that needs data the neutral patient lacks */ }
            if (!before && after) out.push({ kind: 'contraindication', drug: m.name, forced: true, label: `${t.kind === 'com' ? 'comorbidity' : 'outside drug'} ${t.val}`, apply: p => (t.kind === 'com' ? p.comorbidities : p.external_medications!).add(t.val), remove: p => (t.kind === 'com' ? p.comorbidities : p.external_medications!).delete(t.val) });
        }
    }
    for (const [d, rec, forced] of INTOLERANCE_ROWS) out.push({ kind: 'intolerance', drug: d, forced, label: `intolerance ${rec.reason} (${rec.name})`, apply: p => { p.discontinued_meds = [...p.discontinued_meds, rec as never]; }, remove: p => { p.discontinued_meds = p.discontinued_meds.filter(x => x !== (rec as never) && !(x.name === rec.name && x.reason === rec.reason)); } });
    ENTRIES = out; return out;
}
/** The case for one seed: the entry, the dependent / needed / paired drug (rotating, with none among them), on a random background patient. */
export function z11Case(sd: number): { p: Patient; base: Patient; entry: Entry; partner: string | null; role: string } | null {
    const all = z11Entries(); const withDependents = all.filter(x => dependencyPartners(x.drug).dependents.length > 0);
    // One case in four is drawn from the drugs that have a dependent drug, so that corner is swept as hard as the rest.
    const e = (sd % 4 === 0 ? withDependents[Math.floor(sd / 4) % withDependents.length] : all[sd % all.length]) as Entry;
    const dep = dependencyPartners(e.drug);
    // The three kinds of case (alone, with a drug that depends on it, with a drug it pairs with) are drawn equally often where they exist, and a partner of that kind at random.
    const kinds: Array<[string, string[]]> = [['alone', []], ...(dep.dependents.length ? [['dependent', dep.dependents] as [string, string[]]] : []), ...(dep.pairs.length ? [['pair', dep.pairs] as [string, string[]]] : [])];
    const h = Math.imul(sd, 2654435761) >>> 8; const [role, group] = kinds[h % kinds.length] as [string, string[]];
    const partner: string | null = group.length ? group[Math.floor(h / kinds.length) % group.length] as string : null;
    const bg = clonePatient(gen3r(sd).p as Patient); bg.scope_conditions = new Set();
    // The background patient's own regimen stays; the drug, what it needs (Furoscix needs an oral loop) and the partner are added.
    withDrug(bg, e.drug); dep.needs.length && !bg.current_regimen.some(r => dep.needs.includes(r.med.name)) && withDrug(bg, dep.needs[0]);
    if (partner) withDrug(bg, partner);
    const base = clonePatient(bg); const p = clonePatient(bg); e.apply(p);
    return { p, base, entry: e, partner, role };
}
/**
 * The guarantee: for a patient who is not in a stop state and who would be shown options without the entry, the tool shows at least one option, and (when the entry forces the drug out) every
 * option removes or replaces it. Keeps of a diuretic at potassium 6.0 or above are the documented T1 exception (they are removed only for an allergy or intolerance).
 */
export function z11Faults(c: NonNullable<ReturnType<typeof z11Case>>, count: (k: string, n?: number) => void): string[] {
    const out: string[] = []; const { p, base, entry: e } = c;
    let ob: SimulationOutput, oa: SimulationOutput;
    try { ob = runEngine(clonePatient(base)); oa = runEngine(clonePatient(p)); } catch (err) { return [`exception ${String(err).slice(0, 200)}`]; }
    count('cases'); count(`cases ${e.kind}`); count(`cases role ${c.role}`);
    if (ob.scoredRegimens.length === 0) { count('baseline empty (not counted)'); return out; }
    count('baseline with options');
    if (oa.scoredRegimens.length === 0) { out.push(`${e.drug} with ${e.label}${c.partner ? ` and ${c.partner}` : ''}: empty screen (baseline had ${ob.scoredRegimens.length} options): ${oa.clinicalAlerts.map(a => a.slice(0, 60)).join(' | ')}`); return out; }
    if (!e.forced) return out;
    const taken = p.current_regimen.find(r => r.med.name === e.drug); if (!taken) return out;
    const mustGo = e.kind === 'contraindication' ? !!taken.med.contraindications?.(p) && !(['Loop Diuretic', 'Thiazide-like Diuretic', 'K+ Binder'].includes(taken.med.drug_class) && p.potassium >= 6.0 && p.potassium <= 8.0) : true;
    if (!mustGo) { count('entry did not make the drug contraindicated on this patient (kept allowed)'); return out; }
    for (const [i, r] of oa.scoredRegimens.entries()) if (r.regimen.some(x => x.med.name === e.drug)) out.push(`${e.drug} with ${e.label}${c.partner ? ` and ${c.partner}` : ''}: option ${i + 1} still contains it: ${summaries(r).join(' ; ').slice(0, 200)}`);
    // a dependent drug never stays beside nothing it depends on
    for (const [i, r] of oa.scoredRegimens.entries()) { const sp = structuralProblems(r.regimen); if (sp.length > 0 && structuralProblems(p.current_regimen.filter(x => x.exposure?.status !== 'held')).length === 0) out.push(`option ${i + 1} is structurally unsound: ${sp.join('; ')}`); }
    return out;
}
R9_PREP.z11 = (_p, sd) => (z11Case(sd) ? _p : null);
R9_CHECKS.z11 = () => { throw new Error('z11 runs through z11Case; use the sweep script mode z11'); };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Z1: on a forced switch the reason sits with the drug it is about (the drug that must stop), never after the drug being started
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** Faults in the placement of the reason on the change lines of one output: for every forced switch the reason text lies after the drug stopped and before the drug started, in the raw line. */
export function reasonPlacementFaults(o: SimulationOutput, count: (k: string, n?: number) => void = () => { }): string[] {
    const out: string[] = [];
    for (const [i, r] of o.scoredRegimens.entries()) for (const m of modsOfOpt(r)) {
        if (m.action !== 'swap' || !m.source || !m.target) continue;
        const reason = m.forced_reason ?? (/Pregnancy:[^()]*/.exec(m.summary)?.[0]); if (!reason) continue;
        count('forced switch lines');
        const s = m.summary.indexOf(m.source.med.name), ri = m.summary.indexOf(shortLineReason(reason)); const t = s < 0 ? -1 : m.summary.indexOf(m.target.med.name, s + m.source.med.name.length);
        if (!(s >= 0 && ri > s && (t < 0 || ri < t))) out.push(`option ${i + 1}: the reason does not sit with ${m.source.med.name} (stopped), before ${m.target.med.name} (started): "${m.summary.slice(0, 220)}"`);
    }
    return out;
}
R9_CHECKS.z1 = (_p, o, count) => reasonPlacementFaults(o, count);
R9_PREP.z1 = (_p, sd) => z11Case(sd)?.p ?? null;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Z2: the poor-perfusion alert says only what is always true of the options
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** A patient in the cold (poor perfusion) state: cool extremities with a narrow pulse pressure (the engine's own cold predicate), on the background patient's regimen. */
export const coldPatient = (p0: Patient): Patient => { const p = clonePatient(p0); p.scope_conditions = new Set(); p.sbp = 96; p.dbp = 74; p.pulse = 84; p.potassium = Math.min(p.potassium || 4.3, 5.0) || 4.3; p.is_pregnant = false; p.volume_status.exam_findings = new Set([...p.volume_status.exam_findings, 'Cool Extremities']); return p; };
/** The sentence the alert says about the options is tested against EVERY option: no option starts or raises a drug other than a loop diuretic for recorded congestion or a replacement for a beta-blocker that must stop, and the alert claims nothing stronger. */
R9_PREP.z2 = (p) => coldPatient(p);
R9_CHECKS.z2 = (p, o, count) => {
    const out: string[] = []; const a = o.clinicalAlerts.find(x => x.startsWith('POOR PERFUSION')); if (!a || o.scoredRegimens.length === 0) return out;
    count('cold screens with options');
    if (/contain only|safety rules require|only the dose reductions/i.test(a)) out.push(`the alert still says the options hold only what the safety rules require: "${a.slice(a.search(/No drug is started/), a.search(/No drug is started/) + 260)}"`);
    if (!/may still lower or stop a drug/i.test(a)) out.push('the alert does not say that an option may still lower or stop a drug');
    for (const [i, r] of o.scoredRegimens.entries()) for (const m of modsOfOpt(r)) {
        if (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') {
            const loop = m.target?.med.drug_class === 'Loop Diuretic'; const bbReplacement = m.action === 'swap' && !!m.mandatory && m.source?.med.drug_class === 'Beta Blocker';
            const binderRaise = m.action === 'titrate_up' && m.target?.med.drug_class === 'K+ Binder' && a.includes('except the potassium binder the patient already takes'); // R10 A8: a raise of a binder the patient takes is named in the sentence
            if (!loop && !bbReplacement && !binderRaise) out.push(`option ${i + 1} ${m.action}s ${m.target?.med.name} although the alert says no drug is started or raised: ${m.summary.slice(0, 120)}`);
        }
        if (m.action === 'remove' || m.action === 'titrate_down') count(`option lines that lower or stop a drug${m.mandatory ? ' (mandatory)' : ' (by score)'}`);
    }
    void p; return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Z3: every sentence that quotes a total loop diuretic dose is recomputed from the regimen before and the regimen the option produces
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const fe = (regimen: ReadonlyArray<RegimenMed>) => oralLoopFe(regimen);
const r1 = (n: number) => `${Math.round(n * 10) / 10}`;
/** The loop-step note of an option (an option that raises one oral loop and changes another) states the true totals, says "unchanged" only when they are equal, and names a removal by its real reason. */
R9_CHECKS.z3 = (p, o, count) => {
    const out: string[] = []; const before = fe(p.current_regimen.filter(r => r.exposure?.status !== 'held' && r.exposure?.status !== 'completed'));
    for (const [i, r] of o.scoredRegimens.entries()) {
        const after = fe(r.regimen); const mods = modsOfOpt(r);
        for (const w of r.warnings.filter(x => /^Drug note: The loop diuretic step in this option/.test(x))) {
            count('loop step notes');
            const word = /leaves the total oral loop diuretic dose unchanged/.test(w) ? 'unchanged' : /lowers the total oral loop diuretic dose/.test(w) ? 'lowers' : /raises the total oral loop diuretic dose/.test(w) ? 'raises' : '?';
            const truth = Math.abs(after - before) < 1e-9 ? 'unchanged' : after < before ? 'lowers' : 'raises';
            if (word !== truth) out.push(`option ${i + 1}: note says "${word}" but the totals are ${r1(before)} before and ${r1(after)} after: ${w.slice(0, 260)}`);
            const nums = [...w.matchAll(/about (\d+(?:\.\d+)?)/g)].map(x => Number(x[1]));
            if (truth === 'unchanged' ? !(nums.length >= 1 && nums.every(n => Math.abs(n - before) < 0.06)) : !(nums.length === 2 && Math.abs(nums[0] as number - before) < 0.06 && Math.abs(nums[1] as number - after) < 0.06)) out.push(`option ${i + 1}: the figures in the note (${nums.join(', ')}) are not the totals ${r1(before)} and ${r1(after)}`);
            if (/the duplicate entry/.test(w) && !mods.some(m => m.duplicate_cleanup && m.action === 'remove' && m.source?.med.drug_class === 'Loop Diuretic')) out.push(`option ${i + 1}: a removal is called the duplicate entry although no duplicate clean-up removes a loop: ${w.slice(0, 260)}`);
        }
    }
    for (const a of o.clinicalAlerts.filter(x => x.startsWith('DUPLICATE THERAPY') && /total oral loop diuretic dose/.test(x))) {
        count('duplicate alerts quoting a total');
        const m = /Taking (?:both|all three|all \d+), the total oral loop diuretic dose is about (\d+(?:\.\d+)?) mg of furosemide a day; with only (.+?) kept it would be about (\d+(?:\.\d+)?)/.exec(a);
        if (!m) { out.push(`duplicate alert quotes a total in an unknown form: ${a.slice(0, 300)}`); continue; }
        const both = fe(p.current_regimen.filter(x => x.med.drug_class === 'Loop Diuretic' && !x.med.facts?.short_course_addon)); const kept = fe(p.current_regimen.filter(x => x.med.name === m[2]));
        if (Math.abs(Number(m[1]) - both) > 0.06 || Math.abs(Number(m[3]) - kept) > 0.06) out.push(`duplicate alert total ${m[1]} / ${m[3]} but the regimen gives ${r1(both)} / ${r1(kept)}`);
        if (!(kept < both)) out.push('the duplicate alert quotes a total that does not fall');
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Z4: the potassium row says per drug what the tool does at this potassium, and no row forbids what an option on the same screen does
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
R9_PREP.z4 = (p, sd) => { const q = clonePatient(p); q.potassium = [5.0, 5.1, 5.2, 5.3, 5.5, 5.9][sd % 6] as number; return q; };
/** Every potassium row "do not raise the dose of X until ..." (top-level plan and every option's plan) names the drugs the tool holds at this potassium, by each drug's own rule, and no option on the screen raises a named drug. */
R9_CHECKS.z4 = (p, o, count) => {
    const out: string[] = [];
    const rows: Array<[string, string]> = [...o.monitoringPlan.map(x => ['plan', x.details] as [string, string]), ...o.scoredRegimens.flatMap((r, i) => (r.monitoring_plan ?? []).map(x => [`option ${i + 1}`, x.details] as [string, string]))];
    const raised = new Set(o.scoredRegimens.flatMap(r => modsOfOpt(r).filter(m => m.action === 'titrate_up' && m.target).map(m => m.target!.med.name)));
    for (const [where, d] of rows) {
        if (!/^Potassium is 5\.0 or higher and the patient takes a RAAS inhibitor or MRA\./.test(d)) continue;
        count('potassium rows');
        const m = /do not raise the dose of (.+?)\.$/.exec(d);
        if (!m) { count('potassium rows with no hold'); continue; }
        for (const part of (m[1] as string).split(' or of ')) {
            const pm = /^(.+?) until potassium is (below ([\d.]+)|([\d.]+) or lower)$/.exec(part); if (!pm) { out.push(`${where}: unparsed hold "${part}"`); continue; }
            const drug = p.current_regimen.concat(o.scoredRegimens.flatMap(r => r.regimen)).find(x => x.med.name.replace(/\s*\(.*\)/, '') === pm[1])?.med; if (!drug) { out.push(`${where}: names ${pm[1]}, not a drug on the screen`); continue; }
            const rule = drug.facts?.k_uptitration_max; const limit = pm[3] ? Number(pm[3]) : Number(pm[4]);
            const ok = !!rule && (pm[3] ? rule.below === limit && p.potassium >= limit : rule.above === limit && p.potassium > limit);
            if (!ok) out.push(`${where}: "${part}" but the rule for ${drug.name} is ${JSON.stringify(rule)} at potassium ${p.potassium}`);
            if (raised.has(drug.name)) out.push(`${where}: says do not raise ${pm[1]} until potassium is ${pm[2]} but an option on the screen raises it`);
        }
    }
    // a drug the tool holds at this potassium that an option keeps is named in that option's row
    for (const [i, r] of o.scoredRegimens.entries()) for (const x of r.regimen) {
        const blocked = x.med.facts?.k_uptitration_max && (x.med.facts.k_uptitration_max.below !== undefined ? p.potassium >= x.med.facts.k_uptitration_max.below : p.potassium > (x.med.facts.k_uptitration_max.above as number));
        if (blocked && p.potassium < 6.0 && p.potassium >= 5.0) { const row = (r.monitoring_plan ?? []).find(y => /^Potassium is 5\.0 or higher and the patient takes/.test(y.details)); if (row && !row.details.includes(x.med.name.replace(/\s*\(.*\)/, ''))) out.push(`option ${i + 1}: ${x.med.name} is held at potassium ${p.potassium} and the row does not name it`); }
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Z5: every screen with no medication option carries the one sentence that is true in all cases, and no other sentence says no drug can or should be changed
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const NO_CHANGE_CLAIMS = /no medication change is proposed|no drug can be (started|changed)|no medication is changed|nothing (should|can) be changed|no change to (any|your) (drug|medication)/i;
R9_CHECKS.z5 = (_p, o, count) => {
    const out: string[] = []; if (o.scoredRegimens.length > 0) return out;
    count('no-option outputs');
    const texts = [o.why_first?.stop ?? '', ...(o.decisionReadiness?.available ?? []), ...(o.decisionReadiness?.deferred ?? []), ...o.clinicalAlerts, ...o.monitoringPlan.map(x => x.details), ...o.excludedMedications.map(e => e.reason)];
    for (const t of texts) if (NO_CHANGE_CLAIMS.test(t)) out.push(`a no-option screen says no drug can be changed: "${t.slice(Math.max(0, t.search(NO_CHANGE_CLAIMS) - 30), t.search(NO_CHANGE_CLAIMS) + 80)}"`);
    const lead = [o.why_first?.stop ?? '', ...(o.decisionReadiness?.available ?? [])];
    if (o.decisionReadiness?.mode !== 'limited_review' && !lead.some(t => /This tool proposes no medication option today/.test(t))) out.push('no-option screen without the one sentence');
    if (o.decisionReadiness?.mode !== 'limited_review' && !lead.some(t => /may ask you to withhold, reduce or review a drug/.test(t))) out.push('no-option screen whose sentence does not say the alerts may ask for a drug to be withheld, reduced or reviewed');
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Z7: the decompensation alert says "oral"; a potassium "reduce" alert says when every option stops or replaces the drug
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
R9_PREP.z7 = (p, sd) => { const q = clonePatient(p); q.potassium = [5.5, 5.6, 5.7, 5.9][sd % 4] as number; const taken = q.current_regimen.filter(r => ['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA'].includes(r.med.drug_class)); if (taken.length) q.allergies = new Set([generic(taken[sd % taken.length]!.med.name).toLowerCase()]); return q; };
R9_CHECKS.z7 = (p, o, count) => {
    const out: string[] = []; if (o.scoredRegimens.length === 0) return out;
    for (const a of o.clinicalAlerts) {
        const red = /^POTASSIUM REDUCE ON ([^:]+): /.exec(a);
        if (red) {
            const cur = p.current_regimen.find(r => r.med.name.toUpperCase() === red[1]); if (!cur) continue;
            const acts = o.scoredRegimens.map(r => modsOfOpt(r).find(m => m.source?.med.name === cur.med.name)?.action ?? 'keep');
            const all = acts.every(x => x === 'remove' || x === 'swap'); count(all ? 'reduce alerts, every option stops or replaces' : 'reduce alerts, some option keeps or reduces');
            if (all && /reduce one dose step \(withhold/.test(a)) out.push(`reduce alert for ${cur.med.name} although every option stops or replaces it`);
            if (all && !/stopped or replaced in every option shown/.test(a)) out.push(`reduce alert for ${cur.med.name} does not say every option stops or replaces it`);
            if (!all && /stopped or replaced in every option shown/.test(a)) out.push(`reduce alert says every option stops ${cur.med.name} but one does not`);
        }
        if (a.includes('every option includes one.')) { count('decompensation sentences'); if (!/an oral loop diuretic start or increase is eligible/.test(a)) out.push('decompensation sentence does not say oral'); }
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Z8: change lines carry a short reason only; no ".;" or ".." in displayed text; wording of two lines
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const CHANGE_LINE_MAX = 340;
const nestedParens = (t: string) => { let d = 0, m = 0; for (const c of t) { if (c === '(') m = Math.max(m, ++d); else if (c === ')') d--; } return m > 1; };
R9_CHECKS.z8 = (p, o, count) => {
    const out: string[] = [];
    for (const [i, r] of o.scoredRegimens.entries()) {
        for (const sline of summaries(r)) {
            const t = plainText(sline); count('change lines');
            if (nestedParens(t)) out.push(`option ${i + 1}: a parenthesis inside a parenthesis: ${t.slice(0, 200)}`);
            if (t.length > CHANGE_LINE_MAX) out.push(`option ${i + 1}: a change line of ${t.length} characters: ${t.slice(0, 160)}`);
            if (/\.;|\.\.(?!\.)/.test(t) || /\.$/.test(sline)) out.push(`option ${i + 1}: a change line ends with or contains a stray full stop: ${t.slice(-60)}`);
        }
        // a raise of a thiazide-type diuretic the patient already takes is an increase, never an addition
        const sb = r.shown_because ?? '';
        const m = /^Includes a diuretic (addition|increase|addition or increase) \(([^)]*)\)/.exec(sb);
        if (m) {
            count('diuretic sentences');
            const acts = modsOfOpt(r).filter(x => x.target && ['Loop Diuretic', 'Thiazide-like Diuretic'].includes(x.target.med.drug_class) && (x.action === 'add' || x.action === 'titrate_up')).map(x => x.action);
            const want = acts.includes('add') && acts.includes('titrate_up') ? 'addition or increase' : acts.includes('titrate_up') ? 'increase' : 'addition';
            if (m[1] !== want) out.push(`option ${i + 1}: says a diuretic ${m[1]} but the option does ${acts.join(' and ')}`);
        }
    }
    for (const t of [...o.clinicalAlerts, ...o.excludedMedications.map(e => e.reason), ...o.scoredRegimens.flatMap(r => [...r.warnings, r.shown_because ?? ''])]) {
        const d = plainText(t); if (/\.;|\.\.(?!\.)/.test(d)) out.push(`stray full stop: ${d.slice(Math.max(0, d.search(/\.;|\.\.(?!\.)/) - 40), d.search(/\.;|\.\.(?!\.)/) + 20)}`);
        if (/\bnsMRA\b/.test(d)) out.push(`internal class label nsMRA: ${d.slice(0, 100)}`);
    }
    void p; return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Z12: finerenone gap wording for an unknown history; no raw shouted strings in any displayed text
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
R9_CHECKS.z12 = (p, o, count) => {
    const out: string[] = [];
    for (const g of o.gdmtGaps ?? []) {
        const m = /is taken, but it fills the MRA slot only at an ejection fraction of 41 or higher with no earlier ejection fraction of 40 or lower, and (.*)$/.exec(g); if (!m) continue;
        count('finerenone gap lines');
        const unknown = (p.ever_lvef_le_40 ?? 'unknown') === 'unknown' && !(p.previous_lvef && p.previous_lvef > 0);
        if (p.lvef > 40 && unknown && /^here it does not|an earlier ejection fraction of 40 or lower is recorded/.test(m[1] as string)) out.push(`history unknown but the line says it is recorded or "here it does not": ${m[1]}`);
        if (p.lvef > 40 && unknown && !/not known/.test(m[1] as string)) out.push(`history unknown and the line does not say so: ${m[1]}`);
        if (p.lvef <= 40 && !/is 40 or lower/.test(m[1] as string)) out.push(`ejection fraction ${p.lvef} but the line says: ${m[1]}`);
    }
    // raw strings reach no displayed surface in shouted form
    const raw = [...o.clinicalAlerts, ...o.excludedMedications.flatMap(e => [e.reason, ...(e.why ?? [])]), ...o.scoredRegimens.flatMap(r => [...r.warnings, r.shown_because ?? '', ...modsOfOpt(r).map(m => m.summary), ...(r.monitoring_plan ?? []).map(x => x.details)]), ...o.monitoringPlan.map(x => x.details)];
    for (const t of raw) { if (/ENGINE POLICY/.test(t)) out.push(`raw "ENGINE POLICY": ${t.slice(0, 120)}`); if (/\bSTOP\b[^.]*\bWAIT\b|\bTHEN start\b/.test(t)) out.push(`raw STOP ... WAIT ... THEN: ${t.slice(0, 120)}`); }
    return out;
};

export function runEngineReadinessR9Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] ReadinessR9: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR9: ${name}: ${(e as Error).message?.slice(0, 900)}`); }
    };

    // ---------------- Z11 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z11 reviewer seeds 30110113 (allergy bumex, bumetanide + Furoscix), 30100081 and 30110309 (allergy demadex, torsemide + Furoscix): options are shown and every option stops the oral loop and Furoscix with a stated reason', () => {
        for (const [sd, al] of [[30110113, 'bumex'], [30100081, 'demadex'], [30110309, 'demadex'], [30110113, 'bumetanide'], [30100081, 'torsemide']] as Array<[number, string]>) {
            const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); p.allergies = new Set([al]);
            const o = runEngine(clonePatient(p));
            assert.ok(o.scoredRegimens.length > 0, `seed ${sd} ${al}: empty screen`);
            const loop = p.current_regimen.find(r => r.med.drug_class === 'Loop Diuretic' && !r.med.facts?.short_course_addon)!;
            for (const [i, r] of o.scoredRegimens.entries()) {
                assert.ok(!r.regimen.some(x => x.med.name === loop.med.name), `seed ${sd}: option ${i + 1} keeps ${loop.med.name}`);
                assert.deepEqual(structuralProblems(r.regimen), [], `seed ${sd}: option ${i + 1} is unsound`);
            }
        }
    });
    check('Z11 the guarantee over every formulary drug with an allergy, an intolerance or a contraindication, alone and with the drugs that depend on it or pair with it (500 random background patients)', () => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = 30100000; sd < 30100500; sd++) { const c = z11Case(sd); if (!c) continue; for (const m of z11Faults(c, (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; })) if (faults.length < 5) faults.push(`seed ${sd}: ${m}`); }
        assert.deepEqual(faults, []); assert.ok((counts['baseline with options'] ?? 0) > 200, JSON.stringify(counts));
    });
    check('Z11 the dependency rules are read from the code: Furoscix depends on an oral loop diuretic, and two agents of one class pair', () => {
        const d = dependencyPartners('Bumetanide'); assert.ok(d.dependents.includes('Furoscix (SC Furosemide)'), JSON.stringify(d)); assert.ok(d.pairs.includes('Torsemide'));
        assert.ok(dependencyPartners('Furoscix (SC Furosemide)').needs.includes('Bumetanide'));
    });

    // ---------------- Z1 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z1 reviewer patients T02 (lisinopril, allergic to lisinopril), T01 (Entresto, allergic to Entresto), F13 (enalapril allergy at potassium 5.4), R04 (lisinopril, SBP 92): the allergy reason follows the drug stopped, in every option; plus every drug switched for an allergy, an intolerance or a contraindication (1,500 patients)', () => {
        const base = { lvef: 30, nyha_class: 'II' as const, sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97 };
        const cases: Array<[Patient, string]> = [
            [mk(base, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]), 'lisinopril'], [mk(base, [entry('Sacubitril/Valsartan (Entresto)', '24/26', 'bid'), entry('Carvedilol', 12.5, 'bid')]), 'Entresto'],
            [mk({ ...base, potassium: 5.4 }, [entry('Enalapril', 10, 'bid'), entry('Spironolactone', 25)]), 'enalapril'], [mk({ ...base, sbp: 92, dbp: 58 }, [entry('Lisinopril', 10)]), 'lisinopril'],
            [mk(base, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]), 'ACE inhibitors'],
        ];
        let lines = 0;
        for (const [p, al] of cases) { p.allergies = new Set([al]); const o = runEngine(clonePatient(p)); assert.deepEqual(reasonPlacementFaults(o, (k, n = 1) => { if (k === 'forced switch lines') lines += n; }), []); }
        assert.ok(lines >= 3, `${lines} forced switch lines`);
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = 30100000; sd < 30101500; sd++) { const c = z11Case(sd); if (!c) continue; let o: SimulationOutput; try { o = runEngine(clonePatient(c.p)); } catch { continue; } for (const m of reasonPlacementFaults(o, (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; })) if (faults.length < 5) faults.push(`seed ${sd}: ${m}`); }
        assert.deepEqual(faults, []); assert.ok((counts['forced switch lines'] ?? 0) > 100, JSON.stringify(counts));
    });

    // ---------------- Z2 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z2 reviewer patient Q12b (EF 15, NYHA III, cool extremities, BUN 40 creatinine 1.5, at dry weight, Entresto 49/51, carvedilol 12.5, furosemide 40; options stop or lower the loop by score): the poor-perfusion alert does not claim the options hold only required reductions; plus 1,500 cold patients tested against every option', () => {
        const q = mk({ lvef: 15, nyha_class: 'III', sbp: 104, dbp: 70, pulse: 80, potassium: 4.4, creatinine: 1.5, egfr: 52, bun: 40, oxygen_saturation: 96, dry: 80, cur: 80, findings: ['Cool Extremities'] }, [entry('Sacubitril/Valsartan (Entresto)', '49/51', 'bid'), entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 40)]);
        const o = runEngine(clonePatient(q)); const a = o.clinicalAlerts.find(x => x.startsWith('POOR PERFUSION')); assert.ok(a, 'no poor perfusion alert');
        assert.ok(o.scoredRegimens.some(r => modsOfOpt(r).some(m => (m.action === 'remove' || m.action === 'titrate_down') && m.source?.med.name === 'Furosemide' && !m.mandatory)), 'the reviewer patient shows no score-driven loop reduction');
        assert.deepEqual(R9_CHECKS.z2(q, o, () => { }), []);
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = 30200000; sd < 30201500; sd++) { const p = coldPatient(gen3r(sd).p as Patient); let oo: SimulationOutput; try { oo = runEngine(clonePatient(p)); } catch { continue; } for (const m of R9_CHECKS.z2(p, oo, (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; })) if (faults.length < 5) faults.push(`seed ${sd}: ${m}`); }
        assert.deepEqual(faults, []); assert.ok((counts['cold screens with options'] ?? 0) > 100, JSON.stringify(counts));
    });

    // ---------------- Z3 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z3 reviewer seeds 30300099 (torsemide 40 twice daily + furosemide 80: the option raises torsemide and removes furosemide, 240 to 200), 30008901, 30000203 (allergy-forced removal is not "the duplicate entry"), and a duplicate loop pair in a congested patient: totals are recomputed (3,000 patients)', () => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        const run1 = (p: Patient, sd: string) => { const o = runEngine(clonePatient(p)); for (const m of R9_CHECKS.z3(p, o, (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; })) if (faults.length < 5) faults.push(`${sd}: ${m}`); return o; };
        for (const sd of [30300099, 30008901, 30000203]) { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); if (sd === 30000203) p.allergies = new Set(['bumetanide']); run1(p, `seed ${sd}`); }
        const dup = mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.2, egfr: 60, oxygen_saturation: 96, dry: 80, cur: 84, findings: ['Edema (2+)', 'JVP Elevated'] }, [entry('Furosemide', 80), entry('Torsemide', 40)]);
        const od = run1(dup, 'duplicate pair'); assert.ok(od.clinicalAlerts.some(a => /^DUPLICATE THERAPY/.test(a) && /total oral loop diuretic dose is about 240/.test(a) || /^DUPLICATE THERAPY/.test(a) && /total oral loop diuretic dose is about 160/.test(a)), 'the duplicate alert states no total: ' + od.clinicalAlerts.find(a => /^DUPLICATE/.test(a)));
        for (let sd = 30300000; sd < 30310000 && (counts['loop step notes'] ?? 0) < 10; sd++) { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); try { run1(p, `seed ${sd}`); } catch { /* skip */ } }
        assert.deepEqual(faults, []); assert.ok((counts['loop step notes'] ?? 0) >= 10, JSON.stringify(counts));
    });

    // ---------------- Z4 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z4 reviewer seeds 30700016 (potassium 5.0 to 5.1, candesartan: an option raises it) and 30000191, and potassium 5.0 to 5.9 neighbours: the potassium row names the drugs the tool holds, each by its own rule, and no option on the screen raises a drug the row forbids', () => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        const one = (p: Patient, label: string) => { const o = runEngine(clonePatient(p)); for (const m of R9_CHECKS.z4(p, o, (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; })) if (faults.length < 5) faults.push(`${label}: ${m}`); };
        for (const sd of [30700016, 30000191]) for (const k of [5.0, 5.1, 5.2, 5.3]) { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); p.potassium = k; one(p, `seed ${sd} K ${k}`); }
        for (let sd = 30700000; sd < 30701500; sd++) { const p = R9_PREP.z4!(clonePatient(gen3r(sd).p as Patient), sd) as Patient; p.scope_conditions = new Set(); try { one(p, `seed ${sd}`); } catch { /* skip */ } }
        assert.deepEqual(faults, []); assert.ok((counts['potassium rows'] ?? 0) > 100, JSON.stringify(counts));
    });

    // ---------------- Z5 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z5 stop screens (seeds 30000861 and 30400012: NSAID "Deprecribe", duplicate beta-blockers; potassium 6.5; severe kidney disease) carry the one true sentence on every no-option path (1,000 patients x 13 paths)', () => {
        const faults: string[] = []; let seen = 0;
        for (let sd = 30400000; sd < 30401000; sd++) for (const [pn, f] of NO_OPTION_PATHS) {
            const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); f(q); let o: SimulationOutput; try { o = runEngine(clonePatient(q)); } catch { continue; }
            if (o.scoredRegimens.length === 0) seen++;
            for (const m of R9_CHECKS.z5(q, o, () => { })) if (faults.length < 5) faults.push(`seed ${sd} ${pn}: ${m}`);
        }
        for (const sd of [30000861, 30400012]) { const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); q.potassium = 6.6; const o = runEngine(clonePatient(q)); for (const m of R9_CHECKS.z5(q, o, () => { })) faults.push(`seed ${sd}: ${m}`); }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(seen > 1500, `${seen} no-option outputs`);
    });

    // ---------------- Z6 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z6 allergy completeness: (a) semaglutide and tirzepatide are one family (a switch beside an allergy to the other carries the ALLERGY CHECK); (b) an allergy to sacubitril/valsartan puts the check on valsartan and on nothing else (no ARB other than valsartan, no ACE inhibitor); (c) angioedema recorded from an ARB entry does not print "Cross-reactivity with prior ACEi intolerance"; (d) NKDA and its kin are no allergy, with no note', () => {
        const checkWarn = (o: SimulationOutput) => o.scoredRegimens.map(r => r.warnings.filter(w => /^ALLERGY CHECK/.test(w)));
        for (const [taken, allergic, target] of [['Semaglutide (Wegovy)', 'semaglutide', 'Tirzepatide'], ['Tirzepatide (Zepbound)', 'tirzepatide', 'Semaglutide']] as const) {
            let swaps = 0;
            for (const bmi of [32, 34, 38]) {
                const p = mk({ lvef: 55, nyha_class: 'II', sbp: 124, dbp: 72, pulse: 76, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, bmi }, []); withDrug(p, taken); p.allergies = new Set([allergic]);
                const o = runEngine(clonePatient(p));
                o.scoredRegimens.forEach((r, i) => { if (modsOfOpt(r).some(m => m.action === 'swap' && m.target?.med.name.startsWith(target))) { swaps++; assert.ok(checkWarn(o)[i]!.length > 0, `${taken} allergy ${allergic}: switch to ${target} carries no ALLERGY CHECK`); } });
            }
            assert.ok(swaps >= 2, `${taken}: ${swaps} switches seen`);
        }
        // (b)
        const base = () => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 72, pulse: 76, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97 }, [entry('Carvedilol', 12.5, 'bid')]);
        const sv = base(); sv.allergies = new Set(['Entresto']); const osv = runEngine(clonePatient(sv)); let starts = 0, valsartanChecked = 0;
        osv.scoredRegimens.forEach((r, i) => modsOfOpt(r).forEach(m => {
            if ((m.action !== 'add' && m.action !== 'swap') || !m.target) return; const n = m.target.med.name;
            if (['ARB', 'ACEi'].includes(m.target.med.drug_class)) { starts++; const has = checkWarn(osv)[i]!.some(w => /Sacubitril\/Valsartan/.test(w)); if (n === 'Valsartan') { valsartanChecked++; assert.ok(has, 'start of valsartan after an Entresto allergy carries no ALLERGY CHECK'); } else assert.ok(!has, `${n} after an Entresto allergy carries a check (panel question 21: it must not)`); }
        }));
        assert.ok(starts >= 1, 'no ARB or ACE inhibitor start to test');
        const v = base(); v.allergies = new Set(['Entresto']); v.potassium = 4.4; const direct = v.current_regimen.length; void direct;
        // (c)
        const ang = base(); ang.discontinued_meds = [{ name: 'Losartan', drug_class: 'ARB', reason: 'Angioedema' } as never];
        const oa = runEngine(clonePatient(ang)); const aceReason = oa.excludedMedications.find(e => e.name === 'Lisinopril');
        assert.ok(aceReason && !/Cross-reactivity with prior ACEi intolerance/.test(JSON.stringify(aceReason)) && /Angioedema is recorded/.test(JSON.stringify(aceReason)), JSON.stringify(aceReason));
        const cough = base(); cough.discontinued_meds = [{ name: 'Ramipril', drug_class: 'ACEi', reason: 'Cough' } as never];
        assert.ok(/Cross-reactivity with prior ACEi intolerance/.test(JSON.stringify(runEngine(clonePatient(cough)).excludedMedications.find(e => e.name === 'Lisinopril'))), 'the cough record keeps its cross-reactivity wording');
        // (d)
        const ref = JSON.stringify(summaries(runEngine(clonePatient(base())).scoredRegimens[0]!));
        for (const e of ['NKDA', 'nkda', 'No known drug allergies', 'none', 'Nil', 'no allergies']) {
            const q = base(); q.allergies = new Set([e]); const oq = runEngine(clonePatient(q));
            assert.ok(!oq.clinicalAlerts.some(a => /^ALLERGY NOTE/.test(a)), `"${e}" gets a note`); assert.equal(JSON.stringify(summaries(oq.scoredRegimens[0]!)), ref, `"${e}" changes the options`);
        }
        const q2 = base(); q2.allergies = new Set(['glibberish']); assert.ok(runEngine(clonePatient(q2)).clinicalAlerts.some(a => /^ALLERGY NOTE/.test(a)), 'a real unmatched entry still gets its note');
    });

    // ---------------- Z7 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z7 (a) acute decompensation with the oral loop at its maximum (C03 furosemide 160 twice daily at +4 kg, C04 bumetanide 2 mg three times daily at +3 kg): the sentence says an oral loop; (b) R03 (K 5.7, lisinopril allergy) and R10 (K 5.6, Entresto allergy): the reduce alert says every option stops or replaces the drug; 1,500 neighbours', () => {
        const dec = (reg: RegimenMed[], cur: number) => mk({ lvef: 25, nyha_class: 'III', sbp: 112, dbp: 70, pulse: 90, potassium: 4.4, creatinine: 1.2, egfr: 60, oxygen_saturation: 95, dry: 80, cur, findings: ['Edema (2+)', 'JVP Elevated', 'Crackles'] }, reg);
        for (const p of [dec([entry('Furosemide', 160, 'bid'), entry('Lisinopril', 10)], 84), dec([entry('Bumetanide', 2, 'tid')], 83)]) {
            const o = runEngine(clonePatient(p)); const c: Record<string, number> = {}; assert.deepEqual(R9_CHECKS.z7(p, o, (k, n = 1) => { c[k] = (c[k] ?? 0) + n; }), []); assert.ok((c['decompensation sentences'] ?? 0) >= 1, 'no decompensation sentence: ' + o.clinicalAlerts.map(a => a.slice(0, 40)).join(' | '));
        }
        const k = (reg: RegimenMed[], kk: number, al: string) => { const p = mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 72, pulse: 76, potassium: kk, creatinine: 1.0, egfr: 70, oxygen_saturation: 97 }, reg); p.allergies = new Set([al]); return p; };
        for (const p of [k([entry('Lisinopril', 10)], 5.7, 'lisinopril'), k([entry('Sacubitril/Valsartan (Entresto)', '49/51', 'bid')], 5.6, 'Entresto'), k([entry('Spironolactone', 25)], 5.7, 'spironolactone')]) {
            const o = runEngine(clonePatient(p)); const c: Record<string, number> = {}; assert.deepEqual(R9_CHECKS.z7(p, o, (kq, n = 1) => { c[kq] = (c[kq] ?? 0) + n; }), []); assert.ok((c['reduce alerts, every option stops or replaces'] ?? 0) === 1, JSON.stringify(c));
        }
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = 30700000; sd < 30701500; sd++) { const p = R9_PREP.z7!(clonePatient(gen3r(sd).p as Patient), sd) as Patient; p.scope_conditions = new Set(); let o: SimulationOutput; try { o = runEngine(clonePatient(p)); } catch { continue; } for (const m of R9_CHECKS.z7(p, o, (kk, n = 1) => { counts[kk] = (counts[kk] ?? 0) + n; })) if (faults.length < 5) faults.push(`seed ${sd}: ${m}`); }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok((counts['reduce alerts, every option stops or replaces'] ?? 0) > 5, JSON.stringify(counts));
    });

    // ---------------- Z8 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z8 change lines: no parenthesis inside a parenthesis, none longer than 340 characters, no stray full stop, a raised thiazide is an increase, no internal class label (3,000 patients)', () => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = 30800000; sd < 30803000; sd++) { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); let o: SimulationOutput; try { o = runEngine(clonePatient(p)); } catch { continue; } for (const m of R9_CHECKS.z8(p, o, (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; })) if (faults.length < 5) faults.push(`seed ${sd}: ${m}`); }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok((counts['change lines'] ?? 0) > 3000, JSON.stringify(counts));
    });

    // ---------------- Z12 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('Z12 (a) finerenone gap line for an unknown earlier ejection fraction (seed 30000381); (c) no raw "ENGINE POLICY" or "STOP ... WAIT ... THEN" in any output string (2,000 patients); (b) no change line twice in an option (3,000 patients)', () => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        const one = (sd: number) => { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); let o: SimulationOutput; try { o = runEngine(clonePatient(p)); } catch { return; }
            for (const m of R9_CHECKS.z12(p, o, (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; })) if (faults.length < 5) faults.push(`seed ${sd}: ${m}`);
            for (const [i, r] of o.scoredRegimens.entries()) { const ls = modsOfOpt(r).map(m => m.summary); if (new Set(ls).size !== ls.length && faults.length < 5) faults.push(`seed ${sd} option ${i + 1}: a change line twice: ${ls.find((l, j) => ls.indexOf(l) !== j)}`); } };
        one(30000381); for (let sd = 30000000; sd < 30003000; sd++) one(sd);
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok((counts['finerenone gap lines'] ?? 0) >= 3, JSON.stringify(counts));
    });

    return { passed, failed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const r = runEngineReadinessR9Checks();
    console.log(`ReadinessR9: ${r.passed} passed, ${r.failed} failed`);
    process.exit(r.failed > 0 ? 1 : 0);
}
