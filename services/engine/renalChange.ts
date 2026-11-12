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

const round0 = (x: number) => Math.round(x);

export function assessCreatinineChange(patient: Patient): CreatinineChange | null {
    const base = patient.baseline_creatinine;
    if (valueUnknown(base) || valueUnknown(patient.creatinine)) return null;
    const cur = patient.creatinine, b = base as number;
    const risePct = ((cur - b) / b) * 100;
    const eBase = calculateCKDEPI(b, patient.age, patient.sex), eCur = calculateCKDEPI(cur, patient.age, patient.sex);
    const egfrFallPct = eBase > 0 && eCur > 0 ? ((eBase - eCur) / eBase) * 100 : null;
    const currentEgfr = !valueUnknown(patient.egfr) ? patient.egfr : (eCur > 0 ? eCur : null);
    const summary = `creatinine ${b.toFixed(1)} to ${cur.toFixed(1)} mg/dL (${risePct >= 0 ? '+' : ''}${round0(risePct)}%${egfrFallPct !== null ? `, derived eGFR fall ${round0(egfrFallPct)}%` : ''})`;

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

/** True when the 2026 ESC "acceptable" criteria hold and eGFR is 20 or higher (below 20 the eGFR alert speaks instead), so an early dip needs reassurance, not action. */
export const creatinineRiseIsAcceptable = (c: CreatinineChange | null, egfr: number): boolean =>
    c !== null && c.band === 'none' && c.risePct > 0 && (valueUnknown(egfr) || egfr >= RAAS_EGFR_REVIEW_BELOW);
