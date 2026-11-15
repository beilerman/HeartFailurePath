# Medication properties, substitutions and withdrawal review

> Historical stage report. The [consolidated handoff](../HANDOFF-2026-11-13.md) reconciles subsequent fixes, retired response calculations, latest verification and remaining work. Preserve this report as evidence of its review stage.

**Historical .7 review.** The [subsequent .8 repair and repeated review](../medication-repair-loop-2026-11-12/README.md) supersedes the open runtime findings below. Unsupported numerical response was removed from clinical use; exposure/course prerequisites and browser-verified explanations were added. These retained artifacts describe the earlier model, not current forecasts.


Reviewed 2026-11-12. Local rule set **2026-11-12.7**. All **32 medications and 121 dose/frequency entries** were inspected through their effect functions, declared dosing/renal facts, contraindication descriptions and special-feature credits. Shared initiation, titration, substitution and removal calculations were adversarially exercised. This is an implementation/property review, with focused fresh primary-source verification; it is **not a new independent verification of every label or clinical validation of the model**. The five medication-specific source reviews from November 10 remain relevant and are linked below.

No commit, push, merge, deployment or clinical activation occurred. Earlier local repairs remain present.

## Answer: does it back-calculate an untreated patient?

**GlucosePath explicitly does; HeartFailurePath does not maintain a separate untreated state.** Live source inspection, rather than the older project notes, established this:

- `../glucosepath/src_common/patient.cpp:45-76`, `patient_CalcUntreatedA1c`: calculate the current regimen's estimated A1c reduction using the measured A1c, then set `Untreateda1c = Currenta1c + estimated reduction`.
- `../glucosepath/src_common/utils.cpp`, `CalcA1cDiff` and `GetEfficacyCoefficient`: aggregate medication effects with a medication-count coefficient. The coefficient is `0.85^(n-1)`, floored at `0.614125`; it is a modeling assumption, not a measured response.
- `../glucosepath/src_macos/cudakernels.metal:2114-2115`: candidate evaluation starts from that estimated untreated A1c.
- HeartFailurePath's `services/engine/effects.ts` starts from **observed physiology while on the recorded current regimen**. It adds a new drug's effect, subtracts an old drug's effect, or calculates a difference/ratio for titration or substitution. The `baseline_*` fields mean before the proposed change, not before all treatment; their comments now say so.

In a consistent additive model, a substitution can be expressed without creating a drug-free patient record:

```
candidate measurement = observed measurement
                      - signed effect of current regimen
                      + signed effect of candidate regimen
```

For a multiplicative biomarker model, if `F(R)` is the assumed residual fraction on regimen R:

```
candidate NT-proBNP = observed NT-proBNP × F(candidate) / F(current)
```

These are conditional model equations, not validated individual forecasts. They only support an untreated counterfactual when the effect model, baseline, exposure duration, background therapy and endpoint are compatible. Current HF functions do not meet that standard. A single treated visit does not identify how much of that patient's EF, BP, potassium, congestion or symptoms is attributable to each medication.

## Confirmed engineering defects repaired

| Finding | Before | Repair and result |
| --- | --- | --- |
| Identical exposure could change physiology solely because it was described as removal plus re-addition. | 14/32 first-dose drug probes changed physiology. Entresto 24/26 re-described as remove/add raised SBP from 130 to 135.2 and K from 4.30 to 4.33. | New `regimenTransition.ts` derives a deterministic net transition from the actual before/after regimens. Exact unchanged exposures cancel first; same-drug changes precede class substitutions. Zero discrepancies afterward; regression covers all 121 entries. |
| A swap and separate removal/addition could project different physiology. | 68 ordered within-class cross-drug pairs differed. Entresto to lisinopril produced SBP 132.5 as a swap versus 136.07 as separate actions. | Both representations use the same net transition. Zero discrepancies afterward; regressions cover all same-class dose/frequency pairs, including same-drug changes. These simulator probes do not assert that every tested pair is clinically eligible. |
| Withdrawal could generate negative KCCQ or EF. | 29/32 first-dose removal probes from synthetic KCCQ 1 / EF 1 had a negative endpoint. | KCCQ bounded to 0–100; EF cannot go negative. A nonpositive unbounded EF adds an explicit `MODEL LIMIT` warning. **A zero bound is not a plausible individualized prediction or a validated withdrawal estimate.** |
| Projected patient still contained the old medication list. | Lisinopril-to-valsartan projection retained lisinopril inside `projected_patient.current_regimen`. | Projected patient carries the resulting regimen with copied mutable dose records. Every returned scenario option is checked for consistency. |
| Comments overstated evidence and confused observed baseline with drug-free baseline. | The LVEF curve was described as trial-calibrated; PROVE-HF's 5.2-point six-month change was described as a twelve-month result. | Removed unsupported calibration claims; identified initiation/renal/saturation coefficients as model policies. The rationale no longer promises “maximal survival benefit.” No drug effect coefficient was silently recalibrated. |

The transition layer preserves the original clinical instruction list. It does not replace medication reconciliation, eligibility rules, ACEi/ARNI washout guidance, tapering instructions or monitoring. It deliberately keeps short-course Furoscix separate from standing oral-loop substitution pairing.

One existing direct-simulation test supplied a source of furosemide 20 mg while its patient was already taking 40 mg. It previously passed because the action description overrode reality. The test now constructs the stated source exposure before testing a genuine 20-to-40 change.

## Remaining systemic model defects and evidence gaps

1. **No common time horizon.** Acute BP, electrolyte changes, decongestion, months-long remodeling and year-long health-status results feed one projected patient. Start date, time at dose, last dose, actual adherence and measured response are absent. A drug listed as current is effectively credited as if its assumed benefit has already occurred.
2. **Initiation and withdrawal are asymmetric.** Lowest-dose RAAS/beta-blocker initiation uses 35% of the nominal BP effect; removal reverses the full effect. Potassium increases receive renal risk multipliers, including a 15% renal reserve buffer for changed RAAS/MRA exposure, while decreases are not inflated. These are policies, not paired estimates of an individual's treatment response.
3. **Combination effects have only an entry path.** Newly forming four-pillar therapy adds EF 3 points and KCCQ 5; breaking it does not remove an equivalent interaction term. Newly combining loop/SGLT2 therapy multiplies a fluid delta by 1.2; the effect depends on how the combination was assembled. Whole-regimen interactions need their own evidence and time model.
4. **Nonlinear endpoints cannot be undone by subtracting a trial average.** The positive EF saturation formula is asymmetric with removal, and its 0.7 coefficient actually amplifies sufficiently small positive deltas. BP/BNP/weight floors add further path dependence. Sequential add/remove diagnostics still fail to return to baseline for 25/32 drugs. That observation exposes the absence of a coherent inverse model; it does **not** mean real patients must physiologically return to baseline after withdrawal.
5. **Trial comparators and instruments are mixed.** Some effects are within-group changes, others placebo-adjusted benefits on background treatment. KCCQ-TSS, CSS and OSS are not declared separately. Subtracting one drug's generic KCCQ credit from another's can manufacture a comparative benefit unsupported by a head-to-head study.
6. **Flat dose responses hide uncertainty.** Ivabradine has the same HR effect at 2.5, 5 and 7.5 mg twice daily. Metolazone has identical modeled physiology at 2.5, 5 and 10 mg. Hydralazine/ISDN has the same nominal BP drop at both listed doses. These curves cannot quantify added hemodynamic/electrolyte risk from escalation; “no modeled change” must not mean “no additional risk.” Existing observed-state eligibility and monitoring remain essential.
7. **Episodic treatment is not chronic exposure.** Removing ferric carboxymaltose from a medication list reverses an 8-point KCCQ credit, even though a completed infusion does not instantly undo iron repletion. Furoscix has a short-course designation, but no course dates. Its marginal effect depends on the current oral loop; that contribution is not recomputed when an unchanged SC entry accompanies an oral-loop change.
8. **Weight loss is state dependent.** GLP-1 effects use a percentage of current body weight. Reusing a projection as a new patient compounds effects and cannot reconstruct pre-treatment weight. The 50% dry-weight allocation is model policy. Neither regain kinetics nor duration of maintenance is modeled.
9. **Several other properties remain too coarse for individual decisions.** Digoxin exposure lacks measured levels/dose timing; diuretic response lacks observed response and resistance; binder effects lack correction-versus-maintenance timing; KCCQ-driven NYHA improvement has no matching deterioration rule. Side-effect rates are display-only. Cost is mostly per drug rather than dose/formulation, and complexity is not actual pill count.

These gaps remain **open**, not certified by green tests. Inventing slopes, withdrawal percentages or confidence intervals would conceal uncertainty. The recommendations below define the model work needed before such changes can be justified.

## Medication-by-medication findings

All numbers in this table are **current software properties**, not prescribing instructions, efficacy comparisons or individualized expected changes. EF changes are absolute percentage points; KCCQ changes are points; BP is mmHg; pulse is bpm; K is mEq/L. Ranges describe listed lowest-to-highest model entries, sometimes spanning frequencies. Full doses, frequencies, side-effect outputs, declared facts, renal-policy probes and contraindication descriptions are in [inventory.json](inventory.json). Renal probes use one fixed synthetic patient; they are not complete dosing guidance.

| Medication | Property under review | Adversarial finding / remaining action |
| --- | --- | --- |
| Sacubitril/valsartan | EF +5 to +9; BNP −30% to −50%; KCCQ +7 to +11; SBP −8 to −12 before initiation policy. | PROVE-HF is not a drug-free or head-to-head efficacy curve. Separate ARNI-versus-ACEi/ARB evidence from new-initiation evidence; retain washout/angioedema rules. |
| Lisinopril | EF +2 to +4; BNP −15% to −23%; SBP −5.5 to −13; fixed K +0.2. | Dose slopes, potassium increment and reverse-remodeling estimates lack individual calibration. Maximum listed dose is not automatically the patient's appropriate target. |
| Enalapril | EF +2 to +3.5; BNP −15% to −21%; fixed K +0.2. | Do not infer a cross-ACEi difference from independently authored curves. Renal/BP monitoring remains separate from efficacy credit. |
| Ramipril | Daily-dose-aware; 5 mg twice daily and 10 mg daily have equivalent modeled effects. | Frequency invariance is tested. Renal cap basis is explicitly daily; label-versus-HF target policy still needs its documented distinction. |
| Captopril | Fixed three-times-daily tiers; EF +2.25 to +4; fixed K +0.2. | Per-dose renal caps must not become daily caps. High pill burden and an authored EF curve do not establish an inferior or superior clinical effect. |
| Valsartan | EF +2.625 to +4.5; BNP −13% to −22%; fixed K +0.15. | Renal dose-cap policy and pairwise ARB substitutions need provenance; relative target fraction is not validated BP/EF equivalence. |
| Candesartan | EF +2.3125 to +4.5; BNP −11.5% to −22%; fixed K +0.15. | Smooth dose curve is model interpolation. Cannot infer superiority over another ARB from these decimals. |
| Losartan | EF +2 to +4; BNP −10% to −20%; SBP −5 to −10. | Preserve the documented HF-trial versus US-label target distinction and multi-tablet 150 mg description. Comparative effect slope remains unvalidated. |
| Carvedilol | EF +5.06 to +9; benefit plateaus at 25 mg twice daily while hemodynamic effects continue higher. | Weight-dependent target and actual tolerance must govern dosing. Lowest-dose remodeling credit is substantial and unvalidated; withdrawal/cross-taper cannot be inferred from that credit. |
| Metoprolol succinate | EF +5.25 to +9; HR −8.625 to −18. | Starting-dose selection and conduction/rate safety are distinct from the large assumed low-dose EF effect. No patient-specific withdrawal curve. |
| Bisoprolol | Listed 2.5–10 mg daily; EF +6 to +9. | Missing 1.25 mg tier and US formulation issues remain documented in prior source review. Large low-dose credit is not proof that 2.5 mg achieves two-thirds of an individual benefit. |
| Spironolactone | EF +2.5 to +4; K +0.5 to +0.8. | Magnitude relative to eplerenone is not a validated head-to-head estimate. Potassium/renal prerequisites and preparation availability remain important. |
| Eplerenone | EF +2 to +2.5; K +0.325 to +0.4. | Different modeled K and BP slopes can favor a substitution without comparative calibration. Preserve interaction and renal constraints. |
| Finerenone | KCCQ +3.75 to +6; EF +1.75 to +2.5 across 10–40 mg. | High-priority recalibration: FINEARTS reported a placebo-adjusted KCCQ-TSS difference of 1.6 at 12 months, not this dose curve. Instrument/background/time must be resolved before replacing the function. Do not infer mg-for-mg equivalence with steroidal MRAs. |
| Dapagliflozin | Fixed 10 mg; EF +2, BNP −13%, KCCQ +2.5. | Outcome evidence does not validate all surrogate coefficients. Distinguish initiation renal threshold from continuation; keep volume/renal prerequisites. |
| Empagliflozin | Fixed 10 mg; largely identical effects to dapagliflozin except KCCQ +2.0. | A 0.5-point difference from separate studies is not a head-to-head ranking advantage. Initiation policy differs by label/evidence population. |
| Semaglutide | Maximum weight reduction 10.7% and KCCQ +7.8, scaled down by dose; BP/HR effects flat. | Target trial averages have an evidence anchor; interpolated dose response, EF effect, timing and withdrawal/regain do not follow from them. Current-weight basis cannot recover untreated weight. |
| Tirzepatide | Maximum modeled weight reduction 12% and KCCQ +6.9; intermediate-dose fractions; flat BP/HR effects. | KCCQ anchor from SUMMIT does not validate every dose's effect or stopping response. Maintain separate obesity/diabetes phenotype and duration assumptions. |
| Furosemide | Daily-dose response, decongestion ceiling 4.2 kg; K loss continues to its modeled ceiling. | Dose equivalence/frequency is tested, but response, resistance, bioavailability and time to decongestion need observations. Ceiling policy must not be mistaken for safe high-dose escalation. |
| Furoscix | 80 mg short-course SC add-on; incremental effect above oral loop. | Needs course dates, reassessment, and context-aware recalculation if oral therapy changes. Not a chronic oral-loop replacement or a reversible standing contribution. |
| Torsemide | Daily-dose-aware curve; modeled weight ceiling differs from furosemide. | A protocol conversion ratio does not establish equivalent clinical response or a mortality advantage. Reconcile conversion and effect-curve assumptions. |
| Bumetanide | Daily-dose-aware, furosemide-related weight response; different BP slope. | Weight equivalence does not validate BP equivalence. The 10 mg/day limit and eGFR-related frequency policies remain separate constraints. |
| Hydralazine/ISDN | EF +3 to +4, but SBP drop fixed at 10 at both tiers. | Dose escalation has no modeled extra BP effect. Keep nitrate/PDE5 interaction checks and explicit indication; do not read the flat curve as stable BP risk. |
| Ivabradine | HR drop fixed at 10 at every dose; KCCQ +2. | Cannot quantify titration response. Label titrates by measured HR, reassessed after two weeks; do not invent a linear 2.5/5/7.5 response. |
| Vericiguat | EF +0.625 to +1; BNP −7.5% to −15%; small KCCQ credit. | Clinical event evidence is not validation of these surrogate dose slopes. Recent-worsening eligibility and BP checks remain necessary. |
| Patiromer | K reduction 0.15–0.45 across 8.4–25.2 g. | Baseline K, actual response, treatment duration, drug separation and maintenance versus correction matter. A fixed K drop is not an individual correction estimate. |
| Sodium zirconium cyclosilicate | K reduction 0.3–0.7 across 5–15 g. | Sodium/edema burden and correction versus maintenance phases need explicit context. Generic monthly price does not account for every regimen. |
| Ferric carboxymaltose | Same KCCQ +8 and BNP −5% at 500/1000 mg; treated as removable exposure. | Completed-course state is needed. Removing the list entry must not be equated with immediate loss of iron repletion; exact dosing still requires Hb/weight/iron data. |
| Digoxin | 62.5/125 mcg; KCCQ +2/+4; HR effect only in AF; no BNP credit. | Exposure depends on renal function, lean mass, interactions, dose timing and level. Coarse tiers cannot individualize this, and a prior interaction adjustment must not be repeated blindly. |
| Metolazone | All listed doses share weight −1.1 kg, BNP −10%, SBP −5, K −0.5. | Particularly weak dose-risk model. No extra modeled electrolyte/BP change at higher dose; HCTZ combination evidence does not validate metolazone's exact curve. |
| Chlorthalidone | Weight loss fixed 1.1 kg; modest dose-dependent BP/K effects. | BP evidence and thiazide-class extrapolation do not establish a fixed decongestion effect or chronic add-on safety. Needs volume/electrolyte response. |
| Hydrochlorothiazide | Weight loss fixed 1.1 kg; BNP/BP/K change by dose. | Short-term monitored combination evidence is not a universal chronic HF dose-response curve. Renal response, sodium and duration are insufficiently represented. |

## Primary evidence checked in this pass

- [PROVE-HF original JAMA report](https://jamanetwork.com/journals/jama/fullarticle/2749476), Table 2 and design: single-group open-label study; EF change 5.2 points at six months and 9.4 at twelve months. Its treated background and design do not establish independent drug-free contributions. Corrected the erroneous code attribution without inventing a new curve.
- [FINEARTS-HF prespecified analysis](https://onlinelibrary.wiley.com/doi/10.1002/ejhf.3669), Table 2: KCCQ-TSS difference 1.6 points (95% CI 0.8–2.4) at twelve months. The current finerenone generic KCCQ function lacks that instrument/time/comparator alignment.
- [Current ivabradine label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=676907d3-b374-4baa-8422-c04706409540), section 2.1: dose adjustment uses measured resting HR and two-week reassessment. The label supports response-guided titration, not a guessed dose-to-HR slope.
- [STEP-HFpEF](https://www.nejm.org/doi/full/10.1056/NEJMoa2306963): target-dose semaglutide's placebo-adjusted KCCQ-CSS and weight effects support the nominal anchors, not intermediate-dose interpolation or withdrawal estimates.
- [SUMMIT](https://www.nejm.org/doi/full/10.1056/NEJMoa2410027): the 52-week KCCQ-CSS difference of 6.9 is a trial result under a titrated regimen, not proof of all fixed-dose intermediate coefficients.
- [TRED-HF original trial](https://pubmed.ncbi.nlm.nih.gov/30429050/): in a small recovered-dilated-cardiomyopathy population, 11/25 assigned withdrawal relapsed within six months versus none assigned continuation. This supports caution about removing disease-modifying treatment after recovery; it supplies no per-drug deterministic EF subtraction or generalized individual relapse probability.
- [Carvedilol label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=3b56e0d0-82d7-4512-849f-2b72d7bae36e): withdrawal/taper precautions remain independent of efficacy arithmetic.

Prior source-by-source label/dose work: [RAAS](../medication-review-2026-11-10/verified-raas.md), [rate control](../medication-review-2026-11-10/verified-rate-control.md), [MRA/binders](../medication-review-2026-11-10/verified-mra-binders.md), [diuretics](../medication-review-2026-11-10/verified-diuretics.md), [SGLT2/GLP-1/adjuncts](../medication-review-2026-11-10/verified-sglt2-glp1-adjuncts.md). Their unsupported or partly verified items do not become verified through this inventory.

## Recommended next model design

Use **observed treated state plus a time-specific treatment transition**, with an optional explicitly uncertain counterfactual. Do not replace observations with an inferred untreated patient.

1. **Exposure record:** drug, formulation, actual dose/frequency, start/stop dates, time at current dose, last administered dose for episodic therapy, adherence status and observed response/tolerance. Unknown stays unknown. A missing start date need not block label-based safety review; it does prevent claiming full established effect or a precise withdrawal projection.
2. **Per-endpoint evidence record:** endpoint/instrument, units, population/phenotype, comparator/background regimen, time horizon, estimate and evidence-supported uncertainty, dose relationship, source, applicability restrictions and whether withdrawal data exist. Separate clinical outcome evidence from surrogate effect modeling and dose-equivalence policy.
3. **Transition effects:** compute net exposure from before/after once (now implemented). Then use evidence for switching where available, rather than subtracting two unrelated initiation trials. Evaluate interaction effects for both whole regimens under the same assumptions.
4. **Separate time windows:** immediate BP/HR/volume/renal/electrolyte risk; short-term titration response; longer-term symptoms/remodeling/outcomes. Washout and taper instructions are explicit constraints, never inferred from a stable final-state projection.
5. **Withdrawal and episodic state:** distinguish temporary hold, taper, substitution, permanent cessation and completed course. Do not instantly remove accumulated remodeling or iron repletion. Unknown withdrawal magnitude is “not quantified,” while known safety/continuation evidence and monitoring remain actionable.
6. **Patient-informed estimates when possible:** use observed pre/post-treatment measurements to update response, accounting for simultaneous changes and measurement timing. A range or directional assessment is appropriate only when supported; do not invent a confidence percentage from data completeness.
7. **Clinical display:** show what is known now, the change being considered, prerequisites, supported directional effects, unquantified effects and reassessment. Incomplete history should narrow claims rather than fabricate an untreated baseline or blanket-block unrelated decisions. Estimated counterfactuals must stay separate from the actual patient record.

Implementation of this full longitudinal model and clinical recalibration remains open. The current repair supplies a consistent transition boundary and regressions; it does not pretend that a numerical inverse solves these clinical questions.

## Reproduction and verification

```
npx tsx scripts/medicationInventory.ts
npx tsx scripts/medicationTransitionProbes.ts
npx tsx scripts/medicationPropertyChecks.ts
npm run ranking:diff     # run before refreshing the golden snapshot
npm run golden:update   # only after reviewing intended differences
npm run gate
npm run build
```

`probes-before.json` preserves the original diagnostic results; the reproducible probe writes only `probes-after.json`. The old invalid-range predicate included EF equal to zero; inspection confirmed none of the 29 original failures had EF exactly zero. The new predicate counts negative values; a separate regression requires a model-limit warning for zero EF. Add/remove non-inversion remains deliberately reported as an unresolved model characteristic, not hidden by a passing-test assertion.

Eight new regression groups cover all dose functions, identity, representation/order invariance, daily-dose equivalence, numeric bounds, unknown KCCQ, caller immutability and projected-regimen identity across scenario output. These are engineering invariants, not evidence that the pharmacodynamic parameters are accurate.

[Ranking comparison](ranking-before-update.txt): all **1,032/1,032** leading regimens, displayed sets and ordering are unchanged; eligibility, alerts and matched-option warnings are unchanged. The repaired identity/split-representation cases were missing from the original scenario suite and are now covered. The snapshot was refreshed after reviewing that comparison, for the corrected projected regimen and rationale/version changes.

Final checks: **423 engine checks, 27 server-rendered UI groups, 1,032 golden runs, 100/100 and 51/51 audits, zero red-team critical/high/medium findings, pricing audit and 5,000 seeded fuzz cases pass.** Production build passes with the existing bundle-size warning. See [verification.txt](verification.txt). Browser interaction/visual verification and clinical validation remain open.
