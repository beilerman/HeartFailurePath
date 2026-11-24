<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# HeartFailurePATH

Deterministic heart-failure medication review and ranking UI built with React + Vite + TypeScript.

**Start with the [November 23 handoff](docs/HANDOFF-2026-11-23.md)** for the local branch, verified repairs, reproduction commands and outstanding clinical decisions.

## Clinical Scope

HeartFailurePATH evaluates medication changes against recorded findings for adults with chronic heart failure. It does not predict individual physiology or reconstruct an untreated state. Since 2026-11-16 options are ordered by six weighted factors from measured or priced inputs: death from any cause and heart-failure hospitalization (relative risks from randomized trials), symptoms (KCCQ points), side effects (one-year excess harm rates x severity), cost and dosing burden. These are trial population averages, not predictions for this patient; the weights are engine policy pending the owner's review; guideline concordance and completeness are shown for reference only. See the [first-principles model record](docs/first-principles-model-2026-11-16/README.md).

The [November 22 code review and expert-review record](docs/expert-review-2026-11-19/README.md) covers rule set 2026-11-22.4, reproduced defects, local verification and open clinical decisions.

- Follows the 2026 ESC phenotypes: reduced EF (LVEF below 50, including improved EF) and HFpEF (LVEF 50 or higher, never below 50); HFmrEF is no longer a separate phenotype.
- Includes formulary-level contraindication checks, renal dose constraints, and interaction warnings.
- Supports outpatient loop strategy escalation, including `Furoscix (SC Furosemide)` eligibility and safety messaging.

## Safety Notice

This is a clinical decision support prototype and simulation environment, not an autonomous prescriber.

- It does not replace clinician judgment, patient-specific diagnostics, or local policy.
- It must not be used as the sole basis for treatment decisions.
- It has not been validated as a regulated medical device.

## Incomplete information

Enter the information that is known. Missing core observations allow a focused safety review; with the core assessment present, medication options are limited to changes with recorded prerequisites. Measured KCCQ and pricing are not universal prerequisites. Results name what remains unassessed and what information a deferred decision needs. Missing data are not treated as normal findings or reasons to stop established therapy.

See the [incomplete-information review and validation record](docs/incomplete-data-2026-11-12/README.md) for the dependency matrix, scoring policy and limitations. These local changes have not been deployed or clinically validated.

## Current Engine Behavior

Rule set **2026-11-22.4** evaluates proposed medication regimens against recorded treated physiology. It preserves observed measurements and does not calculate an untreated state, individual treatment response or withdrawal magnitude. Legacy response coefficients are audit-only and covered by isolation regressions.

- Candidate actions include addition, titration, substitution, removal and continuation; the UI returns up to three distinct options. A shared net-exposure transition makes equivalent descriptions consistent.
- The public input boundary validates data and resolves medications to canonical formulary entries. Missing information limits dependent decisions; malformed data produces named input errors.
- Current-use, adherence, interval/tolerance, restart and course-history review are explicit. Held/completed courses are excluded from active exposure. Proposed snapshots cannot be reused as observed follow-up visits.
- Eligibility and safety depend on recorded findings and drug-specific restrictions. There is no automatic potassium-binder rescue or assumed potassium normalization. Stable therapy is not reduced solely to improve cost or dosing-burden scores.
- The default visit limit is two new medication classes. An elective switch from an ACE inhibitor or ARB to sacubitril/valsartan also counts toward that limit. Conditional IV iron additions must satisfy prerequisites, visit limits and budget rules. Furoscix remains a short-course adjunct beside an oral loop.
- Neurohormonal, functional, volume and structural domains are not assessed (weight 0). Ranking uses six factors (death, HF hospitalization, symptoms, side effects, cost, dosing burden; weights 0.30 / 0.22 / 0.10 / 0.14 / 0.14 / 0.10, engine policy); unknown cost is unassessed and the other weights are rescaled. Each figure is a trial average with its evidence basis (trial, pooled analysis, extrapolated, borrowed from a sibling, assumed neutral, not measured, upper bound), pulled toward no effect when the trials are small, and valued at the dose the trials achieved (an option that starts or increases a drug is valued as titrated). There is no baseline risk, so only relative effects are shown. A patient value that is not recorded is charged as the higher-risk case rather than ignored, and loop diuretics earn full credit at any dose because no dose relation was measured (congestion relief by dose is not modelled). The score is a model-based ordering, not a validated outcome prediction (2026-11-16; this replaces the earlier statement that treatment evidence and completeness alone informed ranking).
- Input changes suppress stale options and copied notes. Every option shows its own monitoring and medication differences. The copied draft and Visit review describe option 1 by default; the clinician can choose another option (radio group or the card button) and the note, monitoring and follow-up then describe that option (2026-11-15). A separate finalized-plan state is not built.

The [November 13 handoff](docs/HANDOFF-2026-11-13.md) records the disposition of the original 17 findings. The [evidence matrix](docs/evidence-matrix.md) distinguishes sourced rules from conservative software policies. Earlier reports preserve historical calculations and stage-specific findings; they do not override the current contract.

## Verification Strategy

The November 22 review passed the production build and full verification suite, including 910 scenario checks, 1,000 expert-packet checks and 181 server-rendered interface checks. All 1,032 reference comparisons passed. The [November 23 handoff](docs/HANDOFF-2026-11-23.md) records the randomized sweeps, desktop and mobile browser results, commands and limits of the review.

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
npm run verify           # scenario and expert-packet checks
npm run verify:ui        # server-rendered interface checks
npm run test             # alias of verify
npm run golden           # compare reference outputs across three tiers (numeric tolerance 1e-9)
npm run golden:update    # rewrite the golden master after an intended output change (review the diff first)
npm run ranking:diff     # compare the current engine with the golden snapshot and report what an intended scoring change did to the ranking (run before golden:update)
npm run audit:pricing    # every drug under every plan: patient cost never above the cash price, tiers consistent
npm run fuzz             # seeded randomized-patient sweep (5,000 patients): safety invariants written independently of the engine, plus consistency checks (same answer when the regimen is listed in another order; ranking mode and care priority change ordering only; an allergy typed in lower case still excludes the drug)
npm run audit:red        # adversarial red-team probes (standalone)
npm run audit:mistakes   # 51-scenario treatment-error audit (standalone)
npm run audit:hundred    # 100-scenario broad clinical audit (standalone)
npm run gate             # full pre-release gate: typecheck + golden + verify + verify:ui + the three audits + audit:pricing + fuzz
npm run ci               # production build followed by the full gate
npm run preview          # preview production build
```

## Deployment (Vercel)

These are setup notes, not a release authorization. The latest repairs remain local; remote state must be checked before any authorized release.

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
  scripts/         # verifyScenarios, goldenMaster, fuzzSweep, rankingDiff, redTeam, mistakeAudit, hundredScenarioAudit
  docs/
```

## Documentation Map

- [Current project handoff](docs/HANDOFF-2026-11-23.md)

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
