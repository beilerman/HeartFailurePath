# Rate-control / beta-blocker review: Carvedilol, Metoprolol Succinate, Bisoprolol, Ivabradine, Digoxin
Reviewer notes. Provenance tags: "verified" = confirmed online this session (only: Corlanor DailyMed label contraindications/dosing; ivabradine generic launch/cash prices via web search). Everything else "from memory".
Files: constants.ts (carvedilol 338, metoprolol 382, bisoprolol 419, ivabradine 1009, digoxin 1173), services/engine/contraindications.ts:39, candidates.ts:86-130 and 293-330, effects.ts:128-150, pricingService.ts:48-128.

## Carvedilol (units mg, BID; ratio=d/25)
| dose | target? | LVEF abs | BNP red | KCCQ | LVEDD red | SBP drop (x0.35 at 3.125) | HR drop |
|---|---|---|---|---|---|---|---|
| 3.125 | no | 5.6 | 11% | 2.5 | 8.5% | 5.6 (2.0) | 9.0 |
| 6.25 | no | 6.25 | 14% | 3.0 | 9.0% | 6.25 | 10.1 |
| 12.5 | no | 7.5 | 17.5% | 4.0 | 10% | 7.5 | 12.2 |
| 25 | yes (<=85 kg) | 10 | 25% | 6.0 | 12% | 10 | 16.3 |
| 50 | yes (>85 kg only) | 15 | 40% | 10 | 16% | 15 | 24.7 |
Tiers/target: 3.125/6.25/12.5/25 mg tablets are real; 50 mg is not a marketed tablet (Coreg strengths 3.125, 6.25, 12.5, 25 mg; 50 mg = 2x25) - harmless. Target 25 BID <=85 kg, 50 BID >85 kg matches label/COPERNICUS-US Carvedilol (from memory). Static `is_target_dose` is true on BOTH 25 and 50, but isTargetDoseForPatient routes through `is_target_dose_for`, so engine is correct; the static flag only misleads other readers (LOW). Starting dose 3.125 BID correct.

1. MEDIUM (effects extrapolation) constants.ts:355-361. Linear in d/25 with no cap, so 50 mg returns LVEF +15, BNP -40%, KCCQ +10, LVEDD -16% - 50% above the 25 mg target figures and beyond any trial dose-response (MOCHA tested 6.25/12.5/25 BID; no incremental data at 50 BID). Heavy (>85 kg) patients therefore get a built-in ranking bonus for 50 mg that lighter patients cannot reach. Fix: clamp ratio at 1 (`Math.min(d/25,1)`) or express as fraction of the patient's weight-based target. From memory.
2. HIGH (safety, shared by all three BB, see Cross-cutting A) CI_PULSE_LT_55 forces removal of an established beta-blocker.
3. LOW hepatic CI is Child-Pugh B/C (constants.ts:372); Coreg label contraindicates only SEVERE hepatic impairment (Child-Pugh C); B is "caution". Mildly strict. From memory.
4. LOW Label contraindications not modeled: sick sinus syndrome without pacemaker, cardiogenic shock, NYHA IV decompensation needing IV inotropes (acute decompensation handled separately by candidates/eligibility, so effectively covered), hypersensitivity. From memory.
5. LOW `is_best_in_class` (also on metoprolol) is declared in types.ts:139 but read by no engine file; cosmetic. Carvedilol's extra structure_benefit_points 40 vs 35 and higher BNP/LVEF at equipotent dose reflect no head-to-head superiority over succinate/bisoprolol (COMET compared carvedilol with metoprolol TARTRATE). MEDIUM-LOW mis-ranking tilt toward carvedilol; fix: equalize at equipotent target (40->35, BNP 0.25->~0.22, LVEF 10->9) or cite. From memory.
6. LOW HR drop has an 8 bpm floor at every dose (8 + d/3), so 3.125 mg still subtracts 9 bpm. SBP is attenuated 0.35 at the first tier (effects.ts) but HR is not; at HR 60-65 a "starting dose" candidate projects HR ~52-56 and can trigger projected-HR penalties. Fix: scale the floor (e.g. 3 + ...) or apply a starting-dose factor to HR. From memory/model arithmetic.
Asthma: mild/moderate asthma CI for carvedilol matches label ("bronchial asthma or related bronchospastic conditions"); COPD not CI - appropriate (guideline allows). Hemodynamics: carvedilol SBP effect > metoprolol/bisoprolol at equipotent doses - correct direction.

## Metoprolol Succinate (ER, QD; ratio=d/200)
| dose | target? | LVEF | BNP | KCCQ | LVEDD | SBP drop | HR drop |
|---|---|---|---|---|---|---|---|
| 12.5 | no | 5.25 | 10.6% | 3.2 | 7.2% | 3.25 (x0.35=1.1) | 8.6 |
| 25 | no | 5.5 | 11.3% | 3.4 | 7.4% | 3.5 | 9.25 |
| 50 | no | 6.0 | 12.5% | 3.8 | 7.8% | 4.0 | 10.5 |
| 100 | no | 7.0 | 15% | 4.5 | 8.5% | 5.0 | 13 |
| 200 | yes | 9.0 | 20% | 6.0 | 10% | 7.0 | 18 |
Tiers: Toprol-XL marketed as 25/50/100/200 mg; 12.5 mg is a half of a scored 25 mg tablet (label permits), correct start 12.5-25 mg for HF. Target 200 mg = MERIT-HF. Dose-response shape sensible; 12.5-25 mg credited ~55-60% of target LVEF, which is generous but consistent with the other BBs (coherent at equal fraction of target: 12.5% target -> LVEF 5.25-5.6 for all three). Appropriately modeled.
7. LOW Hepatic CI (constants.ts:414) "Child-Pugh B/C" is not on the metoprolol succinate label (label: caution/ titrate slowly in hepatic impairment) and bisoprolol has none, so the three BBs are inconsistent. A cirrhotic patient loses metoprolol but keeps bisoprolol; acceptable as conservative but inconsistent. Fix: convert to a caution or drop. From memory.
8. LOW Same label gaps as carvedilol (sick sinus, cardiogenic shock). Label contraindication is "severe bradycardia"/heart block >1st degree; see Cross-cutting A.

## Bisoprolol (QD; ratio=d/10)
| dose | target? | LVEF | BNP | KCCQ | LVEDD | SBP drop | HR drop |
|---|---|---|---|---|---|---|---|
| 1.25 | no | 5.5 | 11.5% | 3.4 | 7.4% | 3.25 (x0.35) | 8.8 |
| 2.5 | no | 6.0 | 13% | 3.8 | 7.8% | 3.5 | 9.7 |
| 5 | no | 7.0 | 16% | 4.5 | 8.5% | 4.0 | 11.3 |
| 10 | yes | 9.0 | 22% | 6.0 | 10% | 5.0 | 14.7 |
Target 10 mg = CIBIS-II (correct). Dose-shape coherent with metoprolol. 
9. LOW/MEDIUM-LOW Tiers: 1.25 and 2.5 mg bisoprolol are CIBIS-II/European strengths; US-marketed single-agent bisoprolol tablets are 5 and 10 mg (Zebeta label, HTN-only; HF use is guideline/off-label), so 1.25/2.5 mg require splitting (2.5 half of 5 is OK; 1.25 is a quarter-tab, impractical). CIBIS-II titration steps 3.75 and 7.5 mg also absent. Fix: note US availability; keep 2.5 as half-tab, make 1.25 optional. From memory (not verified on DailyMed).
10. LOW Special feature "Preferred in COPD/mild-moderate asthma" +10 (constants.ts:451): rational (beta-1 selective; carvedilol is CI'd in asthma anyway), size 10 is proportional to the small-tiebreaker tier. Note it fires even when COPD patient could equally take metoprolol succinate (also beta-1 selective). Cosmetic; fix by gating on `!metoprolol available` or accept.
11. LOW No sick-sinus/bradycardia nuance beyond CI_PULSE_LT_55; bisoprolol HR drop (14.7 at 10 mg) is lower than metoprolol 200 mg (18) - fine.

## Ivabradine (BID)
| dose | target? | LVEF | BNP | KCCQ | LVEDD | SBP | HR drop |
|---|---|---|---|---|---|---|---|
| 5 | no | 2.0 | 10% | 5 | 2% | 0 | 12 |
| 7.5 | yes | 2.0 | 10% | 5 | 2% | 0 | 12 |
Label (verified: DailyMed Corlanor): start 5 mg BID (2.5 mg BID if conduction defects / bradycardia hemodynamic risk), titrate q2wk to resting HR 50-60, max 7.5 mg BID. Tablets 5 and 7.5 mg (2.5 = half of 5). HR-guided, so "is_target_dose" on 7.5 is a crude proxy (LOW).
12. MEDIUM Contraindications missing vs label (verified, DailyMed Corlanor sec 4): strong CYP3A4 inhibitors (ketoconazole, itraconazole, clarithromycin, ritonavir...), sick sinus syndrome/SA block, acute decompensated HF, severe hepatic impairment (Child-Pugh C), pacemaker dependence, clinically significant hypotension. constants.ts:1025-1042 has none of the CYP3A4/SSS/hepatic/pacemaker checks (only pregnancy, HR<70 init, HR<50 cont, AF, AV block 2/3). Only DDI-7 (BB co-titration) exists; verapamil/diltiazem (moderate CYP3A4 inhibitors and negative chronotropes; label says avoid) are not tied to ivabradine, and ivabradine is also withheld from DDI-5. Fix: add CYP3A4 check on external medications (strong inhibitor list), CI_LIVER_CHILD_PUGH_BC (conservative), SSS/pacemaker if a field exists, DDI warning for verapamil/diltiazem + ivabradine; acute decompensation initiation gate should be confirmed in candidates/eligibility.
13. MEDIUM Special feature criteria `p.pulse >= 70` (constants.ts:1047) is evaluated on the patient state including on-drug HR. A patient already on ivabradine at the intended 50-60 bpm loses the +15 bonus, penalizing treatment success (the same initiation-vs-continuation pattern the engine applies elsewhere). Fix: bonus fires if already on If Inhibitor (sinus, LVEF<=35) regardless of current HR. Verified by reading code (effects.ts:322 evaluates against currentPatient).
14. LOW Effects are dose-independent (5 vs 7.5 identical; HR drop 12 flat). SHIFT mean HR reduction ~15 bpm at 28 d, ~8 bpm placebo-subtracted at study end (from memory) so 12 is acceptable as a mid-range; but up-titration 5->7.5 has zero modeled benefit and only 7.5 flagged target (partial-credit penalty for 5 mg ~"below target" under completeness 60% credit). Fix: HR drop ~9 at 5 mg, 12 at 7.5, or mark both as acceptable (HR-guided).
15. LOW KCCQ +5 overstates SHIFT QoL substudy (KCCQ ~ +1.8 vs placebo; from memory); LVEF +2 consistent with SHIFT echo (+2.7 vs +0.1 at 8 mo; from memory). Fix KCCQ to ~2.
16. LOW Guideline-class labels inconsistent: candidates.ts:293 cites "ESC 2021 Class IIb", special feature cites "Class IIa". ESC 2021 = IIa, 2022 AHA/ACC = 2a (from memory). Fix comment.
17. LOW Initiation tier is always `ivabTiers[0]` = 5 mg; no 2.5 mg BID start for conduction-defect/elderly (label). Fix: add a 2.5 mg (half tablet) tier or alert.
Other checks: HR>=70 sinus on max-tolerated BB gate is correct; "bbAtTarget or allBBExcluded" proxy is stricter than guideline (max TOLERATED, not target) - a patient limited to carvedilol 12.5 by hypotension will never see ivabradine eligibility (MEDIUM-LOW, from memory; add "BB at max tolerated per documented intolerance"). AF exclusion on continuation is clinically sensible (ivabradine increases AF risk; label warns). Pregnancy CI appropriate. LVEF<=35 is enforced at candidate generation only, not in ci(); fine.

## Digoxin (mcg QD)
| dose | target? | LVEF | BNP | KCCQ | HR drop | SBP |
|---|---|---|---|---|---|---|
| 62.5 | no | 0 | 3% | 2 | 4 | 0 |
| 125 | no | 0 | 5% | 4 | 8 | 0 |
Tiers: Lanoxin 62.5/125/250 mcg are real. 125 daily is typical; 62.5 daily (or every other day) for eGFR<30/elderly/low lean mass; 250 not used in modern HF. Missing: every-other-day 62.5 for eGFR<15/dialysis (see CI); fine otherwise. Level target 0.5-0.9 ng/mL (DIG post hoc; 2022 guideline) - warning text present (effects.ts:631).
18. MEDIUM Indication too broad for guideline: candidates.ts:322-326 offers digoxin as an addable adjunct for ANY AFib (even LVEF>=50, even before BB optimization) OR LVEF<=45 + NYHA III/IV with no requirement of GDMT-optimization. 2022 AHA/ACC: digoxin Class 2b only for persistent symptoms/ HFrEF despite optimal GDMT (from memory). Adjunct completeness excludes it (scoring.ts:88), which limits harm, but it can still appear in regimens through the +20 AF special feature and the KCCQ/BNP credits. Fix: require BB at tolerated dose (and RAAS) before offering, or flag rank below GDMT gaps.
19. MEDIUM Credits efficacy not in evidence: BNP -5% and KCCQ +4 at 125 mcg. DIG: reduced HF hospitalization (HR ~0.72), no mortality effect, no NT-proBNP outcome data; digoxin modestly improves symptoms in older trials (RADIANCE/PROVED). Net effect ok but BNP reduction is unsupported; because BNP factors compound multiplicatively, keep small. Fix: BNP 0.0-0.02, KCCQ 2-3. Also hr_drop applies equally in sinus rhythm (8 bpm); digoxin lowers resting HR little in sinus rhythm (~3-5) but substantially in AF. Fix: rhythm-conditional (not currently possible in hemodynamic_effects(dose) signature - consider applying in effects.ts). From memory.
20. MEDIUM Renal/age dosing: only eGFR<30 caps at 62.5 (constants.ts:1202). Label dosing is by CrCl/lean body weight: eGFR 30-50 and age >70-75 typically start 62.5 mcg (or 125 qod), and 125 mcg daily is credited full effect at eGFR 30-49 where steady-state levels >0.9 are common. getDoseTiers has an age>80 tier limiter (regimenUtils:30) which partly covers this. Fix: cap at 62.5 for eGFR<50 or age>=70-75 (HF guideline/label practice). From memory.
21. LOW/MEDIUM-LOW Contraindications vs label: eGFR<15 hard CI (label has no absolute CI; use reduced/ qod dosing with levels), K>5.5 CI (label: hyperkalemia is a caution; toxicity risk rises with HYPOkalemia/hypoMg/hypercalcemia), K<3.5 CI (label: correct hypokalemia first - stricter than label but defensible). Missing: ventricular fibrillation (label CI), accessory pathway (WPW + AF) - dangerous; HCM/amyloid caution. From memory. Fix: add WPW/VF checks if comorbidity fields exist; consider turning eGFR<15 into dose-reduction (62.5 qod) with levels.
22. LOW Missing automatic dose reduction with amiodarone (label: reduce ~30-50%): only a DDI warning (effects.ts:705). Warning is adequate; DDI with verapamil/diltiazem present. Quinidine, clarithromycin, macrolides not modeled. Fine.
23. LOW Special feature "Rate Control in AFib" +20 is reasonable but fires in preserved EF AF where beta-blocker/diltiazem choice differs; proportional.

## Cross-cutting
A. HIGH (all three beta-blockers) constants.ts:366-373/409-415/444-449 + services/engine/contraindications.ts:39-41 + candidates.ts:92-99. `CI_PULSE_LT_55` (p.pulse < 55) is an absolute contraindication with NO initiation-vs-continuation carve-out. candidates.ts:92-99 adds any current med failing contraindications() to `contraindicatedCurrentMeds`, which blocks keep/titrate-up and forces down-titration/swap/removal; swap targets (other BBs) fail the same check, so the likely result is removal of a working BB. A stable HFrEF patient on carvedilol 25 BID with resting HR 50-54 and no symptoms (HR 50-60 is the desired range on BB; ESC/AHA advise dose reduction only for symptomatic bradycardia or HR<50) would have the BB force-removed, losing a mortality-benefit pillar. The engine's own policy elsewhere (ivabradine HR<50 continuation, SGLT2i, vericiguat) uses an `alreadyOn*` carve-out. Evidence: label says "severe bradycardia"; ESC 2021 says reduce dose if HR <50 with symptoms; BB should not be abruptly withdrawn (from memory). Fix: for BB, CI on continuation at pulse <50 (or <50 with symptoms; otherwise a dose-reduction candidate), keep <55 only for INITIATION (current regimen has no BB); the pattern is already at constants.ts:1031-1038. Verified by reading code that no carve-out exists; clinical references from memory.
B. LOW Benefit credited at every dose is steady-state; reverse remodeling takes 3-6 months and the model credits a starting dose ~55% of target-dose LVEF. Consistent across the class; acceptable for a ranking heuristic.
C. LOW Starting-dose hemodynamic factor 0.35 is keyed to `available_doses[0]`; metoprolol 12.5 mg qualifies, but if the carvedilol list were re-ordered or a patient's tier list is filtered (getDoseTiers max_dose) the attenuation still keys to the static first entry. No current bug.

## Prices (pricingService.ts:48-128; 2025-26 US)
- Carvedilol 4/3/3, metoprolol succinate 10/5/5, bisoprolol 11/5/5, digoxin 12/5/5: plausible for generics with discount-card cash pricing (from memory; digoxin 125 mcg cash $10-25). OK.
- Ivabradine cash 58 / commercial 30 / Medicare 45: plausible for GENERIC ivabradine with discount card (verified: web search - generics from Zydus, Ingenus/Camber launched July 2024; GoodRx ~$56, SingleCare $49 w/ card, other sources $80-250; brand $800-900). Entry labelled `tier: 'preferred_brand'`, `generic_available: false` with a note "authorized generic available in some markets" - LOW: should be `generic_available: true`, tier generic; retail non-coupon can be $300+, and a shortage was reported (medfinder, Jan 2026, unverified). Fix metadata; keep numbers.

## Judged appropriately modeled
- Metoprolol Succinate dose tiers, target (200 mg), efficacy shape, hemodynamics: appropriate (aside from CI issue A and hepatic CI LOW).
- Bisoprolol efficacy/hemodynamics/target: appropriate (US tier availability LOW).
- Carvedilol tiers 3.125-25 and weight-based target logic: appropriate; 50 mg extrapolation is the defect.
