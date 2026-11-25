// The prepared cases for the expert panel (docs/expert-review-2026-11-19/panel/). Every patient is constructed, never a real person.
// Built with the project's own pieces (the medication formulary, reconcileDerivedFields and the form's blank-patient shape) so each field the
// entry form requires is set. This file holds ONLY patient inputs and the purpose of each case; nothing here states what the tool will do.
// `npm run panel:cases` regenerates the packet from these definitions and the tool's output.
import type { Patient, RegimenMed, ExcludedMedication } from '../types';
import { MEDICATION_FORMULARY } from '../constants';
import { reconcileDerivedFields } from './scenarios';
import type { WeightProfileName } from '../services/engine/scoreModel';

/** One drug as a clinician would enter it: formulary name, strength, frequency. */
export type DrugSeed = [name: string, strength: string | number, frequency: string];

export interface PanelCaseSpec {
    /** Stable internal key (group letter + order inside the group). Reviewers never see it. */
    key: string;
    group: string;
    /** What the case was chosen to test. Shown only on the owner's page, never to reviewers before they rate. Never states what the tool does. */
    tests: string;
    patient: Patient;
}

const ACTIVE = { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } as const;

function regimen(seeds: DrugSeed[]): RegimenMed[] {
    return seeds.map(([name, strength, freq]): RegimenMed => {
        const med = MEDICATION_FORMULARY.find(m => m.name === name);
        if (!med) throw new Error(`[panelCases] Missing medication "${name}".`);
        const dose = med.available_doses.find(d => String(d.strength) === String(strength));
        if (!dose) throw new Error(`[panelCases] Missing dose "${strength}" for "${name}".`);
        if (!dose.frequency_options.includes(freq)) throw new Error(`[panelCases] "${name}" ${strength} cannot be taken "${freq}".`);
        return { med, dose, selected_frequency: freq, exposure: { ...ACTIVE } };
    });
}

interface Spec {
    age: number; sex: 'Male' | 'Female'; race?: Patient['race']; bmi: number;
    sbp: number; dbp: number; pulse: number; rhythm?: Patient['rhythm']; spo2?: number;
    nt: number; nyha: Patient['nyha_class']; lvef: number; previous_lvef?: number; kccq?: number;
    dry: number; excess?: number; findings?: string[];
    egfr: number; k: number; bun?: number; baseline_creatinine_ratio?: number; hb?: number; ferritin?: number; tsat?: number;
    comorbidities?: string[]; external?: string[]; allergies?: string[]; intolerances?: ExcludedMedication[];
    drugs?: DrugSeed[]; pregnant?: boolean | 'not_recorded'; scope?: string[] | 'not_answered';
    ever_le_40?: Patient['ever_lvef_le_40']; worsening?: Patient['recent_hf_worsening_within_6mo'];
    budget?: number; cost_worry?: number; /** Tolerance for many pills and doses, 0 to 10 (the form's own scale; 5 when not given). */ complexity?: number; tier?: Patient['insurance_tier']; priority?: WeightProfileName;
    /** Potassium, creatinine and eGFR left blank (the form reads a blank as "not entered"). */
    renal_blank?: boolean;
}

function patient(s: Spec): Patient {
    const p: Patient = {
        age: s.age, sex: s.sex, race: s.race ?? 'White', height_cm: 172, bmi: s.bmi,
        sbp: s.sbp, dbp: s.dbp, pulse: s.pulse, oxygen_saturation: s.spo2 ?? 97, rhythm: s.rhythm ?? 'Sinus',
        nt_pro_bnp: s.nt, nyha_class: s.nyha, kccq_score: s.kccq, lvef: s.lvef, previous_lvef: s.previous_lvef,
        volume_status: { dry_weight_kg: s.dry, current_weight_kg: Math.round((s.dry + (s.excess ?? 0)) * 10) / 10, exam_findings: new Set(s.findings ?? []) },
        bun: s.renal_blank ? (undefined as unknown as number) : (s.bun ?? 18), creatinine: s.renal_blank ? 0 : 1.0, baseline_creatinine: undefined, egfr: s.renal_blank ? 0 : s.egfr, potassium: s.renal_blank ? 0 : s.k,
        hemoglobin: s.hb, ferritin: s.ferritin, tsat: s.tsat,
        comorbidities: new Set(s.comorbidities ?? []), external_medications: new Set(s.external ?? []), allergies: new Set(s.allergies ?? []),
        discontinued_meds: s.intolerances ?? [],
        is_pregnant: s.pregnant === 'not_recorded' ? undefined : s.pregnant !== undefined ? s.pregnant : (s.sex === 'Female' ? false : undefined),
        scope_conditions: s.scope === 'not_answered' ? undefined : new Set(s.scope ?? []),
        ever_lvef_le_40: s.ever_le_40 ?? (s.lvef <= 40 ? 'yes' : 'no'), recent_hf_worsening_within_6mo: s.worsening ?? 'no',
        current_regimen: regimen(s.drugs ?? []),
        max_affordable_cost: s.budget ?? 500, cost_sensitivity: s.cost_worry ?? 5, insurance_tier: s.tier ?? 'cash', complexity_tolerance: s.complexity ?? 5,
        max_new_classes_per_visit: 2, care_priority: s.priority ?? 'default',
    };
    if (s.baseline_creatinine_ratio) p.baseline_creatinine = Math.round(p.creatinine * s.baseline_creatinine_ratio * 100) / 100;
    if (s.hb !== undefined && (s.ferritin !== undefined || s.tsat !== undefined)) { p.iron_course_review = 'first_course'; p.phosphate_review = 'not_indicated'; }
    const q = reconcileDerivedFields(p);
    if (s.renal_blank) { q.egfr = 0; q.creatinine = 0; q.potassium = 0; }
    return q;
}

const HFREF = 'Heart failure with reduced ejection fraction';
void HFREF;

// Reused drugs
const FOUR_TARGET_CARV: DrugSeed[] = [['Sacubitril/Valsartan (Entresto)', '97/103', 'bid'], ['Carvedilol', 25, 'bid'], ['Spironolactone', 25, 'qd'], ['Dapagliflozin', 10, 'qd']];

const A2: Spec = { age: 62, sex: 'Male', bmi: 28, sbp: 128, dbp: 80, pulse: 76, nt: 1500, nyha: 'II', lvef: 30, dry: 84, egfr: 70, k: 4.4, comorbidities: ['Coronary Artery Disease'], drugs: [['Lisinopril', 10, 'qd']] };

/** The patient of group J. Found by search, not chosen: see the comment on key J0. */
export const J_PATIENT: Spec = { age: 71, sex: 'Male', bmi: 29, sbp: 126, dbp: 78, pulse: 72, nt: 1900, nyha: 'II', lvef: 30, dry: 88, egfr: 62, k: 4.5, comorbidities: ['Coronary Artery Disease'],
    drugs: [['Lisinopril', 10, 'qd'], ['Carvedilol', 12.5, 'bid'], ['Spironolactone', 25, 'qd']], tier: 'medicare', cost_worry: 9, complexity: 2, budget: 300 };

export const PANEL_CASE_SPECS: PanelCaseSpec[] = [
    // ---- A. Reduced EF, undertreated ----
    { key: 'A1', group: 'A. Reduced ejection fraction, undertreated', tests: 'A new diagnosis with no heart failure drug and no complicating feature: does the first step make sense, and how many classes does it start?',
        patient: patient({ age: 58, sex: 'Male', bmi: 27, sbp: 124, dbp: 78, pulse: 78, nt: 1400, nyha: 'II', lvef: 25, dry: 82, egfr: 78, k: 4.3, drugs: [] }) },
    { key: 'A2', group: 'A. Reduced ejection fraction, undertreated', tests: 'An ACE inhibitor alone: switch to sacubitril/valsartan, or add the missing classes?',
        patient: patient(A2) },
    { key: 'A3', group: 'A. Reduced ejection fraction, undertreated', tests: 'Low-dose ACE inhibitor and beta-blocker: titrate, or add classes first.',
        patient: patient({ age: 67, sex: 'Male', bmi: 29, sbp: 118, dbp: 72, pulse: 72, nt: 1900, nyha: 'II', lvef: 28, dry: 88, egfr: 62, k: 4.6, comorbidities: ['Coronary Artery Disease'], drugs: [['Lisinopril', 5, 'qd'], ['Carvedilol', 6.25, 'bid']] }) },
    { key: 'A4', group: 'A. Reduced ejection fraction, undertreated', tests: 'Type 2 diabetes with eGFR 38 on an ARB and beta-blocker: SGLT2 inhibitor, MRA and sacubitril/valsartan choices at reduced kidney function.',
        patient: patient({ age: 69, sex: 'Female', bmi: 31, sbp: 132, dbp: 76, pulse: 68, nt: 2200, nyha: 'II', lvef: 32, dry: 79, egfr: 38, k: 4.7, comorbidities: ['Diabetes Mellitus Type 2'], drugs: [['Losartan', 50, 'qd'], ['Carvedilol', 12.5, 'bid']] }) },
    { key: 'A5', group: 'A. Reduced ejection fraction, undertreated', tests: 'Self-identified Black patient, NYHA III, on three classes: where hydralazine/isosorbide dinitrate and the fourth class rank.',
        patient: patient({ age: 59, sex: 'Male', race: 'Black', bmi: 30, sbp: 126, dbp: 78, pulse: 70, nt: 2600, nyha: 'III', lvef: 28, dry: 92, egfr: 64, k: 4.8, drugs: [['Lisinopril', 20, 'qd'], ['Metoprolol Succinate', 100, 'qd'], ['Spironolactone', 25, 'qd']] }) },
    { key: 'A6', group: 'A. Reduced ejection fraction, undertreated', tests: 'Age 84 with systolic pressure 104 on a low-dose ACE inhibitor: how the tool treats the oldest patients and borderline pressure.',
        patient: patient({ age: 84, sex: 'Male', bmi: 25, sbp: 104, dbp: 62, pulse: 66, nt: 2100, nyha: 'II', lvef: 30, dry: 72, egfr: 52, k: 4.5, drugs: [['Lisinopril', 2.5, 'qd']] }) },

    // ---- B. Reduced EF, on full therapy ----
    { key: 'B1', group: 'B. Reduced ejection fraction, on full therapy', tests: 'Four classes at target, stable: what, if anything, is first.',
        patient: patient({ age: 61, sex: 'Male', bmi: 28, sbp: 112, dbp: 70, pulse: 62, nt: 600, nyha: 'II', lvef: 30, dry: 82, egfr: 66, k: 4.6, drugs: FOUR_TARGET_CARV }) },
    { key: 'B3', group: 'B. Reduced ejection fraction, on full therapy', tests: 'Four classes at target, NYHA III, NT-proBNP 2,400, recent worsening: vericiguat, ivabradine, iron and device questions.',
        patient: patient({ age: 66, sex: 'Male', bmi: 27, sbp: 108, dbp: 68, pulse: 70, nt: 2400, nyha: 'III', lvef: 25, dry: 78, excess: 0.5, egfr: 55, k: 4.7, worsening: 'yes', drugs: FOUR_TARGET_CARV }) },
    { key: 'B4', group: 'B. Reduced ejection fraction, on full therapy', tests: 'Improved ejection fraction (25 before, 48 now) on four classes: does the tool keep therapy the evidence says to keep?',
        patient: patient({ age: 55, sex: 'Male', bmi: 26, sbp: 118, dbp: 74, pulse: 64, nt: 300, nyha: 'I', lvef: 48, previous_lvef: 25, dry: 80, egfr: 74, k: 4.5, ever_le_40: 'yes', drugs: [['Sacubitril/Valsartan (Entresto)', '49/51', 'bid'], ['Bisoprolol', 5, 'qd'], ['Spironolactone', 25, 'qd'], ['Empagliflozin', 10, 'qd']] }) },

    // ---- C. EF 41 to 49 and 50 or above ----
    { key: 'C1', group: 'C. Mildly reduced and preserved ejection fraction', tests: 'Ejection fraction 45 on a beta-blocker only: which evidence band applies and what is added.',
        patient: patient({ age: 71, sex: 'Male', bmi: 29, sbp: 138, dbp: 82, pulse: 66, nt: 800, nyha: 'II', lvef: 45, dry: 86, egfr: 60, k: 4.5, comorbidities: ['Coronary Artery Disease'], drugs: [['Metoprolol Succinate', 50, 'qd']] }) },
    { key: 'C2', group: 'C. Mildly reduced and preserved ejection fraction', tests: 'Preserved ejection fraction with obesity (BMI 38), NYHA III, no diabetes: SGLT2 inhibitor versus semaglutide.',
        patient: patient({ age: 62, sex: 'Female', bmi: 38, sbp: 136, dbp: 82, pulse: 74, nt: 450, nyha: 'III', lvef: 58, dry: 108, egfr: 80, k: 4.4, drugs: [] }) },
    { key: 'C3', group: 'C. Mildly reduced and preserved ejection fraction', tests: 'Preserved ejection fraction, type 2 diabetes, eGFR 42, on nothing for heart failure.',
        patient: patient({ age: 74, sex: 'Male', bmi: 31, sbp: 142, dbp: 80, pulse: 72, nt: 900, nyha: 'II', lvef: 55, dry: 94, egfr: 42, k: 4.6, comorbidities: ['Diabetes Mellitus Type 2'], drugs: [] }) },
    { key: 'C4', group: 'C. Mildly reduced and preserved ejection fraction', tests: 'Preserved ejection fraction, congested, on no diuretic: is the diuretic step offered and explained.',
        patient: patient({ age: 78, sex: 'Female', bmi: 30, sbp: 148, dbp: 78, pulse: 70, nt: 1800, nyha: 'III', lvef: 60, dry: 74, excess: 3, findings: ['Edema (2+)'], egfr: 54, k: 4.4, drugs: [] }) },
    { key: 'C5', group: 'C. Mildly reduced and preserved ejection fraction', tests: 'Preserved ejection fraction in atrial fibrillation on a beta-blocker.',
        patient: patient({ age: 76, sex: 'Female', bmi: 29, sbp: 130, dbp: 74, pulse: 76, rhythm: 'AFib', nt: 1100, nyha: 'II', lvef: 55, dry: 72, egfr: 58, k: 4.5, comorbidities: ['Atrial Fibrillation'], drugs: [['Metoprolol Succinate', 50, 'qd']] }) },

    // ---- D. Atrial fibrillation with reduced EF ----
    { key: 'D1', group: 'D. Atrial fibrillation with reduced ejection fraction', tests: 'New patient in atrial fibrillation on no beta-blocker: the tool\'s atrial fibrillation figure for beta-blockers.',
        patient: patient({ age: 63, sex: 'Male', bmi: 28, sbp: 122, dbp: 76, pulse: 88, rhythm: 'AFib', nt: 1700, nyha: 'II', lvef: 30, dry: 84, egfr: 72, k: 4.4, comorbidities: ['Atrial Fibrillation'], drugs: [] }) },
    { key: 'D2', group: 'D. Atrial fibrillation with reduced ejection fraction', tests: 'Fast atrial fibrillation (128) on a beta-blocker: what the tool offers for rate control.',
        patient: patient({ age: 70, sex: 'Male', bmi: 27, sbp: 112, dbp: 70, pulse: 128, rhythm: 'AFib', nt: 3000, nyha: 'III', lvef: 28, dry: 80, excess: 1.5, findings: ['Edema (1+)'], egfr: 60, k: 4.4, comorbidities: ['Atrial Fibrillation'], drugs: [['Carvedilol', 12.5, 'bid']] }) },
    { key: 'D3', group: 'D. Atrial fibrillation with reduced ejection fraction', tests: 'Beta-blocker at target with digoxin and eGFR 34: digoxin handling at reduced kidney function.',
        patient: patient({ age: 76, sex: 'Male', bmi: 26, sbp: 118, dbp: 72, pulse: 74, rhythm: 'AFib', nt: 2000, nyha: 'II', lvef: 30, dry: 76, egfr: 34, k: 4.5, comorbidities: ['Atrial Fibrillation'], drugs: [['Carvedilol', 25, 'bid'], ['Digoxin', 125, 'qd']] }) },

    // ---- E. Potassium and kidney ----
    { key: 'E1', group: 'E. Potassium and kidney function', tests: 'Potassium 5.1 on ACE inhibitor and beta-blocker, no MRA: the potassium rule for starting an MRA.',
        patient: patient({ age: 65, sex: 'Male', bmi: 28, sbp: 124, dbp: 76, pulse: 68, nt: 1500, nyha: 'II', lvef: 27, dry: 85, egfr: 55, k: 5.1, drugs: [['Lisinopril', 20, 'qd'], ['Carvedilol', 12.5, 'bid']] }) },
    { key: 'E2', group: 'E. Potassium and kidney function', tests: 'Potassium 5.6 on spironolactone and sacubitril/valsartan: the response to high potassium on an MRA.',
        patient: patient({ age: 70, sex: 'Male', bmi: 27, sbp: 120, dbp: 72, pulse: 70, nt: 1600, nyha: 'II', lvef: 30, dry: 80, egfr: 44, k: 5.6, drugs: [['Sacubitril/Valsartan (Entresto)', '49/51', 'bid'], ['Spironolactone', 25, 'qd']] }) },
    { key: 'E3', group: 'E. Potassium and kidney function', tests: 'Potassium 6.1 on sacubitril/valsartan and spironolactone: very high potassium.',
        patient: patient({ age: 72, sex: 'Male', bmi: 26, sbp: 118, dbp: 70, pulse: 72, nt: 2300, nyha: 'III', lvef: 28, dry: 78, egfr: 40, k: 6.1, drugs: [['Sacubitril/Valsartan (Entresto)', '49/51', 'bid'], ['Spironolactone', 25, 'qd']] }) },
    { key: 'E4', group: 'E. Potassium and kidney function', tests: 'eGFR 28 on lisinopril and carvedilol: kidney limits for each class.',
        patient: patient({ age: 73, sex: 'Male', bmi: 27, sbp: 126, dbp: 74, pulse: 68, nt: 2800, nyha: 'II', lvef: 30, dry: 78, egfr: 28, k: 4.8, drugs: [['Lisinopril', 10, 'qd'], ['Carvedilol', 12.5, 'bid']] }) },
    { key: 'E5', group: 'E. Potassium and kidney function', tests: 'eGFR 18 on an ACE inhibitor: very low kidney function, below the range of the trials.',
        patient: patient({ age: 78, sex: 'Female', bmi: 27, sbp: 128, dbp: 70, pulse: 72, nt: 4200, nyha: 'III', lvef: 30, dry: 62, egfr: 18, k: 5.0, drugs: [['Lisinopril', 5, 'qd']] }) },
    { key: 'E6', group: 'E. Potassium and kidney function', tests: 'Creatinine up 60 percent from the recorded baseline on ACE inhibitor and MRA: the change-from-baseline kidney rule.',
        patient: patient({ age: 68, sex: 'Male', bmi: 28, sbp: 114, dbp: 68, pulse: 72, nt: 2000, nyha: 'II', lvef: 30, dry: 86, egfr: 41, k: 5.0, baseline_creatinine_ratio: 1 / 1.6, drugs: [['Lisinopril', 20, 'qd'], ['Spironolactone', 25, 'qd']] }) },
    { key: 'E7', group: 'E. Potassium and kidney function', tests: 'Potassium 3.3 on furosemide 80 mg, congested: low potassium handling and the diuretic.',
        patient: patient({ age: 69, sex: 'Male', bmi: 29, sbp: 122, dbp: 74, pulse: 80, nt: 3100, nyha: 'III', lvef: 30, dry: 88, excess: 3, findings: ['Edema (2+)', 'JVP Elevated'], egfr: 56, k: 3.3, drugs: [['Furosemide', 80, 'qd']] }) },

    // ---- F. Blood pressure and heart rate ----
    { key: 'F1', group: 'F. Blood pressure and heart rate', tests: 'Systolic pressure 96, no symptoms, low-dose therapy with gaps: how far low pressure limits titration.',
        patient: patient({ age: 60, sex: 'Male', bmi: 25, sbp: 96, dbp: 60, pulse: 80, nt: 1800, nyha: 'II', lvef: 25, dry: 76, egfr: 68, k: 4.4, drugs: [['Lisinopril', 2.5, 'qd'], ['Carvedilol', 3.125, 'bid']] }) },
    { key: 'F2', group: 'F. Blood pressure and heart rate', tests: 'Systolic pressure 86: how the tool treats very low blood pressure.',
        patient: patient({ age: 64, sex: 'Male', bmi: 24, sbp: 86, dbp: 54, pulse: 84, nt: 3500, nyha: 'III', lvef: 20, dry: 74, egfr: 50, k: 4.5, drugs: [['Lisinopril', 5, 'qd'], ['Carvedilol', 6.25, 'bid']] }) },
    { key: 'F3', group: 'F. Blood pressure and heart rate', tests: 'Heart rate 52 on carvedilol 25 mg twice daily: the slow-rate rule for a dose reduction.',
        patient: patient({ age: 68, sex: 'Male', bmi: 27, sbp: 122, dbp: 70, pulse: 52, nt: 1300, nyha: 'II', lvef: 30, dry: 84, egfr: 64, k: 4.5, drugs: [['Lisinopril', 20, 'qd'], ['Carvedilol', 25, 'bid']] }) },
    { key: 'F4', group: 'F. Blood pressure and heart rate', tests: 'Sinus rhythm 78 on a beta-blocker at target, ejection fraction 30: the ivabradine question.',
        patient: patient({ age: 58, sex: 'Male', bmi: 27, sbp: 116, dbp: 72, pulse: 78, nt: 1200, nyha: 'II', lvef: 30, dry: 80, egfr: 70, k: 4.5, drugs: [['Sacubitril/Valsartan (Entresto)', '97/103', 'bid'], ['Metoprolol Succinate', 200, 'qd'], ['Spironolactone', 25, 'qd'], ['Dapagliflozin', 10, 'qd']] }) },

    // ---- G. Volume ----
    { key: 'G2', group: 'G. Volume', tests: 'NYHA II, 3 kg above dry weight with two findings, on furosemide 40: whether the diuretic is stepped up.',
        patient: patient({ age: 64, sex: 'Male', bmi: 29, sbp: 126, dbp: 76, pulse: 76, nt: 2400, nyha: 'II', lvef: 30, dry: 90, excess: 3, findings: ['Edema (2+)', 'JVP Elevated'], egfr: 62, k: 4.5, drugs: [['Lisinopril', 10, 'qd'], ['Carvedilol', 12.5, 'bid'], ['Furosemide', 40, 'qd']] }) },
    { key: 'G3', group: 'G. Volume', tests: 'NYHA III, 4 kg above dry weight, three findings, on furosemide 80 twice daily: the acute decompensation definition.',
        patient: patient({ age: 72, sex: 'Male', bmi: 30, sbp: 118, dbp: 70, pulse: 88, nt: 5200, nyha: 'III', lvef: 25, dry: 92, excess: 4, findings: ['Edema (2+)', 'JVP Elevated', 'Crackles'], egfr: 48, k: 4.4, drugs: [['Lisinopril', 10, 'qd'], ['Furosemide', 80, 'bid']] }) },
    { key: 'G4', group: 'G. Volume', tests: 'NYHA IV with no recorded congestion: symptoms at rest without findings.',
        patient: patient({ age: 66, sex: 'Female', bmi: 26, sbp: 112, dbp: 70, pulse: 82, nt: 3800, nyha: 'IV', lvef: 30, dry: 68, egfr: 60, k: 4.4, drugs: [['Lisinopril', 10, 'qd'], ['Carvedilol', 12.5, 'bid']] }) },
    { key: 'G5', group: 'G. Volume', tests: 'Two kilograms below dry weight on furosemide 80 twice daily with rising creatinine: over-diuresis.',
        patient: patient({ age: 77, sex: 'Male', bmi: 26, sbp: 104, dbp: 60, pulse: 78, nt: 1900, nyha: 'II', lvef: 35, dry: 78, excess: -2, egfr: 38, k: 4.2, baseline_creatinine_ratio: 1 / 1.42, drugs: [['Lisinopril', 10, 'qd'], ['Carvedilol', 12.5, 'bid'], ['Furosemide', 80, 'bid']] }) },
    { key: 'G6', group: 'G. Volume', tests: 'NYHA II entered but 5 kg above dry weight with three findings: disagreement between the class and the examination.',
        patient: patient({ age: 69, sex: 'Male', bmi: 31, sbp: 130, dbp: 78, pulse: 84, nt: 3600, nyha: 'II', lvef: 25, dry: 96, excess: 5, findings: ['Edema (3+)', 'JVP Elevated', 'Crackles'], egfr: 58, k: 4.5, drugs: [['Lisinopril', 10, 'qd'], ['Carvedilol', 12.5, 'bid']] }) },

    // ---- H. Particular situations ----
    { key: 'H1', group: 'H. Particular situations', tests: 'Pregnancy with ejection fraction 30 on lisinopril and carvedilol.',
        patient: patient({ age: 31, sex: 'Female', bmi: 27, sbp: 110, dbp: 68, pulse: 84, nt: 1300, nyha: 'II', lvef: 30, dry: 72, egfr: 98, k: 4.1, pregnant: true, drugs: [['Lisinopril', 10, 'qd'], ['Carvedilol', 12.5, 'bid']] }) },
    { key: 'H2', group: 'H. Particular situations', tests: 'A woman of 40 with pregnancy status not recorded: the missing-information rule.',
        patient: patient({ age: 40, sex: 'Female', bmi: 28, sbp: 116, dbp: 72, pulse: 82, nt: 1100, nyha: 'II', lvef: 30, dry: 74, egfr: 92, k: 4.2, pregnant: 'not_recorded', drugs: [['Carvedilol', 6.25, 'bid']] }) },
    { key: 'H3', group: 'H. Particular situations', tests: 'Prior angioedema on an ACE inhibitor, now on a beta-blocker only: what replaces the blocked class.',
        patient: patient({ age: 56, sex: 'Male', race: 'Black', bmi: 28, sbp: 128, dbp: 80, pulse: 72, nt: 1500, nyha: 'II', lvef: 28, dry: 88, egfr: 68, k: 4.5, comorbidities: ['History of Angioedema'],
            intolerances: [{ name: 'Lisinopril', drug_class: 'ACEi', reason: 'Angioedema', reason_detail: 'Lip and tongue swelling after about two months; the drug was stopped.' }], drugs: [['Carvedilol', 12.5, 'bid']] }) },
    { key: 'H4', group: 'H. Particular situations', tests: 'A monthly budget of 20 dollars and no heart failure drug: the budget limit and the fallback.',
        patient: patient({ age: 63, sex: 'Male', bmi: 27, sbp: 126, dbp: 78, pulse: 76, nt: 1700, nyha: 'II', lvef: 28, dry: 82, egfr: 74, k: 4.4, budget: 20, cost_worry: 9, drugs: [] }) },
    { key: 'H5', group: 'H. Particular situations', tests: 'Iron deficiency (ferritin 60) and NYHA III on four classes: intravenous iron.',
        patient: patient({ age: 62, sex: 'Female', bmi: 28, sbp: 114, dbp: 70, pulse: 72, nt: 2100, nyha: 'III', lvef: 30, dry: 74, egfr: 58, k: 4.6, hb: 11.8, ferritin: 60, tsat: 14, drugs: [['Sacubitril/Valsartan (Entresto)', '49/51', 'bid'], ['Carvedilol', 12.5, 'bid'], ['Spironolactone', 25, 'qd'], ['Dapagliflozin', 10, 'qd']] }) },
    { key: 'H6', group: 'H. Particular situations', tests: 'Second-degree AV block without a pacemaker on carvedilol.',
        patient: patient({ age: 74, sex: 'Male', bmi: 27, sbp: 118, dbp: 70, pulse: 54, rhythm: '2nd Degree AV Block', nt: 1900, nyha: 'II', lvef: 35, dry: 82, egfr: 60, k: 4.5, drugs: [['Carvedilol', 12.5, 'bid']] }) },

    // ---- I. Information and scope ----
    { key: 'I1', group: 'I. Information and scope', tests: 'Potassium and kidney function not entered, new patient: what the tool withholds and what it asks for.',
        patient: patient({ age: 61, sex: 'Male', bmi: 27, sbp: 124, dbp: 78, pulse: 76, nt: 1500, nyha: 'II', lvef: 28, dry: 80, egfr: 0, k: 0, renal_blank: true, drugs: [] }) },
    { key: 'I2', group: 'I. Information and scope', tests: 'Cardiac amyloidosis ticked, with potassium 5.7: a condition outside the scope of the tool, and whether alerts about the current regimen still appear.',
        patient: patient({ age: 79, sex: 'Male', bmi: 25, sbp: 100, dbp: 64, pulse: 70, nt: 5600, nyha: 'III', lvef: 35, dry: 70, excess: 1.5, findings: ['Edema (1+)'], egfr: 45, k: 5.7, scope: ['Cardiac amyloidosis'], drugs: [['Carvedilol', 6.25, 'bid'], ['Furosemide', 40, 'qd']] }) },
    { key: 'I3', group: 'I. Information and scope', tests: 'The scope question left unanswered in an otherwise ordinary undertreated patient.',
        patient: patient({ age: 66, sex: 'Male', bmi: 28, sbp: 126, dbp: 78, pulse: 74, nt: 1400, nyha: 'II', lvef: 32, dry: 84, egfr: 66, k: 4.5, scope: 'not_answered', drugs: [['Carvedilol', 12.5, 'bid']] }) },

    // ---- J. One patient shown three times with the "What matters most" control changed ----
    // R6 V16a: the patient was FOUND by search (the previous one, an ACE inhibitor alone, gave the same first option under all three settings and so showed nothing): on three classes, worried about cost
    // (9 of 10), able to manage few pills (2 of 10), on Medicare with a $300 monthly budget, for whom each of the two settings gives a first option different from Balanced. buildPanelCases.ts fails if that stops being true.
    { key: 'J0', group: 'J. One patient, "What matters most" changed', tests: 'A patient on three classes who worries about cost and can manage few pills, with "What matters most" left at Balanced: the comparison case for the next two.',
        patient: patient(J_PATIENT) },
    { key: 'J1', group: 'J. One patient, "What matters most" changed', tests: 'The same patient as the Balanced case, with "Keep cost low": what the control changes.',
        patient: patient({ ...J_PATIENT, priority: 'cost_first' }) },
    { key: 'J2', group: 'J. One patient, "What matters most" changed', tests: 'The same patient as the Balanced case, with "Keep the regimen simple": what the control changes.',
        patient: patient({ ...J_PATIENT, priority: 'simplicity_first' }) },
];

/**
 * The order reviewers see. Fixed (not grouped, not sorted by topic) so the sequence does not reveal why a case was chosen. Case numbers are positions in this list.
 * `npm run panel:cases` and its check fail if this list is not exactly the set of case keys.
 */
export const PANEL_CASE_ORDER: string[] = [
    'E4', 'A1', 'H3', 'C2', 'G3', 'B1', 'D1', 'F1', 'I1', 'A5', 'E2', 'H4', 'C1', 'G5', 'A3', 'F3', 'H1', 'B3', 'E6', 'D2', 'I3', 'C4',
    'A2', 'G2', 'H5', 'E1', 'F4', 'A6', 'J1', 'C3', 'G4', 'H6', 'E3', 'D3', 'B4', 'F2', 'E5', 'A4', 'G6', 'C5', 'I2', 'H2', 'E7', 'J2',
    'J0',
];
