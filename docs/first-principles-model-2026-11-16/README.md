# First-principles scoring model, 2026-11-16

Record of the work for the next person. It states what the model measures, what it extrapolates and what is engine policy, where every number lives, every ruling made on the way, the weakest rows and the decisions that belong to the owner. Everything here was read from the code and data files as they stood at the final pass on 2026-11-16 (local, uncommitted, undeployed; rule set `2026-11-16.1`). Nothing here is clinical validation: the checks that were run are engineering checks on synthetic cases (listed at the end).

> **Superseded in part on 2026-11-18 (rule set 2026-11-18.1).** The owner instructed "implement the recommended changes and run them as one package". What changed, with measured results and the review record, is in `docs/owner-decisions-2026-11-18/README.md`, section "Package as implemented". It supersedes these statements below: a dose increase earns credit 1 (it now earns the credit at the dose reached, and a start is capped at the best dose the patient may be given); credit is 0.364 at the label starting dose for every drug (a drug with its own trial dose never earns less than its fraction of that dose); one prior of 0.0596 for outcomes (now 0.0288 for death and 0.0935 for hospitalization); one beta-blocker death row regardless of rhythm (now by current rhythm); ten upper-bound harm rows (seven are class averages, two are not measured, one remains); the IV iron hypophosphatemia row of 66.35 (now 7.48); 108 outcome rows (now 111); the results in section 11 (see the new record). Section 10's open decisions are answered, as recommendations, in the same record.

## 1. The owner's instructions

The owner, a physician, ruled on 2026-11-15 and 2026-11-16:

1. "bring outcome estimates back as trial relative risks"
2. "every clinical choice needs to be based on a 'first principles' model which can be combined with the other models"
3. "build the side effect model from measured harm rates. Ultimately, I want the ultimate outcomes to reproduce the guidelines but from first principles rather than a flowsheet."
4. "use the Cochrane diuretic figures for congested patients" (2026-11-16, ruling on section 10 item 5).

These four are the only rulings the owner made in this round. Every other ruling in this record was made by the controller (Claude) while building the model and is open to the owner's review (sections 6 and 10).

Consequences built from these: guideline recommendations are a target the model is measured against, not an input (section 8); every number that moves a rank sits in a data table with a source, or is named as engine policy; the harm scale is the same one the hypertension engine uses (`data/harmDefinitions.json`, method.scale) so the engines can later be merged.

## 2. The model in one page

An option is a proposed regimen (a set of add, increase, decrease, swap, remove, keep changes). Each option gets six factor scores, each 0 to 100, and a weighted sum.

| Factor | What it measures | Basis of the input |
|---|---|---|
| Death from any cause | Percent relative risk reduction for the whole regimen, versus no disease-modifying therapy | Relative risks from randomized trials (`data/outcomeEvidence.json`) |
| Heart-failure hospitalization | Same, for hospitalization | Same table |
| Symptoms | Expected change in KCCQ points, placebo-subtracted | Trials (`data/symptomEvidence.json`) |
| Side effects | One-year excess harm rates x severity weight, summed over the regimen | Trials and labels (`data/harmEvidence.json`, `data/harmDefinitions.json`) |
| Cost | Monthly out-of-pocket cost against the patient's budget | Price table (`services/pricingService.ts`); unchanged |
| Dosing burden | Regimen complexity against the patient's tolerance | Schedule proxy (`calculateAdherenceScore`); unchanged |

Weights (engine policy, pending the owner's review): death 0.30, hospitalization 0.22, symptoms 0.10, side effects 0.14, cost 0.14, dosing burden 0.10 (sum 1.00).

Guideline concordance and therapy completeness are still computed and shown, reference only, weight 0. The four older physiological domains (neurohormonal, functional, volume, structure) stay "not assessed", weight 0. Recorded measurements are never altered or projected.

### Formulas in plain words

- Each drug in the option has one evidence row for the patient's EF band (reduced: LVEF 40 or below, or improved EF; mildly reduced: 41 to 49; preserved: otherwise).
- The published relative risk is pulled toward "no effect" in proportion to how imprecise it is (precision weighting, section 5). The pulled value is the value used.
- The drug's effect is scaled by a dose credit between 0 and 1: full credit at the dose the trials achieved, less below it (section 5).
- Drugs in the same mechanism group are not stacked: only the one with the larger effect counts.
- The regimen's expected relative risk is the product of the counted drugs' dose-adjusted relative risks (the effects add on the log scale). The death or hospitalization score is 100 x (1 - that risk), floored at 0 and capped at 100. No regimen removes all risk, so 100 is not reachable.
- Symptoms: add the credit-weighted KCCQ points of the counted drugs (an assumption: trials did not measure the combinations), divide by 20, times 100, capped 0 to 100. A class with no measurement counts 0 and is labeled "not measured".
- Side effects: for each drug, each harm row's one-year excess percent (interpolated by daily dose where a dose relation was measured, multiplied by any patient-specific multiplier that applies, floored at 0) times its severity weight; plus one symptom line per drug (the combined percent of patients with drug-attributable symptoms, weight 1). The regimen's burden is the sum. Score = max(0, 100 - burden / 2). A patient value that is not recorded never makes an option look safer: a harm measured in one sex only is charged as the higher-risk case when sex is not recorded, and a risk multiplier whose condition cannot be evaluated is applied when its ratio is above 1 (not applied when it lowers risk). Each affected line carries `assumed_because_unknown` and the output lists the assumptions in words (`unknown_assumptions`, for example "race not recorded: charged as the higher-risk case (multiplier applied)").

### Formulas in symbols

- Evidence row i: published relative risk r_i, 95% interval (lo_i, hi_i). se_i = (ln hi_i - ln lo_i) / 3.92. B_i = tau2 / (tau2 + se_i^2). Used log risk = B_i x ln r_i. (Symptoms: x_used = B x KCCQ points, se in points.)
- Credit c_i in [0,1]. Counted drug per mechanism group g.
- ln RR_regimen = sum over groups of c_i x ln r_used,i. Score_outcome = clamp(100 x (1 - RR_regimen), 0, 100).
- Interval: the log scale, independent estimates assumed: var = sum (c_i x se_used,i)^2, bounds = exp(ln RR -/+ 1.96 sqrt(var)). Rows with no interval understate the uncertainty and are listed.
- Symptoms: points = sum c_i x kccq_used,i; Score_symptoms = clamp(100 x points / 20, 0, 100).
- Harm: burden = sum over harm lines of max(0, rate_adj) x w_severity + sum over drugs of symptom_figure x 1, where symptom_figure = 100 x (1 - product(1 - max(0, x_k) / 100)); Score_side = max(0, 100 - burden / 2).
- Raw score = sum over factors of weight x score, plus the named adjustments of section 7. The displayed score is the raw score clamped to 0 to 100 and rounded (capped at 25 in low output). Ranking: displayed score, raw score, cost, fewer changes, regimen key. Therapy completeness is no longer a ranking step (`services/engine/selection.ts`, comment on the comparator).
- Missing budget removes the cost factor and rescales the remaining weights to sum to 1; an unknown NT-proBNP does the same for its (zero-weight) factor. Scores across different input completeness are not directly comparable.

### What is measured, extrapolated, policy

- Measured: the trial relative risks and KCCQ changes (where basis is trial or meta_analysis); the harm rates (level drug or class); the trial-achieved doses (anchors with level drug); the low-dose credit for ACE inhibitors and ARBs (ATLAS, HEAAL).
- Extrapolated, labeled in the row: relative risks and KCCQ values carried to an EF band or class the trials did not study; harm rates borrowed from another population, an incidence minus a placebo-arm incidence, a sibling drug or a class ceiling; dose anchors borrowed from a sibling; the 0.364 low-dose credit applied to every class other than ACE inhibitors and ARBs.
- Policy: the six weights and three profile multipliers; the precision-weighting method; the KCCQ scale anchor; the severity weights, the symptom weight and the divisor 2; additivity of KCCQ across drugs; the mechanism-group rule; valuing a new start or increase as titrated; every fixed safety rule (section 7).

## 3. Where each number lives

| Number | File and name |
|---|---|
| Six base weights | `services/engine/scoreModel.ts`, `BASE_WEIGHTS` |
| Profile multipliers (rows are generated, then renormalized to sum to 1) | same, `PROFILE_MULTIPLIERS`, `WEIGHT_PROFILES` |
| Precision-weighting formula text | same, `SHRINKAGE_FORMULA`; method in `services/engine/shrinkage.ts` |
| tau2, outcomes (0.0596 on the log scale; the code gives 0.05961434) and symptoms (12.559 KCCQ points squared; the code gives 12.558685) | computed, never typed: `OUTCOME_TAU2` (`outcomeBenefit.ts`), `SYMPTOM_TAU2` (`symptomBenefit.ts`) |
| KCCQ full-credit points (20) | `scoreModel.ts`, `KCCQ_FULL_CREDIT_POINTS` |
| Side-effect divisor (2) and score | `scoreModel.ts`, `SIDE_EFFECT_BURDEN_DIVISOR`, `sideEffectScore` |
| Severity weights 0.5 / 1 / 3 and symptom weight 1 | `data/harmDefinitions.json`, `method.severityWeights`, `method.symptomWeight` (read by `harmBurden.ts`, never copied) |
| Which severity each harm has (NCI CTCAE v5 grade rule) | `data/harmDefinitions.json`, `effects` (47 effect definitions) |
| Relative risks (death, hospitalization) | `data/outcomeEvidence.json` (a list of rows) |
| KCCQ changes | `data/symptomEvidence.json`, `rows` |
| Harm rates and multipliers | `data/harmEvidence.json`, `rows` and `multipliers` (also `multipliers_not_representable`, `listed_not_scored`) |
| Trial-achieved doses and the low-dose credit c0 = 0.364247 | `data/doseEvidence.json`, `anchors` and `start_dose_credit` |
| Dose credit logic | `services/engine/doseCredit.ts` (`outcomeDoseCredit`, `planCreditsFor`) |
| Outcome arithmetic, interval, evidence-row lookup, EF band, population keys | `services/engine/outcomeBenefit.ts` (`regimenOutcomeEstimate`, `efBandFor`, `populationKeyFor`) |
| Symptom arithmetic | `services/engine/symptomBenefit.ts` |
| Harm arithmetic | `services/engine/harmBurden.ts` (`harmBurdenFor`, `compareHarmBurden`) |
| Wiring into the score | `services/engine/scoring.ts` (domain scores, then `aggregateScore`) |
| Guideline targets and the report | `scripts/guidelineTargets.ts`, `scripts/guidelineReproduction.ts` (`npm run guideline:report`) |

## 4. The evidence pipeline

Each table was built the same way: (1) collected by one researcher from primary sources (abstracts and open full texts; the quote and PubMed id are in each row); (2) every number independently re-read by a second reader (the `verification-*.md` files: confirmed, corrected, not confirmed); (3) resolved by fixed rules stated before the numbers were chosen, never by the result (the rulings of section 6); (4) loaded into `data/`, where the engine reads it and throws on a missing or duplicate row instead of defaulting to zero or 1.0.

Working folders: `docs/outcome-evidence-2026-11-15/`, `docs/symptom-evidence-2026-11-15/`, `docs/harm-evidence-2026-11-15/` (including `merge_harm.py`, which merged the foundational and adjunct tables), `docs/dose-evidence-2026-11-15/`.

### Counts, computed from the data files on 2026-11-16

- Outcomes (`outcomeEvidence.json`): 108 rows = 16 classes by 3 EF bands by 2 outcomes, with the vasodilator split into two populations (self-identified Black patients versus others) and the loop diuretic into two populations (congested versus other). Basis: meta_analysis 35, extrapolated 34, assumed_neutral 27, trial 12. By outcome: death trial 5, meta_analysis 18, extrapolated 17, assumed_neutral 14; hospitalization trial 7, meta_analysis 17, extrapolated 17, assumed_neutral 13. 26 of the 27 assumed-neutral rows have no interval (the exception is the beta-blocker preserved-EF death row, an "envelope" interval 0.65 to 4.10).
- Symptoms (`symptomEvidence.json`): 51 rows = 17 classes by 3 bands. Basis: extrapolated 29, trial 11, not_measured 6, meta_analysis 5. 20 rows have no interval (extrapolated 10, not_measured 6, trial 4).
- Harms (`harmEvidence.json`): 197 rows, 12 multipliers. By level: drug 128, extrapolated 41, siblingProxy 20, class 8. By layer: harmRow 109 (drug 62, extrapolated 28, siblingProxy 15, class 4), symptomFigure 84 (drug 62, extrapolated 13, siblingProxy 5, class 4), crossCheck 4 (not charged). Upper-bound rows: 10 (listed in section 9). Rows with measured dose groups: 5. Multipliers: drug 6, siblingProxy 4, extrapolated 2. Not representable numerically and therefore not used: 16 modifiers (`multipliers_not_representable`). Listed but not scored: 50 entries (`listed_not_scored`).
- Harm definitions (`harmDefinitions.json`): 47 effect definitions = harmRow 28, symptomFigure 17, crossCheck 1, caution 1.
- Dose anchors (`doseEvidence.json`): 31 anchors. Level drug 10, siblingProxy 8, not_measured 13 (the 13 fall back to the engine's own target-dose logic on the same curve; nine of them are drugs with no numeric target, such as the loop diuretics, thiazide-like diuretics, binders and ferric carboxymaltose).

## 5. How the estimates are used

- **Population averages.** Relative risks and KCCQ changes are trial averages. They are not a prediction for this patient, and the patient's response at follow-up overrides them. No baseline risk is modeled, so the model reports relative effects, not events prevented.
- **Precision weighting.** Small or imprecise trials are pulled toward no effect. B = tau2 / (tau2 + se^2): near 1 for a precise row, small for a tiny trial. tau2 comes from the table itself (DerSimonian-Laird moment estimator centred on no effect, weights 1/se^2, trial or meta-analysis rows with an interval, an identical figure counted once). A row with a value but no interval uses the median se of the rows that have one and is flagged. A row with no effect stays at no effect. Each figure shows a published value and a value used. Harm rates are not shrunk.
- **Dose credit.** Full credit (1) at or above the trial-achieved daily dose (`doseEvidence.json`). Between the label starting dose and that anchor: c0 + (1 - c0) x (dose - start) / (anchor - start), c0 = 0.364. Below the starting dose: c0 x dose / start. Measured for ACE inhibitors and ARBs (ATLAS lisinopril, HEAAL losartan; four values of c0 from 0.206 to 0.565, mean 0.364); extrapolated to every other class. Loop diuretics have no measured dose relation (no anchor): they earn credit 1 at any dose, and the score detail says so. An earlier version gave a congested patient's unchanged loop the partial credit c0 ("still congested on the current dose"); that was removed because it had no measured basis. Congestion relief by dose is therefore not modelled: a loop increase earns no extra outcome credit, and keeping a loop in a congested patient scores above removing it (a hard check in `scripts/measuredModelChecks.ts`, run by `npm run verify`). The congestion display rule (`ensureCongestionCoverage`) is what shows the best diuretic intensification.
- **"As planned" versus "at today's doses".** A trial relative risk measures "start the drug and titrate as tolerated". Each option is therefore valued as the plan it starts (`planCreditsFor`): a drug started today in a class the regimen did not contain, or a drug increased today, earns credit 1; a swap within the same class earns the larger of the two drugs' dose credits; a swap to a different class counts as a start; a reduction or an unchanged drug is credited by its dose. Ranking uses the "as planned" value. The "at today's doses" (`as_prescribed`) value and an "at target" value are also computed and shown. Harm is never discounted, so a new start is charged its full harm and credited its titrated benefit.
- **Evidence basis labels** shown with every figure: trial, pooled analysis (`meta_analysis`), extrapolated, borrowed from a sibling (`siblingProxy`), assumed neutral, not measured, upper bound.

## 6. Every ruling

### 6a. Owner rulings, and controller rulings applying them

Correction, 2026-11-16: an earlier version of this section, the evidence rows and several code comments labelled every item below an "owner ruling", and quoted "no input is zero when randomized evidence exists; small trials mean a wide interval, not a zero" as the owner's words. That sentence was written by the controller. The owner's own rulings are the four in section 1. The labels in the data and the code were corrected the same day.

Owner rulings (his words are in section 1):

- 2026-11-15/16: the first-principles side-effect model is built from measured harm rates; guideline reproduction is measured, not enforced.
- 2026-11-16: the Cochrane diuretic figures are used for congested patients (death 0.24, 0.07 to 0.83; hospitalization 0.07, 0.01 to 0.52; odds ratios used as relative risks). The controller had entered them earlier that day; the owner then confirmed them over the alternative (neutral). His ruling does not cover how the figures are precision-weighted (section 10 item 6), the neutral rows for non-congested patients, or the rule that a loop earns full credit at any dose.

Controller rulings (Claude's, made to apply the owner's instructions; not ruled by the owner):

- 2026-11-15: guideline points and pillar counts leave the ranking; guidelines become targets (`scoreModel.ts` comment above `BASE_WEIGHTS`; `scripts/guidelineTargets.ts`; `selection.ts` comparator comment).
- 2026-11-15: every special feature adds 0 points; each carries `replaced_by` naming the model that now holds its benefit or harm (`docs/outcome-evidence-2026-11-15/special-features-inventory.md`). Only the mandatory swap away from a contraindicated or intolerance-documented drug keeps its +15 (forced-change bookkeeping).
- 2026-11-15: one GLP-1 estimate shared by semaglutide and tirzepatide (no head-to-head trial); where several randomized sources bear on one cell, a fixed-effect inverse-variance pool on the log scale; a same-drug, same-band source outranks a sibling drug ("ruling 3").
- 2026-11-15: when a class has no direct randomized evidence, the row is assumed neutral (relative risk 1.0, null interval); pooled LVEF 40-and-above figures are used for both the mildly reduced and preserved bands when no band-specific figure exists.
- 2026-11-16: no input is zero when randomized evidence exists; small trials mean a wide interval, not a zero (the controller's reading of the owner's evidence rule: best estimates carried with their uncertainty). This replaced the neutral rows for the loop diuretic (congested population) by the Cochrane odds ratios, which the owner confirmed later that day (above). The non-congested loop rows and the thiazide-like and potassium-binder rows stay assumed neutral (decisions recorded in the rows' notes; no randomized outcome evidence in those populations).
- 2026-11-16: precision weighting for every row, with no per-row exception (`shrinkage.ts` header). The first, unweighted version of tau2 let two very imprecise rows set the prior for all rows; the weighted form replaced it. No row is excluded; the value without the congested loop rows (`OUTCOME_TAU2_EXCL_CONGESTED_LOOP`) is computed and recorded but not used.
- 2026-11-16: value each option as the plan it starts (`planCreditsFor`).

### 6b. Harm-table rulings (`data/harmDefinitions.json`, `rulings`, verbatim summaries)

Method fixed before any rate was sought: severity by NCI CTCAE v5 grade (mild 0.5, moderate 1, serious 3; policy, identical to the hypertension engine's PathScore policy-v5; no published utility weights were found). Rate preference order, 6 steps: (1) placebo-controlled excess in heart failure, drug or class; (2) a relative risk applied to the placebo-arm incidence; (3) an incidence minus a placebo-arm incidence of the same definition, or an active comparator's placebo-controlled excess plus the measured difference; (4) a placebo-controlled excess in another population; (5) a sibling drug or class; (6) an upper bound, the largest placebo-controlled excess of that harm for any class in the table. Source choice by definition, then heart failure before other populations, then placebo-controlled, then more patients, then longer follow-up up to a year, never by the result. A cumulative incidence over T years is converted to one year by 1 - (1 - p)^(1/T) (constant risk; understates early harm). An excess below zero is charged as 0 and the row keeps the figure.

- R1 (2026-11-15, after the first collection, before any rate entered the engine): added `hypoglycemiaSevere` (serious) and `urinaryTractInfection` (moderate) because collectors found measured rows with no effect id.
- R2: definition match comes first. A laboratory-threshold row beats an investigator-reported event of the same harm; a reported-event row is used only when no laboratory row exists and is marked as probably understating (TOPCAT 18.7% versus 9.1% by laboratory value, 13.1% versus 5.6% as reported).
- R3: an excess counts as placebo-controlled only if both arms were followed over the same window; otherwise step 3, extrapolated.
- R4: at the same step and definition the source with more patients is used, whether pooled class row or single drug; a class row then applies to every drug in the class.
- R5: a drug tested only against an active comparator takes the comparator's placebo-controlled excess of the nearest definition plus the measured difference (flagged if definitions differ); if the comparator has none, step 5.
- R6: an event tied to each administration (infusion reactions) is charged per year at the trial's number of administrations a year. An event concentrated in the first weeks (gastrointestinal symptoms on dose escalation) is charged as observed over the trial, and the row says the rate falls after the first year.
- R7 (at merge): sibling classes are ACE inhibitor and ARB; MRA and non-steroidal MRA; GLP-1 and GLP-1/GIP agonist; loop and thiazide-like diuretic. A sibling class's measured figure is used before a step-6 upper bound.
- R8 (at merge): a step-4 figure measured at doses below the heart-failure range, for a harm the label states is dose-related, does not qualify (the torsemide hypertension figure for loop hypokalemia was below placebo and was replaced by the thiazide-like sibling figure).
- R9 (at merge): every step-6 upper bound is the largest placebo-controlled excess of that harm anywhere in the merged table, recomputed by `merge_harm.py`.

The notes-resolved files (`notes-resolved-foundational.md`, `notes-resolved-adjunct.md`) describe the tables before R7 to R9 were applied at merge: for example they name ARB syncope (3.0 a year) and eplerenone gynecomastia as step-6 rows, which no longer appear among the 10 upper-bound rows in `harmEvidence.json`. The data file is current.

### 6c. Symptom-table rulings (as applied in `docs/symptom-evidence-2026-11-15/notes-resolved.md`; the numbered ruling text itself is not in the repository, only its application)

- R1: instrument order (KCCQ clinical summary score first); MLHFQ results converted through the standardized mean difference and marked extrapolated.
- R4: ARNI is the ACE inhibitor or ARB value plus the increment versus that comparator (the "do not stack" note was overruled).
- R5: a class with no measurement is filled from the nearest band (the preserved side where both neighbours overlap), then a sibling class, then assumed neutral, then not measured (value 0 with the label). Applied literally, so values carry into bands where they are implausible (beta-blocker 6.57 and vasodilator 3.04 into the mildly reduced and preserved bands; GLP-1 7.5 and 6.9 into the reduced band; ACE inhibitor takes the ARB value).
- R6: a published pooled estimate is used in preference to a computed pool (IV iron 4.45 rather than the computed 3.84; SGLT2 inhibitor 2.14 in all three bands).
- KCCQ standard deviations used for conversion: 21.9 (reduced) and 21.2 (mildly reduced, preserved). Digoxin and ivabradine non-reduced cells were refilled by R5 rather than marked neutral (no measurement existed). The two FIGHT-based GLP-1 reduced cells were unusable and were filled by R5. sGC preserved uses the KCCQ physical limitation score (outside the instrument order) because the summary score was not retrievable.

### 6d. Dose-table rulings (D1 to D6; application recorded in `docs/dose-evidence-2026-11-15/notes-resolved.md`; the numbered text is not in the repository)

- D2: where no direct figure is used, the anchor is the fraction of the target dose that the trials behind the engine's reduced-EF relative-risk row achieved, times the engine's target.
- D3: where the achieved dose is unsettled (CIBIS-II bisoprolol, 6.2 mg or 8.6 mg), use D2: 0.775 x 10 = 7.75 mg (the pool without CIBIS-II).
- D5: clamp an anchor into the formulary's range (digoxin 0.25 mg median in DIG clamped to 0.125 mg, stored as 125 mcg/day in the formulary unit; eplerenone at eGFR 30 to 49 raised from 24.8 to 25 mg).
- One anchor per drug, based on the death row.
- The low-dose credit c0 is the mean of four solved values (ATLAS death 0.565, ATLAS hospitalization 0.206, HEAAL death 0.358, HEAAL hospitalization 0.328): 0.364; recorded range 0.206 to 0.565. The resolved notes say the death-credit intervals include 1 and are not bounded by the data.

### 6e. Ruling-type decisions inside the code (comments marked ENGINE POLICY and ASSUMPTION)

- `scoreModel.ts`: base weights and profile multipliers; precision-weighting method and the uniform no-exclusion rule; KCCQ anchor 20 (Spertus 2005: 5, 10 and 20 points are small, moderate and large changes); side-effect divisor 2 (a full four-drug regimen is about 77 burden points and regimens with a diuretic and adjuncts exceed 100, so `100 - burden` floored at 0 and stopped discriminating); the 0.6 sub-target completeness credit and its linear shape (reference only).
- `outcomeBenefit.ts`: an improved EF is valued at its earlier band (the trials enrolled the lower EF and guidelines say continue therapy); a loop-diuretic row applies to a patient only if congested by the engine's own predicate; the vasodilator row depends on self-identified race (A-HeFT enrolled Black patients; the other row rests on a weaker basis); the 95% interval assumes independent estimates; one counted drug per mechanism group (the lowest dose-adjusted risk).
- `symptomBenefit.ts`: KCCQ points add across drugs (assumption).
- `harmBurden.ts`: several multipliers multiply together (assumption, flagged on the line); a multiplier whose patient value is missing is applied when its ratio is above 1 and not applied when it lowers risk, and either way is listed (`multipliers_not_evaluated` with an `applied` flag, `unknown_assumptions`); the moderate hyperkalemia line is charged only on the excess above the severe line; a harm measured in one sex is charged only to that sex, and to the higher-risk case when sex is not recorded.
- `doseCredit.ts`: c0 applies to every class (extrapolated); with unknown eGFR the higher anchor is used (no over-crediting); loop diuretics earn credit 1 at any dose (no measured dose relation).
- Safety thresholds and bands in `eligibility.ts`, `gates.ts`, `thresholds.ts`, `contraindications.ts`, `candidates.ts`, `explain.ts` (K 6.0 and 6.5 stops, RAAS start at K 5.2, MRA at 5.0, eGFR 20, beta-blocker and ivabradine heart-rate rules, 48 to 72 hour laboratory check). These pre-date this work and are unchanged.

## 7. What is still a fixed safety rule, not a measured model

These named adjustments sit on top of the weighted sum (`SCORE_ADJUSTMENTS`) and eligibility is decided before scoring. They are policy until a measurement replaces them.

| Rule | Value | What would replace it |
|---|---|---|
| Eligibility rules E01 to E20 and contraindications | exclusion | Nothing: labeled hard rules |
| Warning penalty | -8 per residual-risk warning | Event rates for each warning, priced in the harm table |
| Recorded SBP below 90 / below 95 | -20 / -6 (below 85 sets the score to 0) | A measured hypotension harm rate by baseline pressure (the harm table has symptomatic hypotension as a symptom line only; the SBP-by-baseline modifier was not measurable) |
| Recorded heart rate below 50 | -40 | Bradycardia and advanced AV block rates by heart rate |
| Recorded potassium above 5.5 | -40 | Hyperkalemia event rates by baseline potassium (the table has a diabetes modifier for MRAs, not a potassium one) |
| Volume depletion, diuretic de-escalation | +15 | A measured outcome effect of de-escalation |
| Unknown renal function with SGLT2 inhibitor | -12 (retired; renal-dependent changes are withheld instead) | n/a |
| Mandatory-swap adjustment (special features line) | +15 before normalisation when an option replaces a contraindicated or intolerance-documented drug; normalised and clamped to -8 to +12. The one remaining hand-set number in the special-feature sum; non-zero on 17 of 951 displayed options across the scenarios (measured 2026-11-16) | Remove when forced swaps are handled outside the score |
| Low-output cap | displayed score capped at 25 | n/a |
| Two new classes per visit | `max_new_classes_per_visit` = 2 (rescue binder and iron count) | Evidence on titration pace and adherence |
| Congestion display rule | the best diuretic intensification is shown when the patient is congested (`ensureCongestionCoverage`), because congestion relief by dose is not modelled (a loop earns credit 1 at any dose, so an increase earns no extra outcome credit) | A measured dose-response for decongestion |

Special features still exist as rationale text; their old points are kept in `constants.ts` as documentation and add 0.

## 8. Guideline reproduction

`npm run guideline:report` compares the lead option of the current engine with the first option of every run of the guideline-driven engine at commit a6cb28f, frozen in `data/golden/guideline-baseline-a6cb28f.json` (the live golden reference was refreshed with the new engine, so it can no longer serve as the baseline), on the same scenario by insurance-tier runs, and evaluates the targets in `scripts/guidelineTargets.ts`. It is a report, not a gate. Targets about which option leads or is displayed live only in `guidelineTargets.ts`. Never weaken a check to make a target pass.

## 9. The weakest rows

Named by row id; from the resolved notes and the data. Rows marked (current) were checked against `data/` on 2026-11-16.

Outcomes
- `beta-blocker-reduced-hfh` (CIBIS-II alone, the 0.64 figure not confirmed in any source opened; the mildly reduced extrapolation depends on it).
- `beta-blocker-mildly-reduced-hfh` (0.92, 0.52 to 1.60; extrapolated from a cardiovascular-hospitalization figure).
- `beta-blocker-preserved-death` (assumed neutral over conflicting randomized evidence; the interval 0.65 to 4.10 is an envelope, not a statistical interval).
- `arni-mildly-reduced-death`, `arni-mildly-reduced-hfh`, `arni-preserved-death`, `arni-preserved-hfh` (products of two indirect ratios; heterogeneity I2 82% between the two ARNI trials).
- `acei-mildly-reduced-*`, `arb-mildly-reduced-*` (post hoc subgroup of one trial; the death figure is the all-EF value).
- `nsmra-reduced-death`, `nsmra-reduced-hfh` (no finerenone trial in reduced EF; steroidal MRA pool copied).
- `sglt2i-mildly-reduced-hfh` (the shared 0.74 hides EMPEROR-Preserved 0.58 at LVEF 41 to 49 versus 0.78 at 50 and above).
- `glp1-reduced-hfhosp`/`glp1-reduced-death` (pooled across SELECT and the liraglutide trials FIGHT and LIVE; the composite endpoint is not hospitalization alone; engine initiation requires LVEF above 40, so only continuation is affected). `glp1-preserved-death` and `glp1-mildly_reduced-death`: two trials in opposite directions, about 170 deaths.
- `loop-*-congested`, the Cochrane odds ratios (0.24 and 0.07) from about 200 patients, tiny pre-ACE-inhibitor trials used as relative risks; after precision weighting the values used are about 0.83 and 0.86 (section 10).
- Extrapolated rows keep their source trial's interval; the interval is not widened for the extrapolation (review point, unchanged).
- `vasodilator-black-mildly_reduced-*`, `vasodilator-other-reduced-*` (death and event figures disagree), `iviron-preserved-*`, `iviron-mildly_reduced-*` (no event trial in preserved EF), `ivabradine-reduced-death` (reconstructed from counts, not quoted).
- All 27 assumed-neutral rows: neutral is a decision, not a finding.

Symptoms
- `arb-mildly_reduced`, `arb-preserved` (-0.4 points: the sign was read from an abstract that does not state it).
- `bb-reduced`, `bb-mildly_reduced`, `bb-preserved` (6.57 points, interval -3.94 to 16.86; two small trials, MLHFQ converted, copied to bands with no data).
- `glp1-reduced`, `glpgip-reduced` (obesity HFpEF trials applied to HFrEF).
- `arni-reduced` (2.76, no interval; borrowed ACE inhibitor value plus an increment).
- `vasodilator-mildly_reduced`, `vasodilator-preserved` (3.04, one trial in Black patients with HFrEF, no interval).
- `kbinder-mildly_reduced`/`kbinder-preserved` and ivabradine non-reduced cells.

Harms
- `fcm-hypophosphatemia` (66.35 a year at mild weight is about 33 burden points; a 35-day laboratory result against another iron in iron-deficiency anemia; heart-failure trials show 1 serious event in 1532).
- `loop-hypomagnesemia`, `thiazide-hypomagnesemia` (21.6, a potassium-binder figure applied to diuretics; upper bound) (current).
- `hctz-creatinine`, `chlorthalidone-creatinine` (an acute 72-hour inpatient add-on rate, 29.3, used as a yearly outpatient rate).
- `loop-hypokalemia` (now the thiazide-like sibling figure 6.2; the resolved notes describe an earlier version that charged 0 because the only direct figure was below placebo at a hypertension dose).
- `BB-STEP6-AVblockAdv` (0.261, an upper bound lower than the label band; sourced from the adjunct table and not verified by the harm resolver), `ARNI-R5-hyperkalemia` (about zero or negative: a mix of definitions), `ARNI-R5-syncope`, `ACEi-enalapril-syncope` (window mismatch).
- SGLT2 genital infection in women (`SGLT2i-dapa-genital-female`; a 0.4-year pool, and the diabetes populations of the other SGLT2 rows, used as observed).
- `vas-lupus`, `vas-syncope`, `loop-hypotension`, `thiazide-hypotension`, `torsemide-urinary-frequency` (14% at 10 mg and above despite the label saying it is generally not reported in heart failure), `dig-*` symptoms (low-dose trial, cumulative-time assumption), `iva-avb-advanced`, `fcm-hypersensitivity`, `thiazide-hyperglycemia`, `loop-hyperglycemia`, valsartan rows (4-month Val-HeFT window), `MRA/nsMRA-IPD-K60` and hypokalemia (assumed follow-up).
- Hypertension-engine figures not confirmed: the ALLHAT angioedema rate (0.68% is the OCTAVE enalapril overall rate), the pooled empagliflozin tables (full text unavailable), TOPCAT gynecomastia and volume-depletion counts, the HEAAL hazard ratio 1.21.
- Beta-blockers carry the largest foundational burden mainly from syncope (carvedilol COPERNICUS 8 versus 5 patients, applied to metoprolol and bisoprolol as a sibling proxy): at the second listed strength each is 24.1 burden points in the reference run below, against 5 to 13 for most other foundational drugs.

Dose
- The digoxin anchor was in the wrong unit (0.125 where the formulary is in mcg), found by the independent review and fixed (125 mcg/day; every anchor now has a unit and a check asserts each anchor lies inside its drug's dose range). The clamp itself (DIG median 0.25 mg clamped to the largest formulary strength) is a ruling (D5).
- The bisoprolol anchor (7.75 mg) rests on an unsettled CIBIS-II dose (6.2 versus 8.6 mg).
- The SOLVD denominator: the SOLVD mean enalapril dose of 16.6 mg is among patients still taking the drug; the intention-to-treat figure is 11.2 mg (see section 10). The stored enalapril anchor is 16.79 mg.
- The finerenone proxy (27.3 and 13.6 mg) mixes two stratum targets and is conservative against FINEARTS-HF (32.3 and 15.6).
- The ATLAS hospitalization credit has no interval; the HEAAL and ATLAS death credits are not bounded by their data.

Reference run (computed with `harmBurdenFor` at the final pass, reproduced exactly: a 60-year-old man, eGFR 70, potassium 4.3, SBP 120, no comorbidities, one drug at its second listed strength (the first when only one), its first listed frequency; burden points before the divisor of 2): sacubitril/valsartan 12.7; lisinopril 12.8; enalapril 13.0; ramipril 17.0; captopril 11.5; valsartan 23.7; candesartan 13.4; losartan 12.5; carvedilol, metoprolol succinate, bisoprolol 24.1 each; spironolactone 11.2; eplerenone 6.1; finerenone 9.0; dapagliflozin 5.1; empagliflozin 7.4; semaglutide 22.2; tirzepatide 28.4; furosemide 23.5; Furoscix 29.2; torsemide 36.8; bumetanide 23.5; hydralazine/isosorbide dinitrate 65.5; ivabradine 5.2; vericiguat 5.3; patiromer 15.8; sodium zirconium cyclosilicate 17.1; ferric carboxymaltose 39.6; digoxin 7.0; metolazone 27.6; chlorthalidone and hydrochlorothiazide 38.1 each. Burden depends on dose for the drugs with measured dose groups and on sex for the sex-specific rows. This scale is not additive with the symptom model beyond the weights shown, and it indexes expected harm, not a probability.

## 10. Decisions for the owner

All numbers below are engine policy or extrapolation until the owner rules. Ruled so far: item 5 (2026-11-16, Cochrane figures confirmed for congested patients). The other 16 are open. The order is my judgement of how much each one moves the first option, taken from the guideline report and the review reports; I did not measure each separately (the only measured sensitivity is item 2's profile change, and the ranking comparison in section 11). For each, the last sentence says what would change if the owner ruled the other way.

1. **Valuing new starts and increases as titrated** (`planCreditsFor`). The trial relative risk measures "start and titrate", so a start today is credited at the trial-achieved dose while its harm is charged in full. Likely the largest single lever on which option leads, because it decides how much a new start beats an unchanged regimen. If ruled the other way (credit by today's dose, the "at today's doses" figure the card already shows), a new start at the label starting dose earns only a fraction of its benefit (credit 0.364 at the start dose for a measured class) and increases earn little until titrated, so leads would probably shift toward dose increases of drugs already on board and away from starts (not measured here).
2. **The six weights and the three profile rules.** Default: death 0.30, hospitalization 0.22, symptoms 0.10, side effects 0.14, cost 0.14, dosing burden 0.10 (`BASE_WEIGHTS`). Profiles multiply then renormalize (`PROFILE_MULTIPLIERS`): outcomes_first halves cost and dosing burden; cost_first triples cost; simplicity_first triples dosing burden. Implied exchange rates in the default profile (guideline report): one point of death score is 0.30 ranking points, one side-effect burden point 0.07, one KCCQ point 0.50, so one burden point is worth 0.23 death-domain points. Measured at the final pass (337 scenarios with a lead, cash tier, comparing the regimen of the first option; a throwaway script run on 2026-11-16, not kept in the repository): the lead differs from the default in 9 (outcomes_first), 35 (cost_first) and 0 (simplicity_first), so the profiles move few first options. If the weights were ruled differently, leads move toward whichever factor gains weight; a heavier side-effect or cost weight moves leads toward fewer or cheaper drugs.
3. **The side-effect scale and severity weights.** Burden divided by 2 (`SIDE_EFFECT_BURDEN_DIVISOR`), severity weights 0.5 / 1 / 3 and symptom weight 1 (policy shared with the hypertension engine; no published utility weights were found). If the divisor were 1, regimens with a diuretic and adjuncts floor at 0 and stop discriminating; a larger divisor makes side effects matter less than death and favours more drugs.
4. **The upper-bound rows** (largest placebo-controlled excess of that harm for any class, charged as if measured for that drug): `ACEi-STEP6-renalSAE`, `ARB-STEP6-renalSAE`, `ARNI-STEP6-renalSAE` (1.393 a year), `BB-STEP6-AVblockAdv` (0.261), `vas-syncope` (3.0), `loop-hypomagnesemia` (21.6), `loop-hypotension` (5.0), `furoscix-injection-site` (6.0), `thiazide-hypomagnesemia` (21.6), `thiazide-hypotension` (5.0). The two hypomagnesemia rows add about 10.8 burden points to each loop and thiazide-like diuretic. If dropped, loops and thiazide-like drugs lose about 11 burden points each and become cheaper to add or keep.
5. **The loop-diuretic congestion rows and loop handling.** RULED by the owner 2026-11-16: "use the Cochrane diuretic figures for congested patients". The engine already did this, so no output changed. Still open inside this item: the full credit a loop earns at any dose, and the neutral rows for non-congested patients. Cochrane odds ratios 0.24 (death) and 0.07 (hospitalization) from about 200 patients in 1980s to 1990s trials, used as relative risks, applied only to a congested patient, after precision weighting (furosemide death published 0.24, used about 0.83; hospitalization 0.07, used about 0.86). Loops have no measured dose relation, so credit is 1 at any dose; congestion relief by dose is not modelled, and the congestion display rule shows the best diuretic intensification. Alternative recorded in the rows: neutral. If ruled neutral, a loop adds nothing to the outcome score and keeping it in a congested patient would no longer outscore removing it on outcomes (the hard check would need to be rewritten).
6. **The precision-weighting rule** (`SHRINKAGE_FORMULA`, DerSimonian-Laird tau2: 0.0596 outcomes, 12.559 symptoms). Pulls every imprecise row toward no effect, including real effects. A skeptical prior centred on a class effect, or no weighting, would raise the small-trial benefits (loops, beta-blockers outside reduced EF, GLP-1) (not measured here).
7. **The two-new-classes-per-visit limit** (`max_new_classes_per_visit`, counts rescue additions). It counts class-group additions, not dose changes or same-group swaps. It was reported to this author that it makes a switch to sacubitril/valsartan compete with adding an SGLT2 inhibitor; that mechanism was not traced here. The guideline report shows several leads that switch the RAAS agent to sacubitril/valsartan and add or keep an MRA without starting an SGLT2 inhibitor. A limit of 3 would let both happen in one visit.
8. **Finerenone at LVEF 41 to 49.** FINEARTS-HF enrolled LVEF 40 and above, so the evidence supports it and the engine displays it; the 2026 ESC guideline does not list it for that range. This is three of the four missed guideline targets (section 11). If the guideline governs, finerenone would be hidden in that range.
9. **The KCCQ scale anchor** (20 points = full symptom score, `KCCQ_FULL_CREDIT_POINTS`, Spertus 2005). Symptoms then add across drugs, which no trial measured. A smaller anchor raises the symptom factor's effective weight (one KCCQ point is worth 1.67 death points now).
10. **The 0.364 low-dose credit** (c0), measured in ACE inhibitors and ARBs only (ATLAS, HEAAL) and extrapolated to every class; recorded range 0.206 to 0.565. It matters only where a drug is left below its trial dose (it also fixes how much a start at today's dose earns in item 1's alternative). A different c0 changes how much dose increases are worth.
11. **The remaining fixed safety penalties** (section 7) and the measurement that would replace each. Removing a penalty lets options that carry the warning rank higher.
12. **The mandatory-swap adjustment** (+15 before normalisation, when an option replaces a contraindicated or intolerance-documented drug): the one remaining hand-set number in the special-feature sum, non-zero on 17 of 951 displayed options. Removing it would lower the rank of those swap options by up to 12 points before other factors; keeping it keeps a forced switch ahead of leaving the drug.
13. **Beta-blocker benefit applied in atrial fibrillation, and the unconfirmed beta-blocker hospitalization figure.** The beta-blocker row has no rhythm condition (the trials were largely in sinus rhythm), and the 0.64 figure (CIBIS-II) is still not confirmed from a readable source: the trial's PubMed abstract (PMID 10023943) does not report it. If the figure were weaker or absent, beta-blockers would lose hospitalization benefit and the beta-blocker slot would matter less in leads.
14. **Intervals of extrapolated rows are not widened.** An extrapolated row keeps its source trial's interval, so its precision weighting treats it as if measured in that population. Widening them would pull extrapolated rows further toward no effect.
15. **Extrapolated symptom and harm figures with weak sources** (section 9): creatinine rise for chlorthalidone and hydrochlorothiazide (29.3% from a 72-hour inpatient trial, 14.65 burden points each; metolazone 8.175), dapagliflozin genital infection in women (a 0.4-year pool), the ARB health-status sign (read from an abstract that does not state it), GLP-1 in reduced EF (the row pools SELECT with FIGHT and LIVE: death 0.83, hospitalization 1.06), IV iron hypophosphatemia (66% laboratory nadir at 35 days, 33 burden points at mild weight). Each can be kept, dropped or replaced row by row in `data/`; dropping a harm row makes that drug look safer.
16. **The SOLVD denominator.** The SOLVD mean enalapril dose, 16.6 mg, is among patients still taking it; 32.5% of the enalapril group had stopped, so the intention-to-treat dose is about 11.2 mg (`docs/dose-evidence-2026-11-15/notes-resolved.md`). The relative risk is intention-to-treat. The stored enalapril anchor is 16.79 mg; an intention-to-treat basis would lower ACE-inhibitor anchors by about one third; the same question applies, unmeasured, to every other trial mean.
17. **No baseline risk yet.** The model gives relative effects only; absolute events prevented need a baseline risk model (none is in the repository). Adding one would make the cost and side-effect trade-offs depend on the patient's own risk and change leads for low-risk patients.

Found by review and fixed (not open): the digoxin dose-anchor unit (anchor stored as 0.125 where the formulary is in mcg, so digoxin always earned credit 1); the unevaluable-multiplier rule (unknown values no longer make an option look safer); the loop-diuretic partial credit with no measured basis; a row-count comment; repeated table validation. The review also recomputed tau2 independently, checked interval arithmetic for shared rows, the EF band boundaries and every formulary drug, dose and frequency through all three models, and found them correct.

## 11. Current results

`npm run guideline:report`, run at the final pass on 2026-11-16 (the script also rewrites `docs/outcome-evidence-2026-11-15/guideline-reproduction.txt`). Summary lines as printed:

```
Guideline reproduction report (a report, not a gate). 1011 runs with a lead in both the guideline-driven baseline (commit a6cb28f) and the current engine.
(1) mean guideline-concordance score of the lead: new 73.01 vs guideline-driven baseline 73.37
(2) runs where the new lead's concordance is at least the old lead's: 806 of 1011 (79.7%)
(3) runs where the new lead has the highest concordance among the displayed options: 861 of 1011 (85.2%)
Guideline targets reproduced: 3 of 7
```

Missed (4): the Furoscix short course is not displayed in the Furoscix scenario (no displayed option carries it; the report does not establish why), and finerenone is displayed at LVEF 41, 45 and 49 (item 8). Met (3): the lead at LVEF 45 reduced-EF standalone contains an SGLT2 inhibitor; at LVEF 42 obese some displayed option contains one; in the HFpEF finerenone case every displayed option contains one. The full list of the 15 groups with the largest concordance shortfall is in the saved file. These measure behaviour against the guideline-driven engine's own concordance score, not clinical outcomes.

Gate and ranking comparison, as reported by the controller after refreshing the reference outputs (not re-run by me except where stated): `npm run gate` green; golden 1,032 runs byte-identical (I re-ran `npm run golden` after my comment-only edits: byte-identical); verify 541 passed, 0 failed (I re-ran it); verify:ui 68 passed at the controller's gate (72 at my final run, after the new checks); audit:hundred 100/100; audit:mistakes 51/51; audit:red 0/0/0; audit:pricing OK; fuzz no violations. Before the reference refresh the ranking comparison against the previous engine showed eligibility, alerts and per-option warnings identical in all 1,032 runs and the first option identical in 174, changed in 858.

## 12. Known gaps

- No baseline risk, so no events prevented (item 17).
- No combination trials: relative risks multiply and KCCQ points add by assumption; the pillars were trialled on top of one another, so the joint uncertainty is wider than the independent-interval approximation.
- Beta-blocker, ARNI, ACE inhibitor, ARB and GLP-1 rows in the mildly reduced and preserved bands are extrapolated or weak (section 9).
- Congestion relief by loop-diuretic dose is not modelled (credit 1 at any dose).
- The harm table understates harms that trials did not ascertain (registry non-serious events under reporting thresholds hide some MRA and SGLT2 inhibitor harms; negative excesses are floored to 0).
- Six symptom classes have no KCCQ measurement and count 0 ("not measured").
- Modifiers not representable numerically (16) are not applied: by systolic pressure, eGFR, baseline potassium and others.
- The retired physiological domains remain not assessed; no response model replaces them.
- The guideline-concordance score is the only yardstick for "reproduces the guidelines"; it is the previous engine's own measure and is not independent.
- The display (section 13) computes three comparisons the engine does not output (symptom change, side-effect burden change, and the "at today's doses" figure, each versus the current regimen) with the engine's own functions, and reconstructs the current regimen from the option's modification set.

## 13. Where the screens show this

- `components/ExpectedEffect.tsx`: the card block "Expected effect (trial averages)" (death and hospitalization as percent lower or higher with relative risk and 95% interval, and where the interval includes 1 it says "the interval includes no effect"; KCCQ points; side-effect burden change with the two largest contributing harms; "as planned" with "at today's doses" where they differ) and the evidence drill-down (published and used values, dose credit, trial, citation, basis label; for side effects each line's rate, severity, evidence level including "upper bound", multipliers and the assumptions made for missing patient values).
- `components/expectedEffectModel.ts`: pure display model (named so to avoid a casing collision with ExpectedEffect.tsx).
- `components/EvidenceTables.tsx`: read-only tables of the four evidence files on the Evidence tab, with a drug-class filter.
- `components/FAQ.tsx`: "How options are ordered" (weights table generated from `WEIGHT_PROFILES`).
- `components/RecommendationCard.tsx`, `ScoreDetailModal.tsx`, `ScoreLedger.tsx`, `resultsModel.ts` (draft-note sentence), `scoreExplain.ts`, `appStatements.ts`.
- `scripts/verifyClinicalUi.tsx`: UI checks (`npm run verify:ui`).

## 14. Verification limits

- Run at the final pass: `npm run typecheck`, `npm run build`, `npm run verify:ui`, `npm run verify`, `npm run golden` and `npm run guideline:report` (results above and in the hand-off message). A desktop and phone-width browser check of the Guided example cards and the Evidence tab was run before the final engine changes; it was not repeated after them.
- Per-row verification files record confirmations, corrections and unconfirmed items by a second reader; the engine validators throw on a missing or duplicate row.
- Not run or not claimed: any prospective or retrospective clinical validation; comparison with patient outcomes; independent re-derivation of every pooled figure; any regulatory assessment.
