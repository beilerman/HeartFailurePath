# Statistical and decision-analytic review of draft-1 (16 decisions + 2 sub-items)

Reviewer: biostatistician / decision analyst. Repo read-only; nothing in `<repo>` was changed.

## 0. What I ran and what I only reasoned

RAN (code, real data):
- DerSimonian-Laird variants and ML / meta-regression fits on `data/outcomeEvidence.json` (scripts `tau.js`, `tau2.js`, `reg.js`, `pairs.js`, `slope.js` in `.../scratchpad/stat/`).
- Real dose ladders and credits from the engine (`ladder.ts`, importing `outcomeDoseCredit`).
- A toy sequencing model on the engine's shrunk relative risks and credits (`seq.js`, `seq2.js`).
- Whole-engine sweeps over all 344 scenarios (337 have a lead, cash tier) on a COPY of the engine code placed in `scratchpad/stat/repo/` and patched with environment switches (credit rule a/b/c, c0, shrinkage mode, upper-bound harm scale, weights, class limit, safety penalties, mandatory-swap bonus). "Lead changed" = the first displayed regimen differs from base. The scenario set is the hand-authored verification suite, not a patient population, so counts are sensitivity indicators only.
- Harm-burden distribution and KCCQ-points distribution of lead options.

REASONED ONLY (no run): utility derivation (all utility inputs are my assumptions and are labelled), Kotecha 2014 interaction arithmetic (uses the draft's recalled numbers, which I could not verify), MOCHA/ATLAS/HEAAL/STRONG-HF/FINEARTS-HF/SOLVD facts from memory, MAGGIC predictor list from memory, item 7, 11 (the run supports it), 14a-e logic.

## 1. Verdict table

| # | Verdict |
|---|---|
| 1 | CHANGE (premise wrong; a is not needed; prefer c plus cap) |
| 2 | CHANGE (weights are far from any utility scale; "keep until baseline risk" does not survive) |
| 3 | CHANGE the divisor reasoning (it is a hidden weight); UPHOLD severity weights as shared scale |
| 4 | CHANGE (half the bound is not defensible; use the empirical mean across measured classes) but it moves almost nothing |
| 5 | CHANGE (single null-centred tau2 is biased by outcome; prior choice swings used values by 0.1) |
| 6 | CHANGE (keep default 2); UPHOLD not counting binder/iron |
| 7 | UPHOLD (facts unverified) |
| 8 | UPHOLD the 20-point anchor; CHANGE the "1 KCCQ = 1 death point" claim and the additivity argument |
| 9 | UPHOLD the default 0.364 (small influence); CHANGE the MOCHA "corroboration" (wrong dose, uninformative) |
| 10 | CHANGE (the guardrails are inert and cannot do what the draft says) |
| 11 | UPHOLD deleting the number; DROP the new eligibility filter |
| 12 | CHANGE (use a shrunk interaction, not the AF subgroup point estimate) |
| 13 | CHANGE / NEEDS DATA (variance not estimable; attenuation must be proportional) |
| 14a | UPHOLD with a timing note |
| 14b | CHANGE the formulation (multiplier must be female-to-overall, drug is empagliflozin not dapagliflozin) |
| 14c | UPHOLD |
| 14d | CHANGE (the pool is not heart-failure evidence for reduced EF) |
| 14e | UPHOLD |
| 15 | CHANGE the justification ("conservative" is the wrong direction for keep/remove decisions) |
| 16 | CHANGE the formulation; build it, but not as stated |
| Sub: loop credit at any dose | UPHOLD |
| Sub: loop neutral without congestion | CHANGE the citation use (n of about 50 cannot support RR = 1) and give neutral rows an interval |

## 2. Item by item

### Item 1: starts and increases (Analyses 1 and 8 of the brief)

**Premise error.** The draft frames this as scheduling under "a limit on changes per visit". The engine limits NEW CLASSES (`types.ts:108` "Class substitutions/dose changes do not count as new classes"; `candidates.ts:1174` `countNewClassGroups`). Dose increases are free of the slot, and `candidates.ts:903-926` explicitly builds "add + titrate" combinations. A start and an increase never compete for a slot, so an index rule for ordering competing steps is not the criterion that applies to option ranking.

**Real ladders and credits (engine function, eGFR 70, first listed frequency):**
- lisinopril 2.5/5/10/20 mg: 0.364, 0.475, 0.698, 1.000 (step gains 0.111, 0.223, 0.302)
- enalapril 2.5/5/10 mg bid: 0.364, 0.634, 1.000
- carvedilol 3.125/6.25/12.5/25 bid: 0.364, 0.493, 0.752, 1.000
- losartan 25/50/100/150: 0.364, 0.550, 0.922, 1.000
- spironolactone 25 to 50: 0.364 then 1.000 (one rung); eplerenone 25 to 50: same; sacubitril/valsartan 49/51 to 97/103 bid: 0.364 then 1.000 (one rung)

**The draft's ratios hold only for a three-rung ladder.** Index of a start = 0.364 (first step). Index of an increase from the start dose = (1 - 0.364)/n rungs. n = 3 gives 0.212 and ratio 1.72 (the draft's 1.7). n = 1 (spironolactone, eplerenone, sacubitril/valsartan) gives 0.636 and ratio 0.57: the draft's own index would rank the increase ABOVE the start for those classes, while rule (a) ranks the start higher (1 vs 0.636). n = 2 gives 1.14. So the "(a) is closest to the index" conclusion is a statement about ACE inhibitors, ARBs and beta-blockers only, and also depends on the unidentified shape between the two measured points (linear in dose is the engine's assumption; a log-dose shape gives first increments of about 0.23 for lisinopril, not 0.111, making start:increase about 1.6 even under a one-step view).

**Does (a) double count across visits?** Yes in credit claimed: visit 1 books 1.0 for the start; at visit 2 the same drug, held at 0.364, offers a further +0.636, total 1.636 of a ceiling of 1. Within one visit it does not matter that yesterday's plan was credited; what matters is the inflation of today's increase relative to what the dose-response curve says one step buys. Toy valuation (ranking points = 0.30 x death pts + 0.22 x hospitalization pts - harm pts, shrunk reduced-EF RRs), visit 2 after lisinopril started:
- lisinopril step 2.5 to 5: rule a +7.72, by-dose (b) +1.46 (a is 5.3x too high)
- carvedilol start: a +13.32, b +4.46 (3.0x)
- dapagliflozin start: a +8.29, b +8.29 (1.0x; single-dose drug credit is already 1)
So (a) inflates increases 1.8 times more than starts (start:increase 1.73 under a, 3.05 under b), as the draft says, but it inflates every titratable drug against single-dose drugs (SGLT2 inhibitor, vericiguat, ivabradine, digoxin, loop diuretic, which get credit 1 at any dose).

**Two-visit example where (a) picks a worse sequence.** One new class per visit, nothing on board, ranking-point values under (a) / (b) / (c):
- visit 1: carvedilol 14.96 / 5.13 / 14.96; spironolactone 14.55 / 5.45 / 14.55; lisinopril 11.98 / 4.26 / 11.98; dapagliflozin 9.36 / 9.36 / 9.36.
- (a) and (c) start carvedilol (realized 5.13 now); (b) starts dapagliflozin (realized 9.36 now). Five visits, one change each, realized-benefit sum: (a) 63.5, (c) 72.3, (b) 91.6. With two changes per visit: (a) 108.2, (c) 116.8, (b) 123.8. The gap is a constant transition loss (about 28 and 16 points) so its share shrinks with horizon: 30.7%, 13.5%, 5.7% of the total at 5, 10, 20 visits (one change per visit).
Caveats, stated plainly: the realized-benefit objective is rule (b)'s own metric, so this toy favours (b) by construction; it shows only that (a) is not a sequencing-optimal rule, and that (c) beats (a) in both settings. It is not evidence that (b) is right for the engine.

**Engine sweep.** Lead changed vs base (a): rule (c) 1/337 (top-3 set 6/337); rule (b) 79/337 (top-3 set 121/337). So (a) vs (c), the distinction the draft spends most of its argument on, is immaterial in practice; (b) vs the others is the real decision. Under (b) leads shift toward dapagliflozin + eplerenone (credit 1 immediately).

**ATLAS/HEAAL.** Their contrast is the full titration to a high target versus a low target among patients who tolerated the low dose; that supports the policy "titrate to target" as a whole. It does not measure a one-step increase. The engine's own curve (calibrated on those two trials) already says what a step buys; (a) then overrides that curve for increases (value 0.525 against the curve's 0.223 for lisinopril 5 to 10 mg). The measured quantity for an increase is the dose-response, for a start it is the ITT relative risk: that is rule (c), not an inconsistency.

**Cap correction: UPHOLD** (verified: `planCreditsFor` marks credit 1 with no reference to the allowed maximum). **New defect found:** spironolactone 25 mg earns credit 0.364 while its trial anchor is 26 mg (RALES mean) because the code interpolates from the start dose (25) with a 1 mg gap; 50 mg earns 1.0. A patient on the trial dose is credited 36%, and "increase to 50 mg" is credited +0.636. This breaks (b) and (c) for MRAs and is an artefact of anchor equal to start.

**Verdict: CHANGE** to (c) (start = ITT value 1; increase and hold = dose credit) plus the cap and the MRA anchor fix; rationale is data-consistency, not scheduling. If the owner prefers plan semantics, keep (a) but label it as "value of the titration plan", not "closest to a scheduling index".

### Item 2: six weights (Analysis 5)

Formulas from the code: ranking weights 0.30/0.22/0.10/0.14/0.14/0.10; death and hospitalization scores are percent relative-risk reductions (one point = 1% of baseline risk); KCCQ score = 100 x points/20 (one KCCQ point = 5 score points = 0.5 ranking points); side-effect score = 100 - burden/2 (one burden point = 0.07 ranking points). Draft arithmetic checks: 0.30/0.07 = 4.3 burden points per death-score point, i.e. 1 death = 14 serious or 43 moderate events at 10% (correct arithmetic).

**Utility derivation (every assumption is mine; none verified from a source I could open).**
- Death: 0.7 utility x remaining life expectancy, LE = min(1/m, 12) years (constant hazard, capped, undiscounted). QALY lost per death q_D = 8.4 / 7.0 / 3.5 at m = 5/10/20%.
- Hospitalization: 0.15 QALY per event (range 0.05-0.30; typical cost-effectiveness inputs, not verified); untreated hospitalization rate h0 = 1.5 m.
- KCCQ: 0.004 QALY per point per year (range 0.002-0.007; mapping studies, not verified).
- Adverse events: moderate (weight 1) 0.02 QALY per event, mild 0.01, serious 0.06 (inherits the engine's 0.5:1:3).
- Per score point per year: death 0.01 x m x q_D; hospitalization 0.01 x h0 x 0.15; symptoms 0.2 x 0.004 = 0.0008; side effects 2 burden points x 0.01 x 0.02 = 0.0004.

| m | death | hosp | sympt | side eff. | cost | dosing |
|---|---|---|---|---|---|---|
| 5% | 0.579 | 0.016 | 0.110 | 0.055 | 0.14 | 0.10 |
| 10% | 0.632 | 0.020 | 0.072 | 0.036 | 0.14 | 0.10 |
| 20% | 0.615 | 0.040 | 0.070 | 0.035 | 0.14 | 0.10 |
| current | 0.30 | 0.22 | 0.10 | 0.14 | 0.14 | 0.10 |

Direction: death under-weighted about 2x; hospitalization over-weighted 5-14x (not "22 against 30": 0.22 against about 0.02-0.04); side effects over-weighted 2.5-4x (an engine death = 43 moderate events against about 350 under these utilities, so about 8x); symptoms roughly right in absolute weight but 2.9x too high relative to death. The draft's "1 KCCQ point is about 1 death-score point" holds only at KCCQ = 0.007 QALY/point (top of the plausible range); at 0.004 the engine overvalues KCCQ 2.9x, at 0.002 5.8x.

**Key point: the derived death weight barely depends on baseline mortality.** Under proportional hazards, benefit per relative point is 0.01 x m x LE, and LE is roughly 1/m, so it is nearly constant (0.0042-0.0070 across m). The draft's claim that the four clinical weights cannot be derived until absolute baseline risk exists is false for the death/hospitalization/symptom ordering; baseline risk matters mainly for harms on an absolute annual scale and for the hospitalization-to-death ratio.

**Sensitivity (sweep).** The "profiles move few leads" argument is about cost/dosing multipliers (9, 35, 0). Utility weights at m = 5/10/20%: 53/337, 59/337, 62/337 leads change. Halving side effects: 33; doubling symptoms: 25; halving hospitalization: 10.

**Verdict: CHANGE.** "Keep until baseline risk exists" does not survive. The composite-endpoint convention (first hospitalization counted like CV death) is a statistical counting rule, not a utility equivalence.

### Item 3

Divisor 2 is a hidden weight: side-effect effective weight is 0.14/2 = 0.07 per burden point and the two cannot be identified separately. The clamp argument fails numerically: over 948 displayed options the burden has median 45.9, p90 72.1, max 126.1; the clamp at 200 never binds, and even divisor 1 (clamp at 100) would bind for 19/948 (2%). **UPHOLD** severity weights (shared scale, cross-engine); **CHANGE**: make the scale one explicit weight, or remove the clamp for the score.

### Item 4 (Analysis 4)

"Half the bound" is the mean of Uniform(0, bound). But the bound is the maximum of the class values the table happens to contain, not a bound: it is upward-biased as a maximum of noisy values, and the uniform prior gives zero mass above it. Empirical class means from `harmEvidence.json` (measured rows only):

| effect | "bound" | half | mean of measured class means | median | n classes |
|---|---|---|---|---|---|
| renal SAE | 1.39 | 0.70 | 0.34 | 0.30 | 5 |
| AV block adv. | 0.26 | 0.13 | 0.10 | 0.23 | 4 |
| syncope | 3.0 | 1.50 | 0.80 | 0.80 | 8 |
| symptomatic hypotension | 5.0 | 2.50 | 2.00 | 1.41 | 11 |
| injection-site | 6.0 | 3.00 | 3.67 | 4.61 | 3 |
| hypomagnesemia | 21.6 | 10.8 | 21.6 | 21.6 | 1 (patiromer, 4 weeks, magnesium below 1.8) |

Half-bound runs 1-2x the empirical mean for four effects, and is unsupported for hypomagnesemia where n = 1 and the source chelates magnesium. Better expectation: an empirical-Bayes mean across measured classes for the same effect (floored at 0 per row as the engine does), with a mechanism flag (loop and thiazide hypomagnesemia is pharmacologically expected, so a literature rate from loop-treated HF cohorts is NEEDS DATA, not a bound). Also: the draft's rationale invokes "the guidelines support them" as a reason to lower a harm number; under P3 a guideline cannot be an input. **Impact is small:** setting all ten bound rows to half, or to zero, changes 3/337 leads each. **Verdict: CHANGE** the rule and drop the guideline rationale.

### Item 5 (Analysis 2)

**Is DL around zero a legitimate prior variance?** As a second moment of true effects, yes: tau2_0 = E[theta^2] is the variance of a N(0, tau2) prior. Method note: with Q taken around zero the moment denominator should be sum(w), not sum(w) - sum(w^2)/sum(w) (the engine's C is for mean-centred Q). Computed: engine 0.05961, correct moment 0.05687, ML around zero 0.0645; immaterial. A coincidence bug: the engine's duplicate key (rr, ci_low, ci_high) collapses `vericiguat-reduced-death` (0.90, 0.80-1.01) with `arb-preserved-hfh` (same numbers, different trials), so k = 38 not 39.

**What the draft's tau2 actually measures.** Precision-weighted mean of ln RR is -0.200 (RR 0.82). tau2 around the mean is 0.0179 (ML 0.0155): 70% of the "variance" is the mean effect, not heterogeneity. A single tau2 assumes drug classes, both outcomes and all three EF bands are exchangeable draws from one distribution. They are not: meta-regression on outcome and band (ML) gives mean -0.179 for reduced-EF death, band shift +0.080 (mildly reduced), +0.143 (preserved), outcome shift -0.137 (hospitalization), and residual tau2 0.0074. The null-centred prior therefore (i) over-shrinks hospitalization effects (their rms is 0.30, tau2_0 0.0935) and (ii) under-shrinks death effects (rms 0.17, tau2_0 0.0304).

**tau2 variants (all trial/meta rows, k = 38):**

| variant | tau2 |
|---|---|
| engine (null, pooled) | 0.0596 |
| (i) centred on weighted mean | 0.0179 |
| (ii) per outcome, null: death / hosp | 0.0304 / 0.0935 |
| (ii) per outcome, own mean: death / hosp | 0.0141 / 0.0109 |
| (iii) excluding congested loop rows (extrapolated rows and identical copies are already excluded) | null 0.0584; mean 0.0169 |
| also excluding odds-ratio rows | null 0.0535 |
| regression (band + outcome) residual | 0.0074 |

Excluding extrapolated/duplicate rows changes nothing because the engine already does so; the congested loop rows carry little weight (w about 1-2).

**Used relative risk (engine / (i) mean pooled / (ii) per-outcome null / per-outcome mean / regression):**

| row | published | engine | i | ii | ii-mean | reg |
|---|---|---|---|---|---|---|
| loop congested death | 0.24 | 0.830 | 0.777 | 0.904 | 0.846 | 0.817 |
| loop congested hosp | 0.07 | 0.863 | 0.785 | 0.799 | 0.741 | 0.717 |
| beta-blocker LVEF 41-49 death | 0.59 | 0.798 | 0.771 | 0.865 | 0.833 | 0.873 |
| beta-blocker LVEF 41-49 hosp (extrap.) | 0.92 | 0.966 | 0.836 | 0.957 | 0.777 | 0.800 |
| beta-blocker preserved hosp | 0.73 | 0.843 | 0.795 | 0.815 | 0.754 | 0.826 |
| ACE inhibitor preserved death | 1.04 | 1.027 | 0.898 | 1.021 | 0.934 | 0.980 |

Reading: (a) the congested loop value is mostly prior (B = 0.13 death, 0.055 hospitalization): the published number can move by 30% in the data and the used value changes by 0.01; across priors the used value ranges 0.72-0.90 on identical data, wider than any data-driven shift. This bears on the owner's ruling "use the Cochrane figures": the draft's reading reduces them to about 0.83/0.86, and under some defensible priors to 0.72. The owner should see both numbers. (b) A pooled-mean centre is wrong for the opposite reason: it pulls the null ACE-inhibitor preserved-EF row to 0.90 because reduced-EF classes show benefit. So the draft's null centre is protective but by accident, not by design; the correct fix is covariates (outcome and EF band), not a null centre. (c) Per-outcome null tau2 flips signs of bias: death rows get shrunk MORE (BB LVEF 41-49 death 0.80 to 0.865) while hospitalization rows get shrunk LESS (loop 0.863 to 0.799).

**OR as RR.** Odds ratio 0.24 for death with control risk 10-20% gives RR 0.26-0.28; OR 0.07 for worsening HF with control risk 20-40% gives RR 0.09-0.11. After shrinkage the used values move from 0.830 to about 0.849 (death) and 0.864 to about 0.886 (hospitalization): not material, because B is small.

**Engine sweep (lead changes vs base):** no shrinkage 48/337; pooled mean 7; per-outcome null 19; per-outcome mean 10; regression 32.

**Verdict: CHANGE**: per-outcome at minimum, preferably outcome x EF-band covariates with residual tau floored (k is small and rows not independent); report the prior-sensitivity range beside every shrunk row; the loop rows' near-total dependence on the prior must be disclosed. Related: the 27 "assumed neutral" rows carry se = 0 (B = 1), i.e. a stated certainty; give them the prior interval.

### Item 6

STRONG-HF enrolled patients recently hospitalized, with visits at 1, 2, 3 and 6 weeks and biomarker guidance; it tested a package, not "three new classes". The engine has no visit-frequency input, so the justification applies only to a care pattern the default does not assume. Measured: raising 2 to 3 changes 73/337 leads (22%); 3 to 4 changes 32. Given "unvalidated, silent-mode study next", keep 2. Not counting binder and IV iron is reasoned (they do not share the blood-pressure/potassium/kidney risk): UPHOLD that part. **Verdict: CHANGE** (keep default 2).

### Item 7

FINEARTS-HF entry criterion (LVEF at least 40%) and label are recalled, unverified. The engine's nsMRA 41-49 rows are copies of the steroidal-MRA pooled rows (not FINEARTS), which should be disclosed. Using evidence over guideline is consistent with P3. **UPHOLD.**

### Item 8

Anchor: harmless (scale convention). Lead KCCQ points have median 6.1, max 11.9 over 337 leads, so the 20-point clamp never binds. The additivity argument is weak: each trial measured the increment on top of its own background (which already included the other drugs), and KCCQ has a ceiling, so adding increments for four classes is not "what was measured". Symptom tau2 (12.56, k = 9) is dominated by GLP-1 (7.5, 6.9) and IV iron; B for typical rows is 0.94-0.99, so symptoms are essentially unshrunk (only beta-blocker 6.57 to 2.0). tau2 without GLP-1 is 8.46 (beta-blocker used 1.5): immaterial. The "1 KCCQ = 1 death point" claim fails (Item 2). **UPHOLD** anchor; **CHANGE** the claim; NEEDS DATA: KCCQ-to-utility slope.

### Item 9 and Analysis 8 (where start credit still matters under rule a)

Under (a) c0 enters only through: drugs held below their anchor (unchanged), reductions (c0 x dose/start), same-class swaps (max of new-start-dose credit and old-dose credit), and the symptom domain. Measured: c0 = 0.206 changes 10/337 leads, c0 = 0.565 changes 4/337. Under (b) it changes 25 and 16. So the draft's "limited influence" holds. MOCHA "corroboration": the recalled numbers give ln(6.0/15.5) / ln(1.1/15.5) = 0.36, but the lowest MOCHA arm (6.25 mg bid = 12.5 mg/day) is twice the label start dose (6.25 mg/day), where the engine curve gives 0.49 not 0.364. If real it contradicts the curve, not corroborates c0; and with about 1 event in the top arm and about 4 in the low arm the log-ratio SE is about 1, so the credit interval is roughly 0.1 to unbounded: uninformative. The four c0 values are two trials, two outcomes each (correlated); SEs from the HR intervals are about 0.2-0.3, so c0 = 0.36 plus or minus 0.25. Anchor mismatch (from recollection): ATLAS high arm about 33 mg and HEAAL high arm about 129 mg against stored anchors 16.79 and 110.43; using trial means gives c0 about 0.41. Not material. **UPHOLD** default, **CHANGE** the corroboration claim.

### Item 10

The four named penalties (SBP below 95/90, HR below 50, K above 5.5) key on the RECORDED patient values (`scoring.ts:405-427`; recorded measurements are never projected), so each applies identically to every option. They cannot change a ranking. Measured: setting them all to 0 changes 0/337 leads and 0 top-3 sets (62 top-3 scores shift uniformly). The draft's "removing them would let an option that projects to SBP below 90 rank first" is false: there is no projection. Real protection lives in gates and display floors. **Verdict: CHANGE**: say they are display/score shifts, not guardrails; discriminating protection requires drug-specific multipliers on hypotension/hyperkalemia harm (the `sbp_below` mechanism exists in `harmBurden.ts`); the targeted search is reasonable (NEEDS DATA, papers unverified).

### Item 11

Setting the +15 mandatory-swap bonus to 0 changes 0/337 leads and 0 top-3 sets. Delete the number. A new hard eligibility rule is itself a cliff (against P2) and unnecessary; show "keep" options as labelled not recommended instead. **UPHOLD** (deletion).

### Item 12

Recalled Kotecha 2014: sinus 0.73 (0.67-0.80), AF 0.97 (0.83-1.14). Using these: interaction ln(0.97/0.73) = 0.284, SE 0.093, z about 3.1 (consistent with the stated significant interaction). Subgroup effects are exaggerated; the principled estimate shrinks the INTERACTION, not the subgroup toward null. With a prior SD of the interaction 0.10: weight 0.54, shrunk interaction 0.153, AF effect about RR 0.85; with SD 0.05: about RR 0.79. The draft's route (AF row 0.97, then null-shrunk to about 0.973) credits the AF subgroup 0.8 ranking points against 4.5 for the interaction-shrunk value. Hospitalization-by-rhythm figure: NEEDS DATA (unverified). **CHANGE.**

### Item 13 (Analysis 3)

Measured (not extrapolated) rows in at least two EF bands: ACEi, ARB, beta-blocker, MRA, SGLT2i, digoxin (ARNI mild/preserved are all extrapolated, so "sacubitril/valsartan" is not a measured two-band class in this table; the draft's example pairs 0.84/0.97 and 0.70/0.91 are not in the table; only SGLT2i 0.87/0.97 is).

Paired differences d = ln RR(higher band) - ln RR(reduced): 17 raw pairs, 13 after collapsing identical mild/preserved copies, across 6 classes: ACEi death +0.262, hosp +0.250; ARB hosp mild -0.054, pres +0.169, death +0.138; BB death -0.112, hosp +0.132; MRA death +0.253, hosp +0.264; SGLT2i death +0.109, hosp +0.027; digoxin death +0.010, hosp +0.093.
- Mean d 0.118 (precision-weighted 0.137, SE 0.028): attenuation of RR by about 13-15% additive on the log scale.
- Between-pair variance beyond sampling: Q = 11.5 on 12 df, DL tau2 = 0 (hospitalization alone 0.0021): NOT estimable. Pairs are not independent (reduced-EF figure reused; the same trials for death and hospitalization), the effective n is 6 classes, and those classes were chosen because someone ran a trial in higher EF.
- Additive attenuation is mis-specified: adding 0.118 to ln RR flips a source RR of 0.99 to harm. Proportional model through the origin: ln RR(higher) = 0.463 x ln RR(reduced) (naive SE 0.07, Q = 17.9 on 12 df), residual SD about 0.1; slopes differ by class (SGLT2i hospitalization about 0.9, MRA about 0.3, ACEi/ARB about 0 to 0.5).
- Extrapolated rows also run the other way (GLP-1 from preserved to reduced, IV iron from reduced to preserved), where the reduced-to-higher attenuation does not apply.

Instead: (a) proportional attenuation 0.46 with an SD taken from the class-level scatter (inflated for 6 classes), only for reduced-to-higher extrapolations; (b) for the extra variance use an external empirical prior on between-trial heterogeneity of log hazard ratios for cardiovascular drugs (my recollection is SD about 0.1-0.2; I could not verify the source) or formal elicitation; (c) treat the two-band-class data only as a plausibility check of (a). Also note the cumulative stacking: an extrapolated row would be null-shrunk (item 5), attenuated and widened, while harm extrapolations get none of these. **Verdict: NEEDS DATA / CHANGE.**

### Item 14

- 14a: the 29.3% is a 72-hour add-on rate on a loop. Rate is an initiation-phase event but is charged every visit to every kept thiazide; keep as labelled, mild, but note that the same harm model charges initiation-phase harms to kept drugs everywhere. UPHOLD.
- 14b: the recalled 1.7% vs 0.6% is EMPEROR-Reduced, empagliflozin, mostly men (about 24% women); the row is dapagliflozin. The sex multiplier must be female-to-overall, not female-to-male: with excess 1.1% overall, women 24%, F:M ratio 6:1, the correct female rate is 1.1 x 6/(0.24 x 6 + 0.76) = 3.0%; multiplying 1.1 by 6 gives 6.6%, 2.2x too high. CHANGE the formulation.
- 14c: UPHOLD (no unverified sign).
- 14d: the "reduced EF" GLP-1 row (death 0.83) is dominated by SELECT, mostly non-heart-failure; the heart-failure-reduced trials (FIGHT, LIVE) are tiny and lean toward harm. "Pools all randomized evidence in both directions" is a description of mixed populations, not of reduced-EF evidence; after shrinkage the used death RR is about 0.85. Initiation requires LVEF above 40, so only continuation is affected. CHANGE: label not measured in reduced EF or set neutral with a wide interval.
- 14e: UPHOLD (cross-engine question).

### Item 15 (Analysis 7)

Engine credit at 10 mg/day enalapril: anchor 16.79 gives 0.634, anchor 11.2 gives 0.877 (+38%); at 20 mg/day both 1. The draft says pairing an ITT RR with the on-treatment dose is "conservative". That is true only for an adherent taker whose benefit exceeds the ITT effect. If stoppers (32.5%) get no effect, the per-protocol log effect is 1/0.675 = 1.48 times ITT: RR 0.80 becomes 0.72, a death-score difference of 8 points (2.4 ranking points). "Conservative" understates continuation of therapy already on board while a start is credited at ITT (which correctly includes expected dropout). That biases against keeping drugs and toward swap/remove, an unsafe direction for removal decisions. "Nobody was assigned 11.2 mg" is irrelevant: the ITT mean averages in the zero doses of stoppers. It also stacks (ITT dilution plus dose credit) for a confirmed adherent patient. Keep 16.6 mg only as the dose-among-takers axis, and state that continuation value is understated. **Verdict: CHANGE** (justification); NEEDS DATA: SOLVD adherence-adjusted effect.

### Item 16 (Analysis 6)

MAGGIC has 13 predictors including beta-blocker and ACE inhibitor/ARB use (from memory); the engine has no smoking or HF-duration field (`types.ts`), so two inputs are missing. Is the ratio formula double counting? Formally no: if r_obs is the risk under the current regimen then r_obs x RR(opt)/RR(cur) is the right increment and avoids reconstructing the untreated state. Real problems: (1) r_obs is the risk under the cohort's era mix (no MRA, ARNI or SGLT2 inhibitor), so for patients on those drugs it is not "risk under the current regimen" and dividing by RR(cur) over-removes; (2) MAGGIC's own BB/ACEi terms (observational, about 3 and 1 points) imply smaller effects than the trial RRs (BB about 0.82 vs 0.66), so two estimates of the same effect coexist; (3) ITT RRs applied to current users (healthy-adherer; Item 15); (4) 3-year probability to annual hazard; (5) no hospitalization model, and control-arm hospitalization rates vary several-fold across trials. Cleanest formulation: set the model's treatment terms to the reference state (untreated or the cohort average), obtain r_ref(x), then risk(option) = r_ref x RR(option) with the same RRs the engine already uses (the engine's score is already "versus no disease-modifying therapy", so an untreated baseline is the natural scale). Then calibrate against contemporary on-treatment trial control arms. **Verdict: CHANGE** formulation; build it.

### Sub-items under the diuretic ruling

- Loop credit 1 at any dose: UPHOLD (no randomized dose-outcome evidence).
- Neutral without congestion: a withdrawal trial of about 50 patients cannot show RR = 1; cite it as non-contradicting only, and give the neutral rows an interval.

## 3. Harm-not-shrunk (Analysis 9)

Harm rows carry no counts or intervals in the table, so they cannot be shrunk formally. Magnitude: across 66 measured drug/class harm rows the SD of annual excess is 4.6 percentage points; for a well-measured row (carvedilol syncope 3.0, SE about 1) B would be 0.95, a 5% shrinkage (about 0.15 ranking points). So for precisely measured harms the asymmetry is small. The asymmetry matters elsewhere: benefit side, shrinkage removes about 35 ranking points from congested loop diuretic (published 43.3 vs used 8.1) and about 7 from beta-blocker at LVEF 41-49 (14.1 vs 6.8) against harm charges of 1.6 and 1.7. The real bias is the stack of conservative choices on one side: null-centred benefits, selected harms (reported adverse events are upward-biased by selection), worst-case for unknown patient values, bound rows, and the lab-threshold harms (IV iron 33 burden points). Together they push toward fewer drugs, which the owner then reads as guideline misses.

## 4. Cross-item inconsistencies

1. Item 4 (expected value for unknown drug harm, motivated by guideline support) vs Item 10/others (worst-case) vs patient-unknown rule (worst-case) vs Item 14e (keep a 66% laboratory-threshold harm): one policy for uncertainty is not applied; and P3 is violated by item 4's rationale.
2. Item 5 (benefits shrunk toward null) + Item 13 (attenuate and widen extrapolated benefits) with no shrinkage or widening for extrapolated harms (20 sibling-proxy and 41 extrapolated rows): double conservatism on one side.
3. Item 6 (loosen a safety limit now) vs "unvalidated; case review first" and Item 10 (keep inert guardrails "for safety").
4. Item 12 (use the AF subgroup point estimate) vs Item 5 (null-centred, exchangeable rows): subgroups are not exchangeable rows; the interaction should be shrunk.
5. Item 15 (ITT RR with on-treatment dose is "conservative") vs Item 1(a) (start valued as ITT plan) vs Item 16 (ITT RR applied to current users): ITT used for starts and for continuing, which differ.
6. Item 2/3/8 "keep" together: death under-weighted 2x, hospitalization over 5-14x, side effects over 3-8x, KCCQ over 3-6x relative to death; the "within a factor of two" statements do not hold.

## 5. The three items where I am most confident the draft is wrong

1. **Item 10**: the penalties are uniform shifts on recorded values (0/337 lead changes when removed); the safety story is false.
2. **Item 2** (with 3 and 8): the claim that "no interim change is justified" and "weights cannot be derived without baseline risk"; derived weights are insensitive to baseline mortality and move 53-62 of 337 leads; hospitalization is over-weighted by one order of magnitude.
3. **Item 13**: the variance cannot be estimated from the available pairs (tau2 = 0 from 13 pairs/6 classes) and an additive attenuation flips weak effects to harm; cited pairs are not in the table. (Close fourth: Item 1's premise, since the limit is on classes, not changes.)

## 6. Decisions the draft should have raised

- The scoring scale mixes relative outcome points with absolute harm percentages; weights have no meaning until both are on one scale (the draft defers this to item 16 but then calls the weights fine).
- Time-unit mismatch: trial relative risks span 1.5-3 years of follow-up, harms are converted to one-year rates.
- Winner's curse in the mechanism-group rule: the lowest dose-adjusted RR among noisy shrunk estimates is chosen (ACEi vs ARB vs ARNI).
- Independence assumption in the interval (variance sum of independent rows) and multiplicativity of benefits for drugs trialled on top of each other.
- Coincidental-key bug in the duplicate counter and the DL denominator mismatch (minor).
- The spironolactone/eplerenone anchor-equals-start artefact (credit 0.364 at the trial dose).
- Zero-uncertainty on 27 assumed-neutral rows.
- Selection of the table itself (only classes in the formulary), which is the actual reason for a sceptical prior and should be stated as such rather than as a null centre.
