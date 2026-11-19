# Resolved foundational table: notes

42 rows, one per drug class, EF band and outcome, in `resolved-foundational.json`. Relative risk versus placebo or no such drug. All drugs in a class share one estimate. Sacubitril/valsartan is its own class. Verification of the first researcher's 68 rows is in `verification-foundational.md`.

Labels: direct trial, pooled (published or my own inverse-variance pool of verified rows), extrapolated, assumed.

## Per class and band

ACEi (lisinopril, enalapril, ramipril, captopril)
- Reduced: pooled. Flather 2000 overview of five trials, Peto odds ratios. Death 0.80 (0.74-0.87), HF readmission 0.67 (0.61-0.74). Three of the five trials were post-infarction. Solid.
- Mildly reduced: extrapolated from candesartan (CHARM, LVEF 40-49). Death 0.91 (0.83-1.00) is the all-EF CHARM figure because the band figure was not retrievable. HF hospitalization 0.72 (0.55-0.95), time-to-first, quoted through a secondary source. Weak.
- Preserved: pooled randomized (Cochrane 2021, LVEF >40). Death 1.04 (0.75-1.45), HF hospitalization 0.86 (0.64-1.15). Neutral-leaning, imprecise. Moderate certainty, small trials.

ARB (valsartan, candesartan, losartan)
- Reduced: direct trial pool. CHARM low-LVEF (Young 2004), death 0.88 (0.79-0.98), HF hospitalization 0.76 (0.68-0.85), time-to-first. CHARM-Alternative alone was not retrievable. Losartan and valsartan copy candesartan. Solid.
- Mildly reduced: extrapolated from CHARM. Same as ACEi. Weak.
- Preserved: pooled randomized (Cochrane 2021). Death 1.01 (0.92-1.11), HF hospitalization HR 0.90 (0.80-1.01). Solid and close to neutral.

ARNI (sacubitril/valsartan)
- Reduced: extrapolated, indirect. McMurray 2015 putative-placebo analysis (via SOLVD-T). Death 0.72 (0.61-0.85), HF hospitalization 0.51 (0.42-0.61). Not a randomized placebo comparison; the randomized comparison with enalapril is 0.84 for death.
- Mildly reduced: extrapolated, product of two ratios. Death 0.80 (0.71-0.91), HF hospitalization 0.60 (0.45-0.81). Weak: each ratio is an all-EF or post hoc number.
- Preserved: extrapolated, product of two ratios. Death 0.98 (0.83-1.16), HF hospitalization 0.78 (0.66-0.93).

Beta blocker (carvedilol, metoprolol succinate, bisoprolol)
- Reduced: death is my pool of CIBIS-II, MERIT-HF, COPERNICUS, 0.66 (0.58-0.74), solid. HF hospitalization 0.64 (0.53-0.79) is CIBIS-II only and I could not open the source (see weakest cells).
- Mildly reduced: death is the Cleland 2018 IPD, 0.59 (0.34-1.03), direct but few events. HF hospitalization 0.92 (0.52-1.60) is a first-principles extrapolation. Weak.
- Preserved: death assumed neutral, 1.0 with an envelope interval 0.65-4.10, because the evidence conflicts. HF hospitalization 0.73 (0.47-1.13), pooled randomized, very low certainty.

MRA (spironolactone, eplerenone)
- Reduced: pooled individual-patient analysis (RALES + EMPHASIS-HF), death 0.73 (0.65-0.83), HF hospitalization 0.63 (0.55-0.72). Solid.
- Mildly reduced and preserved: pooled analysis of LVEF >=40 trials (TOPCAT + FINEARTS-HF), death 0.94 (0.85-1.03), HF hospitalization 0.82 (0.74-0.91). Same figures for both bands; the pool is mostly LVEF >=50 and includes finerenone.

nsMRA (finerenone)
- Reduced: extrapolated from the steroidal MRA HFrEF pool (no finerenone HFrEF trial). Weak by construction.
- Mildly reduced and preserved: the same pooled LVEF >=40 figures as MRA. FINEARTS-HF's own all-cause death HR is not in its abstract and its HF hospitalization figure is a recurrent-event ratio that includes urgent visits (0.82 (0.71-0.94)), so the ruling's fallback to the pool applies. The two agree.

SGLT2i (dapagliflozin, empagliflozin)
- Reduced: pooled. Death 0.87 (0.77-0.98) (Zannad 2020, DAPA-HF + EMPEROR-Reduced). HF hospitalization 0.72 (0.67-0.78) is the five-trial first-hospitalization pool because the reduced-only figure was not retrievable.
- Mildly reduced and preserved: HF hospitalization 0.74 (0.67-0.83), time-to-first, DELIVER + EMPEROR-Preserved pool. Death 0.97 (0.89-1.07) is my pool of LVEF >40 strata (the Lancet 2022 paper's LVEF >40 death figure was not in the abstract). Same figures for both bands.

## Weakest cells
1. Beta blocker, reduced, HF hospitalization: the CIBIS-II figure 0.64 is not confirmed in any source I could open; everything downstream (the 40-49 extrapolation) depends on it.
2. Beta blocker, mildly reduced, HF hospitalization: extrapolated from a CV-hospitalization HR of 0.95 and an unverified exponent; interval 0.52-1.60.
3. Beta blocker, preserved, death: assumed neutral over conflicting randomized evidence.
4. ARNI, mildly reduced, HF hospitalization and death: two indirect factors, each an all-EF or post hoc number.
5. ACEi and ARB, mildly reduced, death and HF hospitalization: the LVEF 40-49 figures come from a post hoc subgroup of one trial; the death figure is the all-EF value.
6. nsMRA, reduced: no trial.
7. ARNI, preserved: product of ARNI vs valsartan/usual care (one comparator is not an ARB) and ARB vs placebo; high heterogeneity between the two ARNI trials (I2 82%).
8. SGLT2i, mildly reduced HF hospitalization: EMPEROR-Preserved alone shows 0.58 at LVEF 41-49 and 0.78 at >=50; the shared 0.74 hides that spread.

## Where I disagreed with the first researcher
- ARNI mildly reduced HF hospitalization: 0.40 (0.27-0.59) became 0.60 (0.45-0.81). Their arithmetic was right but it multiplied a first-event HR by a recurrent-event rate ratio (0.48) rather than the first-event HR (0.72).
- ARNI preserved: death used CV death as a proxy for all-cause (0.95); HF hospitalization multiplied two recurrent-event ratios (0.66). Now 0.98 (0.83-1.16) and 0.78 (0.66-0.93) from randomized pooled first-event/all-cause data.
- Beta blocker, mildly reduced, HF hospitalization: 0.64 carried over from HFrEF; now 0.92 (0.52-1.60).
- Beta blocker, preserved: the 0.66 labelled as HF hospitalization was cardiovascular hospitalization; HF hospitalization is now the Cochrane pool 0.73 (0.47-1.13). Death is neutral rather than 1.79.
- Beta blocker, reduced death: separate trial values replaced by one pooled estimate.
- ACEi and ARB preserved death: "assumed neutral 1.0" replaced by published randomized estimates (1.04 and 1.01 with intervals).
- ARB reduced: all-EF CHARM death 0.91 replaced by the LVEF <=40 pool 0.88; recurrent-event 0.68 replaced by time-to-first 0.76. Val-HeFT numbers (RR 1.02 and 0.72) were not in the abstract and are not used.
- ACEi preserved HF hospitalization: PEP-CHF 1-year HR 0.63 (a single small trial) replaced by the pooled Cochrane estimate 0.86 (0.64-1.15).
- SGLT2i: class pooling replaced separate dapagliflozin (0.90 all-EF) and empagliflozin (0.96, 1.02) death values.
