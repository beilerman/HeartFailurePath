import type { Patient } from '../../types';

export const NOT_ENTERED = 'not entered';

/** Brand parentheses are dropped for compact display ("Sacubitril/Valsartan (Entresto)" -> "Sacubitril/Valsartan"). */
export const shortDrugName = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');
export const currentDrugNames = (p: Patient) => p.current_regimen.map(r => shortDrugName(r.med.name));

const num = (v: number | undefined | null) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

export interface PatientFact { label: string; value: string; detail?: string; entered: boolean }

/** Values exactly as entered; a blank is "not entered", never 0. Shared by the results bar and the Review step. */
export function patientFacts(p: Patient): PatientFact[] {
    const age = num(p.age); const sex = p.sex;
    const sbp = num(p.sbp); const dbp = num(p.dbp);
    const lvef = num(p.lvef); const hr = num(p.pulse); const k = num(p.potassium); const egfr = num(p.egfr);
    const drugs = currentDrugNames(p);
    const f = (label: string, value: string | undefined, detail?: string): PatientFact => ({ label, value: value ?? NOT_ENTERED, detail, entered: value !== undefined });
    const base = [
        f('Age and sex', age || sex ? `${age ? `${age} years` : 'age not entered'}, ${sex ? sex.toLowerCase() : 'sex not entered'}` : undefined),
        f('LVEF', lvef !== undefined ? `${lvef}%` : undefined),
        f('NYHA class', p.nyha_class || undefined),
        f('Blood pressure (mmHg)', sbp !== undefined && dbp !== undefined ? `${sbp}/${dbp}` : undefined),
        f('Heart rate', hr !== undefined ? `${hr} bpm` : undefined),
        f('Potassium (mEq/L)', k !== undefined ? k.toFixed(1) : undefined),
        f('eGFR (mL/min/1.73 m²)', egfr !== undefined ? `${Math.round(egfr)}` : undefined),
        { label: 'Current drugs', value: String(drugs.length), detail: drugs.join(', ') || 'none entered', entered: drugs.length > 0 },
    ];
    return base;
}

/** What the Review step shows under "What you entered": only items that have a value, plus rhythm and weights. */
export function enteredFacts(p: Patient): PatientFact[] {
    const cw = num(p.volume_status?.current_weight_kg); const dw = num(p.volume_status?.dry_weight_kg);
    const extra: PatientFact[] = [
        { label: 'Rhythm', value: p.rhythm ?? NOT_ENTERED, entered: !!p.rhythm },
        { label: 'Current weight (kg)', value: cw !== undefined ? String(cw) : NOT_ENTERED, entered: cw !== undefined },
        { label: 'Dry weight (kg)', value: dw !== undefined ? String(dw) : NOT_ENTERED, entered: dw !== undefined },
    ];
    return [...patientFacts(p), ...extra].filter(f => f.entered);
}
