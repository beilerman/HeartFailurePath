import { dedupeCurrentRegimen } from '../../services/engine/regimenUtils';
import { isActiveExposure } from '../../services/engine/medicationExposure';
import type { Patient } from '../../types';
import { validatePatientForm } from '../patient-form/formValidation';

export const NOT_ENTERED = 'not entered';

/** Brand parentheses are dropped for compact display ("Sacubitril/Valsartan (Entresto)" -> "Sacubitril/Valsartan"). */
export const shortDrugName = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');
export const currentDrugNames = (p: Patient) => dedupeCurrentRegimen(p.current_regimen).regimen.filter(isActiveExposure).map(r => shortDrugName(r.med.name));

const num = (v: number | undefined | null) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

export interface PatientFact { label: string; value: string; detail?: string; entered: boolean; invalid?: boolean }
export const NOT_ACCEPTED = 'not accepted: fix before running';

/** Values exactly as entered; a blank is "not entered", never 0. Shared by the results bar and the Review step. */
export function patientFacts(p: Patient, errors = validatePatientForm(p)): PatientFact[] {
    const age = num(p.age); const sex = p.sex;
    const sbp = num(p.sbp); const dbp = num(p.dbp);
    const lvef = num(p.lvef); const hr = num(p.pulse); const k = num(p.potassium); const egfr = num(p.egfr);
    const drugs = currentDrugNames(p);
    const f = (label: string, value: string | undefined, detail?: string, ...fields: string[]): PatientFact => fields.some(x => errors[x])
        ? { label, value: NOT_ACCEPTED, detail, entered: true, invalid: true }
        : { label, value: value ?? NOT_ENTERED, detail, entered: value !== undefined };
    const base = [
        f('Age and sex', age || sex ? `${age ? `${age} years` : 'age not entered'}, ${sex ? sex.toLowerCase() : 'sex not entered'}` : undefined, undefined, 'age'),
        f('LVEF', lvef !== undefined ? `${lvef}%` : undefined, undefined, 'lvef'),
        f('NYHA class', p.nyha_class || undefined),
        f('Blood pressure (mmHg)', sbp !== undefined && dbp !== undefined ? `${sbp}/${dbp}` : undefined, undefined, 'sbp', 'dbp'),
        f('Heart rate', hr !== undefined ? `${hr} bpm` : undefined, undefined, 'pulse'),
        f('Potassium (mEq/L)', k !== undefined ? k.toFixed(1) : undefined, undefined, 'potassium'),
        f('eGFR (mL/min/1.73 m²)', egfr !== undefined ? `${Math.round(egfr)}` : undefined, undefined, 'age', 'creatinine'),
        { label: 'Current drugs', value: String(drugs.length), detail: drugs.join(', ') || 'none entered', entered: drugs.length > 0 },
    ];
    return base;
}

/** What the Review step shows under "What you entered": only items that have a value, plus rhythm and weights. */
export function enteredFacts(p: Patient): PatientFact[] {
    const errors = validatePatientForm(p);
    const weight = (field: 'current_weight_kg' | 'dry_weight_kg', label: string): PatientFact => {
        const value = num(p.volume_status[field]);
        return errors[field] ? { label, value: NOT_ACCEPTED, entered: true, invalid: true }
            : { label, value: value === undefined ? NOT_ENTERED : String(value), entered: value !== undefined };
    };
    const extra: PatientFact[] = [
        { label: 'Rhythm', value: p.rhythm ?? NOT_ENTERED, entered: !!p.rhythm },
        weight('current_weight_kg', 'Current weight (kg)'),
        weight('dry_weight_kg', 'Dry weight (kg)'),
    ];
    return [...patientFacts(p, errors), ...extra].filter(f => f.entered);
}
