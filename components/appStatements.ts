import { BREASTFEEDING_NOT_ASSESSED } from '../services/engine/thresholds';
import { PROFILE_MULTIPLIERS, type WeightProfileName } from '../services/engine/scoreModel';

// The statements printed around the results (the research line, the scope statement) and the plain descriptions of the "What matters most" profiles. (Formerly named for the removed second ranking.)

/**
 * Shown in the app footer and the FAQ. Worded to match gates.ts: systolic BP below 90, potassium 6.5 or higher,
 * implausible values, unknown LVEF and SBP <= DBP return alerts with no ranking; other urgent findings (potassium
 * 6.0-6.4, low-output state, pregnancy) raise an alert and still list options.
 */
/** The one always-visible line at the top of every page (ruling U8a). */
export const RESEARCH_LINE = 'Research tool, not validated on patients, for expert review. Estimates are trial averages, not predictions for this patient.';

export const SCOPE_STATEMENT =
    'For outpatient heart-failure medication decisions. It does not manage emergencies or inpatient care. The most urgent findings (systolic BP below 90, potassium 6.5 or higher, third-degree AV block without a pacemaker, implausible values) produce alerts instead of a ranking; other urgent findings are flagged above the options. In a low-output or cold state (ejection fraction below 20 with two perfusion markers, or decompensation with signs of poor perfusion) the only drug starts or increases offered are a loop diuretic for recorded congestion and a replacement for a beta-blocker that must stop for a safety reason; lower doses and stops are still offered. At a potassium of 6.0 or above no option starts a drug or raises a dose, except a raise of a potassium binder the patient already takes. A patient with a condition the trials did not study (see the scope question: amyloidosis, hypertrophic or restrictive cardiomyopathy, severe valve disease, congenital heart disease, cardiotoxic cancer treatment, a transplant or assist device, dialysis) gets no ranked option. ' + BREASTFEEDING_NOT_ASSESSED;

// ---- "What matters most" profiles: plain description generated from the engine's multipliers (the engine's own description text predates the six-factor model) ----
const FACTOR_WORDS: Record<string, string> = { mortality: 'death', hf_hospitalization: 'heart-failure hospitalization', symptoms: 'symptoms', side_effects: 'side effects', cost: 'cost', adherence: 'dosing burden' };
const timesWords = (m: number): string => (m === 0.5 ? 'half as much' : m === 2 ? 'twice as much' : m === 3 ? 'three times as much' : `${m} times as much`);
export function profileDescription(name: WeightProfileName): string {
    const parts = Object.entries(PROFILE_MULTIPLIERS[name]).map(([k, m]) => `${FACTOR_WORDS[k] ?? k} counts ${timesWords(m as number)}`);
    return parts.length === 0
        ? 'Balances death, heart-failure hospitalization, symptoms, side effects, cost and dosing burden at the base weights.'
        : `Starts from the base weights; ${parts.join(' and ')}. The budget limit and every safety rule still apply separately.`;
}
