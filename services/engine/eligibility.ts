/**
 * Eligibility rules as an ordered, numbered list.
 *
 * Before any scoring, every formulary drug is tested against these rules. A drug that trips a
 * rule is withheld and reported in `excludedMedications` with the rule's reason text, its `rule_id`
 * and `rule_name`, so "why isn't drug X offered?" always has a rule number (cf. GlucosePATH's
 * numbered `soln_DisqualifyMeds`).
 *
 * CONTRACT (behavior-preserving extraction of the former inline filter in
 * `generateAndScoreModifications`; the golden master pins it byte-for-byte):
 *   - A drug not in `availableMedNames` is dropped silently (no exclusion entry, no rule).
 *   - Rules run in array order; the FIRST rule that returns a reason wins (one reason per drug).
 *     Order matters: e.g. an allergy outranks an intolerance, and both outrank contraindications.
 *   - `excludedMedications` lists the patient's documented discontinuations first (rule E01,
 *     seeded, never re-pushed), then new exclusions in formulary order.
 *   - Rule ids are unique and ascending (asserted in scripts/verifyScenarios.ts).
 *
 * Dependencies on engine helpers are imported from simulationService (a circular import that is
 * safe: the helpers are only called at run time, never at module load).
 */
import type { Patient, Medication, RegimenMed, ExcludedMedication } from '../../types';
import { MEDICATION_FORMULARY } from '../../constants';
import {
    deriveIntolerancePolicy, currentMedIntoleranceReason, isRenalOnlyContraindication, MRA_POOL_CLASSES,
    type IntolerancePolicy,
} from '../simulationService';

/** Everything the rules need, computed once per patient (not per drug). */
export interface EligibilityContext {
    patient: Patient;
    /** True when renal data is blank (the 0 sentinel) — renal gates must not read it as end-stage CKD. */
    renalDataUnknown: boolean;
    intolerancePolicy: IntolerancePolicy;
    /** Drug names the patient has a documented discontinuation for (rule E01). */
    discontinuedByName: Map<string, ExcludedMedication>;
    hasSulfaAllergy: boolean;
    /** Defer all NEW beta-blocker initiation (prior bradycardia / AV block). */
    excludeBB: boolean;
    excludeACEi: boolean;
    excludeARNI: boolean;
    excludeCarvedilol: boolean;
    excludeGLP1: boolean;
    hasHyperkalemiaHistory: boolean;
    currentHasSteroidalMRA: boolean;
    currentHasNsMRA: boolean;
}

export interface EligibilityRule {
    id: string;
    name: string;
    /** One plain-language sentence a clinician can read. */
    summary: string;
    /** Returns the exclusion reason string, or null when the rule does not exclude this drug. */
    evaluate(ctx: EligibilityContext, med: Medication): string | null;
    /** Entry is already in the seeded exclusion list; the filter must not push it again. */
    seeded?: true;
}

export function buildEligibilityContext(patient: Patient, renalDataUnknown: boolean): EligibilityContext {
    // New starts use the SUSPECTED tier (free-text keyword match is enough to withhold a new drug);
    // current-regimen cleanup uses the CONFIRMED tier inside currentMedIntoleranceReason.
    const intolerancePolicy = deriveIntolerancePolicy(patient);
    const hasAngioedemaRisk = intolerancePolicy.angioedema.suspected;
    const hasAceiCoughHistory = intolerancePolicy.aceiCough.suspected;

    // Dual-MRA prevention must ignore a current MRA the engine is about to force OFF the regimen
    // (intolerance or hard contraindication) — otherwise the DEPARTING steroidal MRA blocks the
    // tolerated nsMRA from the formulary (and vice versa).
    const isStayingOnRegimen = (r: RegimenMed) =>
        !currentMedIntoleranceReason(r.med, intolerancePolicy) &&
        // A renal-only "contraindication" from blank renal data does NOT make the med departing —
        // analyzeCurrentRegimen keeps it on board, so it must still count for dual-MRA prevention.
        (!(r.med.contraindications?.(patient)) || (renalDataUnknown && isRenalOnlyContraindication(r.med, patient)));

    return {
        patient,
        renalDataUnknown,
        intolerancePolicy,
        discontinuedByName: new Map(patient.discontinued_meds.map(m => [m.name, m])),
        hasSulfaAllergy: [...patient.allergies].some(a => a.toLowerCase().includes('sulfa') || a.toLowerCase().includes('sulfonamide')),
        excludeBB: intolerancePolicy.hasBbBradycardia,
        excludeACEi: hasAngioedemaRisk || hasAceiCoughHistory,
        // ACEi angioedema cross-reactivity with ARBs is only ~2-8%; ARBs stay allowed with a warning.
        // ARNI is excluded (neprilysin inhibition raises bradykinin).
        excludeARNI: hasAngioedemaRisk,
        excludeCarvedilol: intolerancePolicy.hasBbBronchospasm,
        excludeGLP1: intolerancePolicy.hasGlp1GiIntolerance,
        hasHyperkalemiaHistory: intolerancePolicy.mraHyperkalemia.suspected,
        currentHasSteroidalMRA: (patient.current_regimen || []).some(r => r.med.drug_class === 'MRA' && isStayingOnRegimen(r)),
        currentHasNsMRA: (patient.current_regimen || []).some(r => r.med.drug_class === 'nsMRA' && isStayingOnRegimen(r)),
    };
}

export const ELIGIBILITY_RULES: readonly EligibilityRule[] = [
    {
        id: 'E01', name: 'Previously discontinued',
        summary: 'A drug the patient already stopped (documented discontinuation) is not offered again.',
        seeded: true,
        evaluate: (ctx, med) => ctx.discontinuedByName.get(med.name)?.reason ?? null,
    },
    {
        id: 'E02', name: 'Patient-reported allergy',
        summary: 'A drug the patient lists as an allergy is never offered.',
        evaluate: (ctx, med) => ctx.patient.allergies.has(med.name) ? 'Patient-reported allergy' : null,
    },
    {
        id: 'E03', name: 'ACE inhibitor intolerance',
        summary: 'ACE inhibitors are withheld after prior angioedema or ACE-inhibitor cough.',
        evaluate: (ctx, med) => med.drug_class === 'ACEi' && ctx.excludeACEi
            ? 'Cross-reactivity with prior ACEi intolerance' : null,
    },
    {
        id: 'E04', name: 'ARNI after angioedema',
        summary: 'Sacubitril/valsartan is withheld after angioedema because neprilysin inhibition raises bradykinin.',
        evaluate: (ctx, med) => ctx.excludeARNI && med.drug_class === 'ARNI'
            ? 'ARNI excluded: neprilysin inhibition worsens bradykinin-mediated angioedema risk' : null,
    },
    {
        id: 'E05', name: 'MRA after hyperkalemia',
        summary: 'All mineralocorticoid antagonists (steroidal and non-steroidal) are withheld after documented MRA hyperkalemia.',
        evaluate: (ctx, med) => MRA_POOL_CLASSES.has(med.drug_class) && ctx.hasHyperkalemiaHistory
            ? 'Hyperkalemia intolerance (applies to all MRA types)' : null,
    },
    {
        id: 'E06', name: 'MRA after gynecomastia',
        summary: 'Spironolactone and any named offender are avoided after MRA gynecomastia; selective agents stay available.',
        // Agent-specific (antiandrogenic), not class-wide, to preserve the MRA pillar.
        evaluate: (ctx, med) => MRA_POOL_CLASSES.has(med.drug_class) && ctx.intolerancePolicy.gynecomastiaAvoidedMeds.has(med.name)
            ? 'Prior MRA gynecomastia — antiandrogenic agent avoided' : null,
    },
    {
        id: 'E07', name: 'Beta-blocker after bradycardia/AV block',
        summary: 'New beta-blocker starts are deferred after prior bradycardia or AV block (an existing one is not stopped).',
        evaluate: (ctx, med) => med.drug_class === 'Beta Blocker' && ctx.excludeBB
            ? 'Prior beta-blocker intolerance (bradycardia / AV block) — new initiation deferred' : null,
    },
    {
        id: 'E08', name: 'Carvedilol after bronchospasm',
        summary: 'Carvedilol (non-selective) is avoided after beta-blocker bronchospasm; beta-1-selective agents are preferred.',
        evaluate: (ctx, med) => med.name === 'Carvedilol' && ctx.excludeCarvedilol
            ? 'Non-selective beta-blocker avoided after bronchospasm; prefer β1-selective (bisoprolol / metoprolol succinate)' : null,
    },
    {
        id: 'E09', name: 'GLP-1 after GI intolerance',
        summary: 'GLP-1 based agents are withheld for new starts after prior GI intolerance.',
        evaluate: (ctx, med) => (med.drug_class === 'GLP-1 RA' || med.drug_class === 'GLP-1/GIP RA') && ctx.excludeGLP1
            ? 'Prior GLP-1 GI intolerance' : null,
    },
    {
        id: 'E10', name: 'Dual MRA (steroidal already on board)',
        summary: 'A non-steroidal MRA is not added while the patient stays on a steroidal MRA.',
        // Depends on the staying-on-regimen predicate in buildEligibilityContext (a steroidal MRA the
        // engine is forcing off does not block).
        evaluate: (ctx, med) => med.drug_class === 'nsMRA' && ctx.currentHasSteroidalMRA
            ? 'Dual MRA prevention: current steroidal MRA in regimen' : null,
    },
    {
        id: 'E11', name: 'Dual MRA (non-steroidal already on board)',
        summary: 'A steroidal MRA is not added while the patient stays on a non-steroidal MRA.',
        evaluate: (ctx, med) => med.drug_class === 'MRA' && ctx.currentHasNsMRA
            ? 'Dual MRA prevention: current nsMRA in regimen' : null,
    },
    {
        id: 'E12', name: 'Renal data required',
        summary: 'A renal-gated drug is not started when kidney function is blank; obtain a BMP first.',
        // Must precede E13: both fire on the same contraindications() result, and a blank-renal
        // trip is labeled honestly instead of as a hard clinical contraindication.
        evaluate: (ctx, med) => med.contraindications && med.contraindications(ctx.patient)
            && ctx.renalDataUnknown && isRenalOnlyContraindication(med, ctx.patient)
            ? 'Renal data required — cannot assess renal safety (obtain BMP before initiation)' : null,
    },
    {
        id: 'E13', name: 'Clinical contraindication',
        summary: 'The drug\'s own contraindication check (pregnancy, potassium, heart rate, interactions, renal cutoffs...) fails for this patient.',
        evaluate: (ctx, med) => med.contraindications && med.contraindications(ctx.patient)
            ? 'Clinical Contraindication' : null,
    },
    {
        id: 'E14', name: 'Renal dose-adjustment contraindication',
        summary: 'The drug\'s renal dosing table marks the patient\'s eGFR as contraindicated (skipped when renal data is blank).',
        evaluate: (ctx, med) => !ctx.renalDataUnknown && med.renal_adjustment
            && med.renal_adjustment(ctx.patient.egfr, ctx.patient).contraindicated === true
            ? 'Renal Contraindication (eGFR below labeled threshold)' : null,
    },
];

export const ELIGIBILITY_RULE_IDS: ReadonlySet<string> = new Set(ELIGIBILITY_RULES.map(r => r.id));

/** Patient's documented discontinuations, tagged with rule E01 (new objects; input untouched). */
export function taggedDiscontinuedMeds(patient: Patient): ExcludedMedication[] {
    const e01 = ELIGIBILITY_RULES[0];
    return patient.discontinued_meds.map(m => ({ ...m, rule_id: e01.id, rule_name: e01.name }));
}

export interface EligibilityResult {
    /** Formulary drugs that passed every rule (formulary order). */
    formulary: Medication[];
    /** Discontinuations first, then new exclusions in formulary order. */
    excludedMeds: ExcludedMedication[];
}

export function filterEligibleMedications(
    ctx: EligibilityContext, availableMedNames: Set<string>,
): EligibilityResult {
    const excludedMeds = taggedDiscontinuedMeds(ctx.patient);
    const formulary = MEDICATION_FORMULARY.filter(m => {
        if (!availableMedNames.has(m.name)) return false;
        for (const rule of ELIGIBILITY_RULES) {
            const reason = rule.evaluate(ctx, m);
            if (reason === null) continue;
            if (!rule.seeded) {
                excludedMeds.push({ name: m.name, drug_class: m.drug_class, reason, rule_id: rule.id, rule_name: rule.name });
            }
            return false;
        }
        return true;
    });
    return { formulary, excludedMeds };
}
