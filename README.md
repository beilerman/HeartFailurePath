<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# HeartFailurePATH

Clinical heart-failure regimen simulation and ranking UI built with React + Vite.

## Requirements

- Node.js `22+`
- npm `10+`

## Local Development

1. Install dependencies:
   `npm install`
2. Start dev server:
   `npm run dev`

## Visit Intensification Limit

- Default behavior: at most **2 new medication classes** are added per visit.
- Dose titration is unrestricted.
- Substitution within the same class group is unrestricted (for example ARNI/ACEi/ARB are treated as one RAAS group).
- Users can change this limit in the UI under **Social Determinants** with **Max New Classes Per Visit**.

## Quality Gates

- Type checks: `npm run typecheck`
- Build: `npm run build`
- Scenario verification: `npm run verify`
- Combined CI command: `npm run ci`

## CI

GitHub Actions runs the following on each push/PR:

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. `npm run verify`

## Secrets

Do not inject LLM/API secrets into the frontend bundle. Any Gemini key usage must stay server-side.
