/**
 * Stage A checks for services/engine/outcomeBenefit.ts: the pure outcome-benefit calculation (trial relative risks, dose-credited, combined on the
 * log scale) and the shared dose-credit function. These use a SMALL SYNTHETIC evidence table defined here (real formulary drugs, plausible but made-up
 * numbers), so they do not depend on the real evidence file. Hand arithmetic is stated beside each expected value.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { entry, patient } from './systemicReviewChecks';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS } from '../data/scenarios';
import { clonePatient } from '../services/simulationService';
import { isTargetDoseForPatient, doseProgressToTarget, therapyDoseCredit, startingDailyDose } from '../services/engine/regimenUtils';
import { gdmtCompletenessFraction, type ScoringContext } from '../services/engine/scoring';
import { COMPLETENESS_SUBTARGET_CREDIT, COMPLETENESS_GRADED_CREDIT_SPAN } from '../services/engine/scoreModel';
import {
    efBandFor, evidenceFor, regimenOutcomeEstimate, compareOutcomeEstimate, OutcomeEvidenceError,
    OUTCOME_EVIDENCE_TABLE, populationKeyFor, outcomeDoseCredit, buildOutcomeEstimateViews, shrunkOutcomeRow,
    type OutcomeEvidenceRow, type EfBand, type OutcomeKey,
} from '../services/engine/outcomeBenefit';
import { START_DOSE_CREDIT } from '../services/engine/doseCredit';
import { WEIGHT_PROFILES, DOMAIN_KEYS, DOMAIN_GROUPS, NON_PENALIZED_WARNING_MARKERS, WARNINGS_PRICED_BY_NAMED_ADJUSTMENT } from '../services/engine/scoreModel';
import { generateAndScoreModifications } from '../services/simulationService';
import { byScoreThenCost } from '../services/engine/selection';
import type { ScoredRegimen } from '../types';
import type { Patient, RegimenMed } from '../types';

const ENTRESTO = 'Sacubitril/Valsartan (Entresto)';
const row = (id: string, drug_class: string, drugs: string[], rr: number, lo: number | null, hi: number | null,
    over: Partial<OutcomeEvidenceRow> = {}): OutcomeEvidenceRow => ({
    id, drug_class, drugs, ef_band: 'reduced' as EfBand, outcome: 'all_cause_death' as OutcomeKey, rr, ci_low: lo, ci_high: hi,
    measure: 'HR', basis: 'trial', source: { trial: `SYN-${id}`, citation: `Synthetic ${id}` }, population: 'synthetic', comparator: 'placebo',
    verification: 'synthetic', quote: '', extrapolation: '', notes: '', ...over,
});
// Reduced-EF, all-cause death. SGLT2i has TWO rows (different drugs) in one mechanism group.
const TABLE: OutcomeEvidenceRow[] = [
    row('ace', 'ACEi', ['Lisinopril', 'Enalapril'], 0.80, 0.70, 0.91),
    row('arni', 'ARNI', [ENTRESTO], 0.84, 0.76, 0.93),
    row('bb', 'Beta Blocker', ['Metoprolol Succinate', 'Carvedilol'], 0.66, 0.53, 0.81),
    row('mra', 'MRA', ['Spironolactone'], 0.70, 0.58, 0.85),
    row('dapa', 'SGLT2i', ['Dapagliflozin'], 0.83, 0.71, 0.97),
    row('empa', 'SGLT2i', ['Empagliflozin'], 0.87, 0.75, 1.01),
    row('furo', 'Loop Diuretic', ['Furosemide'], 1.0, null, null, { basis: 'assumed_neutral' }),
    row('ace-h', 'ACEi', ['Lisinopril', 'Enalapril'], 0.70, 0.60, 0.82, { outcome: 'hf_hospitalization' }),
];
const DEATH: OutcomeKey = 'all_cause_death';
const near = (a: number, b: number, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const se = (lo: number, hi: number) => (Math.log(hi) - Math.log(lo)) / 3.92;
const bounds = (lnRr: number, variance: number) => [Math.exp(lnRr - 1.96 * Math.sqrt(variance)), Math.exp(lnRr + 1.96 * Math.sqrt(variance))];

export function runOutcomeBenefitChecks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] Outcome benefit: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] Outcome benefit: ${name}: ${e}`); }
    };
    const withEf = (lvef: number, prior?: number): Patient => { const p = patient(); p.lvef = lvef; p.previous_lvef = prior; return p; };
    const est = (regimen: RegimenMed[], p = patient(), table = TABLE, outcome = DEATH) => regimenOutcomeEstimate(table, regimen, p, outcome, undefined, therapyDoseCredit, false);

    check('EF band resolution (40, 41, 49, 50, improved EF, prior 45 now 55)', () => {
        assert.equal(efBandFor(withEf(40)), 'reduced');
        assert.equal(efBandFor(withEf(41)), 'mildly_reduced');
        assert.equal(efBandFor(withEf(49)), 'mildly_reduced');
        assert.equal(efBandFor(withEf(50)), 'preserved');
        assert.equal(efBandFor(withEf(55, 30)), 'reduced');          // improved EF: continue at the earlier band (extrapolation)
        assert.equal(efBandFor(withEf(55, 45)), 'mildly_reduced');
        assert.equal(efBandFor(withEf(55)), 'preserved');
        assert.equal(efBandFor(withEf(35, 60)), 'reduced');           // current LVEF governs when it is <= 40
    });

    check('missing row throws a named error; a missing estimate is never 1.0', () => {
        const p = patient();
        assert.throws(() => evidenceFor(TABLE, 'Digoxin', p, DEATH), (e: unknown) => e instanceof OutcomeEvidenceError && e.code === 'missing');
        assert.throws(() => evidenceFor(TABLE, 'Lisinopril', withEf(55), DEATH), OutcomeEvidenceError);     // preserved band: no row
        assert.throws(() => est([entry('Empagliflozin', 10)], patient(), TABLE.filter(r => r.id !== 'empa')), OutcomeEvidenceError);
    });

    check('duplicate rows throw a named error', () => {
        const dup = [...TABLE, row('dapa2', 'SGLT2i', ['Dapagliflozin'], 0.8, 0.7, 0.9)];
        assert.throws(() => evidenceFor(dup, 'Dapagliflozin', patient(), DEATH), (e: unknown) => e instanceof OutcomeEvidenceError && e.code === 'duplicate');
    });

    check('population_key selects the matching row, else the unkeyed / "other" row', () => {
        const t = [
            row('mra-x', 'MRA', ['Spironolactone'], 0.60, 0.5, 0.7, { ef_band: 'mildly_reduced', population_key: 'ef_lower' }),
            row('mra-o', 'MRA', ['Spironolactone'], 0.90, 0.8, 1.0, { ef_band: 'mildly_reduced', population_key: 'other' }),
        ];
        const p = withEf(45);
        assert.equal(evidenceFor(t, 'Spironolactone', p, DEATH, 'ef_lower').id, 'mra-x');
        assert.equal(evidenceFor(t, 'Spironolactone', p, DEATH).id, 'mra-o');
        assert.equal(evidenceFor(t, 'Spironolactone', p, DEATH, 'unlisted_key').id, 'mra-o');
        const unkeyed = [t[0], { ...t[1], population_key: undefined }];
        assert.equal(evidenceFor(unkeyed, 'Spironolactone', p, DEATH).id, 'mra-o');
        // And through the regimen estimate: the callback supplies the key.
        const e = regimenOutcomeEstimate(t, [entry('Spironolactone', 50)], p, DEATH, () => 'ef_lower', therapyDoseCredit, false);
        near(e.rr, 0.60, 1e-12);
    });

    check('product and interval math at target doses (hand-computed)', () => {
        // ACEi 0.80 (0.70-0.91) x beta blocker 0.66 (0.53-0.81), both at target (credit 1).
        // RR = 0.80 x 0.66 = 0.528; score = 100 x (1 - 0.528) = 47.2.
        // se_ace = (ln .91 - ln .70)/3.92 = 0.066929; se_bb = (ln .81 - ln .53)/3.92 = 0.108203; var = 0.004479 + 0.011708 = 0.016187.
        // bounds = exp(ln .528 -/+ 1.96 x sqrt(.016187)) = exp(-0.638659 -/+ 0.249365) = 0.41147 .. 0.67754.
        const e = est([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)]);
        near(e.rr, 0.528, 1e-12); near(e.score, 47.2, 1e-9);
        near(e.ci_low!, 0.41147, 1e-4); near(e.ci_high!, 0.67754, 1e-4);
        const [lo, hi] = bounds(Math.log(0.8) + Math.log(0.66), se(0.70, 0.91) ** 2 + se(0.53, 0.81) ** 2);
        near(e.ci_low!, lo, 1e-12); near(e.ci_high!, hi, 1e-12);
        assert.equal(e.contributors.length, 2);
        const c = e.contributors.find(x => x.medication === 'Lisinopril')!;
        assert.deepEqual([c.row_id, c.drug_class, c.class_group, c.rr, c.credit, c.dose_adjusted_rr, c.basis, c.trial],
            ['ace', 'ACEi', 'RAAS Inhibitor', 0.8, 1, 0.8, 'trial', 'SYN-ace']);
        assert.equal(c.citation, 'Synthetic ace');
        assert.deepEqual(e.contributors_without_interval, []);
    });

    check('contributors lacking an interval are reported and add no variance', () => {
        const e = est([entry('Lisinopril', 20), entry('Furosemide', 40)]);
        assert.deepEqual(e.contributors_without_interval, ['Furosemide']);
        const [lo, hi] = bounds(Math.log(0.8), se(0.70, 0.91) ** 2);
        near(e.ci_low!, lo, 1e-12); near(e.ci_high!, hi, 1e-12);
    });

    // Stage-A arithmetic checks: the calculation module is exercised WITHOUT precision weighting (shrink = false) and with the ORIGINAL therapyDoseCredit (0.6 at start) passed explicitly, so the log-scale arithmetic stays pinned
    // while the engine itself now uses the trial-anchored outcomeDoseCredit (doseCredit.ts).
    check('dose credit: starting dose gives rr^0.6, target gives rr, mid-dose in between', () => {
        const ace = (s: number) => est([entry('Lisinopril', s)]);
        near(ace(2.5).rr, Math.pow(0.8, 0.6), 1e-12);                     // 0.8^0.6 = 0.87454
        near(ace(2.5).contributors[0].credit, 0.6, 1e-12);
        near(ace(20).rr, 0.8, 1e-12);
        // Lisinopril 10 mg: progress (10-2.5)/(20-2.5) = 3/7, credit = 0.6 + 0.4 x 3/7 = 0.771429, rr = 0.8^0.771429 = 0.84186.
        near(ace(10).contributors[0].credit, 0.6 + 0.4 * 3 / 7, 1e-9);
        near(ace(10).rr, Math.pow(0.8, 0.6 + 0.4 * 3 / 7), 1e-9);
        assert.ok(ace(2.5).rr > ace(10).rr && ace(10).rr > ace(20).rr);
        // Interval scales with credit: se x 0.6 at the starting dose.
        const [lo, hi] = bounds(0.6 * Math.log(0.8), (0.6 * se(0.70, 0.91)) ** 2);
        near(ace(2.5).ci_low!, lo, 1e-12); near(ace(2.5).ci_high!, hi, 1e-12);
    });

    check('therapyDoseCredit reproduces the completeness domain exactly (every formulary drug, every dose)', () => {
        const p = patient();
        const ctx = { patient: p } as unknown as ScoringContext;
        // The pre-refactor per-slot logic, copied verbatim as the reference.
        const legacy = (r: RegimenMed): number => {
            const doses = r.med.available_doses;
            if (doses.length === 1) return 1;
            const atTarget = isTargetDoseForPatient(r, p);
            const strengths = doses.map(d => Number(d.strength)).filter(n => !Number.isNaN(n));
            const atMax = strengths.length > 0 && Number(r.dose.strength) >= Math.max(...strengths);
            const cap = r.med.interaction_dose_cap?.(p);
            const atCap = !!cap && Number(r.dose.strength) >= cap.max_dose;
            if (atTarget || atMax || atCap) return 1;
            const progress = doseProgressToTarget(r, p);
            return progress === undefined ? COMPLETENESS_SUBTARGET_CREDIT : COMPLETENESS_SUBTARGET_CREDIT + COMPLETENESS_GRADED_CREDIT_SPAN * progress;
        };
        let n = 0;
        for (const med of MEDICATION_FORMULARY) for (const dose of med.available_doses) {
            const r: RegimenMed = { med, dose, selected_frequency: dose.frequency_options[0] };
            assert.equal(therapyDoseCredit(r, p), legacy(r), `${med.name} ${dose.strength}`);
            assert.equal(gdmtCompletenessFraction({ modifications: [], resulting_regimen: [r] }, ctx, [{ match: c => c === med.drug_class }]).fraction, legacy(r), `${med.name} ${dose.strength} via completeness`);
            n++;
        }
        assert.ok(n > 50);
        // Several multi-drug slots: the slot takes its best drug.
        const reg = [entry('Lisinopril', 2.5), entry('Enalapril', 10), entry('Metoprolol Succinate', 25)];
        const f = gdmtCompletenessFraction({ modifications: [], resulting_regimen: reg }, ctx, [{ match: c => c === 'ACEi' }, { match: c => c === 'Beta Blocker' }, { match: c => c === 'MRA' }]);
        near(f.fraction, (1 + therapyDoseCredit(reg[2], p) + 0) / 3, 1e-12);
    });

    check('two drugs in one mechanism group: only the stronger counts, the other is listed as not counted', () => {
        // Dapagliflozin 0.83 vs empagliflozin 0.87 (both single-dose, credit 1): dapagliflozin counts.
        const e = est([entry('Empagliflozin', 10), entry('Dapagliflozin', 10)]);
        near(e.rr, 0.83, 1e-12);
        assert.deepEqual(e.contributors.map(c => c.medication), ['Dapagliflozin']);
        assert.equal(e.not_counted.length, 1);
        assert.equal(e.not_counted[0].medication, 'Empagliflozin');
        assert.match(e.not_counted[0].reason, /same mechanism group/);
        // The comparison is on DOSE-ADJUSTED rr: lisinopril at its starting dose (0.8^0.6 = 0.8745) loses to Entresto at target (0.84).
        const e2 = est([entry('Lisinopril', 2.5), entry(ENTRESTO, '97/103')]);
        near(e2.rr, 0.84, 1e-12); assert.equal(e2.contributors[0].medication, ENTRESTO);
    });

    check('monotonicity: add / remove / up-titrate / neutral drug', () => {
        const base = [entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)];
        const s0 = est(base).score;
        const withMra = est([...base, entry('Spironolactone', 50)]).score;
        assert.ok(withMra > s0);
        near(withMra, 100 * (1 - 0.528 * 0.70), 1e-9);                      // 0.528 x 0.70 = 0.3696 -> 63.04
        assert.ok(est([base[0]]).score < s0);                                // removing the beta blocker lowers it
        assert.ok(est([entry('Lisinopril', 10), base[1]]).score < s0);       // lisinopril 10 -> 20 raises it
        assert.ok(est([entry('Lisinopril', 2.5), base[1]]).score < est([entry('Lisinopril', 10), base[1]]).score);
        const neutral = est([...base, entry('Furosemide', 80)]);
        assert.equal(neutral.score, s0); assert.equal(neutral.rr, est(base).rr);
        near(neutral.ci_low!, est(base).ci_low!, 1e-12);
    });

    check('empty regimen: rr 1, score 0', () => {
        const e = est([]);
        assert.equal(e.rr, 1); assert.equal(e.score, 0); assert.deepEqual(e.contributors, []);
        assert.equal(e.ci_low, 1); assert.equal(e.ci_high, 1);
    });

    check('an estimate above 1 lowers the score and is clamped at 0, never negative', () => {
        const harm = [row('furo-h', 'Loop Diuretic', ['Furosemide'], 1.25, 1.05, 1.5)];
        const e = est([entry('Furosemide', 160)], patient(), harm);
        near(e.rr, 1.25, 1e-12); assert.equal(e.score, 0);
        // Harm offsets benefit: 0.8 x 1.25 = 1.0 -> score 0; and a beta blocker added pulls the product below 1 again.
        const both = [...TABLE.filter(r => r.id === 'ace'), ...harm];
        assert.equal(est([entry('Lisinopril', 20), entry('Furosemide', 160)], patient(), both).score, 0);
        near(est([entry('Lisinopril', 20), entry('Furosemide', 160)], patient(), both).rr, 1.0, 1e-12);
    });

    check('compare: identical regimens give exactly 1 (interval 1 to 1)', () => {
        const reg = [entry('Lisinopril', 10), entry('Metoprolol Succinate', 100)];
        const c = compareOutcomeEstimate(TABLE, reg, [...reg].reverse(), patient(), DEATH, undefined, therapyDoseCredit, therapyDoseCredit, false);
        assert.equal(c.rr, 1); assert.equal(c.ci_low, 1); assert.equal(c.ci_high, 1);
        const e = compareOutcomeEstimate(TABLE, [], [], patient(), DEATH, undefined, therapyDoseCredit, therapyDoseCredit, false);
        assert.equal(e.rr, 1); assert.equal(e.ci_low, 1); assert.equal(e.ci_high, 1);
    });

    check('compare: adding one drug gives that drug\'s dose-adjusted rr and its interval; removing gives the inverse', () => {
        const cur = [entry('Lisinopril', 20)];
        // Spironolactone 50 (credit 1): ratio 0.70, se = (ln .85 - ln .58)/3.92 = 0.097502, bounds exp(ln .7 -/+ 0.191104) = 0.57823 .. 0.84741.
        const c = compareOutcomeEstimate(TABLE, [...cur, entry('Spironolactone', 50)], cur, patient(), DEATH, undefined, therapyDoseCredit, therapyDoseCredit, false);
        near(c.rr, 0.70, 1e-12); near(c.ci_low!, 0.57823, 1e-4); near(c.ci_high!, 0.84741, 1e-4);
        // Spironolactone 25 (credit 0.6): ratio 0.7^0.6 = 0.80734, se x 0.6 -> bounds 0.71988 .. 0.90543.
        const c2 = compareOutcomeEstimate(TABLE, [...cur, entry('Spironolactone', 25)], cur, patient(), DEATH, undefined, therapyDoseCredit, therapyDoseCredit, false);
        near(c2.rr, Math.pow(0.7, 0.6), 1e-12); near(c2.ci_low!, 0.71988, 1e-4); near(c2.ci_high!, 0.90543, 1e-4);
        const r = compareOutcomeEstimate(TABLE, cur, [...cur, entry('Spironolactone', 50)], patient(), DEATH, undefined, therapyDoseCredit, therapyDoseCredit, false);
        near(r.rr, 1 / 0.70, 1e-12);
    });

    check('compare: same row before and after uses ((c_new - c_old) x se)^2', () => {
        // Lisinopril 10 -> 20: c_old = 0.771429, c_new = 1. ratio = 0.8^(1 - 0.771429) = 0.95027; bounds 0.92220 .. 0.97920.
        const c = compareOutcomeEstimate(TABLE, [entry('Lisinopril', 20)], [entry('Lisinopril', 10)], patient(), DEATH, undefined, therapyDoseCredit, therapyDoseCredit, false);
        near(c.rr, Math.pow(0.8, 1 - (0.6 + 0.4 * 3 / 7)), 1e-9);
        near(c.ci_low!, 0.92220, 1e-4); near(c.ci_high!, 0.97920, 1e-4);
        // Switching Lisinopril -> Enalapril: same evidence row (ace), both at target: nothing changes.
        const same = compareOutcomeEstimate(TABLE, [entry('Enalapril', 20)], [entry('Lisinopril', 20)], patient(), DEATH, undefined, therapyDoseCredit, therapyDoseCredit, false);
        assert.equal(same.rr, 1); assert.equal(same.ci_low, 1); assert.equal(same.ci_high, 1);
    });

    check('compare: a within-group swap with different rows adds both rows\' variances', () => {
        // ACE inhibitor (0.80) -> sacubitril/valsartan (0.84), both at target: ratio 0.84/0.80 = 1.05.
        // var = se_arni^2 + se_ace^2 with se_arni = (ln .93 - ln .76)/3.92 = 0.051349 and se_ace = 0.066929; bounds 0.88983 .. 1.23900.
        const c = compareOutcomeEstimate(TABLE, [entry(ENTRESTO, '97/103')], [entry('Lisinopril', 20)], patient(), DEATH, undefined, therapyDoseCredit, therapyDoseCredit, false);
        near(c.rr, 1.05, 1e-12); near(c.ci_low!, 0.88983, 1e-4); near(c.ci_high!, 1.23900, 1e-4);
        const [lo, hi] = bounds(Math.log(0.84) - Math.log(0.8), se(0.76, 0.93) ** 2 + se(0.70, 0.91) ** 2);
        near(c.ci_low!, lo, 1e-12); near(c.ci_high!, hi, 1e-12);
    });

    check('hospitalization outcome reads its own rows and compares with the same band', () => {
        const e = est([entry('Lisinopril', 20)], patient(), TABLE, 'hf_hospitalization');
        near(e.rr, 0.70, 1e-12);
        assert.throws(() => est([entry('Metoprolol Succinate', 200)], patient(), TABLE, 'hf_hospitalization'), OutcomeEvidenceError);
    });

    check('patient measurements and Sets are never altered', () => {
        const p = patient([entry('Lisinopril', 10)]); p.comorbidities = new Set(['diabetes']);
        const before = clonePatient(p);
        est(p.current_regimen); compareOutcomeEstimate(TABLE, [entry('Lisinopril', 20)], p.current_regimen, p, DEATH, undefined, therapyDoseCredit, therapyDoseCredit, false);
        assert.deepEqual(p.comorbidities, before.comorbidities); assert.equal(p.lvef, before.lvef); assert.equal(p.egfr, before.egfr);
        assert.equal(p.current_regimen.length, before.current_regimen.length);
    });

    return { passed, failed };
}

const LEGACY = ['neurohormonal', 'functional', 'volume', 'structure'] as const;
const ALL_NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));
const PRICES = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
const runEngine = (p: Patient) => generateAndScoreModifications(p, ALL_NAMES, PRICES);
const changes = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
const addsOrRaises = (r: ScoredRegimen, name: string) => changes(r).some(m => (m.action === 'add' || m.action === 'titrate_up') && m.target?.med.name === name);

/** Stage B1 checks: the evidence table as the engine's single source, and the two outcome domains end to end. */
export function runOutcomeEngineChecks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] Outcome engine: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] Outcome engine: ${name}: ${e}`); }
    };
    const inBand = (band: EfBand): Patient => { const p = patient(); p.lvef = band === 'reduced' ? 30 : band === 'mildly_reduced' ? 45 : 60; return p; };
    const bands: EfBand[] = ['reduced', 'mildly_reduced', 'preserved'];
    const outcomes: OutcomeKey[] = ['all_cause_death', 'hf_hospitalization'];
    const baseRegimen = () => [entry('Lisinopril', 20), entry('Metoprolol Succinate', 200)];

    check('evidence table: every formulary drug x 3 bands x 2 outcomes x both population keys resolves', () => {
        assert.equal(OUTCOME_EVIDENCE_TABLE.length, 114);   // 102 + 6: each loop-diuretic row became a congested and an other row (2026-11-16); + 3 beta-blocker rhythm rows (change C4, 2026-11-18), rewritten by E1 (2026-11-19): the derived sinus row is gone, the atrial fibrillation rows are measured subgroups and one atrial fibrillation hospitalization row was added: 111 before the K+ binder split; E8 then added three rows (sodium zirconium cyclosilicate hospitalization, one per band): 114
        for (const med of MEDICATION_FORMULARY) for (const band of bands) for (const o of outcomes) for (const black of [false, true]) {
            const p = inBand(band); if (black) p.race = 'Black';
            const r = evidenceFor(OUTCOME_EVIDENCE_TABLE, med, p, o, populationKeyFor(med, p));
            assert.ok(r.rr > 0, `${med.name} ${band} ${o}`);
        }
    });

    check('evidence table: siblings share one row; ARNI / ACEi / ARB and MRA / nsMRA are separate classes', () => {
        for (const band of bands) for (const o of outcomes) for (const black of [false, true]) {
            const p = inBand(band); if (black) p.race = 'Black';
            const byClass = new Map<string, Set<string>>();
            for (const med of MEDICATION_FORMULARY) {
                const id = evidenceFor(OUTCOME_EVIDENCE_TABLE, med, p, o, populationKeyFor(med, p)).id;
                (byClass.get(med.drug_class) ?? byClass.set(med.drug_class, new Set()).get(med.drug_class)!).add(id);
            }
            // E8 (2026-11-19): the K+ binder hospitalization rows are drug-specific on purpose (patiromer: no outcome evidence; sodium zirconium cyclosilicate: the REALIZE-K signal)
            for (const [cls, ids] of byClass) assert.equal(ids.size, cls === 'K+ Binder' && o === 'hf_hospitalization' ? 2 : 1, `${cls} siblings resolve to different rows in ${band}/${o}: ${[...ids].join(', ')}`);
            const idOf = (cls: string) => [...byClass.get(cls)!][0];
            assert.equal(new Set([idOf('ARNI'), idOf('ACEi'), idOf('ARB')]).size, 3);
            assert.notEqual(idOf('MRA'), idOf('nsMRA'));
        }
        const p = inBand('reduced');
        const g = (n: string) => evidenceFor(OUTCOME_EVIDENCE_TABLE, n, p, 'all_cause_death').id;
        assert.equal(g('Semaglutide (Wegovy)'), g('Tirzepatide (Zepbound)'));
    });

    check('evidence table: intervals bracket the estimate and every row cites a source', () => {
        for (const r of OUTCOME_EVIDENCE_TABLE) {
            if (r.ci_low !== null || r.ci_high !== null) { assert.ok(r.ci_low !== null && r.ci_high !== null, r.id); assert.ok(r.ci_low! <= r.rr && r.rr <= r.ci_high!, `${r.id}: ${r.ci_low} <= ${r.rr} <= ${r.ci_high}`); }
            assert.ok(r.source.citation.trim().length > 0 && r.source.trial.trim().length > 0, `${r.id} lacks a citation`);
        }
    });

    // Rewritten 2026-11-18 (change C4): beta-blockers are now keyed by CURRENT rhythm; the old check asserted that only two classes are keyed.
    check('populationKeyFor: only the vasodilator (self-identified race), loop-diuretic (congestion) and beta-blocker (current rhythm) classes are keyed', () => {
        const hid = MEDICATION_FORMULARY.find(m => m.drug_class === 'Vasodilator')!;
        const black = patient(); black.race = 'Black';
        assert.equal(populationKeyFor(hid, black), 'self_identified_black');
        assert.equal(populationKeyFor(hid, patient()), 'other');
        const bb = MEDICATION_FORMULARY.find(m => m.drug_class === 'Beta Blocker')!, sinus = patient(); sinus.rhythm = 'Sinus'; const af = patient(); af.rhythm = 'AFib';
        assert.equal(populationKeyFor(bb, af), 'atrial_fibrillation'); assert.equal(populationKeyFor(bb, sinus), 'other');
        for (const m of MEDICATION_FORMULARY.filter(m => m.drug_class !== 'Vasodilator' && m.drug_class !== 'Loop Diuretic' && m.drug_class !== 'Beta Blocker')) assert.equal(populationKeyFor(m, black), undefined, m.name);
    });

    check('weights: every profile sums to 1; the four legacy domains weigh 0 and are not assessed', () => {
        for (const [name, w] of Object.entries(WEIGHT_PROFILES)) {
            near(DOMAIN_KEYS.reduce((s, k) => s + w[k], 0), 1, 1e-9, name);
            for (const k of LEGACY) assert.equal(w[k], 0, `${name}.${k}`);
        }
        assert.equal(DOMAIN_GROUPS[0].key, 'benefit');
        assert.deepEqual([...DOMAIN_GROUPS[0].domains], ['mortality', 'hf_hospitalization', 'symptoms']);
        assert.deepEqual([...DOMAIN_KEYS.slice(0, 2)], ['mortality', 'hf_hospitalization']);
        const out = runEngine(patient(baseRegimen()));
        assert.ok(out.scoredRegimens.length > 0);
        for (const r of out.scoredRegimens) for (const k of LEGACY) {
            const line = r.score_breakdown!.domains.find(d => d.key === k)!;
            assert.equal(line.assessed, false); assert.equal(line.weight, 0);
        }
    });

    check('measurements: every returned option keeps the entered recorded values', () => {
        const p = patient(baseRegimen());
        const out = runEngine(p);
        for (const r of out.scoredRegimens) {
            const q = r.projected_patient;
            for (const k of ['sbp', 'dbp', 'pulse', 'potassium', 'lvef', 'nt_pro_bnp', 'kccq_score', 'nyha_class', 'egfr'] as const) assert.equal(q[k], p[k], k);
            assert.equal(q.volume_status.current_weight_kg, p.volume_status.current_weight_kg);
            assert.equal(q.volume_status.dry_weight_kg, p.volume_status.dry_weight_kg);
        }
    });

    check('reduced EF on ACE inhibitor + beta-blocker: adding an MRA or SGLT2 inhibitor raises both outcome domains; no change is exactly 1', () => {
        const out = runEngine(patient(baseRegimen()));
        const keep = out.scoredRegimens.find(r => changes(r).length === 0);
        const adds = out.scoredRegimens.filter(r => addsOrRaises(r, 'Spironolactone') || addsOrRaises(r, 'Eplerenone') || addsOrRaises(r, 'Dapagliflozin') || addsOrRaises(r, 'Empagliflozin'));
        assert.ok(adds.length > 0, 'an MRA or SGLT2 inhibitor option should be offered');
        for (const r of adds) {
            const e = r.outcome_estimates!;
            for (const o of e) { assert.ok(o.vs_current.rr < 1); assert.ok(o.vs_current.ci_low < o.vs_current.rr && o.vs_current.rr < o.vs_current.ci_high); }
        }
        // Compare against the no-change regimen scored directly (the no-change option may be filtered out of the top three).
        const base = adds[0];
        const kept = keep ?? undefined;
        if (kept) {
            assert.ok(base.domain_scores.mortality > kept.domain_scores.mortality);
            assert.ok(base.domain_scores.hf_hospitalization > kept.domain_scores.hf_hospitalization);
            for (const o of kept.outcome_estimates!) assert.equal(o.vs_current.rr, 1);
        }
        const p = patient(baseRegimen());
        const keepEst = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, p.current_regimen, p, 'all_cause_death', populationKeyFor);
        assert.ok(base.score_breakdown!.domains.find(d => d.key === 'mortality')!.score > keepEst.score);
    });

    check('full quadruple therapy at target: no-change is exactly relative risk 1 with an interval of 1 to 1', () => {
        const out = runEngine(patient([entry(ENTRESTO, '97/103'), entry('Metoprolol Succinate', 200), entry('Spironolactone', 50), entry('Dapagliflozin', 10)]));
        const keep = out.scoredRegimens.find(r => changes(r).length === 0);
        assert.ok(keep, 'no-change option should be returned for a fully treated patient');
        for (const o of keep!.outcome_estimates!) { assert.equal(o.vs_current.rr, 1); assert.equal(o.vs_current.ci_low, 1); assert.equal(o.vs_current.ci_high, 1); }
    });

    check('removing or reducing a drug with rr < 1 gives vs_current.rr above 1', () => {
        const p = patient([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200), entry('Spironolactone', 25), entry('Dapagliflozin', 10)]);
        p.potassium = 6.1;                               // continuation rule: the MRA is withheld (and the RAAS inhibitor stopped) in every option
        const out = runEngine(p);
        const reducing = out.scoredRegimens.filter(r => changes(r).some(m => (m.action === 'titrate_down' || m.action === 'remove') && m.source?.med.name === 'Spironolactone'));
        assert.ok(reducing.length > 0, 'expected an option that removes the MRA');
        for (const r of reducing) for (const o of r.outcome_estimates!) assert.ok(o.vs_current.rr > 1, `${o.outcome} ${o.vs_current.rr}`);
    });

    check('sibling rule end to end: carvedilol vs metoprolol succinate at target leave both outcome domains unchanged', () => {
        const mk = (bb: RegimenMed) => { const p = patient([entry('Lisinopril', 20), bb]); const out = runEngine(p); return { p, out }; };
        const a = mk(entry('Carvedilol', 25)), b = mk(entry('Metoprolol Succinate', 200));
        assert.ok(a.p.current_regimen.every(r => therapyDoseCredit(r, a.p) === 1) && b.p.current_regimen.every(r => therapyDoseCredit(r, b.p) === 1));
        // The returned options are the same plans (add an MRA / SGLT2 inhibitor / digoxin) on either beta-blocker, so their outcome domains must match exactly.
        const sig = (r: ScoredRegimen) => changes(r).map(m => `${m.action}:${m.target?.med.name ?? m.source?.med.name}`).sort().join('|');
        assert.ok(a.out.scoredRegimens.length > 0);
        let compared = 0;
        for (const ra of a.out.scoredRegimens) {
            const rb = b.out.scoredRegimens.find(r => sig(r) === sig(ra));
            if (!rb) continue;
            compared++;
            for (const k of ['mortality', 'hf_hospitalization'] as const) {
                assert.equal(ra.score_breakdown!.domains.find(d => d.key === k)!.score, rb.score_breakdown!.domains.find(d => d.key === k)!.score, k);
                assert.equal(ra.domain_scores[k], rb.domain_scores[k]);
            }
        }
        assert.ok(compared > 0, 'at least one identical plan on both beta-blockers');
        // Direct swap of the same regimen, scored by the calculation: identical.
        for (const o of outcomes) {
            const x = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, a.p.current_regimen, a.p, o, populationKeyFor);
            const y = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, b.p.current_regimen, b.p, o, populationKeyFor);
            assert.equal(x.rr, y.rr);
        }
    });

    check('hydralazine / isosorbide dinitrate: Black and non-Black patients get different rows end to end', () => {
        const mk = (race?: string) => {
            const p = patient([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200), entry('Hydralazine/Isosorbide Dinitrate', MEDICATION_FORMULARY.find(m => m.name === 'Hydralazine/Isosorbide Dinitrate')!.available_doses.at(-1)!.strength)]);
            if (race) p.race = race as Patient['race'];
            return p;
        };
        const idsOf = (p: Patient) => {
            const keep = runEngine(p).scoredRegimens.find(r => r.regimen.some(m => m.med.drug_class === 'Vasodilator'))!;
            assert.ok(keep, 'an option keeping the vasodilator');
            return keep.outcome_estimates!.flatMap(o => o.contributors.filter(c => c.medication.startsWith('Hydralazine')).map(c => c.row_id));
        };
        const black = idsOf(mk('Black')), other = idsOf(mk());
        assert.ok(black.length === 2 && other.length === 2);
        assert.ok(black.every(id => id.includes('black')) && other.every(id => id.includes('other')), `${black} / ${other}`);
    });

    // Rewritten 2026-11-18 (C4) and again 2026-11-19 (E1): for a patient in atrial fibrillation the beta-blocker figures are the measured subgroup 0.97 (death) and the extrapolated 0.847 (hospitalization);
    // for sinus and other rhythms they are the three-trial pool 0.66 and CIBIS-II 0.64.
    check('hand-computed four-drug reduced-EF regimen at target: death 0.72 x (0.66 sinus or 0.97 atrial fibrillation) x 0.73 x 0.87, hospitalization 0.51 x (0.64 sinus or 0.847 atrial fibrillation) x 0.63 x 0.72', () => {
        const p = patient();   // the shared fixture is in atrial fibrillation
        const reg = [entry(ENTRESTO, '97/103'), entry('Metoprolol Succinate', 200), entry('Spironolactone', 50), entry('Dapagliflozin', 10)];
        // PUBLISHED figures (no precision weighting): the hand arithmetic is about the table's own numbers.
        const d = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, reg, p, 'all_cause_death', populationKeyFor, undefined, false);
        const h = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, reg, p, 'hf_hospitalization', populationKeyFor, undefined, false);
        near(d.rr, 0.72 * 0.97 * 0.73 * 0.87, 5e-4, 'death (atrial fibrillation)');
        near(h.rr, 0.51 * 0.847 * 0.63 * 0.72, 1e-3, 'hospitalization (atrial fibrillation)');
        const sinus = patient(); sinus.rhythm = 'Sinus';
        near(regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, reg, sinus, 'all_cause_death', populationKeyFor, undefined, false).rr, 0.72 * 0.66 * 0.73 * 0.87, 5e-4, 'death (sinus)');
        near(regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, reg, sinus, 'hf_hospitalization', populationKeyFor, undefined, false).rr, 0.51 * 0.64 * 0.63 * 0.72, 5e-4, 'hospitalization (sinus)');
    });

    check('a medication recorded as held earns no outcome credit, in the current regimen or in any option', () => {
        const held = entry('Metoprolol Succinate', 200); held.exposure = { status: 'held', adherence: 'unknown', restart_or_repeat_reviewed: false };
        const p = patient([entry('Lisinopril', 20)]);
        p.current_regimen.push(held);
        const out = runEngine(p);
        assert.ok(out.scoredRegimens.length > 0);
        const keep = out.scoredRegimens.find(r => changes(r).length === 0);
        if (keep) for (const o of keep.outcome_estimates!) assert.ok(!o.contributors.some(c => c.medication === 'Metoprolol Succinate'));
        for (const r of out.scoredRegimens) if (!r.regimen.some(m => m.med.name === 'Metoprolol Succinate'))
            for (const o of r.outcome_estimates!) assert.ok(!o.contributors.some(c => c.medication === 'Metoprolol Succinate'));
        // The calculation itself refuses to credit a held entry even if one is passed in.
        const direct = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, p.current_regimen, p, 'all_cause_death', populationKeyFor);
        assert.ok(!direct.contributors.some(c => c.medication === 'Metoprolol Succinate'));
    });

    check('every warning marker (non-penalized and priced-by-named-adjustment) matches text the engine can emit', () => {
        // Scan the engine source for each marker in NON-COMMENT code (a marker that survives only in a comment or in scoreModel.ts itself is stale).
        const root = join(import.meta.dirname, '..');
        const files = [...readdirSync(join(root, 'services/engine')).filter(f => f.endsWith('.ts') && f !== 'scoreModel.ts').map(f => join(root, 'services/engine', f)),
            join(root, 'constants.ts'), join(root, 'services/clinicalPredicates.ts')];
        const code = files.map(f => readFileSync(f, 'utf8').split('\n').filter(l => { const t = l.trim(); return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')); }).join('\n')).join('\n');
        const stale = [...NON_PENALIZED_WARNING_MARKERS, ...WARNINGS_PRICED_BY_NAMED_ADJUSTMENT].filter(m => !code.includes(m));
        assert.deepEqual(stale, [], `markers matching no emitted warning: ${stale.join(' | ')}`);
    });

    check('HFimpEF (Prior LVEF 25, Now 45): the up-titration option does not rank below no change', () => {
        const sc = SCENARIOS.find(s => s.title === 'HFimpEF (Prior LVEF 25, Now 45)')!;
        const out = generateAndScoreModifications({ ...sc.patient, insurance_tier: 'cash' }, ALL_NAMES, PRICES);
        const idx = (pred: (r: ScoredRegimen) => boolean) => out.scoredRegimens.findIndex(pred);
        const up = idx(r => changes(r).some(m => m.action === 'titrate_up')), keep = idx(r => changes(r).length === 0);
        assert.ok(up >= 0 && keep >= 0, 'both options expected');
        // Rewritten 2026-11-19 (ruling U4): the titration leads unless it is less than one point above no change, in which case "No medication change" is listed first by the stated rule.
        const gap = out.scoredRegimens[up].raw_score! - out.scoredRegimens[keep].raw_score!;
        assert.ok(gap >= 0, `titration scores ${gap} against no change`);
        assert.ok(up < keep || (keep === 0 && gap < 1), `titration at ${up}, no change at ${keep}, gap ${gap}`);
    });

    // Rewritten 2026-11-18 (change C2): spironolactone has its own trial dose (RALES 26 mg), so credit is never below dose / 26; the old check asserted c0 at the label start dose for it.
    check('outcome dose credit: at the label start dose the larger of c0 and dose / trial dose (spironolactone: dose / 26), below it proportional, completeness credit untouched', () => {
        const c0 = START_DOSE_CREDIT.value;
        const p = patient();                                   // eGFR 70
        const spiro = (d: number) => entry('Spironolactone', d);
        const startMg = Number(MEDICATION_FORMULARY.find(m => m.name === 'Spironolactone')!.start_dose_for!(p));
        const atStart = spiro(startMg), below = spiro(startMg / 2);
        near(outcomeDoseCredit(atStart, p), Math.max(c0, startMg / 26), 1e-12);
        near(outcomeDoseCredit(below, p), Math.max(c0 / 2, (startMg / 2) / 26), 1e-12);
        assert.equal(therapyDoseCredit(below, p), 0.6);        // completeness domain keeps its flat credit
        assert.equal(outcomeDoseCredit(spiro(50), p), 1);      // at or above the trial-achieved dose (26 mg/day)
        assert.equal(outcomeDoseCredit(entry('Dapagliflozin', 10), p), 1);   // single-dose drug: unchanged
        const c = compareOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, [below], [atStart], p, 'all_cause_death', populationKeyFor);
        assert.ok(c.rr > 1, `rr ${c.rr}`);
    });

    check("outcome dose credit uses the patient's own (renally adjusted) label starting dose", () => {
        const at = (name: string, strength: number | string, egfr: number, freq?: string) => {
            const p = patient(); p.egfr = egfr; p.creatinine = egfr < 45 ? 1.8 : 1.0;
            const r = entry(name, strength, freq);
            return { start: startingDailyDose(r, p), credit: outcomeDoseCredit(r, p) };
        };
        const c0 = START_DOSE_CREDIT.value;
        const cases: [string, number | string, number, number | undefined, number, string?][] = [
            ['Spironolactone', 12.5, 40, 12.5, 12.5 / 26], ['Eplerenone', 25, 40, 25, 1],   // spironolactone: the C2 floor (RALES dose 26 mg) replaces c0
            ['Finerenone (Kerendia)', 10, 40, 10, c0], ['Finerenone (Kerendia)', 20, 40, 10, 1],
            ['Finerenone (Kerendia)', 10, 70, 20, c0 / 2], ['Finerenone (Kerendia)', 20, 70, 20, c0],
            [ENTRESTO, '24/26', 70, 100, c0, 'bid'], ['Carvedilol', 3.125, 70, 6.25, c0, 'bid'],
        ];
        for (const [n, d, egfr, start, credit, freq] of cases) {
            const got = at(n, d, egfr, freq);
            assert.equal(got.start, start, `${n} ${d} eGFR ${egfr}: start`);
            near(got.credit, credit, 1e-12, `${n} ${d} eGFR ${egfr}: credit`);
        }
    });

    check('engine: reducing the MRA from its start dose (K+ 5.7) shows vs_current.rr above 1', () => {
        const p = patient([entry('Lisinopril', 20), entry('Metoprolol Succinate', 200), entry('Spironolactone', 25), entry('Dapagliflozin', 10)]);
        p.potassium = 5.7;
        const red = runEngine(p).scoredRegimens.filter(r => changes(r).length === 1 && changes(r).every(m => m.action === 'titrate_down' && m.source?.med.name === 'Spironolactone'));   // reduction alone (other options also add digoxin)
        assert.ok(red.length > 0);
        for (const r of red) for (const o of r.outcome_estimates!) assert.ok(o.vs_current.rr > 1, `${o.outcome} ${o.vs_current.rr}`);
    });

    check('contributors: extrapolated only for basis extrapolated; assumed_neutral is separate', () => {
        const p = patient();
        const reg = [entry('Furosemide', 40), entry(ENTRESTO, '97/103'), entry('Metoprolol Succinate', 200), entry('Digoxin', 125)];
        for (const o of ['all_cause_death', 'hf_hospitalization'] as OutcomeKey[]) {
            const e = regimenOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, reg, p, o, populationKeyFor);
            assert.ok(e.contributors.length > 0);
        }
        const out = runEngine(patient([entry('Furosemide', 40), entry(ENTRESTO, '97/103'), entry('Metoprolol Succinate', 200)]));
        let sawExtrap = false, sawNeutral = false;
        for (const r of out.scoredRegimens) for (const o of r.outcome_estimates!) for (const c of [...o.contributors, ...o.not_counted]) {
            assert.equal(c.extrapolated, c.basis === 'extrapolated');
            assert.equal(c.assumed_neutral, c.basis === 'assumed_neutral' || c.basis === 'no_outcome_evidence' || c.basis === 'conflicting');   // E4: three bases assume no effect
            sawExtrap ||= c.extrapolated; sawNeutral ||= c.assumed_neutral;
        }
        assert.ok(sawExtrap && sawNeutral, 'fixture should show both kinds');
    });

    check('at_target: equals the ordinary figures at target, lower rr than the current dose when a drug is at its start dose; never affects scores', () => {
        const full = runEngine(patient([entry(ENTRESTO, '97/103'), entry('Metoprolol Succinate', 200), entry('Spironolactone', 50), entry('Dapagliflozin', 10)]));
        const keep = full.scoredRegimens.find(r => changes(r).length === 0)!;
        for (const o of keep.outcome_estimates!) {
            assert.deepEqual(o.at_target, { rr: o.rr, ci_low: o.ci_low, ci_high: o.ci_high });
            assert.deepEqual(o.at_target_vs_current, o.vs_current);
        }
        const low = runEngine(patient([entry(ENTRESTO, '24/26'), entry('Metoprolol Succinate', 200), entry('Spironolactone', 25), entry('Dapagliflozin', 10)]));
        const k2 = low.scoredRegimens.find(r => changes(r).length === 0) ?? low.scoredRegimens[0];
        for (const o of k2.outcome_estimates!) { assert.ok(o.at_target.rr < o.rr, `${o.outcome}`); assert.ok(o.at_target_vs_current.rr < 1 || o.at_target_vs_current.rr <= o.vs_current.rr); }
        // Direct: at_target of the module equals every counted drug at credit 1.
        const reg = [entry(ENTRESTO, '24/26'), entry('Metoprolol Succinate', 200)];
        const p = patient(reg);
        const o = buildOutcomeEstimateViews(p.current_regimen, p)[0];
        const used = (id: string) => shrunkOutcomeRow(OUTCOME_EVIDENCE_TABLE, OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)!).rr_used;
        const uArni = used('arni-reduced-death'), uBb = used('beta-blocker-reduced-death-afib');   // precision-weighted values (2026-11-16); the shared fixture is in atrial fibrillation, so the atrial fibrillation row (change C4)
        near(o.at_target.rr, uArni * uBb, 1e-12);
        near(o.as_prescribed.rr, Math.pow(uArni, START_DOSE_CREDIT.value) * uBb, 1e-12);   // ARNI at its start dose earns c0 credit
        near(o.at_target_vs_current.rr, Math.pow(uArni, 1 - START_DOSE_CREDIT.value), 1e-12);   // (0.72 x 0.66) / (0.72^c0 x 0.66)
        assert.equal(o.vs_current.rr, 1);
    });

    check('weights (ENGINE POLICY): guideline and completeness weigh 0 in every profile (the rows themselves are checked by the generating rule in measuredModelChecks.ts)', () => {
        for (const [name, w] of Object.entries(WEIGHT_PROFILES)) {
            assert.equal(w.guideline, 0, `${name}.guideline`); assert.equal(w.completeness, 0, `${name}.completeness`);
            near(DOMAIN_KEYS.reduce((s, k) => s + w[k], 0), 1, 1e-9, name);
        }
    });

    check('guideline and completeness stay computed and shown, with the reference detail and their own group', () => {
        const g = DOMAIN_GROUPS.find(x => x.label === 'Guideline reference (not in ranking)');
        assert.ok(g); assert.deepEqual([...g!.domains], ['guideline', 'completeness']);
        assert.equal(DOMAIN_GROUPS.find(x => x.key === 'outcomes')!.label, 'Individual physiological response (not estimated)');
        assert.ok(!DOMAIN_GROUPS.some(x => x.label === 'Guideline-directed therapy'));
        const out = runEngine(patient(baseRegimen()));
        const REF = 'Shown for reference; not a ranking input. Ranking uses measured outcome effects, cost and dosing burden.';
        for (const r of out.scoredRegimens) {
            for (const k of ['guideline', 'completeness'] as const) {
                const line = r.score_breakdown!.domains.find(d => d.key === k)!;
                assert.equal(line.weight, 0); assert.ok(line.detail!.startsWith(REF), line.detail);
                assert.ok(r.domain_scores[k] >= 0);
            }
            assert.ok(r.score_breakdown!.domains.find(d => d.key === 'neurohormonal')!.detail!.startsWith('Not assessed: treatment response is not quantified.'));
        }
    });

    check('tie-break: gdmt_completeness is no longer a step (score, raw score, cost, change count, key)', () => {
        const mk = (raw: number, completeness: number, cost: number): ScoredRegimen => ({ overall_score: 50, raw_score: raw, gdmt_completeness: completeness, cost, regimen: [], modification_set: { modifications: [], resulting_regimen: [] } } as unknown as ScoredRegimen);
        const moreComplete = mk(50.2, 0.9, 10), higherRaw = mk(50.4, 0.5, 10);
        assert.ok(byScoreThenCost(higherRaw, moreComplete) < 0, 'higher raw score leads regardless of completeness');
        const cheaper = mk(50.2, 0.1, 5);
        assert.ok(byScoreThenCost(cheaper, moreComplete) < 0, 'with equal raw score the cheaper leads regardless of completeness');
    });

    check('special features: class A and A/C features are flagged in data, add 0 points, and keep their rationale text', () => {
        const flagged = MEDICATION_FORMULARY.flatMap(m => (m.special_features ?? []).filter(f => f.replaced_by === 'outcome').map(f => `${m.name}: ${f.feature.slice(0, 18)}`)).sort();
        assert.equal(flagged.length, 7, flagged.join(' | '));
        for (const m of MEDICATION_FORMULARY) for (const f of m.special_features ?? []) {
            const inv = readFileSync(join(import.meta.dirname, '..', 'docs/outcome-evidence-2026-11-15/special-features-inventory.md'), 'utf8');
            assert.ok(inv.includes(f.feature.slice(0, 30)), `inventory lacks: ${m.name}: ${f.feature}`);
        }
        // End to end: A-HeFT (replaced by the outcome model) adds no bonus points but its criteria text stays, in any scenario where an H/ISDN option appears.
        let seen = 0;
        for (const sc of SCENARIOS) for (const r of runEngine(sc.patient).scoredRegimens) {
            if (!r.rationale.some(t => t.includes('A-HeFT'))) continue;
            seen++;
            const sf = r.score_breakdown!.adjustments.find(a => a.code === 'SPECIAL_FEATURES');
            assert.ok(!(sf?.items ?? []).some(i => i.feature.startsWith('A-HeFT')), 'A-HeFT must add no bonus points');
        }
        assert.ok(seen > 0, 'an option with the A-HeFT criteria in its rationale');
    });

    check('outcome_estimates: both outcomes, two-decimal detail text, contributors carry provenance', () => {
        const out = runEngine(patient(baseRegimen()));
        for (const r of out.scoredRegimens) {
            assert.deepEqual(r.outcome_estimates!.map(o => o.outcome), ['all_cause_death', 'hf_hospitalization']);
            const m = r.score_breakdown!.domains.find(d => d.key === 'mortality')!;
            assert.match(m.detail!, /^Relative risk \d\.\d\d \(95% interval \d\.\d\d to \d\.\d\d\) versus no disease-modifying therapy; population average from randomized trials, not a prediction for this patient\.( New drugs valued as titrated, to the trial-achieved dose or the highest dose allowed for this patient: .+?\.)?( Counted at the highest dose allowed for this patient, which is below the trial dose: .+?\.)?$/);
            for (const o of r.outcome_estimates!) for (const c of o.contributors) {
                assert.ok(c.row_id && c.trial && c.citation && typeof c.extrapolated === 'boolean');
            }
        }
    });

    return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const result = runOutcomeBenefitChecks(); const r2 = runOutcomeEngineChecks(); result.passed += r2.passed; result.failed += r2.failed; console.log(result); process.exitCode = result.failed ? 1 : 0;
}
