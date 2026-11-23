import type { ExcludedMedication, MonitoringPlanItem, ScoredRegimen, DecisionReadiness } from '../types';
import { PILLAR_LABELS, buildFollowUpCalendar } from '../services/engine/explain';
import { capitalizeSentence } from '../services/engine/textCase';
import { MEDICATION_FORMULARY } from '../constants';
import { ELIGIBILITY_RULES } from '../services/engine/eligibility';
import { pillarFamilyOf, getTargetDosePatientContext, isTargetDoseForPatient } from '../services/simulationService';
import { isDiureticClass } from '../services/engine/registry';
import type { PillarKey } from '../services/simulationService';
import { clinicalSentence, doseLabel, NO_CHANGE_TEXT, optionDifferences } from './clinicalPresentation';
import { expectedEffectSentence } from './expectedEffectModel';
import { plainText } from './plainText';
import type { WhyFirst } from '../services/engine/whyFirst';

// Display-side organisation of the engine's output. Nothing here changes what the engine says: it
// only decides where each existing string is shown. Unknown kinds always fall on the safety side.

// ---- Alerts -------------------------------------------------------------------------------------

import { ADVISORY_ALERT_HEADS } from '../services/engine/whyFirst';

export interface SplitAlert { head: string | null; body: string; raw: string }

export function splitAlert(alert: string): SplitAlert {
    // Alerts conventionally read 'HEADER: body'. A colon-less alert renders as a single line.
    const sep = alert.indexOf(': ');
    return { head: sep > 0 ? alert.slice(0, sep) : null, body: sep > 0 ? alert.slice(sep + 2) : alert, raw: alert };
}

/** Prompts that read the entered class against the findings are about the patient's state: they are listed with the safety alerts, not with the care prompts (R5 Y12). */
const SHOWN_WITH_SAFETY_ALERTS: readonly string[] = ['NYHA CLASS AND FINDINGS DISAGREE'];

export function partitionAlerts(alerts: string[]): { urgent: SplitAlert[]; advisory: SplitAlert[] } {
    const urgent: SplitAlert[] = [];
    const advisory: SplitAlert[] = [];
    for (const a of alerts) {
        const s = splitAlert(a);
        (s.head && ADVISORY_ALERT_HEADS.includes(s.head) && !SHOWN_WITH_SAFETY_ALERTS.includes(s.head) ? advisory : urgent).push(s);
    }
    return { urgent, advisory };
}

/** "DEVICE THERAPY SCREENING" -> "Device therapy screening" (headers are shouted in the engine text). */
/** Brand names the formulary carries in parentheses (Entresto, Kerendia, Wegovy, Zepbound, Lokelma): a heading in capitals keeps them capitalised (R8 X7). */
const BRAND_NAMES: string[] = MEDICATION_FORMULARY.map(m => /\(([^)]+)\)/.exec(m.name)?.[1]).filter((b): b is string => !!b && /^[A-Z][a-z]+$/.test(b));
export const sentenceCase = (t: string): string => BRAND_NAMES.reduce((x, b) => x.replace(new RegExp(`\\b${b.toLowerCase()}\\b`, 'g'), b), t.charAt(0) + t.slice(1).toLowerCase());

// ---- Per-regimen warnings -----------------------------------------------------------------------

const DRUG_NOTE = /^Drug note\b[:\s]*/i;

/** Engine prefix of the over-budget fallback warning (selection.ts). Display only: it must keep matching that text. */
export const BUDGET_EXCEEDED_PREFIX = 'BUDGET EXCEEDED';

/** True for a regimen the engine shows only for discussion because nothing fit the stated budget. */
export const isOverBudgetFallback = (r: Pick<ScoredRegimen, 'warnings'> | undefined): boolean =>
    !!r && r.warnings.some(w => w.startsWith(BUDGET_EXCEEDED_PREFIX));


/** Prescribing notes are the engine's non-penalized "Drug note" strings; every other warning stays prominent. */
export function partitionWarnings(warnings: string[]): { safety: string[]; notes: string[] } {
    const safety: string[] = [];
    const notes: string[] = [];
    for (const w of warnings) (DRUG_NOTE.test(w) ? notes : safety).push(w);
    return { safety, notes };
}

/** The drug classes a source-table note is about, read from the note's own words, so a note that begins with its source in brackets can still name the drug it is for (T6g). */
const NOTE_SUBJECTS: { test: RegExp; classes: string[]; label: string }[] = [
    { test: /before starting in NYHA IV/i, classes: ['Beta Blocker'], label: 'Beta-blocker' },
    { test: /achieve euvolemia first/i, classes: ['Beta Blocker'], label: 'Beta-blocker' },
    { test: /asthma is a relative contraindication/i, classes: ['Beta Blocker'], label: 'Beta-blocker' },
    { test: /allopurinol prophylaxis/i, classes: ['Loop Diuretic', 'Thiazide-like Diuretic'], label: 'Loop or thiazide-type diuretic' },
    { test: /SGLT2 inhibitor/i, classes: ['SGLT2i'], label: 'SGLT2 inhibitor' },
    { test: /thiazide-type diuretic is added/i, classes: ['Thiazide-like Diuretic'], label: 'Thiazide-type diuretic' },
    { test: /symptomatic hypotension/i, classes: [], label: 'Blood pressure' },
];
export const stripDrugNotePrefix = (w: string, regimen?: { med: { name: string; drug_class: string } }[]): string => {
    let t = plainText(w.replace(DRUG_NOTE, ''));
    if (/^\(/.test(t)) {
        const subject = NOTE_SUBJECTS.find(x => x.test.test(t));
        const drugs = subject ? (regimen ?? []).filter(r => subject.classes.includes(r.med.drug_class)).map(r => r.med.name) : [];
        t = `${subject?.label ?? 'Prescribing note'}${drugs.length > 0 ? ` (${[...new Set(drugs)].join(', ')})` : ''} ${t}`;
    }
    return capitalizeSentence(t);
};

// ---- Gaps and exclusions ------------------------------------------------------------------------

const PILLAR_BY_LABEL = new Map<string, PillarKey>([
    [PILLAR_LABELS['RAAS Inhibitor'], 'RAAS'],
    [PILLAR_LABELS['Beta Blocker'], 'BB'],
    [PILLAR_LABELS['MRA'], 'MRA'],
    [PILLAR_LABELS['SGLT2i'], 'SGLT2i'],
]);

/** The pillar a gap row is about. A row can carry an explanatory tail after the label ("... : not started: ..."), so match on the label's start. */
export const pillarOfGap = (gap: string): PillarKey | null => {
    for (const [label, key] of PILLAR_BY_LABEL) if (gap === label || gap.startsWith(`${label} `)) return key;
    return null;
};

// A drug belongs to a pillar's family (finerenone sits with the MRAs).
export const pillarOfDrugClass = (drugClass: string): PillarKey | null =>
    pillarFamilyOf(drugClass);

const FAMILY_LABEL: Record<PillarKey, string> = {
    RAAS: 'RAAS inhibitors (ARNI, ACE inhibitor, ARB)',
    BB: 'Beta-blockers',
    MRA: 'Mineralocorticoid receptor antagonists',
    SGLT2i: 'SGLT2 inhibitors',
};
const FAMILY_ORDER: PillarKey[] = ['RAAS', 'BB', 'MRA', 'SGLT2i'];

const ruleOrder = (id?: string) => {
    const i = id ? ELIGIBILITY_RULES.findIndex(r => r.id === id) : -1;
    return i < 0 ? ELIGIBILITY_RULES.length : i;
};

export interface ExclusionEntry { names: string[]; ruleId?: string; ruleName?: string; reason: string; why: string[] }
export interface ExclusionGroup { key: string; label: string; entries: ExclusionEntry[] }

/** Group withheld drugs by class family, and merge drugs that share an identical rule and reasons into one entry. */
export function groupExclusions(excluded: ExcludedMedication[]): ExclusionGroup[] {
    const groups = new Map<string, { label: string; order: number; entries: Map<string, ExclusionEntry> }>();
    for (const med of excluded) {
        const pillar = pillarOfDrugClass(med.drug_class);
        const key = pillar ?? med.drug_class;
        const order = pillar ? FAMILY_ORDER.indexOf(pillar) : FAMILY_ORDER.length + ruleOrder(med.rule_id);
        if (!groups.has(key)) groups.set(key, { label: pillar ? FAMILY_LABEL[pillar] : med.drug_class, order, entries: new Map() });
        const g = groups.get(key)!;
        const why = med.why ?? [];
        const sig = [med.rule_id ?? '', med.reason, ...why].join('␟');
        const existing = g.entries.get(sig);
        if (existing) existing.names.push(med.name);
        else g.entries.set(sig, { names: [med.name], ruleId: med.rule_id, ruleName: med.rule_name, reason: med.reason, why });
    }
    return [...groups.entries()]
        .sort((a, b) => a[1].order - b[1].order)
        .map(([key, g]) => ({
            key,
            label: g.label,
            entries: [...g.entries.values()].sort((a, b) => ruleOrder(a.ruleId) - ruleOrder(b.ruleId)),
        }));
}

/** The exclusion group (if any) that explains a gap row. */
export function exclusionsForGap(gap: string, groups: ExclusionGroup[]): ExclusionGroup | undefined {
    const pillar = pillarOfGap(gap);
    return pillar ? groups.find(g => g.key === pillar) : undefined;
}

/** Does this option start or switch to a drug in the gap's family? Returns the drug names. */
export function startedByOption(gap: string, option?: ScoredRegimen): string[] {
    const pillar = pillarOfGap(gap);
    if (!pillar || !option?.modification_set) return [];
    return option.modification_set.modifications
        .filter(m => (m.action === 'add' || m.action === 'swap') && m.target && pillarOfDrugClass(m.target.med.drug_class) === pillar)
        .map(m => m.target!.med.name);
}

/** Kept for existing callers: the same test applied to option 1. */
export const startedByTopOption = startedByOption;

export const entryReasonText = (e: ExclusionEntry): string =>
    plainText(e.why.length > 0 ? e.why.join('; ') : (e.reason.trim().toLowerCase() === (e.ruleName ?? '').trim().toLowerCase() ? '' : e.reason));

/** What "no option" means on screen and in the note: the state that left nothing to propose (generated by the engine; the fallback never names an option). */
export function stopStateText(alerts: string[], readiness?: DecisionReadiness, whyFirst?: WhyFirst): string {
    if (whyFirst?.stop) return whyFirst.stop;
    if (readiness?.mode === 'limited_review') return 'This tool proposes no medication option today because information needed for a medication decision is missing, so only a focused review is shown.';
    const heads = partitionAlerts(alerts).urgent.map(a => a.head).filter((h): h is string => !!h);
    return heads.length > 0
        ? `This tool proposes no medication option today. Safety alerts are in force (${[...new Set(heads)].map(h => plainText(h.charAt(0) + h.slice(1).toLowerCase())).join('; ')}). The alerts may ask you to withhold, reduce or review a drug.`
        : 'This tool proposes no medication option today: no change to the regimen passed the tool\'s rules for this patient. The alerts may ask you to withhold, reduce or review a drug.';
}

/** A short plain description of what an option does, for places where the option is named. */
export function describeOption(r: ScoredRegimen | undefined): string {
    if (!r) return 'not available';
    const ch = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
    return ch.length === 0 ? 'no medication change' : ch.map(m => clinicalSentence(m.summary).split(' (')[0]).join('; ');
}

// ---- Chart note ---------------------------------------------------------------------------------

export interface ChartInput {
    results: ScoredRegimen[];
    clinicalAlerts: string[];
    gdmtGaps: string[];
    eligibleAdjuncts: string[];
    missingDataNotices: string[];
    followUpCalendar: MonitoringPlanItem[];
    monitoringPlan: MonitoringPlanItem[];
    excludedMedications: ExcludedMedication[];
    decisionReadiness?: DecisionReadiness;
    whyFirst?: WhyFirst;
    /** The sentence naming the ejection-fraction evidence used, and the scope line when the question was not answered (both from the engine). */
    evidenceBandText?: string;
    scopeNote?: string;
}

const bullets = (title: string, items: string[]): string[] => items.length === 0 ? [] : ['', `${title}:`, ...items.map(i => `  - ${i}`)];

/** An invalid, negative, fractional or out-of-range choice means option 1. */
export const normalizeOptionIndex = (count: number, index?: number): number =>
    typeof index === 'number' && Number.isInteger(index) && index > 0 && index < count ? index : 0;

export interface OptionPlan { option: ScoredRegimen | undefined; number: number; monitoring: MonitoringPlanItem[]; followUp: MonitoringPlanItem[] }

/**
 * The monitoring and follow-up that belong with the chosen option. Option 1 uses the engine's top-level lists unchanged.
 * Any other option uses its own monitoring plan, the deferred-therapy items (which describe the whole result set) and a
 * follow-up calendar built from its own changes. The screen and the note both call this so they cannot disagree.
 */
export function planForOption(c: ChartInput, selectedIndex = 0): OptionPlan {
    const index = normalizeOptionIndex(c.results.length, selectedIndex);
    const option = c.results[index];
    if (index === 0) return { option, number: 1, monitoring: c.monitoringPlan, followUp: c.followUpCalendar };
    return {
        option, number: index + 1,
        monitoring: [...(option.monitoring_plan ?? []), ...c.monitoringPlan.filter(m => /^Repeat potassium; /.test(m.test))],
        followUp: buildFollowUpCalendar(option.modification_set),
    };
}

const SCALE_NOTE = 'Scales: health status is the KCCQ summary score (0 to 100; 5 points is a small change, 20 a large one); side-effect burden is the sum of one-year excess harm rates (percent of patients) times a severity weight, so more points means more measured harm.';

/** Plain-text plan to paste into a note. Built from the same structured output as the screen; never includes the internal score. */
export function buildChartSummary(c: ChartInput, selectedIndex = 0): string {
    const plan = planForOption(c, selectedIndex);
    const k = plan.number;
    const { urgent, advisory } = partitionAlerts(c.clinicalAlerts);
    const lines: string[] = ['HEART FAILURE MEDICATION REVIEW: DRAFT (research decision support; clinician review required)'];
    lines.push(...bullets('SAFETY ALERTS', urgent.map(a => a.raw)));
    if (c.decisionReadiness) {
        lines.push('', `ASSESSMENT SCOPE: ${c.results.length === 0 ? (c.decisionReadiness.mode === 'limited_review' ? 'Focused review only; no medication option is proposed' : 'No medication option is proposed') : c.decisionReadiness.mode === 'limited_review' ? 'Focused review only; complete medication options withheld' : 'Medication options with recorded prerequisites'}`);
        lines.push(...bullets('WHAT CAN BE REVIEWED', c.decisionReadiness.available));
        lines.push(...bullets('DECISIONS WAITING FOR INFORMATION', c.decisionReadiness.deferred));
        lines.push('  Not recorded does not mean normal or absent. Retained medications are not certified safe by this assessment.');
    }

    const top = plan.option;
    const why = c.whyFirst?.options[k - 1];
    if (top) {
        const ctx = getTargetDosePatientContext(top);
        const n = c.results.length;
        lines.push('', !Number.isFinite(top.cost) ? `PRICING UNAVAILABLE, DISCUSSION ONLY (option ${k} of ${n}; verify costs before choosing):` : isOverBudgetFallback(top)
            ? `REGIMEN FOR DISCUSSION ONLY (option ${k} of ${n}; over the stated budget, so the patient cannot carry it out as entered):`
            : k === 1 ? `TOP-ORDERED REGIMEN (option 1 of ${n}, the option the tool listed first):`
            : `CLINICIAN-SELECTED ALTERNATIVE (option ${k} of ${n}; the tool listed option 1 first):`);
        if (top.regimen.length === 0) lines.push('  - No heart-failure medication is included in this option; review any changes below.');
        top.regimen.forEach(r => {
            // A loop or thiazide-type diuretic has no target dose (titrated to the volume response), so it never carries the tag (S13).
            const target = isTargetDoseForPatient(r, ctx) && !isDiureticClass(r.med.drug_class) ? ' (target dose)' : '';
            lines.push(`  - ${r.med.name} ${doseLabel(r)}${target}`);
        });
        const changes = (top.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
        lines.push(...(changes.length > 0
            ? bullets(`PROPOSED CHANGES IN OPTION ${k}`, changes.map(m => clinicalSentence(m.summary)))
            : ['', `PROPOSED CHANGES IN OPTION ${k}:`, `  - ${NO_CHANGE_TEXT}`]));
        if (why && why.lines.length > 0) {
            // Every other option named in a reason is described, so the note stands alone when pasted into a chart.
            const named = [...new Set(why.lines.flatMap(l => [...l.text.matchAll(/\boption (\d)\b/gi)].map(m => Number(m[1]))))].filter(j => j !== k && c.results[j - 1]);
            lines.push(...bullets(k === 1 ? 'WHY THIS OPTION IS LISTED FIRST' : `WHY THIS OPTION IS LISTED AT POSITION ${k}`, [
                // The first line is about the selected option itself; the glosses of the other options named in a reason follow it, then the remaining reasons (W6e).
                why.lines[0].text,
                ...named.map(j => `Option ${j} means: ${describeOption(c.results[j - 1])}.`),
                ...why.lines.slice(1).map(l => l.text),
            ]));
        } else if (k > 1) {
            lines.push(...bullets(`DIFFERENCES FROM THE OPTION LISTED FIRST (${describeOption(c.results[0])})`, optionDifferences(top, c.results[0])));
        }
        if (k > 1 && why && why.lines.length > 0) lines.push(...bullets(`DRUG DIFFERENCES FROM THE OPTION LISTED FIRST (${describeOption(c.results[0])})`, optionDifferences(top, c.results[0])));
        { const effect = expectedEffectSentence(top); if (effect) lines.push(...bullets('EXPECTED EFFECT VERSUS CURRENT REGIMEN', [effect, ...(effect.includes('points') ? [SCALE_NOTE] : [])])); }
        lines.push(...bullets('TREATMENT CONSIDERATIONS', (top.treatment_assessment?.considerations ?? []).map(x=>`${x.label}: ${x.detail}`)));
        lines.push(...bullets('ASSESSMENT LIMITS', top.treatment_assessment?.limitations ?? ['Expected effects are population averages from randomized trials, not a prediction for this patient; reassess actual response after implementation.']));
        const { safety, notes } = partitionWarnings(top.warnings);
        lines.push(...bullets('SAFETY WARNINGS FOR THIS OPTION', safety.map(clinicalSentence)));
        lines.push(...bullets('PRESCRIBING NOTES', notes.map(n => stripDrugNotePrefix(n, top.regimen))));
        if (top.shown_because) lines.push(...bullets('WHY THIS OPTION IS SHOWN', [top.shown_because]));
        if (c.evidenceBandText) lines.push(...bullets('TRIAL EVIDENCE USED', [c.evidenceBandText]));
    } else {
        lines.push('', stopStateText(c.clinicalAlerts, c.decisionReadiness, c.whyFirst));
    }

    if (c.scopeNote) lines.push(...bullets('SCOPE', [c.scopeNote]));

    // Withheld drugs that explain an indicated-but-missing class, with the specific reasons.
    const groups = groupExclusions(c.excludedMedications);
    const gapLines: string[] = [];
    for (const gap of c.gdmtGaps) {
        const started = startedByOption(gap, top);
        const g = exclusionsForGap(gap, groups);
        const w = c.whyFirst?.gaps.find(x => x.gap === gap);
        const parts: string[] = [];
        if (started.length > 0) parts.push(`started in this option (${started.join(', ')})`);
        else if (!top) parts.push('not started: no medication is started or raised on this screen');
        else if (w && w.reasons[k - 1]) parts.push(`not started in this option. ${w.reasons[k - 1]}`);
        else parts.push('not started in this option');
        if (w && w.eligible.length > 0 && started.length === 0 && top) parts.push(`could be started: ${w.eligible.join(', ')}`);
        g?.entries.forEach(e => parts.push(`${e.names.join(', ')} withheld${e.ruleName ? ` (${e.ruleName})` : ''}${entryReasonText(e) ? `: ${entryReasonText(e)}` : ''}`));
        gapLines.push(`${gap}: ${parts.join(' | ')}`);
    }
    lines.push(...bullets('INDICATED GDMT CURRENTLY MISSING', gapLines));
    lines.push(...bullets('ELIGIBLE ADJUNCTS TO CONSIDER', c.eligibleAdjuncts));
    lines.push(...bullets('OTHER CARE PROMPTS', advisory.map(a => a.raw)));
    lines.push(...bullets('DATA NOT ENTERED (conclusions withheld)', c.missingDataNotices));
    lines.push(...bullets('MONITORING', plan.monitoring.map(i => `${i.test} (${i.timing}): ${i.details}`)));
    lines.push(...bullets('FOLLOW-UP REVIEW PROMPTS (individualize timing)', plan.followUp.map(i => `${i.timing}: ${i.test}. ${i.details}`)));
    // Every other option the note mentions is described, wherever the mention is (reasons for the class rows name options too), so the note stands alone.
    const body = lines.join('\n');
    const described = new Set([...body.matchAll(/Option (\d) means:/g)].map(m => Number(m[1])));
    const mentioned = [...new Set([...body.matchAll(/\boption (\d)\b(?! of)/gi)].map(m => Number(m[1])))].filter(j => j !== k && !described.has(j) && c.results[j - 1]);
    if (mentioned.length > 0) lines.push(...bullets('OTHER OPTIONS NAMED ABOVE', mentioned.map(j => `Option ${j} means: ${describeOption(c.results[j - 1])}.`)));
    return plainText(lines.join('\n'));
}
