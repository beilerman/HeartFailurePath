# Round 2: targeted calculations on draft-2 (statistics reviewer)

All runs use the patched COPY of the engine in `.../scratchpad/stat/repo/` (switches by environment variable); the owner's repository was not touched. Run grid: 344 scenarios x 3 insurance tiers = 1,032 runs; 1,011 have a lead. "Changed" = first option differs from the unpatched copy (base). "Guideline numbers" come from the repo's own `scripts/guidelineReproduction.ts`, run unmodified on each patched copy. Base: mean concordance of lead 73.01; lead at least the old lead 806 of 1011; lead has highest concordance among displayed 861; targets 3 of 7 (missed: Furoscix, and the three finerenone targets).

## 0. Correction to my round-1 report
Round-1 item 11 ("bonus to 0 changes 0 of 337 leads") used a patch that zeroed only the label of the mandatory-swap feature, not the points (`specialFeatureBonus += 15` was untouched; confirmed: the adjustment stayed 8.63). Redone with a working patch over 1,011 runs: first options changed 0, displayed set changed 0, displayed order changed 0; scores move in 18 runs (6 scenarios x 3 tiers). Same conclusion as round 1 and as draft-2, now valid. All other round-1 switches were checked as effective (the penalty, weight, shrinkage, c0, class-limit and harm patches all moved scores).

## 1. Item 2: utility weights 0.632 / 0.020 / 0.072 / 0.036 / 0.14 / 0.10 (reported, not tuned)
Weights used 0.6315/0.0203/0.0722/0.0361/0.14/0.10 (unrounded derivation).

| | base | utility weights |
|---|---|---|
| first options changed | - | 203 of 1011 (20.1%) |
| mean concordance of lead | 73.01 | 72.46 |
| lead concordance at least old lead | 806 | 788 |
| lead has highest concordance of displayed | 861 | 827 |
| targets met of 7 | 3 | 0 |

Targets lost: A (LVEF 45: lead contains SGLT2 inhibitor), E (LVEF 42 obese: some displayed option has one), F (HFpEF: every displayed option has one). In A and E the lead becomes carvedilol + sacubitril/valsartan (dapagliflozin + sacubitril/valsartan 54.1 falls out of the top three); in F, dapagliflozin + furosemide stays first but "furosemide alone" (38.2) enters the display and "dapagliflozin alone" leaves.

What the 203 changes are (by drug set): eplerenone replaced by finerenone 61, by spironolactone 43; hydralazine/isosorbide dinitrate added to the lead 15 (+6 replacing furosemide); furosemide added 12; dapagliflozin replaced by carvedilol 6, by H-ISDN 6; sacubitril/valsartan replaced by spironolactone 6; 9 dose-only changes. Direction on drug count: 30 leads gain a drug, 1 loses one, 172 keep the count (mean drugs in lead 3.27 to 3.30): toward slightly MORE drugs, mostly swaps within a class. SGLT2 inhibitor dropped from the lead in 25 runs (all LVEF below 50, none gained); preserved EF (LVEF 50 or above, 108 runs): SGLT2 inhibitor in the lead in 108 of 108 both before and after, so preserved-EF SGLT2 starts are NOT lost as leads; they are lost only as "every displayed option" (target F).

Five before/after examples (cash tier):
1. John Doe (LVEF 25): carvedilol 25 + dapagliflozin + eplerenone 25 + furosemide 40 + lisinopril 20 -> same but spironolactone 12.5 replaces eplerenone.
2. Hyperkalemia K 5.6, avoid MRA (LVEF 25): dapagliflozin + furosemide 20 -> dapagliflozin + hydralazine/isosorbide dinitrate 37.5/20 tid.
3. Gout and congestion (LVEF 25): carvedilol 3.125 + sacubitril/valsartan 24/26 -> carvedilol 3.125 + spironolactone 12.5 (drops the ARNI).
4. LVEF 45 reduced-EF standalone (NYHA II): dapagliflozin + sacubitril/valsartan 24/26 -> carvedilol 3.125 + sacubitril/valsartan 24/26 (SGLT2 inhibitor lost).
5. Adjunct source, semaglutide at LVEF 46: dapagliflozin + ARNI + semaglutide 0.25 -> carvedilol + dapagliflozin + ARNI (semaglutide replaced by carvedilol).

**Single most sensitive utility input: the adverse-event disutility (QALY lost per moderate event, 0.02 assumed).** Rerun at the ends of its stated range (0.01 / 0.04), compared with the 0.02 utility run: 43 / 58 first options change; against base 241 / 177 change; concordance 72.53 / 72.17; at least old lead 787 / 777; highest of displayed 835 / 817; targets 0 of 7 at both. Other inputs (changes vs the 0.02-run, low/high end): KCCQ utility per point 0.002/0.007: 44/30; death utility 0.5/0.85: 37/20; life-expectancy cap 8 years: 7; hospitalization disutility 0.05/0.30: 1/10; hospitalization-to-death ratio 1/2.5: 1/7. Targets stay 0 of 7 at every end. So the marquee finding (hospitalization over-weighted 5-14x) hardly matters for leads; the side-effect weight does.

## 2. Item 5: separate null-centred priors, death 0.0304 and hospitalization 0.0935
First options changed 55 of 1011 (5.4%). Guideline: mean 73.34 (up from 73.01), at least old lead 822 (up from 806), highest of displayed 892 (up from 861), targets 3 of 7 (same three met, same four missed). 26 of the 55 leads have fewer drugs, 4 more, 25 same count; the congested loop diuretic leaves the lead in 20 changes. Examples: HFpEF with resistant edema (LVEF 55): dapagliflozin + furosemide 20 -> dapagliflozin + spironolactone 12.5; Critical renal (eGFR 25, K 5.2): furosemide + sacubitril/valsartan 24/26 -> dapagliflozin + enalapril 2.5 bid; Finerenone in HFpEF (LVEF 55): dapagliflozin + furosemide -> dapagliflozin + eplerenone 25.

**Is the difference between the two tau2 distinguishable?** Observed death 0.0304 (18 rows), hospitalization 0.0935 (20 rows), difference 0.063.
- Row bootstrap (10,000): difference 95% interval 0.016 to 0.106, P(difference <= 0) = 0.004. Death 0.008 to 0.064; hospitalization 0.059 to 0.128.
- Cluster bootstrap by drug class (12 classes): difference 0.015 to 0.093, P(<= 0) = 0.010.
- Label permutation (10,000): one-sided P = 0.009.
- Profile likelihood (normal model): death MLE 0.0325 (0.014 to 0.088), hospitalization 0.0905 (0.046 to 0.203); likelihood-ratio test separate versus pooled: chi-square 2.77 on 1 df, P about 0.10.
Verdict: the two second moments differ by distribution-free tests (P about 0.01) but only borderline under a likelihood test (P about 0.10), the intervals for death and hospitalization overlap in the likelihood analysis, and most of the difference is the difference in MEAN effect size (hospitalization effects larger, mean -0.27 versus -0.12), not a difference in spread. It does not undercut the change, but it does not prove that the variance of true effects differs; it is a modelling choice with moderate support. Removing the loop rows barely matters (0.029 / 0.092).

## 3. Item 12: beta-blocker death rows in current atrial fibrillation (patient.rhythm = AFib)
Implemented: for a current AFib patient, beta-blocker death rows with published RR below 1 use the stated used value. 159 of the 1,011 runs are AFib (53 scenarios); 78 runs (26 scenarios) have a beta-blocker on board.

| used value | first options changed | of which non-AF | BB start dropped (not on BB) | BB removed where patient on BB | other |
|---|---|---|---|---|---|
| 0.91 | 30 | 0 | 28 | 0 | 2 |
| 0.85 | 24 | 0 | 23 | 0 | 1 |
| 0.973 | 31 | 0 | 29 | 0 | 2 |

Does any displayed option remove or reduce a beta-blocker that the base engine kept? No new one. In AFib runs with a beta-blocker on board the displayed options that remove or reduce it number 9 in base and 9 at every value, and the first options that remove or reduce it number 3 in base and 3 at every value (forced reductions already in base for heart rate or blood pressure). The changes are starts of carvedilol that are displaced by another drug (for example: Jane Smith, carvedilol 3.125 + spironolactone 12.5 -> captopril 6.25 + spironolactone 12.5; De-novo HFrEF male: carvedilol + sacubitril/valsartan -> eplerenone + sacubitril/valsartan; Gout and congestion: carvedilol + sacubitril/valsartan -> eplerenone + sacubitril/valsartan). The range 0.85 to 0.973 moves only 7 first options, so the result is insensitive to the exact value.

Attack on the interaction prior. Interaction ln(0.97/0.73) = 0.284, SE 0.093, z = 3.07. The main-effect death prior 0.0304 is a spread of true MAIN effects; interactions are usually smaller, and the table's own cross-band differences (13 pairs, 6 classes) give a second moment of 0.0199 (class bootstrap 0 to 0.050; rms 0.14), about two thirds of 0.0304, with an interval that includes 0.0304. Resulting AF risk ratio (overall effect 0.75, 16.8% in AF; sinus 0.72-0.73):

| prior for the interaction | weight | shrunk difference | AF RR (sinus x exp(diff)) |
|---|---|---|---|
| draft: 0.0304 | 0.78 | 0.222 | 0.91 |
| table band differences 0.0199 | 0.70 | 0.198 | 0.89 |
| SD 0.10 | 0.54 | 0.153 | 0.85 |
| shrink to the table's mean difference 0.137 (residual variance about 0) | 0.19 | 0.165 | 0.86 |
| SD 0.05 | 0.23 | 0.064 | 0.78 |
| no shrinkage | 1.0 | 0.284 | 0.97 |

Verdict: applying the main-effect prior to the interaction is defensible but probably somewhat too wide (the table suggests about 1.5x too wide, not distinguishable from equal); the choice moves AF RR by 0.02 between 0.0304 and the table's own value. The empirical (table) prior gives 0.89, the zero-variance mean-difference version 0.86. The honest statement is a range 0.85 to 0.91; engine consequence of that range: 24 to 30 first options, none removing a beta-blocker the patient takes.

## 4. Item 13: proportional ratio by band and outcome (measured rows only)
Pairs (reduced-EF log RR vs higher-band log RR, slope through the origin weighted by the higher band's variance; interval inflated for Q above df):

| group | n | slope (95% interval) |
|---|---|---|
| (i) reduced to mildly reduced, death | 1 (beta-blocker) | 1.27 (-0.06 to 2.60) |
| (i) reduced to mildly reduced, hospitalization | 1 (ARB) | 1.20 (0.20 to 2.19) |
| (i) both | 2 | 1.22 (0.43 to 2.02) |
| (ii) reduced to preserved, death | 3 (ACEi, ARB, digoxin) | -0.10 (-0.75 to 0.56) |
| (ii) reduced to preserved, hospitalization | 4 (ACEi, ARB, beta-blocker, digoxin) | 0.46 (0.14 to 0.78) |
| (ii) both | 7 | 0.36 (0.07 to 0.64) |
| pooled 41 and above (MRA, SGLT2i; mildly reduced and preserved rows are identical copies, cannot be separated), death / hospitalization / both | 2 / 2 / 4 | 0.20 (-0.08 to 0.48) / 0.59 (0.14 to 1.03) / 0.47 (0.17 to 0.76) |
| all 13 pairs | 13 | 0.46 (0.30 to 0.63); death 0.20 (-0.06 to 0.45); hospitalization 0.57 (0.38 to 0.76) |
Class-cluster bootstrap of the all-pairs slope: 0.35 to 0.75 over 6 classes.

What the data say: "carry unchanged to LVEF 41 to 49" is not contradicted (slope 1.2, interval 0.4 to 2.0) but rests on two pairs and cannot be called supported; a separate fit for the pooled 41-and-above rows shows attenuation (0.47), so mildly reduced and preserved cannot be told apart. "Scale by about 0.46 to preserved" holds only for hospitalization (0.46, 0.14 to 0.78); for death the preserved-EF slope is about zero (-0.10, -0.75 to 0.56): the death benefit disappears, so 0.46 would overstate it. A single ratio across outcomes (0.36 for preserved) hides this.

Which of the 34 extrapolated rows would change under the draft's rule (reduced carried to preserved): only four (iron preserved death and hospitalization; congested loop preserved death and hospitalization). The other 30 are carried to mildly reduced (unchanged by the rule), indirect products (ARNI), class borrows (nsMRA reduced), or from preserved (GLP-1). Used values (single null prior; per-outcome prior in brackets), published, then scaled 0.46 / 0.30 / 0.65:
- IV iron preserved death: published 0.93, now 0.938 (0.944); scaled 0.971 / 0.981 / 0.959. With the death slope near 0, about 1.0.
- IV iron preserved hospitalization: 0.83, now 0.842 (0.838); scaled 0.924 / 0.950 / 0.894.
- Congested loop preserved death: 0.24, now 0.830 (0.904); scaled 0.918 / 0.946 / 0.886.
- Congested loop preserved hospitalization: 0.07, now 0.863 (0.799); scaled 0.934 / 0.957 / 0.909.
Recommendation by data: apply a ratio by outcome (hospitalization 0.46; death near 0 with wide uncertainty), not one ratio; and only 4 rows are affected, so it is a small decision.

## 5. Item 9: floor "credit never less than dose divided by trial dose"
Combinations that change (122 drug-frequency-dose combinations checked at eGFR 70; all others unchanged because the existing curve already lies above dose/anchor):
- Sacubitril/valsartan 24/26 bid: 0.182 to 0.267 (+0.085); 49/51 bid: 0.364 to 0.533 (+0.169).
- Spironolactone 12.5: 0.182 to 0.481 (+0.299); 25: 0.364 to 0.962 (+0.598).
- Eplerenone 25: 0.364 to 0.595 (+0.231).
- Finerenone 10: 0.182 to 0.366; 20: 0.364 to 0.733.
- Ivabradine 2.5 bid: 0.182 to 0.385; 5 bid: 0.364 to 0.769.
- Digoxin 62.5: 0.364 to 0.500.
No combination exceeds 1 and no ladder becomes non-monotone (checked across all 122 combinations; both before and after: 0 above 1, 0 non-monotone steps). First options changed: 74 of 1011 (7.3%): 41 add vericiguat (the lead lowers spironolactone 50 to 25, which now earns 0.962 with lower dose-related harm, then adds vericiguat), 13 dose-only changes, 6 torsemide to bumetanide, 5 lisinopril to sacubitril/valsartan, 3 ramipril to sacubitril/valsartan. Guideline: mean 72.72 (from 73.01), at least old lead 803, highest of displayed 798 (from 861), targets 3 of 7. First options that are "dose increase only": 213 to 181. Note: the floor changes MRA, ARNI, finerenone, ivabradine and digoxin credits only, so it also makes lowering a drug from 50 to 25 mg nearly free (credit 0.962 vs 1.0); that is the behaviour behind the 41 vericiguat additions.

## 6. Item 10: which adjustments are identical across options
Over the 967 runs with at least two displayed options (base): recorded-value band penalties SBP below 95 (6 runs), HR below 50 (21), K above 5.5 (33): identical on every displayed option in every run where they occur (SBP below 90 never occurs in a displayed option); LOW_OUTPUT_CAP (3 runs): identical. Differ by option: DANGEROUS_WARNINGS (present in 262 runs: identical on all options in 79, on some options only in 166, different amounts in 17); VOLUME_DEPLETION_DEESCALATION (+15; present on some options only in 3 runs); SPECIAL_FEATURES (the mandatory-swap +15; identical in 961 runs, differs in 6). Nothing else varies.

With the four band penalties removed: displayed order unchanged in all 1,011 runs (0 first options, 0 displayed sets, 0 orders; 81 runs have changed scores). Alerts, excluded-medication lists and per-option warnings identical in all 1,032 runs. With the mandatory-swap bonus also removed: still 0 changes (18 runs' scores move).
With the per-option warning penalty ALSO removed: 171 of 1011 first options change (16.9%); 120 gain a drug, 0 lose one; guideline mean 72.83, at least old lead 788, highest of displayed 848, targets 3 of 7. What then leads (counts by drug set): ivabradine added on top 96 (plus 6 with furosemide), digoxin replacing H-ISDN 15 or added 7, sacubitril/valsartan replacing dapagliflozin 12, captopril 6, spironolactone 3, eplerenone 3. Penalizable warnings carried by the new leads: "DDI WARNING: beta blocker + ivabradine has additive chronotropic suppression" 117 of 171; "Digoxin Monitoring: check serum level in 5-7 days" 27 (a procedural note, being used as a ranking penalty); elevated potassium 6; severe CKD loop strategy 6; ARNI at low baseline systolic pressure 9; NSAID + RAAS 3; amiodarone + digoxin 3. Three examples: Pregnant on existing ACEi (LVEF 32): metoprolol 25 -> digoxin 62.5 + metoprolol 25; NSAID + RAAS DDI: carvedilol + dapagliflozin + eplerenone -> carvedilol + eplerenone + sacubitril/valsartan; SBP 90 borderline: carvedilol + eplerenone -> carvedilol + sacubitril/valsartan (ARNI at low systolic pressure). So the warning penalty is the only thing stopping the engine from adding ivabradine to a beta-blocker, digoxin, and an ARNI at low systolic pressure, and one third of those penalties are procedural notes (digoxin monitoring), a defect worth a decision.

## 7. Item 1: start = 1, increase = credit at the new dose, both capped at the highest allowed dose
Cap verification: ramipril start at eGFR 25 credit 0.476 (was 1.0; max allowed 2.5 mg vs 8.39 anchor), at eGFR 35 0.698; digoxin at eGFR 25 0.364; spironolactone at eGFR 35 0.953. First options changed: 9 of 1011 (3 scenarios x 3 tiers), full list:
1. Jane Smith (Dry and Cold): carvedilol 3.125 + spironolactone 12.5 -> carvedilol 3.125 + eplerenone 25 (score 58.4 to 58.2/58.3).
2. Rate-Source Ivabradine With Diltiazem Warned: carvedilol 25 + dapagliflozin + eplerenone 25 + ivabradine 5 + sacubitril/valsartan 24/26 -> same with spironolactone 25 replacing eplerenone (53.3 to 53.0).
3. Rate-Source Ivabradine Beta-Blocker Limited By Hypotension: carvedilol 6.25 + dapagliflozin + sacubitril/valsartan 49/51 + spironolactone 25 -> sacubitril/valsartan 24/26 + spironolactone 50 (68.4 to 67.4).
(each of the three in cash, commercial and medicare tiers). Rule (c) alone (no cap) changes 3 of 1011.
"Titration never recommended" failure: using every scored candidate, in 135 scenarios that have both a no-change option and an increase-only option the best increase-only candidate never ranks below no change, in base or under the new rule (0 of 135). Among the 73 scenarios with a complete four-pillar regimen and at least one drug with credit below 0.6, the best increase-only candidate beats no change by 2.8 to 5.6 points under the new rule (for example Lisinopril 5 mg offers 10 mg next: 71.5 vs 66.8). (Limit: a no-change option exists in 186 of 341 scenarios; scoredCandidates uses uniform prices.) First options that are dose-increase-only: 213 before and 213 after (rule c: 213; the by-dose rule b: 222, with 253 first options changed and sacubitril/valsartan, dapagliflozin added in 155; under rule b guideline concordance would rise to 74.10 and 970 of 1011, reported only; my rule b is "start and increase at the credit of the dose given", which may differ from the draft's variant that changed 542).

## 8. All adopted changes together (weights unchanged)
Switches: item 1 (start capped at allowed maximum, increase at new dose), item 5 (per-outcome null priors), item 9 (floor), item 10 (four band penalties removed), item 11 (bonus removed), item 12 at 0.91, item 14e (iron hypophosphatemia 8.1), item 6 exemption of binder and IV iron, and the four STEP6 bound rows at class averages (0.34, 0.34, 0.34, 0.10). Variant with eight bound rows (adding vas-syncope 0.80, loop and thiazide hypotension 2.0, Furoscix injection site 3.67) in brackets.
- First options changed: 146 of 1011 (14.4%) [131].
- Guideline: mean concordance 73.09 [72.81]; lead at least the old lead 822 [810]; lead has highest concordance of displayed 815 [797]; targets 3 of 7 (same three met, same four missed). Lead concordance higher than base in 25 runs and lower in 62.
- Dominant changes: 41 add vericiguat (the floor effect), 18 carvedilol replaced by eplerenone, 16 dose-only, 8 H-ISDN + metoprolol replaced by bisoprolol, 6 torsemide to bumetanide.
- Dose-increase-only first options 213 to 187 [181].
- Eligibility, alerts and per-option warnings: excluded-medication lists identical in all 1,032 runs; clinical alerts identical in all 1,032; warning text of every option present in both versions identical (0 differences); the displayed set differs (140 options in the combined run are not in base, because ranking changed and the binder/IV-iron exemption lets more combinations pass the class limit).
Contribution of each switch alone (first options changed): floor 74, per-outcome prior 55, AF 0.91 30, cap and increase rule 9, binder/IV iron exemption 2, iron row 0, four bound rows 1 (eight rows 1), band penalties 0, bonus 0; they interact (sum 171, combined 146). The floor is the dominant driver.

## What I ran and what I did not
Ran: everything above (guideline report per variant; 1,032-run dumps for alerts, excluded lists, warnings, adjustments per option; bootstrap, permutation, profile-likelihood tau2; pair and slope fits; capped-credit and floor tables; candidate-level titration check). Did not run: any change to hospitalization/KCCQ literature sourcing (utility inputs are still my assumptions); the draft's own variant of "credit by today's dose" (my rule b differs); any run of `npm run verify` or `golden` on the patched copy (the copy lacks the UI components); no check of the item 6 option generator defect; Kotecha figures are the draft's.
