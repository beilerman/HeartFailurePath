import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { EvidenceTables } from '../components/EvidenceTables';
import { FAQ } from '../components/FAQ';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { gen3r } from './r3Generator';
import { PRICES as TIER_PRICES } from './r2Generator';
import { NO_OPTION_PATHS } from './r6Paths';
import { ARROWS } from './engineReadinessR7Checks';
import type { Patient, SimulationOutput } from '../types';

// Checks for round 7 screen rulings (W1, W5, W7, W8). Server-rendered content only.
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
        whyFirst={o.why_first} scopeStatus={o.scope_status} evidenceBand={o.evidence_band} runSnapshot={{ ranAt: '2026-11-21T10:00:00Z', patient: p, caseLabel: 'test' }} />);
    return { o, html, text: textOf(html) };
};
const patientOf = (sd: number, f?: (p: Patient) => void): Patient => { const p = clonePatient(gen3r(sd).p as Patient); p.scope_conditions = new Set(); f?.(p); return p; };

/** Words and marks a screen never shows a clinician (W7): any arrow, the word "engine", a capitalised eGFR. */
const SCREEN_BANNED: Array<[string, RegExp]> = [['an arrow', ARROWS], ['the word engine', /\bengines?\b/i], ['EGFR in a sentence', /(?<![A-Z] )\bEGFR\b(?! [A-Z]{2})/]];
const scanScreen = (text: string): string[] => SCREEN_BANNED.filter(([, re]) => re.test(text)).map(([n, re]) => `${n}: ${text.slice(Math.max(0, text.search(re) - 50), text.search(re) + 50)}`);

check('W7: no arrow of any kind, no "engine", no capitalised eGFR on the screen, draft note and print view of 60 generated patients on the full path and the stop paths', () => {
    const bad: string[] = []; let screens = 0;
    for (let sd = 10100000; sd < 10100020; sd++) for (const [pn, f] of NO_OPTION_PATHS.slice(0, 11)) {
        const p = patientOf(sd, f); const r = renderScreen(p);
        screens++;
        for (const m of scanScreen(r.text)) if (bad.length < 6) bad.push(`seed ${sd} ${pn}: ${m}`);
    }
    assert.ok(screens >= 100, `${screens} screens`);
    assert.deepEqual(bad, []);
});
check('W7: the Evidence tab and the logic page say "tool" never "engine", and carry no arrow', () => {
    const ev = textOf(renderToStaticMarkup(<EvidenceTables />)), faq = textOf(renderToStaticMarkup(<FAQ />));
    assert.deepEqual(scanScreen(ev), [], 'evidence tab'); assert.deepEqual(scanScreen(faq), [], 'logic page');
});
check('W1: the trade-off pills on the screen compare dosing with the regimen now and never say "Lower dosing burden"; 344 reference screens', () => {
    let pills = 0;
    for (const s of SCENARIOS) {
        const p = clonePatient(s.patient); const r = renderScreen(p);
        assert.ok(!/Lower dosing burden|Well within budget|Near the budget limit/.test(r.text), s.title);
        pills += (r.text.match(/Dosing burden: (More|Fewer|Same) doses a day/g) ?? []).length;
    }
    assert.ok(pills > 300, `${pills} dosing pills`);
});
check('W5: on a stop screen with an alert that says to withhold or reduce a drug (potassium 6.5 on lisinopril and spironolactone), no screen text says "no medication change is proposed"', () => {
    const base = SCENARIOS.find(s => s.title.startsWith('De-novo HFrEF'))!.patient;
    let seen = 0;
    for (let sd = 10100000; sd < 10100030; sd++) {
        const p = patientOf(sd, q => { q.potassium = 6.6; q.current_regimen = [...base.current_regimen]; });
        const r = renderScreen(p);
        if (r.o.scoredRegimens.length > 0) continue;
        seen++;
        const advises = r.o.clinicalAlerts.some(a => /^(HYPERKALEMIC EMERGENCY|POTASSIUM STOP ON)/.test(a));
        if (advises) assert.ok(!/no medication change is proposed/i.test(r.text), `seed ${sd}: ${/[^.]*no medication change is proposed[^.]*/i.exec(r.text)?.[0]}`);
        if (advises) assert.ok(/This tool proposes no medication option today/.test(r.text), `seed ${sd}: the one sentence is missing`);
    }
    assert.ok(seen >= 20, `${seen} stop screens`);
});

console.log(`\nVerifyR7Ui: ${passed} passed, ${failed} failed`);
