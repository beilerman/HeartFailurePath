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
- Rescue additions (K+ binder, IV iron) DO count toward the limit — intentional and test-ratified (it is a patient-facing sequencing limit).
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

Plus a **GDMT-completeness bonus** (up to +30) proportional to the share of indicated, achievable
therapies present (phenotype pillars + eligible disease-modifying adjuncts such as GLP-1 in
obesity). This makes the engine favor complete guideline therapy over the smallest safe change.
It is applied before the hemodynamic/electrolyte penalties, so safety gates still override.
Displayed options are ranked by score, then completeness, then uncapped raw score, then cost as a final
tiebreaker. Cost must not override an evidence-based preference, but among clinically indistinguishable
regimens the cheaper option wins. Budget-constrained outputs should be read as best affordable interim
options, not proof that complete GDMT is financially reachable.

### 4) Hard safety gates and output filters

- Input hard stop: `SBP < 90` -> no regimen output, alerts only.
- Input hard stop: baseline `K+ >= 6.5` -> alerts only (hyperkalemic emergency); `K+ >= 6.0` fires a HYPERKALEMIC EMERGENCY alert (ECG, urgent treatment).
- Input hard stop: physiologically impossible values (e.g. `LVEF > 80`, `K+ > 8`) -> verification alerts only, no recommendations computed on suspect data.
- Display safety filter: excludes regimens with projected `SBP < 85`, `K+ > 6.0`, or `HR < 45`.
- Pregnancy exclusions: RAAS classes, steroidal/non-steroidal MRAs, SGLT2 inhibitors, vericiguat (boxed warning), ivabradine, and GLP-1 therapy are excluded. H/ISDN remains available as the RAAS alternative.
- Nitrate + PDE5 inhibitor exposure: H/ISDN is hard-excluded from the formulary and force-removed from an arriving regimen (absolute contraindication — fatal hypotension risk).
- Acute decompensation handling: blocks beta-blocker initiation and defers up-titration in ANY decompensation (warm or cold); forces existing beta-blocker dose reduction (one step, ~50%) only with hypoperfusion (cold-and-wet), continues it for warm-and-wet; safe additions (esp. SGLT2i) are still offered alongside any mandated reduction.
- Blank safety-critical data (eGFR/creatinine or K+ = 0/empty) is treated as "not entered" — it never clears a safety gate and never reads as end-stage disease. Renal-gated new starts are withheld pending a BMP; retained meds and RAAS/MRA/SGLT2i intensification carry explicit data-unknown warnings and ranking penalties.
- Initiation-vs-continuation carve-outs: trial-enrollment criteria (vericiguat VICTORIA markers, GLP-1 `BMI >= 30`, SGLT2i eGFR floor) gate initiation only — patients already on the drug are not force-removed for improved markers; true safety contraindications still force removal.
- K+ binder rescue carries a residual-risk score penalty: rescue enables consideration (DIAMOND) but never erases the underlying hyperkalemia risk in ranking.

### 5) Furoscix implementation

`Furoscix (SC Furosemide)` is modeled as a loop-diuretic option for worsening congestion contexts.

- Preferred in severe congestion loop-swap/add pathways.
- Contraindicated when escalation context is absent, with severe renal impairment (`eGFR < 15`), or with furosemide/device-material hypersensitivity.
- Adds mandatory regimen warning:
  - `FUROSCIX SAFETY: On-body SQ infusor delivers 80mg over ~5 hours...`
- Additional triage warning appears when hypoxemia suggests possible acute pulmonary edema.

## Verification Strategy

Clinical logic is guarded by a four-harness QA gate. `npm run verify` is the CI regression gate;
the three audit harnesses are standalone (not part of CI) but constitute the full pre-release gate.

| Harness | Command | Pass criteria |
|---------|---------|---------------|
| Scenario assertions (`scripts/verifyScenarios.ts`) | `npm run verify` | All pass — currently `106` (105 clinical scenarios + 1 structural pricing invariant); the harness output is authoritative |
| Adversarial red team (`scripts/redTeam.ts`) | `npm run audit:red` | 0 CRITICAL / HIGH / MEDIUM findings |
| Treatment-error audit (`scripts/mistakeAudit.ts`) | `npm run audit:mistakes` | 51/51 clean |
| Broad clinical audit (`scripts/hundredScenarioAudit.ts`) | `npm run audit:hundred` | 100/100 clean |

- CI command: `npm run ci` (typecheck + build + verify)

Global invariants covered include:

- no dual RAAS overlap
- no dual MRA overlap
- every formulary medication has an explicit pricing entry
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
npm run typecheck        # tsc --noEmit
npm run build            # production build
npm run verify           # scenario assertion harness (its printed count is authoritative; currently 106 passing)
npm run test             # alias of verify
npm run audit:red        # adversarial red-team probes (standalone)
npm run audit:mistakes   # 51-scenario treatment-error audit (standalone)
npm run audit:hundred    # 100-scenario broad clinical audit (standalone)
npm run ci               # typecheck + build + verify
npm run preview          # preview production build
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
  index.css        # Tailwind entry (build-time Tailwind v3; no runtime CDN)
  constants.ts
  types.ts
  components/
  services/
  data/
  scripts/         # verifyScenarios, redTeam, mistakeAudit, hundredScenarioAudit
  docs/
```

## Documentation Map

- Evidence matrix and rule traceability: `docs/evidence-matrix.md`
- Clinical scenario observations: `docs/clinical-scenario-observations-2026-07-03.md`
- Analysis references: `docs/model-analysis.md`, `docs/guideline-analysis.md`, `docs/CHF-FIRST-PRINCIPLES-ANALYSIS.md`
- Developer architecture + implementation guide: `CLAUDE.md`
- Change history: `CHANGELOG.md`
- In-app logic and methodology tab: `components/FAQ.tsx`
- Scenario seeds and fixtures: `data/scenarios.ts`
- Verification assertions: `scripts/verifyScenarios.ts`

## Data Model Note

`Patient` uses `Set<string>` fields (`comorbidities`, `allergies`, `exam_findings`, `external_medications`). Use clone-safe copying logic and avoid JSON serialization when preserving these fields.

## Secrets

Do not ship API keys or model secrets in client-side bundles. Keep secrets server-side only.
