# Guided entry view (2026-11-15)

Local and uncommitted, like the rest of the working tree. Interface change only: `services/`, `constants.ts`, `data/` and the rule set are untouched; `npm run golden` is byte-identical (1,032 runs).

## What was built
- **Guided view (default)** and the original layout as **Full form** (header switch; `?view=form` starts in it). Both edit the same patient, run and stale state in `App.tsx`.
- **Start:** six curated synthetic example cards (`components/guided/demoCases.ts`, facts read from the scenario patient). A card loads the scenario and runs the review once its pricing tier has loaded. "New patient" starts the steps with `blankPatient()`.
- **Steps:** seven clickable steps in a `<nav aria-label="Steps">` (`aria-current="step"`, a marker on steps with an input error or unfinished entry), Back / Next, focus to the step heading on change. Review lists what was entered, the blank core items (with the form's own hints), input errors with links to their step, and the run button behind the same validation gate.
- **Results:** `ResultsDisplay` full width under a patient bar (Edit inputs returns to Review; New patient returns to Start). Stale handling unchanged.
- **Shared field code:** `components/patient-form/usePatientFormModel.tsx` (state, derived fields, validation, hints, handlers, `FormSection`) is used by both `PatientForm` and `components/guided/StepsScreen.tsx`.
- Polish pass (same day): equal-height example cards, potassium shown as "Potassium 4.0", case label once in the guided results (`GuidedResults`, `showCaseLabel`), labelled aligned vitals row with capped menu/number widths (`.guided-fields`), sentence-case section headings and labels (shared), a single labelled step `<select>` below the `sm` breakpoint with a two-row header at 390 px, and a Review step that lists only entered values (plus rhythm and weights).
- Small fix: the results jump link reads "N other option(s)".

## Example cases (engine output)
See the report that accompanied this change; titles are in `demoCases.ts`.

## Verification
- `npm run gate` exit 0 (typecheck, golden 1,032 identical, 442 engine checks, 52 UI checks, audits, pricing, fuzz) and `npm run build` exit 0.
- Browser: `browser-checks.mjs` (26 checks (13 per width, 1440 and 390 px); receipt `browser-checks-receipt.json`, screenshots `1440-*.png` / `390-*.png`).

```bash
npx vite --port 5177 --strictPort                      # terminal 1
HF_BASE_URL=http://localhost:5177/ node docs/guided-entry-2026-11-15/browser-checks.mjs   # terminal 2
```
Needs Playwright at `/tmp/hf-ui-runner/node_modules/playwright/index.mjs` and Chrome for Testing under `~/Library/Caches/ms-playwright/chromium-1243/` (override with `HF_PLAYWRIGHT`, `HF_CHROME`). The script overwrites its receipt and screenshots.

## Not verified
- Keyboard: one Next transition by keyboard, focus placement and no overflow were checked; a full keyboard-only pass and a screen reader were not.
- Medication add flow and the History step's add controls were not exercised in the browser (rendered and unchanged).
- Browsers other than Chromium; clinical validation (unchanged by this work).
- An unfinished medication/history draft is dropped when switching between Guided and Full form.
