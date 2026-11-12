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

## Decisions made from sources 2026-11-11

Added after the sections above, which are unchanged. The owner delegated the open clinical decisions with the instruction that they be guideline- or evidence-based. They were made from `docs/medication-review-2026-11-10/verified-clinical-decisions-2026-11-11.md` (labels, trial registrations, secondary reproductions of guideline text) and `docs/medication-review-2026-11-10/esc-2026-reading-notes.md` (the 2026 ESC heart failure guideline, read directly; its Supplementary Data practical tables were not read). The primary 2022 AHA/ACC/HFSA and 2021 ESC guideline pages could not be opened; the US guideline numbers below come from a secondary reproduction. Nothing here is invented: each row names its source type. Commits on `refactor/glucosepath-alignment`, local only, not pushed.

1. **No new MRA start above potassium 5.0, staged, not co-started with a binder (rule E15).** Source: ESC 2026 "caution" at 5.0 or above (primary); 2022 US start criterion below 5.0 (secondary); Aldactone and Kerendia labels 5.0 (labels); DIAMOND co-initiation was a trial run-in, not a recommendation. Binders are Class 2b in the 2022 US guideline (secondary) and ESC 2026 makes no recommendation. One rule for all MRAs (eplerenone's label K+ above 5.5 start contraindication does not govern). The DIAMOND proactive-binder path was removed; the reactive binder rescue (projected K+ above 5.3) remains and still covers, for example, a RAAS step-up at borderline potassium. The MRA gap shows the reason and the monitoring plan says "repeat potassium; start MRA if 5.0 or lower". Before: a binder co-start at 5.0-5.5 (binder available) or withheld (none). Now: withheld above 5.0. Top picks that changed: none in unchanged scenarios (see `changes-mra-staged-start.txt`).
2. **Starting doses vs labels.** Reviewed spironolactone (25 mg above eGFR 50, else the 12.5 mg tier), eplerenone (25 mg) and finerenone (20/10 mg by eGFR 60, not below 25, HF indication LVEF 40 or above) against the labels: no mismatch, no change.
3. **MRA already in use.** Halve above 5.5 (one dose step), withhold at 6.0 or above: matches the secondary reproduction of ESC guidance; a current MRA is removed, not reduced, at 6.0 or above. No change; enforced by new scenarios.
4. **Potassium 6.0-6.4.** The alert tells the clinician to get an ECG and repeat the potassium urgently and states that a secondary source classes K+ above 6.0 as severe; the 6.0 alert and the 6.5 alerts-only stop are labeled engine policy (KDIGO scheme not verifiable). No RAAS/MRA start or increase (RAAS is already contraindicated above 5.4, MRA above 5.5). Scenarios at 6.0, 6.2, 6.4 added.
5. **Torsemide equivalence.** Furosemide 40 mg = torsemide 20 mg from the TRANSFORM-HF protocol (trial protocol; the registry text says 2-4 mg). Swaps land at the equivalent daily dose; the unconverted-swap fallback is gone. Side effects: equivalent swaps now lead in 9 loop scenarios and the tier rule can overshoot on sparse tiers (see the review README, Still open).
6. **Pregnancy beta-blockers.** Replaced the earlier secondary-source plan (metoprolol only) with the 2026 ESC rule (primary, Class I C): switch non-selective beta-blockers to beta-1-selective ones. New starts are beta-1-selective only (metoprolol succinate, bisoprolol); carvedilol already on board is switched with the reason shown. The rest of the pregnancy handling matches the sources (ACEi/ARB/ARNI, MRA, SGLT2i, ivabradine Class III C; vericiguat per the secondary review; hydralazine plus nitrate and loop diuretics available); the old "Category X/C" alert wording, unsupported by these sources, was removed.
7. **Lab recency.** No source gives a window, so none is enforced. Monitoring timings now match the sources (MRA: within 1 week and about 4 weeks; RAAS: 1-2 weeks). The form and the LABS REQUIRED alert say entered labs should reflect current medications and clinical state.
8. **Reviewed, unchanged.** Beta-blocker heart-rate 55 for metoprolol succinate and bisoprolol (engine policy; labels give no number), low-output handling (hospitalization criteria not verifiable), spironolactone BP effect ("no effect" claim refuted), spironolactone potassium rise and digoxin LVEF credit (magnitudes not verified).

Not done at the time of the section above: the 2026 ESC guideline's larger changes were done later the same day, see the next section.

## Aligned with the 2026 ESC guideline 2026-11-11

The owner delegated the clinical decisions with the instruction that they be guideline- and evidence-based and that the tool follow the 2026 ESC heart failure guideline (read directly: main text, Tables 5, 11, 27, and Supplementary practical tables S3-S9; NOT read: Table S26, decompensated-HF tables, device, advanced-HF, arrhythmia, valve and amyloidosis sections). US labels still govern contraindications and dose limits; where ESC and the US label or 2022 US guideline differ, the stricter safety rule is used and the difference is recorded in `docs/evidence-matrix.md` (rows HF-ESC-001 to HF-ESC-011). Ranking effects: `docs/medication-review-2026-11-10/changes-esc2026-*.txt`.

1. **Phenotype:** HFmrEF removed. LVEF below 50 (or improved EF, or a prior LVEF below 50) is reduced EF with four Class I pillars; HFpEF (LVEF 50 or higher, never below 50) has SGLT2i + MRA as Class I, a RAAS inhibitor as Class IIb. LVEF 41-49 is treated as reduced EF per the 2026 ESC guideline; the 2022 AHA/ACC/HFSA guideline keeps a separate mildly reduced category with weaker recommendations; no large trial tested beta-blockers or RAAS inhibitors only in this range. Drug LVEF criteria keep their own thresholds.
2. **Digoxin** NYHA II-IV, LVEF 40 or below on optimized therapy (IIa B1), level target below 1.2 ng/mL. **Potassium binders** earn no evidence bonus (no ESC recommendation; REALIZE-K note).
3. **RAAS inhibitor in use and potassium:** one step down from 5.5, stop from 6.0, MRA first, first-steps alert; eGFR below 20 raises an alert only, never a stop (see bullet 6). **Creatinine:** rise under 50% acceptable with eGFR above 15.
4. **Table 11:** spironolactone target 50 mg; ARNI start 24/26 below eGFR 60 or with chronic hypotension. **Loops:** titrate, do not swap (forced and diuretic-resistance swaps allowed); nearest-tier equivalent dose. **Thiazides:** short-term, review prompt. **Pregnancy beta-blocker switch:** same fraction of target (engine policy). **Beta-blocker heart rate:** 50 for metoprolol succinate and bisoprolol, 55 carvedilol. **Alerts/notes:** NT-proBNP above 5000, NSAIDs/COX-2/TZD/saxagliptin, IV iron TSAT, restart text, up-titration and monitoring intervals.
5. **Unchanged:** MRA start rule (staged above 5.0), hard stops, vericiguat's recent-worsening requirement (VICTOR neutral in stable patients supports it).
6. **eGFR below 20 on a RAAS inhibitor is an alert, not a stop (correction, same day).** ESC Supplementary Table S4 says to stop when eGFR falls below 20 or creatinine rises more than 100%, a change from baseline; the guideline also says stopping is very rarely necessary and that withdrawal risks deterioration (6.1.6 allows temporary discontinuation in AKI with eGFR below 15). The tool has no baseline, so it could not tell a new fall from stable CKD 4 and was stopping sacubitril/valsartan in long-established patients. The forced stop is removed; the alert states both readings. The MRA "withhold below 20" (S7) was text only and never a gate.
7. **New RAAS start above potassium 5.2 is staged (rule E18) and a binder never enables a new potassium-raising class (correction, same day).** ESC S4/S5: potassium above 5.2 is a caution threshold for starting an ACEi/ARB/ARNI and the guideline makes no binder recommendation; the 2022 US guideline gives binders Class 2b for hyperkalaemia that develops while on a RAAS inhibitor. Parallel to the MRA rule E15. The reactive binder rescue now applies only to existing therapy; a candidate that would need a binder to add a new RAAS or MRA class is dropped. Known limit: at K+ 5.2 a new ARNI/ACEi projects above 5.3 and is dropped, so a new RAAS start is realistically offered up to about K+ 5.1.

## Second pass from the primary US text and the ESC device / advanced HF / AF tables 2026-11-11

The owner delegated the clinical decisions. The 2022 AHA/ACC/HFSA text points (7.1.1 Table 12, 7.3.2, 7.3.3, 7.3.6, 7.6.1, 9.1) and the 2026 ESC Recommendation Tables 6, 7, 11, 15 and Tables 14-15 were read directly (`docs/medication-review-2026-11-10/esc-2026-reading-notes.md`). The US class-of-recommendation labels were images, so classes quoted for the US guideline still come from secondary sources. Where two sources differ the stricter is kept (`docs/evidence-matrix.md`). Per-change effects: `changes-final-*.txt`.

1. **MRA initiation (rule E15 and new check).** Potassium 5.0 or higher, and eGFR 30 or lower, are contraindications to MRA initiation (2022 US 7.3.3). E15 now withholds a new MRA at K+ 5.0 or higher (was above 5.0; the Aldactone and Kerendia labels allow exactly 5.0, the guideline is stricter and used); a new spironolactone start at eGFR 30 or lower is contraindicated (eplerenone already was); a patient already on spironolactone at exactly 30 is not removed. Dosing at eGFR 31-49 is halved: spironolactone and eplerenone are capped at 25 mg below eGFR 50 (was 45 or lower; the Aldactone start boundary of 50 is stricter for a start and kept). Monitoring: within 1 week, about 4 weeks, after the final titration, then every 4-6 months (US every 6 months; the shorter interval used). Effect on the 918 earlier golden runs: no top pick changed.
2. **Baseline creatinine (new optional input).** With it, the ESC change-based kidney rules are enforced (HF-ESC-013): halve the RAAS inhibitor and the MRA at a creatinine rise of 50% or more or a derived eGFR fall over 30% (stricter of main text and supplement), stop and seek specialist advice above 100% or at 50% with eGFR below 20; reassurance below that. Blank baseline: unchanged behaviour (golden byte-identical).
3. **Device, advanced HF and AF alerts (HF-ESC-014).** Alerts only. Inputs the form lacks (QRS, LBBB, aetiology, infarction date, hospitalization count, anticoagulant) are asked of the clinician, not assumed. The INTERMACS wording was dropped (not in the sources read).
4. **Loop maxima.** 2022 US Table 12 (bumetanide 10, furosemide 600, torsemide 200 mg/day) matches the declared maxima; no change (evidence row HF-DIU-002 cites it).
5. **Primary text now read** for: MRA initiation criteria and monitoring, binder outcome uncertainty, HFmrEF statement, loop maxima, beta-blocker agents (no class effect; no heart-rate number there).
- **Up-titration step cap (final pass).** One visit may at most double the total daily dose of any titrated drug; the adjacent tier is always kept (`UP_TITRATION_MAX_DAILY_FACTOR` = 2 in `thresholds.ts`). ESC 2026 supplement S4-S6/S8 source the doubling for RAAS inhibitors, beta-blockers and MRAs; for loop diuretics (S7: "increase dose", no step) and other classes it is engine policy. Reproduced case: furosemide 40 mg with a $1 budget led with 40 to 160 mg bid; it now leads with 40 to 80 mg. Effect: `changes-final-dose-step-cap.txt`.
- **Graded dose credit (final pass, anchored at the starting dose).** A therapy below target earns 0.6 at or below its labeled starting tier, rising linearly to 1.0 at target (0.6 + 0.4 x progress from start to target) in completeness and foundational coverage, so a titration step is credited but a new start scores exactly as before and the credit never chooses between agents (evidence row HF-SCORE-002; the linear shape is engine policy). The first version (0.5 + 0.5 x dose/target) favored eplerenone and finerenone over spironolactone at their starting doses and was replaced. Same-drug-set picks are distinct when each is solely an up-titration of different drugs. Effect against the pre-graded-credit golden: 8 of 999 top picks differ (`changes-final-anchored-credit.txt`).
- **Congestion coverage (final pass).** A congested patient (more than 1 kg above dry weight) always sees at least one option that raises or starts a loop diuretic when the engine has one: the best-ranked such candidate replaces the last option (never option 1) and says why (HF-DIU-CONG-001; ESC 2026 loop dosed to volume status, Class I A). Selection only, no score change. Effect: `changes-final-congestion-coverage.txt`.
- **Binder rescue only beside current RAAS/MRA therapy (final pass).** A potassium binder is added to a candidate only when it keeps, raises or switches within the class a RAAS inhibitor or MRA the patient already takes and projected potassium exceeds 5.3 (HF-BIND-004). A new carvedilol start at K+ 5.3 no longer gets patiromer. Consequence: a patient with high potassium and no RAAS/MRA on board (or whose RAAS/MRA the candidate removes) is no longer shown a binder; those regimens are scored on their own projected potassium, and some scores fall (K+ 6.4 on a removed quad: 56 to 25). 31 top picks changed (`changes-final-binder-rescue.txt`). The +0.05 K+ modeled for carvedilol has no cited source.
