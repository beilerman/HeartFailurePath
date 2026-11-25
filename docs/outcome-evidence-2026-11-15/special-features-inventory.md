# Special-feature inventory (updated 2026-11-16)

Source: `special_features` in `constants.ts`, read in `services/engine/effects.ts`.

**Current state (owner ruling 2026-11-16): every special feature and the gout caution add 0 points.** Each feature is rationale text only and carries a data field
`replaced_by` that says where its benefit or harm is (or is not) modelled. The only remaining `SPECIAL_FEATURES` bonus points are the mandatory swap away from a
contraindicated or intolerance-documented drug (+15, unchanged). Features marked `not_modelled` append "(noted; not scored: no measured model yet)" to the rationale text.

Classes (from the first inventory, 2026-11-15): **A** lower death or HF hospitalization; **B** caution or harm; **C** another outcome or target; **D** other; **A/C** mixed.
The `points` column is the RETIRED figure, kept in the data only as documentation.

| Drug | Feature (text) | Retired points | Class | `replaced_by` |
|---|---|---|---|---|
| Bisoprolol | Preferred in COPD / mild-moderate asthma (most beta-1 selective) | 10 | C | not_modelled |
| Spironolactone | HFpEF Class IIb: TOPCAT Americas subgroup — reduced HF hospitalization (LVEF ≥ 45) | 18 | A | outcome |
| Eplerenone | Fewer endocrine side effects (No gynecomastia risk) | 3 | C (tolerability) | harm |
| Finerenone (Kerendia) | nonsteroidal MRA: 16% RRR CV death/HF events in LVEF≥40 (FINEARTS-HF); lower hyperkalemia vs steroidal MRA | 45 | A/C | outcome |
| Dapagliflozin | Preferred in Diabetics | 10 | C | not_modelled |
| Empagliflozin | Preferred in Diabetics | 10 | C | not_modelled |
| Semaglutide (Wegovy) | STEP-HFpEF: improves symptoms and function in obesity-phenotype HFpEF (LVEF 45 or higher, BMI 30 or higher) | 40 | C | symptom |
| Tirzepatide (Zepbound) | SUMMIT: fewer HF events and better symptoms in obesity-phenotype HFpEF (LVEF 50 or higher, BMI 30 or higher) | 40 | A/C | outcome |
| Furoscix (SC Furosemide) | Outpatient worsening-HF decongestion option on background loop therapy | 12 | C | not_modelled |
| Furoscix (SC Furosemide) | On-body infusor complexity burden | -8 | B | adherence (the dosing-burden domain) |
| Hydralazine/Isosorbide Dinitrate | A-HeFT: mortality and HF-hospitalization benefit in self-identified Black patients, NYHA III-IV HFrEF, on a RAAS inhibitor and a beta-blocker (Class 1) | 60 | A | outcome |
| Ivabradine | SHIFT: Reduces HF hospitalization (sinus rhythm, LVEF <= 35; started at HR >= 70 on maximally tolerated beta-blocker; AHA/ACC 2022 Class 2a) | 15 | A | outcome |
| Sodium Zirconium Cyclosilicate (Lokelma) | Sodium load risk in congested HF (about 400 mg sodium per 5 g; dose-related edema) | dose function -7 / -10 / -27 | B | harm |
| Ferric Carboxymaltose | Treats iron deficiency in HFrEF (LVEF 40 or lower; Class 2a) | 40 | A/C | outcome |
| Ferric Carboxymaltose | Treats iron deficiency, limited evidence at LVEF 41-49 (trials enrolled LVEF below 50) | 20 | A/C | outcome |
| Digoxin | Rate Control in AFib | 20 | C | not_modelled |

Outside `special_features`, in the same sum (`effects.ts`):

| Item | Points now | Class | Treatment |
|---|---|---|---|
| Caution in Gout (uric acid retention), any drug with `facts.raises_uric_acid` | 0 (was -5) | B | `replaced_by` harm: the rationale line stays, the warning note stays |
| Mandatory swap away from a contraindicated or intolerance-documented drug | +15 | D (forced-change bookkeeping, not a benefit claim) | unchanged |

Counts: outcome 7, symptom 1, harm 2 (plus the gout caution), adherence 1, not_modelled 5.
Judgement calls to confirm: the iron features are classed A/C (the code comment cites AFFIRM-AHF hospitalization alongside symptoms); the finerenone potassium share and the
tirzepatide symptom share cannot be split out, so the whole feature is retired into the outcome model.
