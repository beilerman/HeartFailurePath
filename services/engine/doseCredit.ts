/**
 * Dose credit for OUTCOME and SYMPTOM benefit, anchored on the daily dose each trial actually achieved (data/doseEvidence.json, from the dose-evidence review).
 * The completeness domain keeps its own credit (`therapyDoseCredit`, reference only); nothing here touches it.
 *
 *   credit = 1                                              at or above the drug's trial-achieved daily dose (the anchor)
 *   credit = c0 + (1 - c0) x (dose - start) / (anchor - start)    between the patient's label starting dose and the anchor
 *   credit = c0 x dose / start                              below the patient's label starting dose (zero dose means zero benefit)
 *   start at or above the anchor: 1 at or above the anchor, dose / anchor below it (continuous, proportional)
 *   FLOOR (change C2, controller recommendation 2026-11-18): for an anchor row of level "drug" (the drug's own trial dose) credit = max(the curve above, min(1, daily dose / trial dose)). Anchors of any other level keep the curve only.
 *
 * c0 = `start_dose_credit.value` in the file: the mean of four c0 solved from the ATLAS (lisinopril) and HEAAL (losartan) low-versus-high dose comparisons.
 * MEASURED for ACE inhibitors and ARBs only; EXTRAPOLATED to every other class (ENGINE POLICY).
 * An anchor row with a `condition` (eGFR) applies only to the matching patient; with eGFR unknown the higher anchor is used (no over-crediting).
 * `level: "not_measured"` rows (and drugs with no row) fall back to the engine's own target logic (doseProgressToTarget) on the same curve; a drug with no numeric
 * target and a single dose, or no target at or above its start, earns 1.
 */
import type { Patient, RegimenMed } from '../../types';
import { allowedRegimens, doseProgressToTarget, highestAllowedDose, numericDailyDose, startingDailyDose, therapyDoseCredit } from './regimenUtils';
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

/** The anchor row that applies to this drug and patient (the trial-achieved daily dose), or undefined when no measured numeric anchor applies. */
export function doseAnchorRow(r: RegimenMed, patient: Patient): AnchorRow | undefined {
    const rows = ANCHORS.filter(a => a.drug === r.med.name && a.level !== 'not_measured' && typeof a.full_credit_daily_mg === 'number');
    if (rows.length === 0) return undefined;
    if (rows.length === 1 && !rows[0].condition) return rows[0];
    const known = !valueUnknown(patient.egfr);
    const matching = rows.filter(a => !a.condition || (known && (a.condition.kind === 'egfr_at_least' ? patient.egfr >= a.condition.value : patient.egfr < a.condition.value)));
    const pool = matching.length > 0 ? matching : rows;
    return pool.reduce((best, a) => (a.full_credit_daily_mg! > best.full_credit_daily_mg! ? a : best));
}

/** The trial-achieved daily dose for this drug and patient, or undefined when no measured numeric anchor applies. */
export function doseAnchorMg(r: RegimenMed, patient: Patient): number | undefined {
    return doseAnchorRow(r, patient)?.full_credit_daily_mg ?? undefined;
}

export function outcomeDoseCredit(r: RegimenMed, patient: Patient): number {
    const c0 = START_DOSE_CREDIT.value;
    // Loop diuretics: the randomized trials compared a diuretic with none, never one dose with another, so there is NO measured dose relation. Credit 1 at any dose (started,
    // increased, unchanged or reduced while the drug remains); removed means no contributor. The breakdown says "dose relation not measured" (planCreditsFor.doseNotMeasured).
    if (r.med.drug_class === 'Loop Diuretic') return 1;
    const daily = numericDailyDose(r), start = startingDailyDose(r, patient);
    const anchorRow = doseAnchorRow(r, patient), anchor = anchorRow?.full_credit_daily_mg ?? undefined;
    if (anchor !== undefined && !Number.isNaN(daily)) {
        if (daily >= anchor) return 1;
        let curve: number;
        if (start === undefined || start <= 0) curve = c0 + (1 - c0) * Math.max(0, daily) / anchor;
        else if (start >= anchor) curve = Math.max(0, daily) / anchor;
        else if (daily < start) curve = c0 * Math.max(0, daily) / start;
        else curve = c0 + (1 - c0) * (daily - start) / (anchor - start);
        // Floor (controller recommendation 2026-11-18, change C2): the curve was anchored on the label starting dose, so spironolactone 25 mg earned 0.364 although the RALES dose
        // was 26 mg. For a drug with its OWN trial dose (level "drug") credit is never less than the fraction of the trial dose taken. Sibling-proxy and class anchors keep the curve only.
        return anchorRow!.level === 'drug' ? Math.max(curve, Math.min(1, Math.max(0, daily) / anchor)) : curve;
    }
    // Fallback: the engine's own target logic (full credit at target, maximum strength or an interaction cap; single-dose drugs).
    if (r.med.available_doses.length === 1 || therapyDoseCredit(r, patient) >= 1) return 1;
    if (start !== undefined && start > 0 && !Number.isNaN(daily) && daily < start) return c0 * Math.max(0, daily) / start;
    const progress = doseProgressToTarget(r, patient);
    return progress === undefined ? 1 : c0 + (1 - c0) * progress;
}


export type CreditFn = (r: RegimenMed, patient: Patient) => number;

export interface CappedStart { drug: string; credit: number; max_daily: number; unit: string; rules: ('kidney' | 'interaction' | 'maximum')[]; text: string }

/**
 * Value an option as the PLAN it starts (controller recommendation 2026-11-16, revised 2026-11-18, change C1; owner instruction 2026-11-18: "implement the recommended changes and run them as one package").
 * A trial relative risk measures "start the drug and titrate as tolerated" (intention to treat), so a start is credited as titrated, but not beyond the highest dose this patient may be given.
 * Applies to the credit used for RANKING (outcomes and symptoms); harm is unchanged. Per drug in the option:
 *   started today in a class the current regimen does not contain, and a cross-class switch ... credit of the HIGHEST daily dose allowed for this patient (highestAllowedDose: the kidney, interaction
 *                                                                           and declared-maximum rules the candidate generator uses), at most 1; exactly 1 when no rule caps it
 *   increased today ......................................................... credit at the NEW dose (outcomeDoseCredit); no longer 1
 *   swapped within the same class (same evidence row) ....................... the larger of the new drug's dose-based credit and the replaced drug's dose-based credit (a like-for-like swap is never a gain)
 *   reduced ................................................................. credit by the reduced dose
 *   left unchanged .......................................................... credit by its current dose (outcomeDoseCredit)
 *   loop diuretics (start, increase, Furoscix beside an oral loop) .......... credit 1 (no measured dose relation)
 * `titrated` names the drugs STARTED today and valued as titrated; `capped` lists the starts whose credit is below 1 because a rule caps the dose, with the rule and the dose in words.
 */
export function planCreditsFor(modSet: { modifications: { action: string; source?: RegimenMed; target?: RegimenMed }[]; resulting_regimen: RegimenMed[] }, patient: Patient): { creditFn: CreditFn; titrated: string[]; capped: CappedStart[]; doseNotMeasured: string[] } {
    const current = patient.current_regimen ?? [];
    const currentClasses = new Set(current.map(r => r.med.drug_class));
    const key = (r: RegimenMed) => `${r.med.name}|${r.dose.strength}|${r.selected_frequency}`;
    const credits = new Map<string, number>(), titrated: string[] = [], capped: CappedStart[] = [];
    const mark = (r: RegimenMed, c: number, asTitrated: boolean) => { credits.set(key(r), c); if (asTitrated && !titrated.includes(r.med.name)) titrated.push(r.med.name); };
    const markStart = (t: RegimenMed) => {
        if (t.med.drug_class === 'Loop Diuretic') { mark(t, 1, true); return; }
        const top = highestAllowedDose(t.med, patient);
        if (!top?.cap) { mark(t, 1, true); return; }
        // The best credit among every dose and frequency combination the engine may offer (equal daily doses earn equal credit, but the cap never depends on which entry is listed first).
        const credit = Math.min(1, Math.max(outcomeDoseCredit(top.regimen, patient), ...allowedRegimens(t.med, patient).map(a => outcomeDoseCredit(a, patient))));
        mark(t, credit, true);
        if (credit < 1 - 1e-12 && !capped.some(c => c.drug === t.med.name)) capped.push({ drug: t.med.name, credit, max_daily: top.daily, unit: top.regimen.dose.unit, rules: top.cap.rules, text: top.cap.text });
    };
    for (const m of modSet.modifications) {
        const t = m.target, s = m.source;
        // Furoscix beside an oral loop is the same class and mechanism group: an INCREASE of the loop (credit 1), not a second contributor.
        if (m.action === 'add' && t) { if (!currentClasses.has(t.med.drug_class) || t.med.drug_class === 'Loop Diuretic') markStart(t); }
        else if (m.action === 'titrate_up' && t) mark(t, outcomeDoseCredit(t, patient), false);
        else if (m.action === 'swap' && t && s) {
            if (s.med.drug_class === t.med.drug_class) mark(t, Math.max(outcomeDoseCredit(t, patient), outcomeDoseCredit(s, patient)), false);
            else markStart(t);
        }
    }
    // Loop diuretics have no measured dose relation: valued at full credit at any dose, and the detail says so.
    const doseNotMeasured = modSet.resulting_regimen.filter(r => r.med.drug_class === 'Loop Diuretic').map(r => r.med.name);
    return { creditFn: (r, p) => credits.get(key(r)) ?? outcomeDoseCredit(r, p), titrated, capped, doseNotMeasured };
}
