/**
 * Clinical trigger thresholds that BOTH the engine and the patient form's input hints read. One definition each: the form must not keep
 * display-only copies (a hint that disagrees with the rule that fires is a bug). Drug-specific numbers live on the formulary entry (`facts`);
 * these are the class- or patient-level triggers.
 */

/** Systolic BP below this returns alerts only (no drug recommendations). */
export const HYPOTENSION_SBP_BELOW = 90;

/** Potassium above this is never a NEW MRA start (label ceiling; contraindication check). */
export const MRA_START_K_MAX = 5.5;
/**
 * A NEW MRA start is withheld above this potassium (rule E15), with or without a potassium binder: start once potassium is at or below it.
 * Sources (verified-clinical-decisions-2026-11-11.md rows 1, 2a, 2c): 2022 AHA/ACC/HFSA start criterion K < 5.0 (SECONDARY reproduction; the
 * primary guideline was not opened), Aldactone label "serum potassium <=5.0", Kerendia label "do not initiate ... > 5.0". One rule for every MRA:
 * the eplerenone label's looser K > 5.5 start contraindication (row 2b) does not govern.
 */
export const MRA_START_K_CEILING = 5.0;
/**
 * RAAS inhibitor (ACEi, ARB, ARNI) potassium rules (2026 ESC heart failure guideline section 6.1; esc-2026-reading-notes.md).
 * A NEW start (or a swap-in) is blocked above RAAS_START_K_MAX: the engine's longstanding block (ESC says "caution" above 5.2). For an inhibitor the
 * patient is ALREADY on, severe hyperkalaemia ("potassium >5.5 or >6") leads to temporary down-titration or discontinuation, because abrupt withdrawal
 * risks deterioration: one dose step down from RAAS_REDUCE_K (stopped if already at the lowest tier), stopped from RAAS_WITHHOLD_K. The 5.5 / 6.0
 * split mirrors the MRA rule; ESC states ">5.5 or >6" without assigning an action to each number, so the two-step action is ENGINE POLICY.
 * Before 2026-11-11 a current RAAS inhibitor was removed above 5.4 (engine policy).
 */
export const RAAS_START_K_MAX = 5.4;
export const RAAS_REDUCE_K = 5.5;
export const RAAS_WITHHOLD_K = 6.0;

/**
 * Creatinine after starting or raising a RAAS inhibitor, MRA or SGLT2 inhibitor: a rise of less than 50% above baseline is acceptable while eGFR stays
 * above 15 (2026 ESC section 6.1). Before 2026-11-11 the monitoring text used 30% (engine policy). An early eGFR dip is expected and is not a reason to stop.
 */
export const CREATININE_RISE_ACCEPTABLE_PCT = 50;
export const EGFR_FLOOR_FOR_CREATININE_RISE = 15;

/** Potassium below this is hypokalemia (digoxin contraindication; projected-K+ warning). */
export const HYPOKALEMIA_K_BELOW = 3.5;

/** Resting heart rate below this blocks a NEW beta-blocker start and, on an established one, forces a one-step reduction. Engine policy except carvedilol's label 55. */
export const BB_HR_BELOW = 55;

/** eGFR below this is severe CKD for the engine's dose-limiting and start-dose rules (e.g. sacubitril/valsartan start dose). */
export const SEVERE_CKD_EGFR_BELOW = 30;

/** Low-output markers (isLowOutputState needs at least two of the three, with LVEF below `lvefBelow`). */
export const LOW_OUTPUT = { lvefBelow: 20, pulsePressureMax: 25, bunCrAbove: 20 } as const;
