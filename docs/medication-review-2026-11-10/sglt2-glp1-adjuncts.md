# Clinical pharmacology review: SGLT2i, GLP-1/GIP, vericiguat, IV iron, H/ISDN
Repo: /Users/bradeilerman/Projects/HeartFailurePath (read-only; nothing modified). Review date 2026-11-10.
Provenance tags: [verified: X] = confirmed by web this session; [memory] = from memory, unconfirmed.
Web verification was limited (FDA PDF fetch 404'd; searches returned mostly secondary sources).

Units reminder (effects.ts): bnp_reduction_percent is a retention factor (1-x, compounding); weight_reduction_kg is current-weight delta (GLP-1 part is tracked separately in glp1WeightDelta and halved into dry weight, effects.ts:437); hr_drop positive = HR falls (so GLP-1 `hr_drop:-2` = +2 bpm, correct sign); sbp_drop positive = SBP falls; starting-dose hemodynamic attenuation (x0.35) applies only to ARNI/ACEi/ARB/BB (effects.ts:133-135), not to GLP-1/vericiguat/H-ISDN.
Add-on candidates are built at the LOWEST dose tier (candidates.ts adjunct pushes tiers[0]); `getDoseTiers` (regimenUtils.ts:38-46) samples only {lowest, highest, middle-index, target}.

## 1. Dapagliflozin (constants.ts:620)
| dose | target | key effects |
|---|---|---|
| 10 mg qd | yes | LVEF +2.0, BNP retention 0.87, wt -1.5 kg, KCCQ +6, struct 15, LAVI -15%, LVEDD -3%; SBP -3, HR 0, K 0; SE genital 5%, UTI 3%, vol-depletion 2% |

Findings
- MEDIUM kccq_improvement 6 (constants.ts:631 area, line 630). Trials: KCCQ-TSS placebo-adjusted +2.8 (DAPA-HF), ~1.3-2.4 (EMPEROR-R/P, DELIVER); only the small PRESERVED-HF (+5.8 CSS) approaches 6. 6 is ~2-3x the pivotal HFrEF/HFpEF outcome-trial figures and sits in the same units as the GLP-1 values (see 3/4). Suggest 3 (2.5-3). [memory]
- LOW lavi_reduction_percent 0.15 / structure 15. LAVI effect in mechanistic SGLT2i echo studies is a few mL/m2 (~5-8%); 15% not supported. Suggest 0.06-0.08. [memory]
- LOW eGFR floor 25 (line 644). Pivotal: DAPA-CKD eGFR >=25; DAPA-HF/DELIVER >=30/25; label status of HF initiation floor not confirmed this session. Guideline/ESC 2023 practice supports initiation to eGFR >=20 for dapagliflozin and empagliflozin. Current 25 is conservative, defensible for dapagliflozin. [memory; Farxiga HF floor not verified]
- LOW SE asymmetry: dapagliflozin lists volume_depletion 0.02, empagliflozin omits it (line 636 vs 667). Same drug-class effect; add to both. Euglycemic DKA is handled via CI (type 1/prior DKA) rather than SE; fine.
- LOW No eGFR initial dip (3-5 mL/min) modelable: `Medication` type has no eGFR-effect hook (types.ts:123-148). Not an error; note as a scope limit.
- LOW Special feature "Preferred in Diabetics" +10: proportionate (small tiebreaker). OK.
- Modeled appropriately: dose (10 mg is the HF dose; 5 mg is not an HF target), BNP 13%, weight 1.5 kg, SBP -3, genital infection 5%, T1DM/DKA and pregnancy gates, initiation-only renal gate with continuation carve-out.

## 2. Empagliflozin (constants.ts:651)
| dose | target | key effects |
|---|---|---|
| 10 mg qd | yes | identical to dapagliflozin; SE genital 5%, UTI 3% |

Findings
- MEDIUM eGFR initiation floor 25 (line 674-675) is stricter than evidence. EMPEROR-Reduced/Preserved enrolled eGFR >=20; EMPA-KIDNEY >=20; the Jardiance HF label carries no eGFR dosing limit for HF/CKD (glycemic-control use is not recommended <30). The comment "Harmonized with Dapagliflozin" is the only justification, and it withholds a Class 1/2a pillar from eGFR 20-24 patients (these patients also get the "SGLT2i missing" completeness penalty only if achievable... they are filtered, so no penalty, but no therapy). Suggest `p.egfr < 20`. [verified: web summary of Jardiance label says no eGFR dosing limit for HF; EMPEROR enrollment from memory]
- MEDIUM kccq 6 and LAVI 15%: same as dapagliflozin finding. [memory]
- Coherence: the two SGLT2i are numerically identical, which is appropriate (class effect; no head-to-head). Good.
- LOW Empagliflozin SBP -3 / K 0 fine. Optional: SGLT2i modestly lower hyperkalemia risk (not modeled; harmless).

## 3. Semaglutide (Wegovy) (constants.ts:688)
Ratio = max(0.25, min(1, d/2.4)). Computed:
| dose | target | ratio | LVEF | BNP retention | wt kg | KCCQ | struct | LAVI | LVEDD |
|---|---|---|---|---|---|---|---|---|---|
| 0.25 | no | 0.25 (floor; raw 0.104) | 0.25 | 0.95 | 2.0 | 4.15 | 3 | 1.25% | 0.25% |
| 1.0 | no | 0.417 | 0.42 | 0.917 | 3.33 | 6.92 | 4 | 2.1% | 0.42% |
| 2.4 | yes | 1.0 | 1.0 | 0.80 | 8.0 | 16.6 | 10 | 5% | 1% |
SBP -4 / HR +2 at every tier; SE nausea 30%, diarrhea 20%, constipation 15%.

Findings
- HIGH kccq_improvement 16.6 x ratio (line 705) is the PLACEBO-UNADJUSTED within-arm change. STEP-HFpEF: KCCQ-CSS +16.6 semaglutide vs +8.7 placebo; between-group difference 7.8 (95% CI 4.8-10.9). The engine credits more than 2x the true treatment effect, and puts a GLP-1 at ~3x an SGLT2i despite similar trial-level differences (7.8 vs SGLT2i 2-6). This inflates the functional domain for any obese HFpEF/HFmrEF regimen. Fix: 7.8. [verified: STEP-HFpEF numbers via hcplive/ACC web summary]
- MEDIUM Dose-response is linear in dose (d/2.4) but weight loss/efficacy saturates: STEP data put 1.0 mg at roughly 70% of 2.4 mg weight effect (STEP-2: ~-6.9% vs -9.6% in T2DM). Linear gives 42%. Use a saturating map (0.25 mg 0.15, 0.5 mg 0.35, 1.0 mg 0.70, 1.7 mg 0.90, 2.4 mg 1.0) or at least ratio^0.5. Also the floor 0.25 at 0.25 mg credits ~2 kg and 4 KCCQ points at week 0-4, optimistic but acceptable. [memory]
- MEDIUM Missing titration tiers: label escalation is 0.25 -> 0.5 -> 1.0 -> 1.7 -> 2.4 mg (4 weeks each); 0.5 and 1.7 absent. With `getDoseTiers` sampling (lowest, highest, middle, target) tier set is {0.25, 1.0, 2.4}, so titrate_up from 0.25 can land directly on 2.4 mg (skipping 16 weeks of escalation; label/GI-tolerability violation). Add 0.5 and 1.7 and give titrate-up a one-step-only rule for weekly GLP-1s. [memory; label escalation well known]
- LOW weight_reduction 8.0 kg (line 704) with comment "~10%". STEP-HFpEF: -13.3% vs -2.6% (placebo-adjusted ~ -10.7 points, ~11 kg for ~105 kg). Tirzepatide's 12 kg is placebo-adjusted; semaglutide's 8 kg is not on the same footing. Suggest ~11 kg. [memory]
- LOW BNP 0.20: STEP-HFpEF NT-proBNP ratio ~0.80-0.82 vs placebo, consistent. [memory]
- LOW sbp_drop 4 not dose-scaled; starting dose gets full steady-state BP effect (and no x0.35 attenuation). Suggest scale by ratio. [memory]
- MEDIUM Contraindications/gates (lines 716-727): MTC/MEN2 and pregnancy present (correct). No LVEF gate in the formulary CI, and the engine gate is LVEF >40 (candidates.ts:389). STEP-HFpEF enrolled LVEF >=45%; SUMMIT >=50%; the 2023 ACC HFpEF consensus frames obesity-phenotype HFpEF at LVEF >=50. LVEF 41-44 (HFmrEF) has no trial support (STEP-HFpEF had a small 45-49 subgroup). Suggest `lvef >= 45` for initiation (or >=50 with a "limited evidence" tier for 45-49). This affects only add-on offers; the SBP/K/renal gates are unaffected. [memory for enrollment; verified only STEP-HFpEF effect sizes]
- LOW No pancreatitis history, gastroparesis, or diabetic-retinopathy (semaglutide) screen. These are label warnings, not absolute CIs, and the Patient comorbidity list contains none of them (grep: no 'pancreatitis'/'gastroparesis' strings anywhere in components/constants/types/services), so they cannot be gated without adding fields. Add comorbidity options and a caution warning. [memory]
- LOW GI-volume-depletion AKI risk with GLP-1 + SGLT2i + loop not modeled in side_effects. [memory]
- Special feature "Indicated for Obesity Phenotype (BMI > 30)" +50 (line 714): the criterion is `bmi >= 30` (text says > 30, trivial) and is not LVEF-gated. A BMI>=30 HFrEF patient already on a GLP-1 (continuation allowed) gets 50 pts for a phenotype without HFrEF evidence. LOW: gate by `lvef >= 45` (same predicate as initiation) so the label is true. See ordering comment below.

## 4. Tirzepatide (Zepbound) (constants.ts:730)
Ratio = max(0.25, min(1, d/15)).
| dose | target | ratio | LVEF | BNP retention | wt kg | KCCQ | struct | LAVI | LVEDD |
|---|---|---|---|---|---|---|---|---|---|
| 2.5 | no | 0.25 (raw 0.167) | 0.375 | 0.9375 | 3.0 | 4.88 | 4 | 2.0% | 0.5% |
| 5 | no | 0.333 | 0.50 | 0.917 | 4.0 | 6.5 | 5 | 2.7% | 0.67% |
| 10 | no | 0.667 | 1.0 | 0.833 | 8.0 | 13.0 | 10 | 5.3% | 1.3% |
| 15 | yes | 1.0 | 1.5 | 0.75 | 12.0 | 19.5 | 15 | 8% | 2% |
SBP -6, HR +2; SE nausea 30%, diarrhea 20%. (7.5 and 12.5 mg tiers are absent.)

Findings
- HIGH (same defect as semaglutide) kccq 19.5 x ratio (line 748) is the within-arm SUMMIT change, not the treatment effect. Reported placebo-corrected KCCQ-CSS ~ +6.9 (19.5 vs 12.7 arm values not confirmed by search; 6.9 difference was reported by a secondary source). Fix: ~6.9 at 15 mg. Currently tirzepatide gets 19.5 vs semaglutide 16.6 vs dapagliflozin 6, which makes GLP-1/GIP the largest KCCQ lever in the model by ~3x on trial data that show it is similar to or below SGLT2i-PRESERVED-HF. [verified partially: 6.9 via weightlossrankings secondary source; 19.5/12.7 not confirmed]
- MEDIUM Linear dose-scaling (d/15) badly undercredits mid doses: SURMOUNT-1 weight loss 5 mg 15.0%, 10 mg 19.5%, 15 mg 20.9% (i.e. 5 mg ~72%, 10 mg ~93% of 15 mg), versus 33% and 67% modeled. Use a saturating map (2.5 0.25, 5 0.7, 7.5 0.85, 10 0.93, 12.5 0.97, 15 1). [memory]
- MEDIUM Missing 7.5 and 12.5 mg tiers (label steps of 2.5 mg q4wk: 2.5, 5, 7.5, 10, 12.5, 15). Tier sampler gives {2.5, 10, 15}, so titrate_up from 2.5 can go straight to 10 or 15. One-step rule needed. [memory]
- MEDIUM bnp_reduction 0.25 (line 746) justified in the comment by hsCRP ("Reduces hsCRP significantly"); that is a non-sequitur. SUMMIT showed hsCRP -37% but NT-proBNP change was modest and not a headline result; STEP-HFpEF's ~20% sets an upper bound. Suggest <=0.15-0.20 and fix the comment. [memory; low confidence on the SUMMIT NT-proBNP figure]
- LOW weight 12 kg: SUMMIT -13.9% vs -2.2% (placebo-adjusted ~11.7 points ~12.5 kg). Plausible. Comment "15-20% (SUMMIT)" is the SURMOUNT-1 number, SUMMIT was ~14%. [memory]
- LOW sbp_drop 6 flat across tiers (see semaglutide).
- MEDIUM Special feature "Superior Weight Loss & KCCQ Benefit (SUMMIT)" +60 vs semaglutide +50 (line 757). "Superior" is a cross-trial claim (no head-to-head in HF) and it is double-counted: the chf_effects already give tirzepatide larger effects. Equalize both at one value, or move the difference into the effect numbers only. [memory]
- Same LVEF gate and contraindication-set comments as semaglutide (LVEF >40 vs >=45/50 enrollment; no pancreatitis/gastroparesis). Tirzepatide also: thyroid C-cell boxed warning handled by CI_MTC_MEN2; oral-contraceptive reduced efficacy is irrelevant here.

## 5. Vericiguat (constants.ts:1053)
ratio = d/10.
| dose | target | LVEF | BNP retention | KCCQ | struct | LAVI | LVEDD | SBP drop |
|---|---|---|---|---|---|---|---|---|
| 2.5 | no | 0.625 | 0.925 | 2.125 | 3 | 1.25% | 0.25% | 2.125 |
| 5 | no | 0.75 | 0.90 | 2.75 | 4 | 1.5% | 0.5% | 2.75 |
| 10 | yes | 1.0 | 0.85 | 4.0 | 5 | 2.0% | 1.0% | 4.0 |
SE hypotension 10%, anemia 5%. Dose ladder 2.5/5/10 mg qd is correct (start 2.5, double q2 weeks as tolerated) [memory].

Findings
- MEDIUM Initiation NT-proBNP gate is a flat >=1600 (line 1094-1096; candidates.ts:318). VICTORIA required NT-proBNP >=1000 pg/mL in sinus rhythm and >=1600 in AF (BNP 300/500). The code therefore withholds vericiguat from sinus patients with 1000-1599, who were enrolled and benefited; and the FDA label has no NT-proBNP criterion at all (indication: symptomatic chronic HF, EF <45%, after a HF hospitalization or need for outpatient IV diuretics). Suggest `nt_pro_bnp >= (rhythm==='AFib' ? 1600 : 1000)`. [memory]
- MEDIUM No gate for concomitant sGC stimulators (riociguat: label contraindication) or PDE5 inhibitors (label: concomitant use not recommended; excluded in VICTORIA). Code has none; the formulary has pregnancy only, while H/ISDN has a PDE5 gate. `external_medications` already carries Sildenafil/Tadalafil; add a CI for Riociguat/PDE5i (if clinicians treat the PDE5i "not recommended" as a hard stop, as your brief states; label wording is "not recommended", riociguat is the formal CI). [memory]
- MEDIUM NT-proBNP >8000 (VICTORIA subgroup, no apparent benefit; ~6% of cohort... [memory]) not handled: no upper bound or warning. Add a low-confidence note when NT-proBNP >8000 rather than a hard block (label has no upper limit). [memory]
- LOW No eGFR gate: VICTORIA excluded eGFR <15 and label has limited data <15 / dialysis. Add `renal_adjustment` or CI at eGFR <15. [memory]
- LOW No SBP gate for initiation (VICTORIA required SBP >=100; label recommends not initiating when SBP <100). Engine hard-stops only at <90. Add initiation CI `sbp < 100`. [memory]
- LOW kccq 4.0/BNP 0.15 at 10 mg: VICTORIA effect on KCCQ was small/non-significant (~+1-2); NT-proBNP effect was modest. Suggest KCCQ 2, BNP 0.08-0.10. LVEF/structure benefit (+1.0, struct 5) not demonstrated. Magnitudes are small enough to be low-impact. [memory]
- LOW "recent worsening within 6 months" is a coarser proxy: VICTORIA = HF hospitalization within 6 months or outpatient IV diuretic within 3 months. Acceptable approximation, document it. [memory]
- Dose tiers: titration jump 2.5 -> 10 possible via tier sampler (same one-step issue as GLP-1; mild since labeled double-q2wk).
- Pregnancy boxed warning, NYHA II-IV, LVEF <45 and continuation carve-out all modeled appropriately. Cost: cash 650/commercial 10/Medicare 170 plausible (retail ~$600-690, NADAC ~$680/30 tabs) [verified: web search pricing summary].

## 6. Ferric Carboxymaltose (constants.ts:1152)
| dose | target | key effects |
|---|---|---|
| 1000 mg IV once | not flagged | LVEF 0, BNP retention 0.95, KCCQ +8, rest 0; SE hypophosphatemia 15% |

Findings
- MEDIUM Dosing: single 1000 mg tier. The HF label dosing is weight- and Hb-based, two doses (day 1 and week 6, 500-1000 mg each; lower dose for Hb >=14-15 or weight <70 kg) plus 500 mg maintenance q12 weeks if still deficient; AFFIRM-AHF/CONFIRM-HF/HEART-FID used the same Hb/weight tables. Add a 500 mg tier and mark the regimen as "1000 mg day 1 + week-6 dose per Hb/weight". Also no `is_target_dose`, which matters little for a single-dose drug but makes target-dose completeness treat it as sub-target (60% credit, scoring.ts completeness description) -> mark target. [memory; FDA label PDF fetch failed]
- MEDIUM Price (pricingService.ts:154): cash 315, commercial 50, Medicare 60 per "month". Injectafer is ~$1,000-1,400 per 1000 mg (ASP/WAC; first-year course ~2 infusions) and is billed under the medical benefit (Part B 20% coinsurance ~$200-300/dose), so 315 understates cost ~3-4x and the 60 Medicare copay is implausible. Cost domain makes IV iron artificially cheap. [memory; not confirmed online]
- MEDIUM Special feature +40 and rescue auto-append apply to ALL phenotypes. ESC/ACC evidence for IV iron is in LVEF <45-50 (CONFIRM-HF <=45, AFFIRM-AHF <50, HEART-FID/IRONMAN <=45/<=45); HFpEF evidence is minimal (FAIR-HFpEF, small). FDA label is NYHA II/III HF regardless of EF. Suggest restricting the +40 and the HFpEF rescue to LVEF <50, or noting "limited evidence in HFpEF". [memory]
- LOW chf_effects: KCCQ +8 is too large; AFFIRM-AHF KCCQ-OS difference at 24 weeks was small (a few points), IRONMAN not significant, HEART-FID missed its hierarchical primary (marginal p=0.019 vs 0.01 threshold) with a modest 6MWD benefit; CONFIRM-HF/FAIR-HF PGA improvement is the main symptom evidence. Suggest KCCQ ~3-5. BNP -5% unsupported (AFFIRM-AHF showed no clear NT-proBNP difference); use 0. [memory]
- LOW Iron-deficiency predicate (clinicalPredicates.ts:51-56): ferritin <100, or <=300 with TSAT <20, matches the FDA/AFFIRM-AHF definition; ESC text is 100-299 (300 edge is immaterial). Requires ferritin (cannot classify on TSAT alone): acceptable and conservative. Credit only when deficient is correct (rescue gated on isIronDeficient; special feature gated). [memory; code read verified]
- LOW Hemoglobin upper limit (~15 g/dL) and NYHA IV cannot be gated: `Patient` has no hemoglobin field (types.ts:37-98) and the engine ignores NYHA I/IV for iron. Not wrong per se; add a missing-data notice for Hb. [code verified; clinical limits memory]
- LOW Hypophosphatemia 15%: in the range of the trials (HEART-FID and others show a substantial rate of low phosphate; lower than FCM in IDA trials ~ up to 50% at 2 wks). No monitoring/CI hook for baseline hypophosphatemia/osteomalacia. [memory]
- Modeled appropriately: pre-condition iron deficiency, rescue counted against max_new_classes.

## 7. Hydralazine / Isosorbide Dinitrate (constants.ts:972)
level = 2 at '75/40' else 1.
| dose | target | LVEF | BNP retention | KCCQ | struct | LAVI | LVEDD | SBP |
|---|---|---|---|---|---|---|---|---|
| 37.5/20 mg tid (1 tab) | no | 3 | 0.85 | 4 | 15 | 5% | 3% | -10 |
| 75/40 mg tid (2 tabs) | yes | 4 | 0.80 | 5 | 15 | 5% | 3% | -10 |
A-HeFT target 2 tabs TID (225/120 mg/day) = 75/40 per dose, correctly flagged. Unit label "mg" with a string strength is fine; frequency tid correct. No intermediate (1.5 tab) step, acceptable since BiDil is a fixed tablet.

Findings
- MEDIUM Indications are modeled correctly in the candidate gate (candidates.ts:285-291): Black + NYHA III-IV (Class 1) AND the RAAS-unavailable alternative (Class 2b), HFpEF excluded. But Class-1 gate does not require the patient to be on RAAS/BB (A-HeFT: optimal background therapy), so for a Black NYHA III-IV treatment-naive patient H/ISDN is offered alongside the missing pillars; engine crowd-out is limited by max_new_classes. Consider requiring RAAS+BB present or already attempted. [memory]
- MEDIUM Relative weight: A-HeFT bonus 30 (Class 1, 43% mortality reduction, only Black patients) is below iron 40 (Class 2a, symptoms/HF-hosp only, weaker trials) and below obesity 50-60 (symptom/weight, no guideline class). The ordering mis-ranks outcome-level versus symptom-level evidence. Suggest A-HeFT ~50-60, iron ~25-30, obesity ~30-40 (keep FINEARTS 45). Not an error of fact, but ranks at the margin. [memory]
- LOW lvef_improvement 3-4 points (line 981): A-HeFT's echo substudy showed favorable remodeling, but absolute LVEF gains of 3-4 points exceed SGLT2i (2) and are not trial-derived; BNP 15-20% reduction has no A-HeFT basis (NT-proBNP not a reported outcome). Suggest LVEF 1.5-2.5, BNP 0.05-0.08, struct 8. [memory]
- LOW SBP -10 not dose-scaled (low tier likely -5 to -6; also x0.35 starting attenuation does not apply). HR 0: hydralazine produces reflex tachycardia (+3 to +5 bpm). [memory]
- LOW SE headache 30%/dizziness 15% low vs A-HeFT (headache 47% vs 19%, dizziness 29% vs 12%). No lupus-like syndrome (dose-/acetylator-dependent) listed. [memory]
- LOW PDE5 gate (line 995-1001) correct; riociguat + nitrate absolute CI not modeled (rare). [memory]
- LOW Price: cash 20 / copay 15 is for separate generic hydralazine + ISDN components; fixed-dose generic BiDil is more like $100-200 (notes acknowledge brand ~$500). 6 pills/day tid also raises complexity. Plausible if the "generic components" path is intended; flag the fixed-dose assumption. [memory]
- Pregnancy: not contraindicated (correct, alternative to RAAS); modeled appropriately.

## 8. Cross-drug and pricing
- MEDIUM Wegovy/Zepbound Medicare copay modeled at $350/$450 (pricingService.ts:144-152), described as "anti-obesity exclusion". As of today (2026-11-10) the Medicare GLP-1 "bridge" pays obesity coverage at $50/month copay (reported start April-July 2026; Medicare price ~ $245) and Wegovy already carries a CV-risk-reduction indication that Part D covers. Medicare cost for these two drugs is overstated ~7x, depressing their ranking for Medicare patients (the core HFpEF-obesity audience). Suggest medicare_copay ~50. [verified: web search (Becker's/CoveredUSA-class sources; start date varies by source)]
- LOW Wegovy cash 349 and Zepbound cash 449: consistent with 2026 self-pay prices ($349 Wegovy standard, intro $199; Zepbound vials $299-449, pen higher); acceptable. [verified: web search, sources disagree]
- LOW Dapagliflozin cash 290 / Empagliflozin cash 310: Farxiga list ~$556-600; Medicare negotiated price $179 from 1/1/2026 [verified: web CMS table]; Jardiance ~$197 [memory]. Medicare copay 45/50 is plausible post-IRA; cash 290/310 is low relative to brand retail (~$550-650) unless a generic dapagliflozin is on the market; `generic_available:false` conflicts with a $290 cash price. Confirm whether authorized-generic dapagliflozin is available and set generic_available accordingly. [memory; generic launch not confirmed]
- LOW Vericiguat price plausible [verified: web pricing summaries]; H/ISDN and FCM covered above.
- Special-feature scale summary (relative ordering): A-HeFT 30 | iron 40 | FINEARTS 45 | obesity 50 / 60 | DIAMOND binders 50 | diabetics 10. See H/ISDN and tirzepatide findings.

## Counts
HIGH: 2 (semaglutide KCCQ placebo-unadjusted; tirzepatide KCCQ placebo-unadjusted)
MEDIUM: 18 (SGLT2i KCCQ 6; empagliflozin eGFR floor; sema linear dose-response; sema missing tiers/titration jump; GLP-1 LVEF >40 gate; tirz dose-response; tirz missing tiers; tirz BNP 0.25; tirz "superior" +60; vericiguat NT-proBNP rhythm threshold; vericiguat riociguat/PDE5i gate; vericiguat NT-proBNP >8000; FCM dosing; FCM price; FCM all-phenotype; H/ISDN offered without background therapy; H/ISDN point ordering; Wegovy/Zepbound Medicare copay)
LOW: ~22
