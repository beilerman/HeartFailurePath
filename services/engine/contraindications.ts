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
