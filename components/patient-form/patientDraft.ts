import type { Patient } from '../../types';

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
        care_priority: 'default', ranking_mode: 'balanced',
    };
    return blank as unknown as Patient;
}

