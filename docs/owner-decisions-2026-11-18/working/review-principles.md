# Adversarial review of draft-1 (16 HF policy decisions): principles, compatibility, safety

Reviewer scope: read-only. I read the draft, the HF first-principles README (all), `harmDefinitions.json`, `harmEvidence.json`, `outcomeEvidence.json`, `scoreModel.ts`, `harmBurden.ts`, `doseCredit.ts`, `eligibility.ts`, `candidates.ts`, `effects.ts`, `selection.ts`, `scoring.ts`, `intolerance.ts`, and, for HTN, `CARDIOMETABOLIC_COMPATIBILITY.md`, `PATHSCORE_HOW_IT_SCORES.md`, `HANDOFF_2026-11-15.md`, `PROJECT_STATUS.md`, `policy-v1.json`, `class-harm-rates.json`, `harm-definitions.json`, `path-catalog-v1.json`. I ran no engine code. Claims about trials are from memory or from the repo's own notes and are marked "unverified" where I could not check them.

Numbering follows the draft (draft 5 = README 6, draft 6 = README 7, draft 9 = README 10, draft 10 = README 11, draft 11 = README 12, draft 12 = README 13, draft 13 = README 14, draft 14 = README 15, draft 15 = README 16, draft 16 = README 17).

---------------------------------------------------------------------

## 0. Verdicts at a glance

| # | Draft answer | Verdict |
|---|---|---|
| 1 | Keep start=1 / increase=1 / held=by dose, plus cap at highest allowed dose | CHANGE TO: keep as a labelled interim policy only (not "first-principles"); apply the cap only where a static label/renal/interaction cap already exists; decide jointly with HTN's dose/titration plan; drop the scheduling-index argument |
| 2 | Keep six weights and profiles as interim; derive four weights after item 16 | CHANGE TO: keep as labelled policy, but strike the unshown "utility check", state the 3.1x side-effect weight gap to HTN, and delete the claim that item 16 makes the weights derivable |
| 3 | Keep severity weights and divisor 2 | CHANGE TO: the draft contradicts itself (divisor 2 is the one HF-only deviation). Record divisor 2 as an HF-only deviation, correct `harmDefinitions.json` (which says divisor 1), and make the transform a cross-engine owner decision |
| 4 | Charge half the bound on ten upper-bound rows | CHANGE TO: UPHOLD current rows, labelled; no HF-only change. The motivating claim is numerically wrong (about 0.76 ranking points, not "harmful") and the rule is unilateral on an open HTN decision |
| 5 | Keep precision weighting, null centre, read owner's ruling as "through the same rule" | UPHOLD the method; CHANGE TO: return the reading of the owner's Cochrane ruling to the owner with the numbers (0.24 becomes 0.83) |
| 6 | Default 3, exclude rescue drugs from the count | CHANGE TO: keep default 2; the STRONG-HF argument is not a measurement of a limit; the stated safety redundancy is false; the real cause of the ARNI/SGLT2i observation is the candidate enumerator |
| 7 | Keep finerenone displayed; record three targets as "divergences, not misses" | UPHOLD display; CHANGE TO: keep them counted as misses/divergences in the report (relabelling raises the score from 3/7 to 6/7) |
| 8 | Keep KCCQ anchor 20; additive | UPHOLD anchor; NEEDS DATA: the "stays under 20" claim is false by the repo's own numbers; symptom lines double-charge what KCCQ already nets |
| 9 | Keep c0 = 0.364; add MOCHA as a check | CHANGE TO: do not use MOCHA as corroboration; the unweighted mean of four values breaks the item-5 rule; NEEDS DATA: MOCHA numbers unverified |
| 10 | Keep penalties; commission search for measured modifiers | CHANGE TO: keep as labelled policy; withdraw the promise to "replace each"; a measured modifier cannot reproduce a -6/-40 point penalty |
| 11 | Replace +15 with an eligibility rule on "keep" | CHANGE TO: delete the +15 only after the measurement; add no new eligibility rule (forced changes are already injected into every candidate); restrict to the confirmed tier and keep the BB and GLP-1 carve-outs |
| 12 | Rhythm condition for beta-blockers; swap hospitalization source | NEEDS DATA: numbers are the author's recollection; do not ship until read; rate control must be scored, not text, to match HTN; record as a guideline divergence |
| 13 | Widen extrapolated intervals by d2 and apply mean attenuation | NEEDS DATA / CHANGE TO: variance widening only, no mean attenuation; d2 from at most four pairs; selection-bias contradiction with item 5 |
| 14a | Keep thiazide creatinine row for add-on to loop | CHANGE TO: the engine has no "on a loop" condition; either build it or say the row is charged to every thiazide user |
| 14b | Dapagliflozin genital infection women: HF trial base x sex multiplier | NEEDS DATA: base and multiplier definition not specified; figures unverified; effect is small |
| 14c | ARB health status "not measured" | UPHOLD |
| 14d | Keep GLP-1 reduced EF pool | CHANGE TO: stop pooling cross-drug trials with opposite signs into a benefit row that credits continuation where the engine bars initiation |
| 14e | Keep IV iron row, note overstatement | CHANGE TO: either keep with the caveat printed on the card, or hold the row as a flagged owner decision; "knowingly overstated, kept" breaks P2 |
| 15 | Keep on-treatment SOLVD dose | UPHOLD (direction is conservative); state the mixed dose-definition convention |
| 16 | Baseline risk next, MAGGIC | CHANGE TO: not next. Needs a joint baseline/horizon design with HTN; MAGGIC inputs claim not verified; does not make weights derivable |
| sub A | Loop full credit at any dose | UPHOLD |
| sub B | Loop neutral without congestion, cite ReBIC-1 | CHANGE TO: keep "assumed neutral" label; drop the citation as support (it is about symptoms, unverified, underpowered for events) |

Three items where I am most confident the draft is wrong: item 6, item 11, item 4 (details at the end).

---------------------------------------------------------------------

## 1. Compatibility table (HF draft versus the HTN engine today)

HTN passages are from `Docs/PATHSCORE_HOW_IT_SCORES.md` (PS), `Docs/CARDIOMETABOLIC_COMPATIBILITY.md` (CC), `Data/PathScore/policy-v1.json` (policy), `PROJECT_STATUS.md` (PSTAT).

| # | What HTN does today | Same as draft? | Which engine should change |
|---|---|---|---|
| 1 Starts/increases/dose credit | PS 3.2: "A dose below the lowest dose the cited trials used earns no credit where that dose was obtained; for most entries it was not obtained ... those earn full credit at any dose". PS "Dose changes over time": "Not modelled: starting at the label's starting dose (a new medication can enter at any labelled dose, and first-ranked regimens often use high doses); dose reduction; stopping or switching; a titration schedule or time to full effect". Blood-pressure benefit is by dose offered (a_j + s_j (B - ref) per dose). PSTAT item 10: dose titration at visits is the next HTN plan. | No. HF credits a start at 1 at any dose; HTN credits the lowering at the offered dose and outcome need credit 1 at any dose (notObtained). In one merged regimen the same carvedilol 3.125 mg start would be a tiny BP effect (HTN) and a full death benefit (HF). | Neither alone. One dose model for both (horizon-based credit over a titration schedule). This is HTN decision 10 and HF decision 1: one decision. |
| 2 Weights/profiles | policy: weights by cost sensitivity 0 to 10: row 0 = bpControl 0.40, protection 0.20, sideEffects 0.22, cost 0, adherence 0.18; each level adds 0.06 to cost and scales others. PS 4.1: "weights are value judgements with no evidence behind them". | No (mechanism). HF: fixed six weights (cost 0.14 always) plus four discrete care_priority profiles. HF's Patient has `cost_sensitivity` 0 to 10 but the profile, not the slider, sets the weight row (`scoring.ts` line 275 passes it to the cost score only). | One patient-preference mechanism. HTN's continuous cost-sensitivity rule is the more principled shape (P4); HF should move to it or both to profiles. |
| 3 Severity weights, transform | policy: severity 0.5/1/3; symptom weight 1; avoidMultiplier 3. PS 3.3: `sideEffects = max(0, 100 - burden)`. | Weights yes. Transform no: HF `sideEffectScore = max(0, 100 - burden/2)` (`scoreModel.ts`). Effective ranking weight per burden point: HF 0.14/2 = 0.07; HTN 0.22 (0.18 at cost-sens 3: 0.1804). Ratio about 3.1. HF's own `harmDefinitions.json` method.scale says "side-effect score = max(0, 100 - burden)" (divisor 1) so the data file contradicts the code. | Both. Unclamped transform in a common currency (needs item 16); until then HF should print "HF-only divisor". |
| 4 Unmeasured/bounded harms | PS 3.3 rule 6: "an upper bound: the largest placebo-controlled excess of that harm for any class in the catalog (extrapolated, 'upper bound'); without even that, a serious harm leaves the drug listed and not scored". PSTAT decision 2: "Whether an upper bound is charged as a point value. Today a class with no figure for a harm is charged the largest excess recorded for any class (2.8 points for low sodium)." OPEN for the owner. | The draft answers HTN's open decision for HF only (half the bound). Today both charge the full bound (same rule R9 vs rule 6). | Joint owner decision; change both or neither. HTN's torsemide hyponatremia 2.8 is itself a bound borrowed from baxdrostat. |
| 5 Shrinkage | PS 3.2 step 3: DerSimonian-Laird tau2 per outcome (stroke 0.00761, coronary 0.000772, HF 0.017194), `k = tau2/(tau2+SE^2)`, `eta = 1 + k y/ln RR_L`; mean fixed at "no difference from the other classes pooled". Shrinks a class-versus-average comparison. Condition needs (HFrEF, post-MI) use UNSHRUNK point estimates: catalog needs q = "class-level meta-analysis estimate where one exists, otherwise the trial with the most events". | Same family of method, different quantity and centre. HF tau2 0.0596 centred on no effect versus placebo; HTN tau2 centred on no difference between classes at equal pressure. HTN's HFrEF need uses Garg ACE-inhibitor OR 0.77 unshrunk; HF row says ACEi death RR 0.80 (pooled five trials), shrunk. | HF and HTN should read ONE outcome table for any outcome and shrink once, at the point where the term enters the regimen sum (CC point 5). HTN's need entries (unshrunk, different numbers) must be replaced. |
| 6 Per-visit limit | policy: "New ingredients per step: default 2; at most 4", counted as active ingredients (a two-ingredient pill counts as two), plus dose increases in addition. Anchor: "Outcome trials tested starting one or two agents and titrating". | No. HF counts class groups, excludes dose changes, rescue drugs count; draft proposes 3 and rescue exempt. | One patient-level limit in one unit. CC section 2: "Two engines each 'allowing' three pills produce six." Keep 2 in both. |
| 7 Finerenone 41 to 49 | No finerenone in the HTN catalog (not an antihypertensive). | n/a | n/a; but see item 7 note on reporting. |
| 8 KCCQ | No KCCQ. HTN symptom handling is a harm: "symptom figure ... percent with one or more symptoms attributable to treatment" at weight 1. HTN needs: "afRate" (symptom control) and "anginaRelief" are scored needs with policy weights 0.5. | n/a / partial. | Symptom benefit needs one currency across engines (P5). Not resolvable by an HF-only anchor. |
| 9 Low-dose credit | Nothing equivalent; 31 of 49 entries "notObtained, full credit". PSTAT item 10 and PS section 7 list this as open. | No. | Joint with item 1. |
| 10 Fixed penalties | policy: hardFloorSBP 100, hardFloorDBP 50 (a regimen projecting lower is rejected); down slopes 2.0 and 4.0 per mmHg below band, doubled when frailty/fall risk/orthostasis; "Table limits". All labelled policy. | Both have labelled policy penalties; different mechanisms (HTN projects BP and prices it continuously; HF penalises recorded SBP/K/HR in fixed steps and no longer projects). | Merged tool needs one BP-safety mechanism. HTN's continuous slope is closer to a measured modifier; HF's fixed steps are the odd one. |
| 11 Forced swap bonus | HTN: "Stopping or switching a current drug is not modelled" (PS section 7 item 9). | n/a | HF only. |
| 12 BB in AF | HTN need `afRate` credits beta-blockers with coverage 1.0 "by class of recommendation (decision C7), labelled symptom control". HTN need `hfref` credits bisoprolol RRR 0.34 and carvedilol 0.35 for mortality with no rhythm condition. | No. Draft makes BB near-neutral for death in AF and leaves rate control "as text". | One table with a rhythm condition; rate control scored in the same currency as HTN's afRate. Also HTN's class-of-recommendation coverage is a guideline input (a P3 breach in HTN). |
| 13 Extrapolated intervals | Extrapolated harm rows print a "range"; outcome rows are not widened. | n/a (HTN has no equivalent). | HF-first, then HTN's extrapolated entries. |
| 14 Weak rows | PSTAT decision 1: "One way of measuring each harm, across classes. ... Fix one rule per harm, or keep the figures and print the asymmetry." Also PS: laboratory-only harms weigh equal to symptoms is an owner decision. | Draft 14e raises it correctly as cross-engine; others are HF-local. | 14e joint. |
| 15 SOLVD denominator | HTN: dose evidence "notObtained" for most entries. | n/a | n/a |
| 16 Baseline risk | PS section 7 item 9: "there is no 'events prevented per 1000' display (it needs a baseline risk the request does not carry)". CC section 5: baseline risk is a "Medium: a request field through the gates and both implementations (deferred from Plan G as its own plan)". PSTAT decision 7(e) "the deferred events-prevented model". | Both lack it; the draft would build an HF-only version (MAGGIC). | One baseline-risk specification (horizon, outcomes, source) for both; HF-only MAGGIC creates a third incompatible baseline. |
| Sub A/B Loop diuretics | HTN: torsemide `notMeasured` protection 1.00; loops carry no outcome credit. | n/a | Merged tool: loop's Cochrane HF effect conditional on congestion must enter once. |

### How a shared drug gets its harm rows: would it carry two burdens? Yes.

HTN burdens (PS 3.3 table, standard dose, no multipliers) against HF reference-run burdens (README section 9: 60-year-old man, one drug at its second listed strength; doses are not identical, so treat the ratio as indicative):

| Drug | HTN burden | HF burden | What differs (verified in the data files) |
|---|---|---|---|
| Lisinopril | 6.09 (10 mg) | 12.8 | HF itemises hypotension 3.8 as a symptom; HTN uses the Law 2003 pooled "any symptom" 3.9 class figure. Hyperkalemia HTN 1.2 vs HF enalapril 0.241. Creatinine HTN 1.3 vs HF 0.673. |
| Losartan | 1.53 | 12.5 | HF sibling rows from CHARM candesartan: hypotension 3.184 (symptom), creatinine 2.111, hyperkalemia 1.377; HTN losartan symptom figure floored at 0. |
| Atenolol/metoprolol | 11.51 (atenolol) | 24.1 | HF charges syncope 3.0 (COPERNICUS carvedilol) at weight 3 = 9 points; HTN charges syncope 0.6. HTN charges first-degree AV block 3.4 x 0.5; HF charges advanced AV block upper bound 0.261 x 3 instead. |
| Chlorthalidone | 14.88 | 38.1 | HF adds creatinine 29.3 x 0.5 = 14.65 (72-hour inpatient CLOROTIC row) and hypomagnesemia upper bound 21.6 x 0.5 = 10.8; HTN has neither. |
| Torsemide | 5.19 | 36.8 | HF adds hypomagnesemia 10.8; hypokalemia 6.2 (thiazide sibling) vs HTN 0; urinary frequency 14 (HF) vs 14/1.6531 = 8.47 (HTN applies a label-to-Law calibration ratio, HF does not); hyponatremia 2.165 (HF) vs 2.8 (HTN). |
| Spironolactone | 11.14 | 11.2 | Close, but HF charges gynecomastia to men only; HTN charges 4.63 to everyone (PSTAT decision 3). |

Other same-drug conflicts the draft does not mention:
- Black ancestry angioedema multiplier on ACE inhibitors: HTN 1.74 (ALLHAT, "0.68% against 0.39%"); HF 2.5 (PARADIGM label ratio) and HF's own table says the 0.68% figure "is the OCTAVE enalapril overall rate", which means HTN's 1.74 may rest on a misattributed number (`NR-ACEi-Black-ALLHAT`).
- CKD x 3.33 on hyperkalemia (Einhorn 2009) in HTN versus none in HF (an eGFR modifier is "not representable": `NR-eGFR-WRF`).
- HFrEF mortality for the same drug, two numbers: ACEi HTN 0.23 RRR (Garg OR 0.77, unshrunk, dose notObtained) vs HF 0.80 RR (shrunk, dose-credited); MRA spironolactone HTN 0.30 vs HF pooled MRA 0.73; carvedilol 0.35 vs HF beta-blocker 0.66.
- Population matters legitimately: HF-population rates (hypotension) differ from HTN-population rates; the merged tool must pick the row by patient state, never average. But several HF rows are literally HTN data (thiazide hypokalemia 6.2 from SHEP, gout from a hypertension case-control), so those must be one row.

Conclusion: under the draft the same drug carries two harm burdens, two death effects and two dose credits in the merged tool. The draft names none of this; it mentions the scale only for severity weights.

---------------------------------------------------------------------

## 2. Principle audit and per-item verdicts

### Item 1. Start/increase credit

Draft leans on: P1/P2 (trial ITT = "policy it begins"). Literal test:
- No guideline used as a reason. But the draft rejects (b) because "dose form decide[s] leads earlier in this round" (it chose by the effect on leads). Mild P3 smell, not a breach.
- The scheduling-index argument is not what the code computes. `planCreditsFor` gives any start or any increase credit 1. The ratio "1 : 0.64 = 1.56" holds only for a drug sitting at its starting dose (increase gains 1 - 0.364). A drug already at credit 0.7 gains 0.3 from the same increase; the draft's ratio changes by drug and dose. The scheduling criterion (best average gain per step over a chain) is a rule for ordering steps inside a known chain; the engine does not build chains.
- "ATLAS/HEAAL are ITT trials of titrate-up versus stay-low": ATLAS and HEAAL randomised two dose TARGETS (both arms titrated). That justifies credit for a PLAN to reach the high target, not for a single one-step increase when two or three steps remain. The draft lists this as falsifiable and I say it fails: one step from 5 to 10 mg earns credit 1 (anchor 16.8 mg for enalapril).
- Correction (cap): the claim "not already applied" is partly wrong. `doseAnchorMg` already conditions anchors on eGFR (eplerenone/finerenone rows) and `outcomeDoseCredit` is used for held drugs; only `planCreditsFor` returns an unconditional 1. So the correction is real for starts/increases but only for caps that exist as data. Heart-rate and blood-pressure holds are tolerance limits, not caps; applying "highest allowed dose" to them would extend the discount to patients the trials did include.
- Compatibility: conflicts with HTN's offered-dose crediting (table above).
- Safety direction of the correction: lowers the credit of starts and increases in CKD patients, so it pushes away from RAAS/MRA in CKD. Unseen behavior change toward under-treatment; must be shown in the golden diff.
Verdict: CHANGE TO "keep (a) as labelled interim policy; apply the cap only for caps that are data today; resolve jointly with HTN titration (their decision 10)".
Explainability sentence (true version): "Starting or raising this drug is credited with the trial benefit measured at the highest dose this patient is allowed, as if titration continues, while the side-effect cost is charged in full now." That is a true, plain sentence, but it states a planning assumption the tool does not require anyone to carry out; say so on the card.

### Item 2. Weights

Leans on P4/P5. Literal test:
- "No number here is measured" is honest. The "rough utility check" gives conversions ("one death = 14 serious or 43 moderate adverse events at 10% annual mortality", "1 KCCQ point about 1 death-score point") with no derivation and no cited utility mapping. P2 forbids presenting that as a best estimate; it is a hand calculation with hidden inputs. I could not reproduce "14" and "43" from the stated weights (a death-score point is 0.30; a burden point 0.07; a serious AE is 3 burden points).
- It argues that hospitalization at 22 is justified because "trials treat first hospitalization as equal to cardiovascular death in the primary composite". That is a trial endpoint convention, i.e. the same kind of reason as a guideline. It also concedes side effects are overweighted "perhaps 3 to 10 times" and then keeps them. That is allowed as labelled policy, but the record should not call the numbers "checked".
- "The profiles already move few first options (9, 35 and 0 of 337)" comes from a throwaway script that "was not kept" (README section 10 item 2). Cannot be quoted as measured.
- "Derive four clinical weights when baseline risk exists (item 16)": false dependency. Baseline risk gives absolute event counts. Converting events to a common utility needs disutility weights for death, HF hospitalization, symptoms and each severity grade. None exist (HTN: "no published utility weights were found"). Item 16 does not derive the weights.
- Cross-engine: HF burden weight is 0.07 per point against HTN 0.22.
Verdict: CHANGE TO keep labelled policy; delete the utility check and the item-16 dependency; record the HTN gap.
Explainability: "The order weighs death 30, hospitalization 22, symptoms 10, side effects 14, cost 14, dosing burden 10; these are our value judgements, not measured." True and plain.

### Item 3. Side-effect scale

Leans on P1/P5. The draft says "any change must be made in both, so it is a cross-engine decision" and then says KEEP the divisor 2. The divisor is exactly the HF-only deviation: `sideEffectScore = Math.max(0, 100 - burden / SIDE_EFFECT_BURDEN_DIVISOR)`, HTN has no divisor. So the draft itself identifies a breach of P1/P5 and keeps it. Also "equivalent to halving the weight" means HF's side-effect weight is effectively 0.07 where HTN's is 0.22. The reason for the divisor (a clamp at 0) is a property of `100 - burden`, which neither engine should keep. I could not run the clamp measurement; with README reference burdens, a four-drug quad plus a loop and thiazide reaches about 115, which would floor to 0 at divisor 1 but not at divisor 2.
Verdict: CHANGE TO: keep divisor 2 only as a recorded HF-only deviation; fix `harmDefinitions.json` method.scale text; put "unclamped common-currency transform" on the joint owner list.
Explainability: "Side effects are scored 100 minus half the burden; the hypertension tool uses the full burden, so the two are not comparable yet." That sentence is true; the tool cannot honestly say more.

### Item 4. Ten upper-bound rows (changes behaviour)

Leans on P2. Literal test:
- "Charge half the bound (mean of a uniform prior between zero and the bound)": a uniform prior on [0, max] has no basis. The bound is the largest value among measured classes, which is skewed. The data show it: for syncope, measured rows have median 0.175, mean 0.562, max 3.0 (half-max 1.5); for renalSeriousEvent median 0.089, mean 0.173, max 1.393 (half-max 0.697); for hypotension symptom figure median 1.414, mean 2.011, max 5 (half-max 2.5); for avBlockAdvanced median 0.145, mean 0.096, max 0.261. Half the max overstates the mean of measured classes by 2 to 8 times for the serious rows, so "expected value" is not what the rule computes. If the owner wants an expected value, the defensible estimate from the table itself is the mean or median of the measured classes for that harm, with the range shown.
- The hypomagnesemia bound (21.596) is patiromer's own rate (`patiromer-hypomagnesemia`, the only measured row). It is a mechanism of the binder, not a bound for diuretics. Half of it (10.8) is still arbitrary. This row needs real data (loop/thiazide hypomagnesemia literature), which the draft's rule (1) would search for, but then the rule for the other rows is moot.
- The motivating claim ("makes loop and thiazide look harmful, about 11 points each") mixes units. 10.8 is burden points. Ranking effect = 10.8 / 2 x 0.14 = 0.76 points. Diuretic benefit after shrinkage in a congested patient: death 100 x (1 - 0.83) x 0.30 = 5.1 plus hospitalization 14 x 0.22 = 3.1. The ten bounds together can shift an option by at most about 1 ranking point (vasodilator syncope 9 to 4.5 burden = 0.32; renal SAE 4.2 to 2.1 = 0.15 per drug; AV block 0.78 to 0.39 = 0.03). The change cannot rescue a diuretic from being "looked harmful", because they are not ranked down by these rows. HTN's own equivalence band is 2 points.
- Direction in an unvalidated tool: it lowers the charged cost of serious events (syncope, renal SAE, advanced AV block) that a clinician reviewer will look at first.
- Conflict: decides HTN's open decision 2 unilaterally.
- "The rule 'an unknown must not make a drug look safer' was adopted for missing PATIENT values" is a distinction the README does not make; it states the rule for patient values only in code, but R9 (upper bound) for drug harms is also a deliberate conservative choice recorded as a ruling.
Worst displayed recommendation newly possible: a congested patient, SBP 93, K 3.7, eGFR 29: options "furosemide + metolazone" move up by roughly 0.8 points each and can displace a single-diuretic option within ties. Existing stops: E21 (potassium below 3.5 only), metolazone/loop hypokalemia caution below K 3.5, HCTZ eGFR<30 caution, -6 for SBP<95 band. None stops it. The effect is small but is the wrong direction for the unvalidated tool.
Explainability: "Where no study measured this harm for this drug, we charge half the largest rate seen in any class." For loop diuretics the sentence would have to continue "...which for magnesium is a potassium-binder rate". That is not a defensible clinical sentence: finding.
Verdict: CHANGE TO UPHOLD current rows; label each as "upper bound, not measured"; escalate with HTN decision 2; in the meantime search for real diuretic hypomagnesemia data (NEEDS DATA).

### Item 5. Precision weighting

Leans on P2. Test:
- Method is uniform and computed. Fine. One internal contradiction: item 5 says centre on no effect because the table is "a selected set of drugs that succeeded", yet tau2 (0.0596) is itself estimated from that selected set, and item 13 uses that same selected set to estimate d2. If the selection argument is valid it biases tau2 too.
- Normal prior sd 0.244 on ln RR makes the Cochrane death figure (ln 0.24 = -1.43) a 5.9-sd outlier; B = 0.13; used 0.83. A heavy-tailed prior would keep much more of it. The draft does not test sensitivity. P2 says decide under uncertainty, not that every effect is normally distributed around zero.
- "Read the owner's ruling as: use them through the same rule." README section 6a says: "His ruling does not cover how the figures are precision-weighted". The owner said "use the Cochrane diuretic figures for congested patients"; he may not know the used value is 0.83 and 0.86, not 0.24 and 0.07. The draft turns an open question into an interpretation.
Verdict: UPHOLD the method. CHANGE TO: return the reading to the owner with both numbers side by side; add a heavy-tailed sensitivity.
Explainability: "The published figure is 0.24, but because it comes from about 200 patients we count it as 0.83." True and plain; and it is exactly the sentence the owner has not seen.

### Item 6. Default 3 classes, rescue drugs excluded (changes behaviour)

Leans on P2 (measured evidence: STRONG-HF). Literal test:
- "STRONG-HF supports three" is not a measurement of a per-visit limit. STRONG-HF tested an intensive follow-up PACKAGE (frequent visits, labs, NT-proBNP guidance) with rapid up-titration of drugs in post-discharge patients. Whether it started three new classes at once is not what it measured; its primary comparison is care strategies. The draft's own text says "with visits and laboratory checks at 1, 2, 3 and 6 weeks". The engine does not require those visits when it displays a three-class plan. So the sentence "evidence supports three" is a guideline-style citation (the ESC guidelines cite STRONG-HF for rapid sequencing) applied without its condition. Under P3 it is guideline concordance used as an input. The draft even proposes to decide by "first-option changes and guideline concordance with 3 and with 4", which is tuning to a guideline target.
- Safety claim is false: "The engine already has separate gates for projected blood pressure, potassium, heart rate and kidney function". Since rule set .8 the engine projects nothing: `effects.ts` builds `riskScreen` with `basis: 'observed_state_only'`; README: "Recorded measurements are never altered or projected". The SBP/K/HR bands act on RECORDED values and are the same for a 1-class and a 3-class start. The class limit is therefore the only control on cumulative hemodynamic and potassium load of a co-start, not a second blunt gate on the same risk.
- Rescue exemption contradicts the repo's documented purpose: CLAUDE.md says the count includes rescue "intentional, test-ratified ... a patient-facing sequencing limit ... Do not 'fix'". The draft argues only about physiologic risk; the limit is also about what a patient can absorb in a visit.
- Mechanism not established: the observation (ARNI switch competes with SGLT2i) is likely not caused by the limit. `getMedicationClassGroup` puts ACE inhibitor, ARB and ARNI in one RAAS group, so a swap to ARNI adds 0 new classes. With limit 2, "swap + add MRA + add SGLT2i" is two new classes and is allowed by the limit. The generator (`candidates.ts` lines 928 to 945) builds "swap + addition" only over `pillarLists[0]` (the first missing pillar), and "adjunct + pillar" likewise; it never builds swap + two additions. Raising the limit changes only the `product(pillarLists, 3)` enumerator, which fires only when three pillars are missing. So the default 3 would not fix the observed behavior, and activates a rarely exercised combinatorial path.
- Compatibility: HTN default 2.
Worst plausible displayed recommendation: new HFrEF outpatient (LVEF 25, SBP 96, K 4.8, eGFR 36, no GDMT) shown "start ARNI + beta-blocker + MRA" (plus SGLT2i not counted as the fourth). Existing stops: E15 (MRA not at K >= 5.0), E18 (RAAS not above K 5.2), E20 (eGFR 20), -6 for recorded SBP < 95 (SBP 96 escapes it), BB heart-rate rules, the 48-to-72-hour lab check. None is regimen-dependent; none sees that three drugs lower BP and raise K together. A clinician reading "start three drugs now" at SBP 96 is the case a case review would stop on.
Explainability: "Up to three new classes may be started per visit because STRONG-HF started them quickly with weekly follow-up" is not a true sentence for this tool, because the tool does not arrange the follow-up. The only true sentence: "This is a limit we chose; it is a setting." Finding.
Verdict: CHANGE TO keep default 2; keep rescue counting; fix the enumerator separately (swap + up to the permitted number of pillar additions); make the limit a visibly labelled policy input; if 3 is ever allowed, tie it to a recorded "close follow-up arranged" input.

### Item 7. Finerenone at LVEF 41 to 49

Leans on P3 correctly (evidence governs). Test: no guideline used as a reason. But "record the three guideline targets as documented divergences, not misses" changes the validation metric: the report currently says "3 of 7 reproduced"; reclassifying three misses raises it to 6 of 7 without any change in behaviour. P3 says guidelines are the validation target; a divergence the model chooses is still a miss against the target, with an explanation. The draft's own cited facts (FINEARTS-HF enrolled LVEF 40% or above; FDA label) are plausible but I did not verify them, and the draft lists "what the 2026 ESC guideline says" as unverified.
Verdict: UPHOLD display; CHANGE TO: the report prints "diverges, with reason", still counted as divergence.
Explainability: "Finerenone is shown at LVEF 41 to 49 because the trial that supports it enrolled LVEF 40 and above; the ESC 2026 guideline does not list it there." True, plain.

### Item 8. KCCQ anchor and additivity

Leans on published "large change = 20 points". Policy anchor, fine. Problems:
- "A full regimen stays under the 20-point clamp" fails by the README's own numbers: beta-blocker 6.57, GLP-1 7.5, IV iron 4.45, vasodilator 3.04, ARNI 2.76, SGLT2 2.14, which sum to 26.5 before MRA and the RAAS agent; in HFrEF 6.57 + 2.76 + 2.14 + 4.45 + 3.04 = 19. Large regimens reach the clamp, where benefit stops discriminating.
- KCCQ differences are placebo-corrected and net of the adverse symptoms of the drug. The side-effect model then charges symptom lines (dizziness, fatigue, hypotension, cough) at weight 1 again. This double-charges symptom harms. The draft does not mention it. It matters for the merged tool where HTN charges symptom figures as harms with no matching benefit.
- "Within a factor of two" is again the unshown utility check.
Verdict: UPHOLD anchor as policy; NEEDS DATA / owner decision: symptom-line double charge.
Explainability: "Quality-of-life gains from different drugs are added, which no trial measured." True.

### Item 9. Low-dose credit

- MOCHA numbers are recollection (unverified): placebo 15.5, low 6.0, 12.5 mg 6.7, high 1.1 percent six-month mortality, n about 345; roughly 13, 5, 6 and 1 deaths. A credit from five and one deaths has an interval spanning 0 to above 1; calling it "corroboration" of 0.364 is a confirmation bias.
- It breaks item 5: the repo's c0 is an unweighted mean of four values, two of which are "not bounded by their data" (README section 6d). The same draft insists on precision weighting for every other number with "no per-row exception".
- c0 is a number that sets how much benefit increases are worth (README item 10); P3 test: c0 was solved from ATLAS/HEAAL (measured), fine.
Verdict: CHANGE TO: no MOCHA corroboration; if adopted, a class-specific beta-blocker row with its interval; precision-weight c0 or state it is an unweighted convention. NEEDS DATA: MOCHA figures.

### Item 10. Fixed penalties

- Draft claims penalties are guardrails that stop an SBP < 90 option ranking first. The code already hard-stops that: `gates.ts` line 539 "SBP < 90 or K+ >= 6.5 returns alerts only (no regimen output)". So the -20 (SBP < 90) and set-to-0 (SBP < 85) adjustments are unreachable for recorded SBP; the reachable bands are -6 at 90 to 94, K above 5.5 (-40, but E15 and the continuation rules already withhold), HR < 50 (-40). (I did not execute; this is from reading `scoring.ts` lines 407 to 427 and `gates.ts`.)
- The proposed "replace each penalty by a verified measured modifier" is not possible in this arithmetic. A modifier multiplies a hypotension symptom row of 1 to 5 percent at weight 1: even a tripled multiplier moves an option by well under 1 ranking point; the -6 penalty is 6 ranking points. Replacing it would remove the guardrail the draft says it keeps.
- The repo notes `NR-SBP-hypotension`: "NOT MEASURED NUMERICALLY in anything I could read: the full text was not available (abstract only)". The draft believes the first search missed the papers; the more accurate reading is that the papers were found, abstract-only. The draft is probably right that a full-text read would find rates, and that part is a legitimate NEEDS DATA.
Verdict: CHANGE TO keep labelled policy; delete the promise of replacement unless the modifier is coupled to a threshold-type rule; NEEDS DATA: read the full texts.
Explainability: "Options carry a fixed 6-point penalty when systolic BP is 90 to 94; this is a safety rule we set." True.

### Item 11. Mandatory swap bonus (changes behaviour)

Leans on P3 (a number should not choose between options). Read the code:
- Forced changes are already injected into every candidate: `candidates.ts` lines 997 to 1062 push a forced swap or removal into each candidate for every drug in `contraindicatedCurrentMeds` (hard contraindication, confirmed intolerance, allergy, redundancy). So no candidate keeps such a drug today. The draft's premise ("an option that keeps it should not be displayed ... then nothing competes with the switch") is already true for that set. What the +15 actually decides is swap-candidate versus remove-only-candidate, both of which drop the drug.
- If implemented literally as a display-stage eligibility rule on "documented as not tolerated", it would break the carve-outs recorded in `intolerance.ts`: "an existing BB is continued (abrupt withdrawal = Class III harm), and a currently-tolerated GLP-1 is not removed for a historical GI intolerance to a prior agent". `currentMedIntoleranceReason` fires only for confirmed ACEi cough/angioedema, ARNI angioedema, MRA hyperkalemia and gynecomastia. The "suspected" (free-text) tier deliberately affects new starts only ("protects against negated free text like 'no cough'").
- NO displayed option? Yes, possible with a display-stage rule: pregnancy case in `candidates.ts` line 197 to 198 "a non-selective beta-blocker that could not be switched ... is kept, never increased"; blank potassium (E16) withholds a new RAAS start, so `swappable` is empty for an ACEi-cough patient and only plain removal exists; removing keep there leaves "Remove ACE inhibitor" as the only option, with no replacement. A clinically necessary "keep for now" (life-prolonging drug the patient reports not tolerating but is currently tolerating) would be hidden.
- The +15 is also not the only hand-set bonus. README section 7 lists `VOLUME_DEPLETION_DEESCALATION` +15 as well (a hand-set bonus for a clinical state). The draft and the README's "the one remaining hand-set number" overlook it; the claim is true only for the special-feature sum.
- With the bonus removed, who wins? A swap keeps benefit through `planCreditsFor` (same-class swap gets the larger credit), so swap beats removal when its measured benefit exceeds its harm plus cost. In HFpEF or mildly reduced EF, where ACEi/ARB/BB rows are near neutral and each costs 12 to 24 burden points, plain removal can win. That is a first-principles consequence; the bonus currently masks it (up to +12 points). The draft's "to be measured" plan is the right test.
Verdict: CHANGE TO: measure with the bonus at 0; if no first option changes among the 17, delete the +15; add NO eligibility rule; keep confirmed-only and carve-outs; keep E-rules as they are.
Explainability: "A drug you cannot take is not offered; its replacement is judged on its own benefit, harm and cost." True and plain for the confirmed tier. For the draft's broader wording ("documented as not tolerated") the sentence would be false for beta-blockers and GLP-1: finding.

### Item 12. Beta-blockers in AF; hospitalization source (changes behaviour)

- Kotecha 2014 numbers (0.73 sinus, 0.97 AF) are the author's recollection; the draft applies the strictness "no unverified sign in the table" to 14c but not here. NEEDS DATA: read Kotecha 2014 and Cleland 2018 for the hospitalization by rhythm; I could not verify whether hospitalization by rhythm is reported.
- P3: the guideline (ESC) still recommends beta-blockers in HFrEF with AF; this change deviates; the draft records divergences for item 7 but not here.
- P5/HTN: HTN scores AF rate control as a need (`afRate`, weight 0.5, symptom control) and credits beta-blockers for HFrEF mortality without a rhythm condition. The draft leaves rate control "as text", so in the merged tool the same beta-blocker has a rate-control benefit in one engine and none in the other.
- After precision weighting 0.97 (0.83 to 1.14) is used as about 0.973: "close to neutral for death" is accurate but a 3 percent benefit is not an absence of evidence; this is a subgroup (about 3,000 patients) where the interval includes 0.83.
Worst displayed recommendation: HFrEF in AF with HR 118 and a beta-blocker not yet on board: with the BB near-neutral and rate control unscored, options without a beta-blocker can lead (SGLT2i, MRA, ARNI each with measured benefit), with rate control mentioned only in text. Existing stops: BB initiation heart-rate rules (HR < 55/50 blocks), acute decompensation blocks, digoxin indication gate (AF requires beta-blocker optimised: `candidates.ts` "AFib: beta-blocker optimized"), none stops the beta-blocker from falling out of option 1.
Explainability: "In atrial fibrillation, pooled trials show no clear survival gain from beta-blockers (0.97, 0.83 to 1.14), so little benefit is credited; rate control benefit is not scored." True only if the draft's numbers are verified; and the last clause advertises a gap.
Verdict: NEEDS DATA.

### Item 13. Widen extrapolated intervals (changes behaviour)

- Sources: d2 estimated from four classes measured in two bands (SGLT2i, ARNI, MRA, candesartan). Four pairs give an unstable variance of differences.
- Selection: the pairs are drugs successful enough to be tested in a second band: the same "succeeded" set that item 5 rejects as a centre.
- Double shrinking: precision weighting already pulls toward no effect; widening se pulls further (B drops); a mean attenuation shifts the estimate first. Three stacked pulls toward neutral. In mildly reduced and preserved EF this favours doing less than the evidence supports, for drugs the trials do support.
- Specific: "death about 0.87 against 1.0, 0.84 against 0.97, 0.70 against 0.91" are three of the four pairs in a single sentence, unverified, and chosen as examples.
Verdict: NEEDS DATA; CHANGE TO variance widening only (no mean attenuation), shown with n pairs and its interval.
Explainability: "Because this drug was measured in a different EF group, we widened the uncertainty by an amount estimated from four other drugs." True; and shows the weakness (n = 4).

### Item 14 (a to e)

- 14a: README: `hctz-creatinine` 29.3, `chlorthalidone-creatinine` 29.3 siblingProxy. The harm model has no condition kind for "loop on board" (`HarmCondition` kinds: egfr_below, potassium_at_least, sbp_below, age_at_least, sex, self_identified_black, has_diabetes, no_diabetes, has_gout). "KEEP for a thiazide added to a loop" cannot be implemented without a new kind, and today the row is charged to every HCTZ or chlorthalidone user (14.65 burden, about 1.0 ranking point), while HTN charges none. CHANGE TO: build the condition or state the row applies to all.
- 14b: base (a placebo-controlled HF figure) and multiplier (sex ratio from a diabetes pool) need a stated algebra: the HF figure is a mixed-sex rate, the label pool gives sex-specific rates. NEEDS DATA: EMPEROR-Reduced figures are recollection; effect is small (a few burden points, under 0.3 ranking).
- 14c: UPHOLD. The sign was read from an abstract that does not state it; "not measured" is the labelled default already used for six classes. Change is about 0.2 ranking points.
- 14d: the row pools semaglutide SELECT with liraglutide FIGHT and LIVE (different drug, small trials, a harm signal in HFrEF). The engine bars GLP-1 initiation at LVEF <= 40 but the row credits death 0.83 for continuing in reduced EF. That gives a mortality credit to continuation where the evidence outside SELECT is neutral to harmful. CHANGE TO: row-level assumed neutral with wide interval until the evidence is separated.
- 14e: "KEEP the row but note it overstates" knowingly keeps a number it says is wrong (laboratory nadir 66 percent at 35 days charged as a one-year rate at mild weight, 33 burden points, about 2.3 ranking points). P2 says best estimate. Raise as cross-engine (it is HTN's decision 1) but do not ship a flagged overstatement silently. CHANGE TO: print the caveat on the card or hold the row as an open owner item.
Explainability for 14b: "The female genital infection rate is the heart-failure trial overall rate scaled by the diabetes-trial ratio of women to men." True if defined; unverified.

### Item 15. SOLVD denominator

Direction right: patient taking enalapril is by definition on treatment, and pairing ITT RR with the on-treatment dose lowers credit at a given dose (conservative). One issue not mentioned: the c0 curve is solved from ATLAS/HEAAL ASSIGNED dose arms while anchors are trial-ACHIEVED mean doses; the two dose definitions share one curve (credit 1 at 16.6 mg for enalapril, while ATLAS's "high" arm for lisinopril is 32.5 to 35 mg). That is a convention to state, not to hide.
Verdict: UPHOLD; add the convention note.

### Item 16. Baseline risk, MAGGIC (see also section 5)

- "Inputs the tool already collects": MAGGIC needs age, sex, EF, NYHA class, SBP, BMI, creatinine, diabetes, COPD, HF duration over 18 months, current smoker, beta-blocker and ACEi/ARB use. My search of `types.ts` finds no smoking or HF-duration field (COPD appears as a comorbidity string in `constants.ts`). Verify before building.
- Ratio method: risk(option) = observed risk x RR(option)/RR(current) double counts beta-blocker and ACEi/ARB because MAGGIC includes them; the draft notes the doubt but still proposes it as the plan. MAGGIC is derived from pre-2012 cohorts and over-predicts risk on modern GDMT (my recollection; unverified).
- Hospitalization baseline "from control arms of trials in the table": different populations and follow-up; picks a number by trial, not by validity.
- Does not derive the weights (see item 2).
- Horizon and outcomes must match HTN's later baseline; none exists.
- It makes patients' absolute mortality appear on screen, which the README repeatedly says the tool does not predict.
Verdict: CHANGE TO not next; joint design first.

### Sub-items

- Loop full credit at any dose: UPHOLD (no measured dose relation; README states it).
- Neutral without congestion, ReBIC-1: my recollection is that ReBIC-1 is a small randomised withdrawal trial in stable outpatients (a few hundred at most) powered for symptoms/volume, not for death or hospitalization. "No difference in symptoms or need to restart" would not be evidence of neutrality on death or hospitalization, and the restart proportion is unverified (I cannot confirm it was zero). The engine row concerns death and hospitalization. CHANGE TO: keep "assumed neutral", do not cite ReBIC-1 as randomized support.

---------------------------------------------------------------------

## 3. Safety audit, summary of the behaviour-changing answers

| Item | Newly possible displayed recommendation | What already stops it | Does it stop it? |
|---|---|---|---|
| 4 | "Loop + metolazone" gains about 0.8 points in a congested patient with SBP 93, K 3.7, eGFR 29 | E21 (K < 3.5), hypokalemia caution (K < 3.5), HCTZ eGFR < 30 caution, -6 SBP < 95 | No for all but the -6; effect size small |
| 6 | Three new classes at once (ARNI + BB + MRA) at SBP 96, K 4.8, eGFR 36 | E15 (K >= 5.0), E18 (K > 5.2), E20 (eGFR < 20), BB heart-rate rules, lab check, -6 SBP < 95 | No: all use recorded values; none sees a combined start |
| 11 (as drafted) | Display-stage "no option keeps it": zero options or removal-only; hides pregnancy "keep, never increase" non-selective BB, blank-potassium swap withheld by E16, existing BB with history of bradycardia | `NO OPTION AVAILABLE` alert exists but does not offer a clinical option | Partial: alert, no option |
| 12 | HFrEF with AF, HR 118: beta-blocker falls out of option 1; rate control only text | BB initiation HR gates, digoxin gate | No |
| 13 | Evidence-supported GDMT at LVEF 41 to 49 ranked below keep or do-nothing | None | No |
| 14b, 14c | Slightly more favourable SGLT2i in women; ARB symptom 0 | n/a | n/a, small |
| 1 correction | Credit for starts and increases in CKD reduced, a push away from RAAS/MRA | E19/E20 are separate | n/a |

---------------------------------------------------------------------

## 4. Explainability: one sentence per changed answer

1 correction: "Starting or raising a drug is credited with the benefit at the highest dose this patient may take, and its side effects are charged in full now." True; says the plan assumption.
4: "Where no study measured a side effect for this drug, we charge half the biggest rate seen in any class." True; for magnesium the biggest rate is a binder's, so the sentence is true and indefensible.
6: Cannot write a true sentence that cites STRONG-HF. "Three new classes may be started in one visit; this is a limit we chose, and the tool does not arrange follow-up." True but undermines the change.
11 (draft wording): cannot write one true sentence covering both confirmed intolerance and the BB/GLP-1 carve-outs.
12: "In atrial fibrillation, pooled trials show no clear survival gain, so little is credited; rate control is not scored." True if verified, exposes a gap.
13: "Because this effect was measured in another EF group, it is widened and shrunk by amounts estimated from four drugs." True; n = 4 is the finding.
14b: "Women's genital infection risk is the heart-failure trial rate scaled by a diabetes-trial sex ratio." True if defined.
14c: "ARB quality-of-life effect is not measured; counted as zero." True.

---------------------------------------------------------------------

## 5. Order of work

Case against baseline risk (item 16) as the next build:
1. The next real-world step is a clinician case review. Reviewers judge whether displayed options are safe and understandable. A baseline-risk model adds a new patient-level number (a mortality percent) that will be read as a prediction when the tool says it is not, before the existing ranking has been reviewed.
2. It changes first options for low-risk patients (README item 17), so the review would examine a moving target.
3. It has no validated hospitalization model, and the MAGGIC ratio method has a stated double-count.
4. HTN deferred its own baseline (CC section 5, PSTAT 7e). Building HF-only MAGGIC creates a third incompatible baseline and a second horizon.
5. It does not unlock item 2 (no utilities exist).
6. It forces the harm-scale decision (item 3) the draft wants deferred.

Order I would use:
1. Pre-review, no policy: verify every recollected trial figure the draft relies on (Kotecha, MOCHA, EMPEROR-Reduced genital, FINEARTS/finerenone label, ReBIC-1, STRONG-HF design and exclusions) and mark each as read or unread.
2. Measure item 11 (bonus 0 on the 17 options); delete +15 only if no first option changes; add no eligibility rule. Remove the stale `harmDefinitions.json` divisor-1 text (item 3 documentation).
3. Fix the enumerator defect (swap + up to the permitted number of pillar additions) separately from the limit. Keep default 2.
4. Item 14c (ARB not measured) and 14a (state or build the loop condition).
5. Item 7 reporting (count the three as divergences).
6. Hold items 4, 12, 13, 14d, 14e, 1 correction until after case review, shown as open decisions with their sizes (items 4 and 14b are under 1 ranking point; item 12 and 13 can alter leads).
7. Clinician case review on the frozen rule set, with the draft's list of labelled policy numbers handed to reviewers.
8. After review: joint HF/HTN decisions (items 1, 3, 4, 5-reading, 6, 12 rate control, 14e) in one register, then the shared baseline-risk specification (item 16), then merge work.

---------------------------------------------------------------------

## 6. Three items where I am most confident the draft is wrong

1. Item 6: STRONG-HF is cited as a measurement of a per-visit limit and as the guideline argument; the engine does not project BP/K/HR (`basis: 'observed_state_only'`), so the stated redundancy with "projected" gates is false; the class limit is the only combined-start control; HTN default is 2; the ARNI/SGLT2i observation is an enumerator issue, since the RAAS switch adds no new class. Changing the default to 3 is behavior change in the unsafe direction with no measured basis.
2. Item 11: the premise is already true for the set that matters (forced swap/removal is injected into every candidate); the bonus decides swap versus remove-only; a "documented as not tolerated" rule would cut across the BB-continuation and GLP-1 carve-outs and can leave a patient with removal-only or an empty list.
3. Item 4: the motivating claim is numerically wrong (10.8 burden points are 0.76 ranking points; no diuretic is "ranked out" by them), half the bound is not an expected value (measured means are 2 to 8 times lower for the serious rows), the magnesium bound is a potassium binder's own rate, and the change decides HTN's open decision 2 unilaterally while lowering the charged risk of serious events in an unvalidated tool.

## 7. Decisions the draft should have raised and did not

1. A shared outcome table: the same drug's HFrEF death effect differs between engines (ACEi 0.80 vs 0.77/0.23 RRR unshrunk; MRA, BB similar); HTN's need entries are unshrunk and credited at any dose.
2. Symptom double counting (KCCQ net effect plus symptom-line harms) and the merged currency for symptom benefit.
3. Guideline-order mechanisms still in HF: `foundational_first` ranking mode (orders by pillar coverage), `ensureCongestionCoverage` (forces a diuretic option into the display), and the +15 volume-depletion bonus. Each is a guideline-type input under P3. HTN has the same issue (afRate coverage 1.0 "by class of recommendation").
4. One patient-preference mechanism (cost sensitivity continuous in HTN vs discrete profiles in HF) and one regimen-wide change limit.
5. The population conditioning rule for harm rows (HF vs HTN patient) and one row where the HF row is HTN data.
6. The two-tier intolerance policy (suspected vs confirmed), which determines what "documented as not tolerated" means.
7. Rule-set governance for the case review: freeze the rule set and the golden master; do not change numbers during review.
8. Whether lab-threshold harms weigh as much as symptoms (raised only as a footnote under 14e; it is the first item on HTN's owner list).

## 8. Limits of this review

I did not run the engine, so measured claims (clamp binding, the 17 options, option counts) are not verified. Trial figures not found in the repo (Kotecha, MOCHA, ReBIC-1, STRONG-HF design, EMPEROR-Reduced, FDA label, MAGGIC inputs and calibration) are from memory or the draft and are marked unverified. Burden comparisons between engines use different doses and populations and are indicative.
