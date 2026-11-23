/**
 * Seeded sweeps for the round 6 rulings. Usage: `npx tsx scripts/engineReadinessR6Sweep.ts <mode> <firstSeed> <count>` (chunks of at most 5,000 patients per process).
 * Modes: v1v2 (allergy entries: the unmatched note appears if and only if the entry changed nothing; the same-class allergy check appears exactly on options that start a drug of a listed-allergy class),
 *        v3 (no option does what a hold alert says is held), v7 (no "Why" line withholds a class an option starts), v14 (every reason sentence names a factor on which its option is better by the printed figures),
 *        v17v18 (kidney values and iron/weight inputs not entered are never stated as measurements; every formulary drug), v13v19 (start-only wording and conditional drug notes).
 * Exits 1 on any exception and prints the first examples.
 */
import { MEDICATION_FORMULARY } from '../constants';
import { gen3r } from './r3Generator';
import { clonePatient } from '../data/scenarios';
import { allText } from './engineReadinessR5Checks';
import { runEngine } from './engineReadinessR2Checks';
import {
    allergyVocabulary, UNMATCHED_NOTE, SAME_CLASS_WARNING, expectedSameClass, holdViolations, classViolations, reasonViolations, falseKidneyClaims, startedDrugs, modsOfOption,
} from './engineReadinessR6Checks';
import type { Patient, SimulationOutput } from '../types';

const [mode = 'v3', firstArg = '9900000', countArg = '5000'] = process.argv.slice(2);
const first = Number(firstArg), count = Math.min(Number(countArg), 5000);
const bad: Record<string, string[]> = {}; const counts: Record<string, number> = {};
const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const fail = (k: string, seed: number, msg: string) => { inc(`FAIL_${k}`); (bad[k] ??= []).length < 5 && bad[k].push(`seed ${seed}: ${msg.slice(0, 300)}`); };
const patientOf = (sd: number, f?: (p: Patient) => void): Patient => { const p = clonePatient(gen3r(sd).p); p.scope_conditions = new Set(); f?.(p); return p; };
const vocab = allergyVocabulary();
const multi = MEDICATION_FORMULARY.filter(m => MEDICATION_FORMULARY.some(o => o !== m && o.drug_class === m.drug_class));

for (let sd = first; sd < first + count; sd++) {
    let o: SimulationOutput;
    try {
        if (mode === 'v1v2') {
            // V1: a random wording; the unmatched note appears iff nothing changed. V2: a random multi-agent drug listed as an allergy.
            const text = vocab[(sd * 7919) % vocab.length];
            const p0 = patientOf(sd);
            const without = runEngine(clonePatient(p0));
            const p1 = patientOf(sd); p1.allergies = new Set([...p1.allergies, text]);
            o = runEngine(p1); inc('v1_runs');
            const noteShown = o.clinicalAlerts.some(a => UNMATCHED_NOTE.test(a)) || [...(o.decisionReadiness?.deferred ?? []), ...(o.decisionReadiness?.available ?? [])].some(a => /Unmatched entries/.test(a));
            // What an entry can change: the withheld list, the options with their warnings, the alerts other than the note itself, the gaps and the monitoring. (The "why" block is left out: the note itself adds a
            // "safety alerts are in force (allergy note)" line and shifts the lines after it.)
            const sig2 = (x: SimulationOutput) => JSON.stringify({ ex: x.excludedMedications.map(e => [e.name, e.reason, (e as unknown as { why?: unknown }).why]), opts: x.scoredRegimens.map(r => [r.modification_set?.modifications.map(m => m.summary), r.warnings]),
                alerts: x.clinicalAlerts.filter(a => !/^ALLERGY NOTE/.test(a)), mon: x.monitoringPlan, gaps: x.gdmtGaps });
            const changed = sig2(without) !== sig2(o);
            if (noteShown && changed) fail('V1_note_but_changed', sd, `"${text}"`);
            const drug = multi[(sd * 104729) % multi.length];
            const p2 = patientOf(sd); p2.allergies = new Set([...p2.allergies, drug.name]);
            const o2 = runEngine(p2); inc('v2_runs');
            for (const [i, r] of o2.scoredRegimens.entries()) {
                const exp = expectedSameClass(p2, r), got = r.warnings.filter(w => SAME_CLASS_WARNING.test(w));
                if (exp.length > 0) inc('v2_expected_options');
                if ((got.length > 0) !== (exp.length > 0)) fail('V2_check_iff_same_class', sd, `${drug.name} option ${i + 1}: expected ${exp.join(',') || 'none'}, got ${got.length}`);
                else if (exp.some(n => !got.some(w => w.includes(n)) )) fail('V2_check_names_drug', sd, `${drug.name} option ${i + 1}`);
            }
            void startedDrugs;
        } else if (mode === 'v3') {
            o = runEngine(patientOf(sd)); inc('runs');
            const v = holdViolations(o); if (v.length) fail('V3_hold_violation', sd, v[0]);
            inc('hold_alerts', o.clinicalAlerts.filter(a => /^(POTASSIUM HOLD|BRADYCARDIA ON|BETA-BLOCKER START DEFERRED|KIDNEY FUNCTION:|POTASSIUM (STOP|REDUCE))/.test(a)).length);
        } else if (mode === 'v7') {
            for (const forced of [undefined, ['pregBlank'], ['blankLab']] as const) {
                const p = clonePatient(gen3r(sd, forced as never).p); p.scope_conditions = new Set();
                o = runEngine(p); inc('runs');
                const v = classViolations(o); if (v.length) fail('V7_class_withheld_but_started', sd, v[0]);
                inc('class_withheld_lines', (o.why_first?.options ?? []).flatMap(w => w.lines).filter(l => /is withheld because information is missing/.test(l.text)).length);
            }
        } else if (mode === 'v14') {
            o = runEngine(patientOf(sd)); inc('runs');
            const v = reasonViolations(o); if (v.length) fail('V14_reason_not_better', sd, v[0]);
            inc('options_with_reasons', (o.why_first?.options ?? []).length);
        } else if (mode === 'v17v18') {
            // blank kidney (every blank form) with a random formulary drug taken, plus a typed 0 hemoglobin and a blank dry weight
            const drug = MEDICATION_FORMULARY[(sd * 31) % MEDICATION_FORMULARY.length];
            for (const form of [0, undefined, NaN]) {
                const p = patientOf(sd); (p as unknown as Record<string, unknown>).egfr = form; (p as unknown as Record<string, unknown>).creatinine = form; p.baseline_creatinine = undefined;
                if (!p.current_regimen.some(r => r.med.name === drug.name)) p.current_regimen = [...p.current_regimen, { med: drug, dose: drug.available_doses[0], selected_frequency: drug.available_doses[0].frequency_options[0], exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } }];
                if (sd % 3 === 0) p.allergies = new Set([drug.name]);
                o = runEngine(p); inc('kidney_blank_runs');
                const c = falseKidneyClaims(o); if (c.length) fail('V17_false_egfr_claim', sd, c[0]);
            }
            const q = patientOf(sd); q.hemoglobin = 0; (q.volume_status as unknown as Record<string, unknown>).dry_weight_kg = 0;
            o = runEngine(q); inc('v18_runs');
            const ZERO = /\b(Hb|hemoglobin) (is |of |was |at )?0(\.0)?( g\/dL)?\b|(?<![\d.])0 kg\b/i;
            const t = allText(o).find(x => ZERO.test(x)); if (t) fail('V18_zero_printed', sd, t);
        } else if (mode === 'v13v19') {
            o = runEngine(patientOf(sd)); inc('runs');
            const START = /\b(at initiation|after starting|soon after starting|after a start|at the start|within the first doses)\b/i;
            for (const [i, r] of o.scoredRegimens.entries()) {
                const startsAny = modsOfOption(r).some(m => (m.action === 'add' || m.action === 'swap' || m.action === 'titrate_up') && m.target);
                for (const t of [...r.warnings, ...(r.monitoring_plan ?? []).map(x => `${x.test} | ${x.timing} | ${x.details}`)]) if (START.test(t) && !startsAny) fail('V19a_start_wording_on_option_that_starts_nothing', sd, `option ${i + 1}: ${t}`);
                if (r.warnings.some(w => /seek specialist advice before starting (in NYHA class IV|with a recent exacerbation)/.test(w)) && !sdNyha4(sd)) fail('V13_specialist_advice_note_without_NYHA_IV_or_worsening', sd, `option ${i + 1}`);
            }
        } else throw new Error(`unknown mode ${mode}`);
    } catch (e) { fail('EXCEPTION', sd, String((e as Error).message ?? e)); }
}
function sdNyha4(sd: number): boolean { const p = gen3r(sd).p as Patient; return p.nyha_class === 'IV' || p.recent_hf_worsening_within_6mo === 'yes'; }
console.log(JSON.stringify({ mode, first, count, ...counts }, null, 1));
for (const [k, v] of Object.entries(bad)) { console.log(`== ${k}`); v.forEach(x => console.log('  ' + x)); }
if (!Object.keys(bad).length) console.log('No exceptions.');
process.exit(Object.keys(bad).length ? 1 : 0);
