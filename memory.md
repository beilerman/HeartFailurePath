# HeartFailurePath — Cross-Session Memory

## Architecture / Clinical-Safety Decisions

### Documented-intolerance policy unified for new starts AND current regimen (2026-06-12)
100-scenario audit (`scripts/hundredScenarioAudit.ts`) findings 072/073: intolerance logic from
`discontinued_meds` filtered NEW starts only — `analyzeCurrentRegimen` never checked it, so a
patient on Ramipril with documented ACEi cough (or on spironolactone with documented
gynecomastia) kept the offending drug in every recommendation. Fix:
- `deriveIntolerancePolicy(patient)` is the single source of truth (class-attributed keyword
  matching: angioedema, cough, hyperkalemia, gynecomastia, BB bradycardia/bronchospasm, GLP-1 GI).
- `currentMedIntoleranceReason(med, policy)` flags arriving meds; they join
  `contraindicatedCurrentMeds` (blocks keep/titrate-up, enables swap) + a reason map
  (`intolerableCurrentMeds`).
- Forced cleanup (section e) injects a **SWAP to swappable.candidates[0]** instead of a bare
  remove when a tolerated same-group agent exists — otherwise bare "remove ACEi" candidates
  out-rank swaps (removal *raises* projected SBP) and the displayed top-3 silently lose the RAAS
  pillar. Falls back to removal when no alternative (e.g. pregnancy excludes all RAAS).
- Gynecomastia is agent-specific, NOT class-wide: exclude spironolactone + named offender; keep
  eplerenone/finerenone so the MRA pillar survives (was previously excluding all steroidal MRA).
- Deliberately NOT removed from current regimen: existing BB (intolerance defers initiation only;
  abrupt stop = Class III harm) and currently-tolerated GLP-1.
- Knock-on (red-team probe 2): `computeRedundantCurrentMeds` keeper selection is now
  intolerance/contraindication-aware (`isUnkeepable` predicate, required param) — with dual MRA
  where the steroidal is intolerable, the viable nsMRA becomes the keeper instead of both being
  dropped (keeper removed for intolerance + alternative removed as "redundant" = lost pillar).
- Pre-commit multi-agent review found 6 more confirmed bugs in the first cut; all fixed:
  1. Bare "$0 Remove <med>" candidate survived the affordability filter while every swap-carrying
     candidate (ARNI-priced) died → EMPTY regimen displayed as the top pick for a cash-tier
     budget patient. Fix: `removable` skips intolerable meds that have a swap alternative.
  2. Swap candidate list was 3 dose tiers of ONE agent (`safeSlice(3)` over tier-expanded list)
     → no affordable-ARB swap ever generated. Fix: reorder to one starting tier per DISTINCT
     agent first (formulary order preserved within).
  3. "Dual MRA prevention" formulary exclusion keyed on the ARRIVING regimen including a
     steroidal MRA being force-removed → finerenone excluded by the departing drug; MRA pillar
     silently lost when the gynecomastia offender was eplerenone. Fix: `isStayingOnRegimen`
     check (skip intolerable/contraindicated current meds when computing currentHas*MRA).
  4. Free-text `reason_detail` substring matches ("no cough", "angioedema ruled out") could
     force-swap tolerated current therapy. Fix: two evidence tiers — `suspected` (free text)
     blocks new starts only; `confirmed` (structured dropdown reason / comorbidity) is required
     to alter current therapy. UI dropdown values all match the keyword families.
  5. nsMRA gynecomastia offender currently on board wasn't flagged (class check was 'MRA' only).
     Fix: MRA_POOL_CLASSES (registry-derived classesWithFlag('mra')) in all MRA-pool checks.
  6. Intolerance swaps missed the +15 mandatory-swap bonus (simulateModificationEffect keyed on
     med.contraindications only) → bare removal could out-rank the swap. Fix: it now also calls
     currentMedIntoleranceReason. Reason strings are advice-free ("antiandrogenic agent
     avoided", not "switch to eplerenone") so they can't recommend an excluded/offending agent;
     hard contraindication takes label precedence over historical intolerance.
- Regression scenarios in verifyScenarios (now 87): 'ACEi Cough Intolerance on Current ACEi',
  'Gynecomastia on Current Spironolactone', 'Dual MRA With Steroidal Intolerance', 'ACEi Cough
  Intolerance Budget-Constrained', 'Gynecomastia From Eplerenone on Spironolactone', 'Negated
  Free-Text Intolerance Detail'. All harnesses green: 87/87, 100/100 audit, 51/51 mistake,
  red-team 0/0/0.
- KNOWN LIMITATION (accepted): the forced swap target is `swappable.candidates[0]` — first
  agent in formulary declaration order (ARNI for RAAS). Under tight budgets the add-pillar
  candidates carry the ARNI price and can be filtered; the diverse standalone ARB swaps keep the
  output safe, but a budget-aware target choice (needs prices plumbed into
  generateCandidateModifications) would be the deeper fix.
- PITFALL: never round-trip CLAUDE.md/README.md through PS5.1 `Get-Content -Raw | Set-Content`
  — it decodes UTF-8 as CP1252 and writes mojibake. Use the Edit tool for doc text changes.

### Mistake-audit pass — 9 real bugs found & fixed (2026-06-12)
Built `scripts/mistakeAudit.ts` (51 scenarios, meds-on-board, common treatment errors;
standalone QA like redTeam.ts — run `npx tsx scripts/mistakeAudit.ts`). Found and fixed:
1. **Dual same-class therapy not deduped** beyond RAAS/MRA. `computeRedundantCurrentMeds` now
   groups by class GROUP and dedupes ALL one-per-group classes (two BBs, two SGLT2i, two loops →
   keep one, deprescribe rest; non-RAAS/MRA keep = higher dose). `detectInappropriateRegimen`
   emits a generic duplicate-class alert. Redundant meds are excluded from swap SOURCES (a
   duplicate must be removed, not swapped to another same-group agent).
2. **Ivabradine offered before BB maximally tolerated** (SHIFT violation) — eligibility now
   requires `bbAtTarget` (BB at its target dose) OR allBBExcluded, not merely "on a BB".
3. **Lateral BB/MRA/SGLT2i swaps** offered as a dose-escalation mechanism — suppressed
   (`TITRATE_NOT_SWAP_GROUPS`); escalate the existing agent via titrate_up unless it's
   contraindicated. RAAS keeps swaps but **upgrade-only** (ACEi/ARB→ARNI); ARNI→ACEi downgrade
   for "target dose" is blocked. Loop keeps swaps (resistance / Furoscix).
4. **ARNI & H/ISDN never titratable** — `Number('24/26')` / `Number('37.5/20')` = NaN made every
   `> currentStrength` comparison false. Titration now compares dose-ORDER INDEX
   (available_doses are low→high), handling combination strengths.
5. **Titrate-to-target scored BELOW keep** — the informational "Titration Interval" guidance was
   counted in `dangerousWarnings` (−10), so titrating GDMT lost to leaving it sub-target. Added a
   `NON_PENALIZED_WARNING_MARKERS` list (titration cadence, elderly, hepatic, routine monitoring).
   "Binder Required" is deliberately STILL penalized (residual hyperkalemia risk).
6. **getDoseTiers never sampled the target dose** for meds whose target ≠ lowest/middle/highest
   (e.g. carvedilol target 25, sampled tiers were 3.125/12.5/50) — target dose now always included
   as a tier so "titrate to target" is a candidate.
7. **Completeness rewarded presence, not dose** — made dose-aware: a sub-target titratable pillar
   earns partial credit (`SUBTARGET_CREDIT=0.6`); single-dose / at-target / at-max = full. So
   up-titration raises completeness and a starting-dose quad no longer reads as "done".
8. **Euvolemic on high-dose loop** (over-diuresis) not flagged — `detectInappropriateRegimen` now
   emits a LOOP DIURETIC OVER-TREATMENT alert (euvolemic + Furosemide≥120 / Torsemide≥50 /
   Bumetanide≥2), esp. relevant when adding SGLT2i.
9. (audit harness) distinctPicks still dedupes by med-NAME so a pure titration looks identical to
   keep — mitigated because dose-aware completeness now makes the titrate candidate out-SCORE keep
   (becomes topPick); not a separate code change.
All: 51/51 mistake audit + 81 scenarios + 17 red-team probes + typecheck + build green.

### Softness audit + aggressiveness fixes (2026-06-12) — still 81 scenarios
User flagged the engine as too "soft" (e.g. obese patients not recommended GLP-1 even with
unlimited budget). Ran an unconstrained audit (budget 999999, maxNew 4, tol 10, cost_sens 0)
across all scenarios comparing indicated vs displayed therapies. Three real mechanisms found
and fixed:
1. **Composite rewarded SMALLER regimens.** Guideline domain (15% × 20 ≈ +3/pillar) was
   out-weighed by cost/adherence penalties, so partial regimens out-ranked complete ones and
   the 3-slot display dropped the rest. FIX: **GDMT completeness bonus** (`COMPLETENESS_MAX=30`,
   in scoring loop) = `30 × (achievable indicated therapies present / achievable total)`. Slots =
   phenotype pillars (HFrEF: RAAS/BB/MRA/SGLT2i; HFpEF: SGLT2i + MRA) PLUS eligible
   disease-modifying adjuncts derived from `analysis.addableAdjuncts` ∩ {If Inhibitor, sGC
   Stimulator, Vasodilator, GLP-1, IV Iron} (symptomatic loop/thiazide/digoxin excluded).
   "Achievable" = a non-excluded formulary med exists (never penalize for a contraindicated
   therapy). Applied BEFORE the SBP/K+ penalties so safety still disqualifies. Stored as
   `gdmt_completeness` (0-1) on ScoredRegimen.
2. **Projected-SBP ranking penalty too punitive.** Was <90→−60, <95→−30 — made hemodynamically
   inert Digoxin out-rank SGLT2i for de-novo patients near SBP 100 (SGLT2i nudged projSBP to 94
   → −30). FIX: recalibrated to <90→−25, <95→−8 (COPERNICUS ≥85, PIONEER-HF ≥100; projected SBP
   is already the conservative pre-compensation value; hard gates input<90/display<85 unchanged).
3. **Display top-3 dropped complete/important options via 100-cap compression.** FIX:
   completeness-aware ranking `byScoreThenCompleteness` = overall_score, then `gdmt_completeness`,
   then UNCAPPED `raw_score` (preserves evidence/SF differentiation the cap erased). Cost is NOT
   a tiebreaker (must not override evidence). `raw_score` stored on ScoredRegimen.
Also fixed: **H/ISDN was wrongly offered to HFpEF** (the "no RAAS" branch fired for de-novo HFpEF
since RAAS isn't a HFpEF pillar) — now gated to `!isHFpEF` (A-HeFT is HFrEF-only); this freed the
display slot so GLP-1 surfaces for obese HFpEF (#3 = Dapa+Tirzepatide).
Results: warm de-novo HFrEF → SGLT2i leads (was Digoxin); obese HFpEF → GLP-1 surfaced; HFmrEF
→ SGLT2i no longer dropped. Remaining audit "findings" are all clinically correct: BB deferred
in congestion (don't initiate until decongested), SGLT2i deferred when volume-depleted, GLP-1
behind 4 pillars in HFmrEF (in adjunct list). **Finerenone-in-HFpEF assertion CORRECTED** (not
weakened): both finerenone (FINEARTS) and steroidal MRA (TOPCAT) are Class IIb HFpEF adjuncts, so
the test now requires nsMRA be eligible + surfaced (regimen or adjunct list), not strictly
out-rank steroidal — they tie within 0.1 raw because both SF bonuses hit the +15 normalization cap.
KNOWN LIMITATION: the SF normalization cap (+15) flattens finerenone (SF45) vs spironolactone
(SF18) — finerenone can't win on raw score; relies on generation order / surfacing.

### Decompensation under-treatment fix — warm vs cold (2026-06-12) — still 81 scenarios
A standard-of-care audit found the engine was NOT aggressive enough for the DEFAULT patient
(John Doe, LVEF 25 NYHA III, on RAAS+BB+loop, missing MRA+SGLT2i): the sole recommendation was
"reduce Carvedilol, add nothing." Root cause (proven, NOT affordability — confirmed at $5000
budget): `isAcutelyDecompensated` (NYHA IV, or NYHA III + >2kg + ≥2 findings) forced BB
down-titration; the candidate filter (`satisfiesForcedBbDownTitration`) then required EVERY
surviving candidate to reduce/remove the BB, but pillar-ADD candidates kept the BB at full dose
and were all filtered out → only the bare BB cut remained. Two fixes ("Both" option):
1. **Gate narrowed to hypoperfusion** (`analyzeCurrentRegimen`): `forceDownBB` now also requires
   `hasHypoperfusion` = cool extremities OR SBP<90 OR pulse pressure ≤25. Warm-and-wet (John Doe,
   SBP 100) CONTINUES the BB and diureses (ACC/AHA 2022); cold-and-wet still forces the reduction.
   BB *initiation* is still blocked for any decompensation (warm or cold).
2. **Forced reduction injected into add-candidates** (`generateCandidateModifications`, block "f",
   mirrors the contraindicated/redundant force-removal pattern): when `forcedBbDownTitrateNames`
   is non-empty, the BB dose cut is injected into every candidate not already reducing/removing/
   swapping it, so SGLT2i/MRA adds survive ALONGSIDE the cut. SGLT2i is beneficial in acute HF
   (EMPULSE/SOLOIST-WHF) and must not be suppressed.
Results: warm John Doe → #1 "Add Dapagliflozin" (BB continued at target). Cold NYHA IV → "Reduce
Carvedilol + Add SGLT2i + Add MRA". Scenario 'Existing BB Requires Down-Titration' given
'Cool Extremities' (now genuinely cold) + assertion strengthened to require a pillar add survives
the forced cut. De-novo/HFimpEF/A-HeFT paths already reached 4-pillar SoC (audit confirmed).
RESIDUAL: composite score still occasionally floats a degenerate single-drug option to #2 (e.g.
Eplerenone alone) — cosmetic, gaps/adjuncts panels surface everything indicated.

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
