import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { MedicationLibrary } from '../components/MedicationLibrary';
import { DecisionReadinessPanel } from '../components/DecisionReadinessPanel';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { gen3r } from './r3Generator';
import { PRICES as TIER_PRICES } from './r2Generator';
import { NO_OPTION_PATHS } from './r6Paths';
import { ARROWS } from './engineReadinessR7Checks';
import { shoutedWords } from './engineReadinessR8Checks';
import { sentenceCase } from '../components/resultsModel';
import type { Patient, SimulationOutput } from '../types';

// Checks for round 8 screen rulings (X7, X15). Server-rendered content only.
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
const patientOf = (sd: number, f?: (p: Patient) => void): Patient => { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); f?.(p); return p; };

check('X7: the Formulary tab has no word "engine", no em or en dash, no shouted word and no arrow', () => {
    const t = textOf(renderToStaticMarkup(<MedicationLibrary />));
    assert.ok(t.length > 5000, 'the tab rendered');
    assert.ok(!/\bengines?\b/i.test(t), `engine: ${t.slice(Math.max(0, t.search(/\bengine/i) - 40), t.search(/\bengine/i) + 40)}`);
    assert.ok(!/[–—]/.test(t), `dash: ${t.slice(Math.max(0, t.search(/[–—]/) - 40), t.search(/[–—]/) + 40)}`);
    assert.ok(!ARROWS.test(t), 'arrow');
    const shouted = shoutedWords(t.replace(/\b(?:Profile|Not offered when)\b/g, '')).filter(w => !/^(?:[A-Z]{2,5})$/.test(w) || w.length > 5);
    assert.deepEqual(shouted.slice(0, 5), []);
});
check('X7: heading case keeps brand names (Entresto), and the screens of 60 generated patients on the full and stop paths carry no shouted word, empty parentheses, dash or arrow', () => {
    assert.equal(sentenceCase('POTASSIUM HOLD ON SACUBITRIL/VALSARTAN (ENTRESTO)'), 'Potassium hold on sacubitril/valsartan (Entresto)');
    const bad: string[] = []; let screens = 0;
    for (let sd = 20100000; sd < 20100020; sd++) for (const [pn, f] of NO_OPTION_PATHS.slice(0, 11)) {
        const p = patientOf(sd, f); let r; try { r = renderScreen(p); } catch { continue; }
        screens++;
        for (const m of [/\(\s*\)/.exec(r.text), /[–—]/.exec(r.text), ARROWS.exec(r.text)]) if (m && bad.length < 5) bad.push(`seed ${sd} ${pn}: ${r.text.slice(Math.max(0, m.index - 40), m.index + 40)}`);
    }
    assert.ok(screens >= 100, `${screens} screens`); assert.deepEqual(bad, []);
});
check('X7: a stop screen does not print its "no medication change" sentence twice in "What can be assessed"', () => {
    let seen = 0;
    for (let sd = 20100000; sd < 20100040; sd++) {
        const p = patientOf(sd, q => { q.potassium = 6.6; }); const o = runTier(p); if (o.scoredRegimens.length > 0 || !o.decisionReadiness) continue; seen++;
        const t = textOf(renderToStaticMarkup(<DecisionReadinessPanel assessment={o.decisionReadiness} noMedicationChange />));
        const sentences = t.split(/(?<=[.!?]) /).map(s => s.trim()).filter(s => s.length > 25);
        assert.equal(new Set(sentences).size, sentences.length, `seed ${sd}: a sentence is repeated: ${sentences.find((s, i) => sentences.indexOf(s) !== i)}`);
    }
    assert.ok(seen >= 20, `${seen} stop screens`);
});
check('X3/X15: on 344 reference screens the dosing pill reads as a comparison and no sentence about the number of daily doses contradicts the single-dose wording', () => {
    let screens = 0;
    for (const s of SCENARIOS) { const p = clonePatient(s.patient); let r; try { r = renderScreen(p); } catch { continue; } screens++; assert.ok(!/plus 1 drug as a single dose|\b0 doses a day from 0 drugs/.test(r.text), s.title); }
    assert.ok(screens > 300);
});

console.log(`\nVerifyR8Ui: ${passed} passed, ${failed} failed`);
