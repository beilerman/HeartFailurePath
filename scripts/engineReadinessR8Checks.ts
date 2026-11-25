/**
 * Round 8 engine rulings of the 2026-11-22 readiness pass (X1 to X15). Every check builds the patient a reviewer reported AND at least three neighbours, and asserts the corrected
 * behaviour. Run standalone (`npx tsx scripts/engineReadinessR8Checks.ts`) or through `npm run verify`. Per-patient generated checks are `R8_CHECKS`, also run in chunks by
 * `scripts/engineReadinessR8Sweep.ts <mode> <firstSeed> <count>`.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY } from '../constants';
import { mk, runEngine, summaries } from './engineReadinessR2Checks';
import { entry } from './systemicReviewChecks';
import { gen3r } from './r3Generator';
import { clonePatient } from '../data/scenarios';
import { allText } from './engineReadinessR5Checks';
import { NO_OPTION_PATHS } from './r6Paths';
import { resolveAllergy, expandAllergies } from '../services/engine/allergy';
import { START_RULE } from '../services/engine/candidates';
import { takesRaasOrMra } from '../services/engine/urgentStates';
import { displayedStrings } from './engineReadinessR7Checks';
import { plainText } from '../components/plainText';
import { getMedicationClassGroup } from '../services/engine/registry';
import { doseAnchorMg } from '../services/engine/doseCredit';
import { dailyDose } from '../services/engine/regimenUtils';
import { SCENARIOS } from '../data/scenarios';
import { dosingWords, regimenDosesADay, dedupeCurrentRegimen, hasCongestion, loopDoseEffect } from '../services/engine/regimenUtils';
import { isActiveExposure } from '../services/engine/medicationExposure';
import type { Patient, RegimenMed, SimulationOutput } from '../types';

export { mk, runEngine, summaries, entry, gen3r, clonePatient, allText, MEDICATION_FORMULARY, NO_OPTION_PATHS };
export type { Patient, RegimenMed, SimulationOutput };

/** Per-patient generated checks shared by `verify` (a few hundred patients) and the sweep script (thousands): each returns the faults found for one patient and its output. */
export const R8_CHECKS: Record<string, (p: Patient, o: SimulationOutput, count: (k: string, n?: number) => void) => string[]> = {};

type Opt = SimulationOutput['scoredRegimens'][number];
export const modsOfOpt = (r: Opt) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// X12 / X6: the allergy reader
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const generic = (n: string) => n.replace(/\s*\(.*\)/, '').toLowerCase();
export const SEPARATOR_FORMS: Array<[string, string]> = [['slash', '/'], ['slash spaced', ' / '], ['slash left space', ' /'], ['comma', ','], ['comma spaced', ', '], ['semicolon', ';'], ['semicolon spaced', '; '], ['ampersand', '&'], ['ampersand spaced', ' & '], ['plus', '+'], ['plus spaced', ' + '], ['and', ' and '], ['newline', '\n'], ['space', ' ']];
/** Every ordered pair of formulary drugs under every separator: both are read (names typed as their generic names). Returns the faults. */
export function pairReadingFaults(): string[] {
    const out: string[] = [];
    for (const a of MEDICATION_FORMULARY) for (const b of MEDICATION_FORMULARY) {
        if (a === b) continue;
        for (const [label, sep] of SEPARATOR_FORMS) {
            const typed = `${generic(a.name)}${sep}${generic(b.name)}`;
            const got = new Set(resolveAllergy(typed, MEDICATION_FORMULARY));
            for (const want of [a, b]) if (!got.has(want.name)) out.push(`"${typed.replace(/\n/g, '\\n')}" (${label}) does not read ${want.name}`);
        }
    }
    return out;
}
/** The reviewer's 83-entry list (r8-engine al1.ts and al2.ts): [entry, must include any of (prefix), must not include (prefix)]. Misspellings and "diuretics" are not read (a note says so). */
export const ALLERGY_LIST: Array<[string, string[], string[]]> = [
    ['carbon dioxide', [], ['Valsartan', 'Candesartan', 'Losartan']], ['placebo', [], ['Captopril']], ['face swelling', [], ['Lisinopril', 'Enalapril', 'Ramipril', 'Captopril']], ['palace dust', [], ['Lisinopril']],
    ['limpets', [], []], ['gliflozinic', [], ['Dapagliflozin', 'Empagliflozin']], ['spironolactonex', [], ['Spironolactone']], ['metoprololic acid', [], ['Metoprolol Succinate']], ['carvedilolol', [], ['Carvedilol']],
    ['sartanic', [], ['Losartan']], ['mramen noodles', [], ['Spironolactone']], ['arbitrary', [], ['Losartan', 'Valsartan']], ['barbecue sauce', [], ['Losartan']], ['rhubarb', [], ['Losartan']], ['digitalis leaf tea', [], ['Digoxin']],
    ['low sodium diet', [], ['Sodium Zirconium Cyclosilicate']], ['ferric chloride', [], ['Ferric Carboxymaltose']], ['succinate', [], []], ['sodium', [], ['Sodium Zirconium Cyclosilicate']],
    ['sodium bicarbonate', [], ['Sodium Zirconium Cyclosilicate']], ['sodium polystyrene', [], ['Sodium Zirconium Cyclosilicate']], ['ferric', [], ['Ferric Carboxymaltose']],
    ['Lisinopril', ['Lisinopril'], []], ['lisinopril', ['Lisinopril'], []], ['  LISINOPRIL  ', ['Lisinopril'], []], ['Entresto', ['Sacubitril/Valsartan'], []], ['Zestril', ['Lisinopril'], []], ['Lasix', ['Furosemide'], []], ['HCTZ', ['Hydrochlorothiazide'], []],
    ['Toprol XL', ['Metoprolol Succinate'], []], ['Aldactone 25 mg', ['Spironolactone'], []], ['lisinopril 10 mg', ['Lisinopril'], []], ['valsartan', ['Valsartan', 'Sacubitril/Valsartan'], []], ['losartan', ['Losartan'], ['Valsartan', 'Candesartan', 'Sacubitril/Valsartan']],
    ['ibuprofen', [], ['Lisinopril']], ['allergic to lisinopril', ['Lisinopril'], []], ['rash from Lisinopril', ['Lisinopril'], []], ['ACE inhibitors - cough', ['Lisinopril', 'Enalapril', 'Ramipril', 'Captopril'], ['Losartan']],
    ['swelling of lips with Entresto', ['Sacubitril/Valsartan'], []], ['hives with metoprolol', ['Metoprolol Succinate'], ['Carvedilol']], ['penicillin and sulfa', [], ['Lisinopril']], ['peanut', [], []],
    ['lisinopril and carvedilol', ['Lisinopril', 'Carvedilol'], []], ['lisinopril, carvedilol', ['Lisinopril', 'Carvedilol'], []], ['lisinopril/carvedilol', ['Lisinopril', 'Carvedilol'], []], ['lisinopril; spironolactone; Lasix', ['Lisinopril', 'Spironolactone', 'Furosemide'], []],
    ['lisinopril & carvedilol', ['Lisinopril', 'Carvedilol'], []], ['lisinopril + carvedilol', ['Lisinopril', 'Carvedilol'], []], ['lisinopril carvedilol spironolactone', ['Lisinopril', 'Carvedilol', 'Spironolactone'], []],
    ['lisinopril (cough), carvedilol (rash)', ['Lisinopril', 'Carvedilol'], []], ['sulfa, lisinopril', ['Lisinopril'], []],
    ['beta blockers', ['Carvedilol', 'Metoprolol Succinate', 'Bisoprolol'], []], ['beta-blocker', ['Carvedilol'], []], ['ARBs', ['Losartan', 'Valsartan'], []], ['statins', [], ['Lisinopril']], ['SGLT2 inhibitors', ['Dapagliflozin', 'Empagliflozin'], []],
    ['spironolactone/eplerenone', ['Spironolactone', 'Eplerenone'], []], ['angiotensin receptor blockers', ['Losartan'], []], ['ACEI', ['Lisinopril'], []], ['ace-inhibitors', ['Lisinopril'], []], ['Ace Inhibitor Cough', ['Lisinopril'], []],
    ['potassium', [], ['Patiromer']], ['nitrates', ['Hydralazine'], []], ['IV iron', ['Ferric Carboxymaltose'], []],
    ['ACEi/ARB', ['Lisinopril', 'Losartan'], []], ['lisinopril/HCTZ', ['Lisinopril', 'Hydrochlorothiazide'], []], ['sulfa/lasix', ['Furosemide'], []], ['carvedilol/metoprolol', ['Carvedilol', 'Metoprolol Succinate'], []],
    ['Lisinopril / Carvedilol', ['Lisinopril', 'Carvedilol'], []], ['losartan/valsartan', ['Losartan', 'Valsartan'], []], ['beta-blockers/ACE inhibitors', ['Carvedilol', 'Lisinopril'], []], ['ace-inhibitor', ['Lisinopril'], []], ['ACE-I', ['Lisinopril'], []],
    ['sglt2-inhibitor', ['Dapagliflozin'], []], ['sglt2-inhibitors', ['Dapagliflozin', 'Empagliflozin'], []], ['lisinopril-induced cough', ['Lisinopril'], []], ['lisinopril-carvedilol', ['Lisinopril', 'Carvedilol'], []], ['lisinopril,carvedilol', ['Lisinopril', 'Carvedilol'], []],
    ['lisinopril\ncarvedilol', ['Lisinopril', 'Carvedilol'], []], ['mother allergic to Lisinopril', ['Lisinopril'], []], ['tolerates lisinopril fine', ['Lisinopril'], []], ['no allergy to lisinopril', ['Lisinopril'], []],
    // combination products written with a slash (X6b)
    ['Hydralazine/Isosorbide', ['Hydralazine/Isosorbide Dinitrate'], []], ['hydralazine/isosorbide dinitrate', ['Hydralazine/Isosorbide Dinitrate'], []], ['isosorbide dinitrate/hydralazine', ['Hydralazine/Isosorbide Dinitrate'], []], ['sacubitril/valsartan', ['Sacubitril/Valsartan'], ['Valsartan', 'Candesartan', 'Losartan']],
    ['Sacubitril / Valsartan', ['Sacubitril/Valsartan'], []],
];
export function allergyListFaults(): string[] {
    const out: string[] = [];
    for (const [e, inc, exc] of ALLERGY_LIST) {
        const got = resolveAllergy(e, MEDICATION_FORMULARY).map(x => x.replace(/ \(.*\)/, ''));
        for (const w of inc) if (!got.some(g => g.startsWith(w))) out.push(`"${e.replace(/\n/g, '\\n')}" should read ${w}; got ${JSON.stringify(got)}`);
        for (const w of exc) if (got.some(g => g.startsWith(w))) out.push(`"${e.replace(/\n/g, '\\n')}" should not read ${w}; got ${JSON.stringify(got)}`);
    }
    return out;
}

/** How a sweep mode prepares the generated patient (default: as generated). Returning null skips the seed. */
export const R8_PREP: Record<string, (p: Patient, sd: number) => Patient | null> = {};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// X11: the round 7 start rule (a drug an option starts is judged on the regimen the option produces) never empties the list and never loses a forced removal
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const takenDrugs = (p: Patient) => p.current_regimen.filter(isActiveExposure).filter(r => !r.med.facts?.short_course_addon);
/** The reviewer's patient: takes a GLP-1 receptor agonist and has a recorded allergy to it (stable, so no stop state hides the fault). */
export function glpAllergyPatient(p0: Patient): Patient | null {
    const g = takenDrugs(p0).find(x => /Semaglutide|Tirzepatide/.test(x.med.name)); if (!g) return null;
    const p = clonePatient(p0); p.scope_conditions = new Set(); p.allergies = new Set([g.med.name.replace(/ \(.*\)/, '').toLowerCase()]); p.potassium = 4.3; p.sbp = Math.max(p.sbp, 110); p.dbp = Math.min(p.dbp, p.sbp - 30); p.pulse = 80; p.rhythm = 'Sinus'; p.is_pregnant = false;
    p.comorbidities = new Set([...p.comorbidities].filter(x => !/Block|Sick|Anuria|Angioedema|Medullary|MEN2|Gastroparesis|Pancreatitis/.test(x))); p.discontinued_meds = []; p.nyha_class = 'II'; p.volume_status.current_weight_kg = p.volume_status.dry_weight_kg; p.volume_status.exam_findings = new Set();
    return p;
}
/** Allergy to one drug the patient takes, rotating through the regimen by seed so every class is covered over a sweep. */
export function oneDrugAllergyPatient(p0: Patient, sd: number): Patient | null {
    const t = takenDrugs(p0).sort((a, b) => (a.med.name < b.med.name ? -1 : 1)); if (t.length === 0) return null;
    const pick = t[sd % t.length]; const p = clonePatient(p0); p.scope_conditions = new Set();
    p.allergies = new Set([...(p.allergies ?? []), pick.med.name.replace(/ \(.*\)/, '').toLowerCase()]);
    return p;
}
R8_PREP.x11 = (p, sd) => (sd % 2 === 0 ? glpAllergyPatient(p) ?? oneDrugAllergyPatient(p, sd) : oneDrugAllergyPatient(p, sd));
const forcedSources = (o: SimulationOutput): Set<string> => new Set(o.scoredRegimens.flatMap(r => modsOfOpt(r).filter(m => m.mandatory && (m.action === 'remove' || m.action === 'swap') && m.source).map(m => m.source!.med.name)));
/** Rule on (the output given) against rule off (run here): never an empty list that had options, never a forced removal lost; and a drug taken and recorded as an allergy always raises ALLERGY CONFLICT. */
R8_CHECKS.x11 = (p, o, count) => {
    const out: string[] = [];
    const wasOn = START_RULE.enabled; START_RULE.enabled = false;
    let off: SimulationOutput; try { off = runEngine(clonePatient(p)); } finally { START_RULE.enabled = wasOn; }
    count('counterfactual pairs');
    if (off.scoredRegimens.length > 0 && o.scoredRegimens.length === 0) out.push(`the rule empties a list that has ${off.scoredRegimens.length} options without it`);
    if (off.scoredRegimens.length > 0) count('lists with options without the rule');
    if (off.scoredRegimens.length !== o.scoredRegimens.length || JSON.stringify(off.scoredRegimens.map(r => summaries(r))) !== JSON.stringify(o.scoredRegimens.map(r => summaries(r)))) count('lists the rule changes');
    const lost = [...forcedSources(off)].filter(n => !forcedSources(o).has(n));
    if (off.scoredRegimens.length > 0) count('forced removals without the rule', forcedSources(off).size);
    if (lost.length) out.push(`forced removal of ${lost.join(', ')} present without the rule and absent with it`);
    const allergic = expandAllergies(p.allergies ?? new Set<string>(), MEDICATION_FORMULARY).expanded;
    for (const r of p.current_regimen) if (allergic.has(r.med.name)) {
        count('taken and allergic');
        if (!o.clinicalAlerts.some(a => a.startsWith(`ALLERGY CONFLICT: ${r.med.name} `))) out.push(`${r.med.name} is taken and recorded as an allergy; no ALLERGY CONFLICT alert`);
        if (o.scoredRegimens.length > 0) for (const [i, opt] of o.scoredRegimens.entries()) if (opt.regimen.some(x => x.med.name === r.med.name) && !r.exposure?.status?.match(/held|completed/)) out.push(`option ${i + 1} still contains ${r.med.name}, recorded as an allergy`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// X1: the reason a duplicate clean-up keeps one drug is true by the engine's own figures (larger, equal and the tie-break, for every class)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const formularyIndex = (name: string) => MEDICATION_FORMULARY.findIndex(m => m.name === name);
/** Faults in one DUPLICATE THERAPY sentence, tested against the regimen: "larger" only where strictly larger, "equal" only where equal and the kept drug is first in the formulary, percentages ordered as claimed. */
export function duplicateReasonFaults(p: Patient, alert: string, excludedNames: string[] = []): string[] {
    const out: string[] = [];
    const m = /treats (.+?) as the one to keep and (.+?) as the duplicate to remove because (.+?)\. (?:What each option does|Confirm which one)/.exec(alert); if (!m) return [`unparsed duplicate alert: ${alert.slice(0, 120)}`];
    const kept = m[1], removedNames = m[2].split(', '), basis = m[3];
    const find = (n: string) => p.current_regimen.find(r => r.med.name === n);
    const k = find(kept), rem = removedNames.map(find);
    if (!k || rem.some(r => !r)) return [`names a drug the patient does not take: ${kept} / ${removedNames.join(', ')}`];
    const equiv = (r: RegimenMed) => dailyDose(r) * ((r.med.facts as { verified_furosemide_equivalent_per_mg?: number } | undefined)?.verified_furosemide_equivalent_per_mg ?? NaN);
    if (/it is the larger loop diuretic dose/.test(basis)) { for (const r of rem) if (!(equiv(k) > equiv(r!) + 1e-9)) out.push(`says larger but ${kept} is ${equiv(k)} and ${r!.med.name} is ${equiv(r!)} furosemide equivalents`); }
    else if (/the doses are equal in furosemide equivalents/.test(basis)) {
        for (const r of rem) { if (Math.abs(equiv(k) - equiv(r!)) > 1e-9) out.push(`says equal but ${equiv(k)} and ${equiv(r!)}`); if (!excludedNames.includes(r!.med.name) && !(formularyIndex(kept) < formularyIndex(r!.med.name))) out.push(`says the kept drug is first in the formulary but ${r!.med.name} is before it`); }
        const figs = [...basis.matchAll(/about ([\d.]+) mg/g)].map(x => Number(x[1])); if (figs.length < 2 || new Set(figs).size !== 1) out.push(`equal claim beside figures ${figs.join(', ')}`);
    } else if (/are at the same share of/.test(basis)) {
        const frac = (r: RegimenMed) => /daily dose reached in their trials/.test(basis) ? dailyDose(r) / doseAnchorMg(r, p)! : dailyDose(r) / ((r.med.facts as { max_daily_dose?: number } | undefined)?.max_daily_dose ?? NaN);
        for (const r of rem) { if (Math.abs(frac(k) - frac(r!)) > 1e-9) out.push(`says the same share but ${frac(k)} and ${frac(r!)}`); if (!excludedNames.includes(r!.med.name) && !(formularyIndex(kept) < formularyIndex(r!.med.name))) out.push(`says the kept drug is first in the formulary but ${r!.med.name} is before it`); }
    } else if (/ is at ([\d.]+)% of/.test(basis)) {
        const figs = [...basis.matchAll(/at ([\d.]+)%/g)].map(x => Number(x[1])); if (figs.length < 2 || !figs.slice(1).every(f => figs[0] > f)) out.push(`percentages not ordered as the kept drug being larger: ${figs.join(', ')}`);
    } else if (!/no common dose scale/.test(basis)) out.push(`an unknown basis: ${basis.slice(0, 100)}`);
    // every option's removal line for a duplicate repeats the same reason
    return out;
}
R8_CHECKS.x1 = (p, o, count) => {
    const out: string[] = [];
    for (const a of o.clinicalAlerts.filter(x => x.startsWith('DUPLICATE THERAPY'))) {
        count('duplicate alerts'); out.push(...duplicateReasonFaults(p, a, o.excludedMedications.map(e => e.name)));
        const basis = /because (.+?)\. (?:What each option|Confirm which one)/.exec(a)?.[1];
        if (/the doses are equal/.test(basis ?? '')) count('equal-dose duplicates');
        for (const [i, r] of o.scoredRegimens.entries()) for (const mm of modsOfOpt(r)) if (mm.duplicate_cleanup && mm.action === 'remove') {
            count('duplicate removal lines');
            if (/\bbecause\b/.test(mm.summary) || /larger loop/.test(mm.summary)) out.push(`option ${i + 1}: the removal line gives the alert's reasoning: ${mm.summary.slice(0, 120)}`);
        }
    }
    return out;
};
/** Every class group with two or more drugs (RAAS and MRA are handled by their own alerts), every ordered pair, every dose pair: the minimal duplicate patient. */
export function duplicateClassPatients(): Array<{ label: string; p: Patient }> {
    const out: Array<{ label: string; p: Patient }> = [];
    const groups = new Map<string, typeof MEDICATION_FORMULARY>();
    for (const m of MEDICATION_FORMULARY) { if (m.facts?.short_course_addon) continue; const g = getMedicationClassGroup(m.drug_class); if (g === 'RAAS Inhibitor' || g === 'MRA') continue; groups.set(g, [...(groups.get(g) ?? []), m]); }
    for (const [g, ms] of groups) for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) for (const da of ms[i].available_doses) for (const db of ms[j].available_doses) {
        const reg = [{ med: ms[i], dose: da, selected_frequency: da.frequency_options[0] }, { med: ms[j], dose: db, selected_frequency: db.frequency_options[0] }] as RegimenMed[];
        const p = mk({ lvef: 30, nyha_class: 'III', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, findings: ['Edema (2+)'], dry: 80, cur: 84 }, reg);
        out.push({ label: `${g}: ${ms[i].name} ${da.strength} ${da.frequency_options[0]} + ${ms[j].name} ${db.strength} ${db.frequency_options[0]}`, p });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// X2: a monitoring row, withheld reason or gap line says "start" only of a drug the patient does not take (and never names a second drug of a class the patient takes)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** Wording about starting that is not an instruction to start a drug later: negations, dose and label wording, "after a start or increase", new-start explanations. Anything else with the word start is an unknown template for review. */
const NEUTRAL_START = [/Restart or raise the diuretic if congestion returns/,/withhold the MRA \(label rule; restart at a low dose once potassium is below 5\.5\)/, /withhold; restart at a low dose once potassium is below 5\.5/,/\b(?:do|does|did|is|are|was|were|not|never|no)\b[^.;]*\b(?:start|started|starting)\b/i, /\bstart (?:dose|tier|limit|number|criteri|as well|25 mg|at ~)/i, /\bstarting (?:dose|tier|criteri)/i, /after (?:a|an|any) [^.;]*\bstart\b/i, /\bnew [^.;]*\bstart\b/i, /\bstart(?:ed|s)? (?:a|an|the)? ?(?:new|reduced)/i,
    /\bbefore (?:any|each) [^.;]*\bstart\b/i, /\ballow a reduced start\b/i, /\breduced start\b/i, /\bLabel: start\b/i, /\bstart or increase\b/i, /\bwhen_started\b/i, /\bBegin at a reduced starting dose\b/i, /\bstart (?:at|from)\b/i,
    /\ba new start\b|\bnew starts?\b|\bis held\b/i, /\bdo not START\b/i, /\bblank \(not entered\): a new /i, /\bInformation required before starting\b/i, /\breason for the recorded hold and a deliberate restart or substitution decision\b/i];
const POSITIVE_START: Array<{ kind: string; re: RegExp }> = [
    { kind: 'start the MRA once', re: /\bstart the MRA once\b/ }, { kind: 'start it once', re: /\bstart it once it is below\b/ }, 
    { kind: 'staged row', re: /^Repeat potassium; start (.+?) (?:once below 5\.0|if 5\.2 or lower)$/ }, { kind: 'start once 5.2 or lower', re: /\bstart once (?:it is )?5\.2 or lower\b/ },
];
/** Every string of one output about starting a drug later, tested against what the patient takes. */
R8_CHECKS.x2 = (p, o, count) => {
    const out: string[] = [];
    const taken = takenDrugs(p).map(r => r.med.name), takenGroups = new Set(takenDrugs(p).map(r => getMedicationClassGroup(r.med.drug_class)));
    const classOfWord = (w: string): string | null => /\bMRA\b|mineralocorticoid/i.test(w) ? 'MRA' : /RAAS|ACE inhibitor|ARB|ARNI|renin/i.test(w) ? 'RAAS Inhibitor' : null;
    const test = (where: string, text: string, drug?: string) => {
        if (!/\b(re)?start\b/i.test(text)) return;
        const pos = POSITIVE_START.find(k => k.re.test(text));
        if (!pos) { if (!NEUTRAL_START.some(n => n.test(text))) out.push(`${where}: unknown wording about starting: ${text.slice(0, 110)}`); return; }
        count(`start sentences (${pos.kind})`);
        const named: string[] = drug ? [drug] : [];
        const row = pos.re.exec(text);
        if (pos.kind === 'staged row' && row) for (const n of row[1].split(', ')) { const m = MEDICATION_FORMULARY.find(x => x.name.replace(/\s*\(.*\)/, '') === n); if (m) named.push(m.name); }
        const group = drug ? getMedicationClassGroup(MEDICATION_FORMULARY.find(m => m.name === drug)?.drug_class ?? '') : classOfWord(text) ?? (named[0] ? getMedicationClassGroup(MEDICATION_FORMULARY.find(m => m.name === named[0])?.drug_class ?? '') : null);
        for (const n of named) if (taken.includes(n)) out.push(`${where}: says to start ${n}, which the patient takes: ${text.slice(0, 120)}`);
        const g2 = group === 'MRA' || named.some(n => getMedicationClassGroup(MEDICATION_FORMULARY.find(m => m.name === n)?.drug_class ?? '') === 'MRA') ? 'MRA' : group;
        if (g2 && takenGroups.has(g2)) out.push(`${where}: says to start a drug of the class ${g2}, which the patient already takes (${taken.filter(t => getMedicationClassGroup(MEDICATION_FORMULARY.find(m => m.name === t)?.drug_class ?? '') === g2).join(', ')}): ${text.slice(0, 120)}`);
    };
    for (const e of o.excludedMedications) { test(`withheld ${e.name}`, e.reason, e.name); for (const w of e.why ?? []) test(`withheld ${e.name} (detail)`, w, e.name); }
    for (const g of o.gdmtGaps ?? []) test('gap line', g);
    for (const m of o.monitoringPlan) { test('monitoring row', m.test); test('monitoring row details', m.details); }
    for (const [i, r] of o.scoredRegimens.entries()) for (const m of r.monitoring_plan ?? []) { test(`option ${i + 1} monitoring row`, m.test); test(`option ${i + 1} monitoring row details`, m.details); }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// X3: one doses-a-day count for every text; a single course dose (IV iron, frequency "once") is not a daily dose
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** An independent count: doses a day of the drugs taken daily or more often; a weekly, every-other-day or single-dose drug is counted apart. */
export const independentDailyDoses = (regimen: RegimenMed[]): { doses: number; drugs: number; single: number } => {
    const per: Record<string, number> = { qd: 1, bid: 2, tid: 3, qid: 4 }; let doses = 0, drugs = 0, single = 0;
    for (const r of regimen) { const f = r.selected_frequency; if (f === 'once') single++; else if (f === 'weekly' || f === 'qod') continue; else { drugs++; doses += per[f] ?? 1; } }
    return { doses, drugs, single };
};
R8_CHECKS.x3 = (p, o, count) => {
    const out: string[] = [];
    const now = dedupeCurrentRegimen(p.current_regimen).regimen.filter(isActiveExposure);
    for (const [i, r] of o.scoredRegimens.entries()) {
        count('options');
        const lab = r.trade_offs?.find(t => t.dimension === 'Dosing burden')?.label ?? '';
        const m = /^(?:More|Fewer) doses a day than now \((\d+(?:\.\d)?), now (\d+(?:\.\d)?)\)|^Same doses a day as now \((\d+(?:\.\d)?)\)/.exec(lab); if (!m) { out.push(`option ${i + 1}: label is not a comparison: ${lab}`); continue; }
        const a = Number(m[1] ?? m[3]), b = Number(m[2] ?? m[3]);
        const ia = independentDailyDoses(r.regimen).doses, ib = independentDailyDoses(now).doses;
        if (a !== ia || b !== ib) out.push(`option ${i + 1}: label says (${a}, now ${b}); the doses taken daily are (${ia}, now ${ib})`);
        if (r.regimen.some(x => x.selected_frequency === 'once')) { count('options with a single-dose drug'); if (!/a single dose/.test(dosingWords(r.regimen))) out.push(`option ${i + 1}: a single-dose drug is not described as a single dose: ${dosingWords(r.regimen)}`); }
        if (regimenDosesADay(r.regimen) !== ia) out.push(`option ${i + 1}: regimenDosesADay ${regimenDosesADay(r.regimen)} differs from ${ia}`);
        const w = dosingWords(r.regimen); const claimed = Number(/^(\d+) doses? a day/.exec(w)?.[1] ?? 0); if (claimed !== ia) out.push(`option ${i + 1}: the sentence "${w}" says ${claimed} doses a day, not ${ia}`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// X13 / X14 / X4: sentences about the loop diuretic are true of the options on the same screen (a raise, a start, an addition, a net-unchanged step)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const isOralLoopMod = (m: { action: string; target?: { med: { drug_class: string; facts?: { short_course_addon?: boolean } } } }) => (m.action === 'add' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Loop Diuretic' && !m.target.med.facts?.short_course_addon;
const addsFuroscix = (r: Opt) => modsOfOpt(r).some(m => m.action === 'add' && m.target?.med.facts?.short_course_addon && m.target.med.drug_class === 'Loop Diuretic');
R8_CHECKS.loop = (p0, o, count) => {
    const out: string[] = [];
    // the patient as the engine reads the regimen: active drugs only, a drug entered twice resolved
    const p: Patient = { ...p0, current_regimen: dedupeCurrentRegimen(p0.current_regimen).regimen.filter(isActiveExposure) };
    const raisesOrStarts = (r: Opt) => modsOfOpt(r).some(isOralLoopMod);
    const netUp = (r: Opt) => loopDoseEffect(p, r) === 'raises';
    for (const a of o.clinicalAlerts) {
        if (/so no dose increase is suggested/.test(a)) { count('severe CKD "no dose increase" alerts'); o.scoredRegimens.forEach((r, i) => { if (raisesOrStarts(r)) out.push(`alert says no dose increase is suggested; option ${i + 1} ${modsOfOpt(r).find(isOralLoopMod)!.summary}`); }); }
        if (/^SEVERE CKD DIURETIC ALERT.*although (?:option|every option|the option)/.test(a)) { count('severe CKD alerts reconciled with an option that raises'); if (!o.scoredRegimens.some(raisesOrStarts)) out.push('alert says an option raises the loop but none does'); }
        if (/every option includes one\./.test(a)) o.scoredRegimens.forEach((r, i) => { if (modsOfOpt(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'Loop Diuretic') && loopDoseEffect(p, r) !== 'raises') out.push(`alert says every option includes a loop start or increase; option ${i + 1} does not raise the total loop dose`); });
        if (/every option includes a loop diuretic step; where that step comes with the removal/.test(a)) { count('net-unchanged alert wording'); if (!o.scoredRegimens.some(r => loopDoseEffect(p, r) !== 'raises' && modsOfOpt(r).some(isOralLoopMod))) out.push('says a step does not raise the total but none does'); }
    }
    for (const [i, r] of o.scoredRegimens.entries()) {
        const notes = r.warnings.filter(w => /loop diuretic/i.test(w));
        // X13: a loop raise with no recorded congestion says why; X4: a net-unchanged step says so
        if (netUp(r) && !hasCongestion(p) && modsOfOpt(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'Loop Diuretic')) { count('loop raises without recorded congestion'); if (!notes.some(w => /raises the loop diuretic although no congestion is recorded/.test(w))) out.push(`option ${i + 1} raises the loop with no congestion recorded and no reason on it`); }
        if (modsOfOpt(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'Loop Diuretic' && !m.target.med.facts?.short_course_addon) && loopDoseEffect(p, r) !== 'raises') { count('net-unchanged loop steps'); if (!notes.some(w => /(leaves|lowers) the total oral loop diuretic dose/.test(w))) out.push(`option ${i + 1} has a loop step that leaves the total unchanged and does not say so`); }
        // X14: "No loop diuretic start or increase is available" speaks of oral loop steps only and is not printed beside an option that starts or raises an oral loop
        for (const w of notes) {
            if (/^Drug note: No loop diuretic start or increase is available today: (the loop diuretic is already|a prerequisite is missing for the loop)/.test(w)) out.push(`option ${i + 1}: the note speaks of "the loop diuretic" without saying oral: ${w.slice(0, 100)}`);
            if (/^Drug note: No oral loop diuretic start or increase is available today/.test(w)) { count('oral loop notes'); if (addsFuroscix(r)) count('oral loop notes beside Furoscix'); if (raisesOrStarts(r)) out.push(`option ${i + 1}: says no oral loop start or increase is available and the option does "${modsOfOpt(r).find(isOralLoopMod)!.summary}"`); }
        }
        // X14 / X4: the display-rule sentence says what the option does
        const sb = r.shown_because ?? '';
        if (/^Includes a diuretic increase:/.test(sb)) { count('"Includes a diuretic increase"'); if (!(loopDoseEffect(p, r) === 'raises' && modsOfOpt(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'Loop Diuretic'))) out.push(`option ${i + 1}: "Includes a diuretic increase" and the option does: ${modsOfOpt(r).filter(m => m.target?.med.drug_class === 'Loop Diuretic').map(m => m.summary).join(' ; ') || 'no loop change'}`); }
        if (/^Includes the addition of a loop diuretic/.test(sb)) { count('"Includes the addition of a loop diuretic"'); if (!modsOfOpt(r).some(m => m.action === 'add' && isOralLoopMod(m))) out.push(`option ${i + 1}: says a loop diuretic is added and none is`); }
        if (/and no other option raises or starts an oral loop/.test(sb)) o.scoredRegimens.forEach((q, j) => { if (j !== i && modsOfOpt(q).some(isOralLoopMod)) out.push(`option ${i + 1} says no other option raises or starts an oral loop diuretic; option ${j + 1} does`); });
        if (/^Includes a diuretic addition \(/.test(sb)) count('"Includes a diuretic addition"');
        if (/no other option raises the loop diuretic\b/.test(sb)) out.push(`option ${i + 1}: old wording "no other option raises the loop diuretic"`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// X5: potassium: an alert or warning that says to recheck potassium has a potassium row in the plan; 5.5 to 5.9 with no raiser has a visible caution; below 3.5 has a row
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const RECHECK_K = /\b(?:re-?check|repeat)(?:ing)?\s+(?:the\s+)?(?:serum\s+)?potassium\b|\bpotassium\b[^.;]{0,40}\bre-?checked?\b/i;
const kRow = (rows: Array<{ test: string }>) => rows.some(m => /potassium/i.test(m.test));
R8_PREP.x5 = (p, sd) => { const q = clonePatient(p); q.potassium = [3.3, 5.0, 5.2, 5.4, 5.6, 5.9, 4.4, 3.4][sd % 8]; return q; };
R8_CHECKS.x5 = (p, o, count) => {
    const out: string[] = [];
    const k = Math.round(p.potassium * 10) / 10;
    const activeRaiser = takesRaasOrMra({ ...p, current_regimen: p.current_regimen.filter(isActiveExposure) });
    for (const a of o.clinicalAlerts) if (RECHECK_K.test(a)) { count('alerts that say to recheck potassium'); if (!kRow(o.monitoringPlan)) out.push(`alert "${a.slice(0, 60)}" says to recheck potassium; the plan has no potassium row (${o.monitoringPlan.map(m => m.test.slice(0, 30)).join(' | ')})`); }
    for (const [i, r] of o.scoredRegimens.entries()) for (const w of r.warnings) if (RECHECK_K.test(w)) { count('option warnings that say to recheck potassium'); if (!kRow([...(r.monitoring_plan ?? []), ...o.monitoringPlan])) out.push(`option ${i + 1}: warning "${w.slice(0, 60)}" says to recheck potassium; no potassium row`); }
    if (k >= 5.5 && k < 6.0 && !activeRaiser) {
        count('potassium 5.5 to 5.9 with no raiser');
        if (o.scoredRegimens.length > 0 && !o.clinicalAlerts.some(a => /^ELEVATED POTASSIUM: .*Confirm the value/.test(a))) out.push(`potassium ${k} with no renin-angiotensin drug or MRA: no visible caution`);
        if (!o.monitoringPlan.some(m => /^Repeat potassium and look for the cause/.test(m.test))) out.push(`potassium ${k} with no raiser: no monitoring row`);
    // R10 A10 (rewritten): on a raiser at 5.5 to 5.9 the caution may stand, worded for such a patient, when no per-drug alert names the value.
    } else if (o.clinicalAlerts.some(a => /^ELEVATED POTASSIUM/.test(a) && !(activeRaiser && k >= 5.5 && k < 6.0 && /which raises? potassium/.test(a)))) out.push(`the elevated-potassium caution at potassium ${k} on a raiser: ${activeRaiser}`);
    if (k > 0 && k < 3.5) { count('potassium below 3.5'); if (!o.monitoringPlan.some(m => /^Correct potassium and recheck it/.test(m.test))) out.push(`potassium ${k}: no row to correct and recheck it`); }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// X7 / X15a: displayed text hygiene as classes: no shouted word inside a sentence, no empty parentheses, no em or en dash, no "engine"
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** Words in capitals that may stand inside a sentence: true abbreviations, trial names and units. Anything else in capitals inside a sentence is a shouted word. */
export const ALLOWED_CAPS = new Set(['ACE', 'ACEI', 'ACC', 'AF', 'AFIB', 'AHA', 'AKI', 'ARB', 'ARBS', 'ARNI', 'AV', 'BMI', 'BMP', 'BNP', 'BP', 'BUN', 'CAD', 'CKD', 'COPD', 'CRT', 'CYP', 'CYP3A4', 'DBP', 'DDI', 'DOAC', 'ECG', 'EF', 'ESC', 'FDA', 'GFR', 'GI', 'GLP', 'GIP', 'HF', 'HFSA', 'ICD', 'IV', 'JVP', 'KCCQ', 'LAVI', 'LVAD', 'LVEDD', 'LVEF', 'MAP', 'MEN2', 'MRA', 'MRAS', 'MTC', 'NSAID', 'NSAIDS', 'NT', 'NYHA', 'PDE5', 'QRS', 'QT', 'QTC', 'RAAS', 'SBP', 'SC', 'SGLT2', 'SGLT', 'SGLT2I', 'SZC', 'TSAT', 'UK', 'US', 'LBBB', 'HFREF', 'HFPEF', 'HFMREF', 'HFIMPEF', 'ISDN', 'H', 'II', 'III', 'IV', 'I', 'DASH', 'EKG', 'MRI', 'CT', 'HCTZ', 'DM', 'OTC', 'PRN', 'HR', 'RR', 'SSRI', 'TZD', 'ATP', 'DNA', 'BID', 'TID', 'QID', 'QD', 'GDMT', 'COX-2', 'COX2', 'CHA2DS2-VA', 'CHA2DS2VA', 'HEAAL', 'DKA', 'ANA', 'CBC', 'ESRD', 'RRR', 'LVH', 'CLOROTIC', 'NEJM', 'IBD', 'PEF', 'TMP-SMX', 'TMPSMX', 'CYP3A', 'GLP-1', 'GLP1', 'NEED', 'HELP']);
const TRIAL_NAMES = /\b(?:PARADIGM|DAPA|EMPEROR|DELIVER|TOPCAT|FINEARTS|VICTORIA|SHIFT|GALACTIC|DIG|SUMMIT|STEP|REALIZE|DIAMOND|RACE|ONTARGET|AFFIRM|CHARM|SOLVD|RALES|EMPHASIS|TRANSFORM|STRONG|HF|FAIR|AFFIRM-AHF|IRONMAN|HEART-FID|PIONEER|ATMOSPHERE|PEP|COPERNICUS|MERIT|CIBIS|SENIORS|BEAUTIFUL|CONFIRM|A-HeFT|AHeFT|DAPA-HF|EMPEROR-Preserved|EMPEROR-Reduced|DELIVER|CHAMP|SURMOUNT|STEP-HFpEF|FIDELIO|FIGARO|EMPA|REDEFINE)\b/;
/** Shouted words in one displayed string: a word of three or more capitals that is not an allowed abbreviation, after the heading (the text before the first ": ") is set aside. */
export function shoutedWords(text: string): string[] {
    const sep = text.indexOf(': '); const pre = sep > 0 ? text.slice(0, sep).replace(/HFimpEF/g, 'HFIMPEF') : ''; const heading = sep > 0 && sep < 90 && pre === pre.toUpperCase(); const body = heading ? text.slice(sep + 2) : text;
    return (body.match(/\b[A-Z][A-Z0-9-]{2,}\b/g) ?? []).filter(w => !ALLOWED_CAPS.has(w.replace(/-/g, '')) && !ALLOWED_CAPS.has(w) && !TRIAL_NAMES.test(w) && !/^\d/.test(w));
}
R8_CHECKS.x7 = (_p, o, count) => {
    const out: string[] = [];
    for (const t of displayedStrings(o)) {
        count('strings scanned');
        for (const w of shoutedWords(t)) out.push(`shouted word "${w}" in: ${t.slice(Math.max(0, t.indexOf(w) - 30), t.indexOf(w) + 40)}`);
        if (/\(\s*\)/.test(t)) out.push(`empty parentheses in: ${t.slice(0, 100)}`);
        if (/[–—]/.test(t)) out.push(`a dash in: ${t.slice(0, 100)}`);
        if (/\bengine\b/i.test(t)) out.push(`the word engine in: ${t.slice(0, 100)}`);
        if (/\bNYHA (?:I|II|III|IV)-(?:I|II|III|IV)\b/.test(t)) out.push(`hyphenated NYHA range in: ${t.slice(0, 100)}`);
    }
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// X15: stop-screen wording follows the alerts' own text; an identical warning once; rehabilitation prompt; finerenone gap; class names; duplicate alert on a no-option screen
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
/** An independent reading of "this alert tells the clinician to stop, withhold, reduce, deprescribe, review or switch a drug": a sentence that BEGINS with the imperative and names a drug or class. */
const IMPERATIVE = /(?:^|[.;:] )(?:Stop|Deprescribe|Withhold|Reduce|Switch|Review|Replace|Halve|Discontinue)\b[^.;]*\b(?:drug|drugs|agent|agents|diuretic|beta-blocker|MRA|ACE|ARB|RAAS|NSAID|thiazide|nitrate|Amiloride|Triamterene|Spironolactone|Eplerenone|Carvedilol|Metoprolol|Dapagliflozin|Empagliflozin|[A-Z][a-z]+ide|[A-Z][a-z]+ol|[A-Z][a-z]+pril|[A-Z][a-z]+sartan)\b/;
const HEADS_NOT_DRUG_CHANGE = ['ALLERGY', 'POTASSIUM HOLD', 'PARTIAL REVIEW', 'MEDICATION RECONCILIATION', 'ADVANCED HEART FAILURE', 'LOW POTASSIUM'];
R8_CHECKS.x15 = (p, o, count) => {
    const out: string[] = [];
    // (d) an identical warning is printed once on an option
    for (const [i, r] of o.scoredRegimens.entries()) if (new Set(r.warnings).size !== r.warnings.length) out.push(`option ${i + 1} prints an identical warning twice: ${r.warnings.find((w, j) => r.warnings.indexOf(w) !== j)!.slice(0, 80)}`);
    // (e) the rehabilitation prompt is not beside an alert that says the patient is not stable
    if (o.clinicalAlerts.some(a => /^CARDIAC REHABILITATION/.test(a)) && o.clinicalAlerts.some(a => /^(ADVANCED HEART FAILURE ALERT|SLOW HEART RATE|VERY HIGH RISK|ACUTE DECOMPENSATION|POOR PERFUSION)/.test(a))) out.push('cardiac rehabilitation prompt beside an alert that says the patient is not stable');
    // (f) finerenone taken and the MRA listed as missing: the gap line says why
    if (p.current_regimen.some(r => r.med.drug_class === 'nsMRA' && isActiveExposure(r))) for (const g of o.gdmtGaps ?? []) if (/^Mineralocorticoid receptor antagonist/.test(g)) { count('MRA gap lines beside finerenone'); if (!/is taken, but it fills the MRA slot only at an ejection fraction of 41 or higher/.test(plainTextSafe(g))) out.push(`MRA gap line beside finerenone gives no reason: ${g.slice(0, 100)}`); }
    // (g) classes and drugs named in clinical words
    const why = JSON.stringify([o.why_first ?? null, o.excludedMedications.map(e => e.reason)]);
    for (const m of why.matchAll(/Starting ([^"]*?) is withheld because information is missing/g)) { count('withheld-class sentences'); if (/\b(Inotrope|Thiazide-like Diuretic|Loop Diuretic|K\+ Binder|Vasodilator|If Inhibitor)\b|\bfuroscix\b/.test(m[1])) out.push(`class or drug named in internal words: ${m[1]}`); }
    // (h) a screen with no option never speaks of options in the duplicate-therapy alert
    if (o.scoredRegimens.length === 0) for (const a of o.clinicalAlerts) if (/^DUPLICATE THERAPY/.test(a) && /\boptions?\b/i.test(a)) out.push(`no-option screen: duplicate therapy alert mentions options: ${a.slice(-90)}`);
    // (b) on a screen with no option, an alert that tells the clinician to stop, withhold, reduce, review or switch a drug is never beside "no medication change is proposed"
    if (o.scoredRegimens.length === 0) {
        const imperative = o.clinicalAlerts.filter(a => !HEADS_NOT_DRUG_CHANGE.some(h => a.startsWith(h)) && IMPERATIVE.test(a.slice(a.indexOf(': ') + 2)));
        const words = [o.why_first?.stop ?? '', ...(o.decisionReadiness?.available ?? [])];
        if (imperative.length > 0) { count('no-option screens with an imperative drug alert'); for (const w of words) if (/no medication change is proposed|no drug can be (started|changed)/i.test(w)) out.push(`"${w.slice(0, 70)}" beside ${imperative[0].slice(0, 60)}`); }
    }
    return out;
};
const plainTextSafe = (t: string) => t.replace(/\s+—\s+/g, ': ');

// X8: wording true of the options (outpatient sentence, ARNI raise at a low pressure, volume-depletion priority, a start blocked by a state)
R8_CHECKS.x8 = (p, o, count) => {
    const out: string[] = [];
    for (const a of o.clinicalAlerts) {
        if (/^ACUTE DECOMPENSATION/.test(a) && o.scoredRegimens.length > 0) { count('acute decompensation alerts with options'); if (/well enough to be managed as an outpatient/.test(a) || !/The options below apply only if the patient is judged well enough to stay an outpatient\./.test(a)) out.push('the outpatient sentence is not the conditional one'); }
        if (/^VOLUME DEPLETION/.test(a) && /priority intervention before adding new agents/.test(a)) { count('priority sentence kept'); for (const [i, r] of o.scoredRegimens.entries()) if (modsOfOpt(r).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target && !['Loop Diuretic', 'Thiazide-like Diuretic'].includes(m.target.med.drug_class))) out.push(`volume depletion priority beside option ${i + 1} that adds ${modsOfOpt(r).find(m => m.action === 'add')?.summary}`); }
        if (/^VOLUME DEPLETION/.test(a) && /what each option does:/.test(a)) count('priority sentence rewritten');
    }
    if (p.sbp > 0 && p.sbp < 100) for (const [i, r] of o.scoredRegimens.entries()) if (modsOfOpt(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'ARNI') && !modsOfOpt(r).some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.drug_class === 'ARNI')) { count('ARNI raises at a systolic pressure below 100'); if (!r.warnings.some(w => /raises sacubitril\/valsartan at a systolic pressure of/.test(w))) out.push(`option ${i + 1} raises the ARNI at ${p.sbp} with no low-pressure note`); }
    const why = JSON.stringify(o.why_first?.gaps ?? []);
    for (const m of why.matchAll(/means dropping one\.[^"]*?Not started: no beta-blocker is started during acute decompensation/g)) out.push(`a gap line gives two reasons: ${m[0].slice(0, 100)}`);
    return out;
};

// X12 / X6 per patient: two drugs typed in one entry with a rotating separator: neither is in any option's regimen (a taken drug is removed, an untaken drug is not started)
const ALLERGY_PAIR = (p: Patient, sd: number): [string, string, string] | null => {
    const t = takenDrugs(p).sort((a, b) => (a.med.name < b.med.name ? -1 : 1)); if (t.length < 1) return null;
    const others = MEDICATION_FORMULARY.filter(m => !m.facts?.short_course_addon && !t.some(x => x.med.name === m.name));
    const a = t[sd % t.length].med, b = (sd % 3 === 0 && t.length > 1 ? t[(sd + 1) % t.length].med : others[(sd * 7) % others.length]);
    if (a.name === b.name) return null;
    return [generic(a.name), generic(b.name), SEPARATOR_FORMS[sd % SEPARATOR_FORMS.length][1]];
};
R8_PREP.x12 = (p, sd) => { const pair = ALLERGY_PAIR(p, sd); if (!pair) return null; const q = clonePatient(p); q.scope_conditions = new Set(); q.allergies = new Set([`${pair[0]}${pair[2]}${pair[1]}`]); return q; };
R8_CHECKS.x12 = (p, o, count) => {
    const out: string[] = [];
    const entryText = [...(p.allergies ?? [])][0] ?? ''; const names = new Set(resolveAllergy(entryText, MEDICATION_FORMULARY));
    count('two-drug allergy entries');
    for (const [i, r] of o.scoredRegimens.entries()) for (const n of names) {
        const held = p.current_regimen.some(x => x.med.name === n && !(x.exposure?.status && /held|completed/.test(x.exposure.status)));
        if (r.regimen.some(x => x.med.name === n)) out.push(`entry "${entryText.replace(/\n/g, '\\n')}": option ${i + 1} still has ${n}`);
        if (!held && modsOfOpt(r).some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.name === n)) out.push(`entry "${entryText.replace(/\n/g, '\\n')}": option ${i + 1} starts ${n}`);
    }
    return out;
};

export function runEngineReadinessR8Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] ReadinessR8: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR8: ${name}: ${(e as Error).message?.slice(0, 900)}`); }
    };

    // ---------------- X12 / X6 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('X12 every ordered pair of formulary drugs under every separator (slash, comma, semicolon, ampersand, plus, "and", newline, space, with and without spaces): both are read', () => {
        const f = pairReadingFaults(); assert.deepEqual(f.slice(0, 8), []);
    });
    check('X12 / X6 the reviewer\'s 83 entries and the combination products: matches by drug, brand or class name only (no salt or modifier word alone), hyphenated plurals, slash forms', () => {
        assert.deepEqual(allergyListFaults(), []);
    });
    check('X12 the allergy box "lisinopril/carvedilol" removes both drugs from every option, and the same for "lisinopril/HCTZ", "carvedilol/metoprolol", "losartan/valsartan", "sulfa/lasix" (patients taking the second drug)', () => {
        const pairs: Array<[string, string]> = [['lisinopril/carvedilol', 'Carvedilol'], ['lisinopril/HCTZ', 'Hydrochlorothiazide'], ['carvedilol/metoprolol', 'Metoprolol Succinate'], ['losartan/valsartan', 'Valsartan'], ['sulfa/lasix', 'Furosemide']];
        const regimen = (second: string): RegimenMed[] => second === 'Hydrochlorothiazide' ? [entry('Lisinopril', 10), entry('Hydrochlorothiazide', 25)] : second === 'Metoprolol Succinate' ? [entry('Carvedilol', 12.5, 'bid'), entry('Metoprolol Succinate', 50)]
            : second === 'Valsartan' ? [entry('Losartan', 50), entry('Valsartan', 80, 'bid')] : second === 'Furosemide' ? [entry('Furosemide', 40)] : [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')];
        for (const [typed, second] of pairs) {
            const p = mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97 }, regimen(second)); p.allergies = new Set([typed]);
            const o = runEngine(clonePatient(p));
            assert.ok(o.scoredRegimens.length > 0, typed);
            for (const [i, r] of o.scoredRegimens.entries()) {
                if (typed === 'sulfa/lasix') continue; // sulfa is a note on the diuretics, lasix removes furosemide
                assert.ok(!r.regimen.some(x => x.med.name === second), `${typed}: option ${i + 1} keeps ${second}`);
            }
            if (typed === 'sulfa/lasix') for (const [i, r] of o.scoredRegimens.entries()) assert.ok(!r.regimen.some(x => x.med.name === 'Furosemide'), `${typed}: option ${i + 1} keeps Furosemide`);
        }
    });
    check('X6d an entry longer than a bare name that is read as naming a drug says how it was read; a bare name says nothing; negated and "tolerates" sentences keep excluding and say so', () => {
        const note = (e: string) => expandAllergies(new Set([e]), MEDICATION_FORMULARY).readAs.map(r => r.text).join(' | ');
        for (const e of ['tolerates lisinopril fine', 'no allergy to lisinopril', 'mother allergic to Lisinopril', 'rash from Lisinopril', 'ACE inhibitors - cough', 'Hydralazine/Isosorbide']) assert.ok(/is read as an allergy to .*: remove the entry if that is not meant/.test(note(e)), `${e}: ${note(e)}`);
        for (const e of ['Lisinopril', 'lisinopril', 'Entresto', 'Lasix', 'ACE inhibitors', 'beta blocker', 'HCTZ']) assert.equal(note(e), '', e);
        const p = mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97 }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]); p.allergies = new Set(['tolerates lisinopril fine']);
        const o = runEngine(clonePatient(p));
        assert.ok(o.clinicalAlerts.some(a => /^ALLERGY NOTE: "tolerates lisinopril fine" is read as an allergy to Lisinopril: remove the entry if that is not meant\.$/.test(a)), o.clinicalAlerts.map(a => a.slice(0, 80)).join(' || '));
        for (const r of o.scoredRegimens) assert.ok(!r.regimen.some(x => x.med.name === 'Lisinopril'), 'lisinopril still offered');
    });
    check('X6c swelling of the face, lips, tongue or throat with an ACE inhibitor, an ARB or sacubitril/valsartan is read as angioedema: "Losartan - swelling of the face", "ramipril, tongue swelling", "swollen lips after Entresto"; no ACE inhibitor or ARNI in any option; an entry without a renin-angiotensin drug is not', () => {
        const f = MEDICATION_FORMULARY;
        for (const e of ['Losartan - swelling of the face', 'ramipril, tongue swelling', 'swollen lips after Entresto', 'lisinopril throat swelling', 'ACE inhibitors - swelling of the lips', 'valsartan facial swelling']) {
            assert.ok(expandAllergies(new Set([e]), f).expanded.has('angioedema'), `${e} is not read as angioedema`);
            assert.ok(expandAllergies(new Set([e]), f).readAs.some(r => /history of angioedema/.test(r.text)), `${e}: no note`);
        }
        for (const e of ['carvedilol swelling of the face', 'swelling of the face', 'ankle swelling with lisinopril', 'Hydralazine - swollen lips']) assert.ok(!expandAllergies(new Set([e]), f).expanded.has('angioedema'), `${e} is read as angioedema`);
        const p = mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97 }, [entry('Losartan', 50), entry('Carvedilol', 12.5, 'bid')]); p.allergies = new Set(['Losartan - swelling of the face']);
        const o = runEngine(clonePatient(p));
        assert.ok(o.scoredRegimens.length > 0);
        for (const [i, r] of o.scoredRegimens.entries()) for (const m of modsOfOpt(r)) if ((m.action === 'add' || m.action === 'swap') && m.target) assert.ok(!['ACEi', 'ARNI'].includes(m.target.med.drug_class), `option ${i + 1} starts ${m.target.med.name} after an angioedema history`);
    });

    /** Runs a per-patient generated check over `n` generated patients from `first`; returns the faults and the counts. */
    const sweep = (mode: string, n: number, first = 20100000) => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = first; sd < first + n; sd++) {
            const base = clonePatient(gen3r(sd).p as Patient); base.scope_conditions = new Set();
            const p = R8_PREP[mode] ? R8_PREP[mode](base, sd) : base; if (!p) continue;
            const o = runEngine(clonePatient(p));
            for (const m of R8_CHECKS[mode](p, o, (k, c = 1) => { counts[k] = (counts[k] ?? 0) + c; })) if (faults.length < 5) faults.push(`seed ${sd}: ${m}`);
        }
        return { faults, counts };
    };

    // ---------------- X11 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('X11 reviewer patient (takes a GLP-1 receptor agonist, recorded allergy to it): the screen is not empty, an option stops the allergen, ALLERGY CONFLICT is raised; 60 neighbours', () => {
        let n = 0;
        for (let sd = 20160000; sd < 20162500 && n < 60; sd++) {
            const p = glpAllergyPatient(clonePatient(gen3r(sd).p as Patient)); if (!p) continue; n++;
            const o = runEngine(clonePatient(p)); const g = takenDrugs(p).find(x => /Semaglutide|Tirzepatide/.test(x.med.name))!;
            assert.ok(o.scoredRegimens.length > 0, `seed ${sd}: no option (${o.clinicalAlerts.map(a => a.slice(0, 40)).join(' | ')})`);
            assert.ok(o.scoredRegimens.some(r => modsOfOpt(r).some(m => (m.action === 'remove' || m.action === 'swap') && m.source?.med.name === g.med.name)), `seed ${sd}: no option stops ${g.med.name}`);
            assert.deepEqual(R8_CHECKS.x11(p, o, () => { }), [], `seed ${sd}`);
        }
        assert.ok(n >= 40, `${n} patients`);
    });
    check('X11 reviewer seeds 20040210, 20040591, 20041141, 20040142, 20053759 (a GLP-1 drug taken and recorded as an allergy; the last also bilateral renal artery stenosis): options are shown, the allergen is stopped, ramipril and losartan are removed for the stenosis, ALLERGY CONFLICT is raised', () => {
        for (const sd of [20040210, 20040591, 20041141, 20040142, 20053759]) {
            const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); const o = runEngine(clonePatient(p));
            assert.ok(o.scoredRegimens.length > 0, `seed ${sd}: no option`);
            const g = takenDrugs(p).find(x => /Semaglutide|Tirzepatide/.test(x.med.name))!;
            assert.ok(o.scoredRegimens.some(r => modsOfOpt(r).some(m => (m.action === 'remove' || m.action === 'swap') && m.source?.med.name === g.med.name)), `seed ${sd}: the allergen is not stopped`);
            assert.ok(o.clinicalAlerts.some(a => a.startsWith(`ALLERGY CONFLICT: ${g.med.name} `)), `seed ${sd}: no ALLERGY CONFLICT`);
            if (sd === 20053759) for (const n of ['Ramipril', 'Losartan']) assert.ok(o.scoredRegimens.every(r => modsOfOpt(r).some(m => m.action === 'remove' && m.source?.med.name === n)), `seed ${sd}: ${n} is not removed in every option`);
        }
    });
    check('X11a a forced switch whose replacement is refused on the regimen the option produces (a check that fires only once another drug is added in the same option) becomes a plain removal that states the same reason: the allergen is stopped in every option, tirzepatide is never started beside the added drug, and a drug no option starts is named in the withheld list with the check\'s reason', () => {
        const tirz = MEDICATION_FORMULARY.find(m => m.name.startsWith('Tirzepatide'))!;
        const added = { reason: 'test check that fails only on the produced regimen', when: (q: Patient) => q.current_regimen.some(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA') };
        const isMraAdd = (r: Opt) => modsOfOpt(r).some(m => m.action === 'add' && ['MRA', 'nsMRA'].includes(m.target?.med.drug_class ?? ''));
        let n = 0, converted = 0, named = 0;
        for (let sd = 20160000; sd < 20164000 && n < 10; sd++) {
            const p0 = glpAllergyPatient(clonePatient(gen3r(sd).p as Patient)); if (!p0 || p0.current_regimen.some(r => ['MRA', 'nsMRA'].includes(r.med.drug_class)) || !takenDrugs(p0).some(r => r.med.name.startsWith('Semaglutide'))) continue;
            const before = runEngine(clonePatient(p0));
            if (!before.scoredRegimens.some(r => isMraAdd(r) && modsOfOpt(r).some(m => m.action === 'swap' && m.mandatory && m.target?.med.name.startsWith('Tirzepatide')))) continue;
            n++;
            tirz.contraindication_checks = [...(tirz.contraindication_checks ?? []), added];
            try {
                const o = runEngine(clonePatient(p0));
                assert.ok(o.scoredRegimens.length > 0, `seed ${sd}: empty`);
                for (const [i, r] of o.scoredRegimens.entries()) {
                    assert.ok(modsOfOpt(r).some(m => m.source?.med.name.startsWith('Semaglutide') && (m.action === 'remove' || m.action === 'swap') && /Patient-reported allergy/.test(m.summary)), `seed ${sd} option ${i + 1}: the allergen is not stopped: ${summaries(r).join(' ; ')}`);
                    if (isMraAdd(r)) { converted++; assert.ok(!r.regimen.some(x => x.med.name.startsWith('Tirzepatide')), `seed ${sd} option ${i + 1}: tirzepatide is started beside the added MRA`); assert.ok(modsOfOpt(r).some(m => m.action === 'remove' && m.source?.med.name.startsWith('Semaglutide')), `seed ${sd} option ${i + 1}: not a plain removal`); }
                }
                if (!o.scoredRegimens.some(r => r.regimen.some(x => x.med.name.startsWith('Tirzepatide')))) { named++; assert.ok(o.excludedMedications.some(e => e.name.startsWith('Tirzepatide') && /test check that fails only on the produced regimen/.test(e.reason)), `seed ${sd}: the withheld list does not say why tirzepatide is not offered`); }
            } finally { tirz.contraindication_checks = tirz.contraindication_checks!.filter(c => c !== added); }
        }
        assert.ok(n >= 3 && converted >= 3, `${n} patients, ${converted} converted options, ${named} with the drug named in the withheld list`);
    });
    check('X11 counterfactual, rule on against rule off: no list that had options is empty, no forced removal is lost, ALLERGY CONFLICT whenever a taken drug is an allergy (400 patients with an allergy to one drug they take, every class)', () => {
        const r = sweep('x11', 400); assert.deepEqual(r.faults, []); assert.ok((r.counts['counterfactual pairs'] ?? 0) > 250 && (r.counts['taken and allergic'] ?? 0) > 250, JSON.stringify(r.counts));
    });
    check('X11d ALLERGY CONFLICT on every path: input error, limited review, implausible values, stop screens and a scope condition, for a patient who takes a drug recorded as an allergy', () => {
        let seen = 0;
        for (let sd = 20100000; sd < 20100030; sd++) for (const [pn, f] of NO_OPTION_PATHS) {
            const p = oneDrugAllergyPatient(clonePatient(gen3r(sd).p as Patient), sd); if (!p) continue; f(p);
            const o = runEngine(clonePatient(p));
            const names = [...expandAllergies(p.allergies ?? new Set<string>(), MEDICATION_FORMULARY).expanded]; const taken = p.current_regimen.filter(r => names.includes(r.med.name)); if (taken.length === 0) continue; seen++;
            for (const t of taken) assert.ok(o.clinicalAlerts.some(a => a.startsWith(`ALLERGY CONFLICT: ${t.med.name} `)), `seed ${sd} path ${pn}: no ALLERGY CONFLICT for ${t.med.name}`);
            assert.equal(o.clinicalAlerts.filter(a => a.startsWith('ALLERGY CONFLICT')).length, new Set(o.clinicalAlerts.filter(a => a.startsWith('ALLERGY CONFLICT'))).size, 'an alert is repeated');
        }
        assert.ok(seen > 150, `${seen}`);
    });

    // ---------------- X1 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('X1 reviewer patients (furosemide 40 mg with torsemide 20 mg, with bumetanide 1 mg, and furosemide 80 with torsemide 40): at equal furosemide equivalents the alert and every removal line say the doses are equal and the kept drug is the one listed first in the formulary, never "larger"', () => {
        for (const [a, da, b, db] of [['Furosemide', 40, 'Torsemide', 20], ['Furosemide', 40, 'Bumetanide', 1], ['Furosemide', 80, 'Torsemide', 40], ['Furosemide', 20, 'Bumetanide', 0.5]] as Array<[string, number, string, number]>) {
            const p = mk({ lvef: 30, nyha_class: 'III', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, findings: ['Edema (2+)'], dry: 80, cur: 84 }, [entry(a, da), entry(b, db)]);
            const o = runEngine(clonePatient(p)); const alert = o.clinicalAlerts.find(x => x.startsWith('DUPLICATE THERAPY'))!;
            assert.ok(alert && /the doses are equal in furosemide equivalents/.test(alert) && !/larger loop diuretic dose/.test(alert), `${a} ${da} + ${b} ${db}: ${alert}`);
            assert.ok(o.scoredRegimens.length > 0 && o.scoredRegimens.every(r => modsOfOpt(r).filter(m => m.duplicate_cleanup).every(m => !/larger loop/.test(m.summary) && !/because/.test(m.summary) && /duplicate therapy alert gives the reason/.test(m.summary))), 'removal lines');
            assert.deepEqual(R8_CHECKS.x1(p, o, () => { }), []);
        }
        // a strictly larger kept dose still says larger
        const p2 = mk({ lvef: 30, nyha_class: 'III', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, findings: ['Edema (2+)'], dry: 80, cur: 84 }, [entry('Furosemide', 80), entry('Torsemide', 20)]);
        assert.ok(/larger loop diuretic dose/.test(runEngine(clonePatient(p2)).clinicalAlerts.find(x => x.startsWith('DUPLICATE THERAPY'))!));
    });
    check('X1 every duplicate class (every class group of two or more drugs except RAAS and MRA), every ordered pair, every dose pair: the stated reason for the kept drug is true by the figures (larger only if strictly larger, equal only if equal with the tie-break, percentages ordered as claimed)', () => {
        const cases = duplicateClassPatients(); const faults: string[] = []; let alerts = 0, ties = 0, larger = 0;
        for (const { label, p } of cases) {
            const o = runEngine(clonePatient(p)); const c: Record<string, number> = {};
            for (const m of R8_CHECKS.x1(p, o, (k, n = 1) => { c[k] = (c[k] ?? 0) + n; })) if (faults.length < 6) faults.push(`${label}: ${m}`);
            alerts += c['duplicate alerts'] ?? 0; ties += c['equal-dose duplicates'] ?? 0; if (o.clinicalAlerts.some(a => /larger loop diuretic dose/.test(a))) larger++;
        }
        assert.deepEqual(faults, []); assert.ok(cases.length > 100 && alerts > 100 && ties >= 5 && larger >= 10, `${cases.length} patients, ${alerts} alerts, ${ties} equal, ${larger} larger`);
    });
    check('X1 generated: 300 random patients: every duplicate-therapy alert and removal line states a reason true by the figures', () => {
        const r = sweep('x1', 300); assert.deepEqual(r.faults, []);
    });

    // ---------------- X2 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    const kPatient = (k: number, regimen: RegimenMed[], extra: Parameters<typeof mk>[0] = {}) => mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: k, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, ...extra }, regimen);
    check('X2 reviewer patients (potassium 5.5 to 5.9 on an MRA the options reduce: spironolactone alone, with lisinopril, with an ARNI, eplerenone with an ARNI, eGFR 28): no row or withheld line says to start a drug the patient takes or a second drug of the class; the row says not to raise it again', () => {
        const cases: Array<[string, Patient]> = [
            ['K5.6 spironolactone only', kPatient(5.6, [entry('Spironolactone', 25)])], ['K5.9 lisinopril + spironolactone', kPatient(5.9, [entry('Lisinopril', 20), entry('Spironolactone', 25)])],
            ['K5.6 ARNI + spironolactone + dapagliflozin + carvedilol', kPatient(5.6, [entry('Sacubitril/Valsartan (Entresto)', '49/51', 'bid'), entry('Spironolactone', 50), entry('Dapagliflozin', 10), entry('Carvedilol', 12.5, 'bid')])],
            ['K5.5 ARNI + eplerenone', kPatient(5.5, [entry('Sacubitril/Valsartan (Entresto)', '49/51', 'bid'), entry('Eplerenone', 50), entry('Dapagliflozin', 10)])], ['K5.9 ARNI + eplerenone 50', kPatient(5.9, [entry('Sacubitril/Valsartan (Entresto)', '49/51', 'bid'), entry('Eplerenone', 50)])],
            ['K5.5 eGFR 28 spironolactone', kPatient(5.5, [entry('Spironolactone', 25)], { egfr: 28, creatinine: 2.0 })], ['K5.7 spironolactone 50', kPatient(5.7, [entry('Spironolactone', 50)])],
        ];
        for (const [label, p] of cases) {
            const o = runEngine(clonePatient(p)); assert.deepEqual(R8_CHECKS.x2(p, o, () => { }), [], label);
            const row = o.monitoringPlan.find(m => /Repeat potassium/.test(m.test));
            if (row) assert.ok(!/start/i.test(row.test) && /Do not raise|raise/.test(row.test + row.details), `${label}: ${row.test}`);
        }
        // a patient on no MRA still gets the start row, for every MRA, and no second drug of a class the patient takes
        const none = kPatient(5.2, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]); const on = runEngine(clonePatient(none));
        assert.ok(on.monitoringPlan.some(m => /^Repeat potassium; start .*Spironolactone.* once below 5\.0$/.test(m.test)), on.monitoringPlan.map(m => m.test).join(' | '));
        assert.deepEqual(R8_CHECKS.x2(none, on, () => { }), []);
    });
    check('X2 generated: 600 random patients: every start, restart and raise sentence in a monitoring row, withheld reason or gap line is true of the regimen; no unknown wording about starting', () => {
        const r = sweep('x2', 600); assert.deepEqual(r.faults, []); assert.ok(Object.keys(r.counts).length >= 2, JSON.stringify(r.counts));
        const bad: string[] = []; for (const sc of SCENARIOS) { const p = clonePatient(sc.patient); const o = runEngine(clonePatient(p)); for (const m of R8_CHECKS.x2(p, o, () => { })) if (bad.length < 5) bad.push(`${sc.title}: ${m}`); }
        assert.deepEqual(bad, []);
    });

    // ---------------- X3 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('X3 reviewer patients (iron deficiency, ACE inhibitor, beta-blocker and MRA, an option adds IV iron; the packet case 25 style patient): the label does not count the single dose as a daily dose, the sentence says "plus a single dose", neighbours with weekly and every-other-day drugs', () => {
        const base = (regimen: RegimenMed[]) => mk({ lvef: 30, nyha_class: 'III', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, ferritin: 40, tsat: 12, hemoglobin: 11.8, iron_course_review: 'first_course', phosphate_review: 'not_indicated', dry: 80, cur: 80, findings: [] } as never, regimen);
        let ironOptions = 0;
        for (const reg of [[entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid'), entry('Spironolactone', 25)], [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid'), entry('Spironolactone', 25), entry('Dapagliflozin', 10)], [entry('Sacubitril/Valsartan (Entresto)', '49/51', 'bid'), entry('Metoprolol Succinate', 50), entry('Eplerenone', 25)], [entry('Ramipril', 5, 'bid'), entry('Bisoprolol', 5), entry('Spironolactone', 25), entry('Semaglutide (Wegovy)', 0.25)]]) {
            const p = base(reg); const o = runEngine(clonePatient(p)); const c: Record<string, number> = {};
            assert.deepEqual(R8_CHECKS.x3(p, o, (k, n = 1) => { c[k] = (c[k] ?? 0) + n; }), [], reg.map(r => r.med.name).join(','));
            ironOptions += c['options with a single-dose drug'] ?? 0;
        }
        assert.ok(ironOptions >= 3, `${ironOptions} options with a single-dose drug`);
        assert.equal(dosingWords([entry('Lisinopril', 10), entry('Ferric Carboxymaltose', 500)]), '1 dose a day from 1 drug, plus a single dose');
        assert.equal(dosingWords([entry('Ferric Carboxymaltose', 500)]), 'a single dose');
        assert.equal(dosingWords([entry('Lisinopril', 10), entry('Semaglutide (Wegovy)', 0.25)]), '1 dose a day from 1 drug, plus 1 drug once a week');
    });
    check('X3 generated: 500 random patients: every dosing label states the doses taken daily by the regimen shown and the regimen now; a single dose is described as one', () => {
        const r = sweep('x3', 500); assert.deepEqual(r.faults, []); assert.ok((r.counts['options'] ?? 0) > 800 && (r.counts['options with a single-dose drug'] ?? 0) >= 3, JSON.stringify(r.counts));
    });

    // ---------------- X13 / X14 / X4 ------------------------------------------------------------------------------------------------------------------------------------------------
    check('X13 reviewer seeds 20000490, 20070294, 20110417, 20001229 (severe kidney alert says no dose increase while an option raises the loop) and 20001180: the alert is reconciled with the options and each raise without recorded congestion says why', () => {
        for (const sd of [20000490, 20070294, 20110417, 20001229, 20001180]) {
            const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); const o = runEngine(clonePatient(p));
            assert.deepEqual(R8_CHECKS.loop(p, o, () => { }), [], `seed ${sd}`);
        }
        const r = sweep('loop', 1500); assert.deepEqual(r.faults, []); assert.ok((r.counts['loop raises without recorded congestion'] ?? 0) >= 3, JSON.stringify(r.counts));
    });
    check('X14 reviewer seeds 20000007, 20070151, 20080016 (an option adds Furoscix beside "no loop diuretic start or increase") and 20140016, 20140764 (display-rule sentences): the note says oral, the display-rule sentence says addition or increase as the option does, and "no other option" is true', () => {
        for (const sd of [20000007, 20070151, 20080016, 20140016, 20140764]) {
            const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); const o = runEngine(clonePatient(p));
            assert.deepEqual(R8_CHECKS.loop(p, o, () => { }), [], `seed ${sd}: ` + R8_CHECKS.loop(p, o, () => { }).join(' | '));
        }
        const r = sweep('loop', 2500, 20140000); assert.deepEqual(r.faults, []); assert.ok((r.counts['oral loop notes'] ?? 0) >= 5, JSON.stringify(r.counts));
    });
    check('X4 a duplicate clean-up that keeps one loop at a higher dose and removes the other (furosemide 40 mg with torsemide 20 mg, congested) is not called an increase: the option says the total loop dose is unchanged and the alert does not say every option includes an increase', () => {
        const p = mk({ lvef: 30, nyha_class: 'III', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, findings: ['Edema (2+)', 'JVP Elevated', 'Crackles', 'Orthopnea'], dry: 80, cur: 86 }, [entry('Furosemide', 40), entry('Torsemide', 20), entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        const o = runEngine(clonePatient(p)); assert.deepEqual(R8_CHECKS.loop(p, o, () => { }), []);
        const stepUnchanged = o.scoredRegimens.filter(r => modsOfOpt(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'Loop Diuretic') && loopDoseEffect(p, r) !== 'raises');
        assert.ok(stepUnchanged.length >= 1, o.scoredRegimens.map(r => summaries(r).join(' ; ')).join(' || '));
        for (const r of stepUnchanged) assert.ok(r.warnings.some(w => /(leaves|lowers) the total oral loop diuretic dose/.test(w)));
    });

    // ---------------- X5 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('X5 reviewer patients: potassium 5.0 to 5.4 on an MRA and a RAAS inhibitor (H01 type), potassium 5.7 with no RAAS inhibitor or MRA (H04), potassium 3.3 (packet case 43): the plan has the potassium row, the caution is visible, the correct-and-recheck row is there; neighbours at each boundary', () => {
        const kp = (k: number, regimen: RegimenMed[], extra: Parameters<typeof mk>[0] = {}) => mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: k, creatinine: 1.0, egfr: 70, oxygen_saturation: 97, ...extra }, regimen);
        const on = (k: number) => kp(k, [entry('Lisinopril', 10), entry('Spironolactone', 25), entry('Carvedilol', 12.5, 'bid')]);
        const none = (k: number) => kp(k, [entry('Carvedilol', 12.5, 'bid'), entry('Dapagliflozin', 10)]);
        for (const p of [on(5.0), on(5.2), on(5.3), on(5.4), none(5.4), none(5.5), none(5.7), none(5.9), none(6.0), none(3.3), none(3.4), none(3.5), on(3.3), on(5.6)]) {
            const o = runEngine(clonePatient(p)); assert.deepEqual(R8_CHECKS.x5(p, o, () => { }), [], `potassium ${p.potassium} ${p.current_regimen.map(r => r.med.name).join(',')}`);
        }
        const h04 = runEngine(clonePatient(none(5.7))); assert.ok(h04.clinicalAlerts.some(a => /^ELEVATED POTASSIUM: [Pp]otassium is 5\.7 mEq\/L and the patient takes no renin-angiotensin drug or MRA\. Confirm the value/.test(a)), 'H04 caution');
        assert.ok(!runEngine(clonePatient(none(5.4))).clinicalAlerts.some(a => /^ELEVATED POTASSIUM/.test(a)) && !runEngine(clonePatient(none(6.0))).clinicalAlerts.some(a => /^ELEVATED POTASSIUM/.test(a)), 'caution only at 5.5 to 5.9');
        const h01 = runEngine(clonePatient(on(5.2))); assert.ok(h01.scoredRegimens.some(r => (r.monitoring_plan ?? []).some(m => /potassium/i.test(m.test))), 'H01 option plans have a potassium row');
    });
    check('X5 generated: 800 random patients with the potassium set across the bands (3.3, 3.4, 4.4, 5.0, 5.2, 5.4, 5.6, 5.9): every recheck-potassium alert or warning has a potassium row, the caution and the correction row are present', () => {
        const r = sweep('x5', 800); assert.deepEqual(r.faults, []); assert.ok((r.counts['alerts that say to recheck potassium'] ?? 0) > 20 && (r.counts['potassium below 3.5'] ?? 0) > 50 && (r.counts['potassium 5.5 to 5.9 with no raiser'] ?? 0) > 10, JSON.stringify(r.counts));
    });

    // ---------------- X6e / X7 / X8 / X15 -----------------------------------------------------------------------------------------------------------------------------------------
    check('X6e an allergy to an angiotensin receptor blocker of unstated type: when no option starts sacubitril/valsartan the withheld list says why (the allergy check, confirm the reaction)', () => {
        let n = 0;
        for (const [al, reg] of [['losartan', [entry('Carvedilol', 12.5, 'bid')]], ['candesartan', [entry('Carvedilol', 12.5, 'bid'), entry('Dapagliflozin', 10)]], ['losartan', [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]], ['valsartan', [entry('Bisoprolol', 5)]]] as Array<[string, RegimenMed[]]>) {
            const p = mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97 }, reg); p.allergies = new Set([al]);
            const o = runEngine(p);
            const startsArni = o.scoredRegimens.some(r => modsOfOpt(r).some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.drug_class === 'ARNI'));
            const e = o.excludedMedications.find(x => x.name.startsWith('Sacubitril'));
            if (!startsArni && al !== 'valsartan') { n++; assert.ok(e && /Not in an option shown: an allergy to .* is recorded without the type of reaction/.test(e.reason) && /Confirm what the reaction was/.test(e.reason), `${al}: ${e?.reason}`); }
            if (startsArni) assert.ok(!e || !/Not in an option shown/.test(e.reason), 'named as absent while an option starts it');
        }
        assert.ok(n >= 2, `${n} cases`);
    });
    check('X7 displayed text over 600 random patients: no shouted word inside a sentence (abbreviations and trial names are allowed), no empty parentheses, no em or en dash, no "engine", no NYHA range with a hyphen; the Formulary tab strings are clean the same way', () => {
        const r = sweep('x7', 600); assert.deepEqual(r.faults, []); assert.ok((r.counts['strings scanned'] ?? 0) > 20000, JSON.stringify(r.counts));
        const f: string[] = [];
        for (const m of MEDICATION_FORMULARY) for (const t of [...(m.contraindication_checks ?? []).map(c => c.reason), ...(m.facts?.source_differences ?? []).flatMap(d => [d.label, d.guideline, d.why, d.topic])]) { const x = plainText(t); if (/[\u2013\u2014]|\bengine\b/i.test(x) || shoutedWords(x).length) f.push(`${m.name}: ${x.slice(0, 80)}`); }
        assert.deepEqual(f.slice(0, 5), []);
        assert.equal(plainText('NYHA III–IV and NYHA II-III and class not II-IV'), 'NYHA III to IV and NYHA II to III and class not II to IV');
    });
    check('X8 wording over 800 random patients and the reviewer cases: the outpatient sentence is conditional, an ARNI raise at a systolic pressure of 90 to 99 carries the low-pressure note, the volume-depletion priority sentence is true of every option, a gap line gives one reason', () => {
        const r = sweep('x8', 800); assert.deepEqual(r.faults, []);
        const arni = mk({ lvef: 30, nyha_class: 'II', sbp: 96, dbp: 60, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, oxygen_saturation: 97 }, [entry('Sacubitril/Valsartan (Entresto)', '24/26', 'bid'), entry('Carvedilol', 12.5, 'bid')]);
        const oa = runEngine(clonePatient(arni)); assert.deepEqual(R8_CHECKS.x8(arni, oa, () => { }), []);
        assert.ok(oa.scoredRegimens.some(x => x.warnings.some(w => /raises sacubitril\/valsartan at a systolic pressure of 96/.test(w))), 'no ARNI raise note: ' + oa.scoredRegimens.map(x => summaries(x).join(';')).join(' || '));
        const j13 = mk({ lvef: 30, nyha_class: 'II', sbp: 96, dbp: 58, pulse: 78, potassium: 4.4, creatinine: 1.9, egfr: 40, bun: 55, oxygen_saturation: 97, dry: 80, cur: 78 }, [entry('Furosemide', 80), entry('Torsemide', 20)]);
        const oj = runEngine(clonePatient(j13)); assert.deepEqual(R8_CHECKS.x8(j13, oj, () => { }), []);
        const dec = mk({ lvef: 25, nyha_class: 'IV', sbp: 110, dbp: 70, pulse: 90, potassium: 4.4, creatinine: 1.2, egfr: 60, oxygen_saturation: 95, dry: 80, cur: 87, findings: ['Edema (2+)', 'JVP Elevated', 'Crackles', 'Orthopnea'] }, [entry('Lisinopril', 10), entry('Furosemide', 40)]);
        const od = runEngine(clonePatient(dec)); assert.ok(od.clinicalAlerts.some(a => /^ACUTE DECOMPENSATION/.test(a)) && R8_CHECKS.x8(dec, od, () => { }).length === 0);
    });
    check('X15 over 1,500 random patients on every no-option path: an identical warning once, no rehabilitation prompt beside an unstable alert, a gap line for finerenone gives its reason, classes named in clinical words, no option wording in a no-option duplicate alert, and "no medication change is proposed" never beside an alert that tells the clinician to stop, withhold, reduce, review or switch a drug', () => {
        const faults: string[] = []; let imperative = 0, finerenone = 0;
        for (let sd = 20100000; sd < 20100150; sd++) for (const [pn, f] of NO_OPTION_PATHS) {
            const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); f(q); const o = runEngine(clonePatient(q));
            const c: Record<string, number> = {}; for (const m of R8_CHECKS.x15(q, o, (k, n = 1) => { c[k] = (c[k] ?? 0) + n; })) if (faults.length < 5) faults.push(`seed ${sd} ${pn}: ${m}`);
            imperative += c['no-option screens with an imperative drug alert'] ?? 0; finerenone += c['MRA gap lines beside finerenone'] ?? 0;
        }
        assert.deepEqual(faults, []); assert.ok(imperative > 100, `${imperative} no-option screens with an imperative drug alert`);
    });

    check('X12 generated: 500 random patients with two drugs in one allergy entry under every separator: neither drug is in any option', () => {
        const r = sweep('x12', 500); assert.deepEqual(r.faults, []); assert.ok((r.counts['two-drug allergy entries'] ?? 0) > 300, JSON.stringify(r.counts));
    });

    return { passed, failed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const r = runEngineReadinessR8Checks();
    console.log(`ReadinessR8: ${r.passed} passed, ${r.failed} failed`);
    process.exit(r.failed > 0 ? 1 : 0);
}
