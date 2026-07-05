# CHF First-Principles Analysis

Date: 2026-02-21  
Status: Updated to current engine behavior

## Objective

Define the foundational reasoning model that HeartFailurePath should follow independent of UI or implementation details.

## Core Principles

1. Safety before optimization.
2. Preserve perfusion and avoid iatrogenic collapse.
3. Prioritize broad guideline-concordant class coverage over single-drug maximization.
4. Separate physiologic benefit from affordability and adherence burden.
5. Encode contraindications as structural exclusions, not soft suggestions.
6. Provide explicit monitoring plans when risk is increased by therapy changes.

## Operational Translation in Current Code

### Principle 1: Safety-first gating

- Input hard stop if SBP <= DBP.
- Clinical hard gate when SBP < 90 (alerts only, no regimen display).
- Projected severe hypotension/hyperkalemia filtered from display.

### Principle 2: Stabilize unstable states

- Low-output and advanced-HF alerts are surfaced before optimization framing.
- Acute decompensation blocks beta-blocker initiation.
- Existing beta-blockers are down-titrated instead of abruptly removed.

### Principle 3: Guideline class completeness

- HFrEF pathway rewards presence of RAAS + BB + MRA + SGLT2i.
- HFmrEF/HFpEF are scored with phenotype-adjusted expectations.
- HFimpEF preservation avoids premature withdrawal of disease-modifying classes.

### Principle 4: Multi-domain tradeoff visibility

Overall ranking includes:

- clinical status domains (neurohormonal, functional, volume, structure)
- patient burden domains (cost, adherence)
- evidence/guideline domain (concordance)

This prevents one-dimensional optimization.

### Principle 5: Contraindication integrity

- contraindicated formulary options are excluded pre-simulation
- contraindicated current therapies are forced toward safe transition paths
- dual RAAS and dual MRA combinations are blocked

### Principle 6: Monitoring as part of recommendation

- RAAS/MRA intensification triggers early/repeat BMP checks
- diuretic intensification triggers daily weight and chemistry follow-up
- SGLT2i pathways include renal/volume follow-up prompts

## Furoscix in First-Principles Terms

Furoscix is treated as a congestion-escalation tool, not a routine baseline loop replacement.

- must have meaningful congestion/escalation context
- must pass allergy/material and renal safety checks
- carries mandatory operational safety warning when selected

## Current Boundaries

The model is deterministic and reproducible, but remains a simulation:

- no direct causal prediction of outcomes for an individual patient
- no substitute for bedside reassessment, diagnostics, and local protocols
- no standalone authority for prescribing

## Practical Use Standard

Use the engine to:

- structure medication optimization conversations
- identify exclusions and risk interactions quickly
- generate monitoring-aware candidate regimens

Do not use the engine as the sole source of clinical truth.
