# HeartFailurePath Evidence Matrix

Last reviewed: 2026-06-28  
Scope: deterministic clinical decision-support rule traceability. This matrix documents the clinical rationale behind major gates, scoring domains, and recommendation classes. It is not an independent validation study.

## How to use this matrix

Each row provides a stable rule ID that can be referenced from code comments, UI copy, tests, or future structured outputs.

Columns:
- **Rule ID** — stable identifier for the clinical behavior.
- **Implementation location** — current code/doc surface.
- **First-principles rationale** — physiology/pathophysiology basis.
- **Evidence anchor** — guideline/trial/source family used by the app.
- **Evidence strength** — how directly evidence supports the implemented rule.
- **Calibration note** — whether the numeric implementation is guideline-derived, trial-derived, or heuristic.
- **Clinical risk if wrong** — primary harm mode.

## Core phenotype and GDMT rules

| Rule ID | Behavior | Implementation location | First-principles rationale | Evidence anchor | Evidence strength | Calibration note | Clinical risk if wrong |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HF-PHENO-001 | Classify phenotype as HFrEF, HFmrEF, HFpEF, with HFimpEF preserving HFrEF pillar expectations. | `services/simulationService.ts` `classifyPhenotype`, `hasHistoricalHFrEF`, `shouldPreserveQuadForUnknownHistory` | EF phenotype determines which mechanisms have disease-modifying evidence; recovered EF remains relapse-prone if GDMT is withdrawn. | 2022 AHA/ACC/HFSA HF guideline; TRED-HF concept for relapse after withdrawal. | Guideline / pathophysiology | Thresholds are guideline categories; unknown-history preservation is conservative heuristic. | Inappropriate de-escalation or wrong phenotype pathway. |
| HF-GDMT-001 | HFrEF quad-pillar model: RAAS/ARNI, evidence beta-blocker, MRA, SGLT2i. | `CONCORDANCE_TABLE.HFrEF`, `computeGdmtGaps`, candidate generation | Neurohormonal blockade + natriuresis/metabolic effects reduce morbidity/mortality and remodeling. | PARADIGM-HF/SOLVD; MERIT-HF/COPERNICUS/CIBIS-II; RALES/EMPHASIS-HF; DAPA-HF/EMPEROR-Reduced; AHA/ACC/HFSA. | High / Class I | Pillar presence and target-dose bonuses are heuristic scoring representations of guideline priority. | Under-treatment of HFrEF or false sense of completeness. |
| HF-GDMT-002 | HFmrEF weighted hybrid model: SGLT2i strongest (IIa), RAAS/BB/MRA weaker (IIb). | `CONCORDANCE_TABLE.HFmrEF` | Mid-range EF shares mechanisms with HFrEF but trial signals are subgroup/less direct except SGLT2i. | DELIVER/EMPEROR-Preserved LVEF 41-49; CHARM/subgroup data; AHA/ACC/HFSA §7.3.2. | Moderate | Point values are evidence-strength heuristics, not calibrated outcome probabilities. | Overstating weak therapies or underweighting SGLT2i. |
| HF-GDMT-003 | HFpEF SGLT2i-first with MRA/nsMRA as adjunct; volume control remains central. | `CONCORDANCE_TABLE.HFpEF`, adjunct logic | HFpEF benefit is strongest for SGLT2i; congestion drives symptoms/hospitalization; MRAs have subgroup/emerging evidence. | EMPEROR-Preserved, DELIVER, TOPCAT Americas, FINEARTS-HF. | Moderate to high depending class | SGLT2i weighting is guideline/evidence aligned; MRA/nsMRA relative weights are heuristic and need periodic review. | Over/under-treatment and misleading endpoint equivalence. |
| HF-GDMT-004 | GDMT-completeness bonus rewards indicated achievable disease-modifying therapy before cost/adherence. | scoring loop / `gdmt_completeness` | Complete indicated therapy is usually higher value than small safe changes when safety permits. | Guideline sequencing and STRONG-HF style rapid optimization. | Guideline + expert heuristic | `COMPLETENESS_MAX=30` is a heuristic calibration. | Partial regimens could appear optimal if completeness is underweighted; unsafe regimens if overweighted. |

## Safety gates and contraindication rules

| Rule ID | Behavior | Implementation location | First-principles rationale | Evidence anchor | Evidence strength | Calibration note | Clinical risk if wrong |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HF-SAFE-001 | Hard stop when SBP <90; display filter excludes projected SBP <85. | `generateAndScoreModifications`, display safety filter | Oral GDMT initiation/titration requires perfusion reserve; hypotension can precipitate shock/syncope/AKI. | Trial inclusion thresholds and HF guideline safety principles. | High | Input hard stop is physiology/guideline aligned; projected penalties are heuristic. | Hemodynamic collapse or inappropriate withholding if too conservative. |
| HF-SAFE-002 | Implausible physiology hard-stops recommendation generation. | `validatePhysiologicBounds`, `auditCriticalData` | Bad input invalidates phenotype, projections, and contraindication logic. | Clinical data-quality consensus. | High | Bounds are conservative data-quality heuristics. | Confident recommendations from transcription/unit errors. |
| HF-SAFE-003 | Pregnancy excludes RAAS, MRA/nsMRA, and SGLT2i. | formulary filtering and pregnancy alert | Teratogenic/fetal renal toxicity and insufficient pregnancy safety. | Drug labels; pregnancy safety consensus. | High | Hard exclusion. | Fetal/neonatal harm. |
| HF-SAFE-004 | Nitrate/H-ISDN is hard-excluded with PDE5 inhibitor exposure. | formulary exclusion and DDI warning | Combined vasodilation can cause profound/fatal hypotension. | Drug labels / absolute contraindication. | High | Hard exclusion. | Fatal hypotension. |
| HF-SAFE-005 | Dual RAAS and dual MRA combinations are structurally blocked. | candidate filters | Same-mechanism stacking increases AKI/hyperkalemia/hypotension without additive outcome benefit. | Guideline/drug-label safety principles. | High | Hard structural rule. | AKI/hyperkalemia/hypotension. |
| HF-SAFE-006 | Acute decompensation blocks beta-blocker initiation; existing BB is reduced only with hypoperfusion, not warm-and-wet congestion. | `analyzeCurrentRegimen`, candidate injection | BB withdrawal can harm stable/warm patients; initiation during decompensation is unsafe; hypoperfusion changes risk/benefit. | HF guideline acute decompensation principles; EMPULSE/SOLOIST for safe SGLT2i in selected acute HF. | Moderate/high | Warm/cold operationalization is a clinical heuristic based on vitals/exam. | Shock/bradycardia if too aggressive; undertreatment/withdrawal if too conservative. |
| HF-SAFE-007 | K+ binder rescue enables consideration but carries residual-risk penalty. | simulation warnings/scoring | Potassium binders can permit RAAS/MRA continuation but do not remove hyperkalemia substrate. | DIAMOND/HARMONIZE; hyperkalemia management consensus. | Moderate | Penalty magnitude is heuristic. | Unsafe hyperkalemia minimization or missed GDMT continuation. |
| HF-SAFE-008 | Documented intolerance applies to current regimen and new starts; swaps preserve pillars when possible. | `deriveIntolerancePolicy`, current regimen analysis | True intolerance should prevent re-exposure, but pillar loss should be avoided when safe alternatives exist. | Drug labels; clinical medication-reconciliation practice. | Moderate | Keyword/dropdown mapping is local heuristic; structured reason required for current-therapy changes. | Recurrent adverse effect or unnecessary GDMT loss. |

## Adjunct and special-population rules

| Rule ID | Behavior | Implementation location | First-principles rationale | Evidence anchor | Evidence strength | Calibration note | Clinical risk if wrong |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HF-ADJ-001 | Ivabradine requires sinus rhythm, HR >=70, LVEF <=35, and maximally tolerated/evidence BB context. | formulary contraindications / eligibility | If-channel inhibition benefits selected tachycardic HFrEF patients already on GDMT. | SHIFT; guideline criteria. | High for selected population | Eligibility is rule-based; point value heuristic. | Bradycardia or premature adjunct use. |
| HF-ADJ-002 | Vericiguat requires recent worsening HF, elevated NT-proBNP, NYHA II-IV, LVEF <45. | eligibility logic | sGC stimulation targets high-risk recently worsening HFrEF. | VICTORIA; guideline adjunct role. | Moderate | NT-proBNP threshold is modeled for specificity; not full VICTORIA inclusion reproduction. | Overuse in low-risk patients or missed high-risk adjunct. |
| HF-ADJ-003 | GLP-1/GIP therapy restricted to obesity phenotype with LVEF >=40; not used for HFrEF/HFimpEF pathways. | adjunct eligibility | Weight loss can improve HFpEF obesity phenotype; HFrEF benefit is not established and may differ. | STEP-HFpEF / obesity-HFpEF evidence; guideline-adjacent emerging data. | Emerging/moderate | Adjunct points are heuristic; endpoint is symptoms/weight more than mortality. | Overstated disease-modifying benefit. |
| HF-ADJ-004 | IV iron eligibility follows ferritin <100 or ferritin 100-300 with TSAT <20. | iron deficiency logic | Iron deficiency worsens functional capacity and HF outcomes; repletion reduces HF events in selected trials. | AFFIRM-AHF, IRONMAN, ESC criteria. | Moderate | Eligibility thresholds are guideline/trial based; score impact heuristic. | Missed functional improvement or inappropriate infusion. |
| HF-ADJ-005 | Furoscix modeled as outpatient loop strategy for worsening congestion with device/safety warnings. | formulary / simulation warnings / FAQ | Subcutaneous furosemide can support outpatient decongestion in selected patients; hypoxemia/renal failure need escalation. | Loop diuretic standard care; Furoscix labeling; outpatient worsening-HF pathway assumptions. | Label + expert pathway | Eligibility and preference are heuristic, not outcomes-calibrated. | Delayed urgent IV diuresis or device misuse. |
| HF-ADJ-006 | Device/advanced-HF alerts screen low EF, NYHA burden, and low-output/high-risk states. | clinical alerts | Severe systolic dysfunction and advanced symptoms need device/advanced-HF evaluation beyond medication ranking. | AHA/ACC/HFSA ICD/CRT and advanced HF guidance. | Guideline | Alert criteria simplified; not full device eligibility engine. | Missed referral or over-alerting. |

## Scoring and presentation rules

| Rule ID | Behavior | Implementation location | First-principles rationale | Evidence anchor | Evidence strength | Calibration note | Clinical risk if wrong |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HF-SCORE-001 | Seven-domain score combines neurohormonal, functional, volume, structure, cost, adherence, guideline domains. | scoring functions / README / FAQ | HF care is multi-objective: biology, symptoms, congestion, remodeling, affordability, adherence, and evidence alignment. | Guideline + clinical reasoning. | Expert heuristic | Domain weights are local calibration, not externally validated. | False precision or distorted ranking. |
| HF-SCORE-002 | Modeled physiologic deltas are displayed qualitatively, not as individualized predictions. | `buildQualitativeProjections`, UI cards | Trial averages and mechanistic deltas cannot predict individual response precisely. | Modeling-governance best practice. | Consensus/expert | Numeric internal fields support safety tests only. | Patient/clinician over-trust in exact projections. |
| HF-SCORE-003 | Cost is final tiebreaker after clinical score, GDMT completeness, and raw score. | ranking comparator / memory | Affordability matters, but should not override clinically meaningful benefit. | Value-based care principle. | Expert heuristic | Final tiebreaker only; over-budget fallback shows best near-affordable option with warning. | Undertreatment due cost or unaffordable recommendations framed as complete. |
| HF-SCORE-004 | Budget-constrained outputs require “best affordable interim option” framing, not “complete GDMT.” | README/FAQ/results copy | Financial barriers should trigger shared decision-making and assistance, not re-label incomplete care as optimal. | Health-equity/value-care consensus. | Expert governance | Language requirement; not a numeric rule. | Misleading constrained fallback as guideline-concordant care. |
| HF-SCORE-005 | Special-feature bonuses distinguish outcome-level effects from intra-class tolerability tiebreakers. | medication constants / scoring | Outcome benefits should dominate cosmetic/tolerability preferences. | Trial endpoint hierarchy. | Expert heuristic | Feature points require governance; tolerability tiebreakers should remain small. | Single low-value feature can overpower GDMT. |

## Validation coverage vs evidence adequacy

Current scenario harnesses verify implementation invariants such as safety floors, contraindication behavior, duplicate removal, DDI warnings, Furoscix safety, and expected scenario outputs. Passing CI is necessary but not sufficient for clinical validity.

Recommended future CI enhancement: fail when a new clinical rule, warning prefix, score domain, or threshold is added without a corresponding `HF-*` rule ID entry in this matrix.
