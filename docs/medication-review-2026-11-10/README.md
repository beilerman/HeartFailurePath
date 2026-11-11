# Medication model review — 2026-11-10

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
