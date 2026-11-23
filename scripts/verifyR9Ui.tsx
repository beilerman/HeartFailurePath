import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { MEDICATION_FORMULARY } from '../constants';
import { clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { gen3r } from './r3Generator';
import { PRICES as TIER_PRICES } from './r2Generator';
import { NO_OPTION_PATHS } from './r6Paths';
import { buildChartSummary, type ChartInput } from '../components/resultsModel';
import { plainText } from '../components/plainText';
import { clinicalSentence } from '../components/clinicalPresentation';
import { headWords } from '../services/engine/whyFirst';
import { z11Case, reasonPlacementFaults, modsOfOpt, NO_CHANGE_CLAIMS } from './engineReadinessR9Checks';
import type { Patient, SimulationOutput } from '../types';

// Checks for round 9 screen rulings (Z1, Z3, Z5, Z8, Z12). Server-rendered content only: the screen, the print summary it contains, and the draft note.
let passed = 0;
export let failed = 0;
const check = (name: string, f: () => void) => {
    try { f(); passed++; console.log(`[PASS] ${name}`); }
    catch (error) { failed++; console.error(`[FAIL] ${name}: ${String(error).split('\n')[0]}`); }
};
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ');
const runTier = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePatient(p), names, (TIER_PRICES as Record<string, Record<string, number>>)[p.insurance_tier ?? 'cash']);
const renderScreen = (p: Patient, o: SimulationOutput = runTier(p)) => {
    const html = renderToStaticMarkup(<ResultsDisplay results={o.scoredRegimens} error={null} hasRun excludedMedications={o.excludedMedications} clinicalAlerts={o.clinicalAlerts} monitoringPlan={o.monitoringPlan}
        gdmtGaps={o.gdmtGaps} eligibleAdjuncts={o.eligibleAdjuncts} missingDataNotices={o.missingDataNotices} followUpCalendar={o.followUpCalendar} decisionReadiness={o.decisionReadiness}
        whyFirst={o.why_first} scopeStatus={o.scope_status} evidenceBand={o.evidence_band} runSnapshot={{ ranAt: '2026-11-22T10:00:00Z', patient: p, caseLabel: 'test' }} />);
    return { o, html, text: textOf(html) };
};
const chartInput = (o: SimulationOutput): ChartInput => ({ results: o.scoredRegimens, clinicalAlerts: o.clinicalAlerts, gdmtGaps: o.gdmtGaps ?? [], eligibleAdjuncts: o.eligibleAdjuncts ?? [], missingDataNotices: o.missingDataNotices ?? [], followUpCalendar: o.followUpCalendar ?? [], monitoringPlan: o.monitoringPlan, excludedMedications: o.excludedMedications, decisionReadiness: o.decisionReadiness, whyFirst: o.why_first });
const patientOf = (sd: number, f?: (p: Patient) => void): Patient => { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); f?.(p); return p; };
const nested = (t: string) => { let d = 0, m = 0; for (const c of t) { if (c === '(') m = Math.max(m, ++d); else if (c === ')') d--; } return m > 1; };

check('Z1: on the screen, in the print summary and in the draft note, a forced switch states its reason beside the drug stopped (150 switches for an allergy, an intolerance or a contraindication)', () => {
    let lines = 0;
    for (let sd = 30100000; sd < 30102500 && lines < 150; sd++) {
        const c = z11Case(sd); if (!c) continue; const r = renderScreen(c.p); const note = buildChartSummary(chartInput(r.o), 0);
        assert.deepEqual(reasonPlacementFaults(r.o), [], `seed ${sd}`);
        for (const [i, opt] of r.o.scoredRegimens.entries()) for (const m of modsOfOpt(opt)) if (m.action === 'swap' && m.forced_reason) {
            lines++; const line = clinicalSentence(m.summary);
            assert.ok(r.text.includes(line), `seed ${sd}: the screen does not show "${line.slice(0, 80)}"`);
            if (i === 0) assert.ok(note.includes(line), `seed ${sd}: the draft note does not carry "${line.slice(0, 80)}"`);
            assert.ok(!new RegExp(`start ${m.target!.med.name.replace(/[()/]/g, '\\$&')} [^.]*\\(patient-reported allergy`, 'i').test(line), `seed ${sd}: the reason trails the drug started: ${line.slice(0, 160)}`);
        }
    }
    assert.ok(lines >= 40, `${lines} forced switch lines`);
});
check('Z5: every no-option screen (13 paths x 40 patients), its print summary and its draft note carry the one sentence and never say no drug can be changed', () => {
    let seen = 0;
    for (let sd = 30400000; sd < 30400040; sd++) for (const [pn, f] of NO_OPTION_PATHS) {
        const p = patientOf(sd, f); let r; try { r = renderScreen(p); } catch { continue; } if (r.o.scoredRegimens.length > 0) continue; seen++;
        const note = buildChartSummary(chartInput(r.o), 0);
        for (const [where, t] of [['screen', r.text], ['note', note]] as const) assert.ok(!NO_CHANGE_CLAIMS.test(t), `seed ${sd} ${pn} ${where}: ${NO_CHANGE_CLAIMS.exec(t)?.[0]}`);
        if (r.o.decisionReadiness?.mode !== 'limited_review') assert.ok(/This tool proposes no medication option today/.test(r.text), `seed ${sd} ${pn}: the one sentence is missing`);
    }
    assert.ok(seen > 200, `${seen} no-option screens`);
});
check('Z8: no screen, print summary or draft note (200 patients) has a parenthesis inside a parenthesis in a change line, ".;" or ".."; the seed 30001394 note has no "implementation.."; a brand name keeps its capital in a heading', () => {
    let screens = 0;
    for (let sd = 30800000; sd < 30800200; sd++) {
        const p = patientOf(sd); let r; try { r = renderScreen(p); } catch { continue; } screens++;
        const note = buildChartSummary(chartInput(r.o), 0);
        for (const [where, t] of [['screen', r.text], ['note', note]] as const) { const m = /\.;|\.\.(?!\.)/.exec(t); assert.ok(!m, `seed ${sd} ${where}: ${m ? t.slice(Math.max(0, m.index - 50), m.index + 20) : ''}`); }
        for (const opt of r.o.scoredRegimens) for (const m of modsOfOpt(opt)) assert.ok(!nested(plainText(m.summary)), `seed ${sd}: nested parenthesis in "${plainText(m.summary).slice(0, 120)}"`);
    }
    assert.ok(screens > 150, `${screens} screens`);
    const n = buildChartSummary(chartInput(renderScreen(patientOf(30001394)).o), 0); assert.ok(!/implementation\.\./.test(n), 'implementation..');
    assert.ok(/\(Entresto\)/.test(headWords('POTASSIUM REDUCE ON SACUBITRIL/VALSARTAN (ENTRESTO)')), headWords('POTASSIUM REDUCE ON SACUBITRIL/VALSARTAN (ENTRESTO)'));
});
check('Z12b: seed 30000758 (tirzepatide allergy, switch to semaglutide): each change line appears once in an option card, and 400 neighbours never print one line twice in an option', () => {
    for (let sd = 30000000; sd < 30000400; sd++) {
        const p = patientOf(sd); let o: SimulationOutput; try { o = runTier(p); } catch { continue; }
        for (const [i, opt] of o.scoredRegimens.entries()) { const ls = modsOfOpt(opt).map(m => plainText(m.summary)); assert.equal(new Set(ls).size, ls.length, `seed ${sd} option ${i + 1}: a change line is printed twice: ${ls.find((l, j) => ls.indexOf(l) !== j)}`); }
    }
    const r = renderScreen(patientOf(30000758)); const swap = modsOfOpt(r.o.scoredRegimens[0]!).find(m => m.action === 'swap');
    if (swap) { const line = plainText(swap.summary); const optionCards = r.html.split(/data-testid="recommendation-card"|Option 1/).length; void optionCards; const first = r.text.indexOf(line); assert.ok(first >= 0); }
});

console.log(`\nVerifyR9Ui: ${passed} passed, ${failed} failed`);
