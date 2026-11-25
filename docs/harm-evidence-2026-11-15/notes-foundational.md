# Foundational harm evidence: limits and notes (2026-11-15)

Companion to `rows-foundational.json` (183 rows, 24 multipliers). Plain language, short.

## How the numbers were read

Every number in the file was read this session from a source that was fetched: PubMed abstracts, Europe PMC / PMC full text, DailyMed FDA labels, or ClinicalTrials.gov results records. Nothing is recalled-only: no row is `not_verified`.

- `verified_abstract` (8), `verified_fulltext` (8), `verified_label` (83): numbers copied from that source.
- `computed_from_verified` (84): counts divided by arm size, or summed (the arithmetic is in `notes`). Most of these are ClinicalTrials.gov results records (the registry's adverse-event module), which is not in your list of source types. I labelled them `computed_from_verified` and said "rendered from the registry record" in the quote, because the quote is my rendering of a table, not verbatim text.
- NEJM and Lancet trial papers for PARADIGM-HF, PARAGON-HF, DAPA-HF, DELIVER, EMPEROR, FINEARTS-HF, TOPCAT, EMPHASIS-HF, RALES were not open in Europe PMC, so only their abstracts were read. For those trials the safety detail comes from the registry record, the FDA label, or an open secondary paper.

## Definition mismatches (most important)

1. **Hyperkalemia as a laboratory threshold exists for only some drugs.** Laboratory K above 5.5 (and 6.0) was read for: ARNI/enalapril (Jhund age paper, summed over its table), spironolactone (TOPCAT abstract: 18.7% vs 9.1%, threshold not stated in the abstract), eplerenone (EMPHASIS abstract; EPHESUS label table with both 5.5 and 6.0), and the MRA class (Lancet pooled analysis, 6.0 only). For finerenone only hazard ratios were found (K above 5.5: 2.16; above 6.0: 2.07). The finerenone row that carries a percentage is the investigator-reported adverse event (8.4% vs 3.6%), which is not a laboratory threshold. The same is true for every SGLT2 inhibitor, candesartan (CHARM), valsartan, lisinopril/ATLAS and losartan/HEAAL row: these are "hyperkalemia reported as an event", not K above 5.5. In TOPCAT the event rate (13.1% vs 5.6%) is lower than the laboratory rate (18.7% vs 9.1%), so event-based rows probably understate the laboratory definition.
2. **Severe hyperkalemia.** The definition says 6.0 or above, or hyperkalemia leading to hospitalization. Trials used "above 6.0". Where only serious adverse events exist (TOPCAT, EMPHASIS, FINEARTS, SGLT2 trials) I used the serious-event count as a proxy for the hospitalization limb.
3. **Creatinine rise of 0.5 mg/dL or more** was read directly only for eplerenone (EPHESUS label: 6.5% vs 4.9%). For ARNI and valsartan the label gives a rise of more than 50%; Jhund gives an absolute level of 2.5 mg/dL or more; the CHARM and FINEARTS rows are reported "abnormal renal function" events. All are marked as mismatches.
4. **Renal serious event.** Used the preferred term "acute kidney injury" (or "renal failure acute" in PARADIGM-HF) among serious adverse events. Other renal terms were not added because the same patient can appear under several terms.
5. **Symptomatic hypotension** is often reported only as "hypotension" (not stated as symptomatic). The Jhund table is the one source that states "symptomatic".
6. **Hyperglycemia (carvedilol).** The label lists hyperglycemia as an adverse event (12% vs 8%). The definitions file defines `hyperglycemia` as incident diabetes. These are not the same; do not charge those rows.
7. **Volume depletion for SGLT2 inhibitors.** The registry records only list serious dehydration. The non-serious volume-depletion adverse event is not in them. Those rows understate the harm and should be used only as a floor.
8. **Follow-up and the one-year conversion.** The conversion assumes a constant risk. Event-based harms accumulate unevenly and laboratory events that are "ever above a threshold" are probably front-loaded, so the conversion likely understates early harm (as the definitions file says). Where the source gives no follow-up (PARAGON-HF, Val-HeFT, the Lancet pooled analysis, several label lines) `one_year_excess_pct` is null instead of guessed. Assumptions I made are written in `notes`: CHARM program T = 3.09 y (mean of the three verified component medians), ATLAS T = 4.04 y (midpoint of 39 to 58 months), FIDELITY T = 2.55 y, HEAAL denominators 1917 per arm.

## Where an active-controlled trial is the only source

- **ARNI (sacubitril/valsartan).** PARADIGM-HF (enalapril) and PARAGON-HF (valsartan) are the only trials; there is no placebo arm. All of those rows have `excess_pct: null` and a separate `difference_vs_active_comparator_pct`. To follow the preference order I added: composed step-3 rows for hypotension, dizziness and cough (enalapril-vs-placebo from the Vasotec label plus the PARADIGM-HF difference), and two sibling-proxy step-5 rows (hyperkalemia and creatinine rise, from the candesartan CHARM program). The composed rows combine different trials and windows and are the least reliable; hypotension +10.9 points is large and probably overstated. No usable primary exists for ARNI serious renal event, angioedema, syncope, severe hyperkalemia or discontinuation; the PARADIGM rows are there but have no placebo-subtracted excess. Decision for the engine owner: use step 5 or step 6.
- **Losartan (HEAAL) and lisinopril (ATLAS)** are dose comparisons (high vs low), not placebo-controlled, so they carry no excess; they are the dose-relation evidence.
- **ACE inhibitors.** There is no placebo-controlled heart-failure potassium or creatinine figure in the sources read. The label pool for enalapril (Vasotec) has hypotension, dizziness, syncope, cough, but its placebo arm comes only from 12-week controlled trials while the enalapril arm includes uncontrolled exposure up to about a year; the excess is inflated by that.

## Not found (could not be verified from a source reached)

- ACE inhibitor: hyperkalemia and creatinine rise placebo-controlled in heart failure (SOLVD-Treatment abstract has no safety numbers; CONSENSUS abstract gives only hypotension requiring withdrawal 7 of 127 vs 0 of 126); angioedema rate.
- ARB: angioedema and syncope numbers in heart failure (valsartan label says syncope was more common than placebo, no numbers).
- Beta blockers: CIBIS-II, COPERNICUS and US Carvedilol primary papers and SENIORS safety data were not retrieved (search missed the primary papers; labels used for carvedilol and metoprolol). Bisoprolol has no heart-failure label; the rows are from the hypertension studies (other population, 4 to 12 weeks). Advanced AV block: the carvedilol label gives only a band (1 to 3%) for AV block of any degree; no placebo figure; first-degree block was not reported by any source. Dose groups for beta blockers (MOCHA, MERIT-HF) were not found.
- MRA: creatinine rise and discontinuation for spironolactone (TOPCAT/RALES abstracts have no numbers); gynecomastia for eplerenone (EMPHASIS registry record has it below its 2% reporting threshold; the label gives no numbers); K above 6.0 percentages for finerenone and spironolactone separately.
- SGLT2 inhibitor: genital mycotic infection in heart-failure patients (registry records omit it; labels give only type 2 diabetes pools, 12 to 24 weeks); non-serious volume depletion; lower-limb amputation in dapagliflozin trials; discontinuation for adverse events for dapagliflozin and empagliflozin.
- Multipliers not measured numerically: see `not_measured` in the JSON (symptomatic hypotension by baseline SBP, hyperkalemia by baseline K and by eGFR band, worsening renal function by eGFR, ACE-inhibitor angioedema in Black patients). The PARADIGM-HF SBP paper's full text returned only the abstract.

## Traps and surprises in the sources

- **EPHESUS label Table 3 is not a rate table.** It is titled "Rates of Hyperkalemia" but the percentages (32, 24, 17, 11 of N=508) are shares of the hyperkalemic patients, not rates within each creatinine-clearance band. It cannot be used as an eGFR multiplier. I recorded it as unusable.
- EPHESUS is post-MI LV dysfunction (HF or diabetes), not chronic stable HFrEF. By the order rule (same definition, more patients) it is `primary` for eplerenone hyperkalemia, creatinine rise, K above 6.0. EMPHASIS-HF (11.8% vs 7.2%) is the closer population; both are in the file.
- Excess below zero (floor rule applies later): all four SGLT2-inhibitor trials for serious acute kidney injury (about -0.3 to -1.1 points); SGLT2 hyperkalemia (empagliflozin 5.3% vs 5.9% and 5.7% vs 6.5%; serious hyperkalemia fewer except DELIVER 11 vs 4); eplerenone AV block (3 vs 6 complete); metoprolol discontinuation (10.3% vs 12.2%); bisoprolol hypertension dizziness and withdrawals; pooled empagliflozin serious genital infection 0.04 vs 0.07 per 100 patient-years; hypokalemia on all MRAs.
- Excess in the other direction that was not expected: EMPEROR-Reduced serious syncope 17 vs 8; DELIVER serious hyperkalemia 11 vs 4 on dapagliflozin; serious genital infection in men higher than women in the pooled empagliflozin data.
- Pooled empagliflozin (four trials) mixes heart-failure trials with EMPA-REG and EMPA-KIDNEY; its "history of HF" subgroup is not the same as the HF trials alone. All pooled rows are step 4 for that reason and the two serious genital rows are context only (never primary).

## Things in `harmDefinitions.json` that I think need a decision

- No effect for **symptomatic or severe hypoglycemia** (SGLT2 inhibitor plus insulin or sulfonylurea; sotagliflozin severe hypoglycemia 1.5% vs 0.3% in SOLOIST) and none for **urinary tract infection** (the top adverse event in SGLT2 labels; pooled empagliflozin shows no excess for serious infection: 0.78 vs 0.76 per 100 patient-years). Probably fine to omit, but the omission should be a ruling.
- `hyperkalemia` and `hyperkalemiaSevere` are defined on laboratory thresholds, but for many drugs only event-based or hospitalization-based figures exist. The preference order has no step for "event-defined, not threshold-defined"; I treated them as a definition mismatch on the same step. A ruling would help.
- Preference step 3 (active comparator plus comparator's placebo-controlled excess) cannot be applied if the comparator has no placebo-controlled figure of the same definition, which is the case for ARNI hyperkalemia and creatinine. I fell to step 5 (sibling proxy).
- Class-level versus drug-level rows are equal at step 1. I kept both and marked each `primary` within its own group; the engine owner should pick (class rows: `MRA-IPD-K60`, `MRA-IPD-hypoK`).
- `dose_related`: the evidence on dose is limited to ATLAS (lisinopril), HEAAL (losartan), bisoprolol hypertension label, finerenone K above 5.5 by target-dose stratum (no dose effect), spironolactone gynecomastia (label: dose-dependent, no groups). Everything else is "studied dose at every dose", as the file says.
- The HF-trial pooled and registry sources report adverse events by MedDRA term, so near-synonym handling (largest excess among terms) cannot be done reliably from the registry; I took the single dominant term.

## Not done

No claim of a systematic search. I did not read NEJM/Lancet full texts, supplements, or the FDA review documents. No row was cross-checked by a second reader. Sacubitril/valsartan and SGLT2-inhibitor genital infection in heart failure remain open. Sotagliflozin rows are included only as reference (not in the formulary).
