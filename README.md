<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# HeartFailurePATH

Deterministic heart-failure regimen simulation and ranking UI built with React + Vite + TypeScript.

## Clinical Scope

HeartFailurePATH simulates projected effects of medication changes for adults with chronic heart failure and ranks regimens using a weighted multi-domain model.

- Supports HFrEF, HFmrEF, HFpEF, and HFimpEF preservation logic.
- Includes formulary-level contraindication checks, renal dose constraints, and interaction warnings.
- Supports outpatient loop strategy escalation, including `Furoscix (SC Furosemide)` eligibility and safety messaging.

## Safety Notice

This is a clinical decision support prototype and simulation environment, not an autonomous prescriber.

- It does not replace clinician judgment, patient-specific diagnostics, or local policy.
- It must not be used as the sole basis for treatment decisions.
- It has not been validated as a regulated medical device.

## Key Engine Behavior

### 1) Regimen generation model

- Delta-based engine: only the incremental effect of modifications is simulated.
- Candidate actions: `add`, `titrate_up`, `titrate_down`, `swap`, `remove`, `keep`.
- Distinct output: up to 3 clinically distinct regimens are returned.

### 2) Visit intensification limit

- Default: at most `2` new medication class groups per visit.
- Dose titration and same-group swaps do not consume this limit.
- Configurable in UI: `Social Determinants -> Max New Classes Per Visit`.

### 3) Seven-domain scoring (0-100 each)

Weighted overall score:

- Neurohormonal `20%`
- Functional `15%`
- Volume `15%`
- Structure `10%`
- Cost `15%`
- Adherence `10%`
- Guideline concordance `15%`

### 4) Hard safety gates and output filters

- Input hard stop: `SBP < 90` -> no regimen output, alerts only.
- Input hard stop: physiologically impossible values (e.g. `LVEF > 80`, `K+ > 8`) -> verification alerts only, no recommendations computed on suspect data.
- Display safety filter: excludes regimens with projected `SBP < 85`, `K+ > 6.0`, or `HR < 45`.
- Pregnancy exclusions: RAAS classes, steroidal/non-steroidal MRAs, and SGLT2 inhibitors are excluded.
- Nitrate + PDE5 inhibitor exposure: H/ISDN is hard-excluded from the formulary and force-removed from an arriving regimen (absolute contraindication — fatal hypotension risk).
- Acute decompensation handling: blocks beta-blocker initiation; forces existing beta-blocker dose reduction only with hypoperfusion (cold-and-wet), continues it for warm-and-wet; safe additions (esp. SGLT2i) are still offered alongside any mandated reduction.
- K+ binder rescue carries a residual-risk score penalty: rescue enables consideration (DIAMOND) but never erases the underlying hyperkalemia risk in ranking.

### 5) Furoscix implementation

`Furoscix (SC Furosemide)` is modeled as a loop-diuretic option for worsening congestion contexts.

- Preferred in severe congestion loop-swap/add pathways.
- Contraindicated when escalation context is absent, with severe renal impairment (`eGFR < 15`), or with furosemide/device-material hypersensitivity.
- Adds mandatory regimen warning:
  - `FUROSCIX SAFETY: On-body SQ infusor delivers 80mg over ~5 hours...`
- Additional triage warning appears when hypoxemia suggests possible acute pulmonary edema.

## Verification Strategy

Clinical logic is guarded by scenario-based assertions in `scripts/verifyScenarios.ts`.

- Current scenario set: `81`
- CI command: `npm run ci`
- Verification command: `npm run verify`

Global invariants covered include:

- no dual RAAS overlap
- no dual MRA overlap
- score bounds stay within `0-100`
- display safety floors are respected (projected SBP, K+, and HR)
- no nitrate is ever displayed alongside confirmed PDE5 inhibitor exposure
- implausible inputs hard-stop recommendation generation
- duplicate medications are removed
- key DDI warnings are present when high-risk combinations exist

Furoscix-specific checks include:

- eligible candidate is not incorrectly excluded
- mandatory Furoscix safety warning appears when selected
- furosemide hypersensitivity excludes Furoscix while preserving other loop options

## Requirements

- Node.js `22+`
- npm `10+`

## Local Development

```bash
npm install
npm run dev
```

Default dev host/port: `0.0.0.0:3000` (Vite auto-increments if occupied).

## Commands

```bash
npm run typecheck   # tsc --noEmit
npm run build       # production build
npm run verify      # 71 scenario assertion harness
npm run test        # alias of verify
npm run ci          # typecheck + build + verify
npm run preview     # preview production build
```

## Deployment (Vercel)

Typical production deployment:

1. Import repository in Vercel.
2. Set root directory to the app folder (`HeartFailurePath`) if deploying from monorepo root.
3. Build command: `npm run build`
4. Output directory: `dist`
5. Node runtime: `22.x`

## Project Structure

```text
HeartFailurePath/
  App.tsx
  index.tsx
  constants.ts
  types.ts
  components/
  services/
  data/
  scripts/
```

## Documentation Map

- Developer architecture + implementation guide: `CLAUDE.md`
- Change history: `CHANGELOG.md`
- In-app logic and methodology tab: `components/FAQ.tsx`
- Scenario seeds and fixtures: `data/scenarios.ts`
- Verification assertions: `scripts/verifyScenarios.ts`

## Data Model Note

`Patient` uses `Set<string>` fields (`comorbidities`, `allergies`, `exam_findings`, `external_medications`). Use clone-safe copying logic and avoid JSON serialization when preserving these fields.

## Secrets

Do not ship API keys or model secrets in client-side bundles. Keep secrets server-side only.
