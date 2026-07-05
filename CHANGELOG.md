# Changelog

All notable changes are recorded here.

## 2026-07-05 - Full verified audit-and-fix pass

Comprehensive audit of the clinical engine, formulary, pricing, UI, tests, and build.
All four QA harnesses green afterward: `npm run verify` Passed 106 / Failed 0
(105 clinical scenarios + 1 structural pricing invariant), `audit:hundred` 100/100,
`audit:mistakes` 51/51, typecheck and build clean.

### Safety

- Pregnancy contraindications added to Vericiguat (FDA boxed warning — embryo-fetal toxicity) and Ivabradine (fetal harm); the pregnancy alert now names them and GLP-1. H/ISDN deliberately remains pregnancy-appropriate (the RAAS alternative for pregnant HFrEF).
- New hyperkalemic-emergency gate: baseline K+ >= 6.0 fires a HYPERKALEMIC EMERGENCY clinical alert (ECG, urgent treatment); K+ >= 6.5 returns alerts only (no regimens), parallel to the SBP < 90 gate. K+ > 8.0 still hard-stops as implausible.
- Acute decompensation beta-blocker handling is now two-tier: up-titration is deferred in ANY acute decompensation (warm or cold — continue current dose and diurese); the forced dose reduction remains hypoperfusion-gated (cold-and-wet) and now cuts ONE step down (~50%) instead of jumping to the lowest tier.
- Current meds matching a documented allergy by name are flagged (forced swap to a tolerated same-group agent, else removal). A current med appearing in the discontinued list raises a MEDICATION HISTORY CONFLICT alert (verify deliberate restart) rather than forced removal.
- Blank renal data (eGFR/creatinine = 0 sentinel) no longer evaluates as end-stage CKD: current renal-gated meds are retained, new renal-gated starts are excluded pending a BMP, and candidates intensifying RAAS/MRA/SGLT2i carry a RENAL FUNCTION UNKNOWN warning + -15 penalty. Renal-threshold warnings are suppressed when renal data is blank.
- Blank potassium (0 sentinel) no longer flows into projected-K+ math: the unknown sentinel is preserved; K+ warning bands, the digoxin K-band warning, and DDI-3's interpolated K+ value are suppressed (a BMP is prompted instead); digoxin's K+ < 3.5 contraindication gained a > 0 guard.

### Clinical correctness

- Initiation-vs-continuation carve-outs: Vericiguat's VICTORIA enrollment criteria (NT-proBNP >= 1600, NYHA II-IV, recent worsening, LVEF < 45) now gate initiation only — a patient already on vericiguat is never force-removed for improved markers (pregnancy still forces removal). GLP-1 `BMI >= 30` likewise gates initiation only; continuation is blocked only by true safety CIs (pregnancy, MTC, MEN2).
- GLP-1 adjunct gate is now LVEF strictly > 40 (was >= 40); LVEF exactly 40 is HFrEF and gets no GLP-1.
- H/ISDN "RAAS alternative" branch now requires ALL RAAS agents excluded from the formulary, not merely "not currently on RAAS" — a treatment-naive patient gets RAAS first.
- `previous_lvef` = 0/NaN is treated as "not entered" (was: a documented prior EF of 0, producing false HFimpEF quad therapy for HFpEF patients).
- Vericiguat documentation prompt now fires for undefined `recent_hf_worsening_within_6mo`, not just the literal 'unknown'.

### Scoring

- Projected LVEF ceiling never pulls a baseline > 55 down to 55 (was fabricating an "EF may decline" caution for ordinary HFpEF patients).
- GLP-1 dry-weight (tissue-loss) adjustment now applies only to the GLP-1 portion of the weight delta — diuretic fluid loss is no longer reclassified as tissue loss when a GLP-1 is merely present; the SGLT2i+loop diuresis synergy excludes the GLP-1 adiposity portion.
- Procedural warnings are no longer ranking-penalized: the mandatory ACEi-to-ARNI 36-hour washout, beta-blocker taper guidance, and the base Furoscix device instruction joined the non-penalized markers. 'MRA INITIATION AT BORDERLINE K+' and Furoscix CKD caution/triage remain penalized (genuine residual risk).
- BNP/LAVI/LVEDD retention caps applied symmetrically on the add path so add-then-remove is a true inverse (defensive symmetry, no behavior change for the current formulary).
- Titration options sorted ascending by dose index at the source, so the compound "add + titrate" candidate genuinely picks the highest tier.

### Formulary and pricing

- Loop diuretic weight-loss curves recalibrated to documented evidence anchors (had drifted 40-70% high): furosemide `1.5 + 0.9*log2(d/20)`, torsemide `1.8 + 0.96*log2(d/10)`, bumetanide via 40:1 furosemide equivalence, Furoscix on a bioavailability-adjusted oral equivalent.
- GLP-1 `chf_effects` now dose-scaled like other titratable classes (semaglutide d/2.4, tirzepatide d/15, floor 0.25); eplerenone similarly dose-scaled (d/50), matching spironolactone.
- The `renal_adjustment` contract is fully honored: `contraindicated: true` excludes like `contraindications()`; `caution: true` becomes a "Renal dosing review" monitoring item; `start_dose_modifier` becomes a "Reduced starting dose (renal)" monitoring item (Entresto's eGFR < 30 half-dose start was previously a no-op). Finerenone's renal comment corrected (max-dose cap, not start-dose stratification).
- The A-HeFT race criterion uses the shared `isBlackRace()` predicate; `Patient.race` is a closed union matching the form.
- Pricing: Furoscix added to `DRUG_PRICES` (was silently falling back to generic-level pricing); Entresto cash price corrected $50 → $600 (the IRA-negotiated price is Medicare-only, modeled via medicare copay); the unknown-med fallback now warns; the verify harness asserts every formulary med has an explicit price entry.

### UI

- Critical crash fixed: clearing NT-proBNP (or LVEF) no longer crashes the app.
- Required-field validation: cleared engine-required numerics block Run Analysis (no NaN reaches the engine); new validation bounds (previous_lvef, daily_step_count, peak_flow_lpm, max_affordable_cost); LVEF form max corrected 85 → 80 (engine hard-stop parity).
- `is_pregnant` auto-clears when sex leaves 'Female'; pregnancy banner visible regardless of sex.
- eGFR warning tiers match the engine exactly (< 30 / < 25 initiation vs continuation / < 20 loop-response note); ClinicalSummary volume status is three-state; stale AV-block warning fixed.
- Accessibility: labels/aria-labels across form and library controls; full WAI-ARIA tabs keyboard pattern; ScoreDetailModal focus trap fixed.
- MedicationLibrary signed HR/SBP formatting fixed; alert rendering guards; RecommendationCards keyed per run; React.memo on heavy cards; dead loading spinner removed (the engine is synchronous).

### Performance

- Iron/DIAMOND rescue appends built before simulation (one `simulateModificationEffect` call per candidate instead of two/three); intolerance policy and phenotype threaded as params; monitoring plan / qualitative projections / trade-off labels deferred to the <= 3 final picks.

### Types and structure

- New `services/clinicalPredicates.ts`: `valueUnknown`, `hasHistoricalHFrEF`, `hasUnknownHistoricalHFrEF`, `isIronDeficient` (ESC compound criteria), `isBlackRace` — single source shared by engine and formulary (previously duplicated and drifting).
- Scoring constants exported from `simulationService` and rendered by `ScoreDetailModal` (no more hardcoded display copies): `BNP_SCORE_TARGET`/`CRITICAL`, `NYHA_SCORE_MAP`, `FUNCTIONAL_STEPS_FULL_CREDIT`, `VOLUME_SCORING`, `adherenceComplexityThreshold`, `CONCORDANCE_TABLE`, `pillarKeyOf`.
- `clonePatient` unified: single implementation in `simulationService` (now also deep-copies dose objects), re-exported by `data/scenarios.ts`.
- `types.ts`: removed dead `ExamFinding` interface, `Medication.subclass`, `MedicationDose.scored`. tsconfig: added `noUnusedParameters` and `noFallthroughCasesInSwitch`, removed `allowJs` (`noUncheckedIndexedAccess` deliberately deferred).
- Dead code removed (excludedClasses set, unused params/accumulators, an unreachable duplicate SBP < 90 gate); JSDoc added to `generateAndScoreModifications` and other exported API.

### Tests

- New regression scenarios pinning the fixes above (pregnancy exclusions, both continuation carve-outs, GLP-1 LVEF-40 boundary, warm-and-wet BB, blank-renal spironolactone, K+ 6.2/6.8 emergency tiers, previous_lvef = 0 sentinel, LVEF-60 no fabricated decline) — the harness count printed by `npm run verify` is authoritative.
- Structural invariant: every formulary med must have a `DRUG_PRICES` entry.
- Six existence-only scenarios given real behavioral assertions; substring collision anchored; dead assertion clauses removed; harness seeds made explicit.
- `mistakeAudit` header corrected to 51; `hundredScenarioAudit` teratogen list extended with sGC Stimulator + If Inhibitor.

### Build and hygiene

- Tailwind Play CDN replaced with build-time Tailwind v3 (`tailwind.config.js`, `postcss.config.js`, `index.css` imported by `index.tsx`); dead React importmap removed from `index.html`. Dist CSS: 32.55 kB (6.08 kB gzip) vs the ~350 kB runtime CDN compiler.
- `package.json`: version 0.1.0; misleading `lint` script removed; audit harnesses wired as npm scripts: `audit:red`, `audit:mistakes`, `audit:hundred`.
- `metadata.json` description corrected (4-phenotype, 7-domain).
- Stale repo-root artifacts deleted (scraper scripts, debug outputs); the three parent-directory analysis docs moved INTO `docs/` (`docs/guideline-analysis.md`, `docs/model-analysis.md`, `docs/CHF-FIRST-PRINCIPLES-ANALYSIS.md`).

## 2026-06-12 / 2026-06-13 - Clinical hardening and ranking overhaul (consolidated backfill)

Consolidated entry for the six commits after the 2026-02-22 entry, previously unrecorded here.
Harness grew from 71 to 90 scenarios across this period; the standalone QA harnesses
(`scripts/redTeam.ts`, `scripts/mistakeAudit.ts`, `scripts/hundredScenarioAudit.ts`) were built
alongside.

- **Safety hard-gates, usability, and qualitative output** (`fc15f45`): implausible-input hard stops, nitrate + PDE5i absolute exclusion, HR < 45 display floor, and the "checker, not predictor" reframe — direction-only qualitative projections, trade-off labels, `gdmtGaps`/`missingDataNotices`, and the STRONG-HF follow-up calendar.
- **Warm-vs-cold decompensation beta-blocker logic** (`d631873`): forced BB dose reduction narrowed to hypoperfusion (cold-and-wet); warm-and-wet continues the BB and diureses; safe pillar additions (esp. SGLT2i) survive alongside any mandated reduction.
- **GDMT-completeness ranking** (`27b2e2f`): additive completeness bonus (up to +30) for indicated, achievable therapies; completeness-aware display ranking; projected-SBP ranking penalty recalibrated to -25/-8 (from -60/-30).
- **Treatment-error hardening** (`bd85185`): 9 real bugs fixed via the 51-scenario mistake audit — duplicate same-class dedup, ivabradine-before-max-BB, lateral swap suppression, ARNI/H-ISDN titratability, non-penalized procedural warnings list, target-dose tier sampling, dose-aware completeness, over-diuresis alert.
- **Documented-intolerance policy** (`cd1c2ce`): intolerances apply to the CURRENT regimen, not just new starts — forced swap to a tolerated same-group agent with a two-tier evidence model (free text blocks new starts only; the structured reason is required to change current therapy).
- **Budget trade-offs maximize health benefit per dollar** (`7231213`): cost added as the FINAL ranking tiebreaker; over-budget fallback ordered value-first; eplerenone tolerability points recalibrated so a lone MRA cannot out-rank multi-pillar GDMT.

## 2026-02-22 - Documentation refresh

### Added

- Comprehensive product and safety documentation in `README.md`.
- Current developer implementation guide in `CLAUDE.md`.
- In-app clinical logic documentation rewrite in `components/FAQ.tsx`.
- Updated analysis references (moved into the repository under `docs/` on 2026-07-05):
  - `docs/model-analysis.md`
  - `docs/guideline-analysis.md`
  - `docs/CHF-FIRST-PRINCIPLES-ANALYSIS.md`

### Updated

- Documentation now reflects current engine behavior:
  - seven-domain weighted scoring
  - hemodynamic and display safety gates
  - pregnancy and contraindication handling
  - monitoring-plan generation logic
  - Furoscix eligibility, contraindications, and mandatory safety warnings
- Verification references updated to 71-scenario regression harness (`npm run verify`).

### Validation

- `npm run ci` passed after documentation updates (typecheck, build, verify).
