# Verification of achieved-doses.json (independent check, 2026-11-15)

Verdicts: confirmed = the figure was read in at least one fetched source (kinds of source in the line); corrected = the file was wrong, incomplete or misleading and the correction is given; not_confirmed = no fetched source gives the number, or sources conflict. Primary NEJM, Lancet and Circulation texts were not reachable (HTTP 403 or not in PMC), so most dose means rest on Kondo 2022, Tillman 2019, FDA labels and PMC reviews. 'Single secondary' means only one such source was found.

Counts: 34 achieved items + 19 dose-comparison items = 53. confirmed 38, corrected 5, not_confirmed 10.

## Items you asked me to settle

- CIBIS-II mean bisoprolol dose: NOT settled (6.2 mg Kondo vs 8.6 mg Tillman; no primary text). D3 applied.
- DECISION digoxin doses: settled from the primary text: start 0.1 mg (75%) or 0.2 mg (25%), titrated to 0.5-0.9 ng/mL; the review's 0.0625-0.125 mg is not in the paper. Mean achieved dose is not reported.
- FINEARTS-HF achieved dose: found (32.3 mg of 40 at eGFR above 60; 15.6 mg of 20 at eGFR 25-60).
- A-HeFT achieved dose: not found (protocol 225/120 mg per day; 68% at target).
- SAVE, AIRE, TRACE achieved doses: not found. AIRE label: target 5 mg bid in 77%.
- TOPCAT mean spironolactone dose: 25 mg at 8 months (a 2026 review); fraction is 0.556 of the 45 mg maximum, not 0.5.
- ATLAS HF hospitalization: events 1,199 (high) vs 1,576 (low), ratio 0.761 computed; no HR or CI exists in any source read.
- HEAAL arms: losartan 150 mg (n=1927, mean 129 mg) vs 50 mg (n=1919, mean 46 mg); death HR 0.94 (0.84-1.04), HF admission 0.87 (0.76-0.98); confirmed.

## Achieved items

- `acei-solvd-t`: **confirmed**. 16.6 mg (enalapril-arm, patients taking drug) in Kondo Table 1: '16.6 mg (E) 18.0 mg (P)'. Independent arithmetic: final-visit shares 1.8% 2.5 mg, 6.7% 5 mg, 9.5% 10 mg, 49.3% 20 mg give (4.5+33.5+95+986)/67.3 = 16.6; 32.5% had discontinued, 16.6 x 0.675 = 11.2 = the 'all randomized' figure. Lam 2018 (PMC6500736 page): 'the final mean daily dose of either study drug was 11 mg and ... 49% ... were receiving target doses'. Qualifier: 16.6 is on-drug, the ITT-diluted mean is 11.2.
- `acei-solvd-p`: **confirmed**. Kondo Table 1: 'SOLVD-P | Enalapril (2111) Placebo (2117) | ... | 20 mg | 16.9 mg (E) e 18.2 mg (P) e'. Single secondary source; doses are from prescription at last visit.
- `acei-save`: **not_confirmed**. No mean daily captopril dose in any fetched page (Kondo has no SAVE row).
- `acei-aire`: **not_confirmed**. Mean dose not found. Ramipril label (DailyMed b7e49f05...): 'a target regimen (achieved in 77% of patients randomized to ramipril) of 5 mg twice daily'.
- `acei-trace`: **not_confirmed**. Not found; trandolapril is not in the formulary.
- `acei-flather-pooled`: **confirmed**. Arithmetic reproduced: (1285 x 0.83 + 2111 x 0.845)/3396 = 0.839. SOLVD is 3,396 of the pool's 12,763 patients (6,391 + 6,372, Flather abstract) = 27%.
- `acei-mildly-reduced-and-preserved`: **not_confirmed**. Holds no dose figure to check (all null); out of scope for reduced-EF anchors.
- `arb-charm`: **confirmed**. Atacand label section 14: 'The mean daily dose of ATACAND was approximately 23 mg and 59% of subjects on treatment received 32 mg once daily' (CHARM-Alternative, n=1013) and 'approximately 24 mg and 61%' (CHARM-Added, n=1276). Agrees with Kondo (23 and 24 mg).
- `arb-valheft`: **confirmed**. Kondo Table 1: 'Valsartan (2511) ... 320 mg | 254 mg (V) 283 mg (P)'. Single secondary source; the Diovan label gives the protocol (up to 160 mg bid) but no mean. Not a source of the engine row.
- `arb-heaal-losartan`: **confirmed**. Kondo Table 4 footnote: 'mean daily losartan doses administered were 129 mg (SD 39) for the 150 mg group and 46 mg (SD 11) for the 50 mg treatment group'; arms 150 mg (n=1927) vs 50 mg (n=1919) confirmed in the Konstam abstract (PMID 19922995). Doses are time-weighted from follow-up to endpoint or study end.
- `arb-preserved`: **not_confirmed**. Tillman lists 'Irbesartan (275 mg) versus placebo' (I-PRESERVE) but no formulary-relevant achieved dose; out of scope.
- `arni-paradigm`: **confirmed**. Vardeny 2016 (PMC5095784): 'final mean achieved doses of 375 mg daily and 18.9 mg daily respectively'. The Entresto label gives no mean.
- `bb-cibis2`: **not_confirmed**. CONFLICT NOT SETTLED: Kondo '6.2 mg (B) 7.3 mg (P)'; Tillman 'Bisoprolol (8.6 mg daily)'. Lancet paper and PubMed abstract (10023943) give no mean. Review citing the Lancet paper (PMC2374926): '564 patients, 42.5%, receiving 10 mg ...; 152 (11%) receiving 7.5 mg, and 176 (13%) receiving 5.0 mg'. Computed: mean of those 892 patients = 8.59 mg; adding Simon 2003's 434 patients on 1.25-3.75 mg gives 6.2-7.0 mg for all 1,327. Tillman's CIBIS-II row also states 'No significant difference in all-cause death', contradicting the abstract (HR 0.66, p<0.0001).
- `bb-merit-hf`: **confirmed**. Kondo Table 1: '159 mg (M-S) 179 mg (P)'; Tillman: 'Metoprolol CR/XL (159 mg daily) versus placebo'. Two secondary sources agree.
- `bb-copernicus`: **confirmed**. Kondo Table 1: '37 mg (C) e 41 mg (P) e | 65% (C)'. Single secondary source. Carvedilol label confirms the dose ceiling only ('daily doses up to 50 mg (n = 1,156)'); Tillman gives 'about 70% achieved target dose of 25 mg twice daily', no mean.
- `bb-us-carvedilol`: **confirmed**. Kondo Table 1: '45 mg (C) 60 mg (P) | 80% (C)'; carvedilol label: 'daily doses up to 100 mg (n = 765)'. Single secondary for the mean; not a source of the engine row.
- `bb-reduced-pooled-weighted`: **corrected**. Arithmetic reproduces 0.729 (and 0.800 with CIBIS-II at 8.6) but both depend on the unsettled CIBIS-II figure. Pool without CIBIS-II: (1990 x 0.795 + 1156 x 0.74)/3146 = 0.775 (used for D2).
- `bb-mildly-reduced-and-preserved`: **not_confirmed**. No dose figure to check; out of scope.
- `mra-rales`: **confirmed**. Aldactone label: 'The mean daily dose at study end for patients randomized to spironolactone was 26 mg.' Kondo Table 3 '26 mg (S) | 12% (S)'; Tillman 'Spironolactone (26 mg daily)'. Three sources.
- `mra-emphasis`: **confirmed**. Kondo Table 3 footnote d: 'Doses shown are at month 5 visit (overall mean dose 39 mg)'; Tillman 'Eplerenone (39.1 mg daily)'. Kondo text: 'At 5 months, the mean daily dose of eplerenone in the low eGFR/low-dose stratum was 24.8 +/- 10.8 mg and in the high eGFR/high-dose stratum it was 42.0 +/- 12.3 mg.' Stratum targets (50 mg if eGFR >=50, <=25 mg if 30-49) confirmed in the abstract of PMID 30768732.
- `mra-reduced-pooled-weighted`: **confirmed**. Arithmetic reproduced: (822 x 0.52 + 1364 x 0.78)/2186 = 0.682. The EMPHASIS term divides by 50 mg although the low-eGFR stratum's target was 25 mg, so it understates.
- `mra-topcat`: **corrected**. Mean dose confirmed: PMC13635566 (2026 review): 'the mean dose of spironolactone at 8 months was similar to the mean dose that was administered in RALES (25 mg vs 26 mg daily, respectively)'; abstract (PMID 24716680): 15 to 45 mg daily. CORRECTION: the file's fraction 0.5 is wrong against the protocol maximum 45 mg; 25/45 = 0.556 (0.5 only against 50 mg).
- `nsmra-fineartshf`: **corrected**. Was 'not found'. Found: 'The mean +/- SD achieved dose was 32.3 +/- 9.1 mg (finerenone) and 34.4 +/- 7.8 mg (placebo) in the higher eGFR/high-dose stratum, and 15.6 +/- 4.3 mg (finerenone) and 16.7 +/- 4.0 mg (placebo) in the lower eGFR/low-dose stratum' (FINEARTS-HF dosing-strategy analysis, PMID 41642173, abstract read). Fractions 0.81 of 40 and 0.78 of 20. Label (Kerendia, 2,993 patients on 10, 20 or 40 mg, mean duration 2.3 years) gives no mean dose.
- `sglt2i-dapagliflozin`: **confirmed**. DAPA-HF abstract: 'dapagliflozin (at a dose of 10 mg once daily)'. Single dose; no ladder.
- `sglt2i-empagliflozin`: **confirmed**. EMPEROR-Reduced abstract: 'empagliflozin (10 mg once daily)'. Single dose.
- `vasodilator-aheft`: **not_confirmed**. Mean achieved dose not found. Protocol confirmed (PMC1994006): 'titrated to 2 tablets 3 times daily, for a total dose of HYD 225 mg and ISDN 120 mg'; Tillman: '68% achieved target dose'. V-HeFT I average (HYD 270 mg, 136 mg ISDN) is a different trial.
- `vasodilator-hheft`: **confirmed**. Abstract (PMID 42978512): 'Target treatment was hydralazine 75 mg/isosorbide dinitrate 40 mg three times a day'. No mean dose reported.
- `ivabradine-shift`: **confirmed**. Tillman: 'SHIFT Ivabradine (6.5 mg twice daily)'; Cardiology Trials review: 'The mean ivabradine dose was 6.4 mg twice a day at 4 weeks and 6.5mg twice a day at 1 year.' Two secondary sources; Lancet text not read. Corlanor label: start 5 (2.5) mg bid, maximum 7.5 mg bid.
- `vericiguat-victoria`: **confirmed**. Verquvo label: 'increased at approximately 2 week intervals to 5 mg once daily and the target dose of 10 mg once daily ... After approximately 1 year, 90% of patients in both treatment groups were treated with the 10 mg target dose.' No mean given.
- `digoxin-dig`: **corrected**. The file's 'ach 0.25 mg' is a MEDIAN: DIG abstract (PMID 9036306) 'median dose of digoxin, 0.25 mg per day'. Tillman prints '0.25 mg daily'.
- `digoxin-decision`: **confirmed**. PMC13375525: 'As defined by the algorithm, 75% of patients started the study with 0.1 mg digoxin once daily and 25% of patients with 0.2 mg once daily'; target serum concentration 0.5-0.9 ng/mL, 'starting dose of either 0.2 or 0.1 mg'. Mean achieved dose not reported. A review's '0.0625-0.125 mg' is not in the primary text.
- `fcm`: **not_confirmed**. No dose figure in the entry; dosed by iron deficit.
- `glp1-tirzepatide`: **confirmed**. SUMMIT abstract: 'tirzepatide (up to 15 mg subcutaneously once per week)'. A ceiling, not a mean.
- `glp1-semaglutide`: **confirmed**. STEP-HFpEF abstract: 'once-weekly semaglutide (2.4 mg)'. Assigned dose, not a mean.

## Dose-comparison items

- `atlas`: **corrected**. Death HR 0.92 (0.82-1.03), p=0.128, doses 4.5 vs 33.2 mg (end of titration; whole-trial 3.2 vs 22.5): Kondo Table 4. HF hospitalization, was null: Cardiology Trials review of the Circulation paper: 'hospitalizations for heart failure were also lower in the high dose group (1,199 vs 1,576; p= 0.002)' (events, ratio 0.761 computed); abstract (PMID 10587334): '24% fewer hospitalizations for heart failure (P=0.002)'. No HR or CI in any source read.
- `heaal`: **confirmed**. Abstract: 'died (HR 0.94, 95% CI 0.84-1.04; p=0.24), and 450 versus 503 patients were admitted for heart failure (0.87, 0.76-0.98; p=0.025)'; arms 150 mg n=1927, 50 mg n=1919; primary HR 0.90 (0.82-0.99). Mean doses 129 vs 46 mg from Kondo.
- `network`: **confirmed**. Abstract (PMID 9568453): composite 62 (12.3%), 66 (12.9%), 76 (14.7%); deaths 21, 17, 15; 'crude relative risk ... 1.20 (95% CI 0.88 to 1.64)'. Achieved 5.0, 9.7, 16.7 mg/day: Kondo Table 1.
- `nanas-enalapril`: **not_confirmed**. Doses 17.9 and 42.5 mg confirmed in Kondo Table 1 (single source); outcomes not found in any source.
- `solvd-below-vs-target`: **confirmed**. Lam 2018 (PMC6500736 page): 1014 below-target patients (486 placebo, 528 enalapril), mean 8.8 mg, adjusted HR 0.68 (0.57-0.81); target stratum adjusted death HR 0.90 (0.82-0.98), HF hospitalization 0.75 (0.68-0.83), combined 0.70 (0.60-0.81). Below-target death 0.90 and HFH 0.79 are in the file; I confirmed the combined 0.68 and the target-stratum numbers.
- `mocha`: **confirmed**. Abstract (PMID 8941106): 'crude mortality rates of 6.0%, 6.7%, and 1.1% with increasing doses of carvedilol compared with 15.5% in the placebo group'; 6.25, 12.5, 25 mg bid; hospitalization lower by 58% to 64%.
- `merit-hf-dose`: **confirmed**. Europe PMC abstract of PMID 12142116 (PubMed's text drops the methods): 'more than 100 mg ... n = 1,202; mean 192 mg ... 100 mg or less ... n = 412; mean 76 mg'; '38% (95% CI, 16 to 55) in high-dose group ... 38% (95% CI, 11 to 57) in the low-dose group'. HR 0.62 values are computed (1 - 0.38) as the file says.
- `cibis2-dose`: **confirmed**. Simon 2003 abstract (PMID 12643888): last tolerated dose groups n=434, 328, 565; RH 0.66 (0.48-0.92), 0.33 (0.21-0.51), 0.59 (0.40-0.89); withdrawal RH 2.13 (1.43-3.17).
- `biostat-chf`: **confirmed**. Ouwerkerk 2017 abstract: '<50% of the recommended ... dose was associated with an increased risk'; 'Patients reaching 50-99% ... had comparable risk ... to those reaching >=100%'; 22% reached ACEi/ARB and 12% beta-blocker target. Santema 2019 abstract: women approx 30% lower risk at 50% of recommended doses. No numeric HRs by stratum.
- `paradigm-dose-reduction`: **confirmed**. Vardeny abstract: HR 0.80 (0.70-0.93) after a dose reduction and 0.79 (0.71-0.88) without; reduction in 43% (enalapril) and 42% (sacubitril/valsartan); reduction predicted higher risk (HR 2.5, 2.2-2.7).
- `dig-sdc-rathore`: **confirmed**. Abstract (PMID 12588271): HR 0.80 (0.68-0.94), 0.89 (0.74-1.08), 1.16 (0.96-1.39) for SDC 0.5-0.8, 0.9-1.1, >=1.2 ng/mL; n=572/322/277; placebo 2611.
- `dig-sdc-women`: **confirmed**. Abstract (PMID 16053964): 0.5-0.9 ng/mL death HR 0.8 (0.62-1.13), death or HF hospital stay 0.73 (0.58-0.93); 1.2-2.0 ng/mL death 1.33 (1.001-1.76).
- `emphasis-egfr-dose`: **confirmed**. Abstract (PMID 30768732): eplerenone vs placebo HR 0.58 (0.45-0.74) at eGFR >=50 (50 mg target) and 0.62 (0.49-0.78) at eGFR 30-49 (<=25 mg); P interaction 0.89.
- `rales-dose`: **confirmed**. RALES abstract (PMID 10471456): 'relative risk of death, 0.70; 95 percent confidence interval, 0.60 to 0.82'; 25 mg daily. Aldactone label: mean 26 mg at study end. PubMed abstract also confirms hospitalization 'relative risk of hospitalization, 0.65; 95 percent confidence interval, 0.54 to 0.77'.
- `sglt2-single-dose`: **confirmed**. DAPA-HF and EMPEROR-Reduced abstracts: 10 mg once daily; no dose arms.
- `incretin-single-arm`: **confirmed**. SUMMIT: 'up to 15 mg ... once per week'; STEP-HFpEF: 'semaglutide (2.4 mg)'. No dose arms. The SURMOUNT-1 weight figures were not checked.
- `dose-loop`: **confirmed**. DOSE full text (PMC3412356 page): 'between the high-dose group and the low-dose group (63 events and 67 events, respectively; hazard ratio with high dose, 0.83; 95% CI, 0.60 to 1.16; P = 0.28)'; baseline furosemide equivalent 131 +/- 52 mg/day.
- `strong-hf`: **confirmed**. Abstract (PMID 36356631): 'risk ratio 0.66 [95% CI 0.50-0.86]'; 74 (15.2%) of 506 vs 109 (23.3%) of 502. Secondary analysis abstract (PMID 38150260): at 2 weeks 7.6% low, 49.3% medium, 43.1% high doses; 10% more of optimal dose, aHR 0.89 (0.81-0.98) composite, 0.84 (0.73-0.95) all-cause death.
- `shift-bb-interaction`: **confirmed**. Corlanor label: 'Corlanor's benefit on the primary endpoint in SHIFT appeared to decrease as the dose of beta-blockers increased, with little if any benefit demonstrated in patients taking guideline-defined target doses of beta-blockers.'
