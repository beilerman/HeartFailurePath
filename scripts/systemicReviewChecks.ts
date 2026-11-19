import { auditInputs, raiseClinicalAlerts } from '../services/engine/gates';
import { runEligibilityStage } from '../services/engine/eligibility';
import { buildScoringContext, scoreCandidates } from '../services/engine/scoring';
import { calculateCKDEPI } from '../services/clinicalPredicates';
import { LONG_ACTING_NITRATES, EXTERNAL_POTASSIUM_RAISERS } from '../services/engine/contraindications';
/** Independent regressions from the adversarial follow-on review. Run standalone or through verify. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { MEDICATION_FORMULARY } from '../constants';
import { INITIAL_PATIENT, SCENARIOS } from '../data/scenarios';
import { clonePatient, generateAndScoreModifications } from '../services/simulationService';
import { simulateModificationEffect } from '../services/engine/effects';
import { smallestStepAbove, analyzeCurrentRegimen } from '../services/engine/candidates';
import { getDoseTiers } from '../services/engine/regimenUtils';
import { chooseDisplayPicks, byScoreThenCost } from '../services/engine/selection';
import { PATIENT_RHYTHMS, type Patient, type RegimenMed, type ScoredRegimen } from '../types';

const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
export const entry = (name: string, strength: number | string, freq?: string): RegimenMed => {
    const med = MEDICATION_FORMULARY.find(m => m.name === name)!;
    const dose = med.available_doses.find(d => d.strength === strength)!;
    assert.ok(dose);
    return { med, dose, selected_frequency: freq ?? dose.frequency_options[0] };
};
export const patient = (regimen: RegimenMed[] = []): Patient => {
    const p = clonePatient(INITIAL_PATIENT);
    Object.assign(p, { sbp: 140, dbp: 80, pulse: 75, lvef: 35, egfr: 70, creatinine: 1, potassium: 4.3,
        nyha_class: 'II', max_affordable_cost: 1000, current_regimen: regimen.map(r => ({ ...r, exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true, ...r.exposure } })), max_new_classes_per_visit: 2,
        comorbidities: new Set(), external_medications: new Set(), allergies: new Set(), discontinued_meds: [] });
    p.volume_status = { dry_weight_kg: 80, current_weight_kg: 80, exam_findings: new Set() };
    return p;
};
const run = (p: Patient) => generateAndScoreModifications(p, names, prices);

export function runSystemicReviewChecks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] Systemic: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] Systemic: ${name}: ${e}`); }
    };
    check('no-change preserves every observed physiological field and examination finding across fixtures', () => {
        const failures: string[] = [];
        for (const s of SCENARIOS) {
            const p = clonePatient(s.patient);
            const projected = simulateModificationEffect(p, { modifications: [], resulting_regimen: p.current_regimen }, prices).projectedPatient;
            for (const field of ['sbp','dbp','pulse','potassium','lvef','nt_pro_bnp','kccq_score','lvedd','lavi'] as const) {
                if (!Object.is(projected[field], p[field])) failures.push(`${s.title}: ${field} ${p[field]} -> ${projected[field]}`);
            }
            if (projected.volume_status.current_weight_kg !== p.volume_status.current_weight_kg) failures.push(`${s.title}: weight changed`);
            if ([...p.volume_status.exam_findings].some(f => !projected.volume_status.exam_findings.has(f))) failures.push(`${s.title}: exam erased`);
        }
        assert.equal(failures.length, 0, failures.slice(0,8).join('; '));
    });
    check('non-finite, missing and invalid control inputs never yield non-finite scores', () => {
        for (const field of ['kccq_score','cost_sensitivity','complexity_tolerance','max_affordable_cost','max_new_classes_per_visit','dbp'] as const) {
            for (const value of [NaN, Infinity, -Infinity, undefined]) {
                const p = patient(); (p as any)[field] = value;
                const out = run(p);
                if (value === undefined && ['kccq_score', 'max_affordable_cost'].includes(field)) {
                    assert.ok(out.scoredRegimens.length > 0, `${field}: unrelated decisions were blocked`);
                    assert.ok(out.scoredRegimens.every(r => Number.isFinite(r.overall_score) && Number.isFinite(r.raw_score)));
                    assert.ok(out.decisionReadiness?.missing.some(m => m.field === field));
                    continue;
                }
                assert.ok(out.clinicalAlerts.length > 0, `${field} ${value}: no explanation`);
                assert.equal(out.scoredRegimens.length, 0, `${field} ${value}: recommendations issued`);
            }
        }
    });
    check('unsupported dose, wrong units, missing medication and unsupported frequency stop with named input errors', () => {
        const base = entry('Carvedilol', 25);
        const bad: RegimenMed[] = [
            { ...base, selected_frequency: 'weekly' },
            { ...base, dose: { ...base.dose, strength: NaN } },
            { ...base, dose: { ...base.dose, strength: 999 } },
            { ...base, dose: { ...base.dose, unit: 'mcg' } },
            { ...base, med: undefined as any },
        ];
        for (const r of bad) {
            const out = run(patient([r]));
            assert.equal(out.scoredRegimens.length, 0);
            assert.ok(out.clinicalAlerts.some(a => a.startsWith('INPUT ERROR:')));
        }
    });
    check('input medication metadata cannot override canonical clinical facts', () => {
        const r = entry('Spironolactone', 25);
        const p = patient([{ ...r, med: { ...r.med, drug_class: 'SGLT2i', contraindications: () => false, contraindication_checks: [] } as any }]);
        p.potassium = 6;
        const out = run(p);
        assert.ok(out.scoredRegimens.every(o => !o.regimen.some(x => x.med.name === 'Spironolactone')));
        assert.equal(p.current_regimen[0].med.drug_class, 'SGLT2i', 'caller was mutated');
    });
    check('per-dose renal caps do not silently become total-daily caps', () => {
        const p = patient([entry('Captopril', 6.25, 'tid')]); p.egfr = 35; p.creatinine = 2;
        const a = analyzeCurrentRegimen(p, MEDICATION_FORMULARY, MEDICATION_FORMULARY.flatMap(m => getDoseTiers(m,p)));
        const up = a.titratableUp.find(x => x.current.med.name === 'Captopril')!.options;
        assert.ok(up.some(r => r.dose.strength === 12.5 && r.selected_frequency === 'tid'));
        assert.equal(smallestStepAbove(p.current_regimen[0],p,18.75)?.dose.strength,12.5, 'per-dose cap excludes no valid divided dose');
    });
    check('unsafe affordable candidates do not hide safe over-budget candidates', () => {
        const p = patient(); p.max_affordable_cost = 5;
        const seed = run(patient()).scoredRegimens[0]; assert.ok(seed);
        const safe: ScoredRegimen = { ...seed, cost: 10, overall_score: 60, projected_patient: clonePatient(p), warnings: [] };
        const unsafe: ScoredRegimen = { ...safe, cost: 0, overall_score: 90, projected_patient: { ...clonePatient(p), sbp: 70 } };
        const result = chooseDisplayPicks([unsafe,safe], p, byScoreThenCost);
        assert.equal(result.picks.length, 1); assert.equal(result.picks[0].cost, 10);
        assert.ok(result.picks[0].warnings.some(w => w.startsWith('BUDGET EXCEEDED:')));
    });
    check('cost-first over-budget fallback leads with lower cost within the safe pool', () => {
        const p = patient(); p.max_affordable_cost = 1; p.care_priority = 'cost_first';
        const seed = run(patient()).scoredRegimens[0];
        const cheap: ScoredRegimen = { ...seed, cost: 10, overall_score: 20, projected_patient: clonePatient(p), warnings: [] };
        const costly: ScoredRegimen = { ...cheap, cost: 30, overall_score: 90 };
        assert.equal(chooseDisplayPicks([costly,cheap],p,byScoreThenCost).picks[0].cost, 10);
    });
    check('exam-confirmed congestion prevents contradictory euvolemia/over-treatment alerts', () => {
        const p = patient([entry('Furosemide',80,'bid')]); p.volume_status.exam_findings = new Set(['Elevated JVP','Pulmonary Crackles']);
        const out = run(p);
        assert.ok(!out.clinicalAlerts.some(a => a.includes('LOOP DIURETIC OVER-TREATMENT') || a.includes('stable euvolemic')));
    });
    check('digoxin interaction guidance includes each supported interacting exposure', () => {
        for (const name of ['Amiodarone','Clarithromycin']) {
            const p = patient([entry('Digoxin',125)]); p.external_medications = new Set([name]);
            const out = run(p);
            const keeps = out.scoredRegimens.filter(r => r.regimen.some(m => m.med.name === 'Digoxin'));
            assert.ok(keeps.length > 0);
            assert.ok(keeps.every(r => r.warnings.some(w => w.includes(name) && w.includes('digoxin') && w.includes('already'))), name);
        }
    });
    check('every supported rhythm reaches clinical assessment instead of a schema rejection', () => {
        for (const rhythm of PATIENT_RHYTHMS) {
            const p = patient([entry('Carvedilol',12.5)]); p.rhythm = rhythm;
            const out = run(p);
            assert.ok(!out.clinicalAlerts.some(a => a.startsWith('INPUT ERROR:')),rhythm);
        }
    });
    check('every declared drug strength and frequency is accepted without trusting supplied functions', () => {
        for (const med of MEDICATION_FORMULARY) for (const dose of med.available_doses) for (const frequency of dose.frequency_options) {
            const r = entry(med.name,dose.strength,frequency);
            const p = patient([{...r, med: {name: med.name} as any}]);
            assert.ok(!run(p).clinicalAlerts.some(a=>a.startsWith('INPUT ERROR:')),`${med.name} ${dose.strength} ${frequency}`);
        }
    });
    check('adding a drug with no special-feature points does not dilute existing evidence credit', () => {
        const p = patient([entry('Lisinopril',20),entry('Carvedilol',25),entry('Eplerenone',25),entry('Dapagliflozin',10)]);
        p.ferritin=300;p.tsat=30;
        const alerts:string[]=[];const audit=auditInputs(p,alerts);const flags=raiseClinicalAlerts(p,audit.dataAudit,alerts);
        const eligible=runEligibilityStage(p,audit.dataAudit.unknownRenal,names,alerts);
        const tiers=eligible.formulary.flatMap(m=>getDoseTiers(m,p));
        const analysis=analyzeCurrentRegimen(p,eligible.formulary,tiers,eligible.allBBExcluded);
        const ctx=buildScoringContext(p,prices,eligible.intolerancePolicy,audit.dataAudit,eligible.formulary,tiers,analysis,flags);
        const binder=entry('Patiromer',8.4);
        const scores=scoreCandidates([{modifications:[],resulting_regimen:p.current_regimen},
            {modifications:[{action:'add',target:binder,summary:'Add binder'}],resulting_regimen:[...p.current_regimen,binder]}],ctx);
        assert.equal(scores.length,2);assert.equal(scores[0].special_feature_bonus,0);   // 2026-11-16: every special feature adds 0 points (measured models replace them)
        assert.equal(scores[0].special_feature_bonus,scores[1].special_feature_bonus);
    });
    check('pregnancy switch during low output lands at or below the selective beta-blocker start dose', () => {
        const p=patient([entry('Carvedilol',25)]);p.is_pregnant=true;p.sex='Female';p.pulse=52;p.lvef=15;p.sbp=98;p.dbp=76;p.bun=50;
        p.volume_status.current_weight_kg=84;p.volume_status.exam_findings=new Set(['Cool Extremities']);
        const out=run(p);assert.ok(out.scoredRegimens.length>0);
        const bbs=out.scoredRegimens.flatMap(r=>r.regimen.filter(x=>x.med.drug_class==='Beta Blocker'));
        assert.ok(bbs.length>0);
        for(const r of bbs){assert.ok(r.med.facts?.beta1_selective);assert.ok(Number(r.dose.strength)<=Number(r.med.start_dose_for!(p)));}
    });
    check('duplicate nitrate and renal aliskiren warnings cover the actual exposures', () => {
        const p=patient([entry('Hydralazine/Isosorbide Dinitrate','37.5/20')]);p.external_medications=new Set([LONG_ACTING_NITRATES[0]]);
        const w=simulateModificationEffect(p,{modifications:[],resulting_regimen:p.current_regimen},prices).warnings;
        assert.ok(w.some(x=>x.toLowerCase().includes('nitrate')&&x.includes(LONG_ACTING_NITRATES[0])));
        const q=patient([entry('Lisinopril',20)]);q.egfr=45;q.creatinine=1.5;q.external_medications=new Set(['Aliskiren']);
        assert.ok(simulateModificationEffect(q,{modifications:[],resulting_regimen:q.current_regimen},prices).warnings.some(x=>x.toLowerCase().includes('aliskiren')));
    });
    check('potassium interaction warning names every relevant co-medication', () => {
        const p=patient();p.external_medications=new Set([EXTERNAL_POTASSIUM_RAISERS[0],EXTERNAL_POTASSIUM_RAISERS[1]]);
        const target=entry('Lisinopril',2.5);
        const warnings=simulateModificationEffect(p,{modifications:[{action:'add',target,summary:'New RAAS'}],resulting_regimen:[target]},prices).warnings;
        assert.ok(warnings.some(w=>w.includes(EXTERNAL_POTASSIUM_RAISERS[0])&&w.includes(EXTERNAL_POTASSIUM_RAISERS[1])));
    });
    check('negative creatinine produces a finite unknown eGFR rather than a NaN update loop', () => {
        assert.equal(calculateCKDEPI(-1,65,'Male'),0);
    });
    check('malformed nested inputs and numeric strings cannot bypass the public boundary', () => {
        const malformed = [
            { potassium: '6.0' }, { sbp: {} }, { is_pregnant: 'false' },
            { volume_status: { dry_weight_kg: '80', current_weight_kg: 80, exam_findings: new Set() } },
            { volume_status: { dry_weight_kg: 80, current_weight_kg: 80, exam_findings: new Set([12]) } },
            { discontinued_meds: [{ name: 'Lisinopril', drug_class: 'ACEi' }] },
        ];
        for (const patch of malformed) {
            const out = run(Object.assign(patient(),patch) as Patient);
            assert.equal(out.scoredRegimens.length,0);
            assert.ok(out.clinicalAlerts.some(a=>a.startsWith('INPUT ERROR:')));
        }
    });
    check('negative prices cannot make a regimen artificially affordable', () => {
        const p=patient([entry('Carvedilol',25)]);
        const out=simulateModificationEffect(p,{modifications:[],resulting_regimen:p.current_regimen},{Carvedilol:-10});
        assert.equal(out.cost,Infinity);
        assert.ok(out.warnings.some(w=>w.startsWith('PRICE UNKNOWN:')));
    });
    return { passed, failed };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = runSystemicReviewChecks(); console.log(result); process.exit(result.failed ? 1 : 0);
}
