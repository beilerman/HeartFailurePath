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
 * Dependencies on engine helpers are imported from ./intolerance (no import of simulationService:
 * the facade depends on the engine modules, never the reverse).
 */
import type { Patient, Medication, RegimenMed, ExcludedMedication } from '../../types';
import { MEDICATION_FORMULARY } from '../../constants';
import {
    deriveIntolerancePolicy, currentMedIntoleranceReason, isRenalOnlyContraindication, MRA_POOL_CLASSES,
    type IntolerancePolicy,
} from './intolerance';
import { RAAS_CLASSES } from './registry';
import { valueUnknown } from '../clinicalPredicates';
import { drugFacts } from './drugFacts';
import { contraindicationReasons } from './contraindications';
import { MRA_START_K_BINDER_ABOVE } from './thresholds';

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
    /**
     * Whether any K+ binder can actually be offered (formulary-available, not allergic/discontinued). Set when the
     * formulary filter runs (it needs `availableMedNames`); undefined before that. Rule E15 reads it.
     */
    kBinderAvailable?: boolean;
}

export interface EligibilityRule {
    id: string;
    name: string;
    /** One plain-language sentence a clinician can read. */
    summary: string;
    /** Returns the exclusion reason string, or null when the rule does not exclude this drug. */
    evaluate(ctx: EligibilityContext, med: Medication): string | null;
    /** Optional explanation-only specifics (which findings tripped the rule). Never affects the decision. */
    details?(ctx: EligibilityContext, med: Medication): string[];
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

/** Names of the basic-metabolic-panel values that are blank (not entered), for E16 text. Empty when both are present. */
export function blankLabNames(ctx: Pick<EligibilityContext, 'patient' | 'renalDataUnknown'>): string[] {
    const names: string[] = [];
    if (valueUnknown(ctx.patient.potassium)) names.push('potassium');
    if (ctx.renalDataUnknown) names.push('renal function (eGFR/creatinine)');
    return names;
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
        evaluate: (ctx, med) => drugFacts(med).nonselective_beta_blocker && ctx.excludeCarvedilol
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
        details: (_ctx, med) => [
            `eGFR is blank (not entered): ${med.name} has a renal-gated contraindication that cannot be assessed without it — obtain a BMP first`,
        ],
    },
    {
        id: 'E13', name: 'Clinical contraindication',
        summary: 'The drug\'s own contraindication check (pregnancy, potassium, heart rate, interactions, renal cutoffs...) fails for this patient.',
        evaluate: (ctx, med) => med.contraindications && med.contraindications(ctx.patient)
            ? 'Clinical Contraindication' : null,
        details: (ctx, med) => contraindicationReasons(med, ctx.patient),
    },
    {
        id: 'E14', name: 'Renal dose-adjustment contraindication',
        summary: 'The drug\'s renal dosing table marks the patient\'s eGFR as contraindicated (skipped when renal data is blank).',
        evaluate: (ctx, med) => !ctx.renalDataUnknown && med.renal_adjustment
            && med.renal_adjustment(ctx.patient.egfr, ctx.patient).contraindicated === true
            ? 'Renal Contraindication (eGFR below labeled threshold)' : null,
        details: (ctx, med) => [
            `eGFR ${ctx.patient.egfr}: the renal dosing table for ${med.name} marks this level as contraindicated`,
        ],
    },
    {
        id: 'E15', name: 'MRA start above potassium 5.0 needs a binder',
        summary: 'A NEW MRA start at potassium above 5.0 is only offered together with a potassium binder (the label/guideline start threshold is 5.0). If no binder can be offered, the MRA is not started.',
        // Initiation only: a patient already on any MRA is not affected (continuation is governed by the potassium
        // continuation rule). Placed after E13 so potassium above 5.5 is reported as a contraindication.
        evaluate: (ctx, med) => MRA_POOL_CLASSES.has(med.drug_class)
            && ctx.kBinderAvailable === false
            && ctx.patient.potassium > MRA_START_K_BINDER_ABOVE
            && !(ctx.patient.current_regimen ?? []).some(r => MRA_POOL_CLASSES.has(r.med.drug_class))
            ? 'MRA start above potassium 5.0 needs a potassium binder, and none can be offered' : null,
        details: (ctx) => [
            `Potassium ${ctx.patient.potassium.toFixed(1)} mEq/L is above the 5.0 start threshold; the tool only starts an MRA at 5.0-5.5 together with a binder, and no binder is available for this patient`,
        ],
    },
    {
        id: 'E16', name: 'Potassium and renal function required',
        summary: 'A NEW ACE inhibitor, ARB, ARNI or MRA is not started while potassium or renal function is blank; obtain a basic metabolic panel first. A drug the patient already takes is not affected here (dose increases are held at the candidate level).',
        // Physician-owner decision 2026-11-11: a current potassium and renal function are required before intensifying
        // RAAS or MRA therapy where clinically appropriate. Engine policy: no freshness window and no new numeric
        // threshold; "blank" is the existing not-entered sentinel. Placed LAST so a real contraindication (E13/E14)
        // and the renal-gated start (E12) keep their own labels; E16 covers every other RAAS/MRA new start.
        evaluate: (ctx, med) => (RAAS_CLASSES.has(med.drug_class) || MRA_POOL_CLASSES.has(med.drug_class))
            && blankLabNames(ctx).length > 0
            && !(ctx.patient.current_regimen ?? []).some(r => r.med.name === med.name)
            ? `Laboratory prerequisite — ${blankLabNames(ctx).join(' and ')} not entered; obtain a BMP before starting this drug` : null,
        details: (ctx, med) => [
            `${blankLabNames(ctx).join(' and ')} ${blankLabNames(ctx).length > 1 ? 'are' : 'is'} blank (not entered): a new ${med.drug_class} start needs a current potassium and renal function — obtain a BMP first`,
        ],
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
    ctx = {
        ...ctx,
        kBinderAvailable: MEDICATION_FORMULARY.some(m =>
            drugFacts(m).rescue_role?.kind === 'k_binder' && availableMedNames.has(m.name)
            && !ctx.patient.allergies.has(m.name) && !ctx.discontinuedByName.has(m.name)),
    };
    const formulary = MEDICATION_FORMULARY.filter(m => {
        if (!availableMedNames.has(m.name)) return false;
        for (const rule of ELIGIBILITY_RULES) {
            const reason = rule.evaluate(ctx, m);
            if (reason === null) continue;
            if (!rule.seeded) {
                const details = rule.details?.(ctx, m);
                excludedMeds.push({
                    name: m.name, drug_class: m.drug_class, reason, rule_id: rule.id, rule_name: rule.name,
                    ...(details && details.length > 0 ? { why: details } : {}),
                });
            }
            return false;
        }
        return true;
    });
    return { formulary, excludedMeds };
}

// =====================================================================================
// Pipeline stage 4 - eligibility. Body moved verbatim from generateAndScoreModifications.
// =====================================================================================

/**
 * Run the eligibility rules for one patient: raises the sulfa-allergy / beta-blocker-intolerance
 * alerts, filters the formulary, and reports whether EVERY beta blocker was excluded.
 */
export function runEligibilityStage(
    patient: Patient,
    unknownRenal: boolean,
    availableMedNames: Set<string>,
    clinicalAlerts: string[]
) {
    const eligibility = buildEligibilityContext(patient, unknownRenal);
    const intolerancePolicy = eligibility.intolerancePolicy;
    if (eligibility.hasSulfaAllergy) {
        clinicalAlerts.push('SULFA ALLERGY: Loop and thiazide diuretics are sulfonamide derivatives. Cross-reactivity is low but documented — monitor for rash/hypersensitivity. Ethacrynic acid is the sulfonamide-free loop alternative if a true reaction occurs.');
    }
    if (eligibility.excludeBB) {
        clinicalAlerts.push('BETA-BLOCKER INTOLERANCE: Prior bradycardia/AV block on a beta-blocker. New beta-blocker initiation is deferred; if a beta-blocker is essential, evaluate for pacing. An existing beta-blocker should be reduced, not abruptly stopped.');
    }
    const { formulary, excludedMeds } = filterEligibleMedications(eligibility, availableMedNames);
    // (Per-class exclusion tracking is derived from the filtered formulary where needed —
    // e.g. allBBExcluded below — rather than a parallel excludedClasses set, which drifted.)

    // Check if ALL beta blockers were excluded (not just one)
    const allBBExcluded = !formulary.some(m => m.drug_class === 'Beta Blocker');

    return { formulary, excludedMeds, intolerancePolicy, allBBExcluded };
}
