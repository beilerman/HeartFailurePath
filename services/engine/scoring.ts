/**
 * Pipeline stage 6 - score every candidate modification set. Moved verbatim from the per-candidate
 * loop in generateAndScoreModifications, split into named steps that run in the original order:
 *   volume-depletion gate -> applyRescueAdditions -> max-new-classes filter -> scoreDomains ->
 *   aggregateScore -> assemble ScoredRegimen.
 * The two early returns (gate, max-new filter) drop a candidate exactly where they always did.
 */
import { Patient, Medication, ScoredRegimen, RegimenMed, RegimenModification, ModificationSet, DomainScores } from '../../types';
import {
    DOMAIN_KEYS, DOMAIN_LABELS, WEIGHT_PROFILES, resolveWeightProfile, SCORE_ADJUSTMENTS, NON_PENALIZED_WARNING_MARKERS,
    ScoreBreakdown, ScoreBreakdownAdjustment, ScoreBreakdownDomainLine, ScoreBreakdownOverride, ScoreDomainKey,
} from './scoreModel';
import { drugFacts } from './drugFacts';
import { isIronDeficient } from '../clinicalPredicates';
import { RAAS_CLASSES, VOLUME_SENSITIVE_INTENSIFICATION_CLASSES } from './registry';
import { countNewClassGroups, formatDose, hasDiureticDeEscalation, hasRelevantIntensification, isTargetDoseForPatient } from './regimenUtils';
import { calculateAdherenceScore, calculateCostScore, calculateFunctionalScore, calculateGuidelineConcordanceScore, calculateNeurohormonalScore, calculateStructureScore, calculateVolumeScore, classifyPhenotype, describeConcordance, Phenotype } from './domains';
import { simulateModificationEffect } from './effects';
import { IntolerancePolicy } from './intolerance';
import { RegimenAnalysis } from './candidates';
import { CriticalDataAudit, ClinicalFlags } from './gates';

type Simulation = ReturnType<typeof simulateModificationEffect>;

/** One indicated, achievable therapy slot counted by the GDMT-completeness adjustment. */
export interface GdmtSlot { match: (cls: string) => boolean; }

/** Everything the per-candidate steps read, computed once per patient (not per candidate). */
export interface ScoringContext {
    patient: Patient;
    prices: Record<string, number>;
    intolerancePolicy: IntolerancePolicy;
    dataAudit: CriticalDataAudit;
    phenotype: Phenotype;
    isVolumeDepleted: boolean;
    hasDiureticInCurrent: boolean;
    rescueBinder: RegimenMed | undefined;
    ivIron: RegimenMed | undefined;
    ironDeficient: boolean;
    maxNewPerVisit: number;
    achievableSlots: GdmtSlot[];
}

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
    const binders = medTiers.filter(r => r.med.drug_class === 'K+ Binder');
    // H7: Binder rescue — prefer Patiromer, fallback to any available K+ binder (Lokelma)
    const rescueBinder = binders.find(b => drugFacts(b.med).rescue_role?.preferred) || binders[0];
    const ivIron = medTiers.find(r => r.med.drug_class === 'IV Iron');
    const ironDeficient = isIronDeficient(patient);
    const maxNewPerVisit = Math.max(0, Math.round(patient.max_new_classes_per_visit ?? 2));

    // --- GDMT completeness slots (the `completeness` domain, see gdmtCompletenessFraction) ----
    // Each INDICATED, ACHIEVABLE therapy is one slot. "Achievable" excludes therapies the patient
    // cannot take (already filtered out of `formulary`), so a patient is never penalized for a
    // contraindicated pillar. Safety penalties are applied on top of the weighted sum, so an unsafe
    // projection still disqualifies the regimen regardless of completeness.
    const phenotype = classifyPhenotype(patient);
    const isReducedPhenotype = phenotype === 'HFrEF' || phenotype === 'HFmrEF';

    const completenessSlots: GdmtSlot[] = [];
    if (isReducedPhenotype) {
        completenessSlots.push(
            { match: (c) => RAAS_CLASSES.has(c) },
            { match: (c) => c === 'Beta Blocker' },
            { match: (c) => c === 'MRA' || (c === 'nsMRA' && phenotype === 'HFmrEF') },
            { match: (c) => c === 'SGLT2i' }
        );
    } else { // HFpEF
        completenessSlots.push(
            { match: (c) => c === 'SGLT2i' },
            { match: (c) => c === 'MRA' || c === 'nsMRA' } // TOPCAT / FINEARTS-HF adjunct
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

    // Keep only slots the patient can actually attain (a non-excluded formulary med exists).
    const achievableSlots = completenessSlots.filter(s => formulary.some(m => s.match(m.drug_class)));

    return {
        patient, prices, intolerancePolicy, dataAudit, phenotype, isVolumeDepleted, hasDiureticInCurrent,
        rescueBinder, ivIron, ironDeficient, maxNewPerVisit, achievableSlots,
    };
}

/** Pre-simulation rescue appends (iron, DIAMOND binder) -> simulate once -> reactive K+ binder rescue. */
export function applyRescueAdditions(modSet: ModificationSet, ctx: ScoringContext): { activeModSet: ModificationSet; sim: Simulation } {
    const { patient, prices, intolerancePolicy, rescueBinder, ivIron, ironDeficient } = ctx;
    // Pre-simulation rescue appends are built FIRST, then the candidate is simulated ONCE.
    // Iron rescue depends only on patient-level invariants and the candidate's contents;
    // DIAMOND depends on BASELINE potassium — neither needs a prior simulation (previously
    // every candidate was simulated twice for iron-deficient patients, discarding the first
    // result). Only the reactive K+ > 5.3 binder rescue below needs the projected potassium.
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

    // DIAMOND protocol: proactive binder co-prescription when initiating MRA at baseline K+ > 5.0
    const isMraAdd = activeModSet.modifications.some(m =>
        m.action === 'add' && m.target &&
        (m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA')
    );
    const alreadyHasBinder = activeModSet.resulting_regimen.some(r =>
        r.med.drug_class === 'K+ Binder'
    );
    if (isMraAdd && patient.potassium > 5.0 && rescueBinder && !alreadyHasBinder) {
        const diamondMod: RegimenModification = {
            action: 'add',
            target: rescueBinder,
            summary: `Add ${rescueBinder.med.name} ${formatDose(rescueBinder)} (DIAMOND protocol)`
        };
        activeModSet = {
            modifications: [...activeModSet.modifications, diamondMod],
            resulting_regimen: [...activeModSet.resulting_regimen, rescueBinder]
        };
    }

    let sim = simulateModificationEffect(patient, activeModSet, prices, intolerancePolicy);

    // H7+H8: Binder rescue: if K+ > 5.3, try adding K+ binder (Patiromer preferred, Lokelma fallback)
    // H8 fix: Use activeModSet (which includes iron if appended) not original modSet
    if (sim.projectedPatient.potassium > 5.3 && rescueBinder && !activeModSet.resulting_regimen.some(r => r.med.drug_class === 'K+ Binder')) {
        const rescueMod: RegimenModification = {
            action: 'add',
            target: rescueBinder,
            summary: `Add ${rescueBinder.med.name} ${formatDose(rescueBinder)}`
        };
        const rescuedModSet: ModificationSet = {
            modifications: [...activeModSet.modifications, rescueMod],
            resulting_regimen: [...activeModSet.resulting_regimen, rescueBinder]
        };
        const rescuedSim = simulateModificationEffect(patient, rescuedModSet, prices, intolerancePolicy);

        if (rescuedSim.projectedPatient.potassium < 5.3 && rescuedSim.projectedPatient.potassium > 3.5) {
            sim = rescuedSim;
            sim.warnings.push(`Binder Required: ${rescueBinder.med.name} added to manage Hyperkalemia.`);
            activeModSet = rescuedModSet;
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
export function gdmtCompletenessFraction(activeModSet: ModificationSet, ctx: ScoringContext): { fraction: number; slots: number } {
    const { patient, achievableSlots } = ctx;
    const SUBTARGET_CREDIT = 0.6;
    const slotValue = (s: GdmtSlot): number => {
        const meds = activeModSet.resulting_regimen.filter(r => s.match(r.med.drug_class));
        if (meds.length === 0) return 0;
        const optimal = meds.some(r => {
            const doses = r.med.available_doses;
            if (doses.length === 1) return true;
            const atTarget = isTargetDoseForPatient(r, patient);
            const strengths = doses.map(d => Number(d.strength)).filter(n => !Number.isNaN(n));
            const atMax = strengths.length > 0 && Number(r.dose.strength) >= Math.max(...strengths);
            return atTarget || atMax;
        });
        return optimal ? 1.0 : SUBTARGET_CREDIT;
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

    // Special feature bonus (normalized by regimen size, clamped to the SPECIAL_FEATURES bounds)
    const regimenLength = activeModSet.resulting_regimen.length;
    const normalizedSFBonus = regimenLength > 0
        ? Math.max(SCORE_ADJUSTMENTS.SPECIAL_FEATURES.min, Math.min(SCORE_ADJUSTMENTS.SPECIAL_FEATURES.max, sim.specialFeatureBonus / regimenLength * SCORE_ADJUSTMENTS.SPECIAL_FEATURES.factor))
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
    else if (p.sbp < SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90, SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.points, `projected SBP ${p.sbp}`);  // Caution; GDMT often still appropriate with monitoring
    else if (p.sbp < SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95, SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95.points, `projected SBP ${p.sbp}`);   // Mild; within trial tolerability for the conservative estimate
    if (p.pulse < SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50, SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.points, `projected HR ${p.pulse}`);
    if (p.potassium > SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.threshold) addAdjustment(SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5, SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.points, `projected K+ ${p.potassium}`);

    // "Binder Required" deliberately COUNTS here: a regimen that needs a rescue binder to
    // stay under the K+ ceiling carries residual hyperkalemia risk. The binder enables the
    // regimen to be considered (DIAMOND), but must not erase the risk in ranking — an
    // otherwise-equal regimen that needs no rescue should score above one that does.
    // Only TRUE safety warnings should reduce the score. Informational / procedural guidance
    // (titration cadence, elderly start-low-go-slow, routine monitoring) must NOT be penalized —
    // counting the "Titration Interval" guidance as a danger made titrating GDMT toward target
    // score LOWER than leaving it sub-target, defeating the point. NOTE: "Binder Required" is
    // deliberately NOT here — a regimen needing K+ binder rescue carries residual hyperkalemia
    // risk and should rank below an equal regimen that does not (DIAMOND enables, doesn't erase).
    // Marker list (NON_PENALIZED_WARNING_MARKERS) lives in services/engine/scoreModel.ts.
    const dangerousWarnings = sim.warnings.filter(w =>
        !NON_PENALIZED_WARNING_MARKERS.some(marker => w.includes(marker))
    );
    if (dangerousWarnings.length > 0) addAdjustment(SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS, dangerousWarnings.length * SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS.perUnit, dangerousWarnings.join(' | '));

    // Unknown baseline potassium: the projected-K+ hyperkalemia gate above is meaningless
    // when K+ was never entered (it computes from a 0 baseline and always looks "safe").
    // For any RAAS/MRA initiation or up-titration, apply an explicit caution penalty and
    // a mandatory pre-initiation check — never let blank data clear the gate. (Placed after
    // the dangerousWarnings penalty so the added warning is not double-counted.)
    if (dataAudit.unknownPotassium) {
        const initiatesRaasMra = activeModSet.modifications.some(m =>
            (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') &&
            m.target && (RAAS_CLASSES.has(m.target.med.drug_class) || m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA')
        );
        if (initiatesRaasMra) {
            addAdjustment(SCORE_ADJUSTMENTS.UNKNOWN_POTASSIUM, SCORE_ADJUSTMENTS.UNKNOWN_POTASSIUM.points);
            sim.warnings.push('POTASSIUM UNKNOWN: Baseline serum potassium was not entered. Obtain a BMP and confirm K+ ≤ 5.0 before initiating or up-titrating this RAAS inhibitor / MRA.');
        }
    }

    // Unknown renal function: same pattern as unknown potassium. Renal-gated current meds
    // are retained (not force-removed on blank data) and renal-gated new starts are withheld
    // with a data-required reason — but any candidate that UP-TITRATES a retained renal-gated
    // class must carry an explicit caution and ranking penalty until a BMP is obtained.
    if (dataAudit.unknownRenal) {
        const intensifiesRenalGated = activeModSet.modifications.some(m =>
            (m.action === 'add' || m.action === 'titrate_up' || m.action === 'swap') &&
            m.target && (RAAS_CLASSES.has(m.target.med.drug_class) || m.target.med.drug_class === 'MRA'
                || m.target.med.drug_class === 'nsMRA' || m.target.med.drug_class === 'SGLT2i')
        );
        if (intensifiesRenalGated) {
            addAdjustment(SCORE_ADJUSTMENTS.UNKNOWN_RENAL, SCORE_ADJUSTMENTS.UNKNOWN_RENAL.points);
            sim.warnings.push('RENAL FUNCTION UNKNOWN: eGFR/creatinine was not entered. Obtain a BMP before initiating or up-titrating RAAS / MRA / SGLT2i therapy — renal dosing and safety cannot be assessed.');
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

/** Score every candidate; candidates dropped by the volume-depletion gate or the new-class cap are skipped. */
export function scoreCandidates(candidateSets: ModificationSet[], ctx: ScoringContext): ScoredRegimen[] {
    const { patient, isVolumeDepleted, hasDiureticInCurrent, maxNewPerVisit } = ctx;
    const results: ScoredRegimen[] = [];

    candidateSets.forEach(modSet => {
        const requiresDiureticFirst = isVolumeDepleted && hasDiureticInCurrent;
        if (requiresDiureticFirst) {
            const hasUnsafeIntensification = hasRelevantIntensification(modSet, VOLUME_SENSITIVE_INTENSIFICATION_CLASSES);
            const hasPriorityDeEscalation = hasDiureticDeEscalation(modSet);
            if (hasUnsafeIntensification && !hasPriorityDeEscalation) {
                return;
            }
        }

        // Rescue appends + the single simulation (+ reactive K+ binder re-simulation), then the new-class cap.
        const { activeModSet, sim } = applyRescueAdditions(modSet, ctx);

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
