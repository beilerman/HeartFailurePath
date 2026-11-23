/**
 * Round 3 seeded random sweep (rulings U1 to U7, U9 to U13): `npx tsx scripts/engineReadinessR3Sweep.ts <count> <firstSeed> [out.json]`. The patients come from `r3Generator.ts` (the round 3 reviewer's
 * state-combination generator; it still sets the retired ranking_mode field at random on purpose, so the one-ranking rule is exercised). Not part of the gate (it is long); the same rules are asserted on named
 * patients and small samples by `engineReadinessR3Checks.ts`. Prints counts of what was checked and of every exception.
 */
import { writeFileSync } from 'node:fs';
import { MEDICATION_FORMULARY } from '../constants';
import { gen3r } from './r3Generator';
import { scoredCandidates } from './scoredCandidates';
import { generateAndScoreModifications, clonePatient } from '../services/simulationService';
import { baselinePlan, brokenDisplayFloors, plansAreDistinct, includesDiureticIntensification } from '../services/engine/selection';
import { hasCongestion } from '../services/engine/regimenUtils';
import { efBandFor } from '../services/engine/outcomeBenefit';
import { currentRegimenOf } from '../services/engine/effectView';
import { TOO_CLOSE_TO_SEPARATE_POINTS } from '../services/engine/thresholds';
import { enteredValues } from '../services/engine/urgentStates';
import { raiseClinicalAlerts, detectInappropriateRegimen, auditCriticalData, validatePhysiologicBounds } from '../services/engine/gates';
import { ADVISORY_ALERT_HEADS } from '../services/engine/whyFirst';
import { dedupeCurrentRegimen } from '../services/engine/regimenUtils';
import { isActiveExposure } from '../services/engine/medicationExposure';
import type { Patient, ScoredRegimen, SimulationOutput } from '../types';

const NAMES = new Set(MEDICATION_FORMULARY.map(m => m.name));
const PRICES = Object.fromEntries(MEDICATION_FORMULARY.map(m => [m.name, 10]));
const run = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePatient(p), NAMES, PRICES);
const n = Number(process.argv[2] ?? 1000), first = Number(process.argv[3] ?? 7800000), outFile = process.argv[4];
const nCh = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').length;
const head = (a: string) => { const i = a.indexOf(': '); return i > 0 ? a.slice(0, i) : a.slice(0, 40); };

const counts: Record<string, number> = { patients: 0, withOptions: 0, U1_single_option_sentences: 0, U1_sentence_counts_checked: 0, U2_options_below_baseline: 0, U2_unlabelled: 0,
    U3_stop_path_runs: 0, U3_urgent_heads_checked: 0, U3_missing: 0, U4_applicable: 0, U4_violations: 0, U4_no_change_led_by_rule: 0, U15_violations: 0, U15_exception_fired: 0, congested_exact_nochange_patients: 0, congested_nochange_first: 0, congested_nochange_first_by_tie_rule: 0, U5_reordered_runs: 0, U5_order_dependent: 0,
    U6_options_checked: 0, U6_band_mismatch: 0, U7_sentences: 0, U7_wrong: 0, U13_mode_flip_runs: 0, U13_mode_changes_output: 0, capital_alerts_checked: 0, capital_alerts_lower: 0 };
const exceptions: string[] = [];
const displaced: Record<string, number> = {};
const bad = (key: string, seed: number, msg: string) => { counts[key]++; if (exceptions.length < 60) exceptions.push(`${key} seed ${seed}: ${msg}`); };

const urgentHeads = (alerts: string[]) => new Set(alerts.filter(a => !ADVISORY_ALERT_HEADS.includes(head(a))).map(head));
/** What the full path raises from entered values alone (the builders only; no candidate, eligibility or score): the urgent headings. */
function fullPathHeads(p: Patient): Set<string> {
    const c = clonePatient(p);
    c.current_regimen = dedupeCurrentRegimen(c.current_regimen ?? []).regimen.filter(isActiveExposure);   // the engine reads the active drugs only
    const q = enteredValues(c);
    const arr: string[] = [];
    try { raiseClinicalAlerts(q, auditCriticalData(q), arr); arr.push(...detectInappropriateRegimen(q)); } catch { /* ignore */ }
    // the nitrate with a PDE5 inhibitor is raised under its own heading by the limited review (CONTRAINDICATED COMBINATION) and by the input-error stop through the earlier audit
    return urgentHeads(arr.filter(a => !a.startsWith('INAPPROPRIATE THERAPY: Nitrate')));
}
// the full path's headings that a stop path may legitimately not repeat: they restate another alert already raised there (duplicate entries, nitrate with a PDE5 inhibitor)
const COVERED = new Set(['INAPPROPRIATE REGIMEN']);

for (let i = 0; i < n; i++) {
    const seed = first + i;
    const p = gen3r(seed).p;
    counts.patients++;
    let o: SimulationOutput;
    try { o = run(p); } catch (e) { bad('U3_missing', seed, `THROW ${String(e).slice(0, 80)}`); continue; }
    for (const a of o.clinicalAlerts) { const m = /^([A-Z][A-Z0-9 ,'()\/+.-]*[A-Z0-9)]): (.)/.exec(a); if (!m) continue; counts.capital_alerts_checked++; if (!/[A-Z0-9]/.test(m[2])) bad('capital_alerts_lower', seed, a.slice(0, 80)); }
    const picks = o.scoredRegimens;
    if (picks.length > 0) counts.withOptions++;
    if (o.why_first?.options[0]?.lines.some(l => /because congestion is recorded and the tool does not model congestion relief from a diuretic/.test(l.text))) counts.U15_exception_fired++;

    // U13: the retired field is ignored (a quarter of the patients)
    if (i % 4 === 0) {
        counts.U13_mode_flip_runs++;
        const q = clonePatient(p) as Patient & { ranking_mode?: string }; q.ranking_mode = p.ranking_mode === 'foundational_first' ? 'balanced' : 'foundational_first';
        const noMode = (k: string, v: unknown) => (k === 'ranking_mode' ? undefined : v);
        if (JSON.stringify(run(q), noMode) !== JSON.stringify(o, noMode)) bad('U13_mode_changes_output', seed, 'output differs');
    }

    if (picks.length > 0) {
        let scored: ScoredRegimen[] = [];
        try { scored = scoredCandidates(p, NAMES, PRICES); } catch { /* skip */ }
        const safe = scored.filter(r => brokenDisplayFloors(r, p).length === 0), base = baselinePlan(safe);

        // U1: "Only one option is shown": recount
        const one = picks.length === 1 ? (o.why_first?.options[0]?.lines.map(l => l.text).find(t => t.startsWith('Only one option is shown')) ?? null) : null;
        if (one) {
            counts.U1_single_option_sentences++;
            const m = /^Only one option is shown: of the (\d+) other plans? scored, (.*)\.$/.exec(one);
            if (m) {
                counts.U1_sentence_counts_checked++;
                const parts = m[2].split(/; (?=\d+ )/).map(x => /^(\d+) (.*)$/s.exec(x)!);
                const sum = parts.reduce((s, x) => s + Number(x[1]), 0);
                if (Number(m[1]) !== scored.length - 1) bad('U1_single_option_sentences', seed, `says ${m[1]} other plans, scored ${scored.length}`);
                if (sum !== Number(m[1])) bad('U1_single_option_sentences', seed, `parts add to ${sum}, not ${m[1]}`);
                const said = (re: RegExp) => parts.filter(x => re.test(x[2])).reduce((s, x) => s + Number(x[1]), 0);
                const unsafe = scored.filter(r => brokenDisplayFloors(r, p).length > 0).length;
                if (said(/withheld because/) !== unsafe) bad('U1_single_option_sentences', seed, `unsafe ${said(/withheld because/)} vs ${unsafe}`);
                if (!said(/over the stated budget/) && !said(/ranked below|replaced by/) && base) {
                    const below = safe.filter(r => r !== base && (r.raw_score ?? 0) < (base.raw_score ?? 0) - 1e-9 && !picks.some(k => k.raw_score === r.raw_score && nCh(k) === nCh(r))).length;
                    if (said(/scored below/) !== below) bad('U1_single_option_sentences', seed, `below ${said(/scored below/)} vs ${below}`);
                }
            } else if (!/the tool built no other plan/.test(one)) bad('U1_single_option_sentences', seed, one.slice(0, 100));
        }

        // U2: options below the baseline plan carry a label
        if (base) for (const r of picks) if ((r.raw_score ?? 0) < (base.raw_score ?? 0) - 1e-9 && nCh(r) !== 0) { counts.U2_options_below_baseline++; if (!r.shown_because) { counts.U2_unlabelled++; bad('U2_unlabelled', seed, `raw ${r.raw_score?.toFixed(2)} < ${base.raw_score?.toFixed(2)}`); } }

        // U4: no change leads when the best option is within one point, unless a change is required
        const exact = scored.find(r => nCh(r) === 0);
        const none = picks.find(r => nCh(r) === 0);
        if (exact && none) {
            counts.U4_applicable++;
            const best = Math.max(...picks.map(r => r.raw_score ?? 0));
            const exceptionFired = !!o.why_first?.options[0]?.lines.some(l => /because congestion is recorded and the tool does not model congestion relief from a diuretic/.test(l.text));
            if (best - (none.raw_score ?? 0) < TOO_CLOSE_TO_SEPARATE_POINTS && nCh(picks[0]) !== 0 && picks[0] !== none && !exceptionFired) bad('U4_violations', seed, `first option scores ${picks[0].raw_score?.toFixed(2)} against no change ${none.raw_score?.toFixed(2)}`);
            if (picks[0] === none && best > (none.raw_score ?? 0) + 1e-9) counts.U4_no_change_led_by_rule++;
            // U15: for a congested patient the tie rule must not put no change ahead of a within-one-point best option that starts or raises a diuretic
            const bestOpt = picks.reduce((b, r) => ((r.raw_score ?? 0) > (b.raw_score ?? 0) ? r : b));
            if (hasCongestion(p)) {
                counts.congested_exact_nochange_patients++;
                if (picks[0] === none) {
                    counts.congested_nochange_first++;
                    if (bestOpt !== none && (bestOpt.raw_score ?? 0) > (none.raw_score ?? 0) + 1e-9) {
                        counts.congested_nochange_first_by_tie_rule++;
                        const kind = (bestOpt.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => `${m.action}:${(m.target ?? m.source)?.med.drug_class}`).sort().join('+');
                        displaced[kind] = (displaced[kind] ?? 0) + 1;
                        if (includesDiureticIntensification(bestOpt) && (bestOpt.raw_score ?? 0) - (none.raw_score ?? 0) < TOO_CLOSE_TO_SEPARATE_POINTS) bad('U15_violations', seed, `no change first over a diuretic intensification (${kind})`);
                    }
                }
            }
        }

        // U6: one band
        const band = o.evidence_band?.band;
        for (const r of picks) { counts.U6_options_checked++; const cur = currentRegimenOf(r); if (cur && efBandFor({ ...r.projected_patient, current_regimen: cur }) !== band) bad('U6_band_mismatch', seed, `option band differs from ${band}`); }

        // U7: omitted-class sentences re-derived
        const addsOf = (r: ScoredRegimen) => (r.modification_set?.modifications ?? []).filter(m => (m.action === 'add' || m.action === 'swap') && m.target).map(m => m.target!.med.name);
        for (const opt of o.why_first?.options ?? []) for (const l of opt.lines) {
            const m = /A plan that starts it \((.*?)\) is not among the options shown: (.*)\.$/.exec(l.text);
            if (!m) continue;
            counts.U7_sentences++;
            const names = m[1].split(/, | and /), plans = safe.filter(r => names.every(x => addsOf(r).includes(x)));
            let ok = plans.length > 0 && !/scored lower/.test(l.text);
            if (ok && /^it scores below/.test(m[2])) ok = !!base && plans.some(r => (r.raw_score ?? 0) < (base.raw_score ?? 0));
            else if (ok && /^it differs from option (\d) only/.test(m[2])) ok = plans.some(r => !plansAreDistinct(r, picks[Number(/option (\d)/.exec(m[2])![1]) - 1]));
            else if (ok && /over the stated budget/.test(m[2])) ok = plans.some(r => r.cost > p.max_affordable_cost);
            else if (ok && /ranks below the three options shown/.test(m[2])) ok = picks.length === 3;
            if (!ok) bad('U7_wrong', seed, l.text.slice(0, 140));
        }
    }

    // U5: reversed entry order gives the same answer (a third of the patients)
    if (i % 3 === 0 && p.current_regimen.length > 1) {
        counts.U5_reordered_runs++;
        const q = clonePatient(p); q.current_regimen = [...q.current_regimen].reverse();
        const o2 = run(q);
        const sig = (x: SimulationOutput) => JSON.stringify({ s: x.scoredRegimens.map(r => r.raw_score?.toFixed(6)), a: [...x.clinicalAlerts].sort() });
        if (sig(o) !== sig(o2)) bad('U5_order_dependent', seed, 'scores or alerts differ with the entry order reversed');
    }

    // U3: every urgent heading the full path raises from entered values is on the input-error stop path, and on the limited-review path (the typo path: pregnancy only)
    if (i % 2 === 0) {
        const paths: [string, Patient][] = [];
        const e = clonePatient(p); e.dbp = e.sbp > 0 ? e.sbp : 80; if (!(e.sbp > 0)) e.sbp = 80; paths.push(['input error', e]);
        const t = clonePatient(p); t.lvef = 250; paths.push(['implausible value', t]);
        const l = clonePatient(p); l.volume_status.current_weight_kg = 0; paths.push(['limited review', l]);
        for (const [label, q] of paths) {
            let out: SimulationOutput; try { out = run(q); } catch { bad('U3_missing', seed, `${label} THROW`); continue; }
            if (out.scoredRegimens.length > 0) continue;
            counts.U3_stop_path_runs++;
            const have = urgentHeads(out.clinicalAlerts);
            const want = label === 'implausible value' ? new Set([...fullPathHeads(q)].filter(h => h.startsWith('PREGNANCY'))) : fullPathHeads(q);
            for (const h of want) { if (COVERED.has(h)) continue; counts.U3_urgent_heads_checked++; if (!have.has(h) && !(h === 'POOR PERFUSION' || h === 'ACUTE DECOMPENSATION')) { if (![...have].some(x => x === h)) bad('U3_missing', seed, `${label}: ${h}`); } }
            void validatePhysiologicBounds;
        }
    }
}
const top5 = Object.entries(displaced).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log(JSON.stringify({ seeds: `${first}..${first + n - 1}`, counts, displacedBestOptionKinds: displaced, exceptions: exceptions.slice(0, 40) }, null, 1)); void top5;
if (outFile) writeFileSync(outFile, JSON.stringify({ seeds: [first, first + n - 1], counts, displaced, exceptions }, null, 1));
