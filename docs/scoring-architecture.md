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

Explanations: a rule may carry an optional `details(ctx, med)` that returns specifics; the filter
stores them in the additive `ExcludedMedication.why` (E13 lists each contraindication check that fired,
via `contraindicationReasons`; E12 names the blank renal value; E14 gives the eGFR). They never affect
the decision and are in `ADDITIVE_KEYS` for the golden master.

Order matters in two places: E12 must precede E13 (a blank-renal trip is labelled "renal data
required", not "contraindicated"), and E10/E11 ignore a current MRA that is being forced off.

## Stage 6: the score

The score is a true weighted sum. Each candidate's projected state is scored in eight domains, each
0-100, and the eight weights sum to 100%, so a regimen that is perfect on every domain scores 100.
The domains are grouped (`DOMAIN_GROUPS`) as clinical outcomes, guideline-directed therapy, and
patient values. What a score of 100 means for each is in `DOMAIN_GOALS` (`domains.ts`).

| Group | Domain | Weight | Measures | Patient input that moves it |
|---|---|---|---|---|
| Clinical outcomes | Neurohormonal | 15% | Projected NT-proBNP between 125 and 4000 | |
| Clinical outcomes | Functional | 12% | NYHA class, KCCQ, daily steps | |
| Clinical outcomes | Volume | 12% | Weight above dry weight, exam findings, SpO2 | |
| Clinical outcomes | Structure | 8% | LVEF level and improvement, chamber size | |
| Guideline-directed therapy | Guideline | 12% | Indicated pillars present and at target dose for the phenotype | |
| Guideline-directed therapy | Therapy completeness | 22% | Share of indicated, achievable therapies on board (partial credit below target dose) | |
| Patient values | Cost | 12% | Monthly out-of-pocket cost against the budget | `max_affordable_cost`, `cost_sensitivity` |
| Patient values | Adherence | 7% | Regimen complexity against tolerance | `complexity_tolerance` |

The weights above are the Balanced row of `WEIGHT_PROFILES` in `scoreModel.ts`. The clinician's
answer to "What matters most to this patient?" (`patient.care_priority`) selects the row:

| Profile | Neuro | Func | Vol | Struct | Guideline | Completeness | Cost | Adherence |
|---|---|---|---|---|---|---|---|---|
| Balanced (`default`) | 15 | 12 | 12 | 8 | 12 | 22 | 12 | 7 |
| Maximize outcomes | 17 | 13 | 13 | 9 | 13 | 25 | 6 | 4 |
| Keep cost low | 13 | 10 | 10 | 7 | 11 | 20 | 24 | 5 |
| Keep the regimen simple | 13 | 10 | 10 | 7 | 11 | 20 | 10 | 19 |

The profile changes only these eight weights. Exclusions, alerts, safety deductions, display floors
and the budget filter are identical under every profile; `npm run verify` checks this for every
scenario under every profile, and checks that each row sums to 100%. The non-default rows are a
first calibration and have not been clinically reviewed. On the 105 scenarios they change the top
pick in 2 (outcomes), 4 (cost) and 6 (simplicity) cases; "simple" can lead with SGLT2i alone.

Therapy completeness is a domain, not a bonus: its score is the fraction of achievable
indicated slots attained x 100. If a patient had no achievable slots the domain scores 0 (the
breakdown line carries a note); across the 315 golden runs no scored candidate hit that case.

Only named adjustments sit on top of the weighted sum. Every magnitude is in `SCORE_ADJUSTMENTS`
and each is a visible line item in the breakdown, in this order.

| Code | Effect |
|---|---|
| `SPECIAL_FEATURES` | Per-drug evidence bonuses, normalized by regimen size (x 2.3), clamped to -8..+12. The line lists each feature that fired (`items`) |
| `VOLUME_DEPLETION_DEESCALATION` | +15 for reducing diuretics in a volume-depleted patient |
| `PROJECTED_SBP_LT_85` | Override: score set to 0 |
| `PROJECTED_SBP_LT_90` / `_LT_95` | -20 / -6 |
| `PROJECTED_HR_LT_50` | -40 |
| `PROJECTED_K_GT_5_5` | -40 |
| `DANGEROUS_WARNINGS` | -8 per residual-risk warning |
| `UNKNOWN_POTASSIUM` / `UNKNOWN_RENAL` | -12 each when intensifying without the lab |
| `SCORE_CLAMP`, `LOW_OUTPUT_CAP` | Overrides on the displayed score: guard clamp to 0-100 (listed only when it changes the value); cap at 25 in low output |

Every `ScoredRegimen` carries `score_breakdown` with these lines. The contract, checked for every
regimen by `npm run verify`:

```
weighted_subtotal = Σ (domain score × weight)
raw_score         = weighted_subtotal + Σ adjustment points + Σ raw-score override deltas
overall_score     = raw_score, clamped to 0-100 and rounded (then capped at 25 if low output)
```

**Ranking** (`byScoreThenCost` in `selection.ts`), also used for the over-budget fallback:

1. Higher displayed score first.
2. Same displayed whole-number score: the regimen covering more of the indicated therapy first, so
   a fraction of a point never drops a guideline pillar from the lead regimen.
3. Still tied: higher unrounded score, then the cheaper regimen.

The UI shows this ledger under "How this score was calculated" on each recommendation card.

One quirk is preserved from before the refactor: after a projected SBP < 85 zeroes the score, later
penalties still apply, so `raw_score` can be negative. It only affects tie-breaking among regimens
that are hidden by the display floor anyway.

History: until 2026-11-10 the weights summed to 130% (completeness was a +30 bonus) and the result
was clamped to 100. The model was rescaled by exactly 1/1.3, then rounded to the clean values above.
Against the pre-change baseline, 309 of 315 top picks are unchanged and every exclusion, alert and
warning is identical. Median top-pick score moved from 87 to 67 because the scale no longer has
30 points of headroom; scores from before and after are not comparable.

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
| Scenarios | `npm run verify` | 105 clinical scenarios plus 10 structural invariants |
| Audits | `npm run audit:hundred`, `audit:mistakes`, `audit:red` | Broad, treatment-error and adversarial sweeps |
| All of the above | `npm run gate` | |

The structural invariants: every drug has a price; every score breakdown reconciles; every exclusion
has a known rule id; no drug name appears as a literal in engine code; no engine module imports the
facade.

Update the golden snapshot (`npm run golden:update`) only for an intended clinical change, in its
own commit that says why.
