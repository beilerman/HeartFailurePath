/**
 * New-start dose rule for sacubitril/valsartan (Entresto label sections 2.2, 2.7, 2.8; verified-raas.md S1-S3).
 *
 * Standard adult start is 49/51 mg bid. The start is HALVED (24/26 mg bid) when the patient is not taking an
 * ACE inhibitor or ARB, or takes a LOW dose of one, when eGFR is below 30, or with moderate hepatic impairment
 * (Child-Pugh B). 97/103 mg is reached only by up-titration (every 2-4 weeks), never as a start.
 *
 * "Low dose" (the label's phrase) is defined per agent as data on the ACEi/ARB entry
 * (`facts.low_dose_max_daily_mg`, total daily dose). No imports from the engine facade; constants.ts imports this.
 */
import type { Patient } from '../../types';
import { drugFacts } from './drugFacts';
import { hasChildPughBConfirmed } from './contraindications';
import { SEVERE_CKD_EGFR_BELOW } from './thresholds';

const DOSES_PER_DAY: Record<string, number> = { qd: 1, bid: 2, tid: 3 };

/** Total daily dose (mg) of a current ACEi/ARB. */
function dailyMg(strength: number | string, frequency: string): number {
    return Number(strength) * (DOSES_PER_DAY[frequency] ?? 1);
}

/** True when the patient takes no ACEi/ARB, or every ACEi/ARB they take is at or below its low-dose ceiling. */
export function raasNaiveOrLowDose(p: Patient): boolean {
    const onRaas = (p.current_regimen ?? []).filter(r => r.med.drug_class === 'ACEi' || r.med.drug_class === 'ARB');
    if (onRaas.length === 0) return true;
    return onRaas.every(r => {
        const ceiling = drugFacts(r.med).low_dose_max_daily_mg;
        return ceiling !== undefined && dailyMg(r.dose.strength, r.selected_frequency) <= ceiling;
    });
}

/** Why the ARNI start is halved for this patient (empty when the standard start applies). A blank eGFR (0) counts as below 30: be conservative. */
export function arniReducedStartReasons(p: Patient): string[] {
    const reasons: string[] = [];
    if (raasNaiveOrLowDose(p)) reasons.push('not taking an ACE inhibitor or ARB, or taking only a low dose of one');
    if (p.egfr < SEVERE_CKD_EGFR_BELOW) reasons.push('eGFR below 30 (or not entered)');
    if (hasChildPughBConfirmed(p)) reasons.push('moderate hepatic impairment (Child-Pugh B)');
    return reasons;
}

/** `start_dose_for` for the ARNI: the highest strength a new start may begin at. */
export const arniStartDose = (p: Patient): string => (arniReducedStartReasons(p).length > 0 ? '24/26' : '49/51');
