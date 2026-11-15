/** Durable regressions for the open November 12 handoff; called by verify (and therefore gate/CI). */
import assert from 'node:assert/strict';
import { INITIAL_PATIENT } from '../data/scenarios';
import { MEDICATION_FORMULARY } from '../constants';
import type { Patient, RegimenMed, ModificationSet } from '../types';
import { clonePatient, generateAndScoreModifications } from '../services/simulationService';
import { auditInputs, raiseClinicalAlerts } from '../services/engine/gates';
import { runEligibilityStage } from '../services/engine/eligibility';
import { analyzeCurrentRegimen, generateCandidateModifications, smallestStepBelow } from '../services/engine/candidates';
import { getDoseTiers, doseProgressToTarget, formatDose } from '../services/engine/regimenUtils';
import { applyRescueAdditions, buildScoringContext, gdmtCompletenessFraction } from '../services/engine/scoring';

const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
const entry = (name: string, strength: number | string, freq?: string): RegimenMed => {
    const med = MEDICATION_FORMULARY.find(m => m.name === name)!;
    const dose = med.available_doses.find(d => d.strength === strength)!;
    assert.ok(dose, `${name} ${strength} is a declared tier`);
    return { med, dose, selected_frequency: freq ?? dose.frequency_options[0] };
};
const patient = (regimen: RegimenMed[] = []): Patient => {
    const p = clonePatient(INITIAL_PATIENT);
    Object.assign(p, { sbp: 140, dbp: 80, pulse: 75, lvef: 35, egfr: 70, creatinine: 1,
        potassium: 4.3, nyha_class: 'II', max_affordable_cost: 1000, max_new_classes_per_visit: 2,
        current_regimen: regimen.map(r => ({ ...r, exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } })), comorbidities: new Set(), allergies: new Set(), external_medications: new Set(), discontinued_meds: [] });
    p.volume_status = { ...p.volume_status, current_weight_kg: 80, dry_weight_kg: 80, exam_findings: new Set() };
    return p;
};
const context = (p: Patient) => {
    const alerts: string[] = [];
    const audit = auditInputs(p, alerts);
    assert.ok(!audit.stop);
    const flags = raiseClinicalAlerts(p, audit.dataAudit, alerts);
    const eligible = runEligibilityStage(p, audit.dataAudit.unknownRenal, names, alerts);
    const tiers = eligible.formulary.flatMap(m => getDoseTiers(m, p));
    const analysis = analyzeCurrentRegimen(p, eligible.formulary, tiers, eligible.allBBExcluded);
    return { analysis, ctx: buildScoringContext(p, prices, eligible.intolerancePolicy, audit.dataAudit, eligible.formulary, tiers, analysis, flags) };
};
const change = (source: RegimenMed, target: RegimenMed, rest: RegimenMed[] = []): ModificationSet => ({
    modifications: [{ action: 'titrate_down', source, target, summary: 'Regression reduction' }], resulting_regimen: [target, ...rest]
});

export function runAdversarialHandoffChecks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, fn: () => void) => {
        try { fn(); passed++; console.log(`  [PASS] Handoff: ${name}`); }
        catch (error) { failed++; console.error(`  [FAIL] Handoff: ${name}: ${error}`); }
    };
    check('every RAAS dose reduction stands alone without automatic binder rescue', () => {
        for (const med of MEDICATION_FORMULARY.filter(m => ['ACEi', 'ARB', 'ARNI'].includes(m.drug_class))) {
            const source = entry(med.name, med.available_doses.at(-1)!.strength);
            const target = entry(med.name, med.available_doses.at(-2)!.strength);
            const p = patient([source]); p.potassium = 5.6;
            const { ctx } = context(p);
            const result = applyRescueAdditions(change(source, target), ctx);
            assert.equal(result.dropped, undefined, med.name);
            assert.equal(result.activeModSet.resulting_regimen.length, 1, med.name);
            assert.ok(result.sim.projectedPatient.potassium > 5.5, 'unchanged projection still carries hyperkalemia risk');
            // Retaining the existing dose remains eligible for reactive rescue.
            const keep = applyRescueAdditions({ modifications: [], resulting_regimen: [source] }, ctx);
            assert.ok(!keep.activeModSet.resulting_regimen.some(r => r.med.drug_class === 'K+ Binder'), med.name);
            assert.equal(keep.sim.projectedPatient.potassium, p.potassium);
        }
    });
    check('MRA reduction with unchanged RAAS sibling does not acquire a binder', () => {
        const source = entry('Spironolactone', 25), target = entry('Spironolactone', 12.5), sibling = entry('Lisinopril', 20);
        const p = patient([source, sibling]); p.potassium = 5.6;
        const r = applyRescueAdditions(change(source, target, [sibling]), context(p).ctx);
        assert.equal(r.activeModSet.resulting_regimen.length, 2);
        assert.ok(r.sim.projectedPatient.potassium > 5.3);
    });
    check('new potassium-raising class cannot be enabled by a rescue binder', () => {
        const p = patient(); p.potassium = 5.2;
        const target = entry('Spironolactone', 25);
        const r = applyRescueAdditions({ modifications: [{ action: 'add', target, summary: 'New MRA' }], resulting_regimen: [target] }, context(p).ctx);
        assert.equal(r.sim.projectedPatient.potassium, 5.2);
        const actual = generateAndScoreModifications(p, names, prices);
        assert.ok(actual.scoredRegimens.length > 0);
        assert.ok(actual.scoredRegimens.every(x => !x.regimen.some(m => ['MRA','nsMRA'].includes(m.med.drug_class))));
    });
    check('eplerenone renal maximum receives full completeness credit with graded credit below it', () => {
        const p = patient(); p.egfr = 40; p.creatinine = 1.8;
        const r = entry('Eplerenone', 25);
        const score = gdmtCompletenessFraction({ modifications: [], resulting_regimen: [r] }, context(p).ctx, [{ match: c => c === 'MRA' }]);
        assert.equal(score.fraction, 1);
        assert.equal(doseProgressToTarget(r, p), 1);
        p.creatinine = 0;
        assert.equal(doseProgressToTarget(r, p), 0, 'unknown labs do not confer renal-target credit');
    });
    check('ramipril renal maximum is daily: 2.5 mg bid and 5 mg qd receive equal full credit', () => {
        const p = patient(); p.egfr = 35; p.creatinine = 2;
        for (const r of [entry('Ramipril', 2.5, 'bid'), entry('Ramipril', 5, 'qd')]) {
            assert.equal(doseProgressToTarget(r, p), 1);
            assert.equal(gdmtCompletenessFraction({ modifications: [], resulting_regimen: [r] }, context(p).ctx, [{ match: c => c === 'ACEi' }]).fraction, 1);
        }
        const partial = doseProgressToTarget(entry('Ramipril', 2.5, 'qd'), p)!;
        assert.ok(partial > 0 && partial < 1);
    });
    check('nearest loop reduction includes frequency-only changes and obeys dose limits', () => {
        const source = entry('Furosemide', 80, 'tid'), p = patient([source]);
        const lower = smallestStepBelow(source, p)!;
        assert.equal(lower.dose.strength, 80); assert.equal(lower.selected_frequency, 'bid');
        const options = context(p).analysis.titratableDown.find(t => t.current.med.name === 'Furosemide')!.options;
        assert.equal(options.length, 1); assert.equal(formatDose(options[0]), '80mg bid');
        assert.equal(smallestStepBelow(entry('Furosemide', 20, 'qd'), p), null);
        p.egfr = 35; p.creatinine = 2;
        const renal = smallestStepBelow(entry('Ramipril', 5, 'bid'), p)!;
        assert.equal(formatDose(renal), '2.5mg bid');
        // A per-dose cap must not accidentally become a daily cap for divided dosing.
        assert.equal(formatDose(smallestStepBelow(entry('Captopril', 50, 'tid'), p)!), '25mg tid');
    });
    check('all generated titration summaries state source and destination strength and frequency', () => {
        for (const source of [entry('Furosemide', 80, 'tid'), entry('Ramipril', 5, 'bid'), entry('Carvedilol', 25)]) {
            const p = patient([source]); p.volume_status.current_weight_kg = 83;
            if (source.med.drug_class === 'Beta Blocker') p.pulse=52;
            if (source.med.drug_class === 'Loop Diuretic') p.volume_status.current_weight_kg=78;
            if (source.med.name === 'Ramipril') { p.egfr=35; p.creatinine=2; }
            const candidates = generateCandidateModifications(context(p).analysis, p);
            const changes = candidates.flatMap(c => c.modifications).filter(m => m.action === 'titrate_down' || m.action === 'titrate_up');
            assert.ok(changes.length > 0);
            for (const m of changes) {
                assert.ok(m.summary.includes(`${formatDose(m.source!)} → ${formatDose(m.target!)}`), m.summary);
            }
        }
    });
    check('ARB and angioedema allergy text excludes ARNI in the public engine', () => {
        for (const allergy of ['ARB', 'angioedema']) {
            const p = patient(); p.allergies.add(allergy);
            const out = generateAndScoreModifications(p, names, prices);
            assert.ok(out.scoredRegimens.length > 0);
            for (const r of out.scoredRegimens) assert.ok(!r.regimen.some(x => x.med.drug_class === 'ARNI'));
            assert.ok(out.excludedMedications.some(x => x.name === 'Sacubitril/Valsartan (Entresto)'));
        }
    });
    check('forced MRA removal below the potassium display floor names the conflicting requirement', () => {
        const p = patient([entry('Spironolactone', 25), entry('Sacubitril/Valsartan (Entresto)', '97/103'),
            entry('Carvedilol', 25), entry('Dapagliflozin', 10), entry('Furosemide', 40)]);
        p.egfr = 24; p.creatinine = 2.5; p.potassium = 3.1;
        const out = generateAndScoreModifications(p, names, prices);
        assert.ok(out.scoredRegimens.length > 0);
        assert.ok(out.scoredRegimens.every(r => r.projected_patient.potassium === 3.1 && !r.regimen.some(m => m.med.name === 'Spironolactone')));
        assert.ok(out.clinicalAlerts.some(a => /LOW POTASSIUM/.test(a)));
        const unrelated = patient([entry('Lisinopril', 20)]);
        assert.ok(!generateAndScoreModifications(unrelated, names, prices).clinicalAlerts.some(a => a.includes('All candidates include removal')));
    });
    check('congested loop therapy cannot be reduced solely for identical plateaued modeled effects', () => {
        const source = entry('Torsemide', 100, 'bid'), p = patient([source]);
        p.volume_status.current_weight_kg = 83;
        assert.ok(!context(p).analysis.titratableDown.some(t => t.current.med.name === 'Torsemide'));
        const out = generateAndScoreModifications(p, names, prices);
        assert.ok(out.scoredRegimens.length > 0);
        assert.ok(out.scoredRegimens.every(r => !r.modification_set?.modifications.some(m => m.action === 'titrate_down' && m.source?.med.name === 'Torsemide')));
        p.volume_status.current_weight_kg = 78;
        assert.ok(context(p).analysis.titratableDown.some(t => t.current.med.name === 'Torsemide'), 'depleted patient can still reduce');
        p.volume_status.current_weight_kg = 83;
        p.current_regimen = [entry('Torsemide', 40, 'bid')];
        assert.ok(!context(p).analysis.titratableDown.some(t => t.current.med.name === 'Torsemide'), 'congestion holds elective reductions regardless of the retired curve');
    });
    return { passed, failed };
}
