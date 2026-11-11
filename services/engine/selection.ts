/**
 * Pipeline stage 7 - choose what the clinician sees: affordability filter (with the over-budget
 * fallback), the ranking comparator, the display-safety floors, and the distinct top-3.
 * Moved verbatim from generateAndScoreModifications.
 */
import { Patient, ScoredRegimen, RegimenMed } from '../../types';
import { drugFacts } from './drugFacts';
import { getMedicationClassGroup } from './registry';

/**
 * Hard display floors on the PROJECTED state: a regimen that projects past any of these is never
 * shown, however well it scores. The graduated ranking penalties (SCORE_ADJUSTMENTS) begin earlier.
 */
export const DISPLAY_FLOORS = {
    minProjectedSbp: 85,         // projected SBP < 85 mmHg is hidden
    maxProjectedPotassium: 6.0,  // projected K+ > 6.0 mEq/L is hidden
    minProjectedPulse: 45,       // projected HR < 45 bpm is hidden
} as const;

// 6. Affordability filter + distinct picks.
// Ranking is the score a clinician can read: the UNROUNDED raw_score (higher first), then cost
// (cheaper first). There is no completeness or rounded-score key - completeness is already one of
// the eight weighted domains, and the score is no longer clamped at 100 in normal use, so strong
// regimens do not pile up on a tie. Cost is the final tiebreaker only: it breaks ties between
// regimens that are clinically indistinguishable down to the raw score (recommending the cheaper
// one is the cost-effective choice); cost is also already in the cost domain and the affordability
// filter.
export const byScoreThenCost = (a: ScoredRegimen, b: ScoredRegimen) =>
    (b.raw_score ?? 0) - (a.raw_score ?? 0) ||
    a.cost - b.cost;

/**
 * Returns the <= 3 distinct display picks, best first. Empty when no candidate survives the
 * display-safety floors (a NO DISPLAY-SAFE REGIMEN alert is pushed onto `clinicalAlerts` when
 * candidates existed but all were unsafe).
 */
export function selectDisplayPicks(results: ScoredRegimen[], patient: Patient, clinicalAlerts: string[]): ScoredRegimen[] {
    const affordableRegimens = results.filter(r => r.cost <= patient.max_affordable_cost);
    let outputRegimens: ScoredRegimen[] = [];

    if (affordableRegimens.length > 0) {
        outputRegimens = affordableRegimens.sort(byScoreThenCost);
    } else if (results.length > 0) {
        // Nothing fits the budget. Surface the lowest-cost candidates (closest to affordable), but
        // order THEM by clinical value so the best-benefit near-affordable option leads — among
        // equal benefit the cheaper wins (byScoreThenCost ends in cost). Pure cost-ascending
        // would lead with a thin monotherapy / symptomatic-only regimen over a higher-benefit
        // sibling at the same price.
        const cheapest = [...results].sort((a, b) => a.cost - b.cost).slice(0, 5).sort(byScoreThenCost);
        const budgetMessage = patient.max_affordable_cost <= 0
            ? 'No zero-copay regimen found. Add covered medications or raise budget.'
            : 'Increase budget to find valid options.';
        outputRegimens = cheapest.map(r => ({
            ...r,
            warnings: [`BUDGET EXCEEDED: Cheapest option ($${r.cost}) displayed. ${budgetMessage}`, ...r.warnings]
        }));
    }

    // Display-safety floors mirror the graduated score penalties: penalties begin at SBP < 95,
    // K+ > 5.5, HR < 50; the more extreme floors below are hard display gates — a projected
    // state past them is never shown, regardless of how well the regimen scores elsewhere.
    const displaySafeRegimens = outputRegimens.filter(r =>
        r.projected_patient.sbp >= DISPLAY_FLOORS.minProjectedSbp && r.projected_patient.potassium <= DISPLAY_FLOORS.maxProjectedPotassium && r.projected_patient.pulse >= DISPLAY_FLOORS.minProjectedPulse
    );
    if (outputRegimens.length > 0 && displaySafeRegimens.length === 0) {
        clinicalAlerts.push(
            'NO DISPLAY-SAFE REGIMEN: Candidate regimens projected severe hypotension (SBP < 85), severe hyperkalemia (K+ > 6.0), or severe bradycardia (HR < 45). ' +
            'Stabilize and reassess before oral intensification.'
        );
    }
    outputRegimens = displaySafeRegimens;

    const topPick = outputRegimens[0];
    if (!topPick) return [];

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

    return distinctPicks;
}
