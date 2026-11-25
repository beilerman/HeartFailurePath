import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PatientBar } from '../components/guided/PatientBar';
import { ReviewStep } from '../components/guided/ReviewStep';
import { PrintSummary } from '../components/PrintSummary';
import { DiscardConfirm, caseIsTouched, DISCARD_QUESTION } from '../components/guided/DiscardConfirm';
import { DEMO_CASES, demoPatient } from '../components/guided/demoCases';
import { blankPatient, withFormDerivations } from '../components/patient-form/patientDraft';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { PRICES as TIER_PRICES } from './r2Generator';
import { congestedLoopState } from './engineReadinessR10Checks';
import { FAQ } from '../components/FAQ';
import { MedicationLibrary } from '../components/MedicationLibrary';
import { EvidenceDrillDown } from '../components/ExpectedEffect';
import { derivedFields } from '../services/clinicalPredicates';
import type { Patient, RegimenMed } from '../types';

// Checks for round 11 part 2 screen rulings (C1, C2, C3, C4). Server-rendered content only; the click behaviour of C2 is checked in scripts/verifyBrowserSession.mjs.
let passed = 0;
export let failed = 0;
const check = (name: string, f: () => void) => {
    try { f(); passed++; console.log(`[PASS] ${name}`); }
    catch (error) { failed++; console.error(`[FAIL] ${name}: ${String(error).split('\n')[0]}`); }
};
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ');
const short = (n: string) => n.replace(/\s*\(.*\)\s*$/, '');
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));

type Use = 'none' | 'active-consistent' | 'active-partial' | 'active-unknown' | 'unknown' | 'held' | 'completed';
const USES: Use[] = ['none', 'active-consistent', 'active-partial', 'active-unknown', 'unknown', 'held', 'completed'];
const exposureFor = (u: Use): RegimenMed['exposure'] => u === 'none' ? undefined : u === 'active-consistent' ? { status: 'active', adherence: 'consistent' } : u === 'active-partial' ? { status: 'active', adherence: 'partial' }
    : u === 'active-unknown' ? { status: 'active', adherence: 'unknown' } : u === 'unknown' ? { status: 'unknown' } : { status: u };
const withUses = (base: Patient, uses: Use[]): Patient => { const p = clonePatient(base); p.current_regimen = base.current_regimen.slice(0, uses.length).map((r, i) => ({ ...r, exposure: exposureFor(uses[i]) })); return p; };
const base = SCENARIOS.find(s => s.patient.current_regimen.length >= 3)!.patient;

const render = (p: Patient) => ({
    bar: textOf(renderToStaticMarkup(<PatientBar patient={p} caseLabel="test" onEditInputs={() => {}} onNewPatient={() => {}} />)),
    review: textOf(renderToStaticMarkup(<ReviewStep patient={p} problems={[]} hints={{}} hasErrors={false} onGoToField={() => {}} onRun={() => {}} pricesReady />)),
    print: textOf(renderToStaticMarkup(<PrintSummary patient={p} caseLabel="test" results={[]} clinicalAlerts={[]} monitoring={[]} monitoringOption={0} />)),
});

check('C1: header, Review step and print name the held and completed drugs beside the count, and mark uncertain use (every use status, every pair and triple of statuses)', () => {
    let held = 0, completed = 0, uncertain = 0;
    const combos: Use[][] = [];
    for (const a of USES) for (const b of USES) for (const c of USES) combos.push([a, b, c]);
    for (const uses of combos) {
        const p = withUses(base, uses);
        const rs = p.current_regimen;
        const taking = rs.filter((_r, i) => uses[i] !== 'held' && uses[i] !== 'completed');
        const heldNames = rs.filter((_r, i) => uses[i] === 'held').map(r => short(r.med.name));
        const doneNames = rs.filter((_r, i) => uses[i] === 'completed').map(r => short(r.med.name));
        const isUncertain = (u: Use) => u === 'unknown' || u === 'active-partial' || u === 'active-unknown';
        const r = render(p);
        for (const [where, t] of Object.entries(r)) {
            if (taking.length === 0 && heldNames.length + doneNames.length === 0) continue;
            assert.ok(new RegExp(`Current drugs:? ${taking.length}\\b`, 'i').test(t) || t.toLowerCase().includes(`current drugs ${taking.length}`), `${where}: the count ${taking.length} is missing for ${uses.join(',')}`);
            for (const n of heldNames) { assert.ok(t.includes(`held: ${heldNames.join(', ')}`), `${where}: held ${n} not named for ${uses.join(',')}`); }
            for (const n of doneNames) { assert.ok(t.includes(`completed: ${doneNames.join(', ')}`), `${where}: completed ${n} not named for ${uses.join(',')}`); }
            if (heldNames.length === 0) assert.ok(!/\bheld:/.test(t.replace(/held: restart needs review/g, '')), `${where}: a held list appears with no held drug for ${uses.join(',')}`);
            if (doneNames.length === 0) assert.ok(!/\bcompleted:/.test(t), `${where}: a completed list appears with no completed drug for ${uses.join(',')}`);
            taking.forEach((rm, i) => {
                const u = uses[rs.indexOf(rm)];
                const marked = t.includes(`${short(rm.med.name)} (use uncertain)`);
                assert.equal(marked, isUncertain(u), `${where}: ${short(rm.med.name)} use ${u}: marked ${marked}`);
                void i;
            });
        }
        held += heldNames.length; completed += doneNames.length; uncertain += uses.filter(isUncertain).length;
    }
    assert.ok(held > 100 && completed > 100 && uncertain > 100, `${held} ${completed} ${uncertain}`);
});

check('C2: the discard prompt asks the question with the two buttons; an untouched blank case and an unmodified example are not touched, any change is', () => {
    const html = renderToStaticMarkup(<DiscardConfirm onDiscard={() => {}} onKeep={() => {}} />);
    const t = textOf(html);
    assert.equal(DISCARD_QUESTION, 'Discard the entered case?');
    assert.ok(t.includes('Discard the entered case?') && /Discard<\/button>/.test(html) && /Keep editing<\/button>/.test(html), t);
    assert.ok(!/<form|confirm\(/.test(html));
    assert.equal(caseIsTouched(blankPatient(), 'custom', false), false);
    // R12 D5(d) (rewritten): an unmodified example is the example as the form leaves it (the form adds the atrial fibrillation history for an AFib rhythm); the full check over every scenario is the D5(d) check below.
    for (const s of SCENARIOS.slice(0, 40)) { assert.equal(caseIsTouched(clonePatient(s.patient), s.title, false), false, `${s.title}: the raw example (R13 E5(a): asserted again beside the opened one)`); const q = clonePatient(s.patient); if (q.rhythm === 'AFib') q.comorbidities.add('Atrial Fibrillation'); assert.equal(caseIsTouched(q, s.title, false), false, s.title); }
    assert.equal(caseIsTouched(blankPatient(), 'custom', true), true, 'an unfinished entry counts');
    const edits: ((p: Patient) => void)[] = [p => { p.age = 66; }, p => { p.lvef = 35; }, p => { p.sex = 'Female'; }, p => { p.potassium = 4.1; }, p => { p.allergies = new Set(['x']); },
        p => { p.comorbidities = new Set(['diabetes']); }, p => { p.current_regimen = base.current_regimen.slice(0, 1); }, p => { p.volume_status.current_weight_kg = 80; }];
    for (const e of edits) { const p = blankPatient(); e(p); assert.equal(caseIsTouched(p, 'custom', false), true, String(e)); }
    for (const s of SCENARIOS.slice(0, 10)) { const p = clonePatient(s.patient); p.age = (p.age ?? 50) + 1; assert.equal(caseIsTouched(p, s.title, false), true, s.title); }
});

check('C3: each of the six example cards describes what the options actually show', () => {
    assert.equal(DEMO_CASES.length, 6);
    for (const d of DEMO_CASES) {
        const p = clonePatient(demoPatient(d));
        const o = generateAndScoreModifications(p, names, (TIER_PRICES as Record<string, Record<string, number>>)[p.insurance_tier ?? 'cash']);
        const mods = o.scoredRegimens.map(r => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => ({ action: m.action, drug: String((m.target ?? m.source)?.med.name) })));
        const s = d.sentence.toLowerCase();
        const shown = (needle: string) => mods.some(o1 => o1.some(m => m.drug.toLowerCase().includes(needle)));
        const claims: [string, string][] = [['dapagliflozin', 'dapagliflozin'], ['semaglutide', 'semaglutide'], ['spironolactone', 'spironolactone'], ['metoprolol', 'metoprolol'], ['sacubitril', 'sacubitril'], ['finerenone', 'finerenone'], ['furosemide', 'furosemide'], ['eplerenone', 'eplerenone']];
        for (const [word, needle] of claims) if (s.includes(word)) assert.ok(shown(needle), `${d.title}: the sentence names ${word} but no option shows it`);
        if (s.includes('loop diuretic')) assert.ok(mods.length > 0 && mods.every(o1 => o1.some(m => /furosemide|furoscix|torsemide|bumetanide/i.test(m.drug))), `${d.title}: not every option has a loop diuretic`);
        if (s.includes('each option raises one dose')) assert.ok(mods.length > 0 && mods.every(o1 => o1.length === 1 && o1[0].action === 'titrate_up'), `${d.title}: not every option is one dose raise`);
        if (/staying put|no medication change/.test(s)) assert.fail(`${d.title}: says there is a stay-put option`);
        if (s.includes('each option starts')) assert.ok(mods.length > 0 && mods.every(o1 => o1.some(m => m.action === 'add')), `${d.title}: not every option starts a drug`);
        if (/no drug options/.test(s)) assert.equal(o.scoredRegimens.length, 0, d.title);
        if (/adds? first|would add/.test(s)) assert.ok(mods.some(o1 => o1.some(m => m.action === 'add')), `${d.title}: no option adds a drug`);
    }
    const sentenceOf = (t: string) => DEMO_CASES.find(d => d.title === t)!.sentence;
    assert.match(sentenceOf('Preserved EF with obesity'), /dapagliflozin/i);
    assert.match(sentenceOf('Four drugs below target dose'), /raises? one dose/i);
});

check('C4: the Evidence-tab row HF-SCORE-004 and the evidence matrix say up to three of the five least costly', () => {
    const m = readFileSync(new URL('../docs/evidence-matrix.md', import.meta.url), 'utf8').split('\n').find(l => l.startsWith('| HF-SCORE-004'))!;
    assert.ok(m.includes('up to three of the five least costly'), m.slice(0, 200));
    assert.ok(!m.includes('(up to five;'));
    const faq = readFileSync(new URL('../components/FAQ.tsx', import.meta.url), 'utf8');
    assert.ok(/evidence-matrix/.test(faq), 'the Evidence tab no longer reads the matrix');
});

const panel = (f: string) => readFileSync(new URL(`../docs/expert-review-2026-11-19/panel/${f}`, import.meta.url), 'utf8');
check('C5: question 14 has no unreachable parenthetical; the limitations page names the three loop agents in the order the engine starts them (tested on the engine); the no-option case pages carry no "eligible decisions" KCCQ line', () => {
    assert.ok(!panel('3-policy-questions.md').includes('with the age also missing'));
    assert.ok(panel('3-policy-questions.md').includes('the results usually show no medication change'));
    const lim = panel('2-limitations.md');
    assert.ok(lim.includes('furosemide 20 mg unless furosemide is excluded, then torsemide 5 mg, then bumetanide 0.5 mg'), 'the limitations page does not name bumetanide 0.5 mg as the third agent');
    const started = (allergies: string[]) => {
        const seen = new Set<string>();
        for (let j = 0; j < 40; j++) {
            const p = congestedLoopState(61300000 + 30 * j); p.allergies = new Set(allergies);
            const o = generateAndScoreModifications(clonePatient(p), names, {});
            for (const r of o.scoredRegimens) for (const m of r.modification_set?.modifications ?? []) if (m.action === 'add' && m.target?.med.drug_class === 'Loop Diuretic' && !m.target.med.facts?.short_course_addon) seen.add(`${m.target.med.name} ${m.target.dose.strength}`);
        }
        return [...seen];
    };
    assert.deepEqual(started([]), ['Furosemide 20'], 'first agent');
    assert.deepEqual(started(['furosemide']), ['Torsemide 5'], 'second agent');
    assert.deepEqual(started(['furosemide', 'torsemide']), ['Bumetanide 0.5'], 'third agent');
    for (const f of ['cases/case-36.md', 'cases/case-41.md']) { const t = panel(f); assert.ok(!/eligible medication decisions|other eligible decisions/.test(t), f); assert.ok(/No medication option|proposed no medication option|no medication option/i.test(t), `${f} is not a no-option page`); }
});

// ===================================================================================================================================================================================
// R12 SECTION (round 12 fix pass, rulings D5(a) and D5(d); the engine rulings are in scripts/engineReadinessR11Checks.ts under its R12 section)
// ===================================================================================================================================================================================
check('D5(a) no "nsMRA" on any string the Evidence tab, the Formulary tab and the evidence drill-down render (every scenario option that carries finerenone); "nonsteroidal MRA" is shown instead', () => {
    const faq = textOf(renderToStaticMarkup(<FAQ evidenceQuery="" onEvidenceQueryChange={() => {}} jumpNonce={0} />));
    const library = textOf(renderToStaticMarkup(<MedicationLibrary />));
    assert.ok(!/nsMRA/.test(faq), `Evidence tab: ${faq.match(/.{50}nsMRA.{30}/)?.[0]}`);
    assert.ok(!/nsMRA/.test(library), `Formulary tab: ${library.match(/.{50}nsMRA.{30}/)?.[0]}`);
    assert.ok(/nonsteroidal MRA/.test(faq) && /nonsteroidal MRA/.test(library), 'the class is not shown by its name');
    assert.ok(/A NEW MRA or nonsteroidal MRA start at potassium 5\.0 or higher/.test(faq), 'rule E15 text');
    let drill = 0;
    for (const sc of SCENARIOS) {
        const o = generateAndScoreModifications(clonePatient(sc.patient), names, {});
        for (const r of o.scoredRegimens) {
            if (!(r.regimen ?? []).some(m => m.med.drug_class === 'nsMRA')) continue;
            drill++; const t = textOf(renderToStaticMarkup(<EvidenceDrillDown regimen={r} />));
            assert.ok(!/nsMRA/.test(t), `${sc.title}: drill-down: ${t.match(/.{50}nsMRA.{30}/)?.[0]}`);
        }
    }
    assert.ok(drill >= 10, `${drill} finerenone options rendered`);
});

check('D5(d) opening the form on an unchanged example is not "touched" (every scenario, atrial fibrillation rhythm included: the form adds the derived history); changing any one field is', () => {
    // What the form does on opening a case (usePatientFormModel): eGFR and BMI are computed, and a rhythm of AFib records the atrial fibrillation history.
    const openedByForm = (p: Patient): Patient => { const q = clonePatient(p); const d = derivedFields(q as never); q.egfr = Number.isFinite(d.egfr) ? d.egfr : 0; q.bmi = Number.isFinite(d.bmi) ? d.bmi : 0; if (q.rhythm === 'AFib') q.comorbidities.add('Atrial Fibrillation'); return q; };
    let af = 0, lacking = 0, perturbed = 0;
    for (const sc of SCENARIOS) {
        const opened = openedByForm(sc.patient); if (sc.patient.rhythm === 'AFib') { af++; if (!sc.patient.comorbidities.has('Atrial Fibrillation')) lacking++; }
        assert.equal(caseIsTouched(opened, sc.title, false), false, `${sc.title}: an unchanged example is called touched`);
        const bump = (o: Record<string, unknown>, k: string) => { const v = o[k];
            if (v instanceof Set) o[k] = new Set([...v, 'zz-changed']); else if (Array.isArray(v)) o[k] = [...v, 'zz']; else if (typeof v === 'number') o[k] = v + 1; else if (typeof v === 'boolean') o[k] = !v; else if (typeof v === 'string') o[k] = v + 'x'; else if (v === undefined) o[k] = 1; else return false; return true; };
        for (const k of Object.keys(opened)) { const q = openedByForm(sc.patient) as unknown as Record<string, unknown>; if (!bump(q, k)) continue; perturbed++; assert.equal(caseIsTouched(q as unknown as Patient, sc.title, false), true, `${sc.title}: changing ${k} is not noticed`); }
        const q = openedByForm(sc.patient); q.volume_status = { ...q.volume_status, dry_weight_kg: (q.volume_status.dry_weight_kg ?? 0) + 1 }; assert.equal(caseIsTouched(q, sc.title, false), true, `${sc.title}: changing the dry weight is not noticed`);
    }
    assert.ok(af >= 50 && lacking >= 8 && perturbed > 5000, `${af} atrial fibrillation examples (${lacking} lacking the history), ${perturbed} one-field changes`);
    for (const d of DEMO_CASES) { const sc = SCENARIOS.find(x => x.title === d.scenarioTitle); assert.ok(sc, d.scenarioTitle); assert.equal(caseIsTouched(openedByForm(sc!.patient), d.scenarioTitle, false), false, `example card ${d.title}`); }
});

// ===================================================================================================================================================================================
// R13 SECTION (round 13 fix pass, rulings E5(a) and E5(c); rule set 2026-11-25.1). Each check was seen to fail before its fix.
// ===================================================================================================================================================================================
check('R13 E5(a) an unchanged example is not touched whether the case in state is the raw example (results page, form never opened) or the example as the form opens it; every scenario and every example card; one changed field is touched on both', () => {
    let raw = 0, opened = 0;
    for (const sc of SCENARIOS) {
        const rawCase = clonePatient(sc.patient); raw++;
        assert.equal(caseIsTouched(rawCase, sc.title, false), false, `${sc.title}: the raw example is called touched`);
        const q = withFormDerivations(clonePatient(sc.patient)); opened++;
        assert.equal(caseIsTouched(q, sc.title, false), false, `${sc.title}: the example as the form opens it is called touched`);
        const changedRaw = clonePatient(sc.patient); changedRaw.age = (changedRaw.age ?? 50) + 1; assert.equal(caseIsTouched(changedRaw, sc.title, false), true, `${sc.title}: a changed raw example is not noticed`);
        const changedOpened = withFormDerivations(clonePatient(sc.patient)); changedOpened.age = (changedOpened.age ?? 50) + 1; assert.equal(caseIsTouched(changedOpened, sc.title, false), true, `${sc.title}: a changed opened example is not noticed`);
    }
    for (const d of DEMO_CASES) { assert.equal(caseIsTouched(clonePatient(demoPatient(d)), d.scenarioTitle, false), false, `example card ${d.title}: the raw example from the results page is called touched`); }
    assert.ok(raw >= 100 && opened === raw, `${raw} scenarios`);
});

check('R13 E5(c) no programming identifier (a camelCase function name or an underscored field name) in the prose the Evidence tab and the Formulary tab show; the code-location text, which the tab words as "the project record (...)", may name functions', () => {
    const faq = textOf(renderToStaticMarkup(<FAQ evidenceQuery="" onEvidenceQueryChange={() => {}} jumpNonce={0} />));
    const library = textOf(renderToStaticMarkup(<MedicationLibrary />));
    const allowed = new Set(['mEq', 'mmHg']); // written with an inner capital in medicine and units, not code
    const re = /\b[a-z]+(?:[A-Z][a-z0-9]+)+\b|\b[a-z]+_[a-z]+(?:_[a-z]+)*\b/g;
    const found = new Map<string, string>();
    for (const [where, whole] of [['Evidence tab', faq], ['Formulary tab', library]] as const) {
        const t = whole.replace(/the project record \([^)]*\)/g, 'the project record');
        for (const m of t.matchAll(re)) if (!allowed.has(m[0]) && !found.has(m[0])) found.set(m[0], `${where}: ...${t.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 30)}`);
    }
    assert.equal(found.size, 0, [...found.entries()].map(([k, v]) => `${k} (${v})`).join(' || '));
});

console.log(`\nverifyR11Ui: ${passed} passed, ${failed} failed`);
