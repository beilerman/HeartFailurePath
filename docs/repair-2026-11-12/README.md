# First handoff repair batch, 2026-11-12

> Historical stage report. The [consolidated handoff](../HANDOFF-2026-11-13.md) reconciles subsequent fixes, retired response calculations, latest verification and remaining work. Preserve this report as evidence of its review stage.

Local changes on `refactor/glucosepath-alignment`, rule set `2026-11-12.4`. Based on Claude's `docs/HANDOFF-2026-11-12.md` and the third-pass open list in `docs/adversarial-review-2026-11-12.md`. No push, merge, deployment or clinical activation. Engineering checks do not establish clinical readiness.

## What changed

- **Item 1, partial:** automatic binder rescue is suppressed when every change to RAAS/MRA therapy is a reduction or removal. An unchanged sibling no longer overrides that condition. Existing binder therapy, potassium alerts, penalties, safety floors and the ban on binder-enabled new classes remain. Dose-dependent RAAS potassium projection is still unresolved.
- **Item 3:** graded completeness uses the existing renal-capped target when renal labs are known. It respects per-dose versus daily caps: eplerenone 25 mg at its renal maximum and ramipril 2.5 mg twice daily at its 5 mg/day renal maximum now earn full credit. This is scoring policy, not evidence that efficacy equals an unrestricted target dose. Unknown renal inputs do not confer capped-target credit.
- **Item 4:** reductions select the nearest eligible lower total daily dose, including frequency changes. Furosemide 80 mg three times daily can step to 80 mg twice daily instead of jumping to 40 mg twice daily. All increase/reduction summaries include both source and destination frequency. Required safety reductions retain their existing constraints.
- **Item 5:** when every candidate falls below the potassium display floor and shares a potassium-raising drug removal, the alert names that removal and asks the clinician to review both constraints. No safety threshold is loosened.
- **Item 17, partial:** ten durable regression groups in `scripts/adversarialHandoffChecks.ts`, invoked by `verify`, cover this batch plus the prior ARB/angioedema allergy fix. Other third-pass test gaps remain.

## A regression caught and corrected during this batch

The fresh 15,000-patient sweep initially found three immediate loop-dose reversals (seeds 2026114061, 2026117128, 2026122319). A furosemide resistance switch landed on torsemide 100 mg twice daily; the next run preferred 100 mg once daily because both doses lie at/above the model's effect ceiling, leaving an adherence-score gain from the reduction despite unchanged congestion.

The engine now withholds an elective loop reduction during documented congestion when both its hemodynamic and CHF modeled effects are identical to the current dose. Equality of capped model outputs is not evidence of clinical dose equivalence. This is a narrow modeling policy: mandatory safety reductions, reductions after decongestion, and reductions with different modeled effects remain assessable. No numerical curve or clinical threshold changed. A dedicated regression covers congested, depleted and non-plateau cases, and the failed seed range was rerun.

## Evidence boundary

The [lisinopril DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=f2e09150-22f2-4028-b214-917d686200ad) was opened on 2026-11-12. Its ATLAS adverse-reaction table supports dose-related hyperkalemia risk; it does **not** establish a serum-potassium delta for each dose. A linear curve fitted to event percentages would invent clinical precision. The existing flat RAAS potassium model remains, including its residual hyperkalemia penalty after a reduction, pending a defensible modeling decision. This is why item 1 is only partially fixed.

The [ramipril DailyMed label](https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ef05b44e-4bf7-4afa-a5f6-06efa0d0abc3) was also opened. Existing renal caps were reused without changing their thresholds. The complete-vs-partial dose credit is an engine scoring choice, not a label efficacy claim.

## Validation and ranking review

The original checkout passed `npm run gate` before editing (371 verification checks; 1,032 golden runs; 5,000 seeded patients). The final full gate and production build both exited 0. Base commit: `9fba74d13915c57d66fc7938128e56627070db3f`; repairs remain uncommitted local work.

- `npm run gate`: typecheck passed; golden 1,032 runs byte-identical to the reviewed updated snapshot; audit:hundred 100/100; audit:mistakes 51/51; red-team critical/high/medium findings all zero; pricing 32 drugs × 3 profiles; gate sweep 5,000 patients, no violations.
- `npm run build`: passed. Nonblocking output: 852.84 kB JavaScript bundle warning; tooling also prints a Node module-registration deprecation warning. The known Entresto Medicare table-price note remains.
- Fresh sweep `npx tsx scripts/fuzzSweep.ts 15000 2026111204`: passed, no violations after the reversal repair. Together with the gate seed, 20,000 synthetic patients checked.
- Final scenario/invariant harness: 381 passed, zero failed, including ten new handoff regression groups.
- Ranking comparison against the original committed snapshot is retained in `ranking-diff.txt`: 16 of 1,032 top picks changed; eligibility and alerts were unchanged for those existing fixtures. Six changes concern renal-capped ramipril; six remove automatic binders beside reductions; two show binder-free reductions instead of retained-dose binder rescue; one retains the GLP-1 target and adds an MRA rather than considering a larger GLP-1 reduction; one is the deliberately changed Patiromer warning fixture. Two per-regimen warning differences also belong to that fixture. The diff command exits 1 for those expected warning differences. The snapshot was updated after this review; clinical validation of ranking remains open.
- `gate.log`, `build.log` and `fuzz-fresh.log` retain final command output.
- The Patiromer warning fixture now starts with Patiromer already on board. Its purpose is to verify spacing/GI warnings and magnesium monitoring regardless of ranking. Previously it relied on automatic binder rescue reaching the top three. This deliberate fixture change also accounts for its per-regimen warning differences in the ranking report.
- Existing heart-rate summary assertions were updated for both dose frequencies. The general next-step invariant now accepts a gentler daily-dose reduction and respects the plateau hold. Uncapped starting-dose anchor checks use known, uncapped renal inputs; renal-capped anchors have separate positive and missing-lab tests.

## Still open

Items 2, 6-16 remain open. Item 1's numerical potassium model and the remainder of item 17 remain open. MRA continuation thresholds are still the physician owner's decision; none changed here. The prior pass's browser/UI inspection gaps remain open; this batch changes engine output and its tests, with no new browser verification or deployment claim. Review changed rankings clinically before any release.
