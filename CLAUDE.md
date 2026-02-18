# CLAUDE.md — HeartFailurePath

Heart failure (CHF) clinical decision support tool. Vite + React + TypeScript.

**GitHub:** `beilerman/HeartFailurePath` (public)
**Deployment:** Vercel (auto-deploy from main)

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start Vite dev server (port 3000)
npm run build        # Production build (also validates TypeScript)
npm run typecheck    # TypeScript check only (tsc --noEmit)
npm run verify       # Run 26 clinical scenario assertions
npm run test         # Alias for verify
npm run ci           # Full pipeline: typecheck + build + verify
npm run preview      # Preview production build
```

**CI:** GitHub Actions (`ci.yml`) runs typecheck → build → verify on every push/PR.

## Architecture

Source files live directly at root (no `src/` directory).

```
HeartFailurePath/
├── App.tsx                    # Main component, 3 tabs (Simulation/Formulary/Logic), state
├── index.tsx                  # React entry point, ErrorBoundary wrapper
├── types.ts                   # All TypeScript interfaces (Patient, Medication, ScoredRegimen, etc.)
├── constants.ts               # MEDICATION_FORMULARY (21 drugs, ~630 lines)
├── components/
│   ├── PatientForm.tsx        # Input form orchestrator
│   ├── patient-form/          # Form sub-sections:
│   │   ├── Common.tsx         #   Input/Select helpers (auto-generate id from name)
│   │   ├── DemographicsSection.tsx
│   │   ├── DiagnosticsSection.tsx   # LVEF, LVEDD, LAVI, BNP, labs
│   │   ├── HistorySection.tsx       # Comorbidities, allergies, intolerances
│   │   ├── MedicationManager.tsx    # Current regimen editor
│   │   ├── PhysicalExamSection.tsx  # Exam findings (edema, JVP, orthopnea)
│   │   ├── SocialSection.tsx        # Budget, cost/complexity tolerance, pregnancy
│   │   └── SymptomsSection.tsx      # NYHA class
│   ├── ResultsDisplay.tsx     # Results container with loading/error states
│   ├── RecommendationCard.tsx # Regimen card: change banner, domain scores, med pills
│   ├── ScoreDetailModal.tsx   # Domain score drill-down (focus trap, Escape, ARIA)
│   ├── ClinicalSummary.tsx    # Side panel: 6-domain patient status
│   ├── MedicationLibrary.tsx  # Formulary browser tab
│   ├── FAQ.tsx                # Logic documentation tab
│   ├── ErrorBoundary.tsx      # Class component (React requirement)
│   └── icons.tsx              # SVG icon components with IconProps
├── services/
│   ├── simulationService.ts   # Core clinical engine (~1600 lines, deterministic, pure)
│   └── pricingService.ts      # Drug pricing (mocked)
├── data/
│   └── scenarios.ts           # 26 test scenarios, INITIAL_PATIENT, clonePatient()
└── scripts/
    └── verifyScenarios.ts     # Automated scenario verification (assertions)
```

**Key separation:** UI in `components/`, domain logic in `services/`, data in `constants.ts` and `data/`.

## Critical Patterns

### Patient Data Uses Sets, Not Arrays
```typescript
// CORRECT - comorbidities and exam_findings are Set<string>
patient.comorbidities = new Set(['diabetes', 'ckd']);
patient.volume_status.exam_findings = new Set(['elevated_jvp']);

// Use clonePatient() to preserve Sets when copying
import { clonePatient } from './data/scenarios';
const newPatient = clonePatient(existingPatient);
```

### Simulation Engine (Delta-Based)
`services/simulationService.ts` (~1600 lines) must remain deterministic with no side effects. The single entry point is `generateAndScoreModifications(patient, currentRegimen)` which returns `{ scoredRegimens, excludedMedications, clinicalAlerts }`.

**Delta engine:** Generates modification sets (add, titrate_up, titrate_down, swap, remove, keep) from the current regimen. `simulateModificationEffect()` applies only the marginal delta from changed meds — existing meds' effects are already baked into the patient's observed state.

**7-domain scoring** (weighted): Neuro 20% | Func 15% | Vol 15% | Struct 10% | Cost 15% | Adhere 10% | Guideline 15%

**3-tier HF phenotype** affects all scoring: HFrEF (LVEF ≤ 40), HFmrEF (41-49), HFpEF (≥ 50). HFpEF only gets SGLT2i + adjuncts. HFimpEF (previous_lvef ≤ 40, current > 40) scores as HFrEF.

**Key physiological models:**
- BNP reduction: multiplicative (retention factor), not additive — each drug compounds independently
- LVEF attenuation: exponential diminishing returns, cap 55%
- DBP coupling: drug-class-specific ratios (vasodilators 0.5, BB 0.7, diuretics 0.5, SGLT2i 0.4)

**Clinical gates (hard blocks):**
- SBP < 85 → no drug recommendations, clinical alerts only
- Pregnancy → RAAS + MRA contraindicated
- Acute decompensation → BB initiation blocked (NYHA IV or NYHA III + fluid > 2kg + ≥ 2 exam findings)
- Ivabradine: HR < 70 blocks initiation; HR < 50 blocks continuation
- Vericiguat: requires NT-proBNP ≥ 1600 AND LVEF < 45
- GLP-1: requires BMI ≥ 30 AND LVEF ≥ 40 (HFpEF/HFmrEF only)

**Rescue mechanisms:** Patiromer auto-appended for K+ > 5.5; IV Iron auto-appended for ferritin < 100 or TSAT < 20.

### Medication Formulary (21 Drugs)
`constants.ts` contains the formulary. Each entry implements `chf_effects()`, `hemodynamic_effects()`, optional `contraindications()`, `renal_adjustment()`, and `special_features`. Drug classes: ARNI, ACEi, ARB (unified RAAS pool), BB (3), MRA (2), SGLT2i (2), GLP-1 (2), Loop Diuretic (2), Vasodilator, If-channel inhibitor, sGC stimulator, K+ binder, IV Iron, Inotrope, Thiazide-like.

## Making Changes

| Change Type | Where to Edit |
|-------------|---------------|
| Add medication | `constants.ts` (formulary), optionally `pricingService.ts` |
| Change clinical logic / scoring | `services/simulationService.ts` |
| Modify patient form | `components/PatientForm.tsx` and `components/patient-form/*` |
| Change Patient model | `types.ts` (interface), `data/scenarios.ts` (defaults), form sections |
| Add/modify result display | `components/RecommendationCard.tsx`, `components/ScoreDetailModal.tsx` |
| Add test scenario | `data/scenarios.ts` (scenario) + `scripts/verifyScenarios.ts` (assertions) |

## Validation

1. `npm run build` — catch TypeScript errors
2. `npm run verify` — run 26 clinical scenario assertions (contraindications, phenotype gating, clinical alerts, medication selection). This is the primary regression check.
3. `npm run ci` — full pipeline (typecheck + build + verify), same as GitHub Actions
4. Manual UI testing: load a scenario (top-left selector), click "Run Analysis", inspect domain scores
5. Add new scenarios to `data/scenarios.ts` + assertions in `scripts/verifyScenarios.ts`

## Gotchas

- **Set preservation:** Don't use spread operator or JSON.parse/stringify on patient objects — use `clonePatient()`
- **BNP is multiplicative:** Each drug's `bnp_reduction_percent` compounds as a retention factor `(1 - pct)`, not added. 0.8 cap in denominators prevents division-by-zero on removal.
- **Synergy timing:** Synergy bonuses only apply when a modification *creates* the condition (e.g., adding BB to RAAS), not when the synergy already exists in the observed patient state.
- **Medical thresholds:** Changes to clinical cutoffs require comment updates and new test scenarios in `verifyScenarios.ts`
- **`renal_adjustment` signature:** `(egfr: number, patient?: Patient)` — the optional `patient` param enables body-weight gating (e.g., Carvedilol 50mg only for > 85kg dry weight)
- **Path alias:** `@/` points to project root (not `src/`)
- **Dev server ports:** Vite defaults to 3000 but auto-increments if occupied (3001, 3002, etc.)
