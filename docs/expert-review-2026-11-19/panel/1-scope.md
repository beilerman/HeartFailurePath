# What this tool is, and what we are asking of you

## In one paragraph

HeartFailurePath is a research tool that suggests medication changes for an adult outpatient with chronic heart failure at a clinic visit. The clinician enters the patient's findings and current drugs. The tool returns up to three options (each a small set of changes to the current regimen), the reasons one is listed first, safety alerts, and a monitoring plan. It has not been tested on patients. It is not for clinical use. We are asking heart failure experts to judge whether its suggestions and its reasoning are sound before any further step is considered.

## How it decides

The tool does not follow a guideline flowchart. It estimates, for every allowed change, six things from published measurements and ranks the options by a weighted sum:

| Factor | Weight | Where the numbers come from |
|---|---|---|
| Death | 30% | Relative risks from randomized trials and their pooled analyses |
| Heart failure hospitalization | 22% | The same |
| Side effects | 14% | Event rates above placebo, from trials and drug labels |
| Cost to the patient | 14% | A price table by payer type, compared with the patient's monthly budget and stated cost worry |
| Symptoms | 10% | Change in the Kansas City questionnaire score (or a converted equivalent) |
| Dosing burden | 10% | Frequency of dosing and number of drugs, compared with the patient's stated tolerance for complexity |

The score also includes fixed adjustments for recorded low blood pressure, slow heart rate, high potassium, unresolved safety warnings and a few other states. These are policy choices and are listed in the policy questions.

A control on the entry form, "What matters most to this patient?", changes the weights: Balanced (the table above), Prioritize treatment evidence (the weights of cost and dosing burden are halved), Keep cost low (the weight of cost is tripled), or Keep the regimen simple (the weight of dosing burden is tripled); in each case all six weights are then rescaled to total 100%. It changes only the weights, never a safety rule. Every prepared case uses Balanced unless the page says otherwise.

The tool's scale runs from 0 to 100. Death and hospitalization are scored as the estimated percent reduction in relative risk, so with a weight of 30% a gap of one point is what a difference of about 3.3 percentage points in the relative risk reduction for death would produce on its own (for example a relative risk of 0.80 against 0.833), or about 4.5 percentage points for hospitalization. These are relative, not absolute, risks. The tool treats two options within one point of each other as too close to separate and says so.

Three features of the method matter for your review:

1. **Guidelines are a check, not an input.** No number was adjusted to make the tool agree with a guideline. Where the tool disagrees with a guideline, that is a finding for you to judge, and several are listed in the policy questions.
2. **Imprecise estimates count for less.** Each trial estimate is pulled toward "no effect" in proportion to its uncertainty, by one rule applied to every drug. A wide confidence interval therefore earns less credit than a narrow one with the same point estimate. There is no significance cut-off.
3. **Effects are relative, not absolute.** The tool does not estimate the patient's own baseline risk, so it never states events prevented.

Separate from the ranking, a set of safety rules withholds or forces changes (for example low blood pressure, high potassium, slow heart rate, pregnancy, kidney limits from drug labels). These thresholds come from drug labels, trial entry criteria or guidelines, except that about a third are the tool's own policy and are marked as such.

By default at most two new drug classes are started per visit (the clinician can change this limit, from 0 to 6, on the entry form). A voluntary switch from an ACE inhibitor or ARB to sacubitril/valsartan counts as one. Dose increases of drugs already taken, and changes forced by a safety rule, are not limited by this rule. When the best option cannot be told apart from leaving the regimen unchanged (within one point on the tool's 100-point scale), "No medication change" is listed first and the others are shown as alternatives, except that for a congested patient an option containing a diuretic step stays first.

## What it covers

- Adults with chronic heart failure seen as outpatients, at any ejection fraction.
- Drug classes: sacubitril/valsartan, ACE inhibitors, angiotensin receptor blockers, beta-blockers, mineralocorticoid receptor antagonists (steroidal and finerenone), SGLT2 inhibitors, loop and thiazide-type diuretics, hydralazine/isosorbide dinitrate, ivabradine, vericiguat, digoxin, GLP-1 receptor agonists (semaglutide, tirzepatide), intravenous iron, and potassium binders.

## What it does not cover

- Acute or inpatient care. The tool raises an urgent alert when the entered findings suggest acute decompensation, and withholds beta-blocker starts and increases. In a low-output or cold state (ejection fraction below 20 with two perfusion markers, or decompensation with signs of poor perfusion), the only drugs started or raised are a loop diuretic for recorded congestion and a replacement for a beta-blocker that must stop for a safety reason; lower doses and stops are still offered. At a potassium of 6.0 or above, no option starts a drug or raises a dose, except that the dose of a potassium binder already taken may be raised. At an ejection fraction of 20 or more, two perfusion markers raise a "possible poor perfusion" alert, and each option that starts or raises a drug carries a warning to assess perfusion first; scores and order are unchanged. The tool does not manage any of these states.
- Conditions the trials behind it did not study. If any of these is recorded, the tool shows no ranked options and says why: cardiac amyloidosis; hypertrophic or restrictive cardiomyopathy; severe aortic stenosis or other severe valve disease awaiting intervention; heart failure from congenital heart disease; active cancer treatment with a cardiotoxic drug; heart transplant or ventricular assist device; dialysis.
- Devices, procedures and referral. It prints screening reminders only.
- Frailty, limited life expectancy and the patient's goals of care. These are not inputs. The only patient preferences the tool reads are cost worry, monthly budget, tolerance for complexity and the "What matters most" choice.
- Diagnosis. It assumes the diagnosis of heart failure is correct.

The companion page "Limitations" lists what the tool leaves out or simplifies inside its scope.

## What we are asking you to do

1. **Rate the prepared cases.** 45 constructed patients, each with the tool's full output. They were chosen to cover the range of ejection fraction, kidney function, potassium, blood pressure, rhythm and current treatment, and to include the situations where the tool departs from usual practice. Each case asks for your own plan before it shows the tool's, and a page explaining why each case was chosen is provided after the ratings are returned, so that neither influences your answer. For each, a short form asks whether the first option is acceptable, whether anything shown is unsafe or wrong, and whether the stated reasons are true and sufficient.
2. **Answer the policy questions.** A short list of choices that are judgement rather than measurement: the weights, a few definitions, and several places where the tool departs from usual practice. Your answers will be applied once, after all reviews are in.
3. **Tell us what is missing.** Anything a careful clinician would need that the tool does not ask for or does not say.

The rule set is frozen for the review. Every case in the packet was produced by the same version, named on each page.
