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
                         #   (currently: Passed 248 (scenario count + structural invariants; the printed count is authoritative))
npm run test             # alias for verify
npm run audit:red        # adversarial red-team probes (standalone QA, not in CI)
npm run audit:mistakes   # 51-scenario treatment-error audit (standalone QA, not in CI)
npm run audit:hundred    # 100-scenario broad clinical audit (standalone QA, not in CI)
npm run golden           # golden master: every scenario x 3 insurance tiers (705 runs) must be byte-identical
npm run gate             # typecheck + golden + verify + all three audits (full pre-release gate)
npm run ci               # typecheck + build + golden + verify
npm run preview          # preview production build
```

There is no `lint` script (a misleading one was removed 2026-07-05).

CI workflow: `.github/workflows/ci.yml` runs `npm ci -> typecheck -> build -> golden -> verify`.

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
    simulationService.ts          # public facade: 45-line staged orchestrator + re-exports
    engine/                       # the engine, one module per stage (see docs/scoring-architecture.md):
                                  #   gates, eligibility (rules E01-E15), candidates, effects, domains,
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
  projected HR < 50 −40; projected K+ > 5.5 −40; −8 per residual-risk warning; unknown K+ / eGFR
  −12 each; low-output cap 25.
- Ranking: displayed score → therapy completeness → unrounded score → cost. The completeness
  tie-break is deliberate (anti-softness): a fraction of a point must not drop a guideline pillar.
- Therapy completeness = achievable indicated therapies present / achievable total (pillars +
  eligible adjuncts; 60% credit below target dose). "Achievable" excludes therapies filtered out
  of the formulary — never penalize a contraindicated therapy.
- Special-feature `points` calibration: outcome-level benefits are large (A-HeFT 60, FINEARTS 45,
  GLP-1 40 (both agents), iron 40 (20 at LVEF 41-49), binders 50, TOPCAT HFpEF 18); intra-class tolerability tiebreakers are
  small (eplerenone "no gynecomastia" 3). The `/regimenLength` normalization amplifies a lone
  special drug, so a tolerability footnote must stay small.
- Scores before and after 2026-11-10 are not comparable (the old scale had 30 points of headroom
  and clamped at 100).

Guideline domain behavior:

- HFrEF (`LVEF <= 40`): quad pillars (RAAS, BB, MRA, SGLT2i)
- HFmrEF (`41-49`): weighted hybrid scoring
- HFpEF (`>= 50`): SGLT2i-first pathway with adjunct logic
- HFimpEF preservation: continue full HFrEF logic when prior reduced EF is known or strongly suspected

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
  - hyperkalemic-emergency gate: baseline `K+ >= 6.0` fires a HYPERKALEMIC EMERGENCY alert (ECG, urgent treatment); `K+ >= 6.5` returns alerts only (parallel to the SBP < 90 gate); `K+ > 8.0` hard-stops as implausible
  - projected `K+ > 6.0` excluded from display
  - K+ binder rescue counts as a residual-risk warning penalty (rescue enables consideration, never erases risk in ranking)
- Blank-data (sentinel) safety:
  - eGFR/creatinine or K+ of 0/blank = "not entered", never a value: it must never clear a safety gate AND never read as end-stage disease
  - blank renal data: current renal-gated meds are RETAINED (not force-removed); renal-gated new starts are excluded with reason "Renal data required — cannot assess renal safety (obtain BMP before initiation)"; candidates intensifying RAAS/MRA/SGLT2i carry a RENAL FUNCTION UNKNOWN warning + -15 penalty; renal-threshold warnings (eGFR<20 loop alert, Furoscix CKD caution, digoxin renal note) are suppressed
  - blank potassium: projected K+ preserves the unknown sentinel; hypo-/hyperkalemia warning bands, the digoxin K-band warning, and DDI-3's interpolated K+ are suppressed (prompts for a BMP instead); digoxin's K+ < 3.5 contraindication has a > 0 guard
- Drug-interaction hard gates:
  - nitrate (H/ISDN) is contraindicated with confirmed PDE5 inhibitor exposure (Sildenafil/Tadalafil/Vardenafil/Avanafil in external medications) or riociguat — excluded from formulary and force-removed from arriving regimens
- Pregnancy safety:
  - excludes RAAS classes, MRAs/nsMRA, SGLT2i, Vericiguat (FDA boxed warning — embryo-fetal toxicity), Ivabradine (fetal harm), and GLP-1 therapy
  - H/ISDN deliberately remains pregnancy-appropriate (the RAAS alternative for pregnant HFrEF)
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
  - new MRA starts: K+ > 5.5 is a contraindication (initiation only, `mraStartPotassiumCheck`); K+ 5.0-5.5 only with a K+ binder in the same option (DIAMOND pathway) plus the "start the binder first" sequencing warning; rule E15 withholds a new MRA above K+ 5.0 when no binder can be offered
  - continuation: `facts.k_continuation` on spironolactone/eplerenone/finerenone: K+ 5.5-5.9 forces a ONE-STEP reduction (withhold at the lowest dose), K+ >= 6.0 withholds (removal); restart low once K+ < 5.5
  - eplerenone/finerenone contraindicated with strong CYP3A inhibitors (`STRONG_CYP3A_INHIBITORS`); eplerenone capped at 25 mg with a moderate inhibitor (`interaction_dose_cap`) and contraindicated at eGFR <= 30; finerenone/spironolactone contraindicated in adrenal insufficiency
  - `Medication.start_dose_for(patient)` is the opt-in per-drug cap on the dose a NEW START may begin at (finerenone 10/20 mg by eGFR, spironolactone 12.5/25 mg by eGFR); finerenone's target comes from `is_target_dose_for` (20 mg if eGFR < 60, else 40 mg)
  - binders: prevention potassium effects (patiromer -0.1; Lokelma -0.3/-0.6/-0.7 at 5/10/15 g), tried lowest dose first across binders; the "+50 enables RAAS/MRA" bonus needs a RAASi/MRA in the regimen; drug-data warnings/monitoring come from `facts.regimen_warnings` / `facts.monitoring_items` (warning text starts "Drug note" and is not score-penalized)
- RAAS rules (2026-11-10, `docs/medication-review-2026-11-10/verified-raas.md`):
  - every ACEi/ARB/ARNI declares `start_dose_for` (new starts begin at the lowest tier; the ARNI uses `facts.start_dose_exact`: 24/26 mg bid when not on an ACEi/ARB or on a low dose (`facts.low_dose_max_daily_mg`), eGFR < 30/blank, or Child-Pugh B; otherwise 49/51; 97/103 only by titration) and verify fails any RAAS add/swap-in above it (root cause of the old "Add 97/103" bug: `restrictToStartTiers` passed through any drug without the hook)
  - hepatic: "Liver Disease (Child-Pugh B/C)" excludes the ARNI (severity unknown); the extra option "Liver Disease: Child-Pugh B confirmed (not C)" lifts it with a reduced start; all other liver-gated drugs treat either option as liver disease (`hasChildPughBorC`)
  - aliskiren + diabetes contraindicates ARNI/ACEi/ARB (`CI_ALISKIREN_DIABETES`); 36-hour washout warns in both directions (ACEi<->ARNI); ARNI start at SBP < 100 carries a score-penalized caution
  - lisinopril/enalapril/losartan/candesartan have no renal max-dose caps (valsartan 80 mg and ramipril caps kept); losartan 100 and 150 mg are targets
  - generic sacubitril/valsartan pricing (cash ~$60 with a discount card)
- Rate-control rules (2026-11-10, `docs/medication-review-2026-11-10/verified-rate-control.md`):
  - `facts.hr_continuation` (`hrContinuationAction` in `regimenUtils.ts`): HR below `reduce_below` on an established beta-blocker/ivabradine forces a ONE-STEP reduction via `forcedReduceNames` (exact next-lower strength on the full ladder, `forcedReduceExactStep`), withhold at the lowest dose; no up-titration below `no_uptitration_below`; skipped in a "Paced" rhythm; alert `BRADYCARDIA ON <DRUG>` from `gates.ts`. Beta-blockers: 55/60 (carvedilol 55 is the label's; the rest is engine policy). Ivabradine: 50/61 (label)
  - beta-blocker NEW-start block below HR 55 is initiation-only (`bbStartBradycardiaCheck`, engine policy); AV block 2/3 and sick sinus syndrome without a pacemaker (`SICK_SINUS` comorbidity) still force removal
  - carvedilol effect ratio capped at 25 mg bid; carvedilol/metoprolol/bisoprolol equal at target (lvef 9, NT-proBNP -22%, KCCQ 6, LVEDD -10%, structure 35); carvedilol hepatic CI only for unspecified B/C (B confirmed = caution); metoprolol has no hepatic CI; bisoprolol tiers 2.5/5/10 (1.25 dropped, US strengths)
  - ivabradine: label contraindications in `constants.ts`, exact start tier via `start_dose_for` (2.5 mg for conduction defect / amiodarone / digoxin, else 5), "maximally tolerated" beta-blocker in `candidates.ts` (`bbMaxTolerated`), HR >= 70 is initiation only (bonus kept while on the drug)
  - digoxin: indication gate in `candidates.ts` (sinus: LVEF <= 40, NYHA III-IV, no addable/below-target pillar; AFib: beta-blocker optimized); VF is the CI; WPW, K+ > 5.5, eGFR < 15 are penalized warnings; `facts.hr_effect_only_in_rhythm: 'AFib'`; NT-proBNP effect 0
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

Current regression scope (the harness's printed count is authoritative — on 2026-11-10 `Passed: 248`):

- 235 clinical scenarios + 13 structural invariants (every med has a `DRUG_PRICES` entry; every `score_breakdown` reconciles to `raw_score`; every exclusion carries a known eligibility `rule_id`; no formulary drug name appears as a literal in engine code; no `services/engine/` module imports the facade; every weight profile sums to 100%; weight profiles never change exclusions/alerts/safety floors; profile direction checks; contraindication checks equal the boolean; every E13 exclusion states why; no MRA start above potassium 5.0 without a binder; no new start above the declared starting dose; no regimen above a declared maximum daily dose)
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

- **Starting versus continuing.** A threshold that blocks a NEW start must not remove a drug the
  patient already takes. Continuation rules are data on the entry: `facts.k_continuation` (MRAs:
  reduce one step at potassium 5.5-5.9, withhold at 6.0), `facts.hr_continuation` (ivabradine),
  beta-blockers reduce one step below heart rate 55 and are removed only for high-grade AV block,
  sick sinus syndrome without a pacemaker, or bradycardia at the lowest dose.
- **New starts use the label starting dose.** Declare `start_dose_for(patient)` (a ceiling) and, when
  the label gives one exact start, `facts.start_dose_exact`. Higher tiers are reached by titration.
  `facts.titrate_one_step` forbids skipping tiers (GLP-1 drugs).
- **Daily dose.** Loop effects, the high-dose alert and `facts.max_daily_dose` use total daily dose
  (`dailyDose` in `regimenUtils.ts`), never the per-dose strength.
- **Effects are treatment effects.** Use the placebo-adjusted trial difference, not the active-arm
  change (the GLP-1 quality-of-life values were corrected for this).
- **An MRA is not started above potassium 5.0 unless a binder is projected to hold potassium within
  3.5-5.3**; otherwise the candidate is dropped. Patiromer is the preferred binder in heart failure
  (Lokelma carries a sodium load; automatic rescue is capped at 10 g).
- **Furoscix is a short-course add-on** beside an oral loop, never a standing replacement.
- **Sourced versus policy.** A number with no primary source is marked "engine policy" or
  "assumption" in its code comment and in the evidence matrix. Do not present policy as evidence.
- Unverified findings were NOT changed. They are listed for physician review in
  `docs/medication-review-2026-11-10/README.md`.

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
