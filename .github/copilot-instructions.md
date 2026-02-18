<!-- Copilot / AI-Agent instructions for HeartFailurePATH -->
# Quick Context
- This is a Vite + React TypeScript single-page app (UI) with a deterministic clinical "simulation engine" (domain logic) implemented in TypeScript.
- UI: `App.tsx` (tabs: Simulation, Formulary, Logic). Core input form is `components/PatientForm` and its sub-sections under `components/patient-form/`.
- Simulation Engine: `services/simulationService.ts` (baseline calc, regimen simulation, 6-domain scoring). Pricing is mocked in `services/pricingService.ts`.
- Source of truth for medications: `constants.ts` (export `MEDICATION_FORMULARY`). Types are in `types.ts`. Example patients are in `data/scenarios.ts`.

# How to run locally
- Install: `npm install`
- Dev server: `npm run dev` (Vite, default port 3000)
- Build check: `npm run build` (vite build)
- Environment: set `GEMINI_API_KEY` in `.env.local` if using external models; `vite.config.ts` injects `process.env.GEMINI_API_KEY`.

# Key patterns & conventions (specific to this repo)
- Use `Set<string>` for `comorbidities` and `volume_status.exam_findings` (not arrays). Use `clonePatient()` from `data/scenarios.ts` when copying patients so Sets are preserved.
- Medication objects live in `MEDICATION_FORMULARY` (in `constants.ts`). Each med must implement `chf_effects()`, `hemodynamic_effects()`, and optional `contraindications()` / `special_features` similar to existing entries.
- Simulation reduces combinatorial explosion via `getDoseTiers()` and `cartesianProduct()` (see `simulationService.ts`). Add changes with performance impact in mind.
- Hard-coded clinical thresholds (e.g., BNP targets, MAP < 65, K+ cutoffs) live in `simulationService.ts`. If you change them, update nearby comments and add scenario-based checks.

# Typical edits and where to make them
- Add a new medication: add to `constants.ts` (follow the shape of e.g., `Dapagliflozin` or `Sacubitril/Valsartan`), and optionally update `services/pricingService.ts` for pricing.
- Change scoring/clinical logic: edit `services/simulationService.ts`. Tests are not present—add scenario entries in `data/scenarios.ts` to manually validate via the UI.
- Modify patient input or UI: edit `components/` and `components/patient-form/*`. `PatientForm` auto-calculates BMI and eGFR via `useEffect`—preserve these behaviors or centralize them.

# Debugging & validation tips
- Use the UI: load a scenario (top-left selector) and click "Run Analysis" to exercise the entire engine.
- For unit-level inspection, log inside `simulationService.ts` or write small node scripts calling `simulateAndScoreAllRegimens()` (same import path).
- When making scoring changes, add or modify scenarios in `data/scenarios.ts` to create reproducible regressions.

# Minimal guardrails for AI agents
- Do not change medical thresholds or models without adding a test scenario and a comment explaining rationale and expected impact.
- Keep service functions pure and deterministic—side-effects should be explicit and localized to mocks (e.g., `pricingService.ts`).

# Quick file map (examples)
- Domain logic: `services/simulationService.ts` (scoring, baseline, simulateRegimenEffect)
- Med formulary: `constants.ts` (`MEDICATION_FORMULARY` entries)
- Sample data: `data/scenarios.ts` (`INITIAL_PATIENT`, `clonePatient()`)
- UI entry + tabs: `App.tsx`

If anything in this note is unclear or you'd like me to expand a section (examples, more file links, or add test scaffolding), tell me which part to iterate on.
