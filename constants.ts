
import { Medication, Patient } from './types';
import { ci, CI_ANURIA, ANURIA, CI_ANGIOEDEMA, CI_POTASSIUM_GT_5_4, CI_BILATERAL_RAS, CI_ALISKIREN_DIABETES, LIVER_BC, LIVER_B_CONFIRMED, hasChildPughBorC, hasChildPughBConfirmed, bbStartBradycardiaCheck, CI_SICK_SINUS_NO_PACEMAKER, SICK_SINUS, VENTRICULAR_FIBRILLATION, WPW, CONDUCTION_DEFECT, IVABRADINE_STRONG_CYP3A4, CYP3A4_INDUCERS, strongIvabradineCyp3a4, onCyp3a4Inducer, onVerapamilOrDiltiazem, onAmiodarone, CI_SEVERE_HEPATIC_UNSPECIFIED, CI_AV_BLOCK_2, CI_AV_BLOCK_3, CI_SEVERE_ASTHMA, CI_TYPE1_OR_DKA, CI_MTC_MEN2, pregnancyCheck,
    STRONG_CYP3A_INHIBITORS, MODERATE_CYP3A_INHIBITORS, CI_STRONG_CYP3A, CI_ADRENAL_INSUFFICIENCY, CI_MRA_WITHHOLD_K6, mraStartPotassiumCheck, moderateCyp3aInhibitor,
    PDE5_INHIBITORS, onPde5Inhibitor, OTHER_SGC_STIMULATORS, onOtherSgcStimulator, LONG_ACTING_NITRATES, onLongActingNitrate } from './services/engine/contraindications';
import { arniStartDose } from './services/engine/raasStart';
import { valueUnknown, hasHistoricalHFrEF, isBlackRace, isAcutelyDecompensated, vericiguatNtProBnpThreshold, ivIronCreditTier } from './services/clinicalPredicates';

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

// True when EVERY formulary agent in the given classes is unavailable to the patient (contraindicated, or named in the allergy list):
// the A-HeFT Class 1 rule needs a RAAS inhibitor and a beta-blocker on board "or documented inability to take them". Lazy: reads
// MEDICATION_FORMULARY at call time. Documented intolerance that leaves a class member usable (ACEi cough, ARB allowed) is NOT inability.
const unableToTakeClasses = (p: Patient, classes: readonly string[]): boolean => {
    const members = MEDICATION_FORMULARY.filter(m => classes.includes(m.drug_class));
    return members.length > 0 && members.every(m => m.contraindications?.(p) === true || p.allergies.has(m.name));
};
const RAAS_DRUG_CLASSES = ['ARNI', 'ACEi', 'ARB'] as const;

// Ferric carboxymaltose label dosing (Injectafer label Table 1, HF with iron deficiency; verified-sglt2-glp1-adjuncts.md row 30):
//   weight < 70 kg:  Hb < 10 -> 1000 mg day 1 + 500 mg week 6;  Hb 10-14 -> 1000 mg, no week-6 dose;  Hb > 14 to < 15 -> 500 mg, none.
//   weight >= 70 kg: Hb < 10 -> 1000 + 1000;                    Hb 10-14 -> 1000 + 500;               Hb > 14 to < 15 -> 500, none.
//   Maintenance: 500 mg at weeks 12, 24, 36 if ferritin < 100, or 100-300 with TSAT < 20%. No data beyond 36 weeks or with Hb >= 15.
// Weight is the ACTUAL (current) weight. Weight or Hb not entered is stated, never defaulted silently.
const fcmDayOneDose = (p: Patient): number => (p.hemoglobin !== undefined && p.hemoglobin > 14) ? 500 : 1000;
const fcmDosingNote = (p: Patient): string => {
    const wt = p.volume_status.current_weight_kg;
    const hb = p.hemoglobin;
    const maint = 'Then 500 mg at weeks 12, 24 and 36 only if ferritin is below 100 ng/mL, or 100-300 ng/mL with TSAT below 20% (no data beyond 36 weeks).';
    const heavy = wt >= 70;
    const week6 = (h: number) => h < 10 ? (heavy ? '1000 mg' : '500 mg') : h <= 14 ? (heavy ? '500 mg' : 'none') : 'none';
    if (hb !== undefined && hb >= 15) return 'ferric carboxymaltose is held: hemoglobin is 15 g/dL or higher and the label has no data in that range.';
    if (!(wt > 0)) return `ferric carboxymaltose dosing needs the patient's weight (label: below 70 kg vs 70 kg or more) and hemoglobin; the weight was not entered. Day 1: 1000 mg (500 mg if Hb is above 14); week 6: below 70 kg 500 mg if Hb < 10 else none; 70 kg or more 1000 mg if Hb < 10, 500 mg if Hb 10-14, none if Hb above 14. ${maint}`;
    const who = `${wt.toFixed(0)} kg (${heavy ? '70 kg or more' : 'below 70 kg'})`;
    if (hb === undefined) {
        return `ferric carboxymaltose label dosing for ${who}, hemoglobin not entered (enter it to fix the dose): day 1 is 1000 mg (500 mg if Hb is above 14 to below 15); week 6 is ${week6(9)} if Hb < 10, ${week6(12)} if Hb 10-14, none if Hb above 14. ${maint}`;
    }
    return `ferric carboxymaltose label dosing for ${who}, Hb ${hb} g/dL: day 1 ${fcmDayOneDose(p)} mg; week 6 ${week6(hb)}. ${maint}`;
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
    ANURIA, // diuretic label contraindication (Furoscix, metolazone, hydrochlorothiazide)
    "History of Angioedema",
    "Medullary Thyroid Carcinoma",
    "MEN2 Syndrome",
    "Hypotension (Chronic)",
    LIVER_BC,
    LIVER_B_CONFIRMED,
    "Obesity (BMI > 30)",
    "Pulmonary Hypertension",
    "Chronic NSAID Use",
    // GLP-1 / GIP label warnings (Wegovy and Zepbound W&P): caution-level notes, not contraindications.
    "History of Pancreatitis",
    "Severe Gastroparesis",
    "Diabetic Retinopathy",
    "Bilateral Renal Artery Stenosis",
    "Adrenal Insufficiency (Addison's disease)",
    // Rate-control drugs (verified-rate-control.md): beta-blocker / ivabradine / digoxin label contraindications and warnings.
    SICK_SINUS,
    CONDUCTION_DEFECT,
    VENTRICULAR_FIBRILLATION,
    WPW
];

export const RELEVANT_EXTERNAL_MEDICATIONS = [
    'Amiodarone',
    'Verapamil',
    'Diltiazem',
    'Lithium',
    // PDE-5 inhibitors (BiDil label: avanafil, sildenafil, tadalafil, vardenafil contraindicated with H/ISDN; Verquvo label: not recommended).
    ...PDE5_INHIBITORS,
    // Riociguat: contraindicated with vericiguat (Verquvo label) and with H/ISDN (BiDil label).
    ...OTHER_SGC_STIMULATORS,
    // Long-acting nitrates taken outside the formulary: excluded from VICTORIA, so vericiguat carries a warning.
    ...LONG_ACTING_NITRATES,
    // Aliskiren: contraindicated with ARNI / ACEi / ARB in diabetes (Entresto and Zestril labels).
    'Aliskiren',
    // CYP3A inhibitors that gate eplerenone / finerenone (single-sourced in services/engine/contraindications.ts).
    // Verapamil and Diltiazem are already listed above; Erythromycin and Fluconazole are the other moderate agents.
    ...STRONG_CYP3A_INHIBITORS,
    ...MODERATE_CYP3A_INHIBITORS.filter(n => n !== 'Verapamil' && n !== 'Diltiazem'),
    // Corlanor label: telithromycin is a named strong CYP3A4 inhibitor (contraindicated); CYP3A4 inducers are to be avoided.
    ...IVABRADINE_STRONG_CYP3A4.filter(n => !STRONG_CYP3A_INHIBITORS.includes(n)),
    ...CYP3A4_INDUCERS,
];

// Lokelma label: edema 4.4% / 5.9% / 16.1% at 5 / 10 / 15 g in placebo-controlled trials.
const LOKELMA_EDEMA_RATE = (dose: number | string): number => {
    const d = Number(dose);
    return d >= 15 ? 0.161 : d >= 10 ? 0.059 : 0.044;
};

// Wording for the RAAS pregnancy checks: all eight carry a boxed warning for fetal toxicity (replaces the obsolete "Category X").
const BOXED_FETAL_TOXICITY = 'boxed warning: fetal toxicity';

// A potassium binder's "enables RAAS/MRA optimization" credit only applies when a RAAS inhibitor or MRA is
// actually in the resulting regimen (DIAMOND enrolled patients on RAASi; it showed enabling, not outcomes).
const hasRaasOrMra = (regimen?: { med: { drug_class: string } }[]): boolean =>
    (regimen ?? []).some(r => ['ARNI', 'ACEi', 'ARB', 'MRA', 'nsMRA'].includes(r.med.drug_class));

/** Furoscix oral-furosemide-equivalent multiplier (verified-diuretics.md): infusor 99.6% of IV vs oral about 50-64% -> 2:1. */
const FUROSCIX_ORAL_EQUIVALENT = 2.0;

/** Incremental weight loss (kg) of a thiazide-type add-on on top of a loop: CLOROTIC adjusted difference at 72 h, 1.14 kg (95% CI 0.42-1.84), HCTZ added to IV furosemide
 *  in acute HF (Eur Heart J 2023;44:411, PMID 36423214). Used for chlorthalidone and metolazone too: ASSUMPTION, no drug-specific figure is sourced. */
const THIAZIDE_ADDON_WEIGHT_KG = 1.1;
/** CLOROTIC: worsening renal function 46.5% vs 17.2% (P < 0.001): absolute excess 0.29. */
const THIAZIDE_WRF_EXCESS = 0.29;

/** Added to every loop entry: loop response falls at low eGFR (direction supported by labels and reviews; no multiplier is sourced, so none is applied). */
const LOOP_LOW_EGFR_ITEM = {
    test: 'Loop diuretic response in advanced CKD',
    timing: 'Daily weights and urine output; reassess within days of a dose change',
    details: 'With eGFR below 30 less loop diuretic reaches the nephron, so higher doses are usually needed to reach the effective dose (torsemide and Furoscix labels; open-access reviews). This tool does not scale the effect by eGFR (no sourced multiplier): a dose that looks adequate on paper may under-diurese, so up-titrate to the observed weight response.',
    when: (p: Patient) => p.egfr > 0 && p.egfr < 30,
};

export const MEDICATION_FORMULARY: Medication[] = [
    // ========================================
    // PILLAR 1: ARNI / ACEi / ARB
    // Evidence: PARADIGM-HF, PROVE-HF, SOLVD
    // Impact: High Structure (Reverse Remodeling), High Neurohormonal, Mild Volume.
    // ========================================
    {
        name: 'Sacubitril/Valsartan (Entresto)',
        drug_class: 'ARNI',
        facts: { pick_distinctness_key: 'ARNI', start_dose_exact: true },
        // Label start (exact, not a ceiling): 49/51 mg bid, halved to 24/26 mg bid when not on an ACEi/ARB or on a low dose, eGFR < 30 or
        // Child-Pugh B (Entresto label 2.2, 2.7, 2.8). 97/103 mg is reached only by up-titration. See raasStart.ts.
        start_dose_for: arniStartDose,
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
        // Display only. PARADIGM-HF adverse-event table (Entresto label 6.1, vs enalapril): hypotension 18% (12%),
        // hyperkalemia 12% (14%), cough 9% (13%). Angioedema is the label's rare-but-serious risk (not re-verified).
        side_effects: () => ({ hypotension: 0.18, angioedema: 0.005, hyperkalemia: 0.12, cough: 0.09 }),
        ...ci([
            CI_ANGIOEDEMA,
            CI_POTASSIUM_GT_5_4, // Higher cutoff due to binder logic
            pregnancyCheck(BOXED_FETAL_TOXICITY),
            CI_BILATERAL_RAS, // bilateral RAS = absolute CI
            CI_ALISKIREN_DIABETES, // Entresto label section 4
            // Child-Pugh B: reduced start (24/26) plus caution, NOT excluded (label 2.8). Child-Pugh C: not recommended / not
            // studied. The general "B/C" option cannot say which, so it stays excluded; the "B confirmed (not C)" option
            // (read together with it, or alone) lifts the exclusion and halves the start dose (raasStart.ts).
            { reason: 'Liver disease, Child-Pugh B/C with severity not specified: not recommended in Child-Pugh C (not studied); if the patient is Child-Pugh B, select "Child-Pugh B confirmed (not C)" to allow a reduced start',
              when: p => hasChildPughBorC(p) && !hasChildPughBConfirmed(p) },
        ]),
        renal_adjustment: (egfr) => egfr < 30 ? { start_dose_modifier: 0.5, caution: true } : {},
    },
    {
        name: 'Lisinopril',
        drug_class: 'ACEi',
        // New starts begin at the lowest tier (Zestril HF label start 5 mg, 2022 Table 14 start 2.5-5 mg; 2.5 mg when
        // CrCl 10-30). Titration to 40 mg/day is allowed at any renal function. "Low dose" for the ARNI conversion
        // rule: <= 10 mg/day (judgment: enalapril 10 mg/day is the label's reference; see raasStart.ts).
        facts: { low_dose_max_daily_mg: 10 },
        start_dose_for: () => 2.5,
        available_doses: [
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
            { strength: 30, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true }, // Zestril 30 mg tablet; inside the 20-40 mg target range
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
        ...ci([CI_ANGIOEDEMA, CI_POTASSIUM_GT_5_4, pregnancyCheck(BOXED_FETAL_TOXICITY), CI_BILATERAL_RAS, CI_ALISKIREN_DIABETES]),
        // Zestril label 2.4: no adjustment for CrCl above 30; CrCl 10-30 halve the initial dose (HF 2.5 mg), then titrate
        // as tolerated to 40 mg/day. No maximum-dose cap (the old 10 mg / 20 mg caps were stricter than the label).
        renal_adjustment: (egfr) => egfr < 30 ? { start_dose_modifier: 0.5, caution: true } : {},
    },
    {
        name: 'Enalapril',
        drug_class: 'ACEi',
        // New starts begin at 2.5 mg bid (Vasotec HF label; 2.5 mg daily first when creatinine > 1.6 or Na < 130).
        // "Low dose" for the ARNI conversion rule: <= 10 mg/day (the Entresto label's enalapril reference).
        facts: { low_dose_max_daily_mg: 10 },
        start_dose_for: () => 2.5,
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
        ...ci([CI_ANGIOEDEMA, CI_POTASSIUM_GT_5_4, pregnancyCheck(BOXED_FETAL_TOXICITY), CI_BILATERAL_RAS, CI_ALISKIREN_DIABETES]),
        // Vasotec label: HF with serum creatinine > 1.6 mg/dL or Na < 130 starts at 2.5 mg, then titrates (>= 4-day steps) to
        // a maximum of 40 mg/day. No maximum-dose cap (the old 5 mg / 10 mg caps were stricter than the label).
        renal_adjustment: (egfr) => egfr < 30 ? { start_dose_modifier: 0.5, caution: true } : {},
    },
    {
        name: 'Ramipril',
        drug_class: 'ACEi',
        // New starts begin at 1.25 mg (2022 Table 14: start 1.25-2.5 mg daily). "Low dose" for the ARNI conversion rule:
        // <= 5 mg/day (judgment: the dose-equivalent of the enalapril 10 mg/day reference; see raasStart.ts).
        facts: {
            low_dose_max_daily_mg: 5,
            regimen_warnings: [
                { text: 'Drug note: the ramipril label heart-failure regimen (post-MI) is 2.5 mg bid, then 5 mg bid (10 mg/day, the guideline target). Effects are modeled from the per-dose strength, so a twice-daily regimen reads as the single-dose strength.' },
            ],
        },
        start_dose_for: () => 1.25,
        available_doses: [
            { strength: 1.25, unit: 'mg', formulation: 'capsule', frequency_options: ['qd'] }, // Starting dose
            { strength: 2.5, unit: 'mg', formulation: 'capsule', frequency_options: ['qd', 'bid'] }, // bid = label post-MI HF regimen
            { strength: 5, unit: 'mg', formulation: 'capsule', frequency_options: ['qd', 'bid'] }, // 5 mg bid = label target (10 mg/day)
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
        ...ci([CI_ANGIOEDEMA, CI_POTASSIUM_GT_5_4, pregnancyCheck(BOXED_FETAL_TOXICITY), CI_BILATERAL_RAS, CI_ALISKIREN_DIABETES]),
        // Kept as is (verified-raas.md R2): label HF with CrCl < 40 starts 1.25 mg and caps at 5 mg/day; the 2.5 mg cap at
        // eGFR < 30 is stricter than the label and is retained as the conservative reading.
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 2.5, caution: true };
            if (egfr < 45) return { max_dose: 5, caution: true };
            return {};
        },
    },
    {
        name: 'Captopril',
        drug_class: 'ACEi',
        // New starts begin at 6.25 mg tid (2022 Table 14). "Low dose" for the ARNI conversion rule: <= 75 mg/day
        // (judgment: the dose-equivalent of the enalapril 10 mg/day reference; see raasStart.ts).
        facts: { low_dose_max_daily_mg: 75 },
        start_dose_for: () => 6.25,
        available_doses: [
            { strength: 6.25, unit: 'mg', formulation: 'tablet', frequency_options: ['tid'] }, // Starting dose
            { strength: 12.5, unit: 'mg', formulation: 'tablet', frequency_options: ['tid'] }, // label start in diuretic-treated / hyponatremic patients
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
        ...ci([CI_ANGIOEDEMA, CI_POTASSIUM_GT_5_4, pregnancyCheck(BOXED_FETAL_TOXICITY), CI_BILATERAL_RAS, CI_ALISKIREN_DIABETES]),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 6.25, caution: true };
            if (egfr < 45) return { max_dose: 25, caution: true };
            return {};
        },
    },
    {
        name: 'Valsartan',
        drug_class: 'ARB',
        // New starts begin at 40 mg bid (Diovan HF label). "Low dose" for the ARNI conversion rule: <= 160 mg/day
        // (the Entresto label's valsartan reference).
        facts: { low_dose_max_daily_mg: 160 },
        start_dose_for: () => 40,
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
        ...ci([CI_POTASSIUM_GT_5_4, pregnancyCheck(BOXED_FETAL_TOXICITY), CI_BILATERAL_RAS, CI_ALISKIREN_DIABETES]),
        // Kept (verified-raas.md V2): Diovan label has no adjustment for GFR 30-90 and no data below 30; the 80 mg cap is conservative.
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 80, caution: true };
            return {};
        },
    },
    {
        name: 'Candesartan',
        drug_class: 'ARB',
        // New starts begin at 4 mg daily (Atacand HF label). "Low dose" for the ARNI conversion rule: <= 16 mg/day
        // (judgment: the dose-equivalent of valsartan 160 mg/day; see raasStart.ts).
        facts: { low_dose_max_daily_mg: 16 },
        start_dose_for: () => 4,
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
        ...ci([CI_POTASSIUM_GT_5_4, pregnancyCheck(BOXED_FETAL_TOXICITY), CI_BILATERAL_RAS, CI_ALISKIREN_DIABETES]),
        // Atacand HF dosing has no renal-specific adjustment (start low under close supervision if volume-depleted or renally
        // impaired). No maximum-dose cap (the old 8 mg cap at eGFR < 30 was stricter than the label); caution text only.
        renal_adjustment: (egfr) => egfr < 30 ? { caution: true } : {},
    },
    {
        name: 'Losartan',
        drug_class: 'ARB',
        // New starts begin at 25 mg (2022 Table 14: start 25-50 mg). "Low dose" for the ARNI conversion rule: <= 50 mg/day
        // (judgment: the dose-equivalent of valsartan 160 mg/day; see raasStart.ts).
        facts: {
            low_dose_max_daily_mg: 50,
            regimen_warnings: [
                { text: 'Drug note: losartan has no FDA-labeled heart-failure indication (label: hypertension, stroke-risk reduction with LVH, diabetic nephropathy); its use in HFrEF is guideline-supported (2022 AHA/ACC/HFSA Table 14, target 50-150 mg daily; HEAAL tested 150 mg). 150 mg is taken as two tablets (100 mg + 50 mg).' },
            ],
        },
        start_dose_for: () => 25,
        available_doses: [
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            // 2022 AHA/ACC/HFSA Table 14 target: 50-150 mg daily. Per verified-raas.md LO1 both 100 and 150 mg are flagged;
            // 50 mg (inside the range) is deliberately not flagged: the verified correction lists only 100 and 150.
            { strength: 100, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true },
            { strength: 150, unit: 'mg', formulation: 'two tablets (100 mg + 50 mg)', frequency_options: ['qd'], is_target_dose: true }, // no 150 mg tablet exists (Cozaar: 25/50/100); HEAAL dose
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
        ...ci([CI_POTASSIUM_GT_5_4, pregnancyCheck(BOXED_FETAL_TOXICITY), CI_BILATERAL_RAS, CI_ALISKIREN_DIABETES]),
        // Cozaar label 8.6: no dose adjustment for renal impairment. No cap (the old 50 mg cap was stricter than the label); caution text only.
        renal_adjustment: (egfr) => egfr < 30 ? { caution: true } : {},
    },

    // ========================================
    // PILLAR 2: BETA BLOCKERS
    // Evidence: MERIT-HF, COPERNICUS, CIBIS-II
    // Impact: Maximum Structure (LVEF), No Volume effect.
    // ========================================
    {
        name: 'Carvedilol',
        drug_class: 'Beta Blocker',
        // Label (heart failure): start 3.125 mg twice daily; double no sooner than every 2 weeks.
        start_dose_for: () => 3.125,
        facts: {
            nonselective_beta_blocker: true, hepatically_metabolized: true,
            // Coreg label sec 2.1 and 5.2: "reduce the dose if heart rate is less than 55 beats per minute" (sourced). No
            // up-titration below 60 bpm is ENGINE POLICY (no label number). Established therapy is reduced one step, never stopped at a rate.
            hr_continuation: { reduce_below: 55, no_uptitration_below: 60, basis: 'Coreg label: reduce the dose if heart rate is below 55; no up-titration below 60 is this tool\'s policy' },
        },
        // ACC/AHA target: 25 mg BID for <= 85 kg dry weight, 50 mg BID above (the label calls 50 mg BID the maximum
        // ADMINISTERED to patients over 85 kg; the weight-based target is from the guideline, secondary source).
        is_target_dose_for: (strength, patient) => patient.volume_status.dry_weight_kg > 85 ? strength >= 50 : strength >= 25,
        // is_best_in_class removed: the three beta-blockers are modeled as equal at target (verified-rate-control.md); no verified source ranks one above the others.
        available_doses: [
            { strength: 3.125, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: 6.25, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: 12.5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'] },
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true },
        ],
        chf_effects: (dose) => {
            // Efficacy is credited up to 25 mg BID only: MOCHA (6.25/12.5/25 mg BID) is the dose-response data and 25 mg BID was
            // its top dose; nothing supports extra benefit at 50 mg BID (still the label maximum for > 85 kg), so the ratio is
            // clamped at 1. The BP and heart-rate effects below stay dose-related.
            // EQUALIZED with metoprolol succinate and bisoprolol at the target dose (verified-rate-control.md row 5: COMET
            // compared carvedilol with metoprolol TARTRATE and found no benefit over succinate or bisoprolol): LVEF +9, NT-proBNP
            // -22%, KCCQ +6, LVEDD -10%, structure 35. The MOCHA-fitted dose shape (62% of the target effect at 6.25 mg BID) is kept.
            const d = Number(dose);
            const ratio = Math.min(d / 25, 1);
            const shape = (floor: number) => floor + (1 - floor) * ratio;
            return {
                lvef_improvement_absolute: 9 * shape(0.5),
                bnp_reduction_percent: 0.22 * shape(0.4),
                weight_reduction_kg: 0, // Neutral volume effect
                kccq_improvement: 2 + (ratio * 4),
                structure_benefit_points: 35,
                lavi_reduction_percent: 0.02,
                lvedd_reduction_percent: 0.10 * shape(2 / 3)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 5 + Number(dose)/5, hr_drop: 8 + Number(dose)/3, potassium_change: 0.05 }),
        side_effects: () => ({ bradycardia: 0.10, fatigue: 0.15, hypotension: 0.10, fluid_retention_transient: 0.05 }),
        ...ci([
            bbStartBradycardiaCheck('Carvedilol'),
            CI_SICK_SINUS_NO_PACEMAKER,
            CI_AV_BLOCK_2,
            CI_AV_BLOCK_3,
            CI_SEVERE_ASTHMA,
            { reason: 'Mild/moderate asthma (non-selective beta-blocker; use a beta-1-selective agent instead)', when: p => p.comorbidities.has("Asthma (Mild/Moderate)") }, // Non-selective β: avoid in ANY asthma; use β1-selective instead
            // Coreg label: contraindicated in SEVERE hepatic impairment (no Child-Pugh class named); Child-Pugh B confirmed is allowed with a caution.
            CI_SEVERE_HEPATIC_UNSPECIFIED('carvedilol'),
        ]),
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
        // Label (heart failure): start 25 mg daily in NYHA class II, 12.5 mg daily in more severe heart failure.
        start_dose_for: (p) => (p.nyha_class === 'III' || p.nyha_class === 'IV' ? 12.5 : 25),
        facts: {
            beta1_selective: true, hepatically_metabolized: true,
            // Toprol-XL/generic label: "if patients experience symptomatic bradycardia, reduce the dose" (no number). Below 55 bpm as the
            // trigger (same as carvedilol's labeled number) and no up-titration below 60 are ENGINE POLICY.
            hr_continuation: { reduce_below: 55, no_uptitration_below: 60, basis: 'metoprolol label: reduce the dose for symptomatic bradycardia (no number); below 55 and no up-titration below 60 are this tool\'s policy' },
        },
        // is_best_in_class removed: the three beta-blockers are modeled as equal at target (verified-rate-control.md); no verified source ranks one above the others.
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
                bnp_reduction_percent: 0.10 + (ratio * 0.12), // -22% at target: equalized with carvedilol and bisoprolol (was -20%; no head-to-head superiority evidence)
                weight_reduction_kg: 0,
                kccq_improvement: 3 + (ratio * 3),
                structure_benefit_points: 35,
                lavi_reduction_percent: 0.02,
                lvedd_reduction_percent: 0.07 + (ratio * 0.03) // 7-10% (MERIT-HF)
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 3 + Number(dose)/50, hr_drop: 8 + Number(dose)/20, potassium_change: 0 }),
        side_effects: () => ({ bradycardia: 0.10, fatigue: 0.10 }),
        // No hepatic contraindication: the label (8.6) has no hepatic-impairment studies and says to consider a low initial dose and
        // increase gradually. The hepatic caution warning (effects.ts, via facts.hepatically_metabolized) covers it.
        ...ci([
            bbStartBradycardiaCheck('Metoprolol Succinate'),
            CI_SICK_SINUS_NO_PACEMAKER,
            CI_AV_BLOCK_2,
            CI_AV_BLOCK_3,
            CI_SEVERE_ASTHMA,
        ]),
    },

    {
        name: 'Bisoprolol',
        drug_class: 'Beta Blocker',
        // CIBIS-II started at 1.25 mg; the lowest US tablet-derived tier here is 2.5 mg (half a scored 5 mg tablet).
        start_dose_for: () => 2.5,
        facts: {
            beta1_selective: true, most_cardioselective: true,
            // The US label gives no heart-rate number ("marked sinus bradycardia" is a contraindication). Below 55 bpm as the reduction
            // trigger and no up-titration below 60 are ENGINE POLICY, matched to the other two beta-blockers.
            hr_continuation: { reduce_below: 55, no_uptitration_below: 60, basis: 'bisoprolol US label gives no heart-rate number; below 55 and no up-titration below 60 are this tool\'s policy' },
            regimen_warnings: [
                { text: 'Drug note: the US bisoprolol label is for hypertension only and lists overt cardiac failure as a contraindication, so heart-failure use is off-label (guideline-supported: CIBIS-II, target 10 mg daily). US single-agent tablets are 5 mg and 10 mg; 2.5 mg is half of a scored 5 mg tablet, and the CIBIS-II 1.25 mg starting dose is not obtainable (a quarter tablet is impractical).' },
            ],
        },
        // US single-agent strengths are 5 mg and 10 mg (Sun label; PD-Rx repackages 10 mg). 2.5 mg is kept as half of the scored 5 mg
        // tablet; the CIBIS-II 1.25 mg start (a quarter tablet, a non-US strength) is dropped (verified-rate-control.md row 9).
        available_doses: [
            { strength: 2.5, unit: 'mg', formulation: 'half of a scored 5 mg tablet', frequency_options: ['qd'] },
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
        ...ci([
            bbStartBradycardiaCheck('Bisoprolol'),
            CI_SICK_SINUS_NO_PACEMAKER, // label: "marked sinus bradycardia" is a contraindication; extended to sick sinus syndrome like the other two (conservative)
            CI_AV_BLOCK_2,
            CI_AV_BLOCK_3,
            { reason: 'Severe asthma / bronchospasm (all beta-blockers; cardioselectivity lost at higher doses)', when: p => p.comorbidities.has("Severe Asthma / Bronchospasm") }, // All BBs CI in severe asthma (ACC/AHA); cardioselectivity lost at higher doses
        ]),
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
        facts: {
            antiandrogenic: true,
            // Aldactone label: no numeric potassium rule for a patient already on it beyond "decrease the dose or
            // discontinue". The eplerenone and finerenone labels give 5.5-5.9 = reduce one step, >= 6.0 = withhold;
            // applied here BY ANALOGY (flagged). The code's old removal threshold was K+ > 5.5; the label rule
            // starts at 5.5 inclusive, which is the stricter, so it is used.
            k_continuation: { reduce_at: 5.5, withhold_at: 6.0, basis: 'Eplerenone/finerenone label rule applied to spironolactone by analogy (the Aldactone label gives no numeric rule)' },
            monitoring_items: [{
                test: 'Spironolactone starting dose (eGFR 30-50)',
                timing: 'At initiation',
                details: 'Label: start 25 mg daily only if eGFR is above 50. For eGFR 30-50 the label suggests 25 mg every other day; this tool models that as the 12.5 mg daily tier. If hyperkalemia develops on 25 mg daily, go to 25 mg every other day.',
                when: p => p.egfr >= 30 && p.egfr <= 50,
            }],
        },
        // Aldactone label (HF): start 25 mg daily if K+ <= 5.0 and eGFR > 50; eGFR 30-50 -> 25 mg every other day,
        // modeled as the 12.5 mg daily tier. New starts never begin above it; titration of an existing dose is unaffected.
        start_dose_for: (p) => (p.egfr > 50 ? 25 : 12.5),
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
        // Gynecomastia ~10% of men at the RALES mean dose of 26 mg (label ~9%), dose-related (Aldactone label).
        // The label gives no slope: square-root scaling about the 25 mg anchor is a modeling choice (~7% at 12.5, ~14% at 50).
        side_effects: (dose) => ({ hyperkalemia: 0.15, gynecomastia: 0.10 * Math.sqrt(Number(dose) / 25), renal_worsening: 0.05 }),
        ...ci([
            // New starts above 5.5 are never offered; 5.0-5.5 only with a binder (E15 + DIAMOND pathway). Continuation is
            // handled by facts.k_continuation (reduce 5.5-5.9) and the withhold check below (>= 6.0).
            mraStartPotassiumCheck('Spironolactone'),
            CI_MRA_WITHHOLD_K6,
            { reason: 'eGFR below 30', when: p => p.egfr < 30 },
            CI_ADRENAL_INSUFFICIENCY, // Aldactone label contraindication: Addison's disease
            // The Aldactone label gives no letter pregnancy category (the old "Category X" comment was unsupported):
            // it says spironolactone may affect male sex differentiation and advises avoiding it in pregnancy.
            pregnancyCheck('label advises avoiding it in pregnancy; may affect male sex differentiation'),
        ]),
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
        // Label (heart failure): start 25 mg daily.
        start_dose_for: () => 25,
        // Inspra label (HF): K+ 5.5-5.9 decrease dose (withhold if already at the lowest dose), >= 6.0 withhold.
        // The old code removed at K+ > 5.5; the label rule starts at 5.5 inclusive (stricter), so it is used.
        facts: { k_continuation: { reduce_at: 5.5, withhold_at: 6.0, basis: 'Inspra label' } },
        // Inspra label: with a moderate CYP3A inhibitor do not exceed 25 mg once daily (HF).
        interaction_dose_cap: (p) => moderateCyp3aInhibitor(p)
            ? { max_dose: 25, reason: 'moderate CYP3A inhibitor (label maximum 25 mg daily)' } : null,
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
        ...ci([
            // Inspra label: K+ > 5.5 at initiation is a contraindication (label allows a start up to 5.5; the guideline
            // says 5.0, so the engine adds a binder from 5.0). Continuation: facts.k_continuation + the >= 6.0 check.
            mraStartPotassiumCheck('Eplerenone'),
            CI_MRA_WITHHOLD_K6,
            // Inspra label: contraindicated at CrCl <= 30 mL/min (boundary inclusive; eGFR used as the proxy).
            { reason: 'eGFR 30 or below (label: CrCl 30 mL/min or less)', when: p => p.egfr <= 30 },
            CI_STRONG_CYP3A,
            pregnancyCheck('Category X'), // pregnancy Category X
        ]),
        renal_adjustment: (egfr) => {
            if (egfr <= 30) return { contraindicated: true };
            if (egfr <= 45) return { max_dose: 25, caution: true }; // 45/50 cap not source-verified; left unchanged
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
        facts: {
            cirrhosis_cyp3a4_caution: true,
            // Kerendia label (HF), by K+: 10 mg: 5.5-5.9 withhold; >= 6.0 withhold. 20/40 mg: 5.5-5.9 decrease one step
            // (40 -> 20, 20 -> 10); >= 6.0 withhold. Restart 10 mg once K+ is below 5.5 (below 5.0 if recurrent).
            k_continuation: { reduce_at: 5.5, withhold_at: 6.0, basis: 'Kerendia label' },
            regimen_warnings: [{
                text: 'Drug note: a moderate CYP3A4 inhibitor (verapamil, diltiazem, erythromycin, fluconazole) raises finerenone exposure (erythromycin +248%, verapamil +170%). No fixed dose cap: check potassium and adjust the dose. Avoid grapefruit juice.',
                when: moderateCyp3aInhibitor,
            }],
        },
        // Kerendia HF label: start 20 mg if eGFR >= 60, 10 mg if eGFR 25 to < 60; target 40 mg (eGFR >= 60) or 20 mg
        // (eGFR 25 to < 60); do not start below eGFR 25. No static is_target_dose flag: the target depends on eGFR.
        is_target_dose_for: (strength, patient) => strength === (patient.egfr >= 60 ? 40 : 20),
        start_dose_for: (patient) => (patient.egfr >= 60 ? 20 : 10),
        available_doses: [
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // Starting dose; eGFR-dependent
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 40, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // HF target only when eGFR >= 60 (see is_target_dose_for)
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
        ...ci([
            // FINEARTS-HF enrolled LVEF ≥ 40 only; no evidence for HFrEF
            // HFimpEF (previous LVEF ≤ 40) is managed as HFrEF — use steroidal MRA instead
            // Liver Disease (Child-Pugh B/C): CYP3A4 substrate, reduced clearance in cirrhosis
            { reason: 'LVEF below 40 (FINEARTS-HF enrolled LVEF 40 or higher only; no evidence for HFrEF)', when: p => p.lvef < 40 },
            { reason: 'HFimpEF (previous LVEF 40 or lower) is managed as HFrEF; use a steroidal MRA instead', when: p => p.lvef > 40 && hasHistoricalHFrEF(p) },
            {
                reason: 'On HFrEF therapy with no documented prior EF; managed as possible HFimpEF (initiation only)',
                when: p => {
            // The UNKNOWN-history HFimpEF presumption (conservative: on RAAS/BB/MRA with no
            // documented prior EF → manage as possible HFimpEF) gates INITIATION only. A patient
            // already ON and tolerating finerenone must not have it force-removed on a mere
            // presumption — that dropped the entire MRA pillar when gynecomastia barred the
            // steroidal alternatives (red-team probe 2). DOCUMENTED prior LVEF ≤ 40 (isHFimpEF)
            // still applies to continuation; K+/eGFR/pregnancy/hepatic safety gates always apply.
            const alreadyOnFinerenone = p.current_regimen?.some(r => r.med.drug_class === 'nsMRA');
            return !alreadyOnFinerenone && p.lvef > 40 && shouldPreserveHFrEFTherapyForUnknownHistory(p);
                },
            },
            // New starts above 5.5 are never offered (label: do not initiate above 5.0; the engine starts at 5.0-5.5 only
            // with a binder, E15). Continuation: facts.k_continuation + the >= 6.0 withhold check.
            mraStartPotassiumCheck('Finerenone (Kerendia)'),
            CI_MRA_WITHHOLD_K6,
            { reason: 'eGFR below 25', when: p => p.egfr < 25 },
            CI_STRONG_CYP3A, // Kerendia label contraindication (strong CYP3A4 inhibitors)
            CI_ADRENAL_INSUFFICIENCY, // Kerendia label contraindication
            pregnancyCheck(),
            { reason: 'Liver disease, Child-Pugh B/C (CYP3A4 substrate; reduced clearance in cirrhosis)', when: hasChildPughBorC },
        ]),
        renal_adjustment: (egfr) => {
            // Kerendia HF dosing: maximum 20 mg qd if eGFR 25-59, 40 mg qd if eGFR >= 60; contraindicated below 25.
            // The start tier (10 / 20 mg) comes from start_dose_for.
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
            // PLACEBO-ADJUSTED KCCQ: DAPA-HF TSS +2.8, CSS +2.5, OSS +2.3; DELIVER OSS +2.1; DETERMINE TSS 4.2 / 3.2; 2.5 is the verified
            // midpoint (range 2.1-2.8; never above 3). Was 6, a 2-3x overstatement (verified-sglt2-glp1-adjuncts.md row 1). HFrEF figure applied
            // to every phenotype (chf_effects has no patient; the HFmrEF/HFpEF value of about 1.5 is not modeled).
            kccq_improvement: 2.5,
            structure_benefit_points: 15,
            lavi_reduction_percent: 0.15, // Significant volume unloading of LA (NOT VERIFIED: no echo source opened; unchanged)
            lvedd_reduction_percent: 0.03 // 3% (DAPA-HF)
        }),
        hemodynamic_effects: () => ({ sbp_drop: 3, hr_drop: 0, potassium_change: 0 }),
        side_effects: () => ({ genital_infection: 0.05, uti: 0.03, volume_depletion: 0.02 }),
        special_features: [
            { feature: 'Preferred in Diabetics', points: 10, criteria: (p) => p.comorbidities.has("Diabetes Mellitus Type 2") }
        ],
        ...ci([
            // eGFR threshold applies to INITIATION only — continuation allowed (DAPA-CKD)
            // Farxiga label 2.3: initiation not recommended below eGFR 25 for the HF/CKD indications; may continue 10 mg if eGFR falls below 25.
            {
                reason: 'eGFR below 25: initiation not recommended (Farxiga label); continuation is allowed',
                when: p => !p.current_regimen?.some(r => r.med.drug_class === 'SGLT2i') && p.egfr < 25,
            },
            pregnancyCheck(),
            CI_TYPE1_OR_DKA,
        ]),
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
            // PLACEBO-ADJUSTED KCCQ-CSS: EMPEROR-Reduced +1.2 to +2.9 by tertile/time point; EMPEROR-Preserved +1.0/+1.2/+1.5 at 12/32/52 wk.
            // 2.0 for HFrEF per verified-sglt2-glp1-adjuncts.md row 2 (HFmrEF/HFpEF about 1.5 is not modeled). Dapagliflozin carries 2.5 from
            // its own trials; the 0.5 gap is two different trials' figures, not evidence that one drug is better.
            kccq_improvement: 2.0,
            structure_benefit_points: 15,
            lavi_reduction_percent: 0.15,
            lvedd_reduction_percent: 0.03 // 3% (EMPEROR-Reduced)
        }),
        hemodynamic_effects: () => ({ sbp_drop: 3, hr_drop: 0, potassium_change: 0 }),
        // The Jardiance label carries the same volume-depletion warning as Farxiga (row 6), so the entry lists it too.
        side_effects: () => ({ genital_infection: 0.05, uti: 0.03, volume_depletion: 0.02 }),
        special_features: [
            { feature: 'Preferred in Diabetics', points: 10, criteria: (p) => p.comorbidities.has("Diabetes Mellitus Type 2") }
        ],
        ...ci([
            // eGFR threshold applies to INITIATION only — continuation allowed (EMPA-KIDNEY). The Jardiance HF dose (10 mg) has no eGFR
            // condition in the label; EMPEROR-Reduced, EMPEROR-Preserved and EMPA-KIDNEY enrolled eGFR >= 20 and no patient with eGFR < 20
            // or on dialysis was studied, so initiation is blocked below 20 (dapagliflozin stays at 25: its label says so).
            {
                reason: 'eGFR below 20: initiation not studied (EMPEROR and EMPA-KIDNEY enrolled eGFR 20 or higher); continuation is allowed',
                when: p => !p.current_regimen?.some(r => r.med.drug_class === 'SGLT2i') && p.egfr < 20,
            },
            pregnancyCheck(),
            CI_TYPE1_OR_DKA,
        ]),
    },

    // ========================================
    // PHENOTYPE: OBESITY / METABOLIC (GLP-1 / GIP)
    // Evidence: STEP-HFpEF, STEP-HFpEF DM, SUMMIT (verified-sglt2-glp1-adjuncts.md, 2026-11-10).
    // Every effect below is the PLACEBO-ADJUSTED treatment effect at the maintenance dose, not the within-arm change.
    // ========================================
    {
        name: 'Semaglutide (Wegovy)',
        drug_class: 'GLP-1 RA',
        facts: {
            // Wegovy label Table 1: 0.25 mg weeks 1-4, 0.5 mg weeks 5-8, 1 mg weeks 9-12, 1.7 mg weeks 13-16, then maintenance 2.4 mg (1.7 mg is
            // also a labeled maintenance dose). New starts begin at 0.25 mg; titration moves ONE tier, at least 4 weeks per step.
            titrate_one_step: true,
            start_dose_exact: true,
            // STEP-HFpEF DM vs STEP-HFpEF: KCCQ-CSS difference 7.3 vs 7.8 (ratio 0.936); weight difference -6.4 vs -10.7 points (ratio 0.598).
            t2dm_scale: { weight: 6.4 / 10.7, kccq: 7.3 / 7.8, basis: 'STEP-HFpEF DM (PMID 38587233) versus STEP-HFpEF (PMID 37622681)' },
            regimen_warnings: [
                { text: 'Drug note: semaglutide titration is one labeled step at a time (0.25, 0.5, 1.0, 1.7, then 2.4 mg weekly), at least 4 weeks per step; escalation can be delayed 4 weeks for tolerability. 1.7 mg is a labeled maintenance dose, 2.4 mg is the dose studied in STEP-HFpEF (injection only; the oral tablets have no heart-failure data).' },
                { text: 'Drug note: Wegovy warnings: acute pancreatitis (not recommended to restart after pancreatitis; ask about history), gallbladder disease, and worsening of diabetic retinopathy (a larger absolute risk when retinopathy is present at baseline: 8.2% vs 5.2%).',
                  when: p => p.comorbidities.has('History of Pancreatitis') || p.comorbidities.has('Diabetic Retinopathy') },
                { text: 'Drug note: severe gastroparesis: GLP-1 receptor agonists slow gastric emptying and are not recommended in severe gastroparesis (Zepbound label; class caution).',
                  when: p => p.comorbidities.has('Severe Gastroparesis') },
                { text: 'Drug note: GI losses (nausea, vomiting, diarrhea) on a GLP-1 can cause volume depletion and acute kidney injury; with an SGLT2 inhibitor and a loop diuretic on board, counsel on fluids and consider reducing the diuretic if intake falls (Zepbound label; class caution).',
                  when: (_p, regimen) => regimen.some(r => r.med.drug_class === 'SGLT2i') && regimen.some(r => r.med.drug_class === 'Loop Diuretic') },
            ],
        },
        // The start tier: lowest labeled step (exact: a new start never begins higher).
        start_dose_for: () => 0.25,
        available_doses: [
             { strength: 0.25, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] }, // Weeks 1-4 (start)
             { strength: 0.5, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] },  // Weeks 5-8
             { strength: 1.0, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] },  // Weeks 9-12
             { strength: 1.7, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] },  // Weeks 13-16; a labeled maintenance dose
             { strength: 2.4, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], is_target_dose: true }
        ],
        chf_effects: (dose) => {
             // Dose scaling is the EXISTING linear ratio d/2.4 with a 0.25 floor, kept for the intermediate tiers: the semaglutide 1.0 mg
             // fraction of the 2.4 mg effect was NOT verified (STEP 2 gives no 1.0 mg figure; verified row 11), so no saturating map is adopted.
             const ratio = Math.max(0.25, Math.min(1, Number(dose) / 2.4));
             return {
                 lvef_improvement_absolute: 1.0 * ratio, // Indirect benefit (not verified; unchanged)
                 bnp_reduction_percent: 0.20 * ratio, // NOT VERIFIED (STEP-HFpEF NT-proBNP ratio not in the abstract); unchanged
                 weight_reduction_kg: 10.7 * ratio, // display only: percent x 1 kg at a 100 kg reference weight
                 weight_reduction_percent: 10.7 * ratio, // placebo-adjusted: STEP-HFpEF -13.3% vs -2.6% (-6.4 points in type 2 diabetes, t2dm_scale)
                 kccq_improvement: 7.8 * ratio, // placebo-adjusted: STEP-HFpEF KCCQ-CSS +16.6 vs +8.7 (7.3 in type 2 diabetes, t2dm_scale)
                 structure_benefit_points: Math.round(10 * ratio), // Metabolic/Epicardial fat reduction (not verified; unchanged)
                 lavi_reduction_percent: 0.05 * ratio,
                 lvedd_reduction_percent: 0.01 * ratio // Indirect
             };
        },
        hemodynamic_effects: () => ({ sbp_drop: 4, hr_drop: -2, potassium_change: 0 }), // HR can increase slightly
        side_effects: () => ({ nausea: 0.30, diarrhea: 0.20, constipation: 0.15 }),
        special_features: [
             // 40 points for BOTH GLP-1 agents (scale policy: symptom-level benefit with no guideline class sits below a Class 1A mortality
             // benefit; the old 50 / 60 split rested on a cross-trial "superior" claim). Phenotype text matches the initiation gate (LVEF >= 45).
             { feature: 'STEP-HFpEF: improves symptoms and function in obesity-phenotype HFpEF (LVEF 45 or higher, BMI 30 or higher)', points: 40, criteria: (p) => p.bmi >= 30 && p.lvef >= 45 }
        ],
        ...ci([
            // True safety gates — apply to initiation AND continuation:
            pregnancyCheck(),
            CI_MTC_MEN2, // FDA boxed warning: MTC/MEN2
            // BMI >= 30 and LVEF >= 45 are STEP-HFpEF / STEP-HFpEF DM enrollment (INITIATION) gates only — weight-loss or an EF change on a GLP-1
            // must not force its removal (mirrors the SGLT2i alreadyOn* pattern). The Wegovy label has no heart-failure indication and no
            // guideline recommends a GLP-1 in HFpEF (2022 AHA/ACC/HFSA), so these are evidence-tier gates.
            {
                reason: 'BMI below 30 — initiation only (STEP-HFpEF enrollment criterion)',
                when: p => !p.current_regimen?.some(r =>
                    r.med.drug_class === 'GLP-1 RA' || r.med.drug_class === 'GLP-1/GIP RA') && p.bmi < 30,
            },
            {
                reason: 'LVEF below 45 — initiation only (STEP-HFpEF and STEP-HFpEF DM enrolled LVEF 45 or higher; no semaglutide HF trial below 45)',
                when: p => !p.current_regimen?.some(r =>
                    r.med.drug_class === 'GLP-1 RA' || r.med.drug_class === 'GLP-1/GIP RA') && p.lvef < 45,
            },
        ]),
    },
    {
        name: 'Tirzepatide (Zepbound)',
        drug_class: 'GLP-1/GIP RA',
        // is_best_in_class removed: no head-to-head HF trial of tirzepatide vs semaglutide exists (verified-sglt2-glp1-adjuncts.md row 20); both GLP-1 agents are treated alike.
        facts: {
            // Zepbound label: start 2.5 mg weekly x 4 weeks (initiation only, not a maintenance dose), increase in 2.5 mg steps after at least 4
            // weeks; maintenance 5, 10 or 15 mg; maximum 15 mg.
            titrate_one_step: true,
            start_dose_exact: true,
            // T2DM: SUMMIT arm-level weight change -10.4% (with diabetes) vs -12.9% (without): ratio 0.806. These are arm-level figures, not
            // placebo-adjusted, so the ratio is an approximation. No tirzepatide KCCQ figure by diabetes status was opened (scale 1).
            t2dm_scale: { weight: 10.4 / 12.9, kccq: 1, basis: 'SUMMIT (PMID 40701669 / 40903131); arm-level, ratio is an approximation' },
            // Zepbound KwikPen regular self-pay (Lilly savings page, verified 2026-11-10): 2.5 mg $299, 5 mg $399, 7.5 mg $499, 10/12.5/15 mg $699.
            // (The $449 figure is a savings-card price for 7.5 mg and above, requires a refill within 45 days and expires 12/31/2026; not used.)
            cash_price_by_dose: { '2.5': 299, '5': 399, '7.5': 499, '10': 699, '12.5': 699, '15': 699 },
            regimen_warnings: [
                { text: 'Drug note: tirzepatide titration is one labeled step at a time (2.5 mg increments, at least 4 weeks per step). 2.5 mg is the starting dose only, not a maintenance dose; maintenance is 5, 10 or 15 mg weekly.' },
                { text: 'Drug note: tirzepatide 2.5 mg is an initiation dose, not a maintenance dose (Zepbound label): plan the next step after 4 weeks.',
                  when: (_p, regimen) => regimen.some(r => r.med.drug_class === 'GLP-1/GIP RA' && Number(r.dose.strength) === 2.5) },
                { text: 'Drug note: acute pancreatitis warning (ask about history) and gallbladder disease (Zepbound label).',
                  when: p => p.comorbidities.has('History of Pancreatitis') },
                { text: 'Drug note: severe gastroparesis: tirzepatide is not recommended in severe gastroparesis (Zepbound label).',
                  when: p => p.comorbidities.has('Severe Gastroparesis') },
                { text: 'Drug note: GI losses (nausea, vomiting, diarrhea) on a GLP-1/GIP agonist can cause volume depletion and acute kidney injury (Zepbound label warning); with an SGLT2 inhibitor and a loop diuretic on board, counsel on fluids and consider reducing the diuretic if intake falls.',
                  when: (_p, regimen) => regimen.some(r => r.med.drug_class === 'SGLT2i') && regimen.some(r => r.med.drug_class === 'Loop Diuretic') },
            ],
        },
        start_dose_for: () => 2.5,
        available_doses: [
             { strength: 2.5, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] }, // Weeks 1-4 (start; not a maintenance dose)
             { strength: 5, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] },
             { strength: 7.5, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] },
             { strength: 10, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] },
             { strength: 12.5, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'] },
             { strength: 15, unit: 'mg', formulation: 'SQ Weekly', frequency_options: ['weekly'], is_target_dose: true }
        ],
        chf_effects: (dose) => {
             // SATURATING dose map (fraction of the 15 mg effect), anchored on SURMOUNT-1 weight change (72 weeks): -15.0% (5 mg), -19.5% (10 mg),
             // -20.9% (15 mg), placebo -3.1%: placebo-adjusted 5 mg = 0.67, 10 mg = 0.92 (raw 0.72 / 0.93). SOURCED anchors: 5 mg = 0.70 (inside
             // 0.67-0.72), 10 mg = 0.925 (inside 0.92-0.93), 15 mg = 1. ASSUMPTIONS (no trial value): 7.5 mg 0.81 (monotone midpoint of 5 and 10),
             // 12.5 mg 0.96 (monotone midpoint of 10 and 15), 2.5 mg 0.25 (the previous engine floor; a start dose with no trial value).
             // The same fraction scales every effect field (HF-outcome dose-response is unknown) - also an assumption.
             const FRACTION: Record<string, number> = { '2.5': 0.25, '5': 0.70, '7.5': 0.81, '10': 0.925, '12.5': 0.96, '15': 1 };
             const ratio = FRACTION[String(Number(dose))] ?? Math.max(0.25, Math.min(1, Number(dose) / 15));
             return {
                 lvef_improvement_absolute: 1.5 * ratio, // not verified; unchanged
                 // SUMMIT secondary analysis: NT-proBNP treatment difference at 52 weeks -10.5% (95% CI -20.7 to +1.0, P=0.07): at most 0.10.
                 // (The old 0.25 rested on an hsCRP rationale, which is a non-sequitur for natriuretic peptide.)
                 bnp_reduction_percent: 0.10 * ratio,
                 weight_reduction_kg: 12 * ratio, // display only: percent x 1 kg at a 100 kg reference weight
                 // Placebo-adjusted weight change in SUMMIT by BMI tertile -10.7%, -11.8%, -14.4% (verified): 12 points is the rounded mean (about
                 // -11 to -14). The old comment "15-20% (SUMMIT)" was the SURMOUNT-1 number.
                 weight_reduction_percent: 12 * ratio,
                 kccq_improvement: 6.9 * ratio, // placebo-adjusted: SUMMIT KCCQ-CSS +19.5 vs +12.7, difference 6.9 (95% CI 3.3-10.6)
                 structure_benefit_points: Math.round(15 * ratio), // not verified; unchanged
                 lavi_reduction_percent: 0.08 * ratio,
                 lvedd_reduction_percent: 0.02 * ratio // SUMMIT
             };
        },
        hemodynamic_effects: () => ({ sbp_drop: 6, hr_drop: -2, potassium_change: 0 }),
        side_effects: () => ({ nausea: 0.30, diarrhea: 0.20 }),
        special_features: [
             // 40 points, equal to semaglutide. SUMMIT alone reports an event result (CV death or worsening HF 9.9% vs 15.3%, HR 0.62, 0.41-0.95;
             // worsening-HF events HR 0.54; CV death numerically higher, 8 vs 5), but there is no head-to-head HF trial, so no "superior" claim.
             { feature: 'SUMMIT: fewer HF events and better symptoms in obesity-phenotype HFpEF (LVEF 50 or higher, BMI 30 or higher)', points: 40, criteria: (p) => p.bmi >= 30 && p.lvef >= 50 }
        ],
        ...ci([
            // True safety gates — apply to initiation AND continuation:
            pregnancyCheck(),
            CI_MTC_MEN2, // FDA boxed warning: MTC/MEN2
            // BMI >= 30 and LVEF >= 50 are SUMMIT enrollment (INITIATION) gates only (no tirzepatide trial at LVEF 41-49).
            {
                reason: 'BMI below 30 — initiation only (SUMMIT enrollment criterion)',
                when: p => !p.current_regimen?.some(r =>
                    r.med.drug_class === 'GLP-1 RA' || r.med.drug_class === 'GLP-1/GIP RA') && p.bmi < 30,
            },
            {
                reason: 'LVEF below 50 — initiation only (SUMMIT enrolled LVEF 50 or higher; no tirzepatide trial at LVEF 41-49)',
                when: p => !p.current_regimen?.some(r =>
                    r.med.drug_class === 'GLP-1 RA' || r.med.drug_class === 'GLP-1/GIP RA') && p.lvef < 50,
            },
        ]),
    },

    // ========================================
    // VOLUME MANAGEMENT: Loop Diuretics
    // Evidence: Symptom relief only. No mortality/structure benefit.
    // Impact: High Volume, High Functional. Zero Structure.
    // ========================================
    {
        name: 'Furosemide',
        drug_class: 'Loop Diuretic',
        facts: {
            // TOTAL DAILY dose. 120 mg/day is ENGINE POLICY (no source gives a "high-dose" level; the label only says doses over 80 mg/day for long
            // periods need close monitoring). The label ceiling is 600 mg/day (Furosemide tablets label, DailyMed) = max_daily_dose.
            high_dose_threshold: 120,
            max_daily_dose: 600,
            effects_on_daily_dose: true,
            raises_uric_acid: true, // label: asymptomatic hyperuricemia can occur; gout may rarely be precipitated
            loop_furosemide_equivalent_per_mg: 1,
            monitoring_items: [LOOP_LOW_EGFR_ITEM],
        },
        available_doses: [
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 40, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 80, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid', 'tid'] },
            // 160 mg is not a marketed strength (tablets are 20/40/80): this tier is TWO 80 mg tablets (verified-diuretics.md).
            { strength: 160, unit: 'mg', formulation: '2 x 80 mg tablets', frequency_options: ['bid', 'tid'] },
        ],
        chf_effects: (dose) => {
            // `dose` is the TOTAL DAILY dose (strength x doses per day; effects_on_daily_dose): 40 mg bid is credited as 80 mg/day.
            // Calibrated range tops out at 160 mg/day; a higher daily dose is credited as that ceiling (engine policy: nothing above it is calibrated,
            // and loop natriuresis plateaus), so frequent dosing never inflates the effect past the old top tier.
            const d = Math.min(Number(dose), 160);
            // Log-based ceiling effect calibrated to the documented dose-response anchors:
            // Furosemide: ~1.5kg at 20mg, ~2.4kg at 40mg, ~3.3kg at 80mg, ~4.2kg at 160mg
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
        hemodynamic_effects: (dose) => { const d = Math.min(Number(dose), 160); return { sbp_drop: 2 + d/40, hr_drop: 0, potassium_change: -0.3 - (d/80 * 0.3) }; },
        // Uric-acid caution comes from facts.raises_uric_acid (read by the engine).
        side_effects: () => ({ hypokalemia: 0.20, renal_worsening: 0.10, hypotension: 0.05 }),
        renal_adjustment: (egfr) => {
            if (egfr < 20) return { caution: true };
            return {};
        },
    },
    {
        name: 'Furoscix (SC Furosemide)',
        drug_class: 'Loop Diuretic',
        facts: {
            high_dose_threshold: 80, // mg/day, engine policy (one infusor a day is the label dose)
            max_daily_dose: 80,
            effects_on_daily_dose: true,
            delivery: 'on_body_infusor',
            // Label: "not for chronic use", replace with an oral diuretic as soon as practical. Modeled as a SHORT-COURSE ADD-ON beside an
            // oral loop (never a swap, never a standing replacement); its effect is credited only above the oral loop (effects.ts effectsFor).
            short_course_addon: true,
            // Label bioavailability: on-body infusor 99.6% of IV 80 mg (90% CI 94.8-104.8). Oral furosemide is about 50-64% bioavailable (tablet
            // label 64%; reviews about 50%), so SC/IV is about twice an oral dose (standard 2:1 IV-to-oral conversion): multiplier 2.0
            // (1.56 is the label-derived lower bound). Applied to weight, BNP, KCCQ, SBP and K effects alike. Source: verified-diuretics.md.
            oral_equivalent_multiplier: FUROSCIX_ORAL_EQUIVALENT,
            raises_uric_acid: true,
            monitoring_items: [
                {
                    test: 'Volume status after the Furoscix course',
                    timing: 'Daily weights during the course; reassess at the end of the course (a few days)',
                    details: 'Furoscix is labeled "not for chronic use". Reassess weight, edema and symptoms at the end of the course, then resume or adjust the oral loop diuretic (replace Furoscix with an oral diuretic as soon as practical). Number of days in a course is not set by the label (this tool prices 4 kits per course as an assumption).',
                },
                LOOP_LOW_EGFR_ITEM,
            ],
            regimen_warnings: [
                { text: 'Drug note: Furoscix is a short course beside the oral loop diuretic, not a replacement; the label says "not for chronic use". Plan the return to the oral diuretic when congestion resolves. In significantly reduced renal function the fixed 80 mg dose may be insufficient and additional diuretic may be needed (Furoscix label).' },
            ],
        },
        available_doses: [
            { strength: 80, unit: 'mg/10mL', formulation: 'SQ on-body infusor (5h)', frequency_options: ['qd'] }, // FDA-labeled single dose delivered over 5 hours
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            // Same calibrated furosemide curve applied to the ORAL-EQUIVALENT dose (80 mg SC = 160 mg oral). Calibration ceiling 320 mg oral
            // equivalent (engine policy) so the add-on increment above an oral loop can be credited (effects.ts effectsFor).
            const oralEquivalent = Math.min(d * FUROSCIX_ORAL_EQUIVALENT, 320);
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
            const oralEquivalent = Math.min(Number(dose) * FUROSCIX_ORAL_EQUIVALENT, 320);
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
        ...ci([
            // Reserve for active congestion episodes on an oral loop (label: not for chronic use; contraindications are anuria, furosemide
            // hypersensitivity, and adhesive hypersensitivity for the on-body infusor). CKD is an INDICATION, so there is no eGFR exclusion.
            {
                reason: 'Less than 1 kg above dry weight (reserved for active congestion)',
                when: p => (p.volume_status.current_weight_kg - p.volume_status.dry_weight_kg) < 1.0,
            },
            {
                reason: 'No oral loop diuretic on board (Furoscix is a short-course add-on to an oral loop, labeled "not for chronic use", not a replacement)',
                when: p => !(p.current_regimen || []).some(r => r.med.drug_class === 'Loop Diuretic' && r.med.name !== 'Furoscix (SC Furosemide)'),
            },
            CI_ANURIA,
            {
                reason: 'Documented furosemide / loop diuretic hypersensitivity',
                when: p => Array.from(p.allergies || []).map(a => a.toLowerCase()).some(term =>
                    term.includes('furosemide') || term.includes('furoscix') || term.includes('loop diuretic')
                ),
            },
            {
                reason: 'Documented adhesive / acrylate hypersensitivity',
                when: p => Array.from(p.allergies || []).map(a => a.toLowerCase()).some(term =>
                    term.includes('adhesive') || term.includes('acrylate')
                ),
            },
        ]),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { caution: true };
            return {};
        },
    },
    {
        name: 'Torsemide',
        drug_class: 'Loop Diuretic',
        facts: {
            // TOTAL DAILY dose. 60 mg/day is ENGINE POLICY: it keeps the old furosemide-120 alert level through the code's torsemide:furosemide
            // calibration of about 1:2, which is NOT VERIFIED (the torsemide label states no equivalence). Label: doses above 200 mg/day not studied.
            high_dose_threshold: 60,
            max_daily_dose: 200,
            effects_on_daily_dose: true,
            raises_uric_acid: true, // label: gout may rarely be precipitated
            loop_furosemide_equivalent_per_mg: 2, // engine calibration, NOT VERIFIED (only used to credit a Furoscix add-on above the oral loop)
            monitoring_items: [LOOP_LOW_EGFR_ITEM],
        },
        // No "best in class" badge: TRANSFORM-HF (n=2859) showed no mortality difference vs furosemide (26.1% vs 26.2%, HR 1.02, 95% CI 0.89-1.18).
        available_doses: [
            // Marketed strengths: generic 5/10/20/100 mg; Soaanz 20/40/60 mg (the 50 mg tier was not a US strength). 40 mg is the Soaanz tablet.
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 20, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 40, unit: 'mg', formulation: 'tablet (Soaanz)', frequency_options: ['qd', 'bid'] },
            { strength: 100, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
        ],
        chf_effects: (dose) => {
            // `dose` is the TOTAL DAILY dose; the calibrated range tops out at 100 mg/day (ceiling beyond it, engine policy).
            const d = Math.min(Number(dose), 100);
            // Log-based ceiling calibrated to the documented anchors: better bioavailability
            // than furosemide but same ceiling pharmacology.
            // Torsemide: ~1.8kg at 10mg, ~2.8kg at 20mg, ~3.6kg at 40mg, ~5.0kg at 100mg (the old 50 mg anchor, 4.0 kg, was not a US strength)
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
        hemodynamic_effects: (dose) => { const d = Math.min(Number(dose), 100); return { sbp_drop: 2 + d/20, hr_drop: 0, potassium_change: -0.3 - (d/50 * 0.2) }; },
        // Renal-worsening display risk equalized with furosemide (no source compares the drugs; TRANSFORM-HF showed no outcome difference).
        side_effects: () => ({ hypokalemia: 0.15, renal_worsening: 0.10, hypotension: 0.05 }),
        renal_adjustment: (egfr) => {
            if (egfr < 20) return { caution: true };
            return {};
        },
    },
    {
        name: 'Bumetanide',
        drug_class: 'Loop Diuretic',
        facts: {
            // TOTAL DAILY dose. 3 mg/day = 120 mg furosemide-equivalent (label: 1 mg bumetanide is about 40 mg furosemide); the alert level itself is
            // ENGINE POLICY mirroring furosemide. Label maximum total daily dose 10 mg.
            high_dose_threshold: 3,
            max_daily_dose: 10,
            effects_on_daily_dose: true,
            raises_uric_acid: true, // the bumetanide label names asymptomatic hyperuricemia only (gout not mentioned); kept at the loop-class caution it already carried
            loop_furosemide_equivalent_per_mg: 40,
            monitoring_items: [LOOP_LOW_EGFR_ITEM],
        },
        available_doses: [
            // Tablets are 0.5, 1 and 2 mg. The old 4 mg "tablet" does not exist (4 mg tid would be 12 mg/day, above the label maximum of 10).
            { strength: 0.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 1, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid'] },
            { strength: 2, unit: 'mg', formulation: 'tablet', frequency_options: ['qd', 'bid', 'tid'] },
        ],
        chf_effects: (dose) => {
            // `dose` is the TOTAL DAILY dose; calibrated range tops out at 4 mg/day (= 160 mg furosemide-equivalent), a ceiling beyond it.
            const d = Math.min(Number(dose), 4);
            // 1mg bumetanide ≈ 40mg furosemide (label); same calibrated log ceiling as furosemide
            // applied to the equivalent dose (0.5/1/2/4 mg/day -> ~1.5/2.4/3.3/4.2kg)
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
        hemodynamic_effects: (dose) => { const d = Math.min(Number(dose), 4); return { sbp_drop: 2 + d * 2, hr_drop: 0, potassium_change: -0.3 - (d / 2 * 0.3) }; },
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
        // Label (BiDil): start one tablet (37.5/20 mg) three times daily.
        start_dose_for: () => '37.5/20',
        facts: {
            regimen_warnings: [
                { text: 'Drug note: hydralazine can cause a drug-induced lupus-like syndrome (dose- and acetylator-dependent) and peripheral neuritis (pyridoxine / vitamin B6 is used for prevention or treatment) (BiDil label). Ask about joint pain, fever, rash and numbness or tingling at each visit.' },
                { text: 'Drug note: hydralazine can cause tachycardia and hypotension that may worsen ischemia (BiDil label; hypotension 8% vs 4% in A-HeFT). Titrate from one tablet three times daily to two tablets three times daily over several days as tolerated.' },
            ],
            monitoring_items: [
                { test: 'Lupus-like symptoms and neuropathy screen', timing: 'Each visit while on hydralazine',
                  details: 'Ask about arthralgia, fever, rash, pleuritic pain, numbness or tingling; check an ANA and CBC if symptoms appear; give pyridoxine if neuropathy develops (BiDil label).' },
            ],
        },
        available_doses: [
            { strength: '37.5/20', unit: 'mg', formulation: 'tablet', frequency_options: ['tid'] },
            { strength: '75/40', unit: 'mg', formulation: 'tablet', frequency_options: ['tid'], is_target_dose: true },
        ],
        chf_effects: (dose) => {
            const level = dose === '75/40' ? 2 : 1;
            return {
                lvef_improvement_absolute: 2 + level, // A-HeFT showed remodeling (NOT VERIFIED: no A-HeFT echo data opened; unchanged)
                bnp_reduction_percent: 0.10 + (level * 0.05), // NOT VERIFIED; unchanged
                weight_reduction_kg: 0,
                kccq_improvement: 3 + level,
                structure_benefit_points: 15,
                lavi_reduction_percent: 0.05,
                lvedd_reduction_percent: 0.03 // A-HeFT
            };
        },
        // HR effect is a RISE (hydralazine reflex tachycardia; BiDil label). The +3 bpm magnitude is NOT VERIFIED (the label gives no figure;
        // the review's memory range was +3 to +5, the low end used). SBP -10 magnitude is NOT VERIFIED either; unchanged.
        hemodynamic_effects: () => ({ sbp_drop: 10, hr_drop: -3, potassium_change: 0 }),
        ...ci([
            // Absolute CI: nitrate + PDE5 inhibitor → profound/potentially fatal hypotension (BiDil label lists avanafil, sildenafil, tadalafil, vardenafil).
            // Confirmed exposure is a hard gate; suspected exposure (pulmonary HTN without a
            // documented PDE5i) remains a caution warning in the engine.
            {
                reason: 'Concurrent PDE5 inhibitor (sildenafil / tadalafil / vardenafil / avanafil) — nitrate co-use risks profound, potentially fatal hypotension',
                when: onPde5Inhibitor,
            },
            // BiDil label contraindication: riociguat (soluble guanylate cyclase stimulator) with a nitrate.
            {
                reason: 'Concurrent riociguat (soluble guanylate cyclase stimulator) — labeled contraindication with nitrates',
                when: onOtherSgcStimulator,
            },
        ]),
        special_features: [
            // A-HeFT (self-identified Black patients, NYHA III-IV, HFrEF): 2022 AHA/ACC/HFSA Class 1, LOE A "receiving optimal medical therapy"
            // (A-HeFT background: ACEi/ARB 93%, beta-blocker 87%). Credit needs a RAAS inhibitor and a beta-blocker on board, or documented inability
            // to take them. 60 points = the top of the evidence scale: a mortality benefit (10.2% vs 6.2%, HR 0.57) must not sit below a symptom
            // benefit (verified row 38; the exact value is engine policy, was 30).
            {
                feature: 'A-HeFT: mortality and HF-hospitalization benefit in self-identified Black patients, NYHA III-IV HFrEF, on a RAAS inhibitor and a beta-blocker (Class 1)',
                points: 60,
                criteria: (p, regimen) => isBlackRace(p) && (p.nyha_class === 'III' || p.nyha_class === 'IV') && p.lvef <= 40
                    && ((regimen ?? []).some(r => RAAS_DRUG_CLASSES.includes(r.med.drug_class as typeof RAAS_DRUG_CLASSES[number])) || unableToTakeClasses(p, RAAS_DRUG_CLASSES))
                    && ((regimen ?? []).some(r => r.med.drug_class === 'Beta Blocker') || unableToTakeClasses(p, ['Beta Blocker']))
            }
        ],
        // A-HeFT adverse events (BiDil label Table 1, BiDil vs placebo): headache 50% vs 21%, dizziness 32% vs 14%, hypotension 8% vs 4%.
        side_effects: () => ({ headache: 0.50, dizziness: 0.32, hypotension: 0.08 }),
    },
    {
        name: 'Ivabradine',
        drug_class: 'If Inhibitor',
        facts: {
            // Starting dose (Corlanor label 2.2): 5 mg bid; 2.5 mg bid for a history of conduction defects or others in whom
            // bradycardia could cause hemodynamic compromise (the label does not name the elderly). The start tier is exact.
            start_dose_exact: true,
            // Titration (label): HR above 60 -> up 2.5 mg bid (max 7.5 mg bid); 50-60 -> hold; below 50 or symptoms -> reduce one
            // step, and stop if already at 2.5 mg bid. All three numbers are the label's (pulse is whole bpm, so "above 60" is 61+).
            hr_continuation: { reduce_below: 50, no_uptitration_below: 61, basis: 'Corlanor label: reduce 2.5 mg bid if heart rate is below 50 or symptomatic, stop at 2.5 mg bid; increase only if heart rate is above 60' },
            regimen_warnings: [
                { text: 'DDI WARNING: Ivabradine with verapamil or diltiazem (moderate CYP3A4 inhibitors and negative chronotropes): the Corlanor label says to avoid the combination (higher ivabradine exposure, additive heart-rate lowering).', when: onVerapamilOrDiltiazem },
                { text: 'DDI WARNING: Ivabradine with a CYP3A4 inducer (St John\'s wort, rifampin, barbiturates, phenytoin): the Corlanor label says to avoid it (lower ivabradine exposure, possible loss of effect).', when: onCyp3a4Inducer },
            ],
        },
        start_dose_for: (p) => (p.comorbidities.has(CONDUCTION_DEFECT) || onAmiodarone(p) || (p.current_regimen ?? []).some(r => r.med.drug_class === 'Inotrope')) ? 2.5 : 5,
        // 2.5 mg is half of the scored 5 mg tablet. The label titrates by heart rate, so both 5 and 7.5 mg bid are acceptable
        // maintenance doses (flagged target); 2.5 mg bid is a start/reduction tier. Starting rule above: conduction defect, plus
        // co-therapy with amiodarone or digoxin as ENGINE POLICY for "others in whom bradycardia could cause hemodynamic compromise".
        available_doses: [
            { strength: 2.5, unit: 'mg', formulation: 'half of a scored 5 mg tablet', frequency_options: ['bid'] },
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true },
            { strength: 7.5, unit: 'mg', formulation: 'tablet', frequency_options: ['bid'], is_target_dose: true },
        ],
        // Effects are dose-independent: no source gives a per-dose split (the dose is titrated to heart rate), so none is invented.
        // KCCQ +2 = SHIFT QoL substudy, placebo-corrected +1.8 (clinical summary) / +2.4 (overall summary); heart-rate reduction about
        // 10 bpm placebo-corrected at 12 months (PMID 21875859). LVEF +2, NT-proBNP -10% and LVEDD -2% were not verified and are unchanged.
        chf_effects: () => ({
            lvef_improvement_absolute: 2.0, // SHIFT Trial
            bnp_reduction_percent: 0.10,
            weight_reduction_kg: 0,
            kccq_improvement: 2,
            structure_benefit_points: 10,
            lavi_reduction_percent: 0.02,
            lvedd_reduction_percent: 0.02 // SHIFT
        }),
        hemodynamic_effects: () => ({ sbp_drop: 0, hr_drop: 10, potassium_change: 0 }),
        ...ci([
            // Pregnancy: Corlanor labeling: may cause fetal harm (animal embryo-fetal toxicity);
            // applies to initiation AND continuation.
            pregnancyCheck('may cause fetal harm'),
            // Initiation gate: HR >= 70 required (SHIFT enrollment; label indication). Continuation: the heart-rate rule is
            // facts.hr_continuation (reduce below 50, withhold at the lowest dose), not removal.
            {
                reason: 'Heart rate below 70 bpm: initiation requires HR 70 or higher (SHIFT)',
                when: p => !p.current_regimen?.some(r => r.med.drug_class === 'If Inhibitor') && p.pulse < 70,
            },
            { reason: 'Atrial fibrillation', when: p => p.rhythm === 'AFib' },
            CI_AV_BLOCK_2,
            CI_AV_BLOCK_3, // label: 3rd-degree AV block unless a functioning pacemaker (a paced rhythm is excluded below anyway)
            // Corlanor label section 4 (verified-rate-control.md row 12):
            { reason: 'Taking a strong CYP3A4 inhibitor (azole antifungals, clarithromycin, telithromycin, nelfinavir, ritonavir, nefazodone; labeled contraindication)', when: strongIvabradineCyp3a4 },
            CI_SEVERE_HEPATIC_UNSPECIFIED('ivabradine (label: Child-Pugh C)'),
            { reason: 'Sick sinus syndrome / sinoatrial block (labeled contraindication unless a demand pacemaker; a paced rhythm is excluded below)', when: p => p.comorbidities.has(SICK_SINUS) },
            // The label contraindicates pacemaker dependence; the form cannot tell dependence from a demand pacemaker, so any paced
            // rhythm is excluded (conservative; the heart-rate effect also cannot be assessed when the rate is paced).
            { reason: 'Paced rhythm: pacemaker dependence cannot be excluded (labeled contraindication)', when: p => p.rhythm === 'Paced' },
            { reason: 'Acute decompensated heart failure (labeled contraindication; the tool reads NYHA IV, or NYHA III with congestion above dry weight, as acute decompensation)', when: isAcutelyDecompensated },
            // The label gives no number for "clinically significant hypotension". SBP below 90 is this tool's existing hypotension stop
            // (no drug recommendations at all). Chronic asymptomatic low blood pressure is deliberately NOT read as a contraindication, so a
            // patient whose beta-blocker is limited by hypotension can still be offered ivabradine (verified-rate-control.md row 17b).
            { reason: 'Clinically significant hypotension (SBP below 90; labeled contraindication)', when: p => p.sbp < 90 },
        ]),
        special_features: [
            {
                // The HR >= 70 criterion belongs to INITIATION (in the checks above): a patient already on ivabradine is meant to be at
                // 50-60 bpm and keeps the evidence bonus (Corlanor label; 2022 AHA/ACC/HFSA Class 2a, ESC 2021 IIa).
                feature: 'SHIFT: Reduces HF hospitalization (sinus rhythm, LVEF <= 35; started at HR >= 70 on maximally tolerated beta-blocker; AHA/ACC 2022 Class 2a)',
                points: 15,
                criteria: (p) => p.rhythm === 'Sinus' && p.lvef <= 35
                    && (p.pulse >= 70 || (p.current_regimen ?? []).some(r => r.med.drug_class === 'If Inhibitor'))
            }
        ],
        side_effects: () => ({ phosphenes: 0.05, bradycardia: 0.10 }),
    },
    {
        name: 'Vericiguat',
        drug_class: 'sGC Stimulator',
        facts: {
            // Verquvo label 2.2: start 5 mg once daily with food; start 2.5 mg only for a patient at risk of symptomatic hypotension; double about every
            // 2 weeks to the 10 mg target. VICTORIA itself started 2.5 mg. The start tier is exact (never both).
            start_dose_exact: true,
            regimen_warnings: [
                { text: 'Drug note: vericiguat label dosing: start 5 mg once daily with food (2.5 mg if at risk of symptomatic hypotension), double about every 2 weeks as tolerated to the 10 mg target. VICTORIA started 2.5 mg.' },
                { text: 'Drug note: vericiguat with riociguat or another soluble guanylate cyclase stimulator is contraindicated (Verquvo label).',
                  when: p => onOtherSgcStimulator(p) },
                { text: 'Drug note: PDE-5 inhibitor (sildenafil, tadalafil, vardenafil, avanafil) with vericiguat: concomitant use is not recommended (Verquvo label; sildenafil added up to a 5.4 mmHg additional blood pressure drop). VICTORIA excluded PDE-5 inhibitors. Not a hard exclusion: weigh the indication and stop one agent where possible.',
                  when: p => onPde5Inhibitor(p) },
                { text: 'Drug note: long-acting nitrates (isosorbide dinitrate or mononitrate, including hydralazine/isosorbide dinitrate) were excluded from VICTORIA; the label does not prohibit the combination. Watch for additive hypotension and monitor blood pressure closely if both are used.',
                  when: (p, regimen) => onLongActingNitrate(p) || regimen.some(r => r.med.drug_class === 'Vasodilator') },
                { text: 'Drug note: NT-proBNP above 8,000 pg/mL: in VICTORIA no benefit was seen in the highest NT-proBNP group (about 14% of the cohort, 672 of 4,805; primary outcome HR 1.16, 95% CI 0.94-1.41; at or below 8,000 HR 0.85). The label has no upper limit; this is an advisory, not an exclusion.',
                  when: p => p.nt_pro_bnp > 8000 },
                { text: 'Drug note: systolic pressure below 100 mmHg: VICTORIA excluded SBP below 100 or symptomatic hypotension (a trial criterion; the label has no SBP threshold). Start at 2.5 mg, titrate only if blood pressure is tolerated, and recheck blood pressure after each step.',
                  when: p => p.sbp > 0 && p.sbp < 100 },
                { text: 'Drug note: eGFR below 15 mL/min or dialysis: vericiguat was studied only with eGFR 15 or higher (Verquvo label; VICTORIA excluded eGFR below 15). No data support use here; this is a caution, not a label contraindication.',
                  when: p => p.egfr > 0 && p.egfr < 15 },
            ],
        },
        // Label rule: 5 mg unless the patient is at risk of symptomatic hypotension (then 2.5 mg). ENGINE POLICY for "at risk": SBP below 110 or
        // chronic hypotension (the label gives no threshold; the conservative reading starts low whenever blood pressure is near the trial floor of 100).
        start_dose_for: (p) => ((p.sbp > 0 && p.sbp < 110) || p.comorbidities.has('Hypotension (Chronic)')) ? 2.5 : 5,
        available_doses: [
            { strength: 2.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // Start when at risk of symptomatic hypotension (VICTORIA protocol)
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // Label default start; second titration step
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'], is_target_dose: true }, // Target dose
        ],
        chf_effects: (dose) => {
            const d = Number(dose);
            const ratio = d / 10;
            return {
                lvef_improvement_absolute: 0.5 + ratio * 0.5,
                bnp_reduction_percent: 0.05 + ratio * 0.10, // label: dose-dependent NT-proBNP reduction at 12 weeks, no magnitude; kept small, no source gives a number
                weight_reduction_kg: 0,
                // VICTORIA KCCQ analysis (PMID 35656822): vericiguat did NOT significantly improve KCCQ vs placebo (both arms improved). 0-1 per the
                // verified file; 0.5 at the target dose (the midpoint), scaled by dose. Was 1.5 + ratio * 2.5 (up to 4.0).
                kccq_improvement: 0.5 * ratio,
                structure_benefit_points: Math.round(2 + ratio * 3),
                lavi_reduction_percent: 0.01 + ratio * 0.01,
                lvedd_reduction_percent: ratio * 0.01 // VICTORIA
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 1.5 + Number(dose) / 10 * 2.5, hr_drop: 0, potassium_change: 0 }),
        // Verquvo label (VICTORIA): hypotension 16% (placebo 15%), anemia 10% (placebo 7%). (The engine had 10% and 5%.)
        side_effects: () => ({ hypotension: 0.16, anemia: 0.10 }),
        ...ci([
            // Pregnancy: FDA BOXED WARNING — embryo-fetal toxicity ("Do not administer to a
            // pregnant female"); applies to initiation AND continuation.
            pregnancyCheck('FDA boxed warning, embryo-fetal toxicity'),
            // Verquvo label contraindication (initiation AND continuation): concomitant riociguat or another sGC stimulator.
            {
                reason: 'Concurrent riociguat or another soluble guanylate cyclase stimulator — labeled contraindication',
                when: onOtherSgcStimulator,
            },
            // Continuation carve-out: the VICTORIA criteria below (NT-proBNP by rhythm, NYHA II-IV,
            // recent worsening, LVEF < 45) are trial ENROLLMENT gates for INITIATION only (the label has no NT-proBNP criterion).
            // A patient already on vericiguat whose NT-proBNP improved or whose worsening event
            // aged past the window is showing treatment response — that must not force removal
            // (mirrors the SGLT2i alreadyOn* continuation pattern).
            {
                reason: 'NYHA class not II-IV — initiation criterion (VICTORIA)',
                when: p => !p.current_regimen?.some(r => r.med.drug_class === 'sGC Stimulator')
                    && !(p.nyha_class === 'II' || p.nyha_class === 'III' || p.nyha_class === 'IV'),
            },
            {
                reason: 'LVEF 45 or higher — initiation criterion (VICTORIA)',
                when: p => !p.current_regimen?.some(r => r.med.drug_class === 'sGC Stimulator') && p.lvef >= 45,
            },
            {
                // VICTORIA inclusion: NT-proBNP >= 1000 pg/mL in sinus rhythm, >= 1600 in atrial fibrillation (BNP >= 300 / >= 500 is not entered by this tool).
                reason: 'NT-proBNP missing or below the VICTORIA threshold (1000 pg/mL in sinus rhythm, 1600 pg/mL in atrial fibrillation or other rhythms) — initiation criterion',
                when: p => !p.current_regimen?.some(r => r.med.drug_class === 'sGC Stimulator')
                    && (!p.nt_pro_bnp || p.nt_pro_bnp < vericiguatNtProBnpThreshold(p)),
            },
            {
                // The single answer covers both qualifying events: HF hospitalization within 6 months OR outpatient IV diuretic within 3 months.
                reason: 'No qualifying worsening-HF event (HF hospitalization within 6 months, or outpatient IV diuretic within 3 months) — initiation criterion (VICTORIA)',
                when: p => !p.current_regimen?.some(r => r.med.drug_class === 'sGC Stimulator')
                    && !(p.recent_hf_worsening_within_6mo === 'yes'),
            },
        ]),
    },
    {
        name: 'Patiromer',
        drug_class: 'K+ Binder',
        facts: {
            rescue_role: { kind: 'k_binder', preferred: true },
            // Veltassa label: take other oral drugs at least 3 hours before or after; avoid in severe constipation,
            // bowel obstruction or impaction; hypomagnesemia 5.3% (monitor magnesium).
            regimen_warnings: [
                { text: 'Drug note: take other oral medicines at least 3 hours before or after patiromer (it can bind them and reduce absorption).' },
                { text: 'Drug note: avoid patiromer in severe constipation, bowel obstruction or impaction; it can slow bowel motility.' },
            ],
            monitoring_items: [{
                test: 'Serum magnesium',
                timing: 'Periodically while on patiromer',
                details: 'Hypomagnesemia occurred in 5.3% in the label trials (about 9% had Mg below 1.4 mg/dL). Check magnesium and replace if low.',
            }],
        },
        // Veltassa label: start 8.4 g once daily, titrate in 8.4 g steps at intervals of a week or more, maximum 25.2 g daily.
        available_doses: [
            { strength: 8.4, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'] },
            { strength: 16.8, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'] },
            { strength: 25.2, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'] },
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
        // The engine only adds a binder to PREVENT a potassium rise on RAAS/MRA therapy. The sourced figure for
        // that setting is PEARL-HF (Pitt, Eur Heart J 2011; PMC3069389): heart-failure patients starting
        // spironolactone, RLY5016 (patiromer) 30 g/day vs placebo, between-group serum K+ difference -0.45 mEq/L
        // at 4 weeks (-0.52 with CKD). That is assigned to the top (25.2 g) tier; the 8.4 g and 16.8 g values are a
        // linear interpolation (an assumption — no prevention dose-response is sourced).
        // DIAMOND's -0.10 mmol/L is NOT used: both DIAMOND arms had RAAS therapy adjusted to potassium by protocol,
        // so its difference understates the binder's effect. OPAL-HK (~ -1.0) is correction of established
        // hyperkalemia, a different setting.
        hemodynamic_effects: (d) => ({ sbp_drop: 0, hr_drop: 0, potassium_change: -0.45 * Math.min(1, (typeof d === 'number' ? d : 8.4) / 25.2) }),
        side_effects: () => ({ hypomagnesemia: 0.053, constipation: 0.072 }), // Veltassa label (N=666): 5.3%, 7.2%
        special_features: [
            // DIAMOND supports "enables MRA/RAAS dosing", not outcome benefit; only meaningful with RAASi/MRA in the regimen.
            // The 50 points are a calibration choice with no sourced basis (left unchanged).
            { feature: 'Enables RAAS Optimization in Hyperkalemia (DIAMOND trial)', points: 50, criteria: (p, regimen) => p.potassium > 5.0 && hasRaasOrMra(regimen) }
        ]
    },
    {
        name: 'Sodium Zirconium Cyclosilicate (Lokelma)',
        drug_class: 'K+ Binder',
        facts: {
            // Label: edema 4.4% / 5.9% / 16.1% at 5 / 10 / 15 g. In heart failure the engine does not add 15 g on its own.
            rescue_role: { kind: 'k_binder', max_rescue_dose: 10 },
            // Lokelma label: about 400 mg sodium per 5 g; monitor for edema in HF, adjust dietary sodium and increase
            // diuretics as needed. Separate other oral drugs by at least 2 hours. Avoid in severe constipation,
            // bowel obstruction/impaction or abnormal post-operative bowel motility (not studied).
            regimen_warnings: [
                { text: 'Drug note (heart failure): Lokelma carries about 400 mg of sodium per 5 g (800 mg per 10 g) and causes dose-related edema (4.4% at 5 g, 5.9% at 10 g, 16.1% at 15 g; placebo 2.4%). Watch weight and edema, limit dietary sodium, and be ready to increase the diuretic.' },
                { text: 'Drug note: take other oral medicines at least 2 hours before or after Lokelma (its effect on gastric pH changes absorption of some drugs, e.g. furosemide, atorvastatin, dabigatran, tacrolimus).' },
                { text: 'Drug note: avoid Lokelma in severe constipation, bowel obstruction or impaction, or abnormal post-operative bowel motility (not studied).' },
            ],
            monitoring_items: [{
                test: 'Weight and edema (heart failure)',
                timing: 'Daily weights; review at 1 week',
                details: 'Lokelma sodium load can cause fluid retention. Check weight, edema and diuretic need after starting or raising the dose.',
            }],
        },
        // Lokelma label: 10 g three times daily for up to 48 h (correction phase, NOT modeled), then 10 g once daily;
        // maintenance 5 g every other day to 15 g daily, adjusted in 5 g steps at intervals of a week or more.
        available_doses: [
            { strength: 5, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'] },
            { strength: 10, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'] },
            { strength: 15, unit: 'g', formulation: 'powder packet', frequency_options: ['qd'] },
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
        // PREVENTION / maintenance effect (placebo-adjusted, label Study 2 days 8-29: K+ 4.8 / 4.5 / 4.4 at 5 / 10 / 15 g vs
        // 5.1 placebo): about -0.3, -0.6, -0.7. The earlier -0.7 / -1.1 are the drop from a hyperkalemic ~5.6 baseline
        // (HARMONIZE, 10 g three times daily for 48 h) and overstate what a once-daily dose prevents in a patient whose K+ is
        // already near 5. The engine only adds a binder to prevent a rise, so the prevention figures apply.
        // The 15 g value (-0.7) is the label's placebo-adjusted maintenance figure, not an extrapolation.
        hemodynamic_effects: (dose) => ({ sbp_drop: 0, hr_drop: 0, potassium_change: Number(dose) >= 15 ? -0.7 : Number(dose) >= 10 ? -0.6 : -0.3 }),
        // Dose-related edema from the label's placebo-controlled trials (placebo 2.4%); long-term uncontrolled 8-11%.
        side_effects: (dose) => ({ edema: LOKELMA_EDEMA_RATE(dose) }),
        special_features: [
            { feature: 'Enables RAAS/MRA Optimization in Hyperkalemia (HARMONIZE)', points: 50, criteria: (p, regimen) => p.potassium > 5.0 && hasRaasOrMra(regimen) },
            // Sodium load in congested HF: -10 at the 10 g reference, scaled by the dose-related edema rate.
            {
                feature: 'Sodium load risk in congested HF (about 400 mg sodium per 5 g; dose-related edema)',
                points: -10,
                points_for_dose: (dose) => -Math.round(10 * LOKELMA_EDEMA_RATE(dose) / LOKELMA_EDEMA_RATE(10)),
                criteria: (p) => (p.volume_status.current_weight_kg - p.volume_status.dry_weight_kg) > 2.0
            }
        ]
    },
    {
        name: 'Ferric Carboxymaltose',
        drug_class: 'IV Iron',
        facts: {
            // The dose is a one-time label course (Injectafer label Table 1), not a titratable dose.
            single_course_dose: true,
            start_dose_exact: true,
            regimen_warnings: [
                // Patient-specific dosing note (label table by weight and hemoglobin).
                { text: (p) => `Drug note: ${fcmDosingNote(p)}` },
                { text: 'Drug note: BOXED WARNING (Injectafer label, 08/2026): symptomatic, severe and prolonged hypophosphatemia, including osteomalacia and fractures, has occurred, also in patients with a normal baseline phosphate. Correct pre-existing hypophosphatemia first; check serum phosphate before any repeat course within 3 months and in patients at risk (malabsorption, inflammatory bowel disease, vitamin D deficiency, hyperparathyroidism).' },
            ],
            monitoring_items: [
                { test: 'Serum phosphate (ferric carboxymaltose boxed warning)', timing: 'Before any repeat course within 3 months, and when symptoms of bone pain or weakness occur',
                  details: 'Hypophosphatemia can be severe and prolonged and cause osteomalacia and fractures, even with a normal baseline. Check phosphate before repeat dosing, especially with malabsorption, IBD, vitamin D deficiency or hyperparathyroidism (Injectafer label).' },
                { test: 'Ferritin and transferrin saturation', timing: 'Before each 500 mg maintenance dose (weeks 12, 24, 36)',
                  details: 'Maintenance 500 mg is given only if ferritin is below 100 ng/mL, or 100-300 ng/mL with TSAT below 20% (Injectafer label). No data beyond 36 weeks.' },
            ],
        },
        // Day-1 dose from the label table: 1000 mg, except 500 mg when Hb is above 14 to below 15 g/dL. Hb >= 15 holds the drug (contraindication
        // check below). An unknown Hb takes the 1000 mg day-1 dose (the dosing note states both bands).
        start_dose_for: (p) => fcmDayOneDose(p),
        is_target_dose_for: (strength, p) => strength === fcmDayOneDose(p),
        available_doses: [
             { strength: 500, unit: 'mg', formulation: 'IV', frequency_options: ['once'] },  // Day-1 dose when Hb is above 14; week-6 / maintenance dose
             { strength: 1000, unit: 'mg', formulation: 'IV', frequency_options: ['once'] }, // Day-1 dose otherwise
        ],
        chf_effects: () => ({
             lvef_improvement_absolute: 0,
             bnp_reduction_percent: 0.05, // NOT VERIFIED (no NT-proBNP magnitude opened); unchanged
             weight_reduction_kg: 0,
             kccq_improvement: 8, // AFFIRM-AHF; NOT VERIFIED (no KCCQ source opened; the review suggested 3-5): unchanged until a source is opened
             structure_benefit_points: 0,
             lavi_reduction_percent: 0,
             lvedd_reduction_percent: 0
        }),
        hemodynamic_effects: () => ({ sbp_drop: 0, hr_drop: 0, potassium_change: 0 }),
        // Injectafer label: transient serum phosphorus below 2 mg/dL in 27% (440/1,638) of patients in the clinical trials (iron-deficiency-anemia pool).
        side_effects: () => ({ hypophosphatemia: 0.27 }),
        special_features: [
            // 2022 AHA/ACC/HFSA: IV iron Class 2a (B-R) in HFrEF with iron deficiency. Full credit at LVEF <= 40; a limited-evidence tier (half the
            // points: engine policy) at 41-49; none at >= 50, at NYHA I or IV, or at Hb >= 15 (ivIronCreditTier). Symptom / hospitalization-level
            // benefit (CONFIRM-HF 6MWT +33 m, AFFIRM-AHF HF hospitalizations RR 0.74, HEART-FID win ratio 1.10 NS-borderline): 40 sits below the
            // A-HeFT mortality benefit (60) and equal to the GLP-1 symptom benefit (40).
            { feature: 'Treats iron deficiency in HFrEF (LVEF 40 or lower; Class 2a)', points: 40, criteria: p => ivIronCreditTier(p) === 'full' },
            { feature: 'Treats iron deficiency, limited evidence at LVEF 41-49 (trials enrolled LVEF below 50)', points: 20, criteria: p => ivIronCreditTier(p) === 'limited' },
        ],
        ...ci([
            // The label has no data with hemoglobin >= 15 g/dL (HEART-FID required Hb < 15 in men, < 13.5 in women; AFFIRM-AHF excluded Hb > 15).
            { reason: 'Hemoglobin 15 g/dL or higher — no label data (hold ferric carboxymaltose)', when: p => p.hemoglobin !== undefined && p.hemoglobin >= 15 },
        ]),
    },
    {
        name: 'Digoxin',
        drug_class: 'Inotrope',
        facts: {
            // The label's heart-rate lowering data are in atrial fibrillation (it "does not significantly reduce heart rate during
            // exercise"; a sinus-rhythm bpm figure is not verified), so the rate effect is only credited in AFib (effects.ts).
            hr_effect_only_in_rhythm: 'AFib',
            // Converted from hard contraindications (the Lanoxin label contraindicates only ventricular fibrillation and
            // hypersensitivity): these now carry a penalized warning and dosing guidance instead of excluding the drug.
            regimen_warnings: [
                { text: 'DIGOXIN SAFETY: Wolff-Parkinson-White / accessory pathway (Lanoxin label warning 5.1): in atrial fibrillation with an accessory pathway digoxin can accelerate conduction over the pathway and cause ventricular fibrillation. Avoid unless the pathway has been treated or a specialist directs it.', when: p => p.comorbidities.has(WPW) },
                { text: 'DIGOXIN SAFETY: Potassium above 5.5 mEq/L. The label has no potassium contraindication (hypokalemia, hypomagnesemia and hypercalcemia are the toxicity predisposers); correct the hyperkalemia, check an ECG, and recheck the digoxin level before relying on this regimen.', when: p => p.potassium > 5.5 },
                { text: 'DIGOXIN SAFETY: eGFR below 15. The label has no renal contraindication; dosing follows its table by lean body weight and creatinine clearance (the 62.5 mcg tier is the lowest offered). Expect accumulation: check a level in 5-7 days and after any renal change.', when: p => p.egfr > 0 && p.egfr < 15 },
            ],
        },
        available_doses: [
            { strength: 62.5, unit: 'mcg', formulation: 'tablet (half of 125mcg)', frequency_options: ['qd'] },
            { strength: 125, unit: 'mcg', formulation: 'tablet', frequency_options: ['qd'] },
        ],
        // NT-proBNP effect 0: no source gives one (DIG: no mortality effect, fewer HF hospitalizations). KCCQ and the LVEF credit are
        // unchanged: the label says digoxin raises LVEF and improves symptoms but no source opened gives a number, so LVEF stays 0.
        chf_effects: (dose) => ({
            lvef_improvement_absolute: 0,
            bnp_reduction_percent: 0,
            weight_reduction_kg: 0,
            kccq_improvement: Number(dose) >= 125 ? 4 : 2, // DIG Trial (Hospitalization reduction)
            structure_benefit_points: 0,
            lavi_reduction_percent: 0,
            lvedd_reduction_percent: 0
        }),
        hemodynamic_effects: (dose) => ({ sbp_drop: 0, hr_drop: Number(dose) >= 125 ? 8 : 4, potassium_change: 0 }),
        side_effects: () => ({ nausea: 0.10, visual_disturbances: 0.05, arrhythmia: 0.05 }),
        ...ci([
            // Lanoxin label contraindications: ventricular fibrillation and hypersensitivity (hypersensitivity is the allergy rule).
            { reason: 'Ventricular fibrillation (labeled contraindication)', when: p => p.comorbidities.has(VENTRICULAR_FIBRILLATION) },
            // Renal data are needed to START digoxin (it is renally cleared and its label dosing is by creatinine clearance). Blank eGFR is the
            // 0 sentinel: this is reported as "renal data required" (E12) and never forces removal of digoxin already taken. It replaces the
            // old "eGFR below 15" block, which also caught a blank eGFR.
            { reason: 'Renal function not entered (digoxin is renally cleared; obtain a BMP before starting)', when: p => valueUnknown(p.egfr) },
            // (p.potassium > 0 guard: blank/unentered K+ is stored as 0 and must not read as
            // hypokalemia; the engine's POTASSIUM UNKNOWN pathway governs that case.) Hypokalemia potentiates toxicity; the label's
            // advice is to correct it first, so this stays a conservative block (verified-rate-control.md row 21).
            { reason: 'Potassium below 3.5 mEq/L', when: p => (p.potassium > 0 && p.potassium < 3.5) },
            CI_AV_BLOCK_2,
            CI_AV_BLOCK_3,
        ]),
        // The label doses by lean body weight and CrCl (not age or eGFR bands), and no source supports a flat 62.5 mcg cap at eGFR
        // 30-50. The 62.5 mcg cap below eGFR 30 is a CONSERVATIVE ENGINE CHOICE (the label's table gives larger doses at some
        // weights), kept because it only restricts the dose.
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { max_dose: 62.5, caution: true };
            return {};
        },
        special_features: [
             { feature: 'Rate Control in AFib', points: 20, criteria: (p) => p.rhythm === 'AFib' }
        ]
    },
    {
        name: 'Metolazone',
        drug_class: 'Thiazide-like Diuretic',
        facts: {
            raises_uric_acid: true, // label: regularly raises uric acid, can occasionally precipitate gout
            // Penalized caution, NOT a label contraindication (the label's contraindications are anuria, hepatic coma/precoma and allergy). The label warns
            // of rapid-onset severe hyponatremia and/or hypokalemia (dose-related). The K+ 3.5 level is ENGINE POLICY.
            hypokalemia_caution_below_k: { k: 3.5, basis: 'engine policy; the label warns of rapid severe hypokalemia, dose-related, and has no potassium contraindication' },
            monitoring_items: [{
                test: 'Basic metabolic panel (sodium, potassium) after starting metolazone',
                timing: 'Within about 3-5 days of starting, then at regular intervals (the day count is practice-based, not label text)',
                details: 'Label: rapid-onset severe hyponatremia and/or hypokalemia can occur, rarely even after the initial doses, and hyponatremia can occur at any time during long-term therapy; check potassium at regular intervals. Hypokalemia is dose-related and is a hazard with digoxin; adding it to a loop diuretic can cause large fluid and electrolyte losses.',
            }],
            regimen_warnings: [
                { text: 'Drug note: metolazone can cause severe hyponatremia and hypokalemia, sometimes within the first doses, especially added to a loop diuretic. Check sodium and potassium soon after starting and at regular intervals (Zaroxolyn label).' },
            ],
        },
        // Label (HF edema): 5-20 mg once daily, titrated to the minimal effective dose; tablets 2.5 and 5 mg (10 mg named in the description). The 2.5 mg tier is in
        // common use but is BELOW the labeled HF range. No intermittent-dosing schedule is modeled (the label describes none; it is practice-based).
        available_doses: [
            { strength: 2.5, unit: 'mg', formulation: 'tablet (below the labeled HF range of 5-20 mg)', frequency_options: ['qd'] },
            { strength: 5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 10, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
        ],
        chf_effects: () => ({
            lvef_improvement_absolute: 0,
            bnp_reduction_percent: 0.10,
            weight_reduction_kg: THIAZIDE_ADDON_WEIGHT_KG, // add-on above the loop; flat across doses (no dose-response is sourced)
            kccq_improvement: 3,
            structure_benefit_points: 0,
            lavi_reduction_percent: 0.05,
            lvedd_reduction_percent: 0
        }),
        hemodynamic_effects: () => ({ sbp_drop: 5, hr_drop: 0, potassium_change: -0.5 }),
        side_effects: () => ({ severe_hypokalemia: 0.30, dehydration: 0.20, hyponatremia: 0.10, worsening_renal_function: THIAZIDE_WRF_EXCESS }),
        ...ci([
            { reason: 'eGFR below 15 (anuria/ESRD; no tubular function for the thiazide mechanism)', when: p => p.egfr < 15 }, // kept (verified-diuretics.md: no change)
            CI_ANURIA,
        ]),
    },
    {
        name: 'Chlorthalidone',
        drug_class: 'Thiazide-like Diuretic',
        facts: { raises_uric_acid: true }, // label: hyperuricemia, frank gout may be precipitated, dose-related uric acid rise
        // 12.5 mg is half of a 25 mg tablet (label tablets 25 and 50 mg; the edema dose on the label is 30-100 mg daily).
        available_doses: [
            { strength: 12.5, unit: 'mg', formulation: 'half of a 25 mg tablet', frequency_options: ['qd'] },
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
        ],
        chf_effects: (dose) => {
            // The add-on trial is CLOROTIC (Eur Heart J 2023;44:411), which tested HYDROCHLOROTHIAZIDE (not chlorthalidone) added to IV furosemide
            // in acute HF. Its weight benefit is applied to every thiazide-type add-on (ASSUMPTION: no chlorthalidone-specific figure is sourced).
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 0,
                bnp_reduction_percent: 0.08 + (d / 25 * 0.07),
                weight_reduction_kg: THIAZIDE_ADDON_WEIGHT_KG, // sequential nephron blockade, flat across doses
                kccq_improvement: 2 + (d / 25),
                structure_benefit_points: 0,
                lavi_reduction_percent: 0.04,
                lvedd_reduction_percent: 0
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 4 + Number(dose) / 10, hr_drop: 0, potassium_change: -0.4 - (Number(dose) / 25 * 0.1) }),
        side_effects: () => ({ severe_hypokalemia: 0.25, dehydration: 0.15, hyponatremia: 0.10, worsening_renal_function: THIAZIDE_WRF_EXCESS }),
        ...ci([{ reason: 'eGFR below 15 (anuria/ESRD)', when: p => p.egfr < 15 }]), // Anuria/ESRD
    },
    {
        name: 'Hydrochlorothiazide',
        drug_class: 'Thiazide-like Diuretic',
        facts: { raises_uric_acid: true }, // label: acute gout may be precipitated
        available_doses: [
            { strength: 12.5, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] }, // label strengths 12.5, 25, 50 mg
            { strength: 25, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
            { strength: 50, unit: 'mg', formulation: 'tablet', frequency_options: ['qd'] },
        ],
        chf_effects: (dose) => {
            // CLOROTIC (the trial drug is HCTZ): weight benefit applied to every thiazide-type add-on, flat across doses.
            // (CLOROTIC dosed HCTZ by creatinine clearance, MORE at lower clearance; its weight benefit shrank below eGFR 45: -2.1, -1.3, -0.1 kg; not modeled.)
            const d = Number(dose);
            return {
                lvef_improvement_absolute: 0,
                bnp_reduction_percent: 0.06 + (d / 50 * 0.06),
                weight_reduction_kg: THIAZIDE_ADDON_WEIGHT_KG,
                kccq_improvement: 2 + (d / 50),
                structure_benefit_points: 0,
                lavi_reduction_percent: 0.03,
                lvedd_reduction_percent: 0
            };
        },
        hemodynamic_effects: (dose) => ({ sbp_drop: 3 + Number(dose) / 15, hr_drop: 0, potassium_change: -0.3 - (Number(dose) / 50 * 0.1) }),
        // Hypokalemia: CLOROTIC post hoc K+ < 3.5 was more frequent with HCTZ (OR 4.90, 95% CI 2.50-9.90), worst with baseline K+ 4.3 or lower and no MRA.
        side_effects: () => ({ hypokalemia: 0.20, dehydration: 0.10, hyponatremia: 0.08, worsening_renal_function: THIAZIDE_WRF_EXCESS }),
        // The HCTZ label has no eGFR statement (anuria is the contraindication) and CLOROTIC enrolled eGFR 14-109, so eGFR below 30 is a CAUTION (reduced
        // efficacy), not a contraindication. eGFR below 15 stays excluded for consistency with metolazone/chlorthalidone (judgment: no source below 14).
        ...ci([
            { reason: 'eGFR below 15 (below the range studied in CLOROTIC, which enrolled eGFR 14-109)', when: p => p.egfr < 15 },
            CI_ANURIA,
        ]),
        renal_adjustment: (egfr) => {
            if (egfr < 30) return { caution: true };
            return {};
        },
    }
];
