# RAAS pillar review (ARNI / ACEi / ARB) - HeartFailurePath constants.ts

Method: static read of constants.ts:78-330, pricingService.ts, engine effects/candidates/regimenUtils/contraindications. Nothing was executed.
Verification status: NO web lookups were made this session. Every clinical/label/price claim below is "from memory" unless stated as a code fact. Confidence is lowered accordingly.

How numbers are consumed (code facts): effects.ts:135 starting-dose (available_doses[0]) hemodynamic attenuation x0.35 for ARNI/ACEi/ARB/BB, ADD path only; BNP retention factor (1-min(0.8,pct)); K+ change x renalRiskFactor (1.2/1.5/2.0 by 0.85*eGFR); DBP = SBP drop x0.5 for all RAAS; side_effects() is display-only (MedicationLibrary.tsx:17), never scored. None of the 8 drugs has special_features. Only numeric strengths are capped by renal max_dose (regimenUtils.ts:22).

Formula arithmetic: ACEi lvef = 2+0.5*log2(d/dmin) ; bnp = .15+.02*log2(...). ARB lvef = 2+2.5r ; bnp = .10+.12r.

## Sacubitril/Valsartan
| dose | target | lvef | NT-proBNP red | KCCQ | LVEDD | SBP drop (add at 1st tier x0.35) | dK |
|---|---|---|---|---|---|---|---|
| 24/26 bid | no | +5 | 30% | 7 | 6% | 8 (2.8 on add) | .15 |
| 49/51 bid | no | +7 | 40% | 9 | 8% | 10 | .15 |
| 97/103 bid | yes | +9 | 50% | 11 | 10% | 12 | .15 |
(lavi 12%, structure 30 pts, weight -0.5 kg at every tier.)
Tiers/target/units correct (24/26, 49/51, 97/103 bid are the marketed strengths; target 97/103 per PARADIGM-HF). Starting dose 24/26 sensible. Missing the 12/13? Not marketed for adults; fine.

Findings
1. HIGH - candidates.ts:263-267 + regimenUtils.ts:38-48, constants.ts:86. Add-candidates for a missing RAAS pillar are built from ALL dose tiers (low, high, mid, target; safeSlice(4)), so "Add Sacubitril/Valsartan 97/103 bid" to a RAAS-naive patient is a generated candidate. At non-lowest tiers hemoFactor=1.0 (effects.ts:135), so the engine credits full target-dose benefit immediately with an un-attenuated SBP drop, and no eGFR/SBP guard stops it. Label: start 24/26 bid in ACEi/ARB-naive or low-dose patients, and 24/26 for eGFR <30 and moderate hepatic impairment; PARADIGM/PIONEER-HF titrate every 2-4 wk. Generic ACEi/ARB tiers have the same issue (e.g. lisinopril 40 mg de novo). Same pattern applies to every drug in this review. Fix: for action 'add' of any titratable RAAS agent (and BB), restrict target to available_doses[0] (or tier index <= first), leaving up-titration to titrate_up candidates. Confidence: high on the code path; I did not run the engine to see whether a downstream filter drops these (from memory of label, code read only). Verify by running a RAAS-naive HFrEF scenario.
2. MEDIUM - constants.ts:113. renal_adjustment returns start_dose_modifier 0.5 at eGFR <30 but ARNI strengths are strings so no max_dose can apply; the only effect is a monitoring text (explain.ts:81). Combined with #1, an eGFR 20 patient can be offered 97/103. Label (from memory): eGFR <30 start 24/26 bid; no contraindication. Fix: either enforce start tier = 24/26 when egfr<30 on add (via #1) or encode a string-aware max tier.
3. MEDIUM - constants.ts:111. Child-Pugh B and C both contraindicate. Label (from memory): Child-Pugh B start 24/26 bid (not contraindicated); C "not recommended/not studied". Stricter than label for B; defensible but removes ARNI from patients who can take it. Suggest B -> reduced-start caution (modifier 0.5), C -> contraindicated.
4. MEDIUM - pricingService.ts:109-113. Entresto marked generic_available:false, cash $600, tier preferred_brand. From memory (medium-low confidence): FDA-approved generic sacubitril/valsartan launched in the US in mid-2025 and was widely available by late 2025; Medicare negotiated price (~$295/30 d) took effect 1 Jan 2026 (the note is right about that). With cost weight 12% and a budget filter, an out-of-date $600 cash price can drop ARNI for self-pay/cost_first patients. Fix: set generic_available true, cash roughly $150-300 (falling), keep brand $600+ in notes; Medicare ~$40-75 plausible; commercial copay ~$10-35. Needs a GoodRx check.
5. LOW - constants.ts:92. LVEF credit +9 at target anchored to PROVE-HF (single-arm, +9.4 points at 12 mo in patients mostly pre-treated with ACEi/ARB). For swaps (delta vs the old ACEi's ~3.5) this is coherent; for de novo adds vs ACEi/ARB the 5.5-point advantage is larger than randomized head-to-head LVEF data suggest (EVALUATE-HF showed little LVEF difference; from memory, low confidence). Starting-dose ARNI (+5) exceeds ACEi at target (+3.5-4): mild over-credit. Suggest 24/26 -> +3.5-4, 49/51 -> +6, 97/103 -> +8. Low priority because structure weight is 8%.
6. LOW - constants.ts:111. NT-proBNP reduction 30-50% is consistent with PROVE-HF/PARADIGM (about -30% to -45%); modeled field is NT-proBNP (types.ts:53) which is the correct marker for sacubitril users (BNP rises). Modeled appropriately. Consider a UI note that BNP (not NT-proBNP) is unreliable on ARNI.
7. LOW - constants.ts:109. Comment 'Category X' is obsolete; label carries a boxed fetal-toxicity warning. Cosmetic.
8. LOW - missing label contraindication: aliskiren co-use in diabetes (ARNI/ACEi/ARB). RELEVANT_EXTERNAL_MEDICATIONS (constants.ts:63) lacks Aliskiren; K-sparing/NSAID interactions also not modeled here. From memory.
9. LOW - SBP 90-100 initiation: no extra caution for ARNI (PARADIGM excluded SBP <100; PIONEER-HF required >=100). Engine penalizes only projected SBP <95. Suggest a caution at baseline SBP <100.
Side effects (display only): hypotension 15% (PARADIGM ~14% vs 9%), angioedema 0.5% (0.45%), hyperK 5% - plausible. K +0.15 vs ACEi +0.20 consistent with PARADIGM (less severe hyperK than enalapril).

## Lisinopril
| dose | target | lvef | bnp red | KCCQ | LVEDD | SBP drop | dK |
|---|---|---|---|---|---|---|---|
| 2.5 qd | no | 2.0 | 15% | 3.1 | 3.1% | 5.5 | .20 |
| 5 | no | 2.5 | 17% | 3.25 | 3.25% | 6 | .20 |
| 10 | no | 3.0 | 19% | 3.5 | 3.5% | 7 | .20 |
| 20 | yes | 3.5 | 21% | 4 | 4% | 9 | .20 |
| 40 | yes | 4.0 | 23% | 5 | 5% | 13 | .20 |
Tiers real; 30 mg tablet also marketed (missing, LOW). ATLAS high dose 32.5-35, low 2.5-5; 2022 guideline target 20-40 mg qd. Both 20 and 40 flagged target = acceptable.
Findings
- LOW constants.ts:122-123: flagging 20 mg as target gives full "at target" credit at the guideline's lower bound (ATLAS suggests higher dose = fewer hospitalizations), acceptable; consider 30 mg tier. From memory.
- LOW constants.ts:141-145: renal caps (10 mg <30; 20 mg 30-45) are stricter than label (label: no adjustment CrCl >30; <30 start 2.5-5 and titrate). At eGFR<30 the target tier is unreachable, so completeness gives 60% credit (and "below target" nudge). Defensible conservatism; inconsistent with enalapril's rule below. Suggest cap 20-40 at eGFR 10-30 with start 2.5.
- Efficacy/hemodynamics: dose-response shape plausible; starting dose gets 70% of target BNP effect (15 vs 21%), a bit generous but softened by x0.35 SBP attenuation. Modeled appropriately.
- Side effects: cough 10%, angioedema 1% (label 0.1-0.7%; high but conservative). Contraindications (angioedema, K>5.4, pregnancy, bilateral RAS) acceptable; bilateral RAS is a label warning, not CI - stricter. Price $4 / $3 plausible. All from memory.

## Enalapril
| dose | target | lvef | bnp red | KCCQ | LVEDD | SBP drop | dK |
|---|---|---|---|---|---|---|---|
| 2.5 bid | no | 2.0 | 15% | 3.25 | 3.25% | 5.5 | .20 |
| 5 bid | no | 2.5 | 17% | 3.5 | 3.5% | 6 | .20 |
| 10 bid | yes | 3.0 | 19% | 4 | 4% | 7 | .20 |
| 20 bid | yes | 3.5 | 21% | 5 | 5% | 9 | .20 |
Tiers/frequency/targets match SOLVD (10 bid)/CONSENSUS and guideline (10-20 mg bid). Starting 2.5 bid correct.
Findings
- LOW constants.ts:172-176: renal max_dose 10 at eGFR 30-45 and 5 at <30 is stricter than label (label HF: no adjustment above CrCl 30; Cr >3 start 2.5 and titrate to 40 mg/day) and stricter than lisinopril's 20 at 30-45; the comment "more conservative than lisinopril (BID dosing)" is not pharmacologic (10 mg bid is 20 mg/day, the same total as lisinopril 20). At eGFR 30-45 enalapril 20 bid (a flagged target) is unreachable while lisinopril 20 is - slight cross-ACEi mis-ranking. Suggest 30-45: no cap, <30: 10 bid.
- Equipotent doses: lisinopril 20 and enalapril 20 both +3.5 / 21%; coherent.
- Price $4 plausible (could be $5-10). All from memory.

## Ramipril
| dose | target | lvef | bnp red | KCCQ | LVEDD | SBP drop | dK |
|---|---|---|---|---|---|---|---|
| 1.25 qd | no | 2.0 | 15% | 3.25 | 3.2% | 5.6 | .20 |
| 2.5 | no | 2.5 | 17% | 3.5 | 3.5% | 6.25 | .20 |
| 5 | no | 3.0 | 19% | 4 | 4% | 7.5 | .20 |
| 10 | yes | 3.5 | 21% | 5 | 5% | 10 | .20 |
Tiers real (1.25/2.5/5/10 mg capsules). Guideline target 10 mg daily (AIRE used 5 mg bid; HOPE 10 qd). Frequency 'qd' only; label HF-post-MI regimen is bid (2.5 -> 5 mg bid), so a bid option is missing (LOW).
Findings
- LOW constants.ts:200: sbp_drop = 5 + d/2 vs /5 for lisinopril/enalapril; ramipril 10 mg gives 10 mmHg vs lisinopril 20 9, enalapril 20 9. Slight outlier (not harmful). Suggest 5 + d/2.5.
- LOW constants.ts:204-206: renal caps (2.5 <30; 5 at 30-45) are consistent with label (CrCl <40: start 1.25, max 5 mg/day). OK; 30-45 cap 5 conservative-correct.
- Price $5 plausible (maybe $8-15). From memory.

## Captopril
| dose | target | lvef | bnp red | KCCQ | LVEDD | SBP drop | dK |
|---|---|---|---|---|---|---|---|
| 6.25 tid | no | 2.25 | 15.6% | 3.25 | 3.25% | 5.6 | .20 |
| 25 tid | no | 3.0 | 17.5% | 4 | 4% | 7.5 | .20 |
| 50 tid | yes | 4.0 | 20% | 5 | 5% | 10 | .20 |
Target 50 mg tid correct (SAVE, 2022 table); 6.25 start correct. 
Findings
- LOW constants.ts:213-215: missing 12.5 mg (marketed; HF standard step) - ladder jumps 6.25 -> 25. Also 100 mg tablet marketed (not used in HF). Suggest add 12.5.
- LOW constants.ts:221: lvef at 50 mg (+4.0) is highest of all ACEi at "target" (lisinopril 20 +3.5, enalapril 10 +3.0) with TID burden; adherence domain covers tid (complexity 4). Slight over-credit relative to ACEi class; suggest cap +3.5.
- LOW constants.ts:233-237: caps fine/conservative. Price $8 low-ish for TID 90 tablets (GoodRx often $10-25). Low.

## Valsartan
| dose | target | lvef | bnp red | KCCQ | LVEDD | SBP drop | dK |
|---|---|---|---|---|---|---|---|
| 40 bid | no | 2.6 | 13% | 3.75 | 3.75% | 5.3 | .15 |
| 80 bid | no | 3.25 | 16% | 4.5 | 4.5% | 6.7 | .15 |
| 160 bid | yes | 4.5 | 22% | 6 | 6% | 9.3 | .15 |
Tiers/frequency/target correct (Val-HeFT 40 -> 160 bid; guideline target 160 bid). Valsartan capsules/tablets 40/80/160 exist.
Findings
- LOW constants.ts:261: dose-response ok. Note valsartan 160 bid credits +4.5 vs lisinopril 20 +3.5 (the ARB at target slightly above ACEi at target; trial data (HEAAL, ELITE II, CHARM-Alternative) show ARB ~ACEi non-inferior, not superior). Suggest ARB target lvef +3.5-4 to avoid favoring ARB over ACEi on efficacy alone. Low-medium. From memory.
- Renal cap 80 at eGFR <30 (constants.ts:265): label has no adjustment for CrCl >30 and no data <30; conservative. Fine.
- Missing angioedema CI is intentional (policy: ARB allowed with caution) - acceptable. Price $8 plausible.

## Candesartan
| dose | target | lvef | bnp red | KCCQ | LVEDD | SBP drop | dK |
|---|---|---|---|---|---|---|---|
| 4 qd | no | 2.3 | 11.5% | 3.4 | 3.4% | 4.7 | .15 |
| 8 | no | 2.6 | 13% | 3.75 | 3.75% | 5.3 | .15 |
| 16 | no | 3.25 | 16% | 4.5 | 4.5% | 6.7 | .15 |
| 32 | yes | 4.5 | 22% | 6 | 6% | 9.3 | .15 |
Tiers/target correct (CHARM: 4-8 start, 32 qd target; tablets 4/8/16/32).
Findings
- LOW constants.ts:296: renal cap 8 mg at eGFR <30 stricter than label (HF: no initial adjustment; severe renal impairment start low). Slight; suggest cap 16 or none with monitoring.
- LOW pricingService.ts:41: cash $10 low-ish (generic candesartan often $15-40). Same ARB over-credit note as valsartan.
- Hyperkalemia gate, pregnancy fine.

## Losartan
| dose | target | lvef | bnp red | KCCQ | LVEDD | SBP drop | dK |
|---|---|---|---|---|---|---|---|
| 25 | no | 2 | 10% | 3.33 | 3% | 5 | .15 |
| 50 | no | 2 | 10% | 3.67 | 3% | 6 | .15 |
| 100 | yes | 4 | 20% | 4.67 | 5% | 8 | .15 |
| 150 | no | 4 | 20% | 5 | 5% | 10 | .15 |
Findings
- MEDIUM constants.ts:306-307: target flag on 100 mg with comment "ACC/AHA 2022 target". 2022 guideline table (from memory) lists losartan target 50-150 mg daily; HEAAL (150 vs 50) is the outcome evidence for the high dose, ELITE II used 50. 100 mg is a non-trial dose; 150 is the evidence-supported max but not flagged target, so a patient at 150 gets "below target" (60% completeness credit) while 100 does not. Fix: flag 150 as is_target_dose too (keep 100 allowed); 50 mg = ELITE II/low-dose arm.
- LOW constants.ts:307: losartan has no 150 mg tablet (marketed 25/50/100); 150 = 100+50. Comment says "off-label", but HF is off-label for losartan entirely (no FDA HF indication). Relabel formulation or note two tablets.
- LOW constants.ts:309-321: step function: 25 and 50 mg give identical lvef/bnp/LVEDD (only KCCQ differs), and 100 = 150. Dose-response between 25 and 50, and credit for HEAAL's 150 vs 100, are absent. Suggest ratio-based like valsartan: lvef 2+2.5*(d/150) etc.
- LOW constants.ts:326-329: cap 50 at eGFR <30 stricter than label (no renal adjustment) - conservative.
- Price $5 plausible.

## Cross-class
- Appropriately modeled: Lisinopril (shape, tiers, target, price); Enalapril (tiers/target); Ramipril; Candesartan tiers/target; Valsartan tiers/target. Captopril and Losartan have the minor LOW items above.
- Class coherence: ARNI > ARB ~ ACEi is encoded as ARNI +9 LVEF/50% NT-proBNP vs +3.5-4.5/21-22%; SBP 12 vs 9-10 matches PARADIGM's ~3 mmHg extra SBP lowering. K shift ARNI .15 vs ACEi .20 matches PARADIGM.
- Single most important item: #1 de novo add at non-starting tier (all drugs, ARNI worst case). Recommend running a RAAS-naive scenario to confirm whether the displayed regimen can be "Add X at target dose".
