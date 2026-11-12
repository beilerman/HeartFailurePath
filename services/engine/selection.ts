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
import { formatDose, isCongestedAboveDryWeight } from './regimenUtils';
import { CONGESTION_EXCESS_KG_ABOVE } from './thresholds';

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
// only to HFrEF (LVEF below 50, improved EF, or a prior LVEF below 50: classifyPhenotype); for HFpEF it is a no-op because no
// clinical ordering for HFpEF was specified.
// ---------------------------------------------------------------------------------------------------

/** Missing or unknown values resolve to Balanced (compatibility default). */
export function resolveRankingMode(patient: { ranking_mode?: string }): RankingMode {
    return patient.ranking_mode === 'foundational_first' ? 'foundational_first' : 'balanced';
}

/**
 * Severe projected-safety adjustment codes that can demote a regimen in foundational mode, each with the parameter it concerns.
 * The mild projected SBP < 95 tier does not demote (it still costs score points, which feeds the final tie-break).
 */
export const SEVERE_PROJECTED_SAFETY: ReadonlyArray<{ code: string; harmful: (r: ScoredRegimen, baseline: Patient) => boolean }> = [
    { code: SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.code, harmful: (r, b) => r.projected_patient.sbp < b.sbp },
    { code: SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.code, harmful: (r, b) => r.projected_patient.sbp < b.sbp },
    { code: SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.code, harmful: (r, b) => r.projected_patient.pulse < b.pulse },
    { code: SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.code, harmful: (r, b) => r.projected_patient.potassium > b.potassium },
];

/**
 * True unless the regimen CAUSES severe projected harm: it trips a severe projected-safety adjustment AND moves that parameter in the
 * harmful direction versus the entered baseline (SBP lower, HR lower, K+ higher). A baseline-hyperkalemic patient whose regimen does
 * not raise K+ is clean. Engine policy (owner decision 2026-11-11: demote only harm the regimen causes).
 */
export function isProjectedSafetyClean(r: ScoredRegimen, baseline: Patient): boolean {
    const bd = r.score_breakdown;
    if (!bd) return true;
    const codes = new Set([...bd.adjustments.map(a => a.code), ...(bd.overrides ?? []).map(o => o.code)]);
    return !SEVERE_PROJECTED_SAFETY.some(x => codes.has(x.code) && x.harmful(r, baseline));
}

/** Whether the foundational mode has any effect for this patient (HFrEF / HFimpEF only). */
export function foundationalModeApplies(patient: Patient): boolean {
    return classifyPhenotype(patient) === 'HFrEF';
}

/**
 * Comparator for a mode. Foundational: (a) regimens that do not cause severe projected harm first, (b) higher
 * foundational_coverage (pillar slots only), (c) byScoreThenCost. Balanced (and any non-applicable phenotype) is byScoreThenCost itself.
 */
export function rankingComparator(mode: RankingMode, patient: Patient): (a: ScoredRegimen, b: ScoredRegimen) => number {
    if (mode !== 'foundational_first' || !foundationalModeApplies(patient)) return byScoreThenCost;
    return (a, b) =>
        (Number(isProjectedSafetyClean(b, patient)) - Number(isProjectedSafetyClean(a, patient))) ||
        ((b.foundational_coverage ?? 0) - (a.foundational_coverage ?? 0)) ||
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
    let extraPool: ScoredRegimen[] = [];

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
        const flagOverBudget = (r: ScoredRegimen): ScoredRegimen => ({
            ...r,
            warnings: [`BUDGET EXCEEDED: nothing fits the stated budget. Cheapest option ($${r.cost}) is shown for discussion, not as a plan the patient can carry out. ${budgetMessage}`, ...r.warnings]
        });
        outputRegimens = cheapest.map(flagOverBudget);
        // Congestion coverage (below) may need a loop candidate outside the five cheapest: offer the cheapest one, flagged the same way.
        const cheapestSigs = new Set(cheapest);
        extraPool = results.filter(r => !cheapestSigs.has(r)).sort((a, b) => a.cost - b.cost || cmp(a, b)).map(flagOverBudget);
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
            // Same drugs, different drug being dose-changed (titrate carvedilol vs titrate spironolactone): two different next steps, not one pick twice.
            // Only when both picks consist solely of up-titrations of disjoint drug sets, so dose variants of the SAME change still collapse.
            if (similarity === 1) {
                // Up-titrations only: a dose REDUCTION or a swap is never presented as an alternative next step by this rule.
                const upChanged = (x: ScoredRegimen) => {
                    const mods = (x.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
                    return mods.length > 0 && mods.every(m => m.action === 'titrate_up') ? new Set(mods.map(m => m.target!.med.name)) : undefined;
                };
                const cr = upChanged(r), ce = upChanged(existing);
                if (cr && ce && [...cr].every(n => !ce.has(n))) return true;
            }

            return false;
        });

        if (isDistinct) {
            distinctPicks.push(r);
        }
    }

    const displaySafe = (r: ScoredRegimen) =>
        r.projected_patient.sbp >= DISPLAY_FLOORS.minProjectedSbp && r.projected_patient.potassium <= DISPLAY_FLOORS.maxProjectedPotassium && r.projected_patient.pulse >= DISPLAY_FLOORS.minProjectedPulse;
    return { picks: ensureCongestionCoverage(distinctPicks, [...outputRegimens, ...extraPool.filter(displaySafe)], patient), allUnsafe };
}

/** True when the regimen raises a standing loop diuretic's dose or starts one (a short-course add-on beside the oral loop is neither). */
const isLoopIncreaseMod = (m: { action: string; target?: RegimenMed }) =>
    !!m.target && m.target.med.drug_class === 'Loop Diuretic' && !drugFacts(m.target.med).short_course_addon && (m.action === 'titrate_up' || m.action === 'add');
export function includesLoopIncrease(r: ScoredRegimen): boolean {
    return (r.modification_set?.modifications ?? []).some(isLoopIncreaseMod);
}

/** True when the loop increase/start is the regimen's ONLY change, apart from forced safety changes (a removal or a dose reduction). */
export function isPlainLoopStep(r: ScoredRegimen): boolean {
    const changes = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
    return changes.some(isLoopIncreaseMod) && changes.every(m => isLoopIncreaseMod(m) || m.action === 'remove' || m.action === 'titrate_down');
}

/**
 * Congestion coverage (named selection step, runs after distinct-pick selection; pure, changes no score). When the patient meets the engine's congestion criterion
 * (more than CONGESTION_EXCESS_KG_ABOVE kg above dry weight, `isCongestedAboveDryWeight`) and no displayed option raises or starts a loop diuretic, show the
 * best-ranked candidate that does (preferring one whose only change is the loop step, plus forced removals/reductions, and never one that itself causes severe projected harm): it replaces the LAST option when three are shown, else it is appended. Option 1 is never displaced. `pool` is the ranked,
 * display-safe, budget-filtered candidate list (the over-budget fallback list plus the cheapest loop candidates beyond it), so the floors and the budget rule still hold.
 * A loop candidate exists only if the engine's own hold rules (volume depletion, loop at its maximum daily dose, hypotension) allow the increase.
 * The shown option carries `shown_because` (explanation only).
 */
export function ensureCongestionCoverage(picks: ScoredRegimen[], pool: ScoredRegimen[], patient: Patient): ScoredRegimen[] {
    if (picks.length === 0 || !isCongestedAboveDryWeight(patient) || picks.some(includesLoopIncrease)) return picks;
    const shown = new Set(picks);
    // Preference: (i) the best-ranked candidate whose only change is the loop step (plus forced removals/reductions), else (ii) the best-ranked candidate with a loop step.
    // Never a candidate that itself causes a severe projected-safety adjustment (isProjectedSafetyClean against the entered baseline).
    const eligible = pool.filter(r => !shown.has(r) && includesLoopIncrease(r) && isProjectedSafetyClean(r, patient));
    const candidate = eligible.find(isPlainLoopStep) ?? eligible[0];
    if (!candidate) return picks;
    const kg = (patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg).toFixed(1);
    const tagged: ScoredRegimen = { ...candidate, shown_because: `Includes a diuretic increase: the patient is congested (${kg} kg above dry weight; the tool's criterion is more than ${CONGESTION_EXCESS_KG_ABOVE} kg), and no other option raises the loop diuretic.` };
    return picks.length >= 3 ? [...picks.slice(0, picks.length - 1), tagged] : [...picks, tagged];
}

const regimenSignature = (r: ScoredRegimen | undefined): string =>
    r ? r.regimen.map(x => `${x.med.name} ${formatDose(x)}`).sort().join(' + ') : '';

/** One plain line describing a regimen: drugs and doses, score, completeness and monthly cost. */
function describeLead(r: ScoredRegimen): string {
    const drugs = r.regimen.map(x => `${x.med.name} ${formatDose(x)}`).join(' + ');
    return `${drugs} (score ${r.overall_score}, foundational coverage ${Math.round(r.foundational_coverage ?? 0)}%, $${r.cost}/month)`;
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
        ranking.reason_not_applied = 'Prioritizing foundational therapy applies to reduced EF (LVEF below 50, improved EF, or a prior LVEF below 50) only; for HFpEF the order is the same as Balanced.';
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
