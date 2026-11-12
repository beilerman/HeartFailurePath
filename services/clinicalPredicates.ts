import { Patient } from '../types';

// Shared clinical predicates — single source of truth for logic consumed by BOTH the
// engine (services/simulationService.ts) and the formulary (constants.ts). These were
// previously duplicated in the two files (hasHistoricalHFrEFForFormulary /
// isIronDeficientForFormulary) and are extracted here so a future revision cannot
// desynchronize formulary gating from engine gating.
//
// NOTE: the intentionally-DIFFERENT "preserve quad therapy for unknown EF history"
// variants stay in their own files and must NOT be merged:
//   - simulationService.shouldPreserveQuadForUnknownHistory (engine: RAAS/BB/MRA groups)
//   - constants.shouldPreserveHFrEFTherapyForUnknownHistory (formulary: excludes nsMRA,
//     because including it would make finerenone self-contraindicating for a patient
//     already taking it with unknown EF history).

// Physiologically-impossible zero (or undefined / NaN) is treated as "not entered" for
// safety-critical fields. A potassium of 0 is not a measured value — it is a blank field,
// and must NOT be allowed to read as "safe" (e.g. clearing a hyperkalemia gate).
export function valueUnknown(v: number | undefined): boolean {
    return v === undefined || Number.isNaN(v) || v <= 0;
}

// Documented prior LVEF <= 40 (HFimpEF detection). A previous_lvef of 0 or NaN is a blank
// field, not a measured ejection fraction — fall back to the categorical ever_lvef_le_40
// answer instead of misreading it as "documented prior EF of 0" (which would flip an
// ordinary HFpEF patient into HFimpEF quad therapy).
export function hasHistoricalHFrEF(patient: Patient): boolean {
    if (!valueUnknown(patient.previous_lvef)) return patient.previous_lvef! <= 40;
    return patient.ever_lvef_le_40 === 'yes';
}

// A recorded numeric prior LVEF below 50. With current LVEF >= 50 this makes the patient HFrEF (2026 ESC: HFpEF requires an LVEF that was never
// below 50). A blank or zero previous_lvef is not a measurement (see above), and the categorical ever_lvef_le_40 answer cannot show a prior 41-49.
export function hasPriorLvefBelow50(patient: Patient): boolean {
    return !valueUnknown(patient.previous_lvef) && patient.previous_lvef! < 50;
}

// True when prior-EF history is genuinely unknown (no usable numeric previous_lvef AND
// the categorical answer is unknown) — drives the conservative preserve-quad pathways.
export function hasUnknownHistoricalHFrEF(patient: Patient): boolean {
    return valueUnknown(patient.previous_lvef) && (patient.ever_lvef_le_40 ?? 'unknown') === 'unknown';
}

// Single source of truth for the A-HeFT race criterion (H/ISDN special-feature bonus in
// constants.ts + adjunct gating in the engine). Patient.race is a closed union sourced from
// the form's Race options, so a stale alias literal cannot silently reappear.
export function isBlackRace(patient: Patient): boolean {
    return patient.race === 'Black';
}

// Iron deficiency in HF — ESC 2021, IRONMAN, AFFIRM-AHF, FAIR-HF/CONFIRM-HF criteria:
//   - Absolute deficiency:   ferritin < 100 ng/mL (regardless of TSAT)
//   - Functional deficiency: ferritin 100-300 ng/mL AND TSAT < 20%
// TSAT < 20% with ferritin > 300 (or with ferritin unknown) is NOT, by itself, a
// treatment indication — ferritin context is required to classify. The prior logic
// (ferritin < 100 OR tsat < 20) over-flagged functional/inflammatory states.
export function isIronDeficient(patient: Patient): boolean {
    const { ferritin, tsat } = patient;
    if (ferritin === undefined) return false;                              // cannot classify without ferritin
    if (ferritin < 100) return true;                                       // absolute
    return ferritin <= 300 && tsat !== undefined && tsat < 20;             // functional
}

/**
 * Number of distinct CONGESTION findings on examination. Edema is one finding whatever its grade (the form offers 1+, 2+ and 3+ as separate toggles; two grades
 * ticked used to count as two findings), and cool extremities is a perfusion sign, not congestion, so it is not counted (it is read by the low-output and
 * hypoperfusion rules instead). Before 2026-11-12 every rule used the raw size of the findings set.
 */
export function congestionFindingCount(findings: Set<string>): number {
    let n = 0, edema = false;
    findings.forEach(f => {
        if (f === 'Cool Extremities') return;
        if (f.startsWith('Edema')) { edema = true; return; }
        n += 1;
    });
    return n + (edema ? 1 : 0);
}

// Acutely decompensated heart failure, as the engine defines it everywhere (beta-blocker initiation block, ivabradine
// contraindication): NYHA IV, or NYHA III with more than 2 kg above dry weight and at least two congestion exam findings.
export function isAcutelyDecompensated(patient: Patient): boolean {
    const excess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    return patient.nyha_class === 'IV' ||
        (patient.nyha_class === 'III' && excess > 2.0 && congestionFindingCount(patient.volume_status.exam_findings) >= 2);
}

// Vericiguat initiation NT-proBNP threshold (VICTORIA inclusion, NCT02861534): >= 1000 pg/mL in sinus rhythm, >= 1600 in atrial
// fibrillation. The label has no NT-proBNP criterion, so this is an evidence-tier gate for INITIATION only. Any rhythm other than
// sinus (AFib, paced) uses the higher threshold (the trial's non-sinus value; the conservative reading).
export function vericiguatNtProBnpThreshold(patient: Patient): number {
    return patient.rhythm === 'Sinus' ? 1000 : 1600;
}

// IV iron (ferric carboxymaltose) credit tier. 2022 AHA/ACC/HFSA: Class 2a, B-R, in HFrEF with iron deficiency. Trial LVEF: CONFIRM-HF <= 45,
// AFFIRM-AHF < 50, IRONMAN <= 45, HEART-FID <= 40. The Injectafer HF indication is NYHA II/III with no LVEF limit; its label has no data with
// hemoglobin >= 15 g/dL. Full credit at LVEF <= 40, a limited-evidence tier at 41-49, none at >= 50 (HFpEF), none at NYHA I or IV, held at Hb >= 15.
// Returns null when the engine should neither credit nor automatically add IV iron (a clinician may still choose it).
export function ivIronCreditTier(patient: Patient): 'full' | 'limited' | null {
    if (!isIronDeficient(patient)) return null;
    if (patient.nyha_class !== 'II' && patient.nyha_class !== 'III') return null;
    if (patient.hemoglobin !== undefined && patient.hemoglobin >= 15) return null;
    if (patient.lvef <= 40) return 'full';
    if (patient.lvef < 50) return 'limited';
    return null;
}

// CKD-EPI Creatinine Equation (2021 Refit)
export const calculateCKDEPI = (scr: number, age: number, sex: 'Male' | 'Female'): number => {
    if (!scr || !age) return 0;

    // Kappa: 0.7 (female), 0.9 (male)
    const kappa = sex === 'Female' ? 0.7 : 0.9;
    // Alpha: -0.241 (female), -0.302 (male)
    const alpha = sex === 'Female' ? -0.241 : -0.302;

    // Factors
    const scrOverKappa = scr / kappa;
    const minPart = Math.min(scrOverKappa, 1);
    const maxPart = Math.max(scrOverKappa, 1);

    // 142 * (min^alpha) * (max^-1.200) * (0.9938^age) * (1.012 if female)
    let egfr = 142 * Math.pow(minPart, alpha) * Math.pow(maxPart, -1.200) * Math.pow(0.9938, age);

    if (sex === 'Female') {
        egfr *= 1.012;
    }

    return Math.round(egfr);
};
