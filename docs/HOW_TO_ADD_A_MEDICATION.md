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
     `preferred_for_congestion` (moved first in worsening-congestion swaps/adds),
     `high_dose_threshold` (loop over-treatment alert), `rescue_role` (K+ binder rescue;
     `preferred: true` is tried first), `pick_distinctness_key` (top-pick distinctness).
   - `is_target_dose_for(strength, patient)` for patient-dependent targets (carvedilol by weight).
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

- **Adjunct eligibility criteria** (ivabradine, vericiguat, digoxin, H/ISDN, GLP-1, IV iron
  blocks in `analyzeCurrentRegimen`) are keyed on class and live in the engine.
- **A new class** with its own pillar or adjunct logic (concordance table, GDMT-completeness
  slots, class literals in rules).
- **Drug-specific warning text.** A new fact reuses an existing warning. New wording means a new
  emission site (and its score-penalty marker in `services/engine/scoreModel.ts`).
- **External drugs** (amiodarone, verapamil, lithium, sildenafil, ...) are matched in
  `patient.external_medications` by name in the engine; they are not formulary entries.
- Comply with the repo rule on clinical thresholds: update `components/FAQ.tsx`, `README.md`
  and `CLAUDE.md` for any change to clinical logic.
