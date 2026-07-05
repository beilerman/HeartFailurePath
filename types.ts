export type InsuranceTier = 'cash' | 'commercial' | 'medicare';

export interface ExcludedMedication {
    name: string;
    drug_class: string;
    reason: string;
    reason_detail?: string;
    occurred_at?: string;
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
    contraindications?: (patient: Patient) => boolean;
    special_features?: { feature: string; points: number; criteria: (p: Patient) => boolean }[];
    is_best_in_class?: boolean;
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
    cost: number;
    adherence: number;
    guideline: number;
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
