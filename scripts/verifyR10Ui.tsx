import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { MEDICATION_FORMULARY } from '../constants';
import { clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { gen3r } from './r3Generator';
import { PRICES as TIER_PRICES } from './r2Generator';
import { buildChartSummary, type ChartInput } from '../components/resultsModel';
import { plainText } from '../components/plainText';
import { mk } from './engineReadinessR2Checks';
import { congestedLoopState, NO_LOOP_WARNING } from './engineReadinessR10Checks';
import type { Patient, SimulationOutput } from '../types';

// Checks for round 10 screen rulings (A3, A6, A7, A11). Server-rendered content only: the screen, the print summary it contains, the draft note, and the Evidence tab source.
let passed = 0;
export let failed = 0;
const check = (name: string, f: () => void) => {
    try { f(); passed++; console.log(`[PASS] ${name}`); }
    catch (error) { failed++; console.error(`[FAIL] ${name}: ${String(error).split('\n')[0]}`); }
};
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ');
export const runTier = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePatient(p), names, (TIER_PRICES as Record<string, Record<string, number>>)[p.insurance_tier ?? 'cash']);
export const renderScreen = (p: Patient, o: SimulationOutput = runTier(p)) => {
    const html = renderToStaticMarkup(<ResultsDisplay results={o.scoredRegimens} error={null} hasRun excludedMedications={o.excludedMedications} clinicalAlerts={o.clinicalAlerts} monitoringPlan={o.monitoringPlan}
        gdmtGaps={o.gdmtGaps} eligibleAdjuncts={o.eligibleAdjuncts} missingDataNotices={o.missingDataNotices} followUpCalendar={o.followUpCalendar} decisionReadiness={o.decisionReadiness}
        whyFirst={o.why_first} scopeStatus={o.scope_status} evidenceBand={o.evidence_band} runSnapshot={{ ranAt: '2026-11-22T10:00:00Z', patient: p, caseLabel: 'test' }} />);
    return { o, html, text: textOf(html) };
};
export const chartInput = (o: SimulationOutput): ChartInput => ({ results: o.scoredRegimens, clinicalAlerts: o.clinicalAlerts, gdmtGaps: o.gdmtGaps ?? [], eligibleAdjuncts: o.eligibleAdjuncts ?? [], missingDataNotices: o.missingDataNotices ?? [], followUpCalendar: o.followUpCalendar ?? [], monitoringPlan: o.monitoringPlan, excludedMedications: o.excludedMedications, decisionReadiness: o.decisionReadiness, whyFirst: o.why_first });
export const patientOf = (sd: number, f?: (p: Patient) => void): Patient => { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); f?.(p); return p; };
void plainText; void patientOf; void chartInput; void buildChartSummary;

const FAQ = readFileSync(new URL('../components/FAQ.tsx', import.meta.url), 'utf8');
check('A6: the Evidence tab says the other options at potassium 6.0 to 6.4 contain only reductions, removals or no change at all', () => {
    assert.ok(FAQ.includes('the other options contain only reductions, removals or no change at all'));
    assert.ok(!FAQ.includes('contain only reductions and removals that lower potassium'));
});

check('A3: the warning for an option that leaves a congested patient without a loop diuretic is on the screen and in the draft note, with its cause (reviewer seed 30110113 and generated states)', () => {
    let shown = 0;
    const cases: Patient[] = [patientOf(30110113, p => { p.allergies = new Set(['bumex']); }), ...Array.from({ length: 40 }, (_, i) => congestedLoopState(40200000 + i))];
    for (const p of cases) {
        const r = renderScreen(p); const want = !!r.o.scoredRegimens[0]?.warnings.some(w => w.includes(NO_LOOP_WARNING)); if (!want) continue; shown++;
        assert.ok(r.text.includes(NO_LOOP_WARNING), 'the warning is missing on the screen');
        assert.ok(plainText(buildChartSummary(chartInput(r.o), 0)).includes(NO_LOOP_WARNING), 'the warning is missing in the draft note');
    }
    assert.ok(shown >= 10, `only ${shown} cases carried the warning`);
});
check('A11b: with the limit of new drug classes per visit set to 0 and no option, the screen and the draft note name the limit; the device alert keeps its acronyms', () => {
    const p = mk({ lvef: 28, nyha_class: 'III', sbp: 118, dbp: 72, pulse: 74, potassium: 4.4, creatinine: 1.1, egfr: 65 }, []); p.max_new_classes_per_visit = 0;
    const r = renderScreen(p); assert.equal(r.o.scoredRegimens.length, 0);
    assert.ok(r.text.includes('limit of new drug classes per visit is set to 0'), 'the screen does not name the limit');
    assert.ok(plainText(buildChartSummary(chartInput(r.o), 0)).includes('limit of new drug classes per visit is set to 0'), 'the draft note does not name the limit');
    const dev = r.o.clinicalAlerts.find(a => a.startsWith('DEVICE THERAPY SCREENING'))!; assert.ok(!/raas inhibitor|hfref/.test(dev) && /RAAS inhibitor \(ARNI preferred for HFrEF\)/.test(dev), dev.slice(0, 400));
});
check('A11e: the word "engine" appears nowhere on the screen, the print summary or the draft note (500 generated patients, the potassium 5.5-5.9 and iron-deficiency states, and blank-laboratory states)', () => {
    const hits: string[] = [];
    for (let sd = 40200000; sd < 40200500; sd++) {
        const p = patientOf(sd, q => { if (sd % 5 === 1) q.potassium = 5.7; if (sd % 5 === 2) { q.ferritin = 60; q.tsat = 15; } if (sd % 5 === 3) { q.lvef = 55; q.potassium = 0; q.creatinine = 0; q.egfr = 0; } if (sd % 5 === 4) q.potassium = 3.2; });
        const r = renderScreen(p); const note = plainText(buildChartSummary(chartInput(r.o), 0));
        for (const [w, t] of [['screen', r.text], ['note', note]] as const) { const m = /.{0,60}\bengine\b.{0,40}/i.exec(t); if (m && hits.length < 4) hits.push(`seed ${sd} ${w}: ${m[0]}`); }
    }
    assert.deepEqual(hits, []);
});

console.log(`\nVerifyR10Ui: ${passed} passed, ${failed} failed`);
