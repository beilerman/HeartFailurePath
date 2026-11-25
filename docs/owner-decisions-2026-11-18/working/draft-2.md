# Draft 2: answers to the 16 open decisions after round 1 (three adversarial reviews and sensitivity runs)

Inputs: draft-1.md, review-clinical.md, review-statistics.md, review-principles.md, sensitivity.md (same folder). "Changed" counts are first options of the 1,032 reference runs (sensitivity.md) or of the 337 scenarios with a lead (review-statistics.md). The owner's principles P1 to P5 at the top of draft-1.md are fixed.

For each item: ANSWER, what changed from draft 1, and WHY. Items where I overruled a reviewer are marked OVERRULED so round 2 can attack them.

## 1. Valuing starts and increases -> a start is valued as titrated; an increase is valued at the dose it reaches; neither beyond the highest dose this patient may be given
- Changed from draft 1 (which kept "increase = full credit").
- Why: ATLAS and HEAAL compared a fixed low dose with a fixed high dose; they do not measure one step. HEAAL also measured more kidney impairment, low blood pressure and high potassium at the high dose, so my argument that harm has no dose relation was wrong. Crediting an increase with the whole remaining gap overstates one step about threefold by my own arithmetic. Measured effect of the change: 3 of 1,032 first options, so this is a correctness change, not a ranking change.
- A start stays at full credit: the trial relative risk is the intention-to-treat effect of "start and titrate", and both benefit and harm are then on the trial's basis. Credit by today's dose for starts changes 542 first options (180 of them "increase becomes no change") and cannot be matched to the harm table.
- Cap: today a ramipril start at eGFR 25 is credited as if titrated to 8.39 mg/day when the largest dose the engine will offer is 2.5 mg. Credit should be that of the highest dose allowed by the engine's own kidney, interaction and maximum-dose rules (9 first options change). Blood pressure and heart rate "headroom" is NOT included: there is no measured basis for an expected achievable dose (recorded as a new open decision).
- OVERRULED: the clinical reviewer wanted a concave curve from observational data (BIOSTAT-CHF). Not adopted as a number: observational dose comparisons are confounded by who tolerates a dose. Adopted only as the floor in item 9.

## 2. The six weights -> change the METHOD: derive death, hospitalization, symptoms and side effects from one quality-of-life scale with sourced utilities, jointly with the hypertension engine; keep the present numbers, labelled policy, until that evidence round is done
- Changed from draft 1 ("keep until baseline risk exists").
- Why: the statistics review showed the derived death weight barely depends on baseline mortality (benefit per relative point is risk x life expectancy, and life expectancy is about 1/risk), so "wait for item 16" was wrong. With its (unsourced, assumed) utilities the weights would be about death 0.58 to 0.63, hospitalization 0.02 to 0.04, symptoms 0.07 to 0.11, side effects 0.035 to 0.055, cost 0.14, dosing burden 0.10, and 53 to 62 of 337 first options would change. Direction is robust: death is under-weighted about twofold, hospitalization over-weighted five to fourteenfold, side effects about three to eightfold.
- Why not change the numbers now: every utility in that calculation is an assumption no one has sourced. A common utility scale is also what the merged cardiometabolic tool needs to compare a stroke, a heart failure admission and a hypoglycemic episode (P5), so it must be one evidence round for both engines.
- Why this is still the owner's call: how much a hospital admission matters relative to death is a value judgment. The trial convention (first admission counted like cardiovascular death in a composite) is a counting rule, not a valuation. Consequence to show him: with hospitalization near 0.02, a drug whose only benefit is fewer admissions (an SGLT2 inhibitor at preserved EF) is worth much less.
- OVERRULED: the principles reviewer said keep as labelled policy and that no utility weights exist. Utilities for death, heart failure admission, KCCQ change and adverse events are published in cost-effectiveness work; they need sourcing, not inventing.
- Must not be tuned to guideline concordance (P3). Round 2 should REPORT, not tune: guideline concordance and targets under the utility weights.

## 3. Side-effect scale -> keep the 0.5 / 1 / 3 severity weights (shared scale); fold the divisor of 2 into the weight and delete it as a separate constant; the value of one burden point becomes one number for both engines under item 2
- Changed from draft 1 (kept the divisor as a clamp fix).
- Why: the clamp never binds (largest burden 131 of 200; at divisor 1 it would bind in 212 of 34,243 scorings). The divisor is a hidden weight: one burden point is worth 0.07 here and 0.22 in the hypertension engine. The description in data/harmDefinitions.json still says divisor 1 and must be corrected.

## 4. Ten upper-bound harm rows -> replace the worst case by the average excess of that harm across the classes where it was measured, labelled "class average, not measured for this drug"; decide it once for both engines; find a diuretic-specific source for hypomagnesemia
- Changed from draft 1 ("half the bound").
- Why: half the bound is 1 to 2 times the measured class average and has no basis where the bound comes from one unrelated class (hypomagnesemia 21.6% is patiromer's own rate over 4 weeks; patiromer binds magnesium). My draft-1 reason ("guidelines support diuretics") used a guideline as an input and is withdrawn. Effect is small: 11 of 1,032 first options whether the rows are halved or dropped. The hypertension engine has the same open decision, so it is one ruling for both.

## 5. Precision weighting -> keep, centred on no effect, no exception; change to a separate prior for death and for hospitalization (0.030 and 0.094 instead of one 0.0596); mark rows whose used value is mostly prior
- Changed from draft 1 (one prior).
- Why: effects on admission are visibly larger and more variable than effects on death (root-mean-square 0.30 against 0.17), so one prior over-shrinks admission effects and under-shrinks death effects. 19 of 337 first options change. Congested loop diuretic: published 0.24 / 0.07; used now 0.83 / 0.86; with separate priors 0.90 / 0.80.
- The whole method matters a great deal: with weighting off 159 first options change and 0 of 7 guideline targets are met; doubling or halving the prior changes 55 and 173.
- OVERRULED: the statistics reviewer preferred a regression on outcome and EF band (residual prior 0.0074). Not adopted: it centres an imprecise row on the typical effect of drugs that succeeded (it moves the neutral ACE-inhibitor preserved-EF death row from 1.04 to 0.98 or 0.90), and "less certain means closer to no effect" is explainable to a clinician while a regression prior is not (P4).
- The owner's Cochrane ruling: he should see published 0.24 / 0.07 against the used values and say whether that is what he meant.
- Not resolved: harms are not shrunk at all. For precisely measured harms the effect is small (about 5%), but the conservative choices stack on one side (benefits shrunk, harms at face value, worst case for unknown patient values, bound rows, laboratory-threshold harms). Recorded as a new open decision.

## 6. New classes per visit -> keep the default at 2; do not count IV iron or a potassium binder; fix the option generator
- Changed from draft 1 (raise to 3).
- Why: the engine no longer projects blood pressure, potassium or heart rate for a combination (risk screen basis is observed state only), so my claim that separate projected gates cover the risk was false; the limit is the only control on cumulative load. STRONG-HF enrolled patients just hospitalized, required systolic pressure at least 100, heart rate at least 60 and potassium 5.0 or less, most were already on partial doses, titration was conditional on four monitored visits, and adverse events were 41% against 29%. It does not test three new classes in an unmonitored outpatient. Raising the default changes 147 of 1,032 first options. The clinician can still set 3.
- IV iron and binders do not share the risk the limit guards; exempting them changes 2 first options (IV iron added as an extra item).
- Defect found, not a policy: the generator builds "one switch plus one addition" using only the first missing pillar, so "switch to sacubitril/valsartan + MRA + SGLT2 inhibitor" is never generated in 18 of the 20 runs where it would be allowed under the limit of 2 (a same-group switch counts as 0 new classes). Fix the generator.

## 7. Finerenone at LVEF 41 to 49 -> keep displayed; keep the three guideline targets counted as not reproduced, annotated "evidence and label support; guideline does not list"
- Facts verified: FINEARTS-HF enrolled LVEF 40% or above (rate ratio 0.84, 0.74 to 0.95; cardiovascular death 0.93, 0.78 to 1.11); the FDA indication is heart failure with LVEF 40% or above. Hiding it changes 3 first options and would meet 6 of 7 targets, which is exactly the tuning P3 forbids.

## 8. KCCQ anchor -> keep 20 points; record two untested assumptions
- The clamp never binds (largest sum among first options 11.9 points). Untested: that KCCQ gains add across four classes (each trial measured its increment on its own background, and KCCQ has a ceiling); that symptom-type side effects are not charged twice (once in the harm table, once inside the net KCCQ change). The exchange rate against death is settled under item 2.

## 9. Low-dose credit -> keep 0.364 as the default; make credit never less than the fraction of the trial dose taken; pool the four measured values by precision
- Changed from draft 1 (MOCHA dropped: about 3, 3 and 1 deaths per arm; uninformative).
- Why the floor: the curve is anchored on the label starting dose, so spironolactone 25 mg earns 0.364 although the RALES dose was 26 mg, and jumps to 1 one milligram later. If dose-response is concave (more benefit per milligram at low doses), credit is at least dose divided by trial dose. With the floor spironolactone 25 mg earns 0.96. Influence of the 0.364 itself is limited (20 to 22 first options across its measured range).

## 10. Fixed safety penalties -> remove the four recorded-value band penalties from the score and keep them as alerts worded "outside the range the trials studied"; keep the per-option warning penalty as labelled safety policy; add measured modifiers to the harm table where they exist
- Changed from draft 1 ("keep as guardrails").
- Why: the low blood pressure, slow heart rate and high potassium bands key on recorded values, so they lower every option equally and cannot change the order (0 of 337 first options and 0 top-three sets change when removed). They are not guardrails. The real protections are the hard gates and the per-option warning penalty (8 points per dangerous warning, which does differ between options).
- Measured modifier that exists: symptomatic hypotension on sacubitril/valsartan against enalapril by baseline systolic pressure (PARADIGM-HF: 25.5% against 13.7% below 110; 14.4 against 10.7; 11.4 against 8.5; 9.0 against 6.7; 8.0 against 4.2 at 140 or above). Because burden is an ABSOLUTE excess, the excess below 110 (11.8 points) against about 3 elsewhere is a usable multiplier.
- OVERRULED: the clinical reviewer said a multiplier by systolic pressure would double count because the relative risk is constant. It does not: the harm table charges absolute excess, and a constant relative risk on a higher background rate is a larger absolute excess. DAPA-HF shows a flat excess of about 1 point at every pressure, so SGLT2 inhibitors need no modifier.
- No usable hyperkalemia multiplier by kidney function was retrievable; that stays open.

## 11. Bonus for replacing a contraindicated drug -> delete the number; add no new rule
- Changed from draft 1 (eligibility rule).
- Why: forced switches and removals are already built into every option. The bonus lands on every displayed option in the 18 runs where it applies, so it never ranks one above another: at 0, no first option, displayed set or displayed order changes in any of 1,032 runs. A new rule would cut across deliberate exceptions (a beta-blocker continued despite reported intolerance; a drug kept when the contraindication rests only on a blank kidney value).

## 12. Beta-blockers in atrial fibrillation -> add a rhythm condition (current rhythm atrial fibrillation, not history); value = the overall beta-blocker effect plus the measured difference for atrial fibrillation, with that difference precision-weighted like every other estimate (about 0.91 for death, against 0.73 in sinus rhythm); hospitalization by rhythm stays as it is until a readable figure is found; never shown as a reason to stop
- Changed from draft 1 (which used the subgroup's own 0.97).
- Facts verified: Kotecha 2014, 10 trials, 18,254 patients, 3,066 in atrial fibrillation; death hazard ratio 0.73 (0.67 to 0.80) in sinus rhythm, 0.97 (0.83 to 1.14) in atrial fibrillation, interaction p = 0.002.
- Why: a subgroup estimate should be pulled toward the overall effect of the same drug, not toward no effect. Interaction = ln(0.97/0.73) = 0.284, standard error 0.093. Applying the engine's own precision rule to the interaction with the death prior 0.030 gives weight 0.78, shrunk interaction 0.22, value 0.91.
- OVERRULED: the statistics reviewer used a tighter prior for interactions (standard deviation 0.05 to 0.10, giving 0.79 to 0.85). Not adopted: that prior is a new hand-set number; the engine's own prior adds none.
- Unverified and left open: the CIBIS-II admission figure 0.64 (found only in secondary sources; crude counts 159 against 232) and any hospitalization figure by rhythm (Cleland 2018 reports cardiovascular, not heart failure, hospitalization). The owner has journal access: Kotecha 2014 full text and the CIBIS-II paper would settle both.

## 13. Extrapolated rows -> no invented extra uncertainty; rows carried from reduced to mildly reduced EF stay as they are; rows carried from reduced to PRESERVED EF are scaled by the measured ratio (about 0.46 of the log effect); indirect comparisons already carry both trials' uncertainty
- Changed from draft 1 (measured widening plus additive attenuation).
- Why: the extra variance cannot be estimated (Q = 11.5 on 12 degrees of freedom across 13 pairs in 6 classes, excess about 0). Any invented number would drive the ranking: +0.02 changes 85 first options and +0.05 changes 295. An additive attenuation turns a weak benefit into harm; the pairs fit a proportional model (higher-band log effect about 0.46 of the reduced-band one).
- The 34 extrapolated rows are of three kinds: indirect comparisons (sacubitril/valsartan against placebo through enalapril: the interval is already the product of both trials); reduced carried unchanged to LVEF 41 to 49 (most rows; the few classes measured in both, beta-blockers and candesartan, show similar effects there); reduced carried to preserved (IV iron) or the reverse (GLP-1).
- Uncertain: whether 0.46 is the right ratio for reduced to preserved specifically (the pairs mix mildly reduced and preserved). Round 2 should compute it separately.

## 14. Weak rows
- a. Thiazide-type creatinine rise (CLOROTIC, 72 hours, inpatients on IV furosemide, 46.5% against 17.2%): CHANGE. Charge it only when a thiazide-type drug is taken WITH a loop diuretic, labelled extrapolated and mild; for a thiazide-type drug without a loop use the hypertension engine's row for the same drug. The engine has no "loop on board" condition today, so the row is charged to every thiazide user.
- b. Dapagliflozin genital infection in women: KEEP (draft-1 change withdrawn). The row already uses the 24-week pool as observed, not annualized (label: women 6.9% against 1.5%, men 2.7% against 0.3%). The EMPEROR figure I recalled could not be verified.
- c. ARB health-status direction: set to "not measured" until a source that states it is read. All three reviewers agree.
- d. GLP-1 in reduced EF: CHANGE. Pool only the reduced-EF populations (the SELECT reduced-EF subgroup, FIGHT, LIVE) with a random-effects interval because they point opposite ways; after precision weighting this is close to neutral. General rule: fixed-effect pooling unless the sources disagree, then random effects. Affects continuation only (starts need LVEF above 40).
- e. IV iron hypophosphatemia: CHANGE (draft 1 kept it). The 66% row is from iron-deficiency anemia patients on 750 mg twice in a week. The pooled heart failure analysis gives 8.1% moderate or severe, under 0.1% severe, no excess of clinical events. By the table's own first preference (measured in heart failure) the heart failure figure wins: about 4 burden points instead of 33.

## 15. SOLVD dose -> keep the dose among patients still taking the drug (16.6 mg); correct the reasoning
- "Conservative" was the wrong word. If the patients who stopped got no benefit, the effect in those who continued is about 1.48 times the intention-to-treat effect (0.80 becomes 0.72), so pairing the intention-to-treat figure with the on-treatment dose understates the value of a drug the patient is reliably taking. It is still the consistent convention (the patient "on enalapril" is by definition still taking it; no trial reports an adherence-adjusted effect), and the understatement applies to every drug alike. State the convention and that trials differ in how they report achieved dose.

## 16. Baseline risk -> yes, but after the clinician case review, not next; not shown as a patient-level prediction before validation; choose the model in an evidence round
- Changed from draft 1 ("build it next" with MAGGIC).
- Why: MAGGIC predicts death only, has no MRA, sacubitril/valsartan, SGLT2 inhibitor or natriuretic peptide terms, comes from older cohorts, and needs two inputs the tool does not collect (smoking, time since diagnosis). It no longer unlocks the weights (item 2). Its real use is letting harm, cost and benefit trade off on absolute rates per patient. Formulation when built: set the risk model's treatment terms to the reference state and multiply by the engine's own relative risks, then check calibration against recent trial control arms. The hypertension engine has no baseline model to match, so it is a joint design.

## Sub-items under the owner's diuretic ruling
- Loop diuretic earns full credit at any dose: KEEP (all three reviewers).
- Neutral without congestion: KEEP the label "assumed neutral". ReBIC-1 is NOT cited as support (need to restart 24.7% against 16.3%, odds ratio 1.69, 0.82 to 3.49: not significant but leaning toward continuation).

## New decisions and defects found by the reviews (not among the 16)
Defects (fix, no owner decision needed):
- D-a. Option generator never builds "switch + two additions" (item 6).
- D-b. Dose credit 0.364 at spironolactone 25 mg when the trial dose was 26 mg (item 9).
- D-c. Credit 1 for a start whose highest allowed dose is below the trial dose (item 1).
- D-d. data/harmDefinitions.json still describes the side-effect score with divisor 1.
- D-e. The prior calculation treats two different trials with identical numbers as one row (vericiguat death and ARB preserved hospitalization).
Decisions:
- N-1. The same drug carries different side-effect burdens in the two engines (torsemide 5.2 hypertension against 36.8 heart failure; chlorthalidone 14.9 against 38.1; losartan 1.5 against 12.5). One shared harm table is needed before the engines can merge.
- N-2. Whether a loop diuretic is a ranked competitor to the outcome drugs or a separate "congestion" slot.
- N-3. One policy for uncertainty on both sides (benefits are shrunk; harms, bounds and unknown patient values are not).
- N-4. Expected achievable dose given the patient's blood pressure and heart rate; behaviour outside the range the trials enrolled.
- N-5. Guideline-order mechanisms still in the engine: the "prioritize foundational therapy" mode, the congestion display rule, the volume-depletion adjustment.
- N-6. Freeze the rule set before the clinician case review.
