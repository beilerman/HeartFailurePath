/**
 * Checks for the three measured models wired into the score (2026-11-16): trial-achieved dose anchors, symptoms (KCCQ points) and side effects
 * (measured harm rates), the weight rule, retired special-feature points, congestion coverage and label-start new starts. Written test-first.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { RULESET_VERSION } from '../services/rulesetVersion';
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
import { evidenceFor, describeOutcomeEstimate, regimenOutcomeEstimate, compareOutcomeEstimate, OUTCOME_EVIDENCE_TABLE, populationKeyFor } from '../services/engine/outcomeBenefit';
import { auditInputs, raiseClinicalAlerts } from '../services/engine/gates';
import { runEligibilityStage } from '../services/engine/eligibility';
import { analyzeCurrentRegimen, generateCandidateModifications } from '../services/engine/candidates';
import { getDoseTiers, numericStrength, dosesPerDay, startingDailyDose } from '../services/engine/regimenUtils';
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
        assert.equal(f.start_dose_credit.basis, 'estimated from two randomized dose comparisons (ATLAS for lisinopril, HEAAL for losartan) with large uncertainty; carried to every other class');   // E11: "measured" overstated it
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
        near(credit('Spironolactone', 25), 25 / 26, 1e-9, 'spiro at start: the C2 floor (RALES dose 26 mg) replaces the curve value c0');
        near(credit('Spironolactone', 12.5), 12.5 / 26, 1e-9, 'spiro below start: the C2 floor');
        assert.equal(credit('Spironolactone', 50), 1);
        near(credit('Eplerenone', 25), 25 / 42, 1e-9, 'eplerenone eGFR 70 (anchor 42): the C2 floor');
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

    // Rewritten 2026-11-18 (change C1): the old check asserted that every start earns credit 1. A start now earns the credit of the highest dose this patient may be given (kidney, interaction and maximum-dose rules).
    check('plan credit (a, rewritten for C1): at eGFR 40 adding spironolactone (kidney limit 25 mg) earns the credit of 25 mg, adding eplerenone (its trial dose at eGFR below 50 is 25 mg) earns 1', () => {
        const q = low(), sp = entry('Spironolactone', 12.5), ep = entry('Eplerenone', 25);
        for (const o of ['all_cause_death', 'hf_hospitalization'] as const) {
            const a = rrPlanned([{ action: 'add', target: sp, summary: 'x' }], [sp], q, o), b = rrPlanned([{ action: 'add', target: ep, summary: 'x' }], [ep], q, o);
            near(a.contributors[0].credit, outcomeDoseCredit(entry('Spironolactone', 25), q), 1e-12, `${o} spironolactone`);
            assert.equal(b.contributors[0].credit, 1, `${o} eplerenone`);
        }
    });

    check('plan credit (b, rewritten for C1): increasing carvedilol 3.125 to 6.25 bid scores above no change; an increase is valued at the NEW dose, so as_planned equals as_prescribed and both are a smaller benefit than the full-dose (at_target) value', () => {
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
            assert.equal(o.as_planned.rr, o.as_prescribed.rr, `${o.outcome} an increase is valued at the new dose`);
            assert.ok(o.as_prescribed.rr > o.at_target.rr, `${o.outcome}`);
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
        assert.ok(detail.includes('New drugs valued as titrated') && started.every(n => detail.includes(n)), detail);   // rewritten for C1: the wording names starts only
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
        p.volume_status.exam_findings.delete('Cool Extremities'); // the cold state (S1a, 2026-11-19) builds no start at all; this check is about the generator for a patient who is not cold
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
                assert.equal(r.population_key, 'other'); assert.equal(r.rr, 1); assert.equal(r.basis, 'no_outcome_evidence'); assert.equal(r.ci_low, null); assert.equal(r.quote, ''); assert.equal(r.verification, 'n/a');   // E4, E8: no benefit sentence quoted as support for no effect
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
        // This fixture meets the engine's acute-decompensation predicate (NYHA III, 3 kg over, three findings); since S1b (2026-11-19) every option then carries a loop step, which leaves no room
        // for a pillar plus an adjunct under the two-class limit. The check is about the generator for a patient who is not decompensated.
        aa.volume_status.exam_findings = new Set(['Edema (1+)']);
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
    // C3: two different trials with identical numbers are two rows, so the key includes the source and the drug class (a copy of ONE row across bands or drugs still counts once). Separate priors for death and for hospitalization.
    // Third pass: a row is distinct by its SOURCE and numbers, not by drug class, so the MRA pool and its nsMRA copy count once while two different trials with identical numbers count twice.
    const dedupeKey = (r: OutcomeEvidenceRow) => `${r.rr}|${r.ci_low}|${r.ci_high}|${r.source.trial}|${r.source.citation}`;
    // Moment estimator of the between-row variance of true effects about NO EFFECT, written independently of the engine (controller ruling 2026-11-19, round 1 review, E13): w = 1/se^2, Q = sum(w x^2),
    // tau2 = max(0, (Q - k) / sum(w)). For a Q centred on zero the divisor is the sum of the weights; the mean-centred DerSimonian-Laird quantity sum(w) - sum(w^2)/sum(w) belongs to a Q centred on the weighted mean.
    const dl = (items: { x: number; se: number }[]) => {
        const w = items.map(i => 1 / (i.se * i.se)), sw = w.reduce((a, b) => a + b, 0);
        const Q = items.reduce((a, i, j) => a + w[j] * i.x * i.x, 0);
        return Math.max(0, (Q - items.length) / sw);
    };
    const fileTau2 = (rows: OutcomeEvidenceRow[], outcome: 'all_cause_death' | 'hf_hospitalization') => {
        const seen = new Set<string>(), items: { x: number; se: number }[] = [];
        for (const r of rows) {
            if (r.outcome !== outcome || !(r.basis === 'trial' || r.basis === 'meta_analysis' || r.basis === 'subgroup') || r.ci_low === null || r.ci_high === null || seen.has(dedupeKey(r))) continue;
            seen.add(dedupeKey(r)); items.push({ x: Math.log(r.rr), se: lnSe(r.ci_low, r.ci_high) });
        }
        return dl(items);
    };

    check('tau2 (outcomes, C3): separate priors for death and for hospitalization, each recomputed from the file (measured rows of that outcome, the DerSimonian-Laird estimator centred on no effect); the all-rows values are the ones used', () => {
        for (const o of ['all_cause_death', 'hf_hospitalization'] as const) {
            near(OUTCOME_TAU2[o], fileTau2(OUTCOME_EVIDENCE_TABLE, o), 1e-12, `${o} all rows`);
            near(OUTCOME_TAU2_EXCL_CONGESTED_LOOP[o], fileTau2(OUTCOME_EVIDENCE_TABLE.filter(r => r.population_key !== 'congested'), o), 1e-12, `${o} without congested loop rows`);
            assert.ok(OUTCOME_TAU2[o] > 0 && OUTCOME_TAU2_EXCL_CONGESTED_LOOP[o] > 0);
            assert.equal(outcomeStats(OUTCOME_EVIDENCE_TABLE).tau2[o], OUTCOME_TAU2[o]);
        }
        console.log(`  tau2 (outcomes): death ${OUTCOME_TAU2.all_cause_death.toFixed(4)}, hospitalization ${OUTCOME_TAU2.hf_hospitalization.toFixed(4)}; without the congested loop rows ${OUTCOME_TAU2_EXCL_CONGESTED_LOOP.all_cause_death.toFixed(4)} / ${OUTCOME_TAU2_EXCL_CONGESTED_LOOP.hf_hospitalization.toFixed(4)}`);
    });

    check('tau2 (C3): two different trials with identical numbers count as two rows; one row copied across bands counts once; one source copied across drug classes (MRA pool and its nsMRA copy) counts once', () => {
        const base = OUTCOME_EVIDENCE_TABLE.find(r => r.id === 'acei-reduced-death')!;
        const A: OutcomeEvidenceRow = { ...base, id: 'a', rr: 0.5, ci_low: 0.4, ci_high: 0.625, basis: 'trial', source: { ...base.source, trial: 'T1', citation: 'C1' }, drug_class: 'X1', ef_band: 'reduced' };
        const B: OutcomeEvidenceRow = { ...A, id: 'b', rr: 1.0, ci_low: 0.8, ci_high: 1.25, source: { ...base.source, trial: 'T2', citation: 'C2' }, drug_class: 'X2' };
        const copySame: OutcomeEvidenceRow = { ...A, id: 'c', ef_band: 'preserved' };
        const copyOtherClass: OutcomeEvidenceRow = { ...A, id: 'd', drug_class: 'X3' };
        const otherTrial: OutcomeEvidenceRow = { ...A, id: 'e', source: { ...base.source, trial: 'T3', citation: 'C3' }, drug_class: 'X3' };
        const t = (rows: OutcomeEvidenceRow[]) => outcomeStats(rows).tau2.all_cause_death;
        near(t([A, B, copySame]), t([A, B]), 1e-12, 'a copy of one row counts once');
        near(t([A, B, copyOtherClass]), t([A, B]), 1e-12, 'the same source in another drug class counts once');
        assert.ok(Math.abs(t([A, B, otherTrial]) - t([A, B])) > 1e-6, 'a different trial with identical numbers must count');
        // the real table: the nsMRA copies of the MRA pool and the SGLT2i copies are not counted again
        const mra = OUTCOME_EVIDENCE_TABLE.filter(r => r.basis !== 'extrapolated' && r.source.trial.startsWith('MRA IPD meta-analysis') && r.ci_low !== null);
        assert.ok(new Set(mra.map(r => r.drug_class)).size >= 2, 'the table holds the MRA pool under two classes');
    });

    check('shrinkage (b)-(d): ACE inhibitor death barely moves; the congested loop death row equals the formula and lies strictly between published and 1; zero width is unchanged; assumed neutral stays 1', () => {
        const row = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)!;
        const ace = shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, row('acei-reduced-death'));
        assert.ok(Math.abs(ace.rr_used - 0.80) <= 0.02, `ACEi rr_used ${ace.rr_used}`);
        const loop = row('loop-reduced-death-congested');
        const u = shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, loop);
        const se = lnSe(loop.ci_low!, loop.ci_high!), B = OUTCOME_TAU2.all_cause_death / (OUTCOME_TAU2.all_cause_death + se * se);
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
        near(tau2From([{ x: 0.3, se: 0.1 }, { x: 0.1, se: 0.1 }]), 0.04, 1e-12);   // w = 100 each, Q = 100 x 0.09 + 100 x 0.01 = 10, k = 2, sum(w) = 200: (10 - 2) / 200 (E13: the divisor is the sum of the weights)
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
        near(outcomeDoseCredit(startEntry, p), Math.max(c0, numericDailyDose(startEntry) / 125), 1e-9);   // C2: the digoxin trial dose (125) is its own, so the floor applies
        assert.equal(outcomeDoseCredit(entry('Digoxin', 125), p), 1);
    });

    // ================= OWNER-DECISION PACKAGE, rule set 2026-11-18.1 (controller recommendations; owner instruction 2026-11-18: "implement the recommended changes and run them as one package") =================
    // C5. Extrapolated rows.
    type OutcomeRowX = OutcomeEvidenceRow & { derivation?: { kind: string; source_row: string; slope?: number; slope_ci?: number[]; slope_se?: number } };
    const orow = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)! as OutcomeRowX;
    // Slope of the higher band's log relative risk on the reduced-EF log relative risk, through the origin, over EVERY class the table measures in more than one band (change C5, third pass).
    // A pair is a class's measured reduced-EF row with one of its measured higher-band rows (mildly reduced, preserved) of the same outcome; identical copies across the two higher bands, or across classes
    // (the nsMRA copy of the MRA pool), count once. Weight 1 / se^2 of the higher-band row; the interval is inflated by sqrt(Q / df) when Q exceeds its degrees of freedom. Written independently of the script.
    const bandSlope = (outcome: 'all_cause_death' | 'hf_hospitalization') => {
        const measured = (r?: OutcomeEvidenceRow) => !!r && (r.basis === 'trial' || r.basis === 'meta_analysis' || r.basis === 'subgroup') && r.ci_low !== null;
        const get = (c: string, b: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.drug_class === c && r.outcome === outcome && r.ef_band === b && (r.population_key === undefined || r.population_key === 'other'));   // the pooled three-trial beta-blocker row is the measured reduced-EF figure (E1: it serves sinus and other rhythms again)
        const seen = new Set<string>(), pairs: { xr: number; xp: number; se: number }[] = [];
        for (const c of new Set(OUTCOME_EVIDENCE_TABLE.map(r => r.drug_class))) {
            const a = get(c, 'reduced'); if (!measured(a)) continue;
            for (const band of ['mildly_reduced', 'preserved']) {
                const b = get(c, band); if (!measured(b)) continue;
                const key = `${Math.log(a!.rr).toFixed(6)}|${Math.log(b!.rr).toFixed(6)}|${lnSe(b!.ci_low!, b!.ci_high!).toFixed(6)}`;
                if (seen.has(key)) continue;
                seen.add(key); pairs.push({ xr: Math.log(a!.rr), xp: Math.log(b!.rr), se: lnSe(b!.ci_low!, b!.ci_high!) });
            }
        }
        const w = pairs.map(q => 1 / q.se ** 2), sxx = pairs.reduce((a, q, i) => a + w[i] * q.xr ** 2, 0), sxy = pairs.reduce((a, q, i) => a + w[i] * q.xr * q.xp, 0);
        const slope = sxy / sxx, se = 1 / Math.sqrt(sxx), Q = pairs.reduce((a, q, i) => a + w[i] * (q.xp - slope * q.xr) ** 2, 0), df = pairs.length - 1;
        const infl = Math.sqrt(Math.max(1, Q / df)), seEff = se * infl;
        // E10 (controller ruling 2026-11-19): the between-class variance of the per-pair slopes (DerSimonian-Laird on s = xp / xr, weight 1 / (se / xr)^2)
        const sv = pairs.map(q => (q.se / q.xr) ** 2), swv = sv.map(x => 1 / x), sw = swv.reduce((a, b) => a + b, 0), C = sw - swv.reduce((a, b) => a + b * b, 0) / sw, tau2 = C > 0 ? Math.max(0, (Q - df) / C) : 0;
        return { n: pairs.length, slope, seEff, tau2 };
    };
    const T975: Record<number, number> = { 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306 };
    check('C5/E10 IV iron at preserved EF: the slope over all measured two-band pairs (script docs/owner-decisions-2026-11-18/iron_band_slope.py) carries PREDICTION uncertainty for a new class (slope se plus between-class variance, t multiplier) and is never narrower than its source row; the stored rows are re-computed here', () => {
        const hf = bandSlope('hf_hospitalization'), dth = bandSlope('all_cause_death');
        console.log(`  C5: slopes from ${dth.n + hf.n} pairs: death ${dth.slope.toFixed(3)} (tau2 ${dth.tau2.toFixed(4)}, ${dth.n} pairs), hospitalization ${hf.slope.toFixed(3)} (tau2 ${hf.tau2.toFixed(4)}, ${hf.n} pairs)`);
        assert.equal(dth.n + hf.n, 12);
        for (const [id, srcId, sl] of [['iviron-preserved-death', 'fcm-reduced-death', dth], ['iviron-preserved-hfhosp', 'fcm-reduced-hfhosp', hf]] as [string, string, typeof dth][]) {
            const r = orow(id), srcRow = orow(srcId) as OutcomeRowX & { derivation?: never };
            assert.equal(r.basis, 'extrapolated', id); assert.equal(r.derivation!.source_row, srcId);
            near(r.derivation!.slope!, sl.slope, 0.0006, `${id} stored slope`); near(r.derivation!.slope_se!, sl.seEff, 0.0006, `${id} stored slope se`);
            const s = r.derivation!.slope!, tq = T975[sl.n - 2], se = lnSe(srcRow.ci_low!, srcRow.ci_high!), tau2 = (r.derivation as unknown as { tau2_slope: number }).tau2_slope;
            near(tau2, sl.tau2, 0.0006, `${id} between-class variance`);
            const ln = s * Math.log(srcRow.rr), sd = Math.sqrt((s * se) ** 2 + Math.log(srcRow.rr) ** 2 * (r.derivation!.slope_se! ** 2 + tau2)), hw = Math.max(tq * sd, 1.96 * se);
            near(r.rr, Math.exp(ln), 0.0006, `${id} rr`); near(r.ci_low!, Math.exp(ln - hw), 0.0006, `${id} low`); near(r.ci_high!, Math.exp(ln + hw), 0.0006, `${id} high`);
            assert.ok(Math.log(r.ci_high!) - Math.log(r.ci_low!) >= Math.log(srcRow.ci_high!) - Math.log(srcRow.ci_low!) - 1e-3, `${id}: no more precise than its source`);
            assert.ok(!/Copied from the reduced row/.test(r.notes) && !/no carry-over/.test(r.extrapolation) && !/alternative is neutral/.test(r.extrapolation), `${id} stale wording`);
            assert.ok(/pairs/.test(r.extrapolation) && /includes 0|does not include 0/.test(r.extrapolation) && /prediction/i.test(r.extrapolation), `${id} says what the calculation shows`);
            assert.ok(!/The earlier value \(0\.899, 0\.825 to 0\.98/.test(r.extrapolation) && /replaces the values of 2026-11-18/.test(r.extrapolation), `${id} states the replaced values correctly`);
        }
    });

    check('C5 every outcome row carried unchanged from reduced EF to LVEF 41-49 says so (text only, no extra variance); no other row carries the sentence', () => {
        const SENTENCE = 'Not measured at LVEF 41 to 49. Carried unchanged from reduced EF; the two classes measured in both bands do not contradict this and none supports it.';
        const carried = (r: OutcomeEvidenceRow) => r.ef_band === 'mildly_reduced' && r.basis === 'extrapolated' && OUTCOME_EVIDENCE_TABLE.some(x => x.ef_band === 'reduced' && x.drug_class === r.drug_class && x.outcome === r.outcome && x.population_key === r.population_key
            && x.rr === r.rr && x.ci_low === r.ci_low && x.ci_high === r.ci_high);
        const rows = OUTCOME_EVIDENCE_TABLE.filter(carried);
        assert.ok(rows.length >= 12, `${rows.length} carried rows`);
        for (const r of OUTCOME_EVIDENCE_TABLE) assert.equal(r.extrapolation.includes(SENTENCE), carried(r), `${r.id}`);
        for (const r of rows) assert.ok(r.extrapolation.length > SENTENCE.length, `${r.id}: the earlier extrapolation text is kept`);
        console.log(`  C5: ${rows.length} rows carried unchanged from reduced EF to LVEF 41-49 are labelled`);
    });

    // C6. Weak rows.
    check('C6 ARB health status read from an abstract that does not state it is "not measured"; the ARB row whose source states the result is untouched', () => {
        for (const id of ['arb-mildly_reduced', 'arb-preserved']) {
            const r = SYMPTOM_TABLE.find(x => x.id === id)!;
            assert.equal(r.basis, 'not_measured', id); assert.equal(r.kccq_points, 0); assert.equal(r.ci_low, null); assert.equal(r.ci_high, null);
            assert.equal(shrunkSymptomRow(SYMPTOM_TABLE, r).used, 0);
            assert.ok(/abstract does not state the direction/.test(r.notes), id);
        }
        const red = SYMPTOM_TABLE.find(x => x.id === 'arb-reduced')!;
        assert.equal(red.basis, 'converted'); assert.equal(red.kccq_points, 1.83); assert.equal(red.ci_low, 0.45);   // E3: converted from the Minnesota questionnaire
        const e = regimenSymptomEstimate(SYMPTOM_TABLE, [entry('Losartan', 50)], withEf(55));
        assert.equal(e.contributors[0].not_measured, true); assert.equal(e.points, 0);
    });

    check('E3 (round 1 review): symptom rows are labelled for what they are; the withdrawn -0.4 no longer feeds any row; the Val-HeFT citation names its first author; the word "confirmed" is gone', () => {
        const sym = (id: string) => SYMPTOM_TABLE.find(r => r.id === id)!;
        const doc = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'symptomEvidence.json'), 'utf8')) as { quantity: string; method: string };
        assert.ok(doc.quantity.startsWith('Health status, in KCCQ-equivalent points') && !/KCCQ points\b/.test(doc.quantity.replace('KCCQ-equivalent points', '')), doc.quantity);
        for (const id of ['arni-mildly_reduced', 'arni-preserved']) { const r = sym(id); assert.equal(r.kccq_points, 1.0, id); assert.equal(r.ci_low, 0.0); assert.equal(r.ci_high, 2.1); assert.ok(/valsartan \(active comparator\)/.test(r.comparator) && /p = 0\.051/.test(r.notes) && /Not statistically significant/.test(r.notes), id); assert.ok(!/-0\.4|ARB estimate|plus ARB/.test(JSON.stringify(r)), `${id} stale -0.4`); }
        for (const id of ['acei-mildly_reduced', 'acei-preserved', 'arb-mildly_reduced', 'arb-preserved']) { const r = sym(id); assert.equal(r.basis, 'not_measured', id); assert.equal(r.kccq_points, 0); assert.ok(!/-0\.4|-1\.72|0\.81|-\(0\.4/.test(`${r.instrument} ${r.extrapolation} ${r.notes} ${r.population}`.replace('-0.8 to 1.7', '')), `${id} still describes -0.4: ${r.extrapolation}`); }
        for (const id of ['acei-reduced', 'arb-reduced']) { const r = sym(id); assert.ok(r.source.citation.startsWith('Majani G'), r.source.citation); assert.ok(/Cohn JN/.test(r.source.citation) && !r.source.citation.startsWith('Cohn'), 'Cohn is a later author, not the first'); }
        const converted = SYMPTOM_TABLE.filter(r => /Minnesota/i.test(r.instrument) && r.basis !== 'not_measured');
        assert.ok(converted.length >= 8 && converted.every(r => r.basis === 'converted' || r.basis === 'combined'), converted.map(r => `${r.id}:${r.basis}`).join(' '));
        for (const r of SYMPTOM_TABLE) assert.notEqual(r.verification, 'confirmed', r.id);
        for (const id of ['bb-reduced', 'bb-mildly_reduced', 'bb-preserved']) { const r = sym(id); assert.ok(/NOT statistically significant/.test(r.notes) && /P = 0\.22/.test(r.instrument) && /KCCQ-equivalent/.test(r.instrument), id); }
        assert.equal(sym('arni-reduced').basis, 'combined'); assert.ok(/No trial compared sacubitril\/valsartan with no drug/.test(sym('arni-reduced').comparator));
    });

    // ---------------- ROUND 1 REVIEW (controller ruling 2026-11-19): rows labelled no more strongly than their data ----------------
    check('E4, E5, E8, E9 (round 1 review): evidence bases say what the data are; the rows named by the audit carry the corrected figures, quotes and labels', () => {
        const o = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)! as OutcomeEvidenceRow;
        const basisOf = (id: string) => o(id).basis as string;
        // sodium-glucose cotransporter 2 inhibitor, reduced EF hospitalization: the all-EF five-trial pool is extrapolated, not a reduced-EF pooled analysis
        assert.equal(basisOf('sglt2i-reduced-hfh'), 'extrapolated'); assert.ok(/ALL-EF pool of five trials/.test(o('sglt2i-reduced-hfh').extrapolation));
        // steroidal MRA above LVEF 40: TOPCAT alone (hospitalization from the abstract, death from the ClinicalTrials.gov results entry); finerenone keeps the pool
        for (const id of ['mra-preserved-hfh', 'mra-mildly-reduced-hfh']) { const r = o(id); assert.equal(r.rr, 0.83); assert.equal(r.ci_low, 0.69); assert.equal(r.ci_high, 0.99); assert.equal(r.source.pmid, '24716680'); assert.ok(/206 patients \[12\.0%\] vs\. 245 patients \[14\.2%\]/.test(r.quote), id); assert.ok(/borrows this row as a sibling/.test(r.notes), id); }
        for (const id of ['mra-preserved-death', 'mra-mildly-reduced-death']) { const r = o(id); assert.equal(r.rr, 0.91); assert.equal(r.ci_low, 0.77); assert.equal(r.ci_high, 1.08); assert.ok(/NCT00094302/.test(r.quote) && /252 events over 6,022 patient-years/.test(r.quote), id); assert.equal(r.verification, 'registry_quote'); }
        assert.equal(basisOf('mra-preserved-hfh'), 'trial'); assert.equal(basisOf('mra-mildly-reduced-hfh'), 'extrapolated');
        for (const id of ['nsmra-preserved-death', 'nsmra-mildly-reduced-hfh', 'nsmra-preserved-hfh', 'nsmra-mildly-reduced-death']) { const r = o(id); assert.equal(r.rr, id.endsWith('death') ? 0.94 : 0.82); assert.ok(/9,446 patients, 64% of them on finerenone/.test(r.population) && !/few patients at 40-49|about 8,800/.test(`${r.extrapolation} ${r.population}`), id); }
        assert.ok(/n = 4,400 \(1,663 \+ 2,737\)/.test(o('nsmra-reduced-death').population) && !/about 5,000/.test(o('nsmra-reduced-death').population));
        // ACE inhibitors above LVEF 40: every field says candesartan; the false "no all-cause figure" sentence is gone; Leite is quoted
        for (const id of ['acei-mildly-reduced-death', 'acei-mildly-reduced-hfh']) { const r = o(id); assert.ok(/CANDESARTAN|Candesartan/.test(`${r.source.trial} ${r.population} ${r.quote} ${r.extrapolation}`) && /ARB applied to ACE inhibitors/.test(r.population), id); assert.ok(!/give no all-cause figure/.test(r.extrapolation), id); assert.ok(/This was not observed for CV and all-cause mortality/.test(r.extrapolation + r.notes), id); }
        // post hoc or subgroup rows carry the subgroup basis
        for (const id of ['arb-mildly-reduced-hfh', 'beta-blocker-mildly-reduced-death', 'beta-blocker-reduced-death-afib', 'beta-blocker-mildly-reduced-death-afib', 'digoxin-preserved-death', 'digoxin-preserved-hfhosp']) assert.equal(basisOf(id), 'subgroup', id);
        // sacubitril/valsartan
        for (const id of ['arni-reduced-death', 'arni-reduced-hfh']) assert.equal(basisOf(id), 'indirect_comparison', id);
        assert.ok(/0\.72 \/ 0\.80 = 0\.90, a SMALLER advantage/.test(o('arni-reduced-death').notes) && /0\.84 \(0\.76-0\.93\)/.test(o('arni-reduced-death').notes), 'wrong-direction sentence corrected');
        assert.ok(/0\.51 \/ 0\.67 = 0\.76, a LARGER advantage/.test(o('arni-reduced-hfh').notes) && /0\.79/.test(o('arni-reduced-hfh').notes));
        const ah = o('arni-mildly-reduced-hfh'); assert.equal(ah.rr, 0.6); assert.equal(ah.ci_low, 0.4); assert.equal(ah.ci_high, 0.89); assert.ok(/HR vs\. RASi 0\.83, 95% CI 0\.62-1\.11/.test(ah.quote));
        assert.ok(/WEAKEST CELL/.test(o('arni-mildly-reduced-death').notes));
        assert.equal(o('arni-preserved-death').measure, 'RR');
        // conflicting-evidence and no-outcome-evidence bases
        for (const id of ['glp1-reduced-death', 'glp1-reduced-hfhosp', 'beta-blocker-preserved-death']) assert.equal(basisOf(id), 'conflicting', id);
        const noEv = OUTCOME_EVIDENCE_TABLE.filter(r => r.basis === 'no_outcome_evidence'), neutral = OUTCOME_EVIDENCE_TABLE.filter(r => r.basis === 'assumed_neutral');
        assert.ok(noEv.every(r => r.rr === 1 && r.ci_low === null), 'no-evidence rows are 1.0 with no interval');
        assert.ok(OUTCOME_EVIDENCE_TABLE.filter(r => r.drug_class === 'Loop Diuretic' && r.population_key === 'other').every(r => r.basis === 'no_outcome_evidence'));
        assert.ok(OUTCOME_EVIDENCE_TABLE.filter(r => r.drug_class === 'Thiazide-like Diuretic').every(r => r.basis === 'no_outcome_evidence'));
        assert.ok(OUTCOME_EVIDENCE_TABLE.filter(r => (r.drug_class === 'If Inhibitor' || r.drug_class === 'sGC Stimulator') && r.ef_band === 'preserved').every(r => r.basis === 'no_outcome_evidence'));
        assert.deepEqual(neutral.map(r => r.id).sort(), ['vasodilator-black-preserved-death', 'vasodilator-black-preserved-hfhosp', 'vasodilator-other-preserved-death', 'vasodilator-other-preserved-hfhosp'], '"no outcome trial" is said only where it is true');
        // A-HeFT from the label, vericiguat note, beta-blocker hospitalization quote
        for (const id of ['vasodilator-black-reduced-hfhosp', 'vasodilator-black-mildly_reduced-hfhosp']) { const r = o(id); assert.equal(r.rr, 0.61); assert.equal(r.ci_low, 0.46); assert.equal(r.ci_high, 0.8); assert.ok(/16\.4% 24\.4% 0\.61 \(0\.46, 0\.80\)/.test(r.quote), id); assert.ok(!/wider than the published P=0\.001 implies, so conservative/.test(r.notes), id); }
        assert.equal(o('vasodilator-black-reduced-death').ci_high, 0.89);
        const vn = o('vericiguat-reduced-death').notes; assert.ok(/0\.95 \(0\.84-1\.07\)/.test(vn) && /CARDIOVASCULAR death is 0\.93/.test(vn) && /0\.90 \(0\.82-0\.98\)/.test(vn) && !/VICTORIA all-cause death HR 0\.93/.test(vn));
        const bq = o('beta-blocker-reduced-hfh'); assert.ok(bq.quote.includes('hospital admission for worsening heart failure (HR: 0.64 [0.53-0.79])') && !/decreased by 32%/.test(bq.quote)); assert.ok(/10714728/.test(bq.extrapolation) && /11386263/.test(bq.extrapolation) && !/P=0\.000004/.test(bq.extrapolation));
        // potassium binders: sodium zirconium cyclosilicate carries the REALIZE-K signal for hospitalization; patiromer stays at no outcome evidence
        const szc = OUTCOME_EVIDENCE_TABLE.filter(r => r.drugs.includes('Sodium Zirconium Cyclosilicate (Lokelma)') && r.outcome === 'hf_hospitalization');
        assert.equal(szc.length, 3); for (const r of szc) { assert.equal(r.basis, 'extrapolated'); assert.ok(r.rr > 1 && r.ci_low! >= 1 && /11 \(11%\) participants in the SZC group/.test(r.quote) && /randomized-withdrawal/.test(r.extrapolation + r.notes) && /EXPLORATORY/.test(r.extrapolation), r.id); assert.ok(!r.drugs.includes('Patiromer')); }
        assert.ok(OUTCOME_EVIDENCE_TABLE.filter(r => r.drugs.includes('Patiromer')).every(r => r.basis === 'no_outcome_evidence'));
        // loops without congestion do not quote the benefit sentence as support for no effect
        assert.ok(OUTCOME_EVIDENCE_TABLE.filter(r => r.drug_class === 'Loop Diuretic' && r.population_key === 'other').every(r => !/odds ratio \(OR\) for death/.test(r.quote)));
        // no row displays an interval that is not a confidence interval of its value: conflicting rows store the interval of a different estimate only where said so
        assert.equal(o('beta-blocker-preserved-death').ci_low, null);
    });

    check('E6, E7 (round 1 review): carvedilol syncope follows the label by the table\'s own source rule; the age multipliers use the overall rate; the finerenone diabetes multiplier is gone', () => {
        for (const id of ['BB-carvedilol-syncope', 'BB-class-syncope-sibling']) {
            const r = HARM_TABLE.rows.find(x => x.id === id)!;
            near(r.one_year_excess_pct, 0.6, 1e-9, id); assert.ok(/2\.9% and 2\.3%|syncope in 2\.9%/.test(r.quote + r.notes) && /8% vs placebo 5%/.test(r.notes) && /3\.4% vs 2\.5%/.test(r.notes) && /CHOSEN/.test(r.notes), id);
            assert.ok(/more patients/.test(r.notes) && /whole percents/.test(r.notes), `${id} says why`);
        }
        const mult = (id: string) => (HARM_TABLE.multipliers.find(m => m.id === id) as { ratio: number } | undefined)?.ratio;
        const exp: [string, number, number, number, number][] = [['M-age75-hypotension-ARNI', 139, 784, 449, 3403], ['M-age75-hypotension-ACEi', 93, 779, 295, 3433], ['M-age75-K55-ARNI', 139, 784, 535, 3403], ['M-age75-K55-ACEi', 152, 779, 575, 3433], ['M-age75-creat25-ARNI', 33, 784, 106, 3403], ['M-age75-creat25-ACEi', 46, 779, 142, 3433]];
        for (const [id, a, na, b, nb] of exp) near(mult(id)!, (a / na) / ((a + b) / (na + nb)), 0.0006, id);   // every multiplier divides by the OVERALL rate, as the sex, angioedema and diabetes multipliers do
        assert.equal(mult('M-diabetes-K55-nsMRA'), undefined);
        const doc = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'harmEvidence.json'), 'utf8')) as { multipliers_not_representable: { id: string; reason: string }[] };
        assert.ok(doc.multipliers_not_representable.some(m => m.id === 'NR-FINEARTS-K-diabetes' && /prognostic hazard ratio/.test(m.reason)));
    });

    check('E11, E12, E14 (round 1 review): dose rows say whose mean they are; the no-target reason is true; the start-credit note says what the audit found; harm rows that are sums, post hoc or from another disease say so; the digoxin anchor is in micrograms', () => {
        const dose = (id: string) => (DOSE_EVIDENCE.anchors as { id: string; unit: string; notes: string; arithmetic: string; dose_population?: string | null; verification: string }[]).find(a => a.id === id)!;
        assert.equal(dose('digoxin').unit, 'mcg');
        assert.ok(/day-120|day 120/.test(dose('bb-carvedilol').dose_population ?? '') && /9%/.test(dose('bb-carvedilol').dose_population ?? '') && /36\.75/.test(dose('bb-carvedilol').notes));
        assert.ok(/label says patients randomized/.test(dose('mra-spironolactone').dose_population ?? '') && /continuing to receive treatment after 24 months/.test(dose('mra-spironolactone').notes));
        for (const id of ['acei-lisinopril', 'acei-enalapril', 'acei-ramipril', 'acei-captopril']) assert.ok(/24% had discontinued enalapril/.test(dose(id).notes) && /asymptomatic left ventricular dysfunction/.test(dose(id).notes), id);
        for (const id of ['no-target-furosemide', 'no-target-torsemide', 'no-target-bumetanide', 'no-target-metolazone', 'no-target-chlorthalidone', 'no-target-hydrochlorothiazide', 'no-target-patiromer', 'no-target-sodium', 'no-target-ferric']) {
            const t = dose(id).arithmetic; assert.ok(/false for loop diuretics and ferric carboxymaltose/.test(t), id);
            if (/furosemide|torsemide|bumetanide|ferric/.test(id)) assert.ok(/NOT neutral/.test(t), `${id}: the stated reason must not call a non-neutral row neutral`);
        }
        const c = (DOSE_EVIDENCE.start_dose_credit as { audit_note?: string; value: number }).audit_note ?? ''; assert.ok(/0\.6, 0\.269, 0\.394, 0\.365, mean 0\.407/.test(c) && /not bounded/.test(c) && /-0\.364 to 1\.307/.test(c));
        near((DOSE_EVIDENCE.start_dose_credit as { value: number }).value, 0.364247, 1e-9);   // the value itself is unchanged
        const notes = ['ARNI-R5-angioedema', 'dig-av-block', 'loop-hypokalemia', 'loop-hyponatremia', 'loop-hyperglycemia', 'thiazide-hyperglycemia', 'vas-lupus', 'fcm-hypophosphatemia', 'SGLT2i-dapa-genital-female', 'tirz-inj'];
        for (const id of notes) assert.ok(((HARM_TABLE.rows.find(r => r.id === id)! as { level_note?: string }).level_note ?? '').length > 40, `${id} level text`);
        assert.ok(/SUM across two trials/.test((HARM_TABLE.rows.find(r => r.id === 'ARNI-R5-angioedema')! as { level_note?: string }).level_note!) && /POST HOC/.test((HARM_TABLE.rows.find(r => r.id === 'dig-av-block')! as { level_note?: string }).level_note!) && /HYPERTENSION/.test((HARM_TABLE.rows.find(r => r.id === 'loop-hypokalemia')! as { level_note?: string }).level_note!));
        // every verification code in the four tables is one the display has a plain word for (the word list lives in expectedEffectModel.ts and is checked by verify:ui)
        assert.ok(!SYMPTOM_TABLE.some(r => r.verification === 'confirmed'));
    });

    check('C6 GLP-1 in reduced EF (death and hospitalization): relative risk 1.0 for ranking, pooled interval kept for display, basis and note say why, citations kept', () => {
        for (const [id, lo, hi] of [['glp1-reduced-death', 0.68, 1.02], ['glp1-reduced-hfhosp', 0.86, 1.31]] as [string, number, number][]) {
            const r = orow(id);
            assert.equal(r.rr, 1, id); assert.equal(r.ci_low, lo); assert.equal(r.ci_high, hi); assert.equal(r.basis, 'conflicting');   // E4: randomized evidence conflicts
            const t = `${r.extrapolation} ${r.notes}`;
            assert.ok(/conflicting randomized evidence in reduced EF/.test(t) && /two randomized sources of two drugs/.test(t) && /between-source variance not estimable/.test(t) && /FIGHT/.test(t), id);   // E5: LIVE is not in the pooled row; the wording no longer says so
            assert.ok(r.source.citation.includes('Deanfield') && r.source.citation.includes('Margulies'), `${id} citations kept`);
            assert.equal(shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, r).rr_used, 1);
        }
    });

    check('C6 thiazide-type kidney harm (CLOROTIC for hydrochlorothiazide and chlorthalidone, MELT-HF for metolazone: acute add-on to a loop diuretic) is charged only when the option\'s regimen also contains a loop diuretic; without one the line says "kidney harm without a loop diuretic: not measured", level not measured, nothing charged', () => {
        const q = patient();
        type HL = import('../services/engine/harmBurden').HarmLine;
        const line = (regimen: RegimenMed[], drug: string) => harmBurdenFor(HARM_TABLE, regimen, q).lines.find(l => l.kind === 'harm' && l.effect === 'creatinineRise' && l.drug === drug) as HL;
        const loop = entry('Furosemide', 40);
        for (const [drug, dose, rate] of [['Hydrochlorothiazide', 25, 29.3], ['Chlorthalidone', 12.5, 29.3], ['Metolazone', 5, 8.175]] as [string, number, number][]) {
            const t = entry(drug, dose), withLoop = line([loop, t], drug), without = line([t], drug);
            near(withLoop.charged_rate, rate, 1e-9, `${drug} with a loop`); assert.ok(withLoop.points > 0); assert.equal(withLoop.charge_note, undefined); assert.notEqual(withLoop.level, 'notMeasured');
            assert.equal(without.charged_rate, 0, `${drug} without a loop`); assert.equal(without.points, 0); assert.equal(without.level, 'notMeasured');
            const n = without.charge_note ?? '';
            assert.ok(/kidney harm without a loop diuretic: not measured/i.test(n) && /acute add-on use with a loop diuretic/i.test(n) && /hypertension model charges none/i.test(n), `${drug}: ${n}`);
        }
        for (const id of ['hctz-creatinine', 'chlorthalidone-creatinine', 'metolazone-creatinine']) assert.deepEqual((HARM_TABLE.rows.find(r => r.id === id)! as { charge_when?: unknown }).charge_when, { kind: 'regimen_contains_class', value: 'Loop Diuretic' }, id);
        const hctz = entry('Hydrochlorothiazide', 25);
        const b0 = harmBurdenFor(HARM_TABLE, [hctz], q).burden, b1 = harmBurdenFor(HARM_TABLE, [loop, hctz], q).burden, bl = harmBurdenFor(HARM_TABLE, [loop], q).burden;
        assert.ok(b1 - bl > b0 + 10, `thiazide burden with a loop ${b1 - bl} versus alone ${b0}`);
    });

    // C7 (rewritten for E2, controller ruling 2026-11-19, round 1 review). The class-average level is gone: a harm not measured for a drug is charged from a measured row of a class with the SAME mechanism
    // (level "borrowed from a sibling class", the class and the reason named) or is "not measured" and charges nothing.
    check('E2 no harm row charges a class average; the eight rows that did (seven class averages and the Furoscix upper bound) are each either borrowed from a named same-mechanism row or not measured, and every text field describes what the row now is', () => {
        assert.ok(!HARM_TABLE.rows.some(r => (r.level as string) === 'classAverage'), 'no classAverage level remains');
        assert.ok(!HARM_TABLE.rows.some(r => 'class_average' in r || 'bound_value' in r), 'no class-average or bound_value field remains');
        const ids = ['ACEi-STEP6-renalSAE', 'ARB-STEP6-renalSAE', 'ARNI-STEP6-renalSAE', 'BB-STEP6-AVblockAdv', 'vas-syncope', 'loop-hypotension', 'thiazide-hypotension', 'furoscix-injection-site'];
        const stale = /class average|upper bound|largest placebo-controlled excess|step[- ]?6|the controller (should|is searching)|largest (verified )?excess|ceiling, not an estimate/i;
        let borrowed = 0, notMeasured = 0;
        for (const id of ids) {
            const row = HARM_TABLE.rows.find(r => r.id === id)! as typeof HARM_TABLE.rows[number] & { level_note?: string };
            assert.ok(row.level === 'siblingProxy' || row.level === 'notMeasured', `${id}: ${row.level}`);
            assert.equal(row.upper_bound, false, id);
            for (const f of ['population', 'quote', 'notes', 'definition_used'] as const) assert.ok(!stale.test(row[f]), `${id}.${f} still describes the old rule: ${row[f].slice(0, 160)}`);
            assert.ok(!stale.test(row.source.trial) && !stale.test(row.source.citation), `${id} source text`);
            if (row.level === 'notMeasured') {
                notMeasured++; assert.equal(row.one_year_excess_pct, 0, id); assert.ok(/not measured/i.test(row.population), id);
                assert.ok(row.verification !== 'verified_label' || /label/i.test(row.quote + row.notes), id);
            } else {
                borrowed++;
                const src = HARM_TABLE.rows.find(r => r.id === (row as { borrowed_from?: string }).borrowed_from);
                assert.ok(src, `${id} names the row it borrows from`);
                assert.equal(src!.effect, row.effect); assert.ok(src!.level === 'drug' || src!.level === 'class', `${id} borrows a measured row`); assert.ok(/^verified_/.test(src!.verification), `${id} borrows a verified row`);
                near(row.one_year_excess_pct, src!.one_year_excess_pct, 1e-9, id); assert.notEqual(src!.drug_class, row.drug_class);
                assert.ok(row.notes.includes(src!.drug_class) && /same mechanism|same pathway/i.test(row.notes), `${id} names the class and says why the mechanism matches`);
            }
        }
        assert.equal(borrowed + notMeasured, 8); assert.equal(borrowed, 1, 'only the vasodilator fainting row borrows'); assert.equal(notMeasured, 7);
        // the renal serious-event rows are "not measured separately" because the same drug's creatinine-rise row already charges kidney harm
        for (const [id, drug, cls, dose] of [['ACEi-STEP6-renalSAE', 'Ramipril', 'ACEi', 5], ['ARB-STEP6-renalSAE', 'Losartan', 'ARB', 50], ['ARNI-STEP6-renalSAE', 'Sacubitril/Valsartan (Entresto)', 'ARNI', '49/51']] as [string, string, string, number | string][]) {
            assert.ok(/not measured separately/i.test(HARM_TABLE.rows.find(r => r.id === id)!.population), id);
            const hb = harmBurdenFor(HARM_TABLE, [entry(drug, dose)], patient());
            const creat = hb.lines.find(l => l.kind === 'harm' && l.effect === 'creatinineRise' && l.drug_class === cls) as import('../services/engine/harmBurden').HarmLine;
            assert.ok(creat && creat.charged_rate > 0, `${drug}: the creatinine-rise row charges`);
            const l = hb.lines.find(x => x.kind === 'harm' && x.effect === 'renalSeriousEvent') as import('../services/engine/harmBurden').HarmLine;
            assert.equal(l.level, 'notMeasured'); assert.equal(l.charged_rate, 0);
        }
        console.log(`  E2: ${borrowed} row borrowed from a same-mechanism class, ${notMeasured} rows not measured`);
    });

    check('E2 the old class-average script and its record are gone', () => {
        assert.ok(!existsSync(join(import.meta.dirname, '..', 'docs', 'owner-decisions-2026-11-18', 'class_average_harm.py')), 'class_average_harm.py deleted');
    });

    // Second pass 2026-11-18: evidence rows from the lookup report (evidence-lookups.md).
    check('C6 IV iron hypophosphatemia: the pooled heart failure analysis replaces the iron-deficiency-anemia figure; excess = 8.1% minus 5 of 809 on placebo (derived, said so); old value kept', () => {
        const row = HARM_TABLE.rows.find(r => r.id === 'fcm-hypophosphatemia')! as typeof HARM_TABLE.rows[number] & { previous_value?: number };
        near(row.one_year_excess_pct, 8.1 - 100 * 5 / 809, 0.001, 'excess'); assert.equal(row.level, 'drug'); assert.equal(row.effect, 'hypophosphatemia'); assert.equal(row.control_type, 'placebo');
        near(row.previous_value!, 66.35, 1e-9);
        assert.equal(row.source.pmid, '36722321'); assert.ok(row.source.citation.includes('PMC10053364'));
        for (const frag of ['week 4', 'week 12', 'clinical events', 'below 1.0 mg/dL', 'DERIVED from a printed count', '809']) assert.ok(row.notes.includes(frag), `notes lack "${frag}"`);
        assert.ok(row.quote.includes('8.1%') && row.quote.includes('placebo: 5'));
        const l = harmBurdenFor(HARM_TABLE, [entry('Ferric Carboxymaltose', 500)], patient()).lines.find(x => x.kind === 'harm' && x.effect === 'hypophosphatemia') as import('../services/engine/harmBurden').HarmLine;
        near(l.charged_rate, 8.1 - 100 * 5 / 809, 0.001);
    });

    check('C7 loop and thiazide hypomagnesemia: not measured (no randomized incidence exists), nothing charged, never a bare zero; the notes carry the quotes', () => {
        const loop = HARM_TABLE.rows.find(r => r.id === 'loop-hypomagnesemia')!, thz = HARM_TABLE.rows.find(r => r.id === 'thiazide-hypomagnesemia')!;
        for (const r of [loop, thz]) { assert.equal(r.level, 'notMeasured'); assert.equal(r.one_year_excess_pct, 0); assert.ok(r.notes.includes('patiromer')); assert.ok(r.notes.includes('21.596')); }
        assert.ok(loop.quote.includes('The use of loop diuretics is not associated with an increased risk of hypomagnesaemia') && /no association/.test(loop.notes));
        for (const frag of ['3.14', '2.74', 'not reduced by hydrochlorothiazide']) assert.ok(thz.quote.includes(frag), frag);
        assert.ok(/absolute excess cannot be recovered/.test(thz.notes) && /understates the harm/i.test(thz.notes));
        for (const [name, dose] of [['Furosemide', 40], ['Hydrochlorothiazide', 25]] as [string, number][]) {
            const l = harmBurdenFor(HARM_TABLE, [entry(name, dose)], patient()).lines.find(x => x.kind === 'harm' && x.effect === 'hypomagnesemia') as import('../services/engine/harmBurden').HarmLine;
            assert.equal(l.level, 'notMeasured'); assert.equal(l.points, 0); assert.equal(l.charged_rate, 0);
        }
    });

    check('E1 (round 1 review): the three derived beta-blocker rhythm rows are gone; the atrial fibrillation rows are the measured Kotecha and Cleland subgroups; the pooled three-trial row serves sinus and other rhythms and says the trials enrolled all rhythms; the CIBIS-II hospitalization row says it was quoted from a review', () => {
        const row = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)! as OutcomeEvidenceRow & { derivation?: unknown; source_of?: unknown };
        assert.ok(!OUTCOME_EVIDENCE_TABLE.some(r => r.id === 'beta-blocker-reduced-death-sinus'), 'derived sinus row removed');
        assert.ok(!OUTCOME_EVIDENCE_TABLE.some(r => (r as { derivation?: { kind?: string } }).derivation?.kind?.startsWith('rhythm_')), 'no rhythm derivation block remains');
        assert.ok(!OUTCOME_EVIDENCE_TABLE.some(r => r.verification === 'derived'), 'no row is verified as derived');
        const pooled = row('beta-blocker-reduced-death');
        assert.equal(pooled.rr, 0.66); assert.equal(pooled.ci_low, 0.58); assert.equal(pooled.ci_high, 0.74); assert.equal(pooled.basis, 'meta_analysis'); assert.equal(pooled.population_key, 'other'); assert.equal(pooled.source_of, undefined);
        assert.ok(/all rhythms/i.test(pooled.notes) && /did not (analyse|analyze|report) (the )?(results )?by (baseline )?rhythm|enrolled (patients in )?all rhythms/i.test(pooled.notes), pooled.notes);
        const af = row('beta-blocker-reduced-death-afib');
        assert.equal(af.rr, 0.97); assert.equal(af.ci_low, 0.83); assert.equal(af.ci_high, 1.14); assert.equal(af.basis, 'subgroup'); assert.equal(af.population_key, 'atrial_fibrillation'); assert.equal(af.source.pmid, '25193873');
        assert.ok(af.quote.includes('0·97, 0·83-1·14') && af.quote.includes('p=0·73'), af.quote); assert.ok(/all beta-blockers studied/i.test(af.notes) && /subgroup of a pooled patient-level analysis/i.test(af.notes), af.notes);
        assert.ok(af.verification === 'abstract_quote', af.verification);
        const mild = row('beta-blocker-mildly-reduced-death-afib');
        assert.equal(mild.rr, 1.3); assert.equal(mild.ci_low, 0.63); assert.equal(mild.ci_high, 2.67); assert.equal(mild.basis, 'subgroup'); assert.equal(mild.population_key, 'atrial_fibrillation');
        assert.ok(mild.quote.includes('32/146') && mild.quote.includes('1.30 (0.63'), mild.quote);
        assert.equal(row('beta-blocker-mildly-reduced-death').rr, 0.59); assert.equal(row('beta-blocker-mildly-reduced-death').basis, 'subgroup');
        assert.ok(row('beta-blocker-reduced-hfh').notes.includes('quoted from a review (PMC2291328), not read in the primary paper'));
    });

    // Third pass 2026-11-18 (independent review).
    check('C1 a start earns the HIGHEST credit among the dose and frequency combinations the engine may offer, and equal daily doses earn equal credit (ramipril at eGFR 35: 2.5 mg twice daily and 5 mg once daily both earn the 5 mg/day credit)', () => {
        const kidneyAt = (egfr: number): Patient => { const k = patient(); k.egfr = egfr; k.creatinine = egfr < 30 ? 2.6 : 1.4; return k; };
        const q = kidneyAt(35), ram = entry('Ramipril', 1.25, 'qd');
        const a = outcomeDoseCredit(entry('Ramipril', 2.5, 'bid'), q), b = outcomeDoseCredit(entry('Ramipril', 5, 'qd'), q);
        near(a, b, 1e-12, 'same daily dose, same credit');
        const pc = plan([{ action: 'add', target: ram, summary: 'x' }], [ram], q);
        near(pc.creditFn(ram, q), Math.max(a, b), 1e-12, 'the start earns the best allowed combination');
        // every drug, every eGFR: regimens with the same daily dose earn the same credit
        for (const egfr of [30, 45, 70]) {
            const k = kidneyAt(egfr);
            for (const med of MEDICATION_FORMULARY) {
                const byDaily = new Map<string, number>();
                for (const d of med.available_doses) for (const f of d.frequency_options) {
                    const r: RegimenMed = { med, dose: d, selected_frequency: f }, daily = numericDailyDose(r);
                    if (Number.isNaN(daily)) continue;
                    const key = daily.toFixed(6), c = outcomeDoseCredit(r, k);
                    if (byDaily.has(key)) near(c, byDaily.get(key)!, 1e-12, `${med.name} at eGFR ${egfr}: daily dose ${daily} earns different credit by schedule`);
                    else byDaily.set(key, c);
                }
            }
        }
    });

    check('C3 the "mostly prior" threshold is pinned: a row with weight B between 0.1 and 0.2 is marked, one just above 0.2 is not (synthetic rows; outcome and symptom)', () => {
        const base = OUTCOME_EVIDENCE_TABLE.find(r => r.id === 'acei-reduced-death')!;
        const rowWithB = (B: number): OutcomeEvidenceRow => {
            const probe: OutcomeEvidenceRow = { ...base, id: 'probe', basis: 'extrapolated' };
            const tau2 = outcomeStats(OUTCOME_EVIDENCE_TABLE.filter(r => r.id !== 'acei-reduced-death').concat(probe)).tau2.all_cause_death;   // the extrapolated row does not enter the prior
            const se = Math.sqrt(tau2 * (1 / B - 1)); return { ...base, id: `b${B}`, basis: 'extrapolated', rr: 0.8, ci_low: Math.exp(Math.log(0.8) - 1.96 * se), ci_high: Math.exp(Math.log(0.8) + 1.96 * se) }; };
        const p0 = patient();
        for (const [B, expected] of [[0.12, true], [0.15, true], [0.19, true], [0.21, false], [0.3, false]] as [number, boolean][]) {
            const table = OUTCOME_EVIDENCE_TABLE.filter(r => r.id !== 'acei-reduced-death').concat(rowWithB(B));
            const c = regimenOutcomeEstimate(table, [entry('Lisinopril', 20)], p0, 'all_cause_death', populationKeyFor).contributors[0];
            near(c.shrinkage_b, B, 0.002, `B ${B}`); assert.equal(c.mostly_prior, expected, `outcome B ${B}`);
        }
        const sbase = SYMPTOM_TABLE.find(r => r.id === 'bb-reduced')!;
        for (const [B, expected] of [[0.15, true], [0.19, true], [0.21, false]] as [number, boolean][]) {
            const st2 = symptomStats(SYMPTOM_TABLE.filter(r => r.id !== 'bb-reduced').concat({ ...sbase, basis: 'extrapolated' as const })).tau2;
            const se = Math.sqrt(st2 * (1 / B - 1)), row = { ...sbase, id: `s${B}`, basis: 'extrapolated' as const, kccq_points: 3, ci_low: 3 - 1.96 * se, ci_high: 3 + 1.96 * se };
            const table = SYMPTOM_TABLE.filter(r => r.id !== 'bb-reduced').concat(row);
            const c = regimenSymptomEstimate(table, [entry('Carvedilol', 25, 'bid')], p0).contributors[0];
            near(c.shrinkage_b, B, 0.002, `symptom B ${B}`); assert.equal(c.mostly_prior, expected, `symptom B ${B}`);
        }
    });

    check('third pass data (rewritten for E4 and E9): the conflicting-evidence sentence is driven by an explicit field set on exactly the three rows whose basis is "conflicting" (the two GLP-1 reduced-EF rows and the beta-blocker LVEF 50 and above death row); none of them stores an interval that is not a confidence interval of its value', () => {
        const flagged = OUTCOME_EVIDENCE_TABLE.filter(r => (r as { conflicting_evidence?: boolean }).conflicting_evidence === true).map(r => r.id).sort();
        assert.deepEqual(flagged, ['beta-blocker-preserved-death', 'glp1-reduced-death', 'glp1-reduced-hfhosp']);
        assert.deepEqual(OUTCOME_EVIDENCE_TABLE.filter(r => r.basis === 'conflicting').map(r => r.id).sort(), flagged);
        const bb = OUTCOME_EVIDENCE_TABLE.find(r => r.id === 'beta-blocker-preserved-death')!;
        assert.equal(bb.rr, 1); assert.equal(bb.ci_low, null); assert.equal(bb.ci_high, null);
    });

    check('third pass wording: the side-effect line says what is true for class-average, not-measured and upper-bound rows, not "at the trial rate" for every row; the Furoscix upper bound says why it is one', () => {
        const out = run(patient([entry('Lisinopril', 20)]));
        const detail = out.scoredRegimens[0].score_breakdown!.domains.find(d => d.key === 'side_effects')!.detail!;
        assert.ok(!/charged in full at the trial rate/.test(detail), detail);
        assert.ok(/not measured/.test(detail) && /borrowed/.test(detail) && !/class average|upper bound/.test(detail), detail);   // E2: the class-average level and the upper-bound rows are gone
    });

    // C8. Text and rule set.
    check('C8 harmDefinitions describes the actual side-effect formula (burden divided by 2, a weight), and the rule set identifier is 2026-11-25.1', () => {
        const defs = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'harmDefinitions.json'), 'utf8')) as { method: { scale: string } };
        assert.ok(!defs.method.scale.includes('max(0, 100 - burden)'), defs.method.scale);
        assert.ok(defs.method.scale.includes('max(0, 100 - burden / 2)') && /divisor of 2 is a weight/.test(defs.method.scale), defs.method.scale);
        assert.equal(SIDE_EFFECT_BURDEN_DIVISOR, 2);
        // Rewritten 2026-11-21 (round 3 fixes: scope gate, no-change-first, one ranking, label dose credit, wording): the rule set is now 2026-11-21.1 (it was 2026-11-19.3).
        // Rewritten again in round 4 (ruling set W1 to W11: hypoxia alert, tie rule, stop-path alerts, scope prompts, wording): the rule set is now 2026-11-21.2.
        // Rewritten again after the round 4 controller rulings X1 and X2 (finerenone evidence at LVEF 40 to 49; atrial fibrillation alert with a scope condition): the rule set is now 2026-11-21.3.
        // Rewritten again after round 5 (rulings Y1 to Y13: blank pressure, forced-dose reasons, congestion and perfusion prompts, stop-screen wording): the rule set is now 2026-11-21.4.
        // Rewritten again after round 6 (rulings V1 to V19: allergy and potassium holds, blank kidney values, no-option screens, change-line wording, case packet): the rule set is now 2026-11-21.5.
        // Rewritten again after round 7 (rulings W1 to W14: trade-off labels, alerts true of the options, adjunct lines, one angioedema predicate, sentence allergies, no-option wording): the rule set is now 2026-11-21.6.
        // Rewritten again after round 8 (rulings X1 to X15: allergy reader, forced removals, duplicate and potassium wording, dosing count, loop sentences): the rule set is now 2026-11-22.1.
        assert.equal(RULESET_VERSION, '2026-11-25.1'); // round 13 (E1 to E5): 2026-11-25.1
    });

    // C4. Beta-blockers by current rhythm.
    const afib = (regimen: RegimenMed[] = [], lvef = 35): Patient => { const q = patient(regimen); q.rhythm = 'AFib'; q.lvef = lvef; return q; };
    const bbEvidence = (q: Patient, outcome: 'all_cause_death' | 'hf_hospitalization') => {
        const med = MEDICATION_FORMULARY.find(m => m.name === 'Carvedilol')!;
        return evidenceFor(OUTCOME_EVIDENCE_TABLE, med, q, outcome, populationKeyFor(med, q));
    };
    const sinusPt = (): Patient => { const q = patient(); q.rhythm = 'Sinus'; return q; };   // the shared fixture defaults to atrial fibrillation
    check('C4/E1 beta-blocker evidence follows the CURRENT rhythm: atrial fibrillation gets the atrial fibrillation rows (death and, new in E1, hospitalization), sinus, paced and other rhythms the pooled row', () => {
        assert.equal(bbEvidence(afib(), 'all_cause_death').id, 'beta-blocker-reduced-death-afib');
        const sinus = sinusPt(); assert.equal(bbEvidence(sinus, 'all_cause_death').id, 'beta-blocker-reduced-death');
        for (const r of ['Paced', '2nd Degree AV Block'] as const) { const q = sinusPt(); q.rhythm = r; assert.equal(bbEvidence(q, 'all_cause_death').id, 'beta-blocker-reduced-death', r); }
        assert.equal(bbEvidence(afib([], 45), 'all_cause_death').id, 'beta-blocker-mildly-reduced-death-afib');
        assert.equal(bbEvidence(Object.assign(sinusPt(), { lvef: 45 }), 'all_cause_death').id, 'beta-blocker-mildly-reduced-death');
        assert.equal(bbEvidence(afib(), 'hf_hospitalization').id, 'beta-blocker-reduced-hfh-afib');
        assert.equal(bbEvidence(sinusPt(), 'hf_hospitalization').id, 'beta-blocker-reduced-hfh');
        assert.equal(bbEvidence(afib([], 45), 'hf_hospitalization').id, bbEvidence(Object.assign(sinusPt(), { lvef: 45 }), 'hf_hospitalization').id, 'no atrial fibrillation hospitalization row at LVEF 41-49');
        assert.equal(bbEvidence(afib([], 60), 'all_cause_death').id, bbEvidence(Object.assign(sinusPt(), { lvef: 60 }), 'all_cause_death').id, 'no atrial fibrillation row at preserved EF');
        // a history of atrial fibrillation is not the current rhythm
        const hist = sinusPt(); hist.comorbidities = new Set(['Atrial Fibrillation']); assert.equal(bbEvidence(hist, 'all_cause_death').id, 'beta-blocker-reduced-death');
    });

    check('E1 the atrial fibrillation hospitalization row is Cleland 2018 Table 2 cardiovascular hospitalization in atrial fibrillation below LVEF 40 (four strata pooled, inverse variance), converted to heart failure hospitalization by the SAME exponent as the LVEF 41-49 row, labelled extrapolated; the LVEF 41-49 interval carries the uncertainty of the 0.64', () => {
        const row = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)! as OutcomeEvidenceRow & { derivation?: { kind: string; k: number; k_se: number } };
        const pl = (xs: [number, number, number][]) => { const w = xs.map(([, l, h]) => 1 / lnSe(l, h) ** 2), m = xs.reduce((a, [v], i) => a + w[i] * Math.log(v), 0) / w.reduce((a, b) => a + b, 0), s = 1 / Math.sqrt(w.reduce((a, b) => a + b, 0)); return { m, s }; };
        const sinus = pl([[0.70, 0.60, 0.81], [0.75, 0.66, 0.85], [0.84, 0.74, 0.94], [0.75, 0.61, 0.91]]);
        const k = Math.log(0.64) / sinus.m, relK = Math.sqrt((lnSe(0.53, 0.79) / Math.log(0.64)) ** 2 + (sinus.s / sinus.m) ** 2), kSe = Math.abs(k) * relK;
        const conv = (m: number, s: number) => { const ln = k * m, v = (k * s) ** 2 + (m * kSe) ** 2, h = 1.96 * Math.sqrt(v); return { rr: Math.exp(ln), lo: Math.exp(ln - h), hi: Math.exp(ln + h) }; };
        const af = pl([[0.97, 0.69, 1.35], [0.75, 0.58, 0.98], [1.01, 0.81, 1.26], [0.90, 0.60, 1.36]]);
        const afRow = row('beta-blocker-reduced-hfh-afib'), e = conv(af.m, af.s);
        near(afRow.rr, e.rr, 0.002, 'rr'); near(afRow.ci_low!, e.lo, 0.002, 'low'); near(afRow.ci_high!, e.hi, 0.002, 'high');
        assert.equal(afRow.basis, 'extrapolated'); assert.equal(afRow.population_key, 'atrial_fibrillation'); assert.equal(afRow.ef_band, 'reduced'); assert.equal(afRow.outcome, 'hf_hospitalization');
        assert.ok(afRow.quote.includes('0.97 (0.69') && afRow.quote.includes('0.90 (0.60'), afRow.quote); near(afRow.derivation!.k, k, 0.002, 'exponent');
        const m = row('beta-blocker-mildly-reduced-hfh'), em = conv(Math.log(0.95), lnSe(0.68, 1.32));
        near(m.rr, em.rr, 0.002, 'mild rr'); near(m.ci_low!, em.lo, 0.002, 'mild low'); near(m.ci_high!, em.hi, 0.002, 'mild high');
        assert.ok(/uncertainty of the 0\.64/.test(m.extrapolation), m.extrapolation); assert.equal(m.basis, 'extrapolated');
        near(row('beta-blocker-mildly-reduced-hfh').derivation!.k, k, 0.002, 'same exponent in both rows');
    });

    check('C4 for every reference scenario with a beta-blocker on board, run as atrial fibrillation and as sinus rhythm: no displayed option in the atrial fibrillation run removes or reduces the beta-blocker unless the sinus run\'s displayed options do the same', () => {
        const bbDaily = (rg: RegimenMed[]) => rg.filter(r => r.med.drug_class === 'Beta Blocker').reduce((a, r) => a + numericDailyDose(r), 0);
        let scenarios = 0, afReducing = 0;
        for (const sc of SCENARIOS) {
            const cur = sc.patient.current_regimen ?? [];
            if (!cur.some(r => r.med.drug_class === 'Beta Blocker')) continue;
            scenarios++;
            const reduces = (rhythm: 'AFib' | 'Sinus') => {
                const q = clonePatientForTest(sc.patient); q.rhythm = rhythm;
                return run(q).scoredRegimens.some(o => bbDaily(o.regimen) < bbDaily(cur) - 1e-9);
            };
            const af = reduces('AFib'), si = reduces('Sinus');
            if (af) afReducing++;
            assert.ok(!af || si, `${sc.title}: a displayed option removes or reduces the beta-blocker with rhythm AFib but none does with rhythm Sinus`);
        }
        console.log(`  C4: ${scenarios} reference scenarios with a beta-blocker on board; ${afReducing} have an atrial fibrillation option that reduces or removes it (all also present in the sinus run)`);
        assert.ok(scenarios >= 100, `only ${scenarios} scenarios`);
    });

    // C1. Valuing starts and increases.
    const kidney = (egfr: number): Patient => { const q = patient(); q.egfr = egfr; q.creatinine = egfr < 30 ? 2.6 : 1.4; return q; };
    check('C1 a start earns the credit of the highest dose this patient may be given (kidney, interaction and declared-maximum rules), not 1; uncapped starts earn 1; the cap is said in words', () => {
        const q = kidney(25), ram = entry('Ramipril', 1.25, 'qd');
        const pc = plan([{ action: 'add', target: ram, summary: 'x' }], [ram], q);
        const expected = outcomeDoseCredit(entry('Ramipril', 2.5, 'qd'), q);
        near(pc.creditFn(ram, q), expected, 1e-12, 'ramipril start at eGFR 25 earns the credit of 2.5 mg/day');
        assert.ok(expected < 1 && Math.abs(expected - 0.476) < 0.001, `credit ${expected}`);
        assert.ok(pc.titrated.includes('Ramipril'));
        assert.equal(pc.capped.length, 1);
        assert.equal(pc.capped[0].drug, 'Ramipril');
        assert.ok(/kidney/i.test(pc.capped[0].text) && pc.capped[0].text.includes('2.5') && /eGFR 25/.test(pc.capped[0].text), pc.capped[0].text);
        // the scored option says so in the mortality line and in the drill-down contributor
        const views = buildOutcomeEstimateViews([ram], q, { modifications: [{ action: 'add', target: ram, summary: 'x' }], resulting_regimen: [ram] } as ModificationSet);
        assert.ok(views[0].contributors[0].start_cap_note && /kidney/i.test(views[0].contributors[0].start_cap_note!), JSON.stringify(views[0].contributors[0]));
        const e = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, [ram], q, 'all_cause_death', populationKeyFor, pc.creditFn);
        assert.ok(/highest dose allowed/i.test(describeOutcomeEstimate(e, pc.titrated, [], pc.capped)) && /kidney/i.test(describeOutcomeEstimate(e, pc.titrated, [], pc.capped)));
        // uncapped starts earn exactly 1 and carry no cap note
        const p70 = patient();
        for (const [n, d] of [['Spironolactone', 12.5], ['Dapagliflozin', 10], ['Carvedilol', 3.125], ['Lisinopril', 2.5]] as [string, number][]) {
            const t = entry(n, d), pu = plan([{ action: 'add', target: t, summary: 'x' }], [t], p70);
            assert.equal(pu.creditFn(t, p70), 1, `${n} start, eGFR 70`); assert.equal(pu.capped.length, 0, n);
        }
        // a cross-class switch is a start and is capped the same way
        const src = entry('Losartan', 25), sw = plan([{ action: 'swap', source: src, target: ram, summary: 'x' }], [ram], q);
        near(sw.creditFn(ram, q), expected, 1e-12, 'switch to ramipril at eGFR 25');
        // an interaction cap counts too: eplerenone with a moderate CYP3A inhibitor is limited to 25 mg
        const ep = patient(); ep.external_medications = new Set(['Diltiazem']);
        const eplerenone = entry('Eplerenone', 25), pe = plan([{ action: 'add', target: eplerenone, summary: 'x' }], [eplerenone], ep);
        near(pe.creditFn(eplerenone, ep), outcomeDoseCredit(entry('Eplerenone', 25), ep), 1e-12, 'eplerenone with a moderate CYP3A inhibitor: highest allowed dose 25 mg');
        assert.equal(pe.capped.length, 1); assert.ok(/CYP3A/.test(pe.capped[0].text) && pe.capped[0].text.includes('25'), pe.capped[0].text);
    });

    check('C1 an increase earns exactly the dose credit at the new dose (not 1) and is not listed as titrated; unchanged, reduced, same-class swap, loop and Furoscix beside a loop are as before', () => {
        const q = patient([entry('Lisinopril', 5)]), cur = q.current_regimen[0], up = entry('Lisinopril', 10);
        const pc = plan([{ action: 'titrate_up', source: cur, target: up, summary: 'x' }], [up], q);
        near(pc.creditFn(up, q), outcomeDoseCredit(up, q), 1e-12);
        assert.ok(pc.creditFn(up, q) < 1);
        assert.ok(!pc.titrated.includes('Lisinopril'), 'an increase is no longer listed as valued as titrated');
        const toTarget = entry('Lisinopril', 20), pt = plan([{ action: 'titrate_up', source: cur, target: toTarget, summary: 'x' }], [toTarget], q);
        assert.equal(pt.creditFn(toTarget, q), 1);
        const same = plan([{ action: 'swap', source: entry('Metoprolol Succinate', 100), target: entry('Bisoprolol', 1.25), summary: 'x' }], [entry('Bisoprolol', 1.25)], patient());
        assert.ok(same.creditFn(entry('Bisoprolol', 1.25), patient()) < 1);
        const loopQ = congested([entry('Furosemide', 40)]), up80 = entry('Furosemide', 80);
        assert.equal(plan([{ action: 'titrate_up', source: loopQ.current_regimen[0], target: up80, summary: 'x' }], [up80], loopQ).creditFn(up80, loopQ), 1);
    });

    check('C1 in every scenario with both a no-change candidate and an increase-only candidate for a drug below its trial dose, the best increase-only candidate does not score below no change', () => {
        let compared = 0;
        for (const sc of SCENARIOS) {
            const cands = scoredCandidates(sc.patient);
            const none = cands.find(c => changes(c).length === 0);
            if (!none) continue;
            const below = (c: ScoredRegimen) => changes(c).every(m => m.action === 'titrate_up') && changes(c).length > 0
                && changes(c).some(m => m.source && outcomeDoseCredit(m.source, sc.patient) < 1);
            const ups = cands.filter(below);
            if (ups.length === 0) continue;
            compared++;
            const best = Math.max(...ups.map(c => c.raw_score!));
            assert.ok(best >= none.raw_score! - 1e-9, `${sc.title}: best increase-only ${best.toFixed(3)} is below no change ${none.raw_score!.toFixed(3)}`);
        }
        console.log(`  C1: ${compared} scenarios compared (no change versus the best increase-only candidate)`);
        assert.ok(compared > 50, `only ${compared} comparable scenarios`);
    });

    // C3. Prior shown per row.
    check('C3 each outcome contributor says which prior it used (death or hospitalization) and carries a "mostly prior" marker exactly when its weight B is below 0.2', () => {
        const q = congested([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)]);
        const loop = entry('Furosemide', 40);
        let sawMostly = false, sawNot = false;
        for (const v of buildOutcomeEstimateViews([...q.current_regimen, loop], q)) {
            for (const c of v.contributors) {
                near(c.prior_tau2, OUTCOME_TAU2[v.outcome], 1e-12, `${v.outcome} ${c.medication} prior`);
                assert.equal(c.prior_name, v.outcome === 'all_cause_death' ? 'death' : 'hospitalization');
                assert.equal(c.mostly_prior, c.shrinkage_b < 0.2, `${c.medication} B ${c.shrinkage_b}`);
                if (c.mostly_prior) sawMostly = true; else sawNot = true;
            }
        }
        assert.ok(sawMostly && sawNot, 'expected both a mostly-prior row (congested loop) and a well-measured row');
    });

    // C2. Dose credit floor.
    check('C2 dose credit floor: a drug with its own trial dose (level "drug") earns at least dose / trial dose; spironolactone 25 mg about 0.96; no credit above 1; non-decreasing on every ladder at eGFR 30, 45, 70; sibling-proxy anchors unchanged', () => {
        const anchors = DOSE_EVIDENCE.anchors as unknown as { id: string; drug: string; level: string; full_credit_daily_mg: number | null }[];
        const p = patient();
        near(outcomeDoseCredit(entry('Spironolactone', 25), p), 25 / 26, 1e-9, 'spironolactone 25 mg (RALES dose 26 mg)');
        near(outcomeDoseCredit(entry('Spironolactone', 12.5), p), 12.5 / 26, 1e-9, 'spironolactone 12.5 mg');
        // finerenone is a sibling-proxy anchor: the old curve only (c0 + (1 - c0) x progress from the starting dose)
        const fin = entry('Finerenone (Kerendia)', 20), finAnchor = anchors.find(a => a.id === 'nsmra-finerenone-egfr-ge60')!;
        assert.equal(finAnchor.level, 'siblingProxy');
        const finStart = startingDailyDose(fin, p)!, finDaily = numericDailyDose(fin);
        const oldCurve = finDaily >= finAnchor.full_credit_daily_mg! ? 1 : finDaily < finStart ? c0 * finDaily / finStart : c0 + (1 - c0) * (finDaily - finStart) / (finAnchor.full_credit_daily_mg! - finStart);
        near(outcomeDoseCredit(fin, p), oldCurve, 1e-12, 'finerenone (sibling proxy) keeps the old curve');
        for (const egfr of [30, 45, 70]) {
            const q = patient(); q.egfr = egfr;
            for (const med of MEDICATION_FORMULARY) {
                const rows = med.available_doses.flatMap(d => d.frequency_options.map(f => ({ d, f })));
                const credits = rows.map(({ d, f }) => { const r: RegimenMed = { med, dose: d, selected_frequency: f }; return { daily: numericDailyDose(r), c: outcomeDoseCredit(r, q) }; }).filter(x => !Number.isNaN(x.daily)).sort((a, b) => a.daily - b.daily);
                for (const x of credits) assert.ok(x.c <= 1 + 1e-12 && x.c >= 0, `${med.name} at eGFR ${egfr}: credit ${x.c} outside 0..1`);
                for (let i = 1; i < credits.length; i++) assert.ok(credits[i].c >= credits[i - 1].c - 1e-12, `${med.name} at eGFR ${egfr}: credit falls from ${credits[i - 1].c} at ${credits[i - 1].daily} to ${credits[i].c} at ${credits[i].daily}`);
            }
        }
        // the floor binds only for level "drug"
        for (const a of anchors.filter(x => x.level === 'drug' && x.full_credit_daily_mg !== null && x.drug !== 'Loop Diuretic')) {
            const med = MEDICATION_FORMULARY.find(m => m.name === a.drug)!;
            for (const d of med.available_doses) for (const f of d.frequency_options) {
                const r: RegimenMed = { med, dose: d, selected_frequency: f }, daily = numericDailyDose(r);
                if (Number.isNaN(daily)) continue;
                for (const egfr of [30, 70]) { const q = patient(); q.egfr = egfr; const row = anchors.filter(x => x.drug === a.drug); if (row.length > 1) continue; assert.ok(outcomeDoseCredit(r, q) >= Math.min(1, daily / a.full_credit_daily_mg!) - 1e-12, `${a.drug} ${daily}`); }
            }
        }
    });

    return { passed, failed };
}

// Raw assertion helper so a stand-alone run prints a result.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = runMeasuredModelChecks(); console.log(r); process.exitCode = r.failed ? 1 : 0;
}
