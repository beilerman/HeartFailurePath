# Resolved adjunct table: plain-language notes (2026-11-15)

Companion to `resolved-adjunct.json` (60 rows, one per class, EF band, outcome; the vasodilator has two populations). Every number was re-fetched; see `verification-adjunct.md`. "Direct" = a randomized trial in that population; "pooled" = published or computed combination of such trials; "extrapolated" = nearest evidence carried over, reasoning in the row; "assumed" = rr 1.0 with a null interval.

## Class by class

**Vasodilator (hydralazine/isosorbide dinitrate)**
- Black patients, reduced: direct (A-HeFT). Death 0.57 (0.37-0.88), first HF hospitalization 0.67 (0.51-0.89). The intervals are mine, from event counts (32 vs 54 deaths; hospitalization counts derived from the published percentages). Stopped early, 2000s background therapy: solid but probably optimistic.
- Other patients, reduced: direct (H-HeFT, 2026, LVEF <=40%, mostly White). Death 0.72 (0.51-1.02), worsening-HF events 1.01 (0.68-1.50). Death was a secondary result and the primary composite was null; the two outcomes disagree and both are carried.
- Mildly reduced: extrapolated from reduced, both populations. Preserved: assumed (no randomized outcome trial found).

**If inhibitor (ivabradine).** Reduced: direct (SHIFT). HF admission 0.74 (0.66-0.83) quoted; death 0.90 (0.80-1.02) reconstructed from quoted counts and P (503 vs 552 deaths, P=0.092), not quoted. Mildly reduced: extrapolated (SHIFT was LVEF <=35%). Preserved: assumed (EDIFY measured surrogates only).

**sGC stimulator (vericiguat).** Reduced: pooled (VICTORIA + VICTOR). HF hospitalization 0.92 (0.84-1.00) from the Lancet IPD pool; death 0.90 (0.80-1.01) from a published 2-trial meta-analysis. Mildly reduced: extrapolated. Preserved: assumed (VITALITY tested symptoms).

**Inotrope (digoxin).** Reduced and mildly reduced: pooled, DIG + DECISION (DECISION is LVEF <=50%, so it informs both bands). Death 0.98 (0.91-1.06), HF hospitalization 0.72 (0.66-0.79). DIG carries about 90% of the weight and predates beta-blockers, MRAs and SGLT2 inhibitors; DECISION (contemporary background) is small. The outcome definitions differ (DIG: ever hospitalized; DECISION: total worsening-HF events incl. urgent visits). Mildly reduced is labelled extrapolated because no band split is published (DECISION says HFmrEF and HFrEF behaved alike). Preserved: direct, DIG ancillary only (death 0.99, 0.76-1.28; HF hospitalization 0.79, 0.59-1.04), 1990s data.

**IV iron (ferric carboxymaltose).** Reduced: pooled IPD of three trials. First HF hospitalization HR 0.83 (0.72-0.95); death HR 0.93 (0.78-1.10). The same paper's total HF hospitalizations are RR 0.84 (0.71-0.98). Mildly reduced and preserved: extrapolated (the pool includes some LVEF 41-49 patients but publishes no split; FAIR-HFpEF had 39 patients and no events).

**GLP-1 RA / GLP-1/GIP RA (semaglutide and tirzepatide, one shared row per cell).**
- Preserved: pooled across both drugs (published; SUMMIT + SELECT HFpEF subgroup). First HF hospitalization 0.52 (0.33-0.82); death 0.90 (0.67-1.22; inconclusive, about 170 deaths). Mildly reduced: the same numbers, extrapolated (no band-specific estimate; the semaglutide data explicitly cover "mildly reduced or preserved").
- Reduced: same drug, same band (SELECT): HF composite 0.79 (0.58-1.08), but that endpoint is CV death or HF hospitalization or urgent visit, not hospitalization alone. Death 0.81 (0.66-1.00) is for all SELECT patients with HF (31% HFrEF), extrapolated, because the HFrEF-specific death figure is not in any text I could reach.
- Contrary signal, kept for the owner: liraglutide in sicker, recently hospitalized HFrEF (FIGHT: HF rehospitalization 1.30, 0.89-1.88; death 1.10, 0.57-2.14; FIGHT + LIVE pooled HF hospitalization 1.38, 1.03-1.85).

**Loop diuretics, thiazide-like diuretics, K+ binders.** All assumed neutral (1.0, null interval), all bands, both outcomes. The evidence the owner will be asked to rule on is quoted in each row's `notes`: Cochrane (death OR 0.24, 0.07-0.83; HF admission OR 0.07, 0.01-0.52; 14 trials, 525 participants, 3 and 2 placebo trials of 202 and 169 patients), TRANSFORM-HF (death 1.02, 0.89-1.18), DOSE and SUBCUT-HF II (strategy trials, not drug vs none), CLOROTIC (no mortality or rehospitalization difference; no numbers published in the abstracts), DIAMOND (primary endpoint changed to potassium; no event HR; indirect benefit via MRA dose) and REALIZE-K (CV death or worsening HF 11 vs 3 with SZC, exploratory, a safety signal).

## Weakest cells
1. GLP-1 reduced EF, both outcomes: direction depends on a ruling. SELECT subgroup says benefit; the only dedicated HFrEF trials (liraglutide) say harm or nothing. The HF composite is not an HF-hospitalization estimate, and the death figure is not HFrEF-specific.
2. GLP-1 death, preserved and mildly reduced: two trials, opposite directions, about 170 deaths.
3. Vasodilator, Black patients, mildly reduced, and the "other" death/HF-event pair that disagree.
4. IV iron preserved and mildly reduced (no event trial in preserved EF).
5. All neutral classes: neutral is a decision, not a finding; the Cochrane ORs are the alternative.
6. Ivabradine death: reconstructed, not quoted.

## Where I differ from the first researcher
- Semaglutide/tirzepatide shared row, per the owner's ruling: preserved and mildly reduced use the published cross-drug pool (HF hospitalization 0.52, death 0.90), not 0.59/0.83 for semaglutide and 0.54/1.25 for tirzepatide. Reduced uses SELECT (0.79 and 0.81), not FIGHT (1.30 and 1.10), flipping the direction of the HF-hospitalization cell.
- Digoxin: DECISION covers reduced as well as mildly reduced, so both bands use a DIG + DECISION pool instead of DIG alone (reduced) and DECISION alone (mildly reduced). DECISION's abstract figure 0.93 (0.69-1.26) is CV death; all-cause death (0.93, 0.72-1.19) comes from its full text.
- A-HeFT now has intervals; ivabradine death now has a stated derivation; the Cochrane note should read 14 trials (525 participants, 7 placebo-controlled), not "7 small trials".
- I carry the first researcher's mild-band extrapolations unchanged (interval not widened) because nothing in the sources says by how much to widen; they are labelled `extrapolated` so the engine can treat them separately.
