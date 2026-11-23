# How HeartFailurePath reaches a recommendation

Written 2026-11-10; updated 2026-11-12 (rules E16 and E19, the last rule then E22, adversarial review changes, current counts; earlier: rule E16, alignment with the 2026 ESC guideline: see the sections near the end). The engine follows the same five-step shape as GlucosePATH: describe the
patient and the drugs, exclude what cannot be used, generate options, score them against clinical
goals and patient values, and show the arithmetic.

`generateAndScoreModifications` in `services/simulationService.ts` is the staged orchestrator. Each
numbered comment in it is one stage below.

## Medication transitions and the observed baseline

(2026-11-16: the sentence in this paragraph that neurohormonal, functional, volume and structure scores are unassessed still holds; the outcome factors are now the trial-relative-risk model described in the 2026-11-16 section before Stage 6.) Rule set .8: [medication transition repair](medication-repair-loop-2026-11-12/README.md). The observed patient is never replaced by an inferred untreated or future patient. Net transitions drive medication-specific considerations, cost, burden and explicit safety/eligibility rules. CHF/hemodynamic coefficient functions are audit-only and cannot influence clinical output. Neurohormonal, functional, volume and structure scores are unassessed with zero weight; remaining weights are rescaled (cost also excluded when unknown).

The legacy `projected_patient` field contains unchanged observed physiology and a proposed regimen. Its `assessment_basis` is `proposed_regimen`; the public facade rejects it as follow-up input. Changed-dose metadata is not carried forward as evidence of established exposure. New observed data and reconciled actual treatment must come from a subsequent clinical assessment.

Exposure history distinguishes active, uncertain, held and completed therapy. Related increases/swaps need confirmed current use; increases additionally need explicit time-at-dose/tolerance review. Held/repeat-course changes have their own review prerequisites. No automatic binder rescue, numerical synergies, withdrawal subtraction or compensation remains. Known urgent findings remain unresolved until reassessed. Historical numerical-model descriptions later in this document are superseded by this contract and the .8 report.

## The pipeline

| # | Stage | Module (`services/engine/`) | What it decides |
|---|---|---|---|
| 0 | Validate and assess available information | `inputContract.ts`, `decisionReadiness.ts` | Invalid data stop calculation; missing core observations yield a focused review; missing medication prerequisites withhold dependent changes |
| 1 | Audit inputs | `gates.ts` | Implausible observations and arriving-regimen concerns. Can stop with alerts only |
| 2 | Raise alerts | `gates.ts` | Pregnancy, low output, referrals, volume depletion |
| 3 | Safety hard stops | `gates.ts` | SBP < 90 or K+ ≥ 6.5: alerts only, no regimens |
| 4 | Eligibility | `eligibility.ts` | Which drugs cannot be offered, by numbered rule |
| 5 | Enumerate | `candidates.ts` | Changes to the current regimen: add, titrate, swap, remove, keep |
| 6 | Score | `scoring.ts`, `effects.ts`, `domains.ts`, `scoreModel.ts` | A number for each candidate |
| 7 | Rank and select | `selection.ts` | Affordability, display-safety floors, up to 3 distinct picks, then the congestion-coverage step |
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
| E08 | Carvedilol after bronchospasm |
| E09 | GLP-1 after GI intolerance (new starts) |
| E10 | No nsMRA while staying on a steroidal MRA |
| E11 | No steroidal MRA while staying on an nsMRA |
| E12 | Decision-specific information required: missing clinical prerequisites withhold dependent new starts; existing E16 RAAS/MRA lab handling is preserved |
| E13 | Clinical contraindication (the drug's own `contraindications(patient)`) |
| E14 | Renal dosing contraindication |
| E15 | New MRA start at K+ 5.0 or higher is staged: withheld with or without a K+ binder, recheck and start once K+ is below 5.0 (initiation only; decision 2026-11-11; boundary 5.0-or-higher from the 2022 US text, second pass). A new spironolactone start at eGFR 30 or lower is a contraindication (E13, `mraStartEgfrCheck`). The MRA GDMT gap states the reason and the monitoring plan adds "repeat potassium; start MRA once below 5.0". No binder is co-started with a new MRA (the DIAMOND co-start was removed); the reactive rescue (projected K+ above 5.3) remains |
| E16 | Potassium and renal function required: a NEW ACE inhibitor, ARB, ARNI or MRA is not started while potassium or renal function is blank |
| E17 | Pregnancy: a NEW beta-blocker start is limited to beta-1-selective agents (`facts.beta1_selective`); a pregnant patient on a non-selective one is offered a switch with the reason (2026 ESC Class I C) |
| E18 | New RAAS inhibitor start above K+ 5.2 is staged: a NEW ACE inhibitor, ARB or ARNI (patient on none of them) is withheld with or without a K+ binder, recheck and start once K+ is 5.2 or lower (ESC S4/S5 caution threshold; staged start is engine policy). The RAAS GDMT gap states the reason and the monitoring plan adds "repeat potassium; start RAAS inhibitor if 5.2 or lower". A swap within the RAAS pool is not a new start. E13 still blocks a new start above 5.4 |
| E19 | No new RAAS inhibitor or MRA while the entered baseline creatinine shows the reduce band (rise of 50% or more, or derived eGFR fall over 30%); a drug already in use is untouched here (engine policy following 2026 ESC S4/S5/S8) |
| E20 | No new RAAS inhibitor, increase or switch at a measured eGFR below 20: an ACE inhibitor, ARB or ARNI the patient does not already take is not started (this includes a switch within the class) and one in use is not increased; a drug in use is kept, with the alert asking whether the fall is new (engine policy following 2026 ESC S4) |
| E21 | Correct low potassium before diuretic intensification: a new potassium-lowering diuretic waits for correction of recorded hypokalemia; existing therapy is reviewed separately |
| E22 | No switch to sacubitril/valsartan above K+ 5.2: a switch from an ACE inhibitor or ARB that stays on the regimen to sacubitril/valsartan is held at the level at which a new RAAS inhibitor start and an increase are held; a switch forced by the current drug's own allergy, intolerance or contraindication is not held (owner ruling 2026-11-21) |

Explanations: a rule may carry an optional `details(ctx, med)` that returns specifics; the filter
stores them in the additive `ExcludedMedication.why` (E13 lists each contraindication check that fired,
via `contraindicationReasons`; E12 names the blank renal value; E14 gives the eGFR). They never affect
the decision and are in `ADDITIVE_KEYS` for the golden master.

E17 comes after E16 (pregnancy beta-blocker start, initiation only); E18 comes next (new RAAS start above K+ 5.2, initiation only; E13 still reports potassium above 5.4 first); E19 follows (new RAAS inhibitor or MRA start while the baseline creatinine shows the reduce band; needs the optional baseline creatinine, with it blank nothing changes). E15's "already on an MRA" exemption now applies to a within-class switch only while that MRA may continue (potassium below 5.5). E16 (owner decision 2026-11-11) comes after the real contraindications, so a real contraindication (E13/E14) or the renal-gated start (E12) keeps its own label. E20 (eGFR below 20), E21 (low potassium before diuretic intensification) and E22 (no switch to sacubitril/valsartan above potassium 5.2) follow in that order; E22 comes last. It covers new starts only. Dose increases and switches to a RAAS inhibitor or MRA are dropped one level up, in `scoreCandidates` (`intensifiesRaasOrMra`), and a single `LABS REQUIRED: ...` clinical alert is raised once per run in the orchestrator. A drug the patient already takes is not affected. There is no freshness window (the form records no lab dates) and no new numeric threshold: "blank" is the existing not-entered value (0).

Order matters in two places: E12 must precede E13 (a blank-renal trip is labelled "renal data
required", not "contraindicated"), and E10/E11 ignore a current MRA that is being forced off.

## 2026-11-16: the first-principles model (supersedes the eight-domain description in Stage 6 and the .8 sentence that outcome domains are unassessed)

Full record: [first-principles-model-2026-11-16/README.md](first-principles-model-2026-11-16/README.md). The score is a weighted sum of six factors, all from measured or priced inputs, plus the named adjustments below:

| Domain key | Meaning | Weight (default) | Module and data |
|---|---|---|---|
| `mortality` | Death from any cause: percent relative risk reduction from trial relative risks | 0.30 | `outcomeBenefit.ts`, `data/outcomeEvidence.json` |
| `hf_hospitalization` | Heart-failure hospitalization, same method | 0.22 | same |
| `symptoms` | Expected KCCQ points / 20 x 100, capped | 0.10 | `symptomBenefit.ts`, `data/symptomEvidence.json` |
| `side_effects` | max(0, 100 - burden / 2); burden = one-year excess harm % x severity weight (0.5 / 1 / 3) plus a symptom figure per drug | 0.14 | `harmBurden.ts`, `data/harmEvidence.json`, `data/harmDefinitions.json` |
| `cost` | Out-of-pocket cost against budget | 0.14 | `domains.ts` (unchanged) |
| `adherence` | Dosing burden against tolerance | 0.10 | `domains.ts` (unchanged) |
| `guideline`, `completeness` | Computed and shown, reference only | 0 | `domains.ts` |
| `neurohormonal`, `functional`, `volume`, `structure` | Not assessed, no response model | 0 | `domains.ts` |

Supporting modules: `shrinkage.ts` (precision weighting: used value = B x published value, B = tau2 / (tau2 + se^2), tau2 computed from each table), `doseCredit.ts` with `data/doseEvidence.json` (full credit at the trial-achieved dose; `planCreditsFor` values a drug started or increased today as titrated, the way the trials did), all constants in `scoreModel.ts` (`BASE_WEIGHTS`, `PROFILE_MULTIPLIERS`, `KCCQ_FULL_CREDIT_POINTS`, `SIDE_EFFECT_BURDEN_DIVISOR`, `SHRINKAGE_FORMULA`).

Profiles are generated from `PROFILE_MULTIPLIERS` and renormalized: `outcomes_first` (cost and dosing burden x 0.5), `cost_first` (cost x 3), `simplicity_first` (dosing burden x 3). A profile changes only the weights. A missing budget removes the cost factor and the remaining weights are rescaled.

Ranking order is displayed score, raw score, cost, fewer changes, regimen key. Therapy completeness is no longer a ranking step (`selection.ts`). There is one ranking: the order above (`byScoreThenCost`). The earlier second ranking, "Prioritize foundational therapy", was removed on the owner's instruction (2026-11-20).

The estimates are population averages from randomized trials, not predictions for this patient. There is no baseline risk, so only relative effects are shown. Still fixed safety rules, not measured models: eligibility rules, the warning penalty, the low blood pressure / slow heart rate / high potassium bands, the volume-depletion adjustment, the two-new-classes-per-visit limit, the congestion display rule. The `SPECIAL_FEATURES` line now carries 0 points for every feature; it remains only for the mandatory-swap +15 before normalisation (clamped to -8 to +12 after), the one remaining hand-set number in the special-feature sum, non-zero on 17 of 951 displayed options (`special-features-inventory.md`). Loop diuretics have no measured dose relation (credit 1 at any dose); congestion relief by dose is not modelled and the congestion display rule shows the best diuretic intensification. Unknown patient values never make an option look safer: a sex-specific harm with sex not recorded, and a risk multiplier whose condition cannot be evaluated and whose ratio is above 1, are charged as the higher-risk case (`unknown_assumptions`).

Guideline recommendations are a target, not an input: `npm run guideline:report` (`scripts/guidelineReproduction.ts`) and `scripts/guidelineTargets.ts`.

## Stage 6: the score

> **Superseded 2026-11-16** by the section above for the domain list, weights, profile table, the Special-feature description, and the sentence that a perfect regimen scores 100 (the eight-domain model below is the 2026-11-10 to 2026-11-12 description, kept as history). The adjustment list and the reconciliation contract below still hold, except that `SPECIAL_FEATURES` points are now 0 except the forced-swap +15.

Missing-data behavior is defined in [the incomplete-information review](incomplete-data-2026-11-12/README.md). Measured KCCQ is optional: functional scoring averages only the recorded NYHA, KCCQ and activity components. Unmeasured BNP and unassessed affordability are `assessed: false` with zero weight; the remaining domain weights are proportionally rescaled. No baseline or projected measurement is invented. Scores across differing information completeness are not directly comparable. These are model policies, not validated outcome estimates.

With all scoring inputs available, the score is a weighted sum. Each candidate's projected state is scored in eight domains, each
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
| Guideline-directed therapy | Therapy completeness | 22% | Share of indicated, achievable therapies on board (graded credit below target dose: 0.6 + 0.4 x progress from the labeled starting dose to the patient's target; 0.6 at or below the starting tier) | |
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
first calibration and have not been clinically reviewed. On the 241 scenarios that produced a top pick under the default weights when this was measured (the suite then had 248 scenarios),
they change the top pick in 11 (outcomes), 12 (cost) and 13 (simplicity) cases; "simple" can lead with SGLT2i alone.

Therapy completeness is a domain, not a bonus: its score is the fraction of achievable
indicated slots attained x 100. If a patient had no achievable slots the domain scores 0 (the
breakdown line carries a note); across the golden runs when this was measured (744, then 248 scenarios x 3 insurance tiers) no displayed regimen hit that case.

Only named adjustments sit on top of the weighted sum. Every magnitude is in `SCORE_ADJUSTMENTS`
and each is a visible line item in the breakdown, in this order.

| Code | Effect |
|---|---|
| `SPECIAL_FEATURES` | Per-drug evidence bonuses, normalized by max(1, number of indicated foundational therapies) (x 2.3), clamped to -8..+12. The denominator is fixed across a patient's candidates; adding a neutral drug cannot dilute the existing evidence bonus. The line lists each feature that fired (`items`) |
| `VOLUME_DEPLETION_DEESCALATION` | +15 for reducing diuretics in a volume-depleted patient |
| `PROJECTED_SBP_LT_85` | Override: score set to 0 |
| `PROJECTED_SBP_LT_90` / `_LT_95` | -20 / -6. The SBP and HR bands read the LOWER of the projected and the entered value (2026-11-12), so a dose reduction is not rewarded for leaving a band |
| `PROJECTED_HR_LT_50` | -40 (same lower-of-projected-and-entered rule) |
| `PROJECTED_K_GT_5_5` | -40 |
| `DANGEROUS_WARNINGS` | -8 per residual-risk warning. Penalized warnings that are already true of the current regimen (`baselineDangerWarnings` in `scoring.ts`) are charged to every option, so none beats "no change" by cutting a drug until a state warning stops firing (2026-11-12) |
| `UNKNOWN_RENAL` (retired) | No longer applied as of rule set .6. Renal-dependent starts, increases and switches are withheld before scoring, including SGLT2 inhibitors. A penalty cannot replace missing safety prerequisites. The constant remains for historical ledger compatibility. |
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
3. Still tied: higher unrounded score, then the cheaper regimen, then fewer changes to the current regimen, then
   alphabetical order of the regimen's drugs (so the answer never depends on the order the drugs were typed in).

The UI shows this ledger under "How this score was calculated" on each recommendation card.

### One ranking

Options are ordered by `byScoreThenCost` (displayed score, raw score, cost, fewer changes, regimen key). There is no second ranking. Until 2026-11-20 a `Patient.ranking_mode` field (`balanced` or `foundational_first`) offered an
alternative order that put regimens with more pillar slots on board first; the owner removed it, together with `SimulationOutput.ranking`, `ScoredRegimen.foundational_coverage` and the form control. `Patient.ranking_mode`
remains in the type only as an ignored field, so older saved cases still load; a check shows it changes nothing. The weight profile (`care_priority`, "What matters most") is separate and still changes the weights.

Two rules act on the order after it is computed, and neither changes a score: when leaving the regimen unchanged is a candidate and no plan eligible for display scores `TOO_CLOSE_TO_SEPARATE_POINTS` (one point) or more above it,
"No medication change" is listed first (`selection.ts`, `chooseDisplayPicks`); and the congestion display rule adds a diuretic option for a congested patient (`ensureCongestionCoverage`).

Graded dose credit (2026-11-11, final pass): the old flat 0.6 for any dose below target gave a titration step (carvedilol 3.125 to 6.25 mg) no credit, so it lost to unrelated changes. The credit is now progress from the starting dose to the target dose: 0.6 at or below the patient's labeled starting tier for that drug (`start_dose_for(patient)`, else the lowest tier), 1.0 at target, maximum, cap or single dose (also where start equals target), and linear in total daily dose in between: 0.6 + 0.4 x (dose - start) / (target - start) (`COMPLETENESS_SUBTARGET_CREDIT` and `COMPLETENESS_GRADED_CREDIT_SPAN`, `scoreModel.ts`; `doseProgressToTarget`). With no dose cap, a NEW start stays at the start anchor. As of rule set 2026-11-12.4, a known renal cap also bounds the attainable target on its declared daily/per-dose basis: a starting dose that is already the renal maximum earns full completeness credit (eplerenone 25 mg at eGFR 40). Unknown renal labs do not confer this credit. This is scoring policy, not an additional efficacy claim. Basis: higher doses give lower event rates (2026 ESC section 6.1.6: composite event rates were lower with target than lower doses); the linear shape is engine policy. The target is patient-specific (`facts.target_daily_dose`, else the lowest strength `is_target_dose_for` accepts, else the `is_target_dose` flag). The guideline-concordance domain still uses the at-target boolean. The distinct-pick rule also treats two regimens with the same drugs as distinct when each consists solely of up-titrations of different drugs (titrate carvedilol versus titrate spironolactone), so a one-step beta-blocker titration is not hidden behind another titration. Against the pre-graded-credit golden, 8 of 999 top picks differ (`changes-final-anchored-credit.txt`): 3 semaglutide 0.25 to 0.5 steps and 5 beta-blocker heart-rate one-step reductions. Earlier version of this change (0.5 + 0.5 x dose/target): `changes-final-graded-dose-credit.txt`.

Known limit: a fully dosed pillar can still outrank a different pillar at its starting dose.

Congestion coverage (2026-11-11, final pass; `ensureCongestionCoverage` in `selection.ts`, a named pure step after distinct-pick selection, no score change): ESC 2026 dosing the loop diuretic to volume status for congestion is Class I A, so when the patient meets the engine's congestion criterion (more than `CONGESTION_EXCESS_KG_ABOVE` = 1.0 kg above dry weight, `isCongestedAboveDryWeight`, the same predicate the loop start and the diuretic-resistance rule use) and no displayed option raises or starts a loop diuretic, the best-ranked display-safe candidate that does is shown, preferring one whose ONLY change is the loop step (plus forced removals or dose reductions) and otherwise the best-ranked with a loop step, and never one that itself causes a severe projected-safety adjustment (`isProjectedSafetyClean` against the entered baseline): it replaces the LAST option when three are shown, else is appended. Option 1 is never displaced, the display floors and the budget rule still apply (in the over-budget fallback the cheapest loop candidate is used), the rule is part of the one ranking, and the added option carries the explanation-only `shown_because` line (card and copy-to-chart text). A loop candidate exists only if the engine's own hold rules allow an increase (volume depletion, loop at its maximum daily dose, hypotension). Effect: `changes-final-congestion-coverage.txt`.

Known limit: a fully dosed pillar can still outrank a different pillar at its starting dose, and a starting dose that is a large share of target (eplerenone 25 mg of 50) earns more credit than one that is a small share (spironolactone 12.5 mg of 50).
Over-budget fallback regimens are ordered the same way, and the UI marks them as not affordable at the stated budget.

One quirk is preserved from before the refactor: after a projected SBP < 85 zeroes the score, later
penalties still apply, so `raw_score` can be negative. It only affects tie-breaking among regimens
that are hidden by the display floor anyway.

History: until 2026-11-10 the weights summed to 130% (completeness was a +30 bonus) and the result
was clamped to 100. The model was rescaled by exactly 1/1.3, then rounded to the clean values above.
Against the pre-change baseline (315 golden runs at the time), 309 of 315 top picks are unchanged and every exclusion, alert and
warning is identical. Median top-pick score moved from 87 to 67 because the scale no longer has
30 points of headroom; scores from before and after are not comparable.

## Drug knowledge lives on the formulary entry

`constants.ts` entries declare their effects, contraindications, renal rules, special features and
`facts` (for example `beta1_selective`, `antiandrogenic`, `high_dose_threshold`, `rescue_role`). The
engine reads `drugFacts(med)` and never compares drug names. See `HOW_TO_ADD_A_MEDICATION.md`.

Still in engine code: adjunct initiation criteria for ivabradine, digoxin and H/ISDN in `candidates.ts` (vericiguat, GLP-1 and IV iron criteria are now the entries' own `ci` checks), and drug-interaction warning text in `effects.ts`.

## Tests that hold the shape

| Check | Command | Guards |
|---|---|---|
| Golden master | `npm run golden` | Every scenario under three insurance tiers (1032 runs, 344 scenarios) is byte-identical |
| Scenarios | `npm run verify` | 344 scenarios (`SCENARIOS`) plus the structural checks (371 pass on 2026-11-12; the printed count is authoritative) |
| Audits | `npm run audit:hundred`, `audit:mistakes`, `audit:red` | Broad, treatment-error and adversarial sweeps |
| Randomized sweep | `npm run fuzz` | 5,000 seeded random patients (`scripts/fuzzSweep.ts`): safety invariants written independently of the engine, plus consistency checks (regimen listed in another order gives the same answer; the ignored ranking-mode field changes nothing and care priority changes ordering only; a lower-case allergy still excludes the drug). Part of `gate` and `ci` |
| All of the above | `npm run gate` | |

The structural invariants (the harness count is authoritative): every drug has a price; every score breakdown reconciles; weight profiles never change
safety output; weight profiles move the top pick in the stated direction; the ignored `ranking_mode` field changes nothing; every weight
profile covers every domain and sums to 100%; titration never skips the next step; every RAAS new start is at or below its
starting tier; no displayed regimen exceeds a declared maximum total daily dose; eligibility rule ids are unique and ascending
and every exclusion carries one; no drug name appears as a literal in engine code; no engine module imports the facade;
contraindication checks are the single source of each drug's boolean; every E13 exclusion carries a why-detail; potassium binders carry no
positive evidence bonus (replaced the "enables RAAS/MRA" check on 2026-11-11).

## Alignment with the 2026 ESC guideline (2026-11-11)

Sources: `docs/medication-review-2026-11-10/esc-2026-reading-notes.md` (main text sections and Table 5, 11, 27 read directly; Supplementary practical tables S3-S9 were read; Table S26 and the
decompensated-HF tables, and the device, advanced-HF, arrhythmia, valve and amyloidosis sections, were not). Ranking effects are in `docs/medication-review-2026-11-10/changes-esc2026-*.txt`.

- Phenotype: two, not three. `classifyPhenotype`: HFrEF = LVEF below 50, improved EF (prior LVEF 40 or lower, or presumed), or current LVEF 50 or higher with a recorded numeric prior LVEF below 50; HFpEF = LVEF 50 or higher and never below 50.
  The guideline table is `CONCORDANCE_TABLE` (reduced EF: four Class I pillars, 20 + 5 at target; HFpEF: SGLT2i 45 + 10, MRA 30 + 5, RAAS inhibitor 4 as Class IIb, volume 10). HFpEF's MRA is now a pillar (gap, slot, candidate), a RAAS inhibitor in HFpEF is never added or swapped.
  Finerenone fills the MRA slot from LVEF 41 up unless the prior LVEF was 40 or lower (`nsMraFillsMraSlot`). Drug LVEF criteria keep their own thresholds.
- Digoxin: symptomatic NYHA II-IV, LVEF 40 or below, no pillar addable or up-titratable, any rhythm (IIa B1). Potassium binders carry no evidence bonus (no ESC recommendation; REALIZE-K note).
- RAAS potassium: new start blocked above 5.4 (rule E13) and staged above 5.2 (rule E18); a dose INCREASE is held above 5.2 as well (2026-11-12); a current inhibitor goes one step down from 5.5 (stopped at the lowest tier), is stopped from 6.0, MRA first (`facts.k_continuation.yields_to`); eGFR below 20 on a RAAS inhibitor raises an alert and never stops it (ESC S4 describes a fall from baseline and the tool has no baseline). The binder rescue is reactive only: attached only when every potassium-raising class in the candidate was already on the current regimen, otherwise a candidate needing a binder for a NEW class is dropped.
- Doses (Table 11): spironolactone target 50 mg (25 mg at eGFR 45 or below); ARNI starts 24/26 below eGFR 60 or with chronic hypotension (stricter than the label).
- Loops: titrate, do not swap, except forced swaps and diuretic resistance (congested on a loop at its high-dose alert level); forced swaps land on the nearest equivalent daily dose, never above the declared maximum. Thiazides: short-term note, review prompt, never forced removal.
- Pregnancy beta-blocker switch lands at the same fraction of the Table 11 target (engine policy). Beta-blocker heart rate: 55 carvedilol (label), 50 metoprolol succinate and bisoprolol (S6); up-titration hold below 60 is engine policy. With heart rate not entered, a beta-blocker or ivabradine is neither started nor increased (2026-11-12).
- Text: up-titration every 1-2 weeks (not faster than 2-weekly without close monitoring), chemistry 1-2 weeks after starting and after the final titration then every 4-6 months, creatinine rise under 50% acceptable with eGFR above 15 (was 30%).

Update the golden snapshot (`npm run golden:update`) only for an intended clinical change, in its
own commit that says why.

### Second pass (2026-11-11): primary US text, baseline creatinine, device/AF alerts

- MRA initiation: K+ 5.0 or higher (E15) and eGFR 30 or lower (new spironolactone start) withhold a new start; spironolactone and eplerenone are capped at 25 mg and start at the lowest tier below eGFR 50 (2022 AHA/ACC/HFSA 7.3.3). Monitoring line: within 1 week, about 4 weeks, after the final titration, then every 4-6 months.
- Baseline creatinine (optional `Patient.baseline_creatinine`; `services/engine/renalChange.ts`): `assessCreatinineChange` returns none / reduce / stop. Reduce (creatinine rise 50% or more, or CKD-EPI-derived eGFR fall over 30%) reuses the forced one-step reduction for a current RAAS inhibitor and MRA (`candidates.ts`) and blocks increases; stop (rise over 100%, or 50% or more with eGFR below 20) is `creatinineRiseStopCheck`, a contraindication check on every RAAS and MRA entry (removes a current drug, blocks a new start and an in-class swap). A `KIDNEY FUNCTION` alert states the change and the first steps. Blank baseline: no behaviour change.
- Alerts only (`gates.ts`): device (ICD/CRT classes; asks to check QRS, LBBB, aetiology), advanced-HF referral (lists the markers that fired), atrial fibrillation (anticoagulation by CHA2DS2-VA, rate control). No ranking effect; top picks and exclusions identical.
- Counts (2026-11-12): golden 1032 runs (344 scenarios), verify Passed 371.

## Adversarial review changes (2026-11-12)

Eligibility and candidates:

- E19 added (see the rule table); E15's exemption tightened.
- The dose-step cap also covers combination strengths (sacubitril/valsartan 24/26 cannot go straight to 97/103; H/ISDN likewise). The always-kept next step is the smallest increase in total daily dose when the next strength at its usual frequency would more than double it (furosemide 80 mg once daily goes to 80 mg twice daily); see `comparableDailyDose` and `smallestStepAbove` in `candidates.ts`.
- `structuralProblems()` in `candidates.ts` checks every candidate after the forced edits: a regimen listing the same drug twice, two agents of one class group, or a short-course add-on without its oral loop is dropped.
- Lateral swaps: for every class group except the RAAS pool a swap is offered only when the current drug must go (contraindication, intolerance, allergy) or the loop-resistance rule fires. A drug withheld by a potassium, heart-rate or kidney rule is never swapped for a sibling; a contraindicated diuretic in a non-congested patient is stopped, not replaced.
- Diuretics are not increased when the patient is more than 1 kg below dry weight, or at or below dry weight with no congestion finding (`diureticHeldForNoCongestion`).
- `congestionFindingCount()` (`services/clinicalPredicates.ts`) counts edema once whatever the grade and does not count cool extremities (a perfusion sign). The decompensation rule, the volume score and the congestion gate all use it. The form now allows one edema grade at a time.
- Hypokalemia caution is a class rule: any loop or thiazide-type diuretic added, swapped in or increased with a measured potassium below 3.5 carries a penalized caution (was metolazone only). Anuria is a contraindication check on all loop diuretics and chlorthalidone (was Furoscix, metolazone and hydrochlorothiazide only).
- Pregnancy: a non-selective beta-blocker that cannot be switched is kept, never increased.
- Rescue binder: patiromer is auto-added at its label starting dose only (`facts.rescue_role.max_rescue_dose`, 8.4 g daily).

Scoring:

- The projected SBP 90/95 bands and the HR below 50 band read the lower of the projected and the entered value.
- Penalized warnings already true of the current regimen are charged to every option (`baselineDangerWarnings`).
- The quadruple-therapy synergy applies to the reduced-EF phenotype only; KCCQ is clamped to 0-100 in the functional score.

Selection (`selection.ts`):

- The blood-pressure and heart-rate display floors apply only when the regimen moves the value the wrong way from the entered baseline; the high potassium floor stays absolute and a low floor hides an option that lowers projected potassium below 3.0 (the renal multiplier applies to rises only). The NO DISPLAY-SAFE alert names the floor that was broken.
- Ties are broken alphabetically so the answer does not depend on the order the drugs were typed in, and projected SBP, HR and potassium are rounded to 2 decimals.
- In the over-budget fallback the safety floors are applied before taking the five cheapest, and an option scored 0 is not shown merely because it is cheap. The automatic IV iron add-on is left off when it alone would push a regimen over budget.

Inputs and allergies:

- `auditInputs` (`gates.ts`): NaN, undefined or negative numeric inputs are normalised to 0 (the "not entered" sentinel). A blank systolic BP, current weight or dry weight stops the run with a DATA REQUIRED alert naming the field. A duplicate current drug keeps the higher dose and says so.
- Allergies (`allergy.ts` and `facts.allergy_aliases` in `constants.ts`): free-text entries are resolved to formulary drugs ignoring case and spacing, by generic, brand or class name ("ACE inhibitors"). An entry matching nothing raises an ALLERGY NOTE, and the form shows what each entry excludes. Adding a drug now means adding its brand names to `ALLERGY_ALIASES_BY_DRUG`.

UI: the Re-run button obeys form validation; Copy and Print are disabled while results are stale; the results pane has its own error boundary; the low-output hint uses the engine's two-of-three rule; the potassium hint covers 5.2, 6.0 and 6.5.

## Second pass (2026-11-12): the 17 open items

Full table with enforcement: `docs/adversarial-review-2026-11-12.md`. Changes that touch this document's tables:

- Scoring: the special-feature divisor is never below the number of indicated foundational therapies; warnings priced by a named adjustment (`WARNINGS_PRICED_BY_NAMED_ADJUSTMENT`) are shown but charged once.
- Potassium: the renal multiplier applies to rises only (`kPair`); RAAS increases are held above 5.2 like new starts; a binder in use is not reduced while measured potassium is 5.0 or higher; a rescue binder or iron over the per-visit limit or budget is dropped from the option instead of discarding it.
- Ranking ties: see "One ranking" above (displayed score, raw score, cost, fewer changes, regimen key).
- Doses: one target threshold per drug (losartan 150 mg); label versus guideline differences are `facts.source_differences`; `side_effects` rates are display-only.
- Inputs: one `INTOLERANCE_TABLE`; Chronic Kidney Disease and Obesity options removed; `hasAtrialFibrillationHistory`; `EXTERNAL_POTASSIUM_RAISERS`; patient cost capped at the cash price (`npm run audit:pricing`); fixtures reconciled with the form's derived fields.
- Output: cost label "Well within budget / Near the budget limit / Over budget"; copied notes carry run date, `RULESET_VERSION` (2026-11-12.2) and inputs.
