
import { Medication } from './types';

// Helper for logarithmic calculations (dose-response curves)
const logBase = (base: number, x: number) => Math.log(x) / Math.log(base);

export const COMMON_SIDE_EFFECTS = [
    "Angioedema",
    "Cough",
    "Hyperkalemia",
    "Hypotension",
    "Bradycardia",
    "Renal Impairment / AKI",
    "Gout / Hyperuricemia",
    "Gynecomastia",
    "Severe Fatigue",
    "Bronchospasm / Asthma Exacerbation",
    "Rash / Hypersensitivity",
    "Liver Toxicity",
    "Nausea / Vomiting",
    "Diarrhea"
];

export const RELEVANT_COMORBIDITIES = [
    "Atrial Fibrillation",
    "Coronary Artery Disease",
    "Diabetes Mellitus Type 2",
    "Chronic Kidney Disease",
    "Severe Asthma / Bronchospasm",
    "Gout",
    "History of Angioedema",
    "Hypotension (Chronic)",
    "Liver Disease (Child-Pugh B/C)",
    "Obesity (BMI > 30)"
];

export const MEDICATION_FORMULARY: Medication[] = [
    // ========================================
    // PILLAR 1: ARNI / ACEi / ARB
    // Evidence: PARADIGM-HF, PROVE-HF, SOLVD
    // Impact: High Structure (Reverse Remodeling), High Neurohormonal, Mild Volume.
    // ========================================
    {
        name: 'Sacubitril/Valsartan (Entresto)',
        drug_class: 'ARNI',
        is_best_in_class: true,
        available_doses: [
            { strength: '24/26', unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: false },
            { strength: '49/51', unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: false },
            { strength: '97/103', unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: false, is_target_dose: true },
        ],
        chf_effects: (dose) => {
            // PROVE-HF: Average LVEF increase ~9.4% over 12 months
            const level = dose === '97/103' ? 3 : dose === '49/51' ? 2 : 1;
            return {
                lvef_improvement_absolute: 3.0 + (level * 2.0), // 5% to 9%
                bnp_reduction_percent: 0.20 + (level * 0.10), // 30-50% reduction
                weight_reduction_kg: 0.5, // Mild natriuresis
                kccq_improvement: 5 + (level * 2),
                structure_benefit_points: 30, // Significant reverse remodeling
                lavi_reduction_percent: 0.12, // PROVE-HF
                lvedd_reduction_percent: 0.04 + (level * 0.02) // 6-10% (PROVE-HF)
            };
        },
        hemodynamic_effects: (dose) => {
            const level = dose === '97/103' ? 3 : dose === '49/51' ? 2 : 1;
            return { sbp_drop: 6 + (level * 2), hr_drop: 0, potassium_change: 0.15 };
        },
        side_effects: () => ({ hypotension: 0.15, angioedema: 0.005, hyperkalemia: 0.05 }),
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || (p.potassium > 5.4) || (p.is_pregnant === true), // Higher cutoff due to binder logic; Category X in pregnancy
        renal_adjustment: (egfr) => egfr < 30 ? { start_dose_modifier: 0.5, caution: true } : {},
    },
    {
        name: 'Lisinopril',
        drug_class: 'ACEi',
        available_doses: [
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true, is_target_dose: true },
            { strength: 40, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true, is_target_dose: true },
        ],
        chf_effects: (dose) => {
            // SOLVD: Mortality benefit, modest LVEF improvement compared to ARNI
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 2 + (logBase(2, d/2.5) * 0.5), // Max ~4-5%
                bnp_reduction_percent: 0.15 + (logBase(2, d/2.5) * 0.02),
                weight_reduction_kg: 0, // No direct diuretic effect
                kccq_improvement: 3 + (d/40 * 2),
                structure_benefit_points: 15,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.03 + (d / 40 * 0.02) // 3-5% (SOLVD)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 5 + Number(dose)/5, hr_drop: 0, potassium_change: 0.20 }),
        side_effects: () => ({ cough: 0.10, hypotension: 0.08, hyperkalemia: 0.06, angioedema: 0.01 }),
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || p.potassium > 5.4 || (p.is_pregnant === true),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 10, caution: true };
            if (egfr < 45) return { max_dose: 20, caution: true };
            return {};
        },
    },
    {
        name: 'Losartan',
        drug_class: 'ARB',
        available_doses: [
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 100, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 150, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false, is_target_dose: true }, // HEAAL Trial dose
        ],
        chf_effects: (dose) => {
             // ELITE II / HEAAL: Comparable to ACEi at high doses
             const d = Number(dose);
             const isHighDose = d >= 100;
             return {
                lvef_improvement_absolute: isHighDose ? 4 : 2,
                bnp_reduction_percent: isHighDose ? 0.20 : 0.10,
                weight_reduction_kg: 0,
                kccq_improvement: 3 + (d/150 * 2),
                structure_benefit_points: 10,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: isHighDose ? 0.05 : 0.03 // 3-5% (HEAAL)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 4 + Number(dose)/25, hr_drop: 0, potassium_change: 0.15 }),
        side_effects: () => ({ hypotension: 0.05, hyperkalemia: 0.04 }),
        contraindications: (p) => p.potassium > 5.4 || (p.is_pregnant === true),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 50, caution: true };
            return {};
        },
    },

    // ========================================
    // PILLAR 2: BETA BLOCKERS
    // Evidence: MERIT-HF, COPERNICUS, CIBIS-II
    // Impact: Maximum Structure (LVEF), No Volume effect.
    // ========================================
    {
        name: 'Carvedilol',
        drug_class: 'Beta Blocker',
        is_best_in_class: true,
        available_doses: [
            { strength: 3.125, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: false },
            { strength: 6.25, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: true },
            { strength: 12.5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: true },
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: true, is_target_dose: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: true, is_target_dose: true },
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            const ratio = d / 25;
            return {
                lvef_improvement_absolute: 5 + (ratio * 5), // 5% to 10% (Highest structural impact)
                bnp_reduction_percent: 0.10 + (ratio * 0.15),
                weight_reduction_kg: 0, // Neutral volume effect
                kccq_improvement: 2 + (ratio * 4),
                structure_benefit_points: 40, // Major anti-remodeling/anti-arrhythmic
                lavi_reduction_percent: 0.02,
                lvedd_reduction_percent: 0.08 + (ratio * 0.04) // 8-12% (COPERNICUS)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 5 + Number(dose)/5, hr_drop: 8 + Number(dose)/3, potassium_change: 0.05 }),
        side_effects: () => ({ bradycardia: 0.10, fatigue: 0.15, hypotension: 0.10, fluid_retention_transient: 0.05 }),
        contraindications: (p) => p.pulse < 55 || p.comorbidities.has("Severe Asthma / Bronchospasm") || p.comorbidities.has("COPD") || p.comorbidities.has("Liver Disease (Child-Pugh B/C)"),
        // COPERNICUS: 50mg BID target only for patients > 85kg; standard target is 25mg BID
        renal_adjustment: (_egfr, patient) => {
            const dryWeight = patient?.volume_status?.dry_weight_kg ?? 85;
            if (dryWeight <= 85) return { max_dose: 25 };
            return {};
        },
    },
    {
        name: 'Metoprolol Succinate',
        drug_class: 'Beta Blocker',
        is_best_in_class: true,
        available_doses: [
            { strength: 25, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'], scored: true },
            { strength: 50, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'], scored: true },
            { strength: 100, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'], scored: true },
            { strength: 200, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'], scored: true, is_target_dose: true },
        ],
        chf_effects: (dose) => {
            // MERIT-HF
            const d = Number(dose);
            const ratio = d / 200;
            return {
                lvef_improvement_absolute: 5 + (ratio * 4), // ~9% at top dose
                bnp_reduction_percent: 0.10 + (ratio * 0.10),
                weight_reduction_kg: 0,
                kccq_improvement: 3 + (ratio * 3),
                structure_benefit_points: 35,
                lavi_reduction_percent: 0.02,
                lvedd_reduction_percent: 0.07 + (ratio * 0.03) // 7-10% (MERIT-HF)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 3 + Number(dose)/50, hr_drop: 8 + Number(dose)/20, potassium_change: 0 }),
        side_effects: () => ({ bradycardia: 0.10, fatigue: 0.10 }),
        contraindications: (p) => p.pulse < 55,
    },

    {
        name: 'Bisoprolol',
        drug_class: 'Beta Blocker',
        available_doses: [
            { strength: 1.25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true, is_target_dose: true },
        ],
        chf_effects: (dose) => {
            // CIBIS-II: 34% mortality reduction at 10mg
            const d = Number(dose);
            const ratio = d / 10;
            return {
                lvef_improvement_absolute: 5 + (ratio * 4), // ~9% at target
                bnp_reduction_percent: 0.10 + (ratio * 0.12),
                weight_reduction_kg: 0,
                kccq_improvement: 3 + (ratio * 3),
                structure_benefit_points: 35,
                lavi_reduction_percent: 0.02,
                lvedd_reduction_percent: 0.07 + (ratio * 0.03) // 7-10% (CIBIS-II)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 3 + Number(dose)/5, hr_drop: 8 + Number(dose)/1.5, potassium_change: 0 }),
        side_effects: () => ({ bradycardia: 0.10, fatigue: 0.08 }),
        contraindications: (p) => p.pulse < 55,
        // Most beta-1 selective — safest BB option in reactive airway disease
        special_features: [
            { feature: 'Preferred in Reactive Airway Disease (most beta-1 selective)', points: 10, criteria: (p) => p.comorbidities.has("COPD") || p.comorbidities.has("Severe Asthma / Bronchospasm") }
        ],
    },

    // ========================================
    // PILLAR 3: MRAs
    // Evidence: RALES, EPHESUS
    // Impact: Moderate Structure (Anti-fibrotic), Mild Volume.
    // ========================================
    {
        name: 'Spironolactone',
        drug_class: 'MRA',
        is_best_in_class: true,
        available_doses: [
            { strength: 12.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true, is_target_dose: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true, is_target_dose: true },
        ],
        chf_effects: (dose) => {
             const d = Number(dose);
             return {
                lvef_improvement_absolute: 2 + (d/50 * 2), // ~2-4%
                bnp_reduction_percent: 0.10,
                weight_reduction_kg: 0.3 * (d/25), // Mild diuretic
                kccq_improvement: 2,
                structure_benefit_points: 30, // Strong anti-fibrotic
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.04 + (d / 50 * 0.02) // 4-6% (RALES)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 3 + Number(dose)/10, hr_drop: 0, potassium_change: 0.4 + (Number(dose)/50 * 0.4) }),
        side_effects: () => ({ hyperkalemia: 0.15, gynecomastia: 0.10, renal_worsening: 0.05 }),
        contraindications: (p) => p.potassium > 5.5 || p.egfr < 30 || (p.is_pregnant === true), // Relaxed from 5.2 → 5.5 to allow Patiromer rescue (DIAMOND); pregnancy Category X
    },
    {
        name: 'Eplerenone',
        drug_class: 'MRA',
        available_doses: [
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true, is_target_dose: true },
        ],
        chf_effects: (dose) => {
             // EMPHASIS-HF
             return {
                lvef_improvement_absolute: 2.5,
                bnp_reduction_percent: 0.10,
                weight_reduction_kg: 0.2,
                kccq_improvement: 2,
                structure_benefit_points: 30,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.04 // 4% (EMPHASIS-HF)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 3, hr_drop: 0, potassium_change: 0.4 }),
        side_effects: () => ({ hyperkalemia: 0.15 }),
        special_features: [
            { feature: 'Fewer endocrine side effects (Gynecomastia)', points: 10, criteria: (p) => true }
        ],
        contraindications: (p) => p.potassium > 5.5 || p.egfr < 30 || (p.is_pregnant === true), // Relaxed from 5.2 → 5.5; pregnancy Category X
    },

    // ========================================
    // PILLAR 4: SGLT2 Inhibitors
    // Evidence: DAPA-HF, EMPEROR-Reduced
    // Impact: High Functional (KCCQ), Moderate Volume (Osmotic), Low Structure (Direct).
    // ========================================
    {
        name: 'Dapagliflozin',
        drug_class: 'SGLT2i',
        is_best_in_class: true,
        available_doses: [
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false, is_target_dose: true },
        ],
        chf_effects: () => ({
            lvef_improvement_absolute: 2.0, // Modest direct effect
            bnp_reduction_percent: 0.13,
            weight_reduction_kg: 1.5, // Osmotic diuresis ~1-2kg
            kccq_improvement: 6, // High symptom relief
            structure_benefit_points: 15,
            lavi_reduction_percent: 0.15, // Significant volume unloading of LA
            lvedd_reduction_percent: 0.03 // 3% (DAPA-HF)
        }),
        hemodynamic_effects: () => ({ sbp_drop: 3, hr_drop: 0, potassium_change: 0 }),
        side_effects: () => ({ genital_infection: 0.05, uti: 0.03, volume_depletion: 0.02 }),
        special_features: [
            { feature: 'Preferred in Diabetics', points: 10, criteria: (p) => p.comorbidities.has("Diabetes Mellitus Type 2") }
        ],
        contraindications: (p) => p.egfr < 25 || (p.is_pregnant === true), // Do not initiate if eGFR < 25; pregnancy Category C (insufficient human data)
    },
    {
        name: 'Empagliflozin',
        drug_class: 'SGLT2i',
        is_best_in_class: true,
        available_doses: [
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false, is_target_dose: true },
        ],
        chf_effects: () => ({
            lvef_improvement_absolute: 2.0,
            bnp_reduction_percent: 0.13,
            weight_reduction_kg: 1.5,
            kccq_improvement: 6,
            structure_benefit_points: 15,
            lavi_reduction_percent: 0.15,
            lvedd_reduction_percent: 0.03 // 3% (EMPEROR-Reduced)
        }),
        hemodynamic_effects: () => ({ sbp_drop: 3, hr_drop: 0, potassium_change: 0 }),
        side_effects: () => ({ genital_infection: 0.05, uti: 0.03 }),
        special_features: [
            { feature: 'Preferred in Diabetics', points: 10, criteria: (p) => p.comorbidities.has("Diabetes Mellitus Type 2") }
        ],
        contraindications: (p) => p.egfr < 20 || (p.is_pregnant === true), // eGFR per EMPEROR; pregnancy Category C (insufficient human data)
    },

    // ========================================
    // PHENOTYPE: OBESITY / METABOLIC (GLP-1 / GIP)
    // Evidence: STEP-HFpEF, SUMMIT
    // Impact: Massive Functional (KCCQ) & Weight Loss.
    // ========================================
    {
        name: 'Semaglutide (Wegovy)',
        drug_class: 'GLP-1 RA',
        available_doses: [
             { strength: 2.4, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], scored: false, is_target_dose: true }
        ],
        chf_effects: (dose) => ({
             lvef_improvement_absolute: 1.0, // Indirect benefit
             bnp_reduction_percent: 0.20,
             weight_reduction_kg: 8.0, // ~10% weight loss (STEP-HFpEF)
             kccq_improvement: 16.6, // Massive functional gain
             structure_benefit_points: 10, // Metabolic/Epicardial fat reduction
             lavi_reduction_percent: 0.05,
             lvedd_reduction_percent: 0.01 // Indirect
        }),
        hemodynamic_effects: () => ({ sbp_drop: 4, hr_drop: -2, potassium_change: 0 }), // HR can increase slightly
        side_effects: () => ({ nausea: 0.30, diarrhea: 0.20, constipation: 0.15 }),
        special_features: [
             { feature: 'Indicated for Obesity Phenotype (BMI > 30)', points: 50, criteria: (p) => p.bmi >= 30 }
        ],
        contraindications: (p) => p.bmi < 27
    },
    {
        name: 'Tirzepatide (Zepbound)',
        drug_class: 'GLP-1/GIP RA',
        is_best_in_class: true,
        available_doses: [
             { strength: 10, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], scored: false },
             { strength: 15, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], scored: false, is_target_dose: true }
        ],
        chf_effects: (dose) => ({
             lvef_improvement_absolute: 1.5,
             bnp_reduction_percent: 0.25, // Reduces hsCRP significantly
             weight_reduction_kg: 12.0, // ~15-20% weight loss (SUMMIT)
             kccq_improvement: 19.5, // Unmatched symptom relief
             structure_benefit_points: 15,
             lavi_reduction_percent: 0.08,
             lvedd_reduction_percent: 0.02 // SUMMIT
        }),
        hemodynamic_effects: () => ({ sbp_drop: 6, hr_drop: -2, potassium_change: 0 }),
        side_effects: () => ({ nausea: 0.30, diarrhea: 0.20 }),
        special_features: [
             { feature: 'Superior Weight Loss & KCCQ Benefit (SUMMIT)', points: 60, criteria: (p) => p.bmi >= 30 }
        ],
        contraindications: (p) => p.bmi < 27
    },

    // ========================================
    // VOLUME MANAGEMENT: Loop Diuretics
    // Evidence: Symptom relief only. No mortality/structure benefit.
    // Impact: High Volume, High Functional. Zero Structure.
    // ========================================
    {
        name: 'Furosemide',
        drug_class: 'Loop Diuretic',
        available_doses: [
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'], scored: true },
            { strength: 40, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'], scored: true },
            { strength: 80, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'], scored: true },
            { strength: 160, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: false },
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 0, // No evidence of remodeling
                bnp_reduction_percent: 0.10 + (d/160 * 0.20), // Reduces wall stress via volume unload
                weight_reduction_kg: 1.0 + (d/40 * 1.5), // Potent
                kccq_improvement: 4 + (d/40 * 2), // Symptom relief only
                structure_benefit_points: 0, // No points for structure
                lavi_reduction_percent: 0.08, // Acute volume unload
                lvedd_reduction_percent: 0 // No remodeling
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 2 + Number(dose)/40, hr_drop: 0, potassium_change: -0.3 - (Number(dose)/80 * 0.3) }),
        special_features: [
            { feature: 'Caution in Gout (Uric Acid retention)', points: -5, criteria: (p) => p.comorbidities.has("Gout") }
        ],
        side_effects: () => ({ hypokalemia: 0.20, renal_worsening: 0.10, hypotension: 0.05 }),
    },
    {
        name: 'Torsemide',
        drug_class: 'Loop Diuretic',
        is_best_in_class: true,
        available_doses: [
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 100, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 0,
                bnp_reduction_percent: 0.10 + (d/100 * 0.20),
                weight_reduction_kg: 1.2 + (d/20 * 1.5), // Better bioavailability
                kccq_improvement: 5 + (d/20 * 2),
                structure_benefit_points: 0,
                lavi_reduction_percent: 0.08,
                lvedd_reduction_percent: 0 // No remodeling
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 2 + Number(dose)/20, hr_drop: 0, potassium_change: -0.3 - (Number(dose)/50 * 0.2) }),
        special_features: [
            { feature: 'Caution in Gout', points: -5, criteria: (p) => p.comorbidities.has("Gout") }
        ],
        side_effects: () => ({ hypokalemia: 0.15, hypotension: 0.05 }),
    },

    // ========================================
    // OTHER: Vasodilators & HR Control & Adjuncts
    // Evidence: A-HeFT, SHIFT, DIAMOND, AFFIRM-AHF
    // ========================================
    {
        name: 'Hydralazine/Isosorbide Dinitrate',
        drug_class: 'Vasodilator',
        available_doses: [
            { strength: '37.5/20', unit: 'mg', formulation: 'tablet', frequency_options: ['tid'], scored: false },
            { strength: '75/40', unit: 'mg', formulation: 'tablet', frequency_options: ['tid'], scored: false, is_target_dose: true },
        ],
        chf_effects: (dose) => {
            const level = dose === '75/40' ? 2 : 1;
            return {
                lvef_improvement_absolute: 2 + level, // A-HeFT showed remodeling
                bnp_reduction_percent: 0.10 + (level * 0.05),
                weight_reduction_kg: 0,
                kccq_improvement: 3 + level,
                structure_benefit_points: 15,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.03 // A-HeFT
            };
        },
        hemodynamic_effects: () => ({ sbp_drop: 10, hr_drop: 0, potassium_change: 0 }),
        special_features: [
            { feature: 'Significant benefit in African American patients (A-HeFT)', points: 30, criteria: (p) => p.race === 'Black' || p.race === 'African American' }
        ],
        side_effects: () => ({ headache: 0.30, dizziness: 0.15 }),
    },
    {
        name: 'Ivabradine',
        drug_class: 'If Inhibitor',
        available_doses: [
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: true },
            { strength: 7.5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: true, is_target_dose: true },
        ],
        chf_effects: () => ({
            lvef_improvement_absolute: 2.0, // SHIFT Trial
            bnp_reduction_percent: 0.10,
            weight_reduction_kg: 0,
            kccq_improvement: 5,
            structure_benefit_points: 10,
            lavi_reduction_percent: 0.02,
            lvedd_reduction_percent: 0.02 // SHIFT
        }),
        hemodynamic_effects: () => ({ sbp_drop: 0, hr_drop: 12, potassium_change: 0 }),
        contraindications: (p) => {
            // Initiation gate: HR >= 70 required (SHIFT trial enrollment)
            // Continuation: only discontinue if HR < 50 (actual safety threshold)
            const alreadyOnIvabradine = p.current_regimen?.some(r => r.med.drug_class === 'If Inhibitor');
            if (alreadyOnIvabradine) return p.pulse < 50 || p.rhythm === 'AFib';
            return p.pulse < 70 || p.rhythm === 'AFib';
        },
        special_features: [
            {
                feature: 'SHIFT: Reduces HF hospitalization (HR >= 70 on max BB, Class IIa)',
                points: 15,
                criteria: (p) => p.rhythm === 'Sinus' && p.pulse >= 70 && p.lvef <= 35
            }
        ],
        side_effects: () => ({ phosphenes: 0.05, bradycardia: 0.10 }),
    },
    {
        name: 'Vericiguat',
        drug_class: 'sGC Stimulator',
        available_doses: [
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false, is_target_dose: true },
        ],
        chf_effects: () => ({
            lvef_improvement_absolute: 1.0,
            bnp_reduction_percent: 0.15,
            weight_reduction_kg: 0,
            kccq_improvement: 4,
            structure_benefit_points: 5,
            lavi_reduction_percent: 0.02,
            lvedd_reduction_percent: 0.01 // VICTORIA
        }),
        hemodynamic_effects: () => ({ sbp_drop: 4, hr_drop: 0, potassium_change: 0 }),
        side_effects: () => ({ hypotension: 0.10, anemia: 0.05 }),
    },
    {
        name: 'Patiromer',
        drug_class: 'K+ Binder',
        available_doses: [
            { strength: 8.4, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'], scored: false },
        ],
        chf_effects: () => ({
            lvef_improvement_absolute: 0,
            bnp_reduction_percent: 0,
            weight_reduction_kg: 0,
            kccq_improvement: 0,
            structure_benefit_points: 0, // Enabler only
            lavi_reduction_percent: 0,
            lvedd_reduction_percent: 0
        }),
        hemodynamic_effects: () => ({ sbp_drop: 0, hr_drop: 0, potassium_change: -0.8 }), // Reliable reduction
        side_effects: () => ({ hypomagnesemia: 0.05, constipation: 0.05 }),
        special_features: [
            { feature: 'Enables RAAS Optimization in Hyperkalemia (DIAMOND trial)', points: 50, criteria: (p) => p.potassium > 5.0 }
        ]
    },
    {
        name: 'Ferric Carboxymaltose',
        drug_class: 'IV Iron',
        available_doses: [
             { strength: 1000, unit: 'mg', formulation: 'IV', frequency_options: ['once'], scored: false },
        ],
        chf_effects: () => ({
             lvef_improvement_absolute: 0,
             bnp_reduction_percent: 0.05,
             weight_reduction_kg: 0,
             kccq_improvement: 8, // AFFIRM-AHF
             structure_benefit_points: 0,
             lavi_reduction_percent: 0,
             lvedd_reduction_percent: 0
        }),
        hemodynamic_effects: () => ({ sbp_drop: 0, hr_drop: 0, potassium_change: 0 }),
        side_effects: () => ({ hypophosphatemia: 0.15 }),
        special_features: [
            { feature: 'Treats Iron Deficiency in HF', points: 40, criteria: (p) => (p.ferritin !== undefined && p.ferritin < 100) || (p.tsat !== undefined && p.tsat < 20) }
        ]
    },
    {
        name: 'Digoxin',
        drug_class: 'Inotrope',
        available_doses: [
            { strength: 62.5, unit: 'mcg', formulation: 'tablet (half of 125mcg)', frequency_options: ['qd'], scored: true },
            { strength: 125, unit: 'mcg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
        ],
        chf_effects: (dose) => ({
            lvef_improvement_absolute: 0,
            bnp_reduction_percent: Number(dose) >= 125 ? 0.05 : 0.03,
            weight_reduction_kg: 0,
            kccq_improvement: Number(dose) >= 125 ? 4 : 2, // DIG Trial (Hospitalization reduction)
            structure_benefit_points: 0,
            lavi_reduction_percent: 0,
            lvedd_reduction_percent: 0
        }),
        hemodynamic_effects: (dose) => ({ sbp_drop: 0, hr_drop: Number(dose) >= 125 ? 8 : 4, potassium_change: 0 }),
        side_effects: () => ({ nausea: 0.10, visual_disturbances: 0.05, arrhythmia: 0.05 }),
        // Removed hard eGFR<30 contraindication — renal_adjustment caps dose instead (DIG trial included CKD patients)
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 62.5, caution: true }; // Half-dose; target level 0.5-0.9 ng/mL
            return {};
        },
        special_features: [
             { feature: 'Rate Control in AFib', points: 20, criteria: (p) => p.rhythm === 'AFib' }
        ]
    },
    {
        name: 'Metolazone',
        drug_class: 'Thiazide-like Diuretic',
        available_doses: [
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
        ],
        chf_effects: () => ({
            lvef_improvement_absolute: 0,
            bnp_reduction_percent: 0.10,
            weight_reduction_kg: 2.0, // Sequential blockade synergy
            kccq_improvement: 3,
            structure_benefit_points: 0,
            lavi_reduction_percent: 0.05,
            lvedd_reduction_percent: 0
        }),
        hemodynamic_effects: () => ({ sbp_drop: 5, hr_drop: 0, potassium_change: -0.5 }),
        side_effects: () => ({ severe_hypokalemia: 0.30, dehydration: 0.20 }),
    }
];
