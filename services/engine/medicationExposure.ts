import type { MedicationExposure, RegimenMed } from '../../types';

const validDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
    && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;

/** Today's date as the user's calendar shows it (R13 E5(g)): the local year, month and day, not the UTC date, which is already tomorrow for a user east of Greenwich in the evening and still yesterday for one west of it in the morning. */
const localCalendarDate = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function exposureErrors(e: MedicationExposure | undefined, mode: 'review' | 'draft' = 'review'): string[] {
    if (e === undefined) return [];
    if (!e || typeof e !== 'object' || Array.isArray(e)) return ['Exposure history must be an object.'];
    const errors: string[] = [];
    if (e.status !== undefined && !['active','held','completed','unknown'].includes(e.status)) errors.push('Select an exposure status.');
    if (e.adherence !== undefined && !['consistent','partial','unknown'].includes(e.adherence)) errors.push('Select a medication-use assessment.');
    for (const field of ['started_on','dose_changed_on','last_dose_on'] as const) {
        const value = e[field];
        if (value === undefined) continue;
        if (typeof value !== 'string' || (mode === 'review' && !validDate(value))) errors.push(`${field} must be a valid calendar date.`);
        else if (mode === 'review' && value > localCalendarDate()) errors.push(`${field} cannot be a future exposure date.`);
    }
    if (mode === 'review') {
        if (e.started_on && e.dose_changed_on && e.started_on > e.dose_changed_on) errors.push('The dose-change date precedes the start date.');
        if (e.last_dose_on && e.started_on && e.last_dose_on < e.started_on) errors.push('The last dose precedes the start date.');
        if (e.last_dose_on && e.dose_changed_on && e.last_dose_on < e.dose_changed_on) errors.push('The last dose precedes the current-dose date.');
    }
    if (e.dose_interval_reviewed !== undefined && typeof e.dose_interval_reviewed !== 'boolean') errors.push('Dose interval review must be an explicit yes/no assessment.');
    if (e.restart_or_repeat_reviewed !== undefined && typeof e.restart_or_repeat_reviewed !== 'boolean') errors.push('Restart/repeat review must be an explicit yes/no assessment.');
    return errors;
}

export const isActiveExposure = (r: RegimenMed) => r.exposure?.status !== 'held' && r.exposure?.status !== 'completed';
export const copyExposure = (e: MedicationExposure | undefined): MedicationExposure | undefined => e ? {
    status: e.status, adherence: e.adherence, started_on: e.started_on, dose_changed_on: e.dose_changed_on, last_dose_on: e.last_dose_on, restart_or_repeat_reviewed: e.restart_or_repeat_reviewed, dose_interval_reviewed: e.dose_interval_reviewed,
} : undefined;
