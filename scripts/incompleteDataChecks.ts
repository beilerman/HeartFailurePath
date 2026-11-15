import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { patient, entry } from './systemicReviewChecks';
import { SCENARIOS } from '../data/scenarios';
import { MEDICATION_FORMULARY } from '../constants';
import { generateAndScoreModifications, clonePatient } from '../services/simulationService';
import { calculateFunctionalScore } from '../services/engine/domains';
import { calculateCKDEPI, derivedFields } from '../services/clinicalPredicates';
import { blankPatient } from '../components/patient-form/patientDraft';
import { validatePatientForm } from '../components/patient-form/formValidation';
import type { Patient } from '../types';

const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = Object.fromEntries([...names].map(n => [n, 10]));
const run = (p: Patient, allowed = names, costs = prices) => generateAndScoreModifications(p, allowed, costs);
const changes = (out: ReturnType<typeof run>) => out.scoredRegimens.flatMap(r => r.modification_set?.modifications.filter(m => ['add','titrate_up','swap'].includes(m.action)) ?? []);

export function runIncompleteDataChecks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] Incomplete data: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] Incomplete data: ${name}: ${e}`); }
    };
    check('blank observations are accepted for a focused review without inventing clinical facts', () => {
        const p = blankPatient(), before = JSON.stringify(p, (_k,v)=>v instanceof Set ? [...v] : v);
        assert.deepEqual(validatePatientForm(p), {});
        const out = run(p);
        assert.equal(out.decisionReadiness?.mode, 'limited_review');assert.equal(out.scoredRegimens.length, 0);
        assert.ok(out.decisionReadiness!.missing.some(m=>m.field==='lvef'));
        assert.equal(JSON.stringify(p, (_k,v)=>v instanceof Set ? [...v] : v), before);
        const child=patient();child.age=17;
        assert.equal(run(child).scoredRegimens.length,0);assert.ok(run(child).clinicalAlerts.some(a=>a.includes('adults')));
    });
    check('missing KCCQ leaves useful medication options and does not fabricate a KCCQ projection', () => {
        const p=patient();p.kccq_score=undefined;p.daily_step_count=undefined;
        const out=run(p);assert.ok(out.scoredRegimens.length>0);
        for(const r of out.scoredRegimens) {
            assert.equal(r.projected_patient.kccq_score,undefined);
            assert.ok(Number.isFinite(r.overall_score));
            assert.equal(r.domain_scores.functional,75); // recorded NYHA II alone
        }
        assert.equal(calculateFunctionalScore('II',undefined),75);
        assert.equal(calculateFunctionalScore('II',0),37.5); // measured zero is not missing
    });
    check('unmeasured BNP has zero weight and remaining weights reconcile without an invented score', () => {
        const p=patient();p.nt_pro_bnp=0;const out=run(p);assert.ok(out.scoredRegimens.length);
        for(const r of out.scoredRegimens){
            const b=r.score_breakdown!, n=b.domains.find(d=>d.key==='neurohormonal')!;
            assert.equal(n.assessed,false);assert.equal(n.weight,0);assert.equal(n.contribution,0);
            assert.ok(Math.abs(b.domains.reduce((s,d)=>s+d.weight,0)-1)<1e-9);
            assert.ok(Math.abs(b.domains.reduce((s,d)=>s+d.contribution,0)-b.weighted_subtotal)<1e-9);
            assert.equal(r.projected_patient.nt_pro_bnp,0);
            assert.ok(!r.qualitative_projections?.some(q=>q.label==='Neurohormonal stress'));
        }
    });
    check('missing potassium withholds dependent changes but permits an otherwise eligible SGLT2 start', () => {
        const p=patient();p.potassium=0;const out=run(p);assert.ok(out.scoredRegimens.length);
        const held=['ACEi','ARB','ARNI','MRA','nsMRA','Loop Diuretic','Thiazide-like Diuretic','Inotrope','K+ Binder'];
        assert.ok(changes(out).every(m=>!held.includes(m.target!.med.drug_class)));
        const sglt=run(p,new Set(['Dapagliflozin']));assert.ok(changes(sglt).some(m=>m.target!.med.drug_class==='SGLT2i'));
    });
    check('missing renal function withholds renal-dependent changes while a stable beta-blocker start remains assessable', () => {
        const p=patient();p.creatinine=0;p.egfr=0;
        const out=run(p,new Set(['Metoprolol Succinate','Dapagliflozin','Lisinopril','Spironolactone','Furosemide','Digoxin']));
        assert.ok(changes(out).some(m=>m.target!.med.drug_class==='Beta Blocker'));
        assert.ok(changes(out).every(m=>m.target!.med.drug_class==='Beta Blocker'));
        assert.ok(!out.eligibleAdjuncts?.some(a=>a.includes('H/ISDN')));
    });
    check('missing heart rate blocks rate-lowering changes and is not presented as measured bradycardia', () => {
        const p=patient();p.pulse=0;const out=run(p);
        assert.ok(changes(out).every(m=>!['Beta Blocker','If Inhibitor','Inotrope'].includes(m.target!.med.drug_class)));
        const exclusion=out.excludedMedications.find(m=>m.name==='Carvedilol');assert.match(exclusion!.reason,/heart rate/);
        assert.doesNotMatch(exclusion!.reason,/bradycardia/i);
        assert.ok(changes(run(p,new Set(['Dapagliflozin']))).length);
    });
    check('unknown pregnancy holds restricted changes but permits otherwise eligible selective beta-blocker review', () => {
        const p=patient();p.sex='Female';p.is_pregnant=undefined;
        const out=run(p,new Set(['Metoprolol Succinate','Carvedilol','Lisinopril','Dapagliflozin','Spironolactone']));
        assert.ok(changes(out).some(m=>m.target!.med.name==='Metoprolol Succinate'));
        assert.ok(changes(out).every(m=>m.target!.med.name==='Metoprolol Succinate'));
        assert.equal(p.is_pregnant,undefined);
    });
    check('missing hemoglobin withholds an exact IV iron dose without blocking other medication options', () => {
        const p=patient();p.ferritin=60;p.tsat=15;p.hemoglobin=undefined;
        const out=run(p);assert.ok(out.scoredRegimens.length);
        assert.ok(changes(out).every(m=>m.target!.med.drug_class!=='IV Iron'));
        assert.ok(out.excludedMedications.some(m=>m.drug_class==='IV Iron' && /hemoglobin/.test(m.reason)));
    });
    check('missing budget or prices never produces a false affordability or over-budget conclusion', () => {
        for(const missingPrice of [false,true]) {
            const p=patient();if(!missingPrice)(p as any).max_affordable_cost=undefined;
            const out=run(p,names,missingPrice?{}:prices);assert.ok(out.scoredRegimens.length);
            for(const r of out.scoredRegimens){
                assert.ok(r.warnings.some(w=>w.startsWith('AFFORDABILITY UNASSESSED')));
                assert.ok(!r.warnings.some(w=>w.startsWith('BUDGET EXCEEDED')));
                assert.equal(r.score_breakdown!.domains.find(d=>d.key==='cost')!.assessed,false);
                assert.ok(r.trade_offs!.some(t=>t.label==='Affordability not assessed'));
                assert.ok(Number.isFinite(r.overall_score));
            }
        }
    });
    check('known urgent potassium survives every subset of missing core observations', () => {
        const fields=['age','sex','sbp','dbp','lvef','nyha_class','rhythm','current_weight_kg','dry_weight_kg'];
        for(let mask=0;mask<1<<fields.length;mask++){
            const p=patient();p.potassium=6.7;
            fields.forEach((field,i)=>{if(mask&(1<<i)) (field.endsWith('_kg')?p.volume_status:p as any)[field]=undefined;});
            const out=run(p);assert.equal(out.scoredRegimens.length,0,`mask ${mask}`);
            assert.ok(out.clinicalAlerts.some(a=>a.includes('HYPERKALEMIC EMERGENCY')),`mask ${mask}`);
        }
        const invalid=patient();invalid.potassium=6.7;invalid.current_regimen=[{med:{name:'unrecognized'}} as any];
        assert.ok(run(invalid).clinicalAlerts.some(a=>a.includes('HYPERKALEMIC EMERGENCY')));
    });
    check('partial review preserves known duplicate, allergy and nitrate interaction findings without dose orders', () => {
        const p=blankPatient();p.current_regimen=[entry('Lisinopril',10),entry('Valsartan',40),entry('Hydralazine/Isosorbide Dinitrate','37.5/20')];
        p.allergies.add('lisinopril');p.external_medications=new Set(['Sildenafil']);
        const out=run(p);assert.equal(out.scoredRegimens.length,0);
        assert.ok(out.clinicalAlerts.some(a=>a.includes('Multiple entries')));
        assert.ok(out.clinicalAlerts.some(a=>a.startsWith('ALLERGY CONFLICT')));
        assert.ok(out.clinicalAlerts.some(a=>a.startsWith('CONTRAINDICATED COMBINATION')));
        p.sbp=85;p.oxygen_saturation=85;
        const urgent=run(p);assert.ok(urgent.clinicalAlerts.some(a=>a.startsWith('HEMODYNAMIC INSTABILITY')));
        assert.ok(urgent.clinicalAlerts.some(a=>a.startsWith('HYPOXIA ALERT')));
    });
    check('derived measurements are cleared when their inputs disappear, rather than retaining an old BMI or assuming sex', () => {
        const p=patient();(p as any).height_cm=undefined;assert.equal(derivedFields(p).bmi,0);
        assert.equal(calculateCKDEPI(1,65,undefined as any),0);
        p.bmi=0;assert.ok(changes(run(p)).every(m=>!['GLP-1 RA','GLP-1/GIP RA'].includes(m.target!.med.drug_class)));
    });
    check('partial perfusion data cannot clear a patient with severe low EF and a recorded hypoperfusion marker', () => {
        const p=patient();p.lvef=15;(p as any).bun=undefined;p.volume_status.exam_findings.add('Cool Extremities');
        const out=run(p);assert.equal(out.decisionReadiness?.mode,'limited_review');assert.equal(out.scoredRegimens.length,0);
    });
    check('missing-field combinations across fixtures never yield non-finite model scores or forbidden intensification', () => {
        for(const sc of SCENARIOS){
            const p=clonePatient(sc.patient);p.kccq_score=undefined;p.nt_pro_bnp=0;p.potassium=0;p.creatinine=0;p.egfr=0;p.pulse=0;
            const out=run(p);
            for(const r of out.scoredRegimens) assert.ok(Number.isFinite(r.raw_score)&&Number.isFinite(r.overall_score),sc.title);
            assert.ok(changes(out).every(m=>!['ACEi','ARB','ARNI','MRA','nsMRA','SGLT2i','Loop Diuretic','Thiazide-like Diuretic','Inotrope','Beta Blocker','If Inhibitor','K+ Binder'].includes(m.target!.med.drug_class)),sc.title);
        }
    });
    check('missing or deselected foundational drugs do not establish intolerance or exhausted treatment', () => {
        for (const rhythm of ['Sinus', 'AFib'] as const) {
            const p=patient();p.rhythm=rhythm;p.pulse=85;
            const out=run(p,new Set(['Hydralazine/Isosorbide Dinitrate','Ivabradine','Digoxin']));
            assert.ok(changes(out).every(m=>!['Vasodilator','If Inhibitor','Inotrope'].includes(m.target!.med.drug_class)));
            assert.equal(out.eligibleAdjuncts?.length ?? 0,0);
        }
    });
    check('missing labs, pulse and pregnancy assessment do not themselves stop established foundational therapy', () => {
        const p=patient();p.sex='Female';p.is_pregnant=undefined;p.pulse=0;p.potassium=0;p.creatinine=0;p.egfr=0;
        p.current_regimen=[entry('Lisinopril',10),entry('Metoprolol Succinate',25),entry('Spironolactone',25),entry('Dapagliflozin',10)];
        const out=run(p);assert.ok(out.scoredRegimens.length);
        for(const r of out.scoredRegimens) for(const current of p.current_regimen) {
            assert.ok(r.regimen.some(m=>m.med.name===current.med.name && m.dose.strength===current.dose.strength),current.med.name);
        }
    });
    return { passed, failed };
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
    const result=runIncompleteDataChecks();console.log(result);process.exitCode=result.failed?1:0;
}
