# Diuretics review (read-only) - HeartFailurePath
Sources actually checked online this session: ONLY the Furoscix DailyMed label (https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=eac958dd-8d43-e44e-e053-2995a90a4d5e, fetched via summarizing tool; last ~2 KB unread). Everything else is "from memory" (trials, other labels, prices). Lines in constants.ts unless noted.

## How numbers are consumed (effects.ts)
- `chf_effects(dose)` / `hemodynamic_effects(dose)` take ONLY the per-dose strength. `selected_frequency` is used for complexity (effects.ts:102-103) and `pickPreferredFrequency` (regimenUtils.ts:6-15) only; never in effect size or in the high-dose threshold.
- weight deltas add (effects.ts:141,208); BNP multiplicative; K adds; SGLT2i+loop x1.2 on non-GLP1 weight (effects.ts:310). `hasDiuretic` (effects.ts:84) is loop-only.
- No eGFR scaling of any diuretic effect (renalRiskFactor only multiplies POSITIVE K changes, effects.ts:150,227).
- No sodium field appears in types.ts (grep), so Na gates are impossible today.

## Furosemide (:779)
| dose | freq | wt kg | BNP red | KCCQ | SBP drop | dK |
|---|---|---|---|---|---|---|
| 20 | qd/bid | 1.5+.9*0 = 1.50 | .125 | 5.0 | 2.5 | -0.375 |
| 40 | qd/bid | 2.40 | .150 | 6.0 | 3.0 | -0.450 |
| 80 | qd/bid/tid | 3.30 | .200 | 8.0 | 4.0 | -0.600 |
| 160 | bid/tid | 4.20 | .300 | 12.0 | 6.0 | -0.900 |
Findings
- MEDIUM (:786) 160 mg "tablet" is not a marketed strength (US tablets 20/40/80; 160 = 2x80). Threshold 120 (:781) matches no tier except 160. Fix: keep 160 as a labelled "2 x 80 mg" or drop; add nothing at 120. From memory.
- MEDIUM (effects/gates) Per-dose only: 80 mg bid (160/d) credited the same as 80 mg qd; high-dose-loop over-treatment alert (gates.ts:116-118, `Number(dose.strength) >= threshold`) compares PER-DOSE strength, so 80 bid/tid (160-240 mg/d), 40 tid (120/d) never trigger. Fix: compute daily dose = strength x freq multiplier and compare to threshold in furosemide-equivalents (e.g. >=120 mg/d furosemide-eq). Ceiling-per-dose log curve itself is defensible (DOSE: BID vs infusion no difference). Code-verified; evidence from memory.
- MEDIUM (effects.ts, all loops) Loop efficacy not reduced at low eGFR: same kg at eGFR 25 as 90, so furosemide 20/40 mg is credited fully in CKD 4 where threshold/ceiling doses are higher (Brater; ESC 2019). Fix: multiplier on weight_reduction by eGFR band (e.g. x0.8 at 30-45, x0.6 <30 for doses below ceiling). From memory.
- LOW (:808) `side_effects` takes no dose: renal_worsening 0.10 identical at 20 and 160 mg (DOSE: more transient WRF with high dose). Fix: scale with dose.
- LOW (:806) gout -5 reasonable (loops raise urate; label lists hyperuricemia). No outcome bonus given: correct.
- Modeled appropriately: log curve anchors match repo memory.md; K -0.4 to -0.9 plausible; no mortality/LVEF credit (all 0); BID/TID options real.

## Furoscix (:815)
| dose | freq | oral-eq 92 mg: wt | BNP | KCCQ | SBP | dK |
|---|---|---|---|---|---|---|
| 80 mg/10 mL (5 h) | qd | 1.5+.9*log2(4.6)=3.48 | .2465 | 7.53 | 5.13 | -0.75 |
Verified (label): indicated for edema in adults with chronic HF OR CKD incl. nephrotic syndrome (NO NYHA restriction in current label; also pediatric >=43 kg); contraindications = anuria, furosemide/formulation hypersensitivity, medical-adhesive hypersensitivity (On-body Infusor). Cirrhosis is a WARNING not a contraindication. Infusor = 30 mg first hour then 12.5 mg/h x4 = 80 mg/5 h; bioavailability 99.6% vs IV 80 mg (ReadyFlow 107.3%); label gives no oral comparison; "not for chronic use" - replace with oral ASAP; fixed 80 mg may be insufficient in significantly reduced renal function.
Findings
- MEDIUM (:827,:840) 1.15x oral-equivalent under-credits. Label shows ~100% of IV 80 mg; oral furosemide bioavailability ~50% (variable), so 80 mg SC ~ 80 mg IV ~ 160 mg oral. Code gives 3.48 kg vs oral 160 = 4.20 (swap oral 80 -> Furoscix gains only +0.18 kg; real exposure ~2x). Fix: oralEquivalent = d * 2.0 (K and SBP likewise), or at least 1.6-2.0. Label-verified bioavailability; 2x oral conversion from memory.
- MEDIUM (:819,:849-856) Modeled as a standing daily (qd) regimen drug with monthly-equivalent price, but label says not for chronic use. Swap candidates replace the patient's oral loop with Furoscix (candidates.ts:230-236) leaving a standing Furoscix med. Fix: model as add-on burst on top of baseline oral loop (not swap-out), or add a per-rec note "short course; return to oral loop" and exclude from "continued" regimens when fluidExcess <1 (the CI already removes at <1 kg, good).
- LOW (:874) eGFR<15 exclusion is stricter than label (label CI = anuria only; CKD is an indication) and blocks CKD5 non-anuric patients who may be intended users. Fix: gate on anuria/UOP if available, else downgrade to caution. Label-verified.
- LOW (:857-858,:887) adhesive CI present (good); allergy match on 'loop diuretic' is broad but safe.
- LOW price (pricingService:159) cash $900/ commercial $100/ Medicare $200 "monthly-equivalent": per-dose list ~ $800-1000 per prompt is unverified by me; number of doses in a "burst" is undefined so the budget filter compares an arbitrary figure. Fix: define doses/burst (e.g. 4-5) in notes and compute explicitly. Unverified.
- Appropriately modeled: contraindication list, congestion-context gating (>=1 kg / baseline loop), +12 outpatient-decongestion feature (modest, defensible), complexity penalty, single dose tier.

## Torsemide (:894)
| dose | freq | wt kg | BNP | KCCQ | SBP | dK |
|---|---|---|---|---|---|---|
| 10 | qd/bid | 1.80 | .12 | 6.0 | 2.5 | -0.34 |
| 20 | qd/bid | 1.8+.96=2.76 | .14 | 7.0 | 3.0 | -0.38 |
| 50 | qd/bid | 1.8+.96*2.32=4.03 | .20 | 10.0 | 4.5 | -0.50 |
| 100 | qd/bid | 4.99 | .30 | 15.0 | 7.0 | -0.70 |
Findings
- MEDIUM (:901) 50 mg is not a US tablet strength (US: 5/10/20/100; Soaanz 20/40/60). Threshold 50 (:896) keyed to it. Fix: replace 50 with 40 (or 60), threshold ~60 (=furosemide 120). Missing 5 mg. From memory.
- MEDIUM (:897 + components/MedicationLibrary.tsx:29) `is_best_in_class: true` shows a badge on torsemide. TRANSFORM-HF (JAMA 2023, n=2859): all-cause death 26.1% vs 26.2% (HR 1.02), no hospitalization difference. No engine score bonus exists (good), but badge misstates. Also :924 side effects omit renal_worsening while furosemide carries 0.10, and hypokalemia .15 vs .20, with no outcome basis. Fix: remove badge or relabel "better/predictable oral bioavailability"; give torsemide equal renal_worsening. From memory.
- LOW (:908-909) torsemide credit 2.76 kg at 20 mg vs furosemide 40 mg 2.40 (+15%) is a reasonable bioavailability credit; 100 mg ~ furosemide 200 mg (4.99 vs ~4.5) fine. Per-dose/daily-dose issue as furosemide (threshold 50 per dose).
- Appropriately modeled: no LVEF/mortality credit; K and gout handling; renal caution <20.

## Bumetanide (:931)
| dose | freq | wt (40:1) | BNP | KCCQ | SBP | dK |
|---|---|---|---|---|---|---|
| 0.5 | qd/bid | 1.50 | .125 | 5 | 3 | -0.375 |
| 1 | qd/bid | 2.40 | .15 | 6 | 4 | -0.45 |
| 2 | qd/bid/tid | 3.30 | .20 | 8 | 6 | -0.60 |
| 4 | bid/tid | 4.20 | .30 | 12 | 10 | -0.90 |
Findings
- HIGH (:938,:937; regimenUtils.ts:11-14) "4 mg tablet" does not exist (tablets 0.5/1/2 mg). For eGFR<20 `pickPreferredFrequency` auto-selects tid, so the 4 mg tier becomes 12 mg/day, above the labeled max of 10 mg/day (ototoxicity/over-diuresis risk). Even 4 mg bid = 8 mg/d = furosemide-eq 320 mg. Fix: delete 4 mg tier (use 2 mg bid/tid, cap daily <=10 mg), cap frequency selection by label daily maximum. From memory (label max, strengths); 1 mg ~ 40 mg furosemide equivalence is the standard label statement (code's 40:1 is correct).
- MEDIUM (:956) sbp_drop = 2+2d gives 10 mmHg at 4 mg versus 6 for equipotent furosemide 160 and 7 for torsemide 100; inconsistent, overstates hypotension penalty and under-ranks bumetanide. Fix: 2 + d*1.0 (match furosemide-eq: 2 + (40d)/40).
- LOW (:933) threshold 2 mg (=80 mg furosemide) is inconsistent with furosemide's 120 (bumetanide 3 mg) - same per-dose vs daily problem.
- LOW price: cash $6 plausible-low (GoodRx typically ~$10-20), copays $3 fine. From memory.

## Metolazone (:1211)
| dose | freq | wt | BNP | KCCQ | SBP | dK |
|---|---|---|---|---|---|---|
| 2.5 | qd | 2.0 flat | .10 | 3 | 5 | -0.5 |
Findings
- MEDIUM (:1213-1216) Only 2.5 mg qd (typical HF 2.5-5 mg, up to 10 mg, usually 1-3x/week or 30 min before loop, short course). Modeled as a permanent daily add-on with flat +2.0 kg stacked on the loop, and no Na/K baseline gate (no Na field in types.ts; no K<3.5 gate; engine only warns on projected K). Metolazone + loop is the commonest cause of severe hypoK/hypoNa. Fix: add 5 mg tier, `frequency_options` including intermittent label, K<3.5 contraindication, and mandatory BMP within 3-5 days in monitoring; reduce credit (see CLOROTIC finding). Practice facts from memory.
- LOW (:1227) eGFR<15 CI acceptable (metolazone retains efficacy at low GFR - correct to NOT block at 15-30); label CIs (anuria, hepatic coma) not otherwise encoded.
- LOW (:1226) side_effects lack hyponatremia.

## Chlorthalidone (:1230)
| dose | wt (1.5+d/25*.5) | BNP | KCCQ | SBP | dK |
|---|---|---|---|---|---|
| 12.5 | 1.75 | .115 | 2.5 | 5.25 | -0.45 |
| 25 | 2.00 | .15 | 3.0 | 6.5 | -0.50 |
Findings
- MEDIUM (:1237) Comment attributes CLOROTIC to chlorthalidone. CLOROTIC (Trullas, Eur Heart J 2023) tested HYDROCHLOROTHIAZIDE (50 mg/d, 25 mg if eGFR<30) added to IV furosemide: weight loss at 72 h ~-2.3 vs -1.5 kg (incremental ~0.8 kg), better dyspnea, but more worsening renal function, hypokalemia, hyponatremia. Code gives chlorthalidone +1.75-2.0 kg and HCTZ +1.25-1.5 kg: ~2x the incremental trial effect and HCTZ (the studied drug) credited less. Fix: add-on thiazide wt ~0.8-1.0 kg for HCTZ 50/metolazone 2.5, chlorthalidone similar; fix comment; add worsening_renal_function to side effects. From memory (not re-verified online).
- LOW (:1233) tiers 12.5/25 only (12.5 = half tab; 50 mg tab exists but rarely used in HF). Fine.
- LOW no sulfonamide-hypersensitivity CI though thiazide labels list it (engine alerts only, eligibility.ts:252) - acceptable by cross-reactivity data.
- No HFrEF-outcome credit: correct.

## Hydrochlorothiazide (:1254)
| dose | wt (1+d/50*.5) | BNP | KCCQ | SBP | dK |
|---|---|---|---|---|---|
| 25 | 1.25 | .09 | 2.5 | 4.67 | -0.35 |
| 50 | 1.50 | .12 | 3.0 | 6.33 | -0.40 |
Findings
- (see CLOROTIC finding above for credit/ordering)
- LOW (:1257,:1275) 12.5 mg missing; eGFR<30 CI is conservative: CLOROTIC dosed 25 mg at eGFR<30, and CLICK showed chlorthalidone works at eGFR 15-30, so HCTZ at 25 mg should arguably be a caution not a CI. From memory.
- LOW sulfa as above.

## Class-level findings
- MEDIUM (:806,:922,:958 vs none on 1211-1276) Gout caution (-5) is attached to loops but NOT to thiazides/metolazone, which raise urate at least as much (chlorthalidone/HCTZ are the classic gout precipitants). Asymmetry favors adding a thiazide in a gout patient. Fix: same -5 (or -8) on all three thiazide-like entries; add uric acid to side effects. From memory; code-verified absence.
- LOW (candidates.ts:348-353) thiazide add-on only when fluidExcess>4 kg and already on loop; does not check loop dose already escalated (2022 AHA/ACC 2a: add thiazide for persistent congestion despite escalating loop). Also offered only as first tier (`thiazTiers[0]` = metolazone 2.5). Fix: allow at >=2 kg when on high-dose loop; offer chlorthalidone/HCTZ alternatives.
- LOW (effects.ts:84,305) `hasDiuretic` is loop-only but `currentHasDiureticSGLT2` counts thiazides: SGLT2i synergy x1.2 never applies to thiazide-only regimens yet is suppressed if thiazide already present. Cosmetic.
- Loop de-escalation: appropriate - titrate-down/remove offered at fluidExcess<0.5 (candidates.ts:254-259), +15 depletion de-escalation score, VOLUME DEPLETION alert (gates.ts:281-290), BUN/Cr>20 only a warning when MAP<70 (effects.ts:643-649), and a congested patient is never offered loop removal. Appropriately modeled.
- Sulfa handling: alert only (eligibility.ts:252-253); wording accurate (ethacrynic acid not in formulary). Appropriately modeled.

## Prices (pricingService.ts:74-109,159) - all from memory, not checked online
Furosemide $3, torsemide $5, bumetanide $6 (copay 3), metolazone $12, chlorthalidone $5, HCTZ $4: plausible generics for 2025-26 (bumetanide/metolazone may be ~$10-25 cash on GoodRx). Furoscix: see LOW above.
