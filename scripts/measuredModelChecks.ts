/**
 * Checks for the three measured models wired into the score (2026-11-16): trial-achieved dose anchors, symptoms (KCCQ points) and side effects
 * (measured harm rates), the weight rule, retired special-feature points, congestion coverage and label-start new starts. Written test-first.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { entry, patient } from './systemicReviewChecks';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS } from '../data/scenarios';
import { generateAndScoreModifications, clonePatient as clonePatientForTest } from '../services/simulationService';
import { therapyDoseCredit } from '../services/engine/regimenUtils';
import { DOSE_EVIDENCE, START_DOSE_CREDIT, numericDailyDose, outcomeDoseCredit } from '../services/engine/doseCredit';
import { regimenSymptomEstimate, SYMPTOM_TABLE } from '../services/engine/symptomBenefit';
import { harmBurdenFor, HARM_TABLE, HARM_VALIDATION_RUNS } from '../services/engine/harmBurden';
import { planCreditsFor } from '../services/engine/doseCredit';
import { regimenOutcomeEstimate, compareOutcomeEstimate, OUTCOME_EVIDENCE_TABLE, populationKeyFor } from '../services/engine/outcomeBenefit';
import { auditInputs, raiseClinicalAlerts } from '../services/engine/gates';
import { runEligibilityStage } from '../services/engine/eligibility';
import { analyzeCurrentRegimen, generateCandidateModifications } from '../services/engine/candidates';
import { getDoseTiers, numericStrength, dosesPerDay } from '../services/engine/regimenUtils';
import type { ModificationSet } from '../types';
import { buildScoringContext, scoreCandidates } from '../services/engine/scoring';
import { buildOutcomeEstimateViews } from '../services/engine/outcomeBenefit';
import { scoredCandidates } from './scoredCandidates';
import { OUTCOME_TAU2, OUTCOME_TAU2_EXCL_CONGESTED_LOOP, shrunkOutcomeRow, outcomeStats } from '../services/engine/outcomeBenefit';
import { SYMPTOM_TAU2, shrunkSymptomRow, symptomStats } from '../services/engine/symptomBenefit';
import { shrinkValue, tau2From } from '../services/engine/shrinkage';
import type { OutcomeEvidenceRow } from '../services/engine/outcomeBenefit';
import { WEIGHT_PROFILES, WEIGHT_PROFILE_NAMES, DOMAIN_KEYS, KCCQ_FULL_CREDIT_POINTS, sideEffectScore, SIDE_EFFECT_BURDEN_DIVISOR } from '../services/engine/scoreModel';
import type { Patient, RegimenMed, ScoredRegimen } from '../types';

const ENTRESTO = 'Sacubitril/Valsartan (Entresto)';
const NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));
const PRICES = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
const run = (p: Patient) => generateAndScoreModifications(p, NAMES, PRICES);
const near = (a: number, b: number, tol = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const changes = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
const c0 = START_DOSE_CREDIT.value;
const outcomeDoseCreditForTest = outcomeDoseCredit;

export function runMeasuredModelChecks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] Measured models: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] Measured models: ${name}: ${e}`); }
    };
    const withEf = (lvef: number): Patient => { const p = patient(); p.lvef = lvef; return p; };

    // ---------------- A. dose anchors ----------------
    check('start_dose_credit is recomputed from the file (ATLAS and HEAAL entries): mean of the four c0, with basis and arithmetic', () => {
        const f = DOSE_EVIDENCE as unknown as { start_dose_credit: { value: number; entries: { drug: string; low_daily_mg: number; label_start_mg: number; implied_credit: number }[]; basis: string; arithmetic: string }; anchors: { drug: string; full_credit_daily_mg: number | null }[] };
        const mg = (d: string) => f.anchors.find(a => a.drug === d)!.full_credit_daily_mg!;
        assert.equal(f.start_dose_credit.entries.length, 4);
        const cs = f.start_dose_credit.entries.map(e => { const anchor = mg(e.drug), fr = (e.low_daily_mg - e.label_start_mg) / (anchor - e.label_start_mg); return (e.implied_credit - fr) / (1 - fr); });
        near(cs.reduce((a, b) => a + b, 0) / 4, f.start_dose_credit.value, 1e-5, 'value');
        assert.ok(c0 > 0.3 && c0 < 0.45, `c0 ${c0}`);
        assert.equal(f.start_dose_credit.basis, 'measured for ACE inhibitors and ARBs (two randomized dose comparisons); extrapolated to every other class');
        assert.ok(f.start_dose_credit.arithmetic.length > 10);
        for (const a of f.anchors as unknown as Record<string, unknown>[]) for (const k of ['id', 'drug', 'level', 'source', 'verification', 'quote', 'arithmetic', 'trial']) assert.ok(k in a, `anchor ${a.id} lacks ${k}`);
    });

    check('numericDailyDose: combination strengths are numeric (sacubitril + valsartan; hydralazine component); plain drugs unchanged', () => {
        assert.equal(numericDailyDose(entry(ENTRESTO, '97/103', 'bid')), 400);
        assert.equal(numericDailyDose(entry(ENTRESTO, '24/26', 'bid')), 100);
        assert.equal(numericDailyDose(entry('Hydralazine/Isosorbide Dinitrate', '37.5/20', 'tid')), 112.5);
        assert.equal(numericDailyDose(entry('Carvedilol', 25, 'bid')), 50);
        assert.equal(numericDailyDose(entry('Spironolactone', 25)), 25);
        const src = readFileSync(join(import.meta.dirname, '..', 'services/engine/harmBurden.ts'), 'utf8');
        assert.ok(src.includes('numericDailyDose'), 'harmBurden.ts must read daily mg through the shared helper');
    });

    check('outcomeDoseCredit: anchor at 1, linear from the start dose (c0), proportional below start; combinations, renal rows, fallbacks', () => {
        const p = patient();                                   // eGFR 70
        const credit = (n: string, d: number | string, pp: Patient = p, freq?: string) => outcomeDoseCredit(entry(n, d, freq), pp);
        near(credit('Spironolactone', 25), c0, 1e-9, 'spiro at start');
        near(credit('Spironolactone', 12.5), c0 * 0.5, 1e-9, 'spiro below start');
        assert.equal(credit('Spironolactone', 50), 1);
        near(credit('Eplerenone', 25), c0, 1e-9, 'eplerenone eGFR 70 (anchor 42)');
        assert.equal(credit('Eplerenone', 50), 1);
        const low = patient(); low.egfr = 40; low.creatinine = 1.8;
        assert.equal(credit('Eplerenone', 25, low), 1);        // anchor 25 (eGFR < 50 row) is at the start dose
        near(credit('Finerenone (Kerendia)', 10, p), c0 * 0.5, 1e-9, 'finerenone eGFR 70 start 20');
        near(credit('Finerenone (Kerendia)', 20, p), c0, 1e-9);
        assert.equal(credit('Finerenone (Kerendia)', 40, p), 1);
        near(credit('Finerenone (Kerendia)', 10, low), c0, 1e-9, 'finerenone eGFR 40 start 10');
        assert.equal(credit('Finerenone (Kerendia)', 20, low), 1);
        near(credit(ENTRESTO, '24/26', p, 'bid'), c0, 1e-9, 'ARNI start');
        near(credit(ENTRESTO, '49/51', p, 'bid'), c0 + (1 - c0) * (200 - 100) / (375 - 100), 1e-9, 'ARNI middle');
        assert.equal(credit(ENTRESTO, '97/103', p, 'bid'), 1);   // 400 mg >= 375 mg anchor
        const lis = (d: number) => credit('Lisinopril', d);
        near(lis(5), c0 + (1 - c0) * (5 - 2.5) / (16.79 - 2.5), 1e-9, 'lisinopril 5');
        assert.equal(lis(20), 1);
        assert.equal(credit('Dapagliflozin', 10), 1);          // single dose
        assert.equal(credit('Furosemide', 40), 1);             // no numeric anchor, at or above the start
        near(therapyDoseCredit(entry('Spironolactone', 25), p), 0.6, 1e-12, 'completeness credit untouched');
        // not_measured rows with a numeric label dose fall back to the engine target logic with the same curve
        near(credit('Semaglutide (Wegovy)', 0.25, p, 'weekly'), c0, 1e-9, 'semaglutide at its start');
    });

    // ---------------- B. symptoms ----------------
    check('symptoms: sum of credit x KCCQ points over one contributor per mechanism group; score = clamp(100 x sum / 20, 0, 100); additivity stated', () => {
        const p = patient();                                   // reduced EF
        const bb = SYMPTOM_TABLE.find(r => r.id === 'bb-reduced')!, sg = SYMPTOM_TABLE.find(r => r.id === 'sglt2i-reduced')!;
        const ubb = shrunkSymptomRow(SYMPTOM_TABLE, bb).used, usg = shrunkSymptomRow(SYMPTOM_TABLE, sg).used;   // precision-weighted KCCQ points
        const e = regimenSymptomEstimate(SYMPTOM_TABLE, [entry('Carvedilol', 25, 'bid'), entry('Dapagliflozin', 10)], p);
        near(e.points, ubb + usg, 1e-9);
        near(e.score, 100 * (ubb + usg) / KCCQ_FULL_CREDIT_POINTS, 1e-9);
        assert.equal(KCCQ_FULL_CREDIT_POINTS, 20);
        // one per mechanism group: steroidal MRA + nsMRA counts the larger once
        const mra = regimenSymptomEstimate(SYMPTOM_TABLE, [entry('Spironolactone', 50), entry('Finerenone (Kerendia)', 20)], p);
        assert.equal(mra.contributors.length, 1); assert.equal(mra.not_counted.length, 1);
        // clamp at 100, never below 0
        const big = regimenSymptomEstimate(SYMPTOM_TABLE, [entry('Carvedilol', 25, 'bid'), entry('Dapagliflozin', 10), entry('Semaglutide (Wegovy)', 2.4, 'weekly'), entry('Ferric Carboxymaltose', 500)], withEf(30));
        assert.ok(big.points > KCCQ_FULL_CREDIT_POINTS || big.score <= 100); assert.ok(big.score <= 100 && big.score >= 0);
        const neg = regimenSymptomEstimate(SYMPTOM_TABLE, [entry('Patiromer', 8.4)], p);
        assert.equal(neg.score, 0);
        // not_measured contributors are returned and flagged, with 0 points
        const loop = regimenSymptomEstimate(SYMPTOM_TABLE, [entry('Furosemide', 40)], p);
        assert.equal(loop.contributors[0].not_measured, true); assert.equal(loop.points, 0);
        const out = run(patient([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)]));
        for (const r of out.scoredRegimens) {
            const line = r.score_breakdown!.domains.find(d => d.key === 'symptoms')!;
            assert.ok(line && line.detail!.toLowerCase().includes('additive'), line?.detail);
            assert.equal(r.domain_scores.symptoms, Math.round(line.score));
            assert.ok(r.symptom_estimate && r.symptom_estimate.contributors.length > 0);
        }
    });

    check('symptoms: credit uses the anchor curve (below-anchor dose earns less than the anchor dose)', () => {
        const p = patient();
        const at = (d: number) => regimenSymptomEstimate(SYMPTOM_TABLE, [entry('Spironolactone', d)], p).points;
        assert.ok(at(12.5) < at(25) && at(25) < at(50));
        near(at(50), shrunkSymptomRow(SYMPTOM_TABLE, SYMPTOM_TABLE.find(r => r.id === 'mra-reduced')!).used, 1e-9);
    });

    // ---------------- C. side effects ----------------
    check('side effects: domain = harmBurdenFor score; harm_burden attached; every drug x dose x frequency x sex yields a burden without throwing', () => {
        const p = patient([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)]);
        for (const r of run(p).scoredRegimens) {
            const exp = harmBurdenFor(HARM_TABLE, r.regimen, p);
            const line = r.score_breakdown!.domains.find(d => d.key === 'side_effects')!;
            const want = Math.max(0, 100 - exp.burden / SIDE_EFFECT_BURDEN_DIVISOR);
            near(line.score, want, 1e-9); assert.equal(r.domain_scores.side_effects, Math.round(want));
            assert.ok(r.harm_burden && Math.abs(r.harm_burden.score - want) < 1e-9 && Math.abs(r.harm_burden.burden - exp.burden) < 1e-9);
        }
        for (const sex of ['Male', 'Female'] as const) for (const med of MEDICATION_FORMULARY) for (const dose of med.available_doses) for (const frequency of dose.frequency_options) {
            const q = patient(); q.sex = sex;
            const b = harmBurdenFor(HARM_TABLE, [{ med, dose, selected_frequency: frequency } as RegimenMed], q);
            assert.ok(Number.isFinite(b.score) && b.score >= 0 && b.score <= 100, `${med.name} ${dose.strength} ${frequency} ${sex}`);
        }
    });

    // ---------------- D. weights by rule ----------------
    check('weights: generated by the stated rule (base, x0.5 cost and adherence, x3 cost, x3 adherence; renormalized); six active domains; the rest 0', () => {
        const base = { mortality: 0.30, hf_hospitalization: 0.22, symptoms: 0.10, side_effects: 0.14, cost: 0.14, adherence: 0.10 };
        const mult: Record<string, Partial<Record<keyof typeof base, number>>> = { default: {}, outcomes_first: { cost: 0.5, adherence: 0.5 }, cost_first: { cost: 3 }, simplicity_first: { adherence: 3 } };
        for (const name of WEIGHT_PROFILE_NAMES) {
            const raw = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, v * (mult[name][k as keyof typeof base] ?? 1)])) as typeof base;
            const total = Object.values(raw).reduce((a, b) => a + b, 0);
            for (const [k, v] of Object.entries(raw)) near(WEIGHT_PROFILES[name][k as keyof typeof base], v / total, 1e-9, `${name}.${k}`);
            for (const k of ['neurohormonal', 'functional', 'volume', 'structure', 'guideline', 'completeness'] as const) assert.equal(WEIGHT_PROFILES[name][k], 0);
            near(DOMAIN_KEYS.reduce((s, k) => s + WEIGHT_PROFILES[name][k], 0), 1, 1e-9);
        }
        assert.deepEqual([...DOMAIN_KEYS.slice(0, 4)], ['mortality', 'hf_hospitalization', 'symptoms', 'side_effects']);
    });

    // ---------------- E. retired special-feature points ----------------
    check('special features: every entry declares replaced_by and adds 0 points; only the mandatory swap (+15) remains', () => {
        const allowed = ['outcome', 'symptom', 'harm', 'adherence', 'not_modelled'];
        for (const m of MEDICATION_FORMULARY) for (const f of m.special_features ?? []) assert.ok(allowed.includes((f as { replaced_by?: string }).replaced_by ?? ''), `${m.name}: ${f.feature}`);
        const replaced = MEDICATION_FORMULARY.flatMap(m => (m.special_features ?? []).map(f => (f as { replaced_by?: string }).replaced_by));
        assert.equal(replaced.filter(x => x === 'outcome').length, 7);
        assert.equal(replaced.filter(x => x === 'symptom').length, 1);
        assert.equal(replaced.filter(x => x === 'not_modelled').length, 5);   // digoxin AF, Furoscix decongestion, dapagliflozin and empagliflozin in diabetes, bisoprolol COPD
        let swapSeen = 0;
        for (const sc of SCENARIOS) for (const r of run(sc.patient).scoredRegimens) {
            const sf = r.score_breakdown!.adjustments.find(a => a.code === 'SPECIAL_FEATURES');
            for (const it of sf?.items ?? []) { assert.ok(it.feature.startsWith('Mandatory swap'), `${sc.title}: ${it.feature}`); assert.equal(it.points, 15); swapSeen++; }
        }
        assert.ok(swapSeen > 0, 'the +15 mandatory swap must still occur in some scenario');
        // not_modelled note and gout caution at 0
        const d = patient([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)]); d.comorbidities = new Set(['Diabetes Mellitus Type 2', 'Gout']);
        const dm = run(d).scoredRegimens.find(r => r.regimen.some(m => m.med.name === 'Dapagliflozin' || m.med.name === 'Empagliflozin'));
        assert.ok(dm, 'an SGLT2 inhibitor option'); assert.ok(dm!.rationale.some(t => t.includes('Preferred in Diabetics') && t.includes('(noted; not scored: no measured model yet)')));
    });

    // ---------------- F. congestion coverage and label-start new starts ----------------
    check('congestion coverage shows the best-scoring eligible loop candidate, not a plain loop step regardless of score', () => {
        const sc = SCENARIOS.find(s => s.title === 'Finerenone in HFpEF (LVEF 55)')!;
        const patientC = { ...sc.patient, insurance_tier: 'commercial' as const };
        const out = run(patientC);
        const sig = (r: ScoredRegimen) => r.regimen.map(m => `${m.med.name}${m.dose.strength}`).sort().join('+');
        const bestLoop = scoredCandidates(patientC).filter(r => changes(r).some(m => (m.action === 'add' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Loop Diuretic'))
            .sort((a, b) => b.raw_score! - a.raw_score!)[0];
        assert.ok(bestLoop, 'a loop candidate exists');
        assert.ok(out.scoredRegimens.some(r => sig(r) === sig(bestLoop)), 'the best-scoring loop candidate is displayed');
        assert.ok(bestLoop.regimen.some(m => m.med.name === 'Dapagliflozin') || bestLoop.raw_score! > 40, `best loop candidate raw ${bestLoop.raw_score}`);
    });

    check('new starts are offered at the patient label starting dose (start_dose_for), never the lowest tablet tier', () => {
        let seen = 0;
        for (const sc of SCENARIOS) for (const r of run(sc.patient).scoredRegimens) for (const m of changes(r)) {
            if (m.action !== 'add' || !m.target?.med.start_dose_for) continue;
            seen++;
            assert.equal(String(m.target.dose.strength), String(m.target.med.start_dose_for(sc.patient)), `${sc.title}: ${m.target.med.name} ${m.target.dose.strength}`);
        }
        assert.ok(seen > 300);
    });

    // ---------------- plan credit (2026-11-16 round 2) ----------------
    const plan = (modifications: ModificationSet['modifications'], resulting: RegimenMed[], p: Patient) => planCreditsFor({ modifications, resulting_regimen: resulting }, p);
    const rrPlanned = (modifications: ModificationSet['modifications'], resulting: RegimenMed[], p: Patient, outcome: 'all_cause_death' | 'hf_hospitalization') =>
        regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, resulting, p, outcome, populationKeyFor, plan(modifications, resulting, p).creditFn);
    const low = (): Patient => { const q = patient(); q.egfr = 40; q.creatinine = 1.8; return q; };

    check('plan credit (a): adding spironolactone 12.5 and adding eplerenone 25 at eGFR 40 give the same death and hospitalization RR (a start is valued as titrated)', () => {
        const q = low(), sp = entry('Spironolactone', 12.5), ep = entry('Eplerenone', 25);
        for (const o of ['all_cause_death', 'hf_hospitalization'] as const) {
            const a = rrPlanned([{ action: 'add', target: sp, summary: 'x' }], [sp], q, o), b = rrPlanned([{ action: 'add', target: ep, summary: 'x' }], [ep], q, o);
            assert.equal(a.rr, b.rr, o);
            assert.equal(a.contributors[0].credit, 1);
        }
    });

    check('plan credit (b): increasing carvedilol 3.125 to 6.25 bid scores above no change; as_planned equals the full-dose RR while as_prescribed is a smaller benefit', () => {
        const p = patient([entry('Lisinopril', 20), entry('Carvedilol', 3.125, 'bid')]);
        const alerts: string[] = [];
        const audit = auditInputs(p, alerts); const flags = raiseClinicalAlerts(p, audit.dataAudit, alerts);
        const eligible = runEligibilityStage(p, audit.dataAudit.unknownRenal, NAMES, alerts);
        const tiers = eligible.formulary.flatMap(m => getDoseTiers(m, p));
        const analysis = analyzeCurrentRegimen(p, eligible.formulary, tiers, eligible.allBBExcluded);
        const ctx = buildScoringContext(p, PRICES, eligible.intolerancePolicy, audit.dataAudit, eligible.formulary, tiers, analysis, flags);
        const cur = p.current_regimen, up = entry('Carvedilol', 6.25, 'bid');
        const upSet: ModificationSet = { modifications: [{ action: 'titrate_up', source: cur[1], target: up, summary: 'up' }], resulting_regimen: [cur[0], up] };
        const keepSet: ModificationSet = { modifications: [], resulting_regimen: cur };
        const [kept, raised] = scoreCandidates([keepSet, upSet], ctx);
        const m = (r: ScoredRegimen) => r.score_breakdown!.domains.find(d => d.key === 'mortality')!.score;
        assert.ok(m(raised) > m(kept), `${m(raised)} vs ${m(kept)}`);
        assert.ok(raised.raw_score! > kept.raw_score!, 'the up-titration scores above no change overall');
        for (const o of buildOutcomeEstimateViews(raised.regimen, p, upSet)) {
            assert.equal(o.as_planned.rr, o.at_target.rr);
            assert.ok(o.as_prescribed.rr > o.as_planned.rr, `${o.outcome}`);
            assert.equal(o.rr, o.as_planned.rr);
            assert.ok(o.vs_current.rr < 1);
        }
    });

    check('plan credit (c): swapping metoprolol at a sub-anchor dose to bisoprolol at its start dose does not improve the RR (like-for-like swap)', () => {
        const q = patient(), src = entry('Metoprolol Succinate', 100), tgt = entry('Bisoprolol', 1.25);
        const credit = plan([{ action: 'swap', source: src, target: tgt, summary: 'x' }], [tgt], q).creditFn;
        for (const o of ['all_cause_death', 'hf_hospitalization'] as const) {
            const c = compareOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, [tgt], [src], q, o, populationKeyFor, credit, outcomeDoseCreditForTest);
            assert.ok(c.rr >= 1 - 1e-12, `${o} rr ${c.rr}`);
        }
    });

    check('plan credit (d): switching lisinopril 20 to sacubitril/valsartan is a start in a different class, credit 1', () => {
        const q = patient(), src = entry('Lisinopril', 20), tgt = entry(ENTRESTO, '24/26', 'bid');
        const pc = plan([{ action: 'swap', source: src, target: tgt, summary: 'x' }], [tgt], q);
        assert.equal(pc.creditFn(tgt, q), 1);
        assert.ok(pc.titrated.includes(ENTRESTO));
    });

    check('plan credit (e): for a patient on lisinopril 5, increasing lisinopril has a lower death RR than switching to losartan', () => {
        const q = patient([entry('Lisinopril', 5)]);
        const cur = q.current_regimen[0], up = entry('Lisinopril', 20), los = entry('Losartan', 25);
        const inc = rrPlanned([{ action: 'titrate_up', source: cur, target: up, summary: 'x' }], [up], q, 'all_cause_death');
        const sw = rrPlanned([{ action: 'swap', source: cur, target: los, summary: 'x' }], [los], q, 'all_cause_death');
        assert.ok(inc.rr < sw.rr, `${inc.rr} vs ${sw.rr}`);
    });

    check('plan credit: a reduction is valued by the reduced dose; an unchanged drug by its current dose; the breakdown names the drugs valued as titrated', () => {
        const q = patient([entry('Lisinopril', 20), entry('Spironolactone', 50)]);
        const cur = q.current_regimen;
        const down = entry('Spironolactone', 25);
        const pc = plan([{ action: 'titrate_down', source: cur[1], target: down, summary: 'x' }], [cur[0], down], q);
        assert.equal(pc.creditFn(cur[0], q), 1);                 // lisinopril 20: at the anchor
        assert.ok(pc.creditFn(down, q) < 1 && pc.titrated.length === 0);
        const out = run(patient([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)]));
        const adds = out.scoredRegimens.find(r => changes(r).some(m => m.action === 'add'));
        assert.ok(adds);
        const detail = adds!.score_breakdown!.domains.find(d => d.key === 'mortality')!.detail!;
        const started = changes(adds!).filter(m => m.action === 'add').map(m => m.target!.med.name);
        assert.ok(detail.includes('titrated to the trial-achieved dose') && started.every(n => detail.includes(n)), detail);
    });

    // ---------------- side-effect scale ----------------
    check('side-effect score = max(0, 100 - burden / 2); no displayed option scores exactly 0; the largest burden seen is printed', () => {
        assert.equal(SIDE_EFFECT_BURDEN_DIVISOR, 2);
        assert.equal(sideEffectScore(0), 100); assert.equal(sideEffectScore(100), 50); assert.equal(sideEffectScore(300), 0);
        let maxBurden = 0, zeros = 0, n = 0;
        for (const sc of SCENARIOS) for (const r of run(sc.patient).scoredRegimens) {
            n++; maxBurden = Math.max(maxBurden, r.harm_burden!.burden);
            if (r.score_breakdown!.domains.find(d => d.key === 'side_effects')!.score === 0) zeros++;
        }
        console.log(`  side-effect scale: largest burden among ${n} displayed options is ${maxBurden.toFixed(1)}`);
        assert.equal(zeros, 0, `${zeros} displayed options score exactly 0`);
    });

    // ---------------- generator ----------------
    check("candidate generator: pairs choose among every drug of a class ('Jane Smith' has an eplerenone + dapagliflozin candidate)", () => {
        const sc = SCENARIOS.find(s => s.title === 'Jane Smith (Dry & Cold)')!;
        const p = clonePatientForTest(sc.patient);
        const alerts: string[] = [];
        const audit = auditInputs(p, alerts); raiseClinicalAlerts(p, audit.dataAudit, alerts);
        const eligible = runEligibilityStage(p, audit.dataAudit.unknownRenal, NAMES, alerts);
        const tiers = eligible.formulary.flatMap(m => getDoseTiers(m, p));
        const analysis = analyzeCurrentRegimen(p, eligible.formulary, tiers, eligible.allBBExcluded);
        const cands = generateCandidateModifications(analysis, p);
        const adds = (c: ModificationSet) => c.modifications.filter(m => m.action === 'add').map(m => m.target!.med.name);
        assert.ok(cands.some(c => adds(c).includes('Eplerenone') && adds(c).includes('Dapagliflozin')), 'eplerenone + dapagliflozin');
        assert.ok(cands.some(c => adds(c).includes('Spironolactone') && adds(c).includes('Empagliflozin')), 'spironolactone + empagliflozin');
    });

    // ---------------- loop diuretics in congestion (2026-11-16 round 3) ----------------
    const congested = (regimen: RegimenMed[] = [], kg = 3): Patient => { const q = patient(regimen); q.volume_status = { dry_weight_kg: 80, current_weight_kg: 80 + kg, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) }; return q; };
    const euvolemic = (regimen: RegimenMed[] = []): Patient => patient(regimen);
    const hasLoopStart = (r: ScoredRegimen) => changes(r).some(m => (m.action === 'add' || m.action === 'titrate_up') && m.target?.med.drug_class === 'Loop Diuretic');

    check('loop evidence rows: congested and other rows per band and outcome, with the Cochrane figures, bases and the ruling date; populationKeyFor follows the engine congestion predicate', () => {
        const loops = OUTCOME_EVIDENCE_TABLE.filter(r => r.drug_class === 'Loop Diuretic');
        assert.equal(loops.length, 12);
        for (const r of loops) {
            if (r.population_key === 'congested') {
                near(r.rr, r.outcome === 'all_cause_death' ? 0.24 : 0.07, 1e-12); assert.equal(r.measure, 'OR');
                near(r.ci_low!, r.outcome === 'all_cause_death' ? 0.07 : 0.01, 1e-12); near(r.ci_high!, r.outcome === 'all_cause_death' ? 0.83 : 0.52, 1e-12);
                assert.equal(r.basis, r.ef_band === 'reduced' ? 'meta_analysis' : 'extrapolated', r.id);
                assert.ok(r.notes.includes('2026-11-16') && r.notes.includes('1980s-90s') && r.notes.includes('fluid retention') && r.notes.includes('TRANSFORM-HF'), r.id);
            } else {
                assert.equal(r.population_key, 'other'); assert.equal(r.rr, 1); assert.equal(r.basis, 'assumed_neutral'); assert.equal(r.ci_low, null);
            }
        }
        const loop = MEDICATION_FORMULARY.find(m => m.drug_class === 'Loop Diuretic')!;
        assert.equal(populationKeyFor(loop, congested()), 'congested');
        assert.equal(populationKeyFor(loop, euvolemic()), 'other');
        const heavy = euvolemic(); heavy.volume_status.exam_findings = new Set(['Edema (2+)']);        // findings alone are congestion
        assert.equal(populationKeyFor(loop, heavy), 'congested');
        const wt = euvolemic(); wt.volume_status = { dry_weight_kg: 80, current_weight_kg: 82, exam_findings: new Set() };   // weight alone is congestion
        assert.equal(populationKeyFor(loop, wt), 'congested');
    });

    check('loops (a): a congested, loop-naive patient has a loop start in the lead', () => {
        const out = run(congested([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200), entry('Spironolactone', 50), entry('Dapagliflozin', 10)]));
        assert.ok(out.scoredRegimens.length > 0 && hasLoopStart(out.scoredRegimens[0]), changes(out.scoredRegimens[0]).map(m => m.summary).join(' | '));
    });

    check('loops (b): a loop increase is displayed for a congested patient on a loop below its maximum', () => {
        const out = run(congested([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200), entry('Furosemide', 40)]));
        assert.ok(out.scoredRegimens.some(r => changes(r).some(m => m.action === 'titrate_up' && m.target?.med.drug_class === 'Loop Diuretic')), 'a loop increase is displayed');
    });

    check('loops (c): without congestion findings the loop contributes RR 1.0 and no loop start leads', () => {
        const p = euvolemic([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200), entry('Furosemide', 40)]);
        for (const o of ['all_cause_death', 'hf_hospitalization'] as const) {
            const e = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, [entry('Furosemide', 40)], p, o, populationKeyFor);
            assert.equal(e.rr, 1);
        }
        const naive = run(euvolemic([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200), entry('Spironolactone', 50), entry('Dapagliflozin', 10)]));
        assert.ok(!hasLoopStart(naive.scoredRegimens[0]));
    });

    check('loops (d): removing the loop in a congested patient scores below keeping it', () => {
        const p = congested([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200), entry('Furosemide', 40)]);
        const alerts: string[] = [];
        const audit = auditInputs(p, alerts); const flags = raiseClinicalAlerts(p, audit.dataAudit, alerts);
        const eligible = runEligibilityStage(p, audit.dataAudit.unknownRenal, NAMES, alerts);
        const tiers = eligible.formulary.flatMap(m => getDoseTiers(m, p));
        const analysis = analyzeCurrentRegimen(p, eligible.formulary, tiers, eligible.allBBExcluded);
        const ctx = buildScoringContext(p, PRICES, eligible.intolerancePolicy, audit.dataAudit, eligible.formulary, tiers, analysis, flags);
        const cur = p.current_regimen;
        const [kept, removed] = scoreCandidates([{ modifications: [], resulting_regimen: cur }, { modifications: [{ action: 'remove', source: cur[2], summary: 'x' }], resulting_regimen: [cur[0], cur[1]] }], ctx);
        const m = (r: ScoredRegimen) => r.score_breakdown!.domains.find(d => d.key === 'mortality')!.score;
        // A loop has no measured dose relation (credit 1 at any dose), so keeping it in a congested patient must score above removing it: death domain AND total raw score.
        assert.ok(m(kept) > m(removed), `death domain ${m(kept)} vs ${m(removed)}`);
        assert.ok(kept.raw_score! > removed.raw_score!, `raw ${kept.raw_score} vs ${removed.raw_score}`);
    });

    check('loops: no measured dose relation: credit 1 at any dose (started, increased, unchanged or reduced) and the detail says so; Furoscix beside an oral loop is one contributor', () => {
        const p = congested([entry('Furosemide', 40)]);
        const fz = entry('Furoscix (SC Furosemide)', MEDICATION_FORMULARY.find(m => m.name === 'Furoscix (SC Furosemide)')!.available_doses[0].strength);
        const set: ModificationSet = { modifications: [{ action: 'add', target: fz, summary: 'x' }], resulting_regimen: [...p.current_regimen, fz] };
        const pc = planCreditsFor(set, p);
        assert.equal(pc.creditFn(fz, p), 1);
        const e = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, set.resulting_regimen, p, 'hf_hospitalization', populationKeyFor, pc.creditFn);
        assert.equal(e.contributors.filter(c => c.drug_class === 'Loop Diuretic').length, 1);
        assert.equal(e.not_counted.length, 1);
        for (const dose of MEDICATION_FORMULARY.find(m => m.name === 'Furosemide')!.available_doses) assert.equal(outcomeDoseCredit(entry('Furosemide', dose.strength), p), 1, `furosemide ${dose.strength}`);
        const lower = planCreditsFor({ modifications: [{ action: 'titrate_down', source: entry('Furosemide', 80), target: entry('Furosemide', 20), summary: 'x' }], resulting_regimen: [entry('Furosemide', 20)] } as ModificationSet, p);
        assert.equal(lower.creditFn(entry('Furosemide', 20), p), 1);
        const none = planCreditsFor({ modifications: [{ action: 'remove', source: p.current_regimen[0], summary: 'x' }], resulting_regimen: [] } as ModificationSet, p);
        assert.deepEqual(regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, [], p, 'hf_hospitalization', populationKeyFor, none.creditFn).contributors, []);
        const out = run(p);
        const details = out.scoredRegimens.map(r => r.score_breakdown!.domains.find(d => d.key === 'hf_hospitalization')!.detail!);
        assert.ok(details.some(t => /dose relation not measured/i.test(t)), details[0]);
        assert.ok(!details.some(t => /still congested on the current dose/i.test(t)), 'the c0 text is gone');
    });

    // ---------------- renal-maximum reason on every forced reduction ----------------
    check('every drug with a renal maximum: a displayed or scored single reduction to the maximum carries the renal-maximum reason', () => {
        let drugs = 0;
        for (const med of MEDICATION_FORMULARY) {
            if (!med.renal_adjustment) continue;
            for (const egfr of [15, 25, 35, 45]) {
                const q = patient(); q.egfr = egfr; q.creatinine = egfr < 30 ? 3.0 : 1.8;
                const cap = med.renal_adjustment(egfr, q).max_dose;
                if (cap === undefined) continue;
                const above = med.available_doses.filter(d => Number(d.strength) > cap).at(-1);
                if (!above) continue;
                const cur = { med, dose: above, selected_frequency: above.frequency_options[0] } as RegimenMed;
                q.current_regimen = [{ ...cur, exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } }];
                const reductions = scoredCandidates(q).flatMap(r => changes(r).filter(m => m.action === 'titrate_down' && m.source?.med.name === med.name));
                if (reductions.length === 0) continue;
                drugs++;
                for (const m of reductions) assert.ok(/renal maximum|above the maximum/.test(m.summary), `${med.name} eGFR ${egfr}: ${m.summary}`);
            }
        }
        assert.ok(drugs > 0, 'at least one drug with a renal maximum was exercised');
        const rp = SCENARIOS.find(s => s.title === 'Final-Gaps Ramipril 5 mg bid eGFR 40 Exceeds Renal Cap')!;
        const reds = run(rp.patient).scoredRegimens.flatMap(r => changes(r).filter(m => m.action === 'titrate_down' && m.source?.med.name === 'Ramipril'));
        assert.ok(reds.length > 0 && reds.every(m => /renal maximum/.test(m.summary)), reds.map(m => m.summary).join(' | '));
    });

    // ---------------- congestion coverage over any diuretic intensification ----------------
    check('congestion coverage: a congested patient whose loop cannot increase still shows a diuretic intensification (Furoscix or thiazide-like) when one exists', () => {
        const sc = SCENARIOS.find(s => s.title === 'Diuretic-Source Bumetanide eGFR 15 Never Above 10 mg Daily')!;
        const out = run(sc.patient);
        const diuretic = (r: ScoredRegimen) => changes(r).some(m => (m.action === 'add' || m.action === 'titrate_up') && (m.target?.med.drug_class === 'Loop Diuretic' || m.target?.med.drug_class === 'Thiazide-like Diuretic'));
        assert.ok(out.scoredRegimens.some(diuretic), out.scoredRegimens.map(r => changes(r).map(m => m.summary.slice(0, 40)).join('/')).join(' || '));
    });

    // ---------------- swap + add and adjunct + pillar builders over every drug ----------------
    check('generator: adjunct + pillar and swap + pillar candidates are built over every drug of the pillar (eplerenone as well as spironolactone)', () => {
        const adds = (c: ModificationSet) => c.modifications.filter(m => m.action === 'add').map(m => m.target!.med.name);
        const candidatesFor = (p: Patient) => {
            const alerts: string[] = [];
            const audit = auditInputs(p, alerts); raiseClinicalAlerts(p, audit.dataAudit, alerts);
            const eligible = runEligibilityStage(p, audit.dataAudit.unknownRenal, NAMES, alerts);
            const tiers = eligible.formulary.flatMap(m => getDoseTiers(m, p));
            return generateCandidateModifications(analyzeCurrentRegimen(p, eligible.formulary, tiers, eligible.allBBExcluded), p);
        };
        const aa = clonePatientForTest(SCENARIOS.find(s => s.title === 'African American (A-HeFT Indication)')!.patient);
        const c1 = candidatesFor(aa);
        assert.ok(c1.some(c => adds(c).includes('Eplerenone') && adds(c).includes('Hydralazine/Isosorbide Dinitrate')), 'adjunct + eplerenone');
        assert.ok(c1.some(c => adds(c).includes('Spironolactone') && adds(c).includes('Hydralazine/Isosorbide Dinitrate')), 'adjunct + spironolactone');
        const sw = patient([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)]); sw.allergies = new Set(['Lisinopril']);
        const c2 = candidatesFor(sw);
        const withSwap = c2.filter(c => c.modifications.some(m => m.action === 'swap') && c.modifications.some(m => m.action === 'add'));
        assert.ok(withSwap.some(c => adds(c).includes('Eplerenone')) && withSwap.some(c => adds(c).includes('Spironolactone')), `swap + add candidates: ${withSwap.map(adds).join(' ; ')}`);
    });

    // ---------------- precision-weighted estimates (2026-11-16 round 4) ----------------
    const lnSe = (lo: number, hi: number) => (Math.log(hi) - Math.log(lo)) / 3.92;
    const dedupeKey = (r: OutcomeEvidenceRow) => `${r.rr}|${r.ci_low}|${r.ci_high}`;
    // DerSimonian-Laird moment estimator centred on no effect, written independently of the engine: w = 1/se^2, Q = sum(w x^2), C = sum(w) - sum(w^2)/sum(w), tau2 = max(0, (Q - k) / C).
    const dl = (items: { x: number; se: number }[]) => {
        const w = items.map(i => 1 / (i.se * i.se)), sw = w.reduce((a, b) => a + b, 0), sw2 = w.reduce((a, b) => a + b * b, 0);
        const Q = items.reduce((a, i, j) => a + w[j] * i.x * i.x, 0), C = sw - sw2 / sw;
        return Math.max(0, (Q - items.length) / C);
    };
    const fileTau2 = (rows: OutcomeEvidenceRow[]) => {
        const seen = new Set<string>(), items: { x: number; se: number }[] = [];
        for (const r of rows) {
            if (!(r.basis === 'trial' || r.basis === 'meta_analysis') || r.ci_low === null || r.ci_high === null || seen.has(dedupeKey(r))) continue;
            seen.add(dedupeKey(r)); items.push({ x: Math.log(r.rr), se: lnSe(r.ci_low, r.ci_high) });
        }
        return dl(items);
    };

    check('tau2 (outcomes) is recomputed from the file, never typed: all rows and without the congested loop rows; the all-rows value is the one used', () => {
        near(OUTCOME_TAU2, fileTau2(OUTCOME_EVIDENCE_TABLE), 1e-12, 'all rows');
        near(OUTCOME_TAU2_EXCL_CONGESTED_LOOP, fileTau2(OUTCOME_EVIDENCE_TABLE.filter(r => r.population_key !== 'congested')), 1e-12, 'without congested loop rows');
        assert.ok(OUTCOME_TAU2 > 0 && OUTCOME_TAU2_EXCL_CONGESTED_LOOP > 0);
        assert.equal(outcomeStats(OUTCOME_EVIDENCE_TABLE).tau2, OUTCOME_TAU2);
        console.log(`  tau2 (outcomes): all rows ${OUTCOME_TAU2.toFixed(4)}; without the congested loop rows ${OUTCOME_TAU2_EXCL_CONGESTED_LOOP.toFixed(4)}`);
    });

    check('shrinkage (b)-(d): ACE inhibitor death barely moves; the congested loop death row equals the formula and lies strictly between published and 1; zero width is unchanged; assumed neutral stays 1', () => {
        const row = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)!;
        const ace = shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, row('acei-reduced-death'));
        assert.ok(Math.abs(ace.rr_used - 0.80) <= 0.02, `ACEi rr_used ${ace.rr_used}`);
        const loop = row('loop-reduced-death-congested');
        const u = shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, loop);
        const se = lnSe(loop.ci_low!, loop.ci_high!), B = OUTCOME_TAU2 / (OUTCOME_TAU2 + se * se);
        near(u.rr_used, Math.exp(B * Math.log(loop.rr)), 1e-12); near(u.B, B, 1e-12); near(u.se_used, Math.sqrt(B) * se, 1e-12);
        assert.ok(u.rr_used > loop.rr && u.rr_used < 1, `${u.rr_used}`);
        const z = shrinkValue(Math.log(0.7), 0, 0.2, 0.1);
        assert.equal(z.used, Math.log(0.7)); assert.equal(z.se_used, 0); assert.equal(z.B, 1); assert.equal(z.imputed, false);
        const neutral = shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, row('loop-reduced-death-other'));
        assert.equal(neutral.rr_used, 1); assert.equal(neutral.se_used, 0);
        // a value without an interval uses the median se of the rows that have one and is flagged
        const synth: OutcomeEvidenceRow = { ...row('acei-reduced-death'), id: 'synthetic', rr: 0.5, ci_low: null, ci_high: null };
        const imp = shrunkOutcomeRow([...OUTCOME_EVIDENCE_TABLE, synth], synth);
        assert.equal(imp.imputed, true); assert.ok(imp.rr_used > 0.5 && imp.rr_used < 1);
        near(tau2From([{ x: 0.3, se: 0.1 }, { x: 0.1, se: 0.1 }]), 0.08, 1e-12);   // w = 100, Q = 10, k = 2, C = 100: (10 - 2) / 100
        assert.equal(tau2From([{ x: 0.01, se: 0.5 }, { x: 0.02, se: 0.5 }]), 0, 'a negative moment estimate is truncated at 0');
    });

    check('shrinkage (e): the regimen interval uses se_used; contributors carry published and used values; the breakdown says when a figure was pulled toward no effect', () => {
        const p = patient();
        const reg = [entry('Lisinopril', 20)];
        const e = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, reg, p, 'all_cause_death', populationKeyFor);
        const row = OUTCOME_EVIDENCE_TABLE.find(r => r.id === 'acei-reduced-death')!;
        const u = shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, row);
        near(e.rr, u.rr_used, 1e-12);
        near(e.ci_low, Math.exp(Math.log(u.rr_used) - 1.96 * u.se_used), 1e-12); near(e.ci_high, Math.exp(Math.log(u.rr_used) + 1.96 * u.se_used), 1e-12);
        const c = e.contributors[0];
        assert.equal(c.rr_published, 0.8); assert.equal(c.ci_low_published, row.ci_low); assert.equal(c.ci_high_published, row.ci_high);
        near(c.rr, u.rr_used, 1e-12); near(c.shrinkage_b, u.B, 1e-12); assert.equal(c.interval_imputed, false);
        const q = congested([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)]);
        const out = run(q);
        const withLoop = out.scoredRegimens.find(r => r.regimen.some(m => m.med.drug_class === 'Loop Diuretic'));
        assert.ok(withLoop);
        const detail = withLoop!.score_breakdown!.domains.find(d => d.key === 'mortality')!.detail!;
        assert.ok(/pulled toward no effect/i.test(detail) && detail.includes('Furosemide') , detail);
        const view = withLoop!.outcome_estimates![0].contributors.find(x => x.drug_class === 'Loop Diuretic')!;
        assert.ok(view.rr_published === 0.24 && view.rr > 0.24 && view.rr < 1 && view.shrinkage_b < 1, JSON.stringify(view));
    });

    check('tau2 (symptoms) is recomputed from the file; used KCCQ points = B x published; contributors carry both; imputed rows are flagged; not measured stays 0', () => {
        const rows = SYMPTOM_TABLE.filter(r => (r.basis === 'trial' || r.basis === 'meta_analysis') && r.ci_low !== null && r.ci_high !== null);
        const seen = new Set<string>(), items: { x: number; se: number }[] = [];
        for (const r of rows) { const k = `${r.kccq_points}|${r.ci_low}|${r.ci_high}`; if (seen.has(k)) continue; seen.add(k); items.push({ x: r.kccq_points, se: (r.ci_high! - r.ci_low!) / 3.92 }); }
        const t2 = dl(items);
        near(SYMPTOM_TAU2, t2, 1e-9);
        console.log(`  tau2 (symptoms, KCCQ points^2): ${SYMPTOM_TAU2.toFixed(3)}`);
        const bb = SYMPTOM_TABLE.find(r => r.id === 'bb-reduced')!;
        const u = shrunkSymptomRow(SYMPTOM_TABLE, bb);
        const se = (bb.ci_high! - bb.ci_low!) / 3.92, B = SYMPTOM_TAU2 / (SYMPTOM_TAU2 + se * se);
        near(u.used, B * bb.kccq_points, 1e-12); near(u.B, B, 1e-12);
        const e = regimenSymptomEstimate(SYMPTOM_TABLE, [entry('Carvedilol', 25, 'bid')], patient());
        near(e.contributors[0].kccq_points_published, bb.kccq_points, 1e-12); near(e.contributors[0].kccq_points, u.used, 1e-12);
        near(e.points, u.used, 1e-12);
        const noInterval = SYMPTOM_TABLE.find(r => r.id === 'mra-reduced')!;
        assert.equal(shrunkSymptomRow(SYMPTOM_TABLE, noInterval).imputed, true);
        assert.equal(shrunkSymptomRow(SYMPTOM_TABLE, SYMPTOM_TABLE.find(r => r.id === 'loop-reduced')!).used, 0);
        assert.ok(symptomStats(SYMPTOM_TABLE).medianSe > 0);
    });

    // ---------------- review fixes (2026-11-16 round 6) ----------------
    const burdenFor = (name: string, dose: number | string, over: Partial<Patient>, freq?: string, table = HARM_TABLE) => {
        const q = Object.assign(patient(), over);
        return harmBurdenFor(table, [entry(name, dose, freq)], q);
    };
    check('unknown values never make a drug look safer: blank sex is charged as the larger of the male and female burdens (dapagliflozin, spironolactone), each line flagged', () => {
        for (const [n, d] of [['Dapagliflozin', 10], ['Spironolactone', 25]] as [string, number][]) {
            const m = burdenFor(n, d, { sex: 'Male' }).burden, f = burdenFor(n, d, { sex: 'Female' }).burden;
            for (const blank of ['', undefined as unknown as string]) {
                const u = burdenFor(n, d, { sex: blank as Patient['sex'] });
                near(u.burden, Math.max(m, f), 1e-9, `${n} blank`);
                assert.ok(u.burden >= Math.min(m, f));
                assert.ok(u.lines.some(l => l.kind === 'harm' && l.assumed_because_unknown === 'sex'), `${n}: a line carries assumed_because_unknown 'sex'`);
                assert.ok(u.unknown_assumptions.some(a => a.field === 'sex' && /sex not recorded: charged as the higher-risk case/.test(a.text)), n);
            }
        }
    });

    check('unknown race applies the angioedema multipliers (ratio above 1) and is flagged; unknown age applies the age-75 multipliers', () => {
        const black = burdenFor('Lisinopril', 20, { race: 'Black' }), blank = burdenFor('Lisinopril', 20, { race: '' as Patient['race'] });
        const white = burdenFor('Lisinopril', 20, { race: 'White' });
        near(blank.burden, black.burden, 1e-9); assert.ok(blank.burden > white.burden);
        const line = blank.lines.find(l => l.kind === 'harm' && l.effect === 'angioedema')!;
        assert.ok(line.kind === 'harm' && line.multipliers.some(m => m.id === 'M-black-angioedema-ACEi' && m.assumed_because_unknown === 'race'));
        assert.ok(blank.unknown_assumptions.some(a => a.field === 'race' && a.applied === true));
        const old = burdenFor('Lisinopril', 20, { age: 80 }), noAge = burdenFor('Lisinopril', 20, { age: undefined as unknown as number });
        near(noAge.burden, old.burden, 1e-9);
    });

    check('a multiplier below 1 is not applied when its condition cannot be evaluated; one above 1 is', () => {
        const base = { source: { trial: 't', citation: 'c' }, quote: '', notes: '', level: 'class' as const, applies_to_classes: ['ACEi'], effect: 'hyperkalemia' };
        const table = { rows: HARM_TABLE.rows, multipliers: [...HARM_TABLE.multipliers, { ...base, id: 'syn-low', condition: { kind: 'egfr_below' as const, value: 30 }, ratio: 0.5 }, { ...base, id: 'syn-high', condition: { kind: 'egfr_below' as const, value: 30 }, ratio: 2 }] };
        const unknown = burdenFor('Lisinopril', 20, { egfr: 0 }, undefined, table);
        const hk = unknown.lines.find(l => l.kind === 'harm' && l.effect === 'hyperkalemia')!;
        assert.ok(hk.kind === 'harm' && hk.multipliers.some(m => m.id === 'syn-high') && !hk.multipliers.some(m => m.id === 'syn-low'));
        const low = unknown.unknown_assumptions.find(a => a.multiplier_id === 'syn-low')!, high = unknown.unknown_assumptions.find(a => a.multiplier_id === 'syn-high')!;
        assert.equal(low.applied, false); assert.equal(high.applied, true);
        const known = burdenFor('Lisinopril', 20, { egfr: 70 }, undefined, table);
        assert.equal(known.unknown_assumptions.length, 0, 'known values: nothing assumed');
    });

    check('harm table validation runs once per table, not on every call', () => {
        const t = { rows: [...HARM_TABLE.rows], multipliers: [...HARM_TABLE.multipliers] };
        const before = HARM_VALIDATION_RUNS.count;
        burdenFor('Lisinopril', 20, {}, undefined, t); burdenFor('Carvedilol', 25, {}, 'bid', t); burdenFor('Lisinopril', 20, {}, undefined, t);
        assert.equal(HARM_VALIDATION_RUNS.count - before, 1);
    });

    check('every dose anchor lies, in the formulary unit of its drug, between that drug\'s lowest and highest available daily dose; every anchor has a unit', () => {
        for (const a of DOSE_EVIDENCE.anchors as unknown as { id: string; drug: string; full_credit_daily_mg: number | null; unit?: string }[]) {
            const med = MEDICATION_FORMULARY.find(m => m.name === a.drug)!;
            assert.ok(med, a.drug);
            assert.equal(a.unit, med.available_doses[0].unit, `${a.id} unit`);
            if (a.full_credit_daily_mg === null) continue;
            const daily = med.available_doses.flatMap(d => d.frequency_options.map(f => numericStrength(med, d.strength) * dosesPerDay(f)));
            assert.ok(a.full_credit_daily_mg >= Math.min(...daily) && a.full_credit_daily_mg <= Math.max(...daily), `${a.id}: ${a.full_credit_daily_mg} ${a.unit} outside ${Math.min(...daily)}-${Math.max(...daily)}`);
        }
        const p = patient();
        const dig = MEDICATION_FORMULARY.find(m => m.name === 'Digoxin')!;
        const startEntry = entry('Digoxin', Number(dig.start_dose_for ? dig.start_dose_for(p) : dig.available_doses[0].strength));
        assert.ok(outcomeDoseCredit(startEntry, p) < 1, 'the digoxin starting dose is below the anchor');
        near(outcomeDoseCredit(startEntry, p), c0, 1e-9);
        assert.equal(outcomeDoseCredit(entry('Digoxin', 125), p), 1);
    });

    return { passed, failed };
}

// Raw assertion helper so a stand-alone run prints a result.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = runMeasuredModelChecks(); console.log(r); process.exitCode = r.failed ? 1 : 0;
}
