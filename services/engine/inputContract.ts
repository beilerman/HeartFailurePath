/** Validate imported/API inputs before cloning or invoking any medication function.
 * The form is not a trust boundary. Clinical data gaps keep their established sentinel handling;
 * missing scoring controls and malformed medication identities must not produce a ranked plan.
 */
import { PATIENT_RHYTHMS, type Patient, type RegimenMed } from '../../types';
import { MEDICATION_FORMULARY, RELEVANT_COMORBIDITIES, RELEVANT_EXTERNAL_MEDICATIONS } from '../../constants';
import { isExamFinding } from '../clinicalPredicates';
import { isScopeLabel } from './scopeGate';
import { exposureErrors, copyExposure } from './medicationExposure';

const indexedLabels = (names: readonly string[]) => new Map(names.map(name => [name.toLowerCase(), name]));
const conditions = indexedLabels(RELEVANT_COMORBIDITIES);
const medications = indexedLabels(RELEVANT_EXTERNAL_MEDICATIONS);

/** Preserve unmodelled history, but match the same recorded drug or condition regardless of case and surrounding whitespace. */
export function reconciledHistory(patient: Patient) {
    const labels = (values: Set<string> | undefined, index: Map<string, string>) =>
        new Set(values instanceof Set ? [...values].filter(v => typeof v === 'string').map(v => index.get(v.trim().toLowerCase()) ?? v) : []);
    return { comorbidities: labels(patient?.comorbidities, conditions), external_medications: labels(patient?.external_medications, medications) };
}

export function validateEngineInput(patient: Patient, mode: 'review' | 'draft' = 'review'): { errors: string[]; regimen: RegimenMed[] } {
    // A saved form may contain an out-of-range numeric or date entry that the user is still correcting.
    const review = mode === 'review';
    const errors: string[] = [], regimen: RegimenMed[] = [];
    const fail = (message: string) => errors.push(`INPUT ERROR: ${message}`);
    if (!patient || typeof patient !== 'object') return { errors: ['INPUT ERROR: Patient data are required.'], regimen };
    if (patient.assessment_basis !== undefined && patient.assessment_basis !== 'observed') fail('A proposed regimen is not a follow-up observation. Enter reassessed medication use and measurements before a new clinical evaluation.');
    for (const field of ['cost_sensitivity', 'complexity_tolerance', 'max_new_classes_per_visit'] as const) {
        const value = patient[field];
        if (typeof value !== 'number' || !Number.isFinite(value) || (review && value < 0)) fail(`${field} must be a finite, non-negative number.`);
    }
    if (patient.kccq_score !== undefined && (!Number.isFinite(patient.kccq_score) || (review && (patient.kccq_score < 0 || patient.kccq_score > 100)))) fail('KCCQ must be between 0 and 100, or left blank.');
    if (patient.kccq_instrument !== undefined && !['CSS','TSS','OSS','unknown'].includes(patient.kccq_instrument)) fail('Select a supported KCCQ instrument or leave it unknown.');
    for (const field of ['age', 'height_cm', 'dbp', 'max_affordable_cost'] as const) {
        const value = patient[field];
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || (review && value < 0))) fail(`${field} must be a finite, non-negative number or left blank.`);
    }
    if (review && patient.age > 0 && patient.age < 18) fail('This model is limited to adults aged 18 years or older.');
    for (const field of ['cost_sensitivity', 'complexity_tolerance'] as const) {
        if (review && patient[field] > 10) fail(`${field} must be between 0 and 10.`);
    }
    for (const [field, value] of Object.entries(patient)) {
        // NaN in established lab/vital sentinels is handled in auditInputs; Infinity is never an unknown value.
        if (typeof value === 'number' && !Number.isNaN(value) && !Number.isFinite(value)) fail(`${field} is not finite.`);
    }
    // Preserve existing blank/NaN clinical sentinels, but never coerce text, booleans or objects into physiology.
    for (const field of ['sbp', 'pulse', 'lvef', 'nt_pro_bnp', 'bun', 'creatinine', 'egfr', 'potassium', 'bmi'] as const) {
        const value = patient[field];
        if (value !== undefined && value !== null && typeof value !== 'number') fail(`${field} must be numeric or left blank.`);
    }
    for (const field of ['daily_step_count', 'lvedd', 'lavi', 'oxygen_saturation', 'ferritin', 'tsat', 'hemoglobin', 'peak_flow_lpm', 'baseline_creatinine', 'previous_lvef'] as const) {
        const value = patient[field];
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || (review && value < 0))) fail(`${field} must be a valid number or left blank.`);
    }
    if (patient.scope_conditions !== undefined && (!(patient.scope_conditions instanceof Set) || [...patient.scope_conditions].some(v => typeof v !== 'string'))) fail('scope_conditions must be a set of text entries or left unanswered.');
    else if (patient.scope_conditions && [...patient.scope_conditions].some(v => !isScopeLabel(v))) fail('Unrecognized scope condition. Reconcile the scope question before running a medication review.');
    for (const field of ['ever_lvef_le_40', 'recent_hf_worsening_within_6mo'] as const) {
        if (patient[field] !== undefined && !['yes', 'no', 'unknown'].includes(patient[field]!)) fail(`${field} must be yes, no, unknown or left unanswered.`);
    }
    if (patient.race !== undefined && !['White', 'Black', 'Asian', 'Hispanic', 'Other'].includes(patient.race)) fail('Select a supported race or leave it blank.');
    if (patient.insurance_tier !== undefined && !['cash', 'commercial', 'medicare'].includes(patient.insurance_tier)) fail('Select a supported pricing profile or leave it blank.');
    if (review && !Number.isInteger(patient.max_new_classes_per_visit)) fail('The maximum number of new classes per visit must be a whole number.');
    for (const field of ['comorbidities', 'allergies', 'external_medications'] as const) {
        const value = patient[field];
        if (field === 'external_medications' && value === undefined) continue;
        if (!(value instanceof Set) || [...value].some(v => typeof v !== 'string')) fail(`${field} must be a set of text entries.`);
    }
    if (!patient.volume_status || !(patient.volume_status.exam_findings instanceof Set)
        || [...patient.volume_status.exam_findings].some(v => typeof v !== 'string')) fail('Volume assessment and text examination findings are required.');
    else for (const field of ['dry_weight_kg', 'current_weight_kg'] as const) {
        const value = patient.volume_status[field];
        if (value !== undefined && value !== null && typeof value !== 'number') fail(`${field} must be numeric or left blank.`);
        if (typeof value === 'number' && !Number.isNaN(value) && !Number.isFinite(value)) fail(`${field} is not finite.`);
    }
    if (patient.volume_status?.exam_findings instanceof Set && [...patient.volume_status.exam_findings].some(v => !isExamFinding(v))) fail('Unrecognized examination finding. Select the recorded finding before running a medication review.');
    if (!Array.isArray(patient.discontinued_meds) || Array.from(patient.discontinued_meds).some(m => !m
        || typeof m.name !== 'string' || typeof m.drug_class !== 'string' || typeof m.reason !== 'string'
        || (m.reason_detail !== undefined && typeof m.reason_detail !== 'string') || (m.occurred_at !== undefined && typeof m.occurred_at !== 'string'))) fail('Medication history requires a drug name, class and text reason.');
    if (patient.sex !== undefined && !['Male', 'Female'].includes(patient.sex)) fail('Select a supported sex or leave it blank.');
    if (patient.is_pregnant !== undefined && typeof patient.is_pregnant !== 'boolean') fail('Pregnancy status must be true, false or left unspecified.');
    if (patient.nyha_class !== undefined && !['I', 'II', 'III', 'IV'].includes(patient.nyha_class)) fail('NYHA class must be I, II, III or IV, or left blank.');
    if (patient.rhythm !== undefined && !PATIENT_RHYTHMS.includes(patient.rhythm)) fail('Select a supported rhythm or leave it blank.');
    if (!Array.isArray(patient.current_regimen)) fail('Current medications must be a list.');
    else Array.from(patient.current_regimen).forEach((r, i) => {
        const med = MEDICATION_FORMULARY.find(m => m.name === r?.med?.name);
        if (!med) { fail(`Current medication ${i + 1} is not a recognized formulary drug; reconcile the entry.`); return; }
        const strength = r?.dose?.strength;
        const dose = (typeof strength === 'number' || typeof strength === 'string') && med.available_doses.find(d => String(d.strength) === String(strength) && d.unit === r?.dose?.unit);
        if (!dose || !dose.frequency_options.includes(r.selected_frequency)) {
            fail(`${med.name}: unsupported strength, unit or dosing frequency; reconcile the entry.`); return;
        }
        // Clinical functions, classes and dose metadata come only from the current formulary.
        const useErrors = exposureErrors(r.exposure, mode);
        if (useErrors.length) { useErrors.forEach(e => fail(`${med.name}: ${e}`)); return; }
        if (review && r.exposure?.status === 'completed' && !med.facts?.single_course_dose && !med.facts?.short_course_addon) fail(`${med.name}: completed-course status applies only to a course treatment; reconcile a chronic medication as held instead.`);
        regimen.push({ med, dose, selected_frequency: r.selected_frequency, ...(r.exposure ? { exposure: copyExposure(r.exposure) } : {}) });
    });
    if (patient.iron_course_review !== undefined && !['first_course','repeat_reviewed','unknown'].includes(patient.iron_course_review)) fail('Select an iron-course history assessment.');
    if (patient.phosphate_review !== undefined && !['not_indicated','acceptable','low','unknown'].includes(patient.phosphate_review)) fail('Select a phosphate safety assessment.');
    return { errors: [...new Set(errors)], regimen };
}
