/** Documented-intolerance policy: what a patient's discontinued_meds history forbids. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, Medication, ExcludedMedication } from '../../types';
import { drugFacts } from './drugFacts';
import { MEDICATION_FORMULARY } from '../../constants';
import { MRA_POOL_CLASSES, RAAS_CLASSES, getMedicationClassGroup } from './registry';

// Re-exported so the eligibility rules (and any caller) can take every intolerance helper from one module.
export { MRA_POOL_CLASSES };
import { clonePatient } from './regimenUtils';

// When renal data is missing (blank eGFR/creatinine → the 0 sentinel), every `egfr < X`
// contraindication in the formulary evaluates TRUE — blank data must not read as end-stage
// CKD (mass "Clinical Contraindication" exclusions and forced deprescription of working
// therapy). Detects whether a med's contraindication is RENAL-DRIVEN by re-evaluating it
// against a renal-neutral clone: contraindicated with the real data but clean with neutral
// renal values ⇒ the only trigger was the blank renal field.
export function isRenalOnlyContraindication(med: Medication, patient: Patient): boolean {
    if (!med.contraindications || !med.contraindications(patient)) return false;
    const renalNeutral = clonePatient(patient);
    renalNeutral.egfr = 90;
    renalNeutral.creatinine = 1.0;
    return !med.contraindications(renalNeutral);
}

// --- Delta-from-Current Analysis ---

// --- Documented-intolerance policy -------------------------------------------------------------
// Single source of truth for what a patient's discontinued_meds history forbids. Used by BOTH the
// formulary filter (blocking NEW starts) and analyzeCurrentRegimen (cleaning up meds the patient
// ARRIVED on) — previously only new starts were filtered, so a class excluded from initiation
// could still be retained/titrated when already on board (100-scenario audit, findings 072/073).
//
// TWO EVIDENCE TIERS per intolerance. `suspected` matches keywords anywhere in the free-text
// reason + reason_detail and only BLOCKS NEW STARTS (conservative: withholding a new drug on weak
// evidence is safe). `confirmed` requires the keyword in the STRUCTURED reason field (the UI's
// side-effect dropdown) and additionally FORCES CLEANUP of the current regimen — actively
// changing working therapy needs the higher evidence bar, because free-text details like
// "patient denies cough" or "hyperkalemia ruled out" substring-match their negated keyword.
export interface IntoleranceSignal { suspected: boolean; confirmed: boolean; }

export interface IntolerancePolicy {
    angioedema: IntoleranceSignal;        // ACEi + ARNI forbidden; ARB allowed with caution
    aceiCough: IntoleranceSignal;         // ACEi forbidden; ARB/ARNI remain acceptable
    mraHyperkalemia: IntoleranceSignal;   // all MRA types (steroidal + nsMRA) forbidden
    // Gynecomastia is agent-specific antiandrogenic toxicity, NOT a class effect: spironolactone
    // (and any specifically named offender) is avoided, while non-offending selective agents
    // (eplerenone, finerenone) remain acceptable — preserves the MRA pillar.
    gynecomastiaAvoidedMeds: Set<string>;          // suspected tier (blocks new starts)
    confirmedGynecomastiaAvoidedMeds: Set<string>; // confirmed tier (forces current-regimen cleanup)
    hasBbBradycardia: boolean;            // defer NEW BB initiation only — existing BB is continued
    hasBbBronchospasm: boolean;           // avoid non-selective carvedilol; β1-selective acceptable
    hasGlp1GiIntolerance: boolean;        // new starts only — a currently tolerated GLP-1 is kept
}

export function deriveIntolerancePolicy(patient: Patient): IntolerancePolicy {
    const discontinued = patient.discontinued_meds;
    // Drug-class-aware attribution: only match a side effect against the drug class that
    // plausibly caused it (prevents e.g. a beta-blocker's bradycardia excluding a RAAS inhibitor).
    const raasDiscontinued = discontinued.filter(m => RAAS_CLASSES.has(m.drug_class) || m.drug_class === 'RAAS');
    const mraDiscontinued = discontinued.filter(m => MRA_POOL_CLASSES.has(m.drug_class));
    const bbDiscontinued = discontinued.filter(m => m.drug_class === 'Beta Blocker');
    const glp1Discontinued = discontinued.filter(m => getMedicationClassGroup(m.drug_class) === 'GLP-1 Therapy');

    const matchesFreeText = (dm: ExcludedMedication, keyword: string) =>
        `${dm.reason} ${dm.reason_detail ?? ''}`.toLowerCase().includes(keyword);
    const matchesStructuredReason = (dm: ExcludedMedication, keyword: string) =>
        dm.reason.toLowerCase().includes(keyword);
    const signal = (meds: ExcludedMedication[], ...keywords: string[]): IntoleranceSignal => ({
        suspected: meds.some(dm => keywords.some(k => matchesFreeText(dm, k))),
        confirmed: meds.some(dm => keywords.some(k => matchesStructuredReason(dm, k))),
    });

    // Spironolactone carries the dominant antiandrogenic burden — avoid it whenever ANY MRA
    // caused gynecomastia, even if the documented offender was a different agent.
    const collectGynecomastiaOffenders = (match: (dm: ExcludedMedication, k: string) => boolean) => {
        const offenders = new Set(mraDiscontinued.filter(dm => match(dm, 'gynecomastia')).map(dm => dm.name));
        if (offenders.size > 0) MEDICATION_FORMULARY.filter(m => drugFacts(m).antiandrogenic).forEach(m => offenders.add(m.name));
        return offenders;
    };

    // A structured "History of Angioedema" comorbidity is confirmed-tier evidence.
    const angioedema = signal(raasDiscontinued, 'angioedema');
    if (patient.comorbidities.has("History of Angioedema")) {
        angioedema.suspected = true;
        angioedema.confirmed = true;
    }

    return {
        angioedema,
        aceiCough: signal(raasDiscontinued, 'cough'),
        mraHyperkalemia: signal(mraDiscontinued, 'hyperkalemia'),
        gynecomastiaAvoidedMeds: collectGynecomastiaOffenders(matchesFreeText),
        confirmedGynecomastiaAvoidedMeds: collectGynecomastiaOffenders(matchesStructuredReason),
        hasBbBradycardia: bbDiscontinued.some(dm => matchesFreeText(dm, 'bradycardia') || matchesFreeText(dm, 'av block') || matchesFreeText(dm, 'heart block')),
        hasBbBronchospasm: bbDiscontinued.some(dm => matchesFreeText(dm, 'bronchospasm') || matchesFreeText(dm, 'asthma') || matchesFreeText(dm, 'wheez')),
        hasGlp1GiIntolerance: glp1Discontinued.some(dm => matchesFreeText(dm, 'nausea') || matchesFreeText(dm, 'vomit') || matchesFreeText(dm, 'gastrointestinal') || matchesFreeText(dm, 'gi intolerance') || matchesFreeText(dm, 'diarrhea')),
    };
}

// Reason an ALREADY-PRESCRIBED med violates the intolerance policy (null = tolerated). Uses the
// CONFIRMED tier only (structured dropdown reason) — free-text matches never alter the current
// regimen. Scope is deliberately narrower than the new-start filter: BB intolerance defers
// initiation but an existing BB is continued (abrupt withdrawal = Class III harm), and a
// currently-tolerated GLP-1 is not removed for a historical GI intolerance to a prior agent.
// Reasons state the intolerance only — the replacement (if any) is shown by the swap itself.
export function currentMedIntoleranceReason(med: Medication, policy: IntolerancePolicy): string | null {
    if (med.drug_class === 'ACEi' && policy.angioedema.confirmed) {
        return 'Documented angioedema history — ACEi must not be continued';
    }
    if (med.drug_class === 'ACEi' && policy.aceiCough.confirmed) {
        return 'Documented ACEi cough intolerance';
    }
    if (med.drug_class === 'ARNI' && policy.angioedema.confirmed) {
        return 'Documented angioedema history — neprilysin inhibition worsens bradykinin-mediated angioedema risk';
    }
    if (MRA_POOL_CLASSES.has(med.drug_class) && policy.mraHyperkalemia.confirmed) {
        return 'Documented hyperkalemia on MRA therapy — applies to all MRA types';
    }
    if (MRA_POOL_CLASSES.has(med.drug_class) && policy.confirmedGynecomastiaAvoidedMeds.has(med.name)) {
        return 'Documented gynecomastia — antiandrogenic agent avoided';
    }
    return null;
}
