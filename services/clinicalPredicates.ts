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
