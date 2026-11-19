# Resolved dose anchors and low-dose credit (2026-11-15)

Files: `resolved.json` (anchors and low-dose credits), `verification.md` (every item checked). Rulings D1-D6 were applied as written. No recommendation on the 0.6 is made.

## Corrections to the researcher's file
- ATLAS HF hospitalization had no figure. Counts found: 1,199 (high dose) vs 1,576 (low dose) hospitalization events; ratio 0.761 is computed, no HR or CI exists in anything I could read.
- FINEARTS-HF achieved doses were "not found". Found: 32.3 mg of 40 (eGFR above 60) and 15.6 mg of 20 (eGFR 25-60).
- TOPCAT: mean 25 mg at 8 months is confirmed, but the fraction 0.5 is wrong against the 45 mg protocol maximum (25/45 = 0.556).
- DIG: 0.25 mg is a median (abstract: "median dose of digoxin, 0.25 mg per day"), not a mean.
- DECISION: the primary text gives starting doses 0.1 mg (75%) and 0.2 mg (25%); the "0.0625-0.125 mg" in a review is not in the paper. No mean achieved dose is published.
- The pooled beta-blocker fraction (0.729 to 0.80) leans on CIBIS-II, which is unsettled; without it the pooled fraction is 0.775.
- Tillman's CIBIS-II row says "no significant difference in all-cause death", which contradicts the trial abstract (HR 0.66). Treat that review's CIBIS-II line as unreliable.

## The denominator problem in SOLVD (judgement call, please decide)
Kondo's 16.6 mg is the mean among patients still taking enalapril. In SOLVD-T 32.5% of the enalapril group had stopped by the end, and 16.6 x 0.675 = 11.2 mg, the "all randomized" figure in the same footnote (Lam 2018 also quotes 11 mg). The relative risk is an intention-to-treat estimate, so it reflects the diluted 11.2 mg exposure; the on-drug dose is 16.6 mg. I kept 16.6 (a patient modelled as taking the drug) because that is how the engine uses it and the ruling says "achieved". If the controller wants the ITT dose, enalapril becomes 11.2 mg (fraction 0.56) and every ACE-inhibitor proxy drops by a third. The same question applies, unmeasured, to every other trial mean (most are among patients on treatment).

## Conflicts that stay open
- **Bisoprolol (CIBIS-II): 6.2 mg (Kondo) vs 8.6 mg (Tillman).** No primary text was reachable. Under D3 I used D2: 0.775 x 10 = 7.75 mg, and recorded both figures. A side finding, inference only: a review citing the Lancet paper reports 564 patients on 10 mg, 152 on 7.5 and 176 on 5 mg; those 892 patients average 8.59 mg (matching 8.6), and with the 434 low-dose patients (1.25-3.75 mg) the full arm would average 6.2-7.0 mg (matching the low end near 6.2). So 8.6 may be a mean among patients on 5 mg or more.
- **Digoxin**: DIG median 0.25 mg exceeds the largest formulary strength (0.125 mg); DECISION titrated to a serum level with no mean published. D5 clamps to 0.125 mg, which also equals DECISION's mean starting dose.

## Judgement calls
- D2 uses the trials behind the engine's own reduced-EF row. Direct figures from trials outside the row were not used but are recorded: Val-HeFT valsartan 254/320 (0.79, Kondo only), HEAAL losartan 129/150 (0.86), FINEARTS finerenone 0.81 and 0.78.
- The engine's target is the lowest flagged strength (lisinopril 20, enalapril 10 bid, ivabradine 5 bid, carvedilol 25 bid), so fractions use the lowest flagged daily target. Ivabradine's 13 mg/day is 1.3 of that (0.867 of the highest, 15 mg), inside the formulary range.
- EMPHASIS-HF 39/50 = 0.78 mixes two stratum targets (50 and 25 mg) and understates (stratum fractions 0.84 and 0.99); I kept it for the finerenone proxy because stratum sizes were not found. The finerenone proxy (27.3 and 13.6 mg) is therefore conservative against FINEARTS (32.3 and 15.6).
- Eplerenone eGFR 30-49: measured 24.8 mg is below the formulary start of 25 mg, so D5 raises it to 25.0.
- Doses are month-5 values for EMPHASIS and end-of-study for RALES; trial means differ in timing.
- Weekly drugs (semaglutide, tirzepatide) are reported per injection; the engine counts weekly as one dose per day.
- Entries with no flagged target and RR 1.0 (loops, thiazides, K+ binders) get no anchor; ferric carboxymaltose is dosed by iron deficit. Single-dose drugs skipped: dapagliflozin, empagliflozin, Furoscix.
- One anchor per drug, based on the death row. The beta-blocker HF-hospitalization row rests on CIBIS-II alone (bisoprolol), whose dose is unsettled; if the controller wants an HFH-specific anchor, all three beta-blockers fall to D2 with fraction 0.775 (bisoprolol 7.75, carvedilol 38.7, metoprolol 155 mg). I did not split rows by outcome.

## Low-dose credit (Part 3, engine scale: credit = ln RR(low) / ln RR(high))
| Comparison | Low vs high (mg) | HR high vs low | RR high vs placebo | Implied credit | Range over the HR interval |
|---|---|---|---|---|---|
| ATLAS death | 4.5 vs 33.2 (0.136; 1.8 x label start 2.5) | 0.92 (0.82-1.03) | 0.80 | 0.63 | 0.11 to 1.13 |
| ATLAS HF hospitalization | same | 0.761 (events ratio, no CI) | 0.67 | 0.32 | not available |
| HEAAL death | 46 vs 129 (0.357; 1.84 x label start 25) | 0.94 (0.84-1.04) | 0.88 | 0.52 | -0.36 to 1.31 |
| HEAAL HF hospitalization | same | 0.87 (0.76-0.98) | 0.76 | 0.49 | 0.00 to 0.93 |

The spread is the finding: point values run 0.32 to 0.63, but the death credits are not bounded by the data (the HR intervals include 1), and moving RR(high) across its own interval shifts them again (see `resolved.json`). RR(high) is a class value measured near the trial-achieved dose, not at ATLAS's 33 mg or HEAAL's 129 mg, so the formula mixes two dose levels. For comparison the engine's current credit at those low doses is 0.646 (lisinopril 4.5 mg) and 0.667 (losartan 46 mg).

## Non-randomized dose analyses (listed, no credit computed)
- **MERIT-HF** (post hoc, by dose reached): mortality reduction vs placebo 38% at both >100 mg (mean 192) and <=100 mg (mean 76, 38% of target), CI 16-55 and 11-57.
- **CIBIS-II** (Simon 2003, by last tolerated dose, tolerance-selected): all-cause death RH 0.66 (0.48-0.92) at 1.25-3.75 mg, 0.33 (0.21-0.51) at 5-7.5 mg, 0.59 (0.40-0.89) at 10 mg; withdrawal RH 2.13.
- **SOLVD-Treatment** (Lam 2018, post hoc strata): below target (mean 8.8 mg) death or HF hospitalization HR 0.68 (0.57-0.81) vs 0.70 (0.60-0.81) at target; death 0.90 vs 0.90; HF hospitalization 0.79 vs 0.75.
- **BIOSTAT-CHF** (observational, under-treated cohort): under 50% of recommended dose carried higher risk than 100%; 50-99% comparable; women about 30% lower risk at 50% of dose. No numeric stratum HRs.
- **STRONG-HF** (randomized strategy, bundles pace and monitoring): risk ratio 0.66 (0.50-0.86) for readmission or death; within the intensive arm, 10% more of optimal dose, aHR 0.89 (0.81-0.98) composite and 0.84 (0.73-0.95) death (observational).
- **MOCHA** (randomized, 345 patients, 6 months): carvedilol 12.5, 25, 50 mg/day crude mortality 6.0%, 6.7%, 1.1% vs 15.5% placebo; ejection fraction rose 5, 6, 8 vs 2 units; no per-dose HRs.
- **EMPHASIS-HF by eGFR stratum** (dose followed kidney function, not randomized): HR 0.62 (0.49-0.78) at the 25 mg stratum vs 0.58 (0.45-0.74) at 50 mg; P interaction 0.89.
- Randomized, not computed: **NETWORK** (enalapril 5.0, 9.7, 16.7 mg/day, 24 weeks): composite crude RR 1.20 (0.88-1.64) for high vs low, no dose gradient.

## What could not be settled
Primary-paper means for CIBIS-II, SAVE, AIRE, TRACE, A-HeFT, VICTORIA and the SELECT semaglutide dose; COPERNICUS and SOLVD-P rest on one review; ivabradine on two secondary sources; the ATLAS HF-hospitalization HR and CI.
