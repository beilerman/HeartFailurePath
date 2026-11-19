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
import { budgetKnown } from './decisionReadiness';

/**
 * Hard display floors on the PROJECTED state: a regimen that projects past any of these is never
 * shown, however well it scores. The graduated ranking penalties (SCORE_ADJUSTMENTS) begin earlier.
 */
export const DISPLAY_FLOORS = {
    minProjectedSbp: 85,         // projected SBP < 85 mmHg is hidden
    maxProjectedPotassium: 6.0,  // projected K+ > 6.0 mEq/L is hidden
    minProjectedPulse: 45,       // projected HR < 45 bpm is hidden
    minProjectedPotassium: 3.0,  // projected K+ < 3.0 mEq/L is hidden when the regimen lowers it (usable since 2026-11-12: the projection no longer overstates a fall)
} as const;

/**
 * Which display floors a regimen breaks. The blood-pressure and heart-rate floors count only when the regimen moves that value the WRONG way from the
 * entered baseline: a patient who arrives with a heart rate of 43 is not denied a beta-blocker dose reduction, an SGLT2 inhibitor or a diuretic because the
 * unchanged pulse is already under the floor (before 2026-11-12 these floors were absolute and such a patient got an empty page with the wrong reason).
 * The potassium floor stays ABSOLUTE: at a baseline of 6.0-6.4 only an option that brings projected potassium to 6.0 or lower is shown.
 */
export function brokenDisplayFloors(r: ScoredRegimen, baseline: Patient): string[] {
    const p = r.risk_screen ? { ...r.projected_patient,
        sbp: Math.min(r.projected_patient.sbp, r.risk_screen.sbp),
        pulse: Math.min(r.projected_patient.pulse, r.risk_screen.pulse),
        potassium: Math.max(r.projected_patient.potassium, r.risk_screen.potassium_high),
    } : r.projected_patient, out: string[] = [];
    const known = (v: number | undefined) => v !== undefined && !Number.isNaN(v) && v > 0;
    if (p.sbp < DISPLAY_FLOORS.minProjectedSbp && p.sbp < baseline.sbp) out.push('severe hypotension (projected systolic BP below 85)');
    const changes = r.modification_set?.modifications.filter(m => m.action !== 'keep') ?? [];
    const removesPotassiumRaiser = changes.some(m => ['remove','titrate_down'].includes(m.action)
        && m.source && ['ACEi','ARB','ARNI','MRA','nsMRA'].includes(m.source.med.drug_class));
    const correctiveOnly = removesPotassiumRaiser && changes.every(m => ['remove','titrate_down'].includes(m.action));
    if (p.potassium > DISPLAY_FLOORS.maxProjectedPotassium && !correctiveOnly) out.push('recorded severe hyperkalemia (potassium above 6.0; correction not established)');
    if (known(baseline.potassium) && (r.risk_screen?.potassium_low ?? p.potassium) < DISPLAY_FLOORS.minProjectedPotassium && (r.risk_screen?.potassium_low ?? p.potassium) < baseline.potassium) out.push('marked hypokalemia (projected potassium below 3.0)');
    if (known(baseline.pulse) && p.pulse < DISPLAY_FLOORS.minProjectedPulse && p.pulse < baseline.pulse) out.push('severe bradycardia (projected heart rate below 45)');
    return out;
}

// Ranking rule (stated to the clinician in the FAQ and score ledger):
//   1. Higher displayed score first.
//   2. Same displayed score (the same whole number): higher unrounded score.
//   3. Still tied: the cheaper regimen.
//   (Therapy completeness is a reference-only domain with weight 0 and is not a tie-break step; see byScoreThenCost below.)
//   4. Still tied: the option with fewer changes to the current regimen.
//   5. Still tied: alphabetical by regimen, so the answer never depends on the order the current drugs were typed in.
// Scores are compared to 9 decimals: the same regimen summed in a different drug order differs in the last floating-point bits.
const stable = (x: number | undefined) => Math.round((x ?? 0) * 1e9) / 1e9;
const regimenKey = (r: ScoredRegimen): string => r.regimen.map(x => `${x.med.name} ${x.dose.strength} ${x.selected_frequency}`).sort().join(' + ');
/** Number of changes to the current regimen. Between otherwise equal options the one that changes less comes first: an elective dose reduction with no modeled
 * benefit tied with "mandatory changes only" and won alphabetically, so the tool lowered a dose it had started on the previous run (review 2026-11-12). */
const changeCount = (r: ScoredRegimen): number => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').length;
// Order: displayed score, raw score, cost, change count, regimen key. GDMT completeness is NOT a step (owner ruling 2026-11-15: guideline pillar counts leave the ranking;
// it was a tie-break against 'softness' only while displayed scores clamped at 100).
export const byScoreThenCost = (a: ScoredRegimen, b: ScoredRegimen) =>
    b.overall_score - a.overall_score ||
    stable(b.raw_score) - stable(a.raw_score) ||
    a.cost - b.cost ||
    changeCount(a) - changeCount(b) ||
    (regimenKey(a) < regimenKey(b) ? -1 : regimenKey(a) > regimenKey(b) ? 1 : 0);

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
    { code: SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.code, harmful: (r, b) => (r.risk_screen?.sbp ?? r.projected_patient.sbp) < b.sbp },
    { code: SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.code, harmful: (r, b) => (r.risk_screen?.sbp ?? r.projected_patient.sbp) < b.sbp },
    { code: SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.code, harmful: (r, b) => (r.risk_screen?.pulse ?? r.projected_patient.pulse) < b.pulse },
    { code: SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.code, harmful: (r, b) => (r.risk_screen?.potassium_high ?? r.projected_patient.potassium) > b.potassium },
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
): { picks: ScoredRegimen[]; allUnsafe: boolean; unsafeReasons: string[] } {
    // Safety precedes affordability in EVERY path. An unsafe cheap candidate must not suppress
    // the discussion-only fallback for a safe candidate above budget.
    const safeResults = results.filter(r => brokenDisplayFloors(r, patient).length === 0);
    const allUnsafe = results.length > 0 && safeResults.length === 0;
    const unsafeReasons = allUnsafe ? [...new Set(results.flatMap(r => brokenDisplayFloors(r, patient)))] : [];
    if (allUnsafe) return { picks: [], allUnsafe, unsafeReasons };
    results = safeResults;
    const affordableRegimens = results.filter(r => r.cost <= patient.max_affordable_cost);
    let outputRegimens: ScoredRegimen[] = [];
    let extraPool: ScoredRegimen[] = [];
    let displayOrder = cmp;

    if (!budgetKnown(patient) || results.some(r => !Number.isFinite(r.cost))) {
        // An absent budget/price is not zero affordability and not proof of an over-budget regimen.
        // Keep safety filtering and clinical ordering; explicitly withhold affordability conclusions.
        outputRegimens = [...results].sort(cmp).map(r => ({ ...r, warnings: [
            'AFFORDABILITY UNASSESSED: budget or price data are unavailable. Confirm actual coverage and out-of-pocket cost before implementing this option.', ...r.warnings,
        ] }));
    } else if (affordableRegimens.length > 0) {
        outputRegimens = affordableRegimens.sort(cmp);
    } else if (results.length > 0) {
        // Nothing fits the budget. Surface the lowest-cost candidates (closest to affordable).
        // Cost-first preserves cost order; other preferences apply their clinical comparator
        // within this near-affordable pool. Every option remains discussion-only.
        // An option the tool scores 0 (it projects harm) is not offered merely because it is cheap, unless nothing else exists.
        const worthShowing = results.some(r => r.overall_score > 0) ? results.filter(r => r.overall_score > 0) : results;
        const fallbackOrder = patient.care_priority === 'cost_first'
            ? (a: ScoredRegimen, b: ScoredRegimen) => a.cost - b.cost || cmp(a, b) : cmp;
        displayOrder = fallbackOrder;
        const cheapest = [...worthShowing].sort((a, b) => a.cost - b.cost || cmp(a, b)).slice(0, 5).sort(fallbackOrder);
        const budgetMessage = patient.max_affordable_cost <= 0
            ? 'No zero-copay regimen found. Add covered medications or raise budget.'
            : 'Increase budget to find valid options.';
        // Owner decision 2026-11-11: an option the patient cannot afford must not read as an implementable plan.
        const flagOverBudget = (r: ScoredRegimen): ScoredRegimen => ({
            ...r,
            warnings: [`BUDGET EXCEEDED: nothing fits the stated budget. This is one of the lowest-cost options ($${r.cost}), shown for discussion, not as a plan the patient can carry out. ${budgetMessage}`, ...r.warnings]
        });
        outputRegimens = cheapest.map(flagOverBudget);
        // Congestion coverage (below) may need a loop candidate outside the five cheapest: offer the cheapest one, flagged the same way.
        const cheapestSigs = new Set(cheapest);
        extraPool = results.filter(r => !cheapestSigs.has(r)).sort((a, b) => a.cost - b.cost || cmp(a, b)).map(flagOverBudget);
    }

    const topPick = outputRegimens[0];
    if (!topPick) return { picks: [], allUnsafe, unsafeReasons };

    // S2 note: the SBP < 90 hemodynamic-instability gate returns alerts-only near the top of this
    // function (search 'HEMODYNAMIC INSTABILITY') — do not re-add a duplicate check here; a second
    // copy of the same safety gate invites divergent edits.

    const distinctPicks: ScoredRegimen[] = [topPick];

    for (const r of outputRegimens) {
        if (distinctPicks.length >= 3) break;

        const isDistinct = distinctPicks.every(existing => {
            // Equivalent same-family drug choices must not crowd out a different treatment step.
            const family = (m: RegimenMed) => m.med.facts?.pick_distinctness_key === 'ARNI' ? 'ARNI' : m.med.drug_class === 'nsMRA' ? 'nsMRA' : getMedicationClassGroup(m.med.drug_class);
            const strategy = (x: ScoredRegimen) => [
                [...new Set(x.regimen.map(family))].sort().join(','),
                [...new Set((x.modification_set?.modifications ?? []).filter(m => m.action !== 'keep')
                    .map(m => `${m.action}:${family((m.target ?? m.source)!)}`))].sort().join(','),
            ].join('|');
            if (strategy(r) === strategy(existing)) return false;
            const changedSteps = (x: ScoredRegimen) => (x.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => `${m.action}:${family((m.target ?? m.source)!)}`).sort().join(',');
            if (changedSteps(r) !== changedSteps(existing)) return true;
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

    const covered = ensureCongestionCoverage(distinctPicks, [...outputRegimens, ...extraPool], patient);
    // Coverage adds an explicitly explained alternative without displacing the selected lead.
    // The remaining options must still be in the configured order after that insertion.
    return { picks: [covered[0], ...covered.slice(1).sort(displayOrder)], allUnsafe, unsafeReasons };
}

/** True when the regimen raises a standing loop diuretic's dose or starts one (a short-course add-on beside the oral loop is neither). */
const isLoopIncreaseMod = (m: { action: string; target?: RegimenMed }) =>
    !!m.target && m.target.med.drug_class === 'Loop Diuretic' && !drugFacts(m.target.med).short_course_addon && (m.action === 'titrate_up' || m.action === 'add');
export function includesLoopIncrease(r: ScoredRegimen): boolean {
    return (r.modification_set?.modifications ?? []).some(isLoopIncreaseMod);
}

/** True when the regimen adds or raises any diuretic: a loop (including the Furoscix short course) or a thiazide-like drug. */
export function includesDiureticIntensification(r: ScoredRegimen): boolean {
    return (r.modification_set?.modifications ?? []).some(m => !!m.target && (m.action === 'add' || m.action === 'titrate_up') && (m.target.med.drug_class === 'Loop Diuretic' || m.target.med.drug_class === 'Thiazide-like Diuretic'));
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
    if (picks.length === 0 || !isCongestedAboveDryWeight(patient)) return picks;
    const shown = new Set(picks);
    const safe = (r: ScoredRegimen) => !shown.has(r) && isProjectedSafetyClean(r, patient);   // never a candidate that itself causes a severe projected-safety adjustment
    // Stage 1: no displayed loop increase or start -> the BEST-SCORING eligible loop candidate (pool order is the ranking comparator's), not a plain loop step regardless of score.
    // Stage 2 (2026-11-16): when NO loop increase exists at all (the loop is at its cap, as at eGFR 15 on bumetanide) and no displayed option intensifies any diuretic, show the
    // best-scoring other diuretic intensification (Furoscix short course or a thiazide-like add-on).
    let candidate: ScoredRegimen | undefined;
    let what = 'a diuretic increase';
    if (!picks.some(includesLoopIncrease)) {
        candidate = pool.filter(r => safe(r) && includesLoopIncrease(r))[0];
        if (!candidate && !picks.some(includesDiureticIntensification)) { candidate = pool.filter(r => safe(r) && includesDiureticIntensification(r))[0]; what = 'a diuretic intensification (a loop increase is not available)'; }
    }
    if (!candidate) return picks;
    const kg = (patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg).toFixed(1);
    const tagged: ScoredRegimen = { ...candidate, shown_because: `Includes ${what}: the patient is congested (${kg} kg above dry weight; the tool's criterion is more than ${CONGESTION_EXCESS_KG_ABOVE} kg), and no other option raises the loop diuretic.` };
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
    const { picks, allUnsafe, unsafeReasons } = chooseDisplayPicks(results, patient, rankingComparator(mode, patient));
    if (allUnsafe) {
        // Explain a constraint conflict without relaxing either safety rule. A shared removal of a
        // potassium-raising drug can push every option below the low-potassium display floor (review item 5).
        const commonKRemovals = unsafeReasons.some(r => r.includes('hypokalemia'))
            ? (results[0]?.modification_set?.modifications ?? []).filter(m => m.action === 'remove' && m.source
                && ['ACEi','ARB','ARNI','MRA','nsMRA'].includes(m.source.med.drug_class)
                && results.every(r => r.modification_set?.modifications.some(other => other.action === 'remove' && other.source?.med.name === m.source!.med.name)))
                .map(m => m.source!.med.name) : [];
        const conflict = commonKRemovals.length
            ? `All candidates include removal of ${[...new Set(commonKRemovals)].join(', ')}, which contributes to the modeled potassium fall. Review the removal requirement and correct/recheck potassium before choosing a regimen. ` : '';
        clinicalAlerts.push(
            `NO DISPLAY-SAFE REGIMEN: every candidate regimen projected ${unsafeReasons.join(' or ')}. ` +
            conflict +
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
