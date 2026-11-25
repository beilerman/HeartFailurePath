# Notes on the resolved foundational table (2026-11-15)

Files: `resolved-foundational.json` (120 rows, 10 multipliers, 12 not-representable modifiers, 39 listed-not-scored entries), `verification-foundational.md`. The table loads in `harmBurden.ts` without error for all 16 drugs (checked by running `harmBurdenFor` on a one-drug regimen; the module totals equal the hand totals below).

## Corrections to the collector (what changed and why)
- **ACE inhibitors:** the enalapril label rows (hypotension 6.7 vs 0.6, dizziness 7.9 vs 0.6) are inflated by ruling R3 (placebo from 12-week trials, drug up to a year). Replaced by SOLVD (Kostis 1996, PMID 8579032, n=6797, 40 months, same window both arms): hypotension-related symptoms 14.8 vs 7.1, cough 5.0 vs 2.0, fatigue 5.8 vs 3.5, hyperkalemia 1.2 vs 0.4, azotemia 3.8 vs 1.6, angioedema 0.4 vs 0.1. Ramipril has its own AIRE rows (label table plus AIRE 15-month average follow-up).
- **Sacubitril/valsartan:** composed rows rebuilt under R5 on the one-year scale: hypotension 4.81 (collector 10.93), cough -0.49, angioedema 0.18, creatinine 0.15, hyperkalemia -0.33, syncope 1.04.
- **Beta-blockers:** pooled heart-failure source found: Ko 2004 (PMID 15249347): annual absolute increases hypotension 1.1, dizziness 5.7, bradycardia 3.8, fatigue 0.3 (not significant). It replaces the three single-drug label sets as the class rows.
- **Eplerenone:** hyperkalemia primary is now EMPHASIS-HF (11.8 vs 7.2, T 1.75 y); creatinine rise comes from EPHESUS because the label gives the exact definition (rise above 0.5 mg/dL, 6.5% vs 4.9%).
- **CHARM:** follow-up replaced by the CHARM-Overall median 37.7 months (3.142 y) instead of the assumed 3.09 y. **HEAAL:** denominators are 1921 and 1913 analysed, not 1917 each (dose comparison only).
- **TOPCAT registry rows** took one organ-system row of a term; I summed every row of the term (serious plus non-serious). Renal serious events corrected (collector 0.0 from a single 1-vs-1 term; now serious kidney disease/failure terms 71 vs 59, one-year 0.22).
- **AV block (EMPHASIS, FINEARTS):** the generic "Atrioventricular block" term had been left out; both rows corrected.
- **Ketoacidosis:** DAPA-HF and EMPEROR-Preserved had extra ketoacidosis terms in the registry (DAPA-HF 5 vs 1).
- **Not confirmed:** the pooled empagliflozin analysis tables (PMID 38771475, full text unavailable), TOPCAT gynecomastia and volume-depletion counts, the HEAAL hazard ratio 1.21, and the hypertension engine's ALLHAT angioedema figure (0.68% vs 0.39%): 0.68% is the OCTAVE enalapril overall rate; the ALLHAT paper abstract gives no rate by race.

## Gap fills (step used)
- Step 1: ACE-inhibitor cough, fatigue, angioedema, hypotension (SOLVD); ramipril (AIRE); beta-blocker hypotension, dizziness, bradycardia, fatigue (Ko); carvedilol syncope, diarrhea, hyperglycemia (COPERNICUS, label); spironolactone and eplerenone symptom rows (registry); finerenone rows (registry, label); SGLT2 inhibitors, pooled two trials each (size-weighted); RALES gynecomastia in men; potassium 6.0 and 3.5 laboratory class rows (IPD meta-analysis, T assumed 2.56 y).
- Step 3: enalapril syncope (label, windows differ); the whole ARNI set (R5).
- Step 4: candesartan dizziness (hypertension); SGLT2-inhibitor genital infection by sex, increased urination (diabetes label pools).
- Step 5: ACE-inhibitor class rows for captopril and lisinopril; losartan from candesartan; metoprolol and bisoprolol from carvedilol; dapagliflozin non-serious hyperkalemia from empagliflozin.
- Step 6 (upper_bound true): serious renal event for ACEi, ARB, ARNI (0.38, finerenone AKI); ARB angioedema (0.09, SOLVD); ARB syncope (3.0, carvedilol); beta-blocker advanced AV block (0.261, ivabradine from the adjunct table, NOT verified by me); eplerenone gynecomastia in men (4.63, spironolactone).

## Judgement calls for the controller
1. **Step-6 rows can dominate.** ARB syncope (3.0 a year at weight 3 = 9 points) makes valsartan the dearest foundational drug (27.3 vs 16.8 without it). Beta-blocker AV block (0.261) is the opposite: an "upper bound" lower than the label band (1-3% any degree), so it probably understates. Drop or keep by policy; both are marked.
2. **Syncope in beta-blockers (carvedilol COPERNICUS 8 vs 5) is the largest beta-blocker charge (9 points)**; it is a single trial of severe HF and is applied to metoprolol and bisoprolol as sibling proxy.
3. **Ko versus single-drug rows:** I used Ko pooled as class rows (R4: it contains MERIT-HF and COPERNICUS-era trials). MERIT-HF metoprolol (bradycardia +1.1, dizziness +0.8) is much lower than Ko (3.8, 5.7). Ko's patient number is not in the abstract; it could not be checked against R4 directly.
4. **ARNI hyperkalemia comes out about zero or negative** (R5 mixes a reported-event comparator excess with a laboratory difference). Step 5 would give +1.4. Decide whether to charge ARNI hyperkalemia at the ACE inhibitor/ARB sibling level.
5. **Hyperkalemia definitions:** laboratory above 5.5 only for spironolactone (TOPCAT), eplerenone (EMPHASIS, EPHESUS) and the class potassium 6.0/3.5 rows; everything else is a reported event and understates the laboratory rate (TOPCAT: 13.1 vs 5.6 reported against 18.7 vs 9.1 laboratory).
6. **Follow-up assumption in the IPD rows** (T=2.56 y); the module cannot use rows without a one-year figure.
7. **Dose:** no dose groups could be built. Dose relations exist (ATLAS lisinopril, HEAAL losartan, RALES gynecomastia) but none is anchored to placebo; rows carry dose_related true where the label states it (lisinopril hypotension, losartan, spironolactone gynecomastia).
8. **Sex-specific rows:** gynecomastia (men), SGLT2 genital infection (separate female and male rows). The module skips a row whose sex does not match.
9. **Modifiers that exist numerically:** age 75 or older (PARADIGM-HF), Black patients (ARNI/ACE inhibitor angioedema), diabetes (MRA hyperkalemia). The collector items "by baseline systolic pressure", "by eGFR", "by baseline potassium" were NOT measured numerically in anything I could read; I did not estimate them (see `multipliers_not_representable`).

## Ten weakest rows
1. ARB-STEP6-syncope (ceiling from a different class, weight 3).
2. BB-STEP6-AVblockAdv (ceiling lower than label evidence; adjunct source not verified).
3. ARNI-R5-hyperkalemia (definition mix; about zero).
4. ARNI-R5-syncope (label windows plus serious-only difference).
5. ACEi-enalapril-syncope (R3 window mismatch).
6. MRA-STEP6-gynecomastia-eplerenone (spironolactone ceiling for a selective drug).
7. MRA/nsMRA-IPD-K60 and hypoK (assumed follow-up; pooled across trials of different length).
8. ACEi hyperkalemia and creatinine (SOLVD reported events, azotemia is not a creatinine rise).
9. SGLT2 genital infection rows (diabetes populations, 12-24 weeks, used as observed).
10. ARB valsartan rows (4-month Val-HeFT window used as observed; rounded integers) and the BB hyperglycemia row (reported event used for incident diabetes).

## Burden at the usual dose, by hand (reference patient: no multipliers; men or women extras shown separately)
Weights: mild 0.5, moderate 1, serious 3, symptom 1. Moderate hyperkalemia is charged on its excess above the severe row (module rule).

| Drug (usual dose) | Symptom figure % (weight 1) | Harm rows: one-year excess % x weight = points | Total | Total without upper-bound rows | Extra for sex |
|---|---|---|---|---|---|
| Lisinopril (20 mg/d) | 5.37 | angioedema 0.09 x 3 = 0.27; creatinineRise 0.67 x 0.5 = 0.34; hyperkalemia 0.24 x 1 = 0.24; renalSeriousEvent 0.38 x 3 = 1.14 (ceiling); syncope 0.80 x 3 = 2.41 | 9.76 | 8.62 |  |
| Enalapril (20 mg/d) | 4.09 | angioedema 0.09 x 3 = 0.27; creatinineRise 0.67 x 0.5 = 0.34; hyperkalemia 0.24 x 1 = 0.24; renalSeriousEvent 0.38 x 3 = 1.14 (ceiling); syncope 1.30 x 3 = 3.90 | 9.98 | 8.84 |  |
| Ramipril (10 mg/d) | 9.72 | angioedema 0.09 x 3 = 0.27; creatinineRise 0.40 x 0.5 = 0.20; hyperkalemia 0.24 x 1 = 0.24; renalSeriousEvent 0.38 x 3 = 1.14 (ceiling); syncope 0.80 x 3 = 2.41 | 13.98 | 12.84 |  |
| Captopril (150 mg/d) | 4.09 | angioedema 0.09 x 3 = 0.27; creatinineRise 0.67 x 0.5 = 0.34; hyperkalemia 0.24 x 1 = 0.24; renalSeriousEvent 0.38 x 3 = 1.14 (ceiling); syncope 0.80 x 3 = 2.41 | 8.49 | 7.35 |  |
| Valsartan (320 mg/d) | 14.34 | angioedema 0.09 x 3 = 0.27 (ceiling); creatinineRise 3.00 x 0.5 = 1.50; hyperkalemia 1.00 x 1 = 1.00; renalSeriousEvent 0.38 x 3 = 1.14 (ceiling); syncope 3.00 x 3 = 9.00 (ceiling) | 27.25 | 16.84 |  |
| Candesartan (32 mg/d) | 4.15 | angioedema 0.09 x 3 = 0.27 (ceiling); creatinineRise 2.11 x 0.5 = 1.06; hyperkalemia 1.38 x 1 = 1.38; renalSeriousEvent 0.38 x 3 = 1.14 (ceiling); syncope 3.00 x 3 = 9.00 (ceiling) | 16.99 | 6.58 |  |
| Losartan (50-150 mg/d) | 3.18 | angioedema 0.09 x 3 = 0.27 (ceiling); creatinineRise 2.11 x 0.5 = 1.06; hyperkalemia 1.38 x 1 = 1.38; renalSeriousEvent 0.38 x 3 = 1.14 (ceiling); syncope 3.00 x 3 = 9.00 (ceiling) | 16.03 | 5.62 |  |
| Sacubitril/Valsartan (Entresto) (97/103 mg twice daily) | 4.81 | angioedema 0.18 x 3 = 0.55; creatinineRise 0.15 x 0.5 = 0.08; renalSeriousEvent 0.38 x 3 = 1.14 (ceiling); syncope 1.04 x 3 = 3.11 [floored to 0: hyperkalemia] | 9.69 | 8.55 |  |
| Carvedilol (50 mg/d) | 12.34 | avBlockAdvanced 0.26 x 3 = 0.78 (ceiling); hyperglycemia 2.00 x 1 = 2.00; syncope 3.00 x 3 = 9.00 | 24.12 | 23.34 |  |
| Metoprolol Succinate (200 mg/d) | 12.34 | avBlockAdvanced 0.26 x 3 = 0.78 (ceiling); hyperglycemia 2.00 x 1 = 2.00; syncope 3.00 x 3 = 9.00 | 24.12 | 23.34 |  |
| Bisoprolol (10 mg/d) | 12.34 | avBlockAdvanced 0.26 x 3 = 0.78 (ceiling); hyperglycemia 2.00 x 1 = 2.00; syncope 3.00 x 3 = 9.00 | 24.12 | 23.34 |  |
| Spironolactone (25 mg/d) | 1.13 | creatinineRise 0.31 x 0.5 = 0.15; hyperkalemia 2.64 x 1 = 2.64; hyperkalemiaSevere 0.59 x 3 = 1.78; hyponatremia 0.23 x 1 = 0.23; renalSeriousEvent 0.22 x 3 = 0.65 [floored to 0: hyperuricemiaGout, hypokalemia, syncope] | 6.59 | 6.59 | men: gynecomastia 4.63 x 1 = +4.63 |
| Eplerenone (50 mg/d) | 0.97 | creatinineRise 1.22 x 0.5 = 0.61; hyperkalemia 2.15 x 1 = 2.15; hyperkalemiaSevere 0.59 x 3 = 1.78; hyponatremia 0.04 x 1 = 0.04; syncope 0.17 x 3 = 0.52 [floored to 0: avBlockAdvanced, hyperuricemiaGout, hypokalemia, renalSeriousEvent] | 6.08 | 6.08 | men: gynecomastia (step 6 ceiling) 4.63 x 1 = +4.63 |
| Finerenone (Kerendia) (20-40 mg/d) | 2.43 | avBlockAdvanced 0.06 x 3 = 0.17; creatinineRise 2.86 x 0.5 = 1.43; hyperkalemia 1.79 x 1 = 1.79; hyperkalemiaSevere 0.59 x 3 = 1.78; hyponatremia 0.10 x 1 = 0.10; renalSeriousEvent 0.38 x 3 = 1.14; syncope 0.04 x 3 = 0.13 [floored to 0: hypokalemia] | 8.98 | 8.98 |  |
| Dapagliflozin (10 mg/d) | 2.33 | hyperkalemiaSevere 0.02 x 3 = 0.06; hypoglycemiaSevere 0.01 x 3 = 0.04; ketoacidosis 0.05 x 3 = 0.14; urinaryTractInfection 0.12 x 1 = 0.12 [floored to 0: hyperkalemia, renalSeriousEvent, syncope] | 2.69 | 2.69 | women: genital infection 5.4 x 1 = +5.40; men: 2.4 x 1 = +2.40 |
| Empagliflozin (10 mg/d) | 3.05 | hypoglycemiaSevere 0.07 x 3 = 0.22; syncope 0.18 x 3 = 0.53; urinaryTractInfection 0.87 x 1 = 0.87 [floored to 0: hyperkalemia, hyperkalemiaSevere, ketoacidosis, renalSeriousEvent] | 4.67 | 4.67 | women: genital infection 3.9 x 1 = +3.90; men: 2.7 x 1 = +2.70 |

Reading the table: beta-blockers (24.1) and valsartan (27.3) look dearest; both are driven by single rows (syncope 9 points; the ARB syncope ceiling 9 points) rather than by the broad symptom figure. SGLT2 inhibitors (2.7-4.7 before sex-specific genital rows) and MRAs (6.1-9.0) are cheap largely because their registry non-serious events are partly hidden below reporting thresholds, and because several of their measured excesses are negative (floored to 0): this is a definition and ascertainment effect, not evidence that they cause no harm. ACE inhibitors (8.5-14.0) and ARNI (9.7) sit together because ARNI was built from the enalapril figure.
