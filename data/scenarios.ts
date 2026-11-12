import { Patient, TestScenario, RegimenMed } from '../types';
import { MEDICATION_FORMULARY } from '../constants';
import { calculateCKDEPI } from '../services/clinicalPredicates';

interface ScenarioMedSeed {
    name: string;
    strength: number | string;
    freq: string;
}

// Helper to build a current regimen from a list of med seeds
const buildCurrentRegimen = (seeds: ScenarioMedSeed[]): RegimenMed[] => {
    return seeds.map((m): RegimenMed => {
        const foundMed = MEDICATION_FORMULARY.find(f => f.name === m.name);
        if (!foundMed) {
            throw new Error(`[scenarios] Missing medication data for "${m.name}".`);
        }
        const foundDose = foundMed.available_doses.find(d => String(d.strength) === String(m.strength));
        if (!foundDose) {
            throw new Error(`[scenarios] Missing dose data for "${m.name}" at "${m.strength}".`);
        }
        const selectedFrequency = foundDose.frequency_options.includes(m.freq)
            ? m.freq
            : foundDose.frequency_options[0];
        return { med: foundMed, dose: foundDose, selected_frequency: selectedFrequency };
    });
};

// Helper to construct regimen items for initial state
const getInitialRegimen = (): RegimenMed[] => {
    return buildCurrentRegimen([
        { name: 'Lisinopril', strength: 20, freq: 'qd' },
        { name: 'Carvedilol', strength: 25, freq: 'bid' },
        { name: 'Furosemide', strength: 40, freq: 'qd' }
    ]);
};

// Initial State: John Doe (Warm and Wet HFrEF)
export const INITIAL_PATIENT: Patient = {
    age: 65,
    sex: 'Male',
    race: 'White',
    height_cm: 178,
    bmi: 23.0,
    sbp: 100,
    dbp: 70,
    pulse: 68,
    oxygen_saturation: 96, // Default SpO2
    rhythm: 'AFib',
    nt_pro_bnp: 2000,
    nyha_class: 'III',
    kccq_score: 45,
    daily_step_count: 3500, // Moderate activity limit
    lvef: 25,
    lvedd: 65,
    lavi: 42, // Elevated Left Atrial Volume Index
    peak_flow_lpm: 400, // Reasonable
    volume_status: {
        dry_weight_kg: 70,
        current_weight_kg: 73, // +3kg
        exam_findings: new Set(['Edema (1+)', 'JVP Elevated', 'Orthopnea'])
    },
    egfr: 45,
    potassium: 4.9,
    creatinine: 1.5,
    bun: 32, // Suggests mild prerenal if Cr is 1.5 (Ratio ~21)
    comorbidities: new Set(['HFrEF', 'Atrial Fibrillation', 'Chronic Kidney Disease', 'Diabetes Mellitus Type 2']),
    external_medications: new Set<string>(),
    allergies: new Set(),
    discontinued_meds: [],
    ever_lvef_le_40: 'unknown',
    recent_hf_worsening_within_6mo: 'unknown',
    current_regimen: getInitialRegimen(),
    max_affordable_cost: 100,
    cost_sensitivity: 5, // Default medium sensitivity
    insurance_tier: 'commercial',
    complexity_tolerance: 5,
    max_new_classes_per_visit: 2,
    care_priority: 'default'
};

export const SCENARIOS: TestScenario[] = [
    { title: 'John Doe (Wet & Warm)', patient: INITIAL_PATIENT },
    {
        title: 'Jane Smith (Dry & Cold)',
        patient: { ...INITIAL_PATIENT, sex: 'Female', height_cm: 162, bmi: 22.8, sbp: 92, dbp: 64, volume_status: { dry_weight_kg: 60, current_weight_kg: 60, exam_findings: new Set(['Cool Extremities']) }, nt_pro_bnp: 4500, lvef: 15, current_regimen: [] }
    },
    {
        title: 'Hyperkalemia (K+ 5.6) - Avoid MRA',
        patient: {
            ...INITIAL_PATIENT,
            sex: 'Male',
            age: 72,
            potassium: 5.6,
            egfr: 35,
            creatinine: 2.2,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            current_regimen: []
        }
    },
    {
        title: 'Severe Hypotension (BP 85/55) - No Drug Recs',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 85,
            dbp: 55,
            pulse: 85, // Compensatory tachycardia
            volume_status: { dry_weight_kg: 70, current_weight_kg: 70, exam_findings: new Set() }, // Euvolemic
            nt_pro_bnp: 1800,
            current_regimen: []
        }
    },
    {
        title: 'Bradycardia (HR 48) - No BB/Ivabradine',
        patient: {
            ...INITIAL_PATIENT,
            pulse: 48,
            sbp: 120,
            rhythm: 'Sinus',
            current_regimen: []
        }
    },
    {
        title: 'Angioedema Hx - Avoid ACEi/ARNI',
        patient: {
            ...INITIAL_PATIENT,
            comorbidities: new Set(['HFrEF', 'History of Angioedema']),
            current_regimen: []
        }
    },
    {
        title: 'Severe Asthma - Selective BB Only',
        patient: {
            ...INITIAL_PATIENT,
            comorbidities: new Set(['HFrEF', 'Severe Asthma / Bronchospasm']),
            pulse: 90, // Tachycardic, needs BB
            current_regimen: []
        }
    },
    {
        title: 'African American (A-HeFT Indication)',
        patient: {
            ...INITIAL_PATIENT,
            race: 'Black',
            nyha_class: 'III',
            sbp: 135, // Tolerates vasodilators
            // A-HeFT Class 1 applies to patients on optimal therapy: a RAAS inhibitor and a beta-blocker on board (verified-sglt2-glp1-adjuncts.md row 37).
            current_regimen: buildCurrentRegimen([
                { name: 'Lisinopril', strength: 20, freq: 'qd' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' }
            ])
        }
    },
    {
        title: 'Gout & Congestion - Diuretic Caution',
        patient: {
            ...INITIAL_PATIENT,
            comorbidities: new Set(['HFrEF', 'Gout']),
            volume_status: { dry_weight_kg: 85, current_weight_kg: 90, exam_findings: new Set(['Edema (3+)']) },
            current_regimen: []
        }
    },
    {
        title: 'Volume Depleted / Prerenal (BUN/Cr > 25)',
        patient: {
            ...INITIAL_PATIENT,
            volume_status: { dry_weight_kg: 70, current_weight_kg: 67, exam_findings: new Set() }, // -3kg
            bun: 45,
            creatinine: 1.6, // Ratio ~28
            sbp: 105,
            current_regimen: getInitialRegimen() // Currently on diuretics
        }
    },
    {
        title: 'HFpEF with Resistant Edema',
        patient: {
            ...INITIAL_PATIENT,
            age: 80,
            sex: 'Female',
            height_cm: 155,
            bmi: 29.1,
            sbp: 145,
            pulse: 78,
            nt_pro_bnp: 1500,
            nyha_class: 'III',
            kccq_score: 50,
            lvef: 55,
            volume_status: {
                dry_weight_kg: 65,
                current_weight_kg: 70,
                exam_findings: new Set(['Edema (2+)', 'JVP Elevated'])
            },
            egfr: 45,
            creatinine: 1.5,
            bun: 30,
            potassium: 4.2,
            comorbidities: new Set(['HFpEF', 'Hypertension', 'Atrial Fibrillation']),
            allergies: new Set(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 75,
            cost_sensitivity: 6,
            insurance_tier: 'medicare',
            complexity_tolerance: 5,
            max_new_classes_per_visit: 2
        }
    },
    // --- NEW COMPLEX SCENARIOS ---
    {
        title: 'Critical Renal (eGFR 25, K+ 5.2)',
        patient: {
            ...INITIAL_PATIENT,
            age: 75,
            egfr: 25,
            creatinine: 2.8,
            potassium: 5.2,
            comorbidities: new Set(['HFrEF', 'CKD Stage 4']),
            current_regimen: []
        }
    },
    {
        title: 'Borderline Renal (eGFR 22) - Avoid Dapagliflozin Initiation',
        patient: {
            ...INITIAL_PATIENT,
            age: 72,
            egfr: 22,
            creatinine: 3.0,
            potassium: 4.9,
            comorbidities: new Set(['HFrEF', 'CKD Stage 4']),
            current_regimen: []
        }
    },
    {
        title: 'Severe Hypotension (BP 80/50)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 80,
            dbp: 50,
            pulse: 95,
            current_regimen: []
        }
    },
    {
        title: 'Non-Compliant (Tolerance 0)',
        patient: {
            ...INITIAL_PATIENT,
            complexity_tolerance: 0,
            comorbidities: new Set(['HFrEF']),
            current_regimen: []
        }
    },
    {
        title: 'Severe Dilation (LVEF 20%, LVEDD 72)',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 20,
            lvedd: 72,
            lavi: 52,
            nt_pro_bnp: 5000,
            nyha_class: 'IV',
            kccq_score: 25,
            sbp: 95,
            pulse: 85,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 86, exam_findings: new Set(['Edema (3+)', 'JVP Elevated', 'Orthopnea']) },
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            current_regimen: []
        }
    },
    // --- GUIDELINE-ALIGNED SCENARIOS (v2) ---
    {
        title: 'Ideal Candidate (No Constraints)',
        patient: {
            age: 58,
            sex: 'Male',
            race: 'White',
            height_cm: 180,
            bmi: 26.0,
            sbp: 130,
            dbp: 82,
            pulse: 75,
            oxygen_saturation: 98,
            rhythm: 'Sinus',
            nt_pro_bnp: 2500,
            nyha_class: 'II',
            kccq_score: 55,
            daily_step_count: 4000,
            lvef: 30,
            lvedd: 60,
            lavi: 38,
            peak_flow_lpm: 450,
            volume_status: { dry_weight_kg: 82, current_weight_kg: 83, exam_findings: new Set() },
            egfr: 60,
            potassium: 4.2,
            creatinine: 1.2,
            bun: 18,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 500,
            cost_sensitivity: 3,
            insurance_tier: 'commercial',
            complexity_tolerance: 10,
            max_new_classes_per_visit: 4
        }
    },
    {
        title: 'Obese HFpEF (BMI 35, LVEF 58)',
        patient: {
            age: 62,
            sex: 'Female',
            race: 'White',
            height_cm: 160,
            bmi: 35.0,
            sbp: 138,
            dbp: 84,
            pulse: 78,
            oxygen_saturation: 95,
            rhythm: 'Sinus',
            nt_pro_bnp: 800,
            nyha_class: 'II',
            kccq_score: 55,
            daily_step_count: 3000,
            lvef: 58,
            lvedd: 48,
            lavi: 36,
            peak_flow_lpm: 380,
            volume_status: { dry_weight_kg: 88, current_weight_kg: 92, exam_findings: new Set(['Edema (1+)']) },
            egfr: 65,
            potassium: 4.0,
            creatinine: 1.0,
            bun: 16,
            comorbidities: new Set(['HFpEF', 'Diabetes Mellitus Type 2', 'Obesity']),
            allergies: new Set(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'Iron-Deficient HFrEF',
        patient: {
            ...INITIAL_PATIENT,
            age: 55,
            sex: 'Female',
            height_cm: 165,
            bmi: 24.5,
            sbp: 118,
            dbp: 74,
            pulse: 72,
            rhythm: 'Sinus',
            nt_pro_bnp: 3000,
            nyha_class: 'III',
            kccq_score: 40,
            lvef: 28,
            ferritin: 65,
            tsat: 15,
            volume_status: { dry_weight_kg: 65, current_weight_kg: 67, exam_findings: new Set(['Edema (1+)']) },
            egfr: 55,
            potassium: 4.3,
            creatinine: 1.1,
            bun: 20,
            comorbidities: new Set(['HFrEF', 'Iron Deficiency']),
            allergies: new Set(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            complexity_tolerance: 7,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'African American NYHA III (A-HeFT)',
        patient: {
            ...INITIAL_PATIENT,
            race: 'Black',
            age: 60,
            sbp: 130,
            dbp: 80,
            pulse: 74,
            rhythm: 'Sinus',
            nyha_class: 'III',
            kccq_score: 42,
            nt_pro_bnp: 2200,
            lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 82, exam_findings: new Set(['Edema (1+)']) },
            egfr: 55,
            potassium: 4.5,
            creatinine: 1.3,
            bun: 22,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 150,
            cost_sensitivity: 5,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Sinus Tachycardia on Max BB (Ivabradine Candidate)',
        patient: {
            ...INITIAL_PATIENT,
            age: 56,
            sbp: 120,
            dbp: 76,
            pulse: 82,
            rhythm: 'Sinus',
            nyha_class: 'II',
            kccq_score: 50,
            nt_pro_bnp: 1800,
            lvef: 30,
            volume_status: { dry_weight_kg: 78, current_weight_kg: 79, exam_findings: new Set() },
            egfr: 60,
            potassium: 4.4,
            creatinine: 1.2,
            bun: 20,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Sinus Tachycardia (No BB Available) - Ivabradine Fallback',
        patient: {
            ...INITIAL_PATIENT,
            age: 57,
            sbp: 122,
            dbp: 76,
            pulse: 84,
            rhythm: 'Sinus',
            nyha_class: 'II',
            kccq_score: 52,
            nt_pro_bnp: 1700,
            lvef: 30,
            volume_status: { dry_weight_kg: 78, current_weight_kg: 79, exam_findings: new Set() },
            egfr: 58,
            potassium: 4.4,
            creatinine: 1.3,
            bun: 21,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set(),
            discontinued_meds: [],
            // No baseline beta blocker so ivabradine should rely on all-BB-excluded fallback path.
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    // --- TIER 1 & 2 FIX VALIDATION SCENARIOS ---
    {
        title: 'ACEi-to-ARNI Swap (Washout Warning)',
        patient: {
            ...INITIAL_PATIENT,
            age: 60,
            sbp: 120,
            dbp: 78,
            pulse: 64,
            rhythm: 'Sinus',
            nyha_class: 'II',
            kccq_score: 55,
            nt_pro_bnp: 1800,
            lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 81, exam_findings: new Set() },
            egfr: 55,
            potassium: 4.3,
            creatinine: 1.2,
            bun: 20,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set(),
            discontinued_meds: [],
            // Only ACEi in current regimen — swap to ARNI is the clear best option
            current_regimen: buildCurrentRegimen([
                { name: 'Lisinopril', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 300,
            cost_sensitivity: 1,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 0 // Only swaps/titrations, forces ARNI swap to surface
        }
    },
    {
        title: 'Euvolemic Asthma (BB Selection)',
        patient: {
            age: 55,
            sex: 'Male' as const,
            race: 'White',
            height_cm: 175,
            bmi: 27.0,
            sbp: 125,
            dbp: 80,
            pulse: 82,
            oxygen_saturation: 97,
            rhythm: 'Sinus' as const,
            nt_pro_bnp: 2000,
            nyha_class: 'II' as const,
            kccq_score: 55,
            daily_step_count: 4000,
            lvef: 30,
            lvedd: 58,
            lavi: 36,
            peak_flow_lpm: 350,
            volume_status: { dry_weight_kg: 82, current_weight_kg: 83, exam_findings: new Set<string>() },
            egfr: 60,
            potassium: 4.2,
            creatinine: 1.2,
            bun: 18,
            comorbidities: new Set(['HFrEF', 'Severe Asthma / Bronchospasm']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 4
        }
    },
    {
        title: 'HFimpEF (Prior LVEF 25, Now 45)',
        patient: {
            age: 62,
            sex: 'Male' as const,
            race: 'White',
            height_cm: 178,
            bmi: 26.0,
            sbp: 118,
            dbp: 74,
            pulse: 68,
            oxygen_saturation: 97,
            rhythm: 'Sinus' as const,
            nt_pro_bnp: 600,
            nyha_class: 'II' as const,
            kccq_score: 65,
            daily_step_count: 5000,
            lvef: 45,
            lvedd: 52,
            lavi: 32,
            peak_flow_lpm: 420,
            volume_status: { dry_weight_kg: 82, current_weight_kg: 83, exam_findings: new Set<string>() },
            egfr: 65,
            potassium: 4.1,
            creatinine: 1.1,
            bun: 16,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            previous_lvef: 25,  // KEY: was HFrEF, now improved
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'HFimpEF Unknown on Existing Quad (Preserve Pillars)',
        patient: {
            ...INITIAL_PATIENT,
            age: 64,
            sbp: 116,
            dbp: 72,
            pulse: 66,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 68,
            nt_pro_bnp: 520,
            lvef: 52,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 62,
            potassium: 4.2,
            creatinine: 1.1,
            bun: 15,
            comorbidities: new Set(['HFrEF']),
            previous_lvef: undefined,
            ever_lvef_le_40: 'unknown',
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 240,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Pregnant Woman with HFrEF',
        patient: {
            age: 32,
            sex: 'Female' as const,
            race: 'White',
            height_cm: 165,
            bmi: 26.5,
            sbp: 115,
            dbp: 72,
            pulse: 88,
            oxygen_saturation: 97,
            rhythm: 'Sinus' as const,
            nt_pro_bnp: 1500,
            nyha_class: 'II' as const,
            kccq_score: 55,
            daily_step_count: 4000,
            lvef: 30,
            lvedd: 56,
            lavi: 34,
            peak_flow_lpm: 400,
            volume_status: { dry_weight_kg: 68, current_weight_kg: 70, exam_findings: new Set(['Edema (1+)']) },
            egfr: 95,
            potassium: 4.0,
            creatinine: 0.7,
            bun: 10,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            is_pregnant: true,
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'Severe Hypotension (SBP 82) - No Drug Recs',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 82,
            dbp: 52,
            pulse: 105,
            lvef: 18,
            nt_pro_bnp: 8000,
            nyha_class: 'IV' as const,
            volume_status: { dry_weight_kg: 70, current_weight_kg: 74, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea']) },
            current_regimen: []
        }
    },
    {
        title: 'Budget-Constrained ($25)',
        patient: {
            ...INITIAL_PATIENT,
            age: 62,
            sbp: 125,
            dbp: 78,
            pulse: 76,
            rhythm: 'Sinus',
            nyha_class: 'III',
            kccq_score: 40,
            nt_pro_bnp: 3000,
            lvef: 28,
            volume_status: { dry_weight_kg: 75, current_weight_kg: 78, exam_findings: new Set(['Edema (1+)', 'JVP Elevated']) },
            egfr: 50,
            potassium: 4.5,
            creatinine: 1.4,
            bun: 24,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 25,
            cost_sensitivity: 8,
            insurance_tier: 'cash',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 3
        }
    },
    // --- EDGE CASE SCENARIOS (Clinical Safety Review) ---
    {
        title: 'Pregnant on Existing ACEi (Contraindicated Med Removal)',
        patient: {
            age: 30,
            sex: 'Female' as const,
            race: 'White',
            height_cm: 165,
            bmi: 25.0,
            sbp: 118,
            dbp: 74,
            pulse: 82,
            oxygen_saturation: 97,
            rhythm: 'Sinus' as const,
            nt_pro_bnp: 1200,
            nyha_class: 'II' as const,
            kccq_score: 58,
            daily_step_count: 4500,
            lvef: 32,
            lvedd: 55,
            lavi: 33,
            peak_flow_lpm: 420,
            volume_status: { dry_weight_kg: 65, current_weight_kg: 66, exam_findings: new Set<string>() },
            egfr: 95,
            potassium: 4.0,
            creatinine: 0.7,
            bun: 10,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            is_pregnant: true,
            // Currently on ACEi + BB — ACEi should be flagged for removal, NOT titrated
            current_regimen: buildCurrentRegimen([
                { name: 'Lisinopril', strength: 10, freq: 'qd' },
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'SGLT2i Continuation Below eGFR Threshold',
        patient: {
            ...INITIAL_PATIENT,
            age: 70,
            sbp: 115,
            dbp: 72,
            pulse: 68,
            rhythm: 'Sinus' as const,
            nt_pro_bnp: 2200,
            nyha_class: 'II' as const,
            kccq_score: 55,
            lvef: 30,
            egfr: 22, // Below Dapa initiation threshold (25) AND Empa threshold (20 only)
            creatinine: 3.0,
            potassium: 4.5,
            bun: 35,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            // Already on Dapagliflozin — should be allowed to CONTINUE despite eGFR 22
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' },
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'SBP 90 Borderline (Allowed With Caution)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 90,
            dbp: 58,
            pulse: 92,
            lvef: 22,
            nt_pro_bnp: 5000,
            nyha_class: 'III' as const,
            volume_status: { dry_weight_kg: 70, current_weight_kg: 72, exam_findings: new Set(['Edema (1+)']) },
            current_regimen: []
        }
    },
    {
        title: 'MRA Boundary (eGFR 31, K+ 5.4)',
        patient: {
            ...INITIAL_PATIENT,
            age: 68,
            sbp: 120,
            dbp: 76,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 2000,
            lvef: 30,
            egfr: 31, // Just above MRA cutoff of 30
            creatinine: 2.2,
            potassium: 5.4, // Just below MRA cutoff of 5.5
            bun: 28,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' },
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Elderly >80 on All 4 Pillars (Age Dosing)',
        patient: {
            age: 84,
            sex: 'Male' as const,
            race: 'White',
            height_cm: 172,
            bmi: 24.0,
            sbp: 125,
            dbp: 75,
            pulse: 64,
            oxygen_saturation: 96,
            rhythm: 'Sinus' as const,
            nt_pro_bnp: 900,
            nyha_class: 'II' as const,
            kccq_score: 60,
            daily_step_count: 3000,
            lvef: 35,
            lvedd: 54,
            lavi: 34,
            peak_flow_lpm: 380,
            volume_status: { dry_weight_kg: 72, current_weight_kg: 73, exam_findings: new Set<string>() },
            egfr: 42,
            potassium: 4.6,
            creatinine: 1.6,
            bun: 26,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' },
                { name: 'Metoprolol Succinate', strength: 50, freq: 'qd' },
                { name: 'Spironolactone', strength: 12.5, freq: 'qd' },
                { name: 'Empagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            insurance_tier: 'medicare',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 1
        }
    },
    {
        title: 'NYHA II + BNP 1800 (Vericiguat Eligible)',
        patient: {
            ...INITIAL_PATIENT,
            age: 58,
            sbp: 115,
            dbp: 72,
            pulse: 68,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 1800, // >= 1600 threshold
            lvef: 35, // < 45 threshold
            volume_status: { dry_weight_kg: 80, current_weight_kg: 81, exam_findings: new Set<string>() },
            egfr: 55,
            potassium: 4.3,
            creatinine: 1.3,
            bun: 20,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            recent_hf_worsening_within_6mo: 'yes',
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Liver Disease + AFib (Carvedilol CI + Digoxin)',
        patient: {
            age: 65,
            sex: 'Male' as const,
            race: 'White',
            height_cm: 175,
            bmi: 28.0,
            sbp: 118,
            dbp: 74,
            pulse: 88,
            oxygen_saturation: 96,
            rhythm: 'AFib' as const,
            nt_pro_bnp: 2500,
            nyha_class: 'III' as const,
            kccq_score: 42,
            daily_step_count: 2500,
            lvef: 30,
            lvedd: 60,
            lavi: 40,
            peak_flow_lpm: 400,
            volume_status: { dry_weight_kg: 82, current_weight_kg: 85, exam_findings: new Set(['Edema (1+)', 'JVP Elevated']) },
            egfr: 55,
            potassium: 4.2,
            creatinine: 1.3,
            bun: 22,
            comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)', 'Atrial Fibrillation']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'NSAID + RAAS DDI Warning',
        patient: {
            ...INITIAL_PATIENT,
            age: 60,
            sbp: 125,
            dbp: 78,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 1500,
            lvef: 32,
            volume_status: { dry_weight_kg: 78, current_weight_kg: 79, exam_findings: new Set<string>() },
            egfr: 55,
            potassium: 4.3,
            creatinine: 1.2,
            bun: 20,
            comorbidities: new Set(['HFrEF', 'Chronic NSAID Use']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 4,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 3
        }
    },
    // --- NEW SAFETY-CRITICAL SCENARIOS (37-46) ---
    {
        title: 'Projected SBP Safety (SBP 100, No Meds)',
        patient: {
            ...INITIAL_PATIENT,
            age: 58,
            sbp: 100,
            dbp: 65,
            pulse: 78,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 40,
            nt_pro_bnp: 2500,
            lvef: 28,
            volume_status: { dry_weight_kg: 75, current_weight_kg: 78, exam_findings: new Set(['Edema (1+)', 'JVP Elevated']) },
            egfr: 55,
            potassium: 4.2,
            creatinine: 1.3,
            bun: 25,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'K+ Trajectory (K+ 4.8, RAAS+MRA)',
        patient: {
            ...INITIAL_PATIENT,
            age: 65,
            sbp: 118,
            dbp: 72,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 1800,
            lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 82, exam_findings: new Set(['Edema (1+)']) },
            egfr: 45,
            potassium: 4.8,
            creatinine: 1.5,
            bun: 30,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '24/26', freq: 'bid' }
            ]),
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'eGFR 25 SGLT2i Boundary',
        patient: {
            ...INITIAL_PATIENT,
            age: 70,
            sbp: 115,
            dbp: 70,
            pulse: 70,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 60,
            nt_pro_bnp: 1400,
            lvef: 35,
            volume_status: { dry_weight_kg: 72, current_weight_kg: 73, exam_findings: new Set<string>() },
            egfr: 25,
            potassium: 4.5,
            creatinine: 2.5,
            bun: 45,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Pregnant + CKD4 (eGFR 28)',
        patient: {
            ...INITIAL_PATIENT,
            age: 32,
            sex: 'Female',
            height_cm: 165,
            bmi: 24.5,
            sbp: 110,
            dbp: 68,
            pulse: 88,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 1200,
            lvef: 35,
            volume_status: { dry_weight_kg: 62, current_weight_kg: 64, exam_findings: new Set(['Edema (1+)']) },
            egfr: 28,
            potassium: 4.3,
            creatinine: 2.0,
            bun: 35,
            is_pregnant: true,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 3,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'LVEF Recovery Cap (LVEF 20, Quad)',
        patient: {
            ...INITIAL_PATIENT,
            age: 55,
            sbp: 115,
            dbp: 72,
            pulse: 80,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 35,
            nt_pro_bnp: 4000,
            lvef: 20,
            lvedd: 72,
            lavi: 50,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 84, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea']) },
            egfr: 60,
            potassium: 4.0,
            creatinine: 1.1,
            bun: 22,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 4
        }
    },
    {
        title: 'Finerenone in HFpEF (LVEF 55)',
        patient: {
            ...INITIAL_PATIENT,
            age: 68,
            sbp: 138,
            dbp: 82,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 60,
            nt_pro_bnp: 800,
            lvef: 55,
            volume_status: { dry_weight_kg: 85, current_weight_kg: 87, exam_findings: new Set(['Edema (1+)']) },
            egfr: 55,
            potassium: 4.2,
            creatinine: 1.2,
            bun: 22,
            comorbidities: new Set(['HFpEF', 'Diabetes Mellitus Type 2']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Hepatic BB Selection (Liver Disease)',
        patient: {
            ...INITIAL_PATIENT,
            age: 62,
            sbp: 112,
            dbp: 68,
            pulse: 74,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 42,
            nt_pro_bnp: 2200,
            lvef: 28,
            volume_status: { dry_weight_kg: 75, current_weight_kg: 78, exam_findings: new Set(['Edema (1+)', 'Ascites']) },
            egfr: 50,
            potassium: 4.1,
            creatinine: 1.4,
            bun: 28,
            comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'Vericiguat LVEF Boundary (LVEF 46)',
        patient: {
            ...INITIAL_PATIENT,
            age: 66,
            sbp: 108,
            dbp: 66,
            pulse: 76,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 38,
            nt_pro_bnp: 2400,
            lvef: 46,
            volume_status: { dry_weight_kg: 78, current_weight_kg: 80, exam_findings: new Set(['Edema (1+)']) },
            egfr: 48,
            potassium: 4.4,
            creatinine: 1.4,
            bun: 30,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            recent_hf_worsening_within_6mo: 'yes',
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' },
                { name: 'Metoprolol Succinate', strength: 100, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'GLP-1 Not Offered in HFrEF (BMI 35, LVEF 30)',
        patient: {
            ...INITIAL_PATIENT,
            age: 58,
            height_cm: 170,
            bmi: 35,
            sbp: 118,
            dbp: 74,
            pulse: 76,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 1600,
            lvef: 30,
            volume_status: { dry_weight_kg: 101, current_weight_kg: 103, exam_findings: new Set(['Edema (1+)']) },
            egfr: 65,
            potassium: 4.3,
            creatinine: 1.1,
            bun: 20,
            comorbidities: new Set(['HFrEF', 'Diabetes Mellitus Type 2']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'Digoxin Renal Dosing (eGFR 25, AFib)',
        patient: {
            ...INITIAL_PATIENT,
            age: 75,
            sbp: 110,
            dbp: 66,
            pulse: 90,
            rhythm: 'AFib' as const,
            nyha_class: 'III' as const,
            kccq_score: 40,
            nt_pro_bnp: 2000,
            lvef: 35,
            volume_status: { dry_weight_kg: 70, current_weight_kg: 73, exam_findings: new Set(['Edema (1+)', 'JVP Elevated']) },
            egfr: 25,
            potassium: 4.5,
            creatinine: 2.5,
            bun: 45,
            comorbidities: new Set(['HFrEF', 'Atrial Fibrillation', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Metoprolol Succinate', strength: 50, freq: 'qd' },
                { name: 'Furosemide', strength: 40, freq: 'qd' }
            ]),
            max_affordable_cost: 150,
            cost_sensitivity: 5,
            insurance_tier: 'medicare',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Stable Outpatient BNP 1800 (No Recent Worsening)',
        patient: {
            ...INITIAL_PATIENT,
            age: 60,
            sbp: 118,
            dbp: 74,
            pulse: 70,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 58,
            nt_pro_bnp: 1800,
            lvef: 35,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 81, exam_findings: new Set<string>() },
            egfr: 55,
            potassium: 4.3,
            creatinine: 1.2,
            bun: 18,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            recent_hf_worsening_within_6mo: 'no',
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Low Body Weight Carvedilol Boundary (55kg)',
        patient: {
            ...INITIAL_PATIENT,
            age: 63,
            sex: 'Female' as const,
            height_cm: 160,
            bmi: 21.5,
            sbp: 122,
            dbp: 76,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 60,
            nt_pro_bnp: 1800,
            lvef: 30,
            volume_status: { dry_weight_kg: 55, current_weight_kg: 56, exam_findings: new Set<string>() },
            egfr: 62,
            potassium: 4.1,
            creatinine: 1.0,
            bun: 16,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 250,
            cost_sensitivity: 3,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Severe CKD Loop Resistance (eGFR 18)',
        patient: {
            ...INITIAL_PATIENT,
            age: 72,
            sbp: 114,
            dbp: 70,
            pulse: 84,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 40,
            nt_pro_bnp: 3200,
            lvef: 30,
            volume_status: { dry_weight_kg: 70, current_weight_kg: 74, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) },
            egfr: 18,
            potassium: 4.4,
            creatinine: 3.1,
            bun: 62,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' },
                { name: 'Furosemide', strength: 80, freq: 'qd' }
            ]),
            max_affordable_cost: 220,
            cost_sensitivity: 4,
            insurance_tier: 'medicare',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Digoxin Hypokalemia Contraindication (K+ 3.2)',
        patient: {
            ...INITIAL_PATIENT,
            age: 74,
            sbp: 112,
            dbp: 68,
            pulse: 92,
            rhythm: 'AFib' as const,
            nyha_class: 'III' as const,
            kccq_score: 38,
            nt_pro_bnp: 2200,
            lvef: 32,
            volume_status: { dry_weight_kg: 72, current_weight_kg: 75, exam_findings: new Set(['Edema (1+)', 'JVP Elevated']) },
            egfr: 42,
            potassium: 3.2,
            creatinine: 1.8,
            bun: 34,
            comorbidities: new Set(['HFrEF', 'Atrial Fibrillation', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Metoprolol Succinate', strength: 50, freq: 'qd' },
                { name: 'Furosemide', strength: 80, freq: 'qd' }
            ]),
            max_affordable_cost: 180,
            cost_sensitivity: 5,
            insurance_tier: 'medicare',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Acute Decompensated NYHA IV (No BB Initiation)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 108,
            dbp: 70,
            pulse: 92,
            rhythm: 'Sinus' as const,
            nyha_class: 'IV' as const,
            kccq_score: 30,
            nt_pro_bnp: 5200,
            lvef: 28,
            volume_status: { dry_weight_kg: 72, current_weight_kg: 77, exam_findings: new Set(['Edema (3+)', 'JVP Elevated', 'Orthopnea']) },
            egfr: 48,
            potassium: 4.3,
            creatinine: 1.6,
            bun: 34,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 220,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'GLP-1 Contraindication (MEN2)',
        patient: {
            ...INITIAL_PATIENT,
            age: 60,
            height_cm: 168,
            bmi: 36,
            sbp: 124,
            dbp: 78,
            pulse: 74,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 62,
            nt_pro_bnp: 900,
            lvef: 58,
            volume_status: { dry_weight_kg: 98, current_weight_kg: 99, exam_findings: new Set<string>() },
            egfr: 68,
            potassium: 4.2,
            creatinine: 1.0,
            bun: 18,
            comorbidities: new Set(['HFpEF', 'Obesity (BMI > 30)', 'MEN2 Syndrome']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 300,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 8,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'Acute Decompensated NYHA IV (Existing BB Requires Down-Titration)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 106,
            dbp: 68,
            pulse: 88,
            rhythm: 'Sinus' as const,
            nyha_class: 'IV' as const,
            kccq_score: 28,
            nt_pro_bnp: 5600,
            lvef: 26,
            // Cold-and-wet: hypoperfusion (cool extremities) is what justifies forcing the
            // beta-blocker dose reduction. Warm-and-wet decompensation continues the BB.
            volume_status: { dry_weight_kg: 70, current_weight_kg: 75, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea', 'Cool Extremities']) },
            egfr: 44,
            potassium: 4.2,
            creatinine: 1.8,
            bun: 36,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Furosemide', strength: 80, freq: 'qd' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 220,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Type 1 DM + Prior DKA (Avoid SGLT2i)',
        patient: {
            ...INITIAL_PATIENT,
            age: 40,
            sbp: 118,
            dbp: 72,
            pulse: 80,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 58,
            nt_pro_bnp: 1600,
            lvef: 32,
            volume_status: { dry_weight_kg: 70, current_weight_kg: 71, exam_findings: new Set<string>() },
            egfr: 72,
            potassium: 4.2,
            creatinine: 0.9,
            bun: 16,
            comorbidities: new Set(['HFrEF', 'Type 1 Diabetes Mellitus', 'Prior DKA / Euglycemic DKA']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 220,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'AV Block (No BB/Digoxin)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 120,
            dbp: 74,
            pulse: 62,
            rhythm: '3rd Degree AV Block' as const,
            nyha_class: 'III' as const,
            kccq_score: 40,
            nt_pro_bnp: 2600,
            lvef: 30,
            volume_status: { dry_weight_kg: 74, current_weight_kg: 76, exam_findings: new Set(['Edema (1+)']) },
            egfr: 58,
            potassium: 4.3,
            creatinine: 1.2,
            bun: 20,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 220,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 3
        }
    },
    {
        title: 'Non-Formulary DDI Exposures (Amio/CCB/Lithium)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 116,
            dbp: 72,
            pulse: 88,
            rhythm: 'AFib' as const,
            nyha_class: 'III' as const,
            kccq_score: 38,
            nt_pro_bnp: 2400,
            lvef: 30,
            volume_status: { dry_weight_kg: 74, current_weight_kg: 77, exam_findings: new Set(['Edema (1+)', 'JVP Elevated']) },
            egfr: 46,
            potassium: 4.1,
            creatinine: 1.6,
            bun: 32,
            comorbidities: new Set(['HFrEF', 'Atrial Fibrillation']),
            external_medications: new Set(['Amiodarone', 'Verapamil', 'Diltiazem', 'Lithium']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' },
                { name: 'Digoxin', strength: 125, freq: 'qd' },
                { name: 'Furosemide', strength: 40, freq: 'qd' }
            ]),
            max_affordable_cost: 220,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Nitrate + PDE5 Exposure (Hard Exclusion)',
        patient: {
            ...INITIAL_PATIENT,
            race: 'Black',
            sbp: 118,
            dbp: 74,
            pulse: 82,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 42,
            nt_pro_bnp: 2600,
            lvef: 30,
            volume_status: { dry_weight_kg: 76, current_weight_kg: 78, exam_findings: new Set(['Edema (1+)', 'JVP Elevated']) },
            egfr: 54,
            potassium: 4.1,
            creatinine: 1.3,
            bun: 24,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set(['Sildenafil']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Hydralazine/Isosorbide Dinitrate', strength: '37.5/20', freq: 'tid' },
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' }
            ]),
            max_affordable_cost: 220,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    {
        title: 'Invalid BP Inversion (SBP 80 / DBP 120)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 80,
            dbp: 120,
            pulse: 90,
            rhythm: 'Sinus' as const,
            current_regimen: []
        }
    },
    {
        title: 'Duplicate Current Medications (Safety Dedup)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 112,
            dbp: 70,
            pulse: 76,
            rhythm: 'Sinus' as const,
            current_regimen: buildCurrentRegimen([
                { name: 'Furosemide', strength: 40, freq: 'qd' },
                { name: 'Furosemide', strength: 40, freq: 'qd' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' }
            ])
        }
    },
    // --- LVEF 41-49 standalone (LVEF 45) — LVEF 41-49 is reduced EF under the 2026 ESC guideline ---
    {
        title: 'LVEF 45 Reduced-EF Standalone (NYHA II)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 128,
            dbp: 78,
            pulse: 74,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            daily_step_count: 4500,
            nt_pro_bnp: 900,
            lvef: 45,
            lvedd: 54,
            lavi: 36,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 82, exam_findings: new Set(['Edema (1+)']) },
            egfr: 62,
            potassium: 4.2,
            creatinine: 1.1,
            bun: 18,
            comorbidities: new Set(['Diabetes Mellitus Type 2']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    // --- LVEF 41-49 + Obese (GLP-1 eligible) — BMI ≥ 30 + LVEF 42 ---
    {
        title: 'LVEF 42 Reduced-EF Obese (BMI 33, GLP-1 Not Eligible Below LVEF 45)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 134,
            dbp: 82,
            pulse: 78,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 50,
            daily_step_count: 3800,
            bmi: 33,
            nt_pro_bnp: 1100,
            lvef: 42,
            lvedd: 56,
            lavi: 38,
            volume_status: { dry_weight_kg: 95, current_weight_kg: 97, exam_findings: new Set(['Edema (1+)']) },
            egfr: 58,
            potassium: 4.4,
            creatinine: 1.2,
            bun: 20,
            comorbidities: new Set(['Diabetes Mellitus Type 2', 'Obesity']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    // --- Severe congestion + thiazide addition — fluid excess > 4kg on loop ---
    {
        title: 'Severe Congestion + Loop (Thiazide Addition)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 118,
            dbp: 74,
            pulse: 88,
            rhythm: 'AFib' as const,
            nyha_class: 'III' as const,
            kccq_score: 30,
            daily_step_count: 2000,
            nt_pro_bnp: 4200,
            lvef: 25,
            lvedd: 68,
            lavi: 48,
            volume_status: { dry_weight_kg: 75, current_weight_kg: 82, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea', 'Rales']) },
            egfr: 38,
            potassium: 4.0,
            creatinine: 1.8,
            bun: 36,
            comorbidities: new Set(['HFrEF', 'Atrial Fibrillation', 'Chronic Kidney Disease']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Furosemide', strength: 80, freq: 'bid' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' },
                { name: 'Carvedilol', strength: 6.25, freq: 'bid' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    // --- Hypoxia alert (SpO2 < 90) ---
    {
        title: 'Hypoxia Alert (SpO2 85%)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 108,
            dbp: 68,
            pulse: 96,
            oxygen_saturation: 85,
            rhythm: 'AFib' as const,
            nyha_class: 'III' as const,
            kccq_score: 28,
            daily_step_count: 1500,
            nt_pro_bnp: 5000,
            lvef: 20,
            lvedd: 70,
            lavi: 50,
            volume_status: { dry_weight_kg: 72, current_weight_kg: 77, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea', 'Rales']) },
            egfr: 40,
            potassium: 4.6,
            creatinine: 1.6,
            bun: 34,
            comorbidities: new Set(['HFrEF', 'Atrial Fibrillation']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Furosemide', strength: 40, freq: 'bid' },
                { name: 'Carvedilol', strength: 6.25, freq: 'bid' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    // --- NYHA III acute decompensation (not IV, but III + fluid > 2kg + ≥2 exam findings) ---
    {
        title: 'NYHA III Acute Decompensation (BB Initiation Blocked)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 106,
            dbp: 66,
            pulse: 92,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 32,
            daily_step_count: 2200,
            nt_pro_bnp: 3500,
            lvef: 28,
            lvedd: 66,
            lavi: 44,
            volume_status: { dry_weight_kg: 78, current_weight_kg: 83, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea']) },
            egfr: 48,
            potassium: 4.5,
            creatinine: 1.4,
            bun: 28,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Furosemide', strength: 80, freq: 'qd' },
                { name: 'Lisinopril', strength: 5, freq: 'qd' }
            ]),
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    // --- Low peak flow screening (peak_flow < 350, no COPD/asthma) ---
    {
        title: 'Low Peak Flow Screening (PF 280, No COPD)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 122,
            dbp: 76,
            pulse: 72,
            oxygen_saturation: 94,
            peak_flow_lpm: 280,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 52,
            daily_step_count: 4000,
            nt_pro_bnp: 1200,
            lvef: 30,
            lvedd: 62,
            lavi: 40,
            volume_status: { dry_weight_kg: 76, current_weight_kg: 78, exam_findings: new Set(['Edema (1+)']) },
            egfr: 55,
            potassium: 4.3,
            creatinine: 1.3,
            bun: 22,
            comorbidities: new Set(['HFrEF', 'Diabetes Mellitus Type 2']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 200,
            cost_sensitivity: 5,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    // --- Furoscix eligibility: persistent congestion despite oral loop ---
    {
        title: 'Furoscix Candidate (Persistent Congestion on Oral Loop)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 114,
            dbp: 72,
            pulse: 86,
            rhythm: 'AFib' as const,
            nyha_class: 'III' as const,
            kccq_score: 34,
            daily_step_count: 2200,
            nt_pro_bnp: 3800,
            lvef: 26,
            lvedd: 68,
            lavi: 46,
            volume_status: { dry_weight_kg: 78, current_weight_kg: 83, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea']) },
            egfr: 42,
            potassium: 4.1,
            creatinine: 1.7,
            bun: 34,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease', 'Atrial Fibrillation']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Furosemide', strength: 80, freq: 'bid' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' },
                { name: 'Carvedilol', strength: 6.25, freq: 'bid' }
            ]),
            max_affordable_cost: 350,
            cost_sensitivity: 3,
            insurance_tier: 'commercial',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    // --- Furoscix contraindication: furosemide hypersensitivity ---
    {
        title: 'Furoscix Allergy Guardrail (Furosemide Hypersensitivity)',
        patient: {
            ...INITIAL_PATIENT,
            sbp: 120,
            dbp: 74,
            pulse: 82,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 40,
            nt_pro_bnp: 2400,
            lvef: 32,
            lvedd: 64,
            lavi: 42,
            volume_status: { dry_weight_kg: 74, current_weight_kg: 78, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) },
            egfr: 48,
            potassium: 4.2,
            creatinine: 1.4,
            bun: 26,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            external_medications: new Set<string>(),
            allergies: new Set(['Furosemide']),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Torsemide', strength: 20, freq: 'bid' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' },
                { name: 'Bisoprolol', strength: 5, freq: 'qd' }
            ]),
            max_affordable_cost: 300,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    // ===== Issue 2: ARNI Hepatic CI =====
    {
        title: 'ARNI Hepatic CI (Liver Disease)',
        patient: {
            ...INITIAL_PATIENT,
            age: 62,
            sex: 'Male',
            sbp: 118,
            dbp: 72,
            pulse: 74,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 40,
            nt_pro_bnp: 3200,
            lvef: 28,
            lvedd: 68,
            lavi: 44,
            volume_status: { dry_weight_kg: 82, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) },
            egfr: 50,
            potassium: 4.3,
            creatinine: 1.4,
            bun: 24,
            comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 3
        }
    },
    // ===== Issue 1: new MRA start above potassium 5.0 is staged (was: DIAMOND binder co-start; changed 2026-11-11) =====
    {
        title: 'MRA Start Staged At K+ 5.1 (No Binder Co-Start)',
        patient: {
            ...INITIAL_PATIENT,
            age: 58,
            sex: 'Male',
            sbp: 112,
            dbp: 70,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 1800,
            lvef: 30,
            lvedd: 64,
            lavi: 42,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 82, exam_findings: new Set(['Edema (1+)']) },
            egfr: 55,
            potassium: 5.1,
            creatinine: 1.3,
            bun: 22,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' },
                { name: 'Bisoprolol', strength: 5, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
            ]),
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial',
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    // ===== Issue 3: HFpEF Steroidal MRA =====
    {
        title: 'HFpEF Steroidal MRA Eligible (LVEF 55)',
        patient: {
            ...INITIAL_PATIENT,
            age: 72,
            sex: 'Female',
            sbp: 142,
            dbp: 78,
            pulse: 70,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 58,
            nt_pro_bnp: 900,
            lvef: 55,
            volume_status: { dry_weight_kg: 70, current_weight_kg: 72, exam_findings: new Set(['Edema (1+)']) },
            egfr: 50,
            potassium: 4.0,
            creatinine: 1.1,
            bun: 20,
            comorbidities: new Set(['HFpEF', 'Hypertension']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 80,
            cost_sensitivity: 8,
            insurance_tier: 'medicare',
            complexity_tolerance: 6,
            max_new_classes_per_visit: 2
        }
    },
    // --- Real-world robustness: incomplete data, inappropriate regimens, intolerances ---
    {
        // De-novo HFrEF with potassium field left blank (0) — labs pending. Engine must NOT
        // treat unknown K+ as safe when INITIATING an MRA/RAAS — it should alert and flag the
        // new-initiation regimen for a pre-init BMP.
        title: 'Incomplete Data: Missing Potassium (K+ Not Entered)',
        patient: {
            ...INITIAL_PATIENT,
            potassium: 0, // not entered
            egfr: 60,
            creatinine: 1.0,
            current_regimen: [] // de-novo: every candidate initiates RAAS/MRA
        }
    },
    {
        // LVEF left blank (0). Phenotype is undeterminable → fail safe (alerts only, no recs).
        title: 'Incomplete Data: Missing LVEF (Phenotype Unknown)',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 0, // not entered
        }
    },
    {
        // Patient arrives on ACEi + ARB (dual RAAS) — must be flagged for deprescribing.
        title: 'Inappropriate Dual RAAS on Arrival (ACEi + ARB)',
        patient: {
            ...INITIAL_PATIENT,
            current_regimen: buildCurrentRegimen([
                { name: 'Lisinopril', strength: 10, freq: 'qd' },
                { name: 'Valsartan', strength: 80, freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' }
            ])
        }
    },
    {
        // Non-DHP CCB (verapamil) in HFrEF — negative inotrope, Class III harm.
        title: 'Inappropriate Non-DHP CCB in HFrEF (Verapamil)',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 25,
            external_medications: new Set<string>(['Verapamil'])
        }
    },
    {
        // Documented beta-blocker intolerance (bradycardia/AV block). New BB initiation deferred.
        title: 'BB Intolerance Defer New Initiation',
        patient: {
            ...INITIAL_PATIENT,
            pulse: 58,
            current_regimen: buildCurrentRegimen([
                { name: 'Lisinopril', strength: 10, freq: 'qd' },
                { name: 'Furosemide', strength: 40, freq: 'qd' }
            ]),
            discontinued_meds: [
                { name: 'Carvedilol', drug_class: 'Beta Blocker', reason: 'Symptomatic bradycardia and AV block' }
            ]
        }
    },
    {
        // Sulfa allergy — loop/thiazide diuretics are sulfonamides; surface cross-reactivity note.
        title: 'Sulfa Allergy Diuretic Caution',
        patient: {
            ...INITIAL_PATIENT,
            allergies: new Set<string>(['Sulfa'])
        }
    },
    {
        // RED-TEAM REGRESSION: decompensated HFrEF (forces BB dose reduction) whose beta-blocker is
        // ALSO contraindicated (new severe asthma). Removal must satisfy the forced-reduction rule —
        // the patient must still get a regimen (not a silent blank), with taper guidance and no BB.
        title: 'Decompensated HFrEF + Contraindicated BB (Asthma)',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 28,
            nyha_class: 'III' as const,
            volume_status: { dry_weight_kg: 70, current_weight_kg: 73.5, exam_findings: new Set(['Edema (2+)', 'JVP Elevated', 'Orthopnea']) },
            comorbidities: new Set(['HFrEF', 'Severe Asthma / Bronchospasm']),
            current_regimen: buildCurrentRegimen([
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' },
                { name: 'Furosemide', strength: 40, freq: 'qd' }
            ])
        }
    },
    {
        // RED-TEAM REGRESSION: data-entry error (LVEF 99% is physiologically impossible) must be flagged.
        title: 'Implausible Lab Value (LVEF 99)',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 99
        }
    },
    {
        // Mild/moderate asthma: non-selective carvedilol excluded, β1-selective BB available with caution.
        title: 'Mild Asthma BB Selection (Beta-1 Selective)',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 30,
            pulse: 75,
            comorbidities: new Set(['HFrEF', 'Asthma (Mild/Moderate)']),
            current_regimen: []
        }
    },
    {
        // LVEF 41-49 patient arrives on dual MRA (steroidal + finerenone) — keep steroidal, deprescribe nsMRA.
        title: 'Inappropriate Dual MRA on Arrival (Steroidal + nsMRA)',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 45, // LVEF 41-49 — both MRA types are otherwise permissible, so this is true redundancy
            nyha_class: 'II' as const,
            nt_pro_bnp: 1200,
            potassium: 4.6,
            egfr: 55,
            comorbidities: new Set(['HFrEF']),
            current_regimen: buildCurrentRegimen([
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Finerenone (Kerendia)', strength: 10, freq: 'qd' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' }
            ])
        }
    },
    {
        // INTOLERANCE REGRESSION (audit 072): documented ACEi cough intolerance (Lisinopril) while
        // the patient ARRIVES on a different ACEi (Ramipril). Class intolerance must clean up the
        // current regimen too — not just block new ACEi starts. RAAS pillar preserved via ARB/ARNI.
        title: 'ACEi Cough Intolerance on Current ACEi',
        patient: {
            ...INITIAL_PATIENT,
            discontinued_meds: [
                { name: 'Lisinopril', drug_class: 'ACEi', reason: 'Cough' }
            ],
            current_regimen: buildCurrentRegimen([
                { name: 'Ramipril', strength: 5, freq: 'qd' }
            ])
        }
    },
    {
        // INTOLERANCE REGRESSION (red-team probe 2): dual MRA on arrival where the STEROIDAL agent
        // is the intolerable one (gynecomastia history from an MRA) and the nsMRA is viable.
        // Redundancy cleanup must keep the TOLERATED agent (finerenone) — previously the keeper
        // rule blindly preferred the steroidal, so intolerance removal + redundancy removal
        // dropped BOTH MRAs (under-treatment).
        title: 'Dual MRA With Steroidal Intolerance',
        patient: {
            ...INITIAL_PATIENT,
            sex: 'Male',
            ever_lvef_le_40: 'no' as const,
            lvef: 45, // LVEF 41-49 — both MRA types otherwise permissible
            nyha_class: 'II' as const,
            nt_pro_bnp: 1200,
            potassium: 4.6,
            egfr: 55,
            comorbidities: new Set(['HFrEF']),
            discontinued_meds: [
                { name: 'Eplerenone', drug_class: 'MRA', reason: 'Gynecomastia' }
            ],
            current_regimen: buildCurrentRegimen([
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Finerenone (Kerendia)', strength: 10, freq: 'qd' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' }
            ])
        }
    },
    {
        // INTOLERANCE REGRESSION (audit 073): documented spironolactone gynecomastia while the
        // patient is STILL ON spironolactone. It must be removed/swapped in every displayed
        // regimen, and eplerenone (minimal antiandrogenic effect) must remain available so the
        // MRA pillar is not lost to an agent-specific intolerance.
        title: 'Gynecomastia on Current Spironolactone',
        patient: {
            ...INITIAL_PATIENT,
            sex: 'Male',
            discontinued_meds: [
                { name: 'Spironolactone', drug_class: 'MRA', reason: 'Gynecomastia' }
            ],
            current_regimen: buildCurrentRegimen([
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' }
            ])
        }
    },
    {
        // INTOLERANCE REGRESSION (review): budget-constrained ACEi-cough patient. The bare
        // "Remove Ramipril" candidate costs $0 and previously survived the affordability filter
        // while every swap-carrying candidate (ARNI-priced) died — leaving an EMPTY regimen as
        // the top recommendation. Every displayed regimen must retain RAAS coverage.
        title: 'ACEi Cough Intolerance Budget-Constrained',
        patient: {
            ...INITIAL_PATIENT,
            insurance_tier: 'cash' as const,
            max_affordable_cost: 10,
            cost_sensitivity: 9,
            discontinued_meds: [
                { name: 'Lisinopril', drug_class: 'ACEi', reason: 'Cough' }
            ],
            current_regimen: buildCurrentRegimen([
                { name: 'Ramipril', strength: 5, freq: 'qd' }
            ])
        }
    },
    {
        // INTOLERANCE REGRESSION (review): the documented gynecomastia offender is EPLERENONE and
        // the patient arrives on spironolactone (LVEF 41-49, so finerenone is viable). Spironolactone
        // and eplerenone are both avoided; the nsMRA must survive — previously the "dual MRA
        // prevention" formulary exclusion keyed on the departing steroidal MRA and blocked
        // finerenone too, silently dropping the whole MRA pillar.
        title: 'Gynecomastia From Eplerenone on Spironolactone',
        patient: {
            ...INITIAL_PATIENT,
            sex: 'Male',
            lvef: 45,
            ever_lvef_le_40: 'no' as const,
            nyha_class: 'II' as const,
            nt_pro_bnp: 1200,
            potassium: 4.6,
            egfr: 55,
            comorbidities: new Set(['HFrEF']),
            discontinued_meds: [
                { name: 'Eplerenone', drug_class: 'MRA', reason: 'Gynecomastia' }
            ],
            current_regimen: buildCurrentRegimen([
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' }
            ])
        }
    },
    {
        // INTOLERANCE REGRESSION (review): free-text reason_detail containing NEGATED keywords
        // ("no cough", "angioedema ruled out") must NOT force the patient's current tolerated
        // ACEi out of the regimen. Forced current-regimen cleanup requires the structured
        // dropdown reason; free text only (conservatively) blocks new starts.
        title: 'Negated Free-Text Intolerance Detail',
        patient: {
            ...INITIAL_PATIENT,
            discontinued_meds: [
                {
                    name: 'Lisinopril',
                    drug_class: 'ACEi',
                    reason: 'Renal Impairment / AKI',
                    reason_detail: 'no cough; angioedema ruled out, K+ stable throughout'
                }
            ],
            current_regimen: buildCurrentRegimen([
                { name: 'Ramipril', strength: 5, freq: 'qd' }
            ])
        }
    },
    {
        // COST-EFFECTIVENESS REGRESSION (budget sweep): de-novo male HFrEF allowed 2 new classes
        // this visit at a typical commercial copay. The top recommendation must be a multi-pillar
        // GDMT start (>= 2 pillars), NOT MRA monotherapy. Previously eplerenone's "no gynecomastia"
        // tolerability feature (10 pts) was amplified by the special-feature normalization to a
        // full +15 overall, lifting a lone eplerenone above 2-pillar GDMT for any male patient.
        title: 'De-novo HFrEF Male Multi-Pillar Start',
        patient: {
            ...INITIAL_PATIENT,
            sex: 'Male',
            lvef: 25,
            sbp: 118,
            dbp: 76,
            nyha_class: 'II' as const,
            potassium: 4.4,
            egfr: 70,
            comorbidities: new Set(['HFrEF']),
            current_regimen: [],
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80, exam_findings: new Set() },
            insurance_tier: 'commercial' as const,
            max_affordable_cost: 80,
            cost_sensitivity: 5,
            max_new_classes_per_visit: 2
        }
    },
    {
        // COST-EFFECTIVENESS REGRESSION (budget sweep): same as above but diabetic — confirms the
        // SGLT2i "preferred in diabetics" tolerability feature likewise cannot lift a single-pillar
        // start above 2-pillar GDMT. Guards against the monotherapy-amplification bias recurring
        // via a different special feature.
        title: 'De-novo HFrEF Diabetic Multi-Pillar Start',
        patient: {
            ...INITIAL_PATIENT,
            sex: 'Male',
            lvef: 25,
            sbp: 120,
            dbp: 78,
            nyha_class: 'II' as const,
            potassium: 4.4,
            egfr: 70,
            comorbidities: new Set(['HFrEF', 'Diabetes Mellitus Type 2']),
            current_regimen: [],
            volume_status: { dry_weight_kg: 88, current_weight_kg: 88, exam_findings: new Set() },
            insurance_tier: 'commercial' as const,
            max_affordable_cost: 80,
            cost_sensitivity: 5,
            max_new_classes_per_visit: 2
        }
    },
    {
        // COST-EFFECTIVENESS REGRESSION (budget sweep): budget below the cheapest generic forces
        // the over-budget fallback. It must surface the cheapest options BUT order them by clinical
        // value — the highest-benefit near-affordable option leads. Previously the fallback sorted
        // by absolute cost only, so at equal price a lower-benefit agent could lead a higher-benefit
        // one (and a 0-pillar symptomatic-only regimen could top the list).
        title: 'Over-Budget Value Ordering',
        patient: {
            ...INITIAL_PATIENT,
            sex: 'Male',
            lvef: 25,
            sbp: 122,
            dbp: 78,
            nyha_class: 'II' as const,
            potassium: 4.4,
            egfr: 70,
            comorbidities: new Set(['HFrEF']),
            current_regimen: [],
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80, exam_findings: new Set() },
            insurance_tier: 'cash' as const,
            max_affordable_cost: 2,
            cost_sensitivity: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        // CLINICAL RULE REGRESSION: categorical HFimpEF history (ever LVEF <=40) must be treated
        // the same as numeric previous_lvef <=40. Finerenone is LVEF >=40 evidence only and must
        // not substitute for the HFrEF/HFimpEF steroidal MRA pillar.
        title: 'HFimpEF Categorical Prior EF Excludes Finerenone',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 45,
            previous_lvef: undefined,
            ever_lvef_le_40: 'yes' as const,
            nyha_class: 'II' as const,
            nt_pro_bnp: 1200,
            potassium: 4.5,
            egfr: 25,
            comorbidities: new Set(['HFimpEF', 'Chronic Kidney Disease']),
            current_regimen: [],
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80, exam_findings: new Set() },
            insurance_tier: 'commercial' as const,
            max_affordable_cost: 100,
            max_new_classes_per_visit: 2
        }
    },
    {
        // WORKFLOW REGRESSION: max_new_classes_per_visit is a patient-facing sequencing limit.
        // Automatically appended binder/iron rescue therapy must count against it; displayed
        // options must never exceed the configured limit.
        title: 'Max New Classes Counts Binder Rescue',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 30,
            ever_lvef_le_40: 'yes' as const,
            sbp: 120,
            dbp: 78,
            nyha_class: 'II' as const,
            potassium: 5.1,
            egfr: 60,
            comorbidities: new Set(['HFrEF']),
            current_regimen: [],
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80, exam_findings: new Set() },
            insurance_tier: 'commercial' as const,
            max_affordable_cost: 100,
            max_new_classes_per_visit: 1
        }
    },
    {
        // DOSE TARGET REGRESSION: carvedilol target dose is weight-contextual. A patient >85 kg
        // should not receive target-dose credit at 25 mg BID; the engine should surface 50 mg BID.
        title: 'High Body Weight Carvedilol Target Requires 50 BID',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 30,
            sbp: 125,
            dbp: 78,
            nyha_class: 'II' as const,
            potassium: 4.4,
            egfr: 70,
            volume_status: { dry_weight_kg: 100, current_weight_kg: 100, exam_findings: new Set() },
            comorbidities: new Set(['HFrEF']),
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 50, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            insurance_tier: 'commercial' as const,
            max_affordable_cost: 100,
            max_new_classes_per_visit: 1
        }
    },
    // --- AUDIT-FIX REGRESSION SCENARIOS (pregnancy adjunct gates, continuation carve-outs,
    // --- decompensation phenotyping, blank-data guards, hyperkalemic emergency, LVEF clamps) ---
    {
        // REGRESSION (audit fix): Vericiguat (FDA BOXED WARNING — embryo-fetal toxicity) and
        // Ivabradine (Corlanor labeling — fetal harm in animal studies) are pregnancy-
        // contraindicated even when their trial criteria (VICTORIA: NT-proBNP >= 1600 + recent
        // worsening + LVEF < 45; SHIFT: sinus, HR >= 70, LVEF <= 35 on target-dose BB) are
        // otherwise fully met. H/ISDN remains the pregnancy-appropriate RAAS alternative and
        // must NOT be excluded.
        title: 'Pregnant Vericiguat + Ivabradine Exclusion',
        patient: {
            ...INITIAL_PATIENT,
            age: 33,
            sex: 'Female' as const,
            is_pregnant: true,
            sbp: 118,
            dbp: 74,
            pulse: 75, // >= 70: SHIFT initiation criterion met
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 2000, // >= 1600: VICTORIA criterion met
            lvef: 30, // < 45 (VICTORIA) and <= 35 (SHIFT)
            recent_hf_worsening_within_6mo: 'yes' as const,
            volume_status: { dry_weight_kg: 68, current_weight_kg: 69, exam_findings: new Set<string>() },
            egfr: 90,
            potassium: 4.2,
            creatinine: 0.8,
            bun: 14,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            // Target-dose BB (25 BID is target at dry weight <= 85kg) — SHIFT "max tolerated BB" proxy
            current_regimen: buildCurrentRegimen([
                { name: 'Carvedilol', strength: 25, freq: 'bid' }
            ]),
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 3
        }
    },
    {
        // REGRESSION (audit fix): the VICTORIA criteria (NT-proBNP >= 1600, worsening event
        // within 6 months) are trial ENROLLMENT gates for INITIATION only. A patient already
        // ON vericiguat whose NT-proBNP improved to 900 and whose worsening event aged out is
        // showing treatment RESPONSE — that must not force removal (continuation carve-out,
        // mirrors the SGLT2i alreadyOn* pattern).
        title: 'Vericiguat Continuation Carve-Out',
        patient: {
            ...INITIAL_PATIENT,
            age: 61,
            sbp: 116,
            dbp: 72,
            pulse: 68,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 60,
            nt_pro_bnp: 900, // below the 1600 initiation gate — improved on therapy
            lvef: 35,
            recent_hf_worsening_within_6mo: 'no' as const,
            volume_status: { dry_weight_kg: 78, current_weight_kg: 78.5, exam_findings: new Set<string>() },
            egfr: 55,
            potassium: 4.3,
            creatinine: 1.2,
            bun: 18,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
                { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
                { name: 'Vericiguat', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        // REGRESSION (audit fix): BMI >= 30 is a STEP-HFpEF/SUMMIT ENROLLMENT (initiation)
        // gate only. Weight-loss SUCCESS on tirzepatide (BMI now 28) must not force its
        // removal — treatment response is not an indication to stop (continuation carve-out,
        // mirrors the SGLT2i alreadyOn* pattern).
        title: 'GLP-1 Continuation Carve-Out (BMI 28)',
        patient: {
            ...INITIAL_PATIENT,
            age: 60,
            sex: 'Female' as const,
            bmi: 28, // below the 30 initiation gate — successful weight loss on therapy
            sbp: 128,
            dbp: 78,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 62,
            nt_pro_bnp: 700,
            lvef: 55,
            ever_lvef_le_40: 'no' as const,
            volume_status: { dry_weight_kg: 76, current_weight_kg: 77, exam_findings: new Set<string>() },
            egfr: 65,
            potassium: 4.1,
            creatinine: 1.0,
            bun: 16,
            comorbidities: new Set(['HFpEF', 'Obesity']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Tirzepatide (Zepbound)', strength: 15, freq: 'weekly' },
                { name: 'Dapagliflozin', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        // REGRESSION (audit fix): the GLP-1 continuation carve-out must NOT bypass true safety
        // gates — pregnancy (like MTC/MEN2, an FDA gate) applies to initiation AND
        // continuation. A pregnant patient arriving on semaglutide must have it excluded and
        // force-removed from every candidate; the pregnancy-safe beta-blocker is retained.
        title: 'Pregnant on GLP-1 (Force Removal)',
        patient: {
            ...INITIAL_PATIENT,
            age: 31,
            sex: 'Female' as const,
            is_pregnant: true,
            bmi: 34,
            sbp: 118,
            dbp: 74,
            pulse: 82,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 58,
            nt_pro_bnp: 1200,
            lvef: 32,
            volume_status: { dry_weight_kg: 88, current_weight_kg: 89, exam_findings: new Set<string>() },
            egfr: 95,
            potassium: 4.0,
            creatinine: 0.7,
            bun: 10,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Semaglutide (Wegovy)', strength: 2.4, freq: 'weekly' },
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' }
            ]),
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 2
        }
    },
    {
        // REGRESSION (audit fix): LVEF exactly 40 classifies as HFrEF (quad pathway) — the
        // GLP-1 adjunct gate is strictly LVEF > 40 (STEP-HFpEF / SUMMIT enrolled LVEF > 40;
        // no HFrEF evidence). BMI 33 alone must not surface a GLP-1: not displayed and not in
        // the eligible-adjuncts list. NOTE: GLP-1 is not formulary-EXCLUDED here (BMI >= 30,
        // no safety CI) — the eligibility signal is adjunct gating, not contraindication.
        title: 'GLP-1 Boundary LVEF Exactly 40',
        patient: {
            ...INITIAL_PATIENT,
            age: 59,
            bmi: 33,
            sbp: 124,
            dbp: 78,
            pulse: 74,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 1400,
            lvef: 40, // exactly at the boundary — HFrEF, not LVEF 41-49
            volume_status: { dry_weight_kg: 96, current_weight_kg: 97, exam_findings: new Set<string>() },
            egfr: 65,
            potassium: 4.2,
            creatinine: 1.1,
            bun: 18,
            comorbidities: new Set(['HFrEF', 'Obesity']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 300,
            cost_sensitivity: 3,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 8,
            max_new_classes_per_visit: 3
        }
    },
    {
        // REGRESSION (d631873): WARM-and-wet decompensation (NYHA III, +5kg, 2 congestion
        // findings, NO hypoperfusion — no cool extremities, SBP >= 100, pulse pressure > 25)
        // CONTINUES the beta-blocker at its current dose and diureses (ACC/AHA 2022); the
        // forced BB dose-reduction is hypoperfusion-gated ("cold-and-wet") only. The pre-fix
        // bug force-cut the BB in every candidate and suppressed all pillar additions
        // ("reduce beta-blocker, add nothing"). Up-titration is still deferred while
        // decompensated, but safe additions (esp. SGLT2i — EMPULSE/SOLOIST-WHF) must appear.
        title: 'Warm-Wet Decompensation on Existing BB',
        patient: {
            ...INITIAL_PATIENT,
            age: 63,
            sbp: 112, // adequate perfusion; pulse pressure 42 > 25
            dbp: 70,
            pulse: 88,
            rhythm: 'Sinus' as const,
            nyha_class: 'III' as const,
            kccq_score: 34,
            nt_pro_bnp: 3600,
            lvef: 28,
            volume_status: {
                dry_weight_kg: 75,
                current_weight_kg: 80, // +5kg fluid excess
                exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) // congestion WITHOUT Cool Extremities
            },
            egfr: 55,
            potassium: 4.3,
            creatinine: 1.3,
            bun: 24,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' }, // sub-target — up-titration deferred, dose CONTINUED
                { name: 'Lisinopril', strength: 10, freq: 'qd' },
                { name: 'Furosemide', strength: 80, freq: 'qd' }
            ]),
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        // REGRESSION (audit fix): blank eGFR/creatinine (the 0 "not entered" sentinel) trips
        // every `egfr < X` formulary gate. Missing data must not read as end-stage CKD:
        // working spironolactone is NOT force-removed as "contraindicated"; new renal-gated
        // starts are withheld with the honest "Renal data required" reason (not "Clinical
        // Contraindication"); and the DATA REQUIRED renal alert fires.
        title: 'Blank Renal Data Stable Spironolactone',
        patient: {
            ...INITIAL_PATIENT,
            age: 66,
            sbp: 120,
            dbp: 76,
            pulse: 70,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 58,
            nt_pro_bnp: 1500,
            lvef: 30,
            volume_status: { dry_weight_kg: 78, current_weight_kg: 78.5, exam_findings: new Set<string>() },
            egfr: 0, // not entered (blank sentinel)
            creatinine: 0, // not entered (blank sentinel)
            bun: 18,
            potassium: 4.5, // K+ IS entered and safe — only renal data is missing
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' },
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' }
            ]),
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        // REGRESSION (audit fix / red-team probe 2): dual MRA (spironolactone + finerenone) where
        // gynecomastia bars every steroidal MRA. The unknown-EF-history HFimpEF presumption
        // (patient on RAAS/MRA, no documented prior EF) previously contraindicated the KEPT
        // finerenone too — force-removing BOTH MRAs and dropping the pillar entirely. The
        // presumption now gates INITIATION only: the tolerated nsMRA the patient is already on
        // must be retained (FINEARTS-HF: LVEF >= 40).
        title: 'Dual MRA Unknown History Keeps nsMRA',
        patient: {
            ...INITIAL_PATIENT,
            age: 63,
            sbp: 124,
            dbp: 78,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 62,
            nt_pro_bnp: 1200,
            lvef: 45,
            volume_status: { dry_weight_kg: 82, current_weight_kg: 82.5, exam_findings: new Set<string>() },
            egfr: 55,
            creatinine: 1.3,
            bun: 20,
            potassium: 4.6,
            comorbidities: new Set(['HFrEF']),
            allergies: new Set<string>(),
            discontinued_meds: [
                { name: 'Eplerenone', drug_class: 'MRA', reason: 'gynecomastia' }
            ],
            current_regimen: buildCurrentRegimen([
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Finerenone (Kerendia)', strength: 10, freq: 'qd' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        // REGRESSION (audit fix): baseline K+ 6.0-6.4 is a medical emergency (ECG, urgent
        // treatment) — the HYPERKALEMIC EMERGENCY alert must fire, but deprescribing the
        // offending RAAS/MRA with binder rescue is still clinically useful, so
        // recommendations continue (unlike the >= 6.5 alerts-only gate).
        title: 'Hyperkalemic Emergency K+ 6.2 (Deprescribe Offered)',
        patient: {
            ...INITIAL_PATIENT,
            age: 70,
            sbp: 122,
            dbp: 76,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 55,
            nt_pro_bnp: 1600,
            lvef: 30,
            volume_status: { dry_weight_kg: 76, current_weight_kg: 76.5, exam_findings: new Set<string>() },
            egfr: 45,
            potassium: 6.2,
            creatinine: 1.6,
            bun: 28,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Spironolactone', strength: 25, freq: 'qd' }, // K+ >= 6.0 → withheld (removed); 5.5-5.9 would be a one-step reduction
                { name: 'Lisinopril', strength: 10, freq: 'qd' }, // K+ > 5.4 → hard CI, force-removed
                { name: 'Carvedilol', strength: 12.5, freq: 'bid' }
            ]),
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        // REGRESSION (audit fix): baseline K+ >= 6.5 returns ALERTS ONLY (parallel to the
        // SBP < 90 hemodynamic gate) — no drug recommendations while an immediate emergency
        // (ECG, IV calcium, insulin/glucose, binder or dialysis) is untreated.
        title: 'Hyperkalemic Emergency K+ 6.8 (Alerts Only)',
        patient: {
            ...INITIAL_PATIENT,
            age: 72,
            sbp: 124,
            dbp: 78,
            pulse: 74,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 52,
            nt_pro_bnp: 1800,
            lvef: 30,
            volume_status: { dry_weight_kg: 74, current_weight_kg: 74.5, exam_findings: new Set<string>() },
            egfr: 40,
            potassium: 6.8,
            creatinine: 1.8,
            bun: 32,
            comorbidities: new Set(['HFrEF', 'Chronic Kidney Disease']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: buildCurrentRegimen([
                { name: 'Spironolactone', strength: 25, freq: 'qd' },
                { name: 'Lisinopril', strength: 10, freq: 'qd' }
            ]),
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        // REGRESSION (audit fix): previous_lvef 0 is a BLANK field, not a documented prior EF
        // of 0% — with ever_lvef_le_40 'no' this patient is ordinary HFpEF (SGLT2i-first
        // pathway). Pre-fix, the 0 sentinel read as "prior LVEF <= 40" and flipped the
        // phenotype to HFimpEF quad therapy (RAAS/BB pillars for a never-reduced EF).
        title: 'HFpEF Previous LVEF Zero Sentinel',
        patient: {
            ...INITIAL_PATIENT,
            age: 71,
            sex: 'Female' as const,
            sbp: 138,
            dbp: 80,
            pulse: 72,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 58,
            nt_pro_bnp: 700,
            lvef: 60,
            previous_lvef: 0, // blank sentinel — NOT a measured prior EF
            ever_lvef_le_40: 'no' as const,
            volume_status: { dry_weight_kg: 70, current_weight_kg: 71, exam_findings: new Set(['Edema (1+)']) },
            egfr: 60,
            potassium: 4.2,
            creatinine: 1.0,
            bun: 18,
            comorbidities: new Set(['HFpEF', 'Hypertension']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },
    {
        // REGRESSION (audit fix): the projected-LVEF ceiling no longer pulls BELOW baseline.
        // For HFpEF baselines above 55 (here 60), a zero/positive therapy delta must HOLD at
        // baseline — the old unconditional Math.min(55, ...) fabricated a 60 → 55 EF decline
        // (and a false "EF may decline" caution) on every candidate, including a simple
        // SGLT2i add.
        title: 'HFpEF LVEF 60 No Fabricated Decline',
        patient: {
            ...INITIAL_PATIENT,
            age: 69,
            sex: 'Male' as const,
            sbp: 136,
            dbp: 82,
            pulse: 74,
            rhythm: 'Sinus' as const,
            nyha_class: 'II' as const,
            kccq_score: 60,
            nt_pro_bnp: 650,
            lvef: 60,
            ever_lvef_le_40: 'no' as const,
            volume_status: { dry_weight_kg: 82, current_weight_kg: 83, exam_findings: new Set(['Edema (1+)']) },
            egfr: 62,
            potassium: 4.1,
            creatinine: 1.1,
            bun: 18,
            comorbidities: new Set(['HFpEF', 'Hypertension']),
            allergies: new Set<string>(),
            discontinued_meds: [],
            current_regimen: [],
            max_affordable_cost: 250,
            cost_sensitivity: 4,
            insurance_tier: 'commercial' as const,
            complexity_tolerance: 7,
            max_new_classes_per_visit: 2
        }
    },

    // ===== MRA / K+ binder source-verified corrections (docs/medication-review-2026-11-10/verified-mra-binders.md) =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 62, sex: 'Male' as const, sbp: 124, dbp: 76, pulse: 74, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 62, nt_pro_bnp: 1400, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 60, creatinine: 1.2, bun: 20, potassium: 4.5,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            current_regimen: [] as RegimenMed[],
            max_affordable_cost: 400, cost_sensitivity: 3, insurance_tier: 'commercial' as const,
            complexity_tolerance: 8, max_new_classes_per_visit: 2,
        };
        // Quad minus the MRA: the MRA is the one missing pillar, so a new MRA start is what the engine weighs.
        const noMra = buildCurrentRegimen([
            { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
            { name: 'Carvedilol', strength: 25, freq: 'bid' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ]);
        // ARNI below target + beta-blocker + SGLT2i, no MRA: at borderline potassium the ARNI step-up projects potassium above 5.3,
        // which is what the ordinary (reactive) binder rescue covers. A new MRA is withheld above 5.0 (rule E15), so it cannot be the trigger.
        const arniStepUp = buildCurrentRegimen([
            { name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' },
            { name: 'Carvedilol', strength: 12.5, freq: 'bid' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ]);
        const hfpef = { ...base, lvef: 55, nt_pro_bnp: 700, ever_lvef_le_40: 'no' as const, comorbidities: new Set(['HFpEF']) };
        return [
            { title: 'MRA-Source Eplerenone With Strong CYP3A4 Inhibitor Excluded', patient: { ...base, external_medications: new Set(['Clarithromycin']) } },
            { title: 'MRA-Source Finerenone With Strong CYP3A4 Inhibitor Excluded', patient: { ...hfpef, external_medications: new Set(['Itraconazole']) } },
            { title: 'MRA-Source Adrenal Insufficiency Excludes Finerenone And Spironolactone', patient: { ...hfpef, comorbidities: new Set(['HFpEF', "Adrenal Insufficiency (Addison's disease)"]) } },
            { title: 'MRA-Source Eplerenone eGFR 30 Boundary', patient: { ...base, egfr: 30, creatinine: 2.2 } },
            { title: 'MRA-Source Eplerenone Moderate CYP3A Inhibitor Cap 25 mg', patient: { ...base, external_medications: new Set(['Diltiazem']),
                current_regimen: buildCurrentRegimen([{ name: 'Eplerenone', strength: 50, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            { title: 'MRA-Source Current MRA K+ 5.6 One-Step Reduction', patient: { ...base, potassium: 5.6,
                current_regimen: buildCurrentRegimen([{ name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            { title: 'MRA-Source Current MRA K+ 5.7 Lowest Dose Withheld', patient: { ...base, potassium: 5.7,
                current_regimen: buildCurrentRegimen([{ name: 'Eplerenone', strength: 25, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            { title: 'MRA-Source Current MRA K+ 6.1 Withheld', patient: { ...base, potassium: 6.1,
                current_regimen: buildCurrentRegimen([{ name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            // Potassium 6.0-6.4 (decision 2026-11-11, verified-clinical-decisions-2026-11-11.md rows 5b, 7): urgent ECG/repeat alert, no RAAS/MRA start or
            // increase, a current MRA withheld. Each K value is run on the full quad (a current MRA) and on the quad minus the MRA (a new-start candidate).
            ...[6.0, 6.2, 6.4].flatMap(k => [
                { title: `K6-Source K+ ${k.toFixed(1)} On Quad`, patient: { ...base, potassium: k,
                    current_regimen: buildCurrentRegimen([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' },
                        { name: 'Dapagliflozin', strength: 10, freq: 'qd' }, { name: 'Spironolactone', strength: 25, freq: 'qd' }]) } },
                { title: `K6-Source K+ ${k.toFixed(1)} No MRA`, patient: { ...base, potassium: k, current_regimen: arniStepUp } },
            ]),
            { title: 'MRA-Source Finerenone eGFR 40 Targets 20 mg', patient: { ...hfpef, egfr: 40, creatinine: 1.8,
                current_regimen: buildCurrentRegimen([{ name: 'Dapagliflozin', strength: 10, freq: 'qd' }, { name: 'Finerenone (Kerendia)', strength: 20, freq: 'qd' }]) } },
            { title: 'MRA-Source Finerenone eGFR 70 Targets 40 mg', patient: { ...hfpef, egfr: 70, creatinine: 1.0,
                current_regimen: buildCurrentRegimen([{ name: 'Dapagliflozin', strength: 10, freq: 'qd' }, { name: 'Finerenone (Kerendia)', strength: 20, freq: 'qd' }]) } },
            { title: 'MRA-Source Finerenone New Start Tier eGFR 70', patient: { ...hfpef, egfr: 70, creatinine: 1.0 } },
            { title: 'MRA-Source Finerenone New Start Tier eGFR 40', patient: { ...hfpef, egfr: 40, creatinine: 1.8 } },
            { title: 'MRA-Source Spironolactone Start Dose eGFR 40', patient: { ...base, egfr: 40, creatinine: 1.7, current_regimen: noMra } },
            { title: 'MRA-Source Spironolactone Start Dose eGFR 70', patient: { ...base, egfr: 70, creatinine: 1.0, current_regimen: noMra } },
            // Second pass 2026-11-11 (2022 AHA/ACC/HFSA 7.3.3 primary text): potassium 5.0 or above and eGFR 30 or below are contraindications to MRA INITIATION; halve the dosing at eGFR 31-49.
            { title: 'MRA-Source New Start K+ 5.0 Staged (guideline: 5.0 or above)', patient: { ...base, potassium: 5.0, current_regimen: noMra } },
            { title: 'MRA-Source New Start K+ 4.9 Offered', patient: { ...base, potassium: 4.9, current_regimen: noMra } },
            { title: 'MRA-Source Spironolactone New Start eGFR 30 Excluded', patient: { ...base, egfr: 30, creatinine: 2.2, current_regimen: noMra } },
            { title: 'MRA-Source Spironolactone Current At eGFR 30 Continued', patient: { ...base, egfr: 30, creatinine: 2.2,
                current_regimen: buildCurrentRegimen([{ name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            // Baseline creatinine (2026 ESC 6.1.6 / 10.3, S4/S5/S8): eGFR is the app's CKD-EPI 2021 value for each creatinine (male, age 62, as the form computes it).
            ...((): TestScenario[] => {
                const kidney = (baseline: number | undefined, current: number) => ({
                    ...base, creatinine: current, baseline_creatinine: baseline, egfr: calculateCKDEPI(current, base.age, base.sex),
                    current_regimen: buildCurrentRegimen([
                        { name: 'Lisinopril', strength: 20, freq: 'qd' }, { name: 'Spironolactone', strength: 25, freq: 'qd' },
                        { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]),
                });
                return [
                    { title: 'MRA-Source Kidney-Baseline Blank Keeps Behaviour', patient: kidney(undefined, 1.6) },
                    { title: 'MRA-Source Kidney-Baseline Rise 30% No Change', patient: kidney(1.0, 1.3) },
                    { title: 'MRA-Source Kidney-Baseline Rise 60% Halves Both', patient: kidney(1.0, 1.6) },
                    { title: 'MRA-Source Kidney-Baseline Rise 40% eGFR Fall Over 30% Halves Both', patient: kidney(1.0, 1.4) },
                    { title: 'MRA-Source Kidney-Baseline Rise 130% Stops Both', patient: kidney(1.0, 2.3) },
                    { title: 'MRA-Source Kidney-Baseline Rise 59% With eGFR Below 20 Stops Both', patient: kidney(2.2, 3.5) },
                    { title: 'MRA-Source Kidney-Baseline Stable eGFR 19 Kept No Stop', patient: kidney(3.4, 3.5) },
                ];
            })(),
            { title: 'MRA-Source Halved Dose Cap eGFR 49 New Start', patient: { ...base, egfr: 49, creatinine: 1.6, current_regimen: noMra } },
            { title: 'MRA-Source Halved Dose Cap eGFR 49 Current Spironolactone 50', patient: { ...base, egfr: 49, creatinine: 1.6,
                current_regimen: buildCurrentRegimen([{ name: 'Spironolactone', strength: 50, freq: 'qd' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'MRA-Source MRA Start K+ 5.3 Staged, Not Co-Started With A Binder', patient: { ...base, potassium: 5.3, current_regimen: noMra } },
            { title: 'MRA-Source MRA Start K+ 5.3 No Binder Available', patient: { ...base, potassium: 5.3, current_regimen: noMra } },
            { title: 'MRA-Source Lokelma HF Warning (No Patiromer Available)', patient: { ...base, potassium: 5.4, current_regimen: arniStepUp } },
            { title: 'MRA-Source Patiromer Warnings (No Lokelma Available)', patient: { ...base, potassium: 5.4, current_regimen: arniStepUp } },
        ];
    })(),

    // ===== RAAS (ARNI / ACEi / ARB) source-verified corrections (docs/medication-review-2026-11-10/verified-raas.md) =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 62, sex: 'Male' as const, sbp: 140, dbp: 80, pulse: 74, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 62, nt_pro_bnp: 1400, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 70, creatinine: 1.0, bun: 20, potassium: 4.3,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            current_regimen: [] as RegimenMed[],
            max_affordable_cost: 3000, cost_sensitivity: 3, insurance_tier: 'commercial' as const,
            complexity_tolerance: 8, max_new_classes_per_visit: 3,
        };
        const onBbSglt = buildCurrentRegimen([
            { name: 'Carvedilol', strength: 12.5, freq: 'bid' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ]);
        return [
            { title: 'RAAS-Source RAAS-Naive eGFR 22 ARNI 24/26 Only', patient: { ...base, egfr: 22, creatinine: 2.9 } },
            { title: 'RAAS-Source RAAS-Naive Normal Renal ARNI 24/26', patient: { ...base, current_regimen: onBbSglt } },
            { title: 'RAAS-Source RAAS-Naive SBP 150 On Carvedilol Dapagliflozin ARNI 24/26', patient: { ...base, current_regimen: onBbSglt, sbp: 150 } },
            { title: 'RAAS-Source Target-Dose ACEi To ARNI Swap 49/51 Washout', patient: { ...base, sbp: 132,
                current_regimen: buildCurrentRegimen([{ name: 'Lisinopril', strength: 40, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'RAAS-Source Low-Dose ACEi To ARNI Swap 24/26', patient: { ...base, sbp: 132,
                current_regimen: buildCurrentRegimen([{ name: 'Lisinopril', strength: 5, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'RAAS-Source ARNI To ACEi Washout No ARB Available', patient: { ...base, sbp: 132,
                comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)']),
                current_regimen: buildCurrentRegimen([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '49/51', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'RAAS-Source Aliskiren With Diabetes Excludes ARNI ACEi ARB', patient: { ...base, current_regimen: onBbSglt,
                comorbidities: new Set(['HFrEF', 'Diabetes Mellitus Type 2']), external_medications: new Set(['Aliskiren']) } },
            { title: 'RAAS-Source Aliskiren Without Diabetes Not Excluded', patient: { ...base, current_regimen: onBbSglt, external_medications: new Set(['Aliskiren']) } },
            { title: 'RAAS-Source Losartan 150 Counts As Target', patient: { ...base, sbp: 138,
                current_regimen: buildCurrentRegimen([{ name: 'Losartan', strength: 150, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'RAAS-Source ARNI At SBP 98 Caution', patient: { ...base, sbp: 98, dbp: 62,
                current_regimen: buildCurrentRegimen([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }, { name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'RAAS-Source Lisinopril eGFR 25 Not Capped Below Label No ARNI Available', patient: { ...base, egfr: 25, creatinine: 2.6,
                current_regimen: buildCurrentRegimen([{ name: 'Lisinopril', strength: 5, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'RAAS-Source Child-Pugh B Confirmed ARNI Reduced Start', patient: { ...base, sbp: 138,
                comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)', 'Liver Disease: Child-Pugh B confirmed (not C)']),
                current_regimen: buildCurrentRegimen([{ name: 'Valsartan', strength: 160, freq: 'bid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'RAAS-Source ACEi Add Starts At Lowest Tier No ARNI Available', patient: { ...base, current_regimen: onBbSglt } },
        ];
    })(),

    // ===== Rate control source-verified corrections (docs/medication-review-2026-11-10/verified-rate-control.md) =====
    // Beta-blockers (carvedilol, metoprolol succinate, bisoprolol), ivabradine and digoxin: labels Coreg, metoprolol succinate ER,
    // bisoprolol, Corlanor, Lanoxin; MOCHA, COMET, SHIFT, DIG.
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 62, sex: 'Male' as const, sbp: 124, dbp: 76, pulse: 74, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 62, nt_pro_bnp: 1400, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 60, creatinine: 1.2, bun: 20, potassium: 4.5,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            current_regimen: [] as RegimenMed[],
            max_affordable_cost: 3000, cost_sensitivity: 3, insurance_tier: 'commercial' as const,
            complexity_tolerance: 8, max_new_classes_per_visit: 2,
        };
        const withBb = (name: string, strength: number | string, freq = 'bid') => buildCurrentRegimen([
            { name, strength, freq },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ]);
        // All four pillars at target: nothing left to add or titrate, so only adjuncts remain.
        const quad = buildCurrentRegimen([
            { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
            { name: 'Carvedilol', strength: 25, freq: 'bid' },
            { name: 'Spironolactone', strength: 25, freq: 'qd' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ]);
        return [
            { title: 'Rate-Source Carvedilol 25 mg HR 54 One-Step Reduction', patient: { ...base, pulse: 54, current_regimen: withBb('Carvedilol', 25) } },
            { title: 'Rate-Source Carvedilol 3.125 mg HR 50 Withheld', patient: { ...base, pulse: 50, current_regimen: withBb('Carvedilol', 3.125) } },
            // Metoprolol succinate and bisoprolol use 50 bpm (2026 ESC Supplementary Table S6; their labels give no number), carvedilol 55 (label). 2026-11-11: the old 52/53 probes moved to 48.
            { title: 'Rate-Source Metoprolol Succinate 100 mg HR 48 One-Step Reduction', patient: { ...base, pulse: 48, current_regimen: withBb('Metoprolol Succinate', 100, 'qd') } },
            { title: 'Rate-Source Metoprolol Succinate 100 mg HR 52 No Reduction', patient: { ...base, pulse: 52, current_regimen: withBb('Metoprolol Succinate', 100, 'qd') } },
            { title: 'Rate-Source Bisoprolol New Start At HR 52 Allowed', patient: { ...base, pulse: 52, current_regimen: buildCurrentRegimen([{ name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Bisoprolol New Start At HR 48 Withheld', patient: { ...base, pulse: 48, current_regimen: buildCurrentRegimen([{ name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Bisoprolol 10 mg HR 48 One-Step Reduction', patient: { ...base, pulse: 48, current_regimen: withBb('Bisoprolol', 10, 'qd') } },
            { title: 'Rate-Source Third-Degree AV Block Beta-Blocker Removed', patient: { ...base, pulse: 52, rhythm: '3rd Degree AV Block' as const, current_regimen: withBb('Carvedilol', 12.5) } },
            { title: 'Rate-Source Sick Sinus Syndrome Without Pacemaker Beta-Blocker Removed', patient: { ...base, pulse: 66, comorbidities: new Set(['HFrEF', 'Sick Sinus Syndrome / Sinoatrial Block']), current_regimen: withBb('Metoprolol Succinate', 50, 'qd') } },
            { title: 'Rate-Source Paced Rhythm HR 52 Beta-Blocker Kept', patient: { ...base, pulse: 52, rhythm: 'Paced' as const, comorbidities: new Set(['HFrEF', 'Sick Sinus Syndrome / Sinoatrial Block']), current_regimen: withBb('Carvedilol', 12.5) } },
            { title: 'Rate-Source No Up-Titration At HR 56', patient: { ...base, pulse: 56, current_regimen: withBb('Carvedilol', 12.5) } },
            { title: 'Rate-Source Up-Titration Offered At HR 66', patient: { ...base, pulse: 66, current_regimen: withBb('Carvedilol', 12.5) } },
            { title: 'Rate-Source New Beta-Blocker Start Blocked At HR 48', patient: { ...base, pulse: 48, current_regimen: buildCurrentRegimen([{ name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Beta-Blocker Dose Effects Equalized', patient: { ...base, current_regimen: withBb('Carvedilol', 25) } },
            { title: 'Rate-Source Carvedilol Child-Pugh B Confirmed Allowed', patient: { ...base, comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)', 'Liver Disease: Child-Pugh B confirmed (not C)']), current_regimen: [] } },
            { title: 'Rate-Source Carvedilol Child-Pugh B/C Unspecified Excluded Metoprolol Allowed', patient: { ...base, comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)']), current_regimen: [] } },
            { title: 'Rate-Source Bisoprolol US Tiers', patient: { ...base, comorbidities: new Set(['HFrEF', 'Asthma (Mild/Moderate)']), current_regimen: [] } },
            { title: 'Rate-Source Ivabradine Strong CYP3A4 Inhibitor Excluded', patient: { ...base, pulse: 78, external_medications: new Set(['Clarithromycin']), current_regimen: quad } },
            { title: 'Rate-Source Ivabradine Telithromycin Excluded', patient: { ...base, pulse: 78, external_medications: new Set(['Telithromycin']), current_regimen: quad } },
            { title: 'Rate-Source Ivabradine With Diltiazem Warned', patient: { ...base, pulse: 66, external_medications: new Set(['Diltiazem']),
                current_regimen: buildCurrentRegimen([{ name: 'Ivabradine', strength: 5, freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Ivabradine Inducer Warned', patient: { ...base, pulse: 66, external_medications: new Set(['Rifampin']),
                current_regimen: buildCurrentRegimen([{ name: 'Ivabradine', strength: 5, freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Ivabradine Continuation HR 58 Keeps Drug And Bonus', patient: { ...base, pulse: 58, current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }, { name: 'Ivabradine', strength: 5, freq: 'bid' }]) } },
            { title: 'Rate-Source Ivabradine HR 48 On 5 mg Reduced To 2.5 mg', patient: { ...base, pulse: 48, current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }, { name: 'Ivabradine', strength: 5, freq: 'bid' }]) } },
            { title: 'Rate-Source Ivabradine HR 48 On 2.5 mg Withheld', patient: { ...base, pulse: 48, current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }, { name: 'Ivabradine', strength: 2.5, freq: 'bid' }]) } },
            { title: 'Rate-Source Ivabradine Start Tier 5 mg', patient: { ...base, pulse: 78, current_regimen: quad } },
            { title: 'Rate-Source Ivabradine Start Tier 2.5 mg Conduction Defect', patient: { ...base, pulse: 78, comorbidities: new Set(['HFrEF', 'Conduction Defect (history)']), current_regimen: quad } },
            { title: 'Rate-Source Ivabradine Beta-Blocker Limited By Hypotension', patient: { ...base, pulse: 78, sbp: 98, dbp: 62, comorbidities: new Set(['HFrEF', 'Hypotension (Chronic)']),
                current_regimen: buildCurrentRegimen([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '24/26', freq: 'bid' }, { name: 'Carvedilol', strength: 6.25, freq: 'bid' },
                    { name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Ivabradine Beta-Blocker Not Maximized Not Offered', patient: { ...base, pulse: 78, current_regimen: buildCurrentRegimen([
                { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 6.25, freq: 'bid' },
                { name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Ivabradine Sick Sinus Syndrome Excluded', patient: { ...base, pulse: 78, comorbidities: new Set(['HFrEF', 'Sick Sinus Syndrome / Sinoatrial Block']), current_regimen: quad } },
            { title: 'Rate-Source Ivabradine Acute Decompensation Excluded', patient: { ...base, pulse: 78, nyha_class: 'IV' as const, current_regimen: quad } },
            { title: 'Rate-Source Ivabradine Hepatic Child-Pugh B/C Unspecified Excluded', patient: { ...base, pulse: 78, comorbidities: new Set(['HFrEF', 'Liver Disease (Child-Pugh B/C)']), current_regimen: quad } },
            { title: 'Rate-Source Ivabradine Paced Rhythm Excluded', patient: { ...base, pulse: 78, rhythm: 'Paced' as const, current_regimen: quad } },
            { title: 'Rate-Source Digoxin Sinus Rhythm Not Offered While Pillars Remain Addable', patient: { ...base, nyha_class: 'III' as const, lvef: 25,
                current_regimen: buildCurrentRegimen([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            // Spironolactone at 50 mg since 2026-11-11 (2026 ESC Table 11 target); at 25 mg the engine still has a pillar to up-titrate and correctly holds digoxin back.
            { title: 'Rate-Source Digoxin Sinus Rhythm Offered After Maximal GDMT', patient: { ...base, nyha_class: 'III' as const, lvef: 25, current_regimen: quad.map(r => r.med.name === 'Spironolactone' ? { ...r, dose: r.med.available_doses.find(d => d.strength === 50)! } : r) } },
            { title: 'Rate-Source Digoxin Sinus Rhythm Preserved EF Not Offered', patient: { ...base, nyha_class: 'III' as const, lvef: 58, ever_lvef_le_40: 'no' as const, comorbidities: new Set(['HFpEF']),
                current_regimen: buildCurrentRegimen([{ name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Digoxin Ventricular Fibrillation Excluded', patient: { ...base, rhythm: 'AFib' as const, pulse: 96, comorbidities: new Set(['HFrEF', 'Ventricular Fibrillation (active)']), current_regimen: withBb('Carvedilol', 25) } },
            { title: 'Rate-Source Digoxin WPW Warning', patient: { ...base, rhythm: 'AFib' as const, pulse: 96, comorbidities: new Set(['HFrEF', 'Wolff-Parkinson-White / Accessory Pathway']),
                current_regimen: buildCurrentRegimen([{ name: 'Digoxin', strength: 125, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Digoxin Potassium 5.8 Not Excluded Warned', patient: { ...base, rhythm: 'AFib' as const, pulse: 96, potassium: 5.8,
                current_regimen: buildCurrentRegimen([{ name: 'Digoxin', strength: 125, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Digoxin eGFR 12 Not Excluded Warned', patient: { ...base, rhythm: 'AFib' as const, pulse: 96, egfr: 12, creatinine: 4.6,
                current_regimen: buildCurrentRegimen([{ name: 'Digoxin', strength: 62.5, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }]) } },
            { title: 'Rate-Source Digoxin Amiodarone Dose Reduction Text', patient: { ...base, rhythm: 'AFib' as const, pulse: 96, external_medications: new Set(['Amiodarone']),
                current_regimen: buildCurrentRegimen([{ name: 'Digoxin', strength: 125, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Rate-Source Digoxin Heart-Rate Effect Only In AFib', patient: { ...base, current_regimen: quad } },
            { title: 'Rate-Source Ivabradine Metadata', patient: { ...base, current_regimen: quad } },
        ];
    })(),
    // --- SGLT2i / GLP-1 / vericiguat / IV iron / H-ISDN source-verified corrections (docs/medication-review-2026-11-10/verified-sglt2-glp1-adjuncts.md) ---
    ...((): TestScenario[] => {
        const hfref = {
            ...INITIAL_PATIENT,
            age: 62, sex: 'Male' as const, race: 'White' as const, bmi: 27, sbp: 124, dbp: 76, pulse: 74, rhythm: 'Sinus' as const,
            nyha_class: 'III' as const, kccq_score: 52, nt_pro_bnp: 1200, lvef: 30, recent_hf_worsening_within_6mo: 'yes' as const,
            volume_status: { dry_weight_kg: 85, current_weight_kg: 85.5, exam_findings: new Set<string>() },
            egfr: 60, creatinine: 1.2, bun: 20, potassium: 4.5,
            comorbidities: new Set(['HFrEF']), external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [], ever_lvef_le_40: 'yes' as const,
            ferritin: undefined, tsat: undefined, hemoglobin: undefined,
            max_affordable_cost: 5000, cost_sensitivity: 2, insurance_tier: 'commercial' as const,
            complexity_tolerance: 9, max_new_classes_per_visit: 2,
        };
        const quad = buildCurrentRegimen([
            { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
            { name: 'Carvedilol', strength: 25, freq: 'bid' },
            { name: 'Spironolactone', strength: 25, freq: 'qd' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ]);
        const hfpef = {
            ...hfref,
            age: 60, sex: 'Female' as const, bmi: 36, height_cm: 165, nyha_class: 'II' as const, kccq_score: 55, nt_pro_bnp: 900, lvef: 58,
            volume_status: { dry_weight_kg: 100, current_weight_kg: 100.5, exam_findings: new Set<string>() },
            egfr: 70, comorbidities: new Set(['HFpEF', 'Obesity (BMI > 30)']), ever_lvef_le_40: 'no' as const,
            current_regimen: buildCurrentRegimen([{ name: 'Dapagliflozin', strength: 10, freq: 'qd' }]),
        };
        const sglt = buildCurrentRegimen([{ name: 'Dapagliflozin', strength: 10, freq: 'qd' }]);
        const onGlp = (name: string, strength: number) => buildCurrentRegimen([{ name, strength, freq: 'weekly' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]);
        const iron = { ...hfref, ferritin: 60, tsat: 15, current_regimen: quad };
        return [
            // GLP-1
            { title: 'Adjunct-Source GLP-1 KCCQ And Weight Placebo-Adjusted', patient: hfpef },
            { title: 'Adjunct-Source GLP-1 New Start Is Lowest Tier', patient: hfpef },
            { title: 'Adjunct-Source Semaglutide Titration One Step 0.25 To 0.5', patient: { ...hfpef, current_regimen: onGlp('Semaglutide (Wegovy)', 0.25) } },
            { title: 'Adjunct-Source Semaglutide Titration One Step 1.7 To 2.4', patient: { ...hfpef, current_regimen: onGlp('Semaglutide (Wegovy)', 1.7) } },
            { title: 'Adjunct-Source Tirzepatide Titration One Step 2.5 To 5', patient: { ...hfpef, current_regimen: onGlp('Tirzepatide (Zepbound)', 2.5) } },
            { title: 'Adjunct-Source Tirzepatide Titration One Step 10 To 12.5', patient: { ...hfpef, current_regimen: onGlp('Tirzepatide (Zepbound)', 10) } },
            { title: 'Adjunct-Source Semaglutide Not Started At LVEF 43', patient: { ...hfpef, lvef: 43, ever_lvef_le_40: 'no' as const } },
            { title: 'Adjunct-Source Semaglutide Started At LVEF 46 Tirzepatide Not', patient: { ...hfpef, lvef: 46, ever_lvef_le_40: 'no' as const } },
            { title: 'Adjunct-Source Tirzepatide Not Started At LVEF 47', patient: { ...hfpef, lvef: 47, ever_lvef_le_40: 'no' as const } },
            { title: 'Adjunct-Source GLP-1 Continuation Below Initiation Gates', patient: { ...hfpef, lvef: 42, bmi: 28, ever_lvef_le_40: 'no' as const, current_regimen: onGlp('Semaglutide (Wegovy)', 1.0) } },
            { title: 'Adjunct-Source GLP-1 BMI 28 Not Started', patient: { ...hfpef, bmi: 28 } },
            { title: 'Adjunct-Source GLP-1 Cautions Pancreatitis Gastroparesis Retinopathy', patient: { ...hfpef,
                comorbidities: new Set(['HFpEF', 'Obesity (BMI > 30)', 'History of Pancreatitis', 'Severe Gastroparesis', 'Diabetic Retinopathy']),
                current_regimen: onGlp('Semaglutide (Wegovy)', 0.5) } },
            { title: 'Adjunct-Source GLP-1 Type 2 Diabetes Reduces Effect', patient: { ...hfpef, comorbidities: new Set(['HFpEF', 'Obesity (BMI > 30)', 'Diabetes Mellitus Type 2']) } },
            { title: 'Adjunct-Source GLP-1 Evidence Bonus Equal No Superior Claim', patient: hfpef },
            { title: 'Adjunct-Source Tirzepatide Dose Map And NT-proBNP', patient: hfpef },
            { title: 'Adjunct-Source Tirzepatide Cash Price By Dose', patient: { ...hfpef, insurance_tier: 'cash' as const } },
            // SGLT2i
            { title: 'Adjunct-Source Empagliflozin Started At eGFR 22 Dapagliflozin Not', patient: { ...hfref, egfr: 22, creatinine: 3.0, current_regimen: [] } },
            { title: 'Adjunct-Source SGLT2i Not Started At eGFR 18', patient: { ...hfref, egfr: 18, creatinine: 3.6, current_regimen: [] } },
            { title: 'Adjunct-Source SGLT2i Continuation At eGFR 18', patient: { ...hfref, egfr: 18, creatinine: 3.6, current_regimen: sglt } },
            { title: 'Adjunct-Source SGLT2i KCCQ Placebo-Adjusted And Generic Price', patient: hfref },
            // Vericiguat
            { title: 'Adjunct-Source Vericiguat Offered At NT-proBNP 1200 Sinus', patient: { ...hfref, nt_pro_bnp: 1200, current_regimen: quad } },
            { title: 'Adjunct-Source Vericiguat Not Offered At NT-proBNP 1200 AFib', patient: { ...hfref, rhythm: 'AFib' as const, nt_pro_bnp: 1200, current_regimen: quad } },
            { title: 'Adjunct-Source Vericiguat Offered At NT-proBNP 1700 AFib', patient: { ...hfref, rhythm: 'AFib' as const, nt_pro_bnp: 1700, current_regimen: quad } },
            { title: 'Adjunct-Source Vericiguat Starts At 5 mg', patient: { ...hfref, current_regimen: quad } },
            { title: 'Adjunct-Source Vericiguat Starts At 2.5 mg When SBP Low', patient: { ...hfref, sbp: 104, dbp: 66, current_regimen: quad } },
            { title: 'Adjunct-Source Vericiguat Riociguat Excluded', patient: { ...hfref, external_medications: new Set(['Riociguat']), current_regimen: quad } },
            { title: 'Adjunct-Source Vericiguat PDE5 Inhibitor Warned Not Excluded', patient: { ...hfref, external_medications: new Set(['Sildenafil']),
                current_regimen: [...quad, ...buildCurrentRegimen([{ name: 'Vericiguat', strength: 5, freq: 'qd' }])] } },
            { title: 'Adjunct-Source Vericiguat With H/ISDN Warned', patient: { ...hfref, race: 'Black' as const,
                current_regimen: [...quad, ...buildCurrentRegimen([{ name: 'Vericiguat', strength: 5, freq: 'qd' }, { name: 'Hydralazine/Isosorbide Dinitrate', strength: '37.5/20', freq: 'tid' }])] } },
            { title: 'Adjunct-Source Vericiguat NT-proBNP Above 8000 Advisory', patient: { ...hfref, nt_pro_bnp: 9000,
                current_regimen: [...quad, ...buildCurrentRegimen([{ name: 'Vericiguat', strength: 10, freq: 'qd' }])] } },
            { title: 'Adjunct-Source Vericiguat KCCQ And Side Effects', patient: hfref },
            // H/ISDN
            { title: 'Adjunct-Source A-HeFT Offered On RAAS And Beta-Blocker', patient: { ...hfref, race: 'Black' as const,
                current_regimen: buildCurrentRegimen([{ name: 'Lisinopril', strength: 20, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }]) } },
            { title: 'Adjunct-Source A-HeFT Not Offered Without RAAS And Beta-Blocker', patient: { ...hfref, race: 'Black' as const, current_regimen: sglt } },
            { title: 'Adjunct-Source A-HeFT Bonus Absent Without RAAS And Beta-Blocker', patient: { ...hfref, race: 'Black' as const, max_new_classes_per_visit: 0,
                current_regimen: buildCurrentRegimen([{ name: 'Hydralazine/Isosorbide Dinitrate', strength: '37.5/20', freq: 'tid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Adjunct-Source A-HeFT Bonus Present On RAAS And Beta-Blocker', patient: { ...hfref, race: 'Black' as const, max_new_classes_per_visit: 0,
                current_regimen: [...quad, ...buildCurrentRegimen([{ name: 'Hydralazine/Isosorbide Dinitrate', strength: '37.5/20', freq: 'tid' }])] } },
            { title: 'Adjunct-Source H/ISDN Class 2b When RAAS Cannot Be Taken', patient: { ...hfref, potassium: 5.6, current_regimen: buildCurrentRegimen([{ name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            { title: 'Adjunct-Source H/ISDN Riociguat And Vardenafil Excluded', patient: { ...hfref, external_medications: new Set(['Riociguat', 'Vardenafil']), race: 'Black' as const,
                current_regimen: buildCurrentRegimen([{ name: 'Lisinopril', strength: 20, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }]) } },
            { title: 'Adjunct-Source H/ISDN Side Effects Tachycardia Lupus Warning', patient: { ...hfref, race: 'Black' as const,
                current_regimen: [...quad, ...buildCurrentRegimen([{ name: 'Hydralazine/Isosorbide Dinitrate', strength: '75/40', freq: 'tid' }])] } },
            // IV iron
            { title: 'Adjunct-Source IV Iron Not Added At LVEF 55', patient: { ...hfpef, bmi: 28, nyha_class: 'II' as const, ferritin: 60, tsat: 15, hemoglobin: 12 } },
            { title: 'Adjunct-Source IV Iron Added At LVEF 30 Dose 85 kg Hb 12', patient: { ...iron, hemoglobin: 12, volume_status: { dry_weight_kg: 85, current_weight_kg: 85.5, exam_findings: new Set<string>() } } },
            { title: 'Adjunct-Source IV Iron Dose 65 kg Hb 12', patient: { ...iron, hemoglobin: 12, volume_status: { dry_weight_kg: 65, current_weight_kg: 65.5, exam_findings: new Set<string>() } } },
            { title: 'Adjunct-Source IV Iron Dose 65 kg Hb 9', patient: { ...iron, hemoglobin: 9, volume_status: { dry_weight_kg: 65, current_weight_kg: 65.5, exam_findings: new Set<string>() } } },
            { title: 'Adjunct-Source IV Iron Dose 85 kg Hb 9', patient: { ...iron, hemoglobin: 9, volume_status: { dry_weight_kg: 85, current_weight_kg: 85.5, exam_findings: new Set<string>() } } },
            { title: 'Adjunct-Source IV Iron Dose Hb 14.5 Is 500 mg', patient: { ...iron, hemoglobin: 14.5 } },
            { title: 'Adjunct-Source IV Iron Held At Hb 15.5', patient: { ...iron, hemoglobin: 15.5 } },
            { title: 'Adjunct-Source IV Iron Hemoglobin Not Entered Both Bands', patient: iron },
            { title: 'Adjunct-Source IV Iron Limited Evidence LVEF 45', patient: { ...iron, lvef: 45, ever_lvef_le_40: 'no' as const, comorbidities: new Set(['HFrEF']) } },
            { title: 'Adjunct-Source IV Iron Price Amortized Per Course', patient: iron },
        ];
    })(),

    // ===== Diuretic source-verified corrections (docs/medication-review-2026-11-10/verified-diuretics.md) =====
    // Labels: furosemide, bumetanide, torsemide, metolazone, chlorthalidone, hydrochlorothiazide, Furoscix; TRANSFORM-HF, CLOROTIC.
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 66, sex: 'Male' as const, sbp: 122, dbp: 74, pulse: 76, rhythm: 'Sinus' as const,
            nyha_class: 'III' as const, kccq_score: 50, nt_pro_bnp: 2000, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 84, exam_findings: new Set(['Edema (2+)']) },
            egfr: 50, creatinine: 1.4, bun: 24, potassium: 4.3,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            current_regimen: [] as RegimenMed[],
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        const euvolemic = { dry_weight_kg: 80, current_weight_kg: 80.2, exam_findings: new Set<string>() };
        const gdmt = [
            { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
            { name: 'Carvedilol', strength: 25, freq: 'bid' },
            { name: 'Spironolactone', strength: 25, freq: 'qd' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ];
        return [
            { title: 'Diuretic-Source Bumetanide eGFR 15 Never Above 10 mg Daily', patient: { ...base, egfr: 15, creatinine: 3.8,
                current_regimen: buildCurrentRegimen([{ name: 'Bumetanide', strength: 2, freq: 'bid' }, ...gdmt]) } },
            { title: 'Diuretic-Source Furosemide 80 mg tid High-Dose Alert', patient: { ...base, volume_status: euvolemic,
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'tid' }, ...gdmt]) } },
            { title: 'Diuretic-Source Furosemide 40 mg bid Below High-Dose Alert', patient: { ...base, volume_status: euvolemic,
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 40, freq: 'bid' }, ...gdmt]) } },
            { title: 'Diuretic-Source Daily Dose Credit', patient: { ...base,
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 40, freq: 'qd' }, ...gdmt]) } },
            { title: 'Diuretic-Source Furoscix Short-Course Add-On Not Swap', patient: { ...base, volume_status: { dry_weight_kg: 80, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)', 'JVP Elevated']) },
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 40, freq: 'qd' }, ...gdmt]) } },
            { title: 'Diuretic-Source Furoscix Not Offered Without Oral Loop', patient: { ...base, volume_status: { dry_weight_kg: 80, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)']) },
                current_regimen: buildCurrentRegimen(gdmt) } },
            { title: 'Diuretic-Source Furoscix CKD Allowed Anuria Excluded', patient: { ...base, egfr: 12, creatinine: 5, comorbidities: new Set(['HFrEF', 'Anuria']), volume_status: { dry_weight_kg: 80, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)']) },
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'bid' }, ...gdmt]) } },
            { title: 'Diuretic-Source Furoscix CKD Without Anuria Offered With Caution', patient: { ...base, egfr: 12, creatinine: 5, volume_status: { dry_weight_kg: 80, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)']) },
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'bid' }, ...gdmt]) } },
            { title: 'Diuretic-Source Thiazide Add-On Credit And Gout Caution', patient: { ...base, comorbidities: new Set(['HFrEF', 'Gout']), volume_status: { dry_weight_kg: 80, current_weight_kg: 86, exam_findings: new Set(['Edema (3+)']) },
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'bid' }, ...gdmt]) } },
            { title: 'Diuretic-Source HCTZ eGFR 25 Cautioned Not Excluded', patient: { ...base, egfr: 25, creatinine: 2.6, volume_status: { dry_weight_kg: 80, current_weight_kg: 86, exam_findings: new Set(['Edema (3+)']) },
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'bid' }, ...gdmt]) } },
            { title: 'Diuretic-Source Metolazone Electrolyte Monitoring', patient: { ...base, potassium: 3.4, volume_status: { dry_weight_kg: 80, current_weight_kg: 86, exam_findings: new Set(['Edema (3+)']) },
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'bid' }, { name: 'Metolazone', strength: 5, freq: 'qd' }, ...gdmt]) } },
            { title: 'Diuretic-Source Low eGFR Loop Response Note And Titration', patient: { ...base, egfr: 24, creatinine: 2.7, volume_status: { dry_weight_kg: 80, current_weight_kg: 85, exam_findings: new Set(['Edema (2+)']) },
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 40, freq: 'qd' }, ...gdmt]) } },
            { title: 'Diuretic-Source Formulary Strengths And Badges', patient: { ...base, volume_status: euvolemic, current_regimen: buildCurrentRegimen(gdmt) } },
        ];
    })(),

    // ===== Final engine gaps (docs/medication-review-2026-11-10/README.md): daily target, one-step titration, MRA K+ up-titration gate, equivalent loop swaps =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 62, sex: 'Male' as const, sbp: 126, dbp: 78, pulse: 74, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 62, nt_pro_bnp: 1400, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 70, creatinine: 1.1, bun: 18, potassium: 4.4,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            current_regimen: [] as RegimenMed[],
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        const rest = [
            { name: 'Carvedilol', strength: 25, freq: 'bid' },
            { name: 'Spironolactone', strength: 25, freq: 'qd' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ];
        const loopPatient = { ...base, volume_status: { dry_weight_kg: 80, current_weight_kg: 83, exam_findings: new Set(['Edema (2+)']) } };
        return [
            { title: 'Final-Gaps Ramipril 5 mg bid Counts As Target', patient: { ...base,
                current_regimen: buildCurrentRegimen([{ name: 'Ramipril', strength: 5, freq: 'bid' }, ...rest]) } },
            { title: 'Final-Gaps Ramipril 5 mg bid eGFR 40 Exceeds Renal Cap', patient: { ...base, egfr: 40, creatinine: 1.7,
                current_regimen: buildCurrentRegimen([{ name: 'Ramipril', strength: 5, freq: 'bid' }, ...rest]) } },
            { title: 'Final-Gaps Ramipril 2.5 mg bid eGFR 40 At Renal Cap', patient: { ...base, egfr: 40, creatinine: 1.7,
                current_regimen: buildCurrentRegimen([{ name: 'Ramipril', strength: 2.5, freq: 'bid' }, ...rest]) } },
            { title: 'Final-Gaps Lisinopril 5 mg Offers 10 mg Next', patient: { ...base,
                current_regimen: buildCurrentRegimen([{ name: 'Lisinopril', strength: 5, freq: 'qd' }, ...rest]) } },
            { title: 'Final-Gaps Spironolactone 25 mg Potassium 5.2 Not Increased', patient: { ...base, potassium: 5.2,
                current_regimen: buildCurrentRegimen([{ name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }]) } },
            { title: 'Final-Gaps Finerenone 20 mg Potassium 5.1 Not Increased', patient: { ...base, lvef: 55, ever_lvef_le_40: 'no' as const, comorbidities: new Set(['HFpEF']), potassium: 5.1,
                current_regimen: buildCurrentRegimen([{ name: 'Finerenone (Kerendia)', strength: 20, freq: 'qd' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]) } },
            // Loop-to-loop swaps are offered only when the current loop must go (2026-11-11: TRANSFORM-HF, no outcome difference). The three equivalent-dose scenarios
            // below therefore declare an allergy to the current loop (a forced swap); the two "Not Swapped" scenarios are the same patients without a reason.
            { title: 'Final-Gaps Furosemide 80 mg bid To Bumetanide Equivalent Daily Dose', patient: { ...loopPatient, allergies: new Set(['Furosemide']),
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'bid' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, ...rest]) } },
            { title: 'Final-Gaps Furosemide 80 mg bid To Torsemide Equivalent Daily Dose', patient: { ...loopPatient, allergies: new Set(['Furosemide']),
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'bid' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, ...rest]) } },
            { title: 'Final-Gaps Torsemide 20 mg qd To Furosemide Equivalent Daily Dose', patient: { ...loopPatient, allergies: new Set(['Torsemide']),
                current_regimen: buildCurrentRegimen([{ name: 'Torsemide', strength: 20, freq: 'qd' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, ...rest]) } },
            // Diuretic resistance (ESC S7): congested on a HIGH dose (furosemide 160 mg/day is above the 120 mg/day alert level) the loop may be swapped; at 80 mg/day it is titrated, not swapped.
            { title: 'Final-Gaps Furosemide 80 mg bid Congested On High Dose Swap Allowed', patient: { ...loopPatient,
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'bid' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, ...rest]) } },
            { title: 'Final-Gaps Furosemide 40 mg bid Is Not Swapped Without A Reason', patient: { ...loopPatient,
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 40, freq: 'bid' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, ...rest]) } },
            { title: 'Final-Gaps Torsemide 20 mg qd Is Not Swapped Without A Reason', patient: { ...loopPatient,
                current_regimen: buildCurrentRegimen([{ name: 'Torsemide', strength: 20, freq: 'qd' }, { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' }, ...rest]) } },
        ];
    })(),

    // ===== Pregnancy: beta-blockers limited to beta-1-selective agents (2026 ESC heart failure guideline, Recommendation Table 27, Class I C) =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 31, sex: 'Female' as const, is_pregnant: true, sbp: 118, dbp: 72, pulse: 80, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 60, nt_pro_bnp: 1100, lvef: 32,
            volume_status: { dry_weight_kg: 68, current_weight_kg: 69, exam_findings: new Set<string>() },
            egfr: 95, creatinine: 0.8, bun: 12, potassium: 4.2,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            current_regimen: [] as RegimenMed[],
            max_affordable_cost: 400, cost_sensitivity: 3, insurance_tier: 'commercial' as const,
            complexity_tolerance: 8, max_new_classes_per_visit: 2,
        };
        return [
            { title: 'Pregnancy-Source New Beta-Blocker Start Beta-1-Selective Only', patient: { ...base } },
            { title: 'Pregnancy-Source Carvedilol Switched To Beta-1-Selective', patient: { ...base,
                current_regimen: buildCurrentRegimen([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            { title: 'Pregnancy-Source Carvedilol 25 mg bid Switch Lands At Target Fraction', patient: { ...base,
                current_regimen: buildCurrentRegimen([{ name: 'Carvedilol', strength: 25, freq: 'bid' }]) } },
            { title: 'Pregnancy-Source Carvedilol 3.125 mg bid Switch Lands At Start Tier', patient: { ...base,
                current_regimen: buildCurrentRegimen([{ name: 'Carvedilol', strength: 3.125, freq: 'bid' }]) } },
            { title: 'Pregnancy-Source Metoprolol Continued', patient: { ...base,
                current_regimen: buildCurrentRegimen([{ name: 'Metoprolol Succinate', strength: 25, freq: 'qd' }]) } },
        ];
    })(),

    // ===== 2026 ESC phenotype (HFmrEF removed): LVEF below 50 is HFrEF; HFpEF is LVEF 50 or higher and never below 50 =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 66, sex: 'Male' as const, sbp: 128, dbp: 78, pulse: 72, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 62, nt_pro_bnp: 900, lvef: 45,
            volume_status: { dry_weight_kg: 82, current_weight_kg: 82.5, exam_findings: new Set<string>() },
            egfr: 70, creatinine: 1.1, bun: 18, potassium: 4.4,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            current_regimen: [] as RegimenMed[], ever_lvef_le_40: 'no' as const,
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 4,
        };
        return [
            { title: 'ESC26-Phenotype LVEF 41 Is HFrEF', patient: { ...base, lvef: 41 } },
            { title: 'ESC26-Phenotype LVEF 45 Is HFrEF', patient: { ...base, lvef: 45 } },
            { title: 'ESC26-Phenotype LVEF 49 Is HFrEF', patient: { ...base, lvef: 49 } },
            { title: 'ESC26-Phenotype LVEF 50 Is HFpEF', patient: { ...base, lvef: 50 } },
            { title: 'ESC26-Phenotype Prior LVEF 45 Now 55 Is HFrEF', patient: { ...base, lvef: 55, previous_lvef: 45 } },
            { title: 'ESC26-Phenotype Prior LVEF 49 Now 50 Is HFrEF', patient: { ...base, lvef: 50, previous_lvef: 49 } },
            { title: 'ESC26-Phenotype Prior LVEF 50 Now 58 Stays HFpEF', patient: { ...base, lvef: 58, previous_lvef: 50 } },
            { title: 'ESC26-Phenotype HFpEF On Lisinopril RAAS Not A Slot', patient: { ...base, lvef: 58,
                current_regimen: buildCurrentRegimen([{ name: 'Lisinopril', strength: 10, freq: 'qd' }]) } },
            { title: 'ESC26-Phenotype Improved EF Prior 35 Now 46 Excludes Finerenone', patient: { ...base, lvef: 46, previous_lvef: 35, ever_lvef_le_40: 'yes' as const } },
        ];
    })(),

    // ===== 2026 ESC digoxin (Table 5, Class IIa B1): symptomatic (NYHA II-IV) HFrEF with LVEF 40 or below despite optimal foundational therapy =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 64, sex: 'Male' as const, sbp: 122, dbp: 74, pulse: 66, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 60, nt_pro_bnp: 1100, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 70, creatinine: 1.1, bun: 18, potassium: 4.4,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            ever_lvef_le_40: 'yes' as const,
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        const optimized = buildCurrentRegimen([
            { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
            { name: 'Carvedilol', strength: 25, freq: 'bid' },
            { name: 'Spironolactone', strength: 50, freq: 'qd' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ]);
        const open = buildCurrentRegimen([
            { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
            { name: 'Carvedilol', strength: 6.25, freq: 'bid' },
            { name: 'Spironolactone', strength: 50, freq: 'qd' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ]);
        return [
            { title: 'ESC26-Digoxin NYHA II On Optimized Quad Is Offered', patient: { ...base, current_regimen: optimized } },
            { title: 'ESC26-Digoxin NYHA I Is Not Offered', patient: { ...base, nyha_class: 'I' as const, current_regimen: optimized } },
            { title: 'ESC26-Digoxin LVEF 45 Is Not Offered', patient: { ...base, lvef: 45, ever_lvef_le_40: 'no' as const, current_regimen: optimized } },
            { title: 'ESC26-Digoxin Beta-Blocker Still Titratable Is Not Offered', patient: { ...base, current_regimen: open } },
        ];
    })(),

    // ===== 2026 ESC potassium and creatinine rules for a RAAS inhibitor already in use (section 6.1) =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 64, sex: 'Male' as const, sbp: 128, dbp: 78, pulse: 72, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 60, nt_pro_bnp: 1100, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 60, creatinine: 1.2, bun: 20, potassium: 5.6,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            ever_lvef_le_40: 'yes' as const,
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        const lis = (strength: number) => buildCurrentRegimen([{ name: 'Lisinopril', strength, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]);
        return [
            { title: 'ESC26-RAAS-K K+ 5.6 Lisinopril 10 Reduced One Step', patient: { ...base, current_regimen: lis(10) } },
            { title: 'ESC26-RAAS-K K+ 5.6 Lisinopril 2.5 Lowest Tier Withheld', patient: { ...base, current_regimen: lis(2.5) } },
            { title: 'ESC26-RAAS-K K+ 5.6 With MRA Reduces The MRA First', patient: { ...base,
                current_regimen: buildCurrentRegimen([{ name: 'Lisinopril', strength: 10, freq: 'qd' }, { name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            { title: 'ESC26-RAAS-K K+ 6.1 Lisinopril And MRA Stopped', patient: { ...base, potassium: 6.1,
                current_regimen: buildCurrentRegimen([{ name: 'Lisinopril', strength: 10, freq: 'qd' }, { name: 'Spironolactone', strength: 25, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            { title: 'ESC26-RAAS-K K+ 5.5 New RAAS Start Blocked', patient: { ...base, current_regimen: buildCurrentRegimen([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            { title: 'ESC26-RAAS-K K+ 5.1 New RAAS Start Allowed Creatinine Text', patient: { ...base, potassium: 5.1, current_regimen: buildCurrentRegimen([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
        ];
    })(),

    // ===== New RAAS inhibitor start above potassium 5.2 is staged (rule E18) and a potassium binder never enables a NEW potassium-raising class (2026 ESC S4/S5; 2022 US binder Class 2b is for hyperkalaemia on existing therapy) =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 64, sex: 'Male' as const, sbp: 128, dbp: 78, pulse: 72, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 60, nt_pro_bnp: 1100, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 60, creatinine: 1.2, bun: 20, potassium: 5.3,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            ever_lvef_le_40: 'yes' as const,
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        const onLis = buildCurrentRegimen([{ name: 'Lisinopril', strength: 10, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]);
        return [
            { title: 'ESC26-RAAS-Start K+ 5.3 Naive RAAS Start Staged, No Binder', patient: { ...base, current_regimen: [] } },
            { title: 'ESC26-RAAS-Start K+ 5.1 Naive RAAS Start Offered', patient: { ...base, potassium: 5.1, current_regimen: [] } },
            { title: 'ESC26-RAAS-Start K+ 5.2 Naive Not Staged By E18', patient: { ...base, potassium: 5.2, current_regimen: [] } },
            { title: 'ESC26-RAAS-Start K+ 5.0 Naive No MRA Binder Co-Start', patient: { ...base, potassium: 5.0, current_regimen: [] } },
            { title: 'ESC26-RAAS-Start K+ 5.3 On Lisinopril Kept, Not Staged', patient: { ...base, current_regimen: onLis } },
            { title: 'ESC26-RAAS-Start K+ 5.4 On Lisinopril Binder Rescue Of Existing Therapy Kept', patient: { ...base, potassium: 5.4, current_regimen: onLis } },
        ];
    })(),

    // ===== 2026 ESC Table 11 doses: spironolactone target 50 mg (25 mg at the engine's eGFR 45 or below renal cap); sacubitril/valsartan start 24/26 below eGFR 60 or with chronic hypotension =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 64, sex: 'Male' as const, sbp: 130, dbp: 78, pulse: 66, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 60, nt_pro_bnp: 1100, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 70, creatinine: 1.1, bun: 18, potassium: 4.4,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            ever_lvef_le_40: 'yes' as const,
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        const quad25 = buildCurrentRegimen([
            { name: 'Sacubitril/Valsartan (Entresto)', strength: '97/103', freq: 'bid' },
            { name: 'Carvedilol', strength: 25, freq: 'bid' },
            { name: 'Spironolactone', strength: 25, freq: 'qd' },
            { name: 'Dapagliflozin', strength: 10, freq: 'qd' },
        ]);
        const highLisinopril = buildCurrentRegimen([{ name: 'Lisinopril', strength: 20, freq: 'qd' }, { name: 'Carvedilol', strength: 25, freq: 'bid' }, { name: 'Dapagliflozin', strength: 10, freq: 'qd' }]);
        return [
            { title: 'ESC26-Table11 Spironolactone 25 mg eGFR 70 Titrates To 50', patient: { ...base, current_regimen: quad25 } },
            { title: 'ESC26-Table11 Spironolactone 25 mg eGFR 40 Is At Its Renal Cap', patient: { ...base, egfr: 40, creatinine: 1.9, current_regimen: quad25 } },
            { title: 'ESC26-Table11 ARNI Start 49/51 After High-Dose ACEi eGFR 70', patient: { ...base, current_regimen: highLisinopril } },
            { title: 'ESC26-Table11 ARNI Start 24/26 At eGFR 45', patient: { ...base, egfr: 45, creatinine: 1.7, current_regimen: highLisinopril } },
            { title: 'ESC26-Table11 ARNI Start 24/26 With Chronic Hypotension', patient: { ...base, sbp: 104, dbp: 64, comorbidities: new Set(['HFrEF', 'Hypotension (Chronic)']), current_regimen: highLisinopril } },
        ];
    })(),

    // ===== 2026 ESC thiazide-type diuretics (section 6.1 / 7.5.4): short-term add-on for persistent congestion on a loop; chronic use in a stable patient is reviewed, not forced off =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 70, sex: 'Female' as const, sbp: 126, dbp: 74, pulse: 70, rhythm: 'Sinus' as const,
            nyha_class: 'III' as const, kccq_score: 50, nt_pro_bnp: 1800, lvef: 30,
            egfr: 55, creatinine: 1.2, bun: 22, potassium: 4.3,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            ever_lvef_le_40: 'yes' as const,
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        const onLoop = buildCurrentRegimen([{ name: 'Furosemide', strength: 80, freq: 'bid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]);
        return [
            { title: 'ESC26-Diuretic Congested 5 kg On Loop Thiazide Is Short-Term', patient: { ...base, volume_status: { dry_weight_kg: 70, current_weight_kg: 75, exam_findings: new Set(['Edema (2+)']) }, current_regimen: onLoop } },
            { title: 'ESC26-Diuretic Stable Euvolemic On Metolazone Gets Review', patient: { ...base, nyha_class: 'II' as const, volume_status: { dry_weight_kg: 70, current_weight_kg: 70.2, exam_findings: new Set<string>() },
                current_regimen: buildCurrentRegimen([{ name: 'Furosemide', strength: 40, freq: 'qd' }, { name: 'Metolazone', strength: 2.5, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            { title: 'ESC26-Diuretic Congested Not On Loop No Thiazide', patient: { ...base, volume_status: { dry_weight_kg: 70, current_weight_kg: 75, exam_findings: new Set(['Edema (2+)']) }, current_regimen: buildCurrentRegimen([{ name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
        ];
    })(),

    // ===== 2026 ESC Supplementary Table S4 kidney rule: eGFR below 20 on a RAAS inhibitor is an ALERT (the table describes a FALL from baseline; the tool has no baseline, so it never stops the drug on the current value) =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 66, sex: 'Male' as const, sbp: 128, dbp: 78, pulse: 72, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 60, nt_pro_bnp: 1100, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 18, creatinine: 3.4, bun: 40, potassium: 4.6,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            ever_lvef_le_40: 'yes' as const,
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        const onLis = buildCurrentRegimen([{ name: 'Lisinopril', strength: 5, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]);
        return [
            { title: 'ESC26-Renal eGFR 18 Lisinopril Kept With Alert', patient: { ...base, current_regimen: onLis } },
            { title: 'ESC26-Renal eGFR 18 Stable Sacubitril/Valsartan Kept With Alert', patient: { ...base, current_regimen: buildCurrentRegimen([{ name: 'Sacubitril/Valsartan (Entresto)', strength: '24/26', freq: 'bid' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]) } },
            { title: 'ESC26-Renal eGFR 22 Lisinopril Kept No Alert', patient: { ...base, egfr: 22, creatinine: 2.9, current_regimen: onLis } },
            { title: 'ESC26-Renal eGFR Blank Lisinopril Kept No Alert', patient: { ...base, egfr: 0, creatinine: 0, current_regimen: onLis } },
        ];
    })(),

    // ===== 2026 ESC alerts and notes (no ranking effect): NT-proBNP above 5000, harmful external medications =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 66, sex: 'Male' as const, sbp: 128, dbp: 78, pulse: 72, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 60, nt_pro_bnp: 1100, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 70, creatinine: 1.1, bun: 18, potassium: 4.4,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            current_regimen: [] as RegimenMed[], ever_lvef_le_40: 'yes' as const,
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        return [
            { title: 'ESC26-Alerts NT-proBNP 6000 With Congestion Advises Admission', patient: { ...base, nt_pro_bnp: 6000, nyha_class: 'III' as const, volume_status: { dry_weight_kg: 80, current_weight_kg: 83, exam_findings: new Set(['Edema (2+)']) } } },
            { title: 'ESC26-Alerts NT-proBNP 4000 No Admission Alert', patient: { ...base, nt_pro_bnp: 4000, nyha_class: 'III' as const, volume_status: { dry_weight_kg: 80, current_weight_kg: 83, exam_findings: new Set(['Edema (2+)']) } } },
            { title: 'ESC26-Alerts Ibuprofen And Pioglitazone Warned', patient: { ...base, external_medications: new Set(['Ibuprofen', 'Pioglitazone', 'Saxagliptin']) } },
        ];
    })(),

    // ===== Laboratory prerequisite (rule E16, 2026-11-11 physician-owner decision): potassium and renal function required before RAAS/MRA new starts and dose increases =====
    ...((): TestScenario[] => {
        const base = {
            ...INITIAL_PATIENT,
            age: 62, sex: 'Male' as const, sbp: 126, dbp: 78, pulse: 74, rhythm: 'Sinus' as const,
            nyha_class: 'II' as const, kccq_score: 62, nt_pro_bnp: 1400, lvef: 30,
            volume_status: { dry_weight_kg: 80, current_weight_kg: 80.5, exam_findings: new Set<string>() },
            egfr: 70, creatinine: 1.1, bun: 18, potassium: 4.4,
            comorbidities: new Set(['HFrEF']),
            external_medications: new Set<string>(),
            allergies: new Set<string>(), discontinued_meds: [],
            current_regimen: [] as RegimenMed[],
            max_affordable_cost: 20000, cost_sensitivity: 1, insurance_tier: 'cash' as const,
            complexity_tolerance: 10, max_new_classes_per_visit: 2,
        };
        const onLisinopril = buildCurrentRegimen([{ name: 'Lisinopril', strength: 10, freq: 'qd' }, { name: 'Carvedilol', strength: 12.5, freq: 'bid' }]);
        return [
            { title: 'Lab-Prereq Naive HFrEF Blank Potassium', patient: { ...base, potassium: 0 } },
            { title: 'Lab-Prereq Lisinopril 10 mg Blank Potassium', patient: { ...base, potassium: 0, current_regimen: onLisinopril } },
            { title: 'Lab-Prereq Naive HFrEF Blank Renal', patient: { ...base, egfr: 0, creatinine: 0 } },
            { title: 'Lab-Prereq Lisinopril 10 mg Blank Renal', patient: { ...base, egfr: 0, creatinine: 0, current_regimen: onLisinopril } },
            { title: 'Lab-Prereq Both Labs Present Unchanged', patient: { ...base, current_regimen: onLisinopril } },
        ];
    })(),
];

// The single clonePatient implementation lives in the engine (services/simulationService.ts)
// and is re-exported here for existing import sites. The two previous copies had already
// drifted (this one deep-copied dose objects; the engine's tolerated a missing
// current_regimen) — a Patient-shape change applied to only one would silently corrupt the
// other side. The unified engine version is a superset of both behaviors.
export { clonePatient } from '../services/simulationService';
