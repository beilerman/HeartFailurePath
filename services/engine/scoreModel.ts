/**
 * Score model as data.
 *
 * Every weight and every adjustment magnitude used by the per-candidate scoring loop in
 * `generateAndScoreModifications` lives here, so the number a clinician sees is a visible,
 * reconciling piece of arithmetic (cf. GlucosePATH printing every factor score + the weights).
 *
 * THE MODEL: a true weighted sum. Twelve domains, each scored 0-100, are weighted by `WEIGHT_PROFILES` (the weights sum to 100%). Six carry weight (mortality, hf_hospitalization,
 * symptoms, side_effects, cost, adherence); the other six carry weight 0: four physiological domains that are permanently unassessed, and guideline concordance and therapy
 * completeness, which are computed and shown for reference only. The two outcome domains (mortality, hf_hospitalization) are percent risk reductions from trial
 * relative risks (outcomeBenefit.ts), so a perfect 100 is no longer attainable: no regimen removes all risk. Therapy completeness (score = fraction of indicated,
 * achievable therapies attained x 100) is a reference-only domain with weight 0. On top of the weighted sum sit only NAMED adjustments -
 * the special-feature line (now only the +15 mandatory-swap bonus before normalisation) and the safety penalties - each a visible line item. There is
 * no hidden bonus layer and no routine clamping: the final [0,100] clamp is a guard that appears in
 * the breakdown only when it actually changes the value. Ranking is the displayed score, then raw_score (unrounded, higher
 * first), then cost (cheaper first), then fewer changes, then regimen key (see byScoreThenCost in selection.ts).
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
    | 'mortality' | 'hf_hospitalization' | 'symptoms' | 'side_effects' | 'neurohormonal' | 'functional' | 'volume' | 'structure' | 'guideline' | 'completeness' | 'cost' | 'adherence';

/** Display and accumulation order (the weighted sum is accumulated left-to-right in this order). */
export const DOMAIN_KEYS: readonly ScoreDomainKey[] = [
    'mortality', 'hf_hospitalization', 'symptoms', 'side_effects', 'neurohormonal', 'functional', 'volume', 'structure', 'guideline', 'completeness', 'cost', 'adherence',
];

export const DOMAIN_LABELS: Record<ScoreDomainKey, string> = {
    mortality: 'Death from any cause (trial average)',
    hf_hospitalization: 'Heart-failure hospitalization (trial average)',
    symptoms: 'Symptoms and quality of life (KCCQ, trial average)',
    side_effects: 'Side effects (measured harm rates)',
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
    { key: 'benefit', label: 'Expected outcome benefit (trial averages)', domains: ['mortality', 'hf_hospitalization', 'symptoms'] },
    { key: 'harm', label: 'Side effects (measured harm rates)', domains: ['side_effects'] },
    { key: 'outcomes', label: 'Individual physiological response (not estimated)', domains: ['neurohormonal', 'functional', 'volume', 'structure'] },
    { key: 'guideline_reference', label: 'Guideline reference (not in ranking)', domains: ['guideline', 'completeness'] },
    { key: 'values', label: 'Patient values', domains: ['cost', 'adherence'] },
];

export type WeightProfileName = 'default' | 'outcomes_first' | 'cost_first' | 'simplicity_first';

/**
 * Patient-selected weight rows (the clinician records what matters most to this patient). A profile changes ONLY the weights. It never touches eligibility, gates,
 * alerts, candidate generation, rescue logic, adjustments/penalties, display floors or the affordability filter. Each row sums to 1.
 * Owner ruling 2026-11-15: every clinical choice comes from a first-principles model (measured drug properties), so guideline points and pillar counts leave the ranking.
 */
/**
 * ENGINE POLICY (pending owner review): the BASE weights of the six scored domains, and the multipliers that derive the other rows. Rows are GENERATED by
 * `deriveProfile` (multiply the base weight of the named domains, then renormalize to sum to 1), never typed. The legacy four physiological-response domains, guideline
 * concordance and therapy completeness carry an explicit weight of 0 (guideline and completeness are shown for reference only).
 *   default          the base row
 *   outcomes_first   cost and adherence x 0.5
 *   cost_first       cost x 3
 *   simplicity_first adherence x 3
 */
export const BASE_WEIGHTS = { mortality: 0.30, hf_hospitalization: 0.22, symptoms: 0.10, side_effects: 0.14, cost: 0.14, adherence: 0.10 } as const;
export const PROFILE_MULTIPLIERS: Record<WeightProfileName, Partial<Record<keyof typeof BASE_WEIGHTS, number>>> = {
    default: {},
    outcomes_first: { cost: 0.5, adherence: 0.5 },
    cost_first: { cost: 3 },
    simplicity_first: { adherence: 3 },
};
const ZERO_WEIGHTS = { neurohormonal: 0, functional: 0, volume: 0, structure: 0, guideline: 0, completeness: 0 } as const;
function deriveProfile(name: WeightProfileName): Record<ScoreDomainKey, number> {
    const raw = Object.fromEntries(Object.entries(BASE_WEIGHTS).map(([k, v]) => [k, v * (PROFILE_MULTIPLIERS[name][k as keyof typeof BASE_WEIGHTS] ?? 1)])) as Record<keyof typeof BASE_WEIGHTS, number>;
    const total = Object.values(raw).reduce((a, b) => a + b, 0);
    const scaled = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total])) as Record<keyof typeof BASE_WEIGHTS, number>;
    return { ...scaled, ...ZERO_WEIGHTS };
}
export const WEIGHT_PROFILES: Record<WeightProfileName, Record<ScoreDomainKey, number>> = {
    default: deriveProfile('default'),
    outcomes_first: deriveProfile('outcomes_first'),
    cost_first: deriveProfile('cost_first'),
    simplicity_first: deriveProfile('simplicity_first'),
};

/** Clinician-facing name and one-line description of each weight profile. */
export const WEIGHT_PROFILE_META: Record<WeightProfileName, { label: string; description: string }> = {
    default: { label: 'Balanced', description: 'Balances death, heart-failure hospitalization, symptoms, side effects, cost and dosing burden.' },
    outcomes_first: { label: 'Prioritize treatment evidence', description: 'Cost and dosing burden count half as much.' },
    cost_first: { label: 'Keep cost low', description: 'Out-of-pocket cost counts three times as much. The budget limit still applies separately.' },
    simplicity_first: { label: 'Keep the regimen simple', description: 'Dosing burden counts three times as much.' },
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

/**
 * ENGINE POLICY (statistical method): precision-weighted evidence. Ranking uses the posterior mean of each evidence row under a prior centred on no effect:
 *     x_used = B x x_published,  B = tau2 / (tau2 + se^2),  se_used = sqrt(B) x se       (x = ln RR for outcomes, KCCQ points for symptoms)
 * so a precisely measured row barely moves and a row from tiny trials is pulled toward no effect. tau2 is COMPUTED from each table (shrinkage.ts, outcomeBenefit.ts,
 * symptomBenefit.ts), never typed, with the DerSimonian-Laird moment estimator centred on no effect (w = 1/se^2, Q = sum(w x^2), C = sum(w) - sum(w^2)/sum(w), tau2 = max(0, (Q - k) / C)) over trial
 * or meta-analysis rows with an interval, an identical figure counted once. WHY WEIGHTED: a row's influence on the prior should follow its precision, so two very imprecise rows cannot set the prior for the rest.
 */
export const SHRINKAGE_FORMULA = 'x_used = B * x_published; B = tau2 / (tau2 + se^2); se_used = sqrt(B) * se; tau2 = DerSimonian-Laird centred on no effect: w = 1/se^2, Q = sum(w x^2), C = sum(w) - sum(w^2)/sum(w), tau2 = max(0, (Q - k) / C), over trial or meta-analysis rows with an interval (duplicates once; no row excluded)';

/**
 * KCCQ points that earn a symptom score of 100 (a large change). POLICY anchor: Spertus 2005 (J Am Coll Cardiol 45:2): 5 points is a small, 10 a moderate and 20 a large clinical change.
 * symptom score = clamp(100 x credit-weighted KCCQ points / 20, 0, 100).
 */
export const KCCQ_FULL_CREDIT_POINTS = 20;

/**
 * ENGINE POLICY: the side-effect score is max(0, 100 - burden / SIDE_EFFECT_BURDEN_DIVISOR). The BURDEN stays exactly as computed (the same scale as the hypertension engine,
 * harmDefinitions.json). A full quadruple regimen is about 77 burden points and regimens with a diuretic and adjuncts exceed 100, so `100 - burden` floored at 0 and stopped
 * discriminating (Furoscix regimens scored 0); halving keeps every plausible regimen above 0.
 */
export const SIDE_EFFECT_BURDEN_DIVISOR = 2;
export const sideEffectScore = (burden: number): number => Math.max(0, 100 - burden / SIDE_EFFECT_BURDEN_DIVISOR);

/** Therapy-completeness credit for a therapy that is on board but below its target dose (full credit = 1). */
export const COMPLETENESS_SUBTARGET_CREDIT = 0.6;

/**
 * Graded credit for a therapy on board below its target dose, when a numeric target can be derived for THIS patient: progress from the labeled STARTING dose to the
 * target dose. credit = COMPLETENESS_SUBTARGET_CREDIT (0.6) at or below the patient's starting tier for that drug (`start_dose_for`, else the lowest tier), rising
 * linearly in total daily dose to 1.0 at target: 0.6 + 0.4 x (dose - start) / (target - start). Full credit (1) at target, maximum, an interaction cap, a single-dose
 * drug, or when start equals target; the flat 0.6 where no numeric target can be derived. Anchoring at the start dose means a NEW start scores exactly as it did before
 * graded credit existed, so the credit never chooses between agents (a spironolactone 12.5 mg start and an eplerenone 25 mg start are both "at start"); only
 * up-titration steps gain. Basis: dose-response evidence that higher doses give lower event rates (2026 ESC section 6.1.6: composite event rates were lower with the
 * target dose than with lower doses); the linear shape is ENGINE POLICY.
 */
export const COMPLETENESS_GRADED_CREDIT_SPAN = 1 - COMPLETENESS_SUBTARGET_CREDIT;


export const SCORE_ADJUSTMENTS = {
    SPECIAL_FEATURES: {
        code: 'SPECIAL_FEATURES',
        label: 'Special-feature bonus (average per drug; divisor at least the number of indicated foundational therapies)',
        factor: 2.3, min: -8, max: 12,
    },
    VOLUME_DEPLETION_DEESCALATION: {
        code: 'VOLUME_DEPLETION_DEESCALATION',
        label: 'Volume depletion: diuretic de-escalation bonus',
        points: 15,
    },
    PROJECTED_SBP_LT_85: {
        code: 'PROJECTED_SBP_LT_85',
        label: 'Recorded SBP < 85: score disqualified (set to 0)',
        threshold: 85,
    },
    PROJECTED_SBP_LT_90: {
        code: 'PROJECTED_SBP_LT_90',
        label: 'Recorded SBP < 90 penalty',
        threshold: 90, points: -20,
    },
    PROJECTED_SBP_LT_95: {
        code: 'PROJECTED_SBP_LT_95',
        label: 'Recorded SBP < 95 penalty',
        threshold: 95, points: -6,
    },
    PROJECTED_HR_LT_50: {
        code: 'PROJECTED_HR_LT_50',
        label: 'Recorded heart rate < 50 penalty',
        threshold: 50, points: -40,
    },
    PROJECTED_K_GT_5_5: {
        code: 'PROJECTED_K_GT_5_5',
        label: 'Recorded potassium > 5.5 penalty',
        threshold: 5.5, points: -40,
    },
    DANGEROUS_WARNINGS: {
        code: 'DANGEROUS_WARNINGS',
        label: 'Safety warnings (per warning)',
        perUnit: -8,
    },
    UNKNOWN_RENAL: {
        code: 'UNKNOWN_RENAL',
        label: 'Unknown renal function with SGLT2i initiation or up-titration',
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
    // Marker text must match the CURRENT wording in effects.ts (reworded in an earlier rule set; the stale markers silently cost -8 each until 2026-11-15):
    // 'Elderly patient' -> 'Older adult:', 'Monitor: K+' -> 'Monitor: measured K+', 'Titration Interval' -> 'Before dose escalation:',
    // 'Multiple new medications' -> 'Multiple new therapies:'. A verify check scans the engine source so every marker here must match emitted text.
    'Older adult:', 'Frail elderly', 'Hepatic Impairment', 'Monitor: measured K+',
    'Before dose escalation:', 'Multiple new therapies:',
    // Purely PROCEDURAL instructions attached unconditionally to specific actions must not
    // dock the action's rank: the ACEi→ARNI washout text fires on EVERY guideline-preferred
    // ARNI upgrade (docking it vs merely up-titrating the ACEi), the taper guidance on every
    // BB removal, and the base Furoscix device instruction on every Furoscix regimen.
    // (FUROSCIX CKD CAUTION / FUROSCIX TRIAGE remain penalized — they flag genuine patient
    // risk states. 'Binder Required' on the reactive rescue path also remains penalized.)
    'MANDATORY: 36-hour washout', 'BETA-BLOCKER DISCONTINUATION', 'FUROSCIX SAFETY:',
    // Drug-data warnings (facts.regimen_warnings: dose-spacing, GI caution, interaction monitoring, Lokelma
    // sodium load in HF). Informational by design: the real risk is already priced by the dose-scaled Lokelma
    // sodium special feature, the projected-K+ gates and the borderline-K+ MRA warning, which stay penalized.
    'Drug note',
    // Intolerance-history cautions (intolerance.ts table) name a past reaction on a same-class drug; informational, never a rank penalty.
    'Intolerance history:',
];

/**
 * State warnings whose fact already carries its own named adjustment above (PROJECTED_SBP_LT_90, PROJECTED_HR_LT_50, PROJECTED_K_GT_5_5). They are shown to the
 * clinician but not counted again in DANGEROUS_WARNINGS: one fact, one charge (adversarial review 2026-11-12: projected SBP below 90 cost -20 and a further -8).
 * `npm run verify` checks that no ledger charges a fact twice.
 */
export const WARNINGS_PRICED_BY_NAMED_ADJUSTMENT: readonly string[] = [
    'Risk of Hypotension (SBP < 90)', 'Risk of Bradycardia (HR < 50)', 'High Hyperkalemia Risk (K+ > 5.5)', 'Severe Hyperkalemia Risk (K+ > 6.0)',
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
    /** Missing input: excluded from weighting and displayed as not assessed, never as a measured zero. */
    assessed?: boolean;
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
