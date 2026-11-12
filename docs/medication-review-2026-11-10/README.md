# Medication model review and corrections — 2026-11-10

All 32 formulary drugs were reviewed at every dose tier, the findings were checked against primary
sources, and the confirmed ones were corrected in the engine.

## Outcome

| Step | Result |
|---|---|
| Review (from memory) | 7 high, 48 medium, about 83 low findings |
| Source verification | 91 confirmed, 55 partly confirmed, 4 refuted, 32 not verified |
| Corrections | Confirmed and partly confirmed findings implemented; refuted and unverified ones left unchanged |
| Tests | 241 scenarios (136 added), 14 structural invariants, three audits, all passing (2026-11-11 after the ESC alignment: 298 scenarios, 314 checks) |

Sources that could be opened: FDA labels on DailyMed, trial abstracts (PubMed E-utilities, Europe
PMC), a full-text mirror of the 2022 guideline for one group. The AHA/ACC and ESC guideline pages
themselves returned access errors for most verifiers, so guideline-only claims rest on secondary
copies or were left unverified. Each `verified-*.md` file lists the URL opened for every row.

All seven high findings were confirmed and fixed:

| # | Finding | Now |
|---|---|---|
| 1 | Heart rate below 55 removed a beta-blocker already in use | Reduced one dose step with an alert; removed only for high-grade AV block, sick sinus syndrome without a pacemaker, or bradycardia at the lowest dose |
| 2 | Sacubitril/valsartan could be newly started at 97/103 mg | New starts are 24/26 mg (not on an ACEi/ARB or on a low dose, eGFR below 30, Child-Pugh B) or 49/51 mg; 97/103 mg by titration only |
| 3 | Bumetanide 4 mg tier, up to 12 mg a day | Tier removed; every loop declares a maximum daily dose, enforced by a test |
| 4 | Eplerenone and finerenone lacked the strong CYP3A4 inhibitor contraindication | Added, with the inhibitors selectable as outside medications |
| 5 | Finerenone lacked the adrenal-insufficiency contraindication | Added (also spironolactone and Addison's disease) |
| 6, 7 | Semaglutide and tirzepatide quality-of-life gains used the active-arm change | Placebo-adjusted values: 7.8 (7.3 with diabetes) and 6.9 |

Found while correcting, and also fixed: an MRA could be started above potassium 5.0 with no binder;
a binder-enabled MRA start could project a potassium above baseline; carvedilol could be newly
started at 25 mg; loop effects and alerts ignored dosing frequency.

How many top recommendations each pass changed is recorded in the `changes-*.txt` files.

## Open for physician review

These are judgment calls made during the corrections, numbers that are engine policy rather than
sourced, and findings left unchanged because no source could be opened.

**Policy numbers (not sourced)**
- Beta-blockers (reviewed 2026-11-11, unchanged, engine policy: labels give no number, the ESC 50 bpm rule was not verifiable): reduce below heart rate 55 for metoprolol succinate and bisoprolol (the carvedilol
  label states 55; the other two labels give no number); no up-titration below 60; no new start below 55.
- Sacubitril/valsartan "low dose" of a prior ACEi/ARB: at most 10 mg/day enalapril or lisinopril,
  5 mg ramipril, 75 mg captopril, 160 mg valsartan, 16 mg candesartan, 50 mg losartan.
- Digoxin in sinus rhythm: LVEF 40 or below, NYHA III-IV, and no pillar left to add or titrate.
- Ivabradine: starts at 2.5 mg with a conduction defect or amiodarone/digoxin; hypotension
  contraindication at systolic pressure below 90.
- Vericiguat: starts at 2.5 mg when systolic pressure is below 110.
- Loop high-dose alert: furosemide 120, torsemide 60, bumetanide 3 mg a day.
- Furoscix: four kits per course for pricing; commercial and Medicare copays.
- Evidence bonus points: A-HeFT 60, GLP-1 40, IV iron 40 (20 at LVEF 41-49), binders 50.
- IV iron cost amortized over six months.

**Assumptions (interpolated or extended beyond the source)**
- Patiromer potassium effect: -0.45 at 25.2 g from PEARL-HF; 8.4 g and 16.8 g interpolated.
- Tirzepatide dose fractions at 2.5, 7.5 and 12.5 mg; the fractions applied to every effect, although
  only weight is sourced. Semaglutide intermediate doses keep linear scaling.
- Thiazide add-on credit of 1.1 kg (CLOROTIC, hydrochlorothiazide) applied to chlorthalidone and
  metolazone, and flat across metolazone doses.
- Spironolactone continuation rule borrowed from the eplerenone and finerenone labels.
- Blank eGFR treated as below 30 for the sacubitril/valsartan starting dose.

**Design decisions kept**
- The undifferentiated "Child-Pugh B/C" option still excludes sacubitril/valsartan and carvedilol;
  the new "Child-Pugh B confirmed" option allows them with a reduced start or caution.
- "Best in class" badges remain on sacubitril/valsartan, spironolactone, dapagliflozin and
  empagliflozin without a verified source for or against.

**Left unchanged because unverified**
- Efficacy magnitudes for RAAS inhibitors, MRAs, H/ISDN and vericiguat (LVEF, NT-proBNP, quality of life).
- Spironolactone potassium rise and blood-pressure effect (the review judged both too large).
- Finerenone quality-of-life credit; iron quality-of-life and NT-proBNP credit.
- Reduced loop response at low eGFR is a dosing note only; no multiplier.
- Digoxin LVEF credit stays zero although the label states an increase.
- Several prices (other generics, vericiguat, H/ISDN, dose-based Wegovy cash price).

**Known gaps**
- Restart-after-withhold rules for MRAs and Lokelma's 48-hour correction phase are not modeled.
- Captopril (three times daily) and valsartan (twice daily) renal caps are still compared with the per-dose strength, not the total daily dose, and an arriving regimen above them is not yet checked the way ramipril's is. Found 2026-11-11 while closing the ramipril items; undecided whether either label cap is a daily total.

**Closed 2026-11-11 from sources (docs: `verified-clinical-decisions-2026-11-11.md`, `esc-2026-reading-notes.md`; changes: `changes-mra-staged-start.txt`, `changes-hyperkalemia-6-alert.txt`, `changes-torsemide-equivalence.txt`, `changes-pregnancy-beta-blocker.txt`, `changes-monitoring-timings.txt`)**
- New RAAS inhibitor start above potassium 5.2 is staged (rule E18, ESC S4/S5 caution; staging is engine policy) and the binder rescue is reactive only (existing therapy); at K+ 5.2 a new ARNI/ACEi still projects above 5.3 and is dropped, so starts are realistically offered up to about 5.1.
- New MRA start above potassium 5.0 is staged (rule E15), with or without a binder; the DIAMOND co-start was removed. Source types: ESC 2026 "caution" at 5.0 or above (primary), 2022 US start criterion (secondary reproduction), Aldactone and Kerendia labels, DIAMOND (trial protocol, not a recommendation). Binders: Class 2b in the 2022 US guideline (secondary), no recommendation in ESC 2026.
- Spironolactone, eplerenone and finerenone starting doses and renal rules reviewed against the labels: matched, unchanged. MRA continuation (halve above 5.5, withhold at 6.0 or above, secondary reproduction of ESC guidance) matched, unchanged.
- Potassium 6.0-6.4: alert now asks for an ECG and urgent repeat potassium and states the severity source and the engine-policy label; no RAAS/MRA start or increase (enforced by scenarios). The 6.0/6.5 thresholds remain engine policy (KDIGO scheme not verifiable).
- Torsemide 1 mg = furosemide 2 mg from the TRANSFORM-HF protocol (a trial protocol; registry text says 2-4 mg); the "prescriber must convert" fallback is removed. New issues this exposed are listed below under Still open.
- Pregnancy beta-blockers: beta-1-selective only for new starts, carvedilol switch offered (ESC 2026 Class I C, primary). Pregnancy alert wording corrected.
- Monitoring timings follow the labels and secondary guideline text; no numeric lab-recency window (none sourced).
- Reviewed 2026-11-11: beta-blocker heart rate is now ESC-sourced for metoprolol succinate and bisoprolol (50, Supplementary Table S6; the up-titration 60 stays policy); unchanged: low-output handling (not verifiable), spironolactone BP effect ("no effect" refuted, magnitude unknown), spironolactone potassium rise, digoxin LVEF credit (magnitudes not verified).

**Still open after the 2026-11-11 source pass and the 2026 ESC alignment (same day)**
- CLOSED 2026-11-11 (second pass): the optional baseline creatinine input now enforces the ESC change-based kidney rules (HF-ESC-013). Still open: the tool cannot see whether a rise persists after other offenders are stopped, applies the stricter of the main text (creatinine under 50%) and the supplement (eGFR fall under 30%), and keeps a drug already at its lowest dose rather than withdrawing it in the halve band; the eGFR below 20 stop band uses the typed eGFR. With the baseline blank the eGFR below 20 alert still says the tool cannot tell.
- Beta-blocker heart rate is ESC-sourced for metoprolol succinate and bisoprolol (50, Supplementary Table S6) and the carvedilol label (55); the engine reduces on heart rate alone because it has no worsening-symptoms qualifier. The up-titration hold below 60 is the only remaining engine-policy heart-rate number. The S6 "recent exacerbation under 4 weeks" caution is a note (no field).
- The RAAS potassium split (reduce from 5.5, stop from 6.0, MRA first) is engine policy: the ESC text and Supplementary Tables S4/S5 disagree with each other (see the evidence matrix, HF-ESC-004).
- A pregnant patient on a full-dose carvedilol is switched to a full target dose of metoprolol in one step (fraction-of-target policy, no sourced equivalence); the ACEi to ARNI switch at eGFR 30-59 is now less attractive because the ARNI starts at 24/26 (ESC optional, stricter kept).
- Not read: the 2026 ESC Supplementary Table S26 and the decompensated-HF tables, and the guideline's valve and amyloidosis sections. CLOSED 2026-11-11: the ESC device, advanced HF and atrial fibrillation tables (Rec. Tables 6, 7, 11, 15, Tables 14-15) and the 2022 AHA/ACC/HFSA text points (Table 12, 7.3.2, 7.3.3, 7.3.6, 7.6.1) were read directly; the US class-of-recommendation labels were images, so US classes are still secondary; the 2021 ESC page was not opened.
- Device, advanced-HF and AF alerts (HF-ESC-014) cannot see QRS duration, LBBB, aetiology, infarction date, hospitalization count, anticoagulant, inotropes, shocks or RV function (the form has none); the engine-policy numbers there are NT-proBNP 4000 for NYHA III-IV and pulse above 100; the advanced-HF alert fires in about 10% of the scenarios (watch for alert fatigue).
- MRA initiation (HF-MRA-009): potassium 5.0 or higher and eGFR 30 or lower now stage a new start per the 2022 US text; finerenone shares the potassium rule; the 31-49 halving is applied as eGFR below 50.
- Open clinical questions not decided here: bisoprolol 1.25 mg start (no US tablet), losartan 150 mg above the US label maximum (already offered), digoxin 250 mcg tier, GLP-1 LVEF threshold for tirzepatide (ESC 45, engine 50).

**Closed 2026-11-11 (commit `e671e93`, golden regenerated in `d75b5cc`; changes: `changes-ramipril-daily-dose.txt`)**
- Ramipril effects now use the total daily dose (`facts.effects_on_daily_dose`), so 5 mg twice daily and 10 mg once daily are credited alike.
- A regimen arriving above a renal dose cap is force-reduced one ladder step with the reason shown, and no increase is offered while above it. The cap is compared with the total daily dose where the entry declares `facts.renal_cap_is_daily` (ramipril: 5 mg twice daily at eGFR 40 becomes 2.5 mg twice daily). Blank renal data never trips it. This applies to every drug with a renal cap, not only ramipril: before this commit no regimen arriving above any renal cap was flagged.

**Closed in the final engine pass (changes: `changes-final-gaps.txt`)**
- Target dose is judged on the total daily dose where an entry declares `facts.target_daily_dose` (ramipril only: 5 mg twice daily is the 10 mg/day target).
- The immediately next tier above and below the current dose is always a titration candidate (lisinopril 5 mg offers 10 mg); a verify invariant checks it for every scenario.
- CLOSED 2026-11-11 (final pass, `changes-final-dose-step-cap.txt`): larger titration jumps. An up-titration may at most double the total daily dose in one visit (`UP_TITRATION_MAX_DAILY_FACTOR`), the adjacent tier always kept. Sourced for RAAS inhibitors, beta-blockers and MRAs (2026 ESC supplement S4-S6/S8 "doubled at not less than 2-week intervals"); engine policy for loop diuretics (S7 gives no step size) and every other class. Before, a single visit could take furosemide 40 mg/day to 320 mg/day or carvedilol 6.25 to 25 mg bid. New starts, swaps and forced reductions are not governed by it.
- An MRA dose is not increased at potassium 5.0 or above (`facts.k_uptitration_max`; finerenone and eplerenone labels, spironolactone by engine policy), with an alert stating why.
- Loop-to-loop swaps land at the equivalent total daily dose when both agents declare `facts.verified_furosemide_equivalent_per_mg` (furosemide, bumetanide).
- Form input hints read the engine thresholds (`services/engine/thresholds.ts`); the display-only "K+ 3.5-4.0" hint was dropped because no engine rule uses 4.0.

## Original findings (before verification)

Findings only. Nothing in the engine was changed. All 32 formulary drugs were reviewed at every
dose tier by five reviewers (one per drug group) against labels, pivotal trials and the 2022
AHA/ACC/HFSA guideline. Full per-drug tables and findings are in the five files in this folder.

**How far to trust this.** The reviewers did very little online checking: most label, trial and
price statements are from memory and are marked that way in each file. Findings about what the code
does were read from the source. The three marked "reproduced" below were also run through the engine
with a test patient. Treat every clinical claim as a prompt for physician review, not as settled.

Totals: 7 high, 48 medium, about 83 low.

## High

| # | Drug(s) | Problem | Suggested correction | Status |
|---|---|---|---|---|
| 1 | Beta-blockers (all three) | A heart rate below 55 removes a beta-blocker the patient is already taking. At pulse 54 on carvedilol 25 mg BID, every option says "Remove Carvedilol (contraindicated)" | Keep < 55 for new starts only. For continuation, reduce the dose below 50 or when symptomatic, as ivabradine already does | Reproduced |
| 2 | Sacubitril/valsartan | A patient not on any RAAS inhibitor can be started at the full 97/103 mg dose. With eGFR 22 or 18 this was the top option | New starts at the lowest tier only; force 24/26 mg when eGFR < 30 or when not coming from an ACEi/ARB | Reproduced |
| 3 | Bumetanide | A 4 mg tier exists (tablets are 0.5, 1 and 2 mg) with a three-times-daily option, which is 12 mg a day against a labeled maximum of 10 mg | Remove the 4 mg tier; cap the daily dose | Tier confirmed in code; not seen recommended |
| 4 | Eplerenone, finerenone | No contraindication for strong CYP3A4 inhibitors, and those drugs are not in the external-medication list | Add the drugs and the check; cap eplerenone at 25 mg with diltiazem or verapamil | From memory (label) |
| 5 | Finerenone | No adrenal-insufficiency contraindication | Add the comorbidity and the check | From memory (label) |
| 6 | Semaglutide | Quality-of-life gain is modeled as 16.6 points, the unadjusted arm change in STEP-HFpEF. The placebo-adjusted effect is 7.8 | Use 7.8 | Secondary source |
| 7 | Tirzepatide | Same error: 19.5 modeled, placebo-adjusted effect in SUMMIT about 6.9 | Use 6.9 | Secondary source |

Items 6 and 7 mis-rank rather than endanger: they over-favor GLP-1 therapy in obese HFpEF.

## Medium, by theme

**Initiation versus continuation thresholds**
- MRAs (all three): potassium above 5.5 removes a current MRA instead of reducing or holding it.
- MRAs: new starts are allowed up to potassium 5.5; the guideline and labels say 5.0 or below.
- Ivabradine: the evidence bonus is lost once the drug has worked and the heart rate is below 70.

**Dose handling**
- Loop diuretics: effect and the high-dose alert use the single-dose strength, so 80 mg three times
  daily never triggers the alert and twice-daily dosing earns no extra effect.
- Loop diuretics: no reduction in effect at low eGFR.
- GLP-1 drugs: missing titration steps, so a jump from 0.25 to 2.4 mg semaglutide is possible; effect
  scales linearly with dose although the real response saturates.
- Carvedilol 50 mg is credited 50% more benefit than 25 mg with no trial support.
- Losartan 150 mg is not flagged as a target dose. Finerenone 20 mg is not treated as the target at
  eGFR 25–59. Torsemide 50 mg and furosemide 160 mg are not marketed tablet strengths.
- Entresto's reduced renal starting dose produces only monitoring text.
- Digoxin is dose-capped only below eGFR 30; 62.5 mcg is usual at eGFR 30–50 or age 70 and over.
- Ferric carboxymaltose has a single 1000 mg tier; the heart-failure schedule is two doses.

**Effect sizes that look too large or too small**
- Spironolactone potassium rise (0.4–0.8, multiplied up for renal risk) is roughly double trial
  values, which triggers binder rescues and penalties. Its blood-pressure drop is also overstated.
- Finerenone is credited more NT-proBNP and quality-of-life benefit than spironolactone.
- SGLT2 inhibitors: quality-of-life gain about two to three times the trial effect.
- Digoxin: NT-proBNP reduction with no supporting data; rate lowering applied in sinus rhythm.
- Furoscix: credited about 1.15× an oral dose; the label supports about 2×.
- Thiazide add-on credit is about twice the CLOROTIC effect, and the code comment attributes that
  trial to chlorthalidone (it tested hydrochlorothiazide).
- Lokelma: potassium lowering uses the 48-hour correction figure for a once-daily maintenance dose.
- Carvedilol is tilted above metoprolol succinate and bisoprolol at equivalent doses.

**Missing contraindications, criteria or warnings**
- Ivabradine: strong CYP3A4 inhibitors, sick sinus syndrome, severe hepatic impairment, pacemaker
  dependence, acute decompensation (checked against the label online).
- Vericiguat: other sGC stimulators and PDE5 inhibitors; no warning above NT-proBNP 8000; the
  NT-proBNP gate is a flat 1600 where VICTORIA used 1000 in sinus rhythm.
- Digoxin is offered without requiring optimized guideline therapy first.
- H/ISDN for Black patients in NYHA III–IV does not require background RAAS and beta-blocker therapy.
- IV iron bonus and auto-add apply to every phenotype; trials enrolled LVEF below 45–50.
- GLP-1 initiation allows LVEF above 40; the trials enrolled 45 and above (semaglutide) and 50 and
  above (tirzepatide).
- Empagliflozin initiation floor is eGFR 25; the trials and label support 20.
- Entresto is contraindicated in Child-Pugh B; the label allows a reduced start.
- Metolazone has no potassium gate. Thiazides lack the gout caution the loops carry.
- Lokelma edema risk is flat rather than dose-related; the sodium figure in the comment is wrong.
- Furoscix is modeled as a standing daily drug; the label says it is not for chronic use.

**Evidence bonus proportions**
- A-HeFT (mortality) carries 30 points, below IV iron (40) and obesity therapy (50–60).
- Potassium binders get +50 whenever potassium is above 5.0, even with no RAAS inhibitor or MRA in
  the regimen.
- Tirzepatide is labeled "superior" to semaglutide on a cross-trial comparison.
- Torsemide carries a "best in class" badge; TRANSFORM-HF showed no difference from furosemide.

**Prices**
- Entresto is priced as brand-only at $600 cash; a US generic is reported since mid-2025.
- Injectafer is priced at $315 cash; it is roughly $1,000–1,400 per dose under the medical benefit.
- Wegovy and Zepbound Medicare copays ($350, $450) may be out of date for 2026.
- Ivabradine is flagged as brand-only although the generic price is used.

## Judged appropriately modeled

Lisinopril, enalapril, ramipril, valsartan, candesartan (tiers, targets, dose-response);
Entresto efficacy; metoprolol succinate and bisoprolol; carvedilol 3.125–25 mg and its weight-based
target; dapagliflozin; vericiguat's dose ladder and gates; H/ISDN tiers and indications; the
iron-deficiency definition; furosemide's dose-response curve; Furoscix contraindications; loop
de-escalation and volume-depletion handling; generic prices generally.

## Files

- `raas.md` — 1 high, 4 medium, 18 low
- `rate-control.md` — 1 high, 7 medium, about 17 low
- `mra-binders.md` — 2 high, 9 medium, about 14 low
- `sglt2-glp1-adjuncts.md` — 2 high, 18 medium, about 22 low
- `diuretics.md` — 1 high, 10 medium, about 12 low
