/**
 * Dose credit for OUTCOME and SYMPTOM benefit, anchored on the daily dose each trial actually achieved (data/doseEvidence.json, from the dose-evidence review).
 * The completeness domain keeps its own credit (`therapyDoseCredit`, reference only); nothing here touches it.
 *
 *   credit = 1                                              at or above the drug's trial-achieved daily dose (the anchor)
 *   credit = c0 + (1 - c0) x (dose - start) / (anchor - start)    between the patient's label starting dose and the anchor
 *   credit = c0 x dose / start                              below the patient's label starting dose (zero dose means zero benefit)
 *   start at or above the anchor: 1 at or above the anchor, dose / anchor below it (continuous, proportional)
 *
 * c0 = `start_dose_credit.value` in the file: the mean of four c0 solved from the ATLAS (lisinopril) and HEAAL (losartan) low-versus-high dose comparisons.
 * MEASURED for ACE inhibitors and ARBs only; EXTRAPOLATED to every other class (ENGINE POLICY).
 * An anchor row with a `condition` (eGFR) applies only to the matching patient; with eGFR unknown the higher anchor is used (no over-crediting).
 * `level: "not_measured"` rows (and drugs with no row) fall back to the engine's own target logic (doseProgressToTarget) on the same curve; a drug with no numeric
 * target and a single dose, or no target at or above its start, earns 1.
 */
import type { Patient, RegimenMed } from '../../types';
import { doseProgressToTarget, numericDailyDose, startingDailyDose, therapyDoseCredit } from './regimenUtils';
import { valueUnknown } from '../clinicalPredicates';
import doseEvidenceJson from '../../data/doseEvidence.json';

export { numericDailyDose };

interface AnchorRow {
    id: string; drug: string; level: 'drug' | 'class' | 'siblingProxy' | 'not_measured';
    full_credit_daily_mg: number | null;
    condition: { kind: 'egfr_at_least' | 'egfr_below'; value: number } | null;
}
export const DOSE_EVIDENCE = doseEvidenceJson;
export const START_DOSE_CREDIT: { value: number } = doseEvidenceJson.start_dose_credit;
const ANCHORS = doseEvidenceJson.anchors as unknown as AnchorRow[];

/** The trial-achieved daily dose for this drug and patient, or undefined when no measured numeric anchor applies. */
export function doseAnchorMg(r: RegimenMed, patient: Patient): number | undefined {
    const rows = ANCHORS.filter(a => a.drug === r.med.name && a.level !== 'not_measured' && typeof a.full_credit_daily_mg === 'number');
    if (rows.length === 0) return undefined;
    if (rows.length === 1 && !rows[0].condition) return rows[0].full_credit_daily_mg!;
    const known = !valueUnknown(patient.egfr);
    const matching = rows.filter(a => !a.condition || (known && (a.condition.kind === 'egfr_at_least' ? patient.egfr >= a.condition.value : patient.egfr < a.condition.value)));
    const pool = matching.length > 0 ? matching : rows;
    return Math.max(...pool.map(a => a.full_credit_daily_mg!));
}

export function outcomeDoseCredit(r: RegimenMed, patient: Patient): number {
    const c0 = START_DOSE_CREDIT.value;
    // Loop diuretics: the randomized trials compared a diuretic with none, never one dose with another, so there is NO measured dose relation. Credit 1 at any dose (started,
    // increased, unchanged or reduced while the drug remains); removed means no contributor. The breakdown says "dose relation not measured" (planCreditsFor.doseNotMeasured).
    if (r.med.drug_class === 'Loop Diuretic') return 1;
    const daily = numericDailyDose(r), start = startingDailyDose(r, patient);
    const anchor = doseAnchorMg(r, patient);
    if (anchor !== undefined && !Number.isNaN(daily)) {
        if (daily >= anchor) return 1;
        if (start === undefined || start <= 0) return c0 + (1 - c0) * Math.max(0, daily) / anchor;
        if (start >= anchor) return Math.max(0, daily) / anchor;
        if (daily < start) return c0 * Math.max(0, daily) / start;
        return c0 + (1 - c0) * (daily - start) / (anchor - start);
    }
    // Fallback: the engine's own target logic (full credit at target, maximum strength or an interaction cap; single-dose drugs).
    if (r.med.available_doses.length === 1 || therapyDoseCredit(r, patient) >= 1) return 1;
    if (start !== undefined && start > 0 && !Number.isNaN(daily) && daily < start) return c0 * Math.max(0, daily) / start;
    const progress = doseProgressToTarget(r, patient);
    return progress === undefined ? 1 : c0 + (1 - c0) * progress;
}


export type CreditFn = (r: RegimenMed, patient: Patient) => number;

/**
 * Value an option as the PLAN it starts (controller ruling 2026-11-16; awaiting the owner, first-principles README section 10 item 1). A trial relative risk measures "start the drug and titrate as tolerated" (intention to treat); charging a
 * new start the discounted starting-dose credit while charging the trial's full harm rate was inconsistent. Applies to the credit used for RANKING (outcomes and symptoms);
 * harm is unchanged. Per drug in the option:
 *   started today in a class the current regimen does not contain ........ credit 1 (valued as titrated to the trial-achieved dose)
 *   increased today ......................................................... credit 1 (the option commits to titration)
 *   swapped within the same class (same evidence row) ....................... the larger of the new drug's dose-based credit and the replaced drug's dose-based credit (a like-for-like swap is never a gain)
 *   swapped to a different class (ACE inhibitor to ARNI or ARB, MRA to nsMRA) .. a start, credit 1
 *   reduced ................................................................. credit by the reduced dose
 *   left unchanged .......................................................... credit by its current dose (outcomeDoseCredit)
 * `titrated` names the drugs valued as titrated, for the breakdown text.
 */
export function planCreditsFor(modSet: { modifications: { action: string; source?: RegimenMed; target?: RegimenMed }[]; resulting_regimen: RegimenMed[] }, patient: Patient): { creditFn: CreditFn; titrated: string[]; doseNotMeasured: string[] } {
    const current = patient.current_regimen ?? [];
    const currentClasses = new Set(current.map(r => r.med.drug_class));
    const key = (r: RegimenMed) => `${r.med.name}|${r.dose.strength}|${r.selected_frequency}`;
    const credits = new Map<string, number>(), titrated: string[] = [];
    const mark = (r: RegimenMed, c: number, asTitrated: boolean) => { credits.set(key(r), c); if (asTitrated && !titrated.includes(r.med.name)) titrated.push(r.med.name); };
    for (const m of modSet.modifications) {
        const t = m.target, s = m.source;
        // Furoscix beside an oral loop is the same class and mechanism group: an INCREASE of the loop (credit 1), not a second contributor.
        if (m.action === 'add' && t) { if (!currentClasses.has(t.med.drug_class) || t.med.drug_class === 'Loop Diuretic') mark(t, 1, true); }
        else if (m.action === 'titrate_up' && t) mark(t, 1, true);
        else if (m.action === 'swap' && t && s) {
            if (s.med.drug_class === t.med.drug_class) mark(t, Math.max(outcomeDoseCredit(t, patient), outcomeDoseCredit(s, patient)), false);
            else mark(t, 1, true);
        }
    }
    // Loop diuretics have no measured dose relation: valued at full credit at any dose, and the detail says so.
    const doseNotMeasured = modSet.resulting_regimen.filter(r => r.med.drug_class === 'Loop Diuretic').map(r => r.med.name);
    return { creditFn: (r, p) => credits.get(key(r)) ?? outcomeDoseCredit(r, p), titrated, doseNotMeasured };
}
