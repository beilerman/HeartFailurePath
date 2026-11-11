# Aligning HeartFailurePath with the GlucosePATH architecture

Drafted 2026-11-10 · Branch `refactor/glucosepath-alignment` · **Status: all phases complete; `npm run gate` green; engine output byte-identical to the pre-refactor baseline.** Current structure: `scoring-architecture.md`.

## What makes GlucosePATH understandable

GlucosePATH (`pathcds/glucosepath`) treats therapy selection as five visible stages:

| Stage | GlucosePATH | What a reader gets |
|---|---|---|
| 1. Describe | Patient JSON (clinical state + values: `cSen`, `maxCst`, `adh`, `avoid*`) and a medication catalog whose properties are data (A1c reduction, weight, mechanism, class, contraindication, frequency) | Drugs and patients share one vocabulary |
| 2. Exclude | `soln_DisqualifyMeds`: an ordered, numbered rule list (Rule 1…29). Each rule disables a med and writes a note | "Why isn't drug X offered?" has a rule number |
| 3. Enumerate | Every combination of the surviving meds | No hidden candidate logic |
| 4. Score | Six factor scores, each 0–100 (A1c vs goal, weight, patient cost, system cost, adherence, side effects), combined by **one weight table** selected by the patient's cost sensitivity | The number is a weighted sum of clinical goals and patient values |
| 5. Explain | Output prints every factor score, the weights used, and per-drug reasons; disqualification codes decode to text | The printed parts add up to the total |

Its weak spot is that side-effect knowledge is ~10,000 lines of per-drug `if` branches duplicated
in two places — the part HeartFailurePath should *not* copy.

## Where HeartFailurePath differs today

| GlucosePATH property | HeartFailurePath before this work |
|---|---|
| One weight table | Weights are inline literals in a 760-line function; the UI restates them as copy |
| Total = Σ weight × factor | Total = weighted sum **plus ~12 adjustments** (GDMT completeness +30, special-feature bonus, SBP/HR/K+ penalties, −10 per warning, unknown-lab −15s, volume +20, clamps). None are returned or shown |
| Printed parts reconcile to the total | Domain scores are rounded and adjustments discarded; the total cannot be rebuilt from the output |
| Numbered exclusion rules with notes | Exclusions are inline code with reason strings, no rule identity |
| Drug properties are data | ~14 rules in the engine are keyed on drug *names* (Carvedilol, Spironolactone, Furoscix, Patiromer…); adjunct criteria live in the engine |
| Named stages | Filtering, rescue, simulation, scoring and penalties interleave in one loop |

## Target shape

```
describe   patient (clinical state + values) · formulary entries carry their own facts
exclude    ELIGIBILITY_RULES — ordered, numbered, each yields {rule_id, reason}
generate   candidate modifications from the current regimen (HF is delta-based; kept)
score      7 domain scores 0–100  ×  DOMAIN_WEIGHTS  +  named ADJUSTMENTS
explain    score_breakdown on every regimen: Σ lines == raw_score, shown in the UI
```

HF keeps two deliberate differences: it generates *modifications to the current regimen* rather than
all combinations (titration matters in HF), and its hard safety gates stay outside scoring.

## Rule for this work: behavior-preserving

Every phase must leave `npm run gate` green — typecheck, the **golden master** (315 full engine
outputs, byte-identical), verify (106), and the three audits. No ranking, score, warning or
exclusion text changes. Anything that would change clinical behavior is listed under
"Decisions for Brad" instead of being done.

## Phases

| # | Phase | Result |
|---|---|---|
| 0 | Golden-master harness (`scripts/goldenMaster.ts`, `npm run golden`, `npm run gate`) | Done — commit `7c920fc` |
| 1 | **Score model as data + reconciling breakdown.** `DOMAIN_WEIGHTS` and every adjustment magnitude become named exported constants; each `ScoredRegimen` gets `score_breakdown` (unrounded domain × weight lines + named adjustment lines); verify asserts the lines sum to `raw_score` | The number is explainable |
| 2 | **Numbered eligibility rules.** Lift the exclusion stage into `services/engine/eligibility.ts` as an ordered `ELIGIBILITY_RULES` list; each exclusion carries `rule_id` | Mirrors `soln_DisqualifyMeds` |
| 3 | **Drug facts onto the formulary.** Replace drug-name branches in the engine with fields/hooks on `Medication`; add a structural test that no formulary drug name appears as a literal in engine code | Adding a drug stops meaning "edit the engine" |
| 4 | **Named stages.** Split `generateAndScoreModifications` into stage functions/modules along the low-risk seams; `simulationService.ts` stays the public facade | The pipeline reads top to bottom |
| 5 | **Show it.** Score modal renders the weight table and the score math from the engine constants and `score_breakdown`; add `docs/scoring-architecture.md` and `docs/HOW_TO_ADD_A_MEDICATION.md`; update CLAUDE.md, memory.md | Clinician and maintainer can both follow a decision |

Phases 1–4 all edit the engine file, so they run in sequence, one agent each. Phase 5 touches only
components and docs and runs alongside phase 2 in a separate worktree.

## Decisions taken 2026-11-10 (Brad: "best case for clinical use and understandability")

1. **Patient-selected weight profiles: done.** `care_priority` selects the row of `WEIGHT_PROFILES`.
2. **Bonuses folded into the weighted sum: done.** Therapy completeness is an eighth factor; eight
   weights sum to 100%. The evidence bonus and safety deductions stay as itemized adjustments.
3. **Per-patient numeric goals: not done.** Heart-failure targets are not individualized the way an
   A1c goal is. Each factor's fixed goal is now shown in the ledger instead.

Also added: "why this ranked lower" comparison, numbered exclusions with specific reasons.
Open for review: the six changed top picks and the uncalibrated non-default profiles (see memory.md).
