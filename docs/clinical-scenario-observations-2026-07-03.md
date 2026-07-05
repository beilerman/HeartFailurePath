# HeartFailurePath clinical scenario observations — 2026-07-03

## Scope and constraint

Brad asked for varied, realistic, and creative clinical scenario testing of HeartFailurePath, with observations written to a file and no code changes. I did not edit source code. This file is an observations/QA artifact only.

Important working-tree note: before this audit, the repository already had many modified source files plus an untracked `docs/` directory. I left those existing source changes untouched.

## Verification receipts

Commands run from `C:/Users/medpe/HeartFailurePath/HeartFailurePath`:

| Command | Result |
|---|---:|
| `npm run typecheck` | PASS |
| `npm run build` | PASS — Vite build completed, `dist/assets/index-BxKHU6xq.js` 453.10 kB / gzip 123.73 kB |
| `npm run verify` | PASS — 93/93 clinical scenarios |
| `npx tsx scripts/hundredScenarioAudit.ts` | PASS — 100/100 clean |
| `npx tsx scripts/mistakeAudit.ts` | PASS — 51/51 clean |
| Ad hoc creative scenario probe, temporary script outside repo at `C:/Users/medpe/AppData/Local/Temp/hfpath_creative_probe.ts` | Completed — 12 additional stress scenarios inspected |

Total structured scenario checks passing: **244/244** across the existing verification/audit harnesses, plus **12 exploratory probes** reviewed qualitatively.

## Overall impression

HeartFailurePath is clinically much stronger than a simple formulary recommender. The engine repeatedly behaved like a guarded HF medication optimization tool: it recognizes phenotype, preserves HFrEF/HFimpEF disease-modifying therapy, blocks many unsafe medication choices, generates high-signal alerts, and surfaces modern adjuncts. The broad scenario harnesses also show unusually good coverage for real-world prescribing mistakes: dual RAAS, dual MRA, pregnancy teratogens, hyperkalemia, CKD, DDI exposures, intolerance handling, HFimpEF continuation, and affordability constraints.

The most important caveat is that the app should still be treated as **decision support**, not autonomous prescribing. The remaining concerns are not broad failures in core GDMT logic; they are edge-context gaps where a human clinician would add nuance not fully captured by the current input model.

## Strengths observed

1. **Strong regression coverage and current green baseline.** Existing checks now cover 93 CI scenarios, a 100-scenario broad clinical audit, and a 51-scenario mistake audit, all passing.
2. **Safety-first hard stops.** Severe hypotension, invalid BP inversion, missing LVEF, physiologically impossible values, pregnancy contraindications, severe hyperkalemia patterns, dual RAAS/MRA, PDE5+nitrate, and duplicate-med cleanup are represented and passed.
3. **HF phenotype handling is substantially developed.** HFrEF, HFmrEF, HFpEF, and HFimpEF are handled differently; HFimpEF preservation is a particular strength.
4. **Modern HFrEF optimization is prioritized.** Quad-pillar therapy and adjuncts such as ivabradine, vericiguat, IV iron, hydralazine/isosorbide for appropriate Black NYHA III patients, and potassium-binder-enabled GDMT are represented.
5. **Intolerance handling is more nuanced than typical.** The harness validates ACEi cough, angioedema, gynecomastia, budget-constrained swaps, and negated free-text intolerance detail.
6. **CKD/electrolyte logic is clinically useful.** It distinguishes SGLT2i initiation/continuation boundaries, MRA risk, binder rescue, and severe-CKD loop strategy alerts.
7. **Affordability and complexity are considered.** Budget and complexity constraints affect displayed choices rather than merely being informational.
8. **Data-quality gates are present.** Missing LVEF stops recommendations; missing potassium and missing renal function trigger data-required alerts.
9. **Device/cardiac rehab/advanced-HF alerts add non-medication value.** The tool is not limited to medication selection.

## Potential problem points / follow-up targets

These are observations from the exploratory scenarios and the existing harness output. They should be reviewed clinically before deciding whether to change code.

### P1 — SGLT2i recommendation despite prior DKA in a T2DM/HFpEF probe

Exploratory scenario: obese HFpEF + CKD + type 2 diabetes + `Prior DKA`.

Observed top recommendation included **Dapagliflozin** plus spironolactone, with no displayed DKA caution in the probe output. The formal regression suite has a scenario for `Type 1 DM + Prior DKA (Avoid SGLT2i)`, but this exploratory T2DM/prior-DKA combination suggests the risk model may be too narrow if it only catches type 1 diabetes or a specific comorbidity pattern.

Clinical concern: prior DKA, ketogenic diet, insulin deficiency, acute illness, or perioperative state can materially change SGLT2i risk even in type 2 diabetes. This may deserve either a hard block in selected contexts or at minimum a strong warning/monitoring requirement.

### P1 — Missing renal function still allowed renal-dependent therapy suggestions

Exploratory scenario: missing eGFR/creatinine but normal potassium.

Observed: the engine produced a `DATA REQUIRED` alert, but still displayed recommendations including ARNI, beta blocker, and SGLT2i. This is not necessarily wrong if the UX clearly frames them as provisional, but it is a possible safety/usability issue: clinicians may anchor on the displayed regimen and underweight the data-required alert.

Potential mitigation: require renal function before initiating renal/electrolyte-sensitive classes, or visually separate provisional suggestions from actionable recommendations when renal function is missing.

### P1/P2 — COPD/hypoxia probe recommended carvedilol rather than beta-1 selective strategy

Exploratory scenario: severe COPD/home-O2-like profile with SpO2 88%, low peak flow, untreated HFrEF.

Observed top regimen included **Carvedilol** and a hypoxia alert. Existing formal tests do check asthma and severe asthma pathways, but COPD-specific beta-blocker selection may deserve more nuance. In real practice, HFrEF benefit usually supports beta-blocker use in COPD, but a beta-1 selective agent is often preferred when bronchospasm risk is prominent.

Potential mitigation: add COPD/low-peak-flow preference toward metoprolol succinate or bisoprolol, while preserving the message that evidence-based beta-blockers remain beneficial when tolerated.

### P2 — Lactation/postpartum context appears under-modeled

Exploratory scenario: postpartum/lactating HFrEF, not pregnant.

Observed: treated like standard nonpregnant HFrEF with ARNI + carvedilol + SGLT2i. Pregnancy protections are strong, but lactation/postpartum medication-safety nuance is not obviously modeled. This is a narrower issue than pregnancy, but could matter clinically.

Potential mitigation: add a structured pregnancy/postpartum/lactation field or warning text; review ARNI/SGLT2i/lactation guidance before implementing.

### P2 — Active cocaine/substance-use nuance not surfaced

Exploratory scenario: HFrEF with active cocaine use and tachycardia.

Observed: no substance-use alert; top recommendation included carvedilol. This may be clinically acceptable in chronic HFrEF depending on current intoxication status and agent selection, but the app currently does not appear to distinguish acute intoxication from history/active use.

Potential mitigation: if substance-use context is in scope, add an alert differentiating acute cocaine intoxication/chest pain from chronic HFrEF management.

### P2 — Amyloid-like HFpEF is not a first-class phenotype

Exploratory scenario: HFpEF with low BP, AFib, small LV cavity/severe atrial enlargement surrogate, possible cardiac amyloid.

Observed: SGLT2i + finerenone with hypotension warning. The warning is helpful, but infiltrative/restrictive cardiomyopathy nuance is not explicitly modeled. If the app intends general HF use, this may be acceptable; if it intends advanced phenotype triage, amyloid flags could be valuable.

Potential mitigation: add optional flags for suspected amyloid/infiltrative cardiomyopathy and prompt for disease-specific evaluation rather than only medication optimization.

### P2 — Advanced HF scenario may still present medication optimization too prominently

Exploratory scenario: EF 15%, NYHA IV, NT-proBNP 9000, severe congestion, very low KCCQ, low BP, high-dose loop, on carvedilol.

Observed: advanced-HF alert fired, which is good. The top regimen still included ARNI + ivabradine + carvedilol + high-dose furosemide and warned about BB+ivabradine. This may be reasonable as a display candidate, but in true advanced/decompensated HF the clinical priority is urgent advanced-HF evaluation, perfusion/volume assessment, and possible admission/inotropes/mechanical support rather than routine outpatient optimization.

Potential mitigation: make advanced-HF alerts visually dominant and consider suppressing or downgrading outpatient med-optimization cards when multiple advanced-HF red flags are present.

### P3 — Output score field mismatch in the ad hoc script

The temporary creative probe printed `Top score undefined` because it referenced `top.score`; current output appears to use a different score property in the formal harness/UI. This is a probe-script issue, not an app failure. The regimen/alert outputs were still readable.

## Suggested next test additions

If follow-up coding is approved later, add formal non-CI or CI scenarios for:

1. T2DM + prior DKA / ketosis-prone diabetes / ketogenic diet with SGLT2i risk.
2. Missing eGFR/creatinine with normal K: ensure renal-sensitive therapies are either blocked or clearly provisional.
3. Severe COPD/low peak flow/hypoxia: prefer beta-1 selective beta blocker or provide explicit COPD caution.
4. Lactation/postpartum cardiomyopathy medication-safety warnings.
5. Active cocaine use: distinguish acute intoxication vs chronic use/history.
6. Suspected cardiac amyloidosis / restrictive cardiomyopathy with low BP and AFib.
7. Multi-criterion advanced HF: ensure referral/urgent evaluation dominates routine outpatient GDMT optimization.

## Architecture review: first-principles disease management vs scenario scripts

Short answer: **the fundamental engine is mostly first-principles / disease-management based, not a collection of scenario-specific situational scripts.** The scenario files are primarily regression tests. The production engine builds recommendations by classifying phenotype, identifying applicable disease-modifying pillars and adjuncts, generating medication modifications, simulating physiologic deltas, applying safety filters, and ranking trade-offs.

Evidence from code review:

1. **Central class model, not case names.** `services/simulationService.ts` starts with a `DRUG_CLASS_REGISTRY` that defines class group, DBP coupling, and flags such as `raas`, `mra`, `diuretic`, `disease-modifying`, and `volume-sensitive-intensifier`. This makes behavior attach to medication classes rather than named test scenarios.
2. **Phenotype-first pathway selection.** `classifyPhenotype(patient)` maps patients to HFrEF/HFmrEF/HFpEF, with HFimpEF preserving HFrEF therapy. Missing pillars are computed from applicable phenotype pillars rather than from individual canned cases.
3. **Delta-based medication modification engine.** The engine analyzes the current regimen into missing pillars, titratable medications, swaps, removals, addable adjuncts, contraindications, intolerances, and redundant therapies; then `generateCandidateModifications` creates add/titrate/swap/remove/keep candidates and compound candidates. This is algorithmic disease management.
4. **Physiologic simulation layer.** `simulateModificationEffect` applies marginal drug effects to LVEF, NT-proBNP, volume/weight, KCCQ, LAVI/LVEDD, SBP/DBP, HR, and potassium. It uses additive/multiplicative deltas and dose-response data from formulary entries rather than selecting outputs by scenario label.
5. **Evidence-weighted scoring.** The guideline-concordance table encodes phenotype-specific pillar evidence, recommendation class, trial basis, and target-dose credit. The overall score combines neurohormonal, functional, volume, structural, cost, adherence, and guideline domains with explicit weights.
6. **Safety gates are general rules.** Examples: pregnancy exclusions, SBP hard blocks, projected SBP/HR/K filters, RAAS/MRA duplication prevention, nitrate/PDE5 exclusion, intolerance policy, renal/electrolyte checks, acute decompensation beta-blocker logic, and binder rescue. These are broad guardrails, not scenario-output lookup tables.
7. **Scenario/test labels do not appear as production branches.** Searching the engine for obvious scenario identifiers such as `John Doe`, `Jane Smith`, `Scenario`, `patient.name`, or scenario titles did not show case-specific dispatch. The few `scenario/audit/finding` strings in comments refer to bug-fix provenance, not runtime case selection.
8. **UI now explicitly downplays false precision.** `RecommendationCard.tsx` labels the composite score as an internal ordering heuristic and states modeled estimates are population-average, uncalibrated, and not patient-specific predictions.

Important caveat:

The code is **not a pure mechanistic cardiovascular physiology simulator**. It is a hybrid clinical-decision engine: guideline pathways + trial-derived effect estimates + physiologic deltas + safety/contraindication rules + scoring heuristics. That is appropriate for clinical decision support, but it means some logic remains threshold/rule based — e.g., `LVEF <= 40`, `K+ > 5.4`, `SBP < 90`, `NT-proBNP >= 1600`, fluid excess cutoffs, and eligibility criteria for ivabradine/vericiguat/GLP-1/iron/H-ISDN. Those thresholds are not “scenario scripts”; they are guideline/trial criteria and safety gates. Still, they can create blind spots when a real-world context is not represented by the input model.

Where scenario-driven patches may have entered:

Some comments explicitly mention “100-scenario audit,” “red-team probe,” “H1/H2 fixes,” or “Finding” IDs. Those are signs that testing discovered edge failures and the code was adjusted. The resulting fixes generally appear to have been generalized into reusable policies — e.g., intolerance policy, duplicate-class cleanup, hypoperfusion definition, DBP coupling, target-dose inclusion — rather than hard-coded to pass one named scenario. That is healthy if maintained carefully, but future work should keep pushing those fixes back into general disease-management abstractions rather than accumulating one-off conditional branches.

Verdict:

**Mostly first-principles/guideline/disease-management architecture with scenario-driven regression hardening.** I would not characterize it as merely scenario-based situational algorithms. The main improvement opportunity is not to “make it first-principles” from scratch; it is to continue consolidating thresholds and special cases into explicit clinical concepts — phenotype, congestion/perfusion, renal/electrolyte risk, intolerance evidence tier, treatment pillar/adjunct eligibility, and advanced-HF triage — with citations and tests.

## Bottom line

The current engine passed a very large structured safety/regression sweep and looks strong on mainstream HFrEF/HFimpEF GDMT, contraindications, renal/electrolyte safety, intolerance handling, and common prescribing mistakes. The most clinically important remaining gaps are specialized-context refinements: SGLT2i risk beyond type 1 diabetes, missing renal-function actionability, COPD beta-blocker selection, lactation/postpartum context, substance-use nuance, infiltrative HFpEF, and advanced-HF prioritization.
