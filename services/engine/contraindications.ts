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
import { assessCreatinineChange } from './renalChange';
import { MRA_START_EGFR_MAX, MRA_START_K_MAX, RAAS_START_K_MAX, RAAS_WITHHOLD_K } from './thresholds';

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
/** Anuria: a label contraindication of furosemide (incl. Furoscix), metolazone and hydrochlorothiazide (verified-diuretics.md). The app has no urine-output field; the comorbidity option "Anuria" records it. */
export const ANURIA = 'Anuria';
export const CI_ANURIA: ContraindicationCheck = {
    reason: 'Anuria (label contraindication)', when: p => p.comorbidities.has(ANURIA),
};
/**
 * RAAS inhibitor potassium checks (2026 ESC section 6.1; thresholds.ts). Spread into the entry: `...raasPotassiumChecks('Lisinopril')`.
 * Two checks: a NEW start (or swap-in) above 5.4 is blocked ("caution" above 5.2 in ESC); a drug already on board is withheld at 6.0 or above.
 * There is deliberately NO current-eGFR stop here: ESC Table S4 says stop when eGFR FALLS below 20 (a change from baseline), the tool has no baseline, so eGFR below
 * 20 on a RAAS inhibitor raises an alert instead (gates.ts, RAAS_EGFR_REVIEW_BELOW). Between them a current RAAS inhibitor is kept and handled by facts.k_continuation (one step down from 5.5), never removed at 5.5-5.9.
 */
/**
 * Change from a baseline creatinine (optional input; renalChange.ts): over 100% above baseline, or 50% or more with eGFR below 20, stops the RAAS inhibitor and withholds the MRA
 * (2026 ESC Supplementary Tables S4/S5/S8, "stop and seek specialist advice"). It also blocks a NEW start. Never fires without a baseline creatinine.
 */
export const creatinineRiseStopCheck = (kind: 'RAAS inhibitor' | 'MRA'): ContraindicationCheck => ({
    reason: `Creatinine rise from baseline requires stopping the ${kind}: more than 100% above baseline, or 50% or more with eGFR below 20 (2026 ESC Supplementary Tables S4/S5/S8): ${kind === 'MRA' ? 'withhold the MRA' : 'stop the RAAS inhibitor'} and seek specialist advice`,
    when: p => assessCreatinineChange(p)?.band === 'stop',
});
export const raasPotassiumChecks = (name: string): ContraindicationCheck[] => [
    { reason: `Potassium above ${RAAS_START_K_MAX} mEq/L (new start; 2026 ESC advises caution above 5.2)`, when: p => !alreadyOnMed(p, name) && p.potassium > RAAS_START_K_MAX },
    { reason: `Potassium ${RAAS_WITHHOLD_K.toFixed(1)} mEq/L or above: stop the RAAS inhibitor (2026 ESC: severe hyperkalaemia leads to temporary discontinuation)`, when: p => p.potassium >= RAAS_WITHHOLD_K },
    creatinineRiseStopCheck('RAAS inhibitor'),
];
export const CI_BILATERAL_RAS: ContraindicationCheck = {
    reason: 'Bilateral renal artery stenosis', when: p => p.comorbidities.has("Bilateral Renal Artery Stenosis"),
};
/**
 * Hepatic status. The form has one general option, "Liver Disease (Child-Pugh B/C)", which every drug that gates
 * on liver disease reads as the conservative "B or C". A second option confirms the severity is Child-Pugh B
 * (not C); only the ARNI reads it (label: B = reduced start with caution, C = not recommended). Selecting the
 * B-confirmed option alone still counts as liver disease for every other drug (`hasChildPughBorC`).
 */
export const LIVER_BC = "Liver Disease (Child-Pugh B/C)";
export const LIVER_B_CONFIRMED = "Liver Disease: Child-Pugh B confirmed (not C)";
export const hasChildPughBorC = (p: Patient): boolean => p.comorbidities.has(LIVER_BC) || p.comorbidities.has(LIVER_B_CONFIRMED);
export const hasChildPughBConfirmed = (p: Patient): boolean => p.comorbidities.has(LIVER_B_CONFIRMED);
export const CI_LIVER_CHILD_PUGH_BC: ContraindicationCheck = {
    reason: 'Liver disease, Child-Pugh B/C', when: hasChildPughBorC,
};
/** Aliskiren in diabetes: contraindicated with ARNI, ACE inhibitors and ARBs (Entresto and Zestril labels, section 4). */
export const ALISKIREN = 'Aliskiren';
export const CI_ALISKIREN_DIABETES: ContraindicationCheck = {
    reason: 'Taking aliskiren with diabetes (labeled contraindication with ARNI, ACE inhibitors and ARBs)',
    when: p => (p.external_medications?.has(ALISKIREN) ?? false)
        && (p.comorbidities.has('Diabetes Mellitus Type 2') || p.comorbidities.has('Type 1 Diabetes Mellitus')),
};
/**
 * True when the patient is already taking this exact drug (initiation-vs-continuation carve-out). Declared here (before
 * its first use) and re-used by the MRA potassium gates below.
 */
export const alreadyOnMed = (p: Patient, name: string): boolean =>
    p.current_regimen?.some(r => r.med.name === name) ?? false;

/**
 * Beta-blocker NEW-START heart-rate block (initiation only). The labels give no number: carvedilol and metoprolol
 * succinate contraindicate "severe bradycardia" and bisoprolol "marked sinus bradycardia". Below 55 bpm as the start
 * threshold is ENGINE POLICY (carvedilol's label uses 55 only as the dose-reduction trigger). A patient already on the
 * drug is never blocked here: bradycardia on established therapy is handled by `facts.hr_continuation` (one-step dose
 * reduction), not removal (verified-rate-control.md finding A). A paced rhythm sets a floor under the rate, so the
 * intrinsic-rate block does not apply (carvedilol label: severe bradycardia is a contraindication "unless a permanent
 * pacemaker is in place"). A blank pulse (0) still blocks a new start, as before.
 */
export const bbStartBradycardiaCheck = (name: string, below: number, basis: string): ContraindicationCheck => ({
    reason: `Heart rate below ${below} bpm: do not START a beta-blocker (${basis}; an established beta-blocker is dose-reduced, not stopped)`,
    when: p => !alreadyOnMed(p, name) && p.rhythm !== 'Paced' && p.pulse < below,
});
export const SICK_SINUS = 'Sick Sinus Syndrome / Sinoatrial Block';
/**
 * Sick sinus syndrome or sinoatrial block without a pacemaker: contraindication on the carvedilol and metoprolol
 * succinate labels. The form's rhythm "Paced" is read as a functioning pacemaker.
 */
export const CI_SICK_SINUS_NO_PACEMAKER: ContraindicationCheck = {
    reason: 'Sick sinus syndrome / sinoatrial block without a pacemaker (labeled beta-blocker contraindication)',
    when: p => p.comorbidities.has(SICK_SINUS) && p.rhythm !== 'Paced',
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
    // ENGINE-CONSERVATIVE, not a label contraindication: the Farxiga and Jardiance labels contraindicate only serious hypersensitivity
    // (type 1 diabetes is a limitation of use for glycemic control; ketoacidosis is a warning). verified-sglt2-glp1-adjuncts.md row 7.
    reason: 'Type 1 diabetes or prior DKA / euglycemic DKA (engine-conservative choice: the label contraindicates only hypersensitivity)',
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

/** External medications that are harmful in heart failure (2026 ESC): NSAIDs and COX-2 inhibitors are Class III; thiazolidinediones and saxagliptin are contraindicated (section 10.2). Matched by name in the form's "Other medications" list. */
export const NSAID_COX2_EXTERNAL: readonly string[] = ['Ibuprofen', 'Naproxen', 'Diclofenac', 'Meloxicam', 'Celecoxib'];
export const TZD_SAXAGLIPTIN_EXTERNAL: readonly string[] = ['Pioglitazone', 'Rosiglitazone', 'Saxagliptin'];

export const onAny = (p: Patient, names: readonly string[]): boolean =>
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
/**
 * NEW-START potassium ceiling for an MRA: above 5.5 mEq/L is never started. The labels and guideline say
 * to start only at K+ 5.0 or below (eplerenone's label allows up to 5.5); the engine deliberately allows a
 * start at 5.0-5.5 ONLY together with a potassium binder, with a sequencing warning (see the DIAMOND
 * pathway in scoring.ts and eligibility rule E15). Blank potassium (0) is never a value.
 */
export const mraStartPotassiumCheck = (name: string): ContraindicationCheck => ({
    reason: 'Potassium above 5.5 mEq/L (new start)',
    when: p => !alreadyOnMed(p, name) && p.potassium > MRA_START_K_MAX,
});
/** NEW steroidal MRA start contraindicated at eGFR 30 or below (2022 AHA/ACC/HFSA 7.3.3); a drug already on board is not removed by this check. Blank eGFR (0) is handled by the renal-only probe (rule E12). */
export const mraStartEgfrCheck = (name: string): ContraindicationCheck => ({
    reason: 'eGFR 30 or below (new start; 2022 AHA/ACC/HFSA: contraindication to MRA initiation)',
    when: p => !alreadyOnMed(p, name) && p.egfr <= MRA_START_EGFR_MAX,
});
/** Withhold an MRA already on board at K+ 6.0 or above (eplerenone and finerenone labels; spironolactone by analogy). */
export const CI_MRA_WITHHOLD_K6: ContraindicationCheck = {
    reason: 'Potassium 6.0 mEq/L or above: withhold the MRA (label rule; restart at a low dose once potassium is below 5.5)',
    when: p => p.potassium >= 6.0,
};

// --- Ivabradine, digoxin, carvedilol label checks (verified-rate-control.md) ----------------------------------
export const VENTRICULAR_FIBRILLATION = 'Ventricular Fibrillation (active)';
export const WPW = 'Wolff-Parkinson-White / Accessory Pathway';
export const CONDUCTION_DEFECT = 'Conduction Defect (history)';

/** Strong CYP3A4 inhibitors named on the Corlanor label (adds telithromycin to the shared eplerenone/finerenone list). */
export const IVABRADINE_STRONG_CYP3A4 = [...STRONG_CYP3A_INHIBITORS, 'Telithromycin'] as const;
/** CYP3A4 inducers the Corlanor label says to avoid (reduce ivabradine exposure): St John's wort, rifampin, barbiturates, phenytoin. */
export const CYP3A4_INDUCERS: readonly string[] = ["St John's Wort", 'Rifampin', 'Phenobarbital', 'Phenytoin'];
export const strongIvabradineCyp3a4 = (p: Patient): boolean => onAny(p, IVABRADINE_STRONG_CYP3A4);
export const onCyp3a4Inducer = (p: Patient): boolean => onAny(p, CYP3A4_INDUCERS);
export const onVerapamilOrDiltiazem = (p: Patient): boolean =>
    onAny(p, ['Verapamil', 'Diltiazem']) || p.comorbidities.has('On Verapamil/Diltiazem');
export const onAmiodarone = (p: Patient): boolean => onAny(p, ['Amiodarone']) || p.comorbidities.has('On Amiodarone');

/**
 * "Severe hepatic impairment" (carvedilol and ivabradine labels: contraindicated; the labels name no Child-Pugh class, ivabradine says
 * Child-Pugh C). The general "Child-Pugh B/C" option cannot say which, so it stays excluded; "Child-Pugh B confirmed (not C)" lifts the
 * exclusion (the drug is then used with the hepatic caution warning). Same pattern as the ARNI.
 */
export const CI_SEVERE_HEPATIC_UNSPECIFIED = (drug: string): ContraindicationCheck => ({
    reason: `Liver disease, Child-Pugh B/C with severity not specified: ${drug} is contraindicated in severe hepatic impairment; if the patient is Child-Pugh B, select "Child-Pugh B confirmed (not C)" to allow it with caution`,
    when: p => hasChildPughBorC(p) && !hasChildPughBConfirmed(p),
});

// --- PDE5 inhibitors, sGC stimulators, long-acting nitrates (verified-sglt2-glp1-adjuncts.md rows 22, 42) ---------------------------
/** PDE-5 inhibitors named in the BiDil label contraindication (avanafil, sildenafil, tadalafil, vardenafil). Matched by name in `external_medications`. */
export const PDE5_INHIBITORS: readonly string[] = ['Sildenafil', 'Tadalafil', 'Avanafil', 'Vardenafil'];
export const onPde5Inhibitor = (p: Patient): boolean => onAny(p, PDE5_INHIBITORS);
/** Soluble guanylate cyclase stimulators other than vericiguat: contraindicated with vericiguat (Verquvo label) and with H/ISDN (BiDil label). */
export const OTHER_SGC_STIMULATORS: readonly string[] = ['Riociguat'];
export const onOtherSgcStimulator = (p: Patient): boolean => onAny(p, OTHER_SGC_STIMULATORS);
/** Long-acting nitrates taken outside the formulary: VICTORIA excluded them (the label does not prohibit the combination). */
export const LONG_ACTING_NITRATES: readonly string[] = ['Isosorbide Mononitrate', 'Isosorbide Dinitrate'];
export const onLongActingNitrate = (p: Patient): boolean => onAny(p, LONG_ACTING_NITRATES);
