/**
 * Seeded random sweep for the round 2 rulings (S1a, S1b, S2, S3, S4, S10, S11). For each ruling: how many patients are in the state and in how many the rule held.
 * Usage: npx tsx scripts/engineRound2Sweep.ts [count] [firstSeed]. The base patients come from fuzzSweep.randomPatient; one in three is nudged into a rare state
 * (cool extremities, potassium 6.0-6.4, congestion with a low weight, heart block) so each ruling is exercised many times. Not part of the gate.
 */
import { MEDICATION_FORMULARY } from '../constants';
import { randomPatient } from './fuzzSweep';
import { generateAndScoreModifications } from '../services/simulationService';
import { scoredCandidates } from './scoredCandidates';
import { isColdState, hasCongestion, countVisitLimitChanges, scaleAndExamDisagree } from '../services/engine/regimenUtils';
import { isAcutelyDecompensated } from '../services/clinicalPredicates';
import { partitionAlerts } from '../components/resultsModel';
import type { Patient, ScoredRegimen } from '../types';

const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 15]));
const count = Number(process.argv[2] ?? 20000), seed0 = Number(process.argv[3] ?? 7000000);
const chg = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
const loopUp = (r: ScoredRegimen) => chg(r).some(m => (m.action === 'add' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Loop Diuretic' && !m.target.med.facts?.short_course_addon);
const tally: Record<string, { state: number; held: number; exceptions: string[] }> = {};
const t = (k: string) => (tally[k] ??= { state: 0, held: 0, exceptions: [] });
const rec = (k: string, ok: boolean, seed: number, why: string) => { const x = t(k); x.state++; if (ok) x.held++; else if (x.exceptions.length < 8) x.exceptions.push(`seed ${seed}: ${why}`); };
const quiet = console.warn; console.warn = () => { };
let ran = 0, withOptions = 0;
for (let i = 0; i < count; i++) {
    const seed = seed0 + i;
    const p: Patient = randomPatient(seed);
    const nudge = i % 6;
    if (nudge === 1) { p.volume_status.exam_findings.add('Cool Extremities'); if (i % 12 === 1) { p.nyha_class = 'IV'; p.volume_status.current_weight_kg = p.volume_status.dry_weight_kg + 5; p.volume_status.exam_findings.add('Edema (2+)'); } }
    if (nudge === 2) { p.potassium = 6.0 + (i % 5) / 10; }
    if (nudge === 3) { p.volume_status.current_weight_kg = p.volume_status.dry_weight_kg - 3; p.volume_status.exam_findings.add('Orthopnea'); p.volume_status.exam_findings.add('Crackles'); }
    if (nudge === 4) { p.rhythm = i % 12 === 4 ? '3rd Degree AV Block' : '2nd Degree AV Block'; }
    if (nudge === 5) { p.nyha_class = i % 12 === 5 ? 'IV' : 'III'; p.volume_status.current_weight_kg = p.volume_status.dry_weight_kg + 4; p.volume_status.exam_findings.add('Edema (2+)'); p.volume_status.exam_findings.add('JVP Elevated'); }
    let out; try { out = generateAndScoreModifications(p, names, prices); } catch (e) { rec('THREW', false, seed, String(e).slice(0, 100)); continue; }
    ran++; if (out.scoredRegimens.length) withOptions++;
    const picks = out.scoredRegimens, urgent = partitionAlerts(out.clinicalAlerts).urgent.map(a => a.raw);
    const reached = out.decisionReadiness?.mode !== 'limited_review' && !out.clinicalAlerts.some(a => /^(IMPLAUSIBLE|DATA REQUIRED: (systolic|current weight|dry weight|LVEF)|INPUT ERROR)/.test(a));
    if (!reached) continue;
    // S1a
    if (isColdState(p)) {
        const bad = picks.flatMap(r => chg(r).filter(m => ['add', 'titrate_up', 'swap'].includes(m.action) && !(m.target?.med.drug_class === 'Loop Diuretic' && hasCongestion(p)) && !(m.action === 'swap' && m.mandatory && m.source?.med.drug_class === 'Beta Blocker')).map(m => m.summary.slice(0, 50)));
        const stopped = p.sbp < 90 || p.potassium >= 6.5 || p.rhythm === '3rd Degree AV Block';
        rec('S1a cold: no start or raise (except a diuretic when congested)', bad.length === 0 && (stopped || urgent.some(a => /^POOR PERFUSION/.test(a))), seed, bad.join('; ') || 'urgent alert missing');
    }
    // S1b
    if (isAcutelyDecompensated(p)) {
        const stopped = p.sbp < 90 || p.potassium >= 6.5 || p.rhythm === '3rd Degree AV Block';
        let ok = stopped || urgent.some(a => /^ACUTE DECOMPENSATION/.test(a) && /same-day evaluation/.test(a));
        if (ok && !stopped && hasCongestion(p) && picks.length > 0 && !p.potassium) ok = ok;
        if (ok && !stopped && hasCongestion(p) && picks.length > 0) {
            const all = picks.every(loopUp), none = picks.every(r => !loopUp(r) && r.warnings.some(w => /No loop diuretic start or increase/.test(w)));
            ok = all || none || (p.potassium >= 6.0 || isColdState(p));  // the potassium and perfusion states restrict options further; the loop step there is checked under S1a/S3
        }
        rec('S1b decompensated: urgent alert; every option has a loop step or says why none', ok, seed, 'alert or loop step missing');
    }
    // S2
    if (scaleAndExamDisagree(p)) {
        const bad = picks.flatMap(r => chg(r).filter(m => (m.action === 'remove' || m.action === 'titrate_down') && m.source?.med.drug_class === 'Loop Diuretic' && !m.mandatory).map(m => m.summary.slice(0, 50)));
        const volDepl = out.clinicalAlerts.some(a => /^VOLUME DEPLETION/.test(a));
        const disagree = out.clinicalAlerts.some(a => /^SCALE AND EXAMINATION DISAGREE/.test(a)) || p.sbp < 90 || p.potassium >= 6.5 || p.rhythm === '3rd Degree AV Block';
        rec('S2 scale below dry weight with congestion: disagreement alert, no depletion alert, no diuretic reduction as a volume step', bad.length === 0 && !volDepl && disagree, seed, `${bad.join('; ')} depl=${volDepl} disagree=${disagree}`);
    }
    // S3
    if (p.potassium >= 6.0 && p.potassium < 6.5 && p.sbp >= 90 && p.rhythm !== '3rd Degree AV Block') {
        const bad = picks.flatMap(r => chg(r).filter(m => ['add', 'titrate_up', 'swap'].includes(m.action) && !(m.action === 'titrate_up' && m.target?.med.drug_class === 'K+ Binder')).map(m => m.summary.slice(0, 50)));
        const plan = picks.every(r => (r.monitoring_plan ?? []).some(x => /ECG/.test(x.test)));
        rec('S3 K 6.0 to 6.4: no start or raise; urgent repeat and ECG in every plan', bad.length === 0 && plan && urgent.some(a => /^HYPERKALEMIC EMERGENCY/.test(a)), seed, `${bad.join('; ')} plan=${plan}`);
    }
    // S4
    if (p.rhythm === '3rd Degree AV Block' && p.sbp > 0) rec('S4 third-degree block: no options, urgent alert naming pacing', picks.length === 0 && urgent.some(a => /^THIRD-DEGREE AV BLOCK/.test(a) && /pacing/.test(a)), seed, `${picks.length} options`);
    if (p.rhythm === '2nd Degree AV Block') rec('S4 second-degree block: urgent alert, no rate-lowering drug started', urgent.some(a => /^SECOND-DEGREE AV BLOCK/.test(a)) && picks.every(r => !chg(r).some(m => m.action === 'add' && ['Beta Blocker', 'If Inhibitor', 'Inotrope'].includes(m.target!.med.drug_class))), seed, 'alert or rate-lowering start');
    // S10 (balanced ranking): compare with the no-change candidate when it exists
    if (picks.length > 0) {
        let keep: ScoredRegimen | undefined; try { keep = scoredCandidates(p, names, prices).find(r => chg(r).length === 0); } catch { /* skip */ }
        if (keep) rec('S10 no change is a candidate: no displayed option scores below it unless labelled', picks.every(r => (r.raw_score ?? 0) >= (keep!.raw_score ?? 0) - 1e-9 || !!r.shown_because), seed, 'option below no change without a label');
    }
    // S11
    if (picks.length > 0) {
        const bad = picks.filter(r => r.modification_set && countVisitLimitChanges(r.modification_set, p.current_regimen) > Math.max(0, Math.round(p.max_new_classes_per_visit ?? 2)));
        rec('S11 per-visit limit counts an ACE inhibitor or ARB to ARNI switch', bad.length === 0, seed, `${bad.length} options over the limit`);
    }
}
console.warn = quiet;
console.log(`patients run: ${ran} of ${count}; with options: ${withOptions}`);
Object.entries(tally).forEach(([k, v]) => { console.log(`${k}\n   in state: ${v.state}, rule held: ${v.held}, exceptions: ${v.state - v.held}`); v.exceptions.forEach(e => console.log('     ' + e)); });
