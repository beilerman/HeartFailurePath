import { dedupeCurrentRegimen } from '../../services/engine/regimenUtils';
import { isActiveExposure } from '../../services/engine/medicationExposure';
import type { Patient, RegimenMed } from '../../types';
import { validatePatientForm } from '../patient-form/formValidation';

export const NOT_ENTERED = 'not entered';

/** Brand parentheses are dropped for compact display ("Sacubitril/Valsartan (Entresto)" -> "Sacubitril/Valsartan"). */
export const shortDrugName = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');
export const currentDrugNames = (p: Patient) => dedupeCurrentRegimen(p.current_regimen).regimen.filter(isActiveExposure).map(r => shortDrugName(r.med.name));

/** Use recorded as uncertain: status "use uncertain", or taking with partial or unknown consistency. A drug with nothing recorded is "not assessed", not uncertain. */
const useUncertain = (r: RegimenMed) => r.exposure?.status === 'unknown' || r.exposure?.adherence === 'partial' || r.exposure?.adherence === 'unknown';
/** The reconciled records (same duplicate rule as everywhere else): drugs counted as current (with the uncertain ones marked), then the held and the completed drugs by name. */
export function drugRecords(p: Patient) {
    const all = dedupeCurrentRegimen(p.current_regimen).regimen;
    const current = all.filter(isActiveExposure);
    const named = (status: 'held' | 'completed') => all.filter(r => r.exposure?.status === status).map(r => shortDrugName(r.med.name));
    return { current: current.map(r => `${shortDrugName(r.med.name)}${useUncertain(r) ? ' (use uncertain)' : ''}`), held: named('held'), completed: named('completed') };
}

const num = (v: number | undefined | null) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

export interface PatientFact { label: string; value: string; detail?: string; /** Drugs recorded as held or completed, by name ("held: Lisinopril"), shown beside the count of current drugs. */ held?: string; entered: boolean; invalid?: boolean }
export const NOT_ACCEPTED = 'not accepted: fix before running';

/** Values exactly as entered; a blank is "not entered", never 0. Shared by the results bar and the Review step. */
export function patientFacts(p: Patient, errors = validatePatientForm(p)): PatientFact[] {
    const age = num(p.age); const sex = p.sex;
    const sbp = num(p.sbp); const dbp = num(p.dbp);
    const lvef = num(p.lvef); const hr = num(p.pulse); const k = num(p.potassium); const egfr = num(p.egfr);
    const rec = drugRecords(p);
    const drugs = rec.current;
    const heldNote = [rec.held.length ? `held: ${rec.held.join(', ')}` : '', rec.completed.length ? `completed: ${rec.completed.join(', ')}` : ''].filter(Boolean).join('; ');
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
        { label: 'Current drugs', value: String(drugs.length), detail: drugs.join(', ') || (heldNote ? 'none taking' : 'none entered'), held: heldNote || undefined, entered: drugs.length > 0 || !!heldNote },
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
