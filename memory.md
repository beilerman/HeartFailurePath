# HeartFailurePath — Cross-Session Memory

## Architecture / Clinical-Safety Decisions

### Tool reframed: checker, not predictor (2026-06-12)
A literature + operationability review concluded the projection-and-ranking layer was the
least defensible, most authoritative-looking part of the engine (false precision from
uncalibrated constants). The tool was reframed as a **deterministic GDMT gap-and-safety
checklist with explicit uncertainty**, not an individual-outcome predictor. Six changes:

1. **CO-compensation out of safety gates** (`simulateModificationEffect`): Frank-Starling
   forward-flow offset is no longer subtracted from `sbpDelta`/`dbpDelta`. Projected SBP read
   by the display floor and penalty gates is now the **conservative pre-compensation value**.
   Compensation is surfaced as a rationale note only — it can never lift a projected SBP across
   a safety threshold.
2. **Iron-deficiency criterion** corrected to ESC 2021/IRONMAN/AFFIRM-AHF via `isIronDeficient()`:
   ferritin <100 (absolute) OR (ferritin 100–300 AND TSAT <20) (functional). TSAT<20 alone with
   ferritin >300/unknown no longer flags. Used in `analyzeCurrentRegimen` + main entry.
3. **Qualitative projections** per regimen (`buildQualitativeProjections`) — direction-only
   (improve/stable/caution/worsen) for remodeling, congestion, neurohormonal, BP, K+. No decimals.
4. **Trade-off labels** per regimen (`buildTradeOffLabels`) from domain sub-scores — replaces
   composite-score emphasis with cost / pill-burden / evidence chips.
5. **Categorical output** on `SimulationOutput`: `gdmtGaps` (indicated-but-missing pillars for
   phenotype), `missingDataNotices` (inputs not entered → inference withheld, no silent defaults).
6. **STRONG-HF follow-up calendar** (`buildFollowUpCalendar`) — Day7/Wk2/Wk4/Wk6 schedule,
   triggered when a disease-modifying class is initiated/up-titrated. Now a primary deliverable.

UI: `RecommendationCard` leads with Expected Direction + Trade-offs; raw projected numbers and
the composite score moved behind a `<details>` disclosure labeled "not a prediction".
`ResultsDisplay`/`App` render gaps, missing-data notices, and the follow-up calendar.

Note: `projected_patient` numeric fields are still populated (the verify harness reads
`projected_patient.sbp/.potassium/.lvef/.pulse`) — only the clinician-facing **display** is qualitative.

All 71 scenarios still pass; types + build clean. The harness tests internal invariants, NOT
clinical correctness — green CI ≠ clinical validation.

### Real-world robustness: incomplete data, inappropriate regimens, intolerances (2026-06-12)
Added handling for messy clinical reality. Now 77 scenarios (added 6).

- **Critical missing-data layer** (`auditCriticalData`, `valueUnknown`): physiologically-impossible
  0 / undefined treated as "not entered" for safety-critical fields.
  - LVEF unknown → **fail safe**: alerts only, no recs (phenotype undeterminable).
  - Potassium unknown → DATA REQUIRED alert + any RAAS/MRA **initiation/up-titration** gets a
    `POTASSIUM UNKNOWN` warning and −15 caution (the projected-K+ gate is meaningless at K+=0).
  - eGFR/creatinine unknown → DATA REQUIRED alert.
  - NT-proBNP unknown → neurohormonal domain scored neutral 50, not a false 100.
- **Inappropriate arriving-regimen alerts** (`detectInappropriateRegimen`): dual RAAS, dual MRA,
  non-DHP CCB (verapamil/diltiazem) in HFrEF (Class III harm), chronic NSAID in HF → explicit
  deprescribe alerts instead of silent output filtering.
- **Redundant-therapy correction (CLOSED gap, 2026-06-12)**: `computeRedundantCurrentMeds` picks
  the agent to KEEP (RAAS preference ARNI>ACEi>ARB; MRA keep steroidal, drop nsMRA) and the engine
  FORCE-REMOVES the duplicate from every candidate (same injection path as contraindicated meds).
  So a dual-RAAS / dual-MRA arrival now yields a *corrected single-agent regimen* (+ gap-filling),
  not alerts-only. Redundant meds are also blocked from titrate-up/swap and added to `removable`.
  `RegimenAnalysis.redundantCurrentMeds` carries the set. Scenarios: 'Inappropriate Dual RAAS on
  Arrival', 'Inappropriate Dual MRA on Arrival'. Now 78 scenarios.
- **Expanded class-attributed intolerance** (in exclusion block): bradycardia/AV block → defer all
  NEW beta-blockers (existing BB still continued); bronchospasm → avoid Carvedilol (keep β1-selective);
  GLP-1 GI intolerance → exclude GLP-1; sulfa allergy → loop/thiazide cross-reactivity caution alert
  (NOT excluded — ethacrynic acid noted as sulfonamide-free alternative). Matching is class-attributed
  to avoid cross-contamination (same principle as the H3 fix).

Harness note: every scenario title MUST appear in `ASSERTION_TITLE_MARKERS` AND have an assertion
block, else it fails via the orphan-assertion guard.

### Red-team pass — 3 real bugs found & fixed (2026-06-12)
`scripts/redTeam.ts` is a standalone adversarial harness (`npx tsx scripts/redTeam.ts`) — 12 probes,
auto-flags safety violations. Findings:
1. **Abrupt beta-blocker withdrawal** (HIGH): a BB force-removed for a new contraindication was
   dropped with no taper. FIX: any `remove` of a Beta Blocker now pushes a
   `BETA-BLOCKER DISCONTINUATION` taper warning (abrupt withdrawal = Class III harm).
2. **Decompensated HFrEF + contraindicated BB → ZERO regimens** (HIGH, the worst one): an acutely
   decompensated patient (forces BB dose-reduction) whose BB is also contraindicated (e.g. new
   asthma) had every candidate filtered out, because `satisfiesForcedBbDownTitration` required a
   `titrate_down` but the BB was force-`remove`d. FIX: a **removal now satisfies the forced-BB-
   reduction rule** (removal ⊇ down-titration). Patient now gets a proper BB-free regimen.
3. **Incoherent mod list** (MED): "down-titrate AND remove the same drug in one visit." FIX: when
   force-removing a med, strip any titrate/keep mods for that same drug from the candidate.
Plus **input plausibility bounds** (`validatePhysiologicBounds`): LVEF>80, K+>8 or <2, SBP>260,
eGFR>150, HR out of 20-250, Cr>20, BMI out of 10-80 → `IMPLAUSIBLE VALUE` verification alert (catches
unit-confusion / transcription typos that would otherwise drive confident output).
Probes that PASSED clean (good existing behavior): triple-RAAS reduction, pregnancy teratogen removal,
Furoscix blocked under furosemide allergy, MRA+binder at K+5.4/eGFR30, low-SBP HFrEF still offered GDMT.
Now 80 scenarios (added 2 red-team regressions). CAUTION when writing red-team checks: a 0-regimen
result can vacuously pass a check that needs a regimen to inspect — always assert non-empty first.

### Red-team round 2 + asthma granularity + adjunct surfacing (2026-06-12) — now 81 scenarios
Extended `scripts/redTeam.ts` to 16 probes (scoring-gaming, budget $0, race/A-HeFT, qualitative-projection
sanity, dialysis eGFR, mild-asthma BB selection). Two improvements made:
1. **Mild/moderate asthma BB granularity**: added comorbidities `Asthma (Mild/Moderate)` and `COPD` to
   `RELEVANT_COMORBIDITIES`. Non-selective **Carvedilol** is now contraindicated in mild/moderate asthma
   (in addition to severe); β1-selective **Bisoprolol/Metoprolol Succinate** remain available (Bisoprolol
   preferred via special_feature) with an `ASTHMA + BETA-BLOCKER` monitoring warning. Severe asthma still
   excludes ALL BBs. Scenario: 'Mild Asthma BB Selection'.
2. **Eligible-adjuncts surfacing** (`buildEligibleAdjuncts`/`describeAdjunct` → `SimulationOutput.eligibleAdjuncts`):
   criteria-met adjuncts (H/ISDN A-HeFT, ivabradine SHIFT, vericiguat VICTORIA, IV iron, GLP-1, finerenone,
   thiazide) are now surfaced as a labeled list with evidence EVEN IF they don't rank in the top-3 picks.
   Fixes the gap where a Black NYHA III HFrEF patient's A-HeFT H/ISDN indication was silently absent (it was
   eligible/not-excluded but never displayed). Rendered as a violet "Eligible Adjuncts to Consider" panel in
   ResultsDisplay; threaded through App.tsx. gdmtGaps = missing PILLARS; eligibleAdjuncts = met ADD-ONS.
Residual accepted: composite score still occasionally favors a minimal correction as the #1 pick (mitigated
by gaps + adjuncts panels surfacing everything indicated).

### Critique-response hard-gate pass (2026-06-12) — still 81 scenarios
External first-principles critique argued safety/eligibility should CONSTRAIN scoring, not
participate in it. Most of it was already addressed (hard gates, data audits, dedicated
exclusion pass). Three genuine gaps were closed:
1. **Nitrate + PDE5i now an absolute exclusion** (was DDI warning only): H/ISDN
   `contraindications` returns true when Sildenafil/Tadalafil in `external_medications`, so the
   formulary filter drops it AND `detectInappropriateRegimen` emits an `INAPPROPRIATE THERAPY`
   alert that force-removes an arriving nitrate. Scenario 'Nitrate + PDE5 Exposure' flipped from
   "nitrate displays WITH warning" to "nitrate never displays". New global invariant in harness.
2. **Implausible values now HARD-STOP** (was flag-and-proceed): `validatePhysiologicBounds`
   non-empty → return alerts only. LVEF 99 previously classified HFpEF and produced confident
   recs off a typo. 'Implausible Lab Value' assertion now also requires zero regimens.
3. **Projected bradycardia display floor**: HR < 45 added to `displaySafeRegimens` filter +
   NO-DISPLAY-SAFE alert + global harness invariant (matched the existing SBP/K+ floors).
Plus: **K+ binder rescue no longer exempt from the dangerousWarnings penalty** — "Binder
Required" now counts as residual risk, so a rescue-dependent regimen ranks below an equal one
that needs none (mitigates "mitigation erases baseline risk" critique). FAQ/README/CLAUDE.md
safety sections updated. Critiques NOT actioned (judged out of scope / already-handled):
splitting the composite score into a non-compensatory lexicographic model, and building a
structured evidence-strength object model — the trade-off chips + concordance table + gaps/
adjuncts panels already surface dimensions separately; composite is behind a "not a prediction"
disclosure. Reframing to full rule-engine would be a rewrite, logged as residual.

### Declarative framework refactor — Phases A & B (2026-06-12, behavior-preserving)
**Phase A — `DRUG_CLASS_REGISTRY`** (top of simulationService.ts): single source of truth keyed by
drug_class with `{ group, dbpRatio, flags }`. `getMedicationClassGroup`, `getDbpRatio`, `RAAS_CLASSES`,
`DIURETIC_CLASSES`, `VOLUME_SENSITIVE_INTENSIFICATION_CLASSES`, `DISEASE_MODIFYING_CLASSES` all DERIVE
from it (via `classesWithFlag(flag)`). Adding a class = one registry row + formulary entry (was: grep-and-
patch ~80 inline `drug_class === '...'` branches). flags: raas | mra | diuretic | disease-modifying |
volume-sensitive-intensifier. Behavior-preserving — memberships copied exactly.
**Phase B — `CONCORDANCE_TABLE`** (evidence as data): phenotype × pillar → `{ base, targetBonus, recClass,
trials }`. The three former hardcoded phenotype branches in `calculateGuidelineConcordanceScore` are gone —
replaced by one generic pass (`classifyPhenotype` + `pillarsPresentAtTarget`). Points calibrated to exactly
reproduce prior scores (Class I = 20-22, IIb = 8-13); recClass + landmark trials now attached as data.
`describeConcordance()` surfaces "Guideline: <pillar> — Class <X> (<trials>)" into each regimen's rationale.
Adding/restating a pillar or phenotype is now a data edit in the table. Both phases: 81 scenarios + 17
red-team probes + typecheck + build all green. Red-team probe 17 locks evidence-surfacing + concordance
consistency. NOTE: Phase-B recClass labels are metadata only — changing a label does NOT change the score
(points are separate); to change scoring, edit `base`/`targetBonus`.
