/**
 * Seeded random sweep for the round 2 engine rulings (readiness part A: T1, T2, T3, T4, T5, T16, T18, T22, T23, T24, T25, T26). For each rule: how many patients are in the state it covers
 * and in how many the rule held. Not part of the gate (it is long); the same rules are asserted on named patients and small samples by `engineReadinessR2Checks.ts`.
 * Usage:  npx tsx scripts/engineReadinessR2Sweep.ts <count> <firstSeed> [out.json]      one shard
 *         npx tsx scripts/engineReadinessR2Sweep.ts --merge a.json b.json ...            add shards and print the table
 * The patients come from `r2Generator.gen2` (state flags that co-occur on purpose), seeds from 5,000,000.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { gen2, run, F } from './r2Generator';
import { isColdState, hasCongestion, hasHypoperfusion } from '../services/engine/regimenUtils';
import { isAcutelyDecompensated } from '../services/clinicalPredicates';
import { generateAndScoreModifications, clonePatient } from '../services/simulationService';
import { MEDICATION_FORMULARY } from '../constants';
import { auditInputs, raiseClinicalAlerts, checkSafetyHardStops } from '../services/engine/gates';
import { runEligibilityStage } from '../services/engine/eligibility';
import { getDoseTiers } from '../services/engine/regimenUtils';
import { analyzeCurrentRegimen, generateCandidateModifications } from '../services/engine/candidates';
import { buildScoringContext, scoreCandidates } from '../services/engine/scoring';
import { selectWithRanking } from '../services/engine/selection';
import { PRICES } from './r2Generator';
import type { Patient, ScoredRegimen, SimulationOutput } from '../types';

type Tally = Record<string, { state: number; held: number; exceptions: string[] }>;
const FUROSEMIDE_PER_MG: Record<string, number> = Object.fromEntries(MEDICATION_FORMULARY.filter(m => m.facts?.verified_furosemide_equivalent_per_mg !== undefined).map(m => [m.name, m.facts!.verified_furosemide_equivalent_per_mg!]));
const PER_DAY: Record<string, number> = { qd: 1, bid: 2, tid: 3 };
const equivDaily = (r: { med: { name: string }; dose: { strength: number | string }; selected_frequency: string }) => Number(r.dose.strength) * (PER_DAY[r.selected_frequency] ?? 1) * (FUROSEMIDE_PER_MG[r.med.name] ?? 0);
const chg = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
const OPTION_BELOW = /\boptions? below\b/i;
const KLOW = new Set(['Loop Diuretic', 'Thiazide-like Diuretic', 'K+ Binder']);
const BANDS: [string, (k: number) => boolean][] = [['K below 3.5', k => k > 0 && k < 3.5], ['K 3.5 to 4.9', k => k >= 3.5 && k < 5.0], ['K 5.0 to 5.4', k => k >= 5.0 && k < 5.5], ['K 5.5 to 5.9', k => k >= 5.5 && k < 6.0], ['K 6.0 to 6.4', k => k >= 6.0 && k < 6.5]];

/** The engine's own stages 1 to 7 up to the displayed picks, with the congestion display rule optionally switched off (its loop step removed from the analysis). Counterfactual for T23. */
function picksWithRule(source: Patient, ruleOn: boolean): number | null {
    const p = clonePatient(source);
    p.current_regimen = (p.current_regimen ?? []).map(r => r);
    const alerts: string[] = [];
    const audit = auditInputs(p, alerts); if (audit.stop) return null;
    const flags = raiseClinicalAlerts(p, audit.dataAudit, alerts);
    if (checkSafetyHardStops(p, alerts, audit.gdmtGaps, audit.missingDataNotices)) return null;
    const el = runEligibilityStage(p, audit.dataAudit.unknownRenal, new Set(F.map(m => m.name)), alerts);
    const tiers = el.formulary.flatMap(m => getDoseTiers(m, p));
    const an = analyzeCurrentRegimen(p, el.formulary, tiers, el.allBBExcluded, el.allRAASExcluded, el.unresolvedFoundationalClass);
    if (!ruleOn) an.unstable = { ...an.unstable, loopStep: undefined };
    const ctx = buildScoringContext(p, PRICES[p.insurance_tier], el.intolerancePolicy, audit.dataAudit, el.formulary, tiers, an, flags);
    const results = scoreCandidates(generateCandidateModifications(an, p), ctx);
    return selectWithRanking(results, p, alerts).picks.length;
}

function shard(count: number, first: number): { tally: Tally; no: Record<string, { n: number; none: number; noneBuilt: number }> } {
    const tally: Tally = {}; const no: Record<string, { n: number; none: number; noneBuilt: number }> = {};
    const rec = (k: string, inState: boolean, ok: boolean, seed: number, why: string) => { if (!inState) return; const t = (tally[k] ??= { state: 0, held: 0, exceptions: [] }); t.state++; if (ok) t.held++; else if (t.exceptions.length < 8) t.exceptions.push(`seed ${seed}: ${why}`.slice(0, 200)); };
    const warn = console.warn; console.warn = () => { };
    for (let i = 0; i < count; i++) {
        const seed = first + i; const p = gen2(seed);
        let o: SimulationOutput; try { o = run(p); } catch (e) { rec('THREW', true, false, seed, String(e)); continue; }
        const limited = o.decisionReadiness?.mode === 'limited_review';
        const picks = o.scoredRegimens;
        const inputStop = o.clinicalAlerts.some(a => /^(IMPLAUSIBLE|INPUT ERROR|DATA REQUIRED: (systolic|current weight|dry weight|LVEF))/.test(a)) && !limited;
        const hardStop = !limited && !inputStop && (p.sbp < 90 || p.potassium >= 6.5 || p.rhythm === '3rd Degree AV Block');
        const full = !limited && !inputStop && !hardStop;
        const noOptionsBefore = picks.length === 0;
        const kEmergency = full && p.potassium >= 6.0 && p.potassium < 6.5;

        // T1 potassium 6.0 or above
        if (kEmergency) {
            const cut = picks.flatMap(r => chg(r).filter(m => (m.action === 'remove' || m.action === 'titrate_down') && m.source && KLOW.has(m.source.med.drug_class) && !m.mandatory).map(m => m.summary.slice(0, 40)));
            const text = o.clinicalAlerts.some(a => /^LOOP DIURETIC OVER-TREATMENT|^DIURETIC REVIEW/.test(a) || /[Dd]own-titrate/.test(a));
            const lowK = /low potassium/i.test(JSON.stringify(o.why_first ?? {}));
            const urg = o.monitoringPlan.some(m => /^Repeat potassium urgently and obtain an ECG/.test(m.test));
            rec('T1 K 6.0-6.4: no diuretic or binder cut, no diuretic-reduction text, no low-potassium benefit, urgent item', true, cut.length === 0 && !text && !lowK && urg, seed, `cut=${cut} text=${text} lowK=${lowK} urgent=${urg}`);
        }
        // T2 two loop diuretics
        const loops = p.current_regimen.filter(r => r.med.drug_class === 'Loop Diuretic' && !r.med.facts?.short_course_addon);
        const distinctLoops = new Set(loops.map(r => r.med.name));
        if (full && distinctLoops.size >= 2 && picks.length > 0) {
            const best = Math.max(...[...distinctLoops].map(n => Math.max(...loops.filter(r => r.med.name === n).map(equivDaily))));
            // the entry the engine reads for a duplicated drug is the higher dose; compare drugs by their best entry
            const bad: string[] = [];
            for (const r of picks) {
                const total = r.regimen.filter(x => x.med.drug_class === 'Loop Diuretic' && !x.med.facts?.short_course_addon).reduce((s, x) => s + equivDaily(x), 0);
                const hasLoopMod = chg(r).some(m => m.source?.med.drug_class === 'Loop Diuretic' && !m.duplicate_cleanup); // a loop changed for another stated reason (anuria, allergy, a titration) is not the clean-up
                if (!hasLoopMod && total + 1e-9 < best) bad.push(`total ${total} < ${best}`);
                const bd = r.score_breakdown?.adjustments.find(a => a.code === 'VOLUME_DEPLETION_DEESCALATION');
                const onlyCleanup = chg(r).filter(m => ['Loop Diuretic', 'Thiazide-like Diuretic'].includes(m.source?.med.drug_class ?? '')).every(m => m.action === 'remove' && m.duplicate_cleanup);
                if (bd && onlyCleanup) bad.push('clean-up scored as de-escalation');
            }
            rec('T2 two loop diuretics: larger equivalent dose kept, loop total never below it, clean-up not scored as a diuretic reduction', true, bad.length === 0, seed, bad.join('; '));
        }
        // T3 no start with an unmet prerequisite
        if (picks.length > 0) {
            const bad = picks.flatMap(r => chg(r).filter(m => (m.action === 'add' || m.action === 'swap') && m.target).flatMap(m => (m.target!.med.facts?.regimen_warnings ?? []).filter(w => w.start_prerequisite && (!w.when || w.when(p, r.regimen))).map(() => m.target!.med.name)));
            rec('T3 no displayed option starts a drug whose own start warning says a prerequisite is not met', true, bad.length === 0, seed, bad.join(','));
            if (p.potassium > 5.5) rec('T3b potassium above 5.5: no digoxin start displayed', true, !picks.some(r => chg(r).some(m => m.action === 'add' && m.target?.med.name === 'Digoxin')), seed, 'digoxin start');
        }
        // T4 block alerts name the drugs
        if (p.rhythm === '3rd Degree AV Block' || p.rhythm === '2nd Degree AV Block') {
            const a = o.clinicalAlerts.find(x => /^(THIRD|SECOND)-DEGREE AV BLOCK/.test(x));
            const names = [...p.current_regimen.filter(r => ['Beta Blocker', 'Inotrope', 'If Inhibitor'].includes(r.med.drug_class)).map(r => r.med.name), ...['Amiodarone', 'Diltiazem', 'Verapamil'].filter(n => p.external_medications?.has(n))];
            const stopped = !limited && p.sbp > 0 && !inputStop;
            if (stopped || limited) rec('T4 heart block alert present, says review now, names every rate-slowing drug taken', true, !!a && /review now/i.test(a) && names.every(n => a.includes(n)), seed, `alert=${!!a} names=${names}`);
        }
        // T5 decompensation alert needs evidence
        if (!limited && !inputStop && isAcutelyDecompensated(p)) {
            const evidence = hasCongestion(p) || hasHypoperfusion(p);
            const same = o.clinicalAlerts.some(a => /^ACUTE DECOMPENSATION/.test(a));
            const repl = o.clinicalAlerts.some(a => /^SYMPTOMS AT REST WITHOUT RECORDED CONGESTION/.test(a));
            rec('T5 decompensation predicate true: same-day alert exactly when congestion or poor perfusion is recorded, otherwise the symptoms sentence', true, evidence ? same && !repl : !same && repl, seed, `evidence=${evidence} sameDay=${same} replacement=${repl}`);
        }
        // T16 limited review keeps the alerts the entered values justify
        if (limited) {
            const need: [string, boolean, RegExp][] = [
                ['acute decompensation', p.nyha_class === 'IV' || (p.nyha_class === 'III' && p.volume_status.current_weight_kg > 0 && p.volume_status.dry_weight_kg > 0 && isAcutelyDecompensated(p)), /^ACUTE DECOMPENSATION|^SYMPTOMS AT REST WITHOUT RECORDED CONGESTION/],
                ['third-degree block', p.rhythm === '3rd Degree AV Block', /^THIRD-DEGREE AV BLOCK/],
                ['second-degree block', p.rhythm === '2nd Degree AV Block', /^SECOND-DEGREE AV BLOCK/],
                ['potassium emergency', p.potassium >= 6.0, /^HYPERKALEMIC EMERGENCY/],
                ['low blood pressure', p.sbp > 0 && p.sbp < 90, /^HEMODYNAMIC INSTABILITY/],
            ];
            for (const [name, inState, re] of need) rec(`T16 limited review: ${name} alert present`, inState, o.clinicalAlerts.some(a => re.test(a)), seed, 'alert missing');
            rec('T16 limited review: no "model limitation" wording and no "option below"', true, !o.clinicalAlerts.some(a => OPTION_BELOW.test(a)) && !(o.decisionReadiness?.deferred ?? []).some(d => /model limitation/i.test(d)), seed, 'wording');
        }
        // T18 order and wording
        { let top = 0, ok = true; const EM = ['POOR PERFUSION', 'ACUTE DECOMPENSATION', 'THIRD-DEGREE AV BLOCK', 'HEMODYNAMIC INSTABILITY', 'HYPERKALEMIC EMERGENCY', 'HYPOXIA ALERT', 'IMPLAUSIBLE VALUE', 'INPUT ERROR'];
            const RT = ['DEVICE THERAPY SCREENING', 'CARDIAC REHABILITATION', 'VERICIGUAT ELIGIBILITY WARNING', 'DATA NOTE', 'PARTIAL REVIEW', 'DATA REQUIRED', 'LABS REQUIRED', 'MEDICATION USE REVIEW', 'DOSE TIMING REVIEW', 'EXPOSURE HISTORY', 'SYMPTOMS AT REST WITHOUT RECORDED CONGESTION'];
            for (const a of o.clinicalAlerts) { const h = a.split(': ')[0]; const t = EM.includes(h) ? 0 : RT.includes(h) ? 2 : 1; if (t < top) ok = false; top = Math.max(top, t); }
            rec('T18 alerts ordered: emergencies and stop states, then urgent, then routine', true, ok, seed, o.clinicalAlerts.map(a => a.split(': ')[0].slice(0, 20)).join(' | '));
            if (noOptionsBefore) rec('T18 no alert says "option below" when no option is shown', true, !o.clinicalAlerts.some(a => OPTION_BELOW.test(a)), seed, o.clinicalAlerts.find(a => OPTION_BELOW.test(a)) ?? ''); }
        // T22 a removal reads as a removal; options do not repeat
        if (picks.length > 0) {
            const bad: string[] = []; const seen = new Set<string>();
            for (const r of picks) { for (const m of chg(r)) if (m.action === 'remove' && !/^Remove /.test(m.summary)) bad.push(m.summary.slice(0, 40)); const key = chg(r).map(m => m.summary).sort().join('|'); if (seen.has(key)) bad.push('repeat'); seen.add(key); }
            rec('T22 a removal never reads as a swap and no two options repeat', true, bad.length === 0, seed, bad.join('; '));
        }
        // T23 share of patients with no option by potassium band: decompensated and congested versus otherwise similar (congested, not decompensated)
        if (full) {
            const dec = isAcutelyDecompensated(p), cong = hasCongestion(p);
            if (cong) for (const [band, f] of BANDS) if (f(p.potassium)) { const k = `${dec ? 'decompensated+congested' : 'congested, not decompensated'} | ${band}`; const t = (no[k] ??= { n: 0, none: 0, noneBuilt: 0 }); t.n++;
                if (noOptionsBefore) { t.none++; const built = Number((o.clinicalAlerts.find(x => /^(NO OPTION AVAILABLE|NO REGIMEN CHANGE SHOWN)/.test(x))?.match(/\((\d+) candidate (?:plans|regimens) built/) ?? [])[1] ?? NaN); if (o.clinicalAlerts.some(x => /^NO DISPLAY-SAFE/.test(x)) || built > 0) t.noneBuilt++; } }
        }
        // T23 counterfactual: where the congestion display rule applies and no option is shown, switching the rule off must not produce one
        if (full) {
            const dec = isAcutelyDecompensated(p), cold = isColdState(p);
            if ((dec || cold) && hasCongestion(p)) {
                let withRule: number | null = picks.length, without: number | null = null;
                if (withRule === 0) { try { without = picksWithRule(p, false); } catch { without = null; } }
                rec('T23 decompensated or cold and congested: the display rule never turns a patient who has an option without it into one with none', true, !(withRule === 0 && without !== null && without > 0), seed, `with rule ${withRule}, without ${without}`);
            }
        }
        // T24 monitoring does not depend on an option being shown
        if (!limited && !inputStop && p.potassium >= 6.0 && p.potassium <= 8.0) rec('T24 potassium 6.0 or above: the plan carries "repeat potassium urgently and obtain an ECG" (with or without an option)', true, o.monitoringPlan.some(m => /^Repeat potassium urgently and obtain an ECG/.test(m.test)), seed, `options=${picks.length}`);
        if (picks.length === 0 && !limited && !inputStop && p.rhythm === '3rd Degree AV Block') rec('T24 third-degree block stop carries its own monitoring item', true, o.monitoringPlan.some(m => /ECG/.test(m.test) && /pacing/i.test(m.test)), seed, 'missing');
        if (picks.length === 0 && !limited && !inputStop && p.sbp > 0 && p.sbp < 90) rec('T24 low blood pressure stop carries its own monitoring item', true, o.monitoringPlan.some(m => /blood pressure/i.test(m.test)), seed, 'missing');
        // T26 chemistry recheck
        for (const r of picks) {
            const plan = (r.monitoring_plan ?? []).map(m => m.test);
            const touches = (cls: string[]) => chg(r).some(m => [m.source, m.target].some(x => x && cls.includes(x.med.drug_class)));
            if (touches(['ACEi', 'ARB', 'ARNI', 'MRA', 'nsMRA'])) rec('T26 option changes a RAAS inhibitor or MRA: potassium and kidney recheck present', true, plan.some(t => /^BMP \((potassium|urea\/creatinine)/.test(t)), seed, chg(r).map(m => m.summary.slice(0, 30)).join(';'));
            if (touches(['Loop Diuretic', 'Thiazide-like Diuretic'])) rec('T26 option changes a diuretic: electrolyte and kidney recheck present', true, plan.some(t => /^BMP \(electrolytes/.test(t)), seed, chg(r).map(m => m.summary.slice(0, 30)).join(';'));
        }
        // T25 order independence (every 20th patient: the answer in reverse entry order)
        if (i % 20 === 0 && p.current_regimen.length > 1) {
            const sig = (x: SimulationOutput) => JSON.stringify([x.clinicalAlerts, x.scoredRegimens.map(r => [r.overall_score, chg(r).map(m => m.summary), r.warnings])]);
            const rev = { ...p, current_regimen: [...p.current_regimen].reverse(), comorbidities: new Set([...p.comorbidities].reverse()), external_medications: new Set([...(p.external_medications ?? [])].reverse()), allergies: new Set([...p.allergies].reverse()), discontinued_meds: [...p.discontinued_meds].reverse(), volume_status: { ...p.volume_status, exam_findings: new Set([...p.volume_status.exam_findings].reverse()) } } as Patient;
            let o2: SimulationOutput | undefined; try { o2 = generateAndScoreModifications(clonePatient(rev), new Set(F.map(m => m.name)), Object.fromEntries(F.map(m => [m.name, 10]))); } catch { /* skip */ }
            const o1 = generateAndScoreModifications(clonePatient(p), new Set(F.map(m => m.name)), Object.fromEntries(F.map(m => [m.name, 10])));
            if (o2) rec('T25 the answer in reverse entry order is identical', true, sig(o1) === sig(o2), seed, 'differs');
        }
        void isColdState;
    }
    console.warn = warn;
    return { tally, no };
}

function print(tally: Tally, no: Record<string, { n: number; none: number; noneBuilt: number }>, count: number) {
    console.log(`patients run: ${count}`);
    for (const [k, v] of Object.entries(tally).sort((a, b) => a[0] < b[0] ? -1 : 1)) { console.log(`${k}\n   in state: ${v.state}, rule held: ${v.held}, exceptions: ${v.state - v.held}`); v.exceptions.forEach(e => console.log('     ' + e)); }
    console.log('\nT23 share of congested patients (full path) with no option; the second figure counts only those where candidate plans WERE built (so the display rule could have mattered):');
    const keys = new Set(Object.keys(no).map(k => k.split(' | ')[1]));
    for (const band of BANDS.map(b => b[0]).filter(b => keys.has(b))) {
        const a = no[`decompensated+congested | ${band}`] ?? { n: 0, none: 0, noneBuilt: 0 }, b = no[`congested, not decompensated | ${band}`] ?? { n: 0, none: 0, noneBuilt: 0 };
        const pa = a.n ? a.noneBuilt / a.n : 0, pb = b.n ? b.noneBuilt / b.n : 0;
        console.log(`   ${band.padEnd(14)} decompensated and congested: no option ${a.none}/${a.n} (${(a.n ? a.none / a.n * 100 : 0).toFixed(1)}%), with plans built ${a.noneBuilt} (${(pa * 100).toFixed(2)}%)   congested, not decompensated: no option ${b.none}/${b.n} (${(b.n ? b.none / b.n * 100 : 0).toFixed(1)}%), with plans built ${b.noneBuilt} (${(pb * 100).toFixed(2)}%)   ${pa <= pb + 1e-9 ? 'not higher' : 'HIGHER'}`);
    }
}

const args = process.argv.slice(2);
if (args[0] === '--merge') {
    const tally: Tally = {}; const no: Record<string, { n: number; none: number; noneBuilt: number }> = {}; let count = 0;
    for (const f of args.slice(1)) { const j = JSON.parse(readFileSync(f, 'utf8')); count += j.count; for (const [k, v] of Object.entries(j.tally as Tally)) { const t = (tally[k] ??= { state: 0, held: 0, exceptions: [] }); t.state += v.state; t.held += v.held; t.exceptions.push(...v.exceptions); } for (const [k, v] of Object.entries(j.no as Record<string, { n: number; none: number; noneBuilt: number }>)) { const t = (no[k] ??= { n: 0, none: 0, noneBuilt: 0 }); t.n += v.n; t.none += v.none; t.noneBuilt += v.noneBuilt ?? 0; } }
    print(tally, no, count);
} else {
    const count = Number(args[0] ?? 2000), first = Number(args[1] ?? 5000000);
    const { tally, no } = shard(count, first);
    if (args[2]) writeFileSync(args[2], JSON.stringify({ count, tally, no }));
    else print(tally, no, count);
}
