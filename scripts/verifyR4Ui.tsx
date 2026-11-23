import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { EvidenceTables } from '../components/EvidenceTables';
import { buildChartSummary, type ChartInput } from '../components/resultsModel';
import { IV_IRON_PER_COURSE_TEXT } from '../components/expectedEffectModel';
import { SCOPE_CONDITIONS } from '../services/engine/scopeGate';
import { DOSE_EVIDENCE } from '../services/engine/doseCredit';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { gen3r } from './r3Generator';
import type { Patient } from '../types';

// Checks for round 4 screen rulings W1 (hypoxia alert counted on the results header), W5 (no therapy prompts with a scope condition), W6e (the note's first "why" line), W9 (evidence screen wording,
// "Options (n)" heading once). Server-rendered content only.
let passed = 0;
export let failed = 0;
const check = (name: string, f: () => void) => {
    try { f(); passed++; console.log(`[PASS] ${name}`); }
    catch (error) { failed++; console.error(`[FAIL] ${name}: ${String(error).split('\n')[0]}`); }
};
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = await getDrugPrices([...names], 'commercial');
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const base = SCENARIOS.find(s => s.title.startsWith('De-novo HFrEF'))!.patient;
const make = (over: (p: Patient) => void): Patient => { const p = clonePatient(base); p.scope_conditions = new Set(); over(p); return p; };
const render = (p: Patient) => {
    const o = generateAndScoreModifications(p, names, prices);
    const html = renderToStaticMarkup(<ResultsDisplay results={o.scoredRegimens} error={null} hasRun excludedMedications={o.excludedMedications} clinicalAlerts={o.clinicalAlerts} monitoringPlan={o.monitoringPlan}
        gdmtGaps={o.gdmtGaps} eligibleAdjuncts={o.eligibleAdjuncts} missingDataNotices={o.missingDataNotices} followUpCalendar={o.followUpCalendar} decisionReadiness={o.decisionReadiness}
        whyFirst={o.why_first} scopeStatus={o.scope_status} evidenceBand={o.evidence_band} runSnapshot={{ ranAt: '2026-11-20T10:00:00Z', patient: p, caseLabel: 'test' }} />);
    return { o, html, text: textOf(html), p };
};
const chartInput = (o: ReturnType<typeof render>['o']): ChartInput => ({ results: o.scoredRegimens, clinicalAlerts: o.clinicalAlerts, gdmtGaps: o.gdmtGaps ?? [], eligibleAdjuncts: o.eligibleAdjuncts ?? [], missingDataNotices: o.missingDataNotices ?? [], followUpCalendar: o.followUpCalendar ?? [], monitoringPlan: o.monitoringPlan, excludedMedications: o.excludedMedications, decisionReadiness: o.decisionReadiness, whyFirst: o.why_first });

check('W1: SpO2 85 raises the hypoxia alert on the screen, the header counts it, and the monitoring row is accompanied by the alert (full path, a stop state, a scope condition)', () => {
    for (const [name, over] of [
        ['full path', (p: Patient) => { p.oxygen_saturation = 85; }],
        ['potassium stop', (p: Patient) => { p.oxygen_saturation = 85; p.potassium = 6.6; }],
        ['hypotension stop', (p: Patient) => { p.oxygen_saturation = 85; p.sbp = 84; p.dbp = 50; }],
        ['scope ticked', (p: Patient) => { p.oxygen_saturation = 85; p.scope_conditions = new Set(['Dialysis']); }],
    ] as const) {
        const r = render(make(over));
        assert.ok(/Hypoxia alert/i.test(r.text), `${name}: no hypoxia alert on the screen`);
        const m = /Analysis complete: \d+ options?, (\d+) safety checks?\./.exec(r.text);
        if (m) assert.ok(Number(m[1]) >= 1, `${name}: header says ${m[1]} safety checks`);
        if (/see the hypoxia alert/.test(r.text)) assert.ok(/HYPOXIA ALERT|Hypoxia alert/i.test(r.text), `${name}: the monitoring row names an alert that is not shown`);
    }
    const clean = render(make(p => { p.oxygen_saturation = 97; }));
    assert.ok(!/Hypoxia alert/i.test(clean.text) && !/see the hypoxia alert/.test(clean.text));
});
check('W5: with each of the seven conditions ticked the page shows the scope alert and its one line, and none of the therapy prompts', () => {
    for (const c of SCOPE_CONDITIONS) {
        const r = render(make(p => { p.scope_conditions = new Set([c.label]); p.lvef = 22; p.nyha_class = 'IV' as never; }));
        assert.equal(r.o.scoredRegimens.length, 0);
        assert.ok(/outside the tool's scope/i.test(r.text) && /not shown, because this condition is outside the tool's scope/.test(r.text), `${c.label}: scope line missing`);
        const rest = r.text.replace(/Prompts that propose therapy or assess whether a therapy is indicated[^]*?outside the tool's scope\./g, ' ');   // the scope alert's own sentence names what is not shown (the alert is printed in several places)
        for (const bad of [/Indicated GDMT/i, /What can be assessed/i, /Device therapy screening/i, /Cardiac rehabilitation/i, /Vericiguat eligibility/i, /transplant evaluation/i, /LVAD/, /Evaluate medication changes whose clinical prerequisites/i, /Eligible adjuncts to consider/i]) {
            assert.ok(!bad.test(rest), `${c.label}: shows ${bad}`);
        }
    }
});
check('W5: the same patient with the question answered "none of these" still shows the prompts the scope condition removes', () => {
    const r = render(make(p => { p.lvef = 22; p.nyha_class = 'III' as never; }));
    assert.ok(/Device therapy screening|Cardiac rehabilitation|Indicated GDMT/i.test(r.text), 'the ordinary prompts disappeared for a patient in scope');
});
check('W6e: the draft note\'s first "why" line is about the selected option, and the other options are glossed after it', () => {
    let seen = 0;
    for (let sd = 9300000; sd < 9300400 && seen < 8; sd++) {
        const p = gen3r(sd).p; p.scope_conditions = new Set();
        const r = render(p);
        if (r.o.scoredRegimens.length < 2 || !r.o.why_first?.options[0]?.lines.length) continue;
        for (const k of [1, 2]) {
            const note = buildChartSummary(chartInput(r.o), k - 1);
            const head = k === 1 ? 'WHY THIS OPTION IS LISTED FIRST:' : `WHY THIS OPTION IS LISTED AT POSITION ${k}:`;
            const at = note.indexOf(head);
            if (at < 0) continue;
            const firstBullet = note.slice(at + head.length).split('\n').map(x => x.trim()).find(x => x.startsWith('- '))!;
            assert.ok(!/^- Option \d means:/.test(firstBullet), `seed ${sd} option ${k}: the first line is a gloss: ${firstBullet.slice(0, 100)}`);
            assert.equal(firstBullet.slice(2), r.o.why_first!.options[k - 1].lines[0].text, `seed ${sd} option ${k}: first line is not the option's own first reason`);
            seen++;
        }
    }
    assert.ok(seen >= 6, `only ${seen} notes checked`);
});
check('W9: the Injectafer dose row says what its label sentence says; no lower-case fragment about "the rows of the evidence tables"; the figures match the label sentence in the data', () => {
    const html = renderToStaticMarkup(<EvidenceTables />);
    const rows = html.split('<tr ').filter(x => x.includes('data-evidence-row="dose"')).map(x => textOf(`<tr ${x}`));
    const iron = rows.find(r => /Ferric Carboxymaltose/.test(r))!;
    assert.ok(iron.includes(IV_IRON_PER_COURSE_TEXT), iron.slice(0, 300));
    assert.ok(!/The label names no target dose/.test(iron), 'the contradicting sentence is still there');
    const row = ((DOSE_EVIDENCE as unknown as { anchors: Array<{ drug: string; label_basis?: { sentence: string } }> }).anchors).find(r => r.drug === 'Ferric Carboxymaltose')!;
    assert.ok(/750 mg/.test(row.label_basis!.sentence) && /1,500 mg/.test(row.label_basis!.sentence), 'the label sentence no longer carries the figures the screen quotes');
    assert.ok(!/ the rows of the evidence tables for this drug class/.test(textOf(html)), 'lower-case fragment present');
    assert.ok(/See the outcome rows of the evidence tables for this drug class\./.test(textOf(html)));
});
check('W9: the "Options (n)" heading text appears once on a results page', () => {
    const r = render(make(() => { /* the base patient */ }));
    assert.ok(r.o.scoredRegimens.length > 0);
    const n = r.o.scoredRegimens.length;
    assert.equal((r.text.match(new RegExp(`Options \\(${n}\\)`, 'g')) ?? []).length, 1);
    assert.ok(!/aria-labelledby="results-options-title"/.test(r.html), 'the section is still named by the heading a second time');
});
console.log(`R4 screen checks: ${passed} passed; ${failed} failed. Server-rendered content only.`);
