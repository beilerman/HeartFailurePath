# CLAUDE.md - HeartFailurePath

Heart failure clinical decision-support simulation tool. Vite + React + TypeScript.

GitHub: `beilerman/HeartFailurePath` (public)  
Deployment target: Vercel (main branch auto-deploy)

## Commands

```bash
npm install          # install dependencies
npm run dev          # start Vite dev server (default 3000)
npm run build        # production build
npm run typecheck    # TypeScript check only
npm run verify       # run scenario assertion harness (90 scenarios)
npm run test         # alias for verify
npm run ci           # typecheck + build + verify
npm run preview      # preview production build
```

CI workflow: `.github/workflows/ci.yml` runs `npm ci -> typecheck -> build -> verify`.

## Repository Layout

All source files live at project root (no `src/` directory).

```text
HeartFailurePath/
  App.tsx                         # top-level app shell + tabs
  index.tsx                       # React entry point
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
    pricingService.ts             # mock pricing source
  data/
    scenarios.ts                  # scenario fixtures and clone helper
  scripts/
    verifyScenarios.ts            # scenario verification harness
```

## Core Clinical Engine

Primary entry point:

```ts
generateAndScoreModifications(patient, availableMedNames, prices)
```

Output contract:

- `scoredRegimens` (up to 3 display candidates)
- `excludedMedications`
- `clinicalAlerts`
- `monitoringPlan`

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
  - projected `K+ > 6.0` excluded from display
  - K+ binder rescue counts as a residual-risk warning penalty (rescue enables consideration, never erases risk in ranking)
- Drug-interaction hard gates:
  - nitrate (H/ISDN) is contraindicated with confirmed PDE5 inhibitor exposure (Sildenafil/Tadalafil in external medications) — excluded from formulary and force-removed from arriving regimens
- Pregnancy safety:
  - excludes RAAS classes, MRAs/nsMRA, and SGLT2i
- Acute decompensation handling:
  - blocks beta-blocker initiation (warm OR cold)
  - forces existing beta-blocker dose REDUCTION only with hypoperfusion ("cold-and-wet": cool extremities, SBP < 90, or pulse pressure ≤ 25); warm-and-wet continues the beta-blocker and diureses
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

## Verification Harness

`scripts/verifyScenarios.ts` executes scenario assertions against `data/scenarios.ts`.

Current regression scope:

- 90 scenarios
- safety invariants (dual-class prevention, score bounds, display floors)
- contraindication logic
- phenotype-specific recommendations
- warning and alert expectations
- Furoscix candidate + allergy guardrail checks

This harness is the primary safety regression gate for logic edits.

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

- Preserve `Set` fields when cloning patient objects.
- Medication name matching is exact-string sensitive in seeded scenarios.
- `max_new_classes_per_visit` counts class-group additions, not dose changes.
- Do not rely on top-3 regimen presence for adjunct assertions; some checks must use exclusion/eligibility logic.
- Keep path alias assumptions consistent: `@/` resolves to repository root.

## Clinical Use Guardrail

This codebase is intended for CDS simulation/prototyping and requires prospective validation, governance, and regulatory/legal review before any real-world clinical deployment.
