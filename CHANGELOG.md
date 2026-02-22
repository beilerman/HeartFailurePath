# Changelog

All notable documentation changes are recorded here.

## 2026-02-22 - Documentation refresh

### Added

- Comprehensive product and safety documentation in `README.md`.
- Current developer implementation guide in `CLAUDE.md`.
- In-app clinical logic documentation rewrite in `components/FAQ.tsx`.
- Updated analysis references:
  - `../model-analysis.md`
  - `../guideline-analysis.md`
  - `../CHF-FIRST-PRINCIPLES-ANALYSIS.md`

### Updated

- Documentation now reflects current engine behavior:
  - seven-domain weighted scoring
  - hemodynamic and display safety gates
  - pregnancy and contraindication handling
  - monitoring-plan generation logic
  - Furoscix eligibility, contraindications, and mandatory safety warnings
- Verification references updated to 71-scenario regression harness (`npm run verify`).

### Validation

- `npm run ci` passed after documentation updates (typecheck, build, verify).
