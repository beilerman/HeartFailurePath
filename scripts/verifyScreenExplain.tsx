import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { RecommendationCard } from '../components/RecommendationCard';
import { buildChartSummary } from '../components/resultsModel';
import { buildChartHeader } from '../components/chartHeader';
import { ScoreDetailModal } from '../components/ScoreDetailModal';
import { EvidenceTables } from '../components/EvidenceTables';
import { FAQ } from '../components/FAQ';
import { ReviewStep } from '../components/guided/ReviewStep';
import { enteredFacts } from '../components/guided/patientFacts';
import { encodeSession, decodeSession } from '../components/guided/sessionStore';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { DOMAIN_LABELS } from '../services/engine/scoreModel';
import type { Patient, ScoredRegimen, SimulationOutput } from '../types';

// Checks for the screen-explanation pass (rulings W1 to W7 and three leftovers, 2026-11-19). Server-rendered content only.

let passed = 0;
export let failed = 0;
const check = (name: string, f: () => void) => {
    try { f(); passed++; console.log(`[PASS] ${name}`); }
    catch (error) { failed++; console.error(`[FAIL] ${name}: ${process.env.VERBOSE ? String(error).slice(0, 700) : String(error).split('\n')[0]}`); }
};
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = await getDrugPrices([...names], 'commercial');
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ');

interface Run { title: string; patient: Patient; out: SimulationOutput }
const runs: Run[] = SCENARIOS.map(s => ({ title: s.title, patient: s.patient, out: generateAndScoreModifications(s.patient, names, prices) }));
const propsOf = (r: Run): React.ComponentProps<typeof ResultsDisplay> => ({
    results: r.out.scoredRegimens, runId: 1, error: null, hasRun: true, excludedMedications: r.out.excludedMedications, clinicalAlerts: r.out.clinicalAlerts,
    monitoringPlan: r.out.monitoringPlan, gdmtGaps: r.out.gdmtGaps, eligibleAdjuncts: r.out.eligibleAdjuncts, missingDataNotices: r.out.missingDataNotices,
    followUpCalendar: r.out.followUpCalendar, decisionReadiness: r.out.decisionReadiness, whyFirst: r.out.why_first,
    runSnapshot: { patient: r.patient, ranAt: '2026-11-19T12:00:00Z' },
});
const screen = (r: Run) => renderToStaticMarkup(<ResultsDisplay {...propsOf(r)} />);
const chartInput = (r: Run) => ({ results: r.out.scoredRegimens, clinicalAlerts: r.out.clinicalAlerts, gdmtGaps: r.out.gdmtGaps ?? [], eligibleAdjuncts: r.out.eligibleAdjuncts ?? [], missingDataNotices: r.out.missingDataNotices ?? [], followUpCalendar: r.out.followUpCalendar ?? [], monitoringPlan: r.out.monitoringPlan ?? [], excludedMedications: r.out.excludedMedications, decisionReadiness: r.out.decisionReadiness, whyFirst: r.out.why_first });
const card = (r: Run, i: number) => renderToStaticMarkup(<RecommendationCard regimen={r.out.scoredRegimens[i]} rank={i + 1} leader={i > 0 ? r.out.scoredRegimens[0] : undefined} why={r.out.why_first?.options[i]} />);
const withOptions = runs.filter(r => r.out.scoredRegimens.length > 0);
const multi = runs.filter(r => r.out.scoredRegimens.length > 1);
const noOptions = runs.filter(r => r.out.scoredRegimens.length === 0);
const isNoChangeOpt = (o: ScoredRegimen) => !(o.modification_set?.modifications ?? []).some(m => m.action !== 'keep');
const whyHtml = (html: string) => html.match(/data-testid="why-1"[\s\S]*?<\/ul>/)?.[0] ?? '';

// ------------------------------------------------------------------------------------------------ W1
check('W1: every option 1 card carries a "Why this is first" block with at least one engine-generated line', () => {
    for (const r of withOptions) {
        const h = card(r, 0);
        assert.match(h, /Why this is first/, r.title);
        assert.ok((whyHtml(h).match(/data-why-kind=/g) ?? []).length >= 1, `${r.title}: no line`);
    }
});
check('W1a: with two or more options the block compares option 1 with option 2 in natural units (relative risk, KCCQ-equivalent points, side-effect burden, safety warnings, cost), or says the two are too close to separate (T6/T19: reworded)', () => {
    const units = /relative risk|KCCQ-equivalent points|cheaper each month|fewer doses a day|side-effect burden|safety warnings?|replaces a drug|reduces a diuretic|avoids a projected|no displayed figure differs/;
    for (const r of multi) {
        const t = textOf(whyHtml(card(r, 0)));
        // Rewritten in round 4 (ruling W6d): when option 2 is "no medication change" it is named so, and the separate comparison with no change is not printed again.
        assert.match(t, /Compared with option 2( \(no medication change\))?:|too close to separate/, r.title);
        const line = t.match(/Compared with option 2( \(no medication change\))?:[^]*|too close to separate[^]*/)![0];
        if (/Compared with option 2( \(no medication change\))?:/.test(t)) assert.match(t.match(/Compared with option 2( \(no medication change\))?:[^]*/)![0], units, r.title);
        assert.doesNotMatch(line, /[−+]\d+\.\d points lower|Overall \d+ points? lower/, r.title);
    }
});
check('W1a: every relative risk, KCCQ figure, cost and dose count in the comparison equals the engine figure for that option', () => {
    let checked = 0;
    for (const r of multi.slice(0, 120)) {
        const [a, b] = r.out.scoredRegimens;
        const t = r.out.why_first!.options[0].lines.find(l => l.kind === 'versus_other')!.text;
        const rr = (o: ScoredRegimen) => o.outcome_estimates!.flatMap(e => [e.vs_current.rr.toFixed(2)]);
        const allowed = new Set([...rr(a), ...rr(b)]);
        for (const m of t.matchAll(/relative risk (\d\.\d\d) against (\d\.\d\d)/g)) { assert.ok(allowed.has(m[1]) && allowed.has(m[2]), `${r.title}: ${m[0]}`); checked++; }
        const costs = new Set([a, b].map(o => `$${o.cost.toFixed(2)}`));
        for (const m of t.matchAll(/\((\$\d+\.\d\d) against (\$\d+\.\d\d)\)/g)) { assert.ok(costs.has(m[1]) && costs.has(m[2]), `${r.title}: ${m[0]}`); checked++; }
    }
    assert.ok(checked > 40, `${checked} figures checked`);
});
check('W1a: when two options differ by less than one weighted point the block says they are too close to separate, gives the tie order in words, and no other option is called tied (T19: reworded)', () => {
    let ties = 0;
    for (const r of multi) {
        const [a, b] = r.out.scoredRegimens;
        const diff = Math.abs((a.raw_score ?? 0) - (b.raw_score ?? 0));
        const t = textOf(whyHtml(card(r, 0)));
        if (diff < 1) { ties++; assert.match(t, /Option 1 and option 2( \(no medication change\))? are too close to separate/, r.title);
            // Rewritten 2026-11-19 (ruling U4) and in round 4 (W6a, W6d): when "No medication change" leads by the stated rule, the block says no option scores a point or more above it instead of giving a tie order.
            if (r.out.why_first?.options[0].lines.some(l => /closer than the tool can separate/.test(l.text))) assert.match(t, /closer than the tool can separate/, r.title); else assert.match(t, /listed first because/, r.title); }
        else if (diff >= 1) assert.doesNotMatch(t, /too close to separate/, r.title);
    }
    assert.ok(ties >= 3, `${ties} near-ties seen`);
});
check('W1b: when no change is a candidate and option 1 changes something, the block compares option 1 with making no medication change', () => {
    let seen = 0;
    for (const r of withOptions) {
        const o = r.out.scoredRegimens[0];
        if (isNoChangeOpt(o)) continue;
        const t = textOf(whyHtml(card(r, 0)));
        if (/Compared with making no medication change/.test(t)) seen++;
    }
    assert.ok(seen >= 40, `${seen}`);
});
check('W1c: every indicated class that option 1 does not start, although a drug of it is eligible, has its own reason sentence', () => {
    let rows = 0;
    for (const r of withOptions) {
        const w = r.out.why_first!;
        for (const g of w.gaps) {
            if (g.eligible.length === 0 || !g.reasons[0]) continue;
            rows++;
            const t = textOf(card(r, 0));
            assert.ok(t.includes(g.reasons[0]), `${r.title}: ${g.gap}`);
            assert.match(g.reasons[0], /already uses the limit|appears in option|not among the options shown|Not started: |No plan that starts it passed/, `${r.title}: ${g.reasons[0]}`);
        }
    }
    assert.ok(rows >= 30, `${rows}`);
});
check('W1c: when the per-visit limit is the reason, the sentence names the classes that used it and gives the deciding figures against the best plan with the omitted class', () => {
    const r = runs.find(x => x.title === 'De-novo HFrEF Male Multi-Pillar Start')!;
    const t = textOf(card(r, 0));
    assert.match(t, /already uses the limit of 2 new drug classes \(/);
    // Rewritten 2026-11-19 (ruling U7): the reason is the plan's own fate (below the baseline, repeats a shown option's step, over budget, ranks below the three shown), never "scored lower" unless it did.
    assert.match(t, /A plan that starts it \([^)]*\) is not among the options shown: (it scores below|it differs from option \d only in the drug or dose used|it is over the stated budget|it ranks below the three options shown)/);
});
check('W1d: when option 1 is "no medication change" the block gives the reason on the card, from engine facts', () => {
    let seen = 0;
    for (const r of withOptions) {
        if (!isNoChangeOpt(r.out.scoredRegimens[0])) continue;
        const lines = r.out.why_first!.options[0].lines;
        assert.ok(lines.some(l => l.kind === 'no_change_reason' && l.text.length > 30), r.title);
        const h = whyHtml(card(r, 0));
        assert.match(h, /data-why-kind="no_change_reason"/, r.title);
        seen++;
    }
    assert.ok(seen >= 5, `${seen}`);
    // A patient on drugs whose use and course history is left "not assessed" (the default for a hand-entered patient): the reason is named on the card.
    const base = clonePatient(SCENARIOS.find(x => x.title.startsWith('Elderly >80 on All 4 Pillars'))!.patient);
    base.current_regimen = base.current_regimen.map(x => ({ ...x, exposure: undefined }));
    const out = generateAndScoreModifications(base, names, prices);
    assert.ok(isNoChangeOpt(out.scoredRegimens[0]), 'no change leads when use is unconfirmed');
    const html = renderToStaticMarkup(<RecommendationCard regimen={out.scoredRegimens[0]} rank={1} why={out.why_first!.options[0]} />);
    assert.match(textOf(whyHtml(html)), /use and course history of .* is not confirmed, so no dose increase or substitution/);
});
check('W1: options 2 and 3 carry a "Why this is option N" mirror sentence before the collapsed sections, in the same units', () => {
    for (const r of multi) for (let i = 1; i < r.out.scoredRegimens.length; i++) {
        const h = card(r, i);
        assert.match(h, new RegExp(`Why this is option ${i + 1}`), r.title);
        const t = textOf(h);
        assert.match(t, /Compared with option 1:/, r.title);
        assert.ok(t.indexOf(`Why this is option ${i + 1}`) < t.indexOf('Assessment limits'), r.title);
    }
});
check('W1: the draft note for the selected option carries the same sentence, and names what each other option it mentions is', () => {
    for (const r of multi.slice(0, 80)) for (let k = 0; k < r.out.scoredRegimens.length; k++) {
        const note = buildChartSummary(chartInput(r), k);
        const why = r.out.why_first!.options[k].lines.find(l => l.kind === 'versus_other')!;
        assert.ok(note.includes(why.text), `${r.title} option ${k + 1}`);
        for (const m of why.text.matchAll(/\boption (\d)\b/gi)) { const j = Number(m[1]); if (j !== k + 1) assert.ok(note.includes(`Option ${j} means:`), `${r.title}: option ${j} not described in note ${k + 1}`); }
    }
});

// ------------------------------------------------------------------------------------------------ W2
check('W2: "No eligibility rule withheld a drug in this class" never appears', () => {
    for (const r of runs) assert.doesNotMatch(textOf(screen(r)), /No eligibility rule withheld a drug in this class/, r.title);
});
check('W2: a stop state names the state that withheld everything and nothing refers to "option 1"', () => {
    assert.ok(noOptions.length >= 3, `${noOptions.length}`);
    for (const r of noOptions) {
        const t = textOf(screen(r)), note = buildChartSummary(chartInput(r));
        assert.doesNotMatch(t, /option 1/i, r.title);
        assert.doesNotMatch(note, /option 1/i, r.title);
        assert.ok(r.out.why_first?.stop && r.out.why_first.stop.length > 20, r.title);
        assert.ok(t.includes(r.out.why_first!.stop!), r.title);
    }
    const hypo = runs.find(r => r.title.startsWith('Severe Hypotension'))!;
    assert.match(textOf(screen(hypo)), /Hemodynamic instability/);
});
check('W2: a class the patient could start lists every eligible drug of the class', () => {
    let rows = 0;
    for (const r of withOptions) {
        const t = textOf(screen(r));
        for (const g of r.out.why_first!.gaps) {
            if (g.eligible.length === 0 || (r.out.scoredRegimens[0].modification_set?.modifications ?? []).some(m => m.target && g.eligible.includes(m.target.med.name))) continue;
            rows++;
            assert.ok(t.includes(`Could be started (no rule withholds them): ${g.eligible.join(', ')}.`), `${r.title}: ${g.gap}`);
        }
    }
    assert.ok(rows >= 20, `${rows}`);
});

// ------------------------------------------------------------------------------------------------ W3
const allCardText = (r: Run) => r.out.scoredRegimens.map((_, i) => textOf(card(r, i))).join('\n');
check('W3a: no interval whose two ends are the same figure, no interval for "no change", and no "about the same" on an outcome line', () => {
    for (const r of withOptions) {
        const t = allCardText(r);
        for (const m of t.matchAll(/95% interval (\d\.\d\d) to (\d\.\d\d)/g)) assert.notEqual(m[1], m[2], `${r.title}: ${m[0]}`);
        assert.doesNotMatch(t, /(Death from any cause|Heart-failure hospitalization): about the same/, r.title);
        r.out.scoredRegimens.forEach((o, i) => { if (isNoChangeOpt(o)) assert.doesNotMatch(textOf(card(r, i)), /Versus the current regimen: [^.]*95% interval/, r.title); });
    }
});
check('W3b: a loop diuretic dose change, removal or switch says the effect of the dose on death and hospitalization is not modelled', () => {
    let seen = 0;
    for (const r of withOptions) r.out.scoredRegimens.forEach((o, i) => {
        const loop = (o.modification_set?.modifications ?? []).some(m => ['titrate_up', 'titrate_down', 'remove', 'swap'].includes(m.action) && (m.source?.med.drug_class === 'Loop Diuretic' || m.target?.med.drug_class === 'Loop Diuretic'));
        if (!loop) return;
        seen++;
        const t = textOf(card(r, i));
        assert.match(t, /effect of the loop diuretic dose on death and hospitalization is not modelled/, `${r.title} option ${i + 1}`);
        assert.doesNotMatch(t, /(Death from any cause|Heart-failure hospitalization): (about the same|no measurable difference)/, `${r.title} option ${i + 1}`);
    });
    assert.ok(seen >= 10, `${seen}`);
});
check('W3c: a dose increase with no dose-specific side-effect rate says so instead of "about the same"', () => {
    let seen = 0;
    for (const r of withOptions) r.out.scoredRegimens.forEach((o, i) => {
        const inc = (o.modification_set?.modifications ?? []).filter(m => m.action === 'titrate_up' && m.target && m.target.med.drug_class !== 'Loop Diuretic');
        if (inc.length === 0) return;
        const hb = o.harm_burden!;
        const unmeasured = inc.filter(m => !hb.lines.some(l => l.drug === m.target!.med.name && (l.kind === 'harm' ? l.dose_relation_measured : l.components.some(c => c.dose_relation_measured))));
        if (unmeasured.length === 0) return;
        seen++;
        const t = textOf(card(r, i));
        assert.match(t, /Side effects at the higher dose were not measured separately; the burden shown for .* is that of the current dose/, `${r.title} option ${i + 1}`);
        assert.doesNotMatch(t, /Side-effect burden: about the same/, `${r.title} option ${i + 1}`);
    });
    assert.ok(seen >= 10, `${seen}`);
});
check('W3d: a temporary safety hold or forced reduction is not shown as a permanent withdrawal: the card says the figure is the trial effect of not taking the drug, the reason and when to reassess', () => {
    let seen = 0;
    for (const r of withOptions) r.out.scoredRegimens.forEach((o, i) => {
        const holds = (o.modification_set?.modifications ?? []).some(m => m.temporary_hold);
        const higher = (o.outcome_estimates ?? []).some(e => e.vs_current.rr > 1.005);
        if (!holds || !higher) return;
        seen++;
        const t = textOf(card(r, i));
        assert.match(t, /trial effect of not taking .* at all\. Here it is a temporary hold or reduction for the safety reason stated in the change, not a permanent withdrawal\. Reassess (at the first follow-up \(about 1 week; sooner if indicated\)|at the next review), and restore the drug when the stated reason has been rechecked and has resolved/, `${r.title} option ${i + 1}`);
        assert.match(buildChartSummary(chartInput(r), i), /temporary hold or reduction/, `${r.title} note ${i + 1}`);
    });
    assert.ok(seen >= 5, `${seen}`);
});

// ------------------------------------------------------------------------------------------------ W4
const evTables = textOf(renderToStaticMarkup(<EvidenceTables />)), faqText = textOf(renderToStaticMarkup(<FAQ />));
const matrixRows = fs.readFileSync(new URL('../docs/evidence-matrix.md', import.meta.url), 'utf8').split('\n').filter(l => /^\|\s*HF-/.test(l));
check('W4 (rewritten by T20): the evidence matrix no longer carries the rows for bonuses the tool does not have (HF-ADJ-013 is gone) and the eligibility rows HF-ADJ-010 and 011 are corrected to the current rule, with no "bonus" or point values', () => {
    assert.ok(!matrixRows.some(l => l.startsWith('| HF-ADJ-013')), 'HF-ADJ-013 is removed');
    for (const id of ['HF-ADJ-010', 'HF-ADJ-011']) {
        const row = matrixRows.find(l => l.startsWith(`| ${id} `));
        assert.ok(row, id);
        assert.doesNotMatch(row!, /Superseded|evidence bonus|\b\d+ points\b|20-point/, id);
    }
});
check('W4: the dose-anchor table gives digoxin in micrograms; "dosing burden" is the one term; no file names or "engine\'s own target dose" in clinician text', () => {
    assert.match(evTables, /Digoxin[^|]*125 mcg/); assert.doesNotMatch(evTables, /Digoxin[^|]{0,40}125 mg/);
    assert.equal(DOMAIN_LABELS.adherence, 'Dosing burden');
    for (const t of [evTables, faqText]) { assert.doesNotMatch(t.replace(/https?:\/\/\S+/g, ''), /\.json|\.tsx?\b|engine's own target dose|rows loop-/); }
    const l = textOf(renderToStaticMarkup(<ScoreDetailModal domain="adherence" score={50} regimen={withOptions[0].out.scoredRegimens[0]} onClose={() => {}} />));
    assert.doesNotMatch(l, /\bAdherence\b/); assert.match(l, /Dosing burden/);
});

// ------------------------------------------------------------------------------------------------ W5
check('W5: the draft note for every option of every scenario has no rule numbers, programming terms, underscores, em dashes, "on screen", unexplained option references, dangling lines or lower-cased abbreviations', () => {
    for (const r of runs) {
        const n = Math.max(1, r.out.scoredRegimens.length);
        for (let k = 0; k < n; k++) {
            const note = buildChartSummary(chartInput(r), k);
            const where = `${r.title} option ${k + 1}`;
            assert.doesNotMatch(note, /\bRule E\d|\bE\d\d\b|engine policy|Engine policy|—|_|on screen|\.json|undefined|NaN/, where);
            assert.doesNotMatch(note, /raas inhibitor|sglt2 inhibitor|\(mra\)|hfref|\barni\b(?! preferred)/, where);
            for (const line of note.split('\n')) if (/^  - /.test(line)) assert.ok(line.length > 8, `${where}: dangling "${line}"`);
            const gapSection = note.split('INDICATED GDMT CURRENTLY MISSING:\n')[1]?.split('\n\n')[0] ?? '';
            for (const line of gapSection.split('\n').filter(Boolean)) assert.match(line, /: (started in this option|not started)/, `${where}: ${line.slice(0, 80)}`);
            if (r.out.scoredRegimens.length > 0) {
                assert.match(note, /population averages from randomized trials, not a prediction for this patient/, where);
                for (const m of note.matchAll(/\boption (\d)\b/gi)) { const j = Number(m[1]); if (j !== k + 1 && !/of \d/.test(m[0])) assert.ok(note.includes(`Option ${j} means:`) || note.includes(`option ${j} of`) || j === 1 && /listed first/.test(note), `${where}: unexplained ${m[0]}`); }
            }
        }
    }
});
check('W5: the scale of a health-status or side-effect figure is stated once in the note', () => {
    for (const r of withOptions.slice(0, 60)) { const note = buildChartSummary(chartInput(r), 0); if (/burden [+−]\d/.test(note)) assert.equal((note.match(/Scales:/g) ?? []).length, 1, r.title); }
});
check('W5: screen text for every scenario has no rule numbers, "engine policy", em dashes, underscores or file names outside a collapsed technical reference', () => {
    for (const r of runs) {
        const html = screen(r).replace(/<details[^>]*>(?:(?!<\/details>)[\s\S])*Technical reference[\s\S]*?<\/details>/g, '');
        const t = textOf(html.replace(/<textarea[\s\S]*?<\/textarea>/g, ''));
        assert.doesNotMatch(t, /\bRule E\d|engine policy|Engine policy|—|\.json|the engine's own/, r.title);
        assert.doesNotMatch(t.replace(/[a-z]+_[a-z_]+="/g, ''), /\b[a-z]+_[a-z_]+\b/, r.title);
        assert.doesNotMatch(t, /raas inhibitor|sglt2 inhibitor|\(mra\)/, r.title);
    }
});

// ------------------------------------------------------------------------------------------------ W6
check('W6: the page declares an icon that exists, so no request returns 404', () => {
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const href = html.match(/<link[^>]*rel="icon"[^>]*href="([^"]+)"/)?.[1];
    if (href && !href.startsWith('data:')) assert.ok(fs.existsSync(new URL(`../public${href}`, import.meta.url)), `missing public${href}`);
    assert.doesNotMatch(html, /vite\.svg/);
});
check('W6: each option heading contains "Option N", repeated headings carry their option, and the "Evidence for" links use the full drug name', () => {
    const r = runs.find(x => x.title === 'John Doe (Wet & Warm)')!;
    const h = screen(r);
    const h3 = [...h.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].map(m => textOf(m[1]).trim()).filter(t => /^Option \d: (first|alternative) option/i.test(t) || /^(First option to review|Alternative option)$/i.test(t));
    assert.equal(h3.length, 3);
    h3.forEach((t, i) => assert.match(t, new RegExp(`^Option ${i + 1}`)));
    const h4 = [...h.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)].map(m => textOf(m[1]).trim());
    const dup = h4.filter((t, i) => h4.indexOf(t) !== i);
    assert.deepEqual(dup, [], `repeated headings: ${dup.join('; ')}`);
    // T21 rewrote this: the link label is the drug name with no count in brackets
    const labels = [...h.matchAll(/>\s*Evidence for ([^<]+?)\s*</g)].map(m => m[1]);
    assert.ok(labels.length >= 3, `${labels.length} evidence links`);
    for (const l of labels) assert.ok(MEDICATION_FORMULARY.some(d => d.name === l.trim()), `link label "${l}"`);
});
check('W6: the results carry a compact print summary and the long disclosures are hidden when printing; the draft note prints as text', () => {
    const r = runs.find(x => x.title === 'John Doe (Wet & Warm)')!;
    const h = screen(r);
    assert.match(h, /data-print-summary/);
    assert.match(h, /data-print-note/);
    assert.match(h, /data-print-detail/);
    const css = fs.readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    assert.match(css, /\[data-print-detail\] \{ display: none !important; \}/);
    assert.match(css, /body\[data-print="note"\] \[data-print-summary\]/);
    const summary = h.match(/<section data-print-summary[\s\S]*?<\/section>/)![0];
    for (const word of ['Safety alerts', 'Option 1', 'Option 2', 'Option 3', 'Why this is first', 'Monitoring for option 1']) assert.ok(textOf(summary).includes(word), word);
    assert.ok(textOf(summary).length < 9000, `print summary is ${textOf(summary).length} characters`);
});
check('W6: the entered patient survives a reload for the session (Sets and doses intact) and has a clear start-over control', () => {
    const p = clonePatient(SCENARIOS[0].patient);
    const back = decodeSession(encodeSession({ patient: p, step: 3, phase: 'steps', scenario: 'custom' }))!;
    assert.equal(back.step, 3); assert.equal(back.phase, 'steps');
    assert.deepEqual([...back.patient.comorbidities].sort(), [...p.comorbidities].sort());
    assert.deepEqual(back.patient.current_regimen.map(x => `${x.med.name} ${x.dose.strength} ${x.selected_frequency}`), p.current_regimen.map(x => `${x.med.name} ${x.dose.strength} ${x.selected_frequency}`));
    assert.equal(decodeSession('not json'), undefined);
    const saved = JSON.parse(encodeSession({ patient: p, step: 3, phase: 'steps', scenario: 'custom' }));
    const change = (edit: (draft: typeof saved) => void) => {
        const copy = structuredClone(saved); edit(copy); return decodeSession(JSON.stringify(copy));
    };
    for (const field of ['name', 'unit', 'frequency']) {
        assert.equal(change(x => { x.patient.current_regimen[0].__reg[field] = 'unrecognized'; }), undefined);
    }
    assert.equal(change(x => { x.step = 100; }), undefined);
    assert.equal(change(x => { x.patient.allergies = []; }), undefined);
    assert.ok(change(x => { delete x.patient.current_regimen[0].__reg.unit; }), 'older valid session must survive');
    assert.equal(change(x => { x.patient.age = 12; })?.patient.age, 12, 'keep a draft value the user can correct');
    assert.equal(change(x => { x.patient.volume_status = {}; }), undefined);
});
check('W6: an invalid entry is not echoed as an accepted value on the review step', () => {
    const q = clonePatient(SCENARIOS[0].patient); q.lvef = 150; q.potassium = 9; q.volume_status.dry_weight_kg = 999;
    const facts = enteredFacts(q);
    assert.equal(facts.find(f => f.label === 'Dry weight (kg)')?.invalid, true);
    for (const f of facts) if (/LVEF|Potassium/.test(f.label)) assert.doesNotMatch(f.value, /150|9\.0/, f.label);
});

// ------------------------------------------------------------------------------------------------ W7
check('W7: the review step says before running which drugs are unconfirmed and that their doses will not be changed, and offers one control to confirm all', () => {
    const q = clonePatient(SCENARIOS[0].patient);
    q.current_regimen = q.current_regimen.map(r => ({ ...r, exposure: undefined }));
    const t = textOf(renderToStaticMarkup(<ReviewStep patient={q} problems={[]} hints={{}} hasErrors={false} onGoToField={() => {}} onRun={() => {}} pricesReady onConfirmAllUse={() => {}} />));
    for (const r of q.current_regimen) assert.ok(t.includes(r.med.name), r.med.name);
    assert.match(t, /use and course history is not confirmed/i);
    assert.match(t, /will not be (increased or )?changed until (it is|they are) confirmed/i);
    assert.match(t, /Confirm all as taking as recorded/);
    const confirmed = clonePatient(q); confirmed.current_regimen = confirmed.current_regimen.map(r => ({ ...r, exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true, restart_or_repeat_reviewed: true } }));
    assert.doesNotMatch(textOf(renderToStaticMarkup(<ReviewStep patient={confirmed} problems={[]} hints={{}} hasErrors={false} onGoToField={() => {}} onRun={() => {}} pricesReady onConfirmAllUse={() => {}} />)), /Confirm all as taking as recorded/);
});

// ------------------------------------------------------------------------------------------------ leftovers
check('Leftover: a page with no options never refers to "Option 1" (screen or note)', () => {
    for (const r of noOptions) { assert.doesNotMatch(textOf(screen(r)), /Option 1/, r.title); assert.doesNotMatch(buildChartSummary(chartInput(r)), /[Oo]ption 1/, r.title); }
});
check('Leftover: a side-effect line never prints a rate that rounds to 0.0 beside a nonzero point value', () => {
    for (const r of withOptions.slice(0, 80)) for (let i = 0; i < r.out.scoredRegimens.length; i++) {
        const o = r.out.scoredRegimens[i];
        const t = textOf(renderToStaticMarkup(<ScoreDetailModal domain="side_effects" score={o.domain_scores.side_effects} regimen={o} onClose={() => {}} />)) + textOf(card(r, i));
        assert.doesNotMatch(t, /\b0\.0% (measured|charged)|, 0\.0% (charged|adjusted)/, r.title);
    }
});
check('Leftover: the digoxin adjunct says "rate control" only for a patient in atrial fibrillation with a fast rate', () => {
    const base = SCENARIOS.find(s => s.title.startsWith('Digoxin Renal Dosing'))!.patient;
    const slow = clonePatient(base); slow.pulse = 68; slow.rhythm = 'AFib';
    const fast = clonePatient(base); fast.pulse = 118; fast.rhythm = 'AFib';
    const sinus = clonePatient(base); sinus.rhythm = 'Sinus'; sinus.pulse = 70;
    const label = (p: Patient) => (generateAndScoreModifications(p, names, prices).eligibleAdjuncts ?? []).find(a => a.startsWith('Digoxin'));
    const l1 = label(slow), l2 = label(fast), l3 = label(sinus);
    if (l1) assert.doesNotMatch(l1, /rate control/i);
    if (l3) assert.doesNotMatch(l3, /rate control/i);
    assert.ok(l1 || l2 || l3, 'digoxin offered in at least one variant');
    if (l2) assert.match(l2, /rate control/i);
});
void buildChartHeader;

console.log(`Screen explanation checks: ${passed} passed; ${failed} failed. Server-rendered content only.`);
