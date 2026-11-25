# Sensitivity of the first option to the open policy decisions

Measurement only. Every number below was produced by running the engine; nothing is estimated. Nothing was kept.

## How it was run (read this first)

- The assigned worktree was at commit 5db3fc4 (main). It does not contain `services/engine/`, the first-principles README, `rankingDiff.ts` or `guidelineReproduction.ts`: those exist only in the owner's checkout as uncommitted work (head 461eb99 plus working tree, rule set 2026-11-16.1). I did not write to the owner's checkout. I copied its working tree (without node_modules, .git, dist) to a scratch folder and ran everything there: `<scratchpad>/sens/` (`pristine/` = untouched copy, `repo/` = the copy edited per variant and reset from `pristine/` before each variant, `out/` = raw outputs per variant). The assigned worktree was left unchanged (the node_modules symlink I first made there was removed; `git status` is clean).
- Baseline on that copy reproduces the README: `ranking:diff` 1,032 of 1,032 first options identical; `guideline:report` 73.01 / 806 of 1,011 (79.7%) / 861 of 1,011 (85.2%) / 3 of 7 targets, 4 missed.
- For every variant I ran `ranking:diff` and `guideline:report` (both unmodified scripts) plus a throwaway dump (`dump.ts`) that records each run's first option. Column (i) counts runs whose first option's regimen (drug, dose, frequency) differs from the baseline engine; the dump count and the `ranking:diff` "top pick identical" count agreed exactly in all 37 runs.
- "Runs" = 344 scenarios x 3 insurance tiers = 1,032. 21 of them have no option at all (hard stops), so they never change. Concordance figures use the 1,011 runs that have a lead in both engines.
- (iii) "tracked targets" are the 7 definitions in `scripts/guidelineTargets.ts`: A (LVEF 45 reduced-EF standalone: lead has an SGLT2 inhibitor), B (Furoscix short course displayed), E (LVEF 42 obese: some option has an SGLT2 inhibitor), F (HFpEF finerenone case: every option has an SGLT2 inhibitor), D x3 (no finerenone at LVEF 41, 45, 49). Baseline met: A, E, F. Missed: B, D41, D45, D49.

## Results table

(ii) = mean guideline concordance of the first option (baseline engine 73.01; the frozen guideline-driven engine a6cb28f = 73.37) / runs where the first option's concordance is at least the old lead's (of 1,011) / runs where the first option has the highest concordance among the displayed options (of 1,011).

| Variant | (i) first option changed (of 1,032) | (ii) mean / at least old lead / highest of displayed | (iii) targets met (of 7) | Targets that changed |
|---|---|---|---|---|
| Baseline (unmodified) | 0 | 73.01 / 806 / 861 | 3 | none |
| V1b strict: every drug credited by the dose taken today (start at its starting dose, increase earns nothing until given, cross-class switch at the new drug's dose) | 542 | 72.92 / 941 / 683 | 3 | none |
| V1b' card reading ("at today's doses" as the card shows it: start at starting dose, increase at the NEW dose) | 253 | 74.10 / 970 / 953 | 3 | none |
| V1c: starts credit 1, increases credited by NEW dose | 3 | 73.02 / 806 / 861 | 3 | none |
| V1d: start or increase earns credit of highest allowed dose (renal/interaction/max cap) | 9 | 72.99 / 806 / 858 | 3 | none |
| V2 death weight halved | 107 | 73.32 / 822 / 839 | 3 | none |
| V2 death weight doubled | 38 | 72.73 / 793 / 854 | 2 | A met to missed |
| V2 hospitalization halved | 25 | 72.89 / 799 / 861 | 2 | A met to missed |
| V2 hospitalization doubled | 69 | 73.05 / 807 / 853 | 3 | none |
| V2 symptoms halved | 52 | 72.35 / 783 / 849 | 2 | A met to missed |
| V2 symptoms doubled | 90 | 73.29 / 820 / 859 | 3 | none |
| V2 side effects halved | 102 | 73.04 / 804 / 858 | 2 | A met to missed |
| V2 side effects doubled | 123 | 72.77 / 801 / 860 | 3 | none |
| V2 cost halved | 13 | 72.79 / 798 / 850 | 3 | none |
| V2 cost doubled | 37 | 73.02 / 804 / 860 | 2 | A met to missed |
| V2 dosing burden halved | 2 | 73.01 / 806 / 861 | 3 | none |
| V2 dosing burden doubled | 1 | 73.01 / 806 / 858 | 3 | none |
| V3 divisor 1 | 123 | 72.77 / 801 / 857 | 3 | none |
| V3 divisor 4 | 102 | 73.04 / 804 / 858 | 2 | A met to missed |
| V4a ten upper-bound harm rows dropped | 11 | 72.81 / 800 / 852 | 2 | A met to missed |
| V4b ten rows charged at half | 11 (same runs as 4a) | 72.81 / 800 / 852 | 2 | A met to missed |
| V5a precision weighting off | 159 | 69.58 / 748 / 818 | 0 | A, E, F met to missed |
| V5b tau2 doubled (less shrinkage) | 55 | 72.11 / 775 / 814 | 1 | A, F met to missed |
| V5c tau2 halved (more shrinkage) | 173 | 73.64 / 834 / 904 | 3 | none |
| V6 default max new classes 3 | 147 | 76.32 / 929 / 849 | 3 | none |
| V6 default max new classes 4 | 147 (66 differ from the "3" variant) | 77.92 / 929 / 901 | 3 | none |
| V6 default 2, K+ binder and IV iron not counted | 2 | 73.01 / 806 / 861 | 3 | none |
| V7 finerenone not offered at LVEF 41-49 | 3 | 72.96 / 805 / 860 | 6 | D41, D45, D49 missed to met |
| V8 KCCQ anchor 10 | 63 | 73.29 / 820 / 859 | 3 | none |
| V8 KCCQ anchor 40 | 52 | 72.35 / 783 / 849 | 2 | A met to missed |
| V9 c0 = 0.206 | 22 | 72.54 / 791 / 848 | 3 | none |
| V9 c0 = 0.565 | 20 | 73.40 / 823 / 871 | 3 | none |
| V11 mandatory-swap bonus 0 | 0 | 73.01 / 806 / 861 | 3 | none |
| V13 extrapolated outcome rows, se^2 + 0.02 | 85 | 73.56 / 827 / 894 | 3 | none |
| V13 extrapolated outcome rows, se^2 + 0.05 | 295 | 73.73 / 850 / 916 | 3 | none |
| V15 ACE inhibitor anchors lowered by one third | 13 | 73.33 / 819 / 873 | 3 | none |

Notes on the table:
- Targets that flip on small changes (A flips in 7 variants) are single scenarios; one scenario decides each flip.
- V6 "3" and "4": the 64 scenarios that spell out `max_new_classes_per_visit: 2` (the default value) were set to 3 or 4; the 28 scenarios that set 0, 1, 3 or 4 explicitly were left alone. So in "4" the scenarios that explicitly say 3 stay at 3.
- V6 exemption: implemented in `countNewClassGroups` (`regimenUtils.ts:435`) by ignoring the K+ Binder and IV Iron classes. Both of the 2 changed runs add IV iron as an extra fourth item (example below).
- V11 (i) = 0: not one first option, displayed set or displayed order changes in any of the 1,032 runs (`ranking:diff` (a), (b), (c) all 1,032 of 1,032). Only 18 runs' displayed scores change. Its keep-a-bad-drug list is below.

## Extra numbers requested

V3, on the unmodified engine, counting every candidate scoring in all 1,032 runs (34,243 scorings; the same regimen is scored again in each run and tier, so these are scorings, not distinct regimens):
- largest side-effect burden: 131.29 (score floor needs burden 200 at divisor 2: 0 scorings hit the floor of 0).
- at divisor 1 the floor is burden 100: 212 of 34,243 scorings hit 0. At divisor 4: 0.

V1d, is the cap already applied? No. `planCreditsFor` (`doseCredit.ts:88-92`) gives credit 1 to every start, increase and cross-class switch whatever the patient's cap. A cap enters only where an anchor row itself carries an eGFR condition (`doseAnchorMg`, `doseCredit.ts:33-42`: eplerenone and finerenone). In the cash-tier runs, 458 distinct (drug, eGFR, planned dose) combinations were valued; under V1d 21 of them earn credit below 1: spironolactone (max 25 mg at eGFR 38-49, anchor 26 mg, credit 0.953; 9), digoxin (max 62.5 mcg at eGFR 12-25, anchor 125, credit 0.364; 6), ramipril (max 2.5 mg/day at eGFR 22-42, anchor 8.39, credit 0.476-0.634; 5), eplerenone (1). So today a ramipril start at eGFR 25 is credited as if titrated to 8.39 mg when the largest dose offerable is 2.5 mg. Caveat: "highest allowed dose" was implemented as the highest daily dose among `eligibleDoses` (renal, interaction, declared maximum) and frequencies within `frequenciesWithinMax` and `dailyCapFor`; potassium and heart-rate dose limits are not included.

V11, runs where the first option KEEPS a contraindicated or intolerance-documented drug (same list with the bonus at 0 and at +15): 3 runs, `Blank Renal Data Stable Spironolactone` in all three tiers (cash, commercial, medicare). The first option is "Titrate Carvedilol 12.5 to 25 mg bid" and it keeps spironolactone, which `contraindications()` flags only because eGFR and creatinine are blank. No other run, and no new run, appears when the bonus is set to 0.

## Examples (first option, before then after, from the saved outputs)

- V1b (credit by today's dose). Dry-and-cold patient "Jane Smith": before, start carvedilol 3.125 mg bid and spironolactone 12.5 mg; after, start eplerenone 25 mg and dapagliflozin 10 mg (a low-dose beta-blocker start earns only 0.364 of its benefit now, so SGLT2 inhibitor and MRA lead). Patient with sinus tachycardia on maximal beta-blocker: before, raise spironolactone 25 to 50 mg; after, keep everything (an increase no longer earns anything). Patient with ACEi-to-ARNI swap scenario: before, switch lisinopril to sacubitril/valsartan 24/26; after, keep lisinopril 10 mg. 180 of the 542 changes are "dose increase becomes no change".
- V1b' and V1d (card reading and cap). Patients on ACE inhibitor with acute decompensation: before, switch to sacubitril/valsartan and add eplerenone; after, add eplerenone and dapagliflozin and leave the ACE inhibitor. V1d: Jane Smith, before start carvedilol plus spironolactone 12.5, after carvedilol plus eplerenone 25 (spironolactone's cap at her kidney function is below its trial dose); elderly patient on all four pillars: before, raise spironolactone 12.5 to 25 mg, after, raise metoprolol 50 to 100 mg.
- V1c: only 3 runs, all "which dose to raise" (for example raise sacubitril/valsartan 24/26 to 49/51 becomes raise spironolactone 25 to 50 mg).
- V2 weights. Death halved (107 runs): gout and congestion patient, before start sacubitril/valsartan plus carvedilol 3.125, after sacubitril/valsartan plus eplerenone; the "Furoscix candidate" scenario switches from ACE-inhibitor-to-sacubitril/valsartan plus eplerenone to eplerenone plus dapagliflozin. Death doubled (38): non-compliant patient, before start lisinopril 2.5 plus eplerenone, after sacubitril/valsartan plus eplerenone. Side effects doubled (123): acute decompensated patient, before eplerenone plus dapagliflozin plus beta-blocker cut, after switch to sacubitril/valsartan plus eplerenone plus beta-blocker cut. Cost doubled (37): before eplerenone plus dapagliflozin, after spironolactone 12.5 plus dapagliflozin (cheaper MRA). 77 of 107 changes under halved death are start-to-start swaps of which drug is started.
- V3 divisor 1 and 4: the same kind of change as the side-effect weight (divisor 1 gives 123 changed runs, the same count as side-effect weight doubled; divisor 4 gives 102, the same count as halved; I did not check that the runs are identical). Example, divisor 1: digoxin patient with potassium 5.8, before start hydralazine/nitrate, after keep digoxin, carvedilol and dapagliflozin unchanged (3 runs); gynecomastia patient, before dapagliflozin plus furosemide plus swap to eplerenone, after dapagliflozin plus raise lisinopril plus swap to eplerenone.
- V4 (upper-bound rows): MRA-boundary patient (eGFR 31, K 5.4), before raise carvedilol 12.5 to 25 mg, after add furosemide 20 mg (the README says loops lose about 11 burden points when the magnesium rows are dropped; I did not trace each run); LVEF 45 reduced-EF patient: before sacubitril/valsartan plus dapagliflozin, after sacubitril/valsartan plus furosemide (this is the A target flip).
- V5 (precision weighting). Off (159 runs): bradycardia patient, before sacubitril/valsartan plus eplerenone, after sacubitril/valsartan plus furosemide (the small loop-diuretic trials get their published figures); elderly patient on all four pillars switches the raised drug. Tau2 halved (more shrinkage, 173): gout and congestion patient, before sacubitril/valsartan plus carvedilol, after sacubitril/valsartan plus eplerenone; Furoscix patient, before switch to sacubitril/valsartan plus eplerenone, after eplerenone plus dapagliflozin.
- V6 default limit 3 / 4 (147 runs, all "start becomes a larger start"): Jane Smith, before carvedilol plus spironolactone; at 3, captopril 6.25 tid plus carvedilol plus spironolactone; at 4, adds dapagliflozin as well.
- V6 exemption: iron-deficient HFrEF patient (commercial and medicare), before sacubitril/valsartan, carvedilol, spironolactone; after the same plus ferric carboxymaltose 1,000 mg.
- V7: patient with gynecomastia on both spironolactone and eplerenone, before add furosemide and swap spironolactone to finerenone; after stop lisinopril and switch to sacubitril/valsartan, add carvedilol, remove spironolactone (the finerenone swap target is gone). The 3 changed runs are this scenario x 3 tiers. The three LVEF 41/45/49 target scenarios stop displaying finerenone.
- V8 anchor 10: Furoscix candidate, before switch to sacubitril/valsartan plus eplerenone, after eplerenone plus dapagliflozin. Anchor 40: LVEF 45 reduced-EF patient, before sacubitril/valsartan plus dapagliflozin, after sacubitril/valsartan plus furosemide (target A flips).
- V9 c0: c0 0.206: K+ trajectory patient, before start carvedilol plus eplerenone, after start carvedilol plus raise sacubitril/valsartan 24/26 to 49/51. c0 0.565: Furoscix candidate, before sacubitril/valsartan switch plus eplerenone, after eplerenone plus dapagliflozin; patient with MRA boundary, before raise carvedilol, after add furosemide.
- V13 extrapolated rows +0.02 / +0.05: bradycardia patient (+0.05), before start sacubitril/valsartan plus eplerenone, after start captopril plus eplerenone; washout-warning patient, before switch lisinopril to sacubitril/valsartan, after raise lisinopril 10 to 20 mg (+0.05). 41 switch-to-start and 9 switch-to-increase changes at +0.05.
- V15: 13 runs, all "switch ACE inhibitor to sacubitril/valsartan plus add eplerenone" becoming "add eplerenone plus dapagliflozin" (the mechanism was not traced).
- V11: no first option changes (the bonus is on every displayed option in the 18 runs where it applies; Q2).

## Q1. The class limit and sacubitril/valsartan

Does a same-group switch count as a new class at limit 2? No. `countNewClassGroups` (`services/engine/regimenUtils.ts:435-444`) counts class GROUPS present in the candidate but absent from the current regimen; ACEi, ARB and ARNI are all group "RAAS Inhibitor" (`services/engine/registry.ts:27-29`). Test (`sens/q1.ts`, output `out/q1.txt`): current lisinopril + carvedilol; switching lisinopril to sacubitril/valsartan = 0 new groups; plus eplerenone = 1; plus eplerenone and dapagliflozin = 2 (allowed at limit 2). With no RAAS drug on board, adding sacubitril/valsartan plus an MRA = 2. Limit filter: `candidates.ts:1154-1184`.

Why some first options switch to sacubitril/valsartan and add an MRA without an SGLT2 inhibitor: neither the limit nor, in most runs, the score. Of 55 first options that switch to sacubitril/valsartan and have an MRA, 35 also have an SGLT2 inhibitor and 20 do not. In those 20: (a) the limit removed no candidate in any of them (candidates before and after the limit filter were equal); (b) setting the default limit to 3 or 4 changes 0 of these 20, and exempting binders/iron changes 0; (c) in 18 of the 20 the candidate "switch to sacubitril/valsartan + MRA + start SGLT2 inhibitor" is never generated. The generator builds multi-drug candidates only as: adds of 2 to 4 missing pillars (`candidates.ts:883-898`, adds only), one add plus one titration, ONE swap plus ONE add from the first missing pillar only (`candidates.ts:927-945`, `pillarLists[0]`, which is the MRA when the RAAS inhibitor and beta-blocker are on board; pillar order `candidates.ts:54-59`), and adjunct combinations. A swap plus two adds exists only when the swap is forced (contraindication or intolerance; those forced changes are injected into every candidate, `candidates.ts:1003` onward): that is the 2 remaining runs (ACE inhibitor cough on ramipril, cash and medicare), where the full candidate does exist and the score picks "add eplerenone + furosemide + switch" over it. So for 18 of 20 the cause is candidate generation, for 2 it is the score. Further check: raising the extrapolated-row standard error by +0.05 (V13) changes 18 of the 20 to options that include an SGLT2 inhibitor; the score, not the limit, is what sacubitril/valsartan competes on.

## Q2. When is a contraindicated or intolerance-documented drug kept, and does the +15 matter?

Code: the bonus is added in `services/engine/effects.ts:119-127` for any swap whose source drug has `contraindications(patient) === true` or an intolerance reason. Test: `sens/q2.ts`, output `out/q2.txt` (all displayed options in all 1,032 runs).
- Options that keep such a drug exist only in one situation: renal-only contraindication with eGFR or creatinine blank. `candidates.ts:126-132` deliberately does not add the drug to `contraindicatedCurrentMeds` ("never force-remove working therapy on missing data"), so keep and titrate options survive. 6 displayed options in 3 runs, all `Blank Renal Data Stable Spironolactone` (x3 tiers), 3 of which are first options. Every other contraindicated or intolerance case is forced into every candidate as a swap or removal (`candidates.ts:1003-1090`), so no displayed option keeps the drug.
- Where the bonus fires (49 displayed options in 18 runs: ACE inhibitor cough, gynecomastia, ARNI-to-ACEi washout, hepatic ivabradine-exclusion scenarios): every displayed option in those runs carries it, because the forced swap is in every candidate. So it does not order the options against each other. Setting it to 0 left the first option, the displayed set and the order unchanged in all 1,032 runs (V11). It changes displayed scores in 18 runs only (up to 12 points, the clamp). In the three blank-renal runs the bonus does not fire at all (0 of 49 bonus options are blank-renal), though if a swap away from spironolactone were displayed there it would earn the +15 because the effects.ts test uses the raw `contraindications()` result.
- In the 1,032 runs there is no situation where the +15 is what puts a swap ahead of keeping the drug.

## Q3. Kinds of first option on the unmodified engine (1,032 runs)

Each first option classified once, in priority order (any switch; else any new start; else dose increase only; else removal or reduction; else keep):

| Kind | Runs |
|---|---|
| New start (at least one add, no switch; adds only 452, add + dose increase 57, add + removal/reduction 53) | 562 |
| Dose increase only (increase alone 213; with a removal or reduction 15) | 228 |
| Switch (any swap, with or without adds or increases; switch to sacubitril/valsartan 65, other switches 45) | 110 |
| Removal or dose reduction only | 63 |
| No change (keep everything) | 48 |
| No option at all (hard stops: severe hypotension, missing or implausible inputs, hyperkalemic emergency) | 21 |

## What I could not do or am unsure of

- Not run in the assigned worktree (it lacks the code); run on a copy of the owner's uncommitted working tree. The copy matches the README baseline exactly.
- V1b has two possible meanings of "today's dose"; I ran both (V1b strict and V1b' card reading). V1d's "highest allowed dose" excludes potassium and heart-rate dose limits.
- V4 "dropped" was implemented by deleting the ten rows (no validator error; every drug keeps other rows); "half" by halving the rate and dose-group rates.
- V6 "default": changing the value in scenario definitions that spell out 2 is an assumption about which scenarios mean "default"; the result for a different patient mix could differ. The binder/iron exemption changes only the count rule (`countNewClassGroups`), used by both the candidate filter and the rescue path.
- V7 hides finerenone by removing it from the formulary for add, swap and keep after eligibility; excludedMedications is unchanged. A patient already on finerenone at LVEF 41-49 would have it treated as not in the formulary; no reference scenario tests that combination, so it is not measured.
- V13: inflation was applied to the standard error used in precision weighting for the 34 `extrapolated` rows (rows with no interval use the median standard error, then add the extra variance); tau2 is unchanged because it is computed only from trial and meta-analysis rows; the symptom table was not touched.
- V15: the four ACE inhibitor anchors (lisinopril, enalapril, ramipril, captopril) were multiplied by 2/3. c0 (0.364) was not recomputed against the lowered anchors.
- V2 uses `BASE_WEIGHTS` with the existing renormalization; added fixed-point adjustments (penalties, bonus) are not rescaled, so the effective exchange rate changes slightly beyond the weight alone.
- V3 candidate counts are scorings, not distinct regimens (instrumented in `scoring.ts`, then reset).
- Concordance (ii) is the old engine's own guideline-concordance score, as the README says; the "highest among displayed" column can fall when more options become concordant.
- The target flips depend on one scenario each, so they are fragile signals.
- No opinions on what the decisions should be, by instruction.
- Scratch files (`sens/`) were left in the scratchpad: scripts `dump.ts`, `q1.ts`, `q2.ts`, `lowcheck.ts`, patch scripts `p_*.py`, `v2.sh`, `runvar.sh`, and raw outputs in `sens/out/`.
