/**
 * Pipeline stage 6 - score every candidate modification set. Moved verbatim from the per-candidate
 * loop in generateAndScoreModifications, split into named steps that run in the original order:
 *   volume-depletion gate -> applyRescueAdditions -> max-new-classes filter -> scoreDomains ->
 *   aggregateScore -> assemble ScoredRegimen.
 * The two early returns (gate, max-new filter) drop a candidate exactly where they always did.
 */
import { Patient, Medication, ScoredRegimen, RegimenMed, RegimenModification, ModificationSet, DomainScores } from '../../types';
import {
    DOMAIN_KEYS, DOMAIN_LABELS, WEIGHT_PROFILES, resolveWeightProfile, SCORE_ADJUSTMENTS, NON_PENALIZED_WARNING_MARKERS, WARNINGS_PRICED_BY_NAMED_ADJUSTMENT,
    ScoreBreakdown, ScoreBreakdownAdjustment, ScoreBreakdownDomainLine, ScoreBreakdownOverride, ScoreDomainKey,
    COMPLETENESS_SUBTARGET_CREDIT,
    COMPLETENESS_GRADED_CREDIT_SPAN,
} from './scoreModel';
import { drugFacts } from './drugFacts';
import { ivIronCreditTier } from '../clinicalPredicates';
import { RAAS_CLASSES, MRA_POOL_CLASSES, VOLUME_SENSITIVE_INTENSIFICATION_CLASSES, getMedicationClassGroup } from './registry';
import { countNewClassGroups, formatDose, hasDiureticDeEscalation, hasRelevantIntensification, isTargetDoseForPatient, doseProgressToTarget, restrictToStartTiers } from './regimenUtils';
import { calculateAdherenceScore, calculateCostScore, calculateFunctionalScore, calculateGuidelineConcordanceScore, calculateNeurohormonalScore, calculateStructureScore, calculateVolumeScore, classifyPhenotype, describeConcordance, nsMraFillsMraSlot, Phenotype } from './domains';
import { simulateModificationEffect } from './effects';
import { IntolerancePolicy } from './intolerance';
import { RegimenAnalysis } from './candidates';
import { CriticalDataAudit, ClinicalFlags } from './gates';

type Simulation = ReturnType<typeof simulateModificationEffect>;

/** One indicated, achievable therapy slot counted by the GDMT-completeness adjustment. */
/** `foundational` marks the guideline pillar slots (RAAS, beta-blocker, MRA, SGLT2i for HFrEF); adjunct slots are not foundational. */
export interface GdmtSlot { match: (cls: string) => boolean; foundational?: boolean; }

/** Everything the per-candidate steps read, computed once per patient (not per candidate). */
export interface ScoringContext {
    patient: Patient;
    prices: Record<string, number>;
    intolerancePolicy: IntolerancePolicy;
    dataAudit: CriticalDataAudit;
    phenotype: Phenotype;
    isVolumeDepleted: boolean;
    hasDiureticInCurrent: boolean;
    /** K+ binder tiers in trial order: the preferred agent's tiers (low to high) first, then the others'. */
    rescueBinders: RegimenMed[];
    ivIron: RegimenMed | undefined;
    ironDeficient: boolean;
    maxNewPerVisit: number;
    achievableSlots: GdmtSlot[];
    /** The foundational (pillar) slots indicated for the phenotype, whether or not a drug for them can be started today. Display and averaging only. */
    indicatedFoundationalSlots: GdmtSlot[];
    /** Penalized warnings already true of the CURRENT regimen with nothing changed (number-free keys -> text). See `warningKey`. */
    baselineDangerWarnings: Map<string, string>;
}

/** A warning's identity without its numbers ("Low Perfusion Pressure (MAP 62 mmHg)" and "(MAP 63 mmHg)" are the same warning). */
export const warningKey = (w: string): string => w.replace(/-?\d+(\.\d+)?/g, '#');
const isPenalizedWarning = (w: string): boolean => !NON_PENALIZED_WARNING_MARKERS.some(marker => w.includes(marker)) && !WARNINGS_PRICED_BY_NAMED_ADJUSTMENT.some(marker => w.includes(marker));

export function buildScoringContext(
    patient: Patient,
    prices: Record<string, number>,
    intolerancePolicy: IntolerancePolicy,
    dataAudit: CriticalDataAudit,
    formulary: Medication[],
    medTiers: RegimenMed[],
    analysis: RegimenAnalysis,
    flags: ClinicalFlags
): ScoringContext {
    const { isVolumeDepleted, hasDiureticInCurrent } = flags;
    const binders = medTiers.filter(r => r.med.drug_class === 'K+ Binder')
        .filter(r => { const cap = drugFacts(r.med).rescue_role?.max_rescue_dose; return cap === undefined || typeof r.dose.strength !== 'number' || r.dose.strength <= cap; });
    // H7: Binder rescue — preferred agent first (Patiromer), then any other available K+ binder (Lokelma), each
    // from its lowest dose tier up, so the engine can reach a binder/dose that actually prevents the rise.
    const doseIdx = (r: RegimenMed) => r.med.available_doses.findIndex(d => d.strength === r.dose.strength);
    const isPreferred = (r: RegimenMed) => drugFacts(r.med).rescue_role?.preferred ? 0 : 1;
    const rescueBinders = [...binders].sort((a, b) =>
        isPreferred(a) - isPreferred(b) || (a.med.name === b.med.name ? doseIdx(a) - doseIdx(b) : a.med.name.localeCompare(b.med.name)));
    // The automatic iron rescue uses the entry's exact label start tier (day-1 dose by hemoglobin) and only fires in the evidence population:
    // iron deficient AND LVEF < 50, NYHA II/III, Hb < 15 (ivIronCreditTier; a clinician may still choose iron outside it).
    const ivIron = restrictToStartTiers(medTiers, patient).find(r => r.med.drug_class === 'IV Iron');
    const ironDeficient = ivIronCreditTier(patient) !== null;
    const maxNewPerVisit = Math.max(0, Math.round(patient.max_new_classes_per_visit ?? 2));

    // --- GDMT completeness slots (the `completeness` domain, see gdmtCompletenessFraction) ----
    // Each INDICATED, ACHIEVABLE therapy is one slot. "Achievable" excludes therapies the patient
    // cannot take (already filtered out of `formulary`), so a patient is never penalized for a
    // contraindicated pillar. Safety penalties are applied on top of the weighted sum, so an unsafe
    // projection still disqualifies the regimen regardless of completeness.
    const phenotype = classifyPhenotype(patient);
    const isReducedPhenotype = phenotype === 'HFrEF';

    const completenessSlots: GdmtSlot[] = [];
    if (isReducedPhenotype) {
        completenessSlots.push(
            { match: (c) => RAAS_CLASSES.has(c), foundational: true },
            { match: (c) => c === 'Beta Blocker', foundational: true },
            { match: (c) => c === 'MRA' || (c === 'nsMRA' && nsMraFillsMraSlot(patient)), foundational: true },
            { match: (c) => c === 'SGLT2i', foundational: true }
        );
    } else { // HFpEF
        completenessSlots.push(
            { match: (c) => c === 'SGLT2i', foundational: true },
            { match: (c) => c === 'MRA' || c === 'nsMRA', foundational: true } // TOPCAT / FINEARTS-HF adjunct
        );
    }
    // Eligible DISEASE-MODIFYING adjuncts also count toward completeness, sourced from the engine's
    // own eligibility (analysis.addableAdjuncts) so criteria (HR/rhythm for ivabradine, NT-proBNP +
    // worsening for vericiguat, BMI/EF for GLP-1, A-HeFT for H/ISDN, iron studies for IV iron) stay
    // in ONE place. Symptomatic-only adjuncts (loop/thiazide diuretics, digoxin) are excluded — they
    // are not guideline "completeness." Without this, adding an indicated adjunct earned no
    // completeness credit, so the bare pillar regimen out-ranked it and the adjunct fell out of the
    // 3-slot display (e.g. ivabradine in a SHIFT candidate, vericiguat in a VICTORIA candidate).
    const ADJUNCT_COMPLETENESS_CLASSES = new Set(['If Inhibitor', 'sGC Stimulator', 'Vasodilator', 'GLP-1 RA', 'GLP-1/GIP RA', 'IV Iron']);
    const eligibleAdjunctClasses = new Set<string>();
    analysis.addableAdjuncts.forEach(a => { if (ADJUNCT_COMPLETENESS_CLASSES.has(a.med.drug_class)) eligibleAdjunctClasses.add(a.med.drug_class); });
    (patient.current_regimen ?? []).forEach(r => { if (ADJUNCT_COMPLETENESS_CLASSES.has(r.med.drug_class)) eligibleAdjunctClasses.add(r.med.drug_class); });
    // GLP-1 RA and GLP-1/GIP RA are one therapeutic slot (either agent satisfies it).
    const hasGlp1Slot = [...eligibleAdjunctClasses].some(c => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA');
    eligibleAdjunctClasses.delete('GLP-1 RA');
    eligibleAdjunctClasses.delete('GLP-1/GIP RA');
    if (hasGlp1Slot) completenessSlots.push({ match: (c) => c === 'GLP-1 RA' || c === 'GLP-1/GIP RA' });
    eligibleAdjunctClasses.forEach(cls => completenessSlots.push({ match: (c) => c === cls }));

    const indicatedFoundationalSlots = completenessSlots.filter(s => s.foundational);
    // Keep only slots the patient can actually attain (a non-excluded formulary med exists).
    const achievableSlots = completenessSlots.filter(s => formulary.some(m => s.match(m.drug_class)));

    // Warnings that already apply to the patient as entered (the current regimen, nothing changed). They are charged to EVERY candidate, so a candidate cannot
    // out-score "no change" merely by cutting a drug until a state warning stops firing (adversarial review 2026-11-12: at MAP 63 "reduce the beta-blocker"
    // beat "no change" by one warning while "increase it" beat "no change" on completeness, and the tool reversed its own advice on the next run).
    const baselineDangerWarnings = new Map<string, string>();
    const current = patient.current_regimen ?? [];
    if (current.length > 0) {
        const keepAll: ModificationSet = { modifications: current.map(r => ({ action: 'keep' as const, source: r, summary: `Keep ${r.med.name}` })), resulting_regimen: [...current] };
        simulateModificationEffect(patient, keepAll, prices, intolerancePolicy).warnings.filter(isPenalizedWarning).forEach(w => baselineDangerWarnings.set(warningKey(w), w));
    }

    return {
        patient, prices, intolerancePolicy, dataAudit, phenotype, isVolumeDepleted, hasDiureticInCurrent,
        rescueBinders, ivIron, ironDeficient, maxNewPerVisit, achievableSlots, indicatedFoundationalSlots, baselineDangerWarnings,
    };
}

/** Classes that raise potassium and so can make a binder rescue necessary: the RAAS pool and both MRA classes. */
const K_RAISING_CLASSES: ReadonlySet<string> = new Set([...RAAS_CLASSES, ...MRA_POOL_CLASSES]);
export function addsNewPotassiumRaisingClass(modSet: ModificationSet, patient: Patient): boolean {
    const currentGroups = new Set((patient.current_regimen ?? []).filter(r => K_RAISING_CLASSES.has(r.med.drug_class)).map(r => getMedicationClassGroup(r.med.drug_class)));
    return modSet.resulting_regimen.some(r => K_RAISING_CLASSES.has(r.med.drug_class) && !currentGroups.has(getMedicationClassGroup(r.med.drug_class)));
}

/** True when the resulting regimen contains a RAAS-pool or MRA/nsMRA drug whose class group is already on the patient's current regimen. */
export function keepsCurrentPotassiumRaiser(modSet: ModificationSet, patient: Patient): boolean {
    const currentGroups = new Set((patient.current_regimen ?? []).filter(r => K_RAISING_CLASSES.has(r.med.drug_class)).map(r => getMedicationClassGroup(r.med.drug_class)));
    return modSet.resulting_regimen.some(r => K_RAISING_CLASSES.has(r.med.drug_class) && currentGroups.has(getMedicationClassGroup(r.med.drug_class)));
}

/**
 * Pre-simulation iron rescue -> simulate once -> reactive K+ binder rescue.
 *
 * The reactive binder rescue covers any candidate whose PROJECTED potassium exceeds 5.3 (for example a RAAS inhibitor
 * continued or increased in a patient already at borderline potassium). It is no longer a way to start an MRA above
 * potassium 5.0: rule E15 withholds that start regardless of binder availability (decision 2026-11-11,
 * verified-clinical-decisions-2026-11-11.md rows 1, 3, 4). Note it still fires for a new MRA whose projected potassium
 * (baseline at or below 5.0 plus the modeled rise) exceeds 5.3.
 *
 * The rescue is REACTIVE ONLY (decision 2026-11-11): it may be attached only when every potassium-raising drug in the candidate (RAAS pool, MRA, nsMRA) was ALREADY
 * on the patient's current regimen in that class (kept, up-titrated or swapped within the class). This follows the 2022 US guideline wording (binders, Class 2b, for
 * hyperkalaemia that develops on existing therapy; secondary source) and the 2026 ESC guideline's absence of any binder recommendation. A candidate that adds a NEW
 * potassium-raising class and projects potassium above 5.3 is returned with `dropped: true` (a binder must not be what makes the new class acceptable) and the
 * caller discards it. E15/E18 already stop most such starts at baseline; this covers a start whose baseline is below the ceiling but whose modeled rise is not.
 */
export function applyRescueAdditions(modSet: ModificationSet, ctx: ScoringContext): { activeModSet: ModificationSet; sim: Simulation; dropped?: true } {
    const { patient, prices, intolerancePolicy, rescueBinders, ivIron, ironDeficient } = ctx;
    // Iron rescue depends only on patient-level invariants and the candidate's contents, so it is appended BEFORE
    // the single simulation (previously every candidate was simulated twice for iron-deficient patients).
    // Only the reactive K+ > 5.3 binder rescue below needs the projected potassium.
    let activeModSet = modSet;

    // Iron rescue: auto-append IV iron when criteria met (clinic-administered, not competing with oral GDMT)
    if (ironDeficient && ivIron && !activeModSet.resulting_regimen.some(r => r.med.drug_class === 'IV Iron')) {
        const ironMod: RegimenModification = {
            action: 'add',
            target: ivIron,
            summary: `Add ${ivIron.med.name} ${formatDose(ivIron)} (iron deficiency)`
        };
        activeModSet = {
            modifications: [...activeModSet.modifications, ironMod],
            resulting_regimen: [...activeModSet.resulting_regimen, ivIron]
        };
    }

    // Try each binder tier in order and keep the first whose simulation brings projected K+ into 3.5-5.3 (the lowest effective dose).
    const withBinder = (base: ModificationSet, binder: RegimenMed): ModificationSet => ({
        modifications: [...base.modifications, {
            action: 'add' as const, target: binder,
            summary: `Add ${binder.med.name} ${formatDose(binder)}`,
        }],
        resulting_regimen: [...base.resulting_regimen, binder],
    });
    const tryBinders = (base: ModificationSet) => {
        for (const binder of rescueBinders) {
            const set = withBinder(base, binder);
            const trial = simulateModificationEffect(patient, set, prices, intolerancePolicy);
            const k = trial.projectedPatient.potassium;
            if (k < 5.3 && k > 3.5) return { set, sim: trial };
        }
        return undefined;
    };

    let sim: Simulation = simulateModificationEffect(patient, activeModSet, prices, intolerancePolicy);
    // The automatic iron add-on must not be the reason a regimen exceeds the stated budget: when the regimen fits without it, it is offered without it and
    // iron stays in the "also eligible" list (2026-11-12: one iron-deficient cash patient with a $100 budget was shown only over-budget options at $284
    // while a $58 three-pillar regimen existed).
    if (activeModSet !== modSet && sim.cost > patient.max_affordable_cost) {
        const plain = simulateModificationEffect(patient, modSet, prices, intolerancePolicy);
        if (plain.cost <= patient.max_affordable_cost) { activeModSet = modSet; sim = plain; }
    }

    // H7+H8: Binder rescue: if K+ > 5.3, try adding a K+ binder (Patiromer preferred, then Lokelma, lowest effective dose)
    // H8 fix: Use activeModSet (which includes iron if appended) not original modSet
    if (sim.projectedPatient.potassium > 5.3 && !activeModSet.resulting_regimen.some(r => r.med.drug_class === 'K+ Binder') && addsNewPotassiumRaisingClass(activeModSet, patient)) {
        return { activeModSet, sim, dropped: true };
    }
    // The binder is attached ONLY to potassium-raising therapy the patient already takes (RAAS pool, MRA, nsMRA kept, up-titrated or swapped within the class). A candidate with
    // no such drug on board (for example a new beta-blocker start, modeled with a small potassium effect) gets no binder and is scored on its own projected potassium.
    if (sim.projectedPatient.potassium > 5.3 && rescueBinders.length > 0 && !activeModSet.resulting_regimen.some(r => r.med.drug_class === 'K+ Binder') && keepsCurrentPotassiumRaiser(activeModSet, patient)) {
        const rescued = tryBinders(activeModSet);
        if (rescued) {
            sim = rescued.sim;
            sim.warnings.push(`Binder Required: ${rescued.set.resulting_regimen[rescued.set.resulting_regimen.length - 1].med.name} added to manage Hyperkalemia.`);
            activeModSet = rescued.set;
        }
    }

    return { activeModSet, sim };
}

/**
 * GDMT completeness: the share of indicated, ACHIEVABLE therapy attained, 0-1. It is the
 * `completeness` domain (score = fraction x 100).
 *
 * Standard of care is COMPLETE guideline therapy, rapidly sequenced - not the smallest safe change.
 * The other domains alone under-reward each added pillar while cost/adherence immediately penalize
 * the extra drug, so partial regimens would out-rank complete ones. "Achievable" excludes
 * therapies the patient cannot take, so a patient is never penalized for a contraindicated pillar.
 *
 * DOSE-AWARE: a pillar present but below target earns PARTIAL credit, so up-titrating a sub-target
 * agent toward its target raises the score (otherwise a quad at starting doses would look
 * "complete" and the engine would prefer "keep" over titration - GDMT inertia). A single-dose
 * drug, or one already at target / at its maximum available dose, earns full credit.
 *
 * With NO achievable slots the fraction is 0 (this reproduces the pre-rescale behavior, where no
 * completeness bonus was added in that case).
 */
export function gdmtCompletenessFraction(activeModSet: ModificationSet, ctx: ScoringContext, slots: GdmtSlot[] = ctx.achievableSlots): { fraction: number; slots: number } {
    const { patient } = ctx;
    const achievableSlots = slots;
    const SUBTARGET_CREDIT = COMPLETENESS_SUBTARGET_CREDIT;
    const slotValue = (s: GdmtSlot): number => {
        const meds = activeModSet.resulting_regimen.filter(r => s.match(r.med.drug_class));
        if (meds.length === 0) return 0;
        let best = 0;
        const optimal = meds.some(r => {
            const doses = r.med.available_doses;
            if (doses.length === 1) return true;
            const atTarget = isTargetDoseForPatient(r, patient);
            const strengths = doses.map(d => Number(d.strength)).filter(n => !Number.isNaN(n));
            const atMax = strengths.length > 0 && Number(r.dose.strength) >= Math.max(...strengths);
            // A dose held at an interaction cap (e.g. eplerenone 25 mg with a moderate CYP3A inhibitor) is at its maximum.
            const cap = r.med.interaction_dose_cap?.(patient);
            const atCap = !!cap && Number(r.dose.strength) >= cap.max_dose;
            const full = atTarget || atMax || atCap;
            if (!full) {
                // Below target: SUBTARGET_CREDIT at or below the labeled starting tier, rising linearly to 1 at target (scoreModel.ts); the flat credit where no numeric target exists.
                const progress = doseProgressToTarget(r, patient);
                best = Math.max(best, progress === undefined ? SUBTARGET_CREDIT : SUBTARGET_CREDIT + COMPLETENESS_GRADED_CREDIT_SPAN * progress);
            }
            return full;
        });
        return optimal ? 1.0 : best;
    };
    if (achievableSlots.length === 0) return { fraction: 0, slots: 0 };
    const attained = achievableSlots.reduce((sum, s) => sum + slotValue(s), 0);
    return { fraction: attained / achievableSlots.length, slots: achievableSlots.length };
}

/** The eight domain scores for one simulated candidate (unrounded for the math, rounded for display). */
export function scoreDomains(
    sim: Simulation,
    activeModSet: ModificationSet,
    ctx: ScoringContext
): { unrounded: Record<ScoreDomainKey, number>; rounded: DomainScores; completenessSlots: number } {
    const { patient, dataAudit, phenotype } = ctx;
    const p = sim.projectedPatient;

    // Unknown baseline NT-proBNP → neutral 50, not a false 100 (it would otherwise
    // read as "perfect neurohormonal status" simply because the field was blank).
    const s_neuro = dataAudit.unknownBnp ? 50 : calculateNeurohormonalScore(p.nt_pro_bnp);
    const s_func = calculateFunctionalScore(p.nyha_class, p.kccq_score, p.daily_step_count);
    const s_vol = calculateVolumeScore(p.volume_status.dry_weight_kg, p.volume_status.current_weight_kg, p.volume_status.exam_findings, p.oxygen_saturation);
    const s_struc = calculateStructureScore(p.lvef, p.lvedd, p.lavi, patient.lvef, patient.lvedd, patient.lavi);
    const s_cost = calculateCostScore(sim.cost, patient.max_affordable_cost, patient.cost_sensitivity);
    const s_adhere = calculateAdherenceScore(sim.complexity, patient.complexity_tolerance);
    const s_guide = calculateGuidelineConcordanceScore(activeModSet.resulting_regimen, patient, phenotype);
    const completeness = gdmtCompletenessFraction(activeModSet, ctx);
    const s_complete = completeness.fraction * 100;
    // Attach the evidence basis (recommendation class + trials) for the pillars present.
    sim.rationale = [...sim.rationale, ...describeConcordance(activeModSet.resulting_regimen, patient, phenotype)];
    const unroundedDomainScores: Record<ScoreDomainKey, number> = {
        neurohormonal: s_neuro, functional: s_func, volume: s_vol, structure: s_struc,
        guideline: s_guide, completeness: s_complete, cost: s_cost, adherence: s_adhere,
    };
    const domainScores: DomainScores = {
        neurohormonal: Math.round(s_neuro),
        functional: Math.round(s_func),
        volume: Math.round(s_vol),
        structure: Math.round(s_struc),
        guideline: Math.round(s_guide),
        completeness: Math.round(s_complete),
        cost: Math.round(s_cost),
        adherence: Math.round(s_adhere),
    };

    return { unrounded: unroundedDomainScores, rounded: domainScores, completenessSlots: completeness.slots };
}

/**
 * Weighted domain sum + the named adjustments (special features, GDMT completeness, volume
 * depletion, projected SBP/HR/K+, warnings, unknown labs) + clamp, with the reconciling breakdown.
 * Pushes the unknown-lab warnings onto `sim.warnings`, exactly as the inline code did.
 */
export function aggregateScore(
    unroundedDomainScores: Record<ScoreDomainKey, number>,
    sim: Simulation,
    activeModSet: ModificationSet,
    ctx: ScoringContext,
    completenessSlots: number = ctx.achievableSlots.length
): { overall: number; raw: number; breakdown: ScoreBreakdown; normalizedSFBonus: number; gdmtCompleteness: number } {
    const { dataAudit, isVolumeDepleted } = ctx;
    const p = sim.projectedPatient;
    // Resolve the patient-selected weight profile once; it affects ONLY the eight domain weights below.
    const weightProfile = resolveWeightProfile(ctx.patient);
    const weights = WEIGHT_PROFILES[weightProfile];

    // Weighted sum of the eight domains (weights sum to 100%), from the patient's WEIGHT_PROFILES row,
    // accumulated left-to-right in DOMAIN_KEYS order.
    const breakdownDomains: ScoreBreakdownDomainLine[] = DOMAIN_KEYS.map(key => ({
        key,
        label: DOMAIN_LABELS[key],
        score: unroundedDomainScores[key],
        weight: weights[key],
        contribution: unroundedDomainScores[key] * weights[key],
        ...(key === 'completeness' && completenessSlots === 0
            ? { detail: 'No achievable indicated therapies for this patient - scored 0' }
            : {}),
    }));
    let overall = breakdownDomains.reduce((sum, d) => sum + d.contribution, 0);
    const weightedSubtotal = overall;
    const breakdownAdjustments: ScoreBreakdownAdjustment[] = [];
    const breakdownOverrides: ScoreBreakdownOverride[] = [];
    const addAdjustment = (spec: { code: string; label: string }, points: number, detail?: string, items?: ScoreBreakdownAdjustment['items']) => {
        overall += points;
        breakdownAdjustments.push({
            code: spec.code, label: spec.label, points,
            ...(detail === undefined ? {} : { detail }),
            ...(items === undefined ? {} : { items }),
        });
    };

    // Special-feature bonus: the average per drug, where the divisor is never smaller than the number of foundational therapies indicated for the patient.
    // Dividing by the regimen size alone made a 3-point note worth about 7 points on a one-drug regimen, so one drug could out-rank a three-pillar start
    // (adversarial review 2026-11-12). Clamped to the SPECIAL_FEATURES bounds.
    const regimenLength = activeModSet.resulting_regimen.length;
    const sfDivisor = Math.max(regimenLength, ctx.indicatedFoundationalSlots.length);
    const normalizedSFBonus = regimenLength > 0
        ? Math.max(SCORE_ADJUSTMENTS.SPECIAL_FEATURES.min, Math.min(SCORE_ADJUSTMENTS.SPECIAL_FEATURES.max, sim.specialFeatureBonus / sfDivisor * SCORE_ADJUSTMENTS.SPECIAL_FEATURES.factor))
        : 0;
    addAdjustment(SCORE_ADJUSTMENTS.SPECIAL_FEATURES, normalizedSFBonus, undefined, sim.specialFeatureItems);

    // GDMT completeness is the eighth weighted DOMAIN (see gdmtCompletenessFraction), not a bonus here.
    const gdmtCompleteness = unroundedDomainScores.completeness / 100;

    // P5: Volume depletion — boost diuretic removal candidates
    if (isVolumeDepleted) {
        const hasDiureticRemoval = hasDiureticDeEscalation(activeModSet);
        if (hasDiureticRemoval) addAdjustment(SCORE_ADJUSTMENTS.VOLUME_DEPLETION_DEESCALATION, SCORE_ADJUSTMENTS.VOLUME_DEPLETION_DEESCALATION.points);
    }

    // Graduated hemodynamic safety penalties for PROJECTED SBP.
    // The input SBP < 90 gate is a separate hard block for truly hypotensive patients, and the
    // display filter hides any regimen projecting SBP < 85 — those protect against real harm.
    // This RANKING penalty is therefore recalibrated to trial tolerability so it no longer
    // swamps guideline value: a projected SBP in the low-to-mid 90s is well within COPERNICUS
    // (enrolled ≥ 85) and PIONEER-HF (≥ 100) tolerability, and the projected value here is the
    // CONSERVATIVE pre-compensation estimate. The prior −60/−30 made hemodynamically-inert
    // drugs (e.g. digoxin) out-rank SGLT2i / full GDMT in de-novo patients starting near
    // SBP 100 — backwards. Disqualification at < 85 is retained.
    // The 90 and 95 bands read the LOWER of the projected and the entered systolic pressure: a regimen that raises blood pressure by reducing or stopping a drug
    // is not credited with leaving the band. Otherwise, at an entered SBP of 93, "halve the beta-blocker" out-scored "no change" (which carries the band penalty)
    // while "double the beta-blocker" also out-scored it on completeness, and the tool reversed its own advice on the next run (adversarial review 2026-11-12).
    const sbpForBand = Math.min(p.sbp, ctx.patient.sbp > 0 ? ctx.patient.sbp : p.sbp);
    const sbpDetail = sbpForBand < p.sbp ? `entered SBP ${ctx.patient.sbp} (projected ${p.sbp}; a dose reduction is not credited with leaving this band)` : `projected SBP ${p.sbp}`;
    if (p.sbp < SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.threshold) {
        // Projected severe hypotension — disqualify (also display-filtered). Non-additive: recorded as an override.
        // NOTE: later adjustments (HR, K+, warnings, unknown-lab) still apply on top of this zeroed total.
        breakdownOverrides.push({
            code: SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.code,
            label: SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.label,
            applies_to: 'raw_score',
            before: overall,
            after: 0,
            detail: `projected SBP ${p.sbp}`,
        });
        overall = 0;
    }
    else if (sbpForBand < SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90, SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.points, sbpDetail);  // Caution; GDMT often still appropriate with monitoring
    else if (sbpForBand < SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95, SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95.points, sbpDetail);   // Mild; within trial tolerability for the conservative estimate
    // Heart-rate band: only with a measured heart rate, and (like the SBP bands) on the LOWER of projected and entered, so cutting a beta-blocker is not rewarded
    // for leaving the band (a rate below the reduce threshold already forces the reduction in every option; a paced patient at 49 is not helped by it).
    const hrKnown = ctx.patient.pulse > 0;
    const hrForBand = Math.min(p.pulse, hrKnown ? ctx.patient.pulse : p.pulse);
    if (hrKnown && hrForBand < SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50, SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.points, hrForBand < p.pulse ? `entered HR ${ctx.patient.pulse} (projected ${p.pulse}; a dose reduction is not credited with leaving this band)` : `projected HR ${p.pulse}`);
    if (p.potassium > SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5, SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.points, `projected K+ ${p.potassium}`);

    // "Binder Required" deliberately COUNTS here: a regimen that needs a rescue binder to
    // stay under the K+ ceiling carries residual hyperkalemia risk. The binder enables the
    // regimen to be considered, but must not erase the risk in ranking — an
    // otherwise-equal regimen that needs no rescue should score above one that does.
    // Only TRUE safety warnings should reduce the score. Informational / procedural guidance
    // (titration cadence, elderly start-low-go-slow, routine monitoring) must NOT be penalized —
    // counting the "Titration Interval" guidance as a danger made titrating GDMT toward target
    // score LOWER than leaving it sub-target, defeating the point. NOTE: "Binder Required" is
    // deliberately NOT here — a regimen needing K+ binder rescue carries residual hyperkalemia
    // risk and should rank below an equal regimen that does not (a binder enables, it doesn't erase).
    // Marker list (NON_PENALIZED_WARNING_MARKERS) lives in services/engine/scoreModel.ts.
    const ownWarnings = sim.warnings.filter(isPenalizedWarning);
    // Plus the warnings that were already true before any change and that this candidate no longer shows: they still count (see baselineDangerWarnings).
    const ownKeys = new Set(ownWarnings.map(warningKey));
    const carried = [...ctx.baselineDangerWarnings.entries()].filter(([key]) => !ownKeys.has(key)).map(([, text]) => `${text} (true of the current regimen; counted for every option)`);
    const dangerousWarnings = [...ownWarnings, ...carried];
    if (dangerousWarnings.length > 0) addAdjustment(SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS, dangerousWarnings.length * SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS.perUnit, dangerousWarnings.join(' | '));

    // Unknown baseline potassium: a RAAS/MRA start or dose increase can no longer reach this point with the lab
    // blank - eligibility rule E16 withholds new starts and scoreCandidates drops dose increases (2026-11-11
    // physician-owner decision), so the old -12 caution (UNKNOWN_POTASSIUM) was removed as unreachable.

    // Unknown renal function: RAAS/MRA intensification is dropped before scoring (E16 + scoreCandidates), so only
    // SGLT2i remains reachable here. Renal-gated current meds are retained (not force-removed on blank data) and
    // renal-gated new starts are withheld (E12) - but a candidate that adds or up-titrates an SGLT2i must carry an
    // explicit caution and ranking penalty until a BMP is obtained.
    if (dataAudit.unknownRenal) {
        const intensifiesRenalGated = activeModSet.modifications.some(m =>
            (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') &&
            m.target && m.target.med.drug_class === 'SGLT2i'
        );
        if (intensifiesRenalGated) {
            addAdjustment(SCORE_ADJUSTMENTS.UNKNOWN_RENAL, SCORE_ADJUSTMENTS.UNKNOWN_RENAL.points);
            sim.warnings.push('RENAL FUNCTION UNKNOWN: eGFR/creatinine was not entered. Obtain a BMP before initiating or up-titrating SGLT2i therapy — renal dosing and safety cannot be assessed.');
        }
    }

    const finalOverall = Math.round(Math.min(SCORE_ADJUSTMENTS.SCORE_CLAMP.max, Math.max(SCORE_ADJUSTMENTS.SCORE_CLAMP.min, overall)));
    const wasClamped = overall < SCORE_ADJUSTMENTS.SCORE_CLAMP.min || overall > SCORE_ADJUSTMENTS.SCORE_CLAMP.max;
    if (wasClamped) {
        breakdownOverrides.push({
            code: SCORE_ADJUSTMENTS.SCORE_CLAMP.code,
            label: SCORE_ADJUSTMENTS.SCORE_CLAMP.label,
            applies_to: 'overall_score',
            before: overall,
            after: finalOverall,
        });
    }
    const scoreBreakdown: ScoreBreakdown = {
        weight_profile: weightProfile,
        domains: breakdownDomains,
        weighted_subtotal: weightedSubtotal,
        adjustments: breakdownAdjustments,
        raw_score: overall,
        overall_score: finalOverall,
        clamped: wasClamped,
        ...(breakdownOverrides.length > 0 ? { overrides: breakdownOverrides } : {}),
    };

    return { overall: finalOverall, raw: overall, breakdown: scoreBreakdown, normalizedSFBonus, gdmtCompleteness };
}

/**
 * True when the candidate adds, swaps to, or up-titrates an ACEi/ARB/ARNI, MRA or nsMRA. Dose reductions,
 * removals and keeps do not count.
 */
export function intensifiesRaasOrMra(modSet: ModificationSet): boolean {
    return modSet.modifications.some(m =>
        (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') &&
        m.target && (RAAS_CLASSES.has(m.target.med.drug_class) || MRA_POOL_CLASSES.has(m.target.med.drug_class)));
}

/** Potassium or renal function is blank: RAAS/MRA intensification is withheld (rule E16, candidate level). */
export function labPrerequisiteBlank(dataAudit: CriticalDataAudit): boolean {
    return dataAudit.unknownPotassium || dataAudit.unknownRenal;
}

/** Score every candidate; candidates dropped by the volume-depletion gate or the new-class cap are skipped. */
export function scoreCandidates(candidateSets: ModificationSet[], ctx: ScoringContext): ScoredRegimen[] {
    const { patient, isVolumeDepleted, hasDiureticInCurrent, maxNewPerVisit } = ctx;
    const results: ScoredRegimen[] = [];

    candidateSets.forEach(modSet => {
        // Laboratory prerequisite (engine policy, physician-owner decision 2026-11-11): with potassium or renal
        // function blank, any candidate that adds, swaps to or up-titrates a RAAS inhibitor / MRA is dropped.
        if (labPrerequisiteBlank(ctx.dataAudit) && intensifiesRaasOrMra(modSet)) return;

        const requiresDiureticFirst = isVolumeDepleted && hasDiureticInCurrent;
        if (requiresDiureticFirst) {
            const hasUnsafeIntensification = hasRelevantIntensification(modSet, VOLUME_SENSITIVE_INTENSIFICATION_CLASSES);
            const hasPriorityDeEscalation = hasDiureticDeEscalation(modSet);
            if (hasUnsafeIntensification && !hasPriorityDeEscalation) {
                return;
            }
        }

        // Rescue appends + the single simulation (+ reactive K+ binder re-simulation), then the new-class cap.
        const { activeModSet, sim, dropped } = applyRescueAdditions(modSet, ctx);
        if (dropped) return; // a new potassium-raising class that would need a binder to stay in range is not offered

        if (countNewClassGroups(activeModSet.resulting_regimen, patient.current_regimen || []) > maxNewPerVisit) {
            return;
        }

        const domains = scoreDomains(sim, activeModSet, ctx);
        const agg = aggregateScore(domains.unrounded, sim, activeModSet, ctx, domains.completenessSlots);
        results.push({
            regimen: activeModSet.resulting_regimen,
            projected_patient: sim.projectedPatient,
            baseline_lvef: patient.lvef,
            baseline_lvedd: patient.lvedd,
            baseline_lavi: patient.lavi,
            baseline_dry_weight_kg: patient.volume_status.dry_weight_kg,
            overall_score: agg.overall,
            raw_score: agg.raw,
            score_breakdown: agg.breakdown,
            domain_scores: domains.rounded,
            special_feature_bonus: Math.round(agg.normalizedSFBonus),
            gdmt_completeness: agg.gdmtCompleteness,
            // Same per-slot credit rule, over the foundational (pillar) slots only; explanation/ranking-mode only, never scored.
            // Over the INDICATED pillars, not only those startable today: with a pillar held (potassium 5.3) two of four on board read "80%" (review 2026-11-12).
            foundational_coverage: gdmtCompletenessFraction(activeModSet, ctx, ctx.indicatedFoundationalSlots).fraction * 100,
            foundational_slots: {
                indicated: ctx.indicatedFoundationalSlots.length,
                on_board: ctx.indicatedFoundationalSlots.filter(sl => activeModSet.resulting_regimen.some(r => sl.match(r.med.drug_class))).length,
                not_startable: ctx.indicatedFoundationalSlots.filter(sl => !ctx.achievableSlots.includes(sl) && !activeModSet.resulting_regimen.some(r => sl.match(r.med.drug_class))).length,
            },
            cost: sim.cost,
            complexity: sim.complexity,
            rationale: sim.rationale,
            risks: [],
            warnings: sim.warnings,
            // Display-only artifacts (monitoring plan, qualitative projections, trade-off labels)
            // are populated AFTER distinctPicks selection — building them for every scored
            // candidate was pure waste since only ≤ 3 are ever returned.
            monitoring_plan: [],
            qualitative_projections: [],
            trade_offs: [],
            modification_set: activeModSet
        });
    });

    if (typeof process !== 'undefined' && process.env && process.env.DEBUG_CAND) {
        [...results].sort((a, b) => (b.raw_score ?? 0) - (a.raw_score ?? 0)).slice(0, 14).forEach(r => {
            const ch = (r.modification_set?.modifications ?? []).filter(m => m.action !== 'keep').map(m => `${m.action}:${(m.target ?? m.source)?.med.name} ${m.target?.dose?.strength ?? ''}`);
            console.log(`   [cand] ${(r.raw_score ?? 0).toFixed(1)} c${(r.gdmt_completeness ?? 0).toFixed(2)} :: ${ch.join(', ') || 'KEEP'}`);
        });
    }

    return results;
}
