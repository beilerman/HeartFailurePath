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
    allergies: new Set(),
    discontinued_meds: [],
    current_regimen: getInitialRegimen(),
    max_affordable_cost: 100,
    cost_sensitivity: 5, // Default medium sensitivity
    complexity_tolerance: 5,
    max_new_classes_per_visit: 2
};

export const SCENARIOS: TestScenario[] = [
    { title: 'John Doe (Wet & Warm)', patient: INITIAL_PATIENT },
    {
        title: 'Jane Smith (Dry & Cold)',
        patient: { ...INITIAL_PATIENT, sex: 'Female', height_cm: 162, bmi: 22.8, sbp: 85, volume_status: { dry_weight_kg: 60, current_weight_kg: 60, exam_findings: new Set() }, nt_pro_bnp: 4500, lvef: 15, current_regimen: [] }
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
        title: 'Severe Hypotension (BP 85/55)',
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
            complexity_tolerance: 6,
            max_new_classes_per_visit: 3
        }
    }
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
        allergies: new Set(p.allergies),
        discontinued_meds: p.discontinued_meds.map(m => ({ ...m })),
        current_regimen: p.current_regimen.map(r => ({
            ...r,
            dose: { ...r.dose }
        }))
    };
};
