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
                         #   (currently: Passed 106 = 105 clinical scenarios + 1 structural pricing invariant)
npm run test             # alias for verify
npm run audit:red        # adversarial red-team probes (standalone QA, not in CI)
npm run audit:mistakes   # 51-scenario treatment-error audit (standalone QA, not in CI)
npm run audit:hundred    # 100-scenario broad clinical audit (standalone QA, not in CI)
npm run ci               # typecheck + build + verify
npm run preview          # preview production build
```

There is no `lint` script (a misleading one was removed 2026-07-05).

CI workflow: `.github/workflows/ci.yml` runs `npm ci -> typecheck -> build -> verify`.

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
    simulationService.ts          # core clinical engine
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

## Seven-Domain Scoring

Weighted overall score:

- Neurohormonal: 20%
- Functional: 15%
- Volume: 15%
- Structure: 10%
- Cost: 15%
- Adherence: 10%
- Guideline concordance: 15%

Guideline domain behavior:

- HFrEF (`LVEF <= 40`): quad pillars (RAAS, BB, MRA, SGLT2i)
- HFmrEF (`41-49`): weighted hybrid scoring
- HFpEF (`>= 50`): SGLT2i-first pathway with adjunct logic
- HFimpEF preservation: continue full HFrEF logic when prior reduced EF is known or strongly suspected

GDMT-completeness bonus (anti-softness):

- Additive bonus up to +30 = `30 × (achievable indicated therapies present / achievable total)`.
- Slots = phenotype pillars + eligible disease-modifying adjuncts (GLP-1, H/ISDN [reduced-EF only], ivabradine, vericiguat, IV iron) derived from `analysis.addableAdjuncts`.
- "Achievable" excludes therapies filtered out of the formulary (never penalize a contraindicated therapy). Applied before SBP/K+ penalties so safety still overrides.
- Stored as `gdmt_completeness` (0-1); display ranks by score → completeness → uncapped `raw_score` → **cost (final tiebreaker)**. Cost decides last so it never overrides an evidence-based preference, but among clinically-indistinguishable regimens the cheaper one wins (maximize health benefit per dollar). The over-budget fallback surfaces the cheapest candidates ordered by this same value-first key (best near-affordable option leads, not the absolute cheapest).
- Special-feature `points` calibration: outcome-level benefits are large (A-HeFT 30, FINEARTS 45, obesity 50-60, iron 40, DIAMOND/HARMONIZE binders 50, TOPCAT HFpEF 18) while intra-class tolerability tiebreakers are small (eplerenone "no gynecomastia" 3). A tolerability footnote must not lift a single-pillar regimen above multi-pillar GDMT (the SF-bonus normalization `/regimenLength * 3` otherwise amplifies a lone special drug to the +15 cap).
- Projected-SBP ranking penalty recalibrated to trial tolerability (`<90 → -25`, `<95 → -8`) so disease-modifying therapy is not out-ranked by hemodynamically-inert drugs; hard gates (input `<90`, display `<85`) unchanged.

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
  - nitrate (H/ISDN) is contraindicated with confirmed PDE5 inhibitor exposure (Sildenafil/Tadalafil in external medications) — excluded from formulary and force-removed from arriving regimens
- Pregnancy safety:
  - excludes RAAS classes, MRAs/nsMRA, SGLT2i, Vericiguat (FDA boxed warning — embryo-fetal toxicity), Ivabradine (fetal harm), and GLP-1 therapy
  - H/ISDN deliberately remains pregnancy-appropriate (the RAAS alternative for pregnant HFrEF)
- Initiation-vs-continuation carve-outs (the `alreadyOn*` pattern):
  - Vericiguat: VICTORIA enrollment criteria (NT-proBNP >= 1600, NYHA II-IV, recent worsening, LVEF < 45) gate INITIATION only — a patient already on vericiguat is never force-removed for improved markers; pregnancy still forces removal
  - GLP-1: `BMI >= 30` gates INITIATION only; continuation is blocked only by true safety CIs (pregnancy, MTC/MEN2) — weight-loss success never forces removal
  - SGLT2i eGFR floor and ivabradine HR thresholds follow the same pattern (initiation HR >= 70; continuation stopped only below 50)
- Current-regimen history checks:
  - a current med matching a documented ALLERGY by name is flagged and force-swapped to a tolerated same-group agent (else removed) — it is never kept or up-titrated
  - a current med appearing in the discontinued list raises a MEDICATION HISTORY CONFLICT alert (verify deliberate restart) rather than forced removal
- Acute decompensation handling (two-tier beta-blocker logic):
  - blocks beta-blocker initiation (warm OR cold)
  - defers beta-blocker UP-TITRATION in ANY acute decompensation (warm or cold) — continue the current dose and diurese; up-titrate after euvolemia
  - forces existing beta-blocker dose REDUCTION only with hypoperfusion ("cold-and-wet": cool extremities, SBP < 90, or pulse pressure ≤ 25) — the cut is ONE dose step down (~50%, e.g. carvedilol 25 → 12.5), not a jump to the lowest tier; warm-and-wet continues the beta-blocker and diureses
  - safe guideline ADDITIONS (esp. SGLT2i — beneficial in acute HF, EMPULSE/SOLOIST) are force-injected alongside any mandated BB reduction so decompensation never suppresses gap-closing therapy
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

Furoscix is modeled as:

- medication name: `Furoscix (SC Furosemide)`
- class: `Loop Diuretic`
- dose: `80 mg/10mL SQ on-body infusor (5h)` (single modeled tier)

Behavioral integration:

- prioritized in worsening-congestion loop escalation pathways
- eligibility tied to active congestion/escalation context
- contraindication checks include:
  - insufficient congestion context
  - `eGFR < 15`
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

- GLP-1 `chf_effects` are dose-scaled like every other titratable class (ratio to target dose, floor 0.25): semaglutide `d/2.4`, tirzepatide `d/15` — a starting-dose add is no longer credited the full STEP-HFpEF/SUMMIT steady-state benefit. Eplerenone is similarly dose-scaled (`d/50`), matching spironolactone.
- Loop diuretic weight-loss curves are calibrated to documented dose-response anchors via `log2` ceiling curves: furosemide `1.5 + 0.9*log2(d/20)` (~1.5/2.4/3.3/4.2 kg at 20/40/80/160 mg); torsemide `1.8 + 0.96*log2(d/10)` (~1.8/2.8/4.0/5.0 kg at 10/20/50/100 mg); bumetanide inherits the furosemide curve via 40:1 equivalence; Furoscix uses the calibrated curve on a bioavailability-adjusted oral equivalent (~15% above oral at the labeled 80 mg).
- The `renal_adjustment` contract is fully honored by the engine: `contraindicated: true` excludes exactly like `contraindications()` (formulary filter + current-med audit); `caution: true` surfaces as a "Renal dosing review" monitoring-plan item (not a ranking-penalized warning); `start_dose_modifier` surfaces as a "Reduced starting dose (renal)" monitoring item for adds.

## Verification Harness

`scripts/verifyScenarios.ts` executes scenario assertions against `data/scenarios.ts`.

Current regression scope (the harness's printed count is authoritative — currently `Passed: 106`):

- 105 clinical scenarios + 1 structural invariant (every formulary med must have a `DRUG_PRICES` entry)
- safety invariants (dual-class prevention, score bounds, display floors)
- contraindication logic
- phenotype-specific recommendations
- warning and alert expectations
- Furoscix candidate + allergy guardrail checks

This harness is the primary safety regression gate for logic edits. The three standalone audit
harnesses (`audit:red`, `audit:mistakes`, `audit:hundred` — see Commands) are deliberately outside
CI but are part of the full pre-release gate.

## Development Rules of Thumb

### If you add or change medications

Update:

1. `constants.ts` (formulary object)
2. optional pricing logic in `services/pricingService.ts`
3. scenario coverage in `data/scenarios.ts`
4. verification assertions in `scripts/verifyScenarios.ts`

### If you change clinical logic or thresholds

Update:

1. `services/simulationService.ts`
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
