# Verification, adjunct classes (2026-11-15)

Verifier: independent check; every number below was read in this session from a PubMed abstract, a Europe PMC / PMC full text, a DailyMed label or a ClinicalTrials.gov record. One line per collector row (75) and multiplier (8).

## Rows

- iva-af-label-ppy | confirmed | label: "5.0% per patient-year ... and 3.9% per patient-year"
- iva-af-label-cum | confirmed | label Table 2: Atrial fibrillation 8.3% vs 6.6% (N 3260 vs 3278); median exposure 21.5 months; same data as the per-patient-year row
- iva-af-ctgov | confirmed | registry: serious 126 vs 106 + other 161 vs 123 (3232 vs 3260) = 8.88% vs 7.03%; may double count a patient
- iva-avb-ctgov | confirmed | registry serious AV block: complete 9 vs 2, 2nd 7 vs 4, 3rd 8 vs 2 = 24 vs 8; 0.743% vs 0.245%; converted over 22.9 months = excess 0.261 (arithmetic right). Complete and third degree are near-synonyms: upper bound (kept, flagged)
- iva-brady-symptomatic-lancet | confirmed | "150 (5%) of ivabradine patients had symptomatic bradycardia compared with 32 (1%) of the placebo group"; 3241 vs 3264; median follow-up 22.9 months; excess 1.937
- iva-brady-all-label | confirmed | label: bradycardia 6.0% per patient-year (2.7% symptomatic) vs 1.3%; counts asymptomatic; not used
- iva-phosphenes-lancet | confirmed | "89 (3%) ... and 17 (1%)"; excess 1.175 after conversion
- iva-phosphenes-label | confirmed | label Table 2: phosphenes 2.8% vs 0.5%
- iva-dizziness-ctgov | confirmed | registry other events: dizziness 55 of 3232 vs 45 of 3260
- iva-hypotension-ctgov | confirmed | registry other events: hypotension 59 vs 82; negative
- iva-creat-ctgov | confirmed | registry other events: blood creatinine increased 55 vs 47
- ver-anemia-label | confirmed | label Table 1: "Anemia 10 7" (N = 2,519 vs 2,515); whole numbers
- ver-syncope-nejm | confirmed | "syncope occurred in 4.0% ... and in 3.5%"; median 10.8 months
- ver-hypotension-victor | confirmed | "345 [11.3%] ... 281 [9.2%]"; median 18.5 months; conversion gives 1.415 (arithmetic right)
- ver-hypotension-victoria | confirmed | "Symptomatic hypotension occurred in 9.1% ... 7.9%"
- ver-hypotension-label | confirmed | label: Hypotension 16 vs 15 (grouped reaction, not symptomatic)
- ver-dizziness-ctgov | confirmed | registry: dizziness 169 of 2519 vs 152 of 2515
- ver-gi-ctgov | confirmed | registry other events: diarrhoea 127 vs 120 (nausea and vomiting not listed above the threshold)
- ver-dae-ctgov | not_confirmed | VICTORIA registry participant-flow module lists only death, lost to follow-up, site terminated and withdrawal by subject; no adverse-event discontinuation count found. Row dropped from the resolved table (cross-check only).
- vas-headache-label | confirmed | BiDil label Table 1: Headache 50 21 (N=517 vs 527)
- vas-dizziness-label | confirmed | BiDil label Table 1: Dizziness 32 14 (N=517 vs 527)
- vas-hypotensionSymptomatic-label | confirmed | BiDil label Table 1: Hypotension 8 4 (N=517 vs 527)
- vas-fatigue-label | confirmed | BiDil label Table 1: Asthenia 14 11 (N=517 vs 527)
- vas-giUpset-label | confirmed | BiDil label Table 1: Nausea 10 6; Vomiting 4 2 (N=517 vs 527)
- vas-vt-label | confirmed | BiDil label Table 1: Ventricular tachycardia 4 2 (N=517 vs 527)
- vas-dae-label | confirmed | label: "21% of the patients discontinued BiDil for adverse reactions compared to 12%"
- vas-lupus-cameron | corrected | numbers confirmed (6.7% at 3 years; 5.4% at 100 mg; 10.4% at 200 mg; none at 50 mg; no control group). CORRECTED use: 2.285 is the all-dose figure; the BiDil target (225 mg) sits at the 200 mg group, 10.4% over 3 y = 3.594 a year. Placebo rate 0 remains an assumption.
- ino-toxhosp-label | confirmed | label: "2% in patients taking LANOXIN compared to 0.9% in patients taking placebo". Follow-up settled: label says "37-week" (typo); DIG NEJM abstract (PMID 9036306): "average follow-up, 37 months". 37/12 = 3.083 y is right. SUPERSEDED in the resolved table by the one-year DIG post hoc row (44/3889 vs 13/3899).
- iron-hypersens-heartfid | confirmed | registry: Hypersensitivity (serious) 3 of 1532 vs 0 of 1533
- iron-hypersens-label | confirmed | label: "serious anaphylactic/anaphylactoid reactions were reported in 0.1% (2/1,775)"; no control
- iron-hypophos-wolf | confirmed | abstract: trial A 7.9% vs 75.0%, trial B 8.1% vs 73.7%; pooled 74.35 vs 8.0 reasonable (123 vs 122 patients)
- iron-hypophos-label | confirmed | label Table 2: Hypophosphatemia 2.1 vs 0.1 (pooled comparators, not placebo); label also gives laboratory phosphorus <2 mg/dL in 27% (440/1,638)
- iron-hypophos-heartfid-serious | confirmed | registry: Hypophosphataemia (serious) 1 of 1532 vs 0 of 1533
- iron-inj-confirm | corrected | numbers right (9 of 152 vs 2 of 152) but the category is "General disorders and administration site conditions" among drug-related events (2 injection-site discolouration, 4 feeling hot), not injection-site reactions. Row kept with the corrected definition.
- iron-dae-confirm | confirmed | CONFIRM-HF Table 3: "AE leading to study drug withdrawal 14 (9.2) 14 19 (12.5) 19"
- kb-hypok-pearl | confirmed | PEARL-HF Table 2: "Serum potassium <3.5 mEq/L 3 (6) 0 (0)"; 55 vs 49; 4 weeks
- kb-hypok-diamond | confirmed | DIAMOND Table 4: Hypokalemia 66 (15.0) vs 47 (10.7); median follow-up 27 weeks
- kb-hypomg-pearl | corrected | 13 of 55 (24%) vs 1 of 49 (text 2.1%; 1/49 = 2.04%); excess 21.595 not 21.536 (trivial). Definition Mg <1.8 mg/dL; 30 g/day, 4 weeks.
- kb-hypomg-diamond | confirmed | Table 4: Hypomagnesemia 19 (4.3) vs 22 (5.0)
- kb-const-diamond | confirmed | Table 4: Constipation 11 (2.5) vs 5 (1.1)
- kb-gi-diamond | confirmed | Table 4: Diarrhea 19 (4.3) vs 15 (3.4)
- kb-edema-diamond | confirmed | registry: Oedema peripheral 2 vs 5 (of 439)
- kb-dae-diamond | confirmed | Table 4: Adverse events leading to withdrawal 12 (2.7) vs 11 (2.5)
- kb-hypok-realizek | confirmed | registry: other Hypokalaemia 6 of 101 vs 0; the SZC arm also has 1 serious hypokalaemia (7 of 101 if distinct patients), so 5.94 may understate by 1
- kb-hypok-harmonize | confirmed | abstract: "5/51 (10%) and 6/56 patients (11%) in the 10-g and 15-g ... vs none in the 5-g or placebo groups"
- kb-edema-harmonize | confirmed | abstract: edema 2/85, 1/45, 3/51, 8/56 (placebo, 5, 10, 15 g)
- kb-edema-realizek | confirmed | registry: Oedema peripheral 6 of 101 vs 2 of 101
- sema-pancreatitis-step | confirmed | registry: 1 of 573 vs 1 of 572
- sema-pancreatitis-label | confirmed | label: 4 patients (0.2 cases per 100 patient years) vs 1 (less than 0.1); placebo figure is an upper limit
- sema-gallbladder-label | corrected | label: cholelithiasis 1.6% vs 0.7% AND cholecystitis 0.6% vs 0.2%. The collector used cholelithiasis only (0.9); the definition is cholelithiasis or cholecystitis: 2.2 - 0.9 = 1.3.
- sema-gallbladder-step | confirmed | registry: cholecystitis 1+1 vs 0+1, cholelithiasis 2+1 vs 2+0 (serious only visible): 5/573 vs 3/572
- sema-gi-step | confirmed | registry: nausea 45 and 55 of 263 and 310 vs 7 and 18 of 266 and 306: 100/573 vs 25/572
- sema-const-step | confirmed | registry: constipation 17 of 263 vs 7 of 266
- sema-inj-label | confirmed | label: "1.4% ... and 1% of patients receiving placebo"
- tir-pancreatitis-summit | confirmed | registry: obstructive pancreatitis 2, acute 1 vs 0 of 364/367
- tir-gallbladder-summit | confirmed | registry: cholecystitis 1+6+1, cholelithiasis 1 vs 4 + 1 (9/364 vs 5/367); serious only
- tir-gallbladder-label | confirmed | label 5.4: cholelithiasis 1.1% vs 1%, cholecystitis 0.7% vs 0.2%
- tir-gi-summit | confirmed | registry: diarrhoea 65 vs 23 (of 364 and 367)
- tir-const-summit | confirmed | registry: constipation 54 vs 22
- tir-dizz-summit | confirmed | registry: dizziness 34 vs 18
- tir-hypotension-summit | confirmed | registry: hypotension 22 vs 10
- tir-inj-label | confirmed | label Table 2: Injection Site Reactions 2 / 6 / 8 / 8 (placebo, 5, 10, 15 mg); row used the 8 vs 2
- tir-dae-summit | confirmed | abstract: "23 patients (6.3%) ... and in 5 patients (1.4%)"; median follow-up 104 weeks
- loop-creat-dose | confirmed | DOSE (full text): "occurred in 23% of the patients in the high-dose group, as compared with 14% in the low-dose group (P = 0.04)"; creatinine >0.3 mg/dL within 72 hours; a dose contrast, not a placebo excess
- loop-renal-dose | not_confirmed | row has no figure; DOSE text gives no renal serious-adverse-event rate (only overall serious adverse events 38% vs 50%). Row dropped.
- loop-hypok-torsemide-htn | confirmed | label: "1.5% on torsemide and 3% on placebo"; median treatment 41 days; label adds that at HF doses hypokalemia was "observed with greater frequency, in a dose-related manner"
- loop-hypok-sibling-shep | confirmed | abstract: "7.2% ... compared with 1% of the participants randomized to placebo" (chlorthalidone, 1 year)
- loop-urinary-torsemide | corrected | label: 6.7% vs 2.2% overall, but the dose groups are 1% placebo, 4% at 5 mg, 15% at 10 mg, so excess 3 and 14 by dose; replaced by dose groups. Label also says excessive urination was generally not reported in cardiac failure.
- loop-dae-torsemide | confirmed | label: "3.5% of United States patients treated with torsemide and in 4.4% ... placebo"
- loop-gout-choi | confirmed | full text: absolute risk difference for diuretics 572 per 100 000 person years (RR 2.36)
- th-gout-choi | confirmed | same Choi figure
- th-hypok-shep | confirmed | SHEP abstract as above
- th-creat-clorotic | confirmed | abstract: "increase in creatinine 26.5 moL/L or decrease in eGFR 50; 46.5 vs. 17.2" at 72 h; threshold is 0.3 mg/dL (definition 0.5)
- th-creat-melt | confirmed | registry: Acute Kidney Injury 10 of 72 metolazone vs 4 of 70 placebo, 48 hours
- th-hyperglyc-elliott | confirmed | abstract: diuretic 998/18,699 (5.34%), placebo 1686/24,767 (6.81%), placebo OR 0.77 (0.63-0.94): computed 8.67% vs 6.81% (arithmetic right); follow-up not given

## Multipliers

- mult-hydralazine-lupus-sex | confirmed | abstract: "The incidence was higher in women (11.6%) than in men (2.8%)"; ratio 4.14 is women vs men; the resolved multipliers re-express it against the overall 6.7% base (1.731 and 0.418)
- mult-hydralazine-lupus-dose | confirmed | abstract: 5.4% at 100 mg, 10.4% at 200 mg, none at 50 mg; not representable (engine daily dose is NaN for the combination); the 200 mg figure is the base row
- mult-dose-loop-creatinine | confirmed | DOSE: 23% vs 14%; not representable (dose contrast, row withheld)
- mult-torsemide-urination-dose | corrected | label: 1% placebo, 4% at 5 mg, 15% at 10 mg (rates 4 and 15; collector used 4 vs 15 ratio 3.75 on drug-arm rates, but the base is better as dose_groups 3 and 14)
- mult-szc-edema-dose | confirmed | label: 4.4% at 5 g, 5.9% at 10 g, 16.1% at 15 g vs 2.4% placebo; collector used 16.1 vs 4.4 (ratio 3.66); converted to dose_groups
- mult-szc-hypok-dose | confirmed | HARMONIZE abstract: 10 g 5/51, 15 g 6/56, 5 g and placebo none; ratio undefined (reference 0); converted to dose_groups
- mult-tir-injection-dose | confirmed | label Table 2: 6 / 8 / 8 vs 2 placebo; converted to dose_groups (excess 4, 6, 6)
- mult-thiazide-add-on-electrolyte | confirmed | registry MELT-HF: electrolyte abnormalities requiring intervention 4 of 72 vs 2 of 70 (collector: 5.56 vs 2.86); not potassium specific, 6 events; not representable and not used

## Items the verifier added (not in the collector file)

- dig-toxicity-hosp, dig-vent-arrhythmia, dig-av-block | confirmed | DIG first-year post hoc analysis (Ahmed, PMC2900803), Table 3 read in full: suspected digoxin toxicity 13 vs 44; ventricular arrhythmia/cardiac arrest 57 vs 65; AV block/bradyarrhythmia 2 vs 11; N 3899 vs 3889
- dig-gi, dig-dizziness, dig-headache, dig-vision, dig-rash | confirmed | DECISION Extended Data Table 4 (image table read)
- vas-vision (amblyopia 3 vs 1), loop/thiazide step-6 rows, sema-aki, tirz-aki, szc dose groups, thiazide-hyponatremia (Widaplik Study 1 table read) | confirmed | label text read in this session

## Counts

Rows+multipliers checked: 83. confirmed 75, corrected 6, not_confirmed 2.
