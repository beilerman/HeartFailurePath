# Guideline Alignment Analysis for HeartFailurePath

Last updated: 2026-02-21  
Scope: summarize how current implementation aligns with modern HF guideline principles and where it intentionally simplifies.

This is a code-informed implementation analysis, not a new clinical guideline.

## 1. Guideline Intent Represented in the Engine

The current engine reflects major contemporary themes:

- early multi-pillar GDMT adoption for reduced-EF phenotypes
- phenotype-aware treatment differentiation across EF spectrum
- safety-first gating for hypotension, hyperkalemia, and contraindications
- staged escalation with monitoring requirements
- avoidance of harmful or duplicative class combinations

## 2. Phenotype-Specific Logic

### HFrEF (`LVEF <= 40`)

Implemented as quad-pillar logic:

- RAAS (ARNI/ACEi/ARB)
- beta blocker
- MRA/nsMRA grouping
- SGLT2i

Guideline-concordance scoring rewards:

- pillar presence
- target-dose achievement

### HFmrEF (`LVEF 41-49`)

Implemented as weighted intermediate pathway:

- stronger points for RAAS and SGLT2i
- lower weight for BB and MRA relative to HFrEF
- volume-management contribution

### HFpEF (`LVEF >= 50`)

Implemented as SGLT2i-first framework with adjunct options:

- SGLT2i primary scoring contribution
- volume-management reward
- adjunct MRA/nsMRA logic
- obesity phenotype pathway allows GLP-1 class consideration

### HFimpEF Preservation

When prior reduced EF is known (or strongly suspected), logic preserves reduced-EF pillar expectations rather than downgrading to HFpEF behavior.

## 3. Safety-Gate Alignment

### Hemodynamic protection

- `SBP < 90` blocks regimen output and returns alerts only.
- projected severe hypotension is filtered before display.

Rationale: preserve perfusion before oral intensification.

### Electrolyte/renal protection

- projected severe hyperkalemia filtered from displayed options
- potassium-aware binder rescue logic
- CKD-focused alerting and monitoring prompts

### Contraindication handling

- class and medication contraindications are exclusion-driven
- current contraindicated medications are forced toward removal/down-titration/safe swap paths

### Combination safety

- dual RAAS combinations blocked
- dual MRA combinations blocked

### Pregnancy safety

Implementation excludes classes considered unsafe or insufficiently supported in pregnancy in this model context.

## 4. Acute Decompensation and Low Output

Current logic explicitly addresses decompensated risk states:

- blocks beta-blocker initiation in acute decompensation
- avoids abrupt beta-blocker withdrawal by preferring down-titration behavior
- emits low-output and advanced-HF referral alerts for escalation contexts

This is consistent with conservative bedside safety behavior.

## 5. Adjunct and Specialized Pathways

Adjunct logic in implementation includes:

- Ivabradine eligibility constraints
- Vericiguat eligibility + unknown-worsening warning logic
- Hydralazine/isosorbide pathways for selected contexts
- IV iron rescue for iron-deficiency states
- DIAMOND-like potassium binder support when MRA initiation risk is elevated
- GLP-1 eligibility for obesity phenotype with EF restrictions

## 6. Furoscix Clinical Modeling Position

Furoscix is implemented as a loop diuretic pathway for persistent congestion and escalation contexts.

Current safeguards:

- explicit contraindication checks (clinical context + hypersensitivity + severe renal constraints)
- mandatory device-use warning in selected regimens
- hypoxemia triage warning to prompt urgent in-person evaluation context

This represents operational safety framing rather than universal recommendation.

## 7. Where the Model Simplifies

Current engine intentionally simplifies several real-world factors:

- no individualized pharmacogenomic response modeling
- no direct hospitalization-event simulator
- no dynamic longitudinal titration calendar
- no EHR-native lab trend ingestion

These simplifications are expected for deterministic CDS prototyping.

## 8. Validation Posture

Safety and behavior are regression-tested with:

- 71 scenario fixtures
- invariant assertions for safety boundaries and regimen structure
- CI gating on typecheck/build/verification

This supports implementation stability but is not equivalent to prospective clinical outcomes validation.

## 9. Practical Interpretation

The codebase is broadly aligned with contemporary HF treatment principles at class and safety-logic level, with conservative guardrails around unstable physiology.

It should be interpreted as a clinician-support simulation framework:

- useful for structured regimen exploration
- useful for surfacing contraindications and monitoring needs
- not sufficient alone for independent clinical deployment without formal validation, governance, and regulatory review
