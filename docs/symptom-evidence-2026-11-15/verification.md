# Verification, symptom evidence table, 2026-11-15

Format: id | verdict | quote or corrected value. Sources fetched this session: PubMed abstracts (efetch), Europe PMC / PMC full text where open. Rows with no value (`not_measured`, no source) are skipped: bb-mildly_reduced-none, bb-preserved-none, vasodilator-mildly_reduced-none, vasodilator-preserved-none, loop-reduced-none, loop-mildly_reduced-none, loop-preserved-none, thiazide-reduced-none, thiazide-mildly_reduced-none, thiazide-preserved-none.

- `sglt2i-reduced-css-meta` | confirmed | JAMA Netw Open 2024 (PMID 38573633; also full text): "KCCQ-CSS (MD, 2.14 points; 95% CI, 1.53-2.74 points; P < .001)". EF subgroup values are in a supplement (not retrieved); full text says no significant KCCQ interaction by baseline LVEF. Band-specific pool: not retrievable.
- `sglt2i-mildly_reduced-css-meta` | confirmed | JAMA Netw Open 2024 (PMID 38573633; also full text): "KCCQ-CSS (MD, 2.14 points; 95% CI, 1.53-2.74 points; P < .001)". EF subgroup values are in a supplement (not retrieved); full text says no significant KCCQ interaction by baseline LVEF. Band-specific pool: not retrievable.
- `sglt2i-preserved-css-meta` | confirmed | JAMA Netw Open 2024 (PMID 38573633; also full text): "KCCQ-CSS (MD, 2.14 points; 95% CI, 1.53-2.74 points; P < .001)". EF subgroup values are in a supplement (not retrieved); full text says no significant KCCQ interaction by baseline LVEF. Band-specific pool: not retrievable.
- `sglt2i-reduced-dapahf` | confirmed | PMID 31736335: "2.8, 2.5 and 2.3 points higher versus placebo" (TSS, CSS, OSS) at 8 months. No interval in source.
- `sglt2i-reduced-emperor-reduced` | confirmed | Full text PMC8014525: "Empagliflozin significantly improved KCCQ-CSS (by 1.94, 1.35, and 1.61 points) ... at 3, 8, and 12 months". Not in abstract; no interval in text. Baseline KCCQ-CSS 70.7 (21.9).
- `sglt2i-reduced-define-hf` | confirmed | PMID 37203441: EF<=40 "4.6 points [95% CI, 1.0-8.1]" at 12 weeks.
- `sglt2i-reduced-determine` | confirmed | PMID 38059368: "median placebo-corrected difference in KCCQ-TSS ... at 16 weeks was 4.2 (95% CI, 1.0, 8.2)". Median, not mean.
- `sglt2i-mildly_reduced-deliver` | confirmed | PMID 36526515: "KCCQ-TSS, -PLS, -CSS, and -OSS (2.4, 1.9, 2.3, and 2.1 points higher vs placebo)" at 8 months. No interval.
- `sglt2i-mildly_reduced-define-preserved-41to60` | confirmed | PMID 37203441: ">40 to <=60 (4.9 points [95% CI, 0.8-9.0])".
- `sglt2i-preserved-emperor-preserved` | confirmed | PMID 34779658: "+1.03, +1.24, and +1.50 at 12, 32, and 52 weeks". No interval.
- `sglt2i-preserved-preserved-hf-over60` | confirmed | PMID 37203441: ">60% (6.8 points [95% CI, 1.5-12.1]; Pinteraction=0.79)".
- `sglt2i-preserved-determine` | confirmed | PMID 38059368: "3.2 (95% CI, 0.4, 6.0; P=0.079)" for HFpEF KCCQ-TSS at 16 weeks (CI and P as printed do not agree; abstract copied).
- `sglt2i-all-chief-hf` | confirmed | PMID 35228753: "4.3 points (95% confidence interval, 0.8-7.8; P = 0.016)" KCCQ-TSS at 12 weeks.
- `glp1-preserved-css-pooled` | confirmed | PMID 38599221: "KCCQ-CSS 7.5 points [95% CI 5.3 to 9.8]" at week 52; EF at least 45%; consistent across subgroups incl. LVEF.
- `glp1-preserved-step-hfpef` | confirmed | PMID 37622681: "estimated difference, 7.8 points; 95% CI, 4.8 to 10.9".
- `glp1-preserved-step-hfpef-dm` | confirmed | PMID 38587233: "estimated difference, 7.3 points; 95% CI, 4.1 to 10.4".
- `glp1-mildly_reduced-css` | confirmed | Value as above. STEP-HFpEF enrolled LVEF at least 45% (pooled abstract), so only part of this band; extrapolated is the right label.
- `glp1-reduced-fight-liraglutide` | not_confirmed | FIGHT abstract (PMID 27483064) reports the primary composite and clinical events only; no KCCQ number. Full text not open access (Europe PMC: not in EPMC). A 2026 Cureus meta-analysis found (PMID 42292722) gives a KCCQ-CSS 7.4 pool dominated by HFpEF trials, not HFrEF. Not used.
- `glpgip-preserved-summit` | confirmed | PMID 39555826: "between-group difference, 6.9; 95% CI, 3.3 to 10.6" at 52 weeks; LVEF at least 50%.
- `glpgip-mildly_reduced-extrap` | confirmed | Value as SUMMIT. SUMMIT enrolled LVEF 50+, so nothing in this band; extrapolated is right.
- `glpgip-reduced-extrap` | not_confirmed | Depends on FIGHT 1.3 (-4.0 to 6.5), which could not be read (see glp1-reduced-fight-liraglutide). Also FIGHT is a different class here (liraglutide).
- `iviron-reduced-pooled-oss` | confirmed | Arithmetic recomputed: OSS 4.45 (2.19-6.72), SE 1.156; AFFIRM OSS 3.0 (0.3-5.6), SE 1.352; weights 0.748 and 0.547; pooled 3.84, SE 0.879, 95% CI 2.12 to 5.56. Matches. Selection under R6 changed (published pool exists): see resolved.json.
- `iviron-reduced-fair-confirm` | confirmed | Full text PMC9313582: "KCCQ OSS ... week 24 ... fixed-effects model LS mean difference: 4.45 [95% CI 2.19; 6.72] points". Week 12 was 4.36 (2.14; 6.59). CSS "similar", not numbered (chart).
- `iviron-reduced-affirm-ahf` | confirmed | PMID 34080008: "Week 24: 3.0 (0.3-5.6) for OSS and 2.9 (0.2-5.6) for CSS". Row value is the CSS.
- `iviron-mildly_reduced-extrap` | corrected | 3.84 is the reduced-band pool carried over. AFFIRM-AHF (LVEF below 50, which wholly contains this band) gives CSS 2.9 (0.2-5.6) at week 24 and is the in-band measurement; resolved row uses it.
- `iviron-preserved-ironmet` | corrected | Number confirmed, PMID 42999950: "KCCQ-Overall Summary Score did not differ significantly between groups (FDI group, +4.4 [95% CI, -2.4 to 11.2]; P=0.20)" at 12 weeks. Basis corrected: it is a same-class (IV iron) trial in the preserved band, not an extrapolation.
- `iviron-all-jacc-adv-meta` | confirmed | Full text PMC12834078: "IV iron significantly improved KCCQ score >=5 points ... (mean difference: 6.84; 95% CI: 3.24-10.45; P = 0.0002; I2 = 27%) (Supplemental Figure 1)". Number is real; the trial list, EF range and instruments are in the supplement and could not be read (text says 3 of 4 IV iron trials were HFrEF/HFmrEF, 1 HFpEF). Not used.
- `arni-reduced-paradigm` | confirmed | PMID 28784687: "KCCQ clinical summary score (+0.64 versus -0.29; P=0.008)" at 8 months versus enalapril; difference 0.93 computed. No interval.
- `arni-mildly_reduced-pooled` | corrected | Arithmetic confirmed (PARAGON SE 0.536, PARALLAX SE 0.740; pooled 0.835, -0.015 to 1.685). Corrected: basis is computed, and PARALLAX comparator was RAS inhibitor or placebo (PMID 34783839), not an ARB, so the pool is not a pure increment over an ARB. Resolved rows use PARAGON alone (R4).
- `arni-preserved-pooled` | corrected | Same as arni-mildly_reduced-pooled.
- `arni-preserved-paragon` | confirmed | PMID 36394533: "LSM adjusted difference of 1.0 (95% CI 0.0, 2.1; p = 0.051)" KCCQ-CSS at 8 months versus valsartan.
- `arni-mildly_reduced-parallax` | confirmed | PMID 34783839: "KCCQ clinical summary score (12.3 vs 11.8; mean difference, 0.52; 95% CI, -0.93 to 1.97)" at week 24; LVEF above 40%.
- `acei-reduced-solvd` | confirmed | PMID 8294693: "Modest benefits in quality of life for > or = 1 year ... enalapril"; 14-scale brief questionnaire, no estimate, no KCCQ. Value correctly empty.
- `acei-mildly_reduced-extrap` | confirmed | I-PRESERVE PMID 22267751: "mean adjusted difference, 0.4; 95% confidence interval, -0.8 to 1.7" at 6 months. Direction not stated in the abstract; its end-of-study value "2.0 (-4.1 to 0.01)" is internally inconsistent.
- `acei-preserved-extrap` | confirmed | I-PRESERVE PMID 22267751: "mean adjusted difference, 0.4; 95% confidence interval, -0.8 to 1.7" at 6 months. Direction not stated in the abstract; its end-of-study value "2.0 (-4.1 to 0.01)" is internally inconsistent.
- `arb-reduced-valheft` | confirmed | PMID 15880333: "0.19 +/- 0.47 versus 1.94 +/- 0.48; P = .005"; difference -1.75 correct, lower MLHFQ = better. Interval -3.07 to -0.43 recomputed (SE 0.672) and matches, but is computed assuming independent means; P=0.005 implies about -2.97 to -0.53.
- `arb-preserved-ipreserve` | confirmed | PMID 22267751 as above. Baseline MLHFQ "43+/-21" (n=3605).
- `arb-mildly_reduced-extrap` | confirmed | As above; I-PRESERVE range (45+) only partly overlaps this band.
- `bb-reduced-meta-mlhfq` | confirmed | Full text PMC12834078: "beta-blockers (SMD: -0.30; 95% CI: -0.77 to 0.18; P = 0.22; I2 = 0%)" for MLHFQ, 2 trials (Goldstein 1999 pilot; Hawkins 2009, HF with COPD). Direction: same paragraph, "IV iron numerically improved MLHFQ score ... (SMD: -0.91)", so negative = improvement. Not a KCCQ-scale value; needs conversion (R2).
- `bb-reduced-merit-hf` | confirmed | PMID 10714728: "McMaster Overall Treatment Evaluation score ... improved in the metoprolol CR/XL group ... (P = .009)". No number.
- `mra-preserved-topcat` | confirmed | PMID 26962133: "12-month (1.35 better; P=0.02)"; KCCQ type not stated in the abstract; LVEF 45% or more. No interval.
- `mra-mildly_reduced-topcat` | confirmed | Value as TOPCAT; range 45+ overlaps only part of band.
- `mra-reduced-extrap` | confirmed | Value as TOPCAT (HFpEF); nothing in HFrEF.
- `mra-preserved-aldo-dhf` | confirmed | PMID 23443441: "did not improve heart failure symptoms or quality of life"; no number in abstract (row said not extracted).
- `nsmra-mildly_reduced-finearts` | confirmed | PMID 39520455: "mean difference at 12 months of 1.62 points (95% CI: 0.69-2.56 points)", KCCQ-TSS; trial enrolled LVEF 40% or more.
- `nsmra-preserved-finearts` | confirmed | PMID 39520455: "mean difference at 12 months of 1.62 points (95% CI: 0.69-2.56 points)", KCCQ-TSS; trial enrolled LVEF 40% or more.
- `nsmra-reduced-extrap` | confirmed | Value as FINEARTS-HF; trial enrolled LVEF 40% or more, so nothing in HFrEF.
- `if-reduced-shift` | confirmed | PMID 21875859: "improved KCCQ by 1.8 for CSS and 2.4 for OSS (placebo-corrected, P = 0.02 and P < 0.01)" at 12 months. No interval.
- `if-mildly_reduced-edify` | corrected | PMID 28462519: EDIFY (LVEF 45%+) "No evidence of improvement was found in any of the three co-primary endpoints" (E/e', 6MWT, NT-proBNP). No KCCQ is reported in the abstract, so "KCCQ-CSS 0.0" is not a measurement; value is a fill (R5), not a trial result.
- `if-preserved-edify` | corrected | PMID 28462519: EDIFY (LVEF 45%+) "No evidence of improvement was found in any of the three co-primary endpoints" (E/e', 6MWT, NT-proBNP). No KCCQ is reported in the abstract, so "KCCQ-CSS 0.0" is not a measurement; value is a fill (R5), not a trial result.
- `sgc-reduced-victoria` | confirmed | PMID 35656822: "CSS improved by a median of 6.3 in both arms; no significant differences ... (P=0.69, 0.97, and 0.13 for CSS, TSS, and OSS)". No estimate, correctly empty; resolved as R3 zero.
- `sgc-preserved-vitality` | confirmed | PMID 33079152: "15-mg/d vericiguat and placebo groups was -1.5 (95% CI, -5.5 to 2.5; P = .47)", KCCQ physical limitation score, 24 weeks; sign: vericiguat numerically lower. CSS not found; full text fetch failed.
- `sgc-mildly_reduced-vitality` | confirmed | Value as VITALITY-HFpEF (mean LVEF 56%).
- `sgc-preserved-socrates` | confirmed | PMID 28586537: physical limitations "+17.2 +/- 19.1 at 12 weeks, compared with +4.5 +/- 21.6 in placebo" gives 12.7 (computed, 10 mg arm, phase 2, no interval). CSS difference not reported, only responder rates.
- `digoxin-reduced-dig` | confirmed | PMID 12612867: "At 12 months, there was no statistically significant difference in ... Minnesota Living with Heart Failure ... between the digoxin and placebo groups." No estimate; resolved as R3 zero.
- `digoxin-mildly_reduced-assumed` | corrected | DIG substudy used perceived health, physical functioning, MLHFQ, depression and others, not KCCQ; the "KCCQ-CSS 0.0" instrument is wrong. Value is a fill, not a measurement.
- `digoxin-preserved-assumed` | corrected | DIG substudy used perceived health, physical functioning, MLHFQ, depression and others, not KCCQ; the "KCCQ-CSS 0.0" instrument is wrong. Value is a fill, not a measurement.
- `vasodilator-reduced-aheft` | confirmed | PMID 15533851: "change in score, -5.6+/-20.6 vs. -2.7+/-21.2, with lower scores indicating better quality of life; P=0.02" MLHFQ; difference -2.9 computed; no interval; timepoint not in abstract.
- `loop-all-transform-hf` | confirmed | PMID 37212600: "adjusted mean difference, 0.06 [95% CI, -2.26 to 2.37]" KCCQ-CSS at 12 months, torsemide vs furosemide.
- `kbinder-reduced-realize-k` | confirmed | PMID 39566872: "Kansas City Cardiomyopathy Questionnaire-Clinical Summary Score at 6 months (-1.01 points; 95% CI: -6.64 to 4.63; P = 0.72)".
- `kbinder-mildly_reduced-assumed` | confirmed | Value as REALIZE-K; HFrEF only. Researcher label assumed_neutral value 0 is replaced by R5(1) in resolved.json (an ordering change, not a source error).
- `kbinder-preserved-assumed` | confirmed | Value as REALIZE-K; HFrEF only. Researcher label assumed_neutral value 0 is replaced by R5(1) in resolved.json (an ordering change, not a source error).

## Counts

- confirmed: 52
- corrected: 8
- not_confirmed: 2
- skipped (no value): 10
- total rows: 72

Corrected rows: iviron-mildly_reduced-extrap, iviron-preserved-ironmet, arni-mildly_reduced-pooled, arni-preserved-pooled, if-mildly_reduced-edify, if-preserved-edify, digoxin-mildly_reduced-assumed, digoxin-preserved-assumed.

Not confirmed: glp1-reduced-fight-liraglutide, glpgip-reduced-extrap (FIGHT KCCQ 1.3 not readable from any fetched source).

Specific checks asked for: beta-blocker SMD -0.30 confirmed with direction (MLHFQ, negative = improvement); IV iron 3.84 arithmetic confirmed, 6.84 real but its composition is unreadable; ARNI figures confirmed as increments over enalapril/valsartan (PARALLAX comparator includes placebo); SGLT2i pooled 2.14 confirmed, band-specific pool only in an unreadable supplement (band figures exist only in the smaller DEFINE/PRESERVED pool); A-HeFT -2.9 MLHFQ confirmed (computed from -5.6 vs -2.7); TOPCAT 1.35 confirmed; SHIFT 1.8 confirmed; FINEARTS-HF 1.62 TSS confirmed; STEP-HFpEF pooled 7.5 and SUMMIT 6.9 confirmed; VICTORIA no estimate, VITALITY -1.5 PLS confirmed.
