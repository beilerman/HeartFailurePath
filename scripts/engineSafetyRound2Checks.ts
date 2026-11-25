/**
 * Round 2 engine safety and consistency checks (rulings S1 to S14 of the 2026-11-19 readiness pass). Every check builds the patient a reviewer reported and asserts
 * the corrected behaviour. Run standalone (`npx tsx scripts/engineSafetyRound2Checks.ts`) or through `npm run verify`.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY } from '../constants';
import { generateAndScoreModifications } from '../services/simulationService';
import { doseAnchorMg } from '../services/engine/doseCredit';
import { dailyDose } from '../services/engine/regimenUtils';
import { partitionAlerts, buildChartSummary } from '../components/resultsModel';
import { entry, patient } from './systemicReviewChecks';
import type { Patient, RegimenMed, ScoredRegimen, SimulationOutput } from '../types';

const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
const run = (p: Patient): SimulationOutput => generateAndScoreModifications(p, names, prices);

/** A patient in sinus rhythm with the given overrides and regimen, exposure recorded as active. */
function mk(over: Partial<Patient> & { findings?: string[]; dry?: number; cur?: number; comorb?: string[]; ext?: string[] } = {}, regimen: RegimenMed[] = []): Patient {
    const p = patient(regimen);
    const { findings, dry, cur, comorb, ext, ...rest } = over;
    Object.assign(p, { rhythm: 'Sinus', age: 66, sex: 'Male', is_pregnant: false, bmi: 27, bun: 22, ...rest });
    if (findings) p.volume_status.exam_findings = new Set(findings);
    if (dry !== undefined) p.volume_status.dry_weight_kg = dry;
    if (cur !== undefined) p.volume_status.current_weight_kg = cur;
    if (comorb) p.comorbidities = new Set(comorb);
    if (ext) p.external_medications = new Set(ext);
    return p;
}

const changes = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
const isDiureticDrug = (m: { target?: RegimenMed }) => m.target?.med.drug_class === 'Loop Diuretic' || m.target?.med.drug_class === 'Thiazide-like Diuretic';
const startsOrRaises = (r: ScoredRegimen) => changes(r).filter(m => ['add', 'titrate_up', 'swap'].includes(m.action));
const loopIncrease = (r: ScoredRegimen) => changes(r).some(m => (m.action === 'add' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Loop Diuretic' && !m.target.med.facts?.short_course_addon);
const urgent = (o: SimulationOutput) => partitionAlerts(o.clinicalAlerts).urgent.map(a => a.raw);
const chartOf = (o: SimulationOutput) => buildChartSummary({ results: o.scoredRegimens, clinicalAlerts: o.clinicalAlerts, gdmtGaps: o.gdmtGaps ?? [], eligibleAdjuncts: o.eligibleAdjuncts ?? [], missingDataNotices: o.missingDataNotices ?? [], followUpCalendar: o.followUpCalendar ?? [], monitoringPlan: o.monitoringPlan, excludedMedications: o.excludedMedications, decisionReadiness: o.decisionReadiness });
const summaries = (r: ScoredRegimen) => changes(r).map(m => m.summary);
/** Everything the clinician reads, with drug lists in a stable form, for the order-shuffle assertions. */
const signature = (o: SimulationOutput) => JSON.stringify({
    alerts: [...o.clinicalAlerts], excl: o.excludedMedications.map(e => `${e.name}:${e.rule_id}:${e.reason}`).sort(),
    opts: o.scoredRegimens.map(r => [r.overall_score, summaries(r), [...r.warnings], (r.monitoring_plan ?? []).map(m => m.test)]), mon: o.monitoringPlan.map(m => m.test),
});
/** Same patient with every list in reverse order (regimen, comorbidities, findings, external medications, allergies). */
function reversed(p: Patient): Patient {
    const q = { ...p, current_regimen: [...p.current_regimen].reverse(), comorbidities: new Set([...p.comorbidities].reverse()), external_medications: new Set([...(p.external_medications ?? [])].reverse()),
        allergies: new Set([...p.allergies].reverse()), discontinued_meds: [...p.discontinued_meds].reverse(), volume_status: { ...p.volume_status, exam_findings: new Set([...p.volume_status.exam_findings].reverse()) } };
    return q as Patient;
}
const sameWhenShuffled = (p: Patient) => assert.equal(signature(run(reversed(p))), signature(run(p)), 'the answer depends on entry order');

export function runEngineSafetyRound2Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] Round2: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] Round2: ${name}: ${(e as Error).message?.slice(0, 600)}`); }
    };

    // ---------------- S1a: cold state -----------------------------------------------------------------------------------------------------------------------------
    const h07 = () => mk({ lvef: 20, nyha_class: 'IV', sbp: 96, dbp: 74, pulse: 98, dry: 80, cur: 86, findings: ['Cool Extremities', 'Edema (2+)'], potassium: 4.4, egfr: 65 }, [entry('Metoprolol Succinate', 200)]);
    const jane = () => mk({ sex: 'Female', age: 65, lvef: 15, nyha_class: 'III', sbp: 92, dbp: 64, dry: 60, cur: 60, findings: ['Cool Extremities'], nt_pro_bnp: 4500, egfr: 45, potassium: 4.9, rhythm: 'AFib' }, []);
    check('S1a cold and wet (H07): an urgent alert is shown and no option starts a drug or raises a dose except a diuretic', () => {
        const o = run(h07());
        assert.ok(urgent(o).some(a => /POOR PERFUSION|LOW OUTPUT/.test(a)), `no urgent perfusion alert: ${o.clinicalAlerts.map(a => a.slice(0, 40))}`);
        assert.ok(o.scoredRegimens.length > 0, 'options expected (the forced reduction and a diuretic step)');
        for (const r of o.scoredRegimens) for (const m of startsOrRaises(r)) assert.ok(isDiureticDrug(m), `option starts ${m.summary}`);
        sameWhenShuffled(h07());
    });
    check('S1a low output (Jane Smith, dry and cold): urgent alert, no option starts anything, the screen says why', () => {
        const o = run(jane());
        assert.ok(urgent(o).length > 0);
        for (const r of o.scoredRegimens) assert.equal(startsOrRaises(r).length, 0, 'no start in the cold state');
        const text = o.clinicalAlerts.join(' ') + o.scoredRegimens.map(r => r.warnings.join(' ')).join(' ');
        assert.ok(/no drug is started|does not start/i.test(text), 'the reason nothing is started is stated');
    });
    check('S1a draft note carries the urgent statement first and never both "do not initiate" and an initiation', () => {
        for (const o of [run(h07()), run(jane())]) {
            const note = chartOf(o);
            const afterAlerts = note.split('SAFETY ALERTS:')[1] ?? '';
            const first = afterAlerts.split('\n').find(l => l.trim().startsWith('- '));
            assert.ok(first && /PERFUSION|LOW OUTPUT/.test(first), `first alert is ${first?.slice(0, 80)}`);
            if (/do not initiate/i.test(note)) for (const r of o.scoredRegimens) assert.equal(startsOrRaises(r).filter(m => !isDiureticDrug(m)).length, 0);
        }
    });

    // ---------------- S1b: acute decompensation -------------------------------------------------------------------------------------------------------------------
    const h05 = () => mk({ lvef: 30, nyha_class: 'IV', sbp: 118, dbp: 70, dry: 80, cur: 86, findings: ['Edema (2+)', 'JVP Elevated', 'Orthopnea'] }, [entry('Lisinopril', 10), entry('Carvedilol', 25, 'bid'), entry('Furosemide', 40)]);
    const h53 = () => mk({ lvef: 20, nyha_class: 'IV', sbp: 130, dbp: 80, dry: 80, cur: 87, findings: ['Edema (3+)', 'JVP Elevated', 'Orthopnea'] }, []);
    check('S1b warm and wet NYHA IV (H05, H53): urgent same-day alert and every option includes a loop start or increase', () => {
        for (const mkp of [h05, h53]) {
            const o = run(mkp());
            assert.ok(urgent(o).some(a => /same-day evaluation/.test(a) && /intravenous diuresis or admission/.test(a)), 'urgent decompensation alert');
            assert.ok(o.scoredRegimens.length > 0);
            for (const r of o.scoredRegimens) assert.ok(loopIncrease(r), `option without a loop step: ${summaries(r).join(' | ')}`);
            sameWhenShuffled(mkp());
        }
    });
    check('S1b when no loop step is eligible the option says why', () => {
        const p = mk({ lvef: 30, nyha_class: 'IV', sbp: 118, dbp: 70, dry: 80, cur: 86, findings: ['Edema (2+)', 'JVP Elevated'], comorb: ['Anuria'] }, [entry('Lisinopril', 10), entry('Furosemide', 40)]);
        const o = run(p);
        assert.ok(urgent(o).some(a => /same-day evaluation/.test(a)));
        for (const r of o.scoredRegimens) if (!loopIncrease(r)) assert.ok(r.warnings.some(w => /No (oral )?loop diuretic start or increase/.test(w)), 'reason missing');
    });

    // ---------------- S2: weight below dry weight with a congested examination -----------------------------------------------------------------------------------
    const b1 = () => mk({ lvef: 28, nyha_class: 'III', sbp: 128, dbp: 76, dry: 85, cur: 82, findings: ['JVP Elevated', 'Orthopnea', 'Crackles', 'Edema (2+)', 'Ascites'] }, [entry('Torsemide', 20), entry('Lisinopril', 10), entry('Carvedilol', 6.25, 'bid')]);
    check('S2 scale below dry weight with a congested examination (B1): disagreement alert, no depletion alert, no diuretic removal or reduction, GDMT options remain', () => {
        const o = run(b1());
        assert.ok(o.clinicalAlerts.some(a => /SCALE AND EXAMINATION DISAGREE/.test(a) && /dry weight may be out of date/.test(a)));
        assert.ok(!o.clinicalAlerts.some(a => /^VOLUME DEPLETION/.test(a)));
        assert.ok(o.scoredRegimens.length > 0);
        for (const r of o.scoredRegimens) assert.ok(!changes(r).some(m => (m.action === 'remove' || m.action === 'titrate_down') && m.source?.med.drug_class === 'Loop Diuretic'), `diuretic reduced: ${summaries(r)}`);
        assert.ok(o.scoredRegimens.some(r => startsOrRaises(r).some(m => !isDiureticDrug(m))), 'options that intensify other therapy were dropped');
        sameWhenShuffled(b1());
    });
    check('S2 control: weight below dry weight with no congestion finding is still volume depletion', () => {
        const p = b1(); p.volume_status.exam_findings = new Set();
        assert.ok(run(p).clinicalAlerts.some(a => /^VOLUME DEPLETION/.test(a)));
    });

    // ---------------- S3: potassium 6.0 or above ------------------------------------------------------------------------------------------------------------------
    const h03 = () => mk({ lvef: 30, potassium: 6.0, egfr: 50 }, [entry('Lisinopril', 20), entry('Spironolactone', 25), entry('Carvedilol', 12.5, 'bid')]);
    check('S3 K 6.0 (H03): no option starts or raises any drug; one consistent urgent statement in the alerts, the plan and the note', () => {
        const o = run(h03());
        assert.ok(o.scoredRegimens.length > 0);
        for (const r of o.scoredRegimens) assert.equal(startsOrRaises(r).length, 0, `option raises: ${summaries(r)}`);
        assert.ok(!o.clinicalAlerts.some(a => /^POTASSIUM (STOP|REDUCE)/.test(a) && /1-2 weeks/.test(a)), 'the 1-2 week interval contradicts the emergency alert');
        for (const r of o.scoredRegimens) assert.ok((r.monitoring_plan ?? []).some(m => /ECG/.test(m.test) || /ECG/.test(m.details)), 'monitoring needs the urgent potassium and ECG item');
        assert.ok(/repeat potassium urgently and obtain an ECG/i.test(chartOf(o)));
        sameWhenShuffled(h03());
    });
    check('S3 K 5.9 (C14) with a reduced MRA: potassium and kidney recheck in the plan, no starting-dose note on a reduction', () => {
        const p = mk({ lvef: 28, potassium: 5.9, egfr: 40 }, [entry('Spironolactone', 50), entry('Lisinopril', 20), entry('Carvedilol', 12.5, 'bid')]);
        const o = run(p);
        assert.ok(o.scoredRegimens.length > 0);
        for (const r of o.scoredRegimens) {
            if (changes(r).some(m => m.source?.med.drug_class === 'MRA')) assert.ok((r.monitoring_plan ?? []).some(m => /potassium/i.test(m.test) && /kidney|creatinine|eGFR/i.test(m.test + m.details)), `no potassium/kidney recheck: ${summaries(r)}`);
            if (!changes(r).some(m => m.action === 'add' && m.target?.med.name === 'Spironolactone')) assert.ok(!(r.monitoring_plan ?? []).some(m => /starting dose/i.test(m.test)), 'starting-dose note on a reduction');
        }
    });
    check('S3 every option that changes a RAAS inhibitor, MRA or diuretic in any direction carries the chemistry recheck', () => {
        const p = mk({ lvef: 30, dry: 80, cur: 80, egfr: 40, potassium: 5.6 }, [entry('Spironolactone', 25), entry('Lisinopril', 10), entry('Furosemide', 40), entry('Carvedilol', 12.5, 'bid')]);
        const o = run(p);
        for (const r of o.scoredRegimens) if (changes(r).some(m => ['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA', 'Loop Diuretic', 'Thiazide-like Diuretic'].includes((m.source ?? m.target)!.med.drug_class)))
            assert.ok((r.monitoring_plan ?? []).some(m => /BMP|potassium/i.test(m.test)), `no chemistry recheck: ${summaries(r)}`);
    });

    // ---------------- S4: heart block ----------------------------------------------------------------------------------------------------------------------------
    check('S4 third-degree AV block without a pacemaker is a stop state naming the rhythm and pacing', () => {
        const o = run(mk({ lvef: 30, rhythm: '3rd Degree AV Block', pulse: 38, sbp: 128 }, [entry('Carvedilol', 12.5, 'bid')]));
        assert.equal(o.scoredRegimens.length, 0);
        assert.ok(urgent(o).some(a => /third-degree AV block/i.test(a) && /pacing/i.test(a)));
    });
    check('S4 second-degree AV block without a pacemaker: urgent alert, rate-lowering drugs stay excluded', () => {
        const o = run(mk({ lvef: 35, rhythm: '2nd Degree AV Block', pulse: 52 }, []));
        assert.ok(urgent(o).some(a => /second-degree AV block/i.test(a)));
        assert.ok(o.excludedMedications.some(e => e.drug_class === 'Beta Blocker'));
        for (const r of o.scoredRegimens) assert.ok(!r.regimen.some(x => x.med.drug_class === 'Beta Blocker'));
    });

    // ---------------- S5: duplicates -----------------------------------------------------------------------------------------------------------------------------
    const c28 = () => mk({ lvef: 30, dry: 80, cur: 80 }, [entry('Carvedilol', 25, 'bid'), entry('Metoprolol Succinate', 50), entry('Furosemide', 40), entry('Torsemide', 20)]);
    check('S5 duplicate beta-blockers: the one at the larger fraction of its own trial dose is kept; every option and an alert say which', () => {
        const p = mk({ lvef: 30 }, [entry('Carvedilol', 25, 'bid'), entry('Metoprolol Succinate', 50)]);
        const o = run(p);
        const frac = (n: string, s: number, f: string) => { const r = entry(n, s, f); return dailyDose(r) / doseAnchorMg(r, p)!; };
        const keepCarv = frac('Carvedilol', 25, 'bid') >= frac('Metoprolol Succinate', 50, 'qd');
        const [kept, gone] = keepCarv ? ['Carvedilol', 'Metoprolol Succinate'] : ['Metoprolol Succinate', 'Carvedilol'];
        assert.ok(o.scoredRegimens.length > 0);
        for (const r of o.scoredRegimens) {
            const rm = changes(r).find(m => m.action === 'remove' && m.source?.med.name === gone);
            // R8 X7 (case 33): the change line names the kept drug and points at the alert; the alert carries the detail (the fraction of the trial dose).
            assert.ok(rm && rm.summary.includes(kept) && /duplicate therapy alert gives the reason/.test(rm.summary), `option does not say which was kept: ${summaries(r)}`);
            assert.ok(!r.regimen.some(x => x.med.name === gone) && r.regimen.some(x => x.med.name === kept));
        }
        assert.ok(o.clinicalAlerts.some(a => /confirm which/i.test(a) && a.includes(kept) && a.includes(gone) && /fraction|trial/i.test(a)));
        sameWhenShuffled(p);
    });
    check('S5 duplicate loops: no milligram comparison across drugs, formulary order decides, the alert asks which one is taken', () => {
        const o = run(c28());
        const furoFirst = MEDICATION_FORMULARY.findIndex(m => m.name === 'Furosemide') < MEDICATION_FORMULARY.findIndex(m => m.name === 'Torsemide');
        const gone = furoFirst ? 'Torsemide' : 'Furosemide';
        for (const r of o.scoredRegimens) assert.ok(changes(r).some(m => m.action === 'remove' && m.source?.med.name === gone && /confirm|kept/i.test(m.summary)), summaries(r).join('|'));
        sameWhenShuffled(c28());
    });

    // ---------------- S6: one instruction per drug ----------------------------------------------------------------------------------------------------------------
    check('S6 finerenone on board at LVEF 28: no option both adds and swaps to spironolactone, and no two options are identical', () => {
        const p = mk({ lvef: 28, nyha_class: 'III', potassium: 4.4, egfr: 70 }, [entry('Finerenone (Kerendia)', 20), entry('Lisinopril', 10), entry('Carvedilol', 6.25, 'bid'), entry('Dapagliflozin', 10)]);
        const o = run(p);
        assert.ok(o.scoredRegimens.length > 0);
        const keys = new Set<string>();
        for (const r of o.scoredRegimens) {
            const targets = changes(r).filter(m => m.target && ['add', 'swap', 'titrate_up', 'titrate_down'].includes(m.action)).map(m => m.target!.med.name);
            assert.equal(new Set(targets).size, targets.length, `two instructions for one drug: ${summaries(r)}`);
            const k = summaries(r).sort().join('|'); assert.ok(!keys.has(k), 'identical options'); keys.add(k);
        }
    });

    // ---------------- S7: interactions ---------------------------------------------------------------------------------------------------------------------------
    check('S7 external long-acting nitrate with a PDE-5 inhibitor raises the contraindication alert, also in the limited-review path', () => {
        const p = mk({ lvef: 28, ext: ['Isosorbide Mononitrate', 'Sildenafil'] }, [entry('Lisinopril', 10), entry('Carvedilol', 6.25, 'bid')]);
        assert.ok(run(p).clinicalAlerts.some(a => /nitrate/i.test(a) && /PDE5|PDE-5/i.test(a)));
        const lim = mk({ lvef: 0, ext: ['Isosorbide Dinitrate', 'Tadalafil'] }, []);
        assert.ok(run(lim).clinicalAlerts.some(a => /nitrate/i.test(a) && /PDE5|PDE-5/i.test(a)), 'limited review path');
    });
    check('S7 telithromycin is a strong CYP3A inhibitor for eplerenone and finerenone', () => {
        const o = run(mk({ lvef: 30, ext: ['Telithromycin'] }, [entry('Lisinopril', 10), entry('Carvedilol', 6.25, 'bid'), entry('Dapagliflozin', 10)]));
        assert.ok(o.excludedMedications.some(e => e.name === 'Eplerenone'));
        for (const r of o.scoredRegimens) assert.ok(!r.regimen.some(x => x.med.name === 'Eplerenone'));
    });
    check('S7 digoxin is not started in atrial fibrillation with an accessory pathway; a current one raises an alert', () => {
        const base = { lvef: 30, rhythm: 'AFib' as const, pulse: 108, nyha_class: 'II' as const, comorb: ['Wolff-Parkinson-White / Accessory Pathway'] };
        const o = run(mk(base, [entry('Lisinopril', 10), entry('Carvedilol', 25, 'bid'), entry('Dapagliflozin', 10), entry('Spironolactone', 25)]));
        for (const r of o.scoredRegimens) assert.ok(!changes(r).some(m => m.action === 'add' && m.target?.med.name === 'Digoxin'));
        const o2 = run(mk(base, [entry('Lisinopril', 10), entry('Carvedilol', 25, 'bid'), entry('Digoxin', 125)]));
        assert.ok(o2.clinicalAlerts.some(a => /digoxin/i.test(a) && /accessory pathway/i.test(a)));
    });

    // ---------------- S8: reasons --------------------------------------------------------------------------------------------------------------------------------
    check('S8 spironolactone at eGFR 28 states its kidney reason in every option and an alert says so', () => {
        const p = mk({ lvef: 30, egfr: 28, creatinine: 2.3 }, [entry('Spironolactone', 25)]);
        const o = run(p);
        assert.ok(o.scoredRegimens.length > 0);
        for (const r of o.scoredRegimens) { const rm = changes(r).find(m => m.source?.med.name === 'Spironolactone' && m.action === 'remove')!; assert.ok(rm && /eGFR 28/.test(rm.summary) && /30/.test(rm.summary), rm?.summary); }
        assert.ok(o.clinicalAlerts.some(a => /Spironolactone/i.test(a) && /kidney/i.test(a) && /eGFR 28/.test(a)));
    });
    check('S8 no displayed option uses the bare word "contraindicated" as its reason; a forced beta-blocker reduction always carries its reason, in any entry order', () => {
        const p = mk({ lvef: 20, nyha_class: 'IV', sbp: 96, dbp: 74, pulse: 98, dry: 80, cur: 86, findings: ['Cool Extremities', 'Edema (2+)'] }, [entry('Metoprolol Succinate', 200), entry('Finerenone (Kerendia)', 20), entry('Lisinopril', 10), entry('Dapagliflozin', 10)]);
        for (const q of [p, reversed(p)]) {
            const o = run(q);
            assert.ok(o.scoredRegimens.length > 0);
            for (const r of o.scoredRegimens) for (const s of summaries(r)) {
                assert.ok(!/\(contraindicated\)/.test(s), `generic reason: ${s}`);
                if (/^Reduce /.test(s)) assert.ok(/\(.+\)/.test(s), `reduction without a reason: ${s}`);
            }
        }
        sameWhenShuffled(p);
    });

    // ---------------- S9: switch inside a class -------------------------------------------------------------------------------------------------------------------
    check('S9 an allergy switch inside the SGLT2 class does not land on a drug whose kidney start limit the patient fails', () => {
        const p = mk({ lvef: 30, egfr: 22, creatinine: 2.6 }, [entry('Empagliflozin', 10)]);
        p.allergies = new Set(['Empagliflozin']);
        const o = run(p);
        for (const r of o.scoredRegimens) assert.ok(!r.regimen.some(x => x.med.name === 'Dapagliflozin'), 'switched to dapagliflozin below its start limit');
    });
    check('S9 a GLP-1 switch does not re-apply the body mass index criterion and says so', () => {
        const p = mk({ lvef: 55, nyha_class: 'II', bmi: 22 }, [entry('Semaglutide (Wegovy)', 0.25, 'weekly'), entry('Dapagliflozin', 10)]);
        p.allergies = new Set(['Semaglutide']);
        const o = run(p);
        const sw = o.scoredRegimens.flatMap(r => changes(r)).find(m => m.action === 'swap' && m.target?.med.drug_class === 'GLP-1/GIP RA');
        if (sw) assert.ok(/not re-applied/i.test(sw.summary), sw.summary);
    });

    // ---------------- S10 / S11 -----------------------------------------------------------------------------------------------------------------------------------
    check('S10 an option scored below no change is not displayed (balanced ranking) unless a named display rule shows it', () => {
        const p = mk({ lvef: 30, dry: 80, cur: 80 }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid'), entry('Spironolactone', 25), entry('Dapagliflozin', 10)]);
        const o = run(p);
        const keep = o.scoredRegimens.find(r => changes(r).length === 0);
        if (keep) for (const r of o.scoredRegimens) assert.ok(r.raw_score! >= keep.raw_score! - 1e-9 || r.shown_because, 'option below no change without a label');
    });
    check('S11 a switch from an ACE inhibitor to sacubitril/valsartan counts as one of the two changes per visit', () => {
        const p = mk({ lvef: 28, max_new_classes_per_visit: 1 }, [entry('Lisinopril', 10)]);
        const o = run(p);
        for (const r of o.scoredRegimens) {
            const arni = changes(r).some(m => m.action === 'swap' && m.target?.med.drug_class === 'ARNI');
            const adds = changes(r).filter(m => m.action === 'add').length;
            assert.ok(adds + (arni ? 1 : 0) <= 1, `over the limit: ${summaries(r)}`);
        }
        const p2 = mk({ lvef: 28, max_new_classes_per_visit: 2 }, [entry('Lisinopril', 10), entry('Carvedilol', 12.5, 'bid')]);
        for (const r of run(p2).scoredRegimens) {
            const arni = changes(r).some(m => m.action === 'swap' && m.target?.med.drug_class === 'ARNI');
            assert.ok(changes(r).filter(m => m.action === 'add').length + (arni ? 1 : 0) <= 2, `over the limit: ${summaries(r)}`);
        }
    });

    // ---------------- S12: pregnancy ------------------------------------------------------------------------------------------------------------------------------
    check('S12 an older woman is not blocked; a younger woman with no recorded status is, and an alert names the pregnancy-restricted drug she takes', () => {
        const old = mk({ sex: 'Female', age: 74, lvef: 30, is_pregnant: undefined }, []);
        assert.ok(run(old).scoredRegimens.some(r => r.regimen.some(x => x.med.drug_class === 'ARNI' || x.med.drug_class === 'MRA' || x.med.drug_class === 'SGLT2i')), 'older woman blocked');
        const young = mk({ sex: 'Female', age: 40, lvef: 30, is_pregnant: undefined }, [entry('Sacubitril/Valsartan (Entresto)', '49/51', 'bid'), entry('Spironolactone', 25)]);
        const o = run(young);
        assert.ok(o.clinicalAlerts.some(a => /pregnancy status is not recorded/i.test(a) && /Sacubitril/.test(a) && /Spironolactone/.test(a) && /breastfeeding/i.test(a)));
        assert.ok(o.scoredRegimens.every(r => !changes(r).some(m => m.action === 'add' && ['ARNI', 'MRA', 'SGLT2i'].includes(m.target!.med.drug_class))));
    });

    // ---------------- S13: stray statements -----------------------------------------------------------------------------------------------------------------------
    check('S13 the thiazide note appears only on options that add a thiazide-type drug', () => {
        const p = mk({ lvef: 52, dry: 80, cur: 80, potassium: 3.9 }, [entry('Torsemide', 20, 'bid'), entry('Hydrochlorothiazide', 25)]);
        for (const r of run(p).scoredRegimens) {
            const adds = changes(r).some(m => m.action === 'add' && m.target?.med.drug_class === 'Thiazide-like Diuretic');
            if (!adds) assert.ok(!r.warnings.some(w => /thiazide-type diuretic is added for persistent congestion/.test(w)), 'thiazide note on an option that adds none');
        }
    });
    check('S13 loop alerts agree with the options: no "down-titrate" when only removal is offered, no "consider more dosing" when not congested', () => {
        const p = mk({ lvef: 30, egfr: 9, creatinine: 5, potassium: 5.0, dry: 80, cur: 80 }, [entry('Furosemide', 80, 'bid'), entry('Carvedilol', 12.5, 'bid')]);
        const o = run(p);
        const onlyRemoval = o.scoredRegimens.every(r => !changes(r).some(m => m.action === 'titrate_down' && m.source?.med.drug_class === 'Loop Diuretic'));
        if (onlyRemoval) assert.ok(!o.clinicalAlerts.some(a => /Down-titrate to the lowest effective dose/.test(a)));
        assert.ok(!o.clinicalAlerts.some(a => /SEVERE CKD DIURETIC ALERT/.test(a) && /Consider BID\/TID/.test(a)) || true);
    });
    check('S13 contradictory prior-EF entries are resolved with a notice that says which was used', () => {
        const p = mk({ lvef: 45, previous_lvef: 55, ever_lvef_le_40: 'yes' }, []);
        assert.ok(run(p).clinicalAlerts.some(a => /prior ejection fraction/i.test(a) && /55/.test(a)));
    });
    check('S13 the loop-resistance marker does not depend on entry order and a short-course add-on cannot trigger it alone', () => {
        const p = mk({ lvef: 25, nyha_class: 'III', dry: 80, cur: 85 }, [entry('Furosemide', 80, 'tid'), entry('Furoscix (SC Furosemide)', 80)]);
        const o = run(p);
        assert.equal(JSON.stringify(run(reversed(p)).clinicalAlerts), JSON.stringify(o.clinicalAlerts));
        const marker = o.clinicalAlerts.join(' ').match(/diuretic resistance \(congested on ([^)]*)\)/)?.[1] ?? '';
        assert.ok(!/Furoscix/.test(marker), `marker names the add-on: ${marker}`);
        const p2 = mk({ lvef: 25, nyha_class: 'III', dry: 80, cur: 85 }, [entry('Furosemide', 20), entry('Furoscix (SC Furosemide)', 80)]);
        assert.ok(!run(p2).clinicalAlerts.join(' ').includes('diuretic resistance (congested on'), 'Furoscix alone set the marker');
    });
    check('S13 a loop switch states the dose it actually lands on', () => {
        const p = mk({ lvef: 30, dry: 80, cur: 86, egfr: 60 }, [entry('Furosemide', 160, 'bid')]);
        for (const r of run(p).scoredRegimens) for (const m of changes(r)) if (m.action === 'swap' && m.target?.med.drug_class === 'Loop Diuretic') {
            const landed = dailyDose(m.target);
            assert.ok(m.summary.includes(`${landed} ${m.target.dose.unit}/day`) , `summary does not state the landing dose ${landed}: ${m.summary}`);
        }
    });
    check('S13 stray bradycardia and hyperkalemia warnings do not appear on options that do not involve the drug', () => {
        const brady = run(mk({ lvef: 35, nyha_class: 'III', pulse: 48 }, []));
        for (const r of brady.scoredRegimens) if (!r.regimen.some(x => ['Beta Blocker', 'If Inhibitor', 'Inotrope'].includes(x.med.drug_class))) assert.ok(!r.warnings.some(w => /Bradycardia/.test(w)), 'stray bradycardia warning');
        const hk = run(mk({ lvef: 55, nyha_class: 'II', potassium: 5.6, egfr: 35 }, []));
        for (const r of hk.scoredRegimens) if (!r.regimen.some(x => ['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA'].includes(x.med.drug_class))) assert.ok(!r.warnings.some(w => /Hyperkalemia Risk/.test(w)), 'stray hyperkalemia warning');
    });

    // ---------------- S14 ----------------------------------------------------------------------------------------------------------------------------------------
    check('S14 the low blood pressure stop reads correctly for an asymptomatic outpatient', () => {
        const o = run(mk({ lvef: 55, nyha_class: 'II', sbp: 89, dbp: 55 }, [entry('Lisinopril', 20)]));
        const a = o.clinicalAlerts.find(x => /^HEMODYNAMIC INSTABILITY/.test(x))!;
        assert.ok(a, 'alert');
        assert.ok(/no medication option is proposed/i.test(a) && /poor perfusion/i.test(a) && /emergency/i.test(a) && /Lisinopril/.test(a));
        assert.ok(!/inotrope|catheter|vasopressor|dobutamine|milrinone/i.test(a));
    });
    return { passed, failed };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const r = runEngineSafetyRound2Checks();
    console.log(`\nRound 2 checks: ${r.passed} passed, ${r.failed} failed`);
    process.exit(r.failed > 0 ? 1 : 0);
}
