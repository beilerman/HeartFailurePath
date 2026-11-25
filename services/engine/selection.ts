/**
 * Pipeline stage 7 - choose what the clinician sees: affordability filter (with the over-budget
 * fallback), the ranking comparator, the display-safety floors, and the distinct top-3.
 * Moved verbatim from generateAndScoreModifications.
 */
import { Patient, ScoredRegimen, RegimenMed } from '../../types';
import { drugFacts } from './drugFacts';
import { getMedicationClassGroup } from './registry';
import { SCORE_ADJUSTMENTS } from './scoreModel';
import { isCongestedAboveDryWeight, hasCongestion, loopDoseEffect } from './regimenUtils';
import { CONGESTION_EXCESS_KG_ABOVE, TOO_CLOSE_TO_SEPARATE_POINTS } from './thresholds';
import { budgetKnown } from './decisionReadiness';
import { weightAboveDryKg, kgText } from '../clinicalPredicates';

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
/** Changes the clinician would be choosing: the ones the safety rules do not require. A plan with none of them is "no change" plus the required clean-up. */
const discretionaryCount = (r: ScoredRegimen): number => (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep' && !m.mandatory).length;
/**
 * The plan every other option is held against (S10): "no change" when it is a candidate; otherwise, when the safety rules force changes into every candidate (a drug that
 * must go, a potassium or heart-rate reduction), the best-scoring plan whose only changes are those required ones. Before 2026-11-19 only an exact "no change" counted, and
 * no exact one exists when a change is required, so the rule never applied there and a digoxin start at eGFR 7 stayed on the screen (T3).
 */
export function baselinePlan(results: ScoredRegimen[]): ScoredRegimen | undefined {
    const exact = results.find(r => changeCount(r) === 0);
    if (exact) return exact;
    return results.filter(r => changeCount(r) > 0 && discretionaryCount(r) === 0).sort((a, b) => stable(b.raw_score) - stable(a.raw_score))[0];
}
// Order: displayed score, raw score, cost, change count, regimen key. GDMT completeness is NOT a step (owner ruling 2026-11-15: guideline pillar counts leave the ranking;
// it was a tie-break against 'softness' only while displayed scores clamped at 100).
export const byScoreThenCost = (a: ScoredRegimen, b: ScoredRegimen) =>
    b.overall_score - a.overall_score ||
    stable(b.raw_score) - stable(a.raw_score) ||
    a.cost - b.cost ||
    changeCount(a) - changeCount(b) ||
    (regimenKey(a) < regimenKey(b) ? -1 : regimenKey(a) > regimenKey(b) ? 1 : 0);

// ---------------------------------------------------------------------------------------------------
// One ranking (owner ruling 2026-11-20): options are ordered by `byScoreThenCost`. The "Prioritize foundational therapy" ordering and its patient field were removed.
// ---------------------------------------------------------------------------------------------------

/**
 * Severe projected-safety adjustment codes, each with the parameter it concerns. A candidate that trips one the harmful way is not offered by the congestion display rule.
 * The mild projected SBP < 95 tier is not one of them (it still costs score points).
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

/**
 * What became of each scored plan (U1): shown; withheld by a display-safety floor; over the stated budget; scoring below the baseline plan (the one every other option is held
 * against, `baselinePlan`); not different enough from a plan already listed (the distinct-steps rule); passed over because three options were already listed; or displaced by the
 * congestion display rule. The explanation counts these, so what it says is what the selection did.
 */
export type PlanFate = 'shown' | 'unsafe' | 'over_budget' | 'below_baseline' | 'not_distinct' | 'beyond_limit' | 'displaced';
export interface SelectionTrace {
    /** One entry for every plan passed in (the scored candidates), keyed by that plan. */
    fates: Map<ScoredRegimen, PlanFate>;
    /** The plan every other option was held against (among the display-safe plans), when there is one. */
    baseline?: ScoredRegimen;
    /** True when "No medication change" is listed first because the best option is not measurably better than it (U4). */
    noChangeLeads: boolean;
    /** True when the tie rule was NOT applied because the patient has recorded congestion and the best option raises or starts a diuretic (part of the congestion display rule, U15). */
    congestionException?: boolean;
    /** The scored plan behind each displayed pick, in the picks' order. */
    pickOrigins: ScoredRegimen[];
}

/**
 * Whether plan `r` is different enough from plan `existing` to be listed beside it (the distinct-steps rule): the same family-level strategy, or the same changed steps with a similar
 * set of drugs and a similar cost, is one option, not two. Used by the selection and by the explanation, so the explanation names the pair the selection actually compared.
 */
export function plansAreDistinct(r: ScoredRegimen, existing: ScoredRegimen): boolean {
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
}

/**
 * Pure selection: the <= 3 distinct display picks, best first, ordered by `cmp`. `allUnsafe` is true when
 * candidates existed but every one failed the display-safety floors (the caller raises the alert).
 */
export function chooseDisplayPicks(
    results: ScoredRegimen[], patient: Patient, cmp: (a: ScoredRegimen, b: ScoredRegimen) => number,
): { picks: ScoredRegimen[]; allUnsafe: boolean; unsafeReasons: string[]; trace: SelectionTrace } {
    const everyPlan = results;
    const fates = new Map<ScoredRegimen, PlanFate>(everyPlan.map(r => [r, 'not_distinct' as PlanFate]));
    // A plan is copied when a warning is added to it; the copy is traced back to the scored plan.
    const origins = new Map<ScoredRegimen, ScoredRegimen>();
    const orig = (x: ScoredRegimen): ScoredRegimen => origins.get(x) ?? x;
    const copyOf = (r: ScoredRegimen, c: ScoredRegimen): ScoredRegimen => { origins.set(c, orig(r)); return c; };
    const emptyTrace = (picks: ScoredRegimen[], baseline?: ScoredRegimen, noChangeLeads = false, congestionException = false): SelectionTrace => ({ fates, baseline, noChangeLeads, congestionException, pickOrigins: picks.map(orig) });
    // Safety precedes affordability in EVERY path. An unsafe cheap candidate must not suppress
    // the discussion-only fallback for a safe candidate above budget.
    const safeResults = results.filter(r => brokenDisplayFloors(r, patient).length === 0);
    for (const r of everyPlan) if (brokenDisplayFloors(r, patient).length > 0) fates.set(r, 'unsafe');
    const allUnsafe = results.length > 0 && safeResults.length === 0;
    const unsafeReasons = allUnsafe ? [...new Set(results.flatMap(r => brokenDisplayFloors(r, patient)))] : [];
    if (allUnsafe) return { picks: [], allUnsafe, unsafeReasons, trace: emptyTrace([]) };
    results = safeResults;
    const affordableRegimens = results.filter(r => r.cost <= patient.max_affordable_cost);
    let outputRegimens: ScoredRegimen[] = [];
    let extraPool: ScoredRegimen[] = [];
    let displayOrder = cmp;

    if (!budgetKnown(patient) || results.some(r => !Number.isFinite(r.cost))) {
        // An absent budget/price is not zero affordability and not proof of an over-budget regimen.
        // Keep safety filtering and clinical ordering; explicitly withhold affordability conclusions.
        const eligible = results.filter(r => !budgetKnown(patient) || !Number.isFinite(r.cost) || r.cost <= patient.max_affordable_cost);
        outputRegimens = eligible.sort(cmp).map(r => budgetKnown(patient) && Number.isFinite(r.cost) ? r : copyOf(r, { ...r, warnings: [
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
        const flagOverBudget = (r: ScoredRegimen): ScoredRegimen => copyOf(r, {
            ...r,
            warnings: [`BUDGET EXCEEDED: nothing fits the stated budget. This is one of the lowest-cost options ($${r.cost}), shown for discussion, not as a plan the patient can carry out. ${patient.care_priority === 'cost_first' ? 'The options are listed from the lowest monthly cost, not by score, because "Keep cost low" is selected.' : 'Among these least costly options, the options are listed by score.'} ${budgetMessage}`, ...r.warnings]
        });
        outputRegimens = cheapest.map(flagOverBudget);
        // Congestion coverage (below) may need a loop candidate outside the five cheapest: offer the cheapest one, flagged the same way.
        const cheapestSigs = new Set(cheapest);
        extraPool = results.filter(r => !cheapestSigs.has(r)).sort((a, b) => a.cost - b.cost || cmp(a, b)).map(flagOverBudget);
    }

    // S10: when "no change" is a candidate, an option the engine scores below it is not displayed, unless a named display rule shows it (congestion coverage below, which labels
    // it, or the over-budget rules, which label it in selectWithRanking). If that leaves fewer than three options, fewer are shown.
    const inOutput = new Set(outputRegimens.map(orig));
    for (const r of results) if (!inOutput.has(r)) fates.set(r, 'over_budget');
    const unfilteredOutput = outputRegimens;
    const noChange = baselinePlan(results);
    if (noChange) {
        const kept = outputRegimens.filter(r => orig(r) === noChange || stable(r.raw_score) >= stable(noChange.raw_score));
        if (kept.length > 0) {
            for (const r of outputRegimens) if (!kept.includes(r)) fates.set(orig(r), 'below_baseline');
            outputRegimens = kept;
        }
    }
    // U4: when leaving the regimen unchanged is itself a candidate and the best option's weighted score is not measurably above it (less than TOO_CLOSE_TO_SEPARATE_POINTS), "No medication
    // change" is listed first and the others follow in their own order as alternatives. No score, weight or eligibility rule changes. It does not apply when a change is required
    // (then no exact no-change plan exists).
    const exactNoChange0 = results.find(r => changeCount(r) === 0);
    const baseOutput = outputRegimens;
    // The tie rule is applied, the congestion display rule then runs, and the rule is withdrawn if that step shows a plan the rule's sentence would contradict (W2).
    const finish = (applyTie: boolean): { picks: ScoredRegimen[]; noChangeLeads: boolean; congestionException: boolean } | null => {
    let outputRegimens = baseOutput;
    let noChangeLeads = false;
    let congestionException = false;
    const exactNoChange = exactNoChange0;
    if (exactNoChange && applyTie) {
        const lead = outputRegimens.find(r => orig(r) === exactNoChange);
        if (lead) {
            // The best option is the first in the ranking order (its displayed score decides first; an option the tool scores 0 for projected harm can carry a higher raw score and is not the best).
            // W2 (round 4): in the over-budget fallback the list is ordered by cost, so index 0 is the cheapest plan, not the best. The best is found by the ranking comparator, and the
            // rule fires only when NO plan eligible for display (the listed plans, and the congestion display rule's candidates) scores TOO_CLOSE_TO_SEPARATE_POINTS or more above no change.
            const best = [...outputRegimens].sort(cmp)[0];
            const gap = stable(best.raw_score) - stable(exactNoChange.raw_score);
            const widestGap = Math.max(...outputRegimens.map(r => stable(r.raw_score))) - stable(exactNoChange.raw_score);
            if (gap < TOO_CLOSE_TO_SEPARATE_POINTS && widestGap < TOO_CLOSE_TO_SEPARATE_POINTS) {
                // U15 (POLICY: part of the congestion display rule, not a ranking bonus; no score changes): the tool does not model congestion relief by a diuretic, so for a patient with recorded congestion
                // a best option that starts or raises a diuretic (or adds a thiazide-type drug to a loop) keeps its scored place; "no option is measurably better" would be a statement about something the
                // tool never measures. A diuretic reduction or removal, any non-diuretic change, and a patient with no recorded congestion keep the tie rule.
                if (gap > 0 && hasCongestion(patient) && includesDiureticIntensification(best)) congestionException = true;
                else {
                    if (gap > 0) noChangeLeads = true;
                    outputRegimens = [lead, ...outputRegimens.filter(r => r !== lead)];
                }
            }
        }
    }
    const topPick = outputRegimens[0];
    if (!topPick) return null;

    // S2 note: the SBP < 90 hemodynamic-instability gate returns alerts-only near the top of this
    // function (search 'HEMODYNAMIC INSTABILITY') — do not re-add a duplicate check here; a second
    // copy of the same safety gate invites divergent edits.

    const distinctPicks: ScoredRegimen[] = [topPick];

    for (const r of outputRegimens) {
        if (distinctPicks.includes(r)) continue;
        if (distinctPicks.length >= 3) { fates.set(orig(r), 'beyond_limit'); continue; }

        const isDistinct = distinctPicks.every(existing => plansAreDistinct(r, existing));

        if (isDistinct) {
            distinctPicks.push(r);
        } else fates.set(orig(r), 'not_distinct');
    }

    const covered = ensureCongestionCoverage(distinctPicks, [...unfilteredOutput, ...extraPool], patient, copyOf);
    // Coverage adds an explicitly explained alternative without displacing the selected lead.
    // The remaining options must still be in the configured order after that insertion.
    const picks = [covered[0], ...covered.slice(1).sort(displayOrder)];
    for (const r of distinctPicks) if (!covered.includes(r)) fates.set(orig(r), 'displaced');
    for (const r of picks) fates.set(orig(r), 'shown');
    return { picks, noChangeLeads, congestionException };
    };
    let done = finish(true);
    // A plan shown beside the tie sentence that scores a point or more above no change (the congestion display rule can add one the listed plans did not contain): the rule is withdrawn.
    if (done && exactNoChange0 && orig(done.picks[0]) === exactNoChange0 && done.picks.some(r => stable(r.raw_score) - stable(exactNoChange0.raw_score) >= TOO_CLOSE_TO_SEPARATE_POINTS)) done = finish(false);
    if (!done) return { picks: [], allUnsafe, unsafeReasons, trace: emptyTrace([], noChange) };
    return { picks: done.picks, allUnsafe, unsafeReasons, trace: emptyTrace(done.picks, noChange, done.noChangeLeads, done.congestionException) };
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
export function ensureCongestionCoverage(picks: ScoredRegimen[], pool: ScoredRegimen[], patient: Patient, copyOf: (r: ScoredRegimen, c: ScoredRegimen) => ScoredRegimen = (_r, c) => c): ScoredRegimen[] {
    if (picks.length === 0 || !isCongestedAboveDryWeight(patient)) return picks;
    const shown = new Set(picks);
    const safe = (r: ScoredRegimen) => !shown.has(r) && isProjectedSafetyClean(r, patient);   // never a candidate that itself causes a severe projected-safety adjustment
    // Stage 1: no displayed loop increase or start -> the BEST-SCORING eligible loop candidate (pool order is the ranking comparator's), not a plain loop step regardless of score.
    // Stage 2 (2026-11-16): when NO loop increase exists at all (the loop is at its cap, as at eGFR 15 on bumetanide) and no displayed option intensifies any diuretic, show the
    // best-scoring other diuretic intensification (Furoscix short course or a thiazide-like add-on).
    let candidate: ScoredRegimen | undefined;
    let what = 'a diuretic increase';
    let why = 'and no other option raises or starts an oral loop';
    if (!picks.some(includesLoopIncrease)) {
        candidate = pool.filter(r => safe(r) && includesLoopIncrease(r))[0];
        // R8 X14 / X4: say what the candidate does to the oral loop. A start is an addition, not an increase; a step that comes with the clean-up of a duplicate loop entry leaves the total dose unchanged.
        if (candidate) {
            const loopMods = (candidate.modification_set?.modifications ?? []).filter(isLoopIncreaseMod);
            const net = loopDoseEffect(patient, candidate);
            const names = [...new Set(loopMods.map(m => m.target!.med.name.split(' (')[0]))].join(' and ');
            if (net === 'unchanged') what = `a loop diuretic step (${names}) that leaves the total oral loop dose unchanged, because one drug replaces two`;
            else if (loopMods.every(m => m.action === 'add')) what = `the addition of a loop diuretic (${names})`;
        }
        if (!candidate && !picks.some(includesDiureticIntensification)) { candidate = pool.filter(r => safe(r) && includesDiureticIntensification(r))[0]; if (candidate) { const added = [...new Set((candidate.modification_set?.modifications ?? []).filter(m => m.target && (m.action === 'add' || m.action === 'titrate_up') && (m.target.med.drug_class === 'Loop Diuretic' || m.target.med.drug_class === 'Thiazide-like Diuretic')).map(m => m.target!.med.name))]; const addedActions = new Set((candidate.modification_set?.modifications ?? []).filter(m => m.target && (m.action === 'add' || m.action === 'titrate_up') && (m.target.med.drug_class === 'Loop Diuretic' || m.target.med.drug_class === 'Thiazide-like Diuretic')).map(m => m.action)); what = `a diuretic ${addedActions.size > 1 ? 'addition or increase' : addedActions.has('titrate_up') ? 'increase' : 'addition'} (${added.map(n => n.split(' (')[0]).join(' and ')})`; why = 'and no loop increase passed the safety and budget checks'; } }
    }
    if (!candidate) return picks;
    const kg = kgText(weightAboveDryKg(patient));
    const tagged: ScoredRegimen = copyOf(candidate, { ...candidate, shown_because: `Includes ${what}: the patient is congested (${kg} kg above dry weight; the tool's loop criterion is more than ${CONGESTION_EXCESS_KG_ABOVE} kg), ${why}.` });
    return picks.length >= 3 ? [...picks.slice(0, picks.length - 1), tagged] : [...picks, tagged];
}

/**
 * Stage-7 entry point. Selects the display picks (one ranking: `byScoreThenCost`), labels any option shown although it scores below the baseline plan, and raises the
 * NO DISPLAY-SAFE alert once.
 */
export function selectWithRanking(
    results: ScoredRegimen[], patient: Patient, clinicalAlerts: string[],
): { picks: ScoredRegimen[]; trace: SelectionTrace } {
    const chosen = chooseDisplayPicks(results, patient, byScoreThenCost);
    const { allUnsafe, unsafeReasons, trace } = chosen;
    // An option that scores below the baseline plan (S10) is shown only under a named display rule, and the option says which (U2): the congestion display rule (labelled where it is
    // applied) or the over-budget rules. The label is added here, including when no exact "no change" plan exists.
    const baseline = trace.baseline;
    const baselineWords = baseline && changeCount(baseline) === 0 ? 'no change' : 'the plan that makes only the required changes';
    const labelBelowBaseline = (r: ScoredRegimen, from: ScoredRegimen): ScoredRegimen => {
        if (!baseline || r.shown_because || from === baseline || stable(from.raw_score) >= stable(baseline.raw_score)) return r;
        const why = r.warnings.some(w => w.startsWith('BUDGET EXCEEDED'))
            ? `Shown under the over-budget rule: nothing fits the stated monthly budget, so the lowest-cost options are listed for discussion; the tool scores this option below ${baselineWords}.`
            : budgetKnown(patient) && Number.isFinite(baseline.cost) && baseline.cost > patient.max_affordable_cost
                ? `Shown because ${baselineWords} is over the stated monthly budget and so cannot be listed; the tool scores this option below it.`
                : `Shown under a display rule; the tool scores this option below ${baselineWords}.`;
        return { ...r, shown_because: why };
    };
    const picks0 = chosen.picks.map((r, i) => labelBelowBaseline(r, trace.pickOrigins[i] ?? r));
    // R7 W13d: the over-budget fallback says its options are listed by score (or from the lowest monthly cost). When the no-change tie rule has put "no change" first, that sentence is
    // untrue of the order shown, so it says so: no option scores one point or more above no change.
    const inFallbackOrder = picks0.length > 1 && picks0.every(r => r.warnings.some(w => w.startsWith('BUDGET EXCEEDED')));
    const statedOrderHolds = patient.care_priority === 'cost_first' ? picks0.every((r, i) => i === 0 || picks0[i - 1].cost <= r.cost) : picks0.every((r, i) => i === 0 || picks0[i - 1].overall_score >= r.overall_score);
    const costFirst = patient.care_priority === 'cost_first';
    const NO_CHANGE_NOTE = ' Making no change is listed first although another option here scores a little higher or costs less, because no option scores 1 point or more above it.';
    const DISPLAY_RULE_NOTE = ` An option that a display rule adds (it says so) keeps the place the rule gave it, so the order is not strictly ${costFirst ? 'by cost' : 'by score'}.`;
    const note = !inFallbackOrder || statedOrderHolds ? '' : changeCount(picks0[0]) === 0 ? NO_CHANGE_NOTE : DISPLAY_RULE_NOTE;
    const picks = note ? picks0.map(r => ({ ...r, warnings: r.warnings.map(w => (w.startsWith('BUDGET EXCEEDED') && !w.includes(note)
        ? w.replace(/(, not by score, because "Keep cost low" is selected\.|, the options are listed by score\.)/, `$1${note}`) : w)) })) : picks0;
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
    return { picks, trace };
}

/** Back-compat wrapper: the picks only (raises the NO DISPLAY-SAFE alert). */
export function selectDisplayPicks(results: ScoredRegimen[], patient: Patient, clinicalAlerts: string[]): ScoredRegimen[] {
    return selectWithRanking(results, patient, clinicalAlerts).picks;
}
