import type { FormSectionId } from '../patient-form/usePatientFormModel';

/** The guided steps, in order. Every step is reachable at any time; nothing is locked. */
export const STEPS: ReadonlyArray<{ id: string; label: string; sections: readonly FormSectionId[] }> = [
    { id: 'patient', label: 'Patient and symptoms', sections: ['patient-demographics', 'patient-symptoms'] },
    { id: 'vitals', label: 'Vitals and exam', sections: ['patient-exam'] },
    { id: 'labs', label: 'Labs and echo', sections: ['patient-diagnostics'] },
    { id: 'history', label: 'History and allergies', sections: ['patient-history', 'patient-scope'] },
    { id: 'medications', label: 'Current medications', sections: ['patient-medications'] },
    { id: 'preferences', label: 'Preferences', sections: ['patient-social'] },
    { id: 'review', label: 'Review', sections: [] },
];
export const REVIEW_STEP = STEPS.length - 1;

const FIELD_STEP: Record<string, number> = {
    age: 0, sex: 0, race: 0, height_cm: 0, is_pregnant: 0, nyha_class: 0, kccq_score: 0, daily_step_count: 0,
    sbp: 1, dbp: 1, pulse: 1, oxygen_saturation: 1, rhythm: 1, dry_weight_kg: 1, current_weight_kg: 1,
    lvef: 2, previous_lvef: 2, nt_pro_bnp: 2, lvedd: 2, lavi: 2, potassium: 2, creatinine: 2, baseline_creatinine: 2, bun: 2,
    ferritin: 2, tsat: 2, hemoglobin: 2, peak_flow_lpm: 2,
    'patient-history': 3, 'patient-scope': 3,
    'add-medication-drug': 4,
    insurance_tier: 5, max_affordable_cost: 5,
};

/** The step that holds a form field (a validation key, or the id of an unfinished-entry area). */
export function stepForField(field: string): number {
    if (field in FIELD_STEP) return FIELD_STEP[field];
    if (field.startsWith('medication_exposure_')) return 4;
    return 0;
}
