import { Patient, TestScenario, RegimenMed } from '../types';
import { MEDICATION_FORMULARY } from '../constants';

interface ScenarioMedSeed {
    name: string;
    strength: number | string;
    freq: string;
}

const NON_FORMULARY_DATA_ALIASES: Record<string, string> = {
    Enalapril: 'Lisinopril'
};

// Helper to build a current regimen from a list of med seeds
const buildCurrentRegimen = (seeds: ScenarioMedSeed[]): RegimenMed[] => {
    return seeds.map((m): RegimenMed => {
        const dataName = NON_FORMULARY_DATA_ALIASES[m.name] ?? m.name;
        const foundMed = MEDICATION_FORMULARY.find(f => f.name === dataName);
        if (!foundMed) {
            throw new Error(`[scenarios] Missing medication data for "${m.name}" (resolved as "${dataName}").`);
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
    const meds: ScenarioMedSeed[] = [
        // Non-formulary medication resolved to equivalent med with known clinical data.
        { name: 'Enalapril', strength: 20, freq: 'qd' },
        { name: 'Carvedilol', strength: 25, freq: 'bid' },
        { name: 'Furosemide', strength: 40, freq: 'qd' }
    ];

    return meds.map((m): RegimenMed => {
        const dataName = NON_FORMULARY_DATA_ALIASES[m.name] ?? m.name;
        const foundMed = MEDICATION_FORMULARY.find(f => f.name === dataName);
        if (!foundMed) {
            throw new Error(`[scenarios] Missing medication data for "${m.name}" (resolved as "${dataName}").`);
        }

        const foundDose = foundMed.available_doses.find(d => d.strength === m.strength);
        if (!foundDose) {
            throw new Error(`[scenarios] Missing dose data for "${m.name}" at "${m.strength}".`);
        }

        const selectedFrequency = foundDose.frequency_options.includes(m.freq)
            ? m.freq
            : foundDose.frequency_options[0];

        return { med: foundMed, dose: foundDose, selected_frequency: selectedFrequency };
    });
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
    max_new_classes_per_visit: 2
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
            current_regimen: []
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
        title: 'SBP 90 Borderline (Should Block Recs)',
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
            comorbidities: new Set(['HFmrEF']),
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
    // --- HFmrEF standalone (LVEF 45) — validates HFmrEF-specific guideline scoring ---
    {
        title: 'HFmrEF Standalone (LVEF 45, NYHA II)',
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
    // --- HFmrEF + Obese (GLP-1 eligible) — BMI ≥ 30 + LVEF 42 ---
    {
        title: 'HFmrEF Obese (BMI 33, LVEF 42, GLP-1 Eligible)',
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
    // ===== Issue 1: MRA + DIAMOND Binder =====
    {
        title: 'MRA + DIAMOND Binder (K+ 5.1)',
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
        // HFmrEF patient arrives on dual MRA (steroidal + finerenone) — keep steroidal, deprescribe nsMRA.
        title: 'Inappropriate Dual MRA on Arrival (Steroidal + nsMRA)',
        patient: {
            ...INITIAL_PATIENT,
            lvef: 45, // HFmrEF — both MRA types are otherwise permissible, so this is true redundancy
            nyha_class: 'II' as const,
            nt_pro_bnp: 1200,
            potassium: 4.6,
            egfr: 55,
            comorbidities: new Set(['HFmrEF']),
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
            lvef: 45, // HFmrEF — both MRA types otherwise permissible
            nyha_class: 'II' as const,
            nt_pro_bnp: 1200,
            potassium: 4.6,
            egfr: 55,
            comorbidities: new Set(['HFmrEF']),
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
        // the patient arrives on spironolactone (HFmrEF, so finerenone is viable). Spironolactone
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
            comorbidities: new Set(['HFmrEF']),
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
];

// Helper to deep clone patient (useful for resetting state in tests/app)
export const clonePatient = (p: Patient): Patient => {
    return {
        ...p,
        volume_status: {
            ...p.volume_status, // Shallow copy, but nested Set needs helper if mutated deeply, here just replacing reference is enough if Set is new
            exam_findings: new Set(p.volume_status.exam_findings)
        },
        comorbidities: new Set(p.comorbidities),
        external_medications: new Set(p.external_medications || []),
        allergies: new Set(p.allergies),
        discontinued_meds: p.discontinued_meds.map(m => ({ ...m })),
        current_regimen: p.current_regimen.map(r => ({
            ...r,
            dose: { ...r.dose }
        }))
    };
};
