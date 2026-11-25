# CLAUDE.md - HeartFailurePath

Start with `docs/expert-review-2026-11-19/README.md`: round 11 (2026-11-23) came back clean for rule set `2026-11-22.4`; three independent reviewers rated it ready for the expert panel (round 14 was the next clean round). The 2026-11-24 pass (rule set `2026-11-24.1`) then fixed most of its minor findings, round 12 (rule set `2026-11-24.2`) fixed one blocking finding and five small ones, and round 13 (rule set `2026-11-25.1`) fixed the weight-difference twin of it and the other computed-threshold cases, and round 14 came back clean at `2026-11-25.1` with no code change (notes below). The [November 23 handoff](docs/HANDOFF-2026-11-23.md) describes the 2026-11-22 engineering review that produced `.4`. The dated entries below describe earlier stages.

**Expert-review readiness (adversarial loop, fourteen rounds, round 14 clean at rule set `2026-11-25.1`): the record of the work, the current state, the round 11 minor findings and which of them the 2026-11-24 pass fixed, the round 14 minor findings left unfixed, the controller rulings of rounds 11 to 13 (not the owner's), the open owner decisions and how to continue are in `docs/expert-review-2026-11-19/README.md`. Not merged; merging to `main` deploys production and needs the owner's explicit instruction. Any further code change needs a fresh review round before the packet goes out.**

**2026-11-25, round 14 CLEAN at rule set `2026-11-25.1` (no code change after review).** Clinical, engine and screen-and-packet reviewers all rated it ready; nothing blocking. They re-verified E1 to E6 against exact-arithmetic oracles (every dry weight 25.0 to 300.0 in 0.1 steps at ten offsets, BUN/creatinine, pulse pressure, potassium band edges, loop keeper pairs, budget, kidney figures) and found only minor faults: the held-loop clause printed when a loop step passes the rules but is not among the three options shown (5% to 9% of outputs that carry it), the score modal's volume arithmetic one point off for odd tenths (its lines are not displayed in the browser), MAP printed to a whole number, a rounded weight in the ferric carboxymaltose note, two-decimal potassium and BUN read differently by the form and the engine, an omission in the POOR PERFUSION alert, and fuzz seed 913377 (known item 72). All are listed with files in the expert-review README under "Minor findings left unfixed after round 14"; any change needs a fresh review round. One new panel question (congested patient, narrow pulse pressure, up-titration first) is recorded in the same README as question 33 and is not on the panel page. The rulings of rounds 11 to 13 are the controller's, not the owner's, and are listed there too. This pass changed records only.

**2026-11-25 (local, uncommitted), round 13 fixes (controller rulings E1 to E6; rule set `2026-11-25.1`; checks in the marked "R13 SECTION" of `scripts/engineReadinessR11Checks.ts` (run by `npm run verify`; `R13_ONLY=1 npx tsx scripts/engineReadinessR11Checks.ts` runs just them) and of `scripts/verifyR11Ui.tsx`, plus the example-card and tab round trip checks in `scripts/verifyBrowserSession.mjs`).** E1/E2 (the only rulings that can change options, order, eligibility or scores, and only for a patient exactly on a threshold): a computed difference or ratio is rounded to six decimals ONCE in a shared helper and every comparison and printed figure reads it: `weightDifferenceKg`/`weightAboveDryKg` (current minus dry weight: congestion over 1.0 kg, depletion over 1.0 kg below, decompensation over 2.0 kg, Furoscix under 1.0 kg, the over-diuresis and euvolemic tests, the form label), `pulsePressureMmHg` (25 or less), `bunToCreatinineRatio` (above 20), all in `services/clinicalPredicates.ts`; `kgText` prints a kg figure with its second decimal so 1.04 never prints as the 1.0 of "more than 1.0 kg". Never subtract the weights or the pressures directly again. The low-potassium alert now reads potassium to one decimal like every other rule. E3: "; also, no oral loop diuretic step passed ..." follows the held-loop cause only when the same patient with the held and completed loop records removed still has no oral loop step (one more engine run, `loopStepWithoutRecords` in `simulationService.ts`). E4: kidney sentence prints creatinines as entered (`creatinineText`) and every rise or derived fall through `pctFigure` (a figure that rounds to 50, 100 or 30 without equalling it keeps its decimals); the acceptable-range alert says "derived eGFR fall of 30% or less". E5: an unchanged example is untouched whether the case is the raw example or the example as the form opens it (`caseIsTouched`); an open discard prompt also closes on a tab change (`App.tsx`); no function name in Evidence row HF-MRA-010; "Stop" capitalised in the nitrate/PDE5 alert; the pregnancy availability sentence is deleted on no-option outputs; "cannot be a future exposure date" compares with the local calendar date (the date input sets no `max`). E6 (controller ruling): `calculateVolumeScore` and the score detail modal now use the rounded weight difference for the penalty too and round the penalty to six decimals before the integer rounding, so two weight pairs with the same one-decimal difference always show the same volume score (about 1.7% of random patients move by one volume point; no overall score, option set or order moved in 20,000). `golden` fails on text (kidney wording, rule set) until the controller refreshes it; never run `golden:update` from a fixing session.

**2026-11-24 (local, uncommitted), round 12 fixes (controller rulings D1 to D5; rule set `2026-11-24.2`; checks in the marked "R12 SECTION" of `scripts/engineReadinessR11Checks.ts` (run by `npm run verify`) and of `scripts/verifyR11Ui.tsx` (run by `npm run verify:ui`), and the discard-prompt additions in `scripts/verifyBrowserSession.mjs`).** D1 (the only ruling that can change options, order, eligibility or scores): `assessCreatinineChange` (`services/engine/renalChange.ts`) rounds the creatinine rise and the derived eGFR fall to six decimals once (`round6`), so an exact 50% or 100% rise (0.8 to 1.2 was 49.999999999999986) is read as exactly that for every band and every consumer; an exact threshold figure prints as a whole number, one decimal only for a figure that rounds to the threshold without equalling it. It changes the band only for patients whose rise or derived fall lands exactly on a threshold (paired sweep: `HeartFailurePath-readiness/fix-r12/d1-sweep-summary.txt`). D2: the held-loop cause adds "; also, no oral loop diuretic step passed the tool's rules for this patient" in the last fall-through of the loop-unavailable reason (`candidates.ts`). D3: SLOW HEART RATE says "no rate-slowing drug is recorded as taken (...)" in the AV-block alert's words when a rate-slowing drug is held or completed (`urgentStates.ts`). D4: `noOptionKccqWording` (`stopPathAlerts.ts`) also deletes the "other eligible decisions remain available or assessable" clauses on no-option outputs, alerts included. D5: "nonsteroidal MRA" replaces "nsMRA" on every Evidence and Formulary string (`components/drugClassLabel.ts`; rule E15 text); the potassium form error and engine alert are one sentence built from `POTASSIUM_ABOVE_8_ACTION`; an open discard prompt closes on any phase, step or view change (`App.tsx`); `caseIsTouched` compares an example after the form's own derivations (`withFormDerivations`, `patientDraft.ts`); the potassium emergency check reads the value rounded to one decimal on every path (`gates.ts`, `roundedPotassium`). `golden` fails on text until the controller refreshes it; never run `golden:update` from a fixing session.

**2026-11-24 (local, uncommitted), round 11 fixes (controller rulings B1 to B7 and C1 to C8, in two parts; rule set `2026-11-24.1`; checks in `scripts/engineReadinessR11Checks.ts` (run by `npm run verify`; sweeps `scripts/engineReadinessR11Sweep.ts <mode> <firstSeed> <count> [paths]`, seeds from 60,000,000), `scripts/verifyR11Ui.tsx` (run by `npm run verify:ui`) and the new discard-prompt run in `scripts/verifyBrowserSession.mjs`).** Words and added alerts only: no first option, option set, order, eligibility result or score changed (`npm run ranking:diff` lines a, b, c at 1032 of 1032 and e YES; only alert text differs). `golden` fails on text until the controller refreshes it; never run `golden:update` from a fixing session. B1: when a held or completed loop record is what blocks a loop start or raise, the note and the "without a loop diuretic" warning say so by drug name (`candidates.ts`, `heldLoopCause`); the class-wide hold itself is unchanged. B2: EXPOSURE HISTORY for a held or completed drug that matches an allergy adds "An allergy to X is recorded: reconcile the allergy before any restart." on every path (`exposureHistoryAlert`). B3: the "highest dose" reason is not given for a loop the option removes. B4: potassium above 8.0 adds one shared action sentence (`POTASSIUM_ABOVE_8_ACTION`, engine alert and form error). B5: the third-degree block alert names held, uncertain or unreadable rate-slowing drugs instead of "none recorded". B6: an option that replaces Furoscix with a lower oral loop dose carries a drug note with both furosemide equivalents (after scoring). B7: scope sentence "no medication option is shown", "nonsteroidal MRA" in the finerenone label, the kidney alert names the criterion met (`reduceCriterionSentence`), PRICE UNKNOWN says when no pricing profile is selected. C1: the guided header, Review step and print list held and completed drugs by name beside the current-drug count and mark uncertain use (`drugRecords` in `patientFacts.ts`). C2: "Choose a different patient" and "New patient" ask "Discard the entered case?" in the page when anything was entered or changed (`DiscardConfirm.tsx`, `caseIsTouched`; focus goes to Keep editing and returns to the opener; no prompt for a blank case or an unmodified example). C3: two example-card sentences describe what the options show (a test recomputes every card from the engine). C4: HF-SCORE-004 says "up to three of the five least costly". C5: panel question 14 loses an unreachable parenthetical, the limitations page names bumetanide 0.5 mg as the third loop agent, and no-option outputs drop "other eligible decisions" from the two KCCQ lines (`noOptionKccqWording`, called in `withStop`). C6: `memory.md` and the expert-review README say what the screens say now. C8: an input-error stop shows the extreme-potassium message too (once). Existing checks rewritten (each asserted a sentence a ruling changed) are listed in the two final reports (`fix-r11/final-message-part1.md` and `-part2.md` in the readiness folder). A potassium of 8.01 to 8.04 is read as 8.0 on every engine path (round 12 D5(e): the emergency alert, no verify-the-value message; 8.05 and above get one verify message and no emergency alert); only the form's own limit is the raw 8.0, so the form still shows its verify message for 8.01 to 8.04.

**2026-11-22 (local, uncommitted), round 10 fixes (controller rulings A1 to A12; rule set `2026-11-22.3`; checks in `scripts/engineReadinessR10Checks.ts` (run by `npm run verify`; sweeps `scripts/engineReadinessR10Sweep.ts <mode> <firstSeed> <count>`, modes a1 a2 a3 a4 a5 a7 a8 a9 a10 a11a), `scripts/verifyR10Ui.tsx` (run by `npm run verify:ui`)).** The reference comparison (`npm run golden`) is refreshed by the controller after each round, so it fails after a round's edits until then and passes once refreshed; never run `golden:update` from a fixing session. A1: a congested patient taking only Furoscix is offered the same oral loop start as one who takes none (`candidates.ts`, `onAnyOralLoopForStart`). A2: in the cold state a loop diuretic that must stop is replaced when congestion is recorded. A3: an option with no loop diuretic for a congested patient says so with the cause (`simulationService.ts`). A4: a removal at the lowest dose at potassium 5.5 to 5.9 says it is withheld (`kContinuationAction.lowestDoseReason`). A5: the "no oral loop available" note is not shown on an option that starts, switches to or raises a loop. A6 to A11: wording and alert truth (binder exception in the poor-perfusion sentence, over-treatment sentence, potassium 5.5 to 5.9 on a raiser always names the value, Furoscix counted as a diuretic, limit 0 named, no "engine" on any screen, more no-allergy phrases). A12: the round 9 Furoscix co-removal now applies only to a Furoscix the patient takes (it had turned a candidate that ADDS Furoscix into a plain removal and changed budget-fallback lists); seed 40900756 differs from the pre-round-9 tree by design (round 9 Z6b allergy check on valsartan). Existing checks rewritten: three "engine policy" regexes in `verifyScenarios.ts`, `measuredModelChecks.ts` C8 and C-harm wording, `engineSafetyRound2Checks.ts` S14, R5 Y6 (the three "No medication option is ..." sentences are allowed), R7 W2 (a forced loop switch and the no-loop warning count as a loop step or note), R8 X5 (the potassium caution may stand on a raiser), R9 Z2 (binder raise) and R9 Z3 ("all three").

**2026-11-22 (local, uncommitted), round 9 fixes (controller rulings Z1 to Z12; rule set `2026-11-22.2`; checks in `scripts/engineReadinessR9Checks.ts` (run by `npm run verify`; sweeps `scripts/engineReadinessR9Sweep.ts <mode> <firstSeed> <count>`, mode `z11` is the guarantee sweep), `scripts/verifyR9Ui.tsx` (run by `npm run verify:ui`)).** Z11: a short-course add-on (Furoscix) goes with the last oral loop diuretic when an option stops it (`candidates.ts`), so an allergy, intolerance or contraindication to a loop diuretic taken with Furoscix no longer empties the screen; the guarantee (options shown, every option stops the drug) is swept over every formulary drug, every trigger and every dependent or paired drug (dependencies read from `structuralProblems`). Z1/Z8: a forced switch states its reason beside the drug stopped (`reasonBesideSource`); change lines keep a short reason (`shortenChangeLine`). Z2: the poor-perfusion alert no longer says the options hold only required reductions. Z3: every sentence quoting a total loop dose is computed from the regimens (`loopTotals`). Z4: the potassium row names the drugs the tool holds, each by its own rule (`kRaiserRow`). Z5: one true sentence on every no-option screen (`NO_OPTION_SENTENCE`). Z6: GLP-1 family, combination-product component and "no allergy" entries in the allergy check. Z7: "oral" in the decompensation sentence; a potassium reduce alert says when every option stops the drug. Z9/Z10/Z12a: wording. Open and report-only: Furoscix beside an oral loop is deliberately not a duplicate (gates.ts); current carvedilol is kept after a recorded beta-blocker bronchospasm (the rule applies to new starts only, `currentMedIntoleranceReason` has no bronchospasm branch); a duplicate change line (seed 30000758) did not reproduce in the engine (0 of 3,000 patients). `npm run golden` fails until the controller refreshes it.

**2026-11-22 (local, uncommitted), round 8 fixes (controller rulings X1 to X15; rule set `2026-11-22.1`; checks in `scripts/engineReadinessR8Checks.ts` (run by `npm run verify`; sweeps `scripts/engineReadinessR8Sweep.ts`), `scripts/verifyR8Ui.tsx` (run by `npm run verify:ui`)).** X11/X12: a start rule can never empty the option list or lose a forced removal; the allergy reader splits every separator and reads each part. X1/X3: duplicate-keep reasons and the doses-a-day count are true by the figures. X2/X5: no row tells the clinician to start a drug already taken; potassium rows follow the alerts. X13/X14/X4: loop sentences are true of the options. X6/X7/X8/X15: wording and stop-screen rules as classes. See `memory.md` for the record.

**2026-11-21 (local, uncommitted), round 7 fixes (controller rulings W1 to W14; rule set `2026-11-21.6`; checks in `scripts/engineReadinessR7Checks.ts` (run by `npm run verify`; its generated per-patient checks `R7_CHECKS` are also run in chunks by `scripts/engineReadinessR7Sweep.ts <mode> <firstSeed> <count>`), `scripts/verifyR7Ui.tsx` (run by `npm run verify:ui`) and the packet checks in `scripts/panelCasesChecks.ts`).** W1: the dosing-burden label compares with the regimen now (`regimenDosesADay`) and the cost label states the figures. W2/W12: `reconcilePlanAlerts` (explain.ts) tests every alert sentence that says what the options do, or that a drug stays at its dose, against every displayed option (duplicate-therapy, potassium hold, loop over-treatment, bradycardia, binder); a forced replacement by a new RAAS inhibitor or MRA at a high potassium is said plainly (REPLACEMENT AT HIGH POTASSIUM). W3: adjunct lines name their drug (Furoscix is its own line), a class line is absent when the class is taken or an option starts or raises it, reasons give the plan's cost. W4: staged monitoring rows name the drug held by that rule. W5: `noChangeWording` (stopPathAlerts.ts) on stop screens beside withhold or reduce alerts. W6: the specialist-advice note states NYHA IV or a worsening within 6 months. W7: no arrow, no "engine", `capitalizeSentence` keeps eGFR, low-output warning wording, scope AF sentence. W8: packet wording for no-option cases and the setting sentence for the "What matters most" cases. W10: a sentence allergy is read by the same resolver word by word; sacubitril/valsartan beside an ARB allergy carries the allergy check. W11: one angioedema predicate for the comorbidity, a structured intolerance and the allergy box. W13: allergy notes on no-option screens, a started drug judged on the produced regimen, over-budget order sentence, one not-stable list for the rehabilitation prompt, paced-rhythm note. W14: the scope statement says what is true of the low-output and cold states. Never run `golden:update` without the owner: the controller refreshes the golden reference after each verified round, so a failing `npm run golden` after a change means the output text or a first option changed and the change must be reported, not silenced.

**2026-11-21 (local, uncommitted), round 6 fixes (controller rulings V1 to V19; rule set `2026-11-21.5`; checks in `scripts/engineReadinessR6Checks.ts` (run by `npm run verify`), `scripts/verifyR6Ui.tsx` (run by `npm run verify:ui`) and the sweeps `scripts/engineReadinessR6Sweep.ts` and `scripts/r6ScreenSweep.tsx` (run through `scripts/r6ScreenSweep.mjs`); shared no-option paths in `scripts/r6Paths.ts`).** V17: a contraindication check that fires only because a kidney value was not entered is never a stated reason (`contraindicationReasons` evaluates each check again with a normal value in place of each blank one; `hardContraindicated` in `candidates.ts` likewise), so the real cause (an allergy) is the reason. V1: `ALLERGY_TEXT_RULES` in `allergy.ts` is the one list of allergy wording the engine reads as text (sulfa, loop diuretic, adhesive or acrylate, angioedema); an entry that matches a rule is never "unmatched" and an angioedema entry says what it excluded. V2: an option that starts a drug of the class of a drug the patient lists as an allergy carries an ALLERGY CHECK warning (`sameClassAllergies`, `effects.ts`), on the same warning list as the sacubitril/valsartan check (no new penalty). V3: rule E22 holds a switch from a staying ACE inhibitor or ARB to sacubitril/valsartan above potassium 5.2 (forced switches are left as they were). V4: the over-budget fallback tie sentence says nothing fits the budget. V5: every no-option screen (panel, "Why" block, monitoring heading, adjunct block, AF and congestion alert sentences, "see the ... alert" rows, screen-reader line) speaks of "no medication change is proposed"; `forStopPath`, `noMedicationChangeReadiness` and `monitoringWithoutMissingAlertReferences` in `stopPathAlerts.ts`. V6/V19b: no rehabilitation prompt beside the class-and-findings or congestion-without-weight-gain prompts. V7: a "Why" line names the withheld drug when other drugs of the class are open. V8: monitoring rows for a loop reduced or stopped and a beta-blocker started or raised. V9: the AF digoxin sentence only above a recorded resting rate of 110. V10: the missing kidney field is named exactly (`kidneyNotEntered`). V11: a POOR PERFUSION CHECK safety warning on options that start or raise a drug beside the possible-poor-perfusion alert, added after scoring. V12: `plainText` shows no typed arrow or shouted stop, wait, then instruction and says "Switch". V13: the beta-blocker specialist-advice note is gated by NYHA IV or a recent worsening; euvolemia note by congestion or a low pressure; Furoscix renal clause by eGFR below 30. V14: what the other plan does better follows "against that". V15: an eligible adjunct no option carries says why (`adjunctNotShownReason`); digoxin kidney note; low-potassium reason first in the loop-unavailable note. V16: the case packet (J0, J1, J2 are one searched-for patient; pregnancy row only where the form asks; true dose count). V18: hemoglobin, ferritin and TSAT typed as 0 are read as not entered; a blank weight gives no fluid balance. V19: start-only wording gated; the fallback says how its options are ordered. Never run `golden:update` without the owner: `npm run golden` fails on alert and warning text (and the first options listed in the round 6 record) until the owner refreshes it.

**2026-11-21 (local, uncommitted), round 5 fixes (controller rulings Y1 to Y13 and Z1; rule set `2026-11-21.4`; checks in `scripts/engineReadinessR5Checks.ts` (run by `npm run verify`), `scripts/verifyR5Ui.tsx` (run by `npm run verify:ui`) and the sweep `scripts/engineReadinessR5Sweep.ts`).** No first option changed in the 1,032 reference runs; alert text changed in 174. Y1: a blood pressure that was not entered is never read as 0 (`gates.ts`); SpO2 above 100 is an implausible value. Y2/Z1: a forced reduction names the rule that caused it; carvedilol 50 mg twice daily at 85 kg or less is reduced under the label's body-weight rule (`max_dose_reason`), and `renalCapExceeded` skips a cap on blank kidney values only when the cap has no `max_dose_reason`. Y3/Y4: two alerts in `urgentStates.ts`, "CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN" (findings at the decompensation count, weight not above the loop-start threshold, never with the scale-disagreement alert, not when anuria, loop allergy or low potassium is the reason) and "POSSIBLE POOR PERFUSION" (two of three low-output markers at an ejection fraction not below the limit); alerts only, options unchanged. Y5: finerenone's measured rows apply from LVEF 40 upward with no upper limit (`lvef_range {min: 50}` on the preserved rows). Y6: a no-option output never mentions options, plans or recommendations (stop-path wording runs on every such output; guideline citations there say "advised"); no rehabilitation prompt beside an unstable state; rate-control paragraph rules. Y7: one alert per finding. Y8: an implausible eGFR does not silence MRA potassium alerts. Y9: the tie sentence names a higher-scoring plan above the budget. Y11: evidence rows carry `applies_to` text shown on the Evidence tab. Review working files (criteria, fix specifications, reviewers' reports) live OUTSIDE the repository in `~/Projects/HeartFailurePath-readiness/`.

**2026-11-21 (local, uncommitted), round 4 fixes (rulings W1 to W11; rule set `2026-11-21.3` (it was `2026-11-21.1`; X1: evidence rows may state an `lvef_range`, read by `rowsForPatientLvef`, so finerenone at LVEF 40 to 49 uses the rows FINEARTS-HF measured; X2: with a scope condition ticked the atrial fibrillation alert is kept, limited to anticoagulation and the rate statement); checks in `scripts/engineReadinessR4Checks.ts` (run by `npm run verify`) and `scripts/verifyR4Ui.tsx` (run by `npm run verify:ui`)).** W1: a recorded SpO2 below 90% is a top-level HYPOXIA ALERT on every path (`hypoxiaAlerts`, `urgentStates.ts`; raised in `raiseClinicalAlerts`, in the stop paths through `stopPathAlerts.focusedFindings`), and the monitoring row that names it is dropped when the alert is not on screen. W2: the no-change-first tie rule (`selection.ts`) takes the best plan by the ranking order, not the first in the list (over-budget cost-first lists are ordered by cost), and is switched off when any eligible plan, or a plan the congestion display rule adds, scores `TOO_CLOSE_TO_SEPARATE_POINTS` or more above no change; the sentence now reads "No option scores 1 point or more above leaving the regimen unchanged, which is closer than the tool can separate." W3: every stop path raises every urgent alert the full path raises from entered values (`stopPathAlerts.ts`: no "covered elsewhere" drop except on the limited review, where those alerts really are on screen); a value the implausible-value rules flag (`gates.ts` `implausibleFields`, `withoutImplausibleValues`) is read as not entered. W4: the decompensation alert on a no-option path no longer mentions options. W5: with a scope condition ticked, prompts that propose therapy or assess indication are not shown (`SCOPE_HIDDEN_ALERT_HEADS`, `scopeGate.ts`; indicated-therapy block, adjuncts, missing-data notices and the readiness wording are cleared) and the scope alert says so. W6: wording (tie sentence, congestion sentence when no change is first, two-clause warning comparison, option 2 named when it is no change, the note's first "why" line is about the selected option). W7: start-only monitoring rows (`when_started`/`ongoing` on a drug's `monitoring_items`), eligible adjuncts a displayed option starts are not listed, atrial fibrillation alert states a rate above `AF_RESTING_RATE_LENIENT_TARGET` (110, RACE II) and does not call the patient stable unless the engine says so. W8: temporary-hold flag, the counted drug of a mechanism group on a tie (by name) and the missing-items list no longer depend on entry order. W9: evidence screen wording; the "Options (n)" section is no longer named a second time. W10: `components/rankingModeMeta.ts` is now `components/appStatements.ts`; `docs/scoring-architecture.md` describes the one ranking. `npm run golden` fails until the controller reviews `npm run ranking:diff`.

**2026-11-21 (local, uncommitted), round 3 fixes (rulings U1 to U14 and owner rulings 2, 4, 6 and 1; rule set `2026-11-21.1`; checks in `scripts/engineReadinessR3Checks.ts` (run by `npm run verify`) and `scripts/verifyR3Ui.tsx` (run by `npm run verify:ui`); generator `scripts/r3Generator.ts`).** `selection.ts` now records what happened to every scored plan (`PlanFate`, `SelectionTrace`) and `whyFirst.ts` counts and names those fates ("Only one option is shown" adds up; a reason for an omitted class is that plan's own fate). "No medication change" is listed first when the best option is less than `TOO_CLOSE_TO_SEPARATE_POINTS` (one point) above it. The "Prioritize foundational therapy" ranking toggle and everything only it used (`ranking_mode` handling, `RankingInfo`, `foundational_coverage`) are removed: ONE ranking (`byScoreThenCost`); `Patient.ranking_mode` remains only as an ignored field. Scope gate (policy, `services/engine/scopeGate.ts`): a scope question in both entry views; a ticked condition means no ranked option and an alert, regimen alerts still shown; unanswered shows a visible line. One always-visible research line on every page. Stop paths (`stopPathAlerts.ts`) raise every urgent alert the full path raises from entered values. Same drug entered twice keeps the more cautious use record. The ejection-fraction band is decided once from the entered patient (`evidenceBandStatement`). New alerts/rows: NYHA class against findings (prompt), ECG when the heart rate is below 50 or a rate-slowing drug is reduced for it, trial-range wording for eGFR below 20 and systolic pressure below 95. Dose credit where no trial reported the dose reached: full credit at the label target dose (or label maximum), else at any dose; each of the 13 rows carries the DailyMed sentence and set id (`label_basis`).

**2026-11-19 (local, uncommitted), round 1 screen fixes (rulings W1 to W7; spec `readiness/fix-spec-3-screen.md`; checks in `scripts/verifyScreenExplain.tsx`, run by `npm run verify:ui`; `ONLY_EXPLAIN=1 npm run verify:ui` runs only them).** The screen and the draft note now explain themselves. `services/engine/whyFirst.ts` builds `SimulationOutput.why_first` (explanation only; never changes a score, order, eligibility rule or alert): for each displayed option the sentence against the other option in natural units (relative risk, KCCQ-equivalent points, dollars a month, doses a day, measured harm rates) chosen by weighted contribution, the tie statement when the weighted difference is under one point, the comparison with making no change, one reason for each indicated class that is not started although a drug of it is eligible (per-visit limit with the classes that used it, a better-scoring plan, budget, display floor), the reason when "no medication change" leads, and the stop-state sentence when there is no option. The numbers come from `services/engine/effectView.ts` (moved from `expectedEffectModel.ts`; the card, the note and the explanation read the same function). `RegimenModification.temporary_hold` marks a forced reduction or a withhold for a changeable state (potassium, kidney function, heart rate, interaction cap, acute decompensation) so the figure is not presented as a permanent withdrawal. `components/plainText.ts` removes rule numbers, "engine policy", file names, em dashes and lower-cased abbreviations from engine strings at display time (engine text unchanged, so `npm run ranking:diff` lines (a) to (e) are the same as before). Print: `components/PrintSummary.tsx` (compact) and a print-only note; session copy of the guided entry in `components/guided/sessionStore.ts`; history entry per guided step. `golden` still fails until the controller reviews `ranking:diff`.

**2026-11-19 (local, uncommitted), round 2 part B (screen, explanations, evidence labels; rule set now `2026-11-19.3`; checks in `scripts/verifyPartBChecks.tsx`, run by `npm run verify:ui`).** "Why this is first" is at most three sentences visible with the rest under "More on why"; evidence rows carry `tested_drugs`/`inferences`/`caveats`/`event_recording` fields (display and a definition-match principle, never a charged value except through the harm rows); confirm-all changes only unassessed drugs; `evidence-status.md` is regenerated by `docs/expert-review-2026-11-19/influence.ts` then `make_evidence_status.py` and a check fails when stale. Principle: within one drug class a drug-specific harm row is charged only if it records events the way the class row it replaces does (`event_recording`); otherwise the class row is charged and the drug's own label figure goes in the notes. Five existing ACE-inhibitor rows break it and are listed in `KNOWN_RECORDING_MISMATCHES`. A first attempt to give metoprolol succinate and carvedilol their own bradycardia and dizziness rows (T14) was reversed.

**2026-11-19 (local, uncommitted), round 2 engine safety and consistency fixes (rulings S1 to S14; spec `readiness/fix-spec-2-engine.md`; checks in `scripts/engineSafetyRound2Checks.ts`, run by `npm run verify`; own sweep `scripts/engineRound2Sweep.ts`), rule set `2026-11-19.2`.** Unstable patients are no longer handled as routine titration: the cold state (`isColdState`: low output, or acute decompensation with cool extremities, SBP below 90 or pulse pressure 25 or less) shows an urgent alert and no option starts a drug or raises a dose (a diuretic step when congested, and a forced beta-blocker switch, are the exceptions); acute decompensation (the engine's own predicate) always shows an urgent alert and, when congested and a loop step is eligible, every option includes a loop start or increase (the congestion display rule: policy, not a ranking factor). Weight below dry weight with a congested examination is a scale-and-examination disagreement, not depletion. Potassium 6.0 to 6.4 offers no start or raise; third-degree AV block without a pacemaker is a stop state. Duplicate same-class drugs are resolved by fraction of each drug's own trial dose; one instruction per drug; specific reasons replace "contraindicated"; a within-class switch passes the drug's safety start limits (trial-entry criteria are not re-applied and the option says so); an option scored below "no change" is not shown unless a named rule shows it; an ACE inhibitor or ARB to sacubitril/valsartan switch counts toward the per-visit limit (`VISIT_LIMIT_WORDS`); pregnancy status is required only below age 56 (policy number) and breastfeeding is stated as not assessed. Candidate order, modification order and alert order no longer depend on entry order. `npm run golden` fails until the controller reviews `npm run ranking:diff`.

**2026-11-19 (local, uncommitted), round 1 evidence repair (controller rulings E1 to E14 after an independent audit; spec `readiness/fix-spec-1-evidence.md`, status of every row in `docs/expert-review-2026-11-19/evidence-status.md`).** The three derived beta-blocker rhythm rows are gone: atrial fibrillation uses the measured Kotecha 2014 subgroup (death 0.97), the Cleland 2018 LVEF 41-49 subgroup (1.30) and a labelled extrapolation for hospitalization; sinus and other rhythms use the three-trial pool 0.66 again. The class-average harm level and the upper-bound rows are gone (a harm not measured for a drug is borrowed from a same-mechanism class or is "not measured" and charges nothing). New evidence bases: `subgroup`, `indirect_comparison`, `conflicting`, `no_outcome_evidence` (outcome table) and `converted`, `combined` (symptom table); symptom figures are "health status, in KCCQ-equivalent points"; every row shows what it was checked against. Prior estimator now divides by the sum of the weights (death 0.0244, hospitalization 0.0817, symptoms 6.198 on the final tables). Carvedilol syncope follows label section 5.3 (0.6, was 3.0); steroidal MRA above LVEF 40 is TOPCAT alone; sodium zirconium cyclosilicate carries the REALIZE-K signal; IV iron at preserved EF carries prediction uncertainty. Outcome table 114 rows, 11 harm multipliers. `npm run golden` fails until the controller reviews `npm run ranking:diff`.

**2026-11-18 (local, uncommitted), owner-decision package, rule set `2026-11-18.1`** (controller recommendations, run as one package on the owner's instruction 2026-11-18; recommendations and evidence in `docs/owner-decisions-2026-11-18/`). C1: a start (and a cross-class switch) earns the dose credit of the highest dose this patient may be given (`highestAllowedDose`, `regimenUtils.ts`: the kidney, interaction and declared-maximum rules the candidate generator uses), and the output says which rule caps it; an increase earns the credit at the new dose. C2: for an anchor of level `drug`, credit = max(curve, dose / trial dose). C3: separate zero-centred priors for death and for hospitalization (`OUTCOME_TAU2` is now per outcome; distinct-row key is source plus numbers); rows with weight B below 0.2 are marked "mostly prior". C4: beta-blocker death rows by CURRENT rhythm (`populationKeyFor`; derived rows carry a `derivation` block that a check recomputes). C5/C6: iron at preserved EF, GLP-1 and ARB rows revised; a harm row can carry `charge_when` (kind `regimen_contains_class`). C7: seven upper-bound harm rows now charge the class average (`class_average_harm.py`; `classAverage` level). `npm run golden` fails until the controller reviews `npm run ranking:diff` and runs `golden:update`.

**2026-11-16 (local, uncommitted), first-principles scoring model — SUPERSEDES the statements below that rule set .8 "makes no individual response estimate" for outcomes, that outcome domains are unassessed with zero weight, and the "Scoring Model (weighted sum, 2026-11-10)" weights list.** Options are ranked by six weighted factors from measured or priced inputs: death from any cause and HF hospitalization (trial relative risks), symptoms (KCCQ points), side effects (one-year excess harm rates x severity), cost, dosing burden. Weights 0.30 / 0.22 / 0.10 / 0.14 / 0.14 / 0.10 are ENGINE POLICY pending owner review (`BASE_WEIGHTS`, `scoreModel.ts`). Guideline concordance and therapy completeness are shown, reference only, weight 0, and completeness is no longer a ranking step. Estimates are trial population averages, not predictions for this patient; recorded measurements are never altered; the four physiological domains stay "not assessed" (weight 0); no baseline risk is modeled. Record, formulas, every ruling, weakest rows and open owner decisions: `docs/first-principles-model-2026-11-16/README.md`. Rule set `2026-11-16.1`. Final pass 2026-11-16: unknown patient values never make an option look safer (`harmBurden.ts`: sex-specific harm charged as the higher-risk case when sex is not recorded; a risk multiplier that cannot be evaluated is applied when its ratio is above 1; `unknown_assumptions`); loop diuretics have no measured dose relation, credit 1 at any dose, congestion relief by dose is not modelled; the digoxin dose-anchor unit defect is fixed; the one remaining hand-set number is the mandatory-swap +15 (non-zero on 17 of 951 options). Checks at this pass: golden 1,032 runs byte-identical, `npm run verify` 541 passed, `npm run verify:ui` 72 passed.

**2026-11-15 (local, uncommitted), guided entry:** the app now opens in a **Guided** view (Start with six curated synthetic examples / seven steps / Results under a patient bar); the original layout is the **Full form** (header switch, or `?view=form`). One implementation of every field: `components/patient-form/usePatientFormModel.tsx` (state, validation, hints, handlers, `FormSection`) feeds both `PatientForm` and `components/guided/*`. Engine, `constants.ts`, `data/` and rule set untouched; golden byte-identical. `verify:ui` is now 52 checks. Browser check: `docs/guided-entry-2026-11-15/`. The saved 2026-11-12 browser script needs `HF_BASE_URL` ending in `?view=form`.

**2026-11-15 (local, uncommitted):** the draft note and "Visit review" panel follow a clinician-selected option (default option 1; radio group + per-card button; resets each run). `planForOption` in `components/resultsModel.ts` is the single source for the selected option's monitoring/follow-up; `buildChartSummary(c, selectedIndex)` is byte-identical to before for option 1. Rule set **2026-11-15.1**. Earlier text below that says the note is option-1-only is superseded.

**Current contract overrides historical notes below:** rule set .8 preserves observed physiology, makes no individual response/untreated-state estimate and has no automatic binder rescue. Older projection coefficients, synergy, withdrawal equations and stage-specific open lists are historical. See the handoff for the current limits and exact browser coverage.

Latest: **`docs/medication-repair-loop-2026-11-12/README.md`**, rule set **2026-11-12.8**. Repeated review repaired all identified runtime medication-model and interface defects by removing unsupported individual forecasts, adding exposure/course/interval prerequisites and preserving observed physiology. All 32 drugs / 122 dose-frequency entries covered. Gate/build: 442 engine groups, 29 UI groups, 1,032 golden runs, 100/100 + 51/51 audits, red team/pricing and two 5,000-case sweeps pass. Local Chromium workflow and desktop/mobile visuals verified. Ranking changed intentionally (472/1,032 leads); pre-update review and old snapshot retained. No validated untreated-state or longitudinal response model is claimed. Local, uncommitted, unpushed and undeployed; clinical validation remains separate.

Prior medication-property repair: `docs/medication-properties-2026-11-12/README.md`, rule set .7. All 32 drugs / 121 dose-frequency entries audited. Net-exposure transitions fix identity and swap-versus-remove/add discrepancies; projected regimen identity and numeric bounds are repaired. Gate/build pass: 423 engine checks, 27 UI groups, 1,032 golden runs and audits/fuzz. Rankings and safety outputs unchanged across all golden runs. Time-aware effects, withdrawal, flat dose responses and trial/instrument comparability remain open. Local only; no clinical validation.

Prior incomplete-information repair: `docs/incomplete-data-2026-11-12/README.md`, rule set .6. Missing observations narrow decisions rather than blocking all review. Shared change prerequisites, focused safety review, optional measured KCCQ, unassessed BNP/cost domains, no false intolerance inference and explicit screen/draft scope are implemented. Known urgent findings remain visible during input correction. Gate/build pass: 415 engine checks, 27 UI content groups, 1,032 golden runs and the existing audits/fuzz. Browser and clinical validation remain open; local only.

Prior systemic repair: `docs/adversarial-systemic-2026-11-12/README.md` (rule set .5). Canonical input validation precedes cloning; safety selection precedes affordability; no-change preserves observations; evidence normalization is independent of regimen length. Gate/build and 35,000 distinct synthetic seeds pass; browser verification remains blocked and clinical/model decisions remain open.

Prior UI review: `docs/ui-adversarial-2026-11-12/README.md`. Stale/error options are suppressed, unfinished medication/history entries block runs, new cases start blank, option-specific monitoring and actual drug/dose differences are visible, and shared wording distinguishes observations from model claims. `verify:ui` has 23 passing server-rendered checks (all 344 scenario result states); browser layout and interactions remain unverified. All changes remain local and undeployed.

Heart failure clinical decision-support simulation tool. Vite + React + TypeScript.

GitHub: `beilerman/HeartFailurePath` (public)  
Deployment target: Vercel (main branch auto-deploy)

## Commands

```bash
npm install              # install dependencies
npm run dev              # start Vite dev server (default 3000)
npm run build            # production build
npm run typecheck        # TypeScript check only
npm run verify           # scenario assertion harness — its printed count is authoritative
                         #   (latest saved receipt: Passed 442; the printed count is authoritative)
npm run test             # alias for verify
npm run verify:ui        # clinical UI content checks (the printed count is authoritative), including all 344 scenario result states; not browser tests
npm run guideline:report # REPORT, not a gate: how closely the lead reproduces guideline concordance vs the frozen guideline-driven baseline `data/golden/guideline-baseline-a6cb28f.json` (the first option of every run at commit a6cb28f) + guideline targets met/missed (also rewrites docs/outcome-evidence-2026-11-15/guideline-reproduction.txt)
npm run audit:red        # adversarial red-team probes (standalone QA, not in CI)
npm run audit:mistakes   # 51-scenario treatment-error audit (standalone QA, not in CI)
npm run audit:hundred    # 100-scenario broad clinical audit (standalone QA, not in CI)
npm run golden           # golden master: every scenario x 3 insurance tiers (1032 runs) must be byte-identical
npm run golden:update    # rewrite the golden snapshot after an intended output change (review `npm run ranking:diff` first)
npm run ranking:diff     # compare the current engine with the golden snapshot; reports ranking changes
npm run fuzz             # seeded randomized-patient sweep (5,000 patients): safety invariants written independently of the engine + consistency checks (regimen order, the ignored ranking-mode field changes nothing, care priority changes ordering only, lower-case allergy still excludes). Part of gate and ci
npm run gate             # typecheck + golden + verify + verify:ui + all three audits + audit:pricing + fuzz (full pre-release gate)
npm run ci               # typecheck + build + golden + verify + verify:ui + audit:pricing + fuzz
npm run preview          # preview production build
```

There is no `lint` script (a misleading one was removed 2026-07-05).

CI workflow: `.github/workflows/ci.yml` runs `npm ci -> typecheck -> build -> golden -> verify -> verify:ui` (then `audit:pricing` and `fuzz`, matching `npm run ci`). These local workflow edits have not yet run remotely.

QA harnesses (full pre-release gate — all four must be green):

1. `npm run verify` — scenario assertions, the CI regression gate
2. `npm run audit:red` — adversarial safety probes; pass = 0 CRITICAL/HIGH/MEDIUM findings
3. `npm run audit:mistakes` — 51 common treatment-error scenarios; pass = 51/51
4. `npm run audit:hundred` — 100-scenario broad audit; pass = 100/100

## Repository Layout

All source files live at project root (no `src/` directory).

```text
HeartFailurePath/
  App.tsx                         # top-level app shell + tabs
  index.tsx                       # React entry point (imports index.css)
  index.css                       # Tailwind entry (build-time Tailwind v3 — no runtime CDN)
  tailwind.config.js              # Tailwind configuration
  postcss.config.js               # PostCSS (tailwindcss + autoprefixer)
  types.ts                        # data models and output contracts
  constants.ts                    # formulary (32 medications)
  components/
    PatientForm.tsx               # patient input orchestration
    ResultsDisplay.tsx            # result panes, alerts, cards
    MedicationLibrary.tsx         # formulary browser
    FAQ.tsx                       # in-app logic documentation
    ScoreDetailModal.tsx          # domain-level score drilldown
    RecommendationCard.tsx        # regimen card rendering
    patient-form/                 # form subsections
  services/
    simulationService.ts          # public facade: staged orchestrator + re-exports
    engine/                       # the engine, one module per stage (see docs/scoring-architecture.md):
                                  #   inputContract, decisionReadiness, gates, eligibility (rules E01-E20), candidates, effects, domains,
                                  #   scoreModel (weights + adjustments as data), scoring, selection,
                                  #   outcomeBenefit (trial relative risks), symptomBenefit (KCCQ), harmBurden (measured harm rates),
                                  #   doseCredit (trial-achieved dose anchors, planCreditsFor), shrinkage (precision weighting),
                                  #   explain, registry, intolerance, regimenUtils, drugFacts
    clinicalPredicates.ts         # shared predicates (valueUnknown, hasHistoricalHFrEF,
                                  #   isIronDeficient, isBlackRace) — single source for
                                  #   engine AND formulary
    pricingService.ts             # mock pricing source (insurance-tiered)
  data/
    scenarios.ts                  # scenario fixtures; re-exports clonePatient
    outcomeEvidence.json          # 114 rows: relative risks (death, HF hospitalization) by class, EF band, population
    symptomEvidence.json          # 51 rows: placebo-subtracted KCCQ points by class and EF band
    harmEvidence.json             # 197 harm rows + 11 multipliers (one-year excess rates)
    harmDefinitions.json          # effect definitions, severity weights, method, rulings R1-R9
    doseEvidence.json             # 31 trial-achieved dose anchors + low-dose credit c0
  components/ (evidence UI, 2026-11-16)  # ExpectedEffect.tsx (card block + drill-down), expectedEffectModel.ts (pure display model),
                                  #   EvidenceTables.tsx (read-only tables on the Evidence tab), FAQ.tsx "How options are ordered";
                                  #   UI checks in scripts/verifyClinicalUi.tsx
  scripts/
    verifyScenarios.ts            # scenario verification harness (CI regression gate)
    redTeam.ts                    # adversarial safety probes (standalone)
    mistakeAudit.ts               # 51 treatment-error scenarios (standalone)
    hundredScenarioAudit.ts       # 100-scenario broad audit (standalone)
  docs/
    evidence-matrix.md            # rule-to-evidence traceability
    clinical-scenario-observations-2026-07-03.md
    model-analysis.md             # analysis references (moved into repo 2026-07-05)
    guideline-analysis.md
    CHF-FIRST-PRINCIPLES-ANALYSIS.md
```

## Core Clinical Engine

Primary entry point:

```ts
generateAndScoreModifications(patient, availableMedNames, prices)
```

Output contract (`SimulationOutput`, types.ts):

- `decisionReadiness?` — review scope, missing observations, available and deferred decisions
- `scoredRegimens` (up to 3 display candidates)
- `excludedMedications`
- `clinicalAlerts`
- `monitoringPlan`
- `gdmtGaps?` — indicated-but-missing pillars/adjuncts for the phenotype
- `eligibleAdjuncts?` — criteria-met add-ons (H/ISDN, ivabradine, vericiguat, iron, ...) surfaced even when not in the top-3 picks
- `missingDataNotices?` — inputs not entered, dependent inference withheld
- `followUpCalendar?` — STRONG-HF high-intensity follow-up schedule

The categorical fields are rendered by `ResultsDisplay`/`App` and asserted by the audit
harnesses — they are contract surface that must be preserved on engine changes.

Engine characteristics:

- deterministic and side-effect free at scoring level
- delta-based simulation (incremental changes from observed regimen)
- candidate modifications include add/up/down/swap/remove/keep
- affordability filter and display-safety filter applied before UI output

## Scoring Model (weighted sum, 2026-11-10) — SUPERSEDED 2026-11-16 for the domain list, weights and ranking order

> The current model is the six-factor model in `docs/first-principles-model-2026-11-16/README.md` (see the note at the top of this file). The bullets below are the 2026-11-10 description kept as history; the "Balanced weights" list (Neurohormonal 15 ... Adherence 7), completeness as a 22% domain, the special-feature points calibration and the completeness tie-break in the ranking line no longer apply. Still true: named adjustments and the reconciliation contract, `care_priority` changes only weights.

Full description: `docs/scoring-architecture.md`. All numbers live in `services/engine/scoreModel.ts`.

- Score = Σ (assessed domain scores, each 0-100) × weights that sum to 100%, plus named adjustments. Missing BNP or cost assessment removes that domain and rescales the remaining weights. Missing KCCQ is omitted from the functional average, never imputed. Scores across input completeness are not directly comparable.
- Balanced weights: Neurohormonal 15, Functional 12, Volume 12, Structure 8 (clinical outcomes);
  Guideline concordance 12, Therapy completeness 22 (guideline-directed therapy); Cost 12,
  Adherence 7 (patient values).
- `patient.care_priority` ("What matters most to this patient?") selects the weight row:
  `default` (Balanced), `outcomes_first`, `cost_first`, `simplicity_first`. It changes ONLY the eight
  weights — never eligibility, alerts, adjustments, display floors or the budget filter (verify
  enforces this for every scenario × profile). The non-default rows are a first calibration, not
  yet clinically reviewed.
- Adjustments (visible ledger lines): patient-specific evidence bonus `clamp(sum/max(1, indicated foundational slots) × 2.3, −8, +12)`;
  volume-depletion de-escalation +15; projected SBP < 90 −20, < 95 −6, < 85 sets the score to 0;
  projected HR < 50 −40; projected K+ > 5.5 −40; −8 per residual-risk warning; low-output cap 25.
  Missing renal prerequisites withhold dependent changes, including SGLT2 starts/increases/switches; the former `UNKNOWN_RENAL` deduction is retired.
  There is NO unknown-potassium deduction (`UNKNOWN_POTASSIUM` removed 2026-11-11): see rule E16 below.
- Ranking (Balanced, the default): displayed score → therapy completeness → unrounded score → cost. The completeness
  tie-break is deliberate (anti-softness): a fraction of a point must not drop a guideline pillar.
- **One ranking** (owner ruling 2026-11-20): options are ordered by `byScoreThenCost`; the earlier second ranking ("Prioritize foundational therapy", `Patient.ranking_mode`, `SimulationOutput.ranking`, `foundational_coverage`) was removed. `Patient.ranking_mode` remains only as an ignored field; a check shows it changes nothing.
- **Laboratory prerequisite (rule E16, owner decision 2026-11-11):** with potassium or renal function blank, new starts
  (E16) and dose increases/switches (dropped in `scoreCandidates`) of RAAS inhibitors and MRAs are withheld and one
  `LABS REQUIRED` alert is raised. No freshness window (no lab dates in the form) and no new numeric threshold.
- **Over budget:** the fallback warning is `BUDGET EXCEEDED: ... shown for discussion, not as a plan the patient can carry out`;
  the UI marks such a regimen not affordable (`isOverBudgetFallback` in `components/resultsModel.ts` matches the prefix).
- Renal dose caps: an arriving dose above a cap is force-reduced one step; `facts.renal_cap_is_daily` (ramipril) compares the
  total daily dose, otherwise the per-dose strength (captopril, valsartan: undecided, see the medication-review README).
- Therapy completeness = achievable indicated therapies present / achievable total (pillars +
  eligible adjuncts; graded credit below target dose: `COMPLETENESS_SUBTARGET_CREDIT` / `_GRADED_CREDIT_SPAN` in scoreModel.ts, 0.6 + 0.4 x progress from the labeled starting tier to the patient's target (`doseProgressToTarget`), 0.6 if no numeric target; new starts score as before; engine policy, ESC 6.1.6 for the direction only). "Achievable" excludes therapies filtered out
  of the formulary — never penalize a contraindicated therapy.
- Special-feature `points` calibration: outcome-level benefits are large (A-HeFT 60, FINEARTS 45,
  GLP-1 40 (both agents), iron 40 (20 at LVEF 41-49), binders 0 (no bonus since 2026-11-11), TOPCAT HFpEF 18); intra-class tolerability tiebreakers are
  small (eplerenone "no gynecomastia" 3). The `/regimenLength` normalization amplifies a lone
  special drug, so a tolerability footnote must stay small.
- Scores before and after 2026-11-10 are not comparable (the old scale had 30 points of headroom
  and clamped at 100).

Guideline domain behavior:

Two phenotypes since 2026-11-11 (2026 ESC guideline; HFmrEF removed; `classifyPhenotype` in `services/engine/domains.ts`):

- HFrEF (`LVEF < 50`, improved EF, or current LVEF >= 50 with a recorded numeric prior LVEF < 50): quad pillars (RAAS, BB, MRA, SGLT2i), all Class I. LVEF 41-49 is treated as reduced EF per the 2026 ESC guideline; the 2022 AHA/ACC/HFSA guideline keeps a separate mildly reduced category with weaker recommendations
- HFpEF (`>= 50` and never below 50): SGLT2i + MRA, both Class I (steroidal or finerenone); a RAAS inhibitor is Class IIb (small credit, never a gap, slot or new start)
- HFimpEF preservation: continue full HFrEF logic when prior reduced EF (40 or lower) is known or strongly suspected
- Drug-specific LVEF criteria keep their own evidence thresholds (digoxin/H-ISDN 40, ivabradine 35, vericiguat 45, GLP-1 45/50, IV iron < 50, finerenone label 40)
- ESC alignment details (RAAS potassium rules, E18, the eGFR-20 alert, Table 11 doses, loops, heart-rate thresholds, no binder bonus): `docs/scoring-architecture.md` last section and `docs/evidence-matrix.md` rows HF-ESC-001..011. ESC Supplementary tables S3-S9 and the device, advanced-HF and AF tables (Rec. Tables 6, 7, 11, 15) were read, plus the 2022 US text points (Table 12, 7.3.2, 7.3.3, 7.3.6, 7.6.1; US class labels were images, still secondary); S26, the decompensated-HF tables and the valve/amyloidosis sections were not. Device, advanced-HF and AF alerts (HF-ESC-014) are alerts only and ask the clinician to check QRS, LBBB, aetiology, anticoagulant and hospitalizations (no form fields)

## Safety Logic and Hard Blocks

Implemented high-priority safeguards include:

- Input validity:
  - SBP must be greater than DBP
  - duplicate current medications are removed with safety alert
  - physiologically impossible values (LVEF > 80, K+ > 8, etc.) hard-stop: alerts only, no recommendations
- Hemodynamic safety:
  - `SBP < 90` returns alerts only (no regimen output)
  - projected `SBP < 85` excluded from display
  - projected `HR < 45` excluded from display
- Electrolyte safety:
  - hyperkalemic-emergency gate (6.0 alert and 6.5 alerts-only stop are ENGINE POLICY; a secondary source classes K+ > 6.0 as severe): baseline `K+ >= 6.0` fires a HYPERKALEMIC EMERGENCY alert (ECG and urgent repeat potassium; no RAAS/MRA start or increase at 6.0-6.4, a current MRA is withheld); `K+ >= 6.5` returns alerts only (parallel to the SBP < 90 gate); `K+ > 8.0` hard-stops as implausible
  - projected `K+ > 6.0` excluded from display
  - K+ binder rescue (reactive, projected K+ above 5.3; never auto-attached to reduction/removal-only changes of RAAS/MRA therapy; attached only when every potassium-raising class in the candidate was already on the current regimen AND the candidate keeps, up-titrates or within-class-swaps a RAAS-pool drug or MRA/nsMRA from the current regimen (`keepsCurrentPotassiumRaiser`; a candidate with none, e.g. a new beta-blocker start, gets no binder and is scored on its own projected potassium; 2026-11-11 final pass), so never a co-start with a new MRA or RAAS inhibitor; a candidate needing a binder for a NEW class is dropped) counts as a residual-risk warning penalty (rescue enables consideration, never erases risk in ranking)
- Blank-data (sentinel) safety:
  - eGFR/creatinine or K+ of 0/blank = "not entered", never a value: it must never clear a safety gate AND never read as end-stage disease
  - blank renal data: current therapy is not stopped solely because data are absent; renal-dependent starts, increases and switches are withheld through shared prerequisites. Renal-threshold warnings are suppressed when the measurement is unknown. Missing lab safety cannot be replaced by a score penalty.
  - blank potassium: projected K+ preserves the unknown sentinel; hypo-/hyperkalemia warning bands, the digoxin K-band warning, and DDI-3's interpolated K+ are suppressed (prompts for a BMP instead); digoxin's K+ < 3.5 contraindication has a > 0 guard
- Drug-interaction hard gates:
  - nitrate (H/ISDN) is contraindicated with confirmed PDE5 inhibitor exposure (Sildenafil/Tadalafil/Vardenafil/Avanafil in external medications) or riociguat — excluded from formulary and force-removed from arriving regimens
- Pregnancy safety:
  - excludes RAAS classes, MRAs/nsMRA, SGLT2i, Vericiguat (FDA boxed warning — embryo-fetal toxicity), Ivabradine (fetal harm), and GLP-1 therapy
  - H/ISDN deliberately remains pregnancy-appropriate (the RAAS alternative for pregnant HFrEF)
  - beta-blockers (rule E17, 2026 ESC Class I C): a NEW start is limited to beta-1-selective agents (`facts.beta1_selective`); a non-selective one already on board (carvedilol) gets a switch offered with the reason, never a bare removal
- Initiation-vs-continuation carve-outs (the `alreadyOn*` pattern):
  - Vericiguat: VICTORIA enrollment criteria (NT-proBNP >= 1000 sinus / >= 1600 AFib, NYHA II-IV, recent worsening, LVEF < 45) gate INITIATION only — a patient already on vericiguat is never force-removed for improved markers; pregnancy still forces removal
  - GLP-1: `BMI >= 30` (both agents), LVEF >= 45 (semaglutide) / >= 50 (tirzepatide) gate INITIATION only; continuation is blocked only by true safety CIs (pregnancy, MTC/MEN2) — weight-loss success never forces removal
  - SGLT2i eGFR floor (dapagliflozin 25, empagliflozin 20) and ivabradine HR thresholds follow the same pattern (initiation HR >= 70; continuation: HR below 50 reduces one step, withheld at the lowest dose)
- Current-regimen history checks:
  - a current med matching a documented ALLERGY by name is flagged and force-swapped to a tolerated same-group agent (else removed) — it is never kept or up-titrated
  - a current med appearing in the discontinued list raises a MEDICATION HISTORY CONFLICT alert (verify deliberate restart) rather than forced removal
- Acute decompensation handling (two-tier beta-blocker logic):
  - blocks beta-blocker initiation (warm OR cold)
  - defers beta-blocker UP-TITRATION in ANY acute decompensation (warm or cold) — continue the current dose and diurese; up-titrate after euvolemia
  - forces existing beta-blocker dose REDUCTION only with hypoperfusion ("cold-and-wet": cool extremities, SBP < 90, or pulse pressure ≤ 25) — the cut is ONE dose step down (~50%, e.g. carvedilol 25 → 12.5), not a jump to the lowest tier; warm-and-wet continues the beta-blocker and diureses
  - safe guideline ADDITIONS (esp. SGLT2i — beneficial in acute HF, EMPULSE/SOLOIST) are force-injected alongside any mandated BB reduction so decompensation never suppresses gap-closing therapy
- MRA potassium and interaction rules (2026-11-10, `docs/medication-review-2026-11-10/verified-mra-binders.md`):
  - new MRA starts: K+ > 5.5 is a contraindication (initiation only, `mraStartPotassiumCheck`); rule E15 withholds a new MRA at K+ 5.0 or higher with or without a binder (decision 2026-11-11, boundary tightened from above 5.0 on the second pass: recheck, start once K+ is below 5.0; the DIAMOND binder co-start was removed; sources: 2022 US text 7.3.3 (primary) potassium 5.0 or above and eGFR 30 or below are contraindications to initiation, ESC 2026 "caution" at 5.0 or above, labels allow exactly 5.0 (looser, not used)). A new spironolactone start is also a contraindication at eGFR 30 or below (`mraStartEgfrCheck`; a current drug is not removed); spironolactone and eplerenone are capped at 25 mg below eGFR 50 (halved dosing 31-49). The MRA GDMT gap states the reason and the monitoring plan adds "repeat potassium; start MRA once below 5.0"
  - continuation: `facts.k_continuation` on spironolactone/eplerenone/finerenone: K+ 5.5-5.9 forces a ONE-STEP reduction (withhold at the lowest dose), K+ >= 6.0 withholds (removal); restart low once K+ < 5.5
  - eplerenone/finerenone contraindicated with strong CYP3A inhibitors (`STRONG_CYP3A_INHIBITORS`); eplerenone capped at 25 mg with a moderate inhibitor (`interaction_dose_cap`) and contraindicated at eGFR <= 30; finerenone/spironolactone contraindicated in adrenal insufficiency
  - `Medication.start_dose_for(patient)` is the opt-in per-drug cap on the dose a NEW START may begin at (finerenone 10/20 mg by eGFR, spironolactone 12.5/25 mg by eGFR); finerenone's target comes from `is_target_dose_for` (20 mg if eGFR < 60, else 40 mg)
  - binders: prevention potassium effects (patiromer -0.1; Lokelma -0.3/-0.6/-0.7 at 5/10/15 g), tried lowest dose first across binders; binders carry no evidence bonus (removed 2026-11-11); drug-data warnings/monitoring come from `facts.regimen_warnings` / `facts.monitoring_items` (warning text starts "Drug note" and is not score-penalized)
- RAAS rules (2026-11-10, `docs/medication-review-2026-11-10/verified-raas.md`):
  - every ACEi/ARB/ARNI declares `start_dose_for` (new starts begin at the lowest tier; the ARNI uses `facts.start_dose_exact`: 24/26 mg bid when not on an ACEi/ARB or on a low dose (`facts.low_dose_max_daily_mg`), eGFR < 60/blank (label: < 30; 30-59 is the stricter 2026 ESC Table 11 option), chronic hypotension, or Child-Pugh B; otherwise 49/51; 97/103 only by titration) and verify fails any RAAS add/swap-in above it (root cause of the old "Add 97/103" bug: `restrictToStartTiers` passed through any drug without the hook)
  - hepatic: "Liver Disease (Child-Pugh B/C)" excludes the ARNI (severity unknown); the extra option "Liver Disease: Child-Pugh B confirmed (not C)" lifts it with a reduced start; all other liver-gated drugs treat either option as liver disease (`hasChildPughBorC`)
  - aliskiren + diabetes contraindicates ARNI/ACEi/ARB (`CI_ALISKIREN_DIABETES`); 36-hour washout warns in both directions (ACEi<->ARNI); ARNI start at SBP < 100 carries a score-penalized caution
  - lisinopril/enalapril/losartan/candesartan have no renal max-dose caps (valsartan 80 mg and ramipril caps kept); losartan target is 150 mg (2026 ESC Table 11; 100 mg earns graded credit and can be increased)
  - generic sacubitril/valsartan pricing (cash ~$60 with a discount card)
- Rate-control rules (2026-11-10, `docs/medication-review-2026-11-10/verified-rate-control.md`):
  - `facts.hr_continuation` (`hrContinuationAction` in `regimenUtils.ts`): HR below `reduce_below` on an established beta-blocker/ivabradine forces a ONE-STEP reduction via `forcedReduceNames` (exact next-lower strength on the full ladder, `forcedReduceExactStep`), withhold at the lowest dose; no up-titration below `no_uptitration_below`; skipped in a "Paced" rhythm; alert `BRADYCARDIA ON <DRUG>` from `gates.ts`. Beta-blockers: reduce below 55 for carvedilol (label) and below 50 for metoprolol succinate and bisoprolol (2026 ESC S6), no up-titration below 60 (engine policy). Ivabradine: 50/61 (label)
  - beta-blocker NEW-start block is initiation-only (`bbStartBradycardiaCheck`): below HR 55 for carvedilol (label), below 50 for metoprolol succinate and bisoprolol (2026 ESC S6); the up-titration hold below 60 is engine policy; AV block 2/3 and sick sinus syndrome without a pacemaker (`SICK_SINUS` comorbidity) still force removal
  - carvedilol effect ratio capped at 25 mg bid; carvedilol/metoprolol/bisoprolol equal at target (lvef 9, NT-proBNP -22%, KCCQ 6, LVEDD -10%, structure 35); carvedilol hepatic CI only for unspecified B/C (B confirmed = caution); metoprolol has no hepatic CI; bisoprolol tiers 2.5/5/10 (1.25 dropped, US strengths)
  - ivabradine: label contraindications in `constants.ts`, exact start tier via `start_dose_for` (2.5 mg for conduction defect / amiodarone / digoxin, else 5), "maximally tolerated" beta-blocker in `candidates.ts` (`bbMaxTolerated`), HR >= 70 is initiation only (bonus kept while on the drug)
  - digoxin: indication gate in `candidates.ts` (any rhythm: LVEF <= 40, NYHA II-IV, no addable/below-target pillar, ESC IIa B1; AFib: beta-blocker optimized); VF is the CI; WPW, K+ > 5.5, eGFR < 15 are penalized warnings; `facts.hr_effect_only_in_rhythm: 'AFib'`; NT-proBNP effect 0
- SGLT2i / GLP-1 / vericiguat / IV iron / H-ISDN rules (2026-11-10, `docs/medication-review-2026-11-10/verified-sglt2-glp1-adjuncts.md`; numbers marked engine policy or interpolated are listed in `docs/evidence-matrix.md`):
  - effects are PLACEBO-ADJUSTED: semaglutide KCCQ 7.8 (7.3 in type 2 diabetes), tirzepatide 6.9; GLP-1 weight is `weight_reduction_percent` of the patient's weight (`patientChfEffects` in `effects.ts`, `facts.t2dm_scale`); SGLT2i KCCQ 2.5 / 2.0; vericiguat KCCQ 0.5
  - GLP-1 doses: every labeled tier is offered (`facts.titrate_one_step`: the tier sampler returns all tiers and `titratableUp` offers only the next one); a new start is the exact lowest tier (`start_dose_for` + `start_dose_exact`); GLP-1 Therapy is in `TITRATE_NOT_SWAP_GROUPS`; tirzepatide uses a saturating dose map, semaglutide keeps the linear one; both agents are offered (no cross-trial "best" pick)
  - initiation criteria that live on the entry: GLP-1 BMI/LVEF, vericiguat NYHA/LVEF/NT-proBNP by rhythm/worsening/riociguat, ferric carboxymaltose Hb >= 15 hold; `candidates.ts` only picks the exact start tier of the entries that survive eligibility
  - H/ISDN Class 1 needs a RAAS inhibitor AND a beta-blocker on board (or documented inability: `allRAASExcluded` / `allBBExcluded`), LVEF <= 40; Class 2b is the separate RAAS-unavailable path
  - IV iron: `ivIronCreditTier` (clinicalPredicates.ts) gates the bonus, the candidate and the auto-rescue (iron deficient, NYHA II-III, Hb < 15, LVEF < 50; half bonus at 41-49); the dose is the label table by weight and `patient.hemoglobin` (`facts.single_course_dose`: never titrated); price is a per-course cost amortized over 6 months
  - `facts.regimen_warnings` entries may be a function of the patient and take `(patient, regimen)` for `when`; `facts.cash_price_by_dose` overrides the flat price in the cash tier (Zepbound)
- Diuretic rules (2026-11-10, `docs/medication-review-2026-11-10/verified-diuretics.md`; numbers marked engine policy or assumption are in `docs/evidence-matrix.md` HF-DIU-001..013):
  - loop effects and `facts.high_dose_threshold` use the TOTAL DAILY dose (`dailyDose`/`effectDose` in `regimenUtils.ts`, `facts.effects_on_daily_dose`); the calibrated curve is unchanged and a daily dose above the calibrated top is a ceiling; titration keeps the current frequency (`carryFrequency`)
  - `facts.max_daily_dose` (furosemide 600, torsemide 200, bumetanide 10 mg): never exceeded by candidate generation or frequency selection; verify checks every displayed regimen
  - strengths are marketed ones only (bumetanide 4 mg removed; torsemide 5/10/20/40/100; furosemide 160 = 2 x 80 mg; HCTZ 12.5; metolazone 2.5 (below the labeled HF range)/5/10)
  - thiazide-type add-on credit 1.1 kg (CLOROTIC, HCTZ; same for chlorthalidone and metolazone as an assumption); `facts.raises_uric_acid` gives every loop and thiazide-type drug the gout caution; metolazone: BMP monitoring item and a penalized hypokalemia caution below K+ 3.5 (`facts.hypokalemia_caution_below_k`, not a contraindication); HCTZ eGFR < 30 is a caution (< 15 and anuria excluded)
  - loop response at low eGFR: monitoring note only (no sourced multiplier); torsemide has no best-in-class badge
- Dose-step rules (2026-11-10 final pass, `docs/evidence-matrix.md` HF-MRA-007, HF-RAAS-012, HF-DIU-014, HF-TITR-001):
  - `facts.target_daily_dose` (ramipril 10 mg/day): `isTargetDoseForPatient` compares total daily dose, so 5 mg bid is target; `carryFrequency` keeps the current frequency on titration (never above the renal daily cap) and a step that does not raise the daily dose is not an up-titration
  - the immediate next tier above and below the current dose is always a titration candidate (`adjacentTiers`), on top of the sampler's lowest/middle/highest/target; verify invariant "titration never skips the next step"
  - `facts.k_uptitration_max` (finerenone/eplerenone label 5.0; spironolactone 5.0 engine policy): no MRA increase at K+ >= 5.0, alert `POTASSIUM HOLD ON <DRUG>`
  - loop swaps: `facts.verified_furosemide_equivalent_per_mg` (furosemide 1, bumetanide 40) lands the swap at the equivalent daily dose (`equivalentSwapTier`); torsemide declares 2 (TRANSFORM-HF protocol 1 mg : 2 mg, a trial protocol; decision 2026-11-11) so every swap lands at the equivalent daily dose (there is no unconverted-swap fallback; a verify invariant requires every standing loop to declare it)
  - form input hints read `services/engine/thresholds.ts` (exported via the facade); never keep display-only copies
- Structural regimen safety:
  - blocks dual RAAS combinations
  - blocks dual MRA combinations
- Documented-intolerance policy (`deriveIntolerancePolicy`, single source of truth):
  - applied to BOTH new-start formulary filtering AND the arriving regimen (`analyzeCurrentRegimen`) — a class excluded from initiation can never be retained/titrated when already on board
  - two evidence tiers: free-text keyword match (`suspected`) only blocks NEW starts; the structured dropdown reason (`confirmed`) is required to force changes to CURRENT therapy (protects against negated free text like "no cough" / "angioedema ruled out")
  - an intolerable current med is force-SWAPPED to a tolerated same-group agent when one exists (ACEi cough → ARB/ARNI; spironolactone gynecomastia → eplerenone/finerenone), falling back to removal — cleanup never silently costs a GDMT pillar; the bare "just stop it" removal candidate is suppressed when a swap exists (it would win the affordability filter at $0 and display an empty regimen)
  - gynecomastia is agent-specific (spironolactone + named offender avoided; non-offending eplerenone/finerenone preserved); MRA hyperkalemia intolerance applies to all MRA types; angioedema excludes ACEi + ARNI with ARB allowed under caution; BB intolerance defers NEW initiation only (existing BB continued)
  - dual-MRA prevention ignores a current MRA that is departing (intolerance/contraindication) so the tolerated replacement is not blocked by the drug being removed
  - a hard contraindication (`med.contraindications(patient)`) takes precedence over historical intolerance in forced-removal labeling

Additional safety support:

- DDI warnings (for example BB+Ivabradine, Digoxin interactions, lithium + diuretics)
- CKD and volume-depletion alerts
- mandatory monitoring-plan generation for high-risk intensification paths

## Furoscix Implementation

Furoscix is modeled as (2026-11-10, `docs/medication-review-2026-11-10/verified-diuretics.md`):

- medication name: `Furoscix (SC Furosemide)`
- class: `Loop Diuretic`
- dose: `80 mg/10mL SQ on-body infusor (5h)` (single modeled tier), `facts.short_course_addon`: a SHORT-COURSE ADD-ON beside an oral loop (label: not for chronic use), never a swap or standing replacement (swap candidates exclude it; it is not counted as a duplicate loop)
- credited as 160 mg oral furosemide (`facts.oral_equivalent_multiplier` 2.0) and, beside an oral loop, only the increment above that loop (`effectsFor` in `effects.ts`)
- priced per course of 4 kits (assumption)

Behavioral integration:

- offered (`candidates.ts`) only at >= 2 kg above dry weight with an oral loop on board; summary says SHORT COURSE; monitoring item resumes/adjusts the oral loop
- contraindication checks include:
  - under 1 kg above dry weight
  - no oral loop on board
  - anuria (comorbidity option `Anuria`; there is NO eGFR exclusion: CKD is an indication, eGFR < 30 is a caution)
  - furosemide hypersensitivity
  - adhesive/acrylate hypersensitivity
- mandatory regimen warning when included:
  - `FUROSCIX SAFETY: ... on-body SQ infusor ...`
- hypoxemia triage warning when clinically relevant

## Formulary Snapshot

`constants.ts` currently defines:

- 32 medications
- 17 classes

Major class groups include RAAS, beta blockers, MRAs/nsMRA, SGLT2i, loop/thiazide diuretics, vasodilator, If inhibitor, sGC stimulator, GLP-1 therapies, IV iron, K+ binders, and digoxin.

Formulary modeling notes (2026-07-05 audit):

- GLP-1 `chf_effects` are dose-scaled (semaglutide ratio `d/2.4`, floor 0.25; tirzepatide a saturating map 0.25/0.70/0.81/0.925/0.96/1 over 2.5-15 mg, see 2026-11-10 rules above) — a starting-dose add is no longer credited the full STEP-HFpEF/SUMMIT steady-state benefit. Eplerenone is similarly dose-scaled (`d/50`), matching spironolactone.
- Loop diuretic weight-loss curves are calibrated to documented dose-response anchors via `log2` ceiling curves: furosemide `1.5 + 0.9*log2(d/20)` (~1.5/2.4/3.3/4.2 kg at 20/40/80/160 mg/day); torsemide `1.8 + 0.96*log2(d/10)` (~1.8/2.8/3.6/5.0 kg at 10/20/40/100 mg/day); bumetanide inherits the furosemide curve via 40:1 equivalence; Furoscix uses the calibrated curve on its oral equivalent (80 mg SC = 160 mg oral, multiplier 2.0); `d` is the TOTAL DAILY dose.
- The `renal_adjustment` contract is fully honored by the engine: `contraindicated: true` excludes exactly like `contraindications()` (formulary filter + current-med audit); `caution: true` surfaces as a "Renal dosing review" monitoring-plan item (not a ranking-penalized warning); `start_dose_modifier` surfaces as a "Reduced starting dose (renal)" monitoring item for adds.

## Verification Harness

`scripts/verifyScenarios.ts` executes scenario assertions against `data/scenarios.ts`.

Current regression scope (the harness's printed count is authoritative — on 2026-11-12 `Passed: 415`):

- 344 scenarios (`SCENARIOS.length`) + structural checks, 415 passes in total on 2026-11-12 (the ignored ranking-mode field changes nothing; every med has a `DRUG_PRICES` entry; every `score_breakdown` reconciles to `raw_score`; every exclusion carries a known eligibility `rule_id`; no formulary drug name appears as a literal in engine code; no `services/engine/` module imports the facade; every weight profile sums to 100%; weight profiles never change exclusions/alerts/safety floors; profile direction checks; contraindication checks equal the boolean; every E13 exclusion states why; no new MRA start above potassium 5.0 (with or without a binder); monitoring timings follow the sources; every standing loop declares a furosemide equivalence; no new start above the declared starting dose; no regimen above a declared maximum daily dose; a congested patient with a possible loop increase is shown one; below-target dose credit is graded; no displayed titrate-up more than doubles the total daily dose except the adjacent tier (`UP_TITRATION_MAX_DAILY_FACTOR`; sourced for RAAS/BB/MRA by ESC 2026 S4-S6/S8, engine policy for loops and others); a one-step titration always exists unless a rule blocks it)
- safety invariants (dual-class prevention, score bounds, display floors)
- contraindication logic
- phenotype-specific recommendations
- warning and alert expectations
- Furoscix candidate + allergy guardrail checks

This harness is the primary safety regression gate for logic edits. The three standalone audit
harnesses (`audit:red`, `audit:mistakes`, `audit:hundred` — see Commands) are deliberately outside
CI but are part of the full pre-release gate.

## Architecture (GlucosePATH-aligned, 2026-11-10)

Read `docs/scoring-architecture.md` before changing the engine. Rules that keep the shape:

- Weights and every adjustment magnitude live in `services/engine/scoreModel.ts` (`WEIGHT_PROFILES`, `SCORE_ADJUSTMENTS`). Never inline a scoring number in engine or component code; a new adjustment needs a code there AND a line in `score_breakdown`, or the reconciliation invariant fails.
- A new exclusion is a new numbered rule in `ELIGIBILITY_RULES` (`services/engine/eligibility.ts`), not an inline `if`. Rule order is precedence (first match wins).
- Contraindications are a list of named checks with reasons (`ci([...])` in `constants.ts`); the boolean is derived from them. Never write a bare boolean `contraindications`.
- Drug-specific knowledge goes on the formulary entry (`facts`, hooks) and is read with `drugFacts(med)`. A drug-name string literal in engine code fails verify.
- Import engine symbols from `services/simulationService` (the facade) outside `services/engine/`; inside it, never import the facade.
- `npm run golden` must stay byte-identical for a refactor. Run `npm run golden:update` only for an intended clinical change, in its own commit explaining why. New explanation-only output fields are listed in `ADDITIVE_KEYS` in `scripts/goldenMaster.ts`.

## Medication Modeling (source-verified 2026-11-10)

`docs/medication-review-2026-11-10/` holds the review of all formulary drugs, the source
verification (`verified-*.md`, with URLs) and the measured effect of each correction
(`changes-*.txt`). `docs/evidence-matrix.md` maps each rule to its source. Rules that came out of it:

- **Congestion coverage is a selection step, not a score** (`ensureCongestionCoverage`, `selection.ts`, after distinct-pick selection): congested (`isCongestedAboveDryWeight`, > `CONGESTION_EXCESS_KG_ABOVE` kg over dry weight) and no displayed option raises/starts a loop -> the best-ranked display-safe candidate that does (preferring a plain loop step: loop change alone plus forced removals/reductions, `isPlainLoopStep`; never one failing `isProjectedSafetyClean`) replaces the last pick (or is appended); option 1 is never displaced; `shown_because` is explanation-only (golden `ADDITIVE_KEYS`; card + chart text). Below-target dose credit is progress from the starting dose to target (0.6 to 1.0). Two same-drug-set picks are distinct only when both are solely up-titrations of different drugs.
- **Up-titration is capped at double the total daily dose per visit** (`UP_TITRATION_MAX_DAILY_FACTOR`, `higherDoses` in `candidates.ts`; the adjacent tier is always kept). ESC 2026 S4-S6/S8 source it for RAAS/BB/MRA; for loops (S7, no step size) and other classes it is engine policy. Anything reading `titratableUp[].options[last]` gets the capped maximum, by intent.
- **Starting versus continuing.** A threshold that blocks a NEW start must not remove a drug the
  patient already takes. Continuation rules are data on the entry: `facts.k_continuation` (MRAs:
  reduce one step at potassium 5.5-5.9, withhold at 6.0), `facts.hr_continuation` (ivabradine),
  beta-blockers reduce one step below their heart-rate threshold (55 carvedilol, 50 metoprolol succinate and bisoprolol) and are removed only for high-grade AV block,
  sick sinus syndrome without a pacemaker, or bradycardia at the lowest dose.
- **New starts use the label starting dose.** Declare `start_dose_for(patient)` (a ceiling) and, when
  the label gives one exact start, `facts.start_dose_exact`. Higher tiers are reached by titration.
  `facts.titrate_one_step` forbids skipping tiers (GLP-1 drugs).
- **Daily dose.** Loop effects, the high-dose alert and `facts.max_daily_dose` use total daily dose
  (`dailyDose` in `regimenUtils.ts`), never the per-dose strength.
- **Effects are treatment effects.** Use the placebo-adjusted trial difference, not the active-arm
  change (the GLP-1 quality-of-life values were corrected for this).
- **A new RAAS inhibitor is not started above potassium 5.2 and a new MRA not at 5.0 or higher, with or without a binder** (rules E18 and E15; E15 is the 2022 US/ESC 5.0 boundary, E18 is the ESC "caution" threshold, staging is engine policy). eGFR below 20 on a RAAS inhibitor is an ALERT only, never a stop, unless the OPTIONAL `baseline_creatinine` is entered: then `renalChange.ts` applies the ESC change rules (creatinine rise 50% or more or derived eGFR fall over 30%: halve RAAS inhibitor and MRA one step, no increase; rise over 100% or 50% with eGFR below 20: stop RAAS inhibitor, withhold MRA, specialist advice; blank baseline = old behaviour). The reactive binder rescue
  (projected K+ above 5.3) remains; patiromer is the preferred binder in heart failure (Lokelma carries a sodium load;
  automatic rescue is capped at 10 g). Pregnancy: new beta-blocker starts are beta-1-selective only (E17) and carvedilol is
  switched (2026 ESC Class I C).
- **Furoscix is a short-course add-on** beside an oral loop, never a standing replacement.
- **Sourced versus policy.** A number with no primary source is marked "engine policy" or
  "assumption" in its code comment and in the evidence matrix. Do not present policy as evidence.
- Unverified findings were NOT changed. They are listed for physician review in
  `docs/medication-review-2026-11-10/README.md`.

### Adversarial review changes (2026-11-12)

- **E19** (`eligibility.ts`): no NEW RAAS inhibitor or MRA while the entered baseline creatinine shows the "reduce" band (rise of 50% or more, or derived eGFR fall over 30%). Rules are E01-E19. E15's "already on an MRA" exemption applies to a within-class switch only while that MRA may continue (potassium below 5.5).
- **Dose steps** (`candidates.ts`): the step cap also applies to combination strengths (sacubitril/valsartan 24/26 cannot go to 97/103; H/ISDN likewise). The always-kept next step is the smallest increase in total daily dose when the next strength at its usual frequency would more than double it (furosemide 80 mg once daily goes to 80 mg twice daily); see `comparableDailyDose` / `smallestStepAbove`.
- **`structuralProblems()`**: every candidate is checked after the forced edits; a regimen with the same drug twice, two agents of one class group, or a short-course add-on without its oral loop is dropped.
- **Lateral swaps**: outside the RAAS pool a swap is offered only when the current drug must go (contraindication, intolerance, allergy) or the loop-resistance rule fires. A drug withheld by a potassium, heart-rate or kidney rule is never swapped for a sibling; a contraindicated diuretic in a non-congested patient is stopped, not replaced.
- **Diuretics** are not increased more than 1 kg below dry weight, or at or below dry weight with no congestion finding (`diureticHeldForNoCongestion`). `congestionFindingCount()` (`clinicalPredicates.ts`) counts edema once whatever the grade and ignores cool extremities (a perfusion sign); the decompensation rule, the volume score and the congestion gate all use it. The form allows one edema grade at a time.
- **Class-wide cautions and CIs**: a loop or thiazide-type diuretic added, swapped in or increased with measured potassium below 3.5 carries a penalized caution (was metolazone only). Anuria is a contraindication check on all loops and chlorthalidone.
- **Scoring**: the projected SBP 90/95 and HR below 50 bands read the LOWER of projected and entered value; penalized warnings already true of the current regimen (`baselineDangerWarnings`, `scoring.ts`) are charged to every option so none beats "no change" by cutting a drug; a fact with a named adjustment is not also charged as a generic warning (`WARNINGS_PRICED_BY_NAMED_ADJUSTMENT`); the special-feature divisor is the larger of regimen size and the number of indicated foundational therapies; `foundational_coverage` counts INDICATED pillars (the card says "n of m on board; k cannot be started today"); quadruple-therapy synergy is reduced-EF only; KCCQ is clamped to 0-100.
- **Selection** (`selection.ts`): BP and HR display floors apply only when the regimen moves the value the wrong way from baseline (the high potassium floor stays absolute; an option that LOWERS projected potassium below 3.0 is hidden: the renal multiplier applies to rises only, `kPair` in `effects.ts`); the NO DISPLAY-SAFE alert names the floor; ties break alphabetically and projected SBP/HR/K+ are rounded to 2 decimals (the answer must not depend on typing order); in the over-budget fallback the safety floors come before the five cheapest and a 0-scored option is not shown merely for being cheap; the automatic IV iron add-on is dropped when it alone would exceed budget.
- **Rescue binder**: patiromer is auto-added at its label starting dose only (`facts.rescue_role.max_rescue_dose` 8.4 g daily). A rescue binder or iron that breaks the per-visit limit or the budget is dropped from the option, never the option. A binder in use is not reduced while measured potassium is 5.0 or higher.
- **Second pass 2026-11-12 (17 items; table in `docs/adversarial-review-2026-11-12.md`)**: RAAS increases are held above K+ 5.2, same as new starts (verify invariant); tie-break order is score, coverage, unrounded score, cost, FEWER CHANGES, then alphabetical; one threshold per drug for "at target"; one `INTOLERANCE_TABLE` (cautions are unpenalized "Intolerance history:" warnings); every selectable form option must be read by the engine (`DISPLAY_ONLY_OPTIONS` empty); label vs guideline differences are data (`facts.source_differences`); `side_effects` rates are display-only (verify fails if engine code reads them); patient cost is capped at the cash price (`npm run audit:pricing`); `EXTERNAL_POTASSIUM_RAISERS` for supplement, amiloride, triamterene, trimethoprim; `reconcileDerivedFields` makes fixtures equal what the form loads; copied notes carry run date, `RULESET_VERSION` and inputs (bump the version whenever output changes); the fuzz sweep fails on any code including self-reversal. New verify invariants go in `scripts/optionInvariants.ts` / `optionScenarioChecks.ts` (`verifyScenarios.ts` is near TypeScript's control-flow size limit).
- **Third pass 2026-11-12 (commit fa34d68; record and 17 OPEN items in `docs/adversarial-review-2026-11-12.md`)**: rule **E20** (no RAAS inhibitor start, increase or switch at a measured eGFR below 20; rules are E01-E20); age over 80 no longer shortens dose ladders; a forced beta-blocker switch satisfies the forced-reduction filter, steps down for a low heart rate and lands on the start dose in low output; the loop resistance switch is one-way from furosemide (`facts.resistance_switch_source`); the low-perfusion NT-proBNP surcharge reads the lower of projected and entered MAP; "start a pillar + raise a dose" candidates are built for every missing pillar; potassium is rounded to one decimal on entry; an empty result always carries `NO OPTION AVAILABLE` or another named reason; `reconcilePlanAlerts` (explain.ts) rewrites plan-describing alerts to match the options; an "ARB" allergy excludes the ARNI and angioedema in allergy text counts as an angioedema history; the sweep follows the top option for 30 visits and fails on any cycle (`OSCILLATION`).
- **Inputs** (`gates.ts` `auditInputs`): NaN, undefined or negative numbers become 0 ("not entered"); blank systolic BP, current weight or dry weight stops the run with a DATA REQUIRED alert naming the field; a duplicate current drug keeps the higher dose and says so. With heart rate not entered a beta-blocker or ivabradine is neither started nor increased.
- **Allergies** (`allergy.ts`, `facts.allergy_aliases`): free text resolves to formulary drugs ignoring case and spacing, by generic, brand or class name; an entry matching nothing raises an ALLERGY NOTE and the form shows what each entry excludes. A new drug must add its brand names to `ALLERGY_ALIASES_BY_DRUG` in `constants.ts`. Pregnancy: a non-selective beta-blocker that cannot be switched is kept, never increased.
- **UI**: Re-run obeys form validation; Copy and Print are disabled while results are stale; the results pane has its own error boundary; the low-output hint uses the engine's two-of-three rule; the potassium hint covers 5.2, 6.0 and 6.5.

## First-principles model rules (2026-11-16)

- **Evidence tables are the single source.** Relative risks, KCCQ changes, harm rates and dose anchors live only in `data/*.json`, each row with source, quote, basis/level and extrapolation note. A missing or duplicate row throws; it never becomes 0 or RR 1.0. Never inline an effect size in engine or component code.
- **No hand-set bonus points.** Special features add 0 (rationale text only, `replaced_by` names the model); the only remaining points are named safety adjustments and the forced-swap +15. A new benefit or harm is a new evidence row, not a bonus.
- **Guideline expectations about which option leads or is shown go in `scripts/guidelineTargets.ts`** (a measured target, never a gate). Safety, eligibility, dose rules and arithmetic stay hard checks. Never weaken a check or move a target to make something pass; `golden:update` only for an intended change, with `npm run ranking:diff` reviewed first.
- **Statistical method is uniform:** precision weighting (`shrinkage.ts`) applies to every outcome and symptom row with no per-row exception; tau2 is computed, never typed. Harm rates are not shrunk.
- **Dose credit:** options are valued as the plan they start (`planCreditsFor`); harm is not discounted.
- **Label basis honestly:** trial, pooled analysis (`meta_analysis`), extrapolated, `siblingProxy`, assumed neutral, not measured, upper bound. Do not present policy or extrapolation as evidence.
- Open owner decisions are listed in README section 10 of the 2026-11-16 record; do not decide them silently.

## Development Rules of Thumb

### If you add or change medications

Follow `docs/HOW_TO_ADD_A_MEDICATION.md`.

Update:

1. `constants.ts` (formulary object)
2. optional pricing logic in `services/pricingService.ts`
3. scenario coverage in `data/scenarios.ts`
4. verification assertions in `scripts/verifyScenarios.ts`

### If you change clinical logic or thresholds

Update:

1. the relevant stage module in `services/engine/` (see `docs/scoring-architecture.md`)
2. `components/FAQ.tsx` (in-app logic documentation)
3. `README.md` and this file (`CLAUDE.md`)
4. verification scenarios/assertions to prevent silent regressions

### If you edit patient data structures

Update:

1. `types.ts`
2. `data/scenarios.ts` defaults and builders
3. relevant form components in `components/patient-form/*`
4. any logic in `simulationService.ts` that reads new fields

## Known Pitfalls

- Preserve `Set` fields when cloning patient objects. There is a SINGLE `clonePatient` implementation — it lives in `services/simulationService.ts` (also deep-copies dose objects) and is re-exported by `data/scenarios.ts`. Do not add a second copy.
- Medication name matching is exact-string sensitive in seeded scenarios.
- `max_new_classes_per_visit` counts class-group additions, not dose changes — and rescue additions (K+ binder, IV iron) DO count toward it. This is intentional and test-ratified ("a patient-facing sequencing limit" — see the 'Max New Classes Counts Binder Rescue' scenario). Do not "fix" rescue meds to bypass the cap.
- Scoring constants and the concordance table (`BNP_SCORE_TARGET`/`BNP_SCORE_CRITICAL`, `NYHA_SCORE_MAP`, `FUNCTIONAL_STEPS_FULL_CREDIT`, `VOLUME_SCORING`, `adherenceComplexityThreshold`, `CONCORDANCE_TABLE`, `pillarKeyOf`) are EXPORTED from `simulationService.ts` and rendered by `ScoreDetailModal` — never re-hardcode display copies of these values in components.
- Clinical predicates shared by the engine AND the formulary (`valueUnknown`, `hasHistoricalHFrEF`, `hasUnknownHistoricalHFrEF`, `isIronDeficient`, `isBlackRace`) live in `services/clinicalPredicates.ts` — do not duplicate them in either consumer (they previously drifted).
- Do not rely on top-3 regimen presence for adjunct assertions; some checks must use exclusion/eligibility logic.
- Keep path alias assumptions consistent: `@/` resolves to repository root.

## Clinical Use Guardrail

This codebase is intended for CDS simulation/prototyping and requires prospective validation, governance, and regulatory/legal review before any real-world clinical deployment.
