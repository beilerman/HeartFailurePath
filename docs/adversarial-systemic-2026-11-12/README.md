# Systemic adversarial review and repairs — 2026-11-12

> Historical stage report. The [consolidated handoff](../HANDOFF-2026-11-13.md) reconciles subsequent fixes, retired response calculations, latest verification and remaining work. Preserve this report as evidence of its review stage.

Rule-set version: **2026-11-12.5**. Local, uncommitted work on `refactor/glucosepath-alignment`; no push, merge or deployment. Base commit remains `9fba74d13915c57d66fc7938128e56627070db3f`. This review follows the first repair batch in `../repair-2026-11-12/README.md` and preserves that work.

The review found defects beyond the handoff list: caller-supplied medication metadata could bypass canonical contraindications; malformed inputs reached scoring; an unsafe affordable option could suppress a safe over-budget option; and no-change simulations altered measured physiology and examination findings. Repairs address these shared mechanisms. Passing engineering checks does not establish clinical validity or release readiness.

## Scope and method

Read the public input boundary, input audit, eligibility/contraindication predicates, dose enumeration and caps, forced changes, effect projection, scoring/ledger, display selection, warnings, pricing and regression harnesses. Compared all 17 third-pass findings with current implementation. Exercised the public engine with malformed data and altered medication metadata, and the selection stage with deliberately conflicting safety/cost candidates. Added no-change invariants across all 344 fixtures and acceptance checks across every declared formulary strength/frequency and every supported rhythm.

`before.txt` records the first nine regression groups before repairs: eight failed. The original per-dose-cap check passed because it covered enumeration rather than the faulty nearest-step helper; the test was subsequently strengthened to exercise both. `after.txt` contains the final 18 groups. Additional checks cover the previously unprotected pregnancy switch, interaction warnings, negative-creatinine calculation, neutral-drug scoring and invalid price handling. The regression suite is invoked by `npm run verify`.

This is a source review and synthetic engineering validation, not an independent clinical study, an exhaustive drug-label re-review, or a verified browser assessment. No additional reviewers/agents were used.

## Findings and systemic fixes

Severity describes potential software consequences, not a measured clinical harm rate.

| Finding | Severity | Reproduction and correction |
|---|---|---|
| Drug identity trusted caller metadata | High | A supplied spironolactone object relabeled as SGLT2i with disabled contraindication functions could persist at K 6.0. The public facade now resolves recognized name, strength, unit and frequency to the canonical formulary before any clinical evaluation. Supplied functions/classes/dose metadata are ignored. Caller objects remain unchanged. |
| Invalid controls and malformed medication entries reached scoring | High | NaN KCCQ/preferences, unsupported frequencies, impossible strengths, missing medication objects, numeric strings and malformed history could produce recommendations, non-finite scores or exceptions. `inputContract.ts` rejects these with named INPUT ERROR alerts before cloning. Existing blank clinical-lab sentinel handling remains in the audit stage. |
| Schema drift rejected supported rhythms | High regression prevented | The first validator draft omitted AV-block rhythms. Fixture verification and the random sweep exposed it. A shared `PATIENT_RHYTHMS` list now defines the type, form choices and validator; all five choices are exercised. |
| No-change was not a physiological identity | High | A dry/cold examination was erased; a depleted patient's weight rose to a model floor; low MAP increased BNP 20% without a treatment change. Removed unsourced BNP multipliers, made model floors preserve existing observations, and kept examination findings pending actual reassessment. Unknown BNP remains unknown. |
| Weight-only euvolemia produced contradictory alerts | High | Exam-confirmed JVP/crackles at dry weight still generated euvolemia/loop over-treatment language. Euvolemia now also requires absence of congestion findings. |
| Affordability could hide the only display-safe candidate | High | With one cheap unsafe option and one expensive safe option, selection returned empty. Safety now filters the entire candidate pool before either affordability path. The safe expensive option is clearly discussion-only. |
| Per-dose cap treated as a daily cap in nearest-step helper | Moderate | Captopril 6.25 mg tid could not advance to 12.5 mg tid at eGFR 35 even though the declared cap is 25 mg per dose. Only explicitly daily caps restrict daily totals; per-dose caps remain enforced by eligible-dose filtering. No clinical cap changed. |
| Evidence bonus diluted by a neutral fifth drug | Moderate | Adding a binder with no special-feature points reduced credit for the other drugs. The denominator is now the patient's indicated foundational slots, fixed across candidates and at least one. Existing bonus clamps remain. This is scoring policy, not a calibrated efficacy estimate. |
| Cost-first over-budget order ignored cost | Moderate | A $30 safe option led over a $10 safe option solely because the affordability domain saturated. Cost-first fallback now sorts the eligible low-cost pool by cost, with clinical ties preserved. Other preferences keep their comparator. |
| Congestion coverage disturbed alternative ordering | Moderate | Appending a required congestion alternative could leave a cheaper, higher-scored option behind a dominated alternative. The chosen lead is preserved and the remaining options are ordered after insertion. An initial whole-list sort displaced the lead and failed existing checks; the final repair sorts only alternatives. |
| Interaction text implied an unconditional repeated digoxin reduction | High, partly mitigated | Amiodarone text did not account for an already-adjusted dose, and clarithromycin had no digoxin guidance. The warning names supported exposures, requires checking prior adjustment/serum level, and makes the label reduction conditional on a newly introduced interaction. Exposure dates, levels and prior adjustment are unavailable, so individualized dosing remains unresolved. Duplicate nitrate warnings now name the actual exposure. |
| Negative prices could create false affordability | Moderate | A negative supplied price lowered regimen cost. It is now treated as unavailable pricing, preserving the existing PRICE UNKNOWN warning and non-affordable cost sentinel. Missing prices remain explicitly unknown. |
| Formulation descriptions implied nonexistent or unverified single tablets | Moderate | Corrected carvedilol 50 mg, metoprolol succinate 12.5 mg, captopril 6.25 mg, H/ISDN 75/40 and valsartan descriptions using labels below. Spironolactone 12.5 mg now requires pharmacist preparation confirmation because the reviewed 25 mg product is unscored. No dose, frequency, price or tablet-burden scoring coefficient was invented. |
| Golden harness mixed insurance contexts | Moderate | It varied the price map but retained the fixture's insurance tier. Capture now supplies matching patient and price tiers and checks projected tier consistency. Captured exceptions can no longer be accepted during golden update. This improves the test harness; production pricing inputs were already supplied separately. |

## Current disposition of Claude's 17 third-pass findings

| Item | Status after both local repair batches |
|---|---|
| 1 — Flat RAAS potassium / rescue binder | Binder-on-reduction defect fixed in .4. Numerical potassium curve remains open: adverse-event rates do not establish a dose-to-serum-potassium function. |
| 2 — MRA continuation kidney thresholds | Open physician decision. Start-versus-continuation distinctions and drug-specific label contraindications must be reconciled; thresholds unchanged. |
| 3 — Renal-capped dose credit | Fixed in .4; graded credit and unknown-lab behavior tested. |
| 4 — Gentlest reduction / frequency wording | Fixed in .4. The related per-dose versus daily-cap helper defect is fixed in .5. |
| 5 — Unexplained empty low-potassium conflict | Fixed in .4; shared forced removal is named without relaxing either safety constraint. |
| 6 — Beta-blocker +0.05 potassium demotion | Open model/clinical policy decision. No arbitrary epsilon or new potassium effect introduced. |
| 7 — No-change BNP rise | Fixed in .5; all observed physiological fields and exam findings covered by the fixture identity check. |
| 8 — Bonus dilution above four drugs | Fixed in .5 using a patient-specific fixed denominator; weights still need clinical calibration. |
| 9 — Similar alternatives lack descriptive distinction | Open presentation/design work. Distinctness logic and congestion explanation remain; this pass fixes ordering but does not claim a complete alternative-label redesign. |
| 10 — Cost-first fallback | Fixed in .5; safe-pool ordering tested independently. |
| 11 — Digoxin/amiodarone/clarithromycin | Warning contradiction and missing exposure text fixed; dose personalization remains unresolved until the required treatment-history/level data exist. |
| 12 — Binder prices flat across dose | Open. Current price table is an estimate, not a verified patient quote; dose-specific price evidence is still needed. |
| 13 — Formulations | Misleading descriptions corrected from labels. Spironolactone preparation is explicitly unverified; manufacturer-specific dispensing remains a pharmacist check. Complexity still measures dosing schedule/delivery, not actual tablet count. |
| 14 — Flat drug effects / GLP-1 naming / loop equivalence | Open numerical-model calibration. GLP-1 patient-specific percentage conversion already exists; no new curve inferred from recall. |
| 15 — Lisinopril above minimum target | Open target-versus-maximum-dose policy decision. A target range does not by itself prove a tolerated higher dose must be forbidden. |
| 16 — Absolute potassium display ceiling | Open owner decision about neutral options at baseline K 6.0–6.4. Existing alert and safety threshold retained. |
| 17 — Missing regressions/UI checks | Added ten .4 and eighteen .5 regression groups covering the repairs plus pregnancy, allergy, nitrate/aliskiren/potassium/digoxin warnings and negative creatinine. Browser interaction and chart-copy layout remain unverified. |

## Evidence checked on 2026-11-12

Clinical numerical changes were limited to removing unsupported projection multipliers; no new clinical thresholds or effect sizes were introduced. Engineering/scoring choices above are identified as model policy.

- [Digoxin label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=dfac7f13-28be-423d-9389-9089da29da17): the interaction table supports amiodarone/clarithromycin exposure increases, dose or frequency adjustment and level monitoring. It does not reveal whether an individual patient's current dose already incorporates the interaction.
- [Carvedilol label](https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ec6d8d73-9d18-4a9e-ae0c-0ea12059e78e): listed tablet strengths stop at 25 mg; the modeled 50 mg administration is represented as two 25 mg tablets.
- [Metoprolol succinate label](https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=47f96afd-1483-66d5-e063-6294a90a201f): scored ER tablets can be divided; whole and half tablets must not be crushed or chewed.
- [Captopril label](https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=607687f4-63cf-411c-a20b-21d238a6b7a7): a scored 12.5 mg product supports the half-tablet description.
- [Valsartan label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=04b3c573-4ef7-5cf6-e063-6294a90a2c5f): 40/80/160 mg products are tablets.
- [BiDil label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=e1e63cd5-d1e4-4af5-bad5-1ad41ea46b00): each tablet contains hydralazine 37.5 mg and isosorbide dinitrate 20 mg; the modeled doubled administration requires two tablets.
- [Spironolactone label](https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=beaf74db-4159-3b59-ef99-575c3ac99aa1): this manufacturer's 25 mg tablet is unscored. A blanket scored-half-tablet assertion would be unsupported.
- [ESC guideline index](https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/heart-failure) and [official 2026 announcement](https://www.escardio.org/news/news-room/congress-news/2026-esc-guidelines-for-the-management-of-heart-failure): checked the existing 2026-guideline context. This pass did not change phenotype definitions or resolve the remaining supplement/continuation decisions.

## Ranking review

`ranking-diff-engine-only.txt` compares .5 engine behavior with the .4 local snapshot before the insurance-harness correction. `ranking-diff.txt` includes the harness correction; the ranking counts are unchanged by that correction.

- 1,016/1,032 lead regimens unchanged; 16 lead changes, all in fixtures with LVEF <=40.
- 1,004/1,032 displayed regimen sets unchanged; 995/1,032 orders unchanged.
- Eligibility and clinical alerts unchanged for the existing snapshot fixtures. New adversarial inputs do exercise changed alerts and the input boundary.
- Fifteen matched-regimen warning changes are the intended digoxin interaction wording. The diff command therefore exits 1; this is a reviewed behavior change, not a clean scoring-only refactor.
- Nine lead changes (duplicate current drugs, beta-blocker intolerance, gynecomastia fixtures, each in three tiers) follow preservation of observed congestion findings: a modeled weight drop no longer erases the examination and gains that scoring credit. Congestion-directed alternatives remain enforced by the coverage rule.
- Seven lead changes concern the fixed evidence denominator in regimens containing five or more drugs: two kidney-baseline-rise runs, two vericiguat-advisory runs and three ramipril-target runs. Renal escalation holds and other safety invariants remain checked. These are intentional model changes requiring clinical ranking review before release.

The snapshot was regenerated only after reviewing these differences. The updated snapshot also captures formulation wording, projected insurance context, and no-change preservation; unchanged lead counts do not mean all output fields are identical.

## Verification and limits

Final command outputs are stored beside this report. `npm run gate` and `npm run build` passed: typecheck; 399 verification checks; 1,032 golden runs; 100/100 broad audit; 51/51 treatment-error audit; zero critical/high/medium red-team findings; 32-drug × 3-tier pricing audit; and 5,000 randomized patients (seed 20261112).

Final non-overlapping sweeps of 15,000 patients each, starting at **2026111215** and **2026130000**, both exited 0 with no violations. Together with the 5,000 gate patients, these cover **35,000 distinct synthetic patient seeds**. A further passing run starting at 2026111299 overlaps the first range by 14,916 patients; it is retained as evidence but not counted as another independent 15,000. The sweep checks safety, deterministic ordering, preference isolation and repeated-visit reversals. Its over-budget cost-first oracle was updated to the explicit new policy, and named INPUT ERROR is accepted as an explained stop. These checks do not calibrate the clinical effects or validate real patients.

Browser verification was attempted against a local development server at port 4175. Browser-tab creation failed because the browser host was unavailable; native Chrome control then timed out (`-10005`). No form-click, result-render, chart-copy, keyboard or visual-layout verification is claimed. Build passes with the existing large-bundle warning (856.68 kB JavaScript); Node also emits a module-registration deprecation warning. The known Entresto Medicare table-price note remains capped by the pricing service.

Before release: resolve or explicitly accept the remaining clinical/model policies, review changed rankings clinically, complete the browser flow (including copied notes), then rerun gate/build on the release candidate. No production or clinical activation occurred.
