
import { Medication, Patient } from './types';
import { valueUnknown, hasHistoricalHFrEF, isIronDeficient, isBlackRace } from './services/clinicalPredicates';

// Helper for logarithmic calculations (dose-response curves)
const logBase = (base: number, x: number) => Math.log(x) / Math.log(base);

// Formulary-side "preserve HFrEF therapy for unknown EF history". Intentionally DIFFERENT
// from the engine's shouldPreserveQuadForUnknownHistory: this list excludes nsMRA, because
// including it would make finerenone self-contraindicating for a patient already taking it
// with unknown EF history (constants Finerenone CI calls this predicate). Do NOT "harmonize"
// the two variants — see services/clinicalPredicates.ts for the shared building blocks.
const shouldPreserveHFrEFTherapyForUnknownHistory = (patient: Patient): boolean => {
    if (patient.lvef <= 40) return true;
    if (!valueUnknown(patient.previous_lvef)) return false;
    if ((patient.ever_lvef_le_40 ?? 'unknown') !== 'unknown') return false;
    return (patient.current_regimen || []).some(r => {
        const cls = r.med.drug_class;
        return cls === 'ARNI' || cls === 'ACEi' || cls === 'ARB' || cls === 'Beta Blocker' || cls === 'MRA';
    });
};

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
    "Asthma (Mild/Moderate)",
    "COPD",
    "Gout",
    "History of Angioedema",
    "Medullary Thyroid Carcinoma",
    "MEN2 Syndrome",
    "Hypotension (Chronic)",
    "Liver Disease (Child-Pugh B/C)",
    "Obesity (BMI > 30)",
    "Pulmonary Hypertension",
    "Chronic NSAID Use",
    "Bilateral Renal Artery Stenosis"
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
            { strength: '24/26', unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: '49/51', unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: '97/103', unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true },
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
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || (p.potassium > 5.4) || (p.is_pregnant === true) || p.comorbidities.has("Bilateral Renal Artery Stenosis") || p.comorbidities.has("Liver Disease (Child-Pugh B/C)"), // Higher cutoff due to binder logic; Category X; bilateral RAS = absolute CI; sacubitril AUC ~1.5-2x in Child-Pugh B/C (Entresto PI)
        renal_adjustment: (egfr) => egfr < 30 ? { start_dose_modifier: 0.5, caution: true } : {},
    },
    {
        name: 'Lisinopril',
        drug_class: 'ACEi',
        available_doses: [
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
            { strength: 40, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
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
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || p.potassium > 5.4 || (p.is_pregnant === true) || p.comorbidities.has("Bilateral Renal Artery Stenosis"),
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
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] }, // Starting dose
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true }, // SOLVD target
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true }, // CONSENSUS max
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
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || p.potassium > 5.4 || (p.is_pregnant === true) || p.comorbidities.has("Bilateral Renal Artery Stenosis"),
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
            { strength: 1.25, unit: 'mg', formulation: 'capsule', frequency_options: ['qd'] }, // Starting dose
            { strength: 2.5, unit: 'mg', formulation: 'capsule', frequency_options: ['qd'] },
            { strength: 5, unit: 'mg', formulation: 'capsule', frequency_options: ['qd'] },
            { strength: 10, unit: 'mg', formulation: 'capsule', frequency_options: ['qd'], is_target_dose: true }, // AIRE/HOPE target
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
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || p.potassium > 5.4 || (p.is_pregnant === true) || p.comorbidities.has("Bilateral Renal Artery Stenosis"),
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
            { strength: 6.25, unit: 'mg', formulation: 'tablet', frequency_options: ['tid'] }, // Starting dose
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['tid'] },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['tid'], is_target_dose: true }, // ACC/AHA target
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
        contraindications: (p) => p.comorbidities.has("History of Angioedema") || p.potassium > 5.4 || (p.is_pregnant === true) || p.comorbidities.has("Bilateral Renal Artery Stenosis"),
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
            { strength: 40, unit: 'mg', formulation: 'capsule', frequency_options: ['bid'] }, // Starting dose
            { strength: 80, unit: 'mg', formulation: 'capsule', frequency_options: ['bid'] },
            { strength: 160, unit: 'mg', formulation: 'capsule', frequency_options: ['bid'], is_target_dose: true }, // Val-HeFT/ACC target
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
        contraindications: (p) => p.potassium > 5.4 || (p.is_pregnant === true) || p.comorbidities.has("Bilateral Renal Artery Stenosis"),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 80, caution: true };
            return {};
        },
    },
    {
        name: 'Candesartan',
        drug_class: 'ARB',
        available_doses: [
            { strength: 4, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // Starting dose
            { strength: 8, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 16, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 32, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true }, // CHARM target
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
        contraindications: (p) => p.potassium > 5.4 || (p.is_pregnant === true) || p.comorbidities.has("Bilateral Renal Artery Stenosis"),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 8, caution: true };
            return {};
        },
    },
    {
        name: 'Losartan',
        drug_class: 'ARB',
        available_doses: [
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 100, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true }, // ACC/AHA 2022 target
            { strength: 150, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // HEAAL Trial dose (off-label)
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
        contraindications: (p) => p.potassium > 5.4 || (p.is_pregnant === true) || p.comorbidities.has("Bilateral Renal Artery Stenosis"),
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
            { strength: 3.125, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: 6.25, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: 12.5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true },
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
            p.comorbidities.has("Asthma (Mild/Moderate)") || // Non-selective β: avoid in ANY asthma; use β1-selective instead
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
            { strength: 12.5, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'] }, // Starting dose for NYHA III-IV (MERIT-HF)
            { strength: 25, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'] },
            { strength: 50, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'] },
            { strength: 100, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'] },
            { strength: 200, unit: 'mg', formulation: 'ER tablet', frequency_options: ['qd'], is_target_dose: true },
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
            { strength: 1.25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
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
        // Most beta-1 selective — preferred BB in COPD and mild/moderate asthma (SEVERE asthma remains an absolute CI for all BBs)
        special_features: [
            { feature: 'Preferred in COPD / mild-moderate asthma (most beta-1 selective)', points: 10, criteria: (p) => p.comorbidities.has("COPD") || p.comorbidities.has("Asthma (Mild/Moderate)") }
        ],
    },

    // ========================================
    // PILLAR 3: MRAs
    // Evidence: RALES, EMPHASIS-HF, EPHESUS
    // Impact: Moderate Structure (Anti-fibrotic), Mild Volume.
    // ========================================
    {
        name: 'Spironolactone',
        drug_class: 'MRA',
        is_best_in_class: true,
        available_doses: [
            { strength: 12.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
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
        special_features: [
            {
                feature: 'HFpEF Class IIb: TOPCAT Americas subgroup — reduced HF hospitalization (LVEF ≥ 45)',
                points: 18,
                criteria: (p) => p.lvef >= 45
            }
        ],
    },
    {
        name: 'Eplerenone',
        drug_class: 'MRA',
        available_doses: [
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
        ],
        chf_effects: (dose) => {
             // EMPHASIS-HF — dose-scaled like sibling spironolactone (50mg = trial steady state)
             const ratio = Number(dose) / 50;
             return {
                lvef_improvement_absolute: 1.5 + ratio * 1.0, // ~2-2.5%
                bnp_reduction_percent: 0.10,
                weight_reduction_kg: 0.2 * ratio,
                kccq_improvement: 2,
                structure_benefit_points: 30,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.02 + ratio * 0.02 // ~4% at target (EMPHASIS-HF)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 2 + Number(dose)/50, hr_drop: 0, potassium_change: 0.25 + (Number(dose)/50 * 0.15) }),
        side_effects: () => ({ hyperkalemia: 0.15 }),
        special_features: [
            // Intra-class tolerability tiebreaker (eplerenone vs spironolactone in males), NOT an
            // outcome benefit — must stay small so it nudges MRA-agent choice without lifting a lone
            // MRA above multi-pillar GDMT. (Cf. spironolactone's TOPCAT outcome feature at 18 pts.)
            { feature: 'Fewer endocrine side effects (No gynecomastia risk)', points: 3, criteria: (p) => p.sex === 'Male' }
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
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // Starting dose; eGFR-dependent
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 40, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true }, // HF target dose (new 40mg tablet with HF approval)
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
            const isHFimpEF = p.lvef > 40 && hasHistoricalHFrEF(p);
            // The UNKNOWN-history HFimpEF presumption (conservative: on RAAS/BB/MRA with no
            // documented prior EF → manage as possible HFimpEF) gates INITIATION only. A patient
            // already ON and tolerating finerenone must not have it force-removed on a mere
            // presumption — that dropped the entire MRA pillar when gynecomastia barred the
            // steroidal alternatives (red-team probe 2). DOCUMENTED prior LVEF ≤ 40 (isHFimpEF)
            // still applies to continuation; K+/eGFR/pregnancy/hepatic safety gates always apply.
            const alreadyOnFinerenone = p.current_regimen?.some(r => r.med.drug_class === 'nsMRA');
            const preserveHFrEF = !alreadyOnFinerenone && p.lvef > 40 && shouldPreserveHFrEFTherapyForUnknownHistory(p);
            return p.lvef < 40 || isHFimpEF || preserveHFrEF || p.potassium > 5.5 || p.egfr < 25 || (p.is_pregnant === true)
                || p.comorbidities.has('Liver Disease (Child-Pugh B/C)');
        },
        renal_adjustment: (egfr) => {
            // Kerendia HF dosing (FINEARTS-HF): target/max 20mg qd if eGFR 25-59, 40mg qd if
            // eGFR >= 60; contraindicated below 25. (The PI's 10mg/20mg START-dose
            // stratification is not modeled — adds always begin at the lowest tier.)
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
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
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
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
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
             { strength: 0.25, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] }, // Mandatory starting dose (16-week escalation)
             { strength: 1.0, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] }, // Mid-titration
             { strength: 2.4, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], is_target_dose: true }
        ],
        chf_effects: (dose) => {
             // Dose-scaled like every other titratable class (trial-level effects are the
             // 2.4mg steady-state figures from STEP-HFpEF; a starting-dose add must not be
             // credited the full benefit). Floor 0.25 reflects early sub-maximal benefit
             // during the mandated escalation schedule.
             const ratio = Math.max(0.25, Math.min(1, Number(dose) / 2.4));
             return {
                 lvef_improvement_absolute: 1.0 * ratio, // Indirect benefit
                 bnp_reduction_percent: 0.20 * ratio,
                 weight_reduction_kg: 8.0 * ratio, // ~10% weight loss at 2.4mg (STEP-HFpEF)
                 kccq_improvement: 16.6 * ratio, // Massive functional gain at target
                 structure_benefit_points: Math.round(10 * ratio), // Metabolic/Epicardial fat reduction
                 lavi_reduction_percent: 0.05 * ratio,
                 lvedd_reduction_percent: 0.01 * ratio // Indirect
             };
        },
        hemodynamic_effects: () => ({ sbp_drop: 4, hr_drop: -2, potassium_change: 0 }), // HR can increase slightly
        side_effects: () => ({ nausea: 0.30, diarrhea: 0.20, constipation: 0.15 }),
        special_features: [
             { feature: 'Indicated for Obesity Phenotype (BMI > 30)', points: 50, criteria: (p) => p.bmi >= 30 }
        ],
        contraindications: (p) => {
            // True safety gates — apply to initiation AND continuation:
            const safetyCI = p.is_pregnant === true ||
                p.comorbidities.has('Medullary Thyroid Carcinoma') ||
                p.comorbidities.has('MEN2 Syndrome'); // FDA boxed warning: MTC/MEN2
            // BMI >= 30 is a STEP-HFpEF/SUMMIT enrollment (INITIATION) gate only — weight-loss
            // success on a GLP-1 must not force its removal (mirrors the SGLT2i alreadyOn* pattern).
            const alreadyOnGlp1 = p.current_regimen?.some(r =>
                r.med.drug_class === 'GLP-1 RA' || r.med.drug_class === 'GLP-1/GIP RA');
            if (alreadyOnGlp1) return safetyCI;
            return safetyCI || p.bmi < 30;
        }
    },
    {
        name: 'Tirzepatide (Zepbound)',
        drug_class: 'GLP-1/GIP RA',
        is_best_in_class: true,
        available_doses: [
             { strength: 2.5, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] }, // Mandatory starting dose (4-week escalation schedule)
             { strength: 5, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] }, // Week 4
             { strength: 10, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] },
             { strength: 15, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], is_target_dose: true }
        ],
        chf_effects: (dose) => {
             // Dose-scaled like every other titratable class (trial-level effects are the
             // 15mg steady-state figures from SUMMIT). Floor 0.25 reflects early sub-maximal
             // benefit during the mandated escalation schedule.
             const ratio = Math.max(0.25, Math.min(1, Number(dose) / 15));
             return {
                 lvef_improvement_absolute: 1.5 * ratio,
                 bnp_reduction_percent: 0.25 * ratio, // Reduces hsCRP significantly
                 weight_reduction_kg: 12.0 * ratio, // ~15-20% weight loss at 15mg (SUMMIT)
                 kccq_improvement: 19.5 * ratio, // Unmatched symptom relief at target
                 structure_benefit_points: Math.round(15 * ratio),
                 lavi_reduction_percent: 0.08 * ratio,
                 lvedd_reduction_percent: 0.02 * ratio // SUMMIT
             };
        },
        hemodynamic_effects: () => ({ sbp_drop: 6, hr_drop: -2, potassium_change: 0 }),
        side_effects: () => ({ nausea: 0.30, diarrhea: 0.20 }),
        special_features: [
             { feature: 'Superior Weight Loss & KCCQ Benefit (SUMMIT)', points: 60, criteria: (p) => p.bmi >= 30 }
        ],
        contraindications: (p) => {
            // True safety gates — apply to initiation AND continuation:
            const safetyCI = p.is_pregnant === true ||
                p.comorbidities.has('Medullary Thyroid Carcinoma') ||
                p.comorbidities.has('MEN2 Syndrome'); // FDA boxed warning: MTC/MEN2
            // BMI >= 30 is a STEP-HFpEF/SUMMIT enrollment (INITIATION) gate only — weight-loss
            // success on a GLP-1 must not force its removal (mirrors the SGLT2i alreadyOn* pattern).
            const alreadyOnGlp1 = p.current_regimen?.some(r =>
                r.med.drug_class === 'GLP-1 RA' || r.med.drug_class === 'GLP-1/GIP RA');
            if (alreadyOnGlp1) return safetyCI;
            return safetyCI || p.bmi < 30;
        }
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
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 40, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 80, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid', 'tid'] },
            { strength: 160, unit: 'mg', formulation: 'tablet', frequency_options: ['bid', 'tid'] },
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            // Log-based ceiling effect calibrated to the documented dose-response anchors:
            // Furosemide: ~1.5kg at 20mg, ~2.4kg at 40mg, ~3.3kg at 80mg, ~4.2kg at 160mg
            // (curve produces exactly these values; the previous sqrt form drifted 40-70% above)
            const weightLoss = 1.5 + 0.9 * Math.log2(d / 20);
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
        name: 'Furoscix (SC Furosemide)',
        drug_class: 'Loop Diuretic',
        available_doses: [
            { strength: 80, unit: 'mg/10mL', formulation: 'SQ on-body infusor (5h)', frequency_options: ['qd'] }, // FDA-labeled single dose delivered over 5 hours
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            // FUROSCIX provides more reliable exposure than oral furosemide (bioavailability ~99.6% vs IV).
            // Same calibrated furosemide curve, applied to the bioavailability-adjusted oral
            // equivalent, keeping Furoscix ~15% above oral furosemide at the same labeled dose
            // (80mg -> ~3.5kg vs oral 80mg ~3.3kg).
            const oralEquivalent = d * 1.15;
            const weightLoss = 1.5 + 0.9 * Math.log2(oralEquivalent / 20);
            return {
                lvef_improvement_absolute: 0,
                bnp_reduction_percent: 0.12 + (oralEquivalent / 160 * 0.22),
                weight_reduction_kg: weightLoss,
                kccq_improvement: 5 + (oralEquivalent / 80 * 2.2),
                structure_benefit_points: 0,
                lavi_reduction_percent: 0.08,
                lvedd_reduction_percent: 0
            };
        },
        hemodynamic_effects: (dose) => {
            const oralEquivalent = Number(dose) * 1.15;
            return {
                sbp_drop: 2.5 + oralEquivalent / 35,
                hr_drop: 0,
                potassium_change: -0.35 - (oralEquivalent / 80 * 0.35)
            };
        },
        special_features: [
            {
                feature: 'Outpatient worsening-HF decongestion option on background loop therapy',
                points: 12,
                criteria: (p) => {
                    const fluidExcess = p.volume_status.current_weight_kg - p.volume_status.dry_weight_kg;
                    const hasBaselineLoop = (p.current_regimen || []).some(r => r.med.drug_class === 'Loop Diuretic');
                    return fluidExcess >= 2.0 && hasBaselineLoop;
                }
            },
            { feature: 'On-body infusor complexity burden', points: -8, criteria: (p) => p.complexity_tolerance <= 4 }
        ],
        side_effects: () => ({ hypokalemia: 0.22, renal_worsening: 0.12, hypotension: 0.06, infusion_site_reaction: 0.12 }),
        contraindications: (p) => {
            const fluidExcess = p.volume_status.current_weight_kg - p.volume_status.dry_weight_kg;
            const hasBaselineLoop = (p.current_regimen || []).some(r => r.med.drug_class === 'Loop Diuretic');
            const hasEscalationContext = hasBaselineLoop || fluidExcess >= 3.0;
            const allergyTerms = Array.from(p.allergies || []).map(a => a.toLowerCase());
            const hasFurosemideHypersensitivity = allergyTerms.some(term =>
                term.includes('furosemide') || term.includes('furoscix') || term.includes('loop diuretic')
            );
            const hasAdhesiveHypersensitivity = allergyTerms.some(term =>
                term.includes('adhesive') || term.includes('acrylate')
            );
            // Reserve for active congestion episodes, reflecting outpatient worsening-HF evidence and label contraindications.
            return fluidExcess < 1.0 || !hasEscalationContext || p.egfr < 15 || hasFurosemideHypersensitivity || hasAdhesiveHypersensitivity;
        },
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { caution: true };
            return {};
        },
    },
    {
        name: 'Torsemide',
        drug_class: 'Loop Diuretic',
        is_best_in_class: true,
        available_doses: [
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 100, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            // Log-based ceiling calibrated to the documented anchors: better bioavailability
            // than furosemide but same ceiling pharmacology.
            // Torsemide: ~1.8kg at 10mg, ~2.8kg at 20mg, ~4.0kg at 50mg, ~5.0kg at 100mg
            const weightLoss = 1.8 + 0.96 * Math.log2(d / 10);
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
            { strength: 0.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 1, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 2, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid', 'tid'] },
            { strength: 4, unit: 'mg', formulation: 'tablet', frequency_options: ['bid', 'tid'] }, // Max dose for diuretic resistance
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            // 1mg bumetanide ≈ 40mg furosemide; same calibrated log ceiling as furosemide
            // applied to the equivalent dose (0.5/1/2/4mg -> ~1.5/2.4/3.3/4.2kg)
            const furoEquiv = d * 40; // Convert to furosemide equivalents
            const weightLoss = 1.5 + 0.9 * Math.log2(furoEquiv / 20);
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
            { strength: '37.5/20', unit: 'mg', formulation: 'tablet', frequency_options: ['tid'] },
            { strength: '75/40', unit: 'mg', formulation: 'tablet', frequency_options: ['tid'], is_target_dose: true },
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
        contraindications: (p) => {
            // Absolute CI: nitrate + PDE5 inhibitor → profound/potentially fatal hypotension (FDA label).
            // Confirmed exposure is a hard gate; suspected exposure (pulmonary HTN without a
            // documented PDE5i) remains a caution warning in the engine.
            const ext = p.external_medications || new Set<string>();
            return ext.has('Sildenafil') || ext.has('Tadalafil');
        },
        special_features: [
            { feature: 'Significant benefit in African American patients (A-HeFT)', points: 30, criteria: isBlackRace }
        ],
        side_effects: () => ({ headache: 0.30, dizziness: 0.15 }),
    },
    {
        name: 'Ivabradine',
        drug_class: 'If Inhibitor',
        available_doses: [
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: 7.5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true },
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
            // Pregnancy: Corlanor labeling — may cause fetal harm (animal embryo-fetal toxicity);
            // applies to initiation AND continuation.
            if (p.is_pregnant === true) return true;
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
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // Mandatory starting dose (VICTORIA protocol)
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // Week 2 titration
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true }, // Target dose (Week 4+)
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
            // Pregnancy: FDA BOXED WARNING — embryo-fetal toxicity ("Do not administer to a
            // pregnant female"); applies to initiation AND continuation.
            if (p.is_pregnant === true) return true;
            // Continuation carve-out: the VICTORIA criteria below (NT-proBNP >= 1600, NYHA II-IV,
            // recent worsening, LVEF < 45) are trial ENROLLMENT gates for INITIATION only.
            // A patient already on vericiguat whose NT-proBNP improved or whose worsening event
            // aged past 6 months is showing treatment response — that must not force removal
            // (mirrors the SGLT2i alreadyOn* continuation pattern).
            const alreadyOnVericiguat = p.current_regimen?.some(r => r.med.drug_class === 'sGC Stimulator');
            if (alreadyOnVericiguat) return false;
            const nyhaEligible = p.nyha_class === 'II' || p.nyha_class === 'III' || p.nyha_class === 'IV';
            const hasRequiredWorseningEvent = p.recent_hf_worsening_within_6mo === 'yes';
            return !nyhaEligible || p.lvef >= 45 || !p.nt_pro_bnp || p.nt_pro_bnp < 1600 || !hasRequiredWorseningEvent;
        },
    },
    {
        name: 'Patiromer',
        drug_class: 'K+ Binder',
        available_doses: [
            { strength: 8.4, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'] },
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
            { strength: 5, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'] },
            { strength: 10, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'] }, // Acute correction phase
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
             { strength: 1000, unit: 'mg', formulation: 'IV', frequency_options: ['once'] },
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
            { feature: 'Treats Iron Deficiency in HF', points: 40, criteria: isIronDeficient }
        ]
    },
    {
        name: 'Digoxin',
        drug_class: 'Inotrope',
        available_doses: [
            { strength: 62.5, unit: 'mcg', formulation: 'tablet (half of 125mcg)', frequency_options: ['qd'] },
            { strength: 125, unit: 'mcg', formulation: 'tablet', frequency_options: ['qd'] },
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
            // (p.potassium > 0 guard: blank/unentered K+ is stored as 0 and must not read as
            // hypokalemia — the engine's POTASSIUM UNKNOWN pathway governs that case.)
            return p.potassium > 5.5 || (p.potassium > 0 && p.potassium < 3.5) || p.egfr < 15 || hasAvBlock;
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
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
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
            { strength: 12.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
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
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
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

