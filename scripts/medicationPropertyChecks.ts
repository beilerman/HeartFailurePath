/** Medication transition invariants. These check software consistency, not clinical efficacy. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS } from '../data/scenarios';
import { simulateModificationEffect } from '../services/engine/effects';
import { getMedicationClassGroup } from '../services/engine/registry';
import { effectDose } from '../services/engine/regimenUtils';
import { generateAndScoreModifications } from '../services/simulationService';
import { patient, entry } from './systemicReviewChecks';
import type { Patient, RegimenMed, RegimenModification } from '../types';

const prices = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const tiers = MEDICATION_FORMULARY.flatMap(med => med.available_doses.flatMap(dose =>
    dose.frequency_options.map(selected_frequency => ({ med, dose, selected_frequency }))));
const physiology = (p: Patient) => [p.sbp, p.dbp, p.pulse, p.potassium, p.lvef, p.nt_pro_bnp,
    p.kccq_score, p.volume_status.current_weight_kg, p.volume_status.dry_weight_kg, p.lvedd, p.lavi];
const exposure = (rs: RegimenMed[]) => rs.map(r => `${r.med.name}|${r.dose.strength}|${r.dose.unit}|${r.selected_frequency}`).sort();
const change = (action: RegimenModification['action'], source?: RegimenMed, target?: RegimenMed): RegimenModification =>
    ({ action, source, target, summary: 'Medication property regression' });
const simulate = (p: Patient, modifications: RegimenModification[], resulting_regimen: RegimenMed[]) =>
    simulateModificationEffect(p, { modifications, resulting_regimen }, prices);
const baseline = (regimen: RegimenMed[] = []) => {
    const p = patient(regimen);
    Object.assign(p, { sbp: 130, dbp: 80, pulse: 85, kccq_score: 50 });
    p.volume_status.current_weight_kg = 120;
    p.volume_status.dry_weight_kg = 90;
    return p;
};
const samePhysiology = (a: Patient, b: Patient, context: string) => {
    const left = physiology(a), right = physiology(b);
    left.forEach((v, i) => assert.ok(Object.is(v, right[i]) ||
        (typeof v === 'number' && typeof right[i] === 'number' && Math.abs(v - right[i]!) < 1e-8), `${context}: field ${i}: ${v} vs ${right[i]}`));
};

export function runMedicationPropertyChecks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] Medication properties: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] Medication properties: ${name}: ${e}`); }
    };
    check('all formulary dose/frequency effect functions are finite with valid fractional reductions', () => {
        assert.equal(MEDICATION_FORMULARY.length, 32); assert.equal(tiers.length, 122);
        for (const r of tiers) {
            const chf = r.med.chf_effects(effectDose(r)), hemo = r.med.hemodynamic_effects(effectDose(r));
            for (const [key, value] of Object.entries({ ...chf, ...hemo })) {
                assert.ok(Number.isFinite(value), `${r.med.name}: ${key}`);
            }
            for (const v of [chf.bnp_reduction_percent, chf.lavi_reduction_percent, chf.lvedd_reduction_percent ?? 0]) {
                assert.ok(v >= 0 && v < 1, `${r.med.name}: invalid fractional reduction`);
            }
        }
    });
    check('replacing any of 122 exposures with itself cannot change physiology', () => {
        for (const a of tiers) {
            const p = baseline([a]);
            const unchanged = simulate(p, [], [a]).projectedPatient;
            samePhysiology(p, unchanged, a.med.name);
            samePhysiology(unchanged, simulate(p, [change('remove', a), change('add', undefined, a)], [a]).projectedPatient, a.med.name);
            samePhysiology(unchanged, simulate(p, [change('swap', a, a)], [a]).projectedPatient, a.med.name);
        }
    });
    check('all same-class dose pairs give identical physiology as a swap or removal plus addition', () => {
        for (const a of tiers) for (const b of tiers) {
            if (getMedicationClassGroup(a.med.drug_class) !== getMedicationClassGroup(b.med.drug_class)) continue;
            const p = baseline([a]);
            samePhysiology(simulate(p, [change('swap', a, b)], [b]).projectedPatient,
                simulate(p, [change('remove', a), change('add', undefined, b)], [b]).projectedPatient,
                `${a.med.name} ${a.dose.strength} -> ${b.med.name} ${b.dose.strength}`);
        }
    });
    check('same resulting exposure is independent of action and medication ordering', () => {
        const a = entry('Lisinopril', 10), b = entry('Valsartan', 40);
        const c = entry('Furosemide', 40), d = entry('Furosemide', 80);
        const p = baseline([a, c]), next = [b, d];
        const mods = [change('remove', a), change('add', undefined, b), change('titrate_up', c, d)];
        const one = simulate(p, mods, next).projectedPatient;
        const two = simulate({ ...p, current_regimen: [c, a] }, [...mods].reverse(), [...next].reverse()).projectedPatient;
        samePhysiology(one, two, 'permuted exposure');
        samePhysiology(one, simulate(p, [], next).projectedPatient, 'regimen is physiology source of truth');
    });
    check('equivalent total daily doses preserve modeled exposure where daily-dose effects are declared', () => {
        for (const [a, b] of [[entry('Furosemide', 40, 'bid'), entry('Furosemide', 80, 'qd')],
            [entry('Ramipril', 5, 'bid'), entry('Ramipril', 10, 'qd')]]) {
            const p = baseline([a]);
            samePhysiology(p, simulate(p, [change('swap', a, b)], [b]).projectedPatient, a.med.name);
        }
    });
    check('removal does not produce negative EF or out-of-range KCCQ; missing KCCQ stays missing', () => {
        let checked = 0;
        for (const a of tiers) {
            const p = baseline([a]); p.lvef = 1; p.kccq_score = 1;
            const out = simulate(p, [change('remove', a)], []), q = out.projectedPatient;
            assert.ok(q.lvef >= 0 && q.lvef <= 100); assert.ok(q.kccq_score! >= 0 && q.kccq_score! <= 100);
            assert.equal(q.lvef, 1); assert.equal(q.kccq_score, 1); checked++;
            p.kccq_score = undefined;
            assert.equal(simulate(p, [change('remove', a)], []).projectedPatient.kccq_score, undefined);
        }
        assert.equal(checked, tiers.length, 'every dose preserves observations without inventing withdrawal effects');
    });
    check('projected patient contains the new regimen without mutating or sharing mutable dose records', () => {
        const a = entry('Lisinopril', 10), b = entry('Valsartan', 40), p = baseline([a]);
        const before = JSON.stringify(p), targetBefore = JSON.stringify(b);
        const q = simulate(p, [change('swap', a, b)], [b]).projectedPatient;
        assert.deepEqual(exposure(q.current_regimen), exposure([b]));
        assert.equal(JSON.stringify(p), before); assert.equal(JSON.stringify(b), targetBefore);
        assert.notEqual(q.current_regimen[0], b); assert.notEqual(q.current_regimen[0].dose, b.dose);
    });
    check('every returned scenario option carries its own resulting exposure in projected patient', () => {
        let checked = 0;
        for (const s of SCENARIOS) for (const r of generateAndScoreModifications(s.patient, names, prices).scoredRegimens) {
            assert.deepEqual(exposure(r.projected_patient.current_regimen), exposure(r.regimen), s.title); checked++;
        }
        assert.ok(checked > 100);
    });
    return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = runMedicationPropertyChecks(); console.log(result); process.exit(result.failed ? 1 : 0);
}
