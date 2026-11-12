# Adversarial review, 2026-11-12

Scope: the whole tool on branch `refactor/glucosepath-alignment` (PR #1). Method: (1) a seeded randomized-patient sweep with invariants written independently of the engine (`scripts/fuzzSweep.ts`, now `npm run fuzz` and part of the gate); (2) four independent read-only reviews (safety rules, scoring and ranking, formulary data, form and documentation). Every item below was reproduced before it was fixed.

## How the sweep works

- Random patients (many on threshold values: potassium 5.0/5.2/5.4/5.5/6.0/6.5, heart rate 49/50/54/55/59/60, eGFR 19/20/29/30, blanks) with random current regimens, including duplicates and contraindicated combinations a user could type.
- Output integrity: finite numbers, no "undefined"/"NaN" text, every dose on the drug's ladder, score ledger reconciles, never an empty page with no alert.
- Safety invariants restated in the test (not imported from the engine): what must never be started, raised or kept.
- Consistency: same answer when the regimen is typed in another order; ranking mode and care priority change ordering only; an allergy typed in lower case excludes the drug; entering option 1 as the current regimen must not make the tool undo it.

First run: 300 patients produced 8 kinds of violation. After the fixes: 25,000 patients on two fresh seeds produce none, and the second pass removed the last watched code (self-reversal): 0 reversals in 45,000 random patients on three seeds, and the sweep now fails on any reversal, like every other code.

## Systemic defects found and fixed

| # | Defect | Root cause | Fix |
|---|---|---|---|
| 1 | Sacubitril/valsartan 24/26 went to 97/103 mg in one visit; H/ISDN likewise | The dose-step cap compared `Number("24/26")`, which is NaN, so the cap switched itself off | Compare the leading component |
| 2 | Furosemide 80 mg once daily stepped to 160 mg twice daily (4x) | "Next tier is always kept" ignored the tier's frequency | The kept step is the smallest increase in total daily dose |
| 3 | The same drug twice in one option; two oral loops; two MRAs | Candidates are built by combining changes (swap X to Y + add Y) and nothing checked the result | One structural check on every candidate after the forced edits |
| 4 | A new MRA started while the kidney rule was halving the RAAS inhibitor in use; the next run halved the new MRA | The kidney rule covered drugs in use, not new starts | Rule E19 |
| 5 | Spironolactone withheld for potassium 5.5 was swapped to eplerenone | A withheld drug counted as "contraindicated", which allowed a class swap; E15 exempted any patient "on an MRA" | No class swap for a drug withheld by a potassium, heart-rate or kidney rule; E15 exemption needs an MRA that may continue |
| 6 | A loop diuretic doubled in a patient 3 kg below dry weight | The depletion gate covered RAAS/MRA/SGLT2 starts, not diuretic increases | No diuretic increase without congestion |
| 7 | Metolazone to chlorthalidone, patiromer to Lokelma offered as treatment steps | "Titrate, do not swap" listed five class groups; the rest fell through | It is now the default for every group except the RAAS pool |
| 8 | The tool raised a beta-blocker on one run and halved it on the next | Warnings and penalty bands about the patient's existing state were charged to "no change" and relieved by cutting a drug | Baseline warnings are charged to every option; the SBP and HR bands read the lower of projected and entered |
| 9 | An allergy excluded a drug only when typed as the exact formulary name | Free-text box, exact string match | Resolver for case, brand, generic component and class names; unmatched entries are reported |
| 10 | NaN or undefined inputs passed every limit | Gates are written `value < limit`, false for NaN | Normalised to the blank sentinel on entry; blank SBP or weight stops with a named alert; blank heart rate blocks beta-blocker starts and increases |
| 11 | The answer depended on the order the drugs were typed in | First duplicate won; ties broken by array order; floating-point sums compared against thresholds | Higher dose kept and stated; alphabetical tie-break; projections rounded to 2 decimals |
| 12 | A patient with heart rate 43 got an empty page blaming "hypotension / hyperkalemia / bradycardia" | Display floors were absolute, so the unchanged baseline hid every option | BP and HR floors apply only when the regimen worsens the value; the alert names the floor |
| 13 | An iron-deficient patient with a $100 budget saw only over-budget options | IV iron was appended to every candidate before the budget filter | Iron is left off when it alone breaks the budget; the fallback applies safety floors first and drops score-0 options |
| 14 | Anuria did not exclude furosemide, torsemide, bumetanide or chlorthalidone | The check was declared on three of seven diuretics | Declared on all (labels) |
| 15 | Two edema grades counted as two congestion findings; cool extremities counted as congestion | Rules used the size of the findings set | One helper counts by meaning; the form allows one edema grade |
| 16 | Patiromer auto-added at 25.2 g | Rescue tried each tier until projected potassium fit | Rescue adds the label starting dose only |
| 17 | "Re-run" bypassed form validation; Copy/Print worked on stale results | Validation lived in the form button only | Lifted to the app; actions disabled while stale |

Smaller fixes: hypokalemia caution made a diuretic class rule; quadruple-therapy synergy limited to reduced EF; KCCQ clamped; a non-selective beta-blocker is not increased in pregnancy; "rapid weight loss" no longer fires when weight is rising; no natriuretic-peptide line when NT-proBNP is blank; eplerenone pregnancy text no longer cites a letter category.

Top recommendation changed in 41 of 999 golden runs.

## Second pass: the 17 open items, fixed

Every item that the first pass left open now has a systemic fix (commits 7d880af, 27b5e20, 75e830c, 898d6ef, bdf9cbb, b3d4b08). Gate afterwards: verify 371 pass, 0 fail; golden 1032 runs; audit:hundred 100/100; audit:mistakes 51/51; audit:red clean; audit:pricing OK; fuzz 5,000 patients with no violation. Rule-set version 2026-11-12.2.

| # | What was wrong | Systemic fix | How it is enforced |
|---|---|---|---|
| 1 | Sample patients changed when loaded in the form (form recomputes eGFR and BMI) | Form and fixtures share `derivedFields`; each fixture's creatinine and height are fitted to its authored eGFR and BMI | Verify asserts every fixture loads unchanged |
| 2 | Projected potassium fell about 1.2 mEq/L when an MRA was stopped at eGFR below 30 | The renal multiplier applies to rises only; an option that lowers potassium below 3.0 is not shown | Scenario checks; display floor in `selection.ts` |
| 3 | Evidence bonus worth about 7 points on a one-drug regimen | Divisor is the larger of the regimen size and the number of indicated foundational therapies | Verify scenario; golden snapshot |
| 4 | One fact charged twice (a named adjustment plus a generic warning) | `WARNINGS_PRICED_BY_NAMED_ADJUSTMENT`: the warning is shown, charged once | Verify invariant |
| 5 | Coverage shrank when a pillar was staged | Coverage is counted over indicated pillars; the card says "n of m on board; k cannot be started today" | Verify invariant on the counts |
| 6 | "Low cost" meant low relative to the budget | Labels are "Well within budget", "Near the budget limit", "Over budget" | Scenario checks on the label |
| 7 | Six intolerance reasons excluded only the named drug | One table (`INTOLERANCE_TABLE`): exclude, caution, drug only or history flag for every reason; cautions read "Intolerance history:" and are not penalized; the form shows each effect | Verify checks every reason has a declared effect and every caution fires for exactly its classes |
| 8 | Options nothing read (Chronic Kidney Disease, Obesity); AF comorbidity and rhythm disagreed | Two options removed (derived lines shown); `hasAtrialFibrillationHistory`; paroxysmal AF note on ivabradine starts | Verify fails for any selectable option the engine does not read (`DISPLAY_ONLY_OPTIONS` is empty) |
| 9 | Medicare copay (74) above the cash price (60) | Patient cost is capped at the cash price in `getDrugPrices` | `npm run audit:pricing` (in gate and ci) |
| 10 | Several strengths flagged as target (losartan 100 mg) | One target threshold per drug; losartan target is 150 mg | Verify: a dose above an at-target dose is at target |
| 11 | Side-effect rates ignore dose for most drugs | Declared display-only; the formulary card says so | Verify fails if engine code reads them |
| 12 | RAAS increases allowed to potassium 5.4, new starts held above 5.2 | Increases are held above 5.2 as well | Verify: an increase is never allowed where a start is held |
| 13 | US label and ESC table disagree (vericiguat start, losartan target) | Declared as data (`facts.source_differences`), shown on the option and the formulary card | Verify scenario |
| 14 | Contraindicated carvedilol shown as a plain removal in options 2 and 3 | A contraindicated drug with an eligible same-class alternative is switched in every option | Verify scenario |
| 15 | No potassium supplement, amiloride, triamterene or trimethoprim in external medications | `EXTERNAL_POTASSIUM_RAISERS` with two alerts and an option warning | Verify scenarios; option coverage invariant |
| 16 | Copy-to-chart text had no date, rule version or inputs | Text carries run date, `RULESET_VERSION` and the inputs used (blank prints "not entered") | Verify check on the note text |
| 17 | The tool undid its own option on the next run (about 1 patient in 2,000) | Four causes fixed: rescue binder or iron over the per-visit limit or budget no longer discards the option; fewer changes beats the alphabetical tie-break; forced beta-blocker switch lands at or below the start dose in a low-output state; a binder is not reduced while potassium is 5.0 or higher | Fuzz sweep fails on any reversal (no longer a watched code) |

## Still the owner's call

These are judgement calls the fixes introduced. None blocks use.

- Losartan target 150 mg (2026 ESC Table 11, HEAAL) against the US 50 to 150 mg range. Under the new rule 100 mg earns graded credit and can be increased.
- RAAS increases are held above potassium 5.2, the same line as new starts. The ESC text gives 5.2 as a caution, not a ban, so this is engine policy.
- A binder already in use is not reduced at potassium 5.0 or higher (the same boundary as the MRA start rule). Engine policy.
- The top recommendation changed in 25 of 999 reference runs (scoring commit) and 15 more (rule commit). The scoring changes mostly moved toward more pillars on board; a clinician should look at the changed cases before relying on the new order.
- The sacubitril/valsartan Medicare table copay (74) is still in the table; the cap at the cash price (60) hides it. Fix the table when the plan data is next refreshed.

## Third pass (same day): four fresh reviewers and a visit-by-visit probe

Method: four independent read-only reviewers (safety rules, scoring and ranking, drug data, form/results/docs), each required to reproduce a finding with a run before reporting it, plus a new probe that follows the top option for many visits with the inputs unchanged. Commit `fa34d68`.

### Fixed

| Area | Defect (reproduced) | Fix | Enforced by |
|---|---|---|---|
| Rules | Forced beta-blocker switch (pregnancy, allergy) in a low-output state: empty page, no reason | The forced-reduction filter accepts a switch; every empty result names a reason (`NO OPTION AVAILABLE`) | Sweep: `EMPTY_WITHOUT_REASON` |
| Rules | Pregnancy switch landed on the full target dose at heart rate 52, LVEF 15 | Steps down for a low heart rate; lands on the start dose in low output | Reviewer reproduction (not yet a scenario) |
| Rules | Lisinopril doubled, or switched to the ARNI, at eGFR 14 beside an alert saying seek specialist advice | Rule E20: no RAAS start, increase or switch at a measured eGFR below 20 | Sweep: `RAAS_INTENSIFIED_EGFR_LT_20` |
| Rules | "ARB" allergy still offered sacubitril/valsartan; angioedema typed as an allergy was ignored | ARB aliases include the ARNI; allergy text is read for angioedema; ACE inhibitor allergy of unstated type carries a check on an ARNI start | Not yet a scenario |
| Rules | Loop diuretics switched back and forth on alternate visits | The resistance switch is one-way, from furosemide (`facts.resistance_switch_source`) | Sweep: `OSCILLATION` |
| Scoring | ACE inhibitor alternated 20, 40, 20 mg: the low-perfusion NT-proBNP surcharge was escaped by cutting a dose | The surcharge reads the lower of projected and entered MAP | Sweep: `OSCILLATION` |
| Data | Age over 80 halved every dose ladder (no source): no target dose reachable; ivabradine offered as a result | Rule removed; start-low is kept through start tiers, the doubling cap and the elderly warnings | None (removal) |
| Options | "Start a pillar and raise a dose" built only for the first drug of the first pillar | Built for each missing pillar (one agent per class) | Probe only |
| Alerts | Alerts stated a plan the options did not follow; deferred beta-blocker start had no alert; potassium shown to one decimal but ruled on the raw value; MRA restart text gave three thresholds | Alerts reconciled with the options; new alert; potassium rounded on entry; text corrected | Not yet scenarios |
| Warnings | No duplicate-nitrate warning; no aliskiren warning at eGFR below 60 without diabetes; potassium-raiser warning named one drug of two | Added | Not yet scenarios |
| Form | Negative creatinine froze the tab | eGFR function returns 0 for non-positive input; the effect never writes NaN | jsdom mount by the fixing agent |
| Results | Chart note omitted pregnancy, other medications and other inputs; empty-regimen note; pills without frequency; "Euvolemic" from weight alone; custom profile defaults unmarked | Fixed in components | Typecheck and build only |
| Input | Two entries of one drug with the same daily dose: answer depended on typing order | Larger strength wins the tie | Sweep: `ORDER_DEPENDENT` |

Top recommendation changed in 45 of 1,032 reference runs. Sweep after the fixes: 5,000 (gate seed) and 15,000 (fresh seed) patients, no violations.

### Reproduced, NOT fixed (open)

Ordered by how much they matter. Reviewer probe scripts were in a session scratch directory and are not in the repo; each item below has enough detail to reproduce.

1. **RAAS inhibitor dose changes do not move projected potassium.** Every ACE inhibitor, ARB and ARNI has a flat `potassium_change` in `hemodynamic_effects` (constants.ts), while MRAs scale with dose. Halving the dose at potassium above 5.5 projects no fall, so the option keeps the -40 penalty and a binder is attached to a pure dose reduction (about 2% of random patients). Raising the budget can then flip the top pick to "reduce the ACE inhibitor and add a binder" over a cheaper, more complete option. Fix: dose-scale the RAAS potassium effect, and do not attach a binder to an option whose only potassium-raiser change is a reduction.
2. **A current MRA is removed below the eGFR that blocks a new start** (spironolactone below 30, finerenone below 25; constants.ts unconditional checks). The project's own principle is that a start threshold must not remove a drug in use, and the ESC supplement halves the dose at eGFR below 30 and stops below 20. Needs a clinical decision.
3. **Full completeness credit ignores renal dose caps.** Eplerenone 25 mg at its renal maximum scores 0.9 where spironolactone 25 mg scores 1.0; ramipril at its renal cap is under-credited (scoring.ts `gdmtCompletenessFraction`).
4. **Dose reductions have no gentlest-step rule and summaries hide the starting frequency.** "Reduce Furosemide 80 to 40 mg bid" from 80 mg three times daily is 240 to 80 mg/day; "Titrate Furosemide 80 to 80 mg bid" reads as no change. Increases have `smallestStepAbove`; reductions use strength only.
5. **Empty page when a forced MRA removal meets the low-potassium floor** (quadruple therapy plus a loop, eGFR 24, potassium 3.1): every candidate carries the forced removal and projects below 3.0. The page says no display-safe regimen but not that the forced removal is the cause.
6. **Foundational-first mode can rank "no change" above a Class I beta-blocker start** when baseline potassium is already above 5.5 and the beta-blocker's modeled +0.05 counts as harm (selection.ts `isProjectedSafetyClean`). Rare.
7. **"No change" projects NT-proBNP up 20% when the entered MAP is below 65.** Applied to every option equally, so ranking is not distorted, but the displayed projection is misleading.
8. **Special-feature bonus is discontinuous at five or more drugs** (divisor is the larger of regimen size and indicated pillars).
9. **Options 2 and 3 are often option 1 minus one step**, unlabeled; two options can differ only by the SGLT2 inhibitor chosen.
10. **"Cost first" does not order by cost in the over-budget fallback** (the cost score saturates at 0).
11. **Digoxin with amiodarone is kept at 125 mcg** beside a warning saying to reduce it 30 to 50%; clarithromycin has no digoxin text.
12. **Binder prices do not vary with dose** (patiromer and Lokelma flat monthly price). Needs price data.
13. **Formulation strings**: carvedilol 50 mg, metoprolol succinate 12.5 mg, spironolactone 12.5 mg, captopril 6.25 mg and H/ISDN 75/40 are labelled as single tablets; valsartan is labelled a capsule. Feeds only the complexity score.
14. **Flat modeled effects across doses** for ivabradine and metolazone; GLP-1 `weight_reduction_kg` holds a percent; bumetanide's blood-pressure effect is out of line with the other loops at equivalent doses.
15. **Lisinopril 20 to 40 mg is offered as the top option** although 20 mg is already at target (ESC table: 20 to 35 mg).
16. **At potassium 6.0 to 6.4 with nothing potassium-raising left to stop**, the next visit shows no options (the display floor is absolute). An alert is present; whether to show potassium-neutral options is a design decision.
17. **Tests still to write** for the third-pass fixes marked "not yet a scenario" above.
