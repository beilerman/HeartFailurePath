import type { ExcludedMedication, MonitoringPlanItem, ScoredRegimen, RankingInfo } from '../types';
import { RANKING_MODE_META } from './rankingModeMeta';
import { PILLAR_LABELS } from '../services/engine/explain';
import { ELIGIBILITY_RULES } from '../services/engine/eligibility';
import { pillarKeyOf, getTargetDosePatientContext, isTargetDoseForPatient } from '../services/simulationService';
import type { PillarKey } from '../services/simulationService';

// Display-side organisation of the engine's output. Nothing here changes what the engine says: it
// only decides where each existing string is shown. Unknown kinds always fall on the safety side.

// ---- Alerts -------------------------------------------------------------------------------------

/** Alert headers that are care-gap prompts rather than safety stops. Everything else is treated as urgent. */
const ADVISORY_ALERT_HEADS: readonly string[] = [
    'DEVICE THERAPY SCREENING', 'CARDIAC REHABILITATION', 'VERICIGUAT ELIGIBILITY WARNING', 'DATA NOTE',
];

export interface SplitAlert { head: string | null; body: string; raw: string }

export function splitAlert(alert: string): SplitAlert {
    // Alerts conventionally read 'HEADER: body'. A colon-less alert renders as a single line.
    const sep = alert.indexOf(': ');
    return { head: sep > 0 ? alert.slice(0, sep) : null, body: sep > 0 ? alert.slice(sep + 2) : alert, raw: alert };
}

export function partitionAlerts(alerts: string[]): { urgent: SplitAlert[]; advisory: SplitAlert[] } {
    const urgent: SplitAlert[] = [];
    const advisory: SplitAlert[] = [];
    for (const a of alerts) {
        const s = splitAlert(a);
        (s.head && ADVISORY_ALERT_HEADS.includes(s.head) ? advisory : urgent).push(s);
    }
    return { urgent, advisory };
}

/** "DEVICE THERAPY SCREENING" -> "Device therapy screening" (headers are shouted in the engine text). */
export const sentenceCase = (t: string): string => t.charAt(0) + t.slice(1).toLowerCase();

// ---- Per-regimen warnings -----------------------------------------------------------------------

const DRUG_NOTE = /^Drug note\b[:\s]*/i;

/** Engine prefix of the over-budget fallback warning (selection.ts). Display only: it must keep matching that text. */
export const BUDGET_EXCEEDED_PREFIX = 'BUDGET EXCEEDED';

/** True for a regimen the engine shows only for discussion because nothing fit the stated budget. */
export const isOverBudgetFallback = (r: Pick<ScoredRegimen, 'warnings'> | undefined): boolean =>
    !!r && r.warnings.some(w => w.startsWith(BUDGET_EXCEEDED_PREFIX));

/** Short statement of the active ranking mode for the results screen and the chart note. Null in Balanced mode. */
export function rankingModeLines(ranking: RankingInfo | undefined): string[] {
    if (!ranking || ranking.mode !== 'foundational_first') return [];
    const lines = [`Ranking approach: ${RANKING_MODE_META.foundational_first.label}.`];
    if (!ranking.applied) {
        if (ranking.reason_not_applied) lines.push(ranking.reason_not_applied);
    } else if (ranking.balanced_lead_differs && ranking.balanced_lead_summary) {
        lines.push(`Under Balanced the lead option would be: ${ranking.balanced_lead_summary}`);
    }
    return lines;
}

/** Prescribing notes are the engine's non-penalized "Drug note" strings; every other warning stays prominent. */
export function partitionWarnings(warnings: string[]): { safety: string[]; notes: string[] } {
    const safety: string[] = [];
    const notes: string[] = [];
    for (const w of warnings) (DRUG_NOTE.test(w) ? notes : safety).push(w);
    return { safety, notes };
}

export const stripDrugNotePrefix = (w: string): string => {
    const t = w.replace(DRUG_NOTE, '');
    return t.charAt(0).toUpperCase() + t.slice(1);
};

// ---- Gaps and exclusions ------------------------------------------------------------------------

const PILLAR_BY_LABEL = new Map<string, PillarKey>([
    [PILLAR_LABELS['RAAS Inhibitor'], 'RAAS'],
    [PILLAR_LABELS['Beta Blocker'], 'BB'],
    [PILLAR_LABELS['MRA'], 'MRA'],
    [PILLAR_LABELS['SGLT2i'], 'SGLT2i'],
]);

export const pillarOfGap = (gap: string): PillarKey | null => PILLAR_BY_LABEL.get(gap) ?? null;

// A drug belongs to a pillar's family if it counts for it in either phenotype (so finerenone sits with the MRAs).
export const pillarOfDrugClass = (drugClass: string): PillarKey | null =>
    pillarKeyOf(drugClass, 'HFrEF') ?? pillarKeyOf(drugClass, 'HFpEF');

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

/** Does option 1 start or switch to a drug in this gap's family? Returns the drug names. */
export function startedByTopOption(gap: string, top?: ScoredRegimen): string[] {
    const pillar = pillarOfGap(gap);
    if (!pillar || !top?.modification_set) return [];
    return top.modification_set.modifications
        .filter(m => (m.action === 'add' || m.action === 'swap') && m.target && pillarOfDrugClass(m.target.med.drug_class) === pillar)
        .map(m => m.target!.med.name);
}

export const entryReasonText = (e: ExclusionEntry): string =>
    e.why.length > 0 ? e.why.join('; ') : (e.reason.trim().toLowerCase() === (e.ruleName ?? '').trim().toLowerCase() ? '' : e.reason);

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
    ranking?: RankingInfo;
}

const bullets = (title: string, items: string[]): string[] => items.length === 0 ? [] : ['', `${title}:`, ...items.map(i => `  - ${i}`)];

/** Plain-text plan to paste into a note. Built from the same structured output as the screen; never includes the internal score. */
export function buildChartSummary(c: ChartInput): string {
    const { urgent, advisory } = partitionAlerts(c.clinicalAlerts);
    const lines: string[] = ['HEART FAILURE GDMT PLAN (decision-support output; verify before acting)'];
    lines.push(...bullets('SAFETY ALERTS', urgent.map(a => a.raw)));
    const modeLines = rankingModeLines(c.ranking);
    if (modeLines.length > 0) lines.push('', ...modeLines);

    const top = c.results[0];
    if (top) {
        const ctx = getTargetDosePatientContext(top);
        lines.push('', isOverBudgetFallback(top)
            ? `REGIMEN FOR DISCUSSION ONLY (option 1 of ${c.results.length}; over the stated budget, so the patient cannot carry it out as entered; the other options are on screen):`
            : `RECOMMENDED REGIMEN (option 1 of ${c.results.length}; the other options are on screen):`);
        top.regimen.forEach(r => {
            const target = isTargetDoseForPatient(r, ctx) ? ' (target dose)' : '';
            lines.push(`  - ${r.med.name} ${r.dose.strength}${r.dose.unit} ${r.selected_frequency}${target}`);
        });
        const changes = (top.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
        lines.push(...(changes.length > 0
            ? bullets('CHANGES THIS VISIT', changes.map(m => m.summary))
            : ['', 'CHANGES THIS VISIT:', '  - None: continue the current regimen.']));
        const { safety, notes } = partitionWarnings(top.warnings);
        lines.push(...bullets('SAFETY WARNINGS FOR THIS OPTION', safety));
        lines.push(...bullets('PRESCRIBING NOTES', notes.map(stripDrugNotePrefix)));
    } else {
        lines.push('', 'No regimen was generated (see safety alerts).');
    }

    // Withheld drugs that explain an indicated-but-missing class, with the specific reasons.
    const groups = groupExclusions(c.excludedMedications);
    const gapLines: string[] = [];
    for (const gap of c.gdmtGaps) {
        const started = startedByTopOption(gap, top);
        const g = exclusionsForGap(gap, groups);
        const parts: string[] = [];
        if (started.length > 0) parts.push(`started in option 1 (${started.join(', ')})`);
        g?.entries.forEach(e => parts.push(`${e.names.join(', ')} withheld${e.ruleName ? ` (${e.ruleName})` : ''}${entryReasonText(e) ? `: ${entryReasonText(e)}` : ''}`));
        gapLines.push(`${gap}${parts.length > 0 ? ` - ${parts.join(' | ')}` : ''}`);
    }
    lines.push(...bullets('INDICATED GDMT CURRENTLY MISSING', gapLines));
    lines.push(...bullets('ELIGIBLE ADJUNCTS TO CONSIDER', c.eligibleAdjuncts));
    lines.push(...bullets('OTHER CARE PROMPTS', advisory.map(a => a.raw)));
    lines.push(...bullets('DATA NOT ENTERED (conclusions withheld)', c.missingDataNotices));
    lines.push(...bullets('MONITORING', c.monitoringPlan.map(i => `${i.test} (${i.timing}): ${i.details}`)));
    lines.push(...bullets('FOLLOW-UP (STRONG-HF)', c.followUpCalendar.map(i => `${i.timing}: ${i.test}. ${i.details}`)));
    return lines.join('\n');
}
