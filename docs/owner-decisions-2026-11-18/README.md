# Recommended answers to the 16 open owner decisions (2026-11-18)

Status: the recommendations below are the controller's (Claude's), reached after three adversarial rounds. On 2026-11-18 the owner instructed, in his words, "implement the recommended changes and run them as one package". The "change" recommendations were then implemented as rule set `2026-11-18.1` (section "Package as implemented" below). The owner has not ruled on any individual number; items marked as his value judgment or as waiting for the case review were NOT changed. The open-decision list itself is section 10 of `docs/first-principles-model-2026-11-16/README.md`; the numbering here follows the plain-language list given to the owner on 2026-11-18 (items 4 to 16 are shifted against section 10 because section 10's item 5, the Cochrane diuretic rows, was ruled on 2026-11-16).

Method: a first draft (working/draft-1.md); three independent reviews (clinical evidence with source checks, statistics and decision logic, owner's principles and compatibility with the hypertension engine) and a sensitivity study on the 1,032 reference runs; a revision (draft-2); a second-round challenger that also tested 6,000 seeded random patients, and second-round calculations; a third version (draft-3) and a final line-by-line check (working/round3-final-check.md). The final check's corrections are applied below. The working files contain scratch paths from the session and counts from patched copies of the engine; the repository engine was never changed.

"First options" are the first-ranked option in the 1,032 reference runs (1,011 have one) unless "random" is stated. Random-patient counts show sensitivity, not clinical frequency. The combined package below has NOT been run as one; run it before the owner signs.

| # | Decision | Recommendation | First options changed | Confidence |
|---|---|---|---|---|
| 1 | Valuing starts and increases | A start is valued as titrated, but not beyond the highest dose the engine's kidney, interaction and maximum-dose rules allow this patient; an increase is valued at the dose it reaches | 9 | High |
| 2 | The six weights | Owner's value judgment. Keep today's numbers, labelled policy, through the case review; source quality-of-life values once for both engines before changing any | 0 now (utility-derived weights with assumed inputs: 203, and all 3 met guideline targets lost) | High for "not now"; low that today's ratios are right |
| 3 | Side-effect scale | Keep the 0.5 / 1 / 3 severity weights; state that the divisor of 2 is a weight; correct the stale text in `data/harmDefinitions.json` | 0 | High |
| 4 | Ten upper-bound harm rows | Charge the average excess across the classes where the harm was measured, not the worst case; find a diuretic source for hypomagnesemia; one ruling for both engines | 1 to 11 | Medium |
| 5 | Precision weighting | Keep, centred on no effect, no exceptions; separate priors for death (0.030) and hospitalization (0.094). Owner to confirm his Cochrane ruling (published 0.24 / 0.07; used today 0.83 / 0.86; with separate priors 0.90 / 0.80) | 55 | Method high; separate priors medium |
| 6 | New classes per visit | Keep 2; keep counting IV iron and binders. Fix the option generator (it never builds "switch + two additions") after the owner sees examples | 0 (generator fix: 46) | High |
| 7 | Finerenone at LVEF 41 to 49 | Keep displayed; targets stay counted as not reproduced, annotated | 0 | High |
| 8 | KCCQ anchor | Keep 20 points | 0 | Medium |
| 9 | Low-dose credit | Keep 0.364; credit is never less than the fraction of the trial dose taken (spironolactone 25 mg: 0.36 becomes 0.96; RALES dose 26 mg). Owner to decide: may adding a new drug beat raising a drug already at the trial dose | 71 (44: "raise spironolactone 25 to 50" becomes "add vericiguat" or "add furosemide"; no new lead lowers a dose) | Defect high; remedy medium |
| 10 | Fixed safety penalties | Keep all through the case review. Afterwards: stop penalizing procedural notes; give the beta-blocker + ivabradine warning a heart-rate and dose condition | 0 now | High for now |
| 11 | Bonus for replacing a contraindicated drug | Delete after the case review, with examples | 0 reference; 15 of 6,000 random | Medium |
| 12 | Beta-blockers in atrial fibrillation | Condition on current rhythm; both rhythm values from one source (decomposing the engine's 0.66: sinus about 0.64, atrial fibrillation about 0.79 for death); a value for LVEF 41 to 49 too; never a reason to stop. Hospitalization by rhythm unresolved | about 23 to 30, all in atrial fibrillation | Condition high; number medium |
| 13 | Extrapolated rows | No invented extra uncertainty; rows carried to LVEF 41 to 49 stay, labelled not measured there; IV iron at preserved EF: no death benefit, hospitalization at 0.46 of the log effect; vericiguat at 45 to 49: VITALITY-HFpEF (no symptom benefit) | small | Medium |
| 14 | Weak rows | (a) thiazide creatinine rise only when taken with a loop; (b) dapagliflozin genital infection: keep; (c) ARB health status: not measured; (d) GLP-1 in reduced EF: neutral with the pooled interval; (e) IV iron hypophosphatemia: replace when the full text gives the excess over placebo | small | a, c high; d, e medium |
| 15 | SOLVD dose | Keep the dose among patients still taking the drug; record that a drug the patient reliably takes is undervalued relative to a start | 0 | Medium |
| 16 | Baseline risk | Yes, after the case review, jointly with the hypertension engine; choose the model in an evidence round | 0 now | High on the order |
| sub | Loop diuretic full credit at any dose; neutral without congestion | Keep both | 0 | High |

## Package as implemented (rule set 2026-11-18.1)

Implemented by a Sonnet agent from a written specification in three passes, then probed by an independent reviewer whose eight findings were fixed. Where the table above and this section differ, this section is what the engine does.

| Item | What the engine does now |
|---|---|
| 1 | A start (new class, or a switch to a different class) earns the credit of the best dose and frequency the engine may offer this patient, at most 1; an increase earns the credit at the dose reached. Equal daily doses now earn equal credit (the starting-dose reference was being read at the wrong frequency). |
| 9 | For a drug whose dose anchor is its own trial, credit is never less than daily dose divided by the trial dose (spironolactone 25 mg: 0.36 became 0.96). |
| 5 | Separate priors, centred on no effect: death 0.0288, hospitalization 0.0935 (symptoms unchanged, 12.559). A row is distinct by source and numbers, so one pooled analysis used for two drug classes counts once and two trials with identical numbers count twice. Rows whose weight is below 0.2 are marked "mostly prior". |
| 12 | Beta-blocker death rows by CURRENT rhythm, derived from the pooled 0.66 and the atrial fibrillation difference in Kotecha 2014 after precision weighting: sinus and other rhythms 0.636 (0.562 to 0.721); atrial fibrillation 0.792 (0.661 to 0.948); LVEF 41 to 49 in atrial fibrillation 0.734 (0.413 to 1.307; the measured subgroup, 1.30, 0.63 to 2.67, is cited as consistent but too imprecise to use alone). Hospitalization rows are not conditioned on rhythm. The card says the figure is not a reason to stop a beta-blocker used for rate control. |
| 4 | Seven upper-bound harm rows are charged at the average of the classes where the harm was measured (level "class average"). The loop and thiazide hypomagnesemia rows are "not measured" and charge nothing: the 21.6% was patiromer's rate, a population cohort found no association for loops and about three times the odds for thiazides with no recoverable absolute excess, and a randomized trial found no fall in serum magnesium. The Furoscix injection-site row stays an upper bound (fewer than two classes measured it). |
| 13 | IV iron at preserved EF scaled by the slope measured across all classes with two bands (13 pairs): death 0.195 (-0.056 to 0.446), hospitalization 0.571 (0.382 to 0.759); rows now 0.986 (0.949 to 1.024) and 0.899 (0.825 to 0.980). Rows carried to LVEF 41 to 49 are labelled not measured there. No extra variance added anywhere. |
| 14 | (a) The thiazide-type and metolazone creatinine rows are charged only when a loop diuretic is in the option; without a loop the drill-down says "kidney harm without a loop diuretic: not measured". (c) The ARB health-status row whose direction no source states is not measured. (d) GLP-1 in reduced EF: no effect assumed, shown in words with no interval. (e) IV iron hypophosphatemia: 7.48 points (8.1% on ferric carboxymaltose against 5 of 809 on placebo; PMC10053364), replacing 66.35 from an iron-deficiency anemia population. |
| 3 | The scale description in `data/harmDefinitions.json` now states the real formula and that the divisor of 2 is a weight. |

Not changed, as recommended: the six weights (2), the limit of two new classes per visit and the option generator (6), finerenone (7), the KCCQ anchor (8), the safety penalties (10), the swap bonus (11), the SOLVD dose convention (15), baseline risk (16).

### Measured results (all on the final tree, 2026-11-18)

- Gate: reference cases 1,032 runs identical after an intended refresh; scenario checks 564 passed, 0 failed; display checks 82 passed, 0 failed; audit:hundred 100/100; audit:mistakes 51/51; audit:red 0/0/0; pricing audit OK; random-patient sweep no violations; build passes.
- Against the engine before the package (`ranking-before-update.txt`): first option identical in 910 of 1,032 runs, changed in 122; displayed set the same in 937; eligibility and alerts identical; per-option warnings identical.
- Each change alone (first options changed): dose-fraction floor 71; separate priors 55; beta-blockers by rhythm 31; class-average and not-measured harms 11; start and increase valuation 9; IV iron, GLP-1 and extrapolated-row corrections 0.
- Guideline report (reported, never tuned; `guideline-report.txt`): mean concordance of the first option 72.74 (73.01 before the package, 73.37 for the guideline-driven engine); at least the old lead's in 805 of 1,011; targets 3 of 7.
- Kinds of change: vericiguat added where "raise spironolactone 25 to 50 mg" used to lead, 41; carvedilol replaced by eplerenone (atrial fibrillation), 18; dose only, 15; torsemide replaced by bumetanide, 6; others 42.
- Beta-blocker in the first option for a new reduced-EF patient: sinus 105 of 132 before and after; atrial fibrillation 21 of 54 before, 0 of 54 after.
- Congested patients (285 runs): a loop start or increase is first in 38 (32 before) and displayed in 243 (243 before).
- Hydralazine/isosorbide dinitrate in Black patients with LVEF 40 or below, NYHA III to IV, on a RAAS inhibitor and beta-blocker (21 runs): first in 9 (9 before), displayed in 17 (17 before).
- Finerenone is never the first-choice MRA at LVEF 40 or below, before or after.
- Independent review: no defect in arithmetic, eligibility, alerts or warnings over 1,032 reference runs and 3,000 random patients; in 1,270 atrial fibrillation cases against sinus twins a beta-blocker was never removed or reduced because of rhythm. Eight findings fixed (a false sentence on a beta-blocker row, a thiazide made to look safer with nothing shown, one pooled study counted twice in the prior, an IV iron slope fitted on a subset, start credit on ties, a source row showing a "value used", stale wording, two weak checks). Report: `working/review-implementation.md`.

### Not verified
- No browser check of the changed display. No clinician has reviewed the new first options.
- The Kotecha 2014 figures are from the PubMed abstract; hospitalization by rhythm was not readable. The CIBIS-II 0.64 is quoted from a review, not the primary paper.
- The 122 changed first options were characterized by kind, with 15 written examples; not every one was read.

## What the owner alone can settle
- Item 2: how much a hospital admission and a side effect count against death.
- Item 5: whether "use the Cochrane diuretic figures" meant through precision weighting or at face value.
- Item 4: one rule for unmeasured harms in both engines.
- Item 9: whether adding a new drug may beat raising a drug already at the trial dose.
- Full texts that would close open facts: Kotecha 2014 (hospitalization by rhythm), CIBIS-II (the 0.64 admission figure), the pooled heart failure analysis of hypophosphatemia after ferric carboxymaltose (PMID 36722321, placebo rate), SHIFT (share on beta-blockers).

## Found on the way (not among the 16)
- The same drug carries different side-effect burdens in the two engines (torsemide 5.2 in hypertension, 36.8 here). One shared table is needed before a merge.
- Is a loop diuretic a ranked competitor to the outcome drugs or a separate congestion slot.
- One policy for uncertainty on both sides (benefits are shrunk; harms, bounds and unknown patient values are not).
- Guideline-order mechanisms still in the engine: the prioritize-foundational mode, the congestion display rule, the volume-depletion adjustment.
- The prior calculation treats two different trials with identical numbers as one row.

## Corrections made during the loop (so they are not repeated)
- "The tool lowers spironolactone from 50 to 25 mg": wrong. The comparison was read backwards; the engine lowers a tolerated non-diuretic dose only for a safety reason.
- "The band penalties cannot change the order" and "deleting the bonus changes nothing": true in the reference runs, false in random patients.
- "A third of penalized warnings are procedural": 16% of the new first options in that test; only a few warning types are procedural.
- "The ivabradine bradycardia is already charged": the table charges about 0.14 ranking points; the warning is 8.
- Suggested order: owner rules; run the actual package and show examples for items 1, 5, 6, 9, 11, 12, 14e; implement with the full gate; freeze; clinician case review.

## Found during implementation, not in the package
Written 2026-11-18 during the implementation of rule set `2026-11-18.1`, updated in the third pass. The owner approved "separate priors for death and for hospitalization"; the estimator change below was an addition by the controller and was taken out of the package.

- **Finding.** The prior used for precision weighting is a moment estimator centred on no effect, tau2 = (Q - k) / C with Q = sum(w x^2). The code divides by the mean-centred DerSimonian-Laird quantity C = sum(w) - sum(w^2)/sum(w). For a Q centred on zero the divisor should be sum(w).
- **Values.** Package (C = mean-centred, kept; a row is distinct by source and numbers): death 0.0288, hospitalization 0.0935, symptoms 12.559 (KCCQ points squared). With the corrected divisor sum(w): death 0.0262, hospitalization 0.0853, symptoms 7.28.
- **Effect on first options.** Measured on the 1,032 reference runs against the FINAL package (the corrected estimator also re-derives the three beta-blocker rhythm rows from its death prior 0.0262: sinus 0.637, atrial fibrillation 0.789, LVEF 41-49 atrial fibrillation 0.731): 48 first options change (984 of 1,032 identical); displayed set the same in 1,002; eligibility, alerts and per-option warnings identical in all runs. The symptom prior is where most of the effect comes from (12.56 to 7.28).
- **Status.** Not implemented; a decision for the controller and the owner. A check keeps the stored beta-blocker rhythm rows tied to the live death prior, so changing the estimator later requires regenerating those three rows.


## Superseded on 2026-11-19 (round 1 review, controller rulings E1 to E14)
- Item 12 (beta-blocker death rows derived from the pooled 0.66 and the Kotecha difference): replaced by the measured atrial fibrillation subgroup rows; the three derived rows are removed.
- Item 4 (class-average harm level) and `class_average_harm.py`: removed; unmeasured harms are borrowed from a same-mechanism class or are not measured.
- The prior estimator (found during implementation) now divides by the sum of the weights.
- IV iron at preserved EF now carries the prediction uncertainty of the slope and is never narrower than its source (`iron_band_slope.py` rewritten).
