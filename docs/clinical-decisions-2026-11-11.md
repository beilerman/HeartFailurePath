# CHF PATH clinical decisions and next implementation plan

Recorded November 11, 2026. Source inspected: local branch `refactor/glucosepath-alignment`, commit `376b516` (November 10). This is a documentation-only handoff. No engine, interface, thresholds, tests, deployment or clinical-release status changed.

## Conversation evidence

Assistant:

> For CHF PATH, I’d start with **three clinical decisions**:
>
> 1. **Scope:** Is this strictly for stable outpatient optimization? If so, should suspected acute decompensation, serious hyperkalemia, hypoperfusion, pregnancy, or advanced HF stop ranking and trigger assessment instead?
> 2. **Missing labs and MRA sequencing:** Should a current potassium and renal function be required before intensifying RAAS therapy or an MRA? For elevated potassium, the code already says binder first and MRA only after a repeat potassium ≤5.0, but it still scores them together. Should that sequence be enforced as separate steps?
> 3. **Ranking:** Should eligible foundational HFrEF therapies take priority over convenience and cost, with documented exceptions? The current weighted model can sometimes favor a simpler regimen over completing foundational therapy.

Brad, verbatim (line breaks preserved):

> 1. Not just for stable but outpatient only. 2. If clinically appropriate, yes 3. Make this a toggle, on the whole it should be considered a balance, understanding that if a patient cannot afford or execute
> A
> Regimen — it will not be implemented.

## Decisions established by that answer

1. **Outpatient-only scope, not stable-only scope.** Worsening HF is not excluded solely because it is not stable. This does not approve management of every acute presentation in an outpatient setting, specify an emergency threshold, or settle pregnancy/advanced-HF boundaries. The current triage gates remain unchanged until a separately reviewed policy is implemented.
2. **Clinically appropriate laboratory prerequisites are supported.** The answer is conditional, not a blanket rule for every medication change. No laboratory freshness interval, change-from-baseline threshold, exception criteria or new numerical cutoff was supplied. The question combined lab prerequisites with MRA sequencing; the answer does not unambiguously select an enforced, machine-staged binder/MRA workflow. Obtain that clarification separately.
3. **Provide a ranking toggle.** The intended choice is balanced trade-offs versus prioritizing eligible foundational HFrEF therapy. Brad emphasizes that affordability and ability to carry out a regimen determine whether it can be implemented. A regimen the patient cannot afford or execute must not be represented as an implementable choice merely because its modeled clinical score is higher.

## Proposed toggle design, not yet implemented

### Default and meaning

- Proposed default: **Balanced**. This follows Brad's statement that, on the whole, treatment should be a balance, but the precise UI label and persistence behavior have not been approved.
- Alternate mode: **Prioritize foundational therapy**. Within clinically eligible and feasible choices, give indicated foundational HFrEF treatment priority, then use the balanced comparison to distinguish remaining options. The exact ordering of pillar coverage, tolerated dose, titration and adjuncts still needs a clinical specification; no new score coefficients are chosen here.
- The toggle changes ranking, not indication, contraindications, drug interactions, dose ceilings, triage gates, required laboratory prerequisites or clinical-release status. Neither mode may manufacture an indication or assume an unknown fact is safe.
- Record the selected mode with the decision and explain why it changes the lead option. Missing mode should initially resolve to Balanced for compatibility. Do not make a lasting global preference change without a separate design decision.

### Affordability and executability in both modes

- Separate **cannot do** from **would prefer not to do**. A confirmed inability to obtain, administer or follow a regimen is a feasibility constraint; cost sensitivity and preference for fewer doses remain trade-offs among feasible options.
- The existing `max_affordable_cost` filter and `complexity_tolerance` score are not a complete feasibility assessment. The latter is a preference slider, not verified capability. Define the minimum capability/access questions without inventing a universal pill-count or administration-frequency limit.
- Distinguish a usable plan now from a conditional option requiring cost assistance, medication access, caregiver support, teaching or another prerequisite. If nothing is feasible, return the barriers and necessary next steps rather than an infeasible regimen labeled as the answer.
- The current over-budget fallback displays costly options with a warning. Review its presentation under this distinction; no fallback behavior was changed in this handoff.
- Preserve clinically important gaps and a path to reassessment. A constrained interim plan must not be described as complete foundational therapy or proven equivalent to an inaccessible alternative.

### Relationship to the existing controls

The current `care_priority` select has Balanced, Maximize outcomes, Keep cost low and Keep the regimen simple. These only select weight rows; they are not a foundational-priority mode. Avoid two competing controls whose effect is unclear. Recommended implementation discussion: retain patient priorities within Balanced and introduce the explicit ranking mode separately, or consolidate the controls into one clear design after reviewing representative cases. Do not silently treat `outcomes_first` as equivalent to the new request.

## Clarifications still needed

1. **Outpatient escalation:** which findings should produce assessment/escalation only, and which worsening-HF cases may receive outpatient ranked changes? Address serious hyperkalemia, suspected hypoperfusion, hypoxemia/pulmonary edema, pregnancy and advanced HF without assuming Brad selected any new numerical boundary.
2. **Laboratory prerequisites:** which specific initiation, titration and continuation actions need K/renal results; what makes a result current; which trends matter; and what exceptions, if any, require documented clinician review?
3. **Binder/MRA sequencing:** should the MRA remain a conditional future option until an actual repeat potassium satisfies the drug/indication-specific criterion, with the immediate plan restricted to the preceding step? Current code already includes binder-first/repeat-K wording, but scores the combined resulting regimen. This question was not independently answered.
4. **Foundational-priority semantics:** how should feasible pillar coverage, dose intensity and adjuncts be ordered, and how should the mode apply to HFmrEF, HFpEF and HFimpEF? Do not generalize an HFrEF toggle to other phenotypes without an explicit clinical rule.

## Implementation sequence for an authorized coding pass

1. Define the ranking-mode contract and feasibility states, including unknown versus confirmed barriers and conditional future options. Agree the small set of clinical ambiguities above before encoding thresholds or staged treatment.
2. Add the mode to the patient/decision contract and one unambiguous UI control; show the active mode and rationale in results and exports. Keep Balanced as the proposed compatibility default.
3. Apply the same indication/safety/prerequisite and feasibility rules before either ranking strategy. Add the foundational-priority comparator only against an agreed clinical ordering. Preserve existing work and avoid unrelated refactoring.
4. Review current scenario outputs with Brad, including low budgets, practical administration barriers, new HFrEF, preserved/improved EF, worsening outpatient HF, borderline or missing labs, and cases where simplification loses a foundational class.
5. Verify identical eligibility, contraindications, hard stops and dose safety under both modes; deterministic ordering; no unaffordable or unexecutable option promoted as implementable; explicit unresolved barriers; legacy-mode compatibility; accurate score/explanation math; and exports preserving the chosen mode. Test budget preference separately from confirmed inability.
6. Run the repository's type, scenario, golden and audit checks after code changes. Any intended ranking changes need reviewed case-level differences and a separately justified golden update. Software passes do not establish clinical validation. Do not deploy or activate clinically without separate authorization.

## Source locations and related open work

- `services/engine/scoreModel.ts`: four existing weight profiles and Balanced fallback.
- `services/engine/selection.ts`: affordability filter, over-budget fallback, display safety floors and ranking comparator.
- `components/patient-form/SocialSection.tsx`: current preference, budget and complexity controls.
- `types.ts`: current patient contract, which has no lab collection dates or explicit feasibility states.
- `services/engine/gates.ts`, `eligibility.ts`, `scoring.ts`, `effects.ts`: current safety, missing-data and binder/MRA behavior.
- `docs/medication-review-2026-11-10/README.md`: unresolved evidence, dose-handling and clinical-review items. These decisions do not resolve the ramipril arriving-dose issue, unvalidated physiologic effect estimates or independent clinical validation.

Already ratified separately: the default two-new-class visit cap includes binder and IV-iron rescue additions. This answer does not change that policy.

## Implemented 2026-11-11

Added the same day, after the plan above. The sections above are unchanged; they record the owner's words. Commits on `refactor/glucosepath-alignment`, local only, not pushed or deployed. `npm run gate` and `npm run build` pass; the golden snapshot was regenerated only for the intended output changes, each in its own commit (see `docs/medication-review-2026-11-10/changes-*.txt`). Software passes do not establish clinical validation, and the clinical-release status is unchanged.

### Decision 1: outpatient scope

- Built: a one-sentence scope statement in the app footer and the Evidence tab. It says the tool is for outpatient heart-failure medication decisions, does not manage emergencies or inpatient care, and that the most urgent findings (systolic BP below 90, potassium 6.5 or higher, implausible values) produce alerts instead of a ranking while other urgent findings are flagged above the options. The wording follows what `gates.ts` does; the shorter wording first proposed ("urgent findings produce alerts instead of a ranking") would have overstated it, because potassium 6.0-6.4, a low-output state and pregnancy raise an alert and still list options.
- No gate, threshold or exclusion changed. Stable-only scope was not adopted.
- Still open: which worsening-HF findings should stop ranking and which may receive outpatient changes (outpatient escalation boundaries are unchanged); pregnancy and advanced-HF boundaries.

### Decision 2: laboratory prerequisite

- Built: rule E16 "Potassium and renal function required". With potassium or renal function blank (the existing not-entered value), new starts of ACE inhibitors, ARBs, ARNI and MRAs are withheld (eligibility), and dose increases and switches to those classes are dropped before scoring. One `LABS REQUIRED: ...` clinical alert is raised per run. A drug the patient already takes is not affected by the start rule. The old -12 `UNKNOWN_POTASSIUM` score deduction was removed because the case it covered can no longer reach scoring; `UNKNOWN_RENAL` remains for SGLT2 inhibitors only.
- No freshness window, trend threshold or new numeric cutoff was added.
- Still open: binder-then-MRA staged sequencing (a binder and an MRA are still offered together in one option when the projection allows); no lab-freshness window, because the form has no lab dates; the exact label wording behind E16 was not re-verified in this pass.

### Decision 3: ranking toggle

- Built: `Patient.ranking_mode` (`balanced` default, `foundational_first`), a "Ranking approach" control in the form, and results that state the active mode, the reason when it is not applied, what Balanced would have led with, and each option's foundational coverage. The copy-to-chart text includes the mode when it is not Balanced.
- Foundational mode applies to HFrEF and HFimpEF only. Order: regimens that do not cause a severe projected fall in blood pressure or heart rate or rise in potassium first; then higher foundational coverage (RAAS inhibitor, beta-blocker, MRA, SGLT2 inhibitor; 1.0 at target, 0.6 below); then the Balanced order. Scores, exclusions, alerts, the budget filter and the display floors are identical in both modes.
- A regimen shown only because nothing fits the budget is labeled "BUDGET EXCEEDED ... shown for discussion, not as a plan the patient can carry out" in the engine, and the interface marks it as not affordable at the stated budget, with chart text headed "REGIMEN FOR DISCUSSION ONLY".
- Also implemented the same day (the earlier ramipril known gap): an arriving dose above a renal dose cap is force-reduced one step; ramipril's cap is judged on the total daily dose.
- Still open: no explicit "cannot do" feasibility states beyond the budget limit (complexity tolerance is still a preference, not verified capability); foundational mode is not defined for HFmrEF or HFpEF; under the 1.0 / 0.6 credit rule a fully dosed single pillar outranks a different pillar at its starting dose.
