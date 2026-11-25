# Harm evidence folder, 2026-11-15

Working files for the side-effect table (`data/harmEvidence.json`, scale and rulings in `data/harmDefinitions.json`).

**Which files are current.** `merge_harm.py` and `data/harmEvidence.json` are current. The two `notes-resolved-*.md` files (and `resolved-*.json`) describe the tables as they stood before the merge rulings R7 to R9 (sibling classes before an upper bound; a step-4 figure below the heart-failure dose range does not qualify; every upper bound is recomputed as the largest placebo-controlled excess of that harm in the merged table) and before the controller's eplerenone correction. They are history, not the table. Examples of what changed after them: loop hypokalemia is now a sibling-proxy row (6.2 a year, the thiazide-like figure) instead of 0; the ARB syncope and eplerenone gynecomastia rows are no longer upper bounds. The upper-bound rows in `data/harmEvidence.json` are those with `upper_bound: true` (10 at the final pass 2026-11-16; listed in `docs/first-principles-model-2026-11-16/README.md`, section 10, item 4).

When a note here disagrees with `data/harmEvidence.json`, the data file is right.
