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
import { kContinuationAction } from './regimenUtils';
import { valueUnknown } from '../clinicalPredicates';
import { drugFacts } from './drugFacts';
import { contraindicationReasons } from './contraindications';
import { MRA_START_K_CEILING, RAAS_START_K_CAUTION, RAAS_EGFR_REVIEW_BELOW } from './thresholds';
import { assessCreatinineChange } from './renalChange';

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
        id: 'E15', name: 'New MRA start at potassium 5.0 or higher is staged',
        summary: 'A NEW MRA or nsMRA start at potassium 5.0 or higher is withheld, with or without a potassium binder: recheck potassium and start once it is below 5.0. A binder is not a reason to start sooner (outcome benefit uncertain in the 2022 US guideline; no recommendation in the 2026 ESC guideline).',
        // Decision 2026-11-11 (docs/medication-review-2026-11-10/verified-clinical-decisions-2026-11-11.md, rows 1, 2a, 2c, 3, 4):
        //  - row 1: 2022 AHA/ACC/HFSA section 7.3.3, PRIMARY text read 2026-11-11: "serum potassium 5.0 mEq/L or above ... contraindications to MRA initiation" (class label still secondary)
        //  - row 2a / 2c: Aldactone label (K <= 5.0) and Kerendia label (do not initiate if K > 5.0) - labels
        //  - row 3: binders for hyperkalemia on RAASi are Class 2b (secondary); row 4: DIAMOND co-started an MRA with patiromer only inside a
        //    trial run-in, which is not a recommendation to start an MRA above 5.0
        //  - PRIMARY: 2026 ESC heart failure guideline section 6.1 (esc-2026-reading-notes.md): "caution" when starting an MRA at potassium 5.0 or above; potassium
        //    binders: "no specific recommendations" (insufficient evidence of clinical benefit).
        // One rule for all MRAs (eplerenone's looser label K > 5.5 start contraindication, row 2b, does not govern).
        // Initiation only: a patient already on any MRA is not affected (continuation is facts.k_continuation). Placed after E13 so
        // potassium above 5.5 is still reported as a contraindication.
        evaluate: (ctx, med) => MRA_POOL_CLASSES.has(med.drug_class)
            && ctx.patient.potassium >= MRA_START_K_CEILING
            // "Already on an MRA" exempts a switch within the class only while that MRA may continue at its dose: one being reduced or withheld by its
            // potassium rule (5.5 or higher) is not a licence to start a different MRA (2026-11-12).
            && !(ctx.patient.current_regimen ?? []).some(r => MRA_POOL_CLASSES.has(r.med.drug_class) && kContinuationAction(r.med, ctx.patient) === null)
            ? `Potassium ${ctx.patient.potassium.toFixed(1)} is 5.0 or higher: recheck and start the MRA once potassium is below 5.0` : null,
        details: (ctx) => [
            `Potassium ${ctx.patient.potassium.toFixed(1)} mEq/L is at or above the ${MRA_START_K_CEILING.toFixed(1)} start limit (2022 AHA/ACC/HFSA 7.3.3: potassium 5.0 or above is a contraindication to MRA initiation; 2026 ESC section 6.1: caution at 5.0 or above; the Aldactone and Kerendia labels allow exactly 5.0, the guideline boundary is the stricter and is used). Repeat potassium and start the MRA once it is below ${MRA_START_K_CEILING.toFixed(1)}`,
            'Potassium binders: whether they improve outcomes is uncertain in the 2022 US guideline (primary text); the 2026 ESC guideline makes no recommendation for them (insufficient evidence of clinical benefit). The tool does not start an MRA together with a binder',
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
    {
        id: 'E17', name: 'Pregnancy: new beta-blocker start limited to beta-1-selective agents',
        summary: 'In pregnancy only a beta-1-selective beta-blocker (metoprolol succinate, bisoprolol) is newly started. A pregnant patient on a non-selective beta-blocker is offered a switch to a beta-1-selective one.',
        // Decision 2026-11-11. PRIMARY source: 2026 ESC heart failure guideline, Recommendation Table 27 (esc-2026-reading-notes.md): "switch non-selective
        // beta-blockers to beta-1-selective ones (metoprolol, bisoprolol)", Class I, level C. A 2024 peer-reviewed review (secondary, verified-clinical-decisions-
        // 2026-11-11.md row 12) names metoprolol as preferred; both agree beta-1-selective agents are the choice. Read from data (facts.beta1_selective).
        // Initiation only: a drug already in the regimen is never excluded here (its switch is offered by analyzeCurrentRegimen). Placed last so real
        // contraindications keep their labels.
        evaluate: (ctx, med) => ctx.patient.is_pregnant === true
            && med.drug_class === 'Beta Blocker'
            && !drugFacts(med).beta1_selective
            && !(ctx.patient.current_regimen ?? []).some(r => r.med.name === med.name)
            ? 'Pregnancy: only a beta-1-selective beta-blocker (metoprolol succinate, bisoprolol) is newly started' : null,
        details: () => [
            '2026 ESC heart failure guideline (Class I, level C): in pregnancy switch non-selective beta-blockers to beta-1-selective ones (metoprolol, bisoprolol)',
        ],
    },
    {
        id: 'E18', name: 'New RAAS inhibitor start above potassium 5.2 is staged',
        summary: 'A NEW ACE inhibitor, ARB or ARNI start (patient on none of them) at potassium above 5.2 is withheld, with or without a potassium binder: recheck potassium and start once it is 5.2 or lower. A swap within the RAAS pool is not a new start and is governed by the existing rules.',
        // Decision 2026-11-11, parallel to E15. PRIMARY: 2026 ESC heart failure guideline Supplementary Tables S4/S5 (esc-2026-reading-notes.md): potassium above 5.2 is a
        // caution / seek-specialist-advice threshold for starting an ACE inhibitor, ARB or ARNI; the guideline makes no recommendation for potassium binders. The 2022 US
        // guideline gives binders Class 2b for patients who develop hyperkalaemia while ON a RAAS inhibitor (secondary), not for enabling a start. Treating the caution as a
        // staged start (recheck, then start) is ENGINE POLICY. Initiation only: a patient already on any ACEi/ARB/ARNI is unaffected. Above RAAS_START_K_MAX (5.4) rule E13
        // (clinical contraindication, earlier in the list) still reports the block. Placed after E17 to keep ids ascending.
        evaluate: (ctx, med) => RAAS_CLASSES.has(med.drug_class)
            && ctx.patient.potassium > RAAS_START_K_CAUTION
            && !(ctx.patient.current_regimen ?? []).some(r => RAAS_CLASSES.has(r.med.drug_class))
            ? `Potassium ${ctx.patient.potassium.toFixed(1)} is above 5.2: recheck and start once it is 5.2 or lower` : null,
        details: (ctx) => [
            `Potassium ${ctx.patient.potassium.toFixed(1)} mEq/L is above ${RAAS_START_K_CAUTION.toFixed(1)}, the 2026 ESC caution threshold for starting an ACE inhibitor, ARB or ARNI (Supplementary Tables S4/S5: seek specialist advice). The engine applies it as a staged start (engine policy). First steps: stop potassium supplements, potassium-sparing diuretics, NSAIDs and high-potassium salt substitutes, then repeat potassium and start once it is ${RAAS_START_K_CAUTION.toFixed(1)} or lower`,
            'Potassium binders carry a Class 2b recommendation in the 2022 US guideline for hyperkalaemia that develops while on a RAAS inhibitor (secondary source); the 2026 ESC guideline makes no recommendation for them. The tool does not start a RAAS inhibitor together with a binder',
        ],
    },
    {
        id: 'E19', name: 'No new RAAS inhibitor or MRA while kidney function is worsening',
        summary: 'When the entered baseline creatinine shows a rise of 50% or more (or a derived eGFR fall of more than 30%), a NEW ACE inhibitor, ARB, ARNI or MRA is not started until kidney function is stable. Drugs of these classes already in use are reduced one step by the kidney rule.',
        // Added 2026-11-12 (adversarial review): the kidney rule halved an RAAS inhibitor / MRA already in use (2026 ESC Supplementary Tables S4/S5/S8) while a NEW one
        // of the other class was started at full starting dose in the same option, and the next run then halved it. The guideline text covers the drug in use; withholding
        // a new start in the same state is ENGINE POLICY that follows from it (it also says "no increase until stable"). The 'stop' band is a contraindication check (E13).
        // Needs the optional baseline creatinine: with it blank nothing changes.
        evaluate: (ctx, med) => {
            if (!(RAAS_CLASSES.has(med.drug_class) || MRA_POOL_CLASSES.has(med.drug_class))) return null;
            if ((ctx.patient.current_regimen ?? []).some(r => r.med.name === med.name)) return null;
            const change = assessCreatinineChange(ctx.patient);
            return change?.band === 'reduce' ? 'Kidney function has worsened from baseline: not started until it is stable' : null;
        },
        details: (ctx) => {
            const change = assessCreatinineChange(ctx.patient);
            return change ? [`${change.why}. The 2026 ESC guideline (Supplementary Tables S4/S5/S8) halves these drugs when already in use and allows no increase until kidney function is stable; not starting a new one in the same state is engine policy. Look for and stop other causes (NSAIDs, volume depletion), recheck in 1-2 weeks`] : [];
        },
    },
    {
        id: 'E20', name: 'No new RAAS inhibitor, increase or switch at eGFR below 20',
        summary: 'With a measured eGFR below 20, an ACE inhibitor, ARB or ARNI the patient does not already take is not started (this includes a switch within the class), and one already in use is not increased. A drug in use is kept, with the alert asking whether the fall is new.',
        // Added 2026-11-12 (adversarial review 3): the tool's own alert says that below eGFR 20 a NEW fall means stop and seek specialist advice (2026 ESC Supplementary
        // Table S4), yet option 1 doubled lisinopril at eGFR 14 and another option switched to the ARNI. The guideline text covers stopping after a fall; holding starts,
        // increases and switches at the same level is ENGINE POLICY that follows from it. Blank eGFR (0) never triggers (rules E12/E16 cover missing data).
        evaluate: (ctx, med) => RAAS_CLASSES.has(med.drug_class)
            && ctx.patient.egfr > 0 && ctx.patient.egfr < RAAS_EGFR_REVIEW_BELOW
            && !(ctx.patient.current_regimen ?? []).some(r => r.med.name === med.name)
            ? `eGFR ${ctx.patient.egfr} is below ${RAAS_EGFR_REVIEW_BELOW}: not started without specialist advice` : null,
        details: (ctx) => [
            `eGFR ${ctx.patient.egfr} mL/min/1.73 m2 is below ${RAAS_EGFR_REVIEW_BELOW}. The 2026 ESC guideline (Supplementary Table S4) advises stopping an ACE inhibitor or ARB and seeking specialist advice when eGFR falls below 20; this tool therefore does not start, increase or switch one at this level (engine policy). A drug already in use is kept.`,
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
