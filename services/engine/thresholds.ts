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
 * A NEW MRA start is withheld at this potassium or higher (rule E15), with or without a potassium binder: start once potassium is BELOW it.
 * Sources: 2022 AHA/ACC/HFSA section 7.3.3 (primary text read 2026-11-11): "eGFR 30 or below or serum potassium 5.0 mEq/L or above are contraindications to MRA
 * initiation"; 2026 ESC section 6.1 "caution" at 5.0 or above; Aldactone label "serum potassium <=5.0" and Kerendia label "do not initiate ... > 5.0" are looser
 * at exactly 5.0, so the engine keeps the STRICTER (guideline) boundary, the same for every MRA. The eplerenone label's looser K > 5.5 start contraindication
 * does not govern. Before 2026-11-11 (second pass) the rule withheld only above 5.0.
 */
export const MRA_START_K_CEILING = 5.0;
/** A NEW steroidal MRA start is contraindicated at eGFR at or below this (2022 AHA/ACC/HFSA 7.3.3: "eGFR 30 or below"; eplerenone label CrCl 30 or less). Continuation is not affected. */
export const MRA_START_EGFR_MAX = 30;
/**
 * eGFR below this (31-49 in whole numbers) halves the steroidal MRA dose: a new start begins at the lowest tier and the dose is capped at 25 mg (half the 50 mg target)
 * (2022 AHA/ACC/HFSA 7.3.3 "halve the dosing at eGFR 31-49"). The Aldactone label's start boundary (25 mg daily only if eGFR is above 50) is stricter for the START and is kept.
 */
export const MRA_HALVE_DOSE_EGFR_BELOW = 50;
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
/**
 * Change from a BASELINE creatinine (2026 ESC section 6.1.6 / 10.3 and Supplementary Tables S4, S5, S8; optional input `baseline_creatinine`):
 *  - creatinine rise of CREATININE_RISE_ACCEPTABLE_PCT (50%) or more, or an eGFR fall of more than EGFR_FALL_ACCEPTABLE_PCT (30%, S4/S5/S8), persisting after other
 *    offending drugs are stopped: halve the RAAS inhibitor and the MRA (one dose step), recheck in 1-2 weeks, no increase;
 *  - creatinine rise over CREATININE_RISE_STOP_PCT (100%, S4), or a rise of 50% or more with current eGFR below RAAS_EGFR_REVIEW_BELOW (20): stop the RAAS inhibitor,
 *    withhold the MRA, seek specialist advice.
 * The main text (creatinine under 50%) and the supplement (eGFR fall under 30%) differ; the engine applies EITHER trigger (the stricter). The eGFR fall is derived
 * from creatinine with the same CKD-EPI 2021 equation the form uses (current vs baseline creatinine, same age and sex).
 */
export const EGFR_FALL_ACCEPTABLE_PCT = 30;
export const CREATININE_RISE_STOP_PCT = 100;

/**
 * eGFR below this on a RAAS inhibitor raises an ALERT, never a forced stop (2026 ESC Supplementary Table S4: stop an ACE inhibitor/ARB and seek specialist advice when
 * eGFR FALLS below 20 or creatinine rises more than 100%; the guideline also says stopping is "very rarely necessary", that withdrawal risks deterioration, and
 * section 6.1.6 allows temporary discontinuation in acute kidney injury with eGFR below 15). The tables describe a CHANGE from baseline; the tool has only the current
 * value and cannot tell a new fall from stable CKD 4, so it must not remove a long-established inhibitor on the number alone. Corrected 2026-11-11: an earlier pass
 * stopped the class at current eGFR below 20. A blank eGFR is never treated as below 20. New starts keep their existing label renal gates.
 */
export const RAAS_EGFR_REVIEW_BELOW = 20;

/**
 * Potassium above this is the ESC "caution" threshold for STARTING an ACE inhibitor, ARB or ARNI (2026 ESC Supplementary Tables S4/S5: seek specialist advice if potassium
 * is above 5.2). Withholding a NEW RAAS start above it (rule E18) and staging the start is ENGINE POLICY: the guideline says caution, not "do not start". Applies only
 * when the patient is on no ACE inhibitor, ARB or ARNI; a swap within the pool is not a new start. The block above RAAS_START_K_MAX (5.4) is unchanged.
 */
export const RAAS_START_K_CAUTION = 5.2;

/** Potassium below this is hypokalemia (digoxin contraindication; projected-K+ warning). */
export const HYPOKALEMIA_K_BELOW = 3.5;

/**
 * Resting heart rate below which a NEW beta-blocker start is blocked and an established one is reduced one step. Per drug (facts.hr_continuation / the start check):
 * carvedilol 55 (Coreg label: reduce below 55); metoprolol succinate and bisoprolol 50 (2026 ESC Supplementary Table S6: caution before starting below 50; on
 * treatment lower the dose if below 50 with worsening symptoms; their labels give no number). The engine has no worsening-symptoms qualifier for bradycardia, so the
 * reduction applies on heart rate alone. BB_HR_BELOW stays the highest (carvedilol) value, used for the form hint.
 */
export const BB_HR_BELOW = 55;
export const BB_HR_BELOW_ESC = 50;

/** eGFR below this is severe CKD for the engine's dose-limiting and start-dose rules (e.g. sacubitril/valsartan start dose). */
export const SEVERE_CKD_EGFR_BELOW = 30;

/**
 * 2026 ESC Table 11: sacubitril/valsartan starts at 49/51 mg twice daily, with 24/26 mg "optional" after prior symptomatic hypotension, in ACEi/ARB-naive patients, or
 * at eGFR 30-60. The Entresto label halves the start only below 30 (plus naive/low dose and Child-Pugh B). The engine keeps the STRICTER of the two: 24/26 below eGFR 60.
 */
export const ARNI_REDUCED_START_EGFR_BELOW = 60;

/** Low-output markers (isLowOutputState needs at least two of the three, with LVEF below `lvefBelow`). */
export const LOW_OUTPUT = { lvefBelow: 20, pulsePressureMax: 25, bunCrAbove: 20 } as const;
