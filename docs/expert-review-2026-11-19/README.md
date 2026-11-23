# Readiness for expert review: work to date

Status on 2026-11-22: **not yet ready for the expert panel.** Ten rounds of adversarial review are done. Round 10 was not clean; its fixes are applied and pass every automated check, but no reviewer has yet examined them. Round 11 is the next step.

This page is the record of that work: what was done, what each round found, what state the tool is in, what is still open, and how to continue.

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

See `CLAUDE.md` and `memory.md` at the repository root for the rule set, the commands and the per-round notes. All automated checks pass on the owner's Mac at this commit (typecheck, reference comparison over 1,032 runs, scenario and packet checks, screen checks, the three audits, the pricing audit, the random sweep, and the build). The pull request is not merged; merging to `main` deploys to production and needs the owner's explicit instruction.

## Open decisions for the owner

These were decided by the controller so that work could continue. Each stands until the owner says otherwise.

1. Potassium-binder dose credit (round 4, U14).
2. Finerenone counts as the MRA pillar from ejection fraction 41 although it may be started from 40.
3. Typed allergy sentences: a negated sentence ("tolerates lisinopril") still excludes the drug named; stated on screen and on the limitations page.
4. Screens with no option carry one fixed sentence.
5. Semaglutide and tirzepatide are one family for the allergy warning; valsartan carries the warning after an allergy to sacubitril/valsartan.
6. Round 10: Furoscix alone does not count as an oral loop diuretic; a loop diuretic that must stop may be replaced in the low-output state when congestion is recorded.
7. Earlier controller rulings U15, X1, X2, Y3, Y4, Z1 (in the fix plans).

Questions already put to the panel instead of decided here are on `panel/3-policy-questions.md` (30 questions, including the six weights, the potassium thresholds, the definition of low output, and carvedilol after recorded bronchospasm).

## How to continue

1. Write `criteria-r11.md` from `criteria-r10.md` and `fix-r10/final-message.md`; launch three fresh reviewers (seeds from 50,000,000).
2. If any reviewer says not ready: fix plan, fixer, controller verification, refresh the reference, next round.
3. When a round is clean: update `CLAUDE.md`, `memory.md` and this page, commit, push to the pull request (not merge), confirm the automated checks on GitHub, and update the pull request description.
4. Then the packet in `panel/` goes to the experts: about 45 prepared cases with a short rating form, and the policy questions.
