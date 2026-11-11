/**
 * Clinical trigger thresholds that BOTH the engine and the patient form's input hints read. One definition each: the form must not keep
 * display-only copies (a hint that disagrees with the rule that fires is a bug). Drug-specific numbers live on the formulary entry (`facts`);
 * these are the class- or patient-level triggers.
 */

/** Systolic BP below this returns alerts only (no drug recommendations). */
export const HYPOTENSION_SBP_BELOW = 90;

/** Potassium above this is never a NEW MRA start (label ceiling; contraindication check). */
export const MRA_START_K_MAX = 5.5;
/** A NEW MRA start above this potassium is offered only together with a potassium binder (label/guideline start threshold; rule E15). */
export const MRA_START_K_BINDER_ABOVE = 5.0;
/** Potassium below this is hypokalemia (digoxin contraindication; projected-K+ warning). */
export const HYPOKALEMIA_K_BELOW = 3.5;

/** Resting heart rate below this blocks a NEW beta-blocker start and, on an established one, forces a one-step reduction. Engine policy except carvedilol's label 55. */
export const BB_HR_BELOW = 55;

/** eGFR below this is severe CKD for the engine's dose-limiting and start-dose rules (e.g. sacubitril/valsartan start dose). */
export const SEVERE_CKD_EGFR_BELOW = 30;

/** Low-output markers (isLowOutputState needs at least two of the three, with LVEF below `lvefBelow`). */
export const LOW_OUTPUT = { lvefBelow: 20, pulsePressureMax: 25, bunCrAbove: 20 } as const;
