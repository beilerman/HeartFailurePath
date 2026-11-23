/**
 * Sentence-case helper (R7 W7). A sentence that opens with an abbreviation or unit written in lower or mixed case by convention (eGFR, mg, mmol, mEq, mmHg, bpm) keeps its case:
 * "EGFR not entered" was wrong. Every place that capitalizes the first letter of a displayed sentence uses this one function.
 */
export const LOWER_CASE_OPENERS = /^(eGFR|mg|mcg|mmol|mEq|mmHg|bpm|kg|mL|dL|ng|pg|mIU|mU|pH)\b/;
export const capitalizeSentence = (t: string): string => (LOWER_CASE_OPENERS.test(t) || t.length === 0 ? t : t.charAt(0).toUpperCase() + t.slice(1));
