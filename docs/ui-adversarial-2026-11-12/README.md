# Clinical UI adversarial review — 2026-11-12

> Historical stage report. The [consolidated handoff](../HANDOFF-2026-11-13.md) reconciles subsequent fixes, retired response calculations, latest verification and remaining work. Preserve this report as evidence of its review stage.

The review found reproducible ways for the interface to misstate clinical certainty, present stale options, omit relevant option-specific information, and obscure unfinished input. Those defects are repaired locally. This is a source, workflow and server-rendered-content review; visual and interactive browser verification remains incomplete because browser control was unavailable.

Branch: `refactor/glucosepath-alignment`. Base commit: `9fba74d13915c57d66fc7938128e56627070db3f`. The preceding engine repairs remain in the same working tree. Nothing was committed, pushed, merged or deployed during this review. Engine ruleset remains `2026-11-12.5`: the shared cost lookup preserves the existing engine behavior, verified against all 1,032 golden outputs without rewriting the snapshot.

## Method and evidence

- Followed the intended clinician workflow: start a case, enter clinical observations, reconcile medications and allergies, run the analysis, review safety and alternatives, inspect monitoring, and prepare a draft note.
- Challenged blank, incomplete, invalid, urgent, unchanged, stale, unpriced and example-case states; inspected the formulary, evidence explanations and score dialogs as well as the main screen.
- The first executable UI probes reproduced **10 failing groups**; the scenario rendering group already passed. The repaired suite contains **23 passing groups**, including rendering results for all **344 synthetic scenarios**. These are React server-rendered assertions through the real Vite module loader, not browser interaction tests. See [initial failures](before.txt) and [verification receipt](verification.txt).
- Read the React and verification skills and applied their source-level accessibility, state, cleanup and whole-flow checks. Browser inventory reported no available browser host; a native Chrome attempt timed out. No screenshot, click-through, keyboard, clipboard or print result was observed.

Severity below describes potential misinterpretation or workflow impact in this research tool; it is not a quantified clinical risk estimate. “Repaired” means code/content repaired with the stated verification limits, not clinically validated.

## Findings and systemic repairs

| Priority | Failure mode | Repair and verification |
|---|---|---|
| High | A “no change” result said no change was needed, including in copied text, despite unresolved gaps or warnings. | One shared no-change statement says no change is proposed in that option and requires review of gaps, warnings and monitoring. Screen and draft-note assertions pass. |
| High | Changing inputs left old medication cards in the document; the stale banner could disappear in print. | Input/case fingerprinting determines staleness synchronously. Stale or failed output returns before rendering any old options or note controls. A stale notice remains printable. The regression checks confirm old option markup is absent. Actual print layout remains unverified. |
| High | A first-run error could be hidden by the first-run orientation, while later errors could coexist with old options. | Errors have an explicit result state before orientation/results. All run entry points use the same validation function. Error-state content checks pass. |
| High | Starting the app with sample values and preselected clinical choices could encourage carrying assumptions into a real case. | Startup is blank. Blank-case construction is independent of sample fixtures; sex, race, rhythm, NYHA, insurance and budget require explicit choices. Pregnancy requires confirmation when the field applies. Example origin is visible on screen and in the draft. Model preference defaults remain explicit. Blank/zero/provenance tests pass. |
| High | An allergy, medication, intolerance or other exposure could be typed or selected without pressing Add, then omitted from the run. | Pending drafts report to the form and application, block all run paths and suppress old options until saved or cleared. Medication edits have Save and Cancel. Source path inspected; browser event sequencing remains to be exercised. |
| High | Weight near the estimated dry weight was labeled euvolemic, and unchecked examination findings appeared to establish absence of congestion. | One observation-based description is shared by the form and status summary. It names weight relative to an estimate and findings recorded, with clinical assessment still required. Scoring dialogs also describe weight difference rather than “fluid excess.” Regression assertions pass. |
| High | Drug cards gave blanket escalation instructions and promised maximal benefit at a target dose. | Removed generic escalation directions and maximal-benefit claims. Dose references remain available in a disclosure with source/formulation detail, with cautions and monitoring retained. Content assertions pass. |
| High | Global monitoring belonged to option 1, but alternatives did not show their own plans. | Every card renders that option's monitoring; the top summary and follow-up explicitly identify option 1. An alternative-specific monitoring probe passes. |
| Medium | Alternative options required deciphering numeric score differences to see the actual medication tradeoff. | Visible drug/dose comparisons state additions, omissions and dose differences against option 1 independently of score. Model details are secondary. Regression assertion passes. |
| Medium | Current-regimen prices could disagree with option prices because dose-specific cash pricing was applied only by the engine. Missing prices could become `$Infinity`. | Engine and status summary share `monthlyMedicationCost`. Cost formatting is shared across cards, score dialogs and tie explanations; unknown affordability stays unknown. Cash-dose and unknown-price tests pass; golden outputs remain identical. |
| Medium | Copied notes conflated valid zero scores/preferences with missing data, treated unrecorded pregnancy as no, and represented empty lists as confirmed absence. | Header formatting preserves valid zeros, distinguishes unrecorded facts, uses “none recorded,” includes case origin and expands dose frequency. Screen and draft-note tests pass. |
| Medium | A copy failure offered no usable fallback; the clinician could not inspect the exact text first. | A preview and read-only manual-copy fallback use the identical memoized draft text. Controls explicitly name option 1. Stale/error output cannot offer a note. Clipboard success/denial paths still need browser testing. |
| Medium | Input errors overwrote explanatory associations, and required status was mainly visual. NYHA choices reduced activity limitations to vague severity labels. | Common controls preserve help/error IDs and expose required status. The form lists linked errors and adds section navigation. NYHA choices describe activity limitations; KCCQ guidance names the measured instrument and its direction. Accessibility/content assertions pass; assistive-technology behavior remains unverified. |
| Medium | Current medication dose correction required deleting and recreating the entry. Frequencies were abbreviated. | Added labeled Edit, Save and Cancel controls, dose-frequency compatibility validation and full frequency wording. Pending edits block analysis. SSR verifies names/content; interactive editing needs browser verification. |
| Medium | Pricing failure looked like indefinite loading. | Separate failure message, retry control and disabled run state. The run handler also rejects unavailable prices. Content test passes; network/retry interaction remains unverified. |
| Medium | Library model coefficients looked like individual expected effects or comparative efficacy. Unlisted adverse effects were called “generally well tolerated.” | Model parameters are collapsed and explicitly unvalidated, unsupported “Top Tier” badges removed, absent modeled adverse effects no longer imply safety, formulations shown, and GLP-1 weight parameters retain their percentage unit. Content assertions pass. |
| Medium | Domain dialogs could exceed short viewports; hidden controls could enter the focus trap. Model BNP thresholds looked like clinical targets. | All dialogs have a bounded scrolling body, visible-controls-only focus trapping, scroll-lock cleanup and explicit model-reference wording. All nine dialog variants render in the suite. Actual short-screen, keyboard and focus-return behavior remains unverified. |
| Medium | Evidence/help text claimed cost could not trade against benefit and described outdated evidence normalization. | FAQ now states the real cost weighting/filtering and fallback ordering, disclaims clinical equivalence of equal scores, and describes the fixed evidence denominator. Ranking help now matches the engine's reduced-EF path. Text checks pass. |

## Regression prevention

- `components/clinicalPresentation.ts`: shared frequency, cost, observation and no-change language, plus actual-regimen comparison.
- `services/medicationCost.ts`: one dose-aware price lookup for the engine and current-regimen display.
- `components/patient-form/formValidation.ts`: one required-field/choice contract for form labels, form errors and every run entry point.
- `components/patient-form/patientDraft.ts`: explicit new-case construction without inheriting clinical data from a sample patient.
- `scripts/verifyClinicalUi.tsx` and `scripts/runClinicalUi.mjs`: durable content checks using the real components and engine. `npm run verify:ui` is now included in `gate`, `ci` and the GitHub Actions workflow. Remote CI has not been run for these unpushed changes.

## Verification

The [receipt](verification.txt) records the final local commands and results:

- TypeScript: pass.
- UI content: **23 passed, 0 failed**; all 344 scenario result states render; nine score-dialog variants render.
- Engine scenario/invariant verification: **399 passed, 0 failed**.
- Golden comparison: **1,032 byte-identical runs** against the existing ruleset .5 snapshot.
- Broad audit: **100/100**; treatment-mistake audit: **51/51**; red-team audit: **0 critical/high/medium findings**; pricing audit: **32 drugs × 3 profiles**.
- Randomized sweep: **5,000 synthetic patients**, seed **20261112**, no violations. This repeats an existing gate seed; it is not additional independent coverage over the preceding review's seeds.
- Production build: pass. Existing large-bundle warning remains (about 869 kB minified JavaScript); no runtime-performance measurement was possible.
- Whitespace/conflict-marker check: pass.

Passing these checks does not establish clinical readiness, accessibility compliance or real-world usability.

## Clinical wording references

Checked 2026-11-12. The NYHA choices use activity limitations and rest symptoms, consistent with the [American Heart Association classification table](https://www.heart.org/en/health-topics/heart-failure/what-is-heart-failure/classes-of-heart-failure). KCCQ is identified as a measured 0–100 instrument, where higher scores reflect better health status, consistent with the [instrument developer's description](https://www.cvoutcomes.org/kccq-plan-select-page/). No new drug threshold or effect calibration was introduced by this UI review. Existing guideline-dependent engine decisions and unresolved clinical/model questions remain in the [systemic review](../adversarial-systemic-2026-11-12/README.md).

## Still open

1. **Browser walkthrough and render QA.** At desktop and narrow widths, 200% zoom and a short viewport: complete a blank case; select an example; edit a dose/frequency; leave an allergy draft pending; correct invalid blood pressure; run an unknown-lab case and an urgent no-option case; change a completed case; inspect each option's monitoring; deny clipboard access and manually copy; retry failed pricing; open/close every dialog with keyboard only; print fresh and stale analyses. Confirm no clipping, unexpected scrolling, trapped or lost focus, stale recommendations, duplicate content or lost warning text. None of these interactions is claimed as passed by SSR.
2. **Missing-data workflow — superseded by the subsequent repair.** See [incomplete-information review](../incomplete-data-2026-11-12/README.md): focused reviews, decision-specific prerequisites, optional KCCQ, unassessed-domain handling and regressions are implemented locally. Clinical validation of these policies and browser testing remain open.
3. **Recorded versus assessed.** Empty history/examination collections are now described honestly, but the data model still does not distinguish every “not asked,” “assessed absent” and “unknown” state. A complete reconciliation/assessment model is still a clinical workflow design task.
4. **Draft scope.** The note preview/copy action is explicitly for option 1. Selecting another option as the final treatment plan and producing a corresponding reviewed note is not implemented.
5. **Clinical validation and remaining engine decisions.** Representative clinician task testing, evidence review of outstanding policies and validation of modeled effects remain necessary. See the preceding review's open-item map; this UI pass does not close those items.

The durable next step is the browser walkthrough above, followed by clinician testing of whether the first screen answers: what needs attention, what would change, why this option, what differs in the alternatives, and what must be monitored.
