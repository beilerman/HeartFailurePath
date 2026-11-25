# Symptom evidence (KCCQ) by drug class and EF band, 2026-11-15

`rows.json` holds 72 rows: 51 `cell_primary: true` rows (one per class and EF band, 17 x 3) plus 21 supporting rows (individual trials, components of pooled rows, all-EF rows with `ef_band: "all"`). `cell_primary` is an added field; use it to pick the row for a cell. Values are placebo-subtracted mean differences in points (0-100, higher better) unless `instrument` says otherwise. MLHFQ is lower-is-better and is not converted. Every number was read from a PubMed abstract or an open full text fetched in this session; where a figure was only in a chart, the interval is `null`.

## Direct evidence (measured KCCQ, in that class and EF range)

- SGLT2i: all three bands. Pooled CSS 2.14 (1.53 to 2.74) across 9 studies, no LVEF interaction (JAMA Netw Open 2024). Single trials: DAPA-HF 2.5 (8 mo), EMPEROR-Reduced 1.35 (8 mo), DELIVER 2.3 (8 mo), EMPEROR-Preserved 1.50 (52 wk), DEFINE/PRESERVED 4.6 to 6.8 (12 wk). Short 12 to 16 week trials show larger effects (3 to 7 points) than the 8 to 12 month outcome trials (1.4 to 2.5).
- GLP-1 RA (semaglutide), preserved: pooled STEP-HFpEF 7.5 (5.3 to 9.8) at 52 wk. GLP-1/GIP (tirzepatide), preserved: SUMMIT 6.9 (3.3 to 10.6). Both obesity-restricted, and placebo arms improved 9 to 13 points.
- nsMRA (finerenone), mildly reduced and preserved: FINEARTS-HF TSS 1.62 (0.69 to 2.56) at 12 mo.
- MRA (spironolactone), preserved: TOPCAT 1.35 at 12 mo (no interval in abstract).
- ARNI: reduced vs enalapril (active control) 0.93 computed from PARADIGM-HF means; mildly reduced/preserved pooled PARAGON-HF + PARALLAX 0.83 (-0.02 to 1.69), computed, vs active RAS comparators. This is the increment over an ACEi/ARB; do not stack on the ACEi/ARB rows.
- IV iron, reduced: FAIR-HF/CONFIRM-HF pooled OSS 4.45 (2.19 to 6.72) and AFFIRM-AHF OSS 3.0 (0.3 to 5.6) at 24 wk; computed pool 3.84 (2.12 to 5.56). A separate JACC Adv 2025 meta-analysis gives 6.84 (3.24 to 10.45) with mixed KCCQ scores and timepoints.
- If inhibitor, reduced: SHIFT CSS 1.8, OSS 2.4 at 12 mo (no interval).
- sGC stimulator: VICTORIA null (median 6.3 in both arms, P=0.69, no difference value retrieved); VITALITY-HFpEF physical limitation score -1.5 (-5.5 to 2.5).
- K+ binder, reduced: REALIZE-K (sodium zirconium cyclosilicate) CSS -1.01 (-6.64 to 4.63).
- ARB: reduced Val-HeFT MLHFQ -1.75 (-3.07 to -0.43), computed from least-square means; preserved I-PRESERVE MLHFQ +0.4 (-0.8 to 1.7), null.
- Vasodilator, reduced: A-HeFT MLHFQ -2.9 (difference of means, no interval).
- Digoxin, reduced: DIG quality-of-life substudy, no difference on any measure, no number.
- ACEi, reduced: SOLVD substudy, "modest benefits" on a non-KCCQ brief questionnaire, no number. Beta blocker, reduced: MERIT-HF McMaster global rating improved (P=0.009, no number) and an MLHFQ SMD of -0.30 (-0.77 to 0.18) from two small trials.

## Extrapolated (value present, but from another band, drug or class)

- SGLT2i, GLP-1 RA, nsMRA, MRA, ARNI, ARB, If inhibitor, sGC in the mildly reduced band: most trials enrolled "LVEF above 40" or "45 or above" and reported no band-specific KCCQ, so the all-LVEF number is applied (labelled in `extrapolation`).
- GLP-1 RA reduced (semaglutide) and GLP-1/GIP reduced (tirzepatide): from FIGHT, liraglutide in advanced HFrEF, CSS 1.3 (-4.0 to 6.5). Sign inferred from an unlabeled table.
- GLP-1/GIP mildly reduced: SUMMIT (LVEF 50 or above) plus the semaglutide pool.
- IV iron mildly reduced: reduced pool plus AFFIRM-AHF (LVEF below 50). IV iron preserved: IRONMET-HFpEF (ferric derisomaltose, n=65), OSS +4.4 (-2.4 to 11.2).
- MRA reduced: from TOPCAT (HFpEF). nsMRA reduced: from FINEARTS-HF. Both weak.
- ACEi mildly reduced and preserved: from I-PRESERVE (ARB), MLHFQ null.

## Assumed neutral (value 0)

If inhibitor mildly reduced and preserved (EDIFY: no benefit on any co-primary endpoint; KCCQ not in the abstract); digoxin mildly reduced and preserved (DIG substudy null); K+ binder mildly reduced and preserved (no symptom mechanism, REALIZE-K null).

## Empty (`not_measured`)

Beta blocker mildly reduced and preserved; vasodilator mildly reduced and preserved; loop diuretic all three bands; thiazide-like diuretic all three bands. For loop diuretics the only data is TRANSFORM-HF (torsemide vs furosemide, CSS 0.06, -2.26 to 2.37): a within-class comparison, not versus none.

## Effect differed by baseline status or EF

- DELIVER: placebo-corrected KCCQ-OSS at 4 months rose with frailty: 0.3 (class 1), 1.5 (class 2), 3.4 (class 3), Pinteraction 0.021. DELIVER outcome benefit was larger with worse baseline KCCQ-TSS (Pinteraction 0.026).
- EF itself: no interaction found for dapagliflozin (DAPA-HF/DELIVER pool; DEFINE/PRESERVED Pinteraction 0.79), for the SGLT2i meta-analysis, or for torsemide vs furosemide.
- STEP-HFpEF pool: largely consistent across subgroups including LVEF.

## Caveats the engine owner should know

- CIs are missing for DAPA-HF, EMPEROR, DELIVER, PARADIGM, TOPCAT, SHIFT, A-HeFT (charts or full text I could not open).
- Placebo response is large in the obesity trials and PARALLAX, so absolute change scores are not the drug effect.
- Several enrollment LVEF thresholds (STEP-HFpEF, SUMMIT, PARAGON, I-PRESERVE) come from my knowledge of trial designs, not from the fetched abstracts; rows say so where it matters.
- No unit conversion between MLHFQ and KCCQ was made.
