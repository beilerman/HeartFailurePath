import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { PatientForm } from '../components/PatientForm';
import { SCENARIOS as ALL_SCENARIOS } from '../data/scenarios';
import { ScopeSection } from '../components/patient-form/ScopeSection';
import { FORM_SECTION_IDS } from '../components/patient-form/usePatientFormModel';
import { STEPS, stepForField } from '../components/guided/steps';
import { buildChartSummary, type ChartInput } from '../components/resultsModel';
import { RESEARCH_LINE } from '../components/appStatements';
import { SCOPE_CONDITIONS, SCOPE_NONE_LABEL, SCOPE_QUESTION } from '../services/engine/scopeGate';
import { EvidenceTables } from '../components/EvidenceTables';
import { HARM_TABLE } from '../services/engine/harmBurden';
import { harmRowNotes, IV_IRON_PER_COURSE_TEXT } from '../components/expectedEffectModel';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';

// Checks for round 3 screen rulings U6 (evidence band stated once) and U8 (research line text, scope question in both entry views, scope states on the results). Server-rendered content only.
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
const withScope = (scope?: string[]) => { const p = clonePatient(base); if (scope) p.scope_conditions = new Set(scope); return p; };
const render = (scope?: string[]) => {
    const p = withScope(scope), o = generateAndScoreModifications(p, names, prices);
    const html = renderToStaticMarkup(<ResultsDisplay results={o.scoredRegimens} error={null} hasRun excludedMedications={o.excludedMedications} clinicalAlerts={o.clinicalAlerts} monitoringPlan={o.monitoringPlan}
        gdmtGaps={o.gdmtGaps} eligibleAdjuncts={o.eligibleAdjuncts} missingDataNotices={o.missingDataNotices} followUpCalendar={o.followUpCalendar} decisionReadiness={o.decisionReadiness}
        whyFirst={o.why_first} scopeStatus={o.scope_status} evidenceBand={o.evidence_band} runSnapshot={{ ranAt: '2026-11-20T10:00:00Z', patient: p, caseLabel: 'test' }} />);
    return { o, html, text: textOf(html), p };
};

check('U8a: the always-visible line says research tool, not validated on patients, for expert review, estimates are trial averages not predictions', () => {
    assert.match(RESEARCH_LINE, /^Research tool, not validated on patients, for expert review\. Estimates are trial averages, not predictions/);
});
check('U8b: the scope question is a section of both entry views (the guided history step and the full form), with the question, the seven conditions and "None of these"', () => {
    assert.ok(FORM_SECTION_IDS.includes('patient-scope'));
    assert.ok(STEPS.some(s => s.sections.includes('patient-scope')));
    assert.equal(stepForField('patient-scope'), STEPS.findIndex(s => s.sections.includes('patient-scope')));
    const html = renderToStaticMarkup(<ScopeSection patientData={withScope()} setPatientData={() => undefined} />);
    const t = textOf(html);
    assert.ok(t.includes(SCOPE_QUESTION));
    for (const c of SCOPE_CONDITIONS) assert.ok(t.includes(c.label), c.label);
    assert.ok(t.includes(SCOPE_NONE_LABEL));
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, SCOPE_CONDITIONS.length + 1);
    assert.equal((html.match(/checked=""/g) ?? []).length, 0, 'nothing is ticked when unanswered');
    const ticked = renderToStaticMarkup(<ScopeSection patientData={withScope(['Dialysis'])} setPatientData={() => undefined} />);
    assert.equal((ticked.match(/checked=""/g) ?? []).length, 1);
    const none = renderToStaticMarkup(<ScopeSection patientData={withScope([])} setPatientData={() => undefined} />);
    assert.equal((none.match(/checked=""/g) ?? []).length, 1);
});
check('U8b: unanswered shows options and the visible line that scope was not confirmed; "None of these" shows options and no such line', () => {
    const a = render();
    assert.ok(a.o.scoredRegimens.length > 0);
    assert.ok(a.html.includes('data-testid="scope-not-confirmed"') && /Scope was not confirmed/.test(a.text));
    const n = render([]);
    assert.ok(n.o.scoredRegimens.length > 0);
    assert.ok(!n.html.includes('data-testid="scope-not-confirmed"'));
});
check('U8b: a ticked condition shows no option card and the alert names it; the draft note and the print summary carry the scope line when unanswered', () => {
    const r = render(['Cardiac amyloidosis']);
    assert.equal(r.o.scoredRegimens.length, 0);
    assert.ok(/Cardiac amyloidosis is recorded/.test(r.text) && /did not study it/.test(r.text), r.text.slice(0, 200));
    assert.ok(!/data-testid="why-1"/.test(r.html));
    const a = render();
    const input: ChartInput = { results: a.o.scoredRegimens, clinicalAlerts: a.o.clinicalAlerts, gdmtGaps: a.o.gdmtGaps ?? [], eligibleAdjuncts: a.o.eligibleAdjuncts ?? [], missingDataNotices: a.o.missingDataNotices ?? [], followUpCalendar: a.o.followUpCalendar ?? [], monitoringPlan: a.o.monitoringPlan, excludedMedications: a.o.excludedMedications, decisionReadiness: a.o.decisionReadiness, whyFirst: a.o.why_first, evidenceBandText: a.o.evidence_band?.text, scopeNote: a.o.scope_status?.text };
    const note = buildChartSummary(input, 0);
    assert.ok(/SCOPE:\n  - Scope was not confirmed/.test(note) && /TRIAL EVIDENCE USED:/.test(note));
    assert.ok(a.html.includes('data-print-summary') && /Scope was not confirmed/.test(textOf(a.html.slice(a.html.indexOf('data-print-summary')))));
});
check('U6: the ejection-fraction evidence band is stated once on the results screen, from the engine, and matches the entered patient', () => {
    for (const s of SCENARIOS.slice(0, 40)) {
        const p = clonePatient(s.patient); p.scope_conditions = new Set();
        const o = generateAndScoreModifications(p, names, prices);
        if (o.scoredRegimens.length === 0) continue;
        const html = renderToStaticMarkup(<ResultsDisplay results={o.scoredRegimens} error={null} hasRun excludedMedications={o.excludedMedications} clinicalAlerts={o.clinicalAlerts} whyFirst={o.why_first} evidenceBand={o.evidence_band} scopeStatus={o.scope_status} />);
        assert.equal((html.match(/data-testid="evidence-band"/g) ?? []).length, 1, s.title);
        assert.ok(textOf(html).includes(o.evidence_band!.text), s.title);
    }
});
check('U12: in the evidence tables every outcome, symptom, side-effect and dose row has a Notes disclosure when it has any caveat and says "No caveat recorded" otherwise', () => {
    const html = renderToStaticMarkup(<EvidenceTables />);
    const rows = html.split('<tr ').filter(x => x.includes('data-evidence-row="'));
    const kinds: Record<string, { rows: number; notes: number; none: number }> = {};
    for (const r of rows) {
        const k = /data-evidence-row="(\w+)"/.exec(r)![1];
        kinds[k] ??= { rows: 0, notes: 0, none: 0 };
        kinds[k].rows++;
        const hasNotes = r.includes('data-row-notes="1"'), none = r.includes('data-row-notes="none"') && /No caveat recorded/.test(r);
        assert.ok(hasNotes !== none, `${k} row has ${hasNotes ? 'both' : 'neither'}: ${r.slice(0, 160)}`);
        if (hasNotes) kinds[k].notes++; else kinds[k].none++;
    }
    assert.deepEqual(Object.keys(kinds).sort(), ['dose', 'harm', 'outcome', 'symptom']);
    assert.equal(kinds.dose.rows, 31);
    assert.ok(kinds.dose.notes > 0 && kinds.harm.notes > 0 && kinds.harm.none > 0);
    // the row's own caveats decide: a harm row with caveats always has the disclosure
    for (const r of HARM_TABLE.rows) { const row = html.split('<tr ').find(x => x.includes(`data-row-id="${r.id}"`) && x.includes('data-evidence-row="harm"'))!; assert.equal(row.includes('data-row-notes="1"'), harmRowNotes(r).length > 0, r.id); }
});
check('U13: the "Prioritize foundational therapy" toggle is gone from the full form (and so from the guided preferences step, which renders the same section), the draft note header and the results', () => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(<PatientForm patientData={withScope()} setPatientData={noop} simulationMedicationNames={names} setSimulationMedicationNames={noop} onRunSimulation={noop} pricesReady testScenarios={ALL_SCENARIOS} selectedScenario="custom" onScenarioChange={noop} />);
    assert.ok(!/ranking_mode|Ranking approach|Prioritize foundational therapy/.test(html));
    assert.ok(html.includes('care_priority'), 'what matters most is still there');
    for (const x of [render(), render([])]) {
        assert.ok(!/Ranking approach|Prioritize foundational therapy|Foundational coverage/.test(x.text) && !x.html.includes('ranking-mode-note'));
        assert.ok(!/Ranking approach/.test(buildChartSummary({ results: x.o.scoredRegimens, clinicalAlerts: x.o.clinicalAlerts, gdmtGaps: [], eligibleAdjuncts: [], missingDataNotices: [], followUpCalendar: [], monitoringPlan: [], excludedMedications: [], decisionReadiness: x.o.decisionReadiness, whyFirst: x.o.why_first }, 0)));
    }
});
check('U14: the evidence screen labels every dose row where no trial reported the dose reached, with the label sentence and set id; the other dose rows carry no such label', () => {
    const html = renderToStaticMarkup(<EvidenceTables />);
    const rows = html.split('<tr ').filter(x => x.includes('data-evidence-row="dose"')).map(x => textOf(`<tr ${x}`));
    assert.equal(rows.length, 31);
    const marked = rows.filter(r => /Full-credit dose is the label target dose; no trial reported the dose reached/.test(r));
    // Rewritten in round 4 (ruling W9): the intravenous iron row says what its label sentence says (a per-course dose), so eight rows carry the "names no target dose" sentence and one the per-course sentence.
    const none = rows.filter(r => /The label names no target dose, so full credit is given at any dose; the dose is not measured/.test(r) || r.includes(IV_IRON_PER_COURSE_TEXT));
    assert.equal(marked.length, 4, 'four label-target rows');
    assert.equal(none.length, 9, 'nine rows with no label target (eight, and the per-course iron row)');
    for (const r of [...marked, ...none]) assert.ok(/set id [0-9a-f]{8}-/.test(r) && /Label: "/.test(r), r.slice(0, 200));
    const others = rows.filter(r => !marked.includes(r) && !none.includes(r));
    assert.equal(others.length, 18);
    for (const r of others) assert.ok(!/no trial reported the dose reached/.test(r.replace(/No trial reported the dose reached; the full-credit dose shown is set by this tool\./, '')), r.slice(0, 160));
});
console.log(`R3 screen checks: ${passed} passed; ${failed} failed. Server-rendered content only.`);
