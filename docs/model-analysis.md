# HeartFailurePath Scoring Model - Current Analysis

Date: 2026-02-21  
Code snapshot analyzed:

- `HeartFailurePath/services/simulationService.ts`
- `HeartFailurePath/constants.ts`
- `HeartFailurePath/data/scenarios.ts`
- `HeartFailurePath/scripts/verifyScenarios.ts`

This document replaces older line-by-line analysis that referenced pre-refactor file sizes and obsolete thresholds.

## 1. Model Purpose

HeartFailurePath is a deterministic clinical decision-support simulation engine for heart failure regimen optimization. It ranks medication modification sets using patient-state projection and safety-constrained scoring.

It is designed for clinician decision support, not autonomous prescribing.

## 2. Input/Output Contract

### Input

- patient state (`Patient`)
- available formulary names (`Set<string>`)
- medication prices (`Record<string, number>`)

### Output

`generateAndScoreModifications()` returns:

- `scoredRegimens` (up to 3 distinct recommendations)
- `excludedMedications`
- `clinicalAlerts`
- `monitoringPlan`

## 3. Candidate Generation Strategy

The engine performs delta-based modification generation from current regimen state.

Supported actions:

- add
- titrate up
- titrate down
- swap
- remove
- keep

Candidate generation includes:

- phenotype-aware pillar logic (HFrEF/HFmrEF/HFpEF/HFimpEF)
- contraindication and allergy filtering
- adjunct eligibility checks (Ivabradine, Vericiguat, GLP-1, DIAMOND binder logic, IV iron)
- class-group visit limit (`max_new_classes_per_visit`, default 2)
- structural prevention of dual RAAS and dual MRA combinations

## 4. Seven-Domain Scoring

Each regimen receives domain scores (0 to 100), then weighted aggregation:

- neurohormonal: 20%
- functional: 15%
- volume: 15%
- structure: 10%
- cost: 15%
- adherence: 10%
- guideline concordance: 15%

### Domain specifics (implemented)

- Neurohormonal: NT-proBNP interpolation (`<=125` best, `>=4000` worst)
- Functional: NYHA + KCCQ + optional step count
- Volume: weight excess, exam findings, and SpO2 penalties
- Structure: 40% absolute remodeling state, 40% improvement trajectory, 20% chamber geometry
- Cost: budget/sensitivity model with explicit zero-budget handling
- Adherence: complexity-vs-tolerance threshold decay
- Guideline: phenotype-specific pillar scoring with target-dose bonuses

## 5. Safety Gates and Clinical Alerts

Hard or near-hard controls in current implementation:

- input validation: SBP must be greater than DBP
- hemodynamic gate: `SBP < 90` returns alerts only (no regimen output)
- display safety floor: projected `SBP >= 85`, projected `K+ <= 6.0`
- pregnancy exclusions: RAAS, MRA/nsMRA, and SGLT2i classes excluded
- acute decompensation:
  - blocks beta-blocker initiation
  - down-titrates existing beta-blocker where indicated
- dual-class protections: no dual RAAS, no dual MRA in displayed regimens

Clinical alert channels include:

- low output state
- advanced HF referral triggers
- ICD/CRT screening note
- cardiac rehab referral note
- severe CKD diuretic caution
- volume depletion priority warning

## 6. Furoscix Integration Status

`Furoscix (SC Furosemide)` is fully integrated in formulary and scoring pathways.

Implementation highlights:

- class: Loop Diuretic
- dose model: 80 mg/10mL SQ on-body infusor (5h)
- prioritized for worsening-congestion loop pathways
- contraindicated for:
  - insufficient escalation/congestion context
  - eGFR < 15
  - furosemide hypersensitivity
  - adhesive/acrylate hypersensitivity
- when selected, mandatory warning text includes `FUROSCIX SAFETY`

## 7. Verification and Regression Coverage

Validation harness:

- script: `HeartFailurePath/scripts/verifyScenarios.ts`
- scenario set size: 71
- CI gate: `npm run ci`

Key invariant checks in harness:

- score range containment (0 to 100)
- no dual RAAS and no dual MRA regimens
- no duplicate medications in displayed regimens
- display safety floors preserved
- expected warnings for high-risk DDI contexts
- Furoscix candidate and allergy-guardrail behavior

## 8. Strengths

- deterministic and reproducible output
- explicit safety gating before display
- clear phenotype-specific guideline scoring paths
- integrated structured monitoring-plan output
- scenario-based safety regression harness embedded in CI

## 9. Known Limits

- effect sizes are modeled assumptions, not individualized response prediction
- does not include full longitudinal adherence/outcome modeling
- no direct EHR integration or time-series biomarker calibration
- not validated as a regulated software medical device

## 10. Recommended Use Boundary

Use as clinician-facing CDS simulation support for regimen exploration and safety awareness.  
Do not use as standalone prescribing authority.
