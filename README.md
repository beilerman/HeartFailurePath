<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# HeartFailurePATH

Deterministic heart-failure regimen simulation and ranking UI built with React + Vite + TypeScript.

## Clinical Scope

HeartFailurePATH simulates projected effects of medication changes for adults with chronic heart failure and ranks regimens using a weighted multi-domain model.

- Follows the 2026 ESC phenotypes: reduced EF (LVEF below 50, including improved EF) and HFpEF (LVEF 50 or higher, never below 50); HFmrEF is no longer a separate phenotype.
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
- Configurable in UI: the "Most new drug classes to start at one visit" slider in the "Patient values and practical limits" section of the patient form.

### 3) Eight-domain scoring (0-100 each)

The overall score is a weighted sum of eight domain scores plus a few named adjustments. The weights sum to 100% and live in `WEIGHT_PROFILES` in `services/engine/scoreModel.ts`. The default (Balanced) row:

- Neurohormonal `15%`
- Functional `12%`
- Volume `12%`
- Structure `8%`
- Guideline concordance `12%`
- Therapy completeness `22%`
- Cost `12%`
- Adherence `7%`

Therapy completeness is one of the eight domains: the share of indicated, achievable therapies on board (pillars plus eligible adjuncts such as GLP-1 in obesity), with graded credit for a dose below target. There is no separate completeness bonus. The adjustments (evidence bonus, safety penalties) are visible line items in each regimen's score breakdown, and safety penalties still override. The "What matters most to this patient?" setting swaps the weight row only; it never changes eligibility, alerts or display floors.

Displayed options are ranked by displayed score, then completeness, then uncapped raw score, then cost as a final
tiebreaker. Cost must not override an evidence-based preference, but among clinically indistinguishable
regimens the cheaper option wins. Budget-constrained outputs should be read as best affordable interim
options, not proof that complete GDMT is financially reachable.

### 4) Hard safety gates and output filters

- Input hard stop: `SBP < 90` -> no regimen output, alerts only.
- Input hard stop: baseline `K+ >= 6.5` -> alerts only (hyperkalemic emergency); `K+ >= 6.0` fires a HYPERKALEMIC EMERGENCY alert (ECG, urgent treatment).
- Input hard stop: physiologically impossible values (e.g. `LVEF > 80`, `K+ > 8`) -> verification alerts only, no recommendations computed on suspect data.
- Display safety filter: excludes regimens with projected `SBP < 85`, `K+ > 6.0`, or `HR < 45`. The blood-pressure and heart-rate floors apply only when the regimen moves the value the wrong way from the entered baseline; the potassium floor is absolute. When nothing passes, the alert names the floor that was broken.
- Pregnancy: new beta-blocker starts are limited to beta-1-selective agents and carvedilol is switched (2026 ESC Class I C). Exclusions: RAAS classes, steroidal/non-steroidal MRAs, SGLT2 inhibitors, vericiguat (boxed warning), ivabradine, and GLP-1 therapy are excluded. H/ISDN remains available as the RAAS alternative.
- Nitrate + PDE5 inhibitor (sildenafil, tadalafil, vardenafil, avanafil) or riociguat exposure: H/ISDN is hard-excluded from the formulary and force-removed from an arriving regimen (absolute contraindication — fatal hypotension risk).
- Acute decompensation handling: blocks beta-blocker initiation and defers up-titration in ANY decompensation (warm or cold); forces existing beta-blocker dose reduction (one step, ~50%) only with hypoperfusion (cold-and-wet), continues it for warm-and-wet; safe additions (esp. SGLT2i) are still offered alongside any mandated reduction.
- Blank safety-critical data (eGFR/creatinine or K+ = 0/empty) is treated as "not entered" — it never clears a safety gate and never reads as end-stage disease. Renal-gated new starts are withheld pending a BMP; retained meds and RAAS/MRA/SGLT2i intensification carry explicit data-unknown warnings and ranking penalties.
- Initiation-vs-continuation carve-outs: trial-enrollment criteria (vericiguat VICTORIA markers, GLP-1 `BMI >= 30` and LVEF >= 45 semaglutide / >= 50 tirzepatide, SGLT2i eGFR floor: dapagliflozin 25, empagliflozin 20) gate initiation only — patients already on the drug are not force-removed for improved markers; true safety contraindications still force removal.
- MRA potassium rules (2026-11-10, source-verified): new starts above K+ 5.5 are never offered; a new RAAS inhibitor start above K+ 5.2 is not offered either (rule E18, same staging; the binder rescue applies to existing therapy only); a new MRA start at K+ 5.0 or higher is not offered, with or without a binder (rule E15: recheck and start once K+ is below 5.0; decision 2026-11-11, boundary per the 2022 US text); a new spironolactone start at eGFR 30 or lower is not offered, and spironolactone/eplerenone are capped at 25 mg below eGFR 50; an MRA already on board drops one dose step at K+ 5.5-5.9 and is withheld at 6.0 or above. Eplerenone/finerenone are contraindicated with strong CYP3A4 inhibitors; finerenone and spironolactone with adrenal insufficiency; finerenone dosing follows eGFR (start 10/20 mg, target 20/40 mg).
- Rate-control rules (2026-11-10, source-verified): resting HR below the drug's threshold on an established beta-blocker forces a one-step dose reduction with an alert (withhold only at the lowest dose, or for AV block / sick sinus syndrome without a pacemaker). The threshold is 55 for carvedilol (label) and 50 for metoprolol succinate and bisoprolol (2026 ESC Supplementary Table S6); no beta-blocker up-titration below HR 60 (engine policy); new beta-blocker starts are blocked below the same drug-specific threshold. With heart rate not entered, a beta-blocker or ivabradine is neither started nor increased (2026-11-12). Carvedilol efficacy is capped at the 25 mg bid level and the three beta-blockers are modeled equal at target. Carvedilol is contraindicated in severe (or unspecified Child-Pugh B/C) hepatic impairment only; metoprolol is a caution. Ivabradine has the full Corlanor contraindication set (strong CYP3A4 inhibitors, hepatic, sick sinus, paced rhythm, decompensated HF), a 2.5 mg tier, HR-guided titration and an initiation-only HR >= 70 criterion. Digoxin is offered in any rhythm for NYHA II-IV with LVEF 40 or below once foundational therapy is exhausted (2026 ESC IIa B1), and in atrial fibrillation for rate control once the beta-blocker is optimised; ventricular fibrillation excludes it and WPW warns.
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

### 6) Adversarial review changes (2026-11-12)

- Eligibility rule E19: no NEW RAAS inhibitor or MRA while the entered baseline creatinine shows the "reduce" band (rise of 50% or more, or derived eGFR fall over 30%). Rules are now E01-E19. Second pass (2026-11-12): all 17 open items of the review are fixed, see `docs/adversarial-review-2026-11-12.md` (the form and fixtures share one derived-field function; a RAAS increase is held above potassium 5.2 like a new start; losartan target is 150 mg; the cost label reads "Well within budget / Near the budget limit / Over budget"; the Chronic Kidney Disease and Obesity checkboxes are gone because nothing read them). The E15 "already on an MRA" exemption applies to a within-class switch only while that MRA may continue (potassium below 5.5).
- Dose steps: the one-step cap also covers combination strengths (sacubitril/valsartan 24/26 cannot jump to 97/103; H/ISDN likewise). The always-kept next step is the smallest increase in total daily dose when the next strength at its usual frequency would more than double it (furosemide 80 mg once daily goes to 80 mg twice daily).
- Every candidate is checked after the forced edits; a regimen listing the same drug twice, two agents of one class group, or a short-course add-on without its oral loop is dropped.
- Lateral swaps: outside the RAAS pool a swap is offered only when the current drug must go (contraindication, intolerance, allergy) or the loop-resistance rule fires. A drug withheld by a potassium, heart-rate or kidney rule is never swapped for a sibling, and a contraindicated diuretic in a non-congested patient is stopped, not replaced.
- Diuretics are not increased when the patient is more than 1 kg below dry weight, or at or below dry weight with no congestion finding. Edema counts as one congestion finding whatever the grade and cool extremities (a perfusion sign) are not counted; the form allows one edema grade at a time.
- Any loop or thiazide-type diuretic added, swapped in or increased with a measured potassium below 3.5 carries a penalized hypokalemia caution (was metolazone only). Anuria is a contraindication check on all loop diuretics and chlorthalidone.
- Scoring: the projected SBP 90/95 bands and the HR below 50 band read the lower of the projected and the entered value, so a dose reduction is not rewarded for leaving a band. Penalized warnings already true of the current regimen are charged to every option, so no option beats "no change" merely by cutting a drug until a state warning stops firing. The quadruple-therapy synergy applies to the reduced-EF phenotype only, and KCCQ is clamped to 0-100.
- Selection: ties break alphabetically (the answer does not depend on the order drugs were typed) and projected SBP, HR and potassium are rounded to 2 decimals. In the over-budget fallback the safety floors are applied before taking the five cheapest, and a regimen scored 0 is not shown merely because it is cheap. The automatic IV iron add-on is left off when it alone would push a regimen over budget.
- Rescue binder: patiromer is auto-added at its label starting dose only (8.4 g daily).
- Inputs: NaN, missing or negative numeric inputs are treated as "not entered" (0). A blank systolic BP, current weight or dry weight stops the run with a DATA REQUIRED alert naming the field. A duplicate current drug keeps the higher dose and says so.
- Allergies: free-text entries are resolved to formulary drugs ignoring case and spacing, by generic, brand or class name (for example "ACE inhibitors"). An entry matching nothing raises an ALLERGY NOTE and the form shows what each entry excludes. A new formulary drug needs its brand names added to `ALLERGY_ALIASES_BY_DRUG` in `constants.ts`.
- Pregnancy: a non-selective beta-blocker that cannot be switched is kept, never increased.
- UI: Re-run obeys form validation; Copy and Print are disabled while results are stale; the results pane has its own error boundary; the low-output hint uses the engine's two-of-three rule; the potassium hint covers 5.2, 6.0 and 6.5.

## Verification Strategy

Clinical logic is guarded by a four-harness QA gate. `npm run verify` is the CI regression gate;
the three audit harnesses are standalone (not part of CI) but are part of the full pre-release gate (`npm run gate`).

| Harness | Command | Pass criteria |
|---------|---------|---------------|
| Scenario assertions (`scripts/verifyScenarios.ts`) | `npm run verify` | All pass: `371` on 2026-11-12 (333 clinical scenarios + 38 structural checks); the harness output is authoritative |
| Adversarial red team (`scripts/redTeam.ts`) | `npm run audit:red` | 0 CRITICAL / HIGH / MEDIUM findings |
| Treatment-error audit (`scripts/mistakeAudit.ts`) | `npm run audit:mistakes` | 51/51 clean |
| Broad clinical audit (`scripts/hundredScenarioAudit.ts`) | `npm run audit:hundred` | 100/100 clean |

- CI command: `npm run ci` (typecheck + build + golden + verify + pricing audit + fuzz). The fuzz sweep (`scripts/fuzzSweep.ts`, 5,000 seeded patients; any violation, including the tool reversing its own advice on the next run, fails it) and `npm run audit:pricing` are also part of `npm run gate`.

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
npm run verify           # scenario assertion harness (its printed count is authoritative; currently 371 passing)
npm run test             # alias of verify
npm run golden           # golden master: every scenario under three insurance tiers must be byte-identical (1032 runs)
npm run golden:update    # rewrite the golden master after an intended output change (review the diff first)
npm run ranking:diff     # compare the current engine with the golden snapshot and report what an intended scoring change did to the ranking (run before golden:update)
npm run audit:pricing    # every drug under every plan: patient cost never above the cash price, tiers consistent
npm run fuzz             # seeded randomized-patient sweep (5,000 patients): safety invariants written independently of the engine, plus consistency checks (same answer when the regimen is listed in another order; ranking mode and care priority change ordering only; an allergy typed in lower case still excludes the drug)
npm run audit:red        # adversarial red-team probes (standalone)
npm run audit:mistakes   # 51-scenario treatment-error audit (standalone)
npm run audit:hundred    # 100-scenario broad clinical audit (standalone)
npm run gate             # full pre-release gate: typecheck + golden + verify + the three audits + audit:pricing + fuzz
npm run ci               # typecheck + build + golden + verify + audit:pricing + fuzz
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
  scripts/         # verifyScenarios, goldenMaster, fuzzSweep, rankingDiff, redTeam, mistakeAudit, hundredScenarioAudit
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
