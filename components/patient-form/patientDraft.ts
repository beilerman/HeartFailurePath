import type { Patient } from '../../types';
import { derivedFields } from '../../services/clinicalPredicates';

// "Custom profile" starts from an empty chart, never from the previously loaded sample, so no value
// from another patient can carry into a new one unnoticed. Potassium/creatinine 0 is the engine's
// "not entered" sentinel; everything else clinical is left blank for the clinician to enter.
export function blankPatient(): Patient {
    const blank = {
        age: undefined, height_cm: undefined, bmi: 0,
        sbp: undefined, dbp: undefined, pulse: undefined, oxygen_saturation: undefined,
        sex: undefined, race: undefined, rhythm: undefined, nt_pro_bnp: undefined, nyha_class: undefined, kccq_score: undefined, daily_step_count: undefined,
        lvef: undefined, lvedd: undefined, lavi: undefined, peak_flow_lpm: undefined, previous_lvef: undefined,
        volume_status: { dry_weight_kg: undefined, current_weight_kg: undefined, exam_findings: new Set<string>() },
        egfr: 0, potassium: 0, creatinine: 0, baseline_creatinine: undefined, bun: undefined, ferritin: undefined, tsat: undefined, hemoglobin: undefined,
        comorbidities: new Set<string>(), external_medications: new Set<string>(), allergies: new Set<string>(),
        discontinued_meds: [], current_regimen: [], is_pregnant: undefined,
        ever_lvef_le_40: 'unknown', recent_hf_worsening_within_6mo: 'unknown',
        insurance_tier: undefined, max_affordable_cost: undefined,
        // Explicit model defaults, surfaced beside the form; no defaults inherited from sample patients.
        cost_sensitivity: 5, complexity_tolerance: 5, max_new_classes_per_visit: 2,
        care_priority: 'default',
    };
    return blank as unknown as Patient;
}


/**
 * R12 D5(d): a rhythm of AFib records the atrial fibrillation history (the comorbidity) so the two cannot disagree. The form (usePatientFormModel) applies this when it opens a case; `withFormDerivations`
 * applies the same derivations to an unchanged example, so "has anything been changed?" compares like with like.
 */
export const withRhythmComorbidity = (p: Patient): Patient =>
    p.rhythm === 'AFib' && !p.comorbidities.has('Atrial Fibrillation') ? { ...p, comorbidities: new Set(p.comorbidities).add('Atrial Fibrillation') } : p;

/** The values the form computes rather than takes as entered (eGFR and BMI, the atrial fibrillation history), applied as the form applies them. */
export function withFormDerivations(p: Patient): Patient {
    const d = derivedFields(p as never);
    const egfr = Number.isFinite(d.egfr) ? d.egfr : 0, bmi = Number.isFinite(d.bmi) ? d.bmi : 0;
    return withRhythmComorbidity(Object.is(egfr, p.egfr) && Object.is(bmi, p.bmi) ? p : { ...p, egfr, bmi });
}
