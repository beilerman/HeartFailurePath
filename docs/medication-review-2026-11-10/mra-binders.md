# MRA + K+ binder review (HeartFailurePath) — read-only

Verification key: "verified" = confirmed by web search this session (Kerendia US/UK label snippets; Lokelma label snippets). Everything else "from memory" (lower confidence). Web search returned only fragments; full labels were not fetched. Trial/guideline items were not re-verified online.

Code refs: constants.ts (Spiro 461-502, Epl 503-541, Fin 548-612, Patiromer 1105-1126, Lokelma 1127-1150); pricingService.ts 60-72, 134-143; scoring.ts 135-175; effects.ts 70-79, 150-155, 320-330, 527-545; regimenUtils.ts getDoseTiers (lowest, highest, middle tier only; max_dose drops tiers).

## Spironolactone
| dose | target | LVEF abs | BNP red | wt kg | KCCQ | structure | LVEDD | SBP drop | K+ rise (before renal factor 1.2-2.0x) |
|---|---|---|---|---|---|---|---|---|---|
| 12.5 | no | 2.5 | 10% | 0.15 | 2 | 30 | 4.5% | 4.25 | +0.50 |
| 25 | yes | 3.0 | 10% | 0.30 | 2 | 30 | 5.0% | 5.5 | +0.60 |
| 50 | yes | 4.0 | 10% | 0.60 | 2 | 30 | 6.0% | 8.0 | +0.80 |
Appropriately modeled: tiers/targets (RALES 25-50 mg), eGFR<30 exclusion, eGFR<=45 cap at 25 mg, TOPCAT feature (LVEF>=45, 18 pts, correct population, proportionate), gynecomastia 10% (RALES ~10%).
Findings:
- MEDIUM — K+ projection overstated -> unneeded binder rescue / false hyperK penalty (constants.ts:483, effects.ts:70-79,150). Code: 0.4-0.8 mEq/L x renalRiskFactor (1.2 if eGFR*0.85<60, 1.5 if <45). Example: K 4.8, eGFR 55, spiro 25 -> +0.72 -> 5.52 >5.5 (-40 penalty) and >5.3 (binder rescue appended, +residual-risk penalty). Trials: mean K rise on MRA ~0.2-0.4 (RALES/EMPHASIS); hyperK>5.5 in ~5-12%. Suggest K rise ~0.25 (12.5)/0.3 (25)/0.4 (50), keep renal multiplier. From memory.
- MEDIUM — Initiation K+ ceiling 5.5 (constants.ts:486) vs guideline/label K<=5.0 (2022 AHA/ACC/HFSA; Aldactone HF label: start only if K<=5.0 and eGFR>50 for 25 mg daily, 30-50 -> 25 mg qod). Looser. Mitigated by warning + DIAMOND binder in 5.0-5.5 band (effects.ts:527). Suggest gate NEW starts at >5.0 (continuation may stay 5.5, see M-cont). From memory.
- MEDIUM — SBP drop 3+d/10 (8 mmHg at 50 mg) vs eplerenone 3.0 at equipotent dose (constants.ts:483 vs 523). HF trials show small SBP effect; incoherent pair can steer MRA choice / trip projected-SBP penalties in low-BP patients. Suggest ~2-3 mmHg flat-ish (e.g. 2+d/25). From memory.
- LOW — 12.5 mg tier: no marketed 12.5 mg tablet (25 mg split; Carospir suspension). Fine clinically as a half-tablet; label note only. From memory.
- LOW — side_effects() ignores dose (gynecomastia 10% at 12.5 mg). Dose-scale (RALES dose-dependent). From memory.
- LOW — eGFR 30 exactly is allowed (code <30) vs guideline ">30"; comment "pregnancy Category X" (line 488) is wrong (spironolactone was Cat C, FDA letter categories retired); exclusion is still reasonable. From memory.
- LOW — structure_benefit_points 30 and BNP 10% credited at 12.5 mg identically to 50 mg (dose-independent). Scale structure with dose ratio (floor ~0.5).

## Eplerenone
| dose | target | LVEF abs | BNP | wt | KCCQ | structure | LVEDD | SBP | K+ rise |
|---|---|---|---|---|---|---|---|---|---|
| 25 | no | 2.0 | 10% | 0.10 | 2 | 30 | 3% | 2.5 | +0.325 |
| 50 | yes | 2.5 | 10% | 0.20 | 2 | 30 | 4% | 3.0 | +0.40 |
Appropriately modeled: 25->50 titration, 50 mg target (EMPHASIS-HF/EPHESUS), K>5.5 initiation exclusion matches label, eGFR cap 25 mg, gynecomastia-avoidance tiebreaker 3 pts (small, proportionate). Equipotency coherent: spiro 25 (3.0) ~ epl 50 (2.5); spiro 12.5 (2.5) > epl 25 (2.0) acceptable.
Findings:
- HIGH — strong CYP3A4 inhibitor contraindication (clarithromycin, itraconazole, ketoconazole, ritonavir/cobicistat, nefazodone) absent; RELEVANT_EXTERNAL_MEDICATIONS (constants.ts:63-70) has no such drugs and ci list (531-535) has no check. Eplerenone label: contraindicated; moderate inhibitors (diltiazem/verapamil — which ARE in the list) cap at 25 mg daily. Suggest add inhibitors to external-med list, CI for strong, max 25 mg/warning for diltiazem/verapamil. From memory (label known well; not re-fetched).
- LOW — EMPHASIS-HF eGFR 30-49: start 25 mg qod, max 25 daily; code cap at eGFR<=45 (should be <50). Label: CrCl<=30 contraindicated (code <30). From memory.
- LOW — hyperkalemia 0.15 and K+ 0.325-0.4 are similar to spiro despite smaller K slope; fine, but see spiro K-overstatement finding (same multiplier issue).

## Finerenone (Kerendia)
| dose | target | LVEF abs | BNP | wt | KCCQ | structure | LVEDD | SBP | K+ rise |
|---|---|---|---|---|---|---|---|---|---|
| 10 | no | 1.75 | 12% | 0.05 | 3.75 | 25 | 3.5% | 2.5 | +0.2875 |
| 20 | no (!) | 2.0 | 14% | 0.10 | 4.5 | 25 | 4.0% | 3.0 | +0.325 |
| 40 | yes | 2.5 | 18% | 0.20 | 6.0 | 25 | 5.0% | 4.0 | +0.40 |
(eGFR 25-59: 40 mg tier removed by max_dose 20; eGFR>=60: all three.)
Findings:
- MEDIUM — eGFR-dependent target not modeled (constants.ts:555, 604-610). US label: start 10 mg if eGFR 25-<60, 20 mg if >=60; titrate after 4 wk to target 20 mg or 40 mg by eGFR (verified: US label snippet via search; the 20-vs-40 eGFR split itself from memory/FINEARTS-HF). Code flags only 40 mg as target, so an eGFR 25-59 patient at the correct maximal 20 mg is "sub-target forever": loses target bonus, gets 60% completeness credit, may be nudged to a titration that doesn't exist. Fix: use `is_target_dose_for` (type exists, types.ts:147): target = strength===20 && egfr<60, or 40 && egfr>=60. Also new starts for eGFR>=60 begin at 10 mg (label 20 mg) — conservative, acceptable.
- MEDIUM — Initiation K+ ceiling 5.5 (constants.ts:599) vs label "do not initiate if K+ >5.0" (verified: Kerendia label via search; label also says withhold at K>=6.0 and restart 10 mg when <5.5). Looser for new starts; code actively co-prescribes binder at 5.0-5.5 (effects.ts:527). Fix: new-start gate >5.0.
- HIGH (grouped with eplerenone item) — no strong CYP3A4 inhibitor contraindication (itraconazole, clarithromycin, ketoconazole, ritonavir etc.; label contraindicated) and no adrenal-insufficiency (Addison) contraindication; moderate inhibitors (verapamil, diltiazem) need monitoring. Only a hepatic warning exists (effects.ts:606). From memory (known Kerendia label; not fetched in full). Fix: external-med entries + CI + warning; add 'Adrenal insufficiency' comorbidity CI.
- MEDIUM — BNP 10-18%, KCCQ +3.75 to +6, structure 25 vs steroidal MRAs BNP 10%, KCCQ 2: finerenone credited more symptom/biomarker benefit than spironolactone. FINEARTS-HF: KCCQ-TSS ~+1.6 vs placebo, benefit driven by HF events (total worsening HF events + CV death RR 0.84), NT-proBNP not a headline effect. Fix: KCCQ ~1.5-2, BNP ~0.05-0.10; keep hospitalization benefit in the special feature. From memory.
- LOW — special feature 45 pts (LVEF>=40) vs spironolactone TOPCAT 18: defensible (finerenone has a positive RCT, spiro a post-hoc subgroup), but gap is large; note FINEARTS composite is HF-event driven, CV death alone not significantly reduced — text "16% RRR CV death/HF events" is accurate. Consider ~30. From memory.
- LOW — boundary: finerenone allowed at LVEF exactly 40 (CI is <40) but phenotype HFrEF (<=40) only credits class 'MRA' in completeness slot (scoring.ts:76), so LVEF 40 gets no pillar credit for it. Align phenotype cut or allow nsMRA at 40.
- LOW — comment "new 40mg tablet" (constants.ts:555): UK label snippet says 40 mg is licensed for HF only; whether it is a distinct tablet vs 2x20 mg not confirmed — cosmetic. Unverified.
- Appropriately modeled: eGFR>=25 floor (verified label), LVEF>=40 gating, HFimpEF handling, cirrhosis caution, lower hyperK (8%), K rise smaller than spiro at target.

## Patiromer
| dose | target | HF effects | K+ change |
|---|---|---|---|
| 8.4 g qd | n/a | all 0 | -0.8 |
Findings:
- LOW — only 8.4 g tier; label titrates by 8.4 g weekly to 25.2 g (16.8/25.2 g missing); single tier cannot rescue larger projected K rises. From memory.
- LOW — -0.8 flat, not baseline-dependent. OPAL-HK ~-1.0 at K 5.1-5.5 baseline, DIAMOND vs placebo difference ~-0.2-0.3 (prevention setting). Applied at any baseline it can imply hypokalemia only via later checks; scale with baseline K (e.g. -0.4 at K<5.0, -0.8 at 5.1-5.5, -1.1 at >5.5). From memory.
- LOW — no 3-hour drug-separation warning (grep: none) and no Mg monitoring prompt (hypoMg ~5-9% in label; code 0.05 ok); no severe constipation/obstruction caution. From memory.
- MEDIUM — special feature "+50, K>5.0" (constants.ts:1124): criterion not tied to a RAAS/MRA being in the regimen; DIAMOND showed K/enabling of RAASi, NOT hard outcomes (text says "enables", OK) but 50 pts exceeds finerenone's RCT-outcome 45. The reactive rescue (projected>5.3, baseline possibly 4.6) gets 0 points while proactive gets 50 — inconsistent. Fix: require MRA/RAAS in regimen; reduce to ~20-25; same for Lokelma. From memory.
- Price: cash $985, Medicare $175, commercial $0 (free-drug/copay program) plausible for Veltassa 2025-26 (from memory; commercial copay program does not apply to Medicare — correctly not applied).

## Sodium Zirconium Cyclosilicate (Lokelma)
| dose | HF effects | K+ change |
|---|---|---|
| 5 g qd | 0 | -0.7 |
| 10 g qd | 0 | -1.1 |
Findings:
- MEDIUM — K lowering mis-assigned: -1.1 is the HARMONIZE ~48 h 10 g TID correction effect, applied to a once-daily maintenance tier; -0.7 for 5 g daily overstates maintenance (maintenance ~-0.3 to -0.6 vs baseline; HARMONIZE 5 g arm held ~4.8). Overstating makes binder "rescue" pass the rescued<5.3 test too easily. Fix: 5 g -0.4, 10 g -0.6; (correction phase not modeled). The 10 g TID x48h regimen itself NOT confirmed online (search did not return it); from memory.
- MEDIUM — sodium/edema under-modeled and comment wrong (constants.ts:1145,1148): label says ~400 mg sodium per 5 g (verified), i.e. ~800 mg per 10 g, not "400 mg per 10 g". Label edema 4.4/5.9/16.1% at 5/10/15 g (verified) — code flat 6%, and HF patients flagged "monitor edema; may need diuretic increase" (verified). The -10 penalty fires only if weight is >2 kg above dry, against +50 feature. Fix: dose-scale edema, add a warning for any HF patient on Lokelma (esp. HFpEF/low-EF with diuretic), scale penalty with dose, fix comment.
- LOW — no CI/caution for severe constipation/bowel obstruction/ileus (label warning); no 2.5 g or 15 g tiers (5 g qod-15 g qd range; from memory); maintenance "10 g qd" is what label emphasizes (verified in snippet).
- LOW — spacing: oral meds with pH-dependent solubility (azole antifungals, TKIs) 2 h separation not warned. From memory.
- Same +50 feature issue as patiromer.
- Price: cash $750, Medicare $150, commercial $35 plausible (from memory).

## Cross-cutting
- MEDIUM (M-cont) — K>5.5 makes spiro/epl/finerenone `contraindicated`, which force-removes a CURRENT MRA (current-med audit uses contraindications). Guideline/label: K 5.5-5.9 -> halve dose; >=6.0 hold (finerenone label: hold >=6.0, restart 10 mg at <5.5 — verified). Drops an entire pillar at K 5.6. Mirror the `alreadyOn` pattern: gate initiation at 5.0 but continuation only at >=6.0, with dose reduction 5.5-5.9. From memory (guideline).
- Prices: spiro $4, eplerenone $17 (generic) plausible; Kerendia cash $550 slightly under typical 2025-26 cash/WAC (~$600-700; LOW, from memory); Medicare $125, commercial $10 w/ card plausible.
