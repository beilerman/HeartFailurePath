import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS } from '../data/scenarios';
import { patient, entry } from './systemicReviewChecks';
import { generateAndScoreModifications, clonePatient } from '../services/simulationService';
import { simulateModificationEffect } from '../services/engine/effects';
import { exposureErrors } from '../services/engine/medicationExposure';
import { buildTreatmentAssessment } from '../services/engine/treatmentAssessment';
import type { Patient, RegimenMed } from '../types';

const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = Object.fromEntries([...names].map(n => [n, 10]));
const run = (p: Patient, available = names) => generateAndScoreModifications(p, available, prices);
const physiology = (p: Patient) => [p.sbp,p.dbp,p.pulse,p.potassium,p.lvef,p.nt_pro_bnp,p.kccq_score,p.nyha_class,p.lavi,p.lvedd,p.volume_status.current_weight_kg,p.volume_status.dry_weight_kg];
const intensifications = (out: ReturnType<typeof run>) => out.scoredRegimens.flatMap(r => r.modification_set!.modifications.filter(m => ['add','titrate_up','swap'].includes(m.action)));
const ironPatient = () => {
    const p = patient(); Object.assign(p, { ferritin: 60, tsat: 15, hemoglobin: 12, iron_course_review: 'first_course', phosphate_review: 'not_indicated' }); return p;
};

export function runTreatmentTransitionChecks() {
    let passed = 0, failed = 0;
    const check = (name: string, fn: () => void) => {
        try { fn(); passed++; console.log(`[PASS] Treatment transition: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] Treatment transition: ${name}: ${e}`); }
    };
    check('all fixture outputs preserve measured physiology and omit unquantified outcome domains', () => {
        let count = 0;
        for (const sc of SCENARIOS) for (const r of run(sc.patient).scoredRegimens) {
            assert.deepEqual(physiology(r.projected_patient), physiology(sc.patient), sc.title);
            for (const d of r.score_breakdown!.domains.filter(d => ['neurohormonal','functional','volume','structure'].includes(d.key))) {
                assert.equal(d.assessed, false); assert.equal(d.weight, 0); assert.equal(d.contribution, 0);
            }
            assert.equal(r.treatment_assessment?.quantitative_response, 'not_estimated');
            assert.ok(Math.abs(r.score_breakdown!.domains.reduce((n,d) => n + d.weight, 0) - 1) < 1e-9);
            count++;
        }
        assert.ok(count > 100);
    });
    check('no clinical result calls any retired CHF or hemodynamic effect function', () => {
        const before = SCENARIOS.map(s => JSON.stringify(run(s.patient)));
        const old = MEDICATION_FORMULARY.map(m => ({ med:m, chf:m.chf_effects, hemo:m.hemodynamic_effects }));
        try {
            for (const {med} of old) {
                med.chf_effects = () => { throw new Error(`Retired CHF coefficient read: ${med.name}`); };
                med.hemodynamic_effects = () => { throw new Error(`Retired hemodynamic coefficient read: ${med.name}`); };
            }
            SCENARIOS.forEach((s,i) => assert.equal(JSON.stringify(run(s.patient)), before[i], s.title));
        } finally { for (const o of old) { o.med.chf_effects=o.chf; o.med.hemodynamic_effects=o.hemo; } }
    });
    check('all dose removals and sequential additions leave observations intact, including near-zero endpoints', () => {
        for (const med of MEDICATION_FORMULARY) for (const dose of med.available_doses) for (const selected_frequency of dose.frequency_options) {
            const a: RegimenMed = {med,dose,selected_frequency};
            const p = patient([a]); p.lvef = 5; p.kccq_score = 0;
            const removed = simulateModificationEffect(p,{modifications:[{action:'remove',source:a,summary:'Remove'}],resulting_regimen:[]},prices);
            assert.deepEqual(physiology(removed.projectedPatient),physiology(p));
            const restored = simulateModificationEffect(removed.projectedPatient,{modifications:[{action:'add',target:a,summary:'Add'}],resulting_regimen:[a]},prices);
            assert.deepEqual(physiology(restored.projectedPatient),physiology(p));
        }
    });
    check('binder or MRA additions cannot cancel measured hyperkalemia or hypokalemia', () => {
        const p = patient([entry('Lisinopril',20)]); p.potassium = 5.4;
        const out = run(p); assert.ok(out.scoredRegimens.length);
        assert.ok(out.scoredRegimens.every(r => r.projected_patient.potassium === 5.4));
        assert.ok(out.scoredRegimens.every(r => !r.warnings.some(w => /Binder Required/.test(w))));
        p.potassium=3.2;p.volume_status.current_weight_kg=86;p.volume_status.dry_weight_kg=80;p.current_regimen=patient([entry('Furosemide',40)]).current_regimen;
        const low=run(p); assert.ok(low.scoredRegimens.length);
        assert.ok(intensifications(low).every(m => !['Loop Diuretic','Thiazide-like Diuretic'].includes(m.target!.med.drug_class)));
        assert.ok(low.clinicalAlerts.some(a=>a.startsWith('LOW POTASSIUM')));
    });
    check('known urgent potassium permits corrective de-escalation without claiming correction', () => {
        const p=patient([entry('Spironolactone',25),entry('Lisinopril',10)]);p.potassium=6.2;
        const out=run(p);assert.ok(out.scoredRegimens.length);
        for(const r of out.scoredRegimens){assert.equal(r.projected_patient.potassium,6.2);assert.ok(r.modification_set!.modifications.filter(m=>m.action!=='keep').every(m=>['remove','titrate_down'].includes(m.action)));assert.ok(r.qualitative_projections?.some(q=>q.label==='Urgent measured hyperkalemia'));}
    });
    check('completed iron is history, not active coverage/cost or instantaneous lost benefit', () => {
        const a=entry('Ferric Carboxymaltose',500);a.exposure={status:'completed',last_dose_on:'2026-10-01'};
        const p=ironPatient();p.current_regimen=[a];
        const out=run(p);assert.ok(out.scoredRegimens.length);
        assert.ok(out.clinicalAlerts.some(a=>a.includes('recorded as completed')));
        assert.ok(out.scoredRegimens.every(r=>!r.regimen.some(m=>m.med.drug_class==='IV Iron')));
        assert.ok(out.scoredRegimens.every(r=>r.projected_patient.kccq_score===p.kccq_score));
    });
    check('iron prerequisites distinguish first, repeat, unknown, and low-phosphate states', () => {
        for (const state of [undefined,'unknown','low','not_indicated','acceptable'] as const) {
            const p=ironPatient();p.iron_course_review='repeat_reviewed';p.phosphate_review=state;
            const out=run(p,new Set(['Ferric Carboxymaltose','Dapagliflozin']));
            const hasIron=intensifications(out).some(m=>m.target?.med.drug_class==='IV Iron');
            assert.equal(hasIron,state==='acceptable',`repeat phosphate ${state}`);
            assert.ok(out.scoredRegimens.length,'other eligible decisions survive');
        }
    });
    check('held therapy cannot be silently restarted or substituted while unrelated changes remain assessable', () => {
        const a=entry('Lisinopril',10);a.exposure={status:'held'};const p=patient([a]);
        const out=run(p);assert.ok(out.scoredRegimens.length);
        assert.ok(out.scoredRegimens.every(r=>r.regimen.every(m=>!['ACEi','ARB','ARNI'].includes(m.med.drug_class))));
        assert.ok(out.excludedMedications.some(e=>/recorded hold/.test(e.reason)));
    });
    check('unconfirmed or partial use prevents dose escalation and swaps without an automatic withdrawal', () => {
        const a=entry('Metoprolol Succinate',25), p=patient([a]);p.current_regimen[0].exposure={status:'unknown',adherence:'partial'};
        const out=run(p);assert.ok(out.scoredRegimens.length);
        assert.ok(intensifications(out).every(m=>m.source?.med.name!==a.med.name));
        assert.ok(out.scoredRegimens.every(r=>r.regimen.some(m=>m.med.name===a.med.name)));
    });
    check('invalid exposure dates/status are rejected, and caller history is not mutated', () => {
        assert.ok(exposureErrors({started_on:'2026-02-30'}).length);
        assert.ok(exposureErrors({started_on:'2026-11-10',last_dose_on:'2026-01-01'}).length);
        const p=patient([entry('Lisinopril',10)]);p.current_regimen[0].exposure!.started_on='invalid';
        const before=JSON.stringify(p);const out=run(p);assert.equal(out.scoredRegimens.length,0);assert.ok(out.clinicalAlerts.some(a=>a.includes('calendar date')));assert.equal(JSON.stringify(p),before);
    });
    check('substitution and withdrawal explain unquantified response and course effects', () => {
        const a=entry('Lisinopril',10),b=entry('Valsartan',40),p=patient([a]);
        const swap=buildTreatmentAssessment(p,{modifications:[{action:'swap',source:a,target:b,summary:'Switch'}],resulting_regimen:[b]});
        assert.match(swap.considerations[0].detail,/No untreated state/);
        const iron=entry('Ferric Carboxymaltose',500),q=patient([iron]);
        const stop=buildTreatmentAssessment(q,{modifications:[{action:'remove',source:iron,summary:'End course'}],resulting_regimen:[]});
        assert.match(stop.considerations[0].detail,/does not reverse iron repletion/);
    });
    check('KCCQ instrument survives import and is never converted into another instrument or forecast', () => {
        for (const kccq_instrument of ['CSS','TSS','OSS','unknown'] as const) {
            const p=patient();p.kccq_score=43;p.kccq_instrument=kccq_instrument;
            for(const r of run(clonePatient(p)).scoredRegimens){assert.equal(r.projected_patient.kccq_score,43);assert.equal(r.projected_patient.kccq_instrument,kccq_instrument);}
        }
    });
    check('unknown dose timing blocks escalation but preserves independent decisions and dose reductions', () => {
        const p=patient([entry('Carvedilol',6.25)]);p.current_regimen[0].exposure!.dose_interval_reviewed=false;
        let out=run(p);assert.ok(out.scoredRegimens.length>0);assert.ok(!intensifications(out).some(m=>m.action==='titrate_up'&&m.source?.med.name==='Carvedilol'));
        assert.ok(out.clinicalAlerts.some(a=>a.startsWith('DOSE TIMING REVIEW')));
        assert.ok(out.decisionReadiness?.deferred.some(x=>x.includes('dose timing')));
        assert.ok(!run(patient([entry('Dapagliflozin',10)])).clinicalAlerts.some(a=>a.startsWith('DOSE TIMING REVIEW')));
        p.pulse=52;out=run(p);assert.ok(out.scoredRegimens.length>0);assert.ok(out.scoredRegimens.every(r=>r.modification_set!.modifications.some(m=>m.action==='titrate_down'&&m.source?.med.name==='Carvedilol')));
    });
    check('a proposed regimen cannot masquerade as a follow-up visit or retain prior dose tolerance', () => {
        const p=patient([entry('Carvedilol',6.25)]);p.current_regimen[0].exposure!.dose_changed_on='2026-01-01';
        const proposal=run(p,new Set(['Carvedilol'])).scoredRegimens.find(r=>r.modification_set!.modifications.some(m=>m.action==='titrate_up'))!;assert.ok(proposal);
        assert.equal(proposal.projected_patient.assessment_basis,'proposed_regimen');
        const changed=proposal.modification_set!.modifications.find(m=>m.action==='titrate_up')!.target!;
        assert.equal(proposal.projected_patient.current_regimen.find(r=>r.med.name===changed.med.name)!.exposure?.dose_changed_on,undefined);
        const out=run(proposal.projected_patient);assert.equal(out.scoredRegimens.length,0);assert.ok(out.clinicalAlerts.some(a=>a.includes('not a follow-up observation')));
        assert.equal(p.current_regimen[0].exposure?.dose_changed_on,'2026-01-01');
    });
    check('a reviewed hold can be reconsidered without claiming previous treatment response', () => {
        const p=patient([entry('Lisinopril',10)]);p.current_regimen[0].exposure={status:'held',restart_or_repeat_reviewed:true};
        const out=run(p,new Set(['Lisinopril']));assert.ok(intensifications(out).some(m=>m.target?.med.name==='Lisinopril'));
        assert.ok(out.scoredRegimens.every(r=>r.projected_patient.potassium===p.potassium));
    });
    check('unknown use cannot erase safety-driven removal when an unconfirmed substitution is withheld', () => {
        const p=patient([entry('Lisinopril',20)]);p.current_regimen[0].exposure=undefined;
        p.discontinued_meds=[{name:'Lisinopril',drug_class:'ACEi',reason:'Cough'}];
        const out=run(p);assert.ok(out.scoredRegimens.length>0);assert.ok(out.scoredRegimens.every(r=>!r.regimen.some(m=>m.med.name==='Lisinopril')));
        assert.ok(!intensifications(out).some(m=>m.action==='swap'&&m.source?.med.name==='Lisinopril'));
    });
    check('stable disease-modifying therapy is not reduced solely for cost or dosing burden', () => {
        const p=patient([entry('Lisinopril',20),entry('Carvedilol',25),entry('Spironolactone',25),entry('Dapagliflozin',10)]);
        for(const care_priority of ['default','cost_first','simplicity_first'] as const){p.care_priority=care_priority;const out=run(p);assert.ok(out.scoredRegimens.length>0);assert.ok(out.scoredRegimens.every(r=>!r.modification_set!.modifications.some(m=>['remove','titrate_down'].includes(m.action))));}
    });
    check('renal caution cannot invent a fixed cap or force an unsourced dose cut', () => {
        for(const name of ['Captopril','Valsartan']){const med=MEDICATION_FORMULARY.find(m=>m.name===name)!;
            const p=patient([entry(name,med.available_doses.at(-1)!.strength)]);p.egfr=25;p.creatinine=2.5;
            assert.equal(med.renal_adjustment?.(25,p).max_dose,undefined);
            const out=run(p);assert.ok(out.scoredRegimens.length>0);assert.ok(!intensifications(out).some(m=>m.target?.med.name===name));
            assert.ok(out.scoredRegimens.every(r=>r.regimen.some(x=>x.med.name===name&&x.dose.strength===med.available_doses.at(-1)!.strength)));
        }
    });
    check('future exposure dates are rejected and limited reviews preserve course-history alerts', () => {
        assert.ok(exposureErrors({started_on:'2099-01-01'}).some(e=>e.includes('future')));
        const p=ironPatient();p.current_regimen=[{...entry('Ferric Carboxymaltose',500),exposure:{status:'completed'}}];p.sbp=0;
        const out=run(p);assert.equal(out.scoredRegimens.length,0);assert.ok(out.clinicalAlerts.some(a=>a.startsWith('EXPOSURE HISTORY')));
    });
    return {passed,failed};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){const result=runTreatmentTransitionChecks();console.log(result);process.exit(result.failed?1:0);}
