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

// Acutely decompensated heart failure, as the engine defines it everywhere (beta-blocker initiation block, ivabradine
// contraindication): NYHA IV, or NYHA III with more than 2 kg above dry weight and at least two congestion exam findings.
export function isAcutelyDecompensated(patient: Patient): boolean {
    const excess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    return patient.nyha_class === 'IV' ||
        (patient.nyha_class === 'III' && excess > 2.0 && patient.volume_status.exam_findings.size >= 2);
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
