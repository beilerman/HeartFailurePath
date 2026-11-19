<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# HeartFailurePATH

Deterministic heart-failure medication review and ranking UI built with React + Vite + TypeScript.

**Taking over the project? Start with the [consolidated handoff](docs/HANDOFF-2026-11-13.md).** It records all review stages, the local working tree, saved verification evidence and remaining clinical/workflow work.

## Clinical Scope

HeartFailurePATH evaluates medication changes against recorded findings for adults with chronic heart failure. It does not predict individual physiology or reconstruct an untreated state. Since 2026-11-16 options are ordered by six weighted factors from measured or priced inputs: death from any cause and heart-failure hospitalization (relative risks from randomized trials), symptoms (KCCQ points), side effects (one-year excess harm rates x severity), cost and dosing burden. These are trial population averages, not predictions for this patient; the weights are engine policy pending the owner's review; guideline concordance and completeness are shown for reference only. See the [first-principles model record](docs/first-principles-model-2026-11-16/README.md).

Latest local repair and verification: [medication transition review (.8)](docs/medication-repair-loop-2026-11-12/README.md).

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

Rule set **2026-11-12.8** evaluates proposed medication regimens against recorded treated physiology. It preserves observed measurements and does not calculate an untreated state, individual treatment response or withdrawal magnitude. Legacy response coefficients are audit-only and covered by isolation regressions.

- Candidate actions include addition, titration, substitution, removal and continuation; the UI returns up to three distinct options. A shared net-exposure transition makes equivalent descriptions consistent.
- The public input boundary validates data and resolves medications to canonical formulary entries. Missing information limits dependent decisions; malformed data produces named input errors.
- Current-use, adherence, interval/tolerance, restart and course-history review are explicit. Held/completed courses are excluded from active exposure. Proposed snapshots cannot be reused as observed follow-up visits.
- Eligibility and safety depend on recorded findings and drug-specific restrictions. There is no automatic potassium-binder rescue or assumed potassium normalization. Stable therapy is not reduced solely to improve cost or dosing-burden scores.
- The default visit limit is two new medication class groups; titration and same-group substitutions do not consume it. Conditional IV iron additions must satisfy prerequisites, visit limits and budget rules. Furoscix remains a short-course adjunct beside an oral loop.
- Neurohormonal, functional, volume and structural domains are not assessed (weight 0). Ranking uses six factors (death, HF hospitalization, symptoms, side effects, cost, dosing burden; weights 0.30 / 0.22 / 0.10 / 0.14 / 0.14 / 0.10, engine policy); unknown cost is unassessed and the other weights are rescaled. Each figure is a trial average with its evidence basis (trial, pooled analysis, extrapolated, borrowed from a sibling, assumed neutral, not measured, upper bound), pulled toward no effect when the trials are small, and valued at the dose the trials achieved (an option that starts or increases a drug is valued as titrated). There is no baseline risk, so only relative effects are shown. A patient value that is not recorded is charged as the higher-risk case rather than ignored, and loop diuretics earn full credit at any dose because no dose relation was measured (congestion relief by dose is not modelled). The score is a model-based ordering, not a validated outcome prediction (2026-11-16; this replaces the earlier statement that treatment evidence and completeness alone informed ranking).
- Input changes suppress stale options and copied notes. Every option shows its own monitoring and medication differences. The copied draft and Visit review describe option 1 by default; the clinician can choose another option (radio group or the card button) and the note, monitoring and follow-up then describe that option (2026-11-15). A separate finalized-plan state is not built.

See the handoff for current thresholds, the disposition of the original 17 findings and the remaining clinical policy decisions. The [evidence matrix](docs/evidence-matrix.md) distinguishes sourced rules from conservative software policies. Earlier reports preserve historical calculations and stage-specific findings; they do not override the current contract.

## Verification Strategy

The latest saved local repair receipts record:

| Check | Result |
|---|---|
| Engine scenario/invariant groups | 442 passed, 0 failed |
| Server-rendered UI groups | 29 passed, 0 failed |
| Golden fixture/insurance-tier runs | 1,032 byte-identical after reviewed update |
| Broad clinical / mistake audits | 100/100 and 51/51 clean |
| Red team / pricing | 0 critical, high or medium findings; pricing passes |
| Randomized sweeps | 10,000 runs across two disjoint seed ranges; no violations |
| Transition diagnostics | 32 drugs / 122 dose-frequency entries; no identity or representation discrepancies |
| Actual local browser | Seven desktop/mobile workflows completed; no page errors |
| Typecheck / production build | Passed; existing bundle and Node deprecation warnings remain |

Receipts and their limits are in the [handoff](docs/HANDOFF-2026-11-13.md#verification-evidence) and [latest repair report](docs/medication-repair-loop-2026-11-12/README.md). These are engineering checks on synthetic cases, not clinical validation. Remaining keyboard, accessibility, print and recovery-path coverage is listed explicitly.

`npm run gate` includes typecheck, golden, engine/UI checks, all three clinical audits, pricing and the default 5,000-case fuzz sweep. `npm run ci` includes typecheck, build, golden, engine/UI checks, pricing and fuzz; it does not include all three clinical audits. Review `npm run ranking:diff` before intentionally updating a golden snapshot.

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
npm run verify           # scenario assertion harness (its printed count is authoritative; latest saved receipt: 442 passing)
npm run verify:ui        # 29 server-rendered UI content groups; not browser tests
npm run test             # alias of verify
npm run golden           # golden master: every scenario under three insurance tiers must be byte-identical (1032 runs)
npm run golden:update    # rewrite the golden master after an intended output change (review the diff first)
npm run ranking:diff     # compare the current engine with the golden snapshot and report what an intended scoring change did to the ranking (run before golden:update)
npm run audit:pricing    # every drug under every plan: patient cost never above the cash price, tiers consistent
npm run fuzz             # seeded randomized-patient sweep (5,000 patients): safety invariants written independently of the engine, plus consistency checks (same answer when the regimen is listed in another order; ranking mode and care priority change ordering only; an allergy typed in lower case still excludes the drug)
npm run audit:red        # adversarial red-team probes (standalone)
npm run audit:mistakes   # 51-scenario treatment-error audit (standalone)
npm run audit:hundred    # 100-scenario broad clinical audit (standalone)
npm run gate             # full pre-release gate: typecheck + golden + verify + verify:ui + the three audits + audit:pricing + fuzz
npm run ci               # typecheck + build + golden + verify + verify:ui + audit:pricing + fuzz
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

- Current consolidated handoff: [docs/HANDOFF-2026-11-13.md](docs/HANDOFF-2026-11-13.md)

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
