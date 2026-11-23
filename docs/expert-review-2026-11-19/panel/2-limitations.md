# Limitations

These are known. They are listed so that you can weigh the tool's output with them in mind, and so that you do not spend your time rediscovering them. Where a limitation is also a question for you, it appears again in "Policy questions".

## Not tested on patients

- No real patient data has been run through the tool. Every case in this packet is constructed.
- No clinician has yet reviewed its output formally. This review is the first.
- Agreement with guideline-directed therapy is tracked in a report but was never an input to the ranking.

## What the estimates are

- **Trial averages.** Every effect is the average effect in the trial population. The tool does not adjust an effect for age, sex, race or any other patient feature unless a published subgroup figure exists and is cited on the screen. The one patient-specific change is the dose: when kidney function or an interacting drug lowers the highest dose allowed for a drug an option starts, the drug is credited with the fraction of its trial effect that dose earns, and the option says so.
- **Relative, not absolute.** There is no baseline risk model. The tool cannot say how many events an option would prevent in this patient.
- **Independent effects multiplied together.** When two drugs are combined, their relative risks are multiplied. Trials added each drug on top of the background therapy of their time, so this is an assumption, not a measurement.
- **Pulled toward no effect by their uncertainty.** A drug with one small trial earns less credit than its point estimate suggests. This is deliberate, and it lowers the ranking of newer or less-studied additions.
- **Some rows are borrowed or converted.** Where a drug was not itself tested for an outcome, the tool may use a figure from another drug of the same mechanism, or convert a figure from a different questionnaire or a different outcome definition. Every such row says so on the evidence screen. The document "evidence-status" lists every row by how it was verified.
- **Outside the trials' range.** When kidney function is below an eGFR of 20 or systolic pressure is below 95, the screen notes that the trials enrolled few or no such patients. The estimates are not changed.

## What is not modelled

- **Congestion relief from diuretics.** The tool has outcome figures for diuretics in congested patients from a pooled analysis, but it does not model how much a given dose relieves congestion. A new loop diuretic starts at the lowest dose of the first eligible loop agent (furosemide 20 mg unless furosemide is excluded, then torsemide 5 mg). A diuretic step for a congested patient is kept in view by a stated rule, not by a measured benefit.
- **Dose-related side effects.** A higher dose is charged the same side-effect burden as the current dose, because the tables rarely report rates by dose. The screen says so.
- **Side effects that were never measured.** Several are charged nothing and shown as "not measured": low magnesium and low blood pressure from loop and thiazide-type diuretics; advanced heart block from beta-blockers; serious kidney events from renin-angiotensin drugs beyond the measured rise in creatinine; the injection-site reaction of subcutaneous furosemide.
- **Time.** The tool looks at one visit. It does not plan a titration sequence, and it does not know how long a patient has been on a dose beyond what is entered.
- **Rate control in atrial fibrillation.** There is an alert, not a treatment step.
- **Frailty, limited life expectancy and the patient's goals of care.** These are not inputs. The only patient preferences the tool reads are cost worry, monthly budget, tolerance for complexity and the "What matters most" choice.
- **Blood pressure control and other conditions.** The tool does not prompt for uncontrolled hypertension, diabetes control, lipid treatment or anticoagulant choice beyond a reminder in atrial fibrillation.
- **Drug interactions outside a short coded list.** The tool checks the other drugs a clinician records against a fixed list (amiodarone, verapamil, diltiazem, lithium, NSAIDs, thiazolidinediones, saxagliptin, PDE-5 inhibitors, long-acting nitrates, riociguat, aliskiren, strong and moderate CYP3A inhibitors, CYP3A4 inducers, potassium-raising drugs). An interacting drug not on that list is not checked.
- **Allergy entries are free text read by matching words.** An entry that contains a drug name, a brand name or a drug class name, alone or inside a sentence ("rash from lisinopril"), is read as an allergy to that drug or class and the drug is not offered; several drugs in one entry are each read. A sentence that says the drug was tolerated, that there is no allergy to it, or that a relative reacted to it ("tolerates carvedilol well", "no allergy to lisinopril") is read the same way and also excludes the drug; the screen says how the entry was read so that it can be removed. A misspelled name, or an entry that names nothing the tool knows, is reported as not matched and changes nothing. The word angioedema, or swelling of the face, lips, tongue or throat named together with an ACE inhibitor, ARB or sacubitril/valsartan, is read as a history of angioedema: ACE inhibitors and sacubitril/valsartan are then not offered or continued, and an ARB carries a caution. An allergy to an ACE inhibitor raises no check on an ARB, and an allergy to sacubitril/valsartan raises no check on an ACE inhibitor (policy question 21).
- **Screens with no option.** When the tool shows no option (systolic pressure below 90, potassium 6.5 or above, third-degree AV block without a pacemaker, an out-of-scope condition, an implausible value, missing core information, potassium 6.0 to 6.4 when no option can lower it, or every drug withheld at once) it proposes nothing and ranks nothing; the alerts, not an option, say which drugs to withhold, reduce or review.
- **Dosing burden.** The count of doses a day treats a single intravenous iron course as a single dose, not a daily one. The burden score uses a separate complexity figure.

## Hard thresholds

The ranking itself has no cut-offs, but the safety rules do, and a one-unit change in an entered value can change the first option. The steepest are at systolic pressure 90 and 100; potassium 5.0, 5.3, 5.5, 6.0 and 6.5; eGFR 20, 25 and 31; heart rate 50 and 55; hemoglobin 15; ejection fraction 40, for a patient taking finerenone; age 56 for women when pregnancy status is not recorded; and, for the reading of acute decompensation, 2 kg above dry weight in NYHA class III. The full table is in "Policy questions". A value near one of these should be read with that in mind.

## Policy choices built into the ranking

The six weights, the limit of two new drug classes per visit, the penalty for an unresolved safety warning, and the rule that "No medication change" leads when nothing is distinguishably better are choices, not measurements. They are listed in "Policy questions".

## Cost

Prices come from a fixed table by payer type (cash, commercial, Medicare). They are not the patient's actual plan. Cost carries 14% of the ranking, so a wrong price can change the order.

## Software

- Checked in the Chrome browser on a desktop and at phone width only. Not checked with a screen reader, in Safari or Firefox, or on a real phone.
- Nothing entered leaves the browser. Nothing is stored beyond the browser session.
