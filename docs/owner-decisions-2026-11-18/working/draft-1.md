# Draft answers to the 16 open owner decisions (HeartFailurePath, rule set 2026-11-16.1)

Author: the controller (Claude). Status: DRAFT 1, to be attacked. Nothing here is implemented.

## The owner's principles (the yardstick; quote, do not reinterpret)

- P1. "every clinical choice needs to be based on a 'first principles' model which can be combined with the other models" (the other models: hypertension, diabetes, lipids; one cardiometabolic tool later).
- P2. Evidence philosophy: everything evidence based; extrapolate from first principles, labelled, where no direct evidence; use best estimates and decide under uncertainty; no all-or-nothing significance cliffs.
- P3. "I want the ultimate outcomes to reproduce the guidelines but from first principles rather than a flowsheet. This will lead to greater flexibility for unusual situations." Guidelines are a validation target, never an input. Tuning a number so that the guideline is reproduced is using the guideline as an input.
- P4. Must appreciate cost, adherence and side effects; understandable on the surface.
- P5. Outcome benefit should be expressible per outcome in a common currency (relative risk per outcome, convertible to events prevented) so engines can be added together; side effects, cost and dosing burden are regimen-wide.
- Safety context: the tool is not validated on real patients; the next step is a clinician case review, then a silent-mode study.

## Facts about the current engine that the answers rely on (verify in the repo)

- Outcome score per outcome = 100 x (1 - combined relative risk). Ranking weights: death 0.30, HF hospitalization 0.22, symptoms 0.10, side effects 0.14, cost 0.14, dosing burden 0.10.
- Symptom score = 100 x (sum of KCCQ points) / 20, clamped. Side-effect score = max(0, 100 - burden/2); burden = sum of one-year excess % x severity weight (0.5 mild, 1 moderate, 3 serious).
- Implied exchange rates: 1 death-score point = 0.30 ranking points; 1 burden point = 0.07; 1 KCCQ point = 0.50.
- `planCreditsFor` (services/engine/doseCredit.ts): started today in a new class = credit 1; increased today = credit 1; unchanged or reduced = credit by dose (0.364 at the label start dose, 1 at the trial-achieved dose, linear between); loop diuretic = 1 at any dose. There is no cap at the highest dose the patient is allowed.
- `max_new_classes_per_visit` is a patient-level input, default 2 (types.ts); it counts rescue additions (potassium binder, IV iron).
- Precision weighting: x_used = B x, B = tau2/(tau2+se2), tau2 = 0.0596 (outcomes, DerSimonian-Laird centred on no effect), 12.559 (symptoms).

## The answers

### 1. New starts and increases valued as titrated -> KEEP, with one correction
Three candidate rules: (a) current: start = 1, increase = 1, held = by dose; (b) everything by today's dose; (c) start = 1, increase = by the new dose.
Reasoning:
- A trial relative risk is the intention-to-treat effect of the policy "start low and titrate as tolerated", including patients who never reached target. A start today is the first step of that policy, so the trial figure is the right value for it. ATLAS and HEAAL are the intention-to-treat trials of the policy "titrate up" versus "stay low", so an increase is the first step of that policy and earns the measured gap. A held sub-target drug is the "stay low" arm. So (a) values each action by the trial of the policy it begins. (c) treats a start as a commitment and an increase as not one, which is inconsistent.
- (b) cannot be made consistent with the harm table: benefit would be scaled to 36% at a start dose while harm, measured at trial doses with mostly no dose relation, is charged in full. That asymmetry was the defect that made dose form decide leads earlier in this round.
- Scheduling check: with a limit on changes per visit, the right ordering index for a chain of steps is the best average gain per step over the remaining chain. For a start that is about 0.36 B (the first step is the largest); for a drug sitting at its start dose it is about 0.21 B (three doubling steps sharing 0.64 B). Ratio start:increase about 1.7. Rule (a) gives 1 : 0.64 = 1.56; (b) gives 3.3; (c) gives 9. (a) is the closest to the correct ordering and is the only one that also answers "is this drug worth having at all" with full benefit against full harm and cost.
- Correction: credit 1 should not be granted when this patient cannot reach the trial dose. If a renal or other cap holds the maximum allowed dose below the trial-achieved dose, a start or increase should earn the credit of the highest allowed dose, not 1. The trials excluded most such patients, so the intention-to-treat argument does not cover them.
Falsifiable claims to attack: that ATLAS/HEAAL justify full-gap credit for a single one-step increase; that the scheduling index is the right criterion; that the cap at the allowed maximum is not already applied.

### 2. The six weights and three profiles -> KEEP as interim policy; derive the four clinical weights when baseline risk exists (item 16)
- No number here is measured. The only first-principles derivation is to put death, hospitalization, symptoms and side effects on one utility scale, which needs absolute risk (item 16). After that only cost and dosing burden remain as preference weights, which is what the care-priority profiles are for.
- Rough utility check of the current numbers at 10% annual mortality: one KCCQ point is worth about one death-score point (the engine uses 1.67); hospitalization is weighted far above its direct utility loss (22 against 30 for death), which matches how trials treat first hospitalization as equal to cardiovascular death in the primary composite; side effects are weighted perhaps 3 to 10 times above their utility loss (one death = 14 serious or 43 moderate adverse events at 10% annual mortality).
- The weights must not be tuned to raise guideline concordance (P3).
- The profiles already move few first options (9, 35 and 0 of 337), so the ranking is not very sensitive to the exact numbers. To be measured: halve and double each weight in turn and count first-option changes.
Falsifiable claims: that a utility scale is the only principled derivation; that side effects are overweighted and by how much; that no interim change is justified.

### 3. Side-effect scale -> KEEP the severity weights (shared scale); KEEP the divisor of 2 until item 16 replaces it
- The 0.5 / 1 / 3 weights are the same as the hypertension engine. A different scale in one engine breaks P1/P5. Any change must be made in both, so it is a cross-engine decision, not a heart failure one.
- The divisor exists only because the score is clamped at 0 and a heart failure regimen carries more drugs than a hypertension one. It is a rescale, equivalent to halving the weight. It should disappear when harm and benefit are both absolute annual rates (item 16).
- To be measured: does the clamp at 0 still bind for any candidate with divisor 2; what is the largest burden among candidates.

### 4. Ten upper-bound harm rows -> CHANGE: charge an expected value, not a worst case
- P2 says best estimate under uncertainty. An upper bound is not a best estimate. The rule "an unknown must not make a drug look safer" was adopted for missing PATIENT values (sex, age), where the conservative assumption protects a patient. For an unmeasured DRUG harm the conservative assumption has a clinical cost: it makes loop and thiazide diuretics look harmful (about 11 points each from hypomagnesemia alone) in exactly the congested patients where the evidence and the guidelines support them.
- Rule proposed: (1) where any controlled or observational estimate exists for that drug or a sibling class, use it, labelled extrapolated, with its interval; (2) where only a bound exists, charge half the bound (the mean of a uniform prior between zero and the bound), labelled "bounded, not measured"; (3) never zero for a harm that the drug's pharmacology predicts.
- The ten rows: ACEi/ARB/ARNI renal serious adverse event 1.393; beta-blocker AV block 0.261; vasodilator syncope 3.0; loop and thiazide hypomagnesemia 21.6; loop and thiazide hypotension 5.0; Furoscix injection site 6.0.
Falsifiable claims: that half the bound is a defensible expectation; that a worst case is not required for safety before validation; that better sources exist for these ten.

### 5. Precision weighting -> KEEP, centred on no effect, no per-row exception
- Shrinking each estimate toward no effect in proportion to its imprecision is the posterior mean under a sceptical prior. It is the "best estimate" P2 asks for and it removes the cliff between "significant" and "not". It is what makes it possible to use the Cochrane diuretic figures (0.24 and 0.07 from about 200 patients) without letting them dominate.
- Centre: no effect, not the average effect of the table. The table is a selected set of drugs that succeeded; centring on their mean would credit any new imprecise row with a typical proven-drug effect.
- The owner's ruling "use the Cochrane diuretic figures for congested patients" is read as: use them as the evidence, through the same rule as every other row (used values about 0.83 and 0.86). At face value a diuretic alone would lead in congested patients, on 3 trials and 202 patients.
Falsifiable claims: that one tau2 across drug classes is acceptable; that the null centre is right; that the reading of the owner's ruling is right.

### 6. Two new classes per visit -> CHANGE the default to 3, and do not count potassium binders or IV iron
- No trial measured 2 against 3 changes per outpatient visit. The limit is policy. The measured evidence on speed is STRONG-HF: starting and up-titrating a RAAS inhibitor, a beta-blocker and an MRA together within two weeks, with visits and laboratory checks at 1, 2, 3 and 6 weeks, reduced 180-day death or heart failure readmission. That supports three interacting classes at once under close follow-up. SGLT2 inhibitors have little effect on blood pressure or potassium.
- The engine already has separate gates for projected blood pressure, potassium, heart rate and kidney function, and a laboratory prerequisite. The class limit is a second, blunter gate on the same risk.
- A potassium binder or IV iron does not share the blood pressure / potassium / kidney risk that the limit protects against; counting them can block a pillar.
- It remains a clinician-settable input. A reason to keep 2 until the case review: the blood pressure and potassium bands are fixed policy numbers, not measured (item 10).
Falsifiable claims: the STRONG-HF description; that raising the default is safe before validation; that rescue drugs should not count. To be measured: first-option changes and guideline concordance with 3 and with 4.

### 7. Finerenone at LVEF 41 to 49 -> KEEP displayed; record the three guideline targets as documented divergences, not misses
- FINEARTS-HF enrolled LVEF 40% and above and met its primary endpoint; the FDA label for finerenone now includes heart failure with LVEF 40% or above. Under P3 the evidence governs and the guideline is the comparison. Hiding it because a guideline has not listed it would be the flowsheet behaviour the owner rejected.
Falsifiable claims: the trial entry criterion and result; the label indication; what the 2026 ESC guideline says for this range.

### 8. KCCQ anchor (20 points = full score; effects add across drugs) -> KEEP
- 20 points is the published "large" change (Spertus 2005). The anchor only sets the exchange rate (1 KCCQ point = 0.5 ranking points = 1.67 death-score points). The utility check in item 2 puts 1 KCCQ point near 1 death-score point at 10% annual mortality, so the current rate is within a factor of two.
- Adding across drugs: each trial measured its drug on top of background therapy that included the others, so increments on top of each other are what was measured. Typical placebo-corrected effects are 1 to 8 points, so a full regimen stays under the 20-point clamp.

### 9. Low-dose credit 0.364 -> KEEP as the default, labelled extrapolated outside RAAS inhibitors; add the beta-blocker dose-ranging trial as a measured check
- It is measured for ACE inhibitors and ARBs (ATLAS, HEAAL; four values 0.206 to 0.565). MOCHA randomized carvedilol 6.25, 12.5 and 25 mg twice daily against placebo; my recollection of 6-month mortality is placebo 15.5%, 6.0%, 6.7%, 1.1%, which gives a low-dose credit near 0.35 (very imprecise). If that is confirmed it corroborates the default for beta-blockers.
- With item 1 as answered, the number only affects drugs held below their trial dose, so its influence is limited.
Falsifiable claims: the MOCHA numbers; that an unweighted mean of four values is acceptable.

### 10. Fixed safety penalties -> KEEP as labelled safety policy until each is replaced by a measured modifier; search again, by name
- They are guardrails. Removing them before a measured model exists would let an option that projects to a systolic pressure under 90 rank first.
- I believe the measured modifiers exist and the first search missed them: hypotension by baseline systolic pressure (PARADIGM-HF by systolic pressure, Bohm 2017; DAPA-HF by systolic pressure, Serenelli 2020; COPERNICUS by systolic pressure, Rouleau 2004) and hyperkalemia by eGFR and baseline potassium (RALES, Vardeny 2014; EMPHASIS-HF high-risk subgroups, Eschalier 2013; TOPCAT). Decision: commission a targeted search for these papers; replace each fixed penalty when a verified row exists.
Falsifiable claims: that these papers exist and report rates by subgroup usable as multipliers.

### 11. Bonus (+15) for replacing a contraindicated drug -> CHANGE: make it an eligibility rule and delete the number
- If a drug is contraindicated or documented as not tolerated, an option that keeps it should not be displayed at all. Then nothing competes with the switch and no bonus is needed; the replacement is valued by its own measured benefit and harm like any start.
- To be measured: with the bonus set to 0, what happens in the 17 displayed options that carry it; does any first option then keep the contraindicated drug.

### 12. Beta-blockers in atrial fibrillation; unconfirmed hospitalization figure -> CHANGE both
- Randomized individual-patient evidence exists: Kotecha 2014 (Lancet), 10 trials. My recollection: in sinus rhythm death hazard ratio 0.73 (0.67 to 0.80); in atrial fibrillation 0.97 (0.83 to 1.14); interaction significant. Decision: add a rhythm condition, the same mechanism as the congestion condition for loop diuretics. In atrial fibrillation the beta-blocker rows use the atrial fibrillation figures (after precision weighting, close to neutral for death); rate control remains a separate, non-outcome reason shown as text.
- The hospitalization figure should come from a source that can be read. Replace the single-trial CIBIS-II figure with the pooled individual-patient analysis (Kotecha 2014 or Cleland 2018, which is open access), by rhythm and EF band.
Falsifiable claims: the Kotecha numbers; that a hospitalization figure by rhythm is reported.

### 13. Intervals of extrapolated rows -> CHANGE: widen by a measured cross-population variance
- An extrapolated row is less certain than its source. Using the source interval unchanged overstates precision and, under precision weighting, gives it full credit.
- Rule proposed: for a row extrapolated across EF bands or populations, se_used2 = se2 + d2, where d2 is estimated from the classes that WERE measured in two bands (SGLT2 inhibitors, sacubitril/valsartan, MRAs, candesartan): the variance of the difference in log relative risk between bands beyond sampling error. Those pairs also show a systematic weakening at higher EF (for example death about 0.87 against 1.0, 0.84 against 0.97, 0.70 against 0.91), so the mean difference should be applied as an attenuation, not only as extra variance.
- A row borrowed from a sibling drug in the same class is not widened (class effect, labelled).
Falsifiable claims: that the pairs support both an attenuation and a variance; that sibling rows need none.

### 14. Weak extrapolated rows, one by one
- a. Thiazide-type creatinine rise (29.3%, 72-hour inpatient trial): KEEP for a thiazide-type drug added to a loop diuretic (the population it was measured in), labelled extrapolated, mild severity. It is the only controlled figure for sequential nephron blockade.
- b. Dapagliflozin genital infection in women (0.4-year pool): CHANGE. Use a heart failure trial's placebo-controlled class figure (I recall EMPEROR-Reduced 1.7% against 0.6%) as the base rate and apply the sex ratio from the label pool as a labelled multiplier. Do not annualize a 24-week pool; these events are front-loaded.
- c. ARB health-status direction (abstract does not state it): CHANGE to "not measured" until a source that states the result is read. No unverified sign in the table.
- d. GLP-1 in reduced EF (death 0.83, hospitalization 1.06, SELECT pooled with FIGHT and LIVE): KEEP. It pools all the randomized evidence, in both directions, and precision weighting handles the imprecision.
- e. IV iron hypophosphatemia (66% laboratory nadir, 33 burden points): KEEP the row but note it is the clearest case where the scale's "laboratory threshold beats reported event" ruling overstates clinical harm; raise it as a cross-engine scale question rather than changing one row.

### 15. SOLVD dose denominator -> KEEP the on-treatment dose (16.6 mg)
- The patient in front of the tool who is "on enalapril" is by definition still taking it, so the dose among patients still taking it is the matching anchor. Nobody in the trial was assigned 11.2 mg. A patient taking 16.6 mg gets at least the intention-to-treat relative risk (which is diluted by the 32.5% who stopped), so pairing the intention-to-treat relative risk with the on-treatment dose is conservative. The same convention must be used for every trial.

### 16. Baseline risk -> YES, build it next
- It is the piece that turns relative effects into events prevented (P5), makes the four clinical weights derivable (item 2), and lets harm and benefit be compared on one absolute scale (item 3).
- Proposed: the MAGGIC score for death (published integer score from individual-patient data; inputs the tool already collects). Use it for the patient AS OBSERVED on the current regimen, then risk under an option = observed risk x RR(option) / RR(current). No untreated state is reconstructed, which keeps the existing contract. For hospitalization, use event-rate ratios from the control arms of the trials in the table, labelled extrapolated, until a validated model is chosen.
Falsifiable claims: that MAGGIC's inputs are available; that the ratio method is sound when MAGGIC already includes beta-blocker and ACE inhibitor use as predictors (double counting?).

### Two sub-items left open under the owner's diuretic ruling
- Loop diuretic earns full credit at any dose: KEEP. The Cochrane figure is diuretic against none; no randomized evidence relates chronic loop dose to death or hospitalization.
- Loop diuretics neutral without congestion: KEEP, and cite the furosemide withdrawal trial in stable outpatients (ReBIC-1, as I recall no difference in symptoms or need to restart) as randomized support for neutrality instead of "assumed".
