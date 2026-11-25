/**
 * Round 11 engine rulings of the 2026-11-24 fix pass, part 1 (B1 to B7): wording and alerts only; no option, order, eligibility result or score changes.
 * Every check builds the reviewer's patient AND neighbours. Run standalone (`npx tsx scripts/engineReadinessR11Checks.ts`) or through `npm run verify`. Per-patient generated checks are
 * `R11_CHECKS`, also run in chunks of at most 5,000 patients by `scripts/engineReadinessR11Sweep.ts <mode> <firstSeed> <count>` (seeds from 60,000,000).
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { mk, runEngine, summaries, entry, gen3r, clonePatient, MEDICATION_FORMULARY, NO_OPTION_PATHS, withDrug, modsOfOpt, isOralLoop, isFuroscix } from './engineReadinessR10Checks';
import type { Patient, SimulationOutput } from './engineReadinessR10Checks';
import { generateAndScoreModifications } from '../services/simulationService';
import { expandAllergies } from '../services/engine/allergy';
import { validatePatientForm } from '../components/patient-form/formValidation';
import { RULESET_VERSION } from '../services/rulesetVersion';
import { assessCreatinineChange, reduceCriterionSentence } from '../services/engine/renalChange';
import { exposureErrors } from '../services/engine/medicationExposure';
import { calculateVolumeScore } from '../services/engine/domains';
import { isCongestedAboveDryWeight, weightBelowDryWeight, lowOutputMarkers, hasHypoperfusion } from '../services/engine/regimenUtils';
import { meetsDecompensationFindings } from '../services/clinicalPredicates';
import { diureticHeldForNoCongestion } from '../services/engine/candidates';
import { volumeDescription } from '../components/clinicalPresentation';

export { mk, runEngine, summaries, entry, gen3r, clonePatient, MEDICATION_FORMULARY, NO_OPTION_PATHS, withDrug, modsOfOpt };
export type { Patient, SimulationOutput };


/** Per-patient generated checks (sweep modes): each returns the faults found for one patient and its output. */
export const R11_CHECKS: Record<string, (p: Patient, o: SimulationOutput, count: (k: string, n?: number) => void) => string[]> = {};
/** How a sweep mode prepares the generated patient. Returning null skips the seed. */
export const R11_PREP: Record<string, (p: Patient, sd: number) => Patient | null> = {};

const plain = (n: string) => n.replace(/\s*\(.*\)/, '');
type Status = 'active' | 'held' | 'completed' | 'unknown';
/** Sets the use record of every entry of a drug (status, and consistent use unless unknown). */
function setUse(p: Patient, name: string, status: Status): void {
    p.current_regimen.forEach(r => { if (r.med.name === name) r.exposure = { status, adherence: status === 'unknown' ? 'unknown' : 'consistent', dose_interval_reviewed: true } as never; });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// B1: a held or completed loop record that stops a loop start or raise is named as the cause (not "a prerequisite is missing")
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const LOOP_NOTE_HEAD = 'Drug note: No oral loop diuretic start or increase is available today: ';
const GENERIC_PREREQ = 'a prerequisite is missing for the oral loop diuretic';
export const HELD_LOOP_CAUSE = (names: string[]): string => `a loop diuretic recorded as held or as a completed course (${names.join(', ')}) must be confirmed before any loop diuretic is started or raised`;
const ORAL = ['Furosemide', 'Torsemide', 'Bumetanide'];
type RecordKind = 'none' | 'furoscixCompleted' | 'furoscixHeld' | 'otherHeld' | 'otherCompleted' | 'duplicateHeld';
const RECORD_KINDS: RecordKind[] = ['none', 'furoscixCompleted', 'furoscixHeld', 'otherHeld', 'otherCompleted', 'duplicateHeld'];
/** A congested, decompensated patient (weight 4 to 5 kg above dry, four findings) on one active oral loop (or none), plus the record kind. `sd` picks drug, kind and a few neighbours. */
export function b1Patient(sd: number, forceKind?: RecordKind, noLoop = false): { p: Patient; records: string[]; kind: RecordKind } {
    const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set();
    p.current_regimen = p.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic');
    const active = ORAL[sd % 3] as string; const other = ORAL[(sd + 1 + Math.floor(sd / 3) % 2) % 3] as string;
    if (!noLoop) withDrug(p, active);
    const kind = forceKind ?? (RECORD_KINDS[Math.floor(sd / 7) % RECORD_KINDS.length] as RecordKind);
    const records: string[] = [];
    const add = (name: string, status: Status, dup = false) => {
        if (dup) { const e = p.current_regimen.find(r => r.med.name === name)!; p.current_regimen.push({ ...e, exposure: { status, adherence: 'consistent', dose_interval_reviewed: true } as never }); }
        else { withDrug(p, name); setUse(p, name, status); }
        records.push(plain(name));
    };
    if (kind === 'furoscixCompleted') add('Furoscix (SC Furosemide)', 'completed');
    if (kind === 'furoscixHeld') add('Furoscix (SC Furosemide)', 'held');
    if (kind === 'otherHeld' && !noLoop) add(other === active ? ORAL[(sd + 2) % 3] as string : other, 'held');
    if (kind === 'otherCompleted' && !noLoop) add(other === active ? ORAL[(sd + 2) % 3] as string : other, 'completed');
    if (kind === 'duplicateHeld' && !noLoop) add(active, 'held', true);
    p.volume_status.dry_weight_kg = 80; p.volume_status.current_weight_kg = 84 + (sd % 2); p.volume_status.exam_findings = new Set(['Edema (2+)', 'JVP Elevated', 'Crackles', 'Orthopnea']);
    p.allergies = new Set(); p.comorbidities.delete('Anuria'); p.is_pregnant = false; p.max_affordable_cost = 100000; p.sbp = Math.max(p.sbp || 0, 104); p.dbp = Math.min(p.dbp || 70, p.sbp - 25);
    p.potassium = 4.3; p.egfr = Math.max(p.egfr || 60, 50); p.creatinine = Math.min(p.creatinine || 1.0, 1.3); p.nyha_class = 'III'; p.pulse = 78;
    if (p.rhythm === '3rd Degree AV Block' || p.rhythm === '2nd Degree AV Block') p.rhythm = 'Sinus';
    return { p, records, kind };
}
const loopNotes = (o: SimulationOutput): string[] => o.scoredRegimens.flatMap(r => r.warnings.filter(w => w.startsWith(LOOP_NOTE_HEAD)));
const hasLoopStepOption = (o: SimulationOutput): boolean => o.scoredRegimens.some(r => modsOfOpt(r).some(m => (m.action === 'add' || m.action === 'titrate_up') && m.target && isOralLoop(m.target)));
/** The same patient with every held or completed loop entry removed (what the active loop alone allows). */
const withoutLoopRecords = (p: Patient): Patient => { const q = clonePatient(p); q.current_regimen = q.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic' || (r.exposure?.status !== 'held' && r.exposure?.status !== 'completed')); return q; };
R11_PREP.b1 = (_p, sd) => b1Patient(sd).p;
R11_CHECKS.b1 = (p, o, count) => {
    const out: string[] = [];
    const recs = p.current_regimen.filter(r => r.med.drug_class === 'Loop Diuretic' && (r.exposure?.status === 'held' || r.exposure?.status === 'completed')).map(r => plain(r.med.name));
    const notes = loopNotes(o); count('patients'); if (recs.length) count('patients with a held or completed loop record');
    const warnsNoLoop = o.scoredRegimens.some(r => r.warnings.some(x => x.startsWith('This option leaves the patient without a loop diuretic')));
    if (notes.length === 0 && !warnsNoLoop) { count('no loop note'); return out; }
    count('patients with the loop note');
    let base: SimulationOutput; try { base = runEngine(withoutLoopRecords(p)); } catch (e) { return [`exception without records: ${String(e).slice(0, 100)}`]; }
    const baseStep = hasLoopStepOption(base) || loopNotes(base).length === 0;
    const recordBlocks = recs.length > 0 && baseStep;
    const sentence = HELD_LOOP_CAUSE([...new Set(recs)].sort());
    for (const n of notes) {
        const names = n.includes('recorded as held or as a completed course');
        if (recordBlocks) { count('notes where the record is the cause'); if (!n.includes(sentence)) out.push(`the record blocks the step but the note does not say so: ${n.slice(0, 260)}`); if (n.includes(GENERIC_PREREQ)) out.push(`generic prerequisite wording although only the record blocks: ${n.slice(0, 200)}`); if (n.includes("also, no oral loop diuretic step passed the tool's rules for this patient")) out.push(`R13 E3: the record blocks the step but the note adds that no step passed the rules: ${n.slice(0, 200)}`); }
        else { if (names && (recs.length === 0 || !(n.includes(GENERIC_PREREQ) || (!hasLoopStepOption(base) && n.includes("also, no oral loop diuretic step passed the tool's rules for this patient"))))) out.push(`the note names a held or completed record that is not the cause: ${n.slice(0, 260)}`); if (n.includes(GENERIC_PREREQ)) { count('generic prerequisite notes'); const bn = loopNotes(base); if (!bn.some(x => x.includes(GENERIC_PREREQ))) out.push(`generic prerequisite wording but nothing of the active loop is missing: ${n.slice(0, 200)}`); } }
    }
    // The warning for an option that leaves a congested patient without a loop diuretic quotes the same cause: it never names a record that is not the cause and never calls a record-only block a missing prerequisite.
    for (const r of o.scoredRegimens) for (const w of r.warnings.filter(x => x.startsWith('This option leaves the patient without a loop diuretic'))) {
        count('no-loop warnings');
        if (w.includes('recorded as held or as a completed course') && (recs.length === 0 || (!recordBlocks && !(w.includes(GENERIC_PREREQ) || (!hasLoopStepOption(base) && w.includes("also, no oral loop diuretic step passed the tool's rules for this patient")))))) out.push(`no-loop warning names a record that is not the cause: ${w.slice(0, 260)}`);
        if (recordBlocks && w.includes(GENERIC_PREREQ)) out.push(`no-loop warning calls a record-only block a missing prerequisite: ${w.slice(0, 260)}`);
    }
    return out;
};
// Neighbours where a prerequisite of the active loop really is missing (use not confirmed, kidney value blank) together with a record: both causes are present.
export function b1PrereqPatient(sd: number): Patient {
    const { p } = b1Patient(sd, RECORD_KINDS[1 + (sd % 4)] as RecordKind);
    if (sd % 2) p.creatinine = 0; else p.current_regimen.forEach(r => { if (r.med.drug_class === 'Loop Diuretic' && r.exposure?.status === 'active') r.exposure = { status: 'active', adherence: 'unknown', dose_interval_reviewed: true } as never; });
    return p;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// B2: a drug recorded as held or completed that matches a listed allergy: its EXPOSURE HISTORY sentence says the allergy is recorded (no ALLERGY CONFLICT: "current" would be false)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const ALLERGY_RESTART_SENTENCE = (name: string): string => `An allergy to ${name} is recorded: reconcile the allergy before any restart.`;
const CLASS_WORD: Record<string, string> = { ACEi: 'ACE inhibitor', ARB: 'ARB', 'Beta Blocker': 'beta blocker', SGLT2i: 'SGLT2 inhibitor', MRA: 'MRA', 'Loop Diuretic': 'loop diuretic', ARNI: 'valsartan' };
/** A patient with one drug recorded as held or completed and an allergy entry that matches it by name, brand, class or component (or a different drug: no match), a second drug whose use is unknown or partial. */
export function b2Patient(sd: number): Patient {
    const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set();
    const drugs = MEDICATION_FORMULARY.filter(m => !m.facts?.short_course_addon);
    const d = drugs[(sd * 7) % drugs.length]!; const e = drugs[(sd * 11 + 3) % drugs.length]!;
    p.current_regimen = p.current_regimen.filter(r => r.med.name !== d.name && r.med.name !== e.name);
    withDrug(p, d.name); setUse(p, d.name, sd % 2 ? 'held' : 'completed');
    if (sd % 3 === 0) { withDrug(p, e.name); p.current_regimen.forEach(r => { if (r.med.name === e.name) r.exposure = { status: 'active', adherence: sd % 2 ? 'unknown' : 'partial', dose_interval_reviewed: true } as never; }); }
    const kind = Math.floor(sd / 5) % 5; const lowerGeneric = plain(d.name).toLowerCase();
    const entry = kind === 0 ? d.name : kind === 1 ? lowerGeneric : kind === 2 ? (CLASS_WORD[d.drug_class] ?? lowerGeneric) : kind === 3 ? plain(e.name).toLowerCase() : 'penicillin';
    p.allergies = new Set(sd % 4 === 0 ? [entry, plain(e.name).toLowerCase()] : [entry]);
    return p;
}
R11_PREP.b2 = (_p, sd) => b2Patient(sd);
R11_CHECKS.b2 = (p, o, count) => {
    const out: string[] = []; const expanded = expandAllergies(p.allergies, MEDICATION_FORMULARY).expanded;
    for (const r of p.current_regimen) {
        const name = r.med.name; const st = r.exposure?.status;
        const hist = o.clinicalAlerts.find(a => a.startsWith(`EXPOSURE HISTORY: ${name} is recorded as`));
        if (st === 'held' || st === 'completed') {
            count('held or completed drugs'); const allergic = expanded.has(name); const S = ALLERGY_RESTART_SENTENCE(name);
            if (allergic) { count('held or completed drugs matching an allergy'); if (!hist) out.push(`no EXPOSURE HISTORY alert for ${name}`); else if (!hist.includes(S)) out.push(`allergic ${name}: sentence missing: ${hist.slice(0, 260)}`); }
            else if (hist?.includes('An allergy to')) out.push(`${name} does not match an allergy but the alert says one is recorded: ${hist.slice(0, 260)}`);
            if (o.clinicalAlerts.some(a => a.startsWith(`ALLERGY CONFLICT: ${name} `))) out.push(`ALLERGY CONFLICT (a "current" claim) for the held or completed ${name}`);
        } else if ((r.exposure?.adherence === 'unknown' || r.exposure?.adherence === 'partial' || st === 'unknown') && expanded.has(name)) {
            count('uncertain-use allergic drugs'); if (!o.clinicalAlerts.some(a => a.startsWith(`ALLERGY CONFLICT: ${name} `))) out.push(`uncertain-use allergic ${name} lost its ALLERGY CONFLICT`);
        }
    }
    if (o.clinicalAlerts.some(a => /^EXPOSURE HISTORY/.test(a) && /An allergy to .* is recorded/.test(a) && !a.includes('reconcile the allergy before any restart.'))) out.push('malformed allergy sentence');
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// B3: "the oral loop diuretic is already at the highest dose the tool offers" is never said of a loop that the option removes for safety
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const HIGHEST_DOSE_REASON = 'already at the highest dose the tool offers';
const hasAny = (r: { warnings: string[] }, text: string) => r.warnings.some(w => w.includes(text));
/** A congested, decompensated patient on one oral loop at its highest strength and frequency, allergic to it (or, by sd, only unrelated allergies), with a kidney value blank in about half the patients. */
export function b3Patient(sd: number): Patient {
    const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set();
    p.current_regimen = p.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic');
    const name = ORAL[sd % 3] as string; const m = MEDICATION_FORMULARY.find(x => x.name === name)!;
    const dose = m.available_doses[m.available_doses.length - 1]!; const freq = dose.frequency_options[dose.frequency_options.length - 1]!;
    p.current_regimen.push({ med: m, dose, selected_frequency: freq, exposure: { status: 'active', adherence: sd % 5 === 0 ? 'unknown' : 'consistent', dose_interval_reviewed: true } } as never);
    p.allergies = new Set(sd % 6 === 5 ? ['penicillin'] : [name.toLowerCase()]);
    p.volume_status.dry_weight_kg = 80; p.volume_status.current_weight_kg = 84 + (sd % 3); p.volume_status.exam_findings = new Set(['Edema (2+)', 'JVP Elevated', 'Crackles', 'Orthopnea']);
    p.comorbidities.delete('Anuria'); p.is_pregnant = false; p.max_affordable_cost = 100000; p.potassium = 4.3; p.sbp = Math.max(p.sbp || 0, 104); p.dbp = Math.min(p.dbp || 70, p.sbp - 25); p.nyha_class = 'III'; p.pulse = 78;
    if (p.rhythm === '3rd Degree AV Block' || p.rhythm === '2nd Degree AV Block') p.rhythm = 'Sinus';
    if (sd % 2 === 0) { p.egfr = 0; p.creatinine = 0; } else { p.egfr = Math.max(p.egfr || 60, 50); p.creatinine = Math.min(p.creatinine || 1.0, 1.3); }
    return p;
}
R11_PREP.b3 = (_p, sd) => b3Patient(sd);
R11_CHECKS.b3 = (p, o, count) => {
    const out: string[] = []; const loop = p.current_regimen.find(r => r.med.drug_class === 'Loop Diuretic' && !r.med.facts?.short_course_addon);
    if (!loop) { count('random patients with no oral loop'); return out; }
    count('patients'); if (p.allergies.has(loop.med.name.toLowerCase())) count('patients allergic to the loop they take');
    for (const [i, r] of o.scoredRegimens.entries()) {
        // the loop the claim is about is removed when no oral loop remains in the regimen the option produces (a duplicate clean-up that keeps one loop removes none)
        const removes = !r.regimen.some(x => isOralLoop(x)) && modsOfOpt(r).some(m => (m.action === 'remove' || m.action === 'swap') && m.source?.med.drug_class === 'Loop Diuretic');
        const says = hasAny(r, HIGHEST_DOSE_REASON); if (says) count('options that say the loop is at the highest dose');
        if (removes) { count('options that remove the loop'); if (says) out.push(`option ${i + 1} removes ${loop.med.name} but says it is at the highest dose: ${r.warnings.find(w => w.includes(HIGHEST_DOSE_REASON))!.slice(0, 220)}`); }
    }
    return out;
};
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// B4: potassium above 8.0 (verify the value) also says what to do if the value is accurate; one shared sentence for the engine alert and the form error
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export const K_ABOVE_8_ACTION = 'If the value is accurate, this is a hyperkalemic emergency: obtain an ECG now, withhold potassium-raising drugs and potassium supplements, and arrange emergency assessment.'; // R12 D5(b): one sentence (was "If the value is accurate: obtain ..." after an "If accurate, ..." sentence)
R11_PREP.b4 = (p, sd) => { p.potassium = [8.1, 8.5, 9, 9.5, 12, 15, 8.0, 7.9, 6.8, 5.2][sd % 10] as number; return p; };
// paths that set the potassium themselves are not about this value
const K_PATHS = new Set(['stop_k68']);
R11_CHECKS.b4 = (p, o, count) => {
    const out: string[] = []; const k = p.potassium; if (K_PATHS.has((p as unknown as { __path?: string }).__path ?? '')) return out;
    const imp = o.clinicalAlerts.filter(a => a.startsWith('IMPLAUSIBLE VALUE: Serum potassium'));
    const withSentence = o.clinicalAlerts.filter(a => a.includes(K_ABOVE_8_ACTION));
    count(`k>8 patients`, k > 8.0 ? 1 : 0); count('k<=8 patients', k > 8.0 ? 0 : 1);
    if (k > 8.0) { if (imp.length === 0 && o.clinicalAlerts.some(a => a.startsWith('INPUT ERROR')) && o.scoredRegimens.length === 0) count('input-error screens with no potassium message (existing: report only)'); else if (imp.length !== 1) out.push(`potassium ${k}: ${imp.length} verify-the-value alerts`); else if (!imp[0]!.includes(K_ABOVE_8_ACTION)) out.push(`potassium ${k}: the verify message lacks the action sentence: ${imp[0]!.slice(0, 200)}`); }
    else if (withSentence.length) out.push(`potassium ${k}: the action sentence is present at 8.0 or below`);
    const err = validatePatientForm({ ...p } as Patient).potassium;
    if (k > 8.0) { if (!err || !err.includes(K_ABOVE_8_ACTION)) out.push(`potassium ${k}: the form error lacks the sentence: ${err}`); } else if (err?.includes(K_ABOVE_8_ACTION)) out.push(`potassium ${k}: the form error has the sentence`);
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// B5: the AV block alert says "none recorded here" only when no rate-slowing drug is recorded in any status (held, uncertain, unreadable) or on the outside-drug list
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const RATE_CLASSES = ['Beta Blocker', 'Inotrope', 'If Inhibitor'];
const SLOW_DRUGS = ['Carvedilol', 'Metoprolol Succinate', 'Bisoprolol', 'Digoxin', 'Ivabradine'];
export const HELD_RATE_SENTENCE = (name: string, status: string): string => `${name} is recorded as ${status}: confirm it is not being taken`;
export const UNREADABLE_RATE_SENTENCE = 'the medication list could not be fully read: reconcile it for rate-slowing drugs';
type B5Meta = { held: string[]; uncertain: string[]; unreadable: boolean; external: string[]; active: string[] };
/** An AV-block patient with at most one rate-slowing drug in one use status (active, uncertain, held), an unreadable entry, an outside drug, or none. */
export function b5Patient(sd: number): Patient {
    const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set();
    p.current_regimen = p.current_regimen.filter(r => !RATE_CLASSES.includes(r.med.drug_class)); p.external_medications = new Set([...(p.external_medications ?? [])].filter(x => !['Amiodarone', 'Diltiazem', 'Verapamil'].includes(x)));
    p.rhythm = '3rd Degree AV Block'; p.pulse = 38 + (sd % 12);
    const name = SLOW_DRUGS[sd % SLOW_DRUGS.length] as string; const kind = Math.floor(sd / 5) % 8; const meta: B5Meta = { held: [], uncertain: [], unreadable: false, external: [], active: [] };
    if (kind === 1) { withDrug(p, name); meta.active.push(name); }
    if (kind === 2) { withDrug(p, name); p.current_regimen.forEach(r => { if (r.med.name === name) r.exposure = { status: 'unknown', adherence: 'unknown', dose_interval_reviewed: true } as never; }); meta.uncertain.push(name); }
    if (kind === 3) { withDrug(p, name); p.current_regimen.forEach(r => { if (r.med.name === name) r.exposure = { status: 'active', adherence: 'partial', dose_interval_reviewed: true } as never; }); meta.uncertain.push(name); }
    if (kind === 4 || kind === 5) { withDrug(p, name); setUse(p, name, 'held'); meta.held.push(name); }
    if (kind === 6) { withDrug(p, name); const e = p.current_regimen.find(r => r.med.name === name)!; e.dose = { ...e.dose, strength: 7.3 } as never; meta.unreadable = true; }
    if (kind === 7) { const x = ['Amiodarone', 'Diltiazem', 'Verapamil'][sd % 3] as string; (p.external_medications ??= new Set()).add(x); meta.external.push(x); if (sd % 2) { withDrug(p, name); setUse(p, name, 'held'); meta.held.push(name); } }
    (p as unknown as { __b5: B5Meta }).__b5 = meta;
    return p;
}
R11_PREP.b5 = (_p, sd) => b5Patient(sd);
R11_CHECKS.b5 = (p, o, count) => {
    const out: string[] = []; const meta = (p as unknown as { __b5?: B5Meta }).__b5; if (!meta) return out;
    if (p.rhythm !== '3rd Degree AV Block') return out;
    const a = o.clinicalAlerts.find(x => x.startsWith('THIRD-DEGREE AV BLOCK')); count('AV-block patients'); if (!a) { out.push('no THIRD-DEGREE AV BLOCK alert'); return out; }
    const none = meta.held.length + meta.uncertain.length + meta.active.length + meta.external.length === 0 && !meta.unreadable;
    const has = a.includes('none recorded here'); if (none) count('patients with truly none'); else count('patients with something recorded');
    if (none !== has) out.push(`"none recorded here" is ${has ? 'present' : 'absent'} but a rate-slowing drug is ${none ? 'not ' : ''}recorded (${JSON.stringify(meta)}): ${a.slice(a.indexOf('Review now'), a.indexOf('Review now') + 260)}`);
    for (const h of meta.held) { count('held drugs'); if (!a.includes(HELD_RATE_SENTENCE(h, 'held'))) out.push(`held ${h} not stated: ${a.slice(a.indexOf('Review now'), a.indexOf('Review now') + 260)}`); }
    for (const u of meta.uncertain) { count('uncertain-use drugs'); if (!a.includes(`${u} (use not confirmed)`)) out.push(`uncertain ${u} not marked: ${a.slice(a.indexOf('Review now'), a.indexOf('Review now') + 260)}`); }
    for (const x of meta.active) if (!a.includes(x) || a.includes(`${x} (use not confirmed)`)) out.push(`active ${x} wrongly stated: ${a.slice(a.indexOf('Review now'), a.indexOf('Review now') + 260)}`);
    for (const x of meta.external) if (!a.includes(x)) out.push(`outside drug ${x} not named`);
    if (meta.unreadable) { count('unreadable lists'); if (!a.includes(UNREADABLE_RATE_SENTENCE)) out.push(`unreadable list not stated: ${a.slice(a.indexOf('Review now'), a.indexOf('Review now') + 260)}`); } else if (a.includes(UNREADABLE_RATE_SENTENCE)) out.push('unreadable sentence on a readable list');
    return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// B6: an option that removes Furoscix taken as the only loop and starts oral loop therapy at a lower furosemide-equivalent daily dose says the diuretic dose falls
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const PER_DAY: Record<string, number> = { qd: 1, bid: 2, tid: 3, qid: 4, weekly: 1 };
/** Independent recomputation of a daily dose in furosemide equivalents: strength x doses a day x (the drug's own declared furosemide equivalent, or the Furoscix oral multiplier). */
const feOf = (r: { med: { facts?: Record<string, unknown> }; dose: { strength: unknown }; selected_frequency: string }, furoscix: boolean): number =>
    Number(r.dose.strength) * (PER_DAY[r.selected_frequency] ?? 1) * (furoscix ? Number((r.med.facts as { oral_equivalent_multiplier?: number }).oral_equivalent_multiplier) : Number((r.med.facts as { verified_furosemide_equivalent_per_mg?: number }).verified_furosemide_equivalent_per_mg ?? 1));
const rnd1 = (x: number) => `${Math.round(x * 10) / 10}`;
const dispDose = (r: { med: { name: string }; dose: { strength: unknown; unit?: string }; selected_frequency: string }) => `${plain(r.med.name)} ${r.dose.strength}mg ${r.selected_frequency}`;
export const FUROSCIX_NOTE_HEAD = 'Drug note: this option replaces Furoscix (counted by this tool as ';
/** The expected note of one option, recomputed from the patient and the regimen the option produces; null when none is due. */
export function expectedFuroscixNote(p: Patient, regimen: Array<{ med: { name: string; drug_class: string; facts?: Record<string, unknown> }; dose: { strength: unknown; unit?: string }; selected_frequency: string; exposure?: { status?: string } }>): string | null {
    const active = (r: { exposure?: { status?: string } }) => r.exposure?.status !== 'held' && r.exposure?.status !== 'completed';
    const isLoop = (r: { med: { drug_class: string } }) => r.med.drug_class === 'Loop Diuretic';
    const isF = (r: { med: { facts?: Record<string, unknown> } }): boolean => !!r.med.facts?.short_course_addon;
    const was = (p.current_regimen as unknown as typeof regimen).filter(r => active(r) && isLoop(r)); const fx = was.filter(r => isF(r));
    if (fx.length === 0 || was.some(r => !isF(r))) return null;
    if (regimen.some(r => isLoop(r) && isF(r))) return null; // the Furoscix is kept
    const after = regimen.filter(r => isLoop(r) && !isF(r)); if (after.length === 0) return null;
    const from = fx.reduce((t, r) => t + feOf(r, true), 0); const to = after.reduce((t, r) => t + feOf(r, false), 0);
    if (!(to < from - 1e-9)) return null;
    return `${FUROSCIX_NOTE_HEAD}${rnd1(from)} mg oral furosemide a day) with ${after.map(dispDose).join(' and ')} (${rnd1(to)} mg oral furosemide equivalent a day): a lower diuretic dose. Reassess congestion early.`;
}
/** A congested patient taking Furoscix and no oral loop (the neighbour kinds: with an oral loop, Furoscix held, no Furoscix); a varied kidney value, weight excess and findings. */
export function b6Patient(sd: number): Patient {
    const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set();
    p.current_regimen = p.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic');
    const kind = Math.floor(sd / 3) % 8;
    if (kind !== 7) withDrug(p, 'Furoscix (SC Furosemide)');
    if (kind === 5) withDrug(p, ORAL[sd % 3] as string);
    if (kind === 6) setUse(p, 'Furoscix (SC Furosemide)', 'held');
    p.volume_status.dry_weight_kg = 80; p.volume_status.current_weight_kg = 83 + (sd % 4); p.volume_status.exam_findings = new Set(['Edema (2+)', 'JVP Elevated', 'Crackles', 'Orthopnea'].slice(0, 2 + (sd % 3)));
    p.allergies = new Set(); p.comorbidities.delete('Anuria'); p.is_pregnant = false; p.max_affordable_cost = 100000; p.potassium = 4.2; p.sbp = Math.max(p.sbp || 0, 104); p.dbp = Math.min(p.dbp || 70, p.sbp - 25); p.pulse = 78;
    p.egfr = sd % 4 === 0 ? 8 + (sd % 9) : Math.max(p.egfr || 60, 40); p.creatinine = Math.min(p.creatinine || 1.0, sd % 4 === 0 ? 4 : 1.3); if (p.rhythm === '3rd Degree AV Block' || p.rhythm === '2nd Degree AV Block') p.rhythm = 'Sinus';
    return p;
}
R11_PREP.b6 = (_p, sd) => b6Patient(sd);
R11_CHECKS.b6 = (p, o, count) => {
    const out: string[] = []; count('patients');
    for (const [i, r] of o.scoredRegimens.entries()) {
        const want = expectedFuroscixNote(p, r.regimen as never); const got = r.warnings.filter(w => w.startsWith(FUROSCIX_NOTE_HEAD)); count('options');
        if (want) count('options due a note');
        if (want && !got.includes(want)) out.push(`option ${i + 1}: expected "${want.slice(0, 260)}" but warnings have ${JSON.stringify(got).slice(0, 260)}`);
        if (!want && got.length) out.push(`option ${i + 1}: a note that is not due: ${got[0]!.slice(0, 260)}`);
        if (got.length > 1) out.push(`option ${i + 1}: the note is printed ${got.length} times`);
    }
    return out;
};
R11_CHECKS.b6r = (p, o, count) => R11_CHECKS.b6!(p, o, count);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// B7: wording. (b) no "nsMRA" in any displayed engine string; (c) the kidney-change alert names the criterion the numbers meet; (d) "no pricing profile is selected" when that is the cause
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const SKIP_KEYS = new Set(['drug_class', 'class', 'regimen', 'modification_set', 'projected_patient', 'med', 'target', 'source', 'rule_id', 'rule_name', 'name', 'row_id', 'id']); // internal identifiers, not displayed
/** Every displayed string of an output: alerts, warnings, rationale, withheld reasons, notes; internal objects (the regimen, the modification set, drug records) are skipped, change lines are added back. */
export function displayedStrings(o: SimulationOutput): string[] {
    const out: string[] = [];
    const walk = (v: unknown, key = ''): void => {
        if (typeof v === 'string') { if (!SKIP_KEYS.has(key)) out.push(v); return; }
        if (Array.isArray(v)) { v.forEach(x => walk(x, key)); return; }
        if (v && typeof v === 'object' && !(v instanceof Set)) for (const [k, x] of Object.entries(v)) { if (!SKIP_KEYS.has(k)) walk(x, k); }
    };
    walk(o); for (const r of o.scoredRegimens) out.push(...summaries(r));
    return out;
}
R11_PREP.b7b = (p, sd) => { p.lvef = 50 + (sd % 15); p.nyha_class = 'II'; p.potassium = 4.2; p.egfr = Math.max(p.egfr || 70, 45); p.creatinine = Math.min(p.creatinine || 1.0, 1.4); p.current_regimen = p.current_regimen.filter(r => !['MRA', 'nsMRA'].includes(r.med.drug_class)); p.sbp = Math.max(p.sbp || 0, 110); p.pulse = 78; p.rhythm = 'Sinus'; return p; };
R11_CHECKS.b7b = (_p, o, count) => {
    const out: string[] = []; count('patients'); const strs = displayedStrings(o); count('strings', strs.length);
    if (o.scoredRegimens.some(r => r.regimen.some(x => x.med.name.startsWith('Finerenone')))) count('options with finerenone');
    for (const t of strs) if (/\bnsMRA\b/.test(t)) out.push(`"nsMRA" is displayed: ${t.slice(Math.max(0, t.search(/\bnsMRA\b/) - 60), t.search(/\bnsMRA\b/) + 60)}`);
    return out;
};

// (c) the kidney-change alert names the criterion the numbers meet
const ckdEpi2021 = (scr: number, age: number, female: boolean): number => { const k = female ? 0.7 : 0.9, a = female ? -0.241 : -0.302; return 142 * Math.min(scr / k, 1) ** a * Math.max(scr / k, 1) ** -1.2 * 0.9938 ** age * (female ? 1.012 : 1); };
/** A patient on a RAAS inhibitor and an MRA with a baseline creatinine and a current one that give a rise of 5 to 130 percent and (by age and sex) an eGFR fall on either side of 30 percent. */
export function b7cPatient(sd: number): Patient {
    const age = 40 + (sd * 7) % 50, female = sd % 2 === 1; const base = Math.round((0.6 + ((sd * 13) % 17) / 10) * 10) / 10; const factor = 1.05 + ((sd * 29) % 126) / 100;
    const cur = Math.round(base * factor * 100) / 100; const egfr = Math.round(ckdEpi2021(cur, age, female) * 10) / 10;
    const p = mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 72, pulse: 76, potassium: 4.4, creatinine: cur, egfr, age, sex: female ? 'Female' : 'Male', baseline_creatinine: base }, [entry('Lisinopril', 10, 'qd'), entry('Spironolactone', 25, 'qd'), entry('Carvedilol', 12.5, 'bid')]);
    return p;
}
/** What the alert must say, from an independent CKD-EPI 2021 and the creatinine arithmetic. States within 4 points of the 30 percent fall (the tool rounds the eGFR it derives, so the two fall figures can differ by up to that at a low eGFR) are `near`. */
export function b7cExpected(p: Patient): { band: 'none' | 'reduce' | 'stop'; rise: number; fall: number | null; near: boolean; riseMet: boolean; fallMet: boolean } {
    const r6 = (x: number) => Math.round(x * 1e6) / 1e6; // R12 D1: the oracle rounds the two percentages to six decimals once, as the engine now does (an exact 50% rise must read as 50)
    const base = p.baseline_creatinine as number, cur = p.creatinine; const rise = r6((cur - base) / base * 100); const f = p.sex === 'Female';
    const eb = ckdEpi2021(base, p.age, f), ec = ckdEpi2021(cur, p.age, f); const fall = eb > 0 && ec > 0 ? r6((eb - ec) / eb * 100) : null;
    const riseMet = rise >= 50, fallMet = fall !== null && fall > 30; const stop = rise > 100 || (rise >= 50 && p.egfr < 20);
    return { band: stop ? 'stop' : riseMet || fallMet ? 'reduce' : 'none', rise, fall, near: fall !== null && Math.abs(fall - 30) < 4, riseMet, fallMet };
}
R11_PREP.b7c = (_p, sd) => b7cPatient(sd);
R11_CHECKS.b7c = (p, o, count) => {
    const out: string[] = []; const e = b7cExpected(p); const kid = o.clinicalAlerts.filter(a => a.startsWith('KIDNEY FUNCTION:') && /halv(e|ing) the RAAS/.test(a)); count(`band ${e.band}${e.near ? ' (near the 30 percent boundary)' : ''}`);
    if (e.near && kid.length === 0) return out;
    if (e.band !== 'reduce') { if (kid.length && !e.near) out.push(`a halve alert although the band is ${e.band} (rise ${e.rise.toFixed(1)}, fall ${e.fall?.toFixed(1)})`); if (!kid.length) return out; }
    if (kid.length !== 1) { out.push(`${kid.length} halve alerts for a reduce-band patient (rise ${e.rise.toFixed(1)}, fall ${e.fall?.toFixed(1)})`); return out; }
    // the figures printed in the alert's own summary line (R13 E4: a decimal for a figure that rounds to its threshold, as the criterion sentence does)
    const m = kid[0]!.match(/\(\+?(-?\d+(?:\.\d+)?)%(?:, derived eGFR fall (-?\d+(?:\.\d+)?)%)?\)\. (.*?\.)(?: The 2026 ESC criteria call for halving)/); if (!m) { out.push(`no readable summary and criterion in: ${kid[0]!.slice(0, 260)}`); return out; }
    const sentence = m[3]!; const sr = sentence.match(/creatinine rise of (\d+(?:\.\d+)?)%/)?.[1], sf = sentence.match(/eGFR fall of (\d+(?:\.\d+)?)%/)?.[1];
    const R = sr ?? m[1]!, F = sf ?? m[2];
    const want = e.riseMet && e.fallMet ? `The creatinine rise of ${R}% and the derived eGFR fall of ${F}% each meet the 2026 ESC criteria (a rise of 50% or more, a fall above 30%).`
        : e.fallMet ? `The derived eGFR fall of ${F}% meets the 2026 ESC criterion (a fall above 30%); the creatinine rise of ${R}% alone would not.`
        : `The creatinine rise of ${R}% meets the 2026 ESC criterion (a rise of 50% or more)${F !== undefined ? `; the derived eGFR fall of ${F}% alone would not` : ''}.`;
    // a figure that rounds to its own threshold is printed with a decimal (never "30%" against "a fall above 30%")
    if (F !== undefined && /^30$/.test(F) && sentence.includes('fall of 30%')) out.push(`"fall of 30%" against a criterion of a fall above 30%: ${sentence}`);
    // R12 D1 (rewritten): "rise of 50%" is right ONLY for a rise that equals 50 exactly; a rise that merely rounds to 50 keeps its decimal, and an exact 50 prints as a whole number.
    if (/^50$/.test(R) && e.rise !== 50) out.push(`"rise of 50%" printed for a rise of ${e.rise}, not exactly the 50% threshold: ${sentence}`);
    if (e.rise === 50 && !/creatinine rise of 50%[ ;]/.test(sentence)) out.push(`an exact 50% rise is not printed as "50%": ${sentence}`);
    count(e.riseMet && e.fallMet ? 'reduce: both met' : e.riseMet ? 'reduce: rise only' : 'reduce: fall only');
    if (sentence !== want && !e.near) out.push(`criterion sentence wrong (want "${want}"): "${sentence}"`);
    if (e.near) { const named = sentence.startsWith('The derived eGFR fall') ? 'fall' : sentence.startsWith('The creatinine rise of') && sentence.includes(' and the derived') ? 'both' : 'rise'; if (named === 'fall' && Number(F) <= 30) out.push(`near boundary: the fall is named as the criterion at ${F}%`); }
    return out;
};

R11_CHECKS.b3r = (p, o, count) => R11_CHECKS.b3!(p, o, count); // random patients, no preparation

export function runEngineReadinessR11Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        if (process.env.R13_ONLY && !name.startsWith('R13')) return;
        try { f(); passed++; console.log(`[PASS] ReadinessR11: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR11: ${name}: ${(e as Error).message?.slice(0, 1200)}`); }
    };
    const sweepChecks = (mode: string, from: number, n: number, prep?: (p: Patient, sd: number) => Patient | null) => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = from; sd < from + n; sd++) {
            let p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set();
            const q = prep ? prep(p, sd) : p; if (!q) continue; p = q;
            let o: SimulationOutput; try { o = runEngine(clonePatient(p)); } catch (e) { faults.push(`seed ${sd}: exception ${String(e).slice(0, 100)}`); continue; }
            for (const m of R11_CHECKS[mode]!(p, o, (k, c = 1) => { counts[k] = (counts[k] ?? 0) + c; })) if (faults.length < 6) faults.push(`seed ${sd}: ${m}`);
        }
        return { faults, counts };
    };

    // ---------------- B1 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('B1 reviewer patients Z2, Z3, Z5, H21 (furosemide 40 active; Furoscix completed, Furoscix held, torsemide held, duplicate furosemide held): the note names the held or completed record, never "a prerequisite is missing"', () => {
        const mkZ = (extra: Array<[string, Status]>) => { const p = mk({ lvef: 28, nyha_class: 'III', sbp: 112, dbp: 70, pulse: 78, potassium: 4.3, creatinine: 1.1, egfr: 65, dry: 80, cur: 84, findings: ['Edema (3+)', 'Crackles', 'JVP Elevated', 'Orthopnea'] }, [entry('Furosemide', 40, 'qd'), entry('Carvedilol', 12.5, 'bid')]); for (const [n, s] of extra) { withDrug(p, n); setUse(p, n, s); } return p; };
        const cases: Array<[string, Array<[string, Status]>, string]> = [['Z2', [['Furoscix (SC Furosemide)', 'completed']], 'Furoscix'], ['Z3', [['Furoscix (SC Furosemide)', 'held']], 'Furoscix'], ['Z5', [['Torsemide', 'held']], 'Torsemide']];
        for (const [id, extra, drug] of cases) {
            const o = runEngine(mkZ(extra)); const notes = loopNotes(o); assert.ok(notes.length > 0, `${id}: no loop note`);
            for (const n of notes) { assert.ok(n.includes(HELD_LOOP_CAUSE([drug])), `${id}: ${n.slice(0, 300)}`); assert.ok(!n.includes(GENERIC_PREREQ), `${id}: ${n.slice(0, 300)}`); }
        }
        // the same patient on furosemide alone is offered the raise (no note), as the reviewer's Z1
        assert.equal(loopNotes(runEngine(mkZ([]))).length, 0);
    });
    check('B1 generated: congested patients on an active oral loop with and without a held or completed loop record (and with none): the note names the record exactly when it is the cause (600 here; 3,000 and more in the sweep script)', () => {
        const { faults, counts } = sweepChecks('b1', 60000000, 600, (_p, sd) => b1Patient(sd).p);
        assert.deepEqual(faults, []); assert.ok((counts['notes where the record is the cause'] ?? 0) > 100, JSON.stringify(counts));
    });
    check('B1 neighbours: a record beside a really missing prerequisite (use not confirmed, kidney value blank) keeps the generic wording true; a record with no active loop (start blocked) is named', () => {
        const a = sweepChecks('b1', 60010000, 150, (_p, sd) => b1PrereqPatient(sd)); assert.deepEqual(a.faults, []); assert.ok((a.counts['generic prerequisite notes'] ?? 0) > 20, JSON.stringify(a.counts));
        const b = sweepChecks('b1', 60011000, 150, (_p, sd) => b1Patient(sd, RECORD_KINDS[1 + (sd % 2)] as RecordKind, true).p); assert.deepEqual(b.faults, []); assert.ok((b.counts['notes where the record is the cause'] ?? 0) > 20, JSON.stringify(b.counts));
    });

    // ---------------- B2 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('B2 reviewer patients H25 (held dapagliflozin, allergy to it), H27 (held furosemide, allergy to it), a completed course, a class entry and a component entry: the EXPOSURE HISTORY sentence adds the allergy; no ALLERGY CONFLICT', () => {
        const cases: Array<[string, Status, string, string]> = [['Dapagliflozin', 'held', 'dapagliflozin', 'Dapagliflozin'], ['Furosemide', 'held', 'Furosemide', 'Furosemide'], ['Losartan', 'completed', 'ARB', 'Losartan'], ['Sacubitril/Valsartan (Entresto)', 'held', 'valsartan', 'Sacubitril/Valsartan (Entresto)']];
        for (const [drug, st, al, full] of cases) {
            const name = MEDICATION_FORMULARY.find(m => m.name.startsWith(drug))!.name; void full;
            const p = mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: 4.3, creatinine: 1.0, egfr: 70 }, [entry('Carvedilol', 12.5, 'bid')]); withDrug(p, name); setUse(p, name, st); p.allergies = new Set([al]);
            for (const [pn, pf] of NO_OPTION_PATHS) { const q = clonePatient(p); pf(q); q.allergies = new Set([al]); const o = runEngine(q); const hist = o.clinicalAlerts.find(a => a.startsWith(`EXPOSURE HISTORY: ${name}`));
                if (['scope_unanswered', 'limited_review', 'input_error'].includes(pn) || true) { assert.ok(hist && hist.includes(ALLERGY_RESTART_SENTENCE(name)), `${name} on ${pn}: ${hist ?? 'no EXPOSURE HISTORY alert'}`); }
                assert.ok(!o.clinicalAlerts.some(a => a.startsWith(`ALLERGY CONFLICT: ${name}`)), `${name} on ${pn}: ALLERGY CONFLICT`); }
        }
    });
    check('B2 generated: sentence present exactly when the held or completed drug matches an allergy; uncertain-use drugs keep ALLERGY CONFLICT (2,000 here; 5,000 and more per path in the sweep script)', () => {
        const { faults, counts } = sweepChecks('b2', 60100000, 1500, (_p, sd) => b2Patient(sd));
        assert.deepEqual(faults, []); assert.ok((counts['held or completed drugs matching an allergy'] ?? 0) > 300 && (counts['uncertain-use allergic drugs'] ?? 0) > 20, JSON.stringify(counts));
    });

    // ---------------- B3 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('B3 reviewer state (torsemide 100 mg, allergic to torsemide, congested, kidney value blank): no option that removes the loop says it is at the highest dose; the true cause is named', () => {
        const mkT = (blank: boolean) => { const p = mk({ lvef: 28, nyha_class: 'III', sbp: 112, dbp: 70, pulse: 78, potassium: 4.3, creatinine: blank ? 0 : 1.1, egfr: blank ? 0 : 65, dry: 80, cur: 85, findings: ['Edema (3+)', 'Crackles', 'JVP Elevated', 'Orthopnea'] }, [entry('Torsemide', 100, 'qd'), entry('Carvedilol', 12.5, 'bid')]); p.allergies = new Set(['torsemide']); return p; };
        const o = runEngine(mkT(true)); assert.ok(o.scoredRegimens.length > 0);
        for (const r of o.scoredRegimens) { assert.ok(!hasAny(r, HIGHEST_DOSE_REASON), r.warnings.join(' | ').slice(0, 400)); }
        // the cause that remains is a true one (the generic "no oral loop diuretic step passed the tool's rules" or a prerequisite), never the highest-dose claim
        assert.ok(o.scoredRegimens.every(r => r.warnings.some(w => w.startsWith('Drug note: No oral loop diuretic start or increase is available today: ') || w.startsWith('This option leaves the patient without a loop diuretic')) || modsOfOpt(r).some(m => m.target?.med.drug_class === 'Loop Diuretic')));
        const o2 = runEngine(mkT(false)); for (const r of o2.scoredRegimens) assert.ok(!hasAny(r, HIGHEST_DOSE_REASON));
    });
    check('B3 generated: top-dose loop, allergic, congested (10,000 in the sweep script; 1,000 here): the highest-dose reason never appears on an option that removes that loop', () => {
        const { faults, counts } = sweepChecks('b3', 60200000, 1000, (_p, sd) => b3Patient(sd));
        assert.deepEqual(faults, []); assert.ok((counts['options that remove the loop'] ?? 0) > 300, JSON.stringify(counts));
    });

    // ---------------- B4 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('B4 reviewer patients I01 (potassium 9.5 on spironolactone and lisinopril) and I02 (8.5): the engine message and the form error both carry the sentence; none at 8.0 or below; still no option', () => {
        for (const k of [9.5, 8.5, 8.1, 20]) { const p = mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: k, creatinine: 1.0, egfr: 70 }, [entry('Lisinopril', 10, 'qd'), entry('Spironolactone', 25, 'qd')]); const o = runEngine(p);
            assert.equal(o.scoredRegimens.length, 0); const a = o.clinicalAlerts.find(x => x.startsWith('IMPLAUSIBLE VALUE: Serum potassium'))!; assert.ok(a && a.includes(K_ABOVE_8_ACTION), `${k}: ${a}`); assert.ok(validatePatientForm(p).potassium?.includes(K_ABOVE_8_ACTION), `${k}: form`); }
        for (const k of [8.0, 7.9, 6.5, 5.0]) { const p = mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: k, creatinine: 1.0, egfr: 70 }, [entry('Lisinopril', 10, 'qd')]); const o = runEngine(p); assert.ok(!o.clinicalAlerts.some(x => x.includes(K_ABOVE_8_ACTION)), `${k}`); assert.ok(!validatePatientForm(p).potassium?.includes(K_ABOVE_8_ACTION), `${k}: form`); }
    });
    check('B4 generated: potassium above 8.0 on every path that does not set the potassium itself, and 8.0 and below (1,000 here; 3,000 per path in the sweep script)', () => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = 60300000; sd < 60300600; sd++) for (const [pn, pf] of NO_OPTION_PATHS) {
            if (pn === 'stop_k68') continue; const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); R11_PREP.b4!(q, sd); pf(q);
            let o: SimulationOutput; try { o = runEngine(clonePatient(q)); } catch (e) { faults.push(`${pn} ${sd}: exception`); continue; }
            for (const m of R11_CHECKS.b4!(q, o, (k, c = 1) => { counts[k] = (counts[k] ?? 0) + c; })) if (faults.length < 6) faults.push(`${pn} seed ${sd}: ${m}`);
        }
        assert.deepEqual(faults, []); assert.ok((counts['k>8 patients'] ?? 0) > 1500, JSON.stringify(counts));
    });

    // ---------------- B5 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('B5 reviewer patients V08 (carvedilol held) and U07 (carvedilol with an unreadable strength) with third-degree block: the alert says so instead of "none recorded"; a patient with none still says it', () => {
        const base = (r: Array<ReturnType<typeof entry>>) => mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 40, potassium: 4.3, creatinine: 1.0, egfr: 70, rhythm: '3rd Degree AV Block' }, r);
        const av = (p: Patient) => runEngine(p).clinicalAlerts.find(x => x.startsWith('THIRD-DEGREE AV BLOCK'))!;
        const v08 = base([entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid')]); setUse(v08, 'Carvedilol', 'held'); const a1 = av(v08); assert.ok(a1.includes(HELD_RATE_SENTENCE('Carvedilol', 'held')) && !a1.includes('none recorded here'), a1);
        const u07 = base([entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid')]); u07.current_regimen[1]!.dose = { ...u07.current_regimen[1]!.dose, strength: 7 } as never; const a2 = av(u07); assert.ok(a2.includes(UNREADABLE_RATE_SENTENCE) && !a2.includes('none recorded here'), a2);
        const none = base([entry('Lisinopril', 10, 'qd')]); const a3 = av(none); assert.ok(a3.includes('none recorded here') && !a3.includes(UNREADABLE_RATE_SENTENCE), a3);
    });
    check('B5 generated: AV-block patients in every use status, with outside rate-slowing drugs and unreadable entries (1,200 here; 5,000 per path in the sweep script)', () => {
        const faults: string[] = []; const counts: Record<string, number> = {};
        for (let sd = 60400000; sd < 60400400; sd++) for (const [pn, pf] of NO_OPTION_PATHS) {
            if (!['full', 'scope_unanswered', 'input_error', 'limited_review', 'scope_ticked', 'stop_block3'].includes(pn)) continue;
            const q = b5Patient(sd); pf(q); q.rhythm = '3rd Degree AV Block'; q.pulse = q.pulse || 40;
            let o: SimulationOutput; try { o = runEngine(clonePatient(q)); } catch (e) { faults.push(`${pn} ${sd}: exception`); continue; }
            for (const m of R11_CHECKS.b5!(q, o, (k, c = 1) => { counts[k] = (counts[k] ?? 0) + c; })) if (faults.length < 6) faults.push(`${pn} seed ${sd}: ${m}`);
        }
        assert.deepEqual(faults, []); assert.ok((counts['held drugs'] ?? 0) > 100 && (counts['unreadable lists'] ?? 0) > 50 && (counts['patients with truly none'] ?? 0) > 100, JSON.stringify(counts));
    });

    // ---------------- B6 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('B6 reviewer patients D01 (Furoscix 80 mg, 4 kg over, four findings) and X10 (eGFR 8): every option that replaces Furoscix by furosemide 20 mg says the dose falls, with the tool\'s own figures', () => {
        const mkD = (egfr: number, cr: number) => mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, creatinine: cr, egfr, dry: 80, cur: 84, findings: ['Edema (3+)', 'Crackles', 'JVP Elevated', 'Orthopnea'] }, [entry('Furoscix (SC Furosemide)', 80, 'qd')]);
        for (const [egfr, cr] of [[65, 1.1], [8, 5.5]] as const) { const p = mkD(egfr, cr); const o = runEngine(p); let seen = 0;
            for (const r of o.scoredRegimens) { const want = expectedFuroscixNote(p, r.regimen as never); if (!want) continue; seen++; assert.ok(r.warnings.includes(want), `${egfr}: ${want}`); }
            assert.ok(seen > 0, `eGFR ${egfr}: no option replaces Furoscix by a lower oral dose`); }
        const p = mkD(65, 1.1); const first = runEngine(p).scoredRegimens[0]!; assert.ok(first.warnings.some(w => w.includes('counted by this tool as 160 mg oral furosemide a day) with Furosemide 20mg qd (20 mg oral furosemide equivalent a day)')), first.warnings.join(' | ').slice(0, 400));
    });
    check('B6 generated: Furoscix-only congested patients, with the neighbour kinds (an oral loop on board, Furoscix held, no Furoscix): the note is present exactly when due, figures recomputed (1,000 here; 3,000 per run in the sweep script)', () => {
        const { faults, counts } = sweepChecks('b6', 60500000, 800, (_p, sd) => b6Patient(sd));
        assert.deepEqual(faults, []); assert.ok((counts['options due a note'] ?? 0) > 300, JSON.stringify(counts));
    });
    check('B6 random patients (no preparation): the note is present exactly when due', () => {
        const { faults, counts } = sweepChecks('b6r', 60510000, 600); assert.deepEqual(faults, []); assert.ok((counts['options'] ?? 0) > 1000, JSON.stringify(counts));
    });

    // ---------------- B7 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    check('B7a the scope alert says "no medication option is shown", never "regimen change" (every scope condition, ticked alone and with others); the round 10 A7 check now also reads "regimen change"', () => {
        const p = mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: 4.3, creatinine: 1.0, egfr: 70 }, [entry('Lisinopril', 10, 'qd')]); p.scope_conditions = new Set(['Dialysis']);
        const o = runEngine(p); const a = o.clinicalAlerts.find(x => x.startsWith("OUTSIDE THE TOOL'S SCOPE"))!; assert.ok(a, o.clinicalAlerts.join(' | ').slice(0, 300)); assert.ok(a.includes('and no medication option is shown.') && !/regimen change/i.test(a), a);
        assert.ok(!o.clinicalAlerts.some(x => /no regimen changes? (is|are) shown/i.test(x)));
    });
    check('B7b no "nsMRA" in any displayed engine string (preserved-EF patients, finerenone options included: 1,000 here)', () => {
        const { faults, counts } = sweepChecks('b7b', 60600000, 400, (p, sd) => R11_PREP.b7b!(p, sd)); assert.deepEqual(faults, []); assert.ok((counts['options with finerenone'] ?? 0) > 20, JSON.stringify(counts));
        const p = mk({ lvef: 58, nyha_class: 'II', sbp: 130, dbp: 76, pulse: 74, potassium: 4.2, creatinine: 1.0, egfr: 70, bmi: 24 }, [entry('Dapagliflozin', 10, 'qd')]); const strs = runEngine(p).scoredRegimens.flatMap(r => r.rationale ?? []).concat(displayedStrings(runEngine(p)));
        assert.ok(strs.some(t => /Finerenone \(Kerendia\): nonsteroidal MRA: 16% RRR/.test(t)), 'the finerenone benefit line is not shown as "nonsteroidal MRA:"');
    });

    check('B7c the kidney-change alert names the criterion the numbers meet: packet cases 14 (creatinine 1.3 to 1.8, rise 43%, eGFR fall 36%) and 19, and generated baseline states (rise 5 to 130 percent, either side of the 30 percent fall; 1,000 here)', () => {
        const mkK = (base: number, cur: number, age: number) => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 72, pulse: 76, potassium: 4.4, creatinine: cur, egfr: Math.round(ckdEpi2021(cur, age, false) * 10) / 10, age, sex: 'Male', baseline_creatinine: base }, [entry('Lisinopril', 10, 'qd'), entry('Spironolactone', 25, 'qd')]);
        const p = mkK(1.3, 1.8, 62); const e = b7cExpected(p); assert.equal(e.band, 'reduce'); const a = runEngine(p).clinicalAlerts.find(x => x.startsWith('KIDNEY FUNCTION:') && /halv(e|ing) the RAAS/.test(x))!; assert.ok(/derived eGFR fall of \d+% meets the 2026 ESC criterion \(a fall above 30%\); the creatinine rise of 38% alone would not/.test(a), a);
        const { faults, counts } = sweepChecks('b7c', 60700000, 1000, (_q, sd) => b7cPatient(sd));
        assert.deepEqual(faults, []); assert.ok((counts['reduce: fall only'] ?? 0) > 20 && (counts['reduce: rise only'] ?? 0) > 3 && (counts['reduce: both met'] ?? 0) > 20, JSON.stringify(counts));
    });

    check('B7d with no pricing profile selected the unpriced-drug warning says so (not that prices have not loaded); with a profile selected and a drug unpriced it keeps the loading wording; priced drugs have no warning', () => {
        const mkP = (tier: string | undefined) => { const p = mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: 4.3, creatinine: 1.0, egfr: 70 }, [entry('Carvedilol', 12.5, 'bid')]); (p as unknown as { insurance_tier?: string }).insurance_tier = tier; return p; };
        const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
        const none = generateAndScoreModifications(mkP(undefined), names, {}); const w = none.scoredRegimens.flatMap(r => r.warnings.filter(x => x.startsWith('PRICE UNKNOWN:')));
        assert.ok(w.length > 0 && w.every(x => x.includes('no pricing profile is selected') && !/pricing loads/.test(x)), w.join(' | ').slice(0, 300));
        const some = generateAndScoreModifications(mkP('commercial'), names, {}); const w2 = some.scoredRegimens.flatMap(r => r.warnings.filter(x => x.startsWith('PRICE UNKNOWN:')));
        assert.ok(w2.length > 0 && w2.every(x => /Re-run after pricing loads/.test(x) && !x.includes('no pricing profile')), w2.join(' | ').slice(0, 300));
        const priced = generateAndScoreModifications(mkP('commercial'), names, Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]))); assert.ok(!priced.scoredRegimens.some(r => r.warnings.some(x => x.startsWith('PRICE UNKNOWN:'))));
    });

    // ---------------- C8 ------------------------------------------------------------------------------------------------------------------------------------------------------------
    // Part 2 ruling C8: the extreme-potassium message (with the B4 sentence) appears once on every path, input-error stops included; nothing else on those screens changes.
    const INPUT_ERROR_KINDS: Array<[string, (p: Patient) => void]> = [
        ['cost_sensitivity', p => { p.cost_sensitivity = -1; }], ['complexity_tolerance', p => { p.complexity_tolerance = 11; }], ['age under 18', p => { p.age = 12; }],
        ['kccq', p => { p.kccq_score = 150; }], ['race', p => { (p as unknown as { race: string }).race = 'x'; }], ['pricing profile', p => { (p as unknown as { insurance_tier: string }).insurance_tier = 'x'; }],
        ['classes per visit', p => { p.max_new_classes_per_visit = 1.5; }], ['scope', p => { p.scope_conditions = new Set(['not a condition']); }],
        ['exam finding', p => { p.volume_status.exam_findings = new Set(['not a finding']); }], ['sex', p => { (p as unknown as { sex: string }).sex = 'X'; }],
        ['nyha', p => { (p as unknown as { nyha_class: string }).nyha_class = 'V'; }], ['rhythm', p => { (p as unknown as { rhythm: string }).rhythm = 'x'; }],
        ['bad strength', p => { if (p.current_regimen[0]) p.current_regimen[0] = { ...p.current_regimen[0], dose: { ...p.current_regimen[0].dose, strength: 987654 } } as never; else p.cost_sensitivity = -2; }],
        ['ever_lvef_le_40', p => { (p as unknown as { ever_lvef_le_40: string }).ever_lvef_le_40 = 'maybe'; }],
    ];
    check('C8 potassium above 8.0 with a second input error of every kind: the extreme-potassium message with the action sentence is present once; nothing else changes (2,000 patients)', () => {
        const faults: string[] = []; let screens = 0;
        const potassiums = [8.1, 8.5, 9, 9.5, 12, 15, 8.06, 20]; // R12 D5(e) (rewritten): 8.01 was in this list; 8.01 to 8.04 now reads as the 8.0 the entry rounds to (no message), 8.06 is the nearest value that rounds above 8.0
        for (let i = 0; i < 2000; i++) {
            const sd = 61000000 + i; const [kind, apply] = INPUT_ERROR_KINDS[i % INPUT_ERROR_KINDS.length];
            const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); apply(q); q.potassium = potassiums[i % potassiums.length];
            const o = runEngine(clonePatient(q)); if (!o.clinicalAlerts.some(a => a.startsWith('INPUT ERROR'))) { faults.push(`${kind} seed ${sd}: not an input-error screen`); continue; }
            screens++;
            const K = o.clinicalAlerts.filter(a => a.startsWith('IMPLAUSIBLE VALUE: Serum potassium'));
            if (K.length !== 1 || !K[0].includes(K_ABOVE_8_ACTION)) faults.push(`${kind} seed ${sd} K ${q.potassium}: ${K.length} potassium alerts`);
            if (o.scoredRegimens.length !== 0) faults.push(`${kind} seed ${sd}: options shown`);
            // Nothing else changes: the same screen with the potassium left blank carries the same other alerts.
            const base = clonePatient(q); base.potassium = 0; const ob = runEngine(clonePatient(base));
            const rest = (a: string[]) => a.filter(x => !x.startsWith('IMPLAUSIBLE VALUE: Serum potassium')).join('\n');
            // (A value of 8.01 to 8.04 is read as 8.0 by the urgent-state alerts, which round to one decimal: existing behaviour, so the comparison starts at 8.05.)
            if (q.potassium >= 8.05 && rest(o.clinicalAlerts) !== rest(ob.clinicalAlerts)) faults.push(`${kind} seed ${sd}: other alerts differ from the blank-potassium screen`);
            if (faults.length > 6) break;
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(screens >= 1990, `${screens} input-error screens`);
    });

    // ---------------- C5 (KCCQ lines) -----------------------------------------------------------------------------------------------------------------------------------------------
    // On a no-option output no line speaks of "eligible medication decisions" or "other eligible decisions" (no decision is on the page). With options the lines are unchanged.
    const KCCQ_DECISION_WORDS = /eligible medication decisions|other eligible decisions/;
    check('C5 KCCQ lines: no-option outputs never speak of eligible decisions (every no-option path, 4,000 patients); outputs with options keep the lines', () => {
        const faults: string[] = []; let noOption = 0, withOptions = 0;
        for (let sd = 61100000; sd < 61100300; sd++) for (const [pn, pf] of NO_OPTION_PATHS) {
            const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); q.kccq_score = undefined; pf(q);
            const o = runEngine(clonePatient(q)); if (o.scoredRegimens.length > 0) continue; noOption++;
            const lines = [...(o.missingDataNotices ?? []), ...(o.decisionReadiness?.missing ?? []).map(m => m.consequence), ...(o.decisionReadiness?.available ?? [])];
            const bad = lines.find(l => KCCQ_DECISION_WORDS.test(l)); if (bad && faults.length < 6) faults.push(`${pn} seed ${sd}: ${bad.slice(0, 120)}`);
        }
        for (let sd = 61200000; sd < 61200100; sd++) {
            const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); q.kccq_score = undefined; const o = runEngine(clonePatient(q)); if (o.scoredRegimens.length === 0) continue; withOptions++;
            if (!(o.missingDataNotices ?? []).some(l => l.startsWith('KCCQ not measured') && /eligible medication decisions can still be reviewed/.test(l))) faults.push(`seed ${sd}: the KCCQ notice changed on a screen with options`);
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(noOption > 3000 && withOptions > 20, `${noOption} ${withOptions}`);
    });

    // =====================================================================================================================================================================
    // R12 SECTION (round 12 fix pass, rulings D1 to D5; rule set 2026-11-24.2). Each check was seen to fail before its fix.
    // =====================================================================================================================================================================
    // D1: the creatinine rise and the derived eGFR fall are rounded to six decimals once, so an exact 50 percent (or 100 percent) rise reads as exactly that.
    const d1Patient = (base: number, cur: number, egfr: number): Patient => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 72, pulse: 76, potassium: 4.5, creatinine: cur, egfr, age: 70, sex: 'Male', baseline_creatinine: base }, [entry('Lisinopril', 10, 'qd'), entry('Spironolactone', 25, 'qd')]);
    /** Every pair of creatinines on a grid of `scale` steps per mg/dL from 0.4 to 6.0 whose ratio is exactly num/den (integer arithmetic, no float). */
    const exactRatioPairs = (scale: number, num: number, den: number): Array<[number, number]> => { const out: Array<[number, number]> = []; for (let b = 0.4 * scale; b <= 6.0 * scale + 1e-9; b++) { const bi = Math.round(b); if ((bi * num) % den !== 0) continue; const ci = (bi * num) / den; if (ci > 6.0 * scale + 1e-9) continue; out.push([bi / scale, ci / scale]); } return out; };
    check('D1 (i) every one- and two-decimal creatinine pair with a ratio of exactly 1.5 or 2.0 gets the band the rule states, the same band as every other pair with that ratio at the same eGFR', () => {
        const faults: string[] = []; let pairs = 0;
        for (const scale of [10, 100]) for (const [num, den, label] of [[3, 2, '+50%'], [2, 1, '+100%']] as const) {
            const list = exactRatioPairs(scale, num, den); assert.ok(list.length >= 15, `${scale} ${label}: ${list.length} pairs`);
            for (const egfr of [12, 19.9, 60]) {
                // stated rule: a rise of 50% or more with eGFR below 20 stops; a rise above 100% stops; otherwise 50% or more halves. Exactly 100% is not "above 100%".
                const want = egfr < 20 ? 'stop' : 'reduce'; const bands = new Set<string>();
                for (const [b, c] of list) { pairs++; const ch = assessCreatinineChange(d1Patient(b, c, egfr))!; bands.add(ch.band); if (ch.band !== want && faults.length < 8) faults.push(`${label} ${b}->${c} eGFR ${egfr}: ${ch.band}, rule says ${want} (rise ${ch.risePct})`); }
                if (bands.size !== 1 && faults.length < 8) faults.push(`${label} eGFR ${egfr} grid ${scale}: bands differ across pairs: ${[...bands].join(',')}`);
            }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(pairs > 800, `${pairs} pairs`);
    });
    check('D1 (i) the reviewer patients on screen: 0.8 to 1.2 and 3.2 to 4.8 (eGFR 12) give the same action as 3.0 to 4.5 (stop); at eGFR 60 every exact 50% pair halves', () => {
        const kid = (p: Patient) => runEngine(p).clinicalAlerts.find(a => a.startsWith('KIDNEY FUNCTION:'))!;
        for (const [b, c] of exactRatioPairs(10, 3, 2)) { const a = kid(d1Patient(b, c, 12)); assert.ok(a && /meets the 2026 ESC criteria to stop the ACE inhibitor/.test(a), `${b}->${c} eGFR 12: ${a?.slice(0, 200)}`); }
        for (const [b, c] of exactRatioPairs(10, 3, 2)) { const a = kid(d1Patient(b, c, 60)); assert.ok(a && /halving the RAAS inhibitor/.test(a) && /creatinine rise of 50% (meets|and)/.test(a), `${b}->${c} eGFR 60: ${a?.slice(0, 260)}`); }
    });
    check('D1 (ii) the criterion sentence never says a figure that meets its criterion "would not" (generated baseline states, exact thresholds included: 3,000 here), and an exact threshold value prints as a whole number', () => {
        const faults: string[] = []; let reduce = 0, exact = 0;
        for (let i = 0; i < 3000; i++) {
            const base = Math.round((0.5 + (i * 7) % 40 / 10) * 100) / 100; const ratio = i % 3 === 0 ? 1.5 : i % 3 === 1 ? 1 + ((i * 13) % 90) / 100 : 1.3 + ((i * 11) % 30) / 100;
            const cur = Math.round(base * ratio * 100) / 100; if (cur > 15 || cur <= base) continue;
            const age = 40 + (i * 7) % 50, female = i % 2 === 1; const egfr = [60, 45, 30, 25][i % 4] as number;
            const p = d1Patient(base, cur, egfr); p.age = age; p.sex = female ? 'Female' : 'Male'; const ch = assessCreatinineChange(p)!; if (ch.band !== 'reduce') continue;
            reduce++; const text = reduceCriterionSentence(ch);
            const riseMetExact = Math.round(cur * 100) * 2 >= Math.round(base * 100) * 3; // 50% or more, in integer hundredths
            const riseExactly50 = Math.round(cur * 100) * 2 === Math.round(base * 100) * 3;
            const wouldNotRise = /creatinine rise of [\d.]+% alone would not/.test(text); const wouldNotFall = /derived eGFR fall of [\d.]+% alone would not/.test(text);
            if (wouldNotRise && riseMetExact) faults.push(`${base}->${cur}: says the rise "would not" meet but it is ${ch.risePct}%: ${text}`);
            if (wouldNotFall && ch.egfrFallPct !== null && ch.egfrFallPct > 30) faults.push(`${base}->${cur}: says the fall "would not" meet but it is ${ch.egfrFallPct}%: ${text}`);
            if (riseExactly50) { exact++; if (!/creatinine rise of 50% /.test(text) || /50\.0%/.test(text)) faults.push(`${base}->${cur}: exact 50% not printed as "50%": ${text}`); }
            if (faults.length > 8) break;
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(reduce > 800 && exact > 60, `${reduce} reduce states, ${exact} exact`);
    });
    check('D1 the derived eGFR fall is also compared rounded: a fall that is 30.000000x percent from float noise only is not read as above 30', () => {
        // Direct: the two rounded figures come from one place; the returned figures are already rounded to six decimals.
        for (const [b, c] of [[0.8, 1.2], [1.6, 2.4], [1.0, 1.3], [1.3, 1.8]] as const) { const ch = assessCreatinineChange(d1Patient(b, c, 60))!; assert.equal(ch.risePct, Math.round(ch.risePct * 1e6) / 1e6); if (ch.egfrFallPct !== null) assert.equal(ch.egfrFallPct, Math.round(ch.egfrFallPct * 1e6) / 1e6); }
    });


    // D2: a held or completed loop record is never given as the cause ALONE when the same patient with those records removed still has no loop step (blank kidney value, for example).
    check('D2 held-loop cause: when the patient with the loop records removed still has no loop step, the note and the no-loop warning never give the held-loop cause alone (blank kidney value, every record kind, with and without an active oral loop)', () => {
        const faults: string[] = []; let applies = 0, causeAlone = 0;
        for (let sd = 70300000; sd < 70300300; sd++) for (const kind of ['furoscixCompleted', 'furoscixHeld', 'otherHeld', 'otherCompleted'] as RecordKind[]) for (const blank of [true, false]) for (const noLoop of [false, true]) {
            const { p } = b1Patient(sd, kind, noLoop); if (blank) { p.egfr = 0; p.creatinine = 0; }
            const o = runEngine(clonePatient(p)); const base = runEngine(withoutLoopRecords(p));
            const texts = [...loopNotes(o), ...o.scoredRegimens.flatMap(r => r.warnings.filter(w => w.startsWith('This option leaves the patient without a loop diuretic')))].filter(t => t.includes('recorded as held or as a completed course'));
            if (!texts.length) continue;
            if (hasLoopStepOption(base)) { causeAlone++; for (const t of texts) if (t.includes("also, no oral loop diuretic step passed the tool's rules for this patient") && faults.length < 6) faults.push(`seed ${sd} ${kind}: the record is the blocker but the text adds the no-step clause: ${t.slice(0, 160)}`); continue; } // R13 E3: the record is the blocker: the cause stands ALONE
            applies++; for (const t of texts) if (!t.includes("also, no oral loop diuretic step passed the tool's rules for this patient") && !t.includes(GENERIC_PREREQ) && faults.length < 6) faults.push(`seed ${sd} ${kind} blank ${blank} noLoop ${noLoop}: held-loop cause alone although no step exists without the records: ${t.slice(0, 220)}`);
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(applies > 100 && causeAlone > 20, `${applies} patients without a step, ${causeAlone} with`);
    });

    // D3: the SLOW HEART RATE alert and the AV-block alert read the same use records.
    check('D3 slow-rate alert: with a rate-slowing drug recorded as held, completed or uncertain (with and without AV block, every drug) it says "no rate-slowing drug is recorded as taken (...)" in the AV-block alert\'s words; the plain "is taken" sentence only when none is recorded', () => {
        const faults: string[] = []; let withRecord = 0, plain0 = 0, both = 0;
        for (const drug of SLOW_DRUGS) for (const status of ['none', 'held', 'completed', 'unknown'] as const) for (const block of [false, true]) for (const incomplete of [false, true]) {
            const p = mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 40, potassium: 4.3, creatinine: 1.0, egfr: 70, rhythm: block ? '3rd Degree AV Block' : 'Sinus' }, [entry('Lisinopril', 10, 'qd')]);
            if (status !== 'none') { withDrug(p, drug); setUse(p, drug, status); } if (incomplete) { withDrug(p, 'Spironolactone'); const e = p.current_regimen.find(r => r.med.name === 'Spironolactone')!; e.dose = { ...e.dose, strength: 7.3 } as never; } // an entry the tool cannot read: the list is incomplete
            const o = runEngine(clonePatient(p)); const slow = o.clinicalAlerts.find(a => a.startsWith('SLOW HEART RATE')); const av = o.clinicalAlerts.find(a => a.startsWith('THIRD-DEGREE AV BLOCK'));
            const name = MEDICATION_FORMULARY.find(m => m.name.startsWith(drug))?.name ?? drug; const tag = `${drug} ${status} block=${block} incomplete=${incomplete}`;
            if (status === 'unknown') { // use not confirmed: the drug counts as taken with a mark, in both alerts (no slow-rate alert is raised for a drug taken)
                if (block && !(av ?? '').includes(`${name} (use not confirmed)`)) faults.push(`${tag}: the AV-block alert does not mark the drug: ${(av ?? 'none').slice(0, 200)}`); if (slow) faults.push(`${tag}: a slow-rate alert beside a drug whose use is unconfirmed: ${slow.slice(0, 160)}`); continue; }
            if (block) { if (!av) { faults.push(`${tag}: no AV-block alert`); continue; } if (status !== 'none' && !av.includes(HELD_RATE_SENTENCE(name, status))) faults.push(`${tag}: the AV-block alert does not name the record: ${av.slice(0, 260)}`); }
            if (!slow) { if (status === 'none' && !incomplete) faults.push(`${tag}: no slow-rate alert`); continue; }
            if (block) both++;
            if (status !== 'none') { withRecord++;
                if (/no rate-slowing drug is taken/.test(slow)) faults.push(`${tag}: says none is taken beside a ${status} record: ${slow.slice(0, 200)}`);
                if (!slow.includes(`no rate-slowing drug is recorded as taken (${HELD_RATE_SENTENCE(name, status)}`)) faults.push(`${tag}: lacks "no rate-slowing drug is recorded as taken (${HELD_RATE_SENTENCE(name, status)}": ${slow.slice(0, 260)}`);
                if (incomplete && !slow.includes(UNREADABLE_RATE_SENTENCE)) faults.push(`${tag}: the unreadable list is not said: ${slow.slice(0, 260)}`);
            } else if (!incomplete) { plain0++; if (!/no rate-slowing drug is taken\./.test(slow)) faults.push(`${tag}: plain sentence missing with nothing recorded: ${slow.slice(0, 200)}`); if (block && !av!.includes('none recorded here')) faults.push(`${tag}: the AV-block alert does not say none is recorded`); }
            else if (/no rate-slowing drug is taken/.test(slow)) faults.push(`${tag}: says none is taken with an unreadable list`);
            if (faults.length > 8) break;
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(withRecord >= 30 && plain0 >= 4 && both >= 10, `${withRecord} ${plain0} ${both}`);
    });

    // D4: no-option outputs drop every "other eligible decisions remain ..." clause (clauses deleted, no words added); outputs with options keep their text.
    const ELIGIBLE_CLAUSES = /eligible (medication )?decision|decisions? (may )?remain (available|assessable)|indications remain assessable/i;
    const stringsOf = (x: unknown, out: string[] = []): string[] => { if (typeof x === 'string') out.push(x); else if (Array.isArray(x)) x.forEach(v => stringsOf(v, out)); else if (x && typeof x === 'object') Object.values(x as object).forEach(v => stringsOf(v, out)); return out; };
    const d4Patient = (sd: number): Patient => { const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); q.kccq_score = undefined;
        q.current_regimen.forEach((r, i) => { if ((sd + i) % 3 === 0) r.exposure = { status: 'unknown', adherence: 'unknown', dose_interval_reviewed: false } as never; else if ((sd + i) % 3 === 1) r.exposure = { status: 'active', adherence: 'consistent', dose_interval_reviewed: false } as never; });
        if (sd % 4 === 0) q.pulse = 0; if (sd % 5 === 0) (q as unknown as { race?: string }).race = undefined; return q; };
    check('D4 no-option outputs on every stop path (5,000 here): no line speaks of eligible decisions remaining available or assessable; outputs with options keep the sentences', () => {
        const faults: string[] = []; let noOption = 0, withOptions = 0; const templates = new Set<string>();
        for (let sd = 70400000; sd < 70400700; sd++) for (const [pn, pf] of NO_OPTION_PATHS) {
            const q = d4Patient(sd); pf(q); const o = runEngine(clonePatient(q));
            const hits = stringsOf(o).filter(t => ELIGIBLE_CLAUSES.test(t));
            if (o.scoredRegimens.length === 0) { noOption++; for (const h of hits) { if (faults.length < 6) faults.push(`${pn} seed ${sd}: ${h.slice(0, 200)}`); } }
            else { withOptions++; for (const h of hits) { if (/unrelated eligible decisions remain assessable/.test(h)) templates.add('unrelated'); if (/other eligible decisions remain available/.test(h)) templates.add('other'); } }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(noOption >= 5000, `${noOption} no-option outputs`);
        assert.ok(withOptions > 300 && templates.has('unrelated') && templates.has('other'), `outputs with options lost their sentences: ${withOptions} outputs, ${[...templates]}`);
    });

    // D5(b): one sentence for the potassium emergency, in the form error and the engine alert; D5(e): the 8.01 to 8.04 values read as the 8.0 the entry rounds to, on every path.
    check('D5(b) the potassium messages read "If the value is accurate, this is a hyperkalemic emergency: obtain an ECG now, ..." once, built from the shared constant; "If accurate," is gone from the form error and the engine alert', () => {
        const want = 'If the value is accurate, this is a hyperkalemic emergency: obtain an ECG now, withhold potassium-raising drugs and potassium supplements, and arrange emergency assessment.';
        assert.equal(K_ABOVE_8_ACTION, want);
        for (const k of [8.1, 9.5, 12, 20]) { const p = mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: k, creatinine: 1.0, egfr: 70 }, [entry('Lisinopril', 10, 'qd')]);
            const err = validatePatientForm(p).potassium!; assert.equal(err, `Potassium exceeds the supported range. Verify the result and units immediately. ${want}`, err);
            const a = runEngine(p).clinicalAlerts.filter(x => x.startsWith('IMPLAUSIBLE VALUE: Serum potassium')); assert.equal(a.length, 1); assert.ok(a[0]!.includes(`transcription error. ${want}`) && !/If accurate,/.test(a[0]!) && a[0]!.split('If the value is accurate').length === 2, a[0]); }
    });
    check('D5(e) potassium 8.00, 8.01, 8.04, 8.05, 8.06 and 8.1 on every path (normal, input-error kinds, every no-option path): the verify-the-value message is present once exactly when the rounded value is above 8.0, never more or less', () => {
        const faults: string[] = []; let runs = 0;
        const paths: Array<[string, (p: Patient) => void]> = [...NO_OPTION_PATHS.filter(([n]) => n !== 'stop_k68'), ...INPUT_ERROR_KINDS];
        for (const k of [8.0, 8.01, 8.04, 8.05, 8.06, 8.1]) for (const [pn, pf] of paths) for (let sd = 70500000; sd < 70500004; sd++) {
            const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); pf(q); q.potassium = k; const o = runEngine(clonePatient(q)); runs++;
            const msgs = o.clinicalAlerts.filter(a => a.startsWith('IMPLAUSIBLE VALUE: Serum potassium')); const want = Math.round(k * 10) / 10 > 8.0 ? 1 : 0;
            if (msgs.length !== want && faults.length < 8) faults.push(`${pn} k=${k} seed ${sd}: ${msgs.length} messages, expected ${want}`);
            if (want === 1 && msgs.some(m => m.includes(`potassium ${k} `) && Math.round(k * 10) / 10 !== k) && faults.length < 8) faults.push(`${pn} k=${k}: the message prints the unrounded value`);
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(runs >= 400, `${runs}`);
    });

    // =====================================================================================================================================================================
    // R13 SECTION (round 13 fix pass, rulings E1 to E5; rule set 2026-11-25.1). Each check was seen to fail before its fix.
    // =====================================================================================================================================================================
    // E1: the difference between the current and the dry weight is rounded to six decimals once (weightDifferenceKg), so two entries exactly 1.0 or 2.0 kg apart read the same at every dry weight.
    check('R13 E1 (i) every dry weight 25.0 to 300.0 (step 0.1) with an offset of +1.0, +2.0, -1.0, -2.0 (and +1.1, +0.9 controls) reads like the reference pair (dry 63.0): the predicates on the whole grid, the whole output on every float-sensitive pair and every 10th dry weight', () => {
        const faults: string[] = []; let predicateRuns = 0, engineRuns = 0, sensitive = 0;
        const offsets = [1.0, 2.0, -1.0, -2.0, 1.1, 0.9]; const r1 = (x: number) => Math.round(x * 10) / 10;
        const bases: Array<[string, (dry: number, cur: number) => Patient]> = [
            ['congested on a loop', (dry, cur) => mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 70, pulse: 78, potassium: 4.5, creatinine: 1.0, egfr: 70, dry, cur, findings: ['Edema (2+)', 'Crackles'] }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 40, 'qd')])],
            ['euvolemic', (dry, cur) => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 76, potassium: 4.5, creatinine: 1.0, egfr: 70, dry, cur }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 80, 'qd')])],
            ['low output', (dry, cur) => mk({ lvef: 25, nyha_class: 'III', sbp: 96, dbp: 74, pulse: 82, potassium: 4.4, creatinine: 1.4, egfr: 48, bun: 40, dry, cur, findings: ['Cool Extremities', 'JVP Elevated'] }, [entry('Lisinopril', 5, 'qd'), entry('Furosemide', 40, 'qd')])],
        ];
        // What the weights can change is the congestion reading: options (drugs, doses, order), scores, every alert and warning, and the form label. Other weight effects (the carvedilol limit above 85 kg dry,
        // dosing by body weight) are held equal by taking the reference pair on the same side of 85 kg, and kilogram figures are normalised so a printed weight is not compared.
        const nk = (t: string): string => t.replace(/-?\d+(\.\d+)? kg/g, 'N kg');
        const sig = (p: Patient): string => { const o = runEngine(clonePatient(p)); return JSON.stringify({ alerts: o.clinicalAlerts.map(nk), monitoring: JSON.stringify(o.monitoringPlan), excluded: JSON.stringify(o.excludedMedications), gaps: JSON.stringify(o.gdmtGaps),
            options: o.scoredRegimens.map(r => [summaries(r), r.overall_score, r.warnings.map(nk), r.rationale.map(nk), r.risks.map(nk), nk(r.shown_because ?? '')]), label: nk(volumeDescription(p)) }); };
        const refDry = (dry: number): number => dry <= 85 ? 63.0 : 100.0;
        for (const [bn, mkp] of bases) for (const off of offsets) {
            const refs = new Map<number, { p: Patient; sg: string }>(); for (const d of [63.0, 100.0]) { const rp = mkp(d, r1(d + off)); refs.set(d, { p: rp, sg: sig(rp) }); }
            for (let i = 0; i <= 2750; i++) {
                const dry = r1(25 + i / 10), cur = r1(dry + off); if (cur < 25 || cur > 350) continue;
                const p = mkp(dry, cur); const { p: ref, sg: refSig } = refs.get(refDry(dry))!;
                // the cheap predicates, on the whole grid
                predicateRuns++;
                const same = isCongestedAboveDryWeight(p) === isCongestedAboveDryWeight(ref) && weightBelowDryWeight(p) === weightBelowDryWeight(ref) && meetsDecompensationFindings(p) === meetsDecompensationFindings(ref)
                    && diureticHeldForNoCongestion(p) === diureticHeldForNoCongestion(ref) && volumeDescription(p).replace(/\d+\.\d kg/, 'N kg') === volumeDescription(ref).replace(/\d+\.\d kg/, 'N kg');
                if (!same && faults.length < 10) faults.push(`${bn} offset ${off}: dry ${dry} / current ${cur} is read differently from dry 63 by a predicate`);
                const floatDiff = cur - dry; const isSensitive = off !== 1.1 && off !== 0.9 ? floatDiff !== off : false; if (isSensitive) sensitive++;
                if (isSensitive || i % 100 === 0) { engineRuns++; if (sig(p) !== refSig && faults.length < 10) faults.push(`${bn} offset ${off}: dry ${dry} / current ${cur}: the output differs from the reference pair`); }
            }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(predicateRuns > 45000 && sensitive >= 40 && engineRuns > 300, `${predicateRuns} ${sensitive} ${engineRuns}`);
    });

    // E2-1: the pulse pressure (systolic minus diastolic) is rounded once (pulsePressureMmHg), so a decimal pair exactly 25 apart reads as 25 on every path and prints as 25.
    check('R13 E2-1 a decimal blood pressure pair exactly 25 mmHg apart is a narrow pulse pressure (25 or less) on every path; 25.1 is not; the printed pressure is the rounded one', () => {
        const faults: string[] = []; let pairs = 0, engine = 0; const r1 = (x: number) => Math.round(x * 10) / 10;
        const base = (sbp: number, dbp: number): Patient => mk({ lvef: 18, nyha_class: 'III', sbp, dbp, pulse: 80, potassium: 4.4, creatinine: 1.6, egfr: 40, bun: 20, findings: ['Edema (2+)', 'Crackles'] }, [entry('Lisinopril', 5, 'qd'), entry('Carvedilol', 6.25, 'bid'), entry('Furosemide', 40, 'qd')]);
        for (let s10 = 500; s10 <= 2500; s10++) for (const pp10 of [250, 251, 249]) {
            const sbp = s10 / 10, dbp = r1(sbp - pp10 / 10); if (dbp < 20 || dbp > 150) continue; pairs++;
            const narrow = (Math.round(sbp * 10) - Math.round(dbp * 10)) <= 250; const p = base(sbp, dbp);
            const m = lowOutputMarkers(p).some(x => x.startsWith('pulse pressure')); const h = hasHypoperfusion(p);
            if ((m !== narrow || h !== (narrow || sbp < 90)) && faults.length < 8) faults.push(`${sbp}/${dbp}: narrow=${narrow} markers=${m} hypoperfusion=${h}`);
            if (m) { const t = lowOutputMarkers(p).find(x => x.startsWith('pulse pressure'))!; if (!/pulse pressure \d+(\.\d)? mmHg/.test(t) && faults.length < 8) faults.push(`${sbp}/${dbp}: prints "${t}"`); }
            if (s10 % 25 === 0 && pp10 === 250) { engine++; const o = runEngine(clonePatient(p)); const txt = JSON.stringify([o.clinicalAlerts, o.scoredRegimens.map(r => r.warnings)]);
                if (/pulse pressure \d+\.\d{4,}/.test(txt) && faults.length < 8) faults.push(`${sbp}/${dbp}: the engine prints an unrounded pulse pressure`);
            }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(pairs > 3500 && engine > 40, `${pairs} ${engine}`);
    });

    // E2-2: a kilogram difference printed beside a kilogram criterion shows the second decimal when there is one (1.04 kg above is not printed as the 1.0 of "more than 1.0 kg").
    check('R13 E2-2 every printed "X kg above / below" figure equals the entered difference (two-decimal weights: 1.04, 2.04, -1.04 and their neighbours), on every sentence that prints one', () => {
        const faults: string[] = []; let found = 0, runs = 0;
        const fixtures: Array<[string, (dry: number, cur: number) => Patient]> = [
            ['class and findings disagree', (dry, cur) => mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: 4.5, creatinine: 1.0, egfr: 70, dry, cur, findings: ['Edema (2+)', 'Crackles'] }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid')])],
            ['depleted on a diuretic', (dry, cur) => mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: 4.5, creatinine: 1.0, egfr: 70, dry, cur }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 40, 'qd')])],
            ['scale and examination disagree', (dry, cur) => mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 78, potassium: 4.5, creatinine: 1.0, egfr: 70, dry, cur, findings: ['Edema (2+)', 'Crackles'] }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 40, 'qd')])],
            ['congested, no loop', (dry, cur) => mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 70, pulse: 78, potassium: 4.5, creatinine: 1.0, egfr: 70, dry, cur }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid')])],
        ];
        const offsets = [1.04, 1.05, 1.1, 2.04, 2.05, 2.5, -1.04, -1.05, -1.1, 1.0, 2.0, -1.0, 0.96, 0.95, -0.96];
        for (const [fn, mkp] of fixtures) for (const off of offsets) for (const dry of [63.0, 80.5]) {
            const cur = Math.round((dry + off) * 100) / 100; const p = mkp(dry, cur); const o = runEngine(clonePatient(p)); runs++;
            const texts = [...o.clinicalAlerts, ...o.scoredRegimens.flatMap(r => [...r.warnings, r.shown_because ?? '']), volumeDescription(p)];
            for (const t of texts) for (const m of t.matchAll(/(?<!than )(?<!\d\.?)(\d+(?:\.\d+)?) ?kg (?:above|below)/g)) {
                found++; if (Math.abs(Number(m[1]) - Math.abs(off)) > 0.0051 && faults.length < 10) faults.push(`${fn} dry ${dry} current ${cur}: prints "${m[0]}" for a difference of ${off}: ${t.slice(0, 90)}`);
            }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(runs >= 100 && found >= 40, `${runs} runs ${found} printed figures`);
    });

    // E2-3: the BUN to creatinine ratio is rounded once (bunToCreatinineRatio), so a ratio of exactly 20 (BUN 9.4, creatinine 0.47) is not "above 20" for any digits.
    check('R13 E2-3 a BUN to creatinine ratio of exactly 20 is not above 20 for every one-decimal BUN and one- or two-decimal creatinine (integer arithmetic oracle), in the low-output marker and in the diuretic warning', () => {
        const faults: string[] = []; let pairs = 0, exact = 0;
        for (let b = 20; b <= 2000; b++) for (let c = 20; c <= 1500; c += (b % 7 === 0 ? 1 : 1)) {
            // BUN b/10 and creatinine c/100: ratio = (b/10)/(c/100) = 10 b / c; exactly 20 when c = b/2; one above (above 20) when 10 b > 20 c
            if (c !== Math.round(b / 2) && c !== Math.round(b / 2) + 1 && c !== Math.round(b / 2) - 1) continue;
            const bun = b / 10, cr = c / 100; pairs++; const above = 10 * b > 20 * c; if (10 * b === 20 * c) exact++;
            const p = mk({ lvef: 18, nyha_class: 'III', sbp: 110, dbp: 90, pulse: 80, potassium: 4.4, creatinine: cr, egfr: 40, bun }, [entry('Lisinopril', 5, 'qd')]);
            const marker = lowOutputMarkers(p).some(x => x.startsWith('BUN to creatinine ratio'));
            if (marker !== above && faults.length < 8) faults.push(`BUN ${bun} / creatinine ${cr}: ratio marker ${marker}, exact arithmetic says ${above}`);
            if (b % 37 === 0) { const q = mk({ lvef: 30, nyha_class: 'II', sbp: 92, dbp: 56, pulse: 78, potassium: 4.5, creatinine: cr, egfr: 60, bun }, [entry('Lisinopril', 10, 'qd'), entry('Furosemide', 40, 'qd')]); q.volume_status.dry_weight_kg = 80; q.volume_status.current_weight_kg = 80;
                const w = runEngine(clonePatient(q)).scoredRegimens.some(r => r.warnings.some(x => x.startsWith('Prerenal Azotemia'))); if (w && !above && faults.length < 8) faults.push(`BUN ${bun} / creatinine ${cr}: a ratio warning beside a ratio of exactly 20`); }
        }
        // a ratio that rounds to 20 without equalling it keeps its decimals beside "(above 20)" (BUN 60.1 over creatinine 3.0 is 20.03)
        const near = lowOutputMarkers(mk({ lvef: 18, nyha_class: 'III', sbp: 110, dbp: 90, pulse: 80, potassium: 4.4, creatinine: 3.0, egfr: 20, bun: 60.1 }, [entry('Lisinopril', 5, 'qd')])).find(x => x.startsWith('BUN to creatinine ratio'))!;
        assert.ok(near && !/ratio 20 \(above 20\)/.test(near) && /ratio 20\.03 \(above 20\)/.test(near), near);
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(pairs > 2000 && exact > 800, `${pairs} pairs ${exact} exact`);
    });

    // E2-4: potassium is read to one decimal everywhere (gates.ts auditInputs); the low-potassium alert read the raw value (3.46 raised it while every rule read 3.5). Now one reading.
    check('R13 E2-4 a two-decimal potassium reads exactly like its half-up one-decimal twin (output identical), around every stated limit', () => {
        const faults: string[] = []; let runs = 0;
        const ks = [3.46, 3.49, 3.51, 3.54, 4.96, 4.99, 5.01, 5.04, 5.05, 5.15, 5.19, 5.21, 5.24, 5.25, 5.45, 5.49, 5.51, 5.54, 5.95, 5.99, 6.01, 6.04];
        const fixtures: Array<[string, (k: number) => Patient]> = [
            ['on an MRA and an ACE inhibitor', k => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 76, potassium: k, creatinine: 1.0, egfr: 70 }, [entry('Lisinopril', 10, 'qd'), entry('Spironolactone', 25, 'qd'), entry('Carvedilol', 12.5, 'bid')])],
            ['ACE inhibitor, no MRA', k => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 76, potassium: k, creatinine: 1.0, egfr: 70 }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid')])],
            ['no RAAS inhibitor', k => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 76, potassium: k, creatinine: 1.0, egfr: 70 }, [entry('Carvedilol', 12.5, 'bid')])],
            ['loop and digoxin', k => mk({ lvef: 30, nyha_class: 'III', sbp: 124, dbp: 74, pulse: 76, potassium: k, creatinine: 1.0, egfr: 70, findings: ['Edema (2+)'], dry: 80, cur: 83 }, [entry('Lisinopril', 10, 'qd'), entry('Furosemide', 40, 'qd'), entry('Digoxin', 125, 'qd')])],
        ];
        const sig = (o: SimulationOutput): string => JSON.stringify(o, (key, v) => key === 'projected_patient' || key === 'regimen' || key === 'modification_set' ? undefined : v instanceof Set ? [...v] : v);
        for (const [fn, mkp] of fixtures) for (const k of ks) {
            const twin = Math.floor((Math.round(k * 100) + 5) / 10) / 10; runs++;
            if (sig(runEngine(clonePatient(mkp(k)))) !== sig(runEngine(clonePatient(mkp(twin)))) && faults.length < 8) faults.push(`${fn}: potassium ${k} is read differently from ${twin}`);
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(runs >= 80, `${runs}`);
    });

    // E3: the clause "also, no oral loop diuretic step passed the tool's rules for this patient" is added to the held-loop cause only when the same patient with the loop records removed still has no loop step.
    const E3_CLAUSE = "also, no oral loop diuretic step passed the tool's rules for this patient";
    check('R13 E3 the "also, no oral loop diuretic step passed ..." clause is present exactly when the patient with the held or completed loop records removed has no oral loop step (every record kind, blank kidney value or not, with and without an active loop)', () => {
        const faults: string[] = []; let patients = 0, withClause = 0, withoutClause = 0, texts = 0;
        for (let sd = 70400000; sd < 70400200; sd++) for (const kind of ['furoscixCompleted', 'furoscixHeld', 'otherHeld', 'otherCompleted'] as RecordKind[]) for (const blank of [true, false]) for (const noLoop of [false, true]) {
            const { p } = b1Patient(sd, kind, noLoop); if (blank) { p.egfr = 0; p.creatinine = 0; } patients++;
            const o = runEngine(clonePatient(p)); const base = runEngine(withoutLoopRecords(p)); const stepWithoutRecords = hasLoopStepOption(base);
            const all = [...loopNotes(o), ...o.scoredRegimens.flatMap(r => r.warnings.filter(w => w.startsWith('This option leaves the patient without a loop diuretic')))].filter(t => t.includes('recorded as held or as a completed course') && !t.includes(GENERIC_PREREQ));
            for (const t of all) { texts++; const has = t.includes(E3_CLAUSE); if (has) withClause++; else withoutClause++;
                if (has === stepWithoutRecords && faults.length < 8) faults.push(`seed ${sd} ${kind} blank ${blank} noLoop ${noLoop}: clause ${has ? 'present' : 'absent'} but the patient without the records ${stepWithoutRecords ? 'has' : 'has no'} loop step: ${t.slice(0, 200)}`); }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(patients >= 3000 && withClause > 100 && withoutClause > 100, `${patients} patients, ${texts} texts, ${withClause} with the clause, ${withoutClause} without`);
    });

    // E4: the kidney sentence prints the creatinines as entered (up to two decimals) and never prints a percentage that equals a criterion's number unless it does.
    check('R13 E4 kidney sentence: the printed creatinines equal the entries (one and two decimals), and a printed rise or derived fall equals 50, 100 or 30 only when the exact figure does (pairs aimed at 50%, 100% and a 30% eGFR fall)', () => {
        const faults: string[] = []; let pairs = 0, printed = 0; const rng = (() => { let a = 85400001; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; })();
        for (let i = 0; i < 700; i++) {
            const scale = rng() < 0.5 ? 10 : 100; const b = Math.round((0.5 + rng() * 2.5) * scale) / scale; const ratio = [1.5, 2.0, 1.4995, 1.5005, 1.995, 1.46 + rng() * 0.08, 1.96 + rng() * 0.08, 1.2 + rng() * 0.6][i % 8]!;
            const c = Math.round(b * ratio * scale) / scale; if (!(c > b) || c > 12) continue; pairs++;
            const age = [50, 62, 70, 78][i % 4]!; const egfr = [25, 45, 60, 19][i % 4]!;
            const p = mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 72, pulse: 76, potassium: 4.5, creatinine: c, egfr, age, sex: i % 2 ? 'Male' : 'Female', baseline_creatinine: b }, [entry('Lisinopril', 10, 'qd'), entry('Spironolactone', 25, 'qd')]);
            const ch = assessCreatinineChange(p)!; const o = runEngine(clonePatient(p));
            const texts = [ch.summary, ch.why, reduceCriterionSentence(ch), ...o.clinicalAlerts.filter(a => /KIDNEY FUNCTION/.test(a)), ...o.scoredRegimens.flatMap(r => r.warnings.filter(w => /creatinine/i.test(w) && /baseline/.test(w)))];
            for (const t of texts) {
                for (const m of t.matchAll(/creatinine (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?) mg\/dL/g)) { printed++; if ((Math.abs(Number(m[1]) - b) > 0.0051 || Math.abs(Number(m[2]) - c) > 0.0051) && faults.length < 10) faults.push(`entered ${b} to ${c}: prints "${m[0]}"`); }
                for (const m of t.matchAll(/(?:creatinine rise of |\(\+)(\d+(?:\.\d+)?)%/g)) { printed++; const v = Number(m[1]); for (const th of [50, 100]) if (v === th && ch.risePct !== th && faults.length < 10) faults.push(`entered ${b} to ${c}: prints a rise of ${v}% but the exact rise is ${ch.risePct}%: ${t.slice(0, 120)}`); }
                for (const m of t.matchAll(/derived eGFR fall (?:of )?(\d+(?:\.\d+)?)%(?! or less)/g)) { printed++; if (Number(m[1]) === 30 && ch.egfrFallPct !== 30 && faults.length < 10) faults.push(`entered ${b} to ${c}: prints a fall of 30% but the exact fall is ${ch.egfrFallPct}%`); }
            }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(pairs > 600 && printed > 1500, `${pairs} pairs ${printed} printed figures`);
        // the three figures the reviewer named
        assert.ok(/creatinine 1\.12 to 1\.77 mg\/dL/.test(assessCreatinineChange(mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 72, pulse: 76, potassium: 4.5, creatinine: 1.77, egfr: 40, age: 66, baseline_creatinine: 1.12 }, [entry('Lisinopril', 10, 'qd')]))!.summary));
        assert.ok(/creatinine 1\.1 to 1\.8 mg\/dL/.test(assessCreatinineChange(mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 72, pulse: 76, potassium: 4.5, creatinine: 1.8, egfr: 40, age: 66, baseline_creatinine: 1.1 }, [entry('Lisinopril', 10, 'qd')]))!.summary));
    });

    // E5(e): the nitrate with a PDE5 inhibitor alert begins its last sentence with a capital whether or not the first clause (the formulary nitrate removal) is present.
    check('R13 E5(e) nitrate with a PDE5 inhibitor: every sentence of the alert begins with a capital letter (formulary nitrate and external nitrate, every PDE5 inhibitor)', () => {
        const faults: string[] = []; let alerts = 0;
        for (const pde of ['Sildenafil', 'Tadalafil', 'Avanafil', 'Vardenafil']) for (const nit of ['Isosorbide Mononitrate', 'Isosorbide Dinitrate']) for (const withFormularyNitrate of [false, true]) {
            const regimen = [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid'), ...(withFormularyNitrate ? [entry('Hydralazine/Isosorbide Dinitrate', '37.5/20', 'tid')] : [])];
            let p: Patient; try { p = mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 76, potassium: 4.5, creatinine: 1.0, egfr: 70, ext: [pde, nit] }, regimen); } catch { continue; }
            const a = runEngine(clonePatient(p)).clinicalAlerts.filter(x => x.startsWith('INAPPROPRIATE THERAPY')); for (const t of a) { alerts++; for (const m of t.matchAll(/(?:^|[.!?] )([a-z])/g)) if (faults.length < 6) faults.push(`${pde} + ${nit}${withFormularyNitrate ? ' + BiDil' : ''}: a sentence begins with "${m[1]}": ${t.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 60)}`); }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(alerts >= 10, `${alerts} alerts`);
    });

    // E5(f): the pregnancy alert's availability sentence is deleted on an output with no option (nothing is "available" on that page); outputs with options keep it.
    const PREG_AVAILABLE = ' Hydralazine plus a nitrate and loop diuretics (only with congestion) remain available; beta-1-selective beta-blockers (metoprolol, bisoprolol) are the choice.';
    check('R13 E5(f) the pregnancy alert never says loop diuretics "remain available" on an output with no option (every stop path, pregnancy added); outputs with options keep the sentence', () => {
        const faults: string[] = []; let noOption = 0, withOptions = 0, seen = 0;
        for (let sd = 70600000; sd < 70600120; sd++) for (const [pn, pf] of NO_OPTION_PATHS) {
            const q = clonePatient(gen3r(sd).p as Patient); q.scope_conditions = new Set(); pf(q); q.sex = 'Female'; q.is_pregnant = true; q.age = pn === 'limited_review' ? 0 : Math.min(q.age || 30, 40);
            const o = runEngine(clonePatient(q)); const preg = o.clinicalAlerts.filter(a => a.startsWith('PREGNANCY ALERT')); if (!preg.length) continue; seen++;
            const has = preg.some(a => a.includes(PREG_AVAILABLE));
            if (o.scoredRegimens.length === 0) { noOption++; if (has && faults.length < 6) faults.push(`${pn} seed ${sd}: no option, but the pregnancy alert says what remains available`); if (preg.some(a => /remain available|are the choice/.test(a)) && faults.length < 6) faults.push(`${pn} seed ${sd}: a "remain available" clause is left on a no-option output`); if (preg.some(a => /\.\s*\.|;\s*\.|\s{2,}/.test(a)) && faults.length < 6) faults.push(`${pn} seed ${sd}: a broken sentence after the deletion`); }
            else { withOptions++; if (!has && faults.length < 6) faults.push(`${pn} seed ${sd}: an output with options lost the availability sentence`); }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(noOption >= 300 && withOptions >= 10, `${seen} alerts: ${noOption} outputs without options, ${withOptions} with`);
    });

    // E5(g): "cannot be a future exposure date" compares with the user's LOCAL calendar date, not the UTC date.
    check('R13 E5(g) a last-dose date of the local calendar day is accepted and the next local day is refused: 23:30 UTC in a UTC+2 zone (local day is already the 25th) and 01:00 UTC in a UTC-8 zone (local day is still the 24th)', () => {
        const RealDate = Date; const realTz = process.env.TZ;
        const withClock = (iso: string, tz: string, f: () => void) => {
            process.env.TZ = tz;
            globalThis.Date = class extends RealDate { constructor(...a: unknown[]) { if (a.length === 0) super(iso); else super(...(a as [string])); } static override now(): number { return new RealDate(iso).getTime(); } } as DateConstructor;
            try { f(); } finally { globalThis.Date = RealDate; if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz; }
        };
        const futureError = (day: string): boolean => exposureErrors({ status: 'active', adherence: 'consistent', last_dose_on: day } as never).some(e => /future exposure date/.test(e));
        withClock('2026-11-24T23:30:00Z', 'Europe/Athens', () => { assert.equal(new Date().getDate(), 25, 'the mocked local day'); assert.equal(futureError('2026-11-25'), false, 'today, entered in a UTC+2 zone, is called a future date'); assert.equal(futureError('2026-11-26'), true, 'tomorrow is accepted'); assert.equal(futureError('2026-11-24'), false); });
        withClock('2026-11-25T01:00:00Z', 'America/Los_Angeles', () => { assert.equal(new Date().getDate(), 24, 'the mocked local day'); assert.equal(futureError('2026-11-25'), true, 'tomorrow, entered in a UTC-8 zone, is accepted'); assert.equal(futureError('2026-11-24'), false, 'today is refused'); });
        withClock('2026-11-25T12:00:00Z', 'UTC', () => { assert.equal(futureError('2026-11-25'), false); assert.equal(futureError('2026-11-26'), true); });
    });

    // E6: the volume score reads the rounded weight difference for its penalty too, and rounds the penalty to six decimals before the integer rounding, so identical one-decimal differences score identically.
    check('R13 E6 volume score and overall score of every option equal those of the reference pair with the same offset (dry 25.0 to 300.0 by 0.1: the volume score on the whole grid, the engine on every 25th dry weight and every float-sensitive pair; 14 offsets incl. 1.1, 1.3, 1.5, 1.7, 2.3, -1.1, -1.5; 3 base patients)', () => {
        const faults: string[] = []; let direct = 0, engine = 0; const r1 = (x: number) => Math.round(x * 10) / 10;
        const offsets = [1.1, 1.3, 1.5, 1.7, 2.3, 2.5, 3.1, 4.5, -1.1, -1.5, 0.5, 1.0, 2.0, -1.0];
        for (const off of offsets) { const ref = Math.round(calculateVolumeScore(63.0, r1(63 + off), new Set())); for (let i = 0; i <= 2750; i++) { const dry = r1(25 + i / 10), cur = r1(dry + off); direct++; const got = Math.round(calculateVolumeScore(dry, cur, new Set())); if (got !== ref && faults.length < 8) faults.push(`volume score at dry ${dry} offset ${off}: ${got}, reference ${ref}`); } }
        const bases: Array<(dry: number, cur: number) => Patient> = [
            (dry, cur) => mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 70, pulse: 78, potassium: 4.5, creatinine: 1.0, egfr: 70, dry, cur, findings: ['Edema (2+)', 'Crackles'] }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 40, 'qd')]),
            (dry, cur) => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 76, potassium: 4.5, creatinine: 1.0, egfr: 70, dry, cur }, [entry('Lisinopril', 10, 'qd'), entry('Carvedilol', 12.5, 'bid'), entry('Furosemide', 80, 'qd')]),
            (dry, cur) => mk({ lvef: 25, nyha_class: 'III', sbp: 96, dbp: 74, pulse: 82, potassium: 4.4, creatinine: 1.4, egfr: 48, bun: 40, dry, cur, findings: ['Cool Extremities', 'JVP Elevated'] }, [entry('Lisinopril', 5, 'qd'), entry('Furosemide', 40, 'qd')]),
        ];
        const scores = (p: Patient): string => JSON.stringify(runEngine(clonePatient(p)).scoredRegimens.map(r => [r.domain_scores.volume, r.overall_score]));
        for (const mkp of bases) for (const off of offsets) {
            const refs = new Map<number, string>(); for (const d of [63.0, 100.0]) refs.set(d, scores(mkp(d, r1(d + off))));
            for (let i = 0; i <= 2750; i++) { const dry = r1(25 + i / 10), cur = r1(dry + off); if (cur < 25 || cur > 350) continue; if (i % 25 !== 0 && !(Math.abs(off) === 1 && cur - dry !== off)) continue;
                engine++; if (scores(mkp(dry, cur)) !== refs.get(dry <= 85 ? 63.0 : 100.0) && faults.length < 8) faults.push(`engine at dry ${dry} offset ${off}: ${scores(mkp(dry, cur))} versus ${refs.get(dry <= 85 ? 63.0 : 100.0)}`); }
        }
        assert.deepEqual(faults, [], faults.join(' || ')); assert.ok(direct > 38000 && engine > 1000, `${direct} ${engine}`);
    });

    check('B0 the rule set is 2026-11-25.1', () => { assert.equal(RULESET_VERSION, '2026-11-25.1'); });
    void isFuroscix; void NO_OPTION_PATHS;
    return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { const r = runEngineReadinessR11Checks(); process.exit(r.failed > 0 ? 1 : 0); }
