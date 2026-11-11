import type { ScoreBreakdown, WeightProfileName } from './services/engine/scoreModel';
export type InsuranceTier = 'cash' | 'commercial' | 'medicare';

/** One disqualifying condition for a formulary drug: a plain-clinical reason and the predicate that decides it. */
export interface ContraindicationCheck {
    reason: string;
    when: (patient: Patient) => boolean;
}

export interface ExcludedMedication {
    name: string;
    drug_class: string;
    reason: string;
    reason_detail?: string;
    occurred_at?: string;
    /** Eligibility rule that withheld this drug (services/engine/eligibility.ts); set by the engine. */
    rule_id?: string;
    rule_name?: string;
    /** Explanation-only (the `details` name is taken by followUpCalendar): which specific findings tripped the rule (e.g. each E13 contraindication that fired). */
    why?: string[];
}

export interface VolumeStatus {
    dry_weight_kg: number;
    current_weight_kg: number;
    exam_findings: Set<string>; // e.g. 'Edema', 'JVP', 'Orthopnea'
}

export type HistoricalHFrEFStatus = 'yes' | 'no' | 'unknown';
export type RecentHFWorseningStatus = 'yes' | 'no' | 'unknown';

// Closed union matching the form's Race select options (DemographicsSection). Keeping this a
// union (not string) makes a dead comparison literal (e.g. the old 'African American' check)
// a compile error — the A-HeFT race criterion lives in clinicalPredicates.isBlackRace.
export type Race = 'White' | 'Black' | 'Asian' | 'Hispanic' | 'Other';

export interface Patient {
    // Demographics
    age: number;
    sex: 'Male' | 'Female';
    race: Race;
    height_cm: number;
    bmi: number;

    // Hemodynamics & Remote Vitals
    sbp: number;
    dbp: number;
    pulse: number;
    oxygen_saturation?: number; // SpO2 %
    rhythm: 'Sinus' | 'AFib' | 'Paced' | '2nd Degree AV Block' | '3rd Degree AV Block';

    // CHF Domains & Remote Functional
    nt_pro_bnp: number; // pg/mL
    nyha_class: 'I' | 'II' | 'III' | 'IV';
    kccq_score: number; // 0-100
    daily_step_count?: number; // Activity Level
    peak_flow_lpm?: number; // Strength of exhalation

    lvef: number; // %
    lvedd?: number; // mm (Left Ventricular End Diastolic Diameter) - Optional
    lavi?: number; // mL/m2 (Left Atrial Volume Index) - Optional
    volume_status: VolumeStatus;

    // Labs & Comorbidities
    bun: number; // Blood Urea Nitrogen
    creatinine: number;
    egfr: number; // Calculated
    potassium: number;

    ferritin?: number;
    tsat?: number;

    comorbidities: Set<string>;
    // Active non-formulary/concurrent medications relevant to DDI checks.
    external_medications?: Set<string>;
    allergies: Set<string>;
    discontinued_meds: ExcludedMedication[];

    // Reproductive safety
    is_pregnant?: boolean;

    // HFimpEF detection: LVEF that was ≤40% and has since improved
    previous_lvef?: number;
    ever_lvef_le_40?: HistoricalHFrEFStatus;

    // Vericiguat (VICTORIA) requires recent worsening HF event
    recent_hf_worsening_within_6mo?: RecentHFWorseningStatus;

    // Constraints
    current_regimen: RegimenMed[];
    max_affordable_cost: number;
    cost_sensitivity: number; // 0 (Spend freely) to 10 (Every dollar counts)
    insurance_tier: InsuranceTier; // 'cash' | 'commercial' | 'medicare'
    complexity_tolerance: number; // 0-10
    max_new_classes_per_visit: number; // Default 2. Class substitutions/dose changes do not count as new classes.
    /** What matters most to this patient; selects the score weight row only (never safety). Missing/unknown => 'default'. */
    care_priority?: WeightProfileName;
}

export interface TestScenario {
    title: string;
    patient: Patient;
}

export interface MedicationDose {
    strength: number | string;
    unit: string;
    formulation: string;
    frequency_options: string[];
    is_target_dose?: boolean;
}

export interface ChfEffects {
    lvef_improvement_absolute: number; // e.g., +5%
    bnp_reduction_percent: number; // e.g., 0.20 (20% reduction)
    weight_reduction_kg: number; // e.g., 2.0 kg
    kccq_improvement: number; // points
    structure_benefit_points: number; // Bonus for reverse remodeling evidence
    lavi_reduction_percent: number; // e.g., 0.10 (10% reduction in LA volume)
    lvedd_reduction_percent?: number; // e.g., 0.08 = 8% reduction in LV end-diastolic diameter
}

export interface Medication {
    name: string;
    drug_class: string; // e.g., 'ARNI', 'BB', 'MRA', 'SGLT2i', 'Loop' — must have a DRUG_CLASS_REGISTRY row in simulationService
    available_doses: MedicationDose[];

    // Pharmacodynamics
    chf_effects: (dose: number | string) => ChfEffects;
    hemodynamic_effects: (dose: number | string) => { sbp_drop: number; hr_drop: number; potassium_change: number };

    side_effects: (dose: number | string) => { [key: string]: number }; // Risk probability 0-1
    renal_adjustment?: (egfr: number, patient?: Patient) => { start_dose_modifier?: number; max_dose?: number; caution?: boolean, contraindicated?: boolean };
    /** The function the engine calls. Derived from `contraindication_checks` via `ci()` (services/engine/contraindications.ts). */
    contraindications?: (patient: Patient) => boolean;
    /** Human-readable "not offered when" checks; `contraindications` is exactly `checks.some(c => c.when(p))`. */
    contraindication_checks?: ContraindicationCheck[];
    /** `points_for_dose`, when present, replaces `points` for the dose actually in the regimen (dose-related effects, e.g. Lokelma edema). */
    special_features?: { feature: string; points: number; criteria: (p: Patient, regimen?: RegimenMed[]) => boolean; points_for_dose?: (dose: number | string) => number }[];
    is_best_in_class?: boolean;

    /**
     * Drug facts the engine asks the entry about instead of comparing drug names. Plain data.
     * Read with `drugFacts(med)` (services/engine/drugFacts.ts).
     */
    facts?: MedFacts;
    /** Patient-dependent GDMT target-dose check (when the static `is_target_dose` flag is not enough). */
    is_target_dose_for?: (strength: number, patient: Patient) => boolean;
    /**
     * Opt-in per drug: the HIGHEST strength a NEW START (add or swap-in) may begin at for this patient. Candidate
     * generation offers only tiers at or below it for a new start (a lower start is allowed); titration of a drug
     * already on board is unaffected. Falls back to the lowest allowed tier if nothing qualifies.
     */
    start_dose_for?: (patient: Patient) => number | string;
    /**
     * Patient-dependent MAXIMUM dose from a drug interaction (e.g. eplerenone with a moderate CYP3A
     * inhibitor). Caps the dose tiers like `renal_adjustment.max_dose`, and a current dose above the cap
     * is reduced to the highest allowed tier.
     */
    interaction_dose_cap?: (patient: Patient) => { max_dose: number; reason: string } | null;
}

export interface MedFacts {
    /** Non-selective beta-blocker (beta-2 blockade) — withheld after prior bronchospasm/asthma intolerance. */
    nonselective_beta_blocker?: boolean;
    /** Beta-1-selective beta-blocker — the acceptable option in mild/moderate asthma. */
    beta1_selective?: boolean;
    /** Among beta-1-selective agents, the one named as the most cardioselective alternative in asthma guidance. */
    most_cardioselective?: boolean;
    /** Extensively hepatically metabolized (beta-blockers): increased exposure in cirrhosis. */
    hepatically_metabolized?: boolean;
    /** CYP3A4 substrate with reduced clearance in cirrhosis (Finerenone). */
    cirrhosis_cyp3a4_caution?: boolean;
    /** Dominant antiandrogenic burden: avoided after ANY MRA caused gynecomastia (Spironolactone). */
    antiandrogenic?: boolean;
    /** Delivered by a single-use on-body subcutaneous infusor (Furoscix): device, CKD and SpO2 safety warnings apply. */
    delivery?: 'on_body_infusor';
    /** Moved to the front of the candidate list when congestion is worsening (loop diuretic swaps / new adds). */
    preferred_for_congestion?: boolean;
    /** Dose (in the entry's dose unit) at or above which a euvolemic patient is flagged for loop over-treatment. */
    high_dose_threshold?: number;
    /** Role when the engine must append a rescue agent (K+ binder): `preferred` is tried first, else the first available. */
    rescue_role?: { kind: 'k_binder'; preferred?: boolean; /** Highest dose the engine may add automatically as a rescue (higher tiers stay prescribable). */ max_rescue_dose?: number };
    /** Two regimens differing in presence of this key are always "distinct" in top-pick selection. */
    pick_distinctness_key?: string;
    /**
     * Potassium rule for an MRA the patient is ALREADY on (initiation gates are separate contraindication
     * checks). K+ at or above `reduce_at` and below `withhold_at`: forced ONE-STEP dose reduction (withhold
     * if already at the lowest tier). K+ at or above `withhold_at`: withhold (remove). `basis` states the rule.
     */
    k_continuation?: { reduce_at: number; withhold_at: number; basis: string };
    /** Plain-language warnings shown whenever this drug is in a recommended regimen (optionally only when `when(patient)`); informational, not score-penalized (text starts 'Drug note:'). */
    regimen_warnings?: { text: string; when?: (p: Patient) => boolean }[];
    /** Monitoring-plan items added whenever this drug is in a recommended regimen. */
    monitoring_items?: (MonitoringPlanItem & { when?: (p: Patient) => boolean })[];
}

export interface RegimenMed {
    med: Medication;
    dose: MedicationDose;
    selected_frequency: string;
}

export interface DomainScores {
    neurohormonal: number;
    functional: number;
    volume: number;
    structure: number;
    guideline: number;
    completeness: number;
    cost: number;
    adherence: number;
}

export interface MonitoringPlanItem {
    test: string;
    timing: string;
    details: string;
}

// Direction-only projection shown to clinicians INSTEAD of false-precision biomarker
// values. The underlying engine still computes numeric estimates (population-average
// effect sizes through uncalibrated curves), but those are not individually predictive,
// so the clinician-facing output is qualitative.
export type ProjectionDirection = 'improve' | 'worsen' | 'stable' | 'caution';

export interface QualitativeProjection {
    label: string;                 // e.g. "Reverse remodeling", "Congestion", "Blood pressure", "Potassium"
    direction: ProjectionDirection;
    detail: string;                // qualitative phrasing — no decimal biomarker values
}

export type TradeOffTone = 'good' | 'neutral' | 'bad';

export interface TradeOffLabel {
    dimension: string;             // "Cost", "Pill burden", "Evidence"
    label: string;                 // "Low cost", "High complexity", "Class I (strong)"
    tone: TradeOffTone;
}

export interface ScoredRegimen {
    regimen: RegimenMed[];

    // Projected Clinical State
    projected_patient: Patient;
    baseline_lvef?: number; // Pre-treatment LVEF for reverse remodeling calculations
    baseline_lvedd?: number; // Pre-treatment LVEDD for structural scoring explanation
    baseline_lavi?: number; // Pre-treatment LAVI for structural scoring explanation
    baseline_dry_weight_kg?: number; // Pre-treatment dry weight for weight-based target-dose checks

    // Scores
    overall_score: number;
    domain_scores: DomainScores;
    special_feature_bonus?: number; // Bonus from guideline-specific special features
    gdmt_completeness?: number; // Fraction (0-1) of indicated, achievable GDMT therapies present — display tiebreaker
    score_breakdown?: ScoreBreakdown; // Reconciling arithmetic behind overall_score/raw_score (see services/engine/scoreModel.ts)
    raw_score?: number; // Uncapped pre-clamp score — preserves differentiation lost to the 100 cap (display tiebreaker)

    cost: number;
    complexity: number;

    rationale: string[];
    risks: string[];

    warnings: string[];
    monitoring_plan?: MonitoringPlanItem[];

    // Clinician-facing qualitative outputs (preferred over raw projected_patient values)
    qualitative_projections?: QualitativeProjection[];
    trade_offs?: TradeOffLabel[];

    modification_set?: ModificationSet;
}

export interface SimulationOutput {
    scoredRegimens: ScoredRegimen[];
    excludedMedications: ExcludedMedication[];
    clinicalAlerts: string[];
    monitoringPlan: MonitoringPlanItem[];

    // Categorical, deterministic outputs that the tool can defend (vs. composite ranking)
    gdmtGaps?: string[];              // indicated-but-missing pillars/adjuncts for this phenotype
    eligibleAdjuncts?: string[];     // criteria-met add-ons (H/ISDN, ivabradine, vericiguat, iron…) even if not in top picks
    missingDataNotices?: string[];   // inputs not entered → dependent inference withheld
    followUpCalendar?: MonitoringPlanItem[]; // STRONG-HF high-intensity follow-up schedule
}

// --- Delta-from-Current Modification Types ---

export type ModificationAction = 'add' | 'titrate_up' | 'titrate_down' | 'swap' | 'remove' | 'keep';

export interface RegimenModification {
    action: ModificationAction;
    target?: RegimenMed;   // New med+dose (for add, titrate, swap)
    source?: RegimenMed;   // Existing med+dose being changed (for titrate, swap, remove, keep)
    summary: string;       // "Add Dapagliflozin 10mg", "Titrate Carvedilol 12.5→25mg BID"
}

export interface ModificationSet {
    modifications: RegimenModification[];
    resulting_regimen: RegimenMed[];  // Full regimen after all modifications applied
}

// ExcludedMedication moved to top for broader reuse
