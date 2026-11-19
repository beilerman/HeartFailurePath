# Notes: adjunct classes harm evidence (2026-11-15)

Companion to `rows-adjunct.json` (75 rows, 8 multipliers). Plain language, short.

## How the numbers were checked
- Every number was read in this session from one of: a PubMed abstract, an open-access full text (PMC), a DailyMed label, or a ClinicalTrials.gov results record (adverse events module).
- ClinicalTrials.gov rows are marked `computed_from_verified` (counts read, percentage computed, arithmetic in `notes`). They come from the registry, not the journal paper, and the registry lists "other" events only above a frequency threshold (1 to 5 percent). So non-serious events below the threshold are invisible there, and absence from the list does not prove zero for non-serious events.
- Nothing is `not_verified`. Where I could not reach a source I left the row out and list it below.

## Not found (no source reached, no row written)
- Digoxin: ventricular arrhythmia, advanced AV block, nausea/vomiting/anorexia rates. The DIG paper (NEJM 1997) was not fetchable; the label gives only "5 to 20 percent" overall with no control. DECISION has no posted results. Only the toxicity-hospitalization rate (2.0 vs 0.9 percent) was verified.
- Hydralazine/isosorbide: syncope (A-HeFT label lists syncope only as post-marketing), lupus in A-HeFT or V-HeFT (not reported in the label). Lupus comes from a 1984 hypertension cohort, not from heart failure.
- Loop diuretics (furosemide, torsemide, bumetanide, Furoscix): hyponatremia, hypomagnesemia, hyperglycemia, and any placebo-controlled heart-failure rate for hypokalemia, creatinine rise or renal serious events. The Furoscix label has no incidence table. Torsemide TRANSFORM-HF recorded no adverse events (registry: "Serious and Other Adverse Event data were not collected").
- Thiazide-like diuretics: hyponatremia and hypomagnesemia. The Widaplik (indapamide combination) label has sodium below 135 mmol/L at week 4, but the arm columns were ambiguous in my text extraction and the threshold is not the definition's 130, so I did not use it. Metolazone and chlorthalidone labels give no rates.
- CLOROTIC (HCTZ added to IV furosemide, placebo-controlled, heart failure): the abstract says hypokalaemia was "similar between groups" but gives no numbers; full text is not open.
- IV iron: placebo-controlled laboratory hypophosphatemia in heart failure does not exist in anything I reached. FAIR-HF paper gives only "similar" adverse event rates. IRONMAN (ferric derisomaltose) was not fetched.
- Semaglutide discontinuation for adverse events in STEP-HFpEF (not in registry output I read).
- PEARL-HF is the only lab-threshold potassium-binder trial in heart failure; OPAL-HK and HARMONIZE are not heart-failure-specific.

## Where no placebo-controlled heart-failure source exists, and the step I fell back to
- Loop diuretic hypokalemia: step 4 (torsemide label, hypertension, 5-10 mg, 1.5 vs 3.0 percent; excess -1.5, charged 0). The label itself says HF doses cause more, dose-related, with no number. I added a step-5 sibling proxy (SHEP chlorthalidone, 7.2 vs 1.0) marked non-primary. Owner decision.
- Loop diuretic creatinine rise: only DOSE (high 23 percent vs low 14 percent furosemide, over 72 hours). That is a dose contrast, not a placebo excess; `preference_step` is null and `one_year_excess_pct` is null. The largest placebo-controlled creatinine excess in my set (CLOROTIC thiazide add-on, 29.3 points over 72 hours) is a possible step-6 upper bound for the loop class, but I did not write it as a loop row because the loop diuretic is the background in both arms.
- Loop and thiazide-like gout: step 4, observational (Choi BMJ 2012), 0.572 percent a year, diuretics pooled.
- Thiazide-like hypokalemia and hyperglycemia: step 4 (SHEP; Elliott network meta-analysis). Hydrochlorothiazide and metolazone get chlorthalidone's number by sibling assumption.
- Lupus: step 3/4 (no placebo arm, hypertension cohort). Placebo lupus incidence assumed zero; not measured.
- IV iron hypophosphatemia: step 4 with an ACTIVE comparator (ferric derisomaltose), not placebo.
- Semaglutide and tirzepatide gallbladder, injection site, pancreatitis (label rows): step 4 (obesity trials).
- Patiromer/SZC hypokalemia and edema from HARMONIZE: step 4 (mixed hyperkalemia population).

## Definition mismatches to know about
- Hypokalemia: PEARL-HF is the laboratory threshold (K below 3.5); DIAMOND and REALIZE-K are investigator-reported "hypokalaemia" events. Both are in the file.
- Hypomagnesemia: PEARL-HF used Mg below 1.8 mg/dL (24 vs 2 percent, 4 weeks, 30 g/day); DIAMOND reported-AE 4.3 vs 5.0 percent over 27 weeks. They disagree widely. The laboratory figure matches the definition but is a short, high-dose, spironolactone-treated study.
- Hypophosphatemia: the definition (phosphate below 2.0) matches Wolf JAMA 2020 (about 74 percent on FCM vs 8 percent on derisomaltose over 5 weeks). The label's reported-AE figure is 2.1 percent. Heart-failure trials report only serious events (1 vs 0 in HEART-FID). The label now carries a boxed warning (Aug 2026).
- Creatinine rise: DOSE and CLOROTIC use 0.3 mg/dL (definition says 0.5); MELT-HF uses a 30 percent rise; all measured over 48-72 hours.
- Gallbladder: heart-failure trials expose only serious events; labels give all reported events. I marked the label rows primary because they match the definition (the file's `sourceChoice` says definition first).
- Pancreatitis: 1 vs 1 (semaglutide HF) and 3 vs 0 (tirzepatide HF) are too few to estimate a rate.
- Anemia (vericiguat): label figure is an adverse drug reaction, not a haemoglobin threshold.
- Hypotension: ivabradine registry term "hypotension" (not "symptomatic"); vericiguat paper gives true "symptomatic hypotension".

## Things in the definitions file I think are wrong or unclear
1. The one-year conversion assumes constant risk. It is wrong in two directions: GI events (semaglutide, tirzepatide) cluster in the first weeks, so annualising understates; hypophosphatemia and hypersensitivity happen per infusion course, not per year, so a per-year figure is not the right unit. I applied the conversion exactly as written and flagged it in each row.
2. The file says the conversion applies to "harm rows" but the symptom figure is described as "percent of patients a year". It does not say whether symptom events should be annualised. I annualised both when follow-up exceeded one year.
3. 72-hour and 48-hour inpatient rates (creatinine rise in DOSE, CLOROTIC, MELT-HF) have no sensible annual conversion; I used them as observed. If charged as a yearly rate they would dominate the scale (29 points for a thiazide add-on).
4. `hyponatremia` is defined below 130 mmol/L but trials and labels mostly report below 135.
5. Missing harms I would consider: loop-diuretic ototoxicity and volume depletion/worsening renal function as a named effect; GLP-1 gastroparesis/ileus and loss of lean mass; digoxin visual disturbance; hydralazine peripheral neuropathy; IV iron extravasation staining. I did not invent effect ids.
6. The floor rule makes the K+ binder's negative edema and magnesium rows zero, and the torsemide hypokalemia row zero; for the loop class this charges nothing for hypokalemia in a population where it is a known problem.
7. "Near-synonyms count once at the largest excess" was applied to GI terms; flatulence (patiromer) is not in the giUpset definition and was left out.

## Source caveats worth stating
- Vericiguat: the paper's own anemia figure (7.6 vs 5.7 percent) is recalled from memory and was not fetched; I used the label's whole-number 10 vs 7.
- Ivabradine: AF excess 1.1 percent per patient-year is exposure-adjusted (label); cumulative label 8.3 vs 6.6 percent is the same data. Do not add them.
- Ivabradine AV block row sums near-synonymous terms (complete and third degree), so it is an upper bound.
- Digoxin follow-up: the label says "37-week"; I used 37 months because the fetched JAMA 2003 DIG abstract gives mean follow-up of 37 months (for the men with LVEF 45 percent or less). The overall DIG mean follow-up is not in anything I fetched.
- HEART-FID follow-up is not in the registry or abstract; its rows are used as observed.
- Reused from the hypertension engine, re-verified here: SHEP (7.2 vs 1.0), Choi gout (572 per 100,000 person-years), Elliott diabetes (computed 8.67 vs 6.81), torsemide label (1.5 vs 3.0). NOT reused because I could not re-verify: ALLHAT hypokalemia 12.7 vs 2.6, loop hyponatremia from the baxdrostat label, indapamide hyponatremia from the Widaplik label.

## Multipliers: measured, and not measured
Measured (both rates from a fetched source): hydralazine lupus by sex (11.6 vs 2.8 percent, ratio 4.1) and by dose (5.4 at 100 mg vs 10.4 at 200 mg; zero at 50 mg); loop furosemide creatinine rise by dose (23 vs 14); torsemide excessive urination by dose; SZC edema by dose (label 16.1 vs 4.4 percent) and hypokalemia by dose (HARMONIZE); tirzepatide injection-site reactions by dose; metolazone-added-to-furosemide electrolyte events (weak, 6 events, not potassium-specific).

Not measured (no rates found; do not estimate): digoxin toxicity by eGFR, age or sex (the DIG age paper only says age is an independent risk factor, with no rates in the abstract; the sex paper abstract gives no toxicity rates); ivabradine AF or bradycardia by baseline heart rate; vericiguat hypotension by baseline systolic pressure; hypokalemia with a thiazide added to a loop (CLOROTIC says "similar", no numbers); hydralazine lupus by acetylator status or race.
