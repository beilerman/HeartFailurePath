/**
 * Score model as data.
 *
 * Every weight and every adjustment magnitude used by the per-candidate scoring loop in
 * `generateAndScoreModifications` lives here, so the number a clinician sees is a visible,
 * reconciling piece of arithmetic (cf. GlucosePATH printing every factor score + the weights).
 *
 * This module has NO imports so both `types.ts` and the engine can depend on it without cycles.
 *
 * RECONCILIATION (the contract `ScoreBreakdown` satisfies, asserted in scripts/verifyScenarios.ts):
 *
 *   weighted_subtotal = Σ domains[i].contribution          (contribution = weight × UNROUNDED score)
 *   raw_score         = weighted_subtotal
 *                       + Σ adjustments[i].points
 *                       + Σ (o.after − o.before) for overrides with applies_to === 'raw_score'
 *
 * `raw_score` is the engine's un-clamped, un-rounded running total — the exact value stored in
 * `ScoredRegimen.raw_score` and used as a ranking tiebreaker. Adjustments are listed in the order
 * the engine applies them. The projected-SBP<85 step is NOT additive ("set to 0"): it is an override
 * on `raw_score` whose before/after capture the running value at that moment. Because the engine
 * keeps applying later adjustments (HR, K+, warnings, unknown-lab) to that zeroed total, those lines
 * still appear in `adjustments` after the override; the sum above remains exact.
 *
 * `overall_score` (the displayed 0-100 integer) is derived from `raw_score` by the final [0,100] clamp
 * and rounding, plus — for low-output patients — the cap at 35. Those two are overrides with
 * applies_to === 'overall_score' and are NOT part of the raw_score sum.
 */

export type ScoreDomainKey =
    | 'neurohormonal' | 'functional' | 'volume' | 'structure' | 'cost' | 'adherence' | 'guideline';

/** Domain order matters: the weighted sum is accumulated left-to-right in this order (float-identical to the original expression). */
export const DOMAIN_KEYS: readonly ScoreDomainKey[] = [
    'neurohormonal', 'functional', 'volume', 'structure', 'cost', 'adherence', 'guideline',
];

export const DOMAIN_LABELS: Record<ScoreDomainKey, string> = {
    neurohormonal: 'Neurohormonal',
    functional: 'Functional',
    volume: 'Volume',
    structure: 'Structure',
    cost: 'Cost',
    adherence: 'Adherence',
    guideline: 'Guideline concordance',
};

export type WeightProfileName = 'default';

/** Add more rows here to support patient-selected profiles later. Only `default` exists today. */
export const WEIGHT_PROFILES: Record<WeightProfileName, Record<ScoreDomainKey, number>> = {
    default: {
        neurohormonal: 0.20,
        functional: 0.15,
        volume: 0.15,
        structure: 0.10,
        cost: 0.15,
        adherence: 0.10,
        guideline: 0.15,
    },
};
export const DEFAULT_WEIGHT_PROFILE: WeightProfileName = 'default';
export const DOMAIN_WEIGHTS = WEIGHT_PROFILES.default;

export interface ScoreAdjustmentSpec {
    code: string;
    label: string;
    /** Fixed additive points (negative = penalty). */
    points?: number;
    /** Upper bound (bonus clamp / max bonus). */
    max?: number;
    /** Lower bound (bonus clamp). */
    min?: number;
    /** Points per counted unit (e.g. per dangerous warning). */
    perUnit?: number;
    /** Scale factor applied before clamping. */
    factor?: number;
    /** Threshold the projected value is compared against. */
    threshold?: number;
}

export const SCORE_ADJUSTMENTS = {
    SPECIAL_FEATURES: {
        code: 'SPECIAL_FEATURES',
        label: 'Special-feature bonus (normalized by regimen size)',
        factor: 3, min: -10, max: 15,
    },
    GDMT_COMPLETENESS: {
        code: 'GDMT_COMPLETENESS',
        label: 'GDMT completeness bonus',
        max: 30,
    },
    VOLUME_DEPLETION_DEESCALATION: {
        code: 'VOLUME_DEPLETION_DEESCALATION',
        label: 'Volume depletion: diuretic de-escalation bonus',
        points: 20,
    },
    PROJECTED_SBP_LT_85: {
        code: 'PROJECTED_SBP_LT_85',
        label: 'Projected SBP < 85: score disqualified (set to 0)',
        threshold: 85,
    },
    PROJECTED_SBP_LT_90: {
        code: 'PROJECTED_SBP_LT_90',
        label: 'Projected SBP < 90 penalty',
        threshold: 90, points: -25,
    },
    PROJECTED_SBP_LT_95: {
        code: 'PROJECTED_SBP_LT_95',
        label: 'Projected SBP < 95 penalty',
        threshold: 95, points: -8,
    },
    PROJECTED_HR_LT_50: {
        code: 'PROJECTED_HR_LT_50',
        label: 'Projected heart rate < 50 penalty',
        threshold: 50, points: -50,
    },
    PROJECTED_K_GT_5_5: {
        code: 'PROJECTED_K_GT_5_5',
        label: 'Projected potassium > 5.5 penalty',
        threshold: 5.5, points: -50,
    },
    DANGEROUS_WARNINGS: {
        code: 'DANGEROUS_WARNINGS',
        label: 'Safety warnings (per warning)',
        perUnit: -10,
    },
    UNKNOWN_POTASSIUM: {
        code: 'UNKNOWN_POTASSIUM',
        label: 'Unknown baseline potassium with RAAS/MRA initiation or up-titration',
        points: -15,
    },
    UNKNOWN_RENAL: {
        code: 'UNKNOWN_RENAL',
        label: 'Unknown renal function with RAAS/MRA/SGLT2i initiation or up-titration',
        points: -15,
    },
    SCORE_CLAMP: {
        code: 'SCORE_CLAMP',
        label: 'Final clamp to the 0-100 display range',
        min: 0, max: 100,
    },
    LOW_OUTPUT_CAP: {
        code: 'LOW_OUTPUT_CAP',
        label: 'Low-output state: displayed score capped',
        max: 35,
    },
} as const satisfies Record<string, ScoreAdjustmentSpec>;

/**
 * Warning substrings that are informational/procedural and must NOT be counted as "dangerous"
 * (−10 each). See the rationale at the point of use in simulationService (binder-required and
 * MRA-initiation-at-borderline-K+ deliberately remain penalized).
 */
export const NON_PENALIZED_WARNING_MARKERS: readonly string[] = [
    'Elderly patient', 'Frail elderly', 'Hepatic Impairment', 'Monitor: K+',
    'Titration Interval', 'Multiple new medications',
    // Purely PROCEDURAL instructions attached unconditionally to specific actions must not
    // dock the action's rank: the ACEi→ARNI washout text fires on EVERY guideline-preferred
    // ARNI upgrade (docking it vs merely up-titrating the ACEi), the taper guidance on every
    // BB removal, and the base Furoscix device instruction on every Furoscix regimen.
    // (FUROSCIX CKD CAUTION / FUROSCIX TRIAGE remain penalized — they flag genuine patient
    // risk states. 'MRA INITIATION AT BORDERLINE K+' also remains penalized: it is the
    // residual-hyperkalemia-risk marker for the DIAMOND proactive-binder path, parallel to
    // 'Binder Required' on the reactive rescue path.)
    'MANDATORY: 36-hour washout', 'BETA-BLOCKER DISCONTINUATION', 'FUROSCIX SAFETY:',
];

export interface ScoreBreakdownDomainLine {
    key: ScoreDomainKey;
    label: string;
    /** UNROUNDED domain score (0-100). */
    score: number;
    weight: number;
    /** weight × score */
    contribution: number;
}

export interface ScoreBreakdownAdjustment {
    code: string;
    label: string;
    /** Signed additive points actually applied to the running total. */
    points: number;
    detail?: string;
}

export interface ScoreBreakdownOverride {
    code: string;
    label: string;
    /** Which number the override acts on. Only 'raw_score' overrides participate in the raw_score reconciliation. */
    applies_to: 'raw_score' | 'overall_score';
    before: number;
    after: number;
    detail?: string;
}

export interface ScoreBreakdown {
    weight_profile: WeightProfileName;
    domains: ScoreBreakdownDomainLine[];
    /** Σ domain contributions */
    weighted_subtotal: number;
    adjustments: ScoreBreakdownAdjustment[];
    /** See the reconciliation contract in this file's header. Equals ScoredRegimen.raw_score. */
    raw_score: number;
    /** Equals ScoredRegimen.overall_score (after clamp, rounding, and any low-output cap). */
    overall_score: number;
    /** True when raw_score fell outside [0,100] and the final clamp changed it. */
    clamped: boolean;
    overrides?: ScoreBreakdownOverride[];
}
