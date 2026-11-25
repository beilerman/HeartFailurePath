/**
 * Change from a baseline creatinine: the ESC 2026 kidney rules for a RAAS inhibitor and an MRA (see thresholds.ts for the sources).
 * Pure. Returns null when either creatinine is blank (the behaviour before the optional `baseline_creatinine` input existed).
 * No engine imports other than thresholds: the contraindication checks (formulary) read it.
 */
import type { Patient } from '../../types';
import { valueUnknown, calculateCKDEPI } from '../clinicalPredicates';
import {
    CREATININE_RISE_ACCEPTABLE_PCT, CREATININE_RISE_STOP_PCT, EGFR_FALL_ACCEPTABLE_PCT, RAAS_EGFR_REVIEW_BELOW,
} from './thresholds';

export type CreatinineBand = 'none' | 'reduce' | 'stop';

export interface CreatinineChange {
    band: CreatinineBand;
    risePct: number;
    /** Percent fall in CKD-EPI eGFR from the baseline creatinine to the current one; null when it cannot be derived (age missing). */
    egfrFallPct: number | null;
    /** Plain-language one-line description of the change, e.g. "creatinine 1.0 to 1.7 mg/dL (+70%, eGFR fall 41%)". */
    summary: string;
    /** Why the band was reached (for the reason shown on a held or stopped drug). */
    why: string;
}

/** R12 D1: the rise and the eGFR fall are rounded to six decimals ONCE, here, before any comparison, so an exact 50% rise (0.8 to 1.2 is 49.999999999999986 in floating point) or an exact 100% rise reads as exactly that. Every consumer reads these rounded figures. */
const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * R13 E4: a percentage as printed beside a criterion. A figure that rounds to one of `thresholds` WITHOUT equalling it prints with as many decimals as it takes to differ from it (49.9%, 99.5%, 29.7%), so "50%" is never
 * said of a rise that is below 50% and "30%" is never said to meet "a fall above 30%"; a figure that equals the threshold, or is not near one, prints as a whole number.
 */
export const pctFigure = (x: number, thresholds: readonly number[]): string => {
    const near = thresholds.find(t => Math.round(x) === t);
    if (near === undefined || x === near) return `${Math.round(x)}%`;
    for (let d = 1; d <= 6; d++) { const s = x.toFixed(d); if (Number(s) !== near) return `${s}%`; }
    return `${x}%`;
};
/** R13 E4: a creatinine as entered, up to two decimals, trailing zeros trimmed to at least one decimal (1.12, 1.1, 1.0). */
export const creatinineText = (v: number): string => { const t = String(Number(v.toFixed(2))); return t.includes('.') ? t : `${t}.0`; };
const RISE_THRESHOLDS = [CREATININE_RISE_ACCEPTABLE_PCT, CREATININE_RISE_STOP_PCT] as const;

export function assessCreatinineChange(patient: Patient): CreatinineChange | null {
    const base = patient.baseline_creatinine;
    if (valueUnknown(base) || valueUnknown(patient.creatinine)) return null;
    const cur = patient.creatinine, b = base as number;
    const risePct = round6(((cur - b) / b) * 100);
    const eBase = calculateCKDEPI(b, patient.age, patient.sex), eCur = calculateCKDEPI(cur, patient.age, patient.sex);
    const egfrFallPct = eBase > 0 && eCur > 0 ? round6(((eBase - eCur) / eBase) * 100) : null;
    const currentEgfr = !valueUnknown(patient.egfr) ? patient.egfr : (eCur > 0 ? eCur : null);
    const summary = `creatinine ${creatinineText(b)} to ${creatinineText(cur)} mg/dL (${risePct >= 0 ? '+' : ''}${pctFigure(risePct, RISE_THRESHOLDS)}${egfrFallPct !== null ? `, derived eGFR fall ${pctFigure(egfrFallPct, [EGFR_FALL_ACCEPTABLE_PCT])}` : ''})`;

    if (risePct > CREATININE_RISE_STOP_PCT) {
        return { band: 'stop', risePct, egfrFallPct, summary, why: `creatinine more than ${CREATININE_RISE_STOP_PCT}% above baseline (${summary})` };
    }
    if (risePct >= CREATININE_RISE_ACCEPTABLE_PCT && currentEgfr !== null && currentEgfr < RAAS_EGFR_REVIEW_BELOW) {
        return { band: 'stop', risePct, egfrFallPct, summary, why: `creatinine ${CREATININE_RISE_ACCEPTABLE_PCT}% or more above baseline with eGFR ${currentEgfr} (below ${RAAS_EGFR_REVIEW_BELOW}) (${summary})` };
    }
    if (risePct >= CREATININE_RISE_ACCEPTABLE_PCT) {
        return { band: 'reduce', risePct, egfrFallPct, summary, why: `creatinine ${CREATININE_RISE_ACCEPTABLE_PCT}% or more above baseline (${summary})` };
    }
    if (egfrFallPct !== null && egfrFallPct > EGFR_FALL_ACCEPTABLE_PCT) {
        return { band: 'reduce', risePct, egfrFallPct, summary, why: `derived eGFR fall of more than ${EGFR_FALL_ACCEPTABLE_PCT}% from baseline (${summary})` };
    }
    return { band: 'none', risePct, egfrFallPct, summary, why: summary };
}

/**
 * R11 B7c: the sentence that says WHICH criterion put the patient in the "reduce" band: the creatinine rise (CREATININE_RISE_ACCEPTABLE_PCT or more), the derived eGFR fall (more than EGFR_FALL_ACCEPTABLE_PCT), or
 * both; the other figure is stated as not meeting its criterion alone. Wording only: the band is decided in `assessCreatinineChange`.
 */
export function reduceCriterionSentence(c: CreatinineChange): string {
    const riseMet = c.risePct >= CREATININE_RISE_ACCEPTABLE_PCT, fallMet = c.egfrFallPct !== null && c.egfrFallPct > EGFR_FALL_ACCEPTABLE_PCT;
    // A figure that rounds to its own threshold WITHOUT equalling it is printed with one decimal, so "30%" is never said to meet "a fall above 30%" (or "50%" to fall short of "50% or more"); a figure that equals the threshold prints as a whole number (R12 D1).
    const rise = pctFigure(c.risePct, RISE_THRESHOLDS), fall = c.egfrFallPct === null ? '' : pctFigure(c.egfrFallPct, [EGFR_FALL_ACCEPTABLE_PCT]); // R13 E4: one shared rule for every printed rise and fall
    if (riseMet && fallMet) return `The creatinine rise of ${rise} and the derived eGFR fall of ${fall} each meet the 2026 ESC criteria (a rise of ${CREATININE_RISE_ACCEPTABLE_PCT}% or more, a fall above ${EGFR_FALL_ACCEPTABLE_PCT}%).`;
    if (fallMet) return `The derived eGFR fall of ${fall} meets the 2026 ESC criterion (a fall above ${EGFR_FALL_ACCEPTABLE_PCT}%); the creatinine rise of ${rise} alone would not.`;
    return `The creatinine rise of ${rise} meets the 2026 ESC criterion (a rise of ${CREATININE_RISE_ACCEPTABLE_PCT}% or more)${c.egfrFallPct !== null ? `; the derived eGFR fall of ${fall} alone would not` : ''}.`;
}

/** True when the 2026 ESC "acceptable" criteria hold and eGFR is 20 or higher (below 20 the eGFR alert speaks instead), so an early dip needs reassurance, not action. */
export const creatinineRiseIsAcceptable = (c: CreatinineChange | null, egfr: number): boolean =>
    c !== null && c.band === 'none' && c.risePct > 0 && (valueUnknown(egfr) || egfr >= RAAS_EGFR_REVIEW_BELOW);
