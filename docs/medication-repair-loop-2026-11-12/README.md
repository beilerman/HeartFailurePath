# Medication transition repair and repeated adversarial review

Project-wide continuity, current repository state and remaining work: [consolidated handoff, 2026-11-13](../HANDOFF-2026-11-13.md).

Local rule set **2026-11-12.8**, on `refactor/glucosepath-alignment`. This work follows the [32-medication review](../medication-properties-2026-11-12/README.md) and supersedes its open runtime-model findings. Changes are local, uncommitted, unpushed and undeployed.

The engine now evaluates proposed treatment against **recorded treated physiology**. It does not back-calculate an untreated patient, forecast individual response, or subtract trial-average benefit when a drug is stopped. Unsupported quantitative response functions were removed from clinical evaluation and presentation, rather than replaced with invented coefficients. Medication-specific eligibility, dose guidance, contraindications, interactions, evidence context and monitoring remain active.

## Findings and systemic disposition

| Finding from the prior review | Implemented disposition | Verification |
|---|---|---|
| Mixed acute and chronic time horizons; current medication assumed established | Optional exposure status, adherence assessment, start/current-dose/last-dose dates; explicit interval/tolerance review before escalation. Unknown use holds related increases and switches while independent decisions remain available. | Missing/partial use, date/order/future-date validation, interval hold and corrective reduction tests. |
| Asymmetric initiation, withdrawal and renal coefficients | Removed numerical CHF **and hemodynamic** response functions from clinical decisions. Recorded BP, pulse, potassium, EF, biomarkers, weight and symptoms remain unchanged. | All 32 drugs' CHF/hemodynamic functions replaced with throwing functions during all 344 fixtures: clinical outputs identical. |
| Entry-only synergies and nonexistent reversal rules | Removed numerical four-pillar, loop/SGLT2, renal-buffer and cardiac-output compensation. Net exposure still provides deterministic treatment considerations. | Identity, representation, regimen-order, remove/re-add and coefficient-isolation tests. |
| EF saturation, floors and repeated projections create an incoherent inverse | No numerical forward or inverse response. Proposed snapshots are tagged and rejected if submitted as a new observed visit; changed doses lose old tolerance/date metadata. | All dose/frequency removals preserve observations; public API rejects proposed snapshots. |
| Different trial comparators and KCCQ measures create false comparative benefit | Neurohormonal, functional, volume and structural outcome domains are unassessed with zero weight. Remaining weights are rescaled. CSS/TSS/OSS identity is recorded without conversion; formulary response estimates removed. | Every returned fixture option checked; SSR and browser disclosure checks. |
| Flat dose curves hide escalation risk | No curve can supply equal-effect or equal-risk clearance. Dose changes use recorded findings, restrictions, interval/tolerance assessment and medication-specific reassessment guidance. | Throwing-coefficient mutation covers flat as well as nonflat curves. |
| Completed iron/Furoscix courses treated as continuous exposure | Held/completed entries excluded from active therapy; course history preserved without subtracting benefit. Restart/repeat requires review. Iron requires course and phosphate assessment. | Positive/negative restart paths, completed-course and repeat-phosphate tests; actual browser flow. |
| GLP-1 weight response compounded from current weight; arbitrary dry-weight allocation | Removed percentage-to-individual-kg forecasting, dry-weight allocation and withdrawal/regain calculations. | Every dose preserves measured weight; proposed-state reuse rejected. |
| Digoxin, diuretic and binder response cannot be personalized; cost/burden overinterpreted | Individual exposure/diuresis/correction explicitly unquantified, with drug-specific review needs. Automatic binder rescue removed. Cost remains an estimated drug-level price; dosing burden is explicitly a frequency proxy, not pill count or measured adherence. | Measured potassium cannot be normalized by a binder; unknown prices remain unknown; screen and copied note disclose limits. |

Legacy `chf_effects`, `hemodynamic_effects` and `patientChfEffects` remain **audit-only data/functions**, marked deprecated and covered by a test proving they cannot affect clinical outputs. The diagnostic [inventory](inventory.json) records those historical coefficients; it is not an active patient-response model. There are **32 drugs and 122 dose/frequency entries** after restoring the trial-supported bisoprolol 1.25 mg starting tier with an explicit preparation-verification requirement.

## Additional defects found while looping

1. An adverse-only numerical safety screen still favored flat dose curves. It was removed; safety now uses recorded findings and explicit drug restrictions.
2. Once numerical efficacy was removed, an unsupported reduction could win on cost or burden. Stable established therapy now needs a clinical reason for reduction; dose adjustment remains available for actual potassium, heart-rate, renal, interaction or volume indications.
3. Unknown use could suppress every option when a mandatory substitution was proposed. An unconfirmed substitution is withheld, but indicated removal and independent alternatives survive.
4. Target fractions were used as beta-blocker dose equivalence. Switch proposals now use an eligible starting tier and an individual taper/transition plan. Captopril and valsartan also had unsupported fixed renal caps; these were replaced by caution and a severe-impairment change-review prerequisite, without forced reduction to an invented maximum.
5. Distinct-option selection could hide an increase versus no change, or crowd out other treatment steps with drug variants. Selection now recognizes distinct clinical actions; steroidal/nonsteroidal MRA choices are not silently treated as identical exposure.
6. Potassium-lowering diuretics could be intensified during measured hypokalemia. E21 and the shared candidate prerequisite hold those changes below 3.5 (explicit conservative software policy); independent decisions remain available. Above 6.0 but below 6.5, only supported corrective reductions/removals may be shown, with the emergency alert and abnormal potassium unchanged.
7. An earlier generic removal summary could hide the specific mandatory potassium reason. The final forced-removal explanation now replaces that generic text.
8. Browser testing found uncertainty missing from the copied note, an overly uniform follow-up escalation schedule, and a repeat-iron prerequisite absent from the assessment explanation. Screen and note now share treatment considerations/limits, individualized review prompts and iron/phosphate prerequisites.
9. Visual review found medication-history requests styled as urgent red alerts. They now appear as care prompts and prerequisite explanations; actual urgent findings remain safety alerts. Edits clear stale confirmation, invalid exposure dates can be reached in their expanded form section, and event values are captured before state updates.

## Evidence checked for changed drug rules

- [CIBIS-II](https://pubmed.ncbi.nlm.nih.gov/10023943/) supports the bisoprolol 1.25 mg trial start. This does not establish local product availability or cross-beta-blocker dose equivalence. A verified preparation is required.
- [Captopril label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=65ed6e70-f1ee-437e-965c-d1b1fdadd832) calls for individualized renal dose reduction/slow titration; [valsartan label](https://www.dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=75235313-8a07-8849-9b5a-12887992033e) does not validate the removed fixed severe-renal cap. The software's eGFR-below-30 change hold for these two drugs is conservative policy, not a quoted label maximum.
- [FDA Injectafer safety communication](https://www.fda.gov/drugs/drug-safety-communications/fda-adds-boxed-warning-labeling-ferric-carboxymaltose-injection-injectafer-describe-risk-low) and [2026 label](https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/203565s030lbl.pdf) support phosphate-risk and repeat-course assessment. The warning was already in the project; the missing course-history/prerequisite workflow was repaired. Requiring acceptable phosphate review for **every** repeat course is stricter than the label's conditional testing requirement and is identified as policy.
- [Ivabradine label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=676907d3-b374-4baa-8422-c04706409540) and [finerenone label](https://www.accessdata.fda.gov/drugsatfda_docs/label/2026/215341s011lbl.pdf) support drug-specific reassessment intervals instead of a universal escalation timetable.
- [TRED-HF](https://pubmed.ncbi.nlm.nih.gov/30429050/) documents relapse after withdrawal in a selected recovered-cardiomyopathy population; it does not establish an individual EF subtraction or universal withdrawal percentage. No such coefficient was invented.

This was a full software-property/transition audit of the formulary, with targeted fresh primary-source checks for changed rules. It was not a newly completed label-by-label clinical revalidation of every preexisting rule.

## Ranking review and verification

The [ranking comparison](ranking-before-update.txt) was inspected **before** the golden snapshot update. Across 1,032 fixture/tier runs, 560 lead regimens were unchanged and 472 changed; 197 displayed sets and 102 full orders stayed identical. Eligibility/alert text differed in 996 runs and matched-regimen warnings in 601. Removing outcome forecasts, preventing unsupported reduction/rescue, adding prerequisites and improving option diversity intentionally changed ordering. Scores before and after this change are not comparable measures of clinical benefit.

Representative review: the wet/warm example now prioritizes an eligible missing MRA/SGLT2 step while retaining a congestion-treatment alternative. Stable target/subtarget therapy is no longer reduced solely for score economy. Corrective hyperkalemia plans no longer show an invented normal potassium. Dose-specific label tests now independently exercise the relevant treatment decision rather than assuming it must always occupy one of three full-formulary ranking slots. Old “expected kilograms/heart-rate drop” assertions were replaced by stronger no-fabricated-observation checks, not silently discarded.

Final receipts are in [verification.txt](verification.txt), [browser-checks.json](browser-checks.json), [second-fuzz.txt](second-fuzz.txt) and [probes-after.json](probes-after.json). The last completed engineering review found no additional reproducible defects in the reviewed scope:

- TypeScript check, **442 engine check groups**, **29 UI content groups**, **1,032 golden runs**.
- **100/100** broad clinical cases and **51/51** mistake-audit cases clean; red team **0 critical / 0 high / 0 medium**; pricing audit passes.
- Two **5,000-case randomized sweeps**, seeds 20261112 and 20271112, no violations: 10,000 runs from disjoint seed ranges.
- Transition diagnostics: 122 dose/frequency entries; 0 identity discrepancies, 0 swap/remove-add discrepancies, 0 numerical round-trip drift and 0 invalid ranges. Zero drift follows from retaining observations, not from validating biological reversibility.
- Actual local Chromium workflow: input to calculation to copied note, unknown use, dose-edit invalidation, completed iron, repeat phosphate prerequisites, evidence/formulary pages and 390px mobile layout. No page exceptions or document horizontal overflow; screenshots visually inspected. Built-in browser host was unavailable, so local Playwright was used.
- Production build succeeds. Existing nonblocking large-bundle and Node deprecation warnings remain; neither is a clinical verification result.

Reproduce with `npm run gate`, `npm run build`, and `npx tsx scripts/fuzzSweep.ts 5000 20271112`. The browser script accepts `PLAYWRIGHT_MODULE`, `BROWSER_EXECUTABLE` and `HF_BASE_URL`, runs against the local dev server, and uses only synthetic samples. The [old golden snapshot](golden-before.json.gz) and [pre-repair evidence matrix](evidence-matrix-before.md) are retained for audit.

## Boundary after repair

No identified runtime or interface defect from this review remains intentionally active. **Clinical readiness is not established.** There is still no validated untreated-state estimator, individual pharmacokinetic/pharmacodynamic model, treatment-response forecast or validated clinical utility for the ranking weights. Those capabilities are not claimed or substituted with point estimates. A future quantitative model would require longitudinal observed data, treatment timing/adherence, endpoint-specific trial provenance and independent calibration before it can be enabled. Actual medication reconciliation, measurement freshness, patient-specific prescribing decisions and cost verification remain clinical responsibilities.
