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
- Pregnancy: new beta-blocker starts are limited to beta-1-selective agents and carvedilol is switched (2026 ESC Class I C). Exclusions: RAAS classes, steroidal/non-steroidal MRAs, SGLT2 inhibitors, vericiguat (boxed warning), ivabradine, and GLP-1 therapy are excluded. H/ISDN remains available as the RAAS alternative.
- Nitrate + PDE5 inhibitor (sildenafil, tadalafil, vardenafil, avanafil) or riociguat exposure: H/ISDN is hard-excluded from the formulary and force-removed from an arriving regimen (absolute contraindication — fatal hypotension risk).
- Acute decompensation handling: blocks beta-blocker initiation and defers up-titration in ANY decompensation (warm or cold); forces existing beta-blocker dose reduction (one step, ~50%) only with hypoperfusion (cold-and-wet), continues it for warm-and-wet; safe additions (esp. SGLT2i) are still offered alongside any mandated reduction.
- Blank safety-critical data (eGFR/creatinine or K+ = 0/empty) is treated as "not entered" — it never clears a safety gate and never reads as end-stage disease. Renal-gated new starts are withheld pending a BMP; retained meds and RAAS/MRA/SGLT2i intensification carry explicit data-unknown warnings and ranking penalties.
- Initiation-vs-continuation carve-outs: trial-enrollment criteria (vericiguat VICTORIA markers, GLP-1 `BMI >= 30` and LVEF >= 45 semaglutide / >= 50 tirzepatide, SGLT2i eGFR floor: dapagliflozin 25, empagliflozin 20) gate initiation only — patients already on the drug are not force-removed for improved markers; true safety contraindications still force removal.
- MRA potassium rules (2026-11-10, source-verified): new starts above K+ 5.5 are never offered; a new start above K+ 5.0 is not offered, with or without a binder (rule E15: recheck and start once K+ is 5.0 or lower; decision 2026-11-11); an MRA already on board drops one dose step at K+ 5.5-5.9 and is withheld at 6.0 or above. Eplerenone/finerenone are contraindicated with strong CYP3A4 inhibitors; finerenone and spironolactone with adrenal insufficiency; finerenone dosing follows eGFR (start 10/20 mg, target 20/40 mg).
- Rate-control rules (2026-11-10, source-verified): resting HR below 55 on an established beta-blocker forces a one-step dose reduction with an alert (withhold only at the lowest dose, or for AV block / sick sinus syndrome without a pacemaker); no beta-blocker up-titration below HR 60; new beta-blocker starts stay blocked below HR 55 (engine policy). Carvedilol efficacy is capped at the 25 mg bid level and the three beta-blockers are modeled equal at target. Carvedilol is contraindicated in severe (or unspecified Child-Pugh B/C) hepatic impairment only; metoprolol is a caution. Ivabradine has the full Corlanor contraindication set (strong CYP3A4 inhibitors, hepatic, sick sinus, paced rhythm, decompensated HF), a 2.5 mg tier, HR-guided titration and an initiation-only HR >= 70 criterion. Digoxin is offered in sinus rhythm only after maximal GDMT (Class 2b); ventricular fibrillation excludes it and WPW warns.
- K+ binder rescue carries a residual-risk score penalty: rescue (reactive, projected K+ above 5.3) enables consideration but never erases the underlying hyperkalemia risk in ranking.

### 5) Furoscix implementation

`Furoscix (SC Furosemide)` is modeled as a SHORT-COURSE ADD-ON beside an oral loop diuretic (label: "not for chronic use"), never a swap or standing replacement (2026-11-10, `docs/medication-review-2026-11-10/verified-diuretics.md`).

- Offered only with at least 2 kg above dry weight and an oral loop on board; the modification summary says short course and return to the oral diuretic; a monitoring item reassesses volume status and resumes or adjusts the oral loop.
- Credited as 160 mg oral furosemide (80 mg SC, multiplier 2.0) and, beside an oral loop, only the increment above that loop.
- Contraindicated with anuria (comorbidity option), no oral loop on board, under 1 kg above dry weight, or furosemide/device-material hypersensitivity. CKD is an indication: the old `eGFR < 15` exclusion is gone and a low-eGFR caution remains.
- Priced per course of 4 single-use kits (assumption).
- Adds mandatory regimen warning:
  - `FUROSCIX SAFETY: On-body SQ infusor delivers 80mg over ~5 hours...`
- Additional triage warning appears when hypoxemia suggests possible acute pulmonary edema.

Other loop/thiazide rules from the same review: loop effects and the high-dose alert use the TOTAL DAILY dose (strength x doses per day); each loop declares a label maximum total daily dose (furosemide 600, torsemide 200, bumetanide 10 mg) that candidate generation never exceeds; thiazide-type add-on credit is 1.1 kg (CLOROTIC); gout caution applies to every loop and thiazide-type drug.

## Verification Strategy

Clinical logic is guarded by a four-harness QA gate. `npm run verify` is the CI regression gate;
the three audit harnesses are standalone (not part of CI) but constitute the full pre-release gate.

| Harness | Command | Pass criteria |
|---------|---------|---------------|
| Scenario assertions (`scripts/verifyScenarios.ts`) | `npm run verify` | All pass — `263` on 2026-11-11 (248 clinical scenarios + 15 structural invariants); the harness output is authoritative |
| Adversarial red team (`scripts/redTeam.ts`) | `npm run audit:red` | 0 CRITICAL / HIGH / MEDIUM findings |
| Treatment-error audit (`scripts/mistakeAudit.ts`) | `npm run audit:mistakes` | 51/51 clean |
| Broad clinical audit (`scripts/hundredScenarioAudit.ts`) | `npm run audit:hundred` | 100/100 clean |

- CI command: `npm run ci` (typecheck + build + golden + verify)

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

- offered only as a short-course add-on beside an oral loop, never as a swap
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
npm run ci               # typecheck + build + golden + verify
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
