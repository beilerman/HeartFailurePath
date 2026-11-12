/** Documented-intolerance policy: what a patient's discontinued_meds history forbids. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, Medication, ExcludedMedication, RegimenModification } from '../../types';
import { drugFacts } from './drugFacts';
import { MEDICATION_FORMULARY } from '../../constants';
import { MRA_POOL_CLASSES, RAAS_CLASSES, DIURETIC_CLASSES, DRUG_CLASS_REGISTRY, getMedicationClassGroup } from './registry';

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
    // Angioedema typed in the ALLERGY box ("lisinopril angioedema", "angioedema with ACE inhibitor") is the same history: confirmed tier. Before 2026-11-12 only
    // the comorbidity and the documented-intolerance entry were read, so an ACE inhibitor "allergy" was switched to sacubitril/valsartan (review 3).
    if (patient.comorbidities.has("History of Angioedema") || [...patient.allergies].some(a => /angio-?(o)?edema/i.test(a))) {
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

// =================================================================================================
// INTOLERANCE TABLE: what each documented side-effect reason does to drugs OTHER than the named one.
// One entry per string in COMMON_SIDE_EFFECTS (constants.ts); verify fails if one is missing, so a reason the
// form offers can never again be silently ignored. The named drug itself is always withheld (rule E01).
//   exclude      : other drugs are withheld (enforced by deriveIntolerancePolicy above; the row states it for the form and the test)
//   caution      : other drugs stay eligible; an option that STARTS a drug of an affected class carries a
//                  warning beginning INTOLERANCE_CAUTION_PREFIX (not score-penalized: scoreModel NON_PENALIZED_WARNING_MARKERS)
//   history_flag : the reason is read as a patient-level history (gout) by the rules that already use it
// Offender classes not covered by any rule fall under `drug_only_reason`: only the named drug is withheld, and why.
// Cautions use the STRUCTURED reason only (the dropdown), like current-regimen cleanup: free text can say "no cough".
// =================================================================================================
export const INTOLERANCE_CAUTION_PREFIX = 'Intolerance history:';
export type IntoleranceEffect = 'exclude' | 'caution' | 'history_flag';

export interface IntoleranceRule {
    /** Classes of the DRUG THAT CAUSED the reaction this rule applies to ('any' = every class). */
    offenders: 'any' | ReadonlySet<string>;
    effect: IntoleranceEffect;
    /** Classes the effect lands on ('same_group' = the offender's own class group). Informational for 'exclude' (enforced above) and 'history_flag'. */
    affects: 'same_group' | ReadonlySet<string>;
    /** Plain words for the form: the noun phrase after "Caution on" / "Also excludes", or the whole sentence for a history_flag. */
    label: string;
    /** Caution text ('caution' only): what to do on a new start. */
    advice?: string;
}
export interface IntoleranceEntry {
    reason: string;
    rules: readonly IntoleranceRule[];
    /** What happens to everything not covered by a rule (the named drug is always withheld) and the clinical reason. */
    drug_only_reason: string;
}

const BB_CLASSES: ReadonlySet<string> = new Set(['Beta Blocker']);
const RAAS_MRA_CLASSES: ReadonlySet<string> = new Set([...RAAS_CLASSES, ...MRA_POOL_CLASSES]);
const LOOP_THIAZIDE_CLASSES: ReadonlySet<string> = new Set(['Loop Diuretic', 'Thiazide-like Diuretic']);
const ACEI_CLASSES: ReadonlySet<string> = new Set(['ACEi']);
const GLP1_CLASSES: ReadonlySet<string> = new Set(['GLP-1 RA', 'GLP-1/GIP RA']);
const GI_GLP1_REASON = 'gastrointestinal intolerance is agent- and dose-related except for GLP-1 therapies, where it is the class limiting effect';

export const INTOLERANCE_TABLE: readonly IntoleranceEntry[] = [
    { reason: 'Angioedema', drug_only_reason: 'angioedema is a bradykinin effect of RAAS and neprilysin inhibition; other classes are not implicated',
      rules: [{ offenders: RAAS_CLASSES, effect: 'exclude', affects: new Set(['ACEi', 'ARNI']), label: 'ACE inhibitors and sacubitril/valsartan (ARBs stay allowed with a warning)' }] },
    { reason: 'Cough', drug_only_reason: 'cough is a bradykinin effect of ACE inhibitors; ARBs and ARNI do not share it',
      rules: [{ offenders: ACEI_CLASSES, effect: 'exclude', affects: ACEI_CLASSES, label: 'other ACE inhibitors' }] },
    { reason: 'Hyperkalemia', drug_only_reason: 'potassium retention is specific to RAAS inhibitors and MRAs (rules above); other classes are not implicated',
      rules: [
        { offenders: MRA_POOL_CLASSES, effect: 'exclude', affects: MRA_POOL_CLASSES, label: 'all MRAs (steroidal and non-steroidal)' },
        { offenders: RAAS_CLASSES, effect: 'caution', affects: RAAS_CLASSES, label: 'other RAAS inhibitors', advice: 'recheck potassium in 1-2 weeks' },
      ] },
    { reason: 'Hypotension', drug_only_reason: 'every class is covered by the same-class caution rule',
      rules: [{ offenders: 'any', effect: 'caution', affects: 'same_group', label: 'other drugs of the same class', advice: 'start at the lowest dose and recheck blood pressure' }] },
    { reason: 'Bradycardia', drug_only_reason: 'heart-rate rules (facts.hr_continuation, the beta-blocker start check) already govern ivabradine and digoxin',
      rules: [{ offenders: BB_CLASSES, effect: 'exclude', affects: BB_CLASSES, label: 'new beta-blocker starts (a beta-blocker already taken is continued)' }] },
    { reason: 'Renal Impairment / AKI', drug_only_reason: 'one kidney event is tied to the hemodynamics and potassium handling of RAAS inhibitors, MRAs and diuretics; SGLT2 inhibitors and beta-blockers are not implicated',
      rules: [
        { offenders: RAAS_MRA_CLASSES, effect: 'caution', affects: RAAS_MRA_CLASSES, label: 'other RAAS inhibitors and MRAs', advice: 'recheck creatinine and potassium in 1-2 weeks' },
        { offenders: DIURETIC_CLASSES, effect: 'caution', affects: 'same_group', label: 'other diuretics of the same class', advice: 'recheck creatinine and electrolytes in 1-2 weeks' },
      ] },
    { reason: 'Gout / Hyperuricemia', drug_only_reason: 'read as gout history (hasGoutHistory); no other drug is withheld',
      rules: [{ offenders: 'any', effect: 'history_flag', affects: DIURETIC_CLASSES, label: 'Counts as gout: loop and thiazide-type diuretics (which raise uric acid) lose points and carry a gout note.' }] },
    { reason: 'Gynecomastia', drug_only_reason: 'the antiandrogenic breast effect belongs to steroidal MRAs, not to other classes',
      rules: [{ offenders: MRA_POOL_CLASSES, effect: 'exclude', affects: MRA_POOL_CLASSES, label: 'spironolactone (eplerenone and finerenone stay allowed)' }] },
    { reason: 'Severe Fatigue', drug_only_reason: 'fatigue on a non-beta-blocker is too nonspecific to carry to its class',
      rules: [{ offenders: BB_CLASSES, effect: 'caution', affects: BB_CLASSES, label: 'other beta-blockers', advice: 'start at the lowest dose and ask about fatigue at the first visit' }] },
    { reason: 'Bronchospasm / Asthma Exacerbation', drug_only_reason: 'bronchospasm is a beta-blocker (beta-2) effect',
      rules: [{ offenders: BB_CLASSES, effect: 'exclude', affects: BB_CLASSES, label: 'carvedilol (beta-1-selective agents stay allowed)' }] },
    { reason: 'Rash / Hypersensitivity', drug_only_reason: 'a rash is specific to the agent; no class cross-reactivity is established outside the sulfonamide-derived diuretics',
      rules: [{ offenders: LOOP_THIAZIDE_CLASSES, effect: 'caution', affects: LOOP_THIAZIDE_CLASSES, label: 'other loop and thiazide-type diuretics (sulfonamide-derived)', advice: 'cross-reactivity is uncommon but labels warn; stop at the first sign of rash' }] },
    { reason: 'Liver Toxicity', drug_only_reason: 'hepatotoxicity is idiosyncratic to the agent: only same-class starts carry a caution',
      rules: [{ offenders: 'any', effect: 'caution', affects: 'same_group', label: 'other drugs of the same class', advice: 'check liver tests at baseline and in 2-4 weeks' }] },
    { reason: 'Nausea / Vomiting', drug_only_reason: GI_GLP1_REASON,
      rules: [{ offenders: GLP1_CLASSES, effect: 'exclude', affects: GLP1_CLASSES, label: 'other GLP-1 therapies' }] },
    { reason: 'Diarrhea', drug_only_reason: GI_GLP1_REASON,
      rules: [{ offenders: GLP1_CLASSES, effect: 'exclude', affects: GLP1_CLASSES, label: 'other GLP-1 therapies' }] },
];

const ruleMatchesOffender = (rule: IntoleranceRule, offenderClass: string): boolean =>
    rule.offenders === 'any' || rule.offenders.has(offenderClass);

/** Classes a rule lands on for this offender ('same_group' = every class of the offender's class group). */
function affectedClasses(rule: IntoleranceRule, offenderClass: string): Set<string> {
    if (rule.affects !== 'same_group') return new Set(rule.affects);
    const group = getMedicationClassGroup(offenderClass);
    return new Set(Object.keys(DRUG_CLASS_REGISTRY).filter(c => DRUG_CLASS_REGISTRY[c].group === group));
}

const entryFor = (reason: string): IntoleranceEntry | undefined =>
    INTOLERANCE_TABLE.find(e => e.reason.toLowerCase() === reason.trim().toLowerCase());

/** Plain-language effect of one documented intolerance ("Excludes lisinopril. Caution on other RAAS inhibitors."), computed from the same table. */
export function describeIntoleranceEffect(drugName: string, drugClass: string, reason: string): string {
    const entry = entryFor(reason);
    if (!entry) return `Excludes ${drugName}. This reason has no declared effect on other drugs.`;
    const parts = [`Excludes ${drugName}.`];
    const rules = entry.rules.filter(r => ruleMatchesOffender(r, drugClass));
    rules.forEach(r => {
        if (r.effect === 'exclude') parts.push(`Also excludes ${r.label}.`);
        else if (r.effect === 'caution') parts.push(`Caution on ${r.label}.`);
        else parts.push(r.label);
    });
    if (rules.length === 0) parts.push('No effect on other drugs.');
    return parts.join(' ');
}

/** Caution warnings for a candidate: one per documented intolerance whose affected class has a NEW start (add or swap-in of a drug not already taken). */
export function intoleranceCautionsFor(patient: Patient, modifications: readonly RegimenModification[]): string[] {
    const out: string[] = [];
    const starts = modifications.filter(m => (m.action === 'add' || m.action === 'swap') && m.target
        && !(patient.current_regimen ?? []).some(r => r.med.name === m.target!.med.name));
    if (starts.length === 0) return out;
    (patient.discontinued_meds ?? []).forEach(dm => {
        const entry = entryFor(dm.reason);
        if (!entry) return;
        entry.rules.filter(r => r.effect === 'caution' && ruleMatchesOffender(r, dm.drug_class)).forEach(rule => {
            const classes = affectedClasses(rule, dm.drug_class);
            starts.forEach(m => {
                const t = m.target!.med;
                if (t.name === dm.name || !classes.has(t.drug_class)) return;
                const w = `${INTOLERANCE_CAUTION_PREFIX} ${entry.reason.toLowerCase()} on ${dm.name}; ${t.name} is in the same affected class: ${rule.advice}.`;
                if (!out.includes(w)) out.push(w);
            });
        });
    });
    return out;
}

/** ACE inhibitors the patient lists as an allergy (the resolved formulary names; see allergy.ts). Read by the ARNI allergy check in effects.ts. */
export function aceInhibitorAllergies(patient: Patient): string[] {
    return MEDICATION_FORMULARY.filter(m => m.drug_class === 'ACEi' && patient.allergies.has(m.name)).map(m => m.name);
}
