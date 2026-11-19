# Resolved table notes, adjunct classes (2026-11-15)

Companion to `resolved-adjunct.json` (77 rows, 2 multipliers) and `verification-adjunct.md`. Plain language.

## Corrections to the collector (6)
- IV iron site reaction: it is the drug-related "General disorders and administration site conditions" class (9 vs 2 of 152), not injection-site reactions.
- Patiromer magnesium: placebo 1/49 = 2.04% (not 2.1), excess 21.595.
- Semaglutide gallbladder: cholecystitis (0.6 vs 0.2) had been left out; 1.3 not 0.9.
- Hydralazine lupus: use the 200 mg group (3.59 a year), not the all-dose 6.7% (2.29). No dose_groups (the engine daily dose for "37.5/20" is NaN and would select the lowest group, 0).
- Torsemide excessive urination: dose groups 3 (5 mg) and 14 (10 mg) over a 1% placebo, not 6.7 vs 2.2.
- Digoxin follow-up: the label's "37-week" is a typo; the DIG NEJM abstract says average follow-up 37 months.
Not confirmed (dropped): vericiguat discontinuation (no registry count), loop renal serious event (no figure).

## Gap fills, with the step used
- Digoxin ventricular arrhythmia, advanced AV block, toxicity: step 1, DIG first-year post hoc analysis (Ahmed 2009, 3889 vs 3899, Table 3). Toxicity is now 0.80 (first year) rather than 0.36 (whole-trial label converted). Digoxin symptoms (GI, dizziness, headache, vision, rash): step 1, DECISION Extended Data Table 4 (low-dose digoxin, 36.5 months; the tables are images).
- Hydralazine/ISDN: amblyopia (blurred vision) added from the label; syncope step 6 (0.5, vericiguat), flagged.
- Loop diuretics: hypokalemia stays step 4 (torsemide hypertension label, negative, charges 0); hyponatremia step 6 (2.165, thiazide Widaplik Study 1); magnesium step 6 (21.6, PEARL-HF binder); glucose step 6 (1.86); hypotension step 6 (4.0, BiDil); gout step 4 observational (0.572); Furoscix takes oral furosemide's class rows by sibling assumption plus its own site-reaction upper bound (6.0, tirzepatide).
- Thiazide-like: hyponatremia step 4 (Widaplik Study 1, 2.165); magnesium and hypotension step 6; creatinine HCTZ (CLOROTIC), metolazone (MELT-HF) step 1, chlorthalidone step 5 (HCTZ).
- Semaglutide/tirzepatide: acute kidney injury added (step 1 STEP-HFpEF; label for tirzepatide); gallbladder from labels (definition match, R2).
- Patiromer/SZC: R2 applied: laboratory rows (PEARL-HF; HARMONIZE) beat reported events (DIAMOND; REALIZE-K). SZC edema and constipation from the label with dose groups.

## Judgement calls for the controller
1. LOOP hypokalemia charges 0. The only measured loop figure is a hypertension-dose torsemide result below placebo; the label says heart-failure doses are worse with no number. Alternatives: SHEP thiazide 6.2 (3.1 points) or a step-6 bound of 10.7 (5.4 points).
2. Step-6 rows (flagged `upper_bound`) dominate the loop and thiazide totals: magnesium 21.6 is a binder figure applied to diuretics (10.8 points each). The burden table below is given with and without them.
3. Loop creatinine/renal rows withheld. Charging the step-6 figure (CLOROTIC 29.3, 72 hours, inpatient add-on) would add 14.7 points to every loop. HCTZ and chlorthalidone are charged this same figure (14.7 points), which is the same flaw in a direct form: an acute 72-hour inpatient add-on rate used as a yearly outpatient rate.
4. IV iron hypophosphatemia 66.35 (33 points) is a 35-day laboratory result in iron-deficiency anemia against another iron; heart-failure trials show 1 serious event in 1532. It makes FCM the most expensive drug by far. Owner decision whether a laboratory-only, asymptomatic nadir deserves "mild" weight at 66%.
5. Pancreatitis: the heart-failure row for semaglutide has 1 vs 1 events (charges 0); the label (0.2 vs <0.1 per 100 patient-years) would charge 0.1 x 3 = 0.3 points.
6. Semaglutide/tirzepatide GI and constipation are as observed over the trial (R6), 11 to 13 points before conversion; the 2-year annualised SUMMIT values would be 6.2 and 4.7.
7. Digoxin symptom rates come from a low-dose trial and are assumed cumulative over 36.5 months; the trial table does not say.
8. Torsemide urinary frequency 14 at 10 mg and above (17.4 points of symptom figure at 20 mg) despite the label saying it is generally not reported in cardiac failure. Probably too dear.
9. Hydralazine sex multipliers are re-based on the overall 6.7% (no men-only dose-specific rate exists).
10. SZC hypokalemia: laboratory threshold was not confirmed from the abstract; REALIZE-K (HF, reported events) would give 5.9 to 6.9.

## Ten weakest rows
1. fcm-hypophosphatemia (active comparator, anemia population, 35 days).
2. loop-hypomagnesemia and thiazide-hypomagnesemia (binder figure for diuretics).
3. hctz-creatinine / chlorthalidone-creatinine (72-hour inpatient add-on as a yearly rate; chlorthalidone is a sibling).
4. loop-hypokalemia (below placebo, wrong dose and population).
5. vas-lupus (no control arm, hypertension, placebo assumed 0, one dose group).
6. vas-syncope, loop-hypotension, thiazide-hypotension (step 6 from other drugs).
7. torsemide-urinary-frequency (hypertension, label says not seen in heart failure).
8. dig-* symptoms (low-dose trial, cumulative-time assumption).
9. iva-avb-advanced (near-synonym sum, upper bound); fcm-hypersensitivity (3 events, unknown follow-up).
10. thiazide-hyperglycemia / loop-hyperglycemia (network meta-analysis odds ratio, follow-up not stated).

## Burden at a usual dose, by hand (rate x weight)

Weights: mild 0.5, moderate 1.0, serious 3.0; symptom figure = 100 x (1 - product(1 - x/100)), floors at 0. Usual dose in brackets (engine daily dose units: mg; patiromer, SZC grams; digoxin mcg; weekly drugs mg per dose). "Total" includes the step-6 upper-bound rows; "measured only" leaves them out.

| Drug (dose) | Symptom figure % | Harm rows (rate x weight) | Total | Measured only |
|---|---|---|---|---|
| Furosemide (40) | 4.00 (hypotensionSymptomatic 4.00) | hypokalemia 0.00x0.5=0.00; hyponatremia 2.17x1=2.17; hypomagnesemia 21.60x0.5=10.80; hyperglycemia 1.86x1=1.86; hyperuricemiaGout 0.57x1=0.57 | 19.4 | 0.6 |
| Furoscix (SC Furosemide) (80) | 9.76 (hypotensionSymptomatic 4.00, injectionSiteReaction 6.00) | hypokalemia 0.00x0.5=0.00; hyponatremia 2.17x1=2.17; hypomagnesemia 21.60x0.5=10.80; hyperglycemia 1.86x1=1.86; hyperuricemiaGout 0.57x1=0.57 | 25.2 | 0.6 |
| Torsemide (20) | 17.44 (hypotensionSymptomatic 4.00, urinaryFrequency 14.00) | hypokalemia 0.00x0.5=0.00; hyponatremia 2.17x1=2.17; hypomagnesemia 21.60x0.5=10.80; hyperglycemia 1.86x1=1.86; hyperuricemiaGout 0.57x1=0.57 | 32.8 | 14.6 |
| Bumetanide (2) | 4.00 (hypotensionSymptomatic 4.00) | hypokalemia 0.00x0.5=0.00; hyponatremia 2.17x1=2.17; hypomagnesemia 21.60x0.5=10.80; hyperglycemia 1.86x1=1.86; hyperuricemiaGout 0.57x1=0.57 | 19.4 | 0.6 |
| Hydralazine/Isosorbide Dinitrate (combination) | 49.00 (headache 29.00, dizziness 18.00, hypotensionSymptomatic 4.00, fatigue 3.00, giUpset 4.00, visualPhosphenes 2.00) | ventricularArrhythmia 2.00x3=6.00; lupusLikeSyndrome 3.59x1=3.59; syncope 0.50x3=1.50 | 60.1 | 58.6 |
| Ivabradine (15) | 3.25 (bradycardiaSymptomatic 1.94, visualPhosphenes 1.18, dizziness 0.17, hypotensionSymptomatic 0.00) | atrialFibrillation 1.10x1=1.10; avBlockAdvanced 0.26x3=0.78; avBlockFirstDegree 0.00x0.5=0.00; creatinineRise 0.14x0.5=0.07 | 5.2 | 5.2 |
| Vericiguat (10) | 2.33 (hypotensionSymptomatic 1.41, dizziness 0.67, giUpset 0.27) | anemia 3.00x0.5=1.50; syncope 0.50x3=1.50 | 5.3 | 5.3 |
| Patiromer (16.8) | 2.27 (constipation 1.37, giUpset 0.91, peripheralEdema 0.00) | hypokalemia 5.46x0.5=2.73; hypomagnesemia 21.60x0.5=10.80 | 15.8 | 15.8 |
| Sodium Zirconium Cyclosilicate (Lokelma) (10) | 12.19 (peripheralEdema 3.50, constipation 9.00) | hypokalemia 9.80x0.5=4.90 | 17.1 | 17.1 |
| Ferric Carboxymaltose (1000) | 5.86 (injectionSiteReaction 4.61, giUpset 1.32) | hypophosphatemia 66.35x0.5=33.17; hypersensitivitySerious 0.20x3=0.59 | 39.6 | 39.6 |
| Digoxin (125) | 3.29 (giUpset 0.63, dizziness 1.05, headache 0.63, visualPhosphenes 0.48, rash 0.55) | digoxinToxicityHospitalization 0.80x3=2.39; ventricularArrhythmia 0.21x3=0.63; avBlockAdvanced 0.23x3=0.70 | 7.0 | 7.0 |
| Metolazone (5) | 4.00 (hypotensionSymptomatic 4.00) | hypokalemia 6.20x0.5=3.10; hyponatremia 2.17x1=2.17; hyperglycemia 1.86x1=1.86; hyperuricemiaGout 0.57x1=0.57; hypomagnesemia 21.60x0.5=10.80; creatinineRise 8.18x0.5=4.09 | 26.6 | 11.8 |
| Chlorthalidone (25) | 4.00 (hypotensionSymptomatic 4.00) | hypokalemia 6.20x0.5=3.10; hyponatremia 2.17x1=2.17; hyperglycemia 1.86x1=1.86; hyperuricemiaGout 0.57x1=0.57; hypomagnesemia 21.60x0.5=10.80; creatinineRise 29.30x0.5=14.65 | 37.1 | 22.3 |
| Hydrochlorothiazide (25) | 4.00 (hypotensionSymptomatic 4.00) | hypokalemia 6.20x0.5=3.10; hyponatremia 2.17x1=2.17; hyperglycemia 1.86x1=1.86; hyperuricemiaGout 0.57x1=0.57; hypomagnesemia 21.60x0.5=10.80; creatinineRise 29.30x0.5=14.65 | 37.1 | 22.3 |
| Semaglutide (Wegovy) (2.4) | 16.75 (giUpset 13.08, constipation 3.83, injectionSiteReaction 0.40) | pancreatitis 0.00x3=0.00; gallbladderDisease 1.30x1=1.30; renalSeriousEvent 1.39x3=4.18 | 22.2 | 22.2 |
| Tirzepatide (Zepbound) (10) | 27.24 (giUpset 11.59, constipation 8.84, dizziness 2.30, hypotensionSymptomatic 1.70, injectionSiteReaction 6.00) | pancreatitis 0.41x3=1.24; gallbladderDisease 0.60x1=0.60; renalSeriousEvent 0.30x3=0.90 | 30.0 | 30.0 |

Reading: the drugs measured in heart-failure trials (ivabradine 5.2, vericiguat 5.3, digoxin 7.0) look cheap beside those where gap fills came from other populations or upper bounds (loops 19 with upper bounds, thiazides 37, IV iron 40). Much of that gap is the evidence level, not the drug. BiDil (60) is high because of measured headache (29) and dizziness (18) in A-HeFT; those are real.
