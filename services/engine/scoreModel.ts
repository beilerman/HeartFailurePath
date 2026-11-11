/**
 * Score model as data.
 *
 * Every weight and every adjustment magnitude used by the per-candidate scoring loop in
 * `generateAndScoreModifications` lives here, so the number a clinician sees is a visible,
 * reconciling piece of arithmetic (cf. GlucosePATH printing every factor score + the weights).
 *
 * THE MODEL: a true weighted sum. Eight domains, each scored 0-100, are weighted by
 * `WEIGHT_PROFILES` (the weights sum to 100%), so a regimen that is perfect on every domain scores
 * exactly 100. GDMT completeness is one of the eight domains (score = fraction of indicated,
 * achievable therapies attained x 100). On top of the weighted sum sit only NAMED adjustments -
 * the special-feature evidence bonus and the safety penalties - each a visible line item. There is
 * no hidden bonus layer and no routine clamping: the final [0,100] clamp is a guard that appears in
 * the breakdown only when it actually changes the value. Ranking is raw_score (unrounded, higher
 * first), then cost (cheaper first).
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
 * `raw_score` is the engine's un-clamped, un-rounded running total - the exact value stored in
 * `ScoredRegimen.raw_score` and the ranking key. Adjustments are listed in the order the engine
 * applies them. The projected-SBP<85 step is NOT additive ("set to 0"): it is an override on
 * `raw_score` whose before/after capture the running value at that moment. Because the engine keeps
 * applying later adjustments (HR, K+, warnings, unknown-lab) to that zeroed total, those lines still
 * appear in `adjustments` after the override; the sum above remains exact.
 *
 * `overall_score` (the displayed 0-100 integer) is derived from `raw_score` by the guard clamp and
 * rounding, plus - for low-output patients - the cap. Those are overrides with
 * applies_to === 'overall_score' and are NOT part of the raw_score sum.
 */

export type ScoreDomainKey =
    | 'neurohormonal' | 'functional' | 'volume' | 'structure' | 'guideline' | 'completeness' | 'cost' | 'adherence';

/** Display and accumulation order (the weighted sum is accumulated left-to-right in this order). */
export const DOMAIN_KEYS: readonly ScoreDomainKey[] = [
    'neurohormonal', 'functional', 'volume', 'structure', 'guideline', 'completeness', 'cost', 'adherence',
];

export const DOMAIN_LABELS: Record<ScoreDomainKey, string> = {
    neurohormonal: 'Neurohormonal',
    functional: 'Functional',
    volume: 'Volume',
    structure: 'Structure',
    guideline: 'Guideline concordance',
    completeness: 'Therapy completeness',
    cost: 'Cost',
    adherence: 'Adherence',
};

/** Domains grouped for display, in reading order. */
export const DOMAIN_GROUPS: readonly { key: string; label: string; domains: readonly ScoreDomainKey[] }[] = [
    { key: 'outcomes', label: 'Clinical outcomes', domains: ['neurohormonal', 'functional', 'volume', 'structure'] },
    { key: 'therapy', label: 'Guideline-directed therapy', domains: ['guideline', 'completeness'] },
    { key: 'values', label: 'Patient values', domains: ['cost', 'adherence'] },
];

export type WeightProfileName = 'default' | 'outcomes_first' | 'cost_first' | 'simplicity_first';

/**
 * Patient-selected weight rows (the clinician records what matters most to this patient). A profile
 * changes ONLY these eight weights. It never touches eligibility, gates, alerts, candidate
 * generation, rescue logic, adjustments/penalties, display floors or the affordability filter.
 * Each row must sum to 1.
 */
export const WEIGHT_PROFILES: Record<WeightProfileName, Record<ScoreDomainKey, number>> = {
    default: {
        neurohormonal: 0.15,
        functional: 0.12,
        volume: 0.12,
        structure: 0.08,
        guideline: 0.12,
        completeness: 0.22,
        cost: 0.12,
        adherence: 0.07,
    },
    outcomes_first: {
        neurohormonal: 0.17,
        functional: 0.13,
        volume: 0.13,
        structure: 0.09,
        guideline: 0.13,
        completeness: 0.25,
        cost: 0.06,
        adherence: 0.04,
    },
    cost_first: {
        neurohormonal: 0.13,
        functional: 0.10,
        volume: 0.10,
        structure: 0.07,
        guideline: 0.11,
        completeness: 0.20,
        cost: 0.24,
        adherence: 0.05,
    },
    simplicity_first: {
        neurohormonal: 0.13,
        functional: 0.10,
        volume: 0.10,
        structure: 0.07,
        guideline: 0.11,
        completeness: 0.20,
        cost: 0.10,
        adherence: 0.19,
    },
};

/** Clinician-facing name and one-line description of each weight profile. */
export const WEIGHT_PROFILE_META: Record<WeightProfileName, { label: string; description: string }> = {
    default: { label: 'Balanced', description: 'Standard weighting of outcomes, guideline therapy, cost and regimen burden.' },
    outcomes_first: { label: 'Maximize outcomes', description: 'Cost and regimen burden count for less; disease-modifying therapy counts for more.' },
    cost_first: { label: 'Keep cost low', description: 'Out-of-pocket cost counts double. The budget limit still applies separately.' },
    simplicity_first: { label: 'Keep the regimen simple', description: 'Pill burden and dosing complexity count for more.' },
};

/** Profiles in display order (first is the default). */
export const WEIGHT_PROFILE_NAMES: readonly WeightProfileName[] = ['default', 'outcomes_first', 'cost_first', 'simplicity_first'];

export const DEFAULT_WEIGHT_PROFILE: WeightProfileName = 'default';

/** Resolve a patient's care priority to a profile name; missing or unknown values fall back to 'default'. */
export function resolveWeightProfile(patient: { care_priority?: string }): WeightProfileName {
    const v = patient.care_priority;
    return v !== undefined && Object.prototype.hasOwnProperty.call(WEIGHT_PROFILES, v)
        ? (v as WeightProfileName)
        : DEFAULT_WEIGHT_PROFILE;
}
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

/** Therapy-completeness credit for a therapy that is on board but below its target dose (full credit = 1). */
export const COMPLETENESS_SUBTARGET_CREDIT = 0.6;

/** Special-feature points for a drug that raises uric acid (facts.raises_uric_acid) in a patient with gout. Engine policy, unchanged from the loop-diuretic value (-5). */
export const URIC_ACID_GOUT_POINTS = -5;

export const SCORE_ADJUSTMENTS = {
    SPECIAL_FEATURES: {
        code: 'SPECIAL_FEATURES',
        label: 'Special-feature bonus (normalized by regimen size)',
        factor: 2.3, min: -8, max: 12,
    },
    VOLUME_DEPLETION_DEESCALATION: {
        code: 'VOLUME_DEPLETION_DEESCALATION',
        label: 'Volume depletion: diuretic de-escalation bonus',
        points: 15,
    },
    PROJECTED_SBP_LT_85: {
        code: 'PROJECTED_SBP_LT_85',
        label: 'Projected SBP < 85: score disqualified (set to 0)',
        threshold: 85,
    },
    PROJECTED_SBP_LT_90: {
        code: 'PROJECTED_SBP_LT_90',
        label: 'Projected SBP < 90 penalty',
        threshold: 90, points: -20,
    },
    PROJECTED_SBP_LT_95: {
        code: 'PROJECTED_SBP_LT_95',
        label: 'Projected SBP < 95 penalty',
        threshold: 95, points: -6,
    },
    PROJECTED_HR_LT_50: {
        code: 'PROJECTED_HR_LT_50',
        label: 'Projected heart rate < 50 penalty',
        threshold: 50, points: -40,
    },
    PROJECTED_K_GT_5_5: {
        code: 'PROJECTED_K_GT_5_5',
        label: 'Projected potassium > 5.5 penalty',
        threshold: 5.5, points: -40,
    },
    DANGEROUS_WARNINGS: {
        code: 'DANGEROUS_WARNINGS',
        label: 'Safety warnings (per warning)',
        perUnit: -8,
    },
    UNKNOWN_POTASSIUM: {
        code: 'UNKNOWN_POTASSIUM',
        label: 'Unknown baseline potassium with RAAS/MRA initiation or up-titration',
        points: -12,
    },
    UNKNOWN_RENAL: {
        code: 'UNKNOWN_RENAL',
        label: 'Unknown renal function with RAAS/MRA/SGLT2i initiation or up-titration',
        points: -12,
    },
    SCORE_CLAMP: {
        code: 'SCORE_CLAMP',
        label: 'Guard clamp to the 0-100 display range',
        min: 0, max: 100,
    },
    LOW_OUTPUT_CAP: {
        code: 'LOW_OUTPUT_CAP',
        label: 'Low-output state: displayed score capped',
        max: 25,
    },
} as const satisfies Record<string, ScoreAdjustmentSpec>;

/**
 * Warning substrings that are informational/procedural and must NOT be counted as "dangerous"
 * (penalized per warning). See the rationale at the point of use in simulationService (binder-required and
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
    // Drug-data warnings (facts.regimen_warnings: dose-spacing, GI caution, interaction monitoring, Lokelma
    // sodium load in HF). Informational by design: the real risk is already priced by the dose-scaled Lokelma
    // sodium special feature, the projected-K+ gates and the borderline-K+ MRA warning, which stay penalized.
    'Drug note',
];

export interface ScoreBreakdownDomainLine {
    key: ScoreDomainKey;
    label: string;
    /** UNROUNDED domain score (0-100). */
    score: number;
    weight: number;
    /** weight × score */
    contribution: number;
    /** Optional note on how the score was derived (e.g. the completeness domain with no achievable slots). */
    detail?: string;
}

export interface ScoreBreakdownAdjustment {
    code: string;
    label: string;
    /** Signed additive points actually applied to the running total. */
    points: number;
    detail?: string;
    /** SPECIAL_FEATURES only: each feature that fired, with its pre-normalization points. */
    items?: { med: string; feature: string; points: number }[];
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
