# CLAUDE.md - HeartFailurePath

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
                         #   (currently: Passed 353 on 2026-11-12; the printed count is authoritative)
npm run test             # alias for verify
npm run audit:red        # adversarial red-team probes (standalone QA, not in CI)
npm run audit:mistakes   # 51-scenario treatment-error audit (standalone QA, not in CI)
npm run audit:hundred    # 100-scenario broad clinical audit (standalone QA, not in CI)
npm run golden           # golden master: every scenario x 3 insurance tiers (999 runs) must be byte-identical
npm run golden:update    # rewrite the golden snapshot after an intended output change (review `npm run ranking:diff` first)
npm run ranking:diff     # compare the current engine with the golden snapshot; reports ranking changes
npm run fuzz             # seeded randomized-patient sweep (5,000 patients): safety invariants written independently of the engine + consistency checks (regimen order, ranking mode / care priority change ordering only, lower-case allergy still excludes). Part of gate and ci
npm run gate             # typecheck + golden + verify + all three audits + fuzz (full pre-release gate)
npm run ci               # typecheck + build + golden + verify + fuzz
npm run preview          # preview production build
```

There is no `lint` script (a misleading one was removed 2026-07-05).

CI workflow: `.github/workflows/ci.yml` runs `npm ci -> typecheck -> build -> golden -> verify` (the workflow file does not yet have a `fuzz` step; `npm run ci` does).

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
    simulationService.ts          # public facade: 55-line staged orchestrator + re-exports
    engine/                       # the engine, one module per stage (see docs/scoring-architecture.md):
                                  #   gates, eligibility (rules E01-E19), candidates, effects, domains,
                                  #   scoreModel (weights + adjustments as data), scoring, selection,
                                  #   explain, registry, intolerance, regimenUtils, drugFacts
    clinicalPredicates.ts         # shared predicates (valueUnknown, hasHistoricalHFrEF,
                                  #   isIronDeficient, isBlackRace) — single source for
                                  #   engine AND formulary
    pricingService.ts             # mock pricing source (insurance-tiered)
  data/
    scenarios.ts                  # scenario fixtures; re-exports clonePatient
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

## Scoring Model (weighted sum, 2026-11-10)

Full description: `docs/scoring-architecture.md`. All numbers live in `services/engine/scoreModel.ts`.

- Score = Σ (eight factor scores, each 0-100) × weights that sum to 100%, plus named adjustments.
- Balanced weights: Neurohormonal 15, Functional 12, Volume 12, Structure 8 (clinical outcomes);
  Guideline concordance 12, Therapy completeness 22 (guideline-directed therapy); Cost 12,
  Adherence 7 (patient values).
- `patient.care_priority` ("What matters most to this patient?") selects the weight row:
  `default` (Balanced), `outcomes_first`, `cost_first`, `simplicity_first`. It changes ONLY the eight
  weights — never eligibility, alerts, adjustments, display floors or the budget filter (verify
  enforces this for every scenario × profile). The non-default rows are a first calibration, not
  yet clinically reviewed.
- Adjustments (visible ledger lines): patient-specific evidence bonus `clamp(sum/len × 2.3, −8, +12)`;
  volume-depletion de-escalation +15; projected SBP < 90 −20, < 95 −6, < 85 sets the score to 0;
  projected HR < 50 −40; projected K+ > 5.5 −40; −8 per residual-risk warning; unknown eGFR −12
  (`UNKNOWN_RENAL`, only when an SGLT2 inhibitor is started or increased); low-output cap 25.
  There is NO unknown-potassium deduction (`UNKNOWN_POTASSIUM` removed 2026-11-11): see rule E16 below.
- Ranking (Balanced, the default): displayed score → therapy completeness → unrounded score → cost. The completeness
  tie-break is deliberate (anti-softness): a fraction of a point must not drop a guideline pillar.
- **Ranking mode** (`patient.ranking_mode`, owner decision 2026-11-11; missing = `balanced`; the form's "Ranking approach"):
  `foundational_first` applies to HFrEF/HFimpEF only and changes ONLY the order, never scores, exclusions, alerts, the
  budget filter or display floors (verify enforces it). Order: (a) regimens that do not push SBP, HR or K+ into a severe
  projected range the harmful way from baseline first (`PROJECTED_SBP_LT_85/_LT_90`, `_HR_LT_50`, `_K_GT_5_5`);
  (b) higher `foundational_coverage` (RAAS, beta-blocker, MRA, SGLT2i slots; 1.0 at target, 0.6 at the starting tier rising to 1.0 at target (0.6 if no numeric target); explanation-only,
  never scored); (c) the Balanced order. `SimulationOutput.ranking` reports mode, whether it applied and what Balanced would
  have led with. It is separate from `care_priority`, which changes the weights. Known limit: a fully dosed single pillar
  outranks a different pillar at starting dose.
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
  - K+ binder rescue (reactive, projected K+ above 5.3; attached only when every potassium-raising class in the candidate was already on the current regimen AND the candidate keeps, up-titrates or within-class-swaps a RAAS-pool drug or MRA/nsMRA from the current regimen (`keepsCurrentPotassiumRaiser`; a candidate with none, e.g. a new beta-blocker start, gets no binder and is scored on its own projected potassium; 2026-11-11 final pass), so never a co-start with a new MRA or RAAS inhibitor; a candidate needing a binder for a NEW class is dropped) counts as a residual-risk warning penalty (rescue enables consideration, never erases risk in ranking)
- Blank-data (sentinel) safety:
  - eGFR/creatinine or K+ of 0/blank = "not entered", never a value: it must never clear a safety gate AND never read as end-stage disease
  - blank renal data: current renal-gated meds are RETAINED (not force-removed); renal-gated new starts are excluded with reason "Renal data required — cannot assess renal safety (obtain BMP before initiation)"; candidates intensifying RAAS/MRA/SGLT2i carry a RENAL FUNCTION UNKNOWN warning + -15 penalty; renal-threshold warnings (eGFR<20 loop alert, Furoscix CKD caution, digoxin renal note) are suppressed
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
  - every ACEi/ARB/ARNI declares `start_dose_for` (new starts begin at the lowest tier; the ARNI uses `facts.start_dose_exact`: 24/26 mg bid when not on an ACEi/ARB or on a low dose (`facts.low_dose_max_daily_mg`), eGFR < 30/blank, or Child-Pugh B; otherwise 49/51; 97/103 only by titration) and verify fails any RAAS add/swap-in above it (root cause of the old "Add 97/103" bug: `restrictToStartTiers` passed through any drug without the hook)
  - hepatic: "Liver Disease (Child-Pugh B/C)" excludes the ARNI (severity unknown); the extra option "Liver Disease: Child-Pugh B confirmed (not C)" lifts it with a reduced start; all other liver-gated drugs treat either option as liver disease (`hasChildPughBorC`)
  - aliskiren + diabetes contraindicates ARNI/ACEi/ARB (`CI_ALISKIREN_DIABETES`); 36-hour washout warns in both directions (ACEi<->ARNI); ARNI start at SBP < 100 carries a score-penalized caution
  - lisinopril/enalapril/losartan/candesartan have no renal max-dose caps (valsartan 80 mg and ramipril caps kept); losartan 100 and 150 mg are targets
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

Current regression scope (the harness's printed count is authoritative — on 2026-11-12 `Passed: 353`):

- 333 clinical scenarios + 20 structural checks (the ranking mode changes order only; every med has a `DRUG_PRICES` entry; every `score_breakdown` reconciles to `raw_score`; every exclusion carries a known eligibility `rule_id`; no formulary drug name appears as a literal in engine code; no `services/engine/` module imports the facade; every weight profile sums to 100%; weight profiles never change exclusions/alerts/safety floors; profile direction checks; contraindication checks equal the boolean; every E13 exclusion states why; no new MRA start above potassium 5.0 (with or without a binder); monitoring timings follow the sources; every standing loop declares a furosemide equivalence; no new start above the declared starting dose; no regimen above a declared maximum daily dose; a congested patient with a possible loop increase is shown one; below-target dose credit is graded; no displayed titrate-up more than doubles the total daily dose except the adjacent tier (`UP_TITRATION_MAX_DAILY_FACTOR`; sourced for RAAS/BB/MRA by ESC 2026 S4-S6/S8, engine policy for loops and others); a one-step titration always exists unless a rule blocks it)
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
- **Scoring**: the projected SBP 90/95 and HR below 50 bands read the LOWER of projected and entered value; penalized warnings already true of the current regimen (`baselineDangerWarnings`, `scoring.ts`) are charged to every option so none beats "no change" by cutting a drug; quadruple-therapy synergy is reduced-EF only; KCCQ is clamped to 0-100.
- **Selection** (`selection.ts`): BP and HR display floors apply only when the regimen moves the value the wrong way from baseline (potassium floor stays absolute); the NO DISPLAY-SAFE alert names the floor; ties break alphabetically and projected SBP/HR/K+ are rounded to 2 decimals (the answer must not depend on typing order); in the over-budget fallback the safety floors come before the five cheapest and a 0-scored option is not shown merely for being cheap; the automatic IV iron add-on is dropped when it alone would exceed budget.
- **Rescue binder**: patiromer is auto-added at its label starting dose only (`facts.rescue_role.max_rescue_dose` 8.4 g daily).
- **Inputs** (`gates.ts` `auditInputs`): NaN, undefined or negative numbers become 0 ("not entered"); blank systolic BP, current weight or dry weight stops the run with a DATA REQUIRED alert naming the field; a duplicate current drug keeps the higher dose and says so. With heart rate not entered a beta-blocker or ivabradine is neither started nor increased.
- **Allergies** (`allergy.ts`, `facts.allergy_aliases`): free text resolves to formulary drugs ignoring case and spacing, by generic, brand or class name; an entry matching nothing raises an ALLERGY NOTE and the form shows what each entry excludes. A new drug must add its brand names to `ALLERGY_ALIASES_BY_DRUG` in `constants.ts`. Pregnancy: a non-selective beta-blocker that cannot be switched is kept, never increased.
- **UI**: Re-run obeys form validation; Copy and Print are disabled while results are stale; the results pane has its own error boundary; the low-output hint uses the engine's two-of-three rule; the potassium hint covers 5.2, 6.0 and 6.5.

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
