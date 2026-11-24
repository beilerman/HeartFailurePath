import type { RegimenMed } from '../../types';

// "Confirm all as taking as recorded" (T17). It changes ONLY drugs whose use has not been assessed at all (no use status and no consistency recorded). A drug the clinician
// recorded as held, uncertain, partial or interrupted, or as taking with a consistency already entered, is never changed by it.

type Exposure = NonNullable<RegimenMed['exposure']>;

/** Plain words for a recorded use status, as the form's own options read. */
export function useStatusWords(e: RegimenMed['exposure']): string {
    switch (e?.status) {
        case 'active': return 'taking as recorded';
        case 'held': return 'held: restart needs review';
        case 'unknown': return 'current use uncertain';
        case 'completed': return 'course completed';
        default: return 'not assessed';
    }
}
const consistencyWords = (a: Exposure['adherence']): string => a === 'consistent' ? 'consistent use confirmed' : a === 'partial' ? 'partial or interrupted use' : a === 'unknown' ? 'consistency unknown' : 'consistency not assessed';

/** True when nothing about the drug's use has been recorded yet. */
export const isUseNotAssessed = (r: RegimenMed): boolean => r.exposure?.status === undefined && r.exposure?.adherence === undefined;
/** True when the drug is already confirmed as taken as recorded with consistent use. */
export const isUseConfirmed = (r: RegimenMed): boolean => r.exposure?.status === 'active' && r.exposure?.adherence === 'consistent';

export interface ConfirmResult {
    regimen: RegimenMed[];
    confirmed: string[];
    /** Drugs that are not confirmed and were left exactly as recorded, each with what is recorded. */
    leftAlone: { name: string; recorded: string }[];
}
/** The regimen after the control: unassessed drugs become "taking as recorded" with consistent use; every other drug is returned unchanged. */
export function confirmUnassessedUse(regimen: RegimenMed[]): ConfirmResult {
    const confirmed: string[] = [];
    const leftAlone: ConfirmResult['leftAlone'] = [];
    const next = regimen.map(r => {
        if (isUseNotAssessed(r)) { confirmed.push(r.med.name); return { ...r, exposure: { ...r.exposure, status: 'active' as const, adherence: 'consistent' as const } }; }
        if (!isUseConfirmed(r)) leftAlone.push({ name: r.med.name, recorded: `${useStatusWords(r.exposure)}; ${consistencyWords(r.exposure?.adherence)}` });
        return r;
    });
    return { regimen: next, confirmed, leftAlone };
}

/** What a dose or frequency edit does to a drug's use record: require fresh confirmation of the new dose while preserving explicit held, completed or uncertain status (T17). */
export function exposureAfterDoseEdit(e: RegimenMed['exposure']): RegimenMed['exposure'] {
    if (!e) return e;
    // Correcting a historical strength cannot restart a held drug or repeat a completed course.
    const status = e.status === 'active' ? undefined : e.status;
    return { status, started_on: e.started_on, last_dose_on: e.last_dose_on };
}
