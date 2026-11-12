import type { RankingMode } from '../types';

/**
 * Clinician-facing names and help text for the ranking-mode control (owner decision 2026-11-11).
 * Display text only: the ordering itself lives in services/engine/selection.ts.
 */
export const RANKING_MODE_META: Record<RankingMode, { label: string; description: string }> = {
    balanced: {
        label: 'Balanced',
        description: 'Options are ordered by the overall score, which weighs outcomes, guideline therapy, cost and regimen burden.',
    },
    foundational_first: {
        label: 'Prioritize foundational therapy',
        description: 'For reduced ejection fraction: options that cover more of the four foundational therapies (RAAS inhibitor, beta-blocker, MRA, SGLT2 inhibitor) come first, unless the option would push blood pressure, heart rate or potassium into a severe range. The budget limit still applies. No effect in mildly reduced or preserved ejection fraction.',
    },
};

/** Display order (first is the default). */
export const RANKING_MODE_NAMES: readonly RankingMode[] = ['balanced', 'foundational_first'];

/** Reminder that this control is separate from "What matters most to this patient?". */
export const RANKING_MODE_VS_PRIORITY_NOTE =
    'This changes the order of options. "What matters most" above changes the score weights.';

/**
 * Shown in the app footer and the FAQ. Worded to match gates.ts: systolic BP below 90, potassium 6.5 or higher,
 * implausible values, unknown LVEF and SBP <= DBP return alerts with no ranking; other urgent findings (potassium
 * 6.0-6.4, low-output state, pregnancy) raise an alert and still list options.
 */
export const SCOPE_STATEMENT =
    'For outpatient heart-failure medication decisions. It does not manage emergencies or inpatient care. The most urgent findings (systolic BP below 90, potassium 6.5 or higher, implausible values) produce alerts instead of a ranking; other urgent findings are flagged above the options.';
