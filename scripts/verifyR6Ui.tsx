import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { gen3r } from './r3Generator';
import { PRICES as TIER_PRICES } from './r2Generator';
import { NO_OPTION_PATHS } from './r6Paths';
import type { Patient, SimulationOutput } from '../types';

// Checks for round 6 screen rulings (V5 no-option screens, V6, V11, V12, V19). Server-rendered content only.
let passed = 0;
export let failed = 0;
const check = (name: string, f: () => void) => {
    try { f(); passed++; console.log(`[PASS] ${name}`); }
    catch (error) { failed++; console.error(`[FAIL] ${name}: ${String(error).split('\n')[0]}`); }
};
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
export const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const base = SCENARIOS.find(s => s.title.startsWith('De-novo HFrEF'))!.patient;
export const make = (over: (p: Patient) => void): Patient => { const p = clonePatient(base); p.scope_conditions = new Set(); over(p); return p; };
export const runTier = (p: Patient): SimulationOutput => generateAndScoreModifications(clonePatient(p), names, (TIER_PRICES as Record<string, Record<string, number>>)[p.insurance_tier ?? 'cash']);
/** The whole screen, the draft note and the print view (all are in the server-rendered markup, the note and print view hidden on screen). */
export const renderScreen = (p: Patient, o: SimulationOutput = runTier(p)) => {
    const html = renderToStaticMarkup(<ResultsDisplay results={o.scoredRegimens} error={null} hasRun excludedMedications={o.excludedMedications} clinicalAlerts={o.clinicalAlerts} monitoringPlan={o.monitoringPlan}
        gdmtGaps={o.gdmtGaps} eligibleAdjuncts={o.eligibleAdjuncts} missingDataNotices={o.missingDataNotices} followUpCalendar={o.followUpCalendar} decisionReadiness={o.decisionReadiness}
        whyFirst={o.why_first} scopeStatus={o.scope_status} evidenceBand={o.evidence_band} runSnapshot={{ ranAt: '2026-11-20T10:00:00Z', patient: p, caseLabel: 'test' }} />);
    return { o, html, text: textOf(html), p };
};

/** The words a screen with no ranked option never uses (option, plan, recommend, rank in any form). Phrases allowed on purpose, with the reason, are listed in ALLOWED. */
export const OPTION_WORDS = /\b(options?|plans?|planned|planning|rank\w*|recommend\w*)\b/i;
// R9 Z5 (ruling wording): the one sentence every no-option screen carries says there is no option, so it contains the word. Allowed as a whole sentence and nothing else.
export const ALLOWED: ReadonlyArray<readonly [RegExp, string]> = [[/proposes no medication option today|no medication option is proposed|Having no option/, 'Z5 sentence'], [/No medication option is (?:shown for this patient today|proposed at this pressure|proposed until the rhythm is managed)/, 'R10 A7 sentences']];
export function optionWordSentences(text: string): string[] {
    const out: string[] = [];
    for (const seg of text.split(/ \| |(?<=[.!?:]) (?=[A-Z])/)) {
        const m = OPTION_WORDS.exec(seg);
        if (!m) continue;
        if (ALLOWED.some(([re]) => re.test(seg))) continue;
        out.push(seg.trim().slice(0, 200));
    }
    return out;
}

check('V5: on every no-option output (all stop states, input error, implausible values, limited review, scope), nothing the screen, the draft note or the print view says uses the words option, plan, recommend or rank; 12 patients on 13 paths', () => {
    const bad = new Map<string, string>(); let noOption = 0;
    for (let sd = 9900000; sd < 9900012; sd++) for (const [pn, f] of NO_OPTION_PATHS) {
        const p = clonePatient(gen3r(sd).p as Patient); f(p);
        const o = runTier(p); if (o.scoredRegimens.length > 0) continue;
        noOption++;
        const r = renderScreen(p, o);
        for (const s of optionWordSentences(r.text)) if (!bad.has(s)) bad.set(s, `seed ${sd} ${pn}`);
    }
    assert.ok(noOption >= 60, `${noOption} no-option screens`);
    if (process.env.R6_DUMP) [...bad].forEach(([k, v]) => console.log('DUMP', v, '::', k));
    assert.deepEqual([...bad].slice(0, 6), [], `${bad.size} distinct sentences`);
});

check('V5: no-option screens: the monitoring heading is not "recommended monitoring plan", no eligible-adjunct block, no rate-control drugs in the atrial fibrillation alert, no "tool offers" sentence on the congestion alert, no row pointing at an alert that is absent; a screen with options keeps its heading', () => {
    const afCongested = (f: (p: Patient) => void) => { const p = clonePatient(gen3r(9900003).p as Patient); p.scope_conditions = new Set(); p.rhythm = 'AFib'; p.lvef = 28; p.nyha_class = 'II'; p.pulse = 120; p.volume_status.dry_weight_kg = 80; p.volume_status.current_weight_kg = 80; p.volume_status.exam_findings = new Set(['JVP Elevated', 'Edema (2+)']); p.current_regimen = []; f(p); return p; };
    let screens = 0;
    for (const [pn, f] of NO_OPTION_PATHS) {
        const p = afCongested(f); const o = runTier(p); if (o.scoredRegimens.length > 0) continue;
        screens++;
        const r = renderScreen(p, o);
        assert.ok(!/recommended monitoring plan/i.test(r.text), `${pn}: monitoring heading`);
        assert.ok(!/eligible adjuncts to consider/i.test(r.text), `${pn}: eligible adjuncts shown`);
        const af = o.clinicalAlerts.find(a => a.startsWith('ATRIAL FIBRILLATION'));
        if (af) assert.ok(/anticoagulation/i.test(af) && !/Rate control|beta-blocker is first line|digoxin should be considered/.test(af), `${pn}: ${af.slice(0, 300)}`);
        const cg = o.clinicalAlerts.find(a => a.startsWith('CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN'));
        if (cg) assert.ok(/dry weight/.test(cg) && !/does not offer|tool offers/.test(cg), `${pn}: ${cg}`);
        for (const m of o.monitoringPlan) for (const [phrase, head] of [[/see the low blood pressure alert/, /^HEMODYNAMIC INSTABILITY/], [/see the hypoxia alert/, /^HYPOXIA ALERT/], [/see the heart block alert/, /AV BLOCK/], [/see the potassium emergency alert/, /^HYPERKALEMIC EMERGENCY/]] as Array<[RegExp, RegExp]>) {
            if (phrase.test(m.details)) assert.ok(o.clinicalAlerts.some(a => head.test(a)), `${pn}: row "${m.test}" points at an alert that is not shown`);
        }
    }
    assert.ok(screens >= 8, `${screens} no-option screens`);
    const sys70 = renderScreen(make(p => { p.sbp = 70; p.dbp = 80; }));
    assert.equal(sys70.o.scoredRegimens.length, 0);
    assert.ok(!/see the low blood pressure alert/.test(sys70.text), 'systolic 70 over diastolic 80 still points at the low blood pressure alert');
    const withOptions = renderScreen(make(() => {}));
    assert.ok(withOptions.o.scoredRegimens.length > 0 && /Recommended monitoring plan/.test(withOptions.text), 'a screen with options lost its monitoring heading');
});

const PERF = (sd: number) => clonePatient(gen3r(sd).p as Patient);
check('V12: change lines as displayed (cards, draft note, print): no typed arrow, no shouted instruction, "Switch" not "Swap"; the carvedilol body-weight sentence has no clumsy tail', () => {
    let swaps = 0, acei = 0;
    const patients: Patient[] = [];
    for (let sd = 9920000; sd < 9920120; sd++) { const p = PERF(sd); p.scope_conditions = new Set(); patients.push(p); }
    // the reviewer's own: ACE inhibitor to sacubitril/valsartan, a loop to a loop, carvedilol 50 mg at a dry weight of 70 kg
    const lisinopril = make(p => { p.lvef = 28; p.current_regimen = [{ med: MEDICATION_FORMULARY.find(m => m.name === 'Lisinopril')!, dose: MEDICATION_FORMULARY.find(m => m.name === 'Lisinopril')!.available_doses[0], selected_frequency: 'qd', exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } }]; });
    const carv = make(p => { const m = MEDICATION_FORMULARY.find(x => x.name === 'Carvedilol')!; p.lvef = 30; p.volume_status.dry_weight_kg = 70; p.volume_status.current_weight_kg = 70; p.current_regimen = [{ med: m, dose: m.available_doses.find(d => String(d.strength) === '50')!, selected_frequency: 'bid', exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } }]; });
    patients.push(lisinopril, carv);
    for (const p of patients) {
        const r = renderScreen(p); if (r.o.scoredRegimens.length === 0) continue;
        assert.ok(!/ -&gt; | -> /.test(r.html) && !/ -> /.test(r.text), `a typed arrow is shown`);
        const lines = r.o.scoredRegimens.flatMap(x => (x.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => m.summary));
        if (lines.some(l => /^(STOP|Stop) /.test(l))) { acei++; assert.ok(/Stop [A-Za-z\/ ()]+, wait 36 hours, then start /.test(r.text), 'the plain stop, wait, start sentence is not shown'); }
        assert.ok(!/\bSTOP [A-Z][a-z]|\bWAIT \d+ hours|\bTHEN start\b/.test(r.text), `a shouted instruction is shown: ${/[^.]*\b(WAIT \d+ hours|THEN start)[^.]*/.exec(r.text)?.[0]}`);
        if (lines.some(l => /^Swap /.test(l))) { swaps++; assert.ok(!/\bSwap [A-Z]/.test(r.text) && /Switch [A-Z]/.test(r.text), `Swap is shown: ${/[^.]{0,80}\bSwap [A-Z][^.]{0,120}/.exec(r.text)?.[0]}`); }
        assert.ok(!/ is above the maximum of [0-9.]+ mg\)/.test(r.text.replace(/kidney function[^)]*\)/g, '')) || !/the label's limit by body weight[^)]*is above the maximum/.test(r.text), 'the carvedilol tail is shown');
    }
    assert.ok(acei >= 1, 'no patient had the ACE inhibitor switch');
    const cr = renderScreen(carv);
    assert.ok(/the label's limit by body weight/.test(cr.text) && !/is above the maximum of 25 mg/.test(cr.text), `carvedilol sentence: ${/Reduce Carvedilol[^)]*\)/.exec(cr.text)?.[0]}`);
});

console.log(`\nVerifyR6Ui: ${passed} passed, ${failed} failed`);
