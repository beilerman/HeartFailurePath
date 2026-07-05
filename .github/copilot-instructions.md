<!-- Copilot / AI-Agent instructions for HeartFailurePATH -->
# Quick Context
- Vite + React + TypeScript single-page app with a deterministic clinical simulation engine.
- All source lives at the repository root (no `src/`). UI: `App.tsx` (tabs: Simulation, Formulary, Logic), form in `components/PatientForm.tsx` + `components/patient-form/*`.
- Engine: `services/simulationService.ts`. Single public entry point:
  `generateAndScoreModifications(patient, availableMedNames: Set<string>, prices: Record<string, number>)`
  returning `SimulationOutput` (types.ts): `scoredRegimens`, `excludedMedications`, `clinicalAlerts`, `monitoringPlan`, plus categorical fields `gdmtGaps?`, `eligibleAdjuncts?`, `missingDataNotices?`, `followUpCalendar?`.
- Delta-based engine with 7-domain weighted scoring (Neuro 20 / Func 15 / Vol 15 / Struct 10 / Cost 15 / Adhere 10 / Guideline 15). Candidate actions: add / titrate_up / titrate_down / swap / remove / keep.
- Shared clinical predicates (`valueUnknown`, `hasHistoricalHFrEF`, `isIronDeficient`, `isBlackRace`) live in `services/clinicalPredicates.ts` — single source for both the engine AND the formulary. Never duplicate them.
- Formulary: `constants.ts` (`MEDICATION_FORMULARY`, 32 meds / 17 classes). Each med implements `chf_effects()`, `hemodynamic_effects()`, optional `contraindications()` / `renal_adjustment()` / `special_features`. Pricing: `services/pricingService.ts` — every formulary med MUST have an explicit `DRUG_PRICES` entry (a verify invariant enforces this).
- Scoring constants and the concordance table (`BNP_SCORE_TARGET`, `NYHA_SCORE_MAP`, `VOLUME_SCORING`, `CONCORDANCE_TABLE`, `pillarKeyOf`, ...) are EXPORTED from `simulationService.ts` and rendered by `ScoreDetailModal` — never re-hardcode display copies in components.

# Commands
- `npm install`, `npm run dev` (Vite, default port 3000)
- `npm run typecheck` / `npm run build`
- `npm run verify` — the MANDATORY regression gate (`scripts/verifyScenarios.ts`; its printed count is authoritative, currently Passed 106 = 105 clinical scenarios + 1 structural pricing invariant). Also runs in CI (`.github/workflows/ci.yml`; `npm run ci` = typecheck + build + verify).
- Standalone audit harnesses (not in CI, but part of the pre-release gate):
  `npm run audit:red` (adversarial probes, pass = 0 findings), `npm run audit:mistakes` (51/51), `npm run audit:hundred` (100/100).
- No environment variables are required; there is no external AI integration and no `lint` script.

# Non-negotiables for AI agents
- `Patient` uses `Set<string>` fields (`comorbidities`, `allergies`, `exam_findings`, `external_medications`). Copy patients ONLY with `clonePatient()` (implemented in `services/simulationService.ts`, re-exported by `data/scenarios.ts`) — never spread or JSON round-trip.
- The engine must stay deterministic and pure — no side effects, no randomness, no network. Mocks stay localized (`pricingService.ts`).
- Every clinical-logic or threshold change requires ALL of: a scenario in `data/scenarios.ts`, an assertion in `scripts/verifyScenarios.ts`, an update to `components/FAQ.tsx` (the in-app Logic tab must match the engine), and updates to `README.md`/`CLAUDE.md`.
- Rescue additions (K+ binder, IV iron) COUNT toward `max_new_classes_per_visit`. This is intentional and test-ratified ('Max New Classes Counts Binder Rescue') — do not "fix" it.
- Graduated projected-SBP ranking penalties are `<90 → -25`, `<95 → -8` (recalibrated from -60/-30). Do not restore the old values; hard gates (input SBP < 90, display SBP < 85) are separate and unchanged.
- Blank safety-critical data (eGFR/creatinine/K+ = 0) means "not entered" — it must never clear a safety gate and never read as end-stage disease. Use `valueUnknown()`.
- Trial-enrollment criteria gate INITIATION only (vericiguat VICTORIA markers, GLP-1 BMI >= 30, SGLT2i eGFR floor) — do not force-remove patients already on the drug for improved markers; true safety CIs (e.g. pregnancy) still force removal.

# Validation gate (run before claiming done)
1. `npm run typecheck`
2. `npm run build`
3. `npm run verify` — all assertions must pass
4. For clinical changes, also run the three audit harnesses.

Deeper reference: the project `CLAUDE.md` (architecture, safety logic, pitfalls) and `docs/evidence-matrix.md` (rule-to-evidence traceability).
