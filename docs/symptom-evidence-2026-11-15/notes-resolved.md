# Resolved symptom evidence, 2026-11-15

`resolved.json` has 51 rows (17 classes x 3 EF bands), KCCQ points (0-100, higher better), placebo-subtracted unless the row says otherwise. Line-by-line checks are in `verification.md`: 52 confirmed, 8 corrected, 2 not confirmed.

## What was corrected

- Digoxin and ivabradine (mildly reduced, preserved): the researcher entered "KCCQ-CSS 0.0, assumed neutral". DIG used other scales and EDIFY reported no KCCQ in its abstract, so there is no measurement. These cells are now filled by the fixed order (R5), not marked neutral.
- IV iron: the researcher's primary 3.84 is a computed pool (arithmetic right) but a published pool exists (FAIR-HF/CONFIRM-HF, 4.45, 2.19 to 6.72), so it is used (R6). The mildly reduced cell uses AFFIRM-AHF CSS 2.9 (LVEF below 50), not the reduced pool. The preserved cell (IRONMET-HFpEF) is a same-class trial, not an extrapolation.
- ARNI: the "do not stack" note conflicts with R4, so ARNI is now base plus increment. The PARAGON+PARALLAX pool is dropped because PARALLAX's comparator included placebo.
- Potassium binder (mildly reduced, preserved): researcher assumed 0; R5(1) carries the REALIZE-K value instead.
- Two FIGHT-based cells (GLP-1 RA and GLP-1/GIP RA, reduced) are unusable: the 1.3 figure is in no source I could read.

## Conversions

KCCQ SD: 21.9 (EMPEROR-Reduced baseline KCCQ-CSS, n about 3700) for reduced; 21.2 (EMPEROR-Preserved, LVEF above 40%, n=5942) for mildly reduced and preserved. No LVEF 50+-only SD was available.

- Beta blocker, reduced: MLHFQ SMD -0.30 (-0.77 to 0.18). 0.30 x 21.9 = 6.57; interval -0.18 x 21.9 = -3.94 to 0.77 x 21.9 = 16.86.
- ARB, preserved (I-PRESERVE, MLHFQ SD 21 from its baseline 43 +/- 21): -(0.4/21) x 21.2 = -0.40; interval -1.72 to 0.81.
- ARB, reduced (Val-HeFT, 0.19 - 1.94 = -1.75; MLHFQ SD 21 borrowed from I-PRESERVE because Val-HeFT's abstract gives none): (1.75/21) x 21.9 = 1.83; interval 0.45 to 3.20.
- Vasodilator, reduced (A-HeFT, -5.6 - (-2.7) = -2.9; pooled change SD 20.9 from the trial): (2.9/20.9) x 21.9 = 3.04. No interval.
- ACEi: no number exists, so it takes the sibling ARB value in each band.
- ARNI: preserved and mildly reduced -0.40 + 1.0 (PARAGON vs valsartan) = 0.60, interval -1.05 to 2.24 (SEs combined, independence assumed). Reduced 1.83 + 0.93 (PARADIGM vs enalapril) = 2.76, no interval.

## Judgement calls

1. Mildly reduced "nearest band": where both neighbours overlap the band, the preserved side is used (HFmrEF trials enrolled with HFpEF). Used for sGC. ARB and ACEi follow from I-PRESERVE's range overlapping 45 to 49.
2. R5(1) is applied literally, so values carry into bands where they are implausible: beta blocker 6.57 and vasodilator 3.04 into mildly reduced and preserved, potassium binder -1.01, ivabradine 1.8, GLP-1 RA 7.5 and GLP-1/GIP 6.9 into reduced. A stated-neutral zero (R5(3)) ranks after.
3. SGLT2i: all bands share the published 2.14 (R6). Band-specific figures from the smaller DEFINE/PRESERVED pool (4.6, 4.9, 6.8) were not used; the meta-analysis found no LVEF interaction.
4. sGC preserved uses KCCQ physical limitation score (-1.5), outside the R1 order, because CSS was not retrievable.
5. IV iron reduced uses OSS (CSS for the pooled trials is only in a chart).
6. I-PRESERVE at 6 months (first prespecified visit); sign read as irbesartan minus placebo, not stated in the abstract.
7. A band counts as "measured" only if the trial's enrolled LVEF range contains the band. Ranges for PARAGON-HF and I-PRESERVE come from trial design, not fetched text.

## Five weakest cells

1. Beta blocker, all bands (6.57, interval -3.94 to 16.86): two tiny trials, MLHFQ, converted, then copied to bands with no data.
2. GLP-1 RA and GLP-1/GIP, reduced (7.5, 6.9): obesity HFpEF trials applied to HFrEF, where no readable measurement exists.
3. ARNI, reduced (2.76, no interval): ACEi figure borrowed from an ARB (MLHFQ-converted) plus an increment with no interval.
4. Vasodilator, mildly reduced and preserved (3.04): one trial in black patients with HFrEF, converted, no interval, copied across.
5. Potassium binder and ivabradine, non-reduced bands: nulls or small effects from HFrEF carried forward; EDIFY suggests no effect for ivabradine in HFpEF.
