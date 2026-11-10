# How HeartFailurePath reaches a recommendation

Written 2026-11-10. The engine follows the same five-step shape as GlucosePATH: describe the
patient and the drugs, exclude what cannot be used, generate options, score them against clinical
goals and patient values, and show the arithmetic.

`generateAndScoreModifications` in `services/simulationService.ts` is a 45-line orchestrator. Each
numbered comment in it is one stage below.

## The pipeline

| # | Stage | Module (`services/engine/`) | What it decides |
|---|---|---|---|
| 1 | Audit inputs | `gates.ts` | Missing or implausible data. Can stop with alerts only |
| 2 | Raise alerts | `gates.ts` | Pregnancy, low output, referrals, volume depletion |
| 3 | Safety hard stops | `gates.ts` | SBP < 90 or K+ ≥ 6.5: alerts only, no regimens |
| 4 | Eligibility | `eligibility.ts` | Which drugs cannot be offered, by numbered rule |
| 5 | Enumerate | `candidates.ts` | Changes to the current regimen: add, titrate, swap, remove, keep |
| 6 | Score | `scoring.ts`, `effects.ts`, `domains.ts`, `scoreModel.ts` | A number for each candidate |
| 7 | Rank and select | `selection.ts` | Affordability, display-safety floors, up to 3 distinct picks |
| 8 | Explain | `explain.ts` | Monitoring plan, projections, trade-offs, follow-up |

Unlike GlucosePATH, stage 5 does not try every combination. Heart-failure care is titration of an
existing regimen, so candidates are changes from what the patient already takes.

## Stage 4: eligibility rules

`ELIGIBILITY_RULES` is an ordered list. For each drug, the first rule that fires wins, and the
exclusion carries that rule's id and name.

| Id | Rule |
|---|---|
| E01 | Previously discontinued |
| E02 | Patient-reported allergy |
| E03 | ACE inhibitor intolerance (angioedema or cough) |
| E04 | ARNI after angioedema |
| E05 | MRA after hyperkalemia |
| E06 | MRA after gynecomastia (spironolactone and named offender only) |
| E07 | Beta-blocker after bradycardia or AV block (new starts) |
| E08 | Non-selective beta-blocker after bronchospasm |
| E09 | GLP-1 after GI intolerance (new starts) |
| E10 | No nsMRA while staying on a steroidal MRA |
| E11 | No steroidal MRA while staying on an nsMRA |
| E12 | Renal data required (blank eGFR/creatinine, renal-gated start) |
| E13 | Clinical contraindication (the drug's own `contraindications(patient)`) |
| E14 | Renal dosing contraindication |

Order matters in two places: E12 must precede E13 (a blank-renal trip is labelled "renal data
required", not "contraindicated"), and E10/E11 ignore a current MRA that is being forced off.

## Stage 6: the score

Each candidate's projected state is scored in seven domains, each 0–100. The domains are the
clinical goals (first four and guideline) and the patient's values (cost and adherence).

| Domain | Weight | Measures | Patient input that moves it |
|---|---|---|---|
| Neurohormonal | 20% | Projected NT-proBNP between 125 and 4000 | |
| Functional | 15% | NYHA class, KCCQ, daily steps | |
| Volume | 15% | Weight above dry weight, exam findings, SpO2 | |
| Structure | 10% | LVEF level and improvement, chamber size | |
| Cost | 15% | Monthly out-of-pocket cost against the budget | `max_affordable_cost`, `cost_sensitivity` |
| Adherence | 10% | Regimen complexity against tolerance | `complexity_tolerance` |
| Guideline | 15% | Indicated pillars present and at target dose for the phenotype | |

The weights are `WEIGHT_PROFILES.default` in `scoreModel.ts`. There is one profile today.

Named adjustments are then applied in this order. Every magnitude is in `SCORE_ADJUSTMENTS`.

| Code | Effect |
|---|---|
| `SPECIAL_FEATURES` | Per-drug evidence bonuses, normalized by regimen size, −10 to +15 |
| `GDMT_COMPLETENESS` | +30 × fraction of achievable indicated therapies present |
| `VOLUME_DEPLETION_DEESCALATION` | +20 for reducing diuretics in a volume-depleted patient |
| `PROJECTED_SBP_LT_85` | Override: score set to 0 |
| `PROJECTED_SBP_LT_90` / `_LT_95` | −25 / −8 |
| `PROJECTED_HR_LT_50` | −50 |
| `PROJECTED_K_GT_5_5` | −50 |
| `DANGEROUS_WARNINGS` | −10 per residual-risk warning |
| `UNKNOWN_POTASSIUM` / `UNKNOWN_RENAL` | −15 each when intensifying without the lab |
| `SCORE_CLAMP`, `LOW_OUTPUT_CAP` | Overrides on the displayed score: clamp to 0–100; cap at 35 in low output |

Every `ScoredRegimen` carries `score_breakdown` with these lines. The contract, checked for every
regimen by `npm run verify`:

```
weighted_subtotal = Σ (domain score × weight)
raw_score         = weighted_subtotal + Σ adjustment points + Σ raw-score override deltas
overall_score     = raw_score, clamped to 0–100 and rounded (then capped at 35 if low output)
```

The UI shows this ledger under "How this score was calculated" on each recommendation card.

One quirk is preserved from before the refactor: after a projected SBP < 85 zeroes the score, later
penalties still apply, so `raw_score` can be negative. It only affects tie-breaking among regimens
that are hidden by the display floor anyway.

## Drug knowledge lives on the formulary entry

`constants.ts` entries declare their effects, contraindications, renal rules, special features and
`facts` (for example `beta1_selective`, `antiandrogenic`, `high_dose_threshold`, `rescue_role`). The
engine reads `drugFacts(med)` and never compares drug names. See `HOW_TO_ADD_A_MEDICATION.md`.

Still in engine code: adjunct initiation criteria (ivabradine, vericiguat, digoxin, H/ISDN, GLP-1,
IV iron) in `candidates.ts`, and drug-interaction warning text in `effects.ts`.

## Tests that hold the shape

| Check | Command | Guards |
|---|---|---|
| Golden master | `npm run golden` | 315 full engine outputs are byte-identical |
| Scenarios | `npm run verify` | 105 clinical scenarios plus 5 structural invariants |
| Audits | `npm run audit:hundred`, `audit:mistakes`, `audit:red` | Broad, treatment-error and adversarial sweeps |
| All of the above | `npm run gate` | |

The structural invariants: every drug has a price; every score breakdown reconciles; every exclusion
has a known rule id; no drug name appears as a literal in engine code; no engine module imports the
facade.

Update the golden snapshot (`npm run golden:update`) only for an intended clinical change, in its
own commit that says why.
