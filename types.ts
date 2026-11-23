import type { ScoreBreakdown, WeightProfileName } from './services/engine/scoreModel';
export type InsuranceTier = 'cash' | 'commercial' | 'medicare';

/** One disqualifying condition for a formulary drug: a plain-clinical reason and the predicate that decides it. */
export interface ContraindicationCheck {
    reason: string;
    when: (patient: Patient) => boolean;
    /** True for a trial-entry criterion that applies only when a class is first started (body mass index for a GLP-1 drug, NT-proBNP for vericiguat). A switch inside a class does not re-apply it (S9). */
    indication?: boolean;
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

export const PATIENT_RHYTHMS = ['Sinus', 'AFib', 'Paced', '2nd Degree AV Block', '3rd Degree AV Block'] as const;

export interface Patient {
    /** Proposed regimen snapshots cannot be reused as newly observed follow-up data. */
    assessment_basis?: 'observed' | 'proposed_regimen';
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
    rhythm: typeof PATIENT_RHYTHMS[number];

    // CHF Domains & Remote Functional
    nt_pro_bnp: number; // pg/mL
    nyha_class: 'I' | 'II' | 'III' | 'IV';
    kccq_score?: number; // 0-100; undefined means not measured, never imputed
    kccq_instrument?: 'CSS' | 'TSS' | 'OSS' | 'unknown';
    daily_step_count?: number; // Activity Level
    peak_flow_lpm?: number; // Strength of exhalation

    lvef: number; // %
    lvedd?: number; // mm (Left Ventricular End Diastolic Diameter) - Optional
    lavi?: number; // mL/m2 (Left Atrial Volume Index) - Optional
    volume_status: VolumeStatus;

    // Labs & Comorbidities
    bun: number; // Blood Urea Nitrogen
    creatinine: number;
    /** Optional prior serum creatinine (mg/dL), before the last RAAS inhibitor/MRA start or dose change. Blank/0 = unknown. Enables the ESC change-from-baseline kidney rules (renalChange.ts). */
    baseline_creatinine?: number;
    egfr: number; // Calculated
    potassium: number;

    ferritin?: number;
    tsat?: number;
    /** Hemoglobin g/dL (optional): sets the ferric carboxymaltose label dose and holds it at >= 15 (no label data). */
    hemoglobin?: number;
    iron_course_review?: 'first_course' | 'repeat_reviewed' | 'unknown';
    phosphate_review?: 'not_indicated' | 'acceptable' | 'low' | 'unknown';

    comorbidities: Set<string>;
    /** Scope question (policy, services/engine/scopeGate.ts): undefined = not answered; an empty set = "None of these"; otherwise the ticked conditions. */
    scope_conditions?: Set<string>;
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
    /** Engine-owned canonical record, including held/completed entries; never trusted from a caller. */
    recorded_medication_exposures?: RegimenMed[];
    max_affordable_cost: number;
    cost_sensitivity: number; // 0 (Spend freely) to 10 (Every dollar counts)
    insurance_tier: InsuranceTier; // 'cash' | 'commercial' | 'medicare'
    complexity_tolerance: number; // 0-10
    max_new_classes_per_visit: number; // Default 2. A new drug class counts, and so does a switch from an ACE inhibitor or ARB to sacubitril/valsartan; dose changes and other switches do not.
    /** What matters most to this patient; selects the score weight row only (never safety). Missing/unknown => 'default'. */
    care_priority?: WeightProfileName;
    /** Retired 2026-11-20 (owner ruling: the "Prioritize foundational therapy" ranking toggle was removed). A patient object that still carries it is accepted and ranked the one way; nothing reads it. */
    ranking_mode?: string;
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
    /**
     * Optional, GLP-1 class: PLACEBO-ADJUSTED weight change as a percent of the patient's current body weight. When set, the engine
     * (effects.ts `patientChfEffects`) converts it to kg for THIS patient and ignores `weight_reduction_kg` (which is then only a
     * display figure at a 100 kg reference weight).
     */
    weight_reduction_percent?: number;
    kccq_improvement: number; // points
    structure_benefit_points: number; // Bonus for reverse remodeling evidence
    lavi_reduction_percent: number; // e.g., 0.10 (10% reduction in LA volume)
    lvedd_reduction_percent?: number; // e.g., 0.08 = 8% reduction in LV end-diastolic diameter
}

export interface Medication {
    name: string;
    drug_class: string; // e.g., 'ARNI', 'BB', 'MRA', 'SGLT2i', 'Loop' — must have a DRUG_CLASS_REGISTRY row in simulationService
    available_doses: MedicationDose[];

    // Historical coefficient archive: never use for clinical evaluation or presentation.
    /** @deprecated Audit-only, not a patient-response model. */
    chf_effects: (dose: number | string) => ChfEffects;
    /** @deprecated Audit-only; safety checks use recorded findings and explicit restrictions. */
    hemodynamic_effects: (dose: number | string) => { sbp_drop: number; hr_drop: number; potassium_change: number };

    /**
     * DISPLAY ONLY: the adverse effects listed on the formulary card, with an approximate rate at the usual dose (label or trial figure where the entry cites one).
     * Most entries ignore `dose`; these numbers must never feed scoring or selection. Safety uses recorded findings, explicit contraindications, interactions and medication-specific monitoring. `npm run verify` fails if engine code reads this field.
     */
    side_effects: (dose: number | string) => { [key: string]: number };
    renal_adjustment?: (egfr: number, patient?: Patient) => { start_dose_modifier?: number; max_dose?: number; caution?: boolean, contraindicated?: boolean; /** The eGFR limit in words, used when the drug is removed for kidney function ("below 30"). */ limit_text?: string; /** The cause of `max_dose` when it is NOT kidney function (carvedilol: body weight), in plain words with the patient's value. A cap without this is a kidney cap. */ max_dose_reason?: string };
    /** The function the engine calls. Derived from `contraindication_checks` via `ci()` (services/engine/contraindications.ts). */
    contraindications?: (patient: Patient) => boolean;
    /** Human-readable "not offered when" checks; `contraindications` is exactly `checks.some(c => c.when(p))`. */
    contraindication_checks?: ContraindicationCheck[];
    /** `points_for_dose`, when present, replaces `points` for the dose actually in the regimen (dose-related effects, e.g. Lokelma edema). */
    special_features?: { feature: string; points: number; criteria: (p: Patient, regimen?: RegimenMed[]) => boolean; points_for_dose?: (dose: number | string) => number;
        /**
         * Every special feature now adds 0 bonus points (owner ruling 2026-11-16: no hand-set points); the text stays in the rationale. Says where its benefit or harm is (or is not) modelled:
         * 'outcome' (data/outcomeEvidence.json), 'symptom' (symptomEvidence.json), 'harm' (harmEvidence.json), 'adherence' (the dosing-burden domain), 'not_modelled' (noted, not scored).
         * `points` is kept only as documentation of the retired figure.
         */
        replaced_by: 'outcome' | 'symptom' | 'harm' | 'adherence' | 'not_modelled' }[];
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
    /**
     * TOTAL DAILY dose (strength x doses per day, in the entry's dose unit) at or above which a euvolemic patient is flagged for loop
     * over-treatment. Engine policy (no source gives a "high-dose" level); the label ceiling is `max_daily_dose`.
     */
    high_dose_threshold?: number;
    /** Label MAXIMUM total daily dose (entry's dose unit). Candidate generation never offers a strength x frequency above it; verify checks every regimen. */
    max_daily_dose?: number;
    /** `chf_effects` / `hemodynamic_effects` are evaluated at the TOTAL DAILY dose (strength x doses per day), not the per-dose strength (loop diuretics). */
    effects_on_daily_dose?: boolean;
    /**
     * Short-course add-on to an oral agent of the same class group (Furoscix: label "not for chronic use"): never offered as a swap or a standing
     * replacement, needs an oral loop on board, is not counted as a duplicate loop, and its effect is credited only ABOVE the oral loop already
     * on board (log ceiling), not on top of it.
     */
    short_course_addon?: boolean;
    /** Factor converting this route's mg to ORAL furosemide-equivalent mg (Furoscix 2.0: SC/IV furosemide is about twice an oral dose). */
    oral_equivalent_multiplier?: number;
    /** ESC 2026 Table 11 per-dose TARGET strength of a beta-blocker (carvedilol 25 mg, metoprolol succinate 200 mg, bisoprolol 10 mg): used only to land a forced switch at the same fraction of target. */
    target_reference_dose?: number;
    /** Chronic-use review prompt: shown (as an alert, never forcing removal) when a patient on this drug is stable and euvolemic (thiazide-type diuretics, 2026 ESC section 7.5.4). */
    chronic_use_review?: string;
    /** Raises serum uric acid / may precipitate gout (label): a patient with Gout carries the uric-acid caution while this drug is in the regimen. */
    raises_uric_acid?: boolean;
    /** Drug note shown on an option that STARTS this drug in a patient with an atrial fibrillation history who is in sinus rhythm today (paroxysmal AF); informational, not penalized. */
    af_signal_note?: string;
    /** Warn (penalized caution) when this drug is ADDED and the known baseline K+ is below this value. Engine policy, not a label contraindication; `basis` states it. */
    hypokalemia_caution_below_k?: { k: number; basis: string };
    /** Role when the engine must append a rescue agent (K+ binder): `preferred` is tried first, else the first available. */
    rescue_role?: { kind: 'k_binder'; preferred?: boolean; /** Highest dose the engine may add automatically as a rescue (higher tiers stay prescribable). */ max_rescue_dose?: number };
    /** Two regimens differing in presence of this key are always "distinct" in top-pick selection. */
    pick_distinctness_key?: string;
    /**
     * Potassium rule for an MRA the patient is ALREADY on (initiation gates are separate contraindication
     * checks). K+ at or above `reduce_at` and below `withhold_at`: forced ONE-STEP dose reduction (withhold
     * if already at the lowest tier). K+ at or above `withhold_at`: withhold (remove). `basis` states the rule.
     */
    k_continuation?: {
        reduce_at: number; withhold_at: number; basis: string;
        /** Potassium below which a reduced dose may be raised again (default 5.0, the MRA labels). */
        restart_below?: number;
        /** In the REDUCE band only: take no forced action while an MRA on board is itself being reduced or withheld by its potassium rule (the MRA goes first). */
        yields_to?: 'mra';
        /** Steps to take before or alongside the dose change, shown in the potassium alert (2026 ESC Supplementary Tables S4/S5). */
        first_steps?: string;
    };
    /**
     * Potassium rule for INCREASING the dose of an MRA the patient is already on: the dose is not raised while known K+ is at or
     * above `below` (finerenone and eplerenone labels: increase only when K+ is below 5.0). `basis` states whether the number is
     * the drug's own label or engine policy (class rule applied by analogy).
     */
    /** `below`: held AT or above this value. `above`: held strictly above this value (the RAAS start-caution threshold, so an increase is never allowed at a potassium where a new start is held). */
    k_uptitration_max?: { below?: number; above?: number; basis: string };
    /**
     * GDMT target as a TOTAL DAILY dose (entry's dose unit), declared by an entry whose doses can be given at more than one
     * frequency (ramipril 5 mg twice daily = 10 mg/day). When set, `isTargetDoseForPatient` compares strength x doses per day with it
     * (at or above) instead of reading the per-strength `is_target_dose` flag.
     */
    target_daily_dose?: number;
    /**
     * The entry's `renal_adjustment.max_dose` is a maximum TOTAL DAILY dose (ramipril label: 5 mg/day at CrCl < 40), so it is compared with
     * strength x doses per day. Without it the cap is a per-dose strength (the other entries' caps).
     */
    renal_cap_is_daily?: boolean;
    /** Conservative prerequisite when no validated numeric renal maximum exists. */
    renal_change_review_below?: number;
    /**
     * VERIFIED oral furosemide-equivalent mg per mg of this loop (furosemide 1; bumetanide 40, label; torsemide 2, TRANSFORM-HF protocol). A swap
     * between two loops lands on the nearest tier at or above the equivalent TOTAL DAILY dose; it also converts an oral loop for crediting a
     * short-course add-on. Every non-add-on loop must declare it (a verify invariant): there is no unconverted-swap fallback.
     */
    verified_furosemide_equivalent_per_mg?: number;
    /**
     * Heart-rate rule for an agent the patient is ALREADY on (beta-blockers, ivabradine); initiation gates are separate
     * contraindication checks. Resting pulse below `reduce_below`: forced ONE-STEP dose reduction (withhold if already at the
     * lowest dose), never removal at a higher dose. Pulse below `no_uptitration_below`: no up-titration offered. Does not apply
     * in a paced rhythm or when the pulse is blank. `basis` states the source and which numbers are engine policy.
     */
    hr_continuation?: { reduce_below: number; no_uptitration_below: number; basis: string };
    /** The drug's heart-rate lowering is only credited in this rhythm (digoxin: AFib; the label's rate-control data are in atrial fibrillation). */
    hr_effect_only_in_rhythm?: Patient['rhythm'];
    /**
     * ACEi/ARB only: the TOTAL DAILY dose (mg) at or below which the Entresto label treats the agent as a "low dose"
     * when converting to sacubitril/valsartan (start 24/26 mg bid instead of 49/51 mg bid). Read by the ARNI's
     * `start_dose_for` through `services/engine/raasStart.ts`.
     */
    low_dose_max_daily_mg?: number;
    /**
     * `start_dose_for` names the EXACT new-start tier, not a ceiling (the label prescribes one start dose, e.g. the ARNI:
     * 24/26 or 49/51 mg, never the other). Default false: lower tiers are also allowed ("start low, go slow").
     */
    start_dose_exact?: boolean;
    /** How a combination strength such as "24/26" becomes ONE daily mg figure: 'sum' adds the components (sacubitril + valsartan), 'first' uses the first component (the hydralazine in hydralazine/isosorbide dinitrate). Read by numericDailyDose (regimenUtils.ts). */
    combination_daily_dose?: 'sum' | 'first';
    /**
     * Weekly GLP-1 / GLP-1-GIP agents: titration moves exactly ONE labeled tier at a time (the dose-tier sampler offers every tier, and
     * `titratableUp` offers only the next one), never skipping the label's escalation steps.
     */
    titrate_one_step?: boolean;
    /** The dose is a one-time course chosen by a label table (ferric carboxymaltose), not a titratable dose: no titrate up/down candidates. */
    single_course_dose?: boolean;
    /**
     * Multipliers applied to the drug's effect when the patient has type 2 diabetes (a smaller treatment effect in the diabetes trial
     * than in the non-diabetes trial): `weight` scales the placebo-adjusted weight percent, `kccq` the KCCQ effect.
     */
    t2dm_scale?: { weight: number; kccq: number; basis: string };
    /** Lower-case brand and common names by which an allergy to this drug may be typed ("entresto", "lasix"); read by services/engine/allergy.ts. */
    allergy_aliases?: string[];
    /** Lower-case words of this drug's generic name that are a salt or a modifier, not the drug ("succinate", "sodium"): read inside a typed sentence they name no drug (R7 W10c); read by services/engine/allergy.ts. */
    allergy_modifier_words?: string[];
    /** Cash-pay monthly price by dose strength (used instead of the flat price when `patient.insurance_tier` is 'cash'). */
    cash_price_by_dose?: Record<string, number>;
    /** Plain-language warnings shown whenever this drug is in a recommended regimen (optionally only when `when(patient)`); informational, not score-penalized (text starts 'Drug note:'). */
    regimen_warnings?: { text: string | ((p: Patient) => string); when?: (p: Patient, regimen: RegimenMed[]) => boolean; /** Shown only on an option that starts the drug (or switches to it), never on one that keeps or reduces it (S13). */ when_started?: boolean; /** The note says a prerequisite for STARTING the drug is not met (a value to correct first). An option that starts the drug while `when` is true is not shown (T3). */ start_prerequisite?: boolean }[];
    /** The loop a diuretic-resistance switch starts FROM (2026 ESC Supplementary Table S7: consider switching furosemide to bumetanide or torasemide). The reverse switch is never offered. */
    resistance_switch_source?: boolean;
    /**
     * Places where the drug's label and the guideline give different numbers. Declared as data so the difference is shown on every option carrying the drug
     * (a "Drug note") and on the formulary card, with which source the tool follows and why, instead of living only in a code comment.
     */
    source_differences?: { topic: string; label: string; guideline: string; tool_follows: 'label' | 'guideline'; why: string }[];
    /** Monitoring-plan items added whenever this drug is in a recommended regimen. */
    /**
     * Drug-data monitoring items. `when_started`: the item is about STARTING (or raising) the drug and is shown only for an option that starts or raises it; for a drug already taken and unchanged the
     * `ongoing` wording is shown instead (or nothing when there is none).
     */
    monitoring_items?: (MonitoringPlanItem & { when?: (p: Patient) => boolean; when_started?: boolean; ongoing?: MonitoringPlanItem })[];
}

export interface RegimenMed {
    med: Medication;
    dose: MedicationDose;
    selected_frequency: string;
    exposure?: MedicationExposure;
}

export interface MedicationExposure {
    status?: 'active' | 'held' | 'completed' | 'unknown';
    adherence?: 'consistent' | 'partial' | 'unknown';
    started_on?: string;
    dose_changed_on?: string;
    last_dose_on?: string;
    restart_or_repeat_reviewed?: boolean;
    /** Clinician assessed drug-specific minimum time at dose and tolerability. */
    dose_interval_reviewed?: boolean;
}

/** Recorded findings for safety review; not a future measurement or safety clearance. */
export interface MedicationRiskScreen {
    basis: 'observed_state_only';
    sbp: number;
    dbp: number;
    pulse: number;
    potassium_high: number;
    potassium_low: number;
}

export interface TreatmentAssessment {
    basis: 'observed_treated_state';
    quantitative_response: 'not_estimated';
    considerations: QualitativeProjection[];
    limitations: string[];
}

export interface DomainScores {
    /** Expected outcome benefit from trial relative risks (percent risk reduction versus no disease-modifying therapy); see services/engine/outcomeBenefit.ts. */
    mortality: number;
    hf_hospitalization: number;
    /** Symptoms and quality of life: credit-weighted KCCQ points, 0-100 (symptomBenefit.ts). */
    symptoms: number;
    /** Side effects: 100 minus the measured-harm burden, 0-100 (harmBurden.ts). */
    side_effects: number;
    neurohormonal: number;
    functional: number;
    volume: number;
    structure: number;
    guideline: number;
    completeness: number;
    cost: number;
    adherence: number;
}

/** One drug's contribution to an outcome estimate, with the evidence it rests on (display and audit; never alters a measurement). */
export interface OutcomeContributorView {
    medication: string;
    drug_class: string;
    row_id: string;
    /** The value USED for ranking: the published relative risk pulled toward no effect by its precision (services/engine/shrinkage.ts). */
    rr: number;
    rr_published: number;
    ci_low_published: number | null;
    ci_high_published: number | null;
    /** B = tau2 / (tau2 + se^2); 1 = unchanged. */
    shrinkage_b: number;
    /** The prior variance this row was weighted with: the death prior for death rows, the hospitalization prior for hospitalization rows (change C3, 2026-11-18). */
    prior_tau2: number;
    prior_name: 'death' | 'hospitalization';
    /** True when the weight B is below 0.2: the value used is mostly the prior (no effect), not the trial figure. */
    mostly_prior: boolean;
    /** The evidence row's population key (e.g. 'atrial_fibrillation' for a beta-blocker in current atrial fibrillation). */
    population_key?: string;
    /** The row ranks as no effect because randomized evidence conflicts (basis `conflicting`); no interval is displayed beside 1.00. */
    conflicting_evidence?: boolean;
    /** Plain sentence, present when the row used comes from a different ejection-fraction band than the one stated for the patient (X1). */
    band_note?: string;
    interval_imputed: boolean;
    credit: number;
    dose_adjusted_rr: number;
    basis: import('./services/engine/outcomeBenefit').OutcomeBasis;
    trial: string;
    citation: string;
    /** True only when the row's basis is `extrapolated` (carried from another population or EF band). */
    extrapolated: boolean;
    /** True when the row assumes no effect (relative risk 1): no outcome trial, no outcome evidence, or randomized evidence that conflicts (the basis says which). */
    assumed_neutral: boolean;
    /** True when the option STARTS this drug today and values it at the highest dose this patient may be given (plan credit; increases are valued at the new dose, not as titrated). */
    valued_as_titrated: boolean;
    /** Set when a start's credit is below 1 because a kidney, interaction or maximum-dose rule caps the dose: says which rule and at what dose (change C1, 2026-11-18). */
    start_cap_note?: string;
}

/** Expected relative risk of an outcome for a resulting regimen: a population average from randomized trials, not a prediction for this patient. */
export interface OutcomeEstimateView {
    outcome: 'all_cause_death' | 'hf_hospitalization';
    label: string;
    /** Relative risk versus no disease-modifying therapy, with an approximate 95% interval (independent-estimates assumption). */
    rr: number;
    ci_low: number;
    ci_high: number;
    /** `rr` is the ranking value: the option valued as the plan it starts (new starts at the highest dose this patient may be given, increases at the dose reached). Both views are kept: */
    as_planned: { rr: number; ci_low: number; ci_high: number };
    /** Every drug valued at today's dose. */
    as_prescribed: { rr: number; ci_low: number; ci_high: number };
    /** Relative risk of this option (as planned) versus the patient's current (active) regimen as dosed today; below 1 favors the option. */
    vs_current: { rr: number; ci_low: number; ci_high: number };
    /** Display only, never scored: the same regimen with every counted drug at full dose credit, versus no disease-modifying therapy. */
    at_target: { rr: number; ci_low: number; ci_high: number };
    /** Display only: that at-target regimen versus the current regimen as dosed today. */
    at_target_vs_current: { rr: number; ci_low: number; ci_high: number };
    contributors: OutcomeContributorView[];
    not_counted: (OutcomeContributorView & { reason: string; counted_instead: string })[];
    contributors_without_interval: string[];
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
    label: string;                 // "Well within budget", "High complexity", "Class I (strong)"
    tone: TradeOffTone;
}

export interface ScoredRegimen {
    regimen: RegimenMed[];

    // Projected Clinical State
    projected_patient: Patient;
    risk_screen?: MedicationRiskScreen;
    treatment_assessment?: TreatmentAssessment;
    baseline_lvef?: number; // Observed LVEF before this proposed change; may already be on treatment
    baseline_lvedd?: number; // Observed LVEDD before this proposed change
    baseline_lavi?: number; // Observed LAVI before this proposed change
    baseline_dry_weight_kg?: number; // Recorded dry weight before this proposed change

    // Scores
    overall_score: number;
    domain_scores: DomainScores;
    special_feature_bonus?: number; // Bonus from guideline-specific special features
    /** Explanation only (never scored): why this option is on screen when it was not chosen by the normal ranking (the congestion-coverage selection step). */
    shown_because?: string;
    gdmt_completeness?: number; // Fraction (0-1) of indicated, achievable GDMT therapies present — display tiebreaker
    /** Trial relative-risk estimates behind the two outcome domains, with the comparison against the current regimen. Display-only artifact, populated for the options returned. */
    outcome_estimates?: OutcomeEstimateView[];
    /** Display-only artifacts for the options returned: the KCCQ estimate behind the symptoms domain and the measured-harm lines behind the side-effects domain. */
    symptom_estimate?: import('./services/engine/symptomBenefit').SymptomEstimate;
    harm_burden?: import('./services/engine/harmBurden').HarmBurden;
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
    decisionReadiness?: DecisionReadiness;
    /** Explanation only: why each displayed option holds its place, and why each indicated class is or is not started (services/engine/whyFirst.ts). */
    why_first?: import('./services/engine/whyFirst').WhyFirst;
    /** The ejection-fraction band of the trial evidence, decided once from the entered patient (U6), with the sentence the screen shows once. */
    evidence_band?: { band: 'reduced' | 'mildly_reduced' | 'preserved'; text: string };
    /** Whether the scope question was answered, and what it found (scopeGate.ts). */
    scope_status?: { state: 'confirmed_none' | 'not_confirmed' | 'outside'; conditions: string[]; text: string };
}

/** Explicit scope of an assessment made from incomplete observations; never a safety clearance. */
export interface DecisionReadiness {
    mode: 'medication_options' | 'limited_review';
    missing: { field: string; label: string; consequence: string }[];
    available: string[];
    deferred: string[];
}

// --- Delta-from-Current Modification Types ---

export type ModificationAction = 'add' | 'titrate_up' | 'titrate_down' | 'swap' | 'remove' | 'keep';

export interface RegimenModification {
    action: ModificationAction;
    target?: RegimenMed;   // New med+dose (for add, titrate, swap)
    source?: RegimenMed;   // Existing med+dose being changed (for titrate, swap, remove, keep)
    summary: string;       // "Add Dapagliflozin 10mg", "Titrate Carvedilol 12.5→25mg BID"
    /** True for a change the safety rules require (a forced switch or removal). It does not count toward the per-visit limit. */
    mandatory?: boolean;
    /** Explanation only (never scored): a forced reduction or a withhold the safety rules apply for a state that can change (potassium, kidney function, heart rate, blood pressure, an interaction cap, acute decompensation), not a withdrawal for a lasting reason such as an allergy or pregnancy. */
    temporary_hold?: boolean;
    /** True for the removal of the second agent of one class when the patient arrived on two (the clean-up of a duplicate entry). It is not a dose reduction or a withdrawal of the class and is never scored or counted as a diuretic or other class change. */
    duplicate_cleanup?: boolean;
    /** The stated reason of a forced (mandatory) change, kept so that a forced switch whose replacement cannot be started becomes a plain removal that says the same reason (R8 X11). */
    forced_reason?: string;
}

export interface ModificationSet {
    modifications: RegimenModification[];
    resulting_regimen: RegimenMed[];  // Full regimen after all modifications applied
    /** Set when the congestion display rule could not put a loop diuretic step into this option: why (potassium emergency, per-visit limit, a tool rule). Shown as a note on the option. */
    loop_step_omitted?: string;
}

// ExcludedMedication moved to top for broader reuse
