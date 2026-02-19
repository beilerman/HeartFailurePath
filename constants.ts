
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
    "Type 1 Diabetes Mellitus",
    "Diabetes Mellitus Type 2",
    "Prior DKA / Euglycemic DKA",
    "Chronic Kidney Disease",
    "Severe Asthma / Bronchospasm",
    "Gout",
    "History of Angioedema",
    "Medullary Thyroid Carcinoma",
    "MEN2 Syndrome",
    "Hypotension (Chronic)",
    "Liver Disease (Child-Pugh B/C)",
    "Obesity (BMI > 30)",
    "Pulmonary Hypertension",
    "Chronic NSAID Use"
];

export const RELEVANT_EXTERNAL_MEDICATIONS = [
    'Amiodarone',
    'Verapamil',
    'Diltiazem',
    'Lithium',
    'Sildenafil',
    'Tadalafil'
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
        name: 'Enalapril',
        drug_class: 'ACEi',
        available_doses: [
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: false }, // Starting dose
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: true },
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: true, is_target_dose: true }, // SOLVD target
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], scored: false, is_target_dose: true }, // CONSENSUS max
        ],
        chf_effects: (dose) => {
            // CONSENSUS/SOLVD: First ACEi with HF mortality benefit
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 2 + (logBase(2, d / 2.5) * 0.5), // Max ~4-5%
                bnp_reduction_percent: 0.15 + (logBase(2, d / 2.5) * 0.02),
                weight_reduction_kg: 0,
                kccq_improvement: 3 + (d / 20 * 2),
                structure_benefit_points: 15,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.03 + (d / 20 * 0.02) // 3-5% (SOLVD)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 5 + Number(dose) / 5, hr_drop: 0, potassium_change: 0.20 }),
        side_effects: () => ({ cough: 0.10, hypotension: 0.08, hyperkalemia: 0.06, angioedema: 0.01 }),
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || p.potassium > 5.4 || (p.is_pregnant === true),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 5, caution: true }; // More conservative than Lisinopril (BID dosing)
            if (egfr < 45) return { max_dose: 10, caution: true };
            return {};
        },
    },
    {
        name: 'Ramipril',
        drug_class: 'ACEi',
        available_doses: [
            { strength: 1.25, unit: 'mg', formulation: 'capsule', frequency_options: ['qd'], scored: false }, // Starting dose
            { strength: 2.5, unit: 'mg', formulation: 'capsule', frequency_options: ['qd'], scored: true },
            { strength: 5, unit: 'mg', formulation: 'capsule', frequency_options: ['qd'], scored: true },
            { strength: 10, unit: 'mg', formulation: 'capsule', frequency_options: ['qd'], scored: true, is_target_dose: true }, // AIRE/HOPE target
        ],
        chf_effects: (dose) => {
            // AIRE: Post-MI LV dysfunction; HOPE: High-risk CV patients
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 2 + (logBase(2, d / 1.25) * 0.5),
                bnp_reduction_percent: 0.15 + (logBase(2, d / 1.25) * 0.02),
                weight_reduction_kg: 0,
                kccq_improvement: 3 + (d / 10 * 2),
                structure_benefit_points: 15,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.03 + (d / 10 * 0.02) // 3-5% (AIRE)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 5 + Number(dose) / 2, hr_drop: 0, potassium_change: 0.20 }),
        side_effects: () => ({ cough: 0.10, hypotension: 0.08, hyperkalemia: 0.06, angioedema: 0.01 }),
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || p.potassium > 5.4 || (p.is_pregnant === true),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 2.5, caution: true };
            if (egfr < 45) return { max_dose: 5, caution: true };
            return {};
        },
    },
    {
        name: 'Captopril',
        drug_class: 'ACEi',
        available_doses: [
            { strength: 6.25, unit: 'mg', formulation: 'tablet', frequency_options: ['tid'], scored: false }, // Starting dose
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['tid'], scored: false },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['tid'], scored: false, is_target_dose: true }, // ACC/AHA target
        ],
        chf_effects: (dose) => {
            // SAVE: Post-MI LV dysfunction. Historical significance; TID dosing is practical disadvantage
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 2 + (d / 50 * 2),
                bnp_reduction_percent: 0.15 + (d / 50 * 0.05),
                weight_reduction_kg: 0,
                kccq_improvement: 3 + (d / 50 * 2),
                structure_benefit_points: 15,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.03 + (d / 50 * 0.02) // 3-5% (SAVE)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 5 + Number(dose) / 10, hr_drop: 0, potassium_change: 0.20 }),
        side_effects: () => ({ cough: 0.12, hypotension: 0.10, hyperkalemia: 0.06, angioedema: 0.01, taste_disturbance: 0.05 }),
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || p.potassium > 5.4 || (p.is_pregnant === true),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 6.25, caution: true };
            if (egfr < 45) return { max_dose: 25, caution: true };
            return {};
        },
    },
    {
        name: 'Valsartan',
        drug_class: 'ARB',
        available_doses: [
            { strength: 40, unit: 'mg', formulation: 'capsule', frequency_options: ['bid'], scored: false }, // Starting dose
            { strength: 80, unit: 'mg', formulation: 'capsule', frequency_options: ['bid'], scored: true },
            { strength: 160, unit: 'mg', formulation: 'capsule', frequency_options: ['bid'], scored: true, is_target_dose: true }, // Val-HeFT/ACC target
        ],
        chf_effects: (dose) => {
            // Val-HeFT: Mortality/morbidity reduction in HFrEF
            const d = Number(dose);
            const ratio = d / 160;
            return {
                lvef_improvement_absolute: 2 + (ratio * 2.5),
                bnp_reduction_percent: 0.10 + (ratio * 0.12),
                weight_reduction_kg: 0,
                kccq_improvement: 3 + (ratio * 3),
                structure_benefit_points: 12,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.03 + (ratio * 0.03) // 3-6% (Val-HeFT)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 4 + Number(dose) / 30, hr_drop: 0, potassium_change: 0.15 }),
        side_effects: () => ({ hypotension: 0.06, hyperkalemia: 0.04, dizziness: 0.05 }),
        contraindications: (p) => p.potassium > 5.4 || (p.is_pregnant === true),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 80, caution: true };
            return {};
        },
    },
    {
        name: 'Candesartan',
        drug_class: 'ARB',
        available_doses: [
            { strength: 4, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false }, // Starting dose
            { strength: 8, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 16, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 32, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true, is_target_dose: true }, // CHARM target
        ],
        chf_effects: (dose) => {
            // CHARM-Alternative/Added: CV death/HF hospitalization reduction
            const d = Number(dose);
            const ratio = d / 32;
            return {
                lvef_improvement_absolute: 2 + (ratio * 2.5),
                bnp_reduction_percent: 0.10 + (ratio * 0.12),
                weight_reduction_kg: 0,
                kccq_improvement: 3 + (ratio * 3),
                structure_benefit_points: 12,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.03 + (ratio * 0.03) // 3-6% (CHARM)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 4 + Number(dose) / 6, hr_drop: 0, potassium_change: 0.15 }),
        side_effects: () => ({ hypotension: 0.05, hyperkalemia: 0.04 }),
        contraindications: (p) => p.potassium > 5.4 || (p.is_pregnant === true),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 8, caution: true };
            return {};
        },
    },
    {
        name: 'Losartan',
        drug_class: 'ARB',
        available_doses: [
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 100, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true, is_target_dose: true }, // ACC/AHA 2022 target
            { strength: 150, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false }, // HEAAL Trial dose (off-label)
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
        contraindications: (p) =>
            p.pulse < 55 ||
            p.rhythm === '2nd Degree AV Block' ||
            p.rhythm === '3rd Degree AV Block' ||
            p.comorbidities.has("Severe Asthma / Bronchospasm") ||
            p.comorbidities.has("Liver Disease (Child-Pugh B/C)"),
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
            { strength: 12.5, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'], scored: false }, // Starting dose for NYHA III-IV (MERIT-HF)
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
        contraindications: (p) =>
            p.pulse < 55 ||
            p.rhythm === '2nd Degree AV Block' ||
            p.rhythm === '3rd Degree AV Block' ||
            p.comorbidities.has("Severe Asthma / Bronchospasm") ||
            p.comorbidities.has("Liver Disease (Child-Pugh B/C)"), // CYP2D6 metabolized; increased exposure in cirrhosis
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
        contraindications: (p) =>
            p.pulse < 55 ||
            p.rhythm === '2nd Degree AV Block' ||
            p.rhythm === '3rd Degree AV Block' ||
            p.comorbidities.has("Severe Asthma / Bronchospasm"), // All BBs CI in severe asthma (ACC/AHA); cardioselectivity lost at higher doses
        // Most beta-1 selective — preferred BB in COPD (NOT asthma, which remains an absolute CI)
        special_features: [
            { feature: 'Preferred in COPD (most beta-1 selective)', points: 10, criteria: (p) => p.comorbidities.has("COPD") }
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
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { contraindicated: true };
            if (egfr <= 45) return { max_dose: 25, caution: true };
            return {};
        },
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
            { feature: 'Fewer endocrine side effects (No gynecomastia risk)', points: 10, criteria: (p) => p.sex === 'Male' } // Only relevant advantage over spironolactone in males
        ],
        contraindications: (p) => p.potassium > 5.5 || p.egfr < 30 || (p.is_pregnant === true), // Relaxed from 5.2 → 5.5; pregnancy Category X
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { contraindicated: true };
            if (egfr <= 45) return { max_dose: 25, caution: true };
            return {};
        },
    },

    // ========================================
    // NONSTEROIDAL MRA (LVEF ≥ 40 only)
    // Evidence: FINEARTS-HF (2024), FDA approved July 2025
    // NOT a GDMT pillar for HFrEF — no evidence below LVEF 40
    // ========================================
    {
        name: 'Finerenone (Kerendia)',
        drug_class: 'nsMRA', // Distinct from 'MRA' to prevent HFrEF pillar credit
        available_doses: [
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false }, // Starting dose; eGFR-dependent
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false },
            { strength: 40, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false, is_target_dose: true }, // HF target dose (new 40mg tablet with HF approval)
        ],
        chf_effects: (dose) => {
            // FINEARTS-HF: 16% RRR in CV death/HF events in LVEF ≥ 40
            const d = Number(dose);
            const ratio = d / 40;
            return {
                lvef_improvement_absolute: 1.5 + (ratio * 1.0), // Modest anti-fibrotic remodeling
                bnp_reduction_percent: 0.10 + (ratio * 0.08),
                weight_reduction_kg: 0.2 * ratio, // Minimal diuretic effect
                kccq_improvement: 3 + (ratio * 3),
                structure_benefit_points: 25, // Strong anti-fibrotic (novel MoA)
                lavi_reduction_percent: 0.04,
                lvedd_reduction_percent: 0.03 + (ratio * 0.02) // 3-5% (FINEARTS-HF)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 2 + Number(dose) / 20, hr_drop: 0, potassium_change: 0.25 + (Number(dose) / 40 * 0.15) }), // Lower K+ risk than steroidal MRA
        side_effects: () => ({ hyperkalemia: 0.08, hypotension: 0.04 }), // Lower hyperkalemia vs spironolactone/eplerenone
        special_features: [
            {
                feature: 'nsMRA: 16% RRR CV death/HF events in LVEF≥40 (FINEARTS-HF); lower hyperkalemia vs steroidal MRA',
                points: 45,
                criteria: (p) => p.lvef >= 40
            }
        ],
        contraindications: (p) => {
            // FINEARTS-HF enrolled LVEF ≥ 40 only; no evidence for HFrEF
            // HFimpEF (previous LVEF ≤ 40) is managed as HFrEF — use steroidal MRA instead
            // Liver Disease (Child-Pugh B/C): CYP3A4 substrate, reduced clearance in cirrhosis
            const isHFimpEF = p.previous_lvef !== undefined && p.previous_lvef <= 40 && p.lvef > 40;
            return p.lvef < 40 || isHFimpEF || p.potassium > 5.5 || p.egfr < 25 || (p.is_pregnant === true)
                || p.comorbidities.has('Liver Disease (Child-Pugh B/C)');
        },
        renal_adjustment: (egfr) => {
            // Per Kerendia PI: start 10mg if eGFR 25-59, start 20mg if eGFR ≥ 60
            if (egfr < 25) return { contraindicated: true };
            if (egfr < 60) return { max_dose: 20, caution: true };
            return {};
        },
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
        contraindications: (p) => {
            // eGFR threshold applies to INITIATION only — continuation allowed (DAPA-CKD)
            const alreadyOnSGLT2i = p.current_regimen?.some(r => r.med.drug_class === 'SGLT2i');
            const hasT1orDkaRisk = p.comorbidities.has("Type 1 Diabetes Mellitus") || p.comorbidities.has("Prior DKA / Euglycemic DKA");
            if (alreadyOnSGLT2i) return p.is_pregnant === true || hasT1orDkaRisk;
            return p.egfr < 25 || p.is_pregnant === true || hasT1orDkaRisk;
        },
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
        contraindications: (p) => {
            // eGFR threshold applies to INITIATION only — continuation allowed (EMPA-KIDNEY)
            const alreadyOnSGLT2i = p.current_regimen?.some(r => r.med.drug_class === 'SGLT2i');
            const hasT1orDkaRisk = p.comorbidities.has("Type 1 Diabetes Mellitus") || p.comorbidities.has("Prior DKA / Euglycemic DKA");
            if (alreadyOnSGLT2i) return p.is_pregnant === true || hasT1orDkaRisk;
            return p.egfr < 25 || p.is_pregnant === true || hasT1orDkaRisk; // Harmonized with Dapagliflozin (ACC/AHA uniform eGFR >= 25 initiation)
        },
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
             { strength: 0.25, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], scored: false }, // Mandatory starting dose (16-week escalation)
             { strength: 1.0, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], scored: false }, // Mid-titration
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
        contraindications: (p) =>
            p.bmi < 30 ||
            p.is_pregnant === true ||
            p.comorbidities.has('Medullary Thyroid Carcinoma') ||
            p.comorbidities.has('MEN2 Syndrome') // FDA boxed warning: MTC/MEN2
    },
    {
        name: 'Tirzepatide (Zepbound)',
        drug_class: 'GLP-1/GIP RA',
        is_best_in_class: true,
        available_doses: [
             { strength: 2.5, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], scored: false }, // Mandatory starting dose (4-week escalation schedule)
             { strength: 5, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], scored: false }, // Week 4
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
        contraindications: (p) =>
            p.bmi < 30 ||
            p.is_pregnant === true ||
            p.comorbidities.has('Medullary Thyroid Carcinoma') ||
            p.comorbidities.has('MEN2 Syndrome') // FDA boxed warning: MTC/MEN2
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
            { strength: 80, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid', 'tid'], scored: true },
            { strength: 160, unit: 'mg', formulation: 'tablet', frequency_options: ['bid', 'tid'], scored: false },
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            // Sqrt-based ceiling effect: loop diuretics have diminishing returns at high doses
            // Furosemide: ~1.5kg at 20mg, ~2.5kg at 40mg, ~3.5kg at 80mg, ~4.2kg at 160mg
            const weightLoss = 1.0 + 2.5 * Math.sqrt(d / 40);
            return {
                lvef_improvement_absolute: 0, // No evidence of remodeling
                bnp_reduction_percent: 0.10 + (d/160 * 0.20), // Reduces wall stress via volume unload
                weight_reduction_kg: weightLoss,
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
        renal_adjustment: (egfr) => {
            if (egfr < 20) return { caution: true };
            return {};
        },
    },
    {
        name: 'Torsemide',
        drug_class: 'Loop Diuretic',
        is_best_in_class: true,
        available_doses: [
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'], scored: true },
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'], scored: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'], scored: true },
            { strength: 100, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'], scored: true },
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            // Sqrt-based ceiling: better bioavailability than furosemide but same ceiling pharmacology
            // Torsemide: ~1.8kg at 10mg, ~2.9kg at 20mg, ~4.2kg at 50mg, ~5.0kg at 100mg
            const weightLoss = 1.2 + 2.5 * Math.sqrt(d / 20);
            return {
                lvef_improvement_absolute: 0,
                bnp_reduction_percent: 0.10 + (d/100 * 0.20),
                weight_reduction_kg: weightLoss,
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
        renal_adjustment: (egfr) => {
            if (egfr < 20) return { caution: true };
            return {};
        },
    },
    {
        name: 'Bumetanide',
        drug_class: 'Loop Diuretic',
        available_doses: [
            { strength: 0.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'], scored: true },
            { strength: 1, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'], scored: true },
            { strength: 2, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid', 'tid'], scored: true },
            { strength: 4, unit: 'mg', formulation: 'tablet', frequency_options: ['bid', 'tid'], scored: false }, // Max dose for diuretic resistance
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            // 1mg bumetanide ≈ 40mg furosemide; sqrt ceiling effect like furosemide
            const furoEquiv = d * 40; // Convert to furosemide equivalents
            const weightLoss = 1.0 + 2.5 * Math.sqrt(furoEquiv / 40);
            return {
                lvef_improvement_absolute: 0,
                bnp_reduction_percent: 0.10 + (d / 4 * 0.20),
                weight_reduction_kg: weightLoss,
                kccq_improvement: 4 + (d * 2),
                structure_benefit_points: 0,
                lavi_reduction_percent: 0.08,
                lvedd_reduction_percent: 0
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 2 + Number(dose) * 2, hr_drop: 0, potassium_change: -0.3 - (Number(dose) / 2 * 0.3) }),
        special_features: [
            { feature: 'Caution in Gout (Uric Acid retention)', points: -5, criteria: (p) => p.comorbidities.has("Gout") }
        ],
        side_effects: () => ({ hypokalemia: 0.20, renal_worsening: 0.10, hypotension: 0.05 }),
        renal_adjustment: (egfr) => {
            if (egfr < 20) return { caution: true };
            return {};
        },
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
            const hasAvBlock = p.rhythm === '2nd Degree AV Block' || p.rhythm === '3rd Degree AV Block';
            if (alreadyOnIvabradine) return p.pulse < 50 || p.rhythm === 'AFib' || hasAvBlock;
            return p.pulse < 70 || p.rhythm === 'AFib' || hasAvBlock;
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
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false }, // Mandatory starting dose (VICTORIA protocol)
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false }, // Week 2 titration
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: false, is_target_dose: true }, // Target dose (Week 4+)
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            const ratio = d / 10;
            return {
                lvef_improvement_absolute: 0.5 + ratio * 0.5,
                bnp_reduction_percent: 0.05 + ratio * 0.10,
                weight_reduction_kg: 0,
                kccq_improvement: 1.5 + ratio * 2.5,
                structure_benefit_points: Math.round(2 + ratio * 3),
                lavi_reduction_percent: 0.01 + ratio * 0.01,
                lvedd_reduction_percent: ratio * 0.01 // VICTORIA
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 1.5 + Number(dose) / 10 * 2.5, hr_drop: 0, potassium_change: 0 }),
        side_effects: () => ({ hypotension: 0.10, anemia: 0.05 }),
        contraindications: (p) => {
            const nyhaEligible = p.nyha_class === 'II' || p.nyha_class === 'III' || p.nyha_class === 'IV';
            const hasRequiredWorseningEvent = p.recent_hf_worsening_within_6mo === 'yes';
            return !nyhaEligible || p.lvef >= 45 || !p.nt_pro_bnp || p.nt_pro_bnp < 1600 || !hasRequiredWorseningEvent;
        },
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
        name: 'Sodium Zirconium Cyclosilicate (Lokelma)',
        drug_class: 'K+ Binder',
        available_doses: [
            { strength: 5, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'], scored: false },
            { strength: 10, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'], scored: false }, // Acute correction phase
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
        hemodynamic_effects: (dose) => ({ sbp_drop: 0, hr_drop: 0, potassium_change: Number(dose) >= 10 ? -1.1 : -0.7 }), // Faster onset than Patiromer (1hr vs 7hr)
        side_effects: () => ({ edema: 0.06 }), // ~400mg sodium per 10g dose can worsen HF congestion
        special_features: [
            { feature: 'Enables RAAS/MRA Optimization in Hyperkalemia (HARMONIZE)', points: 50, criteria: (p) => p.potassium > 5.0 },
            { feature: 'Sodium load risk in congested HF (400mg Na/dose)', points: -10, criteria: (p) => (p.volume_status.current_weight_kg - p.volume_status.dry_weight_kg) > 2.0 }
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
        contraindications: (p) => {
            // K+ > 5.5: Hyperkalemia potentiates digitalis toxicity (shifts binding, arrhythmia risk)
            // eGFR < 15: End-stage renal without dialysis monitoring — accumulation risk too high
            // (eGFR 15-30 handled by renal_adjustment dose cap to 62.5mcg)
            const hasAvBlock = p.rhythm === '2nd Degree AV Block' || p.rhythm === '3rd Degree AV Block';
            return p.potassium > 5.5 || p.potassium < 3.5 || p.egfr < 15 || hasAvBlock;
        },
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
        contraindications: (p) => p.egfr < 15, // Anuria/ESRD — no tubular function for thiazide mechanism
    },
    {
        name: 'Chlorthalidone',
        drug_class: 'Thiazide-like Diuretic',
        available_doses: [
            { strength: 12.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
        ],
        chf_effects: (dose) => {
            // CLOROTIC: Improved decongestion when added to loop diuretics
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 0,
                bnp_reduction_percent: 0.08 + (d / 25 * 0.07),
                weight_reduction_kg: 1.5 + (d / 25 * 0.5), // Sequential nephron blockade
                kccq_improvement: 2 + (d / 25),
                structure_benefit_points: 0,
                lavi_reduction_percent: 0.04,
                lvedd_reduction_percent: 0
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 4 + Number(dose) / 10, hr_drop: 0, potassium_change: -0.4 - (Number(dose) / 25 * 0.1) }),
        side_effects: () => ({ severe_hypokalemia: 0.25, dehydration: 0.15, hyponatremia: 0.10 }),
        contraindications: (p) => p.egfr < 15, // Anuria/ESRD
    },
    {
        name: 'Hydrochlorothiazide',
        drug_class: 'Thiazide-like Diuretic',
        available_doses: [
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], scored: true },
        ],
        chf_effects: (dose) => {
            // Less potent than chlorthalidone/metolazone for sequential nephron blockade
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 0,
                bnp_reduction_percent: 0.06 + (d / 50 * 0.06),
                weight_reduction_kg: 1.0 + (d / 50 * 0.5), // Weaker than chlorthalidone
                kccq_improvement: 2 + (d / 50),
                structure_benefit_points: 0,
                lavi_reduction_percent: 0.03,
                lvedd_reduction_percent: 0
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 3 + Number(dose) / 15, hr_drop: 0, potassium_change: -0.3 - (Number(dose) / 50 * 0.1) }),
        side_effects: () => ({ hypokalemia: 0.20, dehydration: 0.10, hyponatremia: 0.08 }),
        contraindications: (p) => p.egfr < 30, // Ineffective at eGFR < 30 (unlike metolazone/chlorthalidone)
    }
];

