/** The domain scorers, their scoring constants, and the guideline-concordance table. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, RegimenMed } from '../../types';
import type { ScoreDomainKey } from './scoreModel';
import { hasHistoricalHFrEF, hasPriorLvefBelow50 } from '../clinicalPredicates';
import { DIURETIC_CLASSES, RAAS_CLASSES, getMedicationClassGroup } from './registry';
import { isTargetDoseForPatient, shouldPreserveQuadForUnknownHistory } from './regimenUtils';

/**
 * Whether a nonsteroidal MRA (finerenone) may fill the MRA slot for this patient. FINEARTS-HF and the Kerendia HF label cover LVEF 40 or
 * higher, so it fills the slot at current LVEF 41 or higher (the former HFmrEF range and HFpEF) but never for a patient with a documented (or
 * presumed) prior LVEF of 40 or lower: that patient is improved-EF HFrEF and takes a steroidal MRA (2026 ESC Table 5: steroidal MRA for HFrEF).
 * The 2026 ESC guideline recommends a steroidal MRA below LVEF 50; keeping the finerenone allowance at 41-49 is the stricter-evidence US
 * label rule (docs/evidence-matrix.md HF-MRA-010).
 */
export function nsMraFillsMraSlot(patient: Patient): boolean {
    return patient.lvef >= 41 && !isImprovedEF(patient);
}

export function mineralocorticoidCountsAsEvidencePillar(drugClass: string, patient: Patient): boolean {
    if (drugClass === 'MRA') return true;
    return drugClass === 'nsMRA' && nsMraFillsMraSlot(patient);
}

export function regimenSatisfiesPillar(regimen: RegimenMed[], pillar: string, patient: Patient): boolean {
    return regimen.some(r => {
        const cls = r.med.drug_class;
        if (pillar === 'RAAS Inhibitor') return RAAS_CLASSES.has(cls);
        if (pillar === 'Beta Blocker') return cls === 'Beta Blocker';
        if (pillar === 'MRA') return mineralocorticoidCountsAsEvidencePillar(cls, patient);
        if (pillar === 'SGLT2i') return cls === 'SGLT2i';
        return getMedicationClassGroup(cls) === pillar;
    });
}

// Shared scoring constants — EXPORTED so the in-app score-detail explanations
// (components/ScoreDetailModal.tsx) render directly from the engine's own tables and can
// never drift from the actual scoring math (they previously re-hardcoded these values).
export const BNP_SCORE_TARGET = 125;    // NT-proBNP <= target → 100 pts

export const BNP_SCORE_CRITICAL = 4000; // NT-proBNP >= critical → 0 pts

export const NYHA_SCORE_MAP: Record<string, number> = { "I": 100, "II": 75, "III": 40, "IV": 10 };

export const FUNCTIONAL_STEPS_FULL_CREDIT = 7000; // daily steps for a 100-pt step score

export const VOLUME_SCORING = {
    weightPenaltyPerKgAbove1: 15, // -15 pts per kg above the 1 kg buffer
    findingPenalty: 10,           // -10 pts per congestion exam finding
    spo2SeverePenalty: 20,        // SpO2 < 90
    spo2MildPenalty: 10,          // SpO2 < 94
} as const;

// Tolerance 0 → threshold 2 (~1 drug BID); 5 → 11 (quad therapy); 10 → 20 (unlimited).
export const adherenceComplexityThreshold = (tolerance: number): number => 2 + tolerance * 1.8;

/**
 * One plain sentence per score domain stating what a domain score of 100 means, built from the
 * exported scoring constants above so the wording cannot drift from the math. (Lives here, not in
 * scoreModel.ts, because scoreModel has no imports and these constants live in this module.)
 */
export const DOMAIN_GOALS: Record<ScoreDomainKey, string> = {
    neurohormonal: `NT-proBNP is at or below ${BNP_SCORE_TARGET} pg/mL (0 at ${BNP_SCORE_CRITICAL} or above).`,
    functional: `NYHA class I, a full KCCQ score of 100, and ${FUNCTIONAL_STEPS_FULL_CREDIT.toLocaleString('en-US')} or more daily steps.`,
    volume: 'At dry weight with no congestion findings on exam and normal oxygen saturation.',
    structure: 'Normal LVEF with normal chamber size, and recovery or improvement from baseline.',
    guideline: 'Every guideline-indicated pillar for the heart-failure phenotype is present at its target dose.',
    completeness: 'Every achievable indicated therapy is on board at its target dose.',
    cost: 'Monthly out-of-pocket cost is within budget and low relative to it.',
    adherence: "The regimen's complexity is within the patient's complexity tolerance.",
};

/**
 * Domain 1: Neurohormonal (NT-proBNP)
 * Target < 125 (100pts). Critical >= 4000 (0pts).
 */
export function calculateNeurohormonalScore(bnp: number): number {
    if (bnp <= BNP_SCORE_TARGET) return 100;
    if (bnp >= BNP_SCORE_CRITICAL) return 0;
    // Linear interpolation
    return 100 - ((bnp - BNP_SCORE_TARGET) / (BNP_SCORE_CRITICAL - BNP_SCORE_TARGET) * 100);
}

/**
 * Domain 2: Functional Status (NYHA + KCCQ + Steps)
 * NYHA: I(100), II(75), III(40), IV(10).
 * KCCQ: 0-100 direct.
 * Steps: <2000 (Low), >5000 (High).
 */
export function calculateFunctionalScore(nyha: string, kccq: number, steps?: number): number {
    const nyhaScore = NYHA_SCORE_MAP[nyha] || 0;

    let totalScore = nyhaScore + kccq;
    let divisor = 2;

    if (steps !== undefined) {
        // Map steps: 0 steps = 0 pts, 7000 steps = 100 pts.
        const stepScore = Math.min(100, (steps / FUNCTIONAL_STEPS_FULL_CREDIT) * 100);
        totalScore += stepScore;
        divisor += 1;
    }

    return totalScore / divisor;
}

/**
 * Domain 3: Volume Status
 * Base 100. Penalty for weight gain (>1kg), exam findings, and low SpO2.
 */
export function calculateVolumeScore(dryWeight: number, currentWeight: number, findings: Set<string>, spo2?: number): number {
    let score = 100;
    const diff = currentWeight - dryWeight;

    // Weight Penalty: -15 pts per kg above 1kg buffer
    if (diff > 1.0) {
        score -= (diff - 1.0) * VOLUME_SCORING.weightPenaltyPerKgAbove1;
    }

    // Findings Penalty: -10 pts per finding
    score -= (findings.size * VOLUME_SCORING.findingPenalty);

    // SpO2 Penalty (Surrogate for Pulmonary Congestion)
    if (spo2 !== undefined) {
        if (spo2 < 90) score -= VOLUME_SCORING.spo2SeverePenalty; // Severe/Hypoxia
        else if (spo2 < 94) score -= VOLUME_SCORING.spo2MildPenalty; // Mild-Mod
    }

    return Math.max(0, Math.min(100, score));
}

/**
 * LVEF severity category (Aimo et al. 2021, ESC HF)
 * Used for reverse remodeling bonus — crossing categories is strongly prognostic.
 */
export function getLvefCategory(lvef: number): number {
    if (lvef <= 30) return 0; // Severe
    if (lvef <= 40) return 1; // Moderate
    if (lvef <= 55) return 2; // Mild
    return 3; // Normal
}

/** Blend of the three structure sub-scores (absolute LVEF / improvement vs baseline / chamber size). Sums to 1. */
export const STRUCTURE_BLEND_WEIGHTS = { absolute: 0.40, improvement: 0.40, chamber: 0.20 } as const;

/**
 * Domain 4: Structure (Cardiac Remodeling & Recovery)
 * Blended: 40% absolute state + 40% improvement trajectory + 20% chamber geometry.
 * A score of 0 = severe untreated cardiomyopathy with no treatment response.
 *
 * Absolute (40%): Piecewise-linear LVEF (ACC/AHA 2022, ceiling 55%).
 *   15→0, 25→15, 35→40, 45→70, 55→100. Gives more resolution in HFrEF range.
 *
 * Improvement (40%): Sqrt-scaled LVEF delta / achievable gap (Aimo 2021, Kan 2023).
 *   Near-normal baselines get a normality floor so HFpEF isn't penalized for
 *   having little room to improve. Category crossing adds +10.
 *
 * Chamber (20%): Projected LVEDD/LAVI severity (ASE/EACVI) + direction-of-change.
 *   Improving >5% → +20, worsening >5% → −20. Neutral 50 when echo data unavailable.
 */
export function calculateStructureScoreComponents(
    lvef: number, lvedd: number | undefined, lavi: number | undefined,
    baselineLvef: number, baselineLvedd?: number, baselineLavi?: number
): { absoluteScore: number; improvementScore: number; chamberScore: number; blended: number } {
    // --- Component 1: Absolute State (0-100) ---
    // Piecewise-linear: gives clinical resolution at each severity tier
    let absoluteScore: number;
    if (lvef >= 55) absoluteScore = 100;
    else if (lvef >= 45) absoluteScore = 70 + ((lvef - 45) / 10) * 30;  // Near-normal
    else if (lvef >= 35) absoluteScore = 40 + ((lvef - 35) / 10) * 30;  // LVEF 35-44, mildly reduced range
    else if (lvef >= 25) absoluteScore = 15 + ((lvef - 25) / 10) * 25;  // Moderate HFrEF
    else if (lvef >= 15) absoluteScore = ((lvef - 15) / 10) * 15;       // Severe HFrEF
    else absoluteScore = 0;                                               // Incompatible w/ life

    // --- Component 2: Improvement Trajectory (0-100) ---
    const achievableGap = Math.max(5, 55 - baselineLvef); // floor avoids /0
    const lvefDelta = Math.max(0, lvef - baselineLvef);
    const ratio = Math.min(1, lvefDelta / achievableGap);
    let improvementScore = Math.sqrt(ratio) * 100; // concave: partial gains rewarded

    // Category crossing bonus (Aimo 2021) — crossing severe→moderate→mild→normal is prognostic
    if (getLvefCategory(lvef) > getLvefCategory(baselineLvef)) {
        improvementScore = Math.min(100, improvementScore + 10);
    }

    // Normality floor: near-normal baselines shouldn't be penalized for limited room to improve
    // LVEF 55 → floor 80; LVEF 20 → floor 0; linear ramp
    const gapToNormal = Math.max(0, 55 - baselineLvef);
    const normalityFloor = Math.max(0, (1 - gapToNormal / 35) * 80);
    improvementScore = Math.max(normalityFloor, improvementScore);

    // --- Component 3: Chamber Geometry (0-100) ---
    const chamberScores: number[] = [];

    if (lvedd && lvedd > 0) {
        // LVEDD severity base (ASE/EACVI grading)
        let lveddScore: number;
        if (lvedd <= 52) lveddScore = 100;       // Normal
        else if (lvedd <= 56) lveddScore = 75;   // Borderline
        else if (lvedd <= 62) lveddScore = 50;   // Mild dilation
        else if (lvedd <= 68) lveddScore = 25;   // Moderate dilation
        else lveddScore = 0;                      // Severe dilation

        // Direction modifier: reward shrinkage, penalize growth
        if (baselineLvedd && baselineLvedd > 0) {
            const pctReduction = (baselineLvedd - lvedd) / baselineLvedd;
            if (pctReduction > 0.05) lveddScore += 20;
            else if (pctReduction > 0.01) lveddScore += 10;
            else if (pctReduction < -0.05) lveddScore -= 20;
            else if (pctReduction < -0.01) lveddScore -= 10;
        }
        chamberScores.push(Math.max(0, Math.min(100, lveddScore)));
    }

    if (lavi && lavi > 0) {
        // LAVI severity base
        let laviScore: number;
        if (lavi <= 28) laviScore = 100;         // Normal
        else if (lavi <= 34) laviScore = 75;     // Mild
        else if (lavi <= 40) laviScore = 50;     // Moderate
        else if (lavi <= 48) laviScore = 25;     // Moderate-severe
        else laviScore = 0;                       // Severe

        // Direction modifier
        if (baselineLavi && baselineLavi > 0) {
            const pctReduction = (baselineLavi - lavi) / baselineLavi;
            if (pctReduction > 0.05) laviScore += 20;
            else if (pctReduction > 0.01) laviScore += 10;
            else if (pctReduction < -0.05) laviScore -= 20;
            else if (pctReduction < -0.01) laviScore -= 10;
        }
        chamberScores.push(Math.max(0, Math.min(100, laviScore)));
    }

    const chamberScore = chamberScores.length > 0
        ? chamberScores.reduce((a, b) => a + b, 0) / chamberScores.length
        : 50; // Neutral when no echo data available

    // --- Blend: 40% absolute + 40% improvement + 20% chamber ---
    const blended = Math.max(0, Math.min(100, absoluteScore * STRUCTURE_BLEND_WEIGHTS.absolute + improvementScore * STRUCTURE_BLEND_WEIGHTS.improvement + chamberScore * STRUCTURE_BLEND_WEIGHTS.chamber));
    return { absoluteScore, improvementScore, chamberScore, blended };
}

export function calculateStructureScore(
    lvef: number, lvedd: number | undefined, lavi: number | undefined,
    baselineLvef: number, baselineLvedd?: number, baselineLavi?: number
): number {
    return calculateStructureScoreComponents(lvef, lvedd, lavi, baselineLvef, baselineLvedd, baselineLavi).blended;
}

/**
 * Domain 5: Cost (Financial Toxicity)
 * 100 = Free/Under Budget. 
 * Updated Logic: Apply 'sensitivity' (sting) penalty even when under budget.
 * Sensitivity 0 = Spend freely (Score stays 100).
 * Sensitivity 10 = Frugal (Score drops as utilization approaches 100%).
 * Zero-budget mode: only $0 regimens score as fully affordable.
 */
export function calculateCostScore(cost: number, budget: number, sensitivity: number): number {
    const normalizedSensitivity = Math.max(0, Math.min(10, sensitivity)) / 10;

    if (budget <= 0) {
        // Zero-budget mode: only no-cost regimens are financially viable.
        return cost <= 0 ? 100 : Math.max(0, 100 - (cost * (5 + (normalizedSensitivity * 5))));
    }

    const effectiveBudget = budget;

    // Over Budget Logic: sensitivity-aware penalty for smooth transition at boundary
    if (cost > effectiveBudget) {
        const baseOverBudgetScore = (effectiveBudget / cost) * 100;
        const sensitivityPenalty = normalizedSensitivity * 30;
        return Math.max(0, Math.min(100, baseOverBudgetScore - sensitivityPenalty));
    }

    // Under/At Budget Logic:
    // Utilization ratio (0.0 to 1.0)
    const utilization = cost / effectiveBudget;

    // Penalty factor (0.0 to 1.0) based on sensitivity
    const penaltyFactor = normalizedSensitivity;

    // Max penalty at 100% utilization with Max Sensitivity is 25 points.
    // e.g., spending $100 of $100 budget with Sens 10 -> Score 75 (affordable, just felt).
    // spending $100 of $100 budget with Sens 0 -> Score 100 (no concern).
    // spending $50 of $100 budget with Sens 10 -> Score 87.5 (comfortable).
    const score = 100 - (utilization * penaltyFactor * 25);

    return Math.max(0, Math.min(100, score));
}

/**
 * Domain 6: Adherence (Complexity vs Tolerance)
 * 100 = Complexity well below tolerance. 
 * Formula: 100 * (ToleranceThreshold / Complexity)
 */
export function calculateAdherenceScore(complexity: number, toleranceInput: number): number {
    // Convert 0-10 tolerance scale to a complexity threshold (shared with ScoreDetailModal)
    const threshold = adherenceComplexityThreshold(toleranceInput);

    const effectiveComplexity = Math.max(1, complexity);

    if (effectiveComplexity <= threshold) return 100;

    // Decay: If complexity is double the tolerance, score is 50.
    return Math.max(0, Math.min(100, (threshold / effectiveComplexity) * 100));
}

/**
 * Domain 7: Guideline Concordance (2026 ESC heart failure guideline, Recommendation Table 5; 2022 AHA/ACC/HFSA where noted)
 * Scores alignment with evidence-based foundational therapy for the phenotype. Two phenotypes (2026 ESC removed HFmrEF):
 *
 * HFrEF (LVEF < 50, or improved EF, or a prior LVEF < 50): all 4 pillars Class I, 20 pts each (max 80) + 5 pts/pillar at target (max 20) = 100.
 * HFpEF (LVEF >= 50 and never < 50): SGLT2i and MRA Class I (SGLT2i 45 + 10 at target, MRA 30 + 5 at target) + volume management (10) = 100.
 *   A RAAS inhibitor is Class IIb in HFpEF: small credit, never a foundational slot.
 */
// =====================================================================================
// GUIDELINE-CONCORDANCE EVIDENCE TABLE — evidence as data, not magic numbers.
//
// Each phenotype declares, per GDMT pillar: the recommendation class + landmark trials
// (the WHY) and the points that class is worth in this phenotype (calibrated to evidence
// strength: Class I = 20-22, IIa ≈ 22, IIb = 8-13). The scorer below is a single generic
// pass over this table — the three former hardcoded phenotype branches are gone. Adding a
// pillar/phenotype, or restating evidence as trials mature, is now a data edit here.
// =====================================================================================
export type PillarKey = 'RAAS' | 'BB' | 'MRA' | 'SGLT2i';

export type RecClass = 'I' | 'IIa' | 'IIb' | 'III';

export interface PillarConcordance { base: number; targetBonus: number; recClass: RecClass; trials: string; }

export type Phenotype = 'HFrEF' | 'HFpEF';

export interface PhenoConcordance {
    pillars: Partial<Record<PillarKey, PillarConcordance>>;
    targetBonusCap: number;   // cap on summed at-target bonuses
    volumeBonus: number;      // awarded when euvolemic or on a diuretic
}

// EXPORTED so ScoreDetailModal renders the guideline pillar points straight from this table
// (it previously re-hardcoded the 3 phenotype tables as display copy — a recalibration here
// would have silently made the clinician-facing explanation wrong).
export const CONCORDANCE_TABLE: Record<Phenotype, PhenoConcordance> = {
    HFrEF: {
        pillars: {
            RAAS:   { base: 20, targetBonus: 5, recClass: 'I', trials: 'PARADIGM-HF / SOLVD' },
            BB:     { base: 20, targetBonus: 5, recClass: 'I', trials: 'MERIT-HF / COPERNICUS / CIBIS-II' },
            MRA:    { base: 20, targetBonus: 5, recClass: 'I', trials: 'RALES / EMPHASIS-HF' },
            SGLT2i: { base: 20, targetBonus: 5, recClass: 'I', trials: 'DAPA-HF / EMPEROR-Reduced' },
        },
        targetBonusCap: Infinity,
        volumeBonus: 0,
    },
    HFpEF: {
        pillars: {
            SGLT2i: { base: 45, targetBonus: 10, recClass: 'I', trials: 'EMPEROR-Preserved / DELIVER (2026 ESC Table 5)' },
            MRA:    { base: 30, targetBonus: 5, recClass: 'I', trials: 'TOPCAT Americas / FINEARTS-HF (2026 ESC Table 5: steroidal or non-steroidal)' },
            RAAS:   { base: 4, targetBonus: 0, recClass: 'IIb', trials: 'PARAGON-HF / CHARM-Preserved (2026 ESC Table 5: Class IIb C; not a foundational therapy)' },
        },
        targetBonusCap: Infinity,
        volumeBonus: 10,
    },
};

// The pillar a drug class belongs to as a FAMILY (finerenone sits with the MRAs), independent of any patient. Used only for display grouping.
export function pillarFamilyOf(drugClass: string): PillarKey | null {
    if (RAAS_CLASSES.has(drugClass)) return 'RAAS';
    if (drugClass === 'Beta Blocker') return 'BB';
    if (drugClass === 'MRA' || drugClass === 'nsMRA') return 'MRA';
    if (drugClass === 'SGLT2i') return 'SGLT2i';
    return null;
}

export function pillarKeyOf(drugClass: string, patient: Patient): PillarKey | null {
    if (RAAS_CLASSES.has(drugClass)) return 'RAAS';
    if (drugClass === 'Beta Blocker') return 'BB';
    if (mineralocorticoidCountsAsEvidencePillar(drugClass, patient)) return 'MRA';
    if (drugClass === 'SGLT2i') return 'SGLT2i';
    return null;
}

/**
 * Improved-EF HFrEF: LVEF now above 40 with a documented prior LVEF of 40 or lower (or, conservatively, presumed when the history is unknown but
 * the patient arrives on RAAS/BB/MRA). Such a patient stays on full HFrEF therapy (2026 ESC Table 5: continue foundational therapy at the highest
 * tolerated dose after LVEF improves; 2022 AHA/ACC/HFSA HFimpEF). It also blocks nonsteroidal-MRA and GLP-1 starts.
 */
export function isImprovedEF(patient: Patient): boolean {
    return patient.lvef > 40 && (hasHistoricalHFrEF(patient) || shouldPreserveQuadForUnknownHistory(patient));
}

/**
 * 2-tier HF phenotype from LVEF (2026 ESC guideline sections 3.3.1 and 5.2: HFmrEF is removed).
 *   HFrEF: LVEF < 50, OR improved EF (isImprovedEF), OR current LVEF >= 50 with a recorded prior LVEF < 50 (HFpEF requires an LVEF that was never < 50).
 *   HFpEF: LVEF >= 50 and no recorded prior LVEF < 50.
 * Only a numeric `previous_lvef` can show a prior value of 41-49: the categorical ever_lvef_le_40 answer says nothing about it, so a patient with
 * LVEF >= 50 and only "ever <= 40: no" is HFpEF here. Drives pathway selection, concordance tables, completeness slots and ranking-mode applicability.
 * Drug-specific LVEF criteria (digoxin, ivabradine, vericiguat, GLP-1, iron, finerenone) keep their own evidence thresholds.
 */
export function classifyPhenotype(patient: Patient): Phenotype {
    if (patient.lvef < 50) return 'HFrEF';
    if (isImprovedEF(patient) || hasPriorLvefBelow50(patient)) return 'HFrEF';
    return 'HFpEF';
}

// Returns, per pillar present in the regimen, whether it is at target dose.
export function pillarsPresentAtTarget(regimen: RegimenMed[], patient: Patient): Map<PillarKey, boolean> {
    const present = new Map<PillarKey, boolean>();
    regimen.forEach(r => {
        const key = pillarKeyOf(r.med.drug_class, patient);
        if (!key) return;
        const atTarget = isTargetDoseForPatient(r, patient);
        present.set(key, (present.get(key) ?? false) || atTarget);
    });
    return present;
}

// phenotype is accepted as a parameter so the per-candidate scoring loop can pass the value
// computed once per run instead of re-deriving it (classifyPhenotype walks the current regimen)
// for every candidate. Defaults preserve standalone-call behavior.
export function calculateGuidelineConcordanceScore(resultingRegimen: RegimenMed[], patient: Patient, phenotype: Phenotype = classifyPhenotype(patient)): number {
    const table = CONCORDANCE_TABLE[phenotype];
    const present = pillarsPresentAtTarget(resultingRegimen, patient);

    let score = 0;
    let targetBonusSum = 0;
    (Object.entries(table.pillars) as [PillarKey, PillarConcordance][]).forEach(([key, ev]) => {
        if (!present.has(key)) return;
        score += ev.base;
        if (present.get(key)) targetBonusSum += ev.targetBonus;
    });
    score += Math.min(table.targetBonusCap, targetBonusSum);

    const fluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const hasDiuretic = resultingRegimen.some(r => DIURETIC_CLASSES.has(r.med.drug_class));
    if (fluidExcess <= 1.0 || hasDiuretic) score += table.volumeBonus;

    return Math.min(100, score);
}

// Surfaceable evidence for the pillars actually present — the "why" behind the concordance score.
export function describeConcordance(resultingRegimen: RegimenMed[], patient: Patient, phenotype: Phenotype = classifyPhenotype(patient)): string[] {
    const table = CONCORDANCE_TABLE[phenotype];
    const present = pillarsPresentAtTarget(resultingRegimen, patient);
    const labels: Record<PillarKey, string> = { RAAS: 'RAAS inhibitor', BB: 'Beta-blocker', MRA: 'MRA', SGLT2i: 'SGLT2i' };
    const out: string[] = [];
    (Object.keys(table.pillars) as PillarKey[]).forEach(key => {
        if (!present.has(key)) return;
        const ev = table.pillars[key]!;
        out.push(`Guideline: ${labels[key]} — Class ${ev.recClass} (${ev.trials})`);
    });
    return out;
}
