/**
 * Pipeline stage 7 - choose what the clinician sees: affordability filter (with the over-budget
 * fallback), the ranking comparator, the display-safety floors, and the distinct top-3.
 * Moved verbatim from generateAndScoreModifications.
 */
import { Patient, ScoredRegimen, RegimenMed, RankingMode, RankingInfo } from '../../types';
import { drugFacts } from './drugFacts';
import { getMedicationClassGroup } from './registry';
import { classifyPhenotype } from './domains';
import { SCORE_ADJUSTMENTS } from './scoreModel';
import { formatDose } from './regimenUtils';

/**
 * Hard display floors on the PROJECTED state: a regimen that projects past any of these is never
 * shown, however well it scores. The graduated ranking penalties (SCORE_ADJUSTMENTS) begin earlier.
 */
export const DISPLAY_FLOORS = {
    minProjectedSbp: 85,         // projected SBP < 85 mmHg is hidden
    maxProjectedPotassium: 6.0,  // projected K+ > 6.0 mEq/L is hidden
    minProjectedPulse: 45,       // projected HR < 45 bpm is hidden
} as const;

// Ranking rule (stated to the clinician in the FAQ and score ledger):
//   1. Higher displayed score first.
//   2. Same displayed score (the same whole number): the regimen covering more of the indicated
//      therapy first. A fraction-of-a-point difference must not drop a guideline pillar.
//   3. Still tied: higher unrounded score, then the cheaper regimen.
// Completeness is also one of the eight weighted domains; here it only orders regimens the
// clinician sees as equal.
export const byScoreThenCost = (a: ScoredRegimen, b: ScoredRegimen) =>
    b.overall_score - a.overall_score ||
    (b.gdmt_completeness ?? 0) - (a.gdmt_completeness ?? 0) ||
    (b.raw_score ?? 0) - (a.raw_score ?? 0) ||
    a.cost - b.cost;

// ---------------------------------------------------------------------------------------------------
// Ranking mode (physician-owner decision 2026-11-11). Balanced is the default and is exactly byScoreThenCost.
// "Prioritize foundational therapy" changes ONLY the order of regimens that already passed eligibility, the
// budget filter and the display floors; it never changes a score, an exclusion, an alert or a gap. It is applied
// only to HFrEF and HFimpEF (classifyPhenotype reports both as HFrEF); for HFmrEF/HFpEF it is a no-op because no
// clinical ordering for those phenotypes was specified.
// ---------------------------------------------------------------------------------------------------

/** Missing or unknown values resolve to Balanced (compatibility default). */
export function resolveRankingMode(patient: { ranking_mode?: string }): RankingMode {
    return patient.ranking_mode === 'foundational_first' ? 'foundational_first' : 'balanced';
}

/** Projected-safety adjustment codes that put a regimen in the second ("not clean") group in foundational mode. */
export const PROJECTED_SAFETY_ADJUSTMENT_CODES: ReadonlySet<string> = new Set([
    SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.code,
    SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.code,
    SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95.code,
    SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.code,
    SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.code,
]);

/** True when the regimen's projected state tripped none of the projected-safety adjustments (read from score_breakdown). */
export function isProjectedSafetyClean(r: ScoredRegimen): boolean {
    const bd = r.score_breakdown;
    if (!bd) return true;
    return !bd.adjustments.some(a => PROJECTED_SAFETY_ADJUSTMENT_CODES.has(a.code))
        && !(bd.overrides ?? []).some(o => PROJECTED_SAFETY_ADJUSTMENT_CODES.has(o.code));
}

/** Whether the foundational mode has any effect for this patient (HFrEF / HFimpEF only). */
export function foundationalModeApplies(patient: Patient): boolean {
    return classifyPhenotype(patient) === 'HFrEF';
}

/**
 * Comparator for a mode. Foundational: (a) regimens with no projected-safety adjustment first, (b) higher
 * gdmt_completeness, (c) byScoreThenCost. Balanced (and any non-applicable phenotype) is byScoreThenCost itself.
 */
export function rankingComparator(mode: RankingMode, patient: Patient): (a: ScoredRegimen, b: ScoredRegimen) => number {
    if (mode !== 'foundational_first' || !foundationalModeApplies(patient)) return byScoreThenCost;
    return (a, b) =>
        (Number(isProjectedSafetyClean(b)) - Number(isProjectedSafetyClean(a))) ||
        ((b.gdmt_completeness ?? 0) - (a.gdmt_completeness ?? 0)) ||
        byScoreThenCost(a, b);
}

/**
 * Pure selection: the <= 3 distinct display picks, best first, ordered by `cmp`. `allUnsafe` is true when
 * candidates existed but every one failed the display-safety floors (the caller raises the alert).
 */
export function chooseDisplayPicks(
    results: ScoredRegimen[], patient: Patient, cmp: (a: ScoredRegimen, b: ScoredRegimen) => number,
): { picks: ScoredRegimen[]; allUnsafe: boolean } {
    const affordableRegimens = results.filter(r => r.cost <= patient.max_affordable_cost);
    let outputRegimens: ScoredRegimen[] = [];

    if (affordableRegimens.length > 0) {
        outputRegimens = affordableRegimens.sort(cmp);
    } else if (results.length > 0) {
        // Nothing fits the budget. Surface the lowest-cost candidates (closest to affordable), but
        // order THEM by clinical value so the best-benefit near-affordable option leads — among
        // equal benefit the cheaper wins (byScoreThenCost ends in cost). Pure cost-ascending
        // would lead with a thin monotherapy / symptomatic-only regimen over a higher-benefit
        // sibling at the same price.
        const cheapest = [...results].sort((a, b) => a.cost - b.cost).slice(0, 5).sort(cmp);
        const budgetMessage = patient.max_affordable_cost <= 0
            ? 'No zero-copay regimen found. Add covered medications or raise budget.'
            : 'Increase budget to find valid options.';
        // Owner decision 2026-11-11: an option the patient cannot afford must not read as an implementable plan.
        outputRegimens = cheapest.map(r => ({
            ...r,
            warnings: [`BUDGET EXCEEDED: nothing fits the stated budget. Cheapest option ($${r.cost}) is shown for discussion, not as a plan the patient can carry out. ${budgetMessage}`, ...r.warnings]
        }));
    }

    // Display-safety floors mirror the graduated score penalties: penalties begin at SBP < 95,
    // K+ > 5.5, HR < 50; the more extreme floors below are hard display gates — a projected
    // state past them is never shown, regardless of how well the regimen scores elsewhere.
    const displaySafeRegimens = outputRegimens.filter(r =>
        r.projected_patient.sbp >= DISPLAY_FLOORS.minProjectedSbp && r.projected_patient.potassium <= DISPLAY_FLOORS.maxProjectedPotassium && r.projected_patient.pulse >= DISPLAY_FLOORS.minProjectedPulse
    );
    const allUnsafe = outputRegimens.length > 0 && displaySafeRegimens.length === 0;
    outputRegimens = displaySafeRegimens;

    const topPick = outputRegimens[0];
    if (!topPick) return { picks: [], allUnsafe };

    // S2 note: the SBP < 90 hemodynamic-instability gate returns alerts-only near the top of this
    // function (search 'HEMODYNAMIC INSTABILITY') — do not re-add a duplicate check here; a second
    // copy of the same safety gate invites divergent edits.

    const distinctPicks: ScoredRegimen[] = [topPick];

    for (const r of outputRegimens) {
        if (distinctPicks.length >= 3) break;

        const isDistinct = distinctPicks.every(existing => {
            const costDiff = Math.abs(r.cost - existing.cost);
            const rNames = new Set(r.regimen.map(x => x.med.name));
            const eNames = new Set(existing.regimen.map(x => x.med.name));
            const distinctnessKeys = (reg: RegimenMed[]) => new Set(reg.map(x => drugFacts(x.med).pick_distinctness_key));
            const rKeys = distinctnessKeys(r.regimen);
            const eKeys = distinctnessKeys(existing.regimen);

            const intersection = [...rNames].filter(x => eNames.has(x)).length;
            const union = new Set([...rNames, ...eNames]).size;
            const similarity = intersection / union;

            const hasArniR = rKeys.has('ARNI');
            const hasArniE = eKeys.has('ARNI');

            const isGlp1 = (x: RegimenMed) => getMedicationClassGroup(x.med.drug_class) === 'GLP-1 Therapy';
            const hasGLPR = r.regimen.some(isGlp1);
            const hasGLPE = existing.regimen.some(isGlp1);

            if (hasArniR !== hasArniE) return true;
            if (hasGLPR !== hasGLPE) return true;
            if (costDiff > 30) return true;
            if (similarity < 0.7) return true;

            return false;
        });

        if (isDistinct) {
            distinctPicks.push(r);
        }
    }

    return { picks: distinctPicks, allUnsafe };
}

const regimenSignature = (r: ScoredRegimen | undefined): string =>
    r ? r.regimen.map(x => `${x.med.name} ${formatDose(x)}`).sort().join(' + ') : '';

/** One plain line describing a regimen: drugs and doses, score, completeness and monthly cost. */
function describeLead(r: ScoredRegimen): string {
    const drugs = r.regimen.map(x => `${x.med.name} ${formatDose(x)}`).join(' + ');
    return `${drugs} (score ${r.overall_score}, therapy completeness ${Math.round((r.gdmt_completeness ?? 0) * 100)}%, $${r.cost}/month)`;
}

/**
 * Stage-7 entry point. Selects the display picks under the patient's ranking mode, raises the
 * NO DISPLAY-SAFE alert once, and reports what Balanced would have led with (computed by re-running the
 * pure selection with the Balanced comparator on the same scored results; nothing is pushed twice).
 */
export function selectWithRanking(
    results: ScoredRegimen[], patient: Patient, clinicalAlerts: string[],
): { picks: ScoredRegimen[]; ranking: RankingInfo } {
    const mode = resolveRankingMode(patient);
    const applies = foundationalModeApplies(patient);
    const { picks, allUnsafe } = chooseDisplayPicks(results, patient, rankingComparator(mode, patient));
    if (allUnsafe) {
        clinicalAlerts.push(
            'NO DISPLAY-SAFE REGIMEN: Candidate regimens projected severe hypotension (SBP < 85), severe hyperkalemia (K+ > 6.0), or severe bradycardia (HR < 45). ' +
            'Stabilize and reassess before oral intensification.'
        );
    }
    const ranking: RankingInfo = { mode, applied: mode === 'foundational_first' && applies, balanced_lead_differs: false };
    if (mode === 'foundational_first' && !applies) {
        ranking.reason_not_applied = 'Prioritizing foundational therapy applies to HFrEF and improved-EF (HFimpEF) only; for this phenotype the order is the same as Balanced.';
    }
    if (ranking.applied) {
        const balanced = chooseDisplayPicks(results, patient, byScoreThenCost).picks[0];
        if (balanced && picks[0] && regimenSignature(balanced) !== regimenSignature(picks[0])) {
            ranking.balanced_lead_differs = true;
            ranking.balanced_lead_summary = describeLead(balanced);
        }
    }
    return { picks, ranking };
}

/** Back-compat wrapper: the picks only (raises the NO DISPLAY-SAFE alert). */
export function selectDisplayPicks(results: ScoredRegimen[], patient: Patient, clinicalAlerts: string[]): ScoredRegimen[] {
    return selectWithRanking(results, patient, clinicalAlerts).picks;
}
