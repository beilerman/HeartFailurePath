/**
 * Contraindication checks: the single source for each formulary drug's "do not offer" rule.
 *
 * A formulary entry declares `...ci([ { reason, when }, ... ])`. The boolean the engine calls
 * (`med.contraindications(patient)`) is DERIVED from the checks (`checks.some(c => c.when(p))`), so the
 * human-readable reasons shown in the UI (E13 "Why:" list, formulary "Not offered when") can never drift
 * from the decision. Checks run in declaration order and short-circuit exactly like the OR-chain they
 * replaced; each `when` keeps the original expression verbatim, including its blank/sentinel-value
 * semantics (e.g. `p.potassium > 5.4` is false for a blank 0).
 *
 * No engine imports here: constants.ts (the formulary) imports this module.
 */
import type { Patient, Medication, ContraindicationCheck } from '../../types';

/** Spread into a formulary entry: `...ci([...])` sets both `contraindication_checks` and `contraindications`. */
export const ci = (checks: ContraindicationCheck[]) => ({
    contraindication_checks: checks,
    contraindications: (p: Patient): boolean => checks.some(c => c.when(p)),
});

/** Reasons of every check that fires for this patient (formulary order); [] when none. */
export function contraindicationReasons(med: Medication, patient: Patient): string[] {
    return (med.contraindication_checks ?? []).filter(c => c.when(patient)).map(c => c.reason);
}

// Shared checks (the same condition across a drug class is defined once).
export const CI_ANGIOEDEMA: ContraindicationCheck = {
    reason: 'History of angioedema', when: p => p.comorbidities.has("History of Angioedema"),
};
export const CI_POTASSIUM_GT_5_4: ContraindicationCheck = {
    reason: 'Potassium above 5.4 mEq/L', when: p => p.potassium > 5.4,
};
export const CI_BILATERAL_RAS: ContraindicationCheck = {
    reason: 'Bilateral renal artery stenosis', when: p => p.comorbidities.has("Bilateral Renal Artery Stenosis"),
};
export const CI_LIVER_CHILD_PUGH_BC: ContraindicationCheck = {
    reason: 'Liver disease, Child-Pugh B/C', when: p => p.comorbidities.has("Liver Disease (Child-Pugh B/C)"),
};
export const CI_PULSE_LT_55: ContraindicationCheck = {
    reason: 'Heart rate below 55 bpm', when: p => p.pulse < 55,
};
export const CI_AV_BLOCK_2: ContraindicationCheck = {
    reason: 'Second-degree AV block', when: p => p.rhythm === '2nd Degree AV Block',
};
export const CI_AV_BLOCK_3: ContraindicationCheck = {
    reason: 'Third-degree AV block', when: p => p.rhythm === '3rd Degree AV Block',
};
export const CI_SEVERE_ASTHMA: ContraindicationCheck = {
    reason: 'Severe asthma / bronchospasm', when: p => p.comorbidities.has("Severe Asthma / Bronchospasm"),
};
export const CI_TYPE1_OR_DKA: ContraindicationCheck = {
    reason: 'Type 1 diabetes or prior DKA / euglycemic DKA',
    when: p => p.comorbidities.has("Type 1 Diabetes Mellitus") || p.comorbidities.has("Prior DKA / Euglycemic DKA"),
};
export const CI_MTC_MEN2: ContraindicationCheck = {
    reason: 'Medullary thyroid carcinoma or MEN2 syndrome (FDA boxed warning)',
    when: p => p.comorbidities.has('Medullary Thyroid Carcinoma') || p.comorbidities.has('MEN2 Syndrome'),
};

/** Pregnancy check; `why` is the rationale the formulary entry already states (e.g. 'Category X'). */
export const pregnancyCheck = (why?: string): ContraindicationCheck => ({
    reason: why ? `Pregnancy (${why})` : 'Pregnancy', when: p => p.is_pregnant === true,
});

// --- CYP3A interaction lists (shared by eplerenone and finerenone) ---------------------------------
// Matched by name in `patient.external_medications` (the form's "Other medications" list).
// Strong CYP3A inhibitors: the eplerenone (Inspra) label names ketoconazole, itraconazole, nefazodone,
// troleandomycin, clarithromycin, ritonavir and nelfinavir as examples and contraindicates them; the
// finerenone (Kerendia) label contraindicates strong CYP3A4 inhibitors generally (ketoconazole,
// itraconazole, clarithromycin, ritonavir among them). Cobicistat is a strong CYP3A inhibitor that the
// label text read for the 2026-11-10 review did not name: included as a class-effect extra (flagged).
export const STRONG_CYP3A_INHIBITORS: readonly string[] = [
    'Ketoconazole', 'Itraconazole', 'Nefazodone', 'Troleandomycin', 'Clarithromycin', 'Ritonavir', 'Nelfinavir',
    'Cobicistat',
];
// Moderate CYP3A inhibitors: eplerenone in HF must not exceed 25 mg daily with one (Inspra label);
// finerenone only needs potassium monitoring (Kerendia: erythromycin AUC +248%, verapamil +170%).
// The label text read named no moderate agents for eplerenone; this is the standard list used in the review.
export const MODERATE_CYP3A_INHIBITORS: readonly string[] = ['Verapamil', 'Diltiazem', 'Erythromycin', 'Fluconazole'];

const onAny = (p: Patient, names: readonly string[]): boolean =>
    names.some(n => p.external_medications?.has(n) ?? false);
export const strongCyp3a4Inhibitor = (p: Patient): boolean => onAny(p, STRONG_CYP3A_INHIBITORS);
export const moderateCyp3aInhibitor = (p: Patient): boolean =>
    onAny(p, MODERATE_CYP3A_INHIBITORS) || p.comorbidities.has('On Verapamil/Diltiazem');

export const CI_STRONG_CYP3A: ContraindicationCheck = {
    reason: 'Taking a strong CYP3A4 inhibitor (ketoconazole, itraconazole, clarithromycin, ritonavir, nelfinavir, nefazodone, troleandomycin, cobicistat)',
    when: strongCyp3a4Inhibitor,
};
export const CI_ADRENAL_INSUFFICIENCY: ContraindicationCheck = {
    reason: "Adrenal insufficiency (Addison's disease)",
    when: p => p.comorbidities.has("Adrenal Insufficiency (Addison's disease)"),
};

// --- MRA potassium gates ----------------------------------------------------------------------------
/** True when the patient is already taking this exact drug (initiation-vs-continuation carve-out). */
export const alreadyOnMed = (p: Patient, name: string): boolean =>
    p.current_regimen?.some(r => r.med.name === name) ?? false;

/**
 * NEW-START potassium ceiling for an MRA: above 5.5 mEq/L is never started. The labels and guideline say
 * to start only at K+ 5.0 or below (eplerenone's label allows up to 5.5); the engine deliberately allows a
 * start at 5.0-5.5 ONLY together with a potassium binder, with a sequencing warning (see the DIAMOND
 * pathway in scoring.ts and eligibility rule E15). Blank potassium (0) is never a value.
 */
export const mraStartPotassiumCheck = (name: string): ContraindicationCheck => ({
    reason: 'Potassium above 5.5 mEq/L (new start)',
    when: p => !alreadyOnMed(p, name) && p.potassium > 5.5,
});
/** Withhold an MRA already on board at K+ 6.0 or above (eplerenone and finerenone labels; spironolactone by analogy). */
export const CI_MRA_WITHHOLD_K6: ContraindicationCheck = {
    reason: 'Potassium 6.0 mEq/L or above: withhold the MRA (label rule; restart at a low dose once potassium is below 5.5)',
    when: p => p.potassium >= 6.0,
};
