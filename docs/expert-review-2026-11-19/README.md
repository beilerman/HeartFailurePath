# Readiness for expert review: work to date

**Round 11 came back clean on 2026-11-23: all three independent reviewers (clinical, engine, screen and packet) rated rule set 2026-11-22.4 ready for the expert panel, with no blocking finding.** Eleven adversarial rounds are done. The reviewers' minor findings are listed under "Round 11" below; none was fixed in code, so the tree the reviewers examined is the tree in this commit.

For the branch, reproduction commands and next reviewer, see the [November 23 handoff](../HANDOFF-2026-11-23.md).

## Local code review, rule set 2026-11-22.4

| Reproduced failure | Repair |
|---|---|
| A recorded dialysis condition could produce three medication options and a message that the patient passed the scope check. | Match recorded scope conditions to the supported identifiers and labels. Unreadable entries block ranking and ask for reconciliation. |
| A held medication could be described as current. An incomplete medication list could produce a statement that the patient took no relevant drug. | Use the reconciled formulary records and recorded use status for alerts, options and the current-regimen summary. When reconciliation fails, identify the uncertainty and retain independently supported urgent findings. |
| “Rales” and “Crackles” together counted as two congestion findings. Rejected observations could trigger monitoring or appear as accepted findings. | Count distinct exam findings. Check the prerequisites for alerts, monitoring and form hints. An extreme potassium entry prompts immediate verification and urgent assessment if accurate. |
| An option known to exceed the budget could pass the affordability filter whenever any other option lacked a price. | Apply the entered budget to every option with a known cost. Identify the remaining options whose affordability cannot be assessed. |
| Reload could silently remove an unrecognized medication or drop a new full-form case. A dose correction could erase the recorded hold and allow bulk confirmation to reactivate the drug. | Validate complete saved regimens before restoring a case. Show a recovery message on failure. Preserve editable drafts and held, completed or explicitly uncertain use when correcting doses. |
| The red-team audit returned success with high-severity findings. Some random checks skipped exceptions, and the reference comparison could create a missing baseline or silently skip a symlinked invocation. | Fail on serious findings, unexpected exceptions, invalid sweep arguments and missing reference data. CI now calls the full local verification suite, including all three clinical audits. Reference updates require the explicit update command. |

Regression coverage includes `scripts/systemicReviewChecks.ts`, `scripts/verifyClinicalUi.tsx`, `scripts/verifyScreenExplain.tsx` and `scripts/verifyPartBChecks.tsx`. The existing 45-case expert packet was regenerated against this rule set. The reviewed baseline was preserved.

The potassium message follows the existing engine warning and guidance for severe hyperkalemia detected in the community. [UK Kidney Association, guideline 4.1](https://guidelines.ukkidney.org/hyperkalaemia/10-1-i-hyperkalaemia-in-the-community-guidelines-1-1-12-1/10-1-4-i-hyperkalaemia-in-the-community-guidelines-4-1-4-2/)

### Results and remaining clinical questions

- All 1,032 reference runs matched on the fields the saved comparison covers. The separate ranking comparison found identical first choices, displayed options, order, eligibility, alerts and per-option warnings.
- The production build, type checks, 910 scenario checks, 1,000 packet checks across 45 cases and 181 rendered-interface checks passed. The focused audits reported 100/100 and 51/51 clean cases, zero critical, high or medium red-team findings, and passing prices for 32 drugs across three profiles. The package audit reported zero known advisories. Node 22 also passed type checking and the reference comparison.
- Two sweeps of 5,000 synthetic patients each, starting at seeds 20261112 and 791342, found zero violations. Another 439 deliberately malformed inputs produced zero failures against the no-crash, no-ranking and independent-alert checks.
- A deliberately failing copy of the red-team audit returned a failure status on 19 injected high-severity findings. A missing reference file and two zero-patient sweeps also returned failure.
- Headless Chrome exercised the production build at widths of 390 and 1,440 pixels. The exercised workflows included full-form reload, preventing a view switch while an entry is unfinished, correcting the dose of a held medication and recovering to a blank case after a damaged session. To repeat against a local server, run `node scripts/verifyBrowserSession.mjs`. Set `HF_BASE_URL` for the server and, if needed, `HF_PLAYWRIGHT` and `HF_CHROME` for the installed browser tooling.
- The exploratory guideline comparison reproduced four of seven prespecified targets. All three differences concerned the existing decision to offer finerenone at LVEF 41%, 45% and 49%. The historical score and the trial evidence answer different questions. The locally reviewed code retains this documented policy for adjudication. [2026 ESC heart failure guideline](https://www.escardio.org/guidelines/clinical-practice-guidelines/all-esc-practice-guidelines/heart-failure) and [FINEARTS-HF trial](https://pubmed.ncbi.nlm.nih.gov/39225278/).

The local review used synthetic cases. Clinical validity, the ranking weights and the remaining open decisions require independent review. [Expert policy questions](panel/3-policy-questions.md)

## Goal and method

The owner's instruction (2026-11-19) was to loop adversarially until the tool is ready for formal review by heart failure experts. One round is:

1. Three fresh reviewers, each with no memory of earlier rounds, attack one area: clinical (constructed patients, rated one by one), the engine (random and forced-state sweeps of tens of thousands of patients), and the screen, evidence and expert packet (real browser renderings, every sentence on the panel pages checked against the code).
2. The controller writes a fix plan from their findings, with a ruling per item.
3. A fixer applies it test first: each fix has a check that fails before the fix and passes after, plus a generated check over thousands of patients for the whole class of fault.
4. The controller re-runs every automated check, compares the 1,032 reference runs before and after, and refreshes the reference only after reviewing what changed.

A round is clean when all three reviewers say ready. The owner ruled (2026-11-20, ruling 10) that a clean round is the point to commit and push. This commit was made earlier than that, at the owner's direct request on 2026-11-22, so that the work is recorded.

## Where the working files are

| What | Where |
|---|---|
| Owner's rulings | `owner-rulings-2026-11-20.md` (this folder) |
| Expert packet: scope, limitations, policy questions, rating form, 45 cases | `panel/` |
| First-option comparison saved before each reference refresh | `ranking-roundN-before-update.txt` |
| Evidence status of every number the tool uses | `evidence-status.md`, `influence.json` |
| Checks added by each round | `scripts/engineReadinessR*Checks.ts`, `scripts/verifyR*Ui.tsx`, `scripts/engineReadinessR*Sweep.ts` |
| Reviewer reports, fix plans and fixer reports for every round | outside the repository, on the owner's Mac: `~/Projects/HeartFailurePath-readiness/` (`criteria-rN.md`, `rN-clinical/`, `rN-engine/`, `rN-screen-evidence/`, `fix-spec-rN.md`, `fix-rN/`), each with a `final-message.md` |

## What each round found

| Round | Rule set after fixes | Verdicts | Main findings fixed |
|---|---|---|---|
| 1 and 2 | 2026-11-19.3 | not ready | Evidence repair after an independent audit of every number; engine safety and consistency (unstable patients); the screen and draft note made to explain why an option is first |
| 3 | 2026-11-21.1 | not ready | Rulings U1 to U14, and the owner's rulings of 2026-11-20 applied (out-of-scope conditions show no options; "No medication change" first within one point; the switch to sacubitril/valsartan counts toward the two-per-visit limit) |
| 4 | 2026-11-21.3 | not ready | Rulings W1 to W11, X1, X2 (finerenone uses the rows measured for the patient's ejection fraction). Details of rounds 1 to 4 are in the notes at the top of `CLAUDE.md` |
| 5 | 2026-11-21.4 | engine ready, screen ready, clinical not ready (two false sentences) | Blood pressure not entered read as zero; reason for a forced dose reduction; two new alerts (congestion without weight gain, possible poor perfusion) |
| 6 | 2026-11-21.5 | not ready | Allergy text reading; same-class allergy check; switch to sacubitril/valsartan held above potassium 5.2 (six reference first options changed; accepted by the owner 2026-11-21); packet grown to 45 cases |
| 7 | 2026-11-21.6 | not ready | Trade-off labels; alerts reconciled with the options actually shown; sentence allergy reader |
| 8 | 2026-11-22.1 | all three not ready | Two safety faults introduced by round 7 (an empty screen for a patient taking a drug they are allergic to; an allergy named after a slash ignored); false loop-diuretic and potassium sentences |
| 9 | 2026-11-22.2 | all three not ready, narrowly | One more empty screen (oral loop allergy plus Furoscix); a forced-switch reason printed after the wrong drug; false loop-total and potassium rows |
| 10 | 2026-11-22.3 | engine ready; clinical and screen not ready | See below |
| 11 | 2026-11-22.4 (no code change after review) | all three ready | Reviewed the round 10 fixes and the separate engineering review of 2026-11-22. Nothing blocking |

### Round 11 in detail

Reports: `r11-clinical/final-message.md`, `r11-engine/final-message.md`, `r11-screen-evidence/final-message.md` in the working folder; criteria in `criteria-r11.md`.

- Clinical: 236 constructed patients through the engine, screen and draft note, and 23,000 random patients (seeds from 50,000,000). No patient rated unsafe or rejected; 25 questionable, about 45 defensible, the rest acceptable.
- Engine: 235,000 paired runs against commit `ed260b6`: no difference in options, order, eligibility, warnings or scores; alert text differs in 0.5% of random patients, every difference explained. 19,316 empty-screen attacks: none unexplained. No earlier check was loosened by the 2026-11-22 engineering review.
- Screen and packet: all 45 cases recomputed and matching; section D recomputed within one point; the browser run passed at 390 and 1,440 pixels.

Minor findings left as they are (changing code would make the reviewed tree and the committed tree differ). They are the starting list for any further pass:

1. A held or completed record of another loop diuretic stops a raise of the loop diuretic the patient takes, and the note names a missing prerequisite instead of that cause (clinical M1; same behaviour before 2026-11-22.4).
2. A drug recorded as held or completed that matches a listed allergy no longer raises ALLERGY CONFLICT; the drug is still never offered, and EXPOSURE HISTORY asks whether to restart without naming the allergy (clinical M2, engine M1).
3. The "without a loop diuretic" warning can give "already at the highest dose" as the cause when the loop is being removed for an allergy and the kidney value is blank (engine M2; 0 of 5,000 random patients).
4. In the low-output state the forced loop replacement is the first eligible loop, not the ranked one (engine M3; panel question 29).
5. Potassium above 8.0 shows only the verify-the-value message, with no ECG or hold instruction (clinical M5).
6. The AV-block alert says no rate-slowing drug is recorded beside a held or unreadable beta-blocker (clinical M3).
7. The Review step and print header count only active drugs, so a held drug named in a warning is not in the count (screen 6).
8. "Choose a different patient" and "New patient" clear the entered case without asking (screen 7).
9. Two example-card descriptions overstate what the card shows (screen 8); "nsMRA" in one benefit line (engine M5); the Evidence tab row HF-SCORE-004 says "up to five" where the screen shows three (screen 5); case 14's kidney alert quotes the creatinine rise where the eGFR fall is the trigger (screen 10).
10. Reachable only by calling the engine directly, not through the form: mixed known and unknown prices with a budget; a bad strength dropping that drug's own alerts (the emergency alert stays).

The pattern in rounds 7 to 10: each fix round removed the faults found and introduced a smaller number of new ones, found a round later. From round 9 the fix plans therefore require the smallest possible change and a generated check for every new sentence.

### Round 10 in detail

Engine reviewer: ready. About 19,000 constructed attempts to empty the option list (every formulary drug forced off by allergy, intolerance or contraindication, alone and in combination) found none unexplained; no option kept an allergen; the allergy reader lost no real allergy in about 98,000 entries.

Clinical reviewer (163 constructed patients: 110 acceptable, 39 defensible, 10 questionable, 4 rejected, none unsafe) and screen reviewer (604 browser renderings, no console error) found:

- A congested patient whose only loop diuretic is Furoscix had it removed in every option with no oral loop started.
- A cold, congested patient taking a loop diuretic they are allergic to was offered only its removal.
- A change line that said "Remove" with a reason that said "reduce one dose step" (round 9's shortening of reasons dropped the clause that explained it).
- A note saying no loop step was available, on an option that switched the loop.
- One false sentence on the Evidence tab and two on the policy page.

Fixes applied (rulings A1 to A12 in `fix-spec-r10.md`):

- Furoscix alone no longer counts as an oral loop already taken, so the oral loop start is offered as for the same patient without Furoscix.
- In the low-output state a loop diuretic that must stop may be replaced when congestion is recorded, as the scope page already said.
- Every option that leaves a congested patient with no loop diuretic carries a warning saying so and why. The rules that cause it (unconfirmed use, potassium below 3.5, allergy to every loop) are unchanged.
- The potassium reason at the lowest dose says the drug is withheld; the false note, the Evidence tab sentence and nine smaller wording items are corrected.
- Round 9's Furoscix rule was found to act also on options that add Furoscix; it is now limited to Furoscix the patient already takes.

The first two are controller rulings that change what the tool offers. They are listed under open decisions for the owner.

## State of the tool at this commit

Rule set `2026-11-22.4`. See `CLAUDE.md` and `memory.md` at the repository root for the commands and the per-round notes. All automated checks pass on the owner's Mac at this commit (typecheck, reference comparison over 1,032 runs, scenario and packet checks, screen checks, the three audits, the pricing audit, the random sweep, and the build). The pull request is not merged; merging to `main` deploys to production and needs the owner's explicit instruction.

## Open decisions for the owner

These were decided by the controller so that work could continue. Each stands until the owner says otherwise.

1. Potassium-binder dose credit (round 4, U14).
2. Finerenone counts as the MRA pillar from ejection fraction 41 although it may be started from 40.
3. Typed allergy sentences: a negated sentence ("tolerates lisinopril") still excludes the drug named; stated on screen and on the limitations page.
4. Screens with no option carry one fixed sentence.
5. Semaglutide and tirzepatide are one family for the allergy warning; valsartan carries the warning after an allergy to sacubitril/valsartan.
6. Round 10: Furoscix alone does not count as an oral loop diuretic; a loop diuretic that must stop may be replaced in the low-output state when congestion is recorded.
7. Earlier controller rulings U15, X1, X2, Y3, Y4, Z1 (in the fix plans).

Questions already put to the panel instead of decided here are on `panel/3-policy-questions.md` (32 questions, including Furoscix as the only loop diuretic and loop replacement in the low-output state, including the six weights, the potassium thresholds, the definition of low output, and carvedilol after recorded bronchospasm).

## How to continue

1. The packet in `panel/` goes to the experts: 45 prepared cases with a short rating form, and the policy questions.
2. Any further code change (for example the round 11 minor findings above) needs its own fix plan, controller verification, refreshed reference and a fresh review round before the packet is regenerated.
3. The pull request is not merged; merging to `main` deploys to production and needs the owner's explicit instruction.
