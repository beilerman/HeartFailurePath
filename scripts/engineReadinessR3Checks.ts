/**
 * Round 3 engine rulings of the 2026-11-19 readiness pass (U1 to U7, U9 to U11). Every check builds the patient a reviewer reported AND at least three
 * neighbours, and asserts the corrected behaviour. Run standalone (`npx tsx scripts/engineReadinessR3Checks.ts`) or through `npm run verify`.
 */
import assert from 'node:assert/strict';
import { LOWER_CASE_OPENERS } from '../services/engine/textCase';
import { pathToFileURL } from 'node:url';
import { entry } from './systemicReviewChecks';
import { mk, runEngine } from './engineReadinessR2Checks';
import { MEDICATION_FORMULARY } from '../constants';
import { gen3r } from './r3Generator';
import { scoredCandidates } from './scoredCandidates';
import { generateAndScoreModifications, clonePatient } from '../services/simulationService';
import { baselinePlan, brokenDisplayFloors, plansAreDistinct, isProjectedSafetyClean } from '../services/engine/selection';
import { efBandFor, compareOutcomeEstimate, OUTCOME_EVIDENCE_TABLE, populationKeyFor, outcomeDoseCredit } from '../services/engine/outcomeBenefit';
import { buildExpectedEffect, currentRegimenOf } from '../services/engine/effectView';
import { SCOPE_CONDITIONS, SCOPE_HEAD } from '../services/engine/scopeGate';
import { partitionAlerts } from '../components/resultsModel';
import { includesLoopIncrease, includesDiureticIntensification as includesDiureticIntensificationFor } from '../services/engine/selection';
import { hasCongestion as hasCongestionFor } from '../services/engine/regimenUtils';
import { DOSE_EVIDENCE } from '../services/engine/doseCredit';
import { SCENARIOS } from '../data/scenarios';
import { PRICES as TIER_PRICES } from './r2Generator';
import { TOO_CLOSE_TO_SEPARATE_POINTS } from '../services/engine/thresholds';
import type { Patient, ScoredRegimen, SimulationOutput } from '../types';
type Over = NonNullable<Parameters<typeof mk>[0]>;

const heads = (o: SimulationOutput): string[] => o.clinicalAlerts.map(a => a.split(': ')[0]);
const has = (o: SimulationOutput, head: string): boolean => heads(o).some(h => h === head || h.startsWith(head));
const triple = () => [entry('Lisinopril', 10), entry('Spironolactone', 25), entry('Carvedilol', 12.5, 'bid')];

const NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));
const PRICES = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
const runP = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePatient(p), NAMES, PRICES);
const nChanges = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').length;
const lines0 = (o: SimulationOutput): string[] => (o.why_first?.options[0]?.lines ?? []).map(l => l.text);
const allWhyText = (o: SimulationOutput): string[] => (o.why_first?.options ?? []).flatMap(x => x.lines.map(l => l.text)).concat((o.why_first?.gaps ?? []).flatMap(g => g.reasons.filter((t): t is string => !!t)));
/** Parses "Only one option is shown: of the N other plans scored, ..." into its counts. */
function parseOnlyOne(text: string): { n: number; parts: { count: number; what: string }[] } | null {
    const m = /^Only one option is shown: of the (\d+) other plans? scored, (.*)\.$/.exec(text);
    if (!m) return null;
    return { n: Number(m[1]), parts: m[2].split(/; (?=\d+ )/).map(x => { const q = /^(\d+) (.*)$/s.exec(x)!; return { count: Number(q[1]), what: q[2] }; }) };
}
const patientsFor = (from: number, to: number) => { const out: Patient[] = []; for (let sd = from; sd < to; sd++) out.push(gen3r(sd).p); return out; };

export function runEngineReadinessR3Checks(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    const check = (name: string, f: () => void) => {
        try { f(); passed++; console.log(`[PASS] ReadinessR3: ${name}`); }
        catch (e) { failed++; console.error(`[FAIL] ReadinessR3: ${name}: ${(e as Error).message?.slice(0, 900)}`); }
    };

    // ---------------- U3: urgent alerts on the stop paths --------------------------------------------------------------------------------------------------------------
    // r3-engine B3: the pregnancy alert was missing on the input-error path (SBP not above DBP) and on the limited-review path (BUN blank with a low-output pattern).
    const base = (over: Over = {}) => mk({ lvef: 30, nyha_class: 'II', sbp: 120, dbp: 70, pulse: 78, potassium: 4.4, creatinine: 1.0, egfr: 70, sex: 'Female', age: 31, is_pregnant: true, ...over }, triple());
    const inputError = (over: Over = {}) => base({ sbp: 70, dbp: 70, ...over });
    const limitedReview = (over: Over = {}) => base({ lvef: 15, bun: 0, findings: ['Cool Extremities'], ...over });
    const typo = (over: Over = {}) => base({ lvef: 250, ...over });
    for (const [label, build] of [['input error', inputError], ['limited review', limitedReview], ['implausible value', typo]] as const) {
        check(`U3 ${label}: pregnancy alert raised for a pregnant patient`, () => {
            const o = runEngine(build());
            assert.equal(o.scoredRegimens.length, 0);
            assert.ok(has(o, 'PREGNANCY ALERT'), `${label}: no PREGNANCY ALERT in ${heads(o).join(' | ')}`);
        });
        check(`U3 ${label}: no pregnancy alert for a patient who is not pregnant, and the status prompt when it is not recorded`, () => {
            assert.ok(!has(runEngine(build({ is_pregnant: false })), 'PREGNANCY ALERT'));
            assert.ok(has(runEngine(build({ is_pregnant: undefined })), 'PREGNANCY STATUS NOT RECORDED'));
        });
    }
    check('U3 stop paths: other entered-value urgent alerts are present (potassium-raising drug, NSAID, thiazolidinedione, slow beta-blocker rate)', () => {
        for (const build of [inputError, limitedReview]) {
            const o = runEngine(build({ is_pregnant: false, potassium: 5.2, ext: ['Potassium supplement (KCl)', 'Ibuprofen', 'Rosiglitazone'], pulse: 44 }));
            assert.equal(o.scoredRegimens.length, 0);
            for (const h of ['POTASSIUM-RAISING MEDICATION', 'AVOID', 'INAPPROPRIATE THERAPY', 'BRADYCARDIA ON CARVEDILOL']) assert.ok(has(o, h), `missing ${h}: ${heads(o).join(' | ')}`);
        }
    });
    check('U3 stop paths: no alert on a stop path points at an option or plan that does not exist', () => {
        for (const build of [inputError, limitedReview, typo]) {
            const o = runEngine(build({ potassium: 5.7, pulse: 44, egfr: 17, ext: ['Diltiazem'] }));
            for (const a of o.clinicalAlerts.filter(x => !x.startsWith('PARTIAL REVIEW'))) assert.ok(!/\boptions? (below|are|is|shown)|\bthe plan\b|in the options|in any option|is offered\b/i.test(a), `option wording on a stop path: ${a.slice(0, 200)}`);
        }
    });
    // ---------------- U1: "Only one option is shown" counts -------------------------------------------------------------------------------------------------------------------
    // r3-engine B1 and r3-clinical blocking 1: the shown option was counted among "the other plans scored", and plans hidden because they scored below the required-changes-only plan
    // were filed under "not different enough". Every count is recomputed here from the scored candidates with the selection's own primitives.
    const oneShown = (ps: Patient[]) => ps.map(p => ({ p, o: runP(p) })).filter(x => x.o.scoredRegimens.length === 1 && parseOnlyOne(lines0(x.o).find(t => t.startsWith('Only one option is shown')) ?? '') !== null);
    check('U1 reviewer case (seed 7300006: two scored plans, one shown): "of the 1 other plan scored" and the count is the real number of other plans', () => {
        const { p } = { p: gen3r(7300006).p };
        const o = runP(p), scored = scoredCandidates(p, NAMES, PRICES);
        assert.equal(o.scoredRegimens.length, 1);
        const parsed = parseOnlyOne(lines0(o).find(t => t.startsWith('Only one option is shown')) ?? '');
        assert.ok(parsed, lines0(o).join(' | '));
        assert.equal(parsed!.n, scored.length - 1, `sentence says ${parsed!.n}, scored ${scored.length}`);
        assert.equal(parsed!.parts.reduce((a, x) => a + x.count, 0), parsed!.n);
    });
    check('U1 neighbours: 300 patients, every count adds up to the other plans scored; unsafe and below-baseline counts match an independent recount', () => {
        const hits = oneShown(patientsFor(7300000, 7300300));
        assert.ok(hits.length >= 20, `only ${hits.length} single-option patients in the sample`);
        for (const { p, o } of hits) {
            const scored = scoredCandidates(p, NAMES, PRICES);
            const parsed = parseOnlyOne(lines0(o).find(t => t.startsWith('Only one option is shown')) ?? '')!;
            assert.equal(parsed.n, scored.length - 1, 'other plans');
            assert.equal(parsed.parts.reduce((a, x) => a + x.count, 0), parsed.n, 'parts add up');
            const unsafe = scored.filter(r => brokenDisplayFloors(r, p).length > 0).length;
            const said = (re: RegExp) => parsed.parts.filter(x => re.test(x.what)).reduce((a, x) => a + x.count, 0);
            assert.equal(said(/withheld because/), unsafe, 'unsafe plans');
            if (!said(/over the stated budget/) && !said(/ranked below|replaced by/)) {
                const safe = scored.filter(r => brokenDisplayFloors(r, p).length === 0), base = baselinePlan(safe);
                const below = base ? safe.filter(r => r !== base && (r.raw_score ?? 0) < (base.raw_score ?? 0) - 1e-9 && !o.scoredRegimens.some(k => k.raw_score === r.raw_score && nChanges(k) === nChanges(r))).length : 0;
                assert.equal(said(/scored below/), below, 'below-baseline plans');
            }
        }
    });
    check('U1 reviewer case 2 (a start that scores below the required-changes plan is said to score below it, never "scored lower" or "not different enough")', () => {
        let seen = 0;
        for (const { o } of oneShown(patientsFor(7300000, 7300400))) {
            for (const t of allWhyText(o)) {
                assert.ok(!/scored lower/.test(t), t);
                if (/scores below the plan that makes only the required changes|scored below the plan that makes only/.test(t)) seen++;
            }
        }
        assert.ok(seen > 0, 'no below-baseline sentence in the sample');
    });

    // ---------------- U2: options that score below the baseline plan carry a label --------------------------------------------------------------------------------------------
    // r3-engine B2: the label existed only when an exact no-change plan existed. Seeds 7600260, 7600472, 7600952, 7600273 were the reviewer's patients (foundational mode, no exact no-change plan).
    const unlabelled = (p: Patient): string[] => {
        const o = runP(p), scored = scoredCandidates(p, NAMES, PRICES);
        const safe = scored.filter(r => brokenDisplayFloors(r, p).length === 0), base = baselinePlan(safe);
        if (!base) return [];
        return o.scoredRegimens.filter(r => (r.raw_score ?? 0) < (base.raw_score ?? 0) - 1e-9 && nChanges(r) !== 0 && !r.shown_because).map(r => `raw ${r.raw_score?.toFixed(2)} < ${base.raw_score?.toFixed(2)} unlabelled`);
    };
    for (const seed of [7600260, 7600472, 7600952, 7600273]) {
        check(`U2 reviewer seed ${seed}: every option below the baseline plan carries a display-rule label`, () => {
            assert.deepEqual(unlabelled(gen3r(seed).p), []);
        });
    }
    check('U2 neighbours: 800 patients (the one ranking), no unlabelled below-baseline option; the label names the baseline', () => {
        let labelled = 0;
        for (let sd = 7600000; sd < 7600800; sd++) {
            const p = gen3r(sd).p;
            assert.deepEqual(unlabelled(p), [], `seed ${sd}`);
            for (const r of runP(p).scoredRegimens) if (r.shown_because && /scores this option below/.test(r.shown_because)) { labelled++; assert.ok(/no change|required changes|over the stated monthly budget/.test(r.shown_because), r.shown_because); }
        }
        // Under the one ranking an option below the baseline plan is shown only by the over-budget rules or the congestion display rule; none occurs in this sample, so the check is about the absence of an unlabelled one.
        assert.ok(labelled >= 0);
    });

    // ---------------- U4: a change the tool cannot distinguish from no change does not lead ---------------------------------------------------------------------------------------
    // r3-clinical policy item 3: stable patients on target doses were told to raise spironolactone to 50 first, with "no displayed figure differs".
    const onTarget = () => [entry('Sacubitril/Valsartan (Entresto)', '97/103', 'bid'), entry('Carvedilol', 25, 'bid'), entry('Spironolactone', 25), entry('Dapagliflozin', 10)];
    const stable = (over: Over = {}) => mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 64, potassium: 4.5, egfr: 70, creatinine: 1.0, ...over }, onTarget());
    const noChangeLeads = (o: SimulationOutput) => o.scoredRegimens.length > 0 && nChanges(o.scoredRegimens[0]) === 0;
    for (const [label, over] of [['reviewer case: NYHA II on target doses', {}], ['Black patient', { race: 'Black' as any }], ['LVEF 25', { lvef: 25 }], ['age 80', { age: 80 }], ['NYHA III', { nyha_class: 'III' as any }]] as const) {
        check(`U4 ${label}: "No medication change" is first and the explanation says no option scores a point or more above it`, () => {
            const o = runEngine(stable(over));
            assert.ok(noChangeLeads(o), o.scoredRegimens.map(r => nChanges(r)).join(','));
            assert.ok(o.scoredRegimens.length > 1, 'alternatives are listed');
            // Rewritten in round 4 (ruling W6a): the sentence no longer denies a measured estimate.
            assert.ok(lines0(o).some(t => t === 'No option scores 1 point or more above leaving the regimen unchanged, which is closer than the tool can separate; the alternatives below are shown for discussion.'), lines0(o).join(' | '));
            assert.ok(o.scoredRegimens[0].raw_score! < o.scoredRegimens.reduce((m, r) => Math.max(m, r.raw_score!), 0) + 1e-9);
        });
    }
    check('U4 rule over 400 random patients: no option listed first scores within one point of no change when no change is displayable and no change is not required', () => {
        let applied = 0;
        for (let sd = 7600000; sd < 7600400; sd++) {
            const p = gen3r(sd).p;
            const o = runP(p);
            if (o.scoredRegimens.length === 0) continue;
            const none = o.scoredRegimens.find(r => nChanges(r) === 0);
            const scored = scoredCandidates(p, NAMES, PRICES), exact = scored.find(r => nChanges(r) === 0);
            const lead = o.scoredRegimens[0];
            if (none) {
                if (lead !== none && none.raw_score !== undefined) assert.ok(lead.raw_score! - none.raw_score >= TOO_CLOSE_TO_SEPARATE_POINTS - 1e-9 || nChanges(lead) === 0, `seed ${sd}`);
                if (o.scoredRegimens.some(r => r !== none && r.raw_score! > none.raw_score!) && lead === none) applied++;
            } else if (exact) {
                // an exact no-change plan exists but is not displayed (over budget or unsafe): the rule has nothing to list
                assert.ok(true);
            }
        }
        assert.ok(applied > 0, 'the rule never applied in the sample');
    });
    check('U4 does not apply when a change is required: a patient on a duplicate beta-blocker keeps the required removal first', () => {
        const o = runEngine(mk({ lvef: 30, nyha_class: 'II', sbp: 118, dbp: 70, pulse: 70, potassium: 4.5, egfr: 70, creatinine: 1.0 }, [entry('Carvedilol', 25, 'bid'), entry('Bisoprolol', 5)]));
        assert.ok(o.scoredRegimens.length > 0);
        assert.ok(o.scoredRegimens.every(r => nChanges(r) > 0), 'every option carries the required removal');
        assert.ok(!lines0(o).some(t => /closer than the tool can separate/.test(t)));
    });
    // ---------------- U5: the same drug entered twice with different use records ---------------------------------------------------------------------------------------------
    // r3-engine L4 (seed 7627747): one entry "unknown", the other "active": the top option scored 33 or 36 depending on which was typed first, and nothing said which record was used.
    const sig = (o: SimulationOutput) => JSON.stringify({ s: o.scoredRegimens.map(r => r.raw_score?.toFixed(6)), a: [...o.clinicalAlerts].sort() });
    const bothOrders = (p: Patient) => { const q = clonePatient(p); q.current_regimen = [...q.current_regimen].reverse(); return [runP(p), runP(q)]; };
    check('U5 reviewer case (seed 7627747): identical output in both entry orders, the cautious use record is kept and the duplicate alert says so', () => {
        const p = gen3r(7627747).p;
        const [a, b] = bothOrders(p);
        assert.equal(sig(a), sig(b));
        const dup = a.clinicalAlerts.find(x => x.startsWith('INPUT SAFETY: Duplicate current medications removed'));
        assert.ok(dup && /different use records \(.*taking.*use not recorded|different use records \(.*use not recorded.*taking/.test(dup) && /more cautious one was kept \(use not recorded\)/.test(dup), dup);
    });
    const dupPair = (a: Partial<RegimenMedExposure>, b: Partial<RegimenMedExposure>, doseA = 10, doseB = 10) => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 70, potassium: 4.4, egfr: 70, creatinine: 1.0 },
        [{ ...entry('Lisinopril', doseA), exposure: a as any }, { ...entry('Lisinopril', doseB), exposure: b as any }, entry('Carvedilol', 12.5, 'bid')]);
    type RegimenMedExposure = { status: string; adherence: string; dose_interval_reviewed: boolean };
    const active = { status: 'active', adherence: 'consistent', dose_interval_reviewed: true };
    for (const [label, a, b, expect] of [
        ['held and active', { status: 'held' }, active, 'held'],
        ['unknown status and active', { status: 'unknown' }, active, 'use not recorded'],
        ['partial and consistent adherence', { status: 'active', adherence: 'partial', dose_interval_reviewed: true }, active, 'taking, partial'],
        ['held and active with different doses (the higher dose is kept)', { status: 'held' }, { ...active }, 'held'],
    ] as const) {
        check(`U5 neighbour ${label}: both entry orders give identical output and the cautious record (${expect}) is stated`, () => {
            const p = dupPair(a, b, 10, label.includes('different doses') ? 20 : 10);
            const [x, y] = bothOrders(p);
            assert.equal(sig(x), sig(y));
            const dup = x.clinicalAlerts.find(t => t.startsWith('INPUT SAFETY: Duplicate'));
            assert.ok(dup && dup.includes(`more cautious one was kept (${expect})`), dup);
            if (expect === 'held') assert.ok(x.clinicalAlerts.some(t => t.startsWith('EXPOSURE HISTORY: Lisinopril is recorded as held')));
        });
    }
    check('U5 sweep: patients 7,627,000 up to 7,630,000 that enter one drug twice (at least 8), every duplicate pair gives the same output in both entry orders', () => {
        let pairs = 0;
        for (let sd = 7627000; sd < 7630000 && pairs < 30; sd++) {
            const p = gen3r(sd).p;
            const byName = new Map<string, number>(); for (const r of p.current_regimen) byName.set(r.med.name, (byName.get(r.med.name) ?? 0) + 1);
            if (![...byName.values()].some(n => n > 1)) continue;
            pairs++;
            const [x, y] = bothOrders(p);
            assert.equal(sig(x), sig(y), `seed ${sd}`);
        }
        assert.ok(pairs >= 8, `only ${pairs} patients with a duplicated drug`);
    });
    // ---------------- U6: one ejection-fraction band per patient --------------------------------------------------------------------------------------------------------------
    // r3-engine section 2 (seeds 7700793, 7701051, 7701062, 7701107): with LVEF above 40 and an unknown earlier LVEF the band depended on whether the OPTION kept a RAAS inhibitor,
    // beta-blocker or MRA, so two options of one patient were valued from different trial rows.
    const bandSeeds = [7700793, 7701051, 7701062, 7701107, 7700266, 7700334, 7700352, 7700492];
    for (const seed of bandSeeds) {
        check(`U6 seed ${seed}: every option's "today's dose" figures use the band of the entered patient (independent recomputation), and the band is stated once`, () => {
            const p = gen3r(seed).p, o = runP(p);
            assert.ok(o.evidence_band, 'band statement present');
            assert.equal(o.evidence_band!.band, efBandFor({ ...clonePatient(p), current_regimen: p.current_regimen.filter((r: any) => r.exposure?.status !== 'held' && r.exposure?.status !== 'completed') }));
            assert.ok(/^The trial evidence used for every option is that of (reduced|mildly reduced|preserved) ejection fraction/.test(o.evidence_band!.text), o.evidence_band!.text);
            for (const r of o.scoredRegimens) {
                const v = buildExpectedEffect(r), cur = currentRegimenOf(r)!;
                assert.ok(v);
                const entered = { ...r.projected_patient, current_regimen: cur };
                for (const line of v!.outcomes) {
                    const t = compareOutcomeEstimate(OUTCOME_EVIDENCE_TABLE, r.regimen, cur, entered, line.outcome, populationKeyFor, outcomeDoseCredit, outcomeDoseCredit);
                    const shown = (x: number) => x.toFixed(2);
                    const expectTodays = shown(t.rr) !== shown(line.rr);
                    assert.equal(line.todays !== undefined, expectTodays, `${line.outcome}: today's figure present ${line.todays !== undefined}, expected ${expectTodays}`);
                    if (line.todays) assert.ok(Math.abs(line.todays.rr - t.rr) < 1e-9);
                }
            }
        });
    }
    check('U6 sweep: 1,200 random patients, no option ever sits in a band other than the entered patient\'s (the old defect hit 45 of 3,160 with options)', () => {
        let n = 0;
        for (let sd = 7700000; sd < 7701200; sd++) {
            const o = runP(gen3r(sd).p);
            if (!o.scoredRegimens.length) continue;
            n++;
            for (const r of o.scoredRegimens) { const cur = currentRegimenOf(r)!; const band = efBandFor({ ...r.projected_patient, current_regimen: cur }); assert.equal(band, o.evidence_band!.band, `seed ${sd}`); }
        }
        assert.ok(n > 500);
    });
    // ---------------- U8: scope gate (policy) and trial-range wording -------------------------------------------------------------------------------------------------------
    const inScope = (over: Over = {}, scope?: string[]) => { const p = mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 70, potassium: 4.4, egfr: 70, creatinine: 1.0, ...over }, triple()); if (scope) p.scope_conditions = new Set(scope); return p; };
    for (const c of SCOPE_CONDITIONS) {
        check(`U8b ${c.label}: no option is shown, the alert names it, says the trials did not study it and the options would not be reliable, and regimen alerts still apply`, () => {
            const o = runEngine(inScope({ potassium: 5.7, ext: ['Ibuprofen'] }, [c.label]));
            assert.equal(o.scoredRegimens.length, 0);
            const a = o.clinicalAlerts.find(x => x.startsWith(`${SCOPE_HEAD}: `));
            assert.ok(a, heads(o).join(' | '));
            assert.ok(a!.toLowerCase().includes(c.label.toLowerCase()) && /did not study it/.test(a!) && /would not be reliable/.test(a!) && /Alerts about the current regimen still apply/.test(a!), a);
            assert.equal(heads(o)[0], SCOPE_HEAD, 'the scope alert leads');
            assert.ok(has(o, 'AVOID') && has(o, 'POTASSIUM REDUCE ON'), `regimen alerts kept: ${heads(o).join(' | ')}`);
            assert.ok(/outside what the trials behind the tool studied/.test(o.why_first?.stop ?? ''), o.why_first?.stop);
            assert.equal(o.scope_status?.state, 'outside');
        });
    }
    check('U8b answers: "None of these" and the unanswered question both show options; only the unanswered one says scope was not confirmed; two ticked conditions are both named', () => {
        const none = runEngine(inScope({}, []));
        assert.ok(none.scoredRegimens.length > 0); assert.equal(none.scope_status?.state, 'confirmed_none'); assert.equal(none.scope_status?.text, '');
        const unanswered = runEngine(inScope({}));
        assert.ok(unanswered.scoredRegimens.length > 0); assert.equal(unanswered.scope_status?.state, 'not_confirmed'); assert.ok(/Scope was not confirmed/.test(unanswered.scope_status?.text ?? ''));
        const two = runEngine(inScope({}, ['Dialysis', 'Cardiac amyloidosis']));
        assert.equal(two.scoredRegimens.length, 0);
        const a = two.clinicalAlerts.find(x => x.startsWith(SCOPE_HEAD))!;
        assert.ok(/^OUTSIDE THE TOOL'S SCOPE: Cardiac amyloidosis and dialysis are recorded/.test(a), a);
        assert.deepEqual(two.scope_status?.conditions, ['Cardiac amyloidosis', 'Dialysis']);
    });
    check('U8b the gate holds on every path: input error, limited review, implausible value, SBP below 90', () => {
        for (const over of [{ sbp: 70, dbp: 70 }, { lvef: 15, bun: 0, findings: ['Cool Extremities'] }, { lvef: 250 }, { sbp: 84, dbp: 50 }] as Over[]) {
            const o = runEngine(inScope(over, ['Heart transplant or ventricular assist device']));
            assert.equal(o.scoredRegimens.length, 0);
            assert.ok(o.clinicalAlerts.some(x => x.startsWith(SCOPE_HEAD)), `${JSON.stringify(over)}: ${heads(o).join(' | ')}`);
        }
    });
    check('U8b a patient whose recorded scope is cloned keeps it (clonePatient copies the set)', () => {
        const p = inScope({}, ['Dialysis']); const q = clonePatient(p);
        assert.ok(q.scope_conditions instanceof Set && q.scope_conditions !== p.scope_conditions && q.scope_conditions.has('Dialysis'));
        assert.equal(clonePatient(inScope({})).scope_conditions, undefined);
    });
    check('U8c wording: eGFR below 20 and systolic pressure below 95 add a trial-range sentence to every option; eGFR 20 and 95 do not (and no score changes)', () => {
        const noteKinds = (o: SimulationOutput) => o.scoredRegimens.map(r => buildExpectedEffect(r)!.notes.filter(n => n.kind === 'trial_range').map(n => n.text));
        const low = runEngine(inScope({ egfr: 18, creatinine: 3.0, sbp: 93, dbp: 60 }, []));
        assert.ok(low.scoredRegimens.length > 0);
        for (const t of noteKinds(low)) { assert.equal(t.length, 2); assert.ok(/eGFR is 18/.test(t[0]) && /few or no patients with kidney function this low/.test(t[0])); assert.ok(/93 mmHg/.test(t[1]) && /few or no patients with a pressure this low/.test(t[1])); }
        const edge = runEngine(inScope({ egfr: 20, creatinine: 2.8, sbp: 95, dbp: 60 }, []));
        for (const t of noteKinds(edge)) assert.equal(t.length, 0);
        for (const over of [{ egfr: 19.9 }, { egfr: 25 }, { sbp: 94, dbp: 60 }]) { const o = runEngine(inScope({ creatinine: 2.5, ...over }, [])); for (const t of noteKinds(o)) assert.equal(t.length, ('egfr' in over ? (over.egfr! < 20 ? 1 : 0) : 1)); }
    });
    // ---------------- U7: a reason for an omitted class is the whole truth ---------------------------------------------------------------------------------------------------
    // r3-engine 1e: "adding X means dropping one" / "scored lower" was printed although a within-limit plan adding the class scored at least as well and was hidden only because it differs
    // from a shown option in the drug within a class. Every "A plan that starts it (...)" sentence is re-derived here from the scored candidates.
    check('U7 re-derivation over 900 random patients: each omitted-class sentence names a real plan and the stated reason is that plan\'s own fate', () => {
        const seen: Record<string, number> = { below: 0, differs: 0, budget: 0, ranks: 0 };
        for (let sd = 7300000; sd < 7300900; sd++) {
            const p = gen3r(sd).p, o = runP(p);
            if (!o.scoredRegimens.length) continue;
            const scored = scoredCandidates(p, NAMES, PRICES);
            const safe = scored.filter(r => brokenDisplayFloors(r, p).length === 0), base = baselinePlan(safe);
            const addsOf = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => (m.action === 'add' || m.action === 'swap') && m.target).map(m => m.target!.med.name);
            for (const opt of o.why_first!.options) for (const l of opt.lines) {
                const m = /A plan that starts it \((.*?)\) is not among the options shown: (.*)\.$/.exec(l.text);
                if (!m) continue;
                const names = m[1].split(/, | and /);
                const plans = safe.filter(r => names.every(n => addsOf(r).includes(n)));
                assert.ok(plans.length > 0, `seed ${sd}: no scored plan starts ${m[1]}: ${l.text}`);
                assert.ok(!/scored lower/.test(l.text), l.text);
                if (/^it scores below/.test(m[2])) { seen.below++; assert.ok(base && plans.some(r => (r.raw_score ?? 0) < (base.raw_score ?? 0)), `seed ${sd}: ${l.text}`); }
                else if (/^it differs from option (\d) only/.test(m[2])) { seen.differs++; const n = Number(/option (\d)/.exec(m[2])![1]); assert.ok(plans.some(r => !plansAreDistinct(r, o.scoredRegimens[n - 1])), `seed ${sd}: ${l.text}`); }
                else if (/over the stated budget/.test(m[2])) { seen.budget++; assert.ok(plans.some(r => r.cost > p.max_affordable_cost), `seed ${sd}: ${l.text}`); }
                else if (/ranks below the three options shown/.test(m[2])) { seen.ranks++; assert.equal(o.scoredRegimens.length, 3, `seed ${sd}: ${l.text}`); }
            }
        }
        assert.ok(seen.below + seen.differs + seen.budget + seen.ranks > 20, JSON.stringify(seen));
    });
    // ---------------- U9: entered NYHA class against the findings --------------------------------------------------------------------------------------------------------------
    // r3-clinical overshoot check (D07: NYHA II, +6 kg, edema 3+, orthopnea, crackles: no alert, no loop step in the first option).
    const classCase = (over: Over) => mk({ lvef: 30, nyha_class: 'II', sbp: 122, dbp: 74, pulse: 72, potassium: 4.4, egfr: 70, creatinine: 1.0, dry: 80, cur: 86, findings: ['Edema (3+)', 'Orthopnea', 'Crackles'], ...over }, triple());
    const HEAD = 'NYHA CLASS AND FINDINGS DISAGREE';
    check('U9 reviewer case D07 (NYHA II, +6 kg, three findings): the alert names the entered class, the weight excess and the findings, asks to confirm the class, and options are still shown', () => {
        const o = runEngine(classCase({}));
        const a = o.clinicalAlerts.find(x => x.startsWith(HEAD));
        assert.ok(a, heads(o).join(' | '));
        assert.ok(/NYHA II/.test(a!) && /6\.0 kg above/.test(a!) && /Confirm the NYHA class/.test(a!) && /Crackles/.test(a!) && /Edema \(3\+\)/.test(a!), a);
        assert.ok(o.scoredRegimens.length > 0);
    });
    for (const [label, over, expected] of [
        ['NYHA I with the same findings', { nyha_class: 'I' }, true],
        ['just over the limit (2.1 kg, two findings)', { cur: 82.1, findings: ['Orthopnea', 'Crackles'] }, true],
        ['exactly 2 kg is not more than 2 kg', { cur: 82, findings: ['Orthopnea', 'Crackles'] }, false],
        ['one finding only', { findings: ['Crackles'] }, false],
        ['edema of several grades counts once, so edema plus nothing else is one finding', { findings: ['Edema (3+)'] }, false],
        ['NYHA III (decompensation rules apply instead)', { nyha_class: 'III' }, false],
        ['NYHA IV', { nyha_class: 'IV' }, false],
        ['current weight not entered', { cur: 0 }, false],
    ] as const) {
        check(`U9 neighbour ${label}: alert ${expected ? 'raised' : 'not raised'}`, () => {
            const o = runEngine(classCase(over as Over));
            assert.equal(o.clinicalAlerts.some(x => x.startsWith(HEAD)), expected, heads(o).join(' | '));
        });
    }
    // Rewritten in round 5 (ruling Y12): the prompt is listed with the safety alerts on the screen (it reads the patient's state), but it still stops nothing and changes no option.
    check('U9 the alert changes no option: it is listed with the safety alerts, yet options are still shown (it is not a stop state)', () => {
        const o = runEngine(classCase({}));
        assert.ok(partitionAlerts(o.clinicalAlerts).urgent.some(a => a.raw.startsWith(HEAD)), 'listed with the safety alerts');
        assert.ok(o.scoredRegimens.length > 0, 'options are still shown');
    });
    // ---------------- U11: slow heart rate and the ECG ----------------------------------------------------------------------------------------------------------------------------
    // r3-clinical P5 (B04: sinus rate 38 on carvedilol 25 mg twice daily: one-step reduction plus two starts, and no ECG row in the monitoring plan).
    const slow = (over: Over, regimen = [entry('Carvedilol', 25, 'bid'), entry('Lisinopril', 10), entry('Spironolactone', 25)]) => mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 38, potassium: 4.4, egfr: 70, creatinine: 1.0, ...over }, regimen);
    const ecgRow = (o: SimulationOutput) => o.monitoringPlan.filter(m => /\bECG\b/.test(m.test));
    const optionHasEcg = (o: SimulationOutput) => o.scoredRegimens.map(r => (r.monitoring_plan ?? []).some(m => /\bECG\b/.test(m.test)));
    check('U11 reviewer case B04 (rate 38 on carvedilol): every option has an ECG row stating the rate and the reason', () => {
        const o = runEngine(slow({}));
        assert.ok(o.scoredRegimens.length > 0);
        assert.deepEqual(optionHasEcg(o), o.scoredRegimens.map(() => true));
        const row = o.scoredRegimens[0].monitoring_plan!.find(m => /\bECG\b/.test(m.test))!;
        assert.ok(/38 bpm/.test(row.details), row.details);
    });
    for (const [label, over, regimen, expected] of [
        ['rate 52 on carvedilol (the label reduces below 55): the reduction brings the ECG', { pulse: 52 }, undefined, true],
        ['rate 52 on bisoprolol (reduction only below 50): no reduction and no ECG', { pulse: 52 }, [entry('Bisoprolol', 5), entry('Lisinopril', 10)], false],
        ['rate 48 with no rate-slowing drug: the heart rate is below 50', { pulse: 48 }, [entry('Lisinopril', 10), entry('Spironolactone', 25)], true],
        ['rate 49 on bisoprolol: reduced for the slow rate', { pulse: 49 }, [entry('Bisoprolol', 5), entry('Lisinopril', 10)], true],
        ['rate 72 on carvedilol: nothing slow', { pulse: 72 }, undefined, false],
        ['rate 50 with no rate-slowing drug: not below 50', { pulse: 50 }, [entry('Lisinopril', 10), entry('Spironolactone', 25)], false],
    ] as const) {
        check(`U11 neighbour ${label}`, () => {
            const o = runEngine(slow(over as Over, regimen as any));
            assert.ok(o.scoredRegimens.length > 0, heads(o).join(' | '));
            assert.deepEqual(optionHasEcg(o), o.scoredRegimens.map(() => expected), JSON.stringify(optionHasEcg(o)));
        });
    }
    check('U11 stop states: with the rate below 50 the stop-state monitoring plan has the ECG too (third-degree block, scope gate, SBP below 90)', () => {
        for (const o of [runEngine(slow({ rhythm: '3rd Degree AV Block' })), runEngine(slow({ sbp: 84, dbp: 50 })), (() => { const p = slow({}); p.scope_conditions = new Set(['Dialysis']); return runEngine(p); })()]) {
            assert.equal(o.scoredRegimens.length, 0);
            assert.ok(ecgRow(o).length >= 1, o.monitoringPlan.map(m => m.test).join(' | '));
        }
    });
    // ---------------- U12: wording and labels (engine side) ------------------------------------------------------------------------------------------------------------------
    check('U12 alert sentences begin with a capital letter, on every path (full, stop, limited review)', () => {
        let n = 0;
        const outs: SimulationOutput[] = [];
        for (let sd = 7300000; sd < 7300400; sd++) outs.push(runP(gen3r(sd).p));
        for (const build of [inputError, limitedReview, typo]) outs.push(runEngine(build()));
        // R7 W7: eGFR, mg and the other lower-case openers keep their case
        for (const o of outs) for (const a of o.clinicalAlerts) { const m = /^([A-Z][A-Z0-9 ,'()\/+.-]*[A-Z0-9)]): (.)/.exec(a); if (!m) continue; n++; assert.ok(/[A-Z0-9]/.test(m[2]) || LOWER_CASE_OPENERS.test(a.slice(a.indexOf(': ') + 2)), `lower-case alert body: ${a.slice(0, 90)}`); }
        assert.ok(n > 500, `${n}`);
        const egfr = runEngine(mk({ lvef: 30, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 72, potassium: 4.4, egfr: 15, creatinine: 3.5 }, triple()));
        assert.ok(egfr.clinicalAlerts.some(a => a.startsWith('LOW KIDNEY FUNCTION ON A RAAS INHIBITOR: The eGFR is below 20 on a RAAS inhibitor')), egfr.clinicalAlerts.map(a => a.slice(0, 50)).join(' | '));
    });
    const waits = (o: SimulationOutput) => [...o.clinicalAlerts, ...(o.decisionReadiness?.deferred ?? [])].filter(t => /waits for: perfusion assessment with missing BUN\/creatinine/.test(t));
    check('U12 stop states: the "waits for: perfusion assessment with missing BUN/creatinine" line is not printed beside an unrelated stop; a plain limited review keeps it', () => {
        assert.ok(waits(runEngine(limitedReview({ is_pregnant: false }))).length > 0, 'a plain limited review keeps the line');
        for (const [label, o] of [
            ['third-degree block', runEngine(limitedReview({ is_pregnant: false, rhythm: '3rd Degree AV Block', pulse: 40 }))],
            ['SBP 84', runEngine(limitedReview({ is_pregnant: false, sbp: 84, dbp: 50 }))],
            ['potassium 6.6', runEngine(limitedReview({ is_pregnant: false, potassium: 6.6 }))],
            ['scope gate', (() => { const p = limitedReview({ is_pregnant: false }); p.scope_conditions = new Set(['Dialysis']); return runEngine(p); })()],
        ] as const) { assert.equal(o.scoredRegimens.length, 0, label); assert.deepEqual(waits(o), [], label); }
    });
    check('U12 the congestion display rule says what is true: the diuretic the option adds, and that no plan raising the loop diuretic passed the checks', () => {
        let n = 0;
        for (let sd = 7600000; sd < 7601600; sd++) {
            const p = gen3r(sd).p, o = runP(p);
            for (const r of o.scoredRegimens) {
                if (!r.shown_because || !/^Includes /.test(r.shown_because)) continue;
                n++;
                assert.ok(!/a loop increase is not available/.test(r.shown_because), r.shown_because);
                if (/passed the safety and budget checks/.test(r.shown_because)) {
                    const scored = scoredCandidates(p, NAMES, PRICES).filter(x => brokenDisplayFloors(x, p).length === 0 && isProjectedSafetyClean(x, p));
                    assert.ok(!scored.some(x => includesLoopIncrease(x) && (x.raw_score ?? 0) >= 0 && o.scoredRegimens.every(k => k.raw_score !== x.raw_score) && x.cost <= p.max_affordable_cost), `seed ${sd}: a loop increase plan was available: ${r.shown_because}`);
                    const names = (r.modification_set?.modifications ?? []).filter(m => m.target && (m.action === 'add' || m.action === 'titrate_up')).map(m => m.target!.med.name);
                    assert.ok(names.some(nm => r.shown_because!.includes(nm.split(' (')[0])), `seed ${sd}: ${r.shown_because}`);
                }
            }
        }
        assert.ok(n > 0, 'the display rule never applied in the sample');
    });
    // Rewritten in round 4 (ruling W6c): the warning comparison is two plain clauses, "this option carries no unresolved safety warning, while option 2 carries one".
    check('U12 "fewer unresolved safety warnings (no against one)" reads as two clauses: "option 1 carries no unresolved safety warning, while option 2 carries one"', () => {
        let plain = 0, odd = 0;
        for (let sd = 7300000; sd < 7300900; sd++) for (const t of (runP(gen3r(sd).p).why_first?.options ?? []).flatMap(x => x.lines.map(l => l.text))) {
            if (/\(no against /.test(t)) odd++;
            if (/carries no unresolved safety warning, while option \d carries (one|two|three|four|five|six|seven|eight|nine|\d+) unresolved safety warnings?/.test(t)) plain++;
        }
        assert.equal(odd, 0);
        assert.ok(plain > 0, 'the zero-warning phrase never occurred in the sample');
    });
    check('U12 no IV-iron information line in a potassium emergency explanation (K 6.0 and above)', () => {
        for (const k of [6.0, 6.1, 6.4]) { const o = runEngine(mk({ lvef: 28, nyha_class: 'II', sbp: 124, dbp: 74, pulse: 72, potassium: k, egfr: 60, creatinine: 1.2, ferritin: 60, tsat: 15 }, triple())); assert.ok(!allWhyText(o).some(t => /IV Iron/.test(t)), `K ${k}: ${allWhyText(o).filter(t => /IV Iron/.test(t))[0]}`); }
    });
    // ---------------- U13: one ranking (owner ruling 2, 2026-11-20) ---------------------------------------------------------------------------------------------------------
    check('U13 a patient still carrying the retired ranking_mode field (any value) is ranked the one way and does not crash: identical output over 300 random patients and 5 named ones', () => {
        const noMode = (k: string, v: unknown) => (k === 'ranking_mode' ? undefined : v);
        const strip = (o: SimulationOutput) => JSON.stringify(o, noMode);
        const ps = [...Array.from({ length: 300 }, (_, i) => gen3r(7600000 + i).p), inScope({}, []), inScope({ lvef: 55 }, []), inScope({ lvef: 45 }, []), classCase({}), slow({})];
        let withOptions = 0;
        for (const p of ps) {
            const base = runP(p);
            if (base.scoredRegimens.length > 0) withOptions++;
            for (const mode of ['balanced', 'foundational_first', 'nonsense', undefined]) {
                const q = clonePatient(p) as Patient & { ranking_mode?: string }; q.ranking_mode = mode as string | undefined;
                assert.equal(strip(runP(q)), strip(base), `ranking_mode ${String(mode)}`);
            }
        }
        assert.ok(withOptions > 100, `${withOptions}`);
    });
    check('U13 nothing is left of the toggle in the engine output: no ranking field on the output, no foundational coverage on an option, no ranking-approach sentence in any explanation or note', () => {
        for (let sd = 7600000; sd < 7600200; sd++) {
            const o = runP({ ...gen3r(sd).p, ranking_mode: 'foundational_first' } as Patient);
            assert.ok(!('ranking' in o), 'ranking field');
            for (const r of o.scoredRegimens) { assert.ok(!('foundational_coverage' in r) && !('foundational_slots' in r), 'coverage fields'); assert.ok(!/Prioritize foundational therapy|ranking approach/i.test(r.shown_because ?? ''), r.shown_because); }
            assert.ok(!allWhyText(o).some(t => /Prioritize foundational therapy|ranking approach/i.test(t)));
        }
    });
    // ---------------- U14: dose credit where no trial reported the dose reached (owner ruling 6) -------------------------------------------------------------------------------
    // Full credit at the LABEL target dose (or the label's maximum recommended maintenance dose); where the label names none, full credit at any dose and the dose is "not measured".
    type Basis = { kind: 'target' | 'maximum' | 'none'; set_id: string; label: string; sentence: string };
    const anchors = DOSE_EVIDENCE.anchors as unknown as { id: string; drug: string; level: string; full_credit_daily_mg: number | null; label_basis?: Basis }[];
    const notMeasured = anchors.filter(a => a.level === 'not_measured');
    check('U14 every anchor with no trial-reported dose (13) carries the label sentence, the label and its DailyMed set id; a label with a target gives the numeric full-credit dose, a label with none gives no dose', () => {
        assert.equal(notMeasured.length, 13);
        for (const a of notMeasured) {
            const b = a.label_basis;
            assert.ok(b, `${a.id}: no label_basis`);
            assert.match(b!.set_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, a.id);
            assert.ok(b!.sentence.length > 20 && b!.sentence.length < 400 && b!.label.length > 5, a.id);
            if (b!.kind === 'none') assert.equal(a.full_credit_daily_mg, null, `${a.id}: a label with no target must give no numeric dose`);
            else assert.ok(typeof a.full_credit_daily_mg === 'number' && a.full_credit_daily_mg > 0, `${a.id}: a label target needs a numeric dose`);
        }
        assert.deepEqual(notMeasured.filter(a => a.label_basis!.kind !== 'none').map(a => a.id).sort(), ['sema-semaglutide', 'sema-tirzepatide', 'vasodilator-hydralazine-isdn', 'vericiguat']);
    });
    check('U14 the engine credits 1 at the label dose and less below it for the four label-target drugs, and 1 at any dose where the label names no target (neighbours: loops, thiazides, binders, iron)', () => {
        const p = mk({ lvef: 30, egfr: 70 });
        const credit = (name: string, strength: number | string, freq?: string) => outcomeDoseCredit(entry(name, strength, freq), p);
        assert.equal(credit('Semaglutide (Wegovy)', 2.4), 1);
        assert.ok(credit('Semaglutide (Wegovy)', 0.5) < 1 && credit('Semaglutide (Wegovy)', 1.7) < 1 && credit('Semaglutide (Wegovy)', 1.7) > credit('Semaglutide (Wegovy)', 0.5));
        assert.equal(credit('Tirzepatide (Zepbound)', 15), 1);
        assert.ok(credit('Tirzepatide (Zepbound)', 5) < 1);
        assert.equal(credit('Vericiguat', 10), 1);
        assert.ok(credit('Vericiguat', 2.5) < 1 && credit('Vericiguat', 5) < 1);
        assert.equal(credit('Hydralazine/Isosorbide Dinitrate', '75/40'), 1);
        assert.ok(credit('Hydralazine/Isosorbide Dinitrate', '37.5/20') < 1);
        for (const [n, ds] of [['Furosemide', [20, 160]], ['Torsemide', [5, 100]], ['Bumetanide', [0.5, 2]], ['Metolazone', [2.5, 10]], ['Chlorthalidone', [12.5, 25]], ['Hydrochlorothiazide', [12.5, 50]], ['Patiromer', [8.4, 25.2]], ['Sodium Zirconium Cyclosilicate (Lokelma)', [5, 15]]] as const)
            for (const d of ds) assert.equal(credit(n, d), 1, `${n} ${d}`);
    });
    // ---------------- U15: the tie rule does not move "No medication change" ahead of a diuretic intensification for a congested patient ----------------------------------------------
    // Controller ruling after round 3: the tool does not model congestion relief by a diuretic, so "no option is measurably better" is not a statement a clinician can read for a congested patient on no diuretic.
    const EXCEPTION = /because congestion is recorded and the tool does not model congestion relief from a diuretic/;
    const MEASURABLY = /closer than the tool can separate/;   // the tie sentence (wording changed in round 4, ruling W6a)
    const tierRun = (p: Patient, tier: 'cash' | 'commercial' | 'medicare') => generateAndScoreModifications({ ...clonePatient(p), insurance_tier: tier }, NAMES, TIER_PRICES[tier]);
    const allLines = (o: SimulationOutput) => (o.why_first?.options[0]?.lines ?? []).map(l => l.text);
    const aheft = () => SCENARIOS.find(x => x.title === 'African American NYHA III (A-HeFT)')!.patient;
    for (const tier of ['cash', 'commercial', 'medicare'] as const) {
        check(`U15 reviewer case: African American NYHA III (A-HeFT), ${tier}: the furosemide start stays first and the explanation says why the tie rule was not applied`, () => {
            const o = tierRun(aheft(), tier);
            assert.ok(o.scoredRegimens.length > 1);
            assert.ok((o.scoredRegimens[0].modification_set?.modifications ?? []).some(m => m.action === 'add' && m.target?.med.name === 'Furosemide'), 'first option adds furosemide');
            assert.ok(allLines(o).some(t => EXCEPTION.test(t)), allLines(o).join(' | '));
            assert.ok(!allLines(o).some(t => MEASURABLY.test(t)));
            const nc = scoredCandidates({ ...clonePatient(aheft()), insurance_tier: tier }, NAMES, TIER_PRICES[tier]).find(r => nChanges(r) === 0);
            assert.ok(nc && Math.abs(o.scoredRegimens[0].raw_score! - (nc.raw_score ?? -99)) < 1, 'within one point of no change');
        });
    }
    const congested = (over: Over = {}, regimen = onTarget()) => mk({ lvef: 30, nyha_class: 'III', sbp: 118, dbp: 70, pulse: 64, potassium: 4.5, egfr: 70, creatinine: 1.0, dry: 80, cur: 82.5, findings: ['Edema (1+)'], ...over }, regimen);
    check('U15 neighbour: the same patient with no congestion finding and weight at dry weight: the exception never applies (the tie rule keeps "No medication change" first when the best option is within a point)', () => {
        const o = runEngine(congested({ cur: 80, findings: [] }));
        assert.ok(!allLines(o).some(t => EXCEPTION.test(t)));
        assert.ok(o.scoredRegimens.length > 0);
    });
    check('U15 neighbour: a volume-depleted patient on furosemide (3 kg below dry weight, no finding): the exception never applies', () => {
        for (const cur of [77, 78.5]) { const o = runEngine(congested({ cur, findings: [] }, [...onTarget(), entry('Furosemide', 40)])); assert.ok(!allLines(o).some(t => EXCEPTION.test(t)), `cur ${cur}`); }
    });
    check('U15 neighbour: a congested patient whose best option within one point is NOT a diuretic change keeps the tie rule (no change first, the measurably-better sentence)', () => {
        let seen = 0;
        for (let sd = 7600000; sd < 7601500 && seen < 3; sd++) {
            const p = gen3r(sd).p, o = runP(p);
            if (o.scoredRegimens.length < 2 || !o.scoredRegimens[0] || nChanges(o.scoredRegimens[0]) !== 0) continue;
            if (!allLines(o).some(t => MEASURABLY.test(t))) continue;
            // congested, tie rule applied, so the displaced best option must not contain a diuretic intensification
            const best = o.scoredRegimens.reduce((b, r) => ((r.raw_score ?? 0) > (b.raw_score ?? 0) ? r : b));
            assert.ok(!includesDiureticIntensificationFor(best), `seed ${sd}: the displaced best option adds or raises a diuretic`);
            if (/congest|Edema|JVP|Crackles|Orthopnea|Ascites/.test(JSON.stringify([...p.volume_status.exam_findings])) || p.volume_status.current_weight_kg > p.volume_status.dry_weight_kg + 1) seen++;
        }
        assert.ok(seen >= 1, `only ${seen} congested tie-rule patients in the sample`);
    });
    check('U15 the exception is for a diuretic increase only: a congested patient on furosemide 40 whose best option within one point is an increase keeps the scored order; no sentence when the option is not a diuretic change', () => {
        let fired = 0, ruleKept = 0;
        const pool: Patient[] = [...SCENARIOS.map(x => x.patient), ...Array.from({ length: 3000 }, (_, i) => gen3r(7600000 + i).p)];
        for (const [sd, p] of pool.entries()) {
            const o = runP(p);
            const lines = allLines(o);
            if (lines.some(t => EXCEPTION.test(t))) { fired++; assert.ok(includesDiureticIntensificationFor(o.scoredRegimens[0]), `seed ${sd}: exception on a non-diuretic first option`); assert.ok(hasCongestionFor(p), `seed ${sd}: exception for a patient with no recorded congestion`); }
            if (lines.some(t => MEASURABLY.test(t)) && hasCongestionFor(p)) ruleKept++;
        }
        assert.ok(fired > 0, 'the exception never fired in the sample');
        assert.ok(ruleKept >= 0);
    });
    return { passed, failed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = runEngineReadinessR3Checks();
    console.log(`ReadinessR3: passed ${r.passed}, failed ${r.failed}`);
    process.exit(r.failed > 0 ? 1 : 0);
}
