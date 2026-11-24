import { PATIENT_RHYTHMS, type Patient } from '../../types';
import { exposureErrors } from '../../services/engine/medicationExposure';

// Missing observations narrow the decision scope; only invalid entered values block a review.
export const REQUIRED_FIELDS: ReadonlySet<string> = new Set();
const VALIDATION_BOUNDS: Record<string, { min: number; max: number; label: string }> = {
    age: { min: 18, max: 120, label: 'Age' },
    height_cm: { min: 100, max: 250, label: 'Height' },
    sbp: { min: 50, max: 250, label: 'SBP' },
    dbp: { min: 20, max: 150, label: 'DBP' },
    pulse: { min: 20, max: 250, label: 'Pulse' },
    lvef: { min: 5, max: 80, label: 'LVEF' },
    nt_pro_bnp: { min: 0, max: 50000, label: 'NT-proBNP' },
    kccq_score: { min: 0, max: 100, label: 'KCCQ' },
    potassium: { min: 2.0, max: 8.0, label: 'K+' },
    creatinine: { min: 0.2, max: 15, label: 'Creatinine' },
    baseline_creatinine: { min: 0.2, max: 15, label: 'Baseline creatinine' },
    bun: { min: 2, max: 200, label: 'BUN' },
    ferritin: { min: 1, max: 2000, label: 'Ferritin' },
    tsat: { min: 1, max: 100, label: 'TSAT' },
    hemoglobin: { min: 3, max: 25, label: 'Hemoglobin' },
    oxygen_saturation: { min: 50, max: 100, label: 'SpO2' },
    lvedd: { min: 20, max: 100, label: 'LVEDD' },
    lavi: { min: 10, max: 80, label: 'LAVI' },
    dry_weight_kg: { min: 25, max: 300, label: 'Dry Weight' },
    current_weight_kg: { min: 25, max: 350, label: 'Current Weight' },
    previous_lvef: { min: 5, max: 85, label: 'Prior LVEF' },
    daily_step_count: { min: 0, max: 50000, label: 'Daily Steps' },
    peak_flow_lpm: { min: 50, max: 900, label: 'Peak Flow' },
    max_affordable_cost: { min: 0, max: 100000, label: 'Monthly Budget' },
};

// Shared by Common and every run entry point so labels and validation agree.
// Potassium and creatinine may be left blank: the engine reads a blank as "not entered".
const BLANK_MEANS_NOT_ENTERED = new Set(['potassium', 'creatinine', 'baseline_creatinine']);


const REQUIRED_CHOICES: Record<string, readonly string[]> = {
    sex: ['Male','Female'], race: ['White','Black','Asian','Hispanic','Other'],
    nyha_class: ['I','II','III','IV'], rhythm: PATIENT_RHYTHMS, insurance_tier: ['cash','commercial','medicare'],
};
const CHOICE_LABELS: Record<string,string> = { sex:'sex used for renal estimation',race:'self-reported race',nyha_class:'NYHA functional class',rhythm:'rhythm',insurance_tier:'pricing profile' };

export function validatePatientForm(patientData: Patient): Record<string, string> {
    const errors: Record<string, string> = {};
    patientData.current_regimen.forEach((r,i) => {
        const found = exposureErrors(r.exposure);
        if (found.length) errors[`medication_exposure_${i}`] = `${r.med.name}: ${found.join(' ')}`;
    });
    const check = (field: string, value: number | undefined) => {
        const bounds = VALIDATION_BOUNDS[field];
        if (!bounds) return;
        if (BLANK_MEANS_NOT_ENTERED.has(field) && (value === undefined || value === null || Number.isNaN(value) || value === 0)) return;
        if (value === undefined || value === null || Number.isNaN(value)) {
            if (REQUIRED_FIELDS.has(field)) errors[field] = `${bounds.label} is required`;
            return;
        }
        if (value < bounds.min || value > bounds.max) {
            errors[field] = `${bounds.label} must be ${bounds.min}–${bounds.max}`;
        }
    };
    check('age', patientData.age);
    check('height_cm', patientData.height_cm);
    check('sbp', patientData.sbp);
    check('dbp', patientData.dbp);
    check('pulse', patientData.pulse);
    check('lvef', patientData.lvef);
    check('nt_pro_bnp', patientData.nt_pro_bnp);
    check('kccq_score', patientData.kccq_score);
    check('potassium', patientData.potassium);
    if (patientData.potassium > VALIDATION_BOUNDS.potassium.max) {
        errors.potassium = 'Potassium exceeds the supported range. Verify the result and units immediately. If accurate, this is a hyperkalemic emergency requiring urgent hospital assessment.';
    }
    check('creatinine', patientData.creatinine);
    check('baseline_creatinine', patientData.baseline_creatinine);
    check('bun', patientData.bun);
    check('ferritin', patientData.ferritin);
    check('tsat', patientData.tsat);
    check('hemoglobin', patientData.hemoglobin);
    check('oxygen_saturation', patientData.oxygen_saturation);
    check('lvedd', patientData.lvedd);
    check('lavi', patientData.lavi);
    check('dry_weight_kg', patientData.volume_status.dry_weight_kg);
    check('current_weight_kg', patientData.volume_status.current_weight_kg);
    check('previous_lvef', patientData.previous_lvef);
    check('daily_step_count', patientData.daily_step_count);
    check('peak_flow_lpm', patientData.peak_flow_lpm);
    check('max_affordable_cost', patientData.max_affordable_cost);
    if (patientData.sbp !== undefined && patientData.dbp !== undefined && patientData.sbp <= patientData.dbp) {
        errors.sbp = 'SBP must be greater than DBP';
        errors.dbp = 'DBP must be lower than SBP';
    }
    for (const [field, choices] of Object.entries(REQUIRED_CHOICES)) {
            const value = patientData[field as keyof Patient];
            if (value !== undefined && !choices.includes(String(value))) errors[field] = `Select ${CHOICE_LABELS[field]}`;
    }
    return errors;
}
