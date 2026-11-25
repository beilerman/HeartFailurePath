# Foundational outcome evidence: notes

Companion to `estimates-foundational.json` (68 rows covering all 96 drug x EF-band x outcome cells). Each row's `quote` is copied from a PubMed abstract or open full text unless `verification` says otherwise.

## How rows were built
- Pooled/IPD meta-analyses are used where they are the best band-specific source (MRAs, beta-blockers in 40-49%, SGLT2i).
- Rows with several drugs apply one estimate to all listed drugs; `basis` says whether that is a trial, a pooled analysis or an extrapolation.
- Percent reductions were converted to ratios (rr = 1 - reduction; interval limits swapped). This applies to SOLVD-T, SAVE, AIRE, COPERNICUS and the McMurray putative-placebo analysis.
- `rate_ratio` rows are recurrent (total) events, not time-to-first. This applies to all CHARM HFH rows, PARAGON, EMPEROR-Reduced HFH, FINEARTS HFH.

## Judgement calls
1. ACEi: Lisinopril has no placebo HF trial (ATLAS is high vs low dose), so it takes the Flather ACE-inhibitor class overview. Enalapril and Ramipril HFH use the same overview (their trials are in it); Captopril uses SAVE; Ramipril death uses AIRE. SAVE and AIRE are post-MI populations, not chronic HFrEF.
2. Flather figures are Peto odds ratios (`measure: OR`), not hazard ratios.
3. ARNI vs placebo, reduced EF: the published McMurray 2015 putative-placebo analysis, SOLVD-T-referenced (death 0.72, HFH 0.51). CHARM-Alternative-referenced alternative is in `notes` (0.74 and 0.54). PARADIGM-HF vs enalapril: all-cause death HR 0.84 (0.76-0.93); HFH reduced 21% (P<0.001, CI not in abstract).
4. ARNI mildly reduced / preserved are computed on the log scale (arithmetic in `extrapolation`): ARNI vs RAS inhibitor (pooled PARADIGM+PARAGON, or PARAGON vs valsartan) times a RAS-blocker-vs-placebo proxy from CHARM. Mildly-reduced HFH = 0.40 (0.27-0.59) is the weakest cell.
5. CHARM EF-stratified HFH (Lund 2018) is the only in-band RAS-blocker evidence for mildly reduced EF, so ACEi, ARB and ARNI mildly-reduced HFH all rest on candesartan IRR 0.48 (0.33-0.70), a post hoc split of a subgroup of 1322.
6. All-cause death for candesartan in each EF band is not in a retrievable abstract. CHARM-Overall HR 0.91 (0.83-1.00) is used for reduced (as trial) and mildly reduced (extrapolated). For preserved EF, CV deaths were identical (170 vs 170) so death is `assumed_neutral` 1.0 for all ACEi/ARB.
7. ACEi in preserved EF HFH: PEP-CHF perindopril 1-year HR 0.628 (0.408-0.966). The trial was underpowered and its full-follow-up composite was HR 0.919 (0.700-1.208). Sibling candesartan CHARM-Preserved is 0.78.
8. Losartan: no placebo-controlled trial. HEAAL and ELITE II are not placebo comparisons and were not retrieved. It copies candesartan.
9. Beta-blockers, reduced EF: own trial for each drug (COPERNICUS, MERIT-HF, CIBIS-II) for death. HFH is CIBIS-II 0.64 (0.53-0.79) for bisoprolol and extrapolated as a class effect to carvedilol and metoprolol; I could not retrieve HFH-alone numbers for COPERNICUS or MERIT-HF.
10. Beta-blockers, EF 40-49: death from the Cleland 2018 IPD (0.59, 0.34-1.03). That paper does not report HFH, so HFH carries over the HFrEF estimate (0.64). The same paper reports CV hospitalization HR 0.95 (0.68-1.32) in this band; that would be the alternative.
11. Beta-blockers, EF >= 50 (sinus rhythm): death HR 1.79 (0.78-4.10) and HFH proxy 0.66 (0.37-1.18, actually CV hospitalization). Both are from a 244-patient subgroup. Recorded as published per rule 3; they point in opposite directions and carry almost no information. The death CI upper limit 4.10 exceeds the requested (0, 3) range, which is why the validator flags it.
12. MRAs: the Lancet 2024 IPD meta-analysis (RALES, EMPHASIS-HF, TOPCAT, FINEARTS-HF) supplies pooled estimates, split HFrEF vs HFmrEF/HFpEF. It is not band-specific within EF >=40. Spironolactone preserved HFH uses TOPCAT overall (0.83), not the Americas-only analysis. Eplerenone HFH reduced uses the pooled HFrEF estimate because EMPHASIS-HF's HFH-alone HR was not retrievable.
13. Finerenone, reduced EF: no trial; steroidal-MRA HFrEF pooled estimate applied (largest assumption in the MRA block). FINEARTS-HF HFH is total worsening-HF events (including urgent visits), same value in both bands.
14. SGLT2i: Dapagliflozin and empagliflozin reduced-EF HFH are total/first worsening-HF events with urgent visits (DAPA-HF 0.70; EMPEROR-Reduced total HFH 0.70). Empagliflozin reduced death is the pooled Zannad estimate (EMPEROR-Reduced's own death HR not retrieved). Dapagliflozin mildly reduced/preserved death uses the pooled DAPA-HF+DELIVER estimate (0.90), which says no EF interaction, while empagliflozin's own EF >=50 death HR is 1.02 and 41-49 is 0.96.

## Unverified rows
- `arb-valsartan-reduced-death`: Val-HeFT numeric RR 1.02 (0.88-1.18) came from a web-search summary of a secondary review. PubMed abstract only says "Overall mortality was similar".
- `arb-valsartan-reduced-hfh`: abstract confirms 455 (18.2%) vs 346 (13.8%) HF hospitalizations but gives no ratio. 0.72 (27.5% reduction) is from a search summary; no CI.

## Secondary-source quotes (not abstract or full text of the primary)
- `bb-bisoprolol-reduced-hfh` plus the two rows extrapolated from it: CIBIS-II HFH 0.64 (0.53-0.79) from a clinical-trial protocol document surfaced by search.
- `bb-all-preserved-death`, `bb-all-preserved-hfh`: Cleland 2018 Table 2 values retrieved through a page-fetch summarizer of the open-access article, not copied by hand. Re-check Table 2 before relying on them.

## Where sources disagree or nuance matters
- PARAGON-HF pooled with PARADIGM-HF says ARNI benefit varies by LVEF; band-specific HRs live only in its figures, which I did not retrieve.
- TOPCAT Americas vs Russia/Georgia show different effects; overall estimate used.
- Dapagliflozin pooled (death 0.90) vs empagliflozin by band (1.02 at >=50): same class, different point estimates.
- Cleland 2018: mortality benefit in 40-49% but CV hospitalization 0.95.

## Not used
SOLVD-T HFH alone, CONSENSUS, Garg & Yusuf, ATLAS, SOLVD-P, EMPEROR-Reduced own HRs, DELIVER/EMPEROR-Preserved all-cause death from abstracts (absent), Vaduganathan 2022 band data (abstract has only pooled composite), FINE-HEART pooled (not located).
