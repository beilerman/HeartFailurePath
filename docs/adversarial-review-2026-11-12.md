# Adversarial review, 2026-11-12

Scope: the whole tool on branch `refactor/glucosepath-alignment` (PR #1). Method: (1) a seeded randomized-patient sweep with invariants written independently of the engine (`scripts/fuzzSweep.ts`, now `npm run fuzz` and part of the gate); (2) four independent read-only reviews (safety rules, scoring and ranking, formulary data, form and documentation). Every item below was reproduced before it was fixed.

## How the sweep works

- Random patients (many on threshold values: potassium 5.0/5.2/5.4/5.5/6.0/6.5, heart rate 49/50/54/55/59/60, eGFR 19/20/29/30, blanks) with random current regimens, including duplicates and contraindicated combinations a user could type.
- Output integrity: finite numbers, no "undefined"/"NaN" text, every dose on the drug's ladder, score ledger reconciles, never an empty page with no alert.
- Safety invariants restated in the test (not imported from the engine): what must never be started, raised or kept.
- Consistency: same answer when the regimen is typed in another order; ranking mode and care priority change ordering only; an allergy typed in lower case excludes the drug; entering option 1 as the current regimen must not make the tool undo it.

First run: 300 patients produced 8 kinds of violation. After the fixes: 25,000 patients on two fresh seeds produce none, apart from the watched self-reversal code (about 1 patient in 2,000; ceiling 1 in 500).

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

## Found, not changed (owner's judgement or larger work)

1. **Sample patients change when loaded in the form.** The form recomputes eGFR (CKD-EPI) and BMI, so 314 of 333 scenarios run in the browser with a different eGFR than the regression suite checks, and 85 cross a rule cut-off. Fixing it means regenerating the fixtures.
2. **Projected potassium is unreliable on the low side.** Removing an MRA at eGFR below 30 projects a fall of about 1.2 mEq/L because the renal risk multiplier is applied to removals too. For that reason no low-potassium display floor was added; hypokalemia has cautions only.
3. **Special-feature bonus** is divided by the number of drugs, so a 3-point tolerability note is worth about 7 points on a one-drug regimen (eplerenone alone can lead a three-pillar start by one point at SBP 98), and large evidence differences clamp to the same +12.
4. **Penalty stacking:** a projected-state fact can cost a named adjustment and a warning (projected SBP below 90: -20 and -8).
5. **Coverage figures shrink when a pillar is staged** (potassium 5.3: "foundational coverage 80%" with two of four pillars on board).
6. **"Low cost" label** is relative to the stated budget (a $953/month regimen is "low cost" under a large budget).
7. **Intolerance reasons** hypotension, kidney injury, rash, liver toxicity, fatigue and gout exclude only the named drug, not its class.
8. **Options nothing reads:** "Chronic Kidney Disease" and "Obesity" comorbidities; the atrial fibrillation comorbidity and the rhythm field are separate and can disagree.
9. **Pricing:** sacubitril/valsartan Medicare copay (74) exceeds its cash price (60).
10. **Target-dose flags:** several drugs flag more than one strength as target (losartan 100 mg counts as at target; ESC lists 150 mg).
11. **Side-effect probabilities** are the same at every dose for most drugs.
12. **RAAS up-titration** is allowed up to potassium 5.4 while a new start is held above 5.2 (documented policy, left as is).
13. **Vericiguat start dose:** the US label (revised January 2026, read on DailyMed) starts at 5 mg, 2.5 mg if at risk of hypotension; the 2026 ESC table lists 2.5 mg. The tool follows the label.
14. **A contraindicated beta-blocker** (carvedilol with asthma) can appear as a plain removal in options 2 and 3 when option 1 offers the switch to a selective agent.
15. **External medication list** has no potassium supplements, amiloride/triamterene or trimethoprim.
16. **Copy-to-chart text** carries no patient inputs, date or rule version.
17. **Residual self-reversal:** about 1 random patient in 2,000, mostly the over-budget fallback and single-option outputs in extreme patients.
