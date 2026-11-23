import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { RecommendationCard } from '../components/RecommendationCard';
import { buildChartSummary } from '../components/resultsModel';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { ADVISORY_ALERT_HEADS } from '../services/engine/whyFirst';
import { ReviewStep } from '../components/guided/ReviewStep';
import { confirmUnassessedUse, exposureAfterDoseEdit, useStatusWords, isUseConfirmed } from '../components/guided/confirmUse';
import { EvidenceTables } from '../components/EvidenceTables';
import { EvidenceDrillDown } from '../components/ExpectedEffect';
import { OUTCOME_EVIDENCE_TABLE } from '../services/engine/outcomeBenefit';
import { SYMPTOM_TABLE } from '../services/engine/symptomBenefit';
import { HARM_TABLE } from '../services/engine/harmBurden';
import { borrowedFrom, borrowedLines, outcomeRowUnweighted, basisLabel as basisLabelOf } from '../components/expectedEffectModel';
import { FAQ } from '../components/FAQ';
import { DecisionReadinessPanel } from '../components/DecisionReadinessPanel';
import { RULESET_VERSION } from '../services/rulesetVersion';
import { ELIGIBILITY_RULES } from '../services/engine/eligibility';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Patient, RegimenMed, ScoredRegimen, SimulationOutput } from '../types';

// Checks for round 2, part B (screen, explanations, evidence labels, status document). Rulings T6 to T15, T17, T19 to T21 (spec readiness/fix-spec-r2.md).
// Server-rendered content only. Each check runs over every reference scenario and over neighbours constructed from them.

let passed = 0;
export let failed = 0;
const check = (name: string, f: () => void) => {
    try { f(); passed++; console.log(`[PASS] ${name}`); }
    catch (error) { failed++; console.error(`[FAIL] ${name}: ${process.env.VERBOSE ? String(error).slice(0, 900) : String(error).split('\n')[0]}`); }
};
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = await getDrugPrices([...names], 'commercial');
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ');

interface Run { title: string; patient: Patient; out: SimulationOutput }

/** Neighbours of the reference scenarios: the same patient with one value moved, so a fix that holds only for the reviewer's patient is caught. */
function neighbours(): Run[] {
    const out: Run[] = [];
    const pick = SCENARIOS.filter((_, i) => i % 7 === 3);
    for (const s of pick) {
        const a = clonePatient(s.patient); a.potassium = Math.max(3.8, Math.min(6.4, (s.patient.potassium || 4.2) + 0.5));
        const b = clonePatient(s.patient); b.sbp = Math.max(96, (s.patient.sbp || 120) - 14); b.dbp = Math.min(b.dbp, b.sbp - 20);
        const c = clonePatient(s.patient); c.volume_status = { ...c.volume_status, current_weight_kg: c.volume_status.dry_weight_kg + 3 };
        const d = clonePatient(s.patient); d.age = Math.min(89, (s.patient.age || 60) + 12); d.egfr = s.patient.egfr ? Math.max(22, s.patient.egfr - 12) : s.patient.egfr;
        out.push({ title: `${s.title} +K`, patient: a, out: null as unknown as SimulationOutput }, { title: `${s.title} -SBP`, patient: b, out: null as unknown as SimulationOutput },
            { title: `${s.title} +3kg`, patient: c, out: null as unknown as SimulationOutput }, { title: `${s.title} older`, patient: d, out: null as unknown as SimulationOutput });
    }
    for (const r of out) { try { r.out = generateAndScoreModifications(r.patient, names, prices); } catch { r.out = { scoredRegimens: [], excludedMedications: [], clinicalAlerts: [], monitoringPlan: [] } as unknown as SimulationOutput; } }
    return out;
}
export const referenceRuns: Run[] = SCENARIOS.map(s => ({ title: s.title, patient: s.patient, out: generateAndScoreModifications(s.patient, names, prices) }));
export const allRuns: Run[] = [...referenceRuns, ...neighbours()];

const propsOf = (r: Run): React.ComponentProps<typeof ResultsDisplay> => ({
    results: r.out.scoredRegimens, runId: 1, error: null, hasRun: true, excludedMedications: r.out.excludedMedications, clinicalAlerts: r.out.clinicalAlerts,
    monitoringPlan: r.out.monitoringPlan, gdmtGaps: r.out.gdmtGaps, eligibleAdjuncts: r.out.eligibleAdjuncts, missingDataNotices: r.out.missingDataNotices,
    followUpCalendar: r.out.followUpCalendar, decisionReadiness: r.out.decisionReadiness, whyFirst: r.out.why_first,
    runSnapshot: { patient: r.patient, ranAt: '2026-11-19T12:00:00Z' },
});
const screen = (r: Run) => renderToStaticMarkup(<ResultsDisplay {...propsOf(r)} />);
const card = (r: Run, i: number) => renderToStaticMarkup(<RecommendationCard regimen={r.out.scoredRegimens[i]} rank={i + 1} leader={i > 0 ? r.out.scoredRegimens[0] : undefined} why={r.out.why_first?.options[i]} />);
const chartInput = (r: Run) => ({ results: r.out.scoredRegimens, clinicalAlerts: r.out.clinicalAlerts, gdmtGaps: r.out.gdmtGaps ?? [], eligibleAdjuncts: r.out.eligibleAdjuncts ?? [], missingDataNotices: r.out.missingDataNotices ?? [], followUpCalendar: r.out.followUpCalendar ?? [], monitoringPlan: r.out.monitoringPlan ?? [], excludedMedications: r.out.excludedMedications, decisionReadiness: r.out.decisionReadiness, whyFirst: r.out.why_first, patient: r.patient, ranAt: '2026-11-19T12:00:00Z' });
const withOptions = allRuns.filter(r => r.out.scoredRegimens.length > 0);
const multi = allRuns.filter(r => r.out.scoredRegimens.length > 1);
const isNoChangeOpt = (o: ScoredRegimen) => !(o.modification_set?.modifications ?? []).some(m => m.action !== 'keep');
const allWhyText = (r: Run): string[] => (r.out.why_first?.options ?? []).flatMap(o => o.lines.map(l => l.text));
const sentences = (t: string): string[] => t.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(x => x.trim().length > 0);
const words = (t: string): number => t.trim().split(/\s+/).filter(Boolean).length;
const visibleLines = (r: Run, i: number) => (r.out.why_first?.options[i]?.lines ?? []).filter(l => !l.detail);

// ------------------------------------------------------------------------------------------------ T6 a: direction
check('T6a: "larger expected reduction" only when both relative risks are below 1 and the first is lower; "smaller expected increase" when both are above 1; mixed cases say so', () => {
    let n = 0;
    for (const r of allRuns) for (const t of allWhyText(r)) {
        for (const m of t.matchAll(/(larger expected reduction|smaller expected increase|an expected reduction|no expected increase) in ([a-z -]+?) \(relative risk (\d\.\d\d) against (\d\.\d\d)[;)]/g)) {
            n++;
            const a = Number(m[3]), b = Number(m[4]);
            assert.ok(a < b, `${r.title}: ${m[0]}`);
            if (m[1] === 'larger expected reduction') assert.ok(b < 1, `${r.title}: ${m[0]}`);
            if (m[1] === 'smaller expected increase') assert.ok(a > 1, `${r.title}: ${m[0]}`);
            if (m[1] === 'an expected reduction') assert.ok(a < 1 && b >= 1, `${r.title}: ${m[0]}`);
        }
        // The old template said "larger expected reduction ... (relative risk 1.10 against 1.52)": the pair itself must never contradict the words.
        for (const m of t.matchAll(/larger expected reduction in [a-z -]+ \(relative risk (\d\.\d\d) against (\d\.\d\d)[;)]/g)) assert.ok(Number(m[2]) < 1, `${r.title}: ${m[0]}`);
    }
    assert.ok(n > 100, `${n} direction statements checked`);
});

// ------------------------------------------------------------------------------------------------ T6 b: size
check('T6b: a figure is cited only when its two displayed values differ and its weighted contribution is at least 0.5 point (or it is the largest); two options that cannot be separated get that sentence alone', () => {
    let cited = 0, ties = 0;
    for (const r of multi) {
        const picks = r.out.scoredRegimens;
        for (let i = 0; i < picks.length; i++) {
            const other = i === 0 ? 1 : 0;
            const line = r.out.why_first!.options[i].lines.find(l => l.kind === 'versus_other');
            if (!line) continue;
            const t = line.text;
            const dom = (o: ScoredRegimen, key: string) => o.score_breakdown!.domains.find(d => d.key === key)!.contribution;
            const bigDiffs = ['mortality', 'hf_hospitalization', 'symptoms', 'side_effects', 'cost', 'adherence'].map(k => Math.abs(dom(picks[i], k) - dom(picks[other], k)));
            const largest = Math.max(...bigDiffs);
            const check1 = (re: RegExp, key: string) => {
                for (const m of t.matchAll(re)) {
                    cited++;
                    if (m[1] !== undefined && m[2] !== undefined) assert.notEqual(m[1], m[2], `${r.title}: equal figures cited: ${m[0]}`);
                    const d = Math.abs(dom(picks[i], key) - dom(picks[other], key));
                    assert.ok(d >= 0.5 - 1e-9 || Math.abs(d - largest) < 1e-9, `${r.title} option ${i + 1}: ${key} cited with ${d.toFixed(2)} points: ${m[0]}`);
                }
            };
            check1(/in death \(relative risk (\d\.\d\d) against (\d\.\d\d)/g, 'mortality');
            check1(/in heart-failure hospitalization \(relative risk (\d\.\d\d) against (\d\.\d\d)/g, 'hf_hospitalization');
            check1(/in health status \(([^ ]+) against ([^ ]+) KCCQ/g, 'symptoms');
            check1(/fewer side effects \(side-effect burden ([^ ]+) against ([^ ]+) points/g, 'side_effects');
            check1(/cheaper each month/g, 'cost');
            const rawDiff = Math.abs((picks[0].raw_score ?? 0) - (picks[1].raw_score ?? 0));
            if (rawDiff < 1) {
                ties++;
                if (!/Compared with option/.test(t)) assert.match(t, /too close to separate/, r.title);
            }
        }
    }
    assert.ok(cited > 100, `${cited} cited figures checked`);
    assert.ok(ties >= 3, `${ties} ties seen`);
});

// ------------------------------------------------------------------------------------------------ T6 c: one source of rounding
check('T6c: every figure quoted in a "why" sentence appears identically in the card of the option it is on or of the option it is compared with (effect block, cost line, burden line)', () => {
    let nums = 0;
    for (const r of withOptions) {
        const picks = r.out.scoredRegimens;
        picks.forEach((_, i) => {
            const cards = [i, i === 0 ? 1 : 0].filter(j => j < picks.length).map(j => textOf(card(r, j))).join(' ');
            const lines = r.out.why_first!.options[i].lines;
            for (const l of lines) {
                // ranking-approach percentages and per-visit counts are the card's foundational coverage line and a limit, not effect figures
                const body = l.text.replace(/\d+% against \d+%/g, '').replace(/option \d/gi, '').replace(/limit of \d/g, '');
                for (const m of body.matchAll(/\$\d+\.\d\d|[−+]?\d+\.\d+/g)) {
                    nums++;
                    const tok = m[0].replace(/^[−+]/, '');
                    if (tok === '1.00' || tok === '0.0') continue; // the no-change baseline (relative risk 1.00, 0.0 points) is the definition of "no change"
                    const esc = tok.replace(/[$.]/g, '\\$&');
                    assert.match(cards, new RegExp(`(^|[^\\d.])${esc}(?![\\d])`), `${r.title} option ${i + 1}: "${m[0]}" is not in the card text. Line: ${l.text.slice(0, 200)}`);
                }
            }
        });
    }
    assert.ok(nums > 300, `${nums} figures checked`);
});

// ------------------------------------------------------------------------------------------------ T6 d, e, f, g
check('T6d: no advisory alert is called a "safety alert in force" and a class is said to be blocked only when its own state is true', () => {
    let seen = 0;
    let kRuleSeen = 0;
    const NOT_GATE = [...ADVISORY_ALERT_HEADS, 'ATRIAL FIBRILLATION', 'ADVANCED HEART FAILURE ALERT'].map(h => h.toLowerCase());
    for (const r of allRuns) for (const t of allWhyText(r)) {
        for (const m of t.matchAll(/Safety alerts are in force \(([^)]*)\)/g)) {
            seen++;
            for (const h of NOT_GATE) assert.ok(!m[1].toLowerCase().includes(h), `${r.title}: ${m[0]}`);
            assert.doesNotMatch(m[1], /Atrial fibrillation|Advanced heart failure/i, r.title);
        }
        if (/no drug is started while the patient shows signs of poor perfusion/.test(t)) assert.match(r.out.clinicalAlerts.join(' '), /POOR PERFUSION|LOW OUTPUT STATE/, r.title);
        for (const m of t.matchAll(/no drug is started at a potassium of (\d\.\d) or above/g)) { kRuleSeen++; assert.equal(m[1], '6.0', `${r.title}: the potassium stop is at 6.0`); assert.ok(r.patient.potassium >= 6.0, r.title); }
        if (/no beta-blocker is started during acute decompensation/.test(t)) assert.match(r.out.clinicalAlerts.join(' '), /ACUTE DECOMPENSATION|SYMPTOMS AT REST|POOR PERFUSION/, r.title);
    }
    assert.ok(seen >= 3 && kRuleSeen >= 1, `${seen} safety-alert sentences, ${kRuleSeen} potassium-stop sentences`);
});
check('T6e: a sentence about a plan that is not displayed says so', () => {
    let seen = 0;
    for (const r of allRuns) for (const t of allWhyText(r)) {
        assert.doesNotMatch(t, /\b[Tt]he best plan that starts it/, `${r.title}: ${t.slice(0, 160)}`);
        for (const m of t.matchAll(/A plan that starts it \([^)]*\)([^.]{0,40})/g)) { seen++; assert.match(m[1], /^ is not among the options shown/, `${r.title}: ${m[0]}`); }
        assert.doesNotMatch(t, /scores? \d+ lower|ranks \d+ of the \d+/, r.title);
    }
    assert.ok(seen >= 10, `${seen}`);
});
check('T6f: no garbled adjustment sentence, never an empty block, and a single option says why there is only one', () => {
    for (const r of withOptions) {
        for (const t of allWhyText(r)) assert.doesNotMatch(t, /points for the points|more points for|smaller deduction|\bpoints for\b/, `${r.title}: ${t.slice(0, 200)}`);
        const vis = visibleLines(r, 0);
        assert.ok(vis.length >= 1 && vis.some(l => l.text.length > 30), `${r.title}: empty block`);
        if (r.out.scoredRegimens.length === 1 && !isNoChangeOpt(r.out.scoredRegimens[0])) {
            assert.ok(vis.some(l => /^Only one option is shown: (of the \d+ other plans? scored|the tool built no other plan)/.test(l.text)), `${r.title}: ${vis.map(l => l.text).join(' | ').slice(0, 200)}`);
            assert.ok(!vis.some(l => /nothing to compare it with/.test(l.text)), r.title);
        }
    }
    const volume = allRuns.filter(r => allWhyText(r).some(t => /reduces a diuretic, which the tool favours when the patient appears volume depleted/.test(t)));
    assert.ok(volume.length >= 1, 'the volume-depletion adjustment is shown in words in at least one run');
});
check('T6g: no alert says "option below" when no option follows; the prescribing note keeps its drug name', () => {
    let stops = 0, notes = 0;
    for (const r of allRuns) {
        if (r.out.scoredRegimens.length === 0) { stops++; for (const a of r.out.clinicalAlerts) assert.doesNotMatch(a, /\b(options? below|in any option below)\b/i, `${r.title}: ${a.slice(0, 120)}`); }
        for (const note of [buildChartSummary(chartInput(r), 0)]) {
            for (const m of note.matchAll(/PRESCRIBING NOTES:?\n((?:\s*- .*\n?)+)/g)) for (const line of m[1].split('\n')) if (line.trim()) { notes++; assert.doesNotMatch(line, /^\s*- \(/, `${r.title}: orphan line: ${line.slice(0, 100)}`); }
        }
        r.out.scoredRegimens.forEach((_, i) => assert.doesNotMatch(card(r, i), />\s*\(2026 ESC[^<]*</, `${r.title}: orphan note on the card`));
    }
    assert.ok(stops >= 3 && notes >= 20, `${stops} stops, ${notes} note lines`);
});

// ------------------------------------------------------------------------------------------------ T19: readable
const BANNED = /unrounded|charged at|added across drugs|a policy, not a ranking factor|deducts?\s+\d|the tool deducts|\bpoints for\b|display rule: a policy/i;
const BANNED_ON_SCREEN = /unrounded|charged at|a policy, not a ranking factor|the tool deducts/i;
check('T19a: the always-visible part is at most three sentences and about 70 words (at most 85), with no nested parentheses and none of the banned phrases', () => {
    let worst = 0;
    if (process.env.WHY_STATS) { const all = withOptions.flatMap(r => r.out.scoredRegimens.map((_, i) => words(visibleLines(r, i).map(l => l.text).join(' ')))).sort((a, b) => a - b); console.log('visible words: n', all.length, 'median', all[Math.floor(all.length / 2)], 'p90', all[Math.floor(all.length * 0.9)], 'p99', all[Math.floor(all.length * 0.99)], 'max', all[all.length - 1]); }
    for (const r of withOptions) r.out.scoredRegimens.forEach((_, i) => {
        const vis = visibleLines(r, i).map(l => l.text);
        const t = vis.join(' ');
        const nsent = vis.reduce((s, x) => s + sentences(x).length, 0);
        assert.ok(nsent <= 3, `${r.title} option ${i + 1}: ${nsent} sentences: ${t.slice(0, 260)}`);
        worst = Math.max(worst, words(t));
        assert.ok(words(t) <= 85, `${r.title} option ${i + 1}: ${words(t)} words: ${t}`);
        assert.doesNotMatch(t, /\([^()]*\([^()]*\)[^()]*\)/, `${r.title}: nested parentheses`);
    });
    assert.ok(worst > 20, `${worst}`);
});
check('T19b: nothing shown or copied carries a banned phrase; reasons for classes left out are one short line each under one "More on why" disclosure', () => {
    for (const r of allRuns) {
        const t = textOf(screen(r)) + ' ' + buildChartSummary(chartInput(r), 0);
        assert.doesNotMatch(t, BANNED_ON_SCREEN, `${r.title}: ${(t.match(BANNED_ON_SCREEN) ?? [''])[0]}`);
        const w = [...allWhyText(r), ...r.out.clinicalAlerts].join(' ');
        assert.doesNotMatch(w, BANNED, `${r.title}: ${(w.match(BANNED) ?? [''])[0]}`);
        for (const o of r.out.why_first?.options ?? []) for (const l of o.lines) {
            if (l.kind === 'class_not_started') { assert.ok(l.detail === true, `${r.title}: class line is not under the disclosure`); assert.ok(words(l.text) <= 45, `${r.title}: class line of ${words(l.text)} words: ${l.text}`); }
        }
    }
    const r = referenceRuns.find(x => (x.out.why_first?.options[0].lines ?? []).some(l => l.detail && l.kind === 'class_not_started'))!;
    const h = card(r, 0);
    assert.equal((h.match(/More on why/g) ?? []).length, 1);
    assert.ok(h.indexOf('More on why') > h.indexOf('data-testid="why-1"'));
});
check('T19c: the block is shown once (not also in the visit review panel); a class left out because every plan with it was excluded names the rule', () => {
    for (const r of withOptions.slice(0, 120)) {
        const t = screen(r);
        assert.equal((t.match(/data-testid="why-1"/g) ?? []).length, 1, r.title);
        assert.equal((t.match(/<h4[^>]*>Why this is first<\/h4>/g) ?? []).length, 1, r.title);
        assert.doesNotMatch(t, /data-testid="visit-why"|Why option \d is first|is listed at position/, r.title);
    }
    // a class that no scored plan starts names the state that stopped it, never an alert that stops nothing
    const cold = SCENARIOS.find(s => /Jane Smith/.test(s.title))!;
    const o = generateAndScoreModifications(cold.patient, names, prices);
    const t = (o.why_first?.options[0].lines ?? []).map(l => l.text).join(' ');
    assert.match(t, /Not started: no drug is started while the patient shows signs of poor perfusion|appears in option|Not started: no/i);
});

// ------------------------------------------------------------------------------------------------ T17: confirm all
const rm = (name: string, exposure?: RegimenMed['exposure']): RegimenMed => {
    const med = MEDICATION_FORMULARY.find(m => m.name.startsWith(name))!;
    const dose = med.available_doses[0];
    return { med, dose, selected_frequency: dose.frequency_options[0], ...(exposure ? { exposure } : {}) };
};
check('T17: "Confirm all as taking as recorded" changes only drugs whose use is not assessed; held, uncertain, partial, interrupted and already-recorded drugs are returned exactly as entered', () => {
    const base = ['Lisinopril', 'Carvedilol', 'Furosemide', 'Spironolactone', 'Dapagliflozin'];
    const states: [string, RegimenMed['exposure']][] = [
        ['held', { status: 'held' }], ['uncertain', { status: 'unknown' }], ['partial', { status: 'active', adherence: 'partial' }], ['interrupted', { adherence: 'partial' }],
        ['completed', { status: 'completed' }], ['unknown consistency', { status: 'active', adherence: 'unknown' }], ['active no consistency', { status: 'active' }],
    ];
    let cases = 0;
    for (const [label, st] of states) for (const pos of [0, 2, 4]) {
        // the reviewer's patient (a held drug among assessed and unassessed ones) and neighbours: the recorded drug at three positions, with two unassessed drugs beside it
        const regimen = base.map((n, i) => (i === pos ? rm(n, st) : i === 1 ? rm(n, { status: 'active', adherence: 'consistent' }) : rm(n)));
        const before = JSON.stringify(regimen.map(r => r.exposure ?? null));
        const res = confirmUnassessedUse(regimen);
        cases++;
        res.regimen.forEach((r, i) => {
            if (i === pos || i === 1) assert.equal(JSON.stringify(r.exposure ?? null), JSON.stringify(regimen[i].exposure ?? null), `${label}@${pos}: ${r.med.name} changed`);
            else assert.ok(isUseConfirmed(r), `${label}@${pos}: ${r.med.name} not confirmed`);
        });
        assert.ok(!res.confirmed.includes(base[pos]), `${label}: named as confirmed`);
        assert.equal(res.confirmed.length, 3, label);
        assert.ok(res.leftAlone.some(x => x.name === base[pos]), `${label}: not named as left alone`);
        assert.equal(JSON.stringify(regimen.map(r => r.exposure ?? null)), before, 'the input must not be mutated');
    }
    assert.ok(cases === 21, `${cases}`);
});
check('T17: the review step names how many drugs the control confirms and the ones it leaves alone, and the result banner names both', () => {
    const p = { ...(SCENARIOS[0].patient), current_regimen: [rm('Lisinopril', { status: 'held' }), rm('Carvedilol'), rm('Furosemide', { status: 'unknown' }), rm('Spironolactone')] } as Patient;
    const html = textOf(renderToStaticMarkup(<ReviewStep patient={p} problems={[]} hints={{}} hasErrors={false} onGoToField={() => {}} onRun={() => {}} pricesReady onConfirmAllUse={() => {}} confirmNote={{ confirmed: ['Carvedilol', 'Spironolactone'], leftAlone: [{ name: 'Lisinopril', recorded: 'held: restart needs review; consistency not assessed' }] }} />));
    assert.match(html, /Confirm all as taking as recorded \(2 not yet assessed\)/);
    assert.match(html, /changes only drugs whose use has not been assessed: Carvedilol, Spironolactone/);
    assert.match(html, /leaves alone what you recorded for Lisinopril \(held: restart needs review\), Furosemide \(current use uncertain\)/);
    assert.match(html, /confirmNote|Left as you recorded them, not confirmed: Lisinopril/);
    // with nothing unassessed the control is not offered
    const q = { ...p, current_regimen: [rm('Lisinopril', { status: 'held' })] } as Patient;
    assert.doesNotMatch(textOf(renderToStaticMarkup(<ReviewStep patient={q} problems={[]} hints={{}} hasErrors={false} onGoToField={() => {}} onRun={() => {}} pricesReady onConfirmAllUse={() => {}} />)), /Confirm all as taking as recorded/);
});
check('T17: editing a drug\'s dose or frequency resets its use record to "not assessed" (no stale "active"), and the use label is in words', () => {
    for (const e of [{ status: 'active', adherence: 'consistent', dose_interval_reviewed: true, dose_changed_on: '2026-01-01', started_on: '2025-01-01' }, { status: 'held', restart_or_repeat_reviewed: true }, { status: 'unknown', adherence: 'partial' }] as RegimenMed['exposure'][]) {
        const after = exposureAfterDoseEdit(e);
        assert.equal(useStatusWords(after), 'not assessed');
        assert.equal(after?.adherence, undefined);
        assert.ok(!after?.dose_interval_reviewed && !after?.restart_or_repeat_reviewed && !after?.dose_changed_on);
    }
    assert.equal(exposureAfterDoseEdit(undefined), undefined);
    assert.equal(useStatusWords({ status: 'active' }), 'taking as recorded');
});

// ------------------------------------------------------------------------------------------------ T7: dose steps
check('T7: an option whose only changes are dose steps shows the point estimate with "estimated from the dose relationship; no interval" (card, note), never a narrow interval; a mixed option says the interval leaves out the dose relationship', () => {
    let doseOnly = 0, mixed = 0, others = 0;
    for (const r of withOptions) r.out.scoredRegimens.forEach((o, i) => {
        const mods = (o.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
        if (mods.length === 0) return;
        const t = textOf(card(r, i));
        const lines = [...t.matchAll(/(Death from any cause|Heart-failure hospitalization): [^()]*\(relative risk[^)]*\)/g)].map(m => m[0]);
        const isDose = mods.every(m => m.action === 'titrate_up' || m.action === 'titrate_down');
        const hasNotModelled = /not modelled for a loop diuretic dose change/.test(t);
        if (isDose) {
            doseOnly++;
            for (const l of lines) { assert.match(l, /relative risk \d\.\d\d, estimated from the dose relationship; no interval\)$/, `${r.title} option ${i + 1}: ${l}`); assert.doesNotMatch(l, /95% interval/, r.title); }
            if (!hasNotModelled) assert.ok(lines.length >= 1, `${r.title}: no outcome line`);
            const note = buildChartSummary(chartInput(r), i);
            if (lines.length > 0) assert.match(note, /estimated from the dose relationship; no interval/, `${r.title}: note`);
        } else {
            others++;
            for (const l of lines) assert.doesNotMatch(l, /estimated from the dose relationship/, `${r.title} option ${i + 1}: ${l}`);
            if (mods.some(m => (m.action === 'titrate_up' || m.action === 'titrate_down') && m.target && m.target.med.drug_class !== 'Loop Diuretic') && lines.some(l => /95% interval/.test(l))) { mixed++; assert.match(t, /The interval does not include the uncertainty of the dose relationship for the dose step of/, `${r.title} option ${i + 1}`); }
        }
    });
    assert.ok(doseOnly >= 20 && others >= 100 && mixed >= 3, `${doseOnly} dose-only, ${mixed} mixed, ${others} other options`);
});

// ------------------------------------------------------------------------------------------------ T8: borrowed rows
check('T8: every outcome and symptom row says which drugs its source tested; a drug of the class that the source did not test reads "borrowed from <drug> (<trial>)" (eplerenone from TOPCAT and five neighbours)', () => {
    for (const r of [...OUTCOME_EVIDENCE_TABLE, ...SYMPTOM_TABLE]) {
        assert.ok('tested_drugs' in r, `${r.id}: no tested_drugs field`);
        if (r.tested_drugs !== null) assert.ok(Array.isArray(r.tested_drugs) && r.tested_drugs.length >= 1 && r.tested_drugs.every(x => x.length > 2), `${r.id}`);
        assert.equal(typeof r.tested_trial, 'string', r.id);
    }
    const o = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)!, sy = (id: string) => SYMPTOM_TABLE.find(r => r.id === id)!;
    assert.equal(borrowedFrom(o('mra-preserved-death'), 'Eplerenone'), 'borrowed from Spironolactone (TOPCAT)');
    assert.equal(borrowedFrom(o('mra-preserved-death'), 'Spironolactone'), null);
    assert.equal(borrowedFrom(o('mra-mildly-reduced-hfh') ?? o('mra-mildly-reduced-death'), 'Eplerenone'), 'borrowed from Spironolactone (TOPCAT)');
    assert.match(borrowedFrom(o('acei-reduced-death'), 'Lisinopril')!, /^borrowed from Captopril, Ramipril, Enalapril and Trandolapril \(/);
    assert.equal(borrowedFrom(o('acei-reduced-death'), 'Enalapril'), null);
    assert.match(borrowedFrom(o('arb-reduced-death'), 'Losartan')!, /^borrowed from Candesartan \(CHARM\)$/);
    assert.equal(borrowedFrom(o('arb-reduced-death'), 'Candesartan (Atacand)'), null);
    assert.match(borrowedFrom(o('nsmra-reduced-death'), 'Finerenone (Kerendia)')!, /borrowed from Spironolactone and Eplerenone \(RALES and EMPHASIS-HF\)/);
    // Rewritten 2026-11-19 (ruling U12): a row of conflicting or no outcome evidence still names the drugs its source tested; a drug it did not test is "borrowed from" them.
    assert.equal(borrowedFrom(o('glp1-reduced-hfhosp'), 'Tirzepatide (Zepbound)'), 'borrowed from Semaglutide and Liraglutide (SELECT and FIGHT)');
    assert.equal(borrowedFrom(o('glp1-reduced-hfhosp'), 'Semaglutide (Wegovy)'), null);
    for (const d of ['Metolazone', 'Chlorthalidone']) assert.match(borrowedFrom(o('thiazide-reduced-death'), d)!, /^borrowed from Hydrochlorothiazide \(/);
    assert.equal(borrowedFrom(o('thiazide-reduced-death'), 'Hydrochlorothiazide'), null);
    assert.match(borrowedFrom(sy('arb-reduced'), 'Irbesartan')!, /^borrowed from Valsartan \(Val-HeFT\)$/);
    assert.equal(borrowedFrom(sy('arb-reduced'), 'Valsartan'), null);
    assert.match(borrowedFrom(sy('iviron-preserved'), 'Ferric Carboxymaltose')!, /borrowed from Ferric Derisomaltose \(IRONMET-HFpEF\)/);
    assert.match(borrowedFrom(sy('mra-preserved'), 'Eplerenone')!, /borrowed from Spironolactone \(TOPCAT\)/);
    assert.match(borrowedFrom(sy('kbinder-reduced'), 'Patiromer')!, /borrowed from Sodium Zirconium Cyclosilicate \(REALIZE-K\)/);
    assert.equal(borrowedFrom(o('arni-reduced-death'), 'Sacubitril/Valsartan (Entresto)'), null);
    assert.equal(borrowedFrom(o('loop-reduced-death-congested'), 'Torsemide'), null); // the review does not name its drugs: no borrowing is claimed
});
check('T8: the borrowed words appear on the card, in the drill-down and in the evidence table', () => {
    let optionsWith = 0;
    const table = textOf(renderToStaticMarkup(<EvidenceTables />));
    assert.match(table, /Eplerenone: borrowed from Spironolactone \(TOPCAT\)/);
    assert.match(table, /Lisinopril: borrowed from Captopril, Ramipril, Enalapril and Trandolapril/);
    assert.match(table, /Finerenone \(Kerendia\): borrowed from Spironolactone and Eplerenone \(RALES and EMPHASIS-HF\)/);
    for (const r of withOptions) r.out.scoredRegimens.forEach((opt, i) => {
        const want = new Map<string, string>();
        for (const v of opt.outcome_estimates ?? []) for (const c of v.contributors) { const row = OUTCOME_EVIDENCE_TABLE.find(x => x.id === c.row_id)!; const b = borrowedFrom(row, c.medication); if (b) want.set(c.medication, b); }
        for (const c of opt.symptom_estimate?.contributors ?? []) { const row = SYMPTOM_TABLE.find(x => x.id === c.row_id)!; const b = c.not_measured ? null : borrowedFrom(row, c.medication); if (b && !want.has(c.medication)) want.set(c.medication, b); }
        const html = textOf(card(r, i)) + ' ' + textOf(renderToStaticMarkup(<EvidenceDrillDown regimen={opt} />));
        if (want.size === 0 || isNoChangeOpt(opt)) { assert.doesNotMatch(textOf(card(r, i)), /Borrowed evidence:/, `${r.title} option ${i + 1}`); return; }
        optionsWith++;
        for (const [d, b] of want) {
            assert.ok(textOf(card(r, i)).includes(`${d} ${b}`), `${r.title} option ${i + 1}: card lacks "${d} ${b}"`);
            assert.ok(html.includes(`${b.charAt(0).toUpperCase()}${b.slice(1)}. In that source:`), `${r.title} option ${i + 1}: drill-down lacks the basis for ${d}`);
        }
    });
    assert.ok(optionsWith >= 10, `${optionsWith} options with borrowed evidence`);
    assert.ok(borrowedLines(OUTCOME_EVIDENCE_TABLE.find(r => r.id === 'mra-preserved-hfh')!).some(l => /Eplerenone/.test(l)));
});

// ------------------------------------------------------------------------------------------------ T10, T11
const evidenceHtml = renderToStaticMarkup(<EvidenceTables />);
const rowHtml = (kind: string, id?: string): string[] => evidenceHtml.split('<tr ').filter(x => x.includes(`data-evidence-row="${kind}"`) && (!id || x.includes(`data-row-id="${id}"`))).map(x => textOf(`<tr ${x}`));
check('T10: a row with no interval, no outcome evidence or conflicting evidence says "No weighting applied: no trial estimate", never "the trial figure gets weight"; every other row keeps the weighting sentence', () => {
    let unweighted = 0, weighted = 0;
    for (const r of OUTCOME_EVIDENCE_TABLE) {
        const [t] = rowHtml('outcome', r.id);
        assert.ok(t, r.id);
        if (outcomeRowUnweighted(r)) { unweighted++; assert.match(t, /No weighting applied: no trial estimate\./, r.id); assert.doesNotMatch(t, /the trial figure gets weight/, r.id); }
        else { weighted++; assert.match(t, /the trial figure gets weight \d\.\d\d/, r.id); assert.doesNotMatch(t, /No weighting applied/, r.id); }
    }
    assert.ok(unweighted >= 29 && weighted >= 40, `${unweighted} unweighted, ${weighted} weighted rows`);
    for (const id of ['glp1-reduced-death', 'glp1-reduced-hfhosp', 'beta-blocker-preserved-death', 'loop-reduced-death-other', 'thiazide-reduced-death', 'kbinder-reduced-death', 'ivabradine-preserved-death', 'vericiguat-preserved-death', 'vasodilator-black-preserved-death']) assert.ok(outcomeRowUnweighted(OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)!), id);
    // the drill-down says the same for a displayed option
    let seen = 0;
    for (const r of withOptions) r.out.scoredRegimens.forEach(opt => {
        const t = textOf(renderToStaticMarkup(<EvidenceDrillDown regimen={opt} />));
        for (const v of opt.outcome_estimates ?? []) for (const c of v.contributors) { const row = OUTCOME_EVIDENCE_TABLE.find(x => x.id === c.row_id)!; if (outcomeRowUnweighted(row)) { seen++; assert.match(t, /No weighting applied: no trial estimate\./, `${r.title}: ${c.row_id}`); } }
    });
    assert.ok(seen >= 20, `${seen}`);
});
check('T11: a symptom row that is a no-estimate convention (a value of 0.0 with no interval) is "Not measured" and is not labelled "Randomized trial"', () => {
    let n = 0;
    for (const r of SYMPTOM_TABLE) {
        const convention = r.kccq_points === 0 && r.ci_low === null && r.ci_high === null;
        if (convention) { n++; assert.equal(r.basis, 'not_measured', r.id); }
    }
    assert.ok(n >= 10, `${n}`);
    const all = rowHtml('symptom');
    assert.equal(all.length, SYMPTOM_TABLE.length);
    for (const id of ['sgc-reduced', 'inotrope-reduced', 'inotrope-mildly_reduced', 'inotrope-preserved']) {
        const row = SYMPTOM_TABLE.find(r => r.id === id)!;
        const t = all[SYMPTOM_TABLE.indexOf(row)];
        assert.match(t, /Not measured/, id); assert.doesNotMatch(t, /Randomized trial|Extrapolated|Published 0\.0/, id);
    }
});

// ------------------------------------------------------------------------------------------------ T12: no internal review language
export const INTERNAL_WORDS = /\bcontroller\b|\bruling\b|\brulings\b|\bchange [A-Z]\d+\b|\b[ERC]\d{1,2}\b|researcher|as the ruling|round \d (review|fix)|\bowner (ruling|review|decision|recommendation)\b|per controller|golden|first-principles README|HF-[A-Z]+-\d+/i;
check('T12: no displayed cell or note of any evidence row (evidence tables, every drill-down) carries internal review language, rule numbers, underscores or em dashes', () => {
    const where = new Map<string, string>();
    const scan = (t: string, w: string) => { for (const m of t.matchAll(new RegExp(INTERNAL_WORDS.source, 'gi'))) where.set(`${w}: ...${t.slice(Math.max(0, m.index! - 50), m.index! + 60)}`, w); if (/—/.test(t)) where.set(`${w}: em dash`, w); if (/\b[a-z]+_[a-z_]+\b/.test(t.replace(/[a-z_-]+="[^"]*"/g, ''))) where.set(`${w}: underscore ${(t.match(/\b[a-z]+_[a-z_]+\b/) ?? [''])[0]}`, w); };
    scan(textOf(evidenceHtml), 'evidence tables');
    const seen = new Set<string>();
    for (const r of withOptions) r.out.scoredRegimens.forEach(opt => { const key = (opt.outcome_estimates ?? []).flatMap(v => v.contributors.map(c => c.row_id)).join('|') + '#' + (opt.harm_burden?.lines.map(l => l.kind === 'harm' ? l.row_id : 'sym').join('|') ?? ''); if (seen.has(key)) return; seen.add(key); scan(textOf(renderToStaticMarkup(<EvidenceDrillDown regimen={opt} />)), `drill-down ${r.title}`); });
    assert.equal(where.size, 0, [...where.keys()].slice(0, 6).join('\n'));
    assert.ok(seen.size >= 100, `${seen.size} distinct drill-downs scanned`);
});

// ------------------------------------------------------------------------------------------------ T13: label precision
check('T13: a row with two inferences names both; outcome-definition conversions say "converted from a different outcome definition"; the beta-blocker death note no longer says its upper limit lies outside the sinus interval', () => {
    const o = (id: string) => OUTCOME_EVIDENCE_TABLE.find(r => r.id === id)!, sy = (id: string) => SYMPTOM_TABLE.find(r => r.id === id)!;
    const L = (r: { basis: string; inferences?: string[] }) => basisLabelOf(r.basis, r.inferences);
    // the reviewer's rows and three neighbours each
    assert.equal(L(sy('bb-preserved')), 'Converted from another questionnaire and carried from another EF band');
    assert.equal(L(sy('bb-mildly_reduced')), 'Converted from another questionnaire and carried from another EF band');
    assert.equal(L(sy('vasodilator-mildly_reduced')), 'Converted from another questionnaire, carried from another EF band and carried from another population');
    assert.equal(L(sy('vasodilator-preserved')), 'Converted from another questionnaire, carried from another EF band and carried from another population');
    assert.equal(L(sy('acei-reduced')), 'Converted from another questionnaire and carried from an ARB to ACE inhibitors');
    assert.equal(L(sy('bb-reduced')), 'Converted from another questionnaire');
    assert.equal(L(sy('arb-reduced')), 'Converted from another questionnaire');
    for (const id of ['kbinder-szc-reduced-hfhosp', 'beta-blocker-reduced-hfh-afib']) assert.equal(L(o(id)), 'Converted from a different outcome definition', id);
    assert.equal(L(o('kbinder-szc-preserved-hfhosp')), 'Converted from a different outcome definition and carried from another EF band');
    assert.equal(L(o('beta-blocker-mildly-reduced-hfh')), 'Converted from a different outcome definition and carried from another EF band');
    assert.equal(L(o('acei-mildly-reduced-death')), 'Carried from an ARB to ACE inhibitors and carried from another EF band');
    assert.equal(L(o('mra-mildly-reduced-death')), 'Carried from another EF band');
    // every converted or extrapolated row names at least one inference, and the label never uses the generic words when a code exists
    for (const r of [...OUTCOME_EVIDENCE_TABLE, ...SYMPTOM_TABLE]) if (r.basis === 'extrapolated' || r.basis === 'converted') { assert.ok((r.inferences ?? []).length >= 1, `${r.id}: no inference named`); assert.doesNotMatch(L(r), /^Extrapolated \(carried/, r.id); }
    const t = rowHtml('outcome', 'kbinder-szc-reduced-hfhosp')[0];
    assert.match(t, /Converted from a different outcome definition/);
    assert.doesNotMatch(t, /Extrapolated/);
    const note = OUTCOME_EVIDENCE_TABLE.find(r => r.id === 'beta-blocker-reduced-death')!.notes;
    assert.doesNotMatch(note, /upper limit \(0\.74\) lies just outside/);
    assert.match(note, /point estimate \(0\.66\) lies just below the lower limit of that interval \(0\.67\)/);
});

// ------------------------------------------------------------------------------------------------ T9: notes on the screen
check('T9: every row has a "Notes" disclosure with its caveats in plain words: carvedilol syncope (both label figures and why one was used), the binder composite, the 72-hour thiazide figure, and where every borrowed or extrapolated harm row came from', () => {
    const harmRow = (id: string): string => evidenceHtml.split('<tr ').filter(x => x.includes('data-evidence-row="harm"') && x.includes(`data-row-id="${id}"`)).map(x => textOf(`<tr ${x}`))[0] ?? '';
    for (const id of ['BB-carvedilol-syncope', 'BB-class-syncope-sibling']) {
        const t = harmRow(id); assert.ok(t, id);
        assert.match(t, /Notes/, id); assert.match(t, /2\.9% against 2\.3%/, id); assert.match(t, /8% against 5%/, id); assert.match(t, /Why that one: section 5\.3 is the label's dedicated statement/, id);
    }
    for (const id of ['kbinder-szc-reduced-hfhosp', 'kbinder-szc-mildly_reduced-hfhosp', 'kbinder-szc-preserved-hfhosp']) { const [t] = rowHtml('outcome', id); assert.match(t, /randomized-withdrawal trial/, id); assert.match(t, /exploratory endpoint with 14 events/, id); assert.match(t, /possible signal, not an established finding/, id); }
    for (const id of ['hctz-creatinine', 'chlorthalidone-creatinine', 'metolazone-creatinine']) {
        const t = harmRow(id); assert.ok(t, id);
        assert.match(t, /\d+\.\d+% over (72|48) hours/, id); assert.doesNotMatch(t, /\d\.\d% a year/, id); assert.match(t, /excess over (72|48) hours, not per year/, id);
    }
    // finished: the rows the evidence reviewer named, and every other borrowed or extrapolated harm row says where it came from
    for (const id of ['chlorthalidone-creatinine', 'thiazide-gout', 'szc-hypokalemia', 'szc-edema', 'szc-constipation', 'torsemide-urinary-frequency', 'ACEi-enalapril-syncope', 'vas-syncope', 'loop-gout']) { const t = harmRow(id); assert.ok(t, id); assert.match(t, /Notes/, id); }
    let n = 0;
    for (const r of HARM_TABLE.rows) if (r.level !== 'drug') { n++; const t = harmRow(r.id); assert.match(t, /Where this figure comes from: .{5,}/, r.id); assert.match(t, /Notes/, r.id); }
    assert.ok(n >= 60, `${n} borrowed or extrapolated harm rows`);
    // every outcome row says whom the source studied
    for (const r of OUTCOME_EVIDENCE_TABLE) assert.match(rowHtml('outcome', r.id)[0], /Notes[\s\S]*Population studied: /, r.id);
    // the drill-down of an option shows the same notes
    let carv = 0, thz = 0;
    for (const r of withOptions) r.out.scoredRegimens.forEach(opt => {
        const t = textOf(renderToStaticMarkup(<EvidenceDrillDown regimen={opt} />));
        if (opt.harm_burden?.lines.some(l => l.kind === 'harm' && l.row_id === 'BB-carvedilol-syncope')) { carv++; assert.match(t, /2\.9% against 2\.3%[\s\S]*8% against 5%/, r.title); }
        if (opt.harm_burden?.lines.some(l => l.kind === 'harm' && /creatinine/.test(l.row_id) && /^(hctz|metolazone|chlorthalidone)/.test(l.row_id) && l.charged_rate > 0)) { thz++; assert.match(t, /measured over (72|48) hours/, r.title); }
    });
    assert.ok(carv >= 20 && thz >= 1, `${carv} carvedilol options, ${thz} thiazide options`);
});

// ------------------------------------------------------------------------------------------------ T20: the Evidence tab
const stripTechnical = (html: string): string => html.replace(/<details[^>]*>(?:(?!<\/details>)[\s\S])*?Technical reference[\s\S]*?<\/details>/g, '').replace(/<section id="faq-evidence-matrix"[\s\S]*?<\/section>/g, '');
check('T20: the Evidence tab never says "engine policy", shows no code constant, and shows rule numbers only inside a technical-reference disclosure; every matrix row names only constants and rules that exist', () => {
    const faq = renderToStaticMarkup(<FAQ evidenceQuery="" onEvidenceQueryChange={() => {}} jumpNonce={0} />);
    const outside = textOf(stripTechnical(faq));
    const everywhere = textOf(faq);
    assert.doesNotMatch(everywhere, /engine policy/i);
    assert.doesNotMatch(everywhere, /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/);
    assert.doesNotMatch(outside, /\bRule E\d|\bE\d{2}\b|\bHF-[A-Z0-9]+-\d+/);
    assert.match(everywhere, /tool policy: not from a trial or guideline/);
    assert.match(faq, /data-testid="technical-reference"/);
    // internal review language nowhere in the matrix or the tab
    assert.doesNotMatch(everywhere, /\bcontroller\b|\brulings?\b|[Rr]eviewer finding|\bowner (ruling|decision|recommendation)s?\b|first researcher|round \d (review|fix)/);
    // the row the reviewer named, and every superseded tag, are gone; every constant the matrix text names exists in the code
    const md = fs.readFileSync(new URL('../docs/evidence-matrix.md', import.meta.url), 'utf8');
    assert.doesNotMatch(md, /\[(Partly )?[Ss]uperseded/);
    assert.ok(!/TITRATE_NOT_SWAP_GROUPS|URIC_ACID_GOUT_POINTS/.test(md));
    const code = [...fs.readdirSync(new URL('../services/engine/', import.meta.url)).map(f => `services/engine/${f}`), 'constants.ts', 'services/clinicalPredicates.ts', 'services/simulationService.ts', 'services/pricingService.ts', 'components/appStatements.ts'].map(f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n');
    const consts = [...new Set(md.match(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/g) ?? [])];
    for (const c of consts) assert.ok(new RegExp(`\\b${c}\\b`).test(code), `${c} is named in the matrix but does not exist in the code`);
    // eligibility rule ids named in the matrix exist
    const ruleIds = new Set(ELIGIBILITY_RULES.map(r => r.id));
    for (const m of md.matchAll(/\brule (E\d{2})\b/gi)) assert.ok(ruleIds.has(m[1]), `rule ${m[1]} named in the matrix does not exist`);
});

// ------------------------------------------------------------------------------------------------ T21: print summary and labels
check('T21: the print summary carries the analysis time, the rule set, the case label, the regimen as entered and the unconfirmed-drug notes, no skip link; evidence-link labels carry no bare count; the panel title uses the body words', () => {
    let n = 0;
    for (const r of withOptions.slice(0, 150)) {
        const html = screen(r);
        const m = html.match(/<section data-print-summary[\s\S]*?<\/section>/);
        assert.ok(m, r.title);
        const t = textOf(m![0]);
        assert.match(t, /Analysis run: \d{4}-\d{2}-\d{2} \d{2}:\d{2}\./, r.title);
        assert.match(t, new RegExp(`Rule-set version: ${RULESET_VERSION.replace(/[.]/g, '\\.')}\\.`), r.title);
        assert.match(t, /Case label: /, r.title);
        assert.match(t, /Current regimen as entered: /, r.title);
        for (const drug of r.patient.current_regimen) assert.ok(t.includes(drug.med.name), `${r.title}: ${drug.med.name} missing from the printed regimen`);
        if (r.patient.current_regimen.some(d => !isUseConfirmed(d))) assert.match(t, /Use and course history is not confirmed for /, r.title);
        else assert.doesNotMatch(t, /not confirmed for/, r.title);
        assert.doesNotMatch(t, /Skip to main content/, r.title);
    }
    // a patient whose drugs are not confirmed, and one with a held drug (neighbours of each other)
    const base = SCENARIOS.find(x => x.title.startsWith('Elderly >80 on All 4 Pillars'))!.patient;
    for (const mode of ['none', 'held', 'uncertain']) {
        const q = clonePatient(base);
        q.current_regimen = q.current_regimen.map((x, i) => ({ ...x, exposure: mode === 'none' ? undefined : i === 0 ? { status: mode === 'held' ? 'held' : 'unknown' } as RegimenMed['exposure'] : { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } as RegimenMed['exposure'] }));
        const run: Run = { title: `unconfirmed ${mode}`, patient: q, out: generateAndScoreModifications(q, names, prices) };
        const t = textOf(screen(run).match(/<section data-print-summary[\s\S]*?<\/section>/)![0]);
        n++;
        assert.match(t, /Use and course history is not confirmed for /, mode);
        assert.ok(t.includes(q.current_regimen[0].med.name), mode);
        if (mode !== 'none') assert.match(t, new RegExp(`${q.current_regimen[0].med.name.replace(/[()/]/g, '\\$&')}[^;]*\\((held: restart needs review|current use uncertain)\\)`), mode);
    }
    assert.ok(n >= 3, `${n} runs with unconfirmed drugs`);
    const app = fs.readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    assert.match(app, /className="sr-only print:hidden[^"]*">\s*Skip to main content/);
    for (const r of withOptions.slice(0, 80)) { const t = textOf(screen(r)); assert.doesNotMatch(t, /Evidence for [A-Za-z\/ ()-]+? \(\d+\)/, r.title); }
    assert.ok(withOptions.some(r => /Evidence for [A-Z][a-z]+/.test(textOf(screen(r)))), 'evidence links still exist');
    const panel = textOf(renderToStaticMarkup(<DecisionReadinessPanel assessment={{ mode: 'limited_review', available: ['a'], deferred: ['b'], missing: [{ field: 'x', label: 'X', consequence: 'c' }] } as never} />));
    assert.match(panel, /Decisions waiting for information \(1\)/);
    assert.doesNotMatch(panel, /Information to obtain and decisions that wait/);
});

// ------------------------------------------------------------------------------------------------ T14 (reversed): one drug's own figure never replaces the class figure unless it records events the same way
// Principle (controller, 2026-11-19): within one drug class, a harm row specific to one drug is charged only if its definition matches the row it replaces (the same kind of event
// recording). Otherwise the class row is charged and the drug's own figure is shown in the notes. `event_recording` says how each such row recorded the event.
const KNOWN_RECORDING_MISMATCHES = ['ACEi-AIRE-cough-ramipril', 'ACEi-AIRE-creatinineRise-ramipril', 'ACEi-AIRE-hypotensionSymptomatic-ramipril', 'ACEi-enalapril-syncope', 'ACEi-lisinopril-hypotension'];
export function recordingMismatches(rows: { id: string; drug_class: string; effect: string; drugs: string[]; event_recording?: string }[]): string[] {
    const bad: string[] = [];
    for (const d of rows.filter(r => r.drugs.length > 0)) {
        const classRows = rows.filter(c => c.drugs.length === 0 && c.drug_class === d.drug_class && c.effect === d.effect);
        if (classRows.length === 0) continue;                                   // nothing is replaced
        if (!d.event_recording || classRows.some(c => !c.event_recording || c.event_recording !== d.event_recording)) bad.push(d.id);
    }
    return bad.sort();
}
check('T14 (reversed): a drug-specific harm row inside a class is charged only when it records events the way the class row it replaces does; the existing exceptions are listed, and metoprolol succinate and carvedilol have no own bradycardia or dizziness row', () => {
    const rows = HARM_TABLE.rows as unknown as { id: string; drug_class: string; effect: string; drugs: string[]; event_recording?: string }[];
    // the principle itself, on the case that prompted it: a label table of events regardless of causality does not replace a pooled trial-reported class figure
    const classRow = { id: 'c', drug_class: 'Beta Blocker', effect: 'dizziness', drugs: [], event_recording: 'trial_reported' };
    assert.deepEqual(recordingMismatches([classRow, { id: 'd1', drug_class: 'Beta Blocker', effect: 'dizziness', drugs: ['Carvedilol'], event_recording: 'label_table_any_cause' }]), ['d1']);
    assert.deepEqual(recordingMismatches([classRow, { id: 'd2', drug_class: 'Beta Blocker', effect: 'dizziness', drugs: ['Carvedilol'], event_recording: 'trial_reported' }]), []);
    assert.deepEqual(recordingMismatches([classRow, { id: 'd3', drug_class: 'Beta Blocker', effect: 'dizziness', drugs: ['Carvedilol'] }]), ['d3']);
    // the real table: every row of a class and drug pair says how it recorded events; the failures are exactly the listed exceptions (a new failure fails the gate; a repaired one must leave the list)
    for (const r of rows) if (rows.some(o => o.drug_class === r.drug_class && o.effect === r.effect && (o.drugs.length === 0) !== (r.drugs.length === 0))) assert.ok(r.event_recording, `${r.id}: no event_recording`);
    assert.deepEqual(recordingMismatches(rows), KNOWN_RECORDING_MISMATCHES);
    for (const id of ['BB-metoprolol-bradycardiaSymptomatic', 'BB-metoprolol-dizziness', 'BB-carvedilol-bradycardiaSymptomatic', 'BB-carvedilol-dizziness']) assert.ok(!rows.some(r => r.id === id), `${id} must not be a charged row`);
    // all three beta-blockers are charged the class figure for these two harms, in every displayed option
    let n = 0;
    for (const r of withOptions) r.out.scoredRegimens.forEach(opt => {
        for (const l of opt.harm_burden?.lines ?? []) {
            const parts = l.kind === 'harm' ? [{ effect: l.effect, row_id: l.row_id }] : l.components.map(c => ({ effect: c.effect, row_id: c.row_id }));
            for (const p of parts) if (['Carvedilol', 'Metoprolol Succinate', 'Bisoprolol'].includes(l.drug) && (p.effect === 'dizziness' || p.effect === 'bradycardiaSymptomatic')) { n++; assert.match(p.row_id, /^BB-Ko-/, `${l.drug} ${p.effect}`); }
        }
    });
    assert.ok(n >= 50, `${n} lines`);
});

// ------------------------------------------------------------------------------------------------ T15: the status document
check('T15: docs/expert-review-2026-11-19/evidence-status.md carries the current rule set and the fingerprint of the evidence data files (it fails when it is stale), files not-measured rows as not measured, prints no interval that is not an interval of the value, and states the three priors', () => {
    const doc = fs.readFileSync(new URL('../docs/expert-review-2026-11-19/evidence-status.md', import.meta.url), 'utf8');
    const fingerprint = createHash('sha256').update(Buffer.concat(['outcomeEvidence', 'symptomEvidence', 'harmEvidence', 'doseEvidence', 'harmDefinitions'].map(f => fs.readFileSync(new URL(`../data/${f}.json`, import.meta.url))))).digest('hex').slice(0, 16);
    assert.match(doc, new RegExp(`^# Evidence status of every row, rule set ${RULESET_VERSION.replace(/[.]/g, '\\.')}\\n`), 'the header names a different rule set: run docs/expert-review-2026-11-19/influence.ts and make_evidence_status.py');
    assert.ok(doc.includes(`Data fingerprint: ${fingerprint}`), 'the evidence data files changed after this document was written: regenerate it (influence.ts then make_evidence_status.py)');
    const cell = (id: string): string[] => (doc.split('\n').find(l => l.startsWith(`| ${id} |`)) ?? '').split(' | ');
    for (const id of ['BB-STEP6-AVblockAdv', 'loop-hypomagnesemia', 'thiazide-hypomagnesemia', 'furoscix-injection-site']) assert.match(cell(id).join(' | '), /No figure to check: not measured/, id);
    for (const r of SYMPTOM_TABLE.filter(x => x.basis === 'not_measured')) assert.match(cell(r.id).join(' | '), /No figure to check: not measured/, r.id);
    assert.doesNotMatch(doc, /None to None/);
    for (const id of ['glp1-reduced-death', 'glp1-reduced-hfhosp', 'beta-blocker-preserved-death']) assert.match(cell(id).join(' | '), /1\.0 \(no interval\)/, id);
    assert.doesNotMatch(doc, /\| (meta_analysis|siblingProxy|notMeasured|assumed_neutral|self_identified_black) \|/);
    assert.match(doc, /## The three priors and the rows that rest mostly on a prior/);
    for (const v of ['0.024', '0.082', '6.198']) assert.ok(doc.includes(v), `prior ${v}`);
    assert.match(doc, /\| loop-reduced-death-congested \| outcome \| 0\.06 \|/);
});

check('T19 (follow-up): a reason is never listed twice in one block', () => {
    for (const r of withOptions) for (const o of r.out.why_first?.options ?? []) { const t = o.lines.map(l => l.text); assert.equal(new Set(t).size, t.length, `${r.title} option ${o.rank}: ${t.find((x, i) => t.indexOf(x) !== i)}`); }
});

/**
 * Second screening test (controller, 2026-11-19): where a class row and a drug-specific row both carry a control-arm rate, a drug row whose control-arm rate differs from the class row's by more
 * than CONTROL_RATE_FACTOR is flagged for the reviewer's attention. The factor 3 is a screening threshold, not a clinical number: it is a POLICY NUMBER with no source. It does not change any charged value.
 */
export const CONTROL_RATE_FACTOR = 3;
export function controlRateFlags(rows: { id: string; drug_class: string; effect: string; drugs: string[]; control_pct?: number | null }[]): string[] {
    const flagged: string[] = [];
    for (const d of rows.filter(r => r.drugs.length > 0 && typeof r.control_pct === 'number')) for (const c of rows.filter(x => x.drugs.length === 0 && x.drug_class === d.drug_class && x.effect === d.effect && typeof x.control_pct === 'number')) {
        const hi = Math.max(c.control_pct!, d.control_pct!), lo = Math.min(c.control_pct!, d.control_pct!);
        if (hi > 0 && (lo === 0 || hi / lo > CONTROL_RATE_FACTOR)) flagged.push(d.id);
    }
    return [...new Set(flagged)].sort();
}
const KNOWN_CONTROL_RATE_FLAGS = ['ACEi-AIRE-creatinineRise-ramipril'];
check('T14 (reversed): the placebo-rate comparison flags a drug row whose control-arm rate is more than threefold the class row\'s (the existing flags are listed), and the displayed notes of the beta-blocker class rows state each drug\'s own label figures and why the class figure is charged to all three', () => {
    assert.deepEqual(controlRateFlags([{ id: 'c', drug_class: 'X', effect: 'e', drugs: [], control_pct: 1 }, { id: 'd', drug_class: 'X', effect: 'e', drugs: ['A'], control_pct: 17 }]), ['d']);
    assert.deepEqual(controlRateFlags([{ id: 'c', drug_class: 'X', effect: 'e', drugs: [], control_pct: 3 }, { id: 'd', drug_class: 'X', effect: 'e', drugs: ['A'], control_pct: 8 }]), []);
    assert.deepEqual(controlRateFlags(HARM_TABLE.rows as never), KNOWN_CONTROL_RATE_FLAGS);
    const ko = ['BB-Ko-dizziness', 'BB-Ko-bradycardiaSymptomatic'];
    const html = textOf(renderToStaticMarkup(<EvidenceTables />));
    for (const id of ko) {
        const t = evidenceHtml.split('<tr ').filter(x => x.includes(`data-row-id="${id}"`)).map(x => textOf(`<tr ${x}`))[0];
        assert.ok(t, id);
        for (const re of [/metoprolol succinate .*1\.0%|metoprolol succinate .*0\.4%/i, /MERIT-HF/, /the label does not state the follow-up of that table/, /only events at 1% or more and more than 0.5% above placebo/, /carvedilol/i, /10\.4 months/, /Bisoprolol: its label has no heart failure table/, /placebo/i, /charged to all three beta-blockers/]) assert.match(t, re, `${id}: ${re}`);
        assert.doesNotMatch(t, /serious|discontinu/i, `${id}: the label does not say that`);
    }
    assert.match(html, /1\.8% against 1\.0%/); assert.match(html, /24% against 17%/); assert.match(html, /10% against 3%/); assert.match(html, /1\.5% against 0\.4%/);
    // the drill-down of an option with each of the three beta-blockers shows the same notes
    const seen = new Set<string>();
    for (const r of withOptions) r.out.scoredRegimens.forEach(opt => {
        for (const m of opt.regimen) if (['Carvedilol', 'Metoprolol Succinate', 'Bisoprolol'].includes(m.med.name) && !seen.has(m.med.name)) {
            const t = textOf(renderToStaticMarkup(<EvidenceDrillDown regimen={opt} />));
            if (/MERIT-HF/.test(t) && /charged to all three beta-blockers/.test(t)) seen.add(m.med.name);
        }
    });
    assert.deepEqual([...seen].sort(), ['Bisoprolol', 'Carvedilol', 'Metoprolol Succinate']);
});

check('Wording: a comparison with "no change" never adds "; no effect" after the figures', () => {
    let seen = 0;
    for (const r of withOptions) for (const o of r.out.why_first?.options ?? []) for (const l of o.lines) {
        if (l.kind === 'versus_no_change' || /^Also against no change/.test(l.text)) { seen++; assert.doesNotMatch(l.text, /KCCQ-equivalent points; no effect/, r.title); }
    }
    assert.ok(seen >= 100, `${seen}`);
});

console.log(`Part B checks: ${passed} passed; ${failed} failed. Server-rendered content only.`);
