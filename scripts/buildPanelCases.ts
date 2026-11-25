// Generator for the expert-panel prepared-case packet. `npm run panel:cases` writes docs/expert-review-2026-11-19/panel/.
// Every sentence about the tool's output is produced here from the tool's own output (the same functions the screen and the draft note use);
// nothing about what the tool says is typed by hand. The packet is deterministic: no clock, no randomness, so the stale-packet check can compare byte for byte.
import { mkdirSync, writeFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PANEL_CASE_SPECS, PANEL_CASE_ORDER, type PanelCaseSpec } from '../data/panelCases';
import { generateAndScoreModifications, clonePatient, getTargetDosePatientContext, isTargetDoseForPatient } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { MEDICATION_FORMULARY } from '../constants';
import { RULESET_VERSION } from '../services/rulesetVersion';
import { WEIGHT_PROFILE_META } from '../services/engine/scoreModel';
import { isDiureticClass } from '../services/engine/registry';
import { dosingWords } from '../services/engine/regimenUtils';
import { headWords } from '../services/engine/whyFirst';
import { valueUnknown, pregnancyStatusRequired } from '../services/clinicalPredicates';
import { SCOPE_CONDITIONS } from '../services/engine/scopeGate';
import type { Patient, ScoredRegimen, SimulationOutput } from '../types';
import { partitionAlerts, partitionWarnings, stripDrugNotePrefix, planForOption, groupExclusions, exclusionsForGap, startedByOption, entryReasonText, stopStateText, describeOption, type ChartInput } from '../components/resultsModel';
import { clinicalSentence, costLabel, doseLabel, optionDifferences, NO_CHANGE_TEXT } from '../components/clinicalPresentation';
import { plainText } from '../components/plainText';
import { shortDrugName } from '../components/guided/patientFacts';
import { useStatusWords } from '../components/guided/confirmUse';
import { isOverBudgetFallback } from '../components/resultsModel';
import { profileDescription } from '../components/appStatements';
import {
    buildExpectedEffect, outcomeLineText, symptomsLineText, burdenLineText, figureText, fmtSigned, POPULATION_AVERAGE_NOTE, AFIB_BETA_BLOCKER_NOTE,
} from '../components/expectedEffectModel';

export const PANEL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'expert-review-2026-11-19', 'panel');
export const PAGE_BREAK = '<div class="page-break"></div>';
/** The packet is stamped with the date inside the rule-set identifier (no clock), so regenerating on another day changes nothing. */
export const RULESET_DATE = RULESET_VERSION.slice(0, 10);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const RULESET_DATE_WORDS = `${Number(RULESET_DATE.slice(8, 10))} ${MONTHS[Number(RULESET_DATE.slice(5, 7)) - 1]} ${RULESET_DATE.slice(0, 4)}`;
export const STAMP = `Rule set ${RULESET_VERSION}, dated ${RULESET_DATE_WORDS}. The patient is constructed for this review and is not a real person.`;

// ---------------------------------------------------------------------------------------------------------------------------------
// Questions (typed text is about the reviewer's task, never about what the tool says)

export const Q1_OPTIONS = ['a. What I would do, or equally good', 'b. Acceptable, but not my first choice', 'c. Not acceptable', 'd. Unsafe'];
export const Q4_OPTIONS = ['True and sufficient', 'True but incomplete', 'Unclear', 'Contains something false (say what below)'];
export const GENERAL_OVERALL_OPTIONS = ['Yes, as a second opinion that does not change care', 'Yes, after the changes I list below', 'No'];

const box = (n = 3): string[] => ['| # | Answer |', '|---|---|', ...Array.from({ length: n }, (_v, i) => `| ${i + 1}. |   |`)];

function questionsFor(noOption: boolean, firstOptionText: string): string[] {
    return [
        '## Your ratings for this case',
        '',
        noOption
            ? '**Question 1.** The tool proposed no medication option and showed the alerts above (they may ask for a drug to be withheld, reduced or reviewed). Having no option, and the alerts shown, are:'
            : `**Question 1.** The tool's first option (${firstOptionText}) is:`,
        '',
        ...Q1_OPTIONS.map(o => `- ☐ ${o}`),
        '',
        '**Question 2.** If you chose b, c or d: what would you do first, and why?',
        '',
        ...box(1),
        '',
        '**Question 3.** Is anything on this page wrong or unsafe (an alert, a dose, a monitoring item, a missing alert)?',
        '',
        '- ☐ No',
        '- ☐ Yes: what?',
        '',
        ...box(1),
        '',
        noOption ? '**Question 4.** The reason given for proposing no option is:' : '**Question 4.** The reasons given for the first option are:',
        '',
        ...Q4_OPTIONS.map(o => `- ☐ ${o}`),
        '',
        ...box(1),
        '',
        '**Question 5.** Is anything a careful clinician would need missing from the inputs or from the output?',
        '',
        ...box(1),
        '',
        '**Question 6 (optional).** Any other comment.',
        '',
        ...box(1),
    ];
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Part 1: the patient (only what the clinician entered)

const sexWord = (p: Patient) => (p.sex === 'Male' ? 'man' : 'woman');
const efBand = (lvef: number) => (lvef <= 40 ? 'reduced ejection fraction' : lvef <= 49 ? 'mildly reduced ejection fraction' : 'preserved ejection fraction');
export function caseTitle(p: Patient): string {
    return `${p.age}-year-old ${sexWord(p)}, ${efBand(p.lvef)} (${p.lvef}%)${p.rhythm === 'AFib' ? ', atrial fibrillation' : ''}`;
}

const NOT_ENTERED = 'not entered';
const val = (v: number | undefined, unit = ''): string => (valueUnknown(v) ? NOT_ENTERED : `${v}${unit}`);
const list = (xs: Iterable<string> | undefined, none = 'none recorded'): string => { const a = xs ? [...xs].sort() : []; return a.length > 0 ? a.join(', ') : none; };
/**
 * A true count of what is taken (R6 V16c). "Doses a day" counts each scheduled dose of a drug taken daily or more often (once daily is one, twice daily is two); a weekly or every-other-day drug is
 * named apart (counting it as a fraction of a dose a day, or a combined tablet by its parts, gave figures nobody takes). One drug, one dose is "1 drug, 1 dose a day".
 */
export { dosingWords };
const RHYTHM_WORDS: Record<string, string> = { Sinus: 'sinus rhythm', AFib: 'atrial fibrillation', Paced: 'paced rhythm', '2nd Degree AV Block': 'second-degree AV block', '3rd Degree AV Block': 'third-degree AV block' };
const TIER_WORDS: Record<string, string> = { cash: 'Uninsured, cash prices', commercial: 'Commercial insurance', medicare: 'Medicare Part D' };
const CONSISTENCY_WORDS: Record<string, string> = { consistent: 'consistent use confirmed', partial: 'partial or interrupted use', unknown: 'consistency unknown' };

function weightText(p: Patient): string {
    const w = p.volume_status;
    if (valueUnknown(w.current_weight_kg) || valueUnknown(w.dry_weight_kg)) return `current ${val(w.current_weight_kg, ' kg')}, dry ${val(w.dry_weight_kg, ' kg')}`;
    const d = Math.round((w.current_weight_kg - w.dry_weight_kg) * 10) / 10;
    return `${w.current_weight_kg} kg now; recorded dry weight ${w.dry_weight_kg} kg (${d === 0 ? 'at dry weight' : `${Math.abs(d)} kg ${d > 0 ? 'above' : 'below'} dry weight`})`;
}

function vignette(p: Patient): string {
    const he = p.sex === 'Male' ? 'He' : 'She';
    const drugs = p.current_regimen.map(r => `${shortDrugName(r.med.name)} ${doseLabel(r)}`);
    const w = p.volume_status;
    const d = valueUnknown(w.current_weight_kg) || valueUnknown(w.dry_weight_kg) ? undefined : Math.round((w.current_weight_kg - w.dry_weight_kg) * 10) / 10;
    const parts = [
        `A ${p.age}-year-old ${sexWord(p)} with an ejection fraction of ${p.lvef}% and NYHA class ${p.nyha_class} symptoms is seen as an outpatient for a heart failure medication review.`,
        `Blood pressure is ${val(p.sbp)}/${val(p.dbp)} mmHg and the heart rate is ${val(p.pulse)} per minute in ${RHYTHM_WORDS[p.rhythm] ?? p.rhythm}.`,
        d === undefined ? '' : d === 0 ? `${he} is at the recorded dry weight.` : `${he} is ${Math.abs(d)} kg ${d > 0 ? 'above' : 'below'} the recorded dry weight.`,
        valueUnknown(p.potassium) && valueUnknown(p.egfr) ? 'Potassium and kidney function have not been entered.' : `Potassium is ${val(p.potassium, ' mEq/L')} and eGFR is ${val(p.egfr, ' mL/min/1.73 m²')}.`,
        drugs.length === 0 ? `${he} takes no heart failure medication.` : `${he} takes ${drugs.join(', ')}.`,
    ];
    return parts.filter(Boolean).join(' ');
}

function part1(n: number, p: Patient): string[] {
    const row = (k: string, v: string) => `| ${k} | ${v} |`;
    const intol = p.discontinued_meds.map(d => `${shortDrugName(d.name)}: ${d.reason}${d.reason_detail ? `, ${d.reason_detail}` : ''}`);
    const scope = p.scope_conditions === undefined ? 'Question not answered' : p.scope_conditions.size === 0 ? 'None of these' : list(p.scope_conditions);
    const out: string[] = [
        `# Case ${n}: ${caseTitle(p)}`,
        '',
        `## Part 1. The patient`,
        '',
        STAMP,
        '',
        vignette(p),
        '',
        '### What the clinician entered',
        '',
        '| Item | Entered |',
        '|---|---|',
        row('Age and sex', `${p.age} years, ${p.sex.toLowerCase()}; self-identified race: ${p.race}`),
        // R6 V16b: shown only where the form asks the question (a woman younger than the age at which it asks); elsewhere the form records nothing, and "Not pregnant" for a man or a woman of 78 was never entered.
        ...(pregnancyStatusRequired(p) ? [row('Pregnancy', p.is_pregnant === undefined ? 'Not recorded' : p.is_pregnant ? 'Pregnant' : 'Not pregnant')] : []),
        row('Ejection fraction', `${p.lvef}%; lowest earlier ejection fraction ${val(p.previous_lvef, '%')}; ever 40% or lower: ${p.ever_lvef_le_40 === 'unknown' ? NOT_ENTERED : p.ever_lvef_le_40}`),
        row('NYHA class', `${p.nyha_class}; heart failure worsening in the last 6 months: ${p.recent_hf_worsening_within_6mo === 'unknown' ? NOT_ENTERED : p.recent_hf_worsening_within_6mo}`),
        row('Blood pressure and heart rate', `${val(p.sbp)}/${val(p.dbp)} mmHg; ${val(p.pulse)} per minute; rhythm: ${RHYTHM_WORDS[p.rhythm] ?? p.rhythm}; oxygen saturation ${val(p.oxygen_saturation, '%')}`),
        row('Weight', weightText(p)),
        row('Examination findings', list(p.volume_status.exam_findings, 'none recorded')),
        row('NT-proBNP', val(p.nt_pro_bnp, ' pg/mL')),
        row('Potassium', val(p.potassium, ' mEq/L')),
        row('Kidney function', `creatinine ${val(p.creatinine, ' mg/dL')}; eGFR ${val(p.egfr, ' mL/min/1.73 m²')}; earlier creatinine ${val(p.baseline_creatinine, ' mg/dL')}; BUN ${val(p.bun, ' mg/dL')}`),
        row('Iron studies and hemoglobin', `ferritin ${val(p.ferritin, ' ng/mL')}; transferrin saturation ${val(p.tsat, '%')}; hemoglobin ${val(p.hemoglobin, ' g/dL')}`),
        row('Other conditions', list(p.comorbidities)),
        row('Conditions the tool does not cover (question asked of the clinician)', scope),
        row('Allergies', list(p.allergies)),
        row('Documented drug intolerances', intol.length > 0 ? intol.join('; ') : 'none recorded'),
        row('Other current medicines', list(p.external_medications)),
        row('Payer and budget', `${TIER_WORDS[p.insurance_tier] ?? NOT_ENTERED}; monthly medication budget $${p.max_affordable_cost}; cost worry ${p.cost_sensitivity} of 10; tolerance for many pills and doses ${p.complexity_tolerance} of 10`),
        row('Most new drug classes at one visit', `${p.max_new_classes_per_visit}`),
        row('What matters most to this patient', WEIGHT_PROFILE_META[p.care_priority ?? 'default'].label),
        '',
        '### Current heart failure medicines',
        '',
        '| Medicine | Dose and frequency | How it is being taken |',
        '|---|---|---|',
        ...(p.current_regimen.length === 0 ? ['| None | not applicable | not applicable |'] : p.current_regimen.map(r =>
            `| ${r.med.name} | ${doseLabel(r)} | ${useStatusWords(r.exposure)}${r.exposure?.adherence ? `; ${CONSISTENCY_WORDS[r.exposure.adherence]}` : ''} |`)),
        '',
        `Daily dosing: ${dosingWords(p.current_regimen)}.`,
        '',
        '### Before turning the page',
        '',
        '**What would you change at this visit?** Write up to three changes (a drug to start, stop or adjust, a test, an action), or write that you would change nothing. Please answer before you read the next page.',
        '',
        ...box(3),
    ];
    return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Part 2: what the tool shows

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
const sentenceEnd = (t: string): string => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);

function optionBlock(k: number, r: ScoredRegimen, out: SimulationOutput, patient: Patient): string[] {
    const L: string[] = [];
    const ctx = getTargetDosePatientContext(r);
    const changes = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
    const why = out.why_first?.options[k - 1];
    L.push(`### Option ${k}${k === 1 ? ': first option to review' : ': alternative option'}`, '');
    if (isOverBudgetFallback(r)) L.push(`**${Number.isFinite(r.cost) ? 'Over budget: shown for discussion only' : 'Cost unavailable: confirm pricing'}**`, '');
    L.push(`**Changes proposed**`, '');
    L.push(...(changes.length === 0 ? [`- ${NO_CHANGE_TEXT}`] : changes.map(m => `- ${clinicalSentence(m.summary)}`)), '');
    L.push(`**Resulting regimen**`, '');
    L.push(...(r.regimen.length === 0 ? ['- No heart failure medicine'] : r.regimen.map(x => {
        const target = isTargetDoseForPatient(x, ctx) && !isDiureticClass(x.med.drug_class) ? ' (target dose)' : '';
        return `- ${x.med.name} ${doseLabel(x)}${target}`;
    })), '');
    L.push(`The tool's ordering score for this option: ${Math.round(r.overall_score)} out of 100. Monthly cost: ${costLabel(r.cost).replace(' estimated', ' (estimate)')}. Dosing burden: ${dosingWords(r.regimen)} (now ${dosingWords(patient.current_regimen)}).`, '');
    if (r.shown_because) L.push(`**Why this option is shown:** ${plainText(r.shown_because)}`, '');
    if (why && why.lines.length > 0) {
        L.push(`**${k === 1 ? 'Why this is first' : `Why this is option ${k}`}**`, '');
        L.push(...why.lines.filter(l => !l.detail).map(l => `- ${plainText(l.text)}`), '');
        if (why.lines.some(l => l.detail)) L.push('More on why:', '', ...why.lines.filter(l => l.detail).map(l => `- ${plainText(l.text)}`), '');
    }
    if (k > 1 && out.scoredRegimens[0]) L.push(`**Drug differences from option 1**`, '', ...optionDifferences(r, out.scoredRegimens[0]).map(d => `- ${d}`), '');
    // Expected effect, generated from the same view the screen uses.
    const v = buildExpectedEffect(r);
    L.push(`**Expected effect versus the current regimen (trial averages, not a prediction for this patient)**`, '');
    if (!v) L.push('- No estimate was produced for this option.', '');
    else if (v.noChange) L.push('- No medication change is proposed, so there is no change in expected effect.', '');
    else {
        for (const o of v.outcomes) {
            L.push(`- ${outcomeLineText(o)}`);
            if (o.todays && !o.notModelled) L.push(`  - At today's doses: ${o.todays.change.text} (${figureText(o.todays.rr, o.todays.lo, o.todays.hi, o.todays.noInterval, o.doseStepOnly)})`);
        }
        L.push(`- ${symptomsLineText(v.symptoms.delta)}`);
        if (v.symptoms.notMeasured.length > 0) L.push(`  - Not measured, so not counted: ${v.symptoms.notMeasured.join(', ')}.`);
        L.push(`- ${burdenLineText(v.sideEffects.burdenChange, v.sideEffects.doseNotMeasured)}`);
        if (v.sideEffects.top.length > 0) L.push(`  - Largest contributors to the change: ${v.sideEffects.top.map(t => `${t.drug}, ${t.label} (${fmtSigned(t.delta)})`).join('; ')}.`);
        L.push('');
        const afib = (r.outcome_estimates ?? []).some(o => o.outcome === 'all_cause_death' && o.contributors.some(c => c.drug_class === 'Beta Blocker' && c.population_key === 'atrial_fibrillation'));
        if (afib) L.push(plainText(AFIB_BETA_BLOCKER_NOTE), '');
        for (const nn of v.notes) L.push(plainText(nn.text), '');
    }
    L.push(POPULATION_AVERAGE_NOTE, '');
    const { safety, notes } = partitionWarnings(r.warnings);
    if (safety.length > 0) L.push(`**Safety warnings for option ${k} (${safety.length})**`, '', ...safety.map(w => `- ${clinicalSentence(w)}`), '');
    if (notes.length > 0) L.push(`**Prescribing notes for option ${k}**`, '', ...notes.map(n => `- ${stripDrugNotePrefix(n, r.regimen)}`), '');
    const proj = r.qualitative_projections ?? [];
    if (proj.length > 0) L.push(`**Treatment considerations for option ${k}**`, '', ...proj.map(x => `- ${x.label}: ${plainText(x.detail)}`), '');
    const trade = r.trade_offs ?? [];
    if (trade.length > 0) L.push(`**Trade-off labels for option ${k}**`, '', ...trade.map(t => `- ${t.dimension}: ${t.label}`), '');
    return L;
}

/** R7 W8: for the "What matters most" cases, one generated sentence: which weights the setting changed, whether the first option differs from the Balanced case's, and, where the page shows the tie sentence, that the top options are within one point. */
function settingSentence(p: Patient, out: SimulationOutput, balanced?: { number: number; first: string; run: SimulationOutput }): string {
    const name = p.care_priority ?? 'default';
    if (!balanced || name === 'default') return '';
    const tied = (out.why_first?.options ?? []).some(o => o.lines.some(l => /too close to separate/.test(l.text)));
    // R8 X9: each page is rated on its own: no other case's number and no other setting's first option. The full comparison is on the how-chosen page, given after the ratings.
    return `**What this setting changed (generated).** This patient is also shown with the Balanced setting elsewhere in the packet. With "${WEIGHT_PROFILE_META[name].label}" the weights are changed as follows: ${plainText(profileDescription(name))}${tied ? ' The top options here are within one point of each other (the tie sentence below), a difference the tool cannot separate, so which of them comes first rests on it.' : ''}`;
}
function part2(n: number, p: Patient, out: SimulationOutput, balanced?: { number: number; first: string; run: SimulationOutput }): string[] {
    const L: string[] = [`# Case ${n}: ${caseTitle(p)}`, '', '## Part 2. What the tool shows', '', STAMP, ''];
    const setting = settingSentence(p, out, balanced);
    if (setting) L.push(setting, '');
    const chart: ChartInput = {
        results: out.scoredRegimens, clinicalAlerts: out.clinicalAlerts, gdmtGaps: out.gdmtGaps ?? [], eligibleAdjuncts: out.eligibleAdjuncts ?? [], missingDataNotices: out.missingDataNotices ?? [],
        followUpCalendar: out.followUpCalendar ?? [], monitoringPlan: out.monitoringPlan, excludedMedications: out.excludedMedications, decisionReadiness: out.decisionReadiness, whyFirst: out.why_first,
        evidenceBandText: out.evidence_band?.text, scopeNote: out.scope_status?.state === 'not_confirmed' ? out.scope_status.text : undefined,
    };
    // Scope and evidence lines
    const scopeLines: string[] = [];
    if (out.scope_status?.state === 'not_confirmed') scopeLines.push(plainText(out.scope_status.text));
    if (out.evidence_band && out.scoredRegimens.length > 0) scopeLines.push(plainText(out.evidence_band.text));
    if (scopeLines.length > 0) L.push('### Scope and evidence', '', ...scopeLines.map(s => `- ${s}`), '');
    // Alerts, in the order the screen shows them: safety alerts first, then care prompts.
    const { urgent, advisory } = partitionAlerts(out.clinicalAlerts);
    L.push(`### Safety alerts (${urgent.length})`, '');
    L.push(...(urgent.length === 0 ? ['- None raised.'] : urgent.map(a => `- ${a.head ? `**${headWords(a.head)}**: ` : ''}${plainText(a.body)}`)), '');
    if (advisory.length > 0) L.push(`### Other care prompts (${advisory.length})`, '', ...advisory.map(a => `- ${a.head ? `**${headWords(a.head)}**: ` : ''}${plainText(a.body)}`), '');
    // Readiness
    const dr = out.decisionReadiness;
    if (dr && (dr.mode === 'limited_review' || dr.deferred.length > 0)) {
        L.push(`### Assessment scope`, '', `- ${out.scoredRegimens.length === 0 ? (dr.mode === 'limited_review' ? 'Focused review only; no medication option is proposed.' : 'No medication option is proposed.') : dr.mode === 'limited_review' ? 'Focused review only; complete medication options withheld.' : 'Medication options with the prerequisites recorded.'}`);
        for (const a of dr.available) L.push(`- Can be reviewed: ${plainText(a)}`);
        for (const d of dr.deferred) L.push(`- Waiting for information: ${plainText(d)}`);
        L.push('');
    }
    // R7 W8: a no-option case reads as the live screen does: the stop state in its own words, under no heading about options.
    if (out.scoredRegimens.length === 0) L.push('### What the tool shows instead of options', '', plainText(stopStateText(out.clinicalAlerts, out.decisionReadiness, out.why_first)), '');
    else out.scoredRegimens.forEach((r, i) => L.push(...optionBlock(i + 1, r, out, p)));
    // Indicated therapy that is missing, with the reason for each (as the screen and the note give it)
    const groups = groupExclusions(out.excludedMedications);
    const top = out.scoredRegimens[0];
    const gaps = out.gdmtGaps ?? [];
    if (gaps.length > 0) {
        L.push('### Indicated therapy currently missing', '');
        for (const gap of gaps) {
            const started = startedByOption(gap, top);
            const g = exclusionsForGap(gap, groups);
            const w = out.why_first?.gaps.find(x => x.gap === gap);
            const parts: string[] = [];
            if (started.length > 0) parts.push(`started in option 1 (${started.join(', ')})`);
            else if (!top) parts.push('not started: no medication is started or raised on this screen');
            else if (w && w.reasons[0]) parts.push(`not started in option 1. ${w.reasons[0]}`);
            else parts.push('not started in option 1');
            if (w && w.eligible.length > 0 && started.length === 0 && top) parts.push(`could be started: ${w.eligible.join(', ')}`);
            g?.entries.forEach(e => parts.push(`${e.names.join(', ')} withheld${e.ruleName ? ` (${e.ruleName})` : ''}${entryReasonText(e) ? `: ${entryReasonText(e)}` : ''}`));
            L.push(`- ${plainText(gap)}: ${plainText(parts.map(x => x.trim().replace(/[.;]+$/, '')).join('; '))}`);
        }
        L.push('');
    }
    if ((out.eligibleAdjuncts ?? []).length > 0) L.push('### Other eligible therapy to consider', '', ...(out.eligibleAdjuncts ?? []).map(a => `- ${plainText(a)}`), '');
    if ((out.missingDataNotices ?? []).length > 0) L.push('### Data not entered', '', ...(out.missingDataNotices ?? []).map(a => `- ${plainText(a)}`), '');
    // Monitoring for option 1
    const plan = planForOption(chart, 0);
    if (plan.monitoring.length > 0) L.push(`### Monitoring plan${top ? ' for option 1' : ''}`, '', ...plan.monitoring.map(m => `- **${plainText(m.test)}** (${plainText(m.timing)}): ${plainText(m.details)}`), '');
    if (plan.followUp.length > 0) L.push('### Follow-up review prompts', '', ...plan.followUp.map(m => `- ${plainText(m.timing)}: ${plainText(m.test)}. ${plainText(m.details)}`), '');
    const first = top ? describeOption(top) : 'none';
    L.push(...questionsFor(!top, top ? (first === 'no medication change' ? 'No medication change' : cap(first)) : 'no option'));
    return L;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Whole packet

export interface CaseRun { number: number; key: string; spec: PanelCaseSpec; out: SimulationOutput; title: string }
const quiet = <T,>(f: () => T): T => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };

export async function runAllCases(): Promise<CaseRun[]> {
    const names = MEDICATION_FORMULARY.map(m => m.name);
    const runs: CaseRun[] = [];
    let i = 0;
    for (const key of PANEL_CASE_ORDER) {
        const spec = PANEL_CASE_SPECS.find(s => s.key === key);
        if (!spec) throw new Error(`[panel] order names unknown case ${key}`);
        i += 1;
        const prices = await getDrugPrices(names, spec.patient.insurance_tier);
        const out = quiet(() => generateAndScoreModifications(clonePatient(spec.patient), new Set(names), prices));
        runs.push({ number: i, key, spec, out, title: caseTitle(spec.patient) });
    }
    return runs;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const caseFileName = (n: number) => `case-${pad2(n)}.md`;

export function caseMarkdown(c: CaseRun, runs: CaseRun[] = []): string {
    const j0 = c.spec.key !== 'J0' ? runs.find(r => r.spec.key === 'J0') : undefined;
    return [...part1(c.number, c.spec.patient), '', PAGE_BREAK, '', ...part2(c.number, c.spec.patient, c.out, j0 ? { number: j0.number, first: firstOptionLine(j0), run: j0.out } : undefined)].join('\n') + '\n';
}

function firstOptionLine(c: CaseRun): string {
    const top = c.out.scoredRegimens[0];
    if (!top) return 'No option shown';
    const d = describeOption(top);
    return d === 'no medication change' ? 'No medication change' : cap(d);
}
function alertHeads(c: CaseRun): string {
    const heads = partitionAlerts(c.out.clinicalAlerts).urgent.map(a => (a.head ? headWords(a.head) : '')).filter(Boolean);
    return heads.length === 0 ? 'none' : [...new Set(heads)].join('; ');
}

function ratingForm(runs: CaseRun[]): string {
    const L: string[] = [
        '# Rating form', '', STAMP, '',
        '## Instructions (one page)', '',
        `You have ${runs.length} prepared cases. Each case is two parts on separate pages. Part 1 describes a constructed patient. **Before you turn the page, write what you would change at that visit.** Part 2 shows everything the tool produced for that patient and asks six questions.`, '',
        'Please read these points first.', '',
        '- Every patient is constructed. None is a real person.',
        '- The tool is a research tool, not validated on patients. Its estimates are trial averages, not predictions for the patient.',
        '- Some patients appear more than once with one entry changed. Please rate each page on its own.',
        '- Case numbers are only a sequence. They do not mean anything about the case.',
        '- A short page explaining why each case was chosen exists. You will receive it after you return your ratings, so that it cannot influence them.',
        '- Judge each first option as you would judge a colleague\'s suggestion at the visit, with the information on the page.',
        '- Answer in the case file, or in the response sheet that goes with this packet (one row per case).', '',
        '## The six questions asked for every case', '',
        '**Question 1. The tool\'s first option is:**', '',
        ...Q1_OPTIONS.map(o => `- ${o}`), '',
        '**Question 2.** If b, c or d: what would you do first, and why? (free text)', '',
        '**Question 3.** Is anything on the page wrong or unsafe (an alert, a dose, a monitoring item, a missing alert)? No, or yes and what.', '',
        '**Question 4. The reasons given for the first option are:**', '',
        ...Q4_OPTIONS.map(o => `- ${o}`), '',
        'Where a case shows no medication option, Question 1 asks whether proposing no option, with the alerts shown, is acceptable, and Question 4 asks whether the reason given for it is true and sufficient. Neither asks about a first option.', '',
        '**Question 5.** Is anything a careful clinician would need missing from the inputs or from the output? (free text)', '',
        '**Question 6.** Optional comment.', '',
        PAGE_BREAK, '',
        '## Questions after the last case', '',
        '**Overall.** Is the tool ready for a comparison study as a second opinion, without changing care?', '',
        ...GENERAL_OVERALL_OPTIONS.map(o => `- ☐ ${o}`), '',
        '**The three most important changes you would ask for:**', '',
        ...box(3), '',
        '## Cases in this packet', '',
        '| Case | Patient |', '|---|---|',
        ...runs.map(c => `| ${c.number} | ${c.title} |`), '',
    ];
    return L.join('\n') + '\n';
}

const csvCell = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
function responsesCsv(runs: CaseRun[]): string {
    const header = ['ReviewerId', 'CaseNumber', 'CaseTitle', 'Q1FirstOptionRating (answer a, b, c or d: a = what I would do or equally good, b = acceptable but not my first choice, c = not acceptable, d = unsafe)', 'Q2WhatIWouldDoFirst', 'Q3AnythingWrongOrUnsafe', 'Q3WhatIsWrong', 'Q4ReasonsRating', 'Q4WhatIsFalse', 'Q5MissingFromInputsOrOutput', 'Q6Comment'];
    const rows = runs.map(c => [ '', String(c.number), c.title, '', '', '', '', '', '', '', '' ]);
    rows.push(['', 'General', 'Overall: is the tool ready for a comparison study as a second opinion? Answer (yes, after changes, no) in Q1FirstOptionRating, and list the three most important changes in Q2WhatIWouldDoFirst, Q3WhatIsWrong and Q5MissingFromInputsOrOutput', '', '', '', '', '', '', '', '']);
    return [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

function howChosen(runs: CaseRun[]): string {
    const L: string[] = [
        '# How the cases were chosen', '',
        '**For the owner and the analysis. Give this page to reviewers only AFTER they have returned their ratings, because it reveals what each case is meant to test.**', '',
        STAMP, '',
        `There are ${runs.length} cases in ten groups. The order reviewers see is fixed and is deliberately not grouped, so the sequence does not reveal why a case was chosen. The last column is generated from the tool's output when the packet is built.`, '',
    ];
    const groups = [...new Set(PANEL_CASE_SPECS.map(s => s.group))];
    for (const g of groups) {
        L.push(`## ${g}`, '', '| Case | Patient | What it was chosen to test | First option the tool shows | Safety alerts raised |', '|---|---|---|---|---|');
        for (const c of runs.filter(r => r.spec.group === g).sort((a, b) => a.number - b.number)) L.push(`| ${c.number} | ${c.title} | ${c.spec.tests} | ${firstOptionLine(c)} | ${alertHeads(c)} |`);
        L.push('');
    }
    // R6 V16a: the J cases show one patient under three settings of "What matters most". They are useful only if each of the two settings changes the first option, so the build says whether it does and fails when it does not.
    const j = Object.fromEntries(['J0', 'J1', 'J2'].map(k => [k, runs.find(r => r.spec.key === k)!]));
    if (j.J0 && j.J1 && j.J2) {
        const f0 = firstOptionLine(j.J0), f1 = firstOptionLine(j.J1), f2 = firstOptionLine(j.J2);
        if (f1 === f0 || f2 === f0) throw new Error(`[panelCases] The J cases no longer show what the "What matters most" control changes: Balanced "${f0}", Keep cost low "${f1}", Keep the regimen simple "${f2}".`);
        L.push('## How the three "What matters most" cases were chosen', '',
            `Cases ${j.J0.number}, ${j.J1.number} and ${j.J2.number} are one patient, shown with "What matters most" set to Balanced, Keep cost low and Keep the regimen simple. An earlier pair used a patient for whom all three settings gave the same first option, which showed nothing; this patient was found by searching for one (a man of 71 on an ACE inhibitor, a beta-blocker and spironolactone, on Medicare with a $300 monthly budget, worried about cost and able to manage few pills) for whom each of the two settings gives a first option different from Balanced.`, '',
            `- Balanced (case ${j.J0.number}): ${f0}`, `- Keep cost low (case ${j.J1.number}): ${f1}`, `- Keep the regimen simple (case ${j.J2.number}): ${f2}`, '');
    }
    return L.join('\n') + '\n';
}

function readme(runs: CaseRun[]): string {
    return [
        '# Expert panel packet: prepared cases', '', STAMP, '',
        'This folder is what a heart failure expert reads and fills in. Every patient is constructed. Every statement about what the tool shows is produced by the tool for the rule set named above, and the packet is regenerated by a script, so it cannot drift from the tool.', '',
        '## Reading order', '',
        '1. `1-scope.md`: what the tool is and what it covers.',
        '2. `2-limitations.md`: what is known to be left out or simplified.',
        `3. \`cases/case-01.md\` to \`cases/case-${pad2(runs.length)}.md\`: the ${runs.length} prepared cases. Each has Part 1 (the patient, then a box asking what you would change) and Part 2 (what the tool shows, then the rating questions). Answer the box in Part 1 before reading Part 2.`,
        '4. `4-rating-form.md`: instructions, the six questions asked for every case, and the questions after the last case. `responses-template.csv` is the same questions as a sheet with one row per case.',
        '5. `3-policy-questions.md`: choices of judgement for the panel to answer once.', '',
        'For the owner only: `0-how-the-cases-were-chosen.md` says what each case tests. Give it to reviewers only after they have returned their ratings.', '',
        '## Printing', '',
        '`cases-all.md` is every case in one file. `cases-all.html` is the same, ready to print from a browser: a page break falls between Part 1 and Part 2 and between cases.', '',
        '## Regenerating', '',
        'Run `npm run panel:cases` from the repository root. `npm run verify` fails if the committed files differ from what the generator produces now (for example after a rule set change), if any case shows another rule set, or if forbidden wording appears.', '',
    ].join('\n') + '\n';
}

// ---- a small, dependency-free Markdown subset to HTML, for printing ----
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string): string => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
export function markdownToHtml(md: string): string {
    const lines = md.split('\n');
    const html: string[] = [];
    let i = 0;
    while (i < lines.length) {
        const ln = lines[i];
        if (ln.trim() === '') { i++; continue; }
        if (ln.trim() === PAGE_BREAK) { html.push(PAGE_BREAK); i++; continue; }
        const h = /^(#{1,4}) (.*)$/.exec(ln);
        if (h) { html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
        if (ln.startsWith('|')) {
            const rows: string[][] = [];
            while (i < lines.length && lines[i].startsWith('|')) { if (!/^\|[-| ]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|').map(c => c.trim())); i++; }
            html.push('<table>', `<tr>${rows[0].map(c => `<th>${inline(c)}</th>`).join('')}</tr>`, ...rows.slice(1).map(r => `<tr>${r.map(c => `<td>${inline(c) || '&nbsp;'}</td>`).join('')}</tr>`), '</table>');
            continue;
        }
        if (/^\s*- /.test(ln)) {
            html.push('<ul>');
            while (i < lines.length && /^\s*- /.test(lines[i])) { const sub = /^\s{2,}- /.test(lines[i]); html.push(`<li${sub ? ' class="sub"' : ''}>${inline(lines[i].replace(/^\s*- /, ''))}</li>`); i++; }
            html.push('</ul>');
            continue;
        }
        if (/^\d+\. /.test(ln)) { html.push('<ol>'); while (i < lines.length && /^\d+\. /.test(lines[i])) { html.push(`<li>${inline(lines[i].replace(/^\d+\. /, ''))}</li>`); i++; } html.push('</ol>'); continue; }
        html.push(`<p>${inline(ln)}</p>`); i++;
    }
    return html.join('\n');
}
const CSS = 'body{font-family:Georgia,serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.4;font-size:11pt}h1{font-size:1.5rem}h2{font-size:1.25rem;border-bottom:1px solid #999}h3{font-size:1.05rem}table{border-collapse:collapse;width:100%;margin:.5rem 0}th,td{border:1px solid #888;padding:.25rem .4rem;vertical-align:top;text-align:left;font-size:10pt}li.sub{margin-left:1.5rem;list-style-type:circle}.page-break{page-break-after:always;break-after:page;height:0;border-top:1px dashed #bbb;margin:1.5rem 0}@media print{.page-break{border:0;margin:0}}';
export function htmlDocument(title: string, md: string): string {
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>${CSS}</style>\n</head>\n<body>\n${markdownToHtml(md)}\n</body>\n</html>\n`;
}

/** Every file of the packet this generator owns, keyed by path relative to the panel folder. */
export async function buildPacket(): Promise<{ files: Map<string, string>; runs: CaseRun[] }> {
    const runs = await runAllCases();
    const files = new Map<string, string>();
    for (const c of runs) files.set(`cases/${caseFileName(c.number)}`, caseMarkdown(c, runs));
    const all = runs.map(c => caseMarkdown(c, runs)).join(`\n${PAGE_BREAK}\n\n`);
    files.set('cases-all.md', all);
    files.set('cases-all.html', htmlDocument(`Prepared cases, rule set ${RULESET_VERSION}`, all));
    files.set('4-rating-form.md', ratingForm(runs));
    files.set('responses-template.csv', responsesCsv(runs));
    files.set('0-how-the-cases-were-chosen.md', howChosen(runs));
    files.set('README.md', readme(runs));
    return { files, runs };
}

export function writePacket(files: Map<string, string>): void {
    mkdirSync(join(PANEL_DIR, 'cases'), { recursive: true });
    for (const f of readdirSync(join(PANEL_DIR, 'cases'))) if (/^case-\d+\.md$/.test(f) && !files.has(`cases/${f}`)) unlinkSync(join(PANEL_DIR, 'cases', f));
    for (const [path, text] of files) writeFileSync(join(PANEL_DIR, path), text);
}

async function main() {
    const { files, runs } = await buildPacket();
    writePacket(files);
    console.log(`panel packet: ${runs.length} cases and ${files.size} files written to ${PANEL_DIR} (rule set ${RULESET_VERSION})`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
void existsSync; void SCOPE_CONDITIONS; void sentenceEnd;
