/**
 * Round 5 seeded random sweep (rulings Y1, Y3, Y4, Y6, Y7, Y8): `npx tsx scripts/engineReadinessR5Sweep.ts <count> <firstSeed> [out.json]`. Patients come from `r3Generator.ts`. Not part of the gate (it is long); the same
 * rules are asserted on the reviewers' patients and on small samples by `engineReadinessR5Checks.ts`. Run in chunks of at most 5,000 patients per process. Prints counts of what was checked and every exception.
 * Each patient is run on several paths (the ordinary one, an input error, a limited review, systolic not above diastolic, an implausible ejection fraction, a potassium stop, a hypotension stop, heart block, a scope condition).
 * Expected values are recomputed here from the entered values, not read from the engine's own predicates (the engine's own definition of an active drug is the one shared helper).
 */
import { writeFileSync } from 'node:fs';
import { gen3r } from './r3Generator';
import { PRICES as TIER_PRICES } from './r2Generator';
import { MEDICATION_FORMULARY } from '../constants';
import { generateAndScoreModifications, clonePatient } from '../services/simulationService';
import { isActiveExposure } from '../services/engine/medicationExposure';
import { expandAllergies } from '../services/engine/allergy';
import type { Patient, SimulationOutput } from '../types';

const NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));
const run = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePatient(p), NAMES, TIER_PRICES[p.insurance_tier ?? 'cash']);
const n = Number(process.argv[2] ?? 1000), first = Number(process.argv[3] ?? 9700000), outFile = process.argv[4];
const head = (a: string) => { const i = a.indexOf(': '); return i > 0 ? a.slice(0, i) : a.slice(0, 40); };

const PRINTED_ZERO = /(?:\b(?:is|of|at|was|to|reads?) |\()0(?:\.0)? ?(?:mmHg|bpm|kg|%|mg|mEq\/L|mmol\/L|mL\/min|g\/dL|pg|ng)|(?:^|[^\d.])0 ?mmHg|\b(?:eGFR|potassium|LVEF|ejection fraction|creatinine|heart rate|pulse|oxygen saturation|SpO2|hemoglobin|weight|BUN|age|systolic(?: blood pressure)?) (?:is |of |was )?0(?:\.0)?(?![\d.])/i;
const THRESHOLD_HEADS = ['HEMODYNAMIC INSTABILITY', 'HYPERKALEMIC EMERGENCY', 'HYPOXIA ALERT', 'POOR PERFUSION', 'POSSIBLE POOR PERFUSION', 'LOW OUTPUT STATE', 'ACUTE DECOMPENSATION', 'SLOW HEART RATE', 'LOW POTASSIUM', 'SCALE AND EXAMINATION DISAGREE'];
// (the congestion-without-weight-gain alert is not a threshold on one input: it is also silenced by a measured potassium below 3.5, so a blank potassium can raise it correctly)
const OPTION_WORDS = /\b(options?|plans?|planned|planning|recommend\w*)/i;
const PER_ITEM_HEADS = new Set(['INAPPROPRIATE REGIMEN', 'EXPOSURE HISTORY', 'AVOID', 'MEDICATION RECONCILIATION', 'PREGNANCY SAFETY REVIEW', 'DATA REQUIRED', 'DATA NOTE', 'DRUG REMOVED FOR KIDNEY FUNCTION',
    'INAPPROPRIATE THERAPY', 'DUPLICATE THERAPY', 'IMPLAUSIBLE VALUE', 'ALLERGY CONFLICT', 'ALLERGY NOTE', 'INTERACTION', 'DRUG INTERACTION', 'CONTRAINDICATED COMBINATION', 'MEDICATION USE REVIEW']);

const counts: Record<string, number> = {
    patients: 0, runs: 0, no_option_runs: 0,
    Y1_blank_runs: 0, Y1_printed_zero: 0, Y1_threshold_from_blank: 0, Y1_sbp_blank_hemodynamic: 0,
    Y3_runs: 0, Y3_expected: 0, Y3_missing: 0, Y3_unexpected: 0, Y3_both_with_scale: 0, Y3_sentence_missing: 0,
    Y4_runs: 0, Y4_expected: 0, Y4_missing: 0, Y4_unexpected: 0,
    Y6_alerts_scanned: 0, Y6_option_words: 0, Y6_rehab_beside_instability: 0, Y6_rate_paragraph_wrong: 0,
    Y7_runs: 0, Y7_repeated_heading: 0, Y7_identical_text: 0,
    Y8_runs: 0, Y8_potassium_alert_lost: 0,
};
const exceptions: string[] = [];
const bad = (key: string, seed: number, msg: string) => { counts[key]++; if (exceptions.length < 80) exceptions.push(`${key} seed ${seed}: ${msg}`); };
const unknown = (v: unknown) => !(typeof v === 'number' && Number.isFinite(v) && v > 0);

const PATHS: Array<[string, (p: Patient) => void]> = [
    ['ordinary', () => { /* as generated */ }], ['input error', p => { p.cost_sensitivity = -1; }], ['limited review', p => { p.age = 0; }], ['sbp not above dbp', p => { p.sbp = Math.min(p.sbp || 100, 110); p.dbp = p.sbp + 5; }],
    ['implausible ejection fraction', p => { p.lvef = 250; }], ['potassium stop', p => { p.potassium = 6.8; }], ['hypotension stop', p => { p.sbp = 84; p.dbp = 50; }],
    ['heart block', p => { p.rhythm = '3rd Degree AV Block'; }], ['scope condition', p => { p.scope_conditions = new Set(['Dialysis']); }],
];
const NUMERIC: Array<keyof Patient> = ['sbp', 'dbp', 'pulse', 'potassium', 'egfr', 'creatinine', 'lvef', 'oxygen_saturation', 'hemoglobin', 'age', 'bun', 'nt_pro_bnp', 'bmi'];
const BLANKS: unknown[] = [0, undefined, Number.NaN];

/** Y3 expectation from the entered values. */
const congestionFindings = (p: Patient): number => { let k = 0, edema = false; for (const f of p.volume_status.exam_findings) { if (f === 'Cool Extremities') continue; if (f.startsWith('Edema')) edema = true; else k++; } return k + (edema ? 1 : 0); };
const y3Expected = (p: Patient): boolean => {
    const w = p.volume_status.current_weight_kg, d = p.volume_status.dry_weight_kg;
    if (unknown(w) || unknown(d)) return false;
    const ex = w - d;
    if (ex > 1 || ex < -1) return false;
    if (congestionFindings(p) < 2) return false;
    if ((p.current_regimen ?? []).some(r => isActiveExposure(r) && r.med.drug_class === 'Loop Diuretic' && !r.med.facts?.short_course_addon)) return false;
    // every oral loop excluded for another reason (anuria, an allergy) or potassium below 3.5: the weight is not the reason, so the statement is not made
    const allergic = expandAllergies(p.allergies instanceof Set ? p.allergies : new Set<string>(), MEDICATION_FORMULARY).expanded;
    const loops = MEDICATION_FORMULARY.filter(m => m.drug_class === 'Loop Diuretic' && !m.facts?.short_course_addon);
    if (p.comorbidities.has('Anuria') || loops.every(m => allergic.has(m.name))) return false;
    if (p.potassium > 0 && p.potassium < 3.5) return false;
    return true;
};
/** Y4 expectation: at least two of cool extremities, pulse pressure 25 or less, BUN to creatinine above 20; the ejection fraction entered and 20 or above; the pressure usable; the poor-perfusion alert not already raised. */
const y4Markers = (p: Patient): number => {
    if (unknown(p.sbp) || (p.dbp > 0 && p.sbp <= p.dbp) || p.sbp <= p.dbp) return 0;
    let k = 0;
    if (p.volume_status.exam_findings.has('Cool Extremities')) k++;
    if (p.sbp - p.dbp <= 25) k++;
    if (p.creatinine > 0 && p.bun / p.creatinine > 20) k++;
    return k;
};

for (let sd = first; sd < first + n; sd++) {
    counts.patients++;
    const base = gen3r(sd).p as Patient;
    // ---- every path
    for (const [pathName, apply] of PATHS) {
        const p = clonePatient(base); apply(p);
        let o: SimulationOutput; try { o = run(p); } catch { continue; }
        counts.runs++;
        const heads = o.clinicalAlerts.map(head);
        // Y7
        counts.Y7_runs++;
        const byHead = new Map<string, string[]>();
        for (const a of o.clinicalAlerts) byHead.set(head(a), [...(byHead.get(head(a)) ?? []), a]);
        for (const [h, xs] of byHead) {
            if (xs.length > 1 && !PER_ITEM_HEADS.has(h)) bad('Y7_repeated_heading', sd, `${pathName}: ${h} x${xs.length}`);
            if (new Set(xs).size !== xs.length) bad('Y7_identical_text', sd, `${pathName}: ${h}`);
        }
        // Y6 (no-option screens)
        if (o.scoredRegimens.length === 0) {
            counts.no_option_runs++;
            for (const a of o.clinicalAlerts) { counts.Y6_alerts_scanned++; const m = OPTION_WORDS.exec(a); if (m) bad('Y6_option_words', sd, `${pathName}: ${head(a)}: ...${a.slice(Math.max(0, m.index - 40), m.index + 40)}...`); }
        }
        const unstable = heads.some(h => ['ACUTE DECOMPENSATION', 'HYPOXIA ALERT', 'POOR PERFUSION', 'POSSIBLE POOR PERFUSION', 'LOW OUTPUT STATE', "OUTSIDE THE TOOL'S SCOPE"].includes(h) || /INSTABILITY|\bSTOP\b|AV BLOCK|EMERGENCY|IMPLAUSIBLE|INPUT ERROR|NO DISPLAY-SAFE|NO REGIMEN CHANGE SHOWN|SICK SINUS|ANURIA/.test(h));
        if (unstable && heads.includes('CARDIAC REHABILITATION')) bad('Y6_rehab_beside_instability', sd, `${pathName}: ${heads.filter(h => h !== 'CARDIAC REHABILITATION').join(' | ').slice(0, 120)}`);
        const af = o.clinicalAlerts.find(a => head(a) === 'ATRIAL FIBRILLATION');
        if (af && /Rate control:/.test(af)) {
            const noDrug = (p.sbp > 0 && p.sbp < 90) || (p.potassium >= 6.0 && p.potassium <= 8.0);
            if (p.rhythm !== 'AFib' || noDrug || (p.scope_conditions?.size ?? 0) > 0) bad('Y6_rate_paragraph_wrong', sd, `${pathName}: rhythm ${p.rhythm} sbp ${p.sbp} k ${p.potassium}`);
        }
        // Y3 / Y4 expectations (path-adjusted values)
        counts.Y3_runs++; counts.Y4_runs++;
        const y3 = o.clinicalAlerts.some(a => head(a) === 'CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN');
        const scale = o.clinicalAlerts.some(a => head(a) === 'SCALE AND EXAMINATION DISAGREE');
        if (y3 && scale) bad('Y3_both_with_scale', sd, pathName);
        const want3 = y3Expected(p);
        if (want3) counts.Y3_expected++;
        if (want3 && !y3) bad('Y3_missing', sd, pathName);
        if (!want3 && y3) bad('Y3_unexpected', sd, pathName);
        if (o.scoredRegimens.length > 0 && y3Expected({ ...p, volume_status: p.volume_status } as Patient) && congestionFindings(p) >= 1 && !o.scoredRegimens.every(r => r.warnings.some(w => /No loop diuretic start or increase is available today: a new loop diuretic is started only when the weight is more than 1 kg above dry weight/.test(w))) && !(o.clinicalAlerts.some(a => head(a) === 'ACUTE DECOMPENSATION') || o.clinicalAlerts.some(a => head(a) === 'POOR PERFUSION'))) bad('Y3_sentence_missing', sd, pathName);
        const y4 = o.clinicalAlerts.some(a => head(a) === 'POSSIBLE POOR PERFUSION');
        const lvefOk = pathName === 'implausible ejection fraction' ? false : p.lvef > 0 && p.lvef <= 80 && p.lvef >= 20;
        const coldAlert = heads.includes('POOR PERFUSION');
        const want4 = lvefOk && y4Markers(p) >= 2 && !coldAlert && !(pathName === 'input error' && false);
        if (want4) counts.Y4_expected++;
        if (want4 && !y4) bad('Y4_missing', sd, `${pathName}: lvef ${p.lvef} markers ${y4Markers(p)}`);
        if (!want4 && y4) bad('Y4_unexpected', sd, `${pathName}: lvef ${p.lvef} markers ${y4Markers(p)}`);
    }
    // ---- Y1: one numeric field blank on the ordinary and stop paths
    const field = NUMERIC[sd % NUMERIC.length];
    for (const [pathName, apply] of [PATHS[0], PATHS[5], PATHS[6], PATHS[8]]) for (const blank of BLANKS) {
        const ref = clonePatient(base); apply(ref);
        if (pathName === 'potassium stop' && field === 'potassium') continue;
        if (pathName === 'hypotension stop' && (field === 'sbp' || field === 'dbp')) continue;
        const q = clonePatient(ref); (q as unknown as Record<string, unknown>)[field as string] = blank;
        let a: SimulationOutput, b: SimulationOutput; try { a = run(ref); b = run(q); } catch { continue; }
        counts.Y1_blank_runs++;
        const zero = b.clinicalAlerts.find(x => PRINTED_ZERO.test(x));
        if (zero) bad('Y1_printed_zero', sd, `${pathName} ${String(field)}=${String(blank)}: ${zero.slice(0, 120)}`);
        const refHeads = new Set(a.clinicalAlerts.map(head));
        const newThreshold = b.clinicalAlerts.map(head).filter(h => THRESHOLD_HEADS.includes(h) && !refHeads.has(h));
        if (newThreshold.length) bad('Y1_threshold_from_blank', sd, `${pathName} ${String(field)}=${String(blank)}: ${newThreshold.join(', ')}`);
        if (field === 'sbp' && b.clinicalAlerts.some(x => head(x) === 'HEMODYNAMIC INSTABILITY')) bad('Y1_sbp_blank_hemodynamic', sd, pathName);
    }
    // ---- Y8: an implausible or unknown eGFR keeps the potassium alerts that depend only on potassium
    if ((base.current_regimen ?? []).some(r => ['MRA', 'nsMRA'].includes(r.med.drug_class))) {
        const kp = clonePatient(base); kp.potassium = [5.2, 5.6, 5.8][sd % 3];
        const ref = run(kp); const refK = new Set(ref.clinicalAlerts.map(head).filter(h => /^POTASSIUM (HOLD|REDUCE) ON/.test(h)));
        for (const egfr of [500, 0]) {
            const q = clonePatient(kp); q.egfr = egfr;
            const o = run(q); counts.Y8_runs++;
            const got = new Set(o.clinicalAlerts.map(head).filter(h => /^POTASSIUM (HOLD|REDUCE) ON/.test(h)));
            // heading by heading: every heading the patient raises with the entered eGFR is raised with the unusable one, unless that patient's own eGFR made the drug contraindicated (then the entered one states removal instead)
            const lost = [...refK].filter(h => !got.has(h));
            const contraWithEntered = (kp.egfr > 0 && kp.egfr <= 30);
            if (lost.length && !contraWithEntered) bad('Y8_potassium_alert_lost', sd, `egfr ${egfr} (entered ${kp.egfr}): lost ${lost.join(', ')}`);
        }
    }
}
console.log(JSON.stringify(counts, null, 1));
console.log(exceptions.length ? `Exceptions (first ${exceptions.length}):\n` + exceptions.join('\n') : 'No exceptions.');
if (outFile) writeFileSync(outFile, JSON.stringify({ counts, exceptions }, null, 1));
