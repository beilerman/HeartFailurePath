# How to add a medication

Drug facts are data on the formulary entry. For a drug in an existing class that shares existing
facts, adding it is a data change and no engine edit. Written 2026-11-10 (alignment plan, phase 3).

## Steps

1. **Formulary entry** in `constants.ts` (`MEDICATION_FORMULARY`). Required:
   `name` (exact string; scenarios and allergies match on it), `drug_class`, `available_doses`
   (mark the guideline target with `is_target_dose: true`), `chf_effects(dose)`,
   `hemodynamic_effects(dose)`, `side_effects(dose)`.
   Optional: `renal_adjustment`, `contraindications`, `special_features`.
   Contraindications are a LIST OF CHECKS, each with a plain-clinical `reason`:
   `...ci([ { reason: 'Potassium above 5.5 mEq/L', when: p => p.potassium > 5.5 }, ... ])`
   (helper and shared checks such as `CI_ANGIOEDEMA` / `pregnancyCheck()` in
   `services/engine/contraindications.ts`). The boolean the engine calls is derived from the checks
   (`some(c => c.when(p))`), so reasons cannot drift from the decision. One check per OR-term, in
   order; state only what the code or its comment supports. The reasons feed the E13 "Why:" list
   (`ExcludedMedication.why`) and the formulary tab's "Not offered when" list. verify enforces
   non-empty, unique reasons and boolean parity.
2. **Facts the engine asks about** (all optional):
   - `facts: { ... }` (plain data) holds:
     `nonselective_beta_blocker` (withheld after bronchospasm), `beta1_selective` and
     `most_cardioselective` (asthma warning), `hepatically_metabolized` (BB cirrhosis warning),
     `cirrhosis_cyp3a4_caution`, `antiandrogenic` (avoided after any MRA gynecomastia),
     `delivery: 'on_body_infusor'` (device, CKD and SpO2 warnings),
     `short_course_addon` (Furoscix: short-course add-on beside an oral loop, never a swap), `max_daily_dose`, `effects_on_daily_dose` (effects use strength x doses per day), `raises_uric_acid`, `hypokalemia_caution_below_k`,
     `high_dose_threshold` (loop over-treatment alert, a TOTAL DAILY dose), `rescue_role` (K+ binder rescue;
     `preferred: true` is tried first), `pick_distinctness_key` (top-pick distinctness).
   - `is_target_dose_for(strength, patient)` for patient-dependent targets (carvedilol by weight, finerenone by eGFR).
   - `start_dose_for(patient)` (opt-in): the highest strength a NEW START (add or swap-in) may begin at;
     `facts.start_dose_exact: true` makes it the EXACT start tier instead of a ceiling (the ARNI: 24/26 or 49/51, never both).
     Every ACEi/ARB/ARNI entry declares one (new RAAS starts begin at the lowest tier; a verify invariant fails any RAAS add or
     swap-in above its declared tier, and any RAAS entry without the hook). `facts.low_dose_max_daily_mg` (ACEi/ARB): the total
     daily dose at or below which the Entresto label's "low dose" conversion rule applies (see `services/engine/raasStart.ts`); `interaction_dose_cap(patient)`: a patient-dependent maximum dose from an interaction (eplerenone + moderate CYP3A inhibitor).
   - `facts.titrate_one_step` (weekly GLP-1 / GLP-1-GIP: every labeled tier is offered and titration moves one tier at a time),
     `facts.single_course_dose` (a one-time label course such as ferric carboxymaltose: never titrated),
     `facts.t2dm_scale` (multipliers on the weight and KCCQ effects with type 2 diabetes), `facts.cash_price_by_dose` (cash-tier price by strength).
     `ChfEffects.weight_reduction_percent` (placebo-adjusted percent of the patient's weight) replaces the fixed kg for a drug that sets it.
   - `facts.regimen_warnings[].text` may be a function of the patient, and `when` receives `(patient, resultingRegimen)`.
   - `facts.k_continuation` (MRA potassium rule for a drug already on board), `facts.regimen_warnings` / `facts.monitoring_items` (warnings and monitoring shown whenever the drug is in a regimen; warning text starts "Drug note").
   - Combination products must declare their component classes the way existing combos do.
3. **Class registry**: if `drug_class` is new, add a row to `DRUG_CLASS_REGISTRY` in
   `services/simulationService.ts` (group, `dbpRatio`, flags). An existing class needs nothing.
4. **Price**: add a `DRUG_PRICES` entry in `services/pricingService.ts` keyed by `name`.
5. **Scenario + assertion**: add a patient in `data/scenarios.ts` and an assertion in
   `scripts/verifyScenarios.ts` showing the drug is chosen (or excluded, with its reason).
6. **Gate**: run `npm run gate`. If a golden diff appears, the change altered engine output.
   Review it as clinical behavior. Updating the golden (`npm run golden:update`) is a deliberate,
   reviewed act, never part of a refactor.

## What the structural tests enforce

- Every formulary drug has a `DRUG_PRICES` entry.
- No formulary drug name (or distinctive fragment such as "Furoscix" or "Entresto") appears as a
  whole string literal or object key in `services/simulationService.ts` or `services/engine/*.ts`.
  A new name branch in the engine fails `npm run verify`. Prose inside longer warning strings is
  not matched. Exceptions go in the commented `ALLOWLIST` in `scripts/verifyScenarios.ts`.
- Score breakdown lines sum to `raw_score`; eligibility rule ids are unique and ascending.

## Still requires engine edits

- **Adjunct eligibility criteria** (ivabradine, digoxin, H/ISDN blocks in `analyzeCurrentRegimen`) are keyed on class and live in the engine.
  Vericiguat, GLP-1 and ferric carboxymaltose initiation criteria are the drugs' own `ci` checks (with an initiation-only carve-out when the patient is
  already on the class); `candidates.ts` only offers the exact start tier of an entry that survives eligibility.
- **A new class** with its own pillar or adjunct logic (concordance table, GDMT-completeness
  slots, class literals in rules).
- **Drug-specific warning text.** A new fact reuses an existing warning. New wording means a new
  emission site (and its score-penalty marker in `services/engine/scoreModel.ts`).
- **External drugs** (amiodarone, verapamil, lithium, sildenafil, ...) are matched in
  `patient.external_medications` by name in the engine; they are not formulary entries.
- Comply with the repo rule on clinical thresholds: update `components/FAQ.tsx`, `README.md`
  and `CLAUDE.md` for any change to clinical logic.
