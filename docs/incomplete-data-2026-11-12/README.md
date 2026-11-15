# Decisions with incomplete information

> Historical stage report. The [consolidated handoff](../HANDOFF-2026-11-13.md) reconciles subsequent fixes, retired response calculations, latest verification and remaining work. Preserve this report as evidence of its review stage.

Implemented locally on 2026-11-12, rule set `2026-11-12.6`. This follows the [UI adversarial review](../ui-adversarial-2026-11-12/README.md) and [systemic engine review](../adversarial-systemic-2026-11-12/README.md). No commit, push, merge, deployment or clinical activation was performed. The user requested useful, clinically understandable decisions even when some information is missing.

## Result

Missing observations narrow the review rather than making the entire form unusable. The result panel and copied draft explain what can be assessed, what remains unassessed, and what information a deferred decision needs. Invalid entered values and unfinished medication/history entries still require correction. Known urgent BP, potassium and oxygenation findings remain visible in the form even when other entries prevent analysis.

Two scopes are explicit:

- **Medication options:** the core model observations are present; each proposed start, increase or switch must also have its own prerequisites. Eligibility is not a safety clearance or a prescribing order.
- **Focused safety review:** one or more core observations are absent. Known low BP, high potassium, low oxygen saturation, duplicate therapies, supported allergy conflicts, recorded pregnancy conflicts and the nitrate/PDE5 interaction can still be flagged. No exact replacement regimen or dose is generated. This is a bounded set of checks, not comprehensive acute triage or medication reconciliation.

Core observations currently needed for full regimen modeling: adult age, sex used for renal estimation, systolic and diastolic BP, LVEF, NYHA class, rhythm, current weight and estimated dry weight. This is a conservative limitation of the integrated physiology model, not a claim that all clinical decisions require all these observations. Under-18 input is outside the model's scope. Severe low EF with a recorded hypoperfusion marker and unavailable BUN/creatinine perfusion assessment also routes to the focused review.

## Decision dependencies

These rules concern new starts, increases and switches. Missing information alone does not direct stopping or reducing an established drug. Known contraindications or observed deterioration retain their existing rules.

| Missing information | What waits | What can remain available if its other prerequisites are present |
|---|---|---|
| Potassium | RAAS/MRA, loop/thiazide, digoxin and potassium-binder changes | For example, otherwise eligible SGLT2 or beta-blocker review |
| Renal assessment | RAAS/MRA, SGLT2, loop/thiazide and digoxin changes | For example, an otherwise eligible beta-blocker change in a stable case |
| Resting pulse | Beta-blocker, ivabradine and digoxin changes | Other eligible medication classes |
| Pregnancy status for a recorded female patient | Pregnancy-restricted changes and nonselective beta-blocker changes | Other eligible decisions; status stays unknown until explicitly assessed or marked not applicable |
| Hemoglobin | Exact IV iron dose selection | Recognition of recorded iron deficiency and other medication options |
| Height/BMI | BMI-dependent obesity-treatment changes | Other eligible decisions; clearing the source measurement clears the derived BMI |
| KCCQ | KCCQ-specific projection | Functional scoring from recorded NYHA/activity and other medication decisions |
| NT-proBNP | Biomarker-dependent eligibility and neurohormonal score/projection | Other eligible decisions |
| Budget or adequate price data | Affordability assessment, cost-domain scoring and budget filtering | Clinical ranking, explicitly labeled affordability unassessed |
| Race | Race-specific evidence application | Other indications, including an independently established alternative-therapy indication |

`decisionReadiness.ts` owns change prerequisites. E12 checks them for new starts, while `scoreCandidates` checks proposed modifications both before and after rescue additions. E16 retains the established RAAS/MRA laboratory explanation. This prevents a swap or automatic add-on from bypassing a prerequisite.

Class-wide inability is derived from actual clinical exclusions. Missing labs, unknown status and deselected formulary drugs do not establish intolerance, contraindication or exhausted foundational therapy. This closes the pathway that previously offered H/ISDN because renal information was absent, and the pathway that inferred a beta-blocker contraindication from deselection alone. Existing AF rate-control handling when beta-blocker initiation is deferred for recorded acute decompensation is preserved.

## Observations and scores

- Missing KCCQ stays missing in the projected patient. Functional scoring averages only available components; a measured KCCQ of zero remains a measured zero. No KCCQ is inferred from NYHA.
- Unmeasured NT-proBNP and unassessed affordability have `assessed: false`, zero weight and no contribution. Internal numeric placeholders are displayed as **N/A / Not assessed**, never as patient scores. Remaining domain weights are proportionally rescaled.
- The denominator is shared across candidate options in a run. Scores across different amounts of recorded information are not directly comparable. This omission/rescaling policy is an unvalidated model choice, not an outcome estimate.
- No insurance profile is assumed. Failed or pending pricing permits a clinical review using no prices; arriving prices make that earlier result stale and require a new run.
- Unknown pulse does not display as bradycardia. Unknown renal estimates do not display as end-stage disease. Unknown pregnancy is preserved. Low completeness of observations is not presented as treatment completion.

## Evidence and policy distinction

Primary sources checked on 2026-11-12:

1. The [2022 AHA/ACC/HFSA guideline slide set](https://professional.heart.org/-/media/PHD-Files-2/Science-News/2/2022/2022-Heart-Failure-Guideline-Slide-Set.pdf) ties MRA initiation to renal function and potassium, with subsequent monitoring. It supports keeping these prerequisites decision-specific. It does not establish KCCQ as a universal prerequisite for medication review.
2. The [Jardiance prescribing information](https://www.accessdata.fda.gov/drugsatfda_docs/label/2025/204629s063lbl.pdf) calls for renal-function and volume-status assessment before initiation. Holding an SGLT2 change when renal assessment is absent is conservative software policy; no new renal threshold was introduced here.
3. The [carvedilol label](https://www.dailymed.nlm.nih.gov/dailymed/fda/fdaDrugXsl.cfm?setid=95300809-be15-461e-904e-b56aba676975&type=display) describes individualized, monitored titration and minimizing fluid retention before initiation. A beta-blocker option in a synthetic case with missing renal labs is conditional on the other stability and medication rules, not blanket permission to start one without assessment.
4. The [furosemide label](https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=3eed4bbf-7d0e-e852-e063-6394a90a85c2) calls for electrolyte and renal monitoring. Requiring recorded potassium/renal assessment before the modeled diuretic changes is a conservative implementation policy, not a claim that the label specifies this exact software gate.
5. The [digoxin label](https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e61d2108-d871-44c0-b12a-2e61fbb56967), sections 2 and 5, links dosing and toxicity risk to renal function, electrolytes and conduction/rate concerns. The prerequisite matrix is conservative software policy informed by those risks.
6. The [August 2026 Injectafer label](https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/203565s030lbl.pdf), section 2.2, Table 1, selects the heart-failure dose by weight and hemoglobin. The engine now waits for hemoglobin instead of offering an exact dose while asking the clinician to choose between hemoglobin bands later.

The core-input boundary, omission/rescaling of scores, unknown-pregnancy change holds and inference restrictions are explicitly software policies. Existing urgency thresholds are reused, not newly validated by this repair. Existing drug-specific indications, thresholds and unresolved model questions remain in the evidence matrix and prior reviews.

## Regression and ranking review

Sixteen new incomplete-information test groups cover useful options with individual gaps, forbidden dependent changes, measured-zero handling, unassessed scores/costs, continuation of established therapy, derived-value clearing, false intolerance inference and focused safety review. A known urgent potassium finding survives all 512 subsets of nine missing core observations and malformed medication metadata. All 344 fixtures are also exercised with a combined missing KCCQ/BNP/potassium/renal/pulse pattern.

UI checks cover the enabled blank-case review, partial-review findings and draft-note scope, N/A domain display, and known urgent findings despite unrelated input errors. The previous stale/pending/error, option-monitoring, cost and clinical-wording checks remain in place. This is server-rendered content verification, not browser interaction or visual QA.

The old snapshot comparison is preserved in `ranking-before-update.txt`; `ranking-reviewed.json` reconciles two renamed fixtures. Across the 1,032 matched full-formulary runs, **1,026 leading regimens are unchanged**. The six changes are two cases across three price profiles:

- Missing hemoglobin no longer allows the exact IV iron dose; an otherwise eligible alternative becomes the leading option.
- Missing renal information no longer establishes inability to take RAAS therapy for the H/ISDN alternative; a beta-blocker-only option remains reviewable.

Exclusion wording changes are expected: missing hemoglobin, potassium and renal prerequisites now have explicit information-required reasons. An unknown-EF case now reports focused-review scope. The generic `ranking:diff` script exits nonzero whenever exclusions/alerts change because it was designed for scoring-only edits; its nonzero result was reviewed, not ignored as a passing refactor. Golden snapshots are refreshed only after that review. Their capture uses all formulary drugs; scenario-specific deselection is covered separately by the assertion harness and the new targeted regression.

Synthetic iron-dose fixtures now explicitly record Hb 12 g/dL; synthetic nonpregnant/not-applicable cases explicitly record that assessment. Those authored test inputs are not defaults for real cases. The missing-hemoglobin fixture remains explicitly unknown and now asserts withholding. The old deselected-beta-blocker fixture now asserts that deselection alone cannot justify ivabradine. `mistakeAudit.ts` now exits unsuccessfully when it reports findings, so a failing audit cannot silently pass the gate.

Validation results and commands are recorded in `verification.txt`. Passing engineering checks does not establish clinical readiness.

## Remaining limits

- Browser layout, keyboard, clipboard, pricing-arrival/staleness interactions and print behavior need the walkthrough described in the UI report. Browser control was unavailable in the earlier review; this pass does not claim browser verification.
- Core inputs remain a conservative boundary for full integrated regimen generation. More granular recommendations without EF, rhythm or dry-weight estimates would need separate decision modules and clinical validation.
- Medication/allergy/examination lists still cannot distinguish every not-asked, unknown and assessed-negative state. Empty entries are labeled not recorded, not clinically cleared.
- Lab timing, adherence/tolerance verification and complete acute triage are not represented sufficiently to authorize treatment automatically. Recorded prerequisites do not establish currentness or safety by themselves.
- Functional-score omission, domain-weight rescaling and all remaining model/calibration decisions require physician review and representative clinician task testing. No numerical confidence percentage is invented.
- The existing large JavaScript bundle warning remains; browser performance is not measured.
