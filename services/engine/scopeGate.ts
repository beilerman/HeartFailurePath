/**
 * SCOPE GATE (POLICY, ruling U8b, 2026-11-19; not a clinical rule from a guideline, not a ranking factor).
 *
 * The tool's estimates are trial averages from trials of heart failure with reduced, mildly reduced or preserved ejection fraction. Some patients were excluded from those trials or were
 * never studied in them, and the tool has no input that could take such a condition into account. A clinician is asked once, before results, whether any of the conditions below is
 * present. If one is ticked the tool shows NO ranked option (an alert names the condition and says why); alerts about the current regimen still apply. If the question is left
 * unanswered the results are shown with a visible line that scope was not confirmed. "None of these" is an answer.
 *
 * The conditions and the basis of each. Basis = the usual exclusion criteria of the pivotal trials in the evidence tables (data/outcomeEvidence.json: PARADIGM-HF, DAPA-HF, DELIVER,
 * EMPEROR-Reduced, EMPEROR-Preserved, PARAGON-HF, TOPCAT, FINEARTS-HF, VICTORIA, SOLOIST-WHF). The registered eligibility text of DAPA-HF (NCT03036124), EMPEROR-Reduced (NCT03057977),
 * EMPEROR-Preserved (NCT03057951), DELIVER (NCT03619213), PARADIGM-HF (NCT01035255) and PARAGON-HF (NCT01920711) was read on ClinicalTrials.gov on 2026-11-20. What that text states:
 *   - cardiac amyloidosis: not named in the registered eligibility text of those six trials; the trials enrolled heart failure of the usual causes. NOT STUDIED, not "excluded by name".
 *   - hypertrophic or restrictive cardiomyopathy: DAPA-HF excluded heart failure due to restrictive or hypertrophic (obstructive) cardiomyopathy; the others do not name them. Not studied.
 *   - severe valve disease awaiting intervention: DAPA-HF excluded uncorrected primary valvular disease and valve repair or replacement within 12 weeks or planned; DELIVER excluded valve
 *     repair or replacement within 12 weeks. The others do not name it.
 *   - heart failure from congenital heart disease: not named in the registered text of those six trials. NOT STUDIED.
 *   - active cancer treatment with a cardiotoxic drug: not named in the registered text of those six trials. NOT STUDIED; cardiotoxic cardiomyopathy has its own evidence and its own
 *     treatment decisions.
 *   - heart transplant or ventricular assist device: DAPA-HF excluded previous cardiac transplantation or a ventricular assist device; EMPEROR-Reduced and -Preserved excluded a heart
 *     transplant recipient or a patient listed for transplant.
 *   - dialysis: EMPEROR-Reduced and -Preserved excluded a patient requiring dialysis (and eGFR below 20); DAPA-HF eGFR below 30; DELIVER eGFR below 25; PARADIGM-HF eGFR below 30.
 * The per-trial text for the remaining trials (TOPCAT, FINEARTS-HF, VICTORIA, SOLOIST-WHF) was not re-read for this rule. The expert panel is asked to confirm the list.
 */
import type { Patient } from '../../types';
import { hasAtrialFibrillationHistory } from '../clinicalPredicates';
import { AF_RESTING_RATE_LENIENT_TARGET } from './thresholds';

export interface ScopeCondition { id: string; label: string }
/** The question put to the clinician, and its seven conditions, in the order shown. */
export const SCOPE_QUESTION = 'Is any of these present?';
export const SCOPE_CONDITIONS: readonly ScopeCondition[] = [
    { id: 'amyloidosis', label: 'Cardiac amyloidosis' },
    { id: 'hcm_rcm', label: 'Hypertrophic or restrictive cardiomyopathy' },
    { id: 'valve', label: 'Severe aortic stenosis or other severe valve disease awaiting intervention' },
    { id: 'congenital', label: 'Heart failure from congenital heart disease' },
    { id: 'cancer_drug', label: 'Active cancer treatment with a cardiotoxic drug' },
    { id: 'transplant_lvad', label: 'Heart transplant or ventricular assist device' },
    { id: 'dialysis', label: 'Dialysis' },
];
export const SCOPE_NONE_LABEL = 'None of these';

export type ScopeState = 'confirmed_none' | 'not_confirmed' | 'outside';
export interface ScopeStatus { state: ScopeState; conditions: string[]; text: string }

export const SCOPE_NOT_CONFIRMED_TEXT = 'Scope was not confirmed: the question about conditions the tool does not cover (amyloidosis, hypertrophic or restrictive cardiomyopathy, severe valve disease, congenital heart disease, cardiotoxic cancer treatment, heart transplant or assist device, dialysis) was not answered.';
export const SCOPE_HEAD = "OUTSIDE THE TOOL'S SCOPE";

const scopeLabels = new Map(SCOPE_CONDITIONS.flatMap(c => [[c.id, c.label], [c.label.toLowerCase(), c.label]] as const));
const scopeLabel = (value: unknown) => typeof value === 'string' ? scopeLabels.get(value.trim().toLowerCase()) : undefined;
const list = (xs: string[]): string => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** Recognized conditions in question order. The input contract separately rejects unknown entries. */
export function scopeConditionsPresent(p: Pick<Patient, 'scope_conditions'> | undefined): string[] {
    const set = p?.scope_conditions;
    if (!(set instanceof Set)) return [];
    const selected = new Set([...set].map(scopeLabel));
    return SCOPE_CONDITIONS.filter(c => selected.has(c.label)).map(c => c.label);
}

/** The alert for a ticked condition: names it, says the trials did not study it and that the tool's estimates would not be reliable, and that regimen alerts still apply. The atrial fibrillation sentence is added only when that alert is shown (the patient has atrial fibrillation or a history of it). */
export function scopeAlertText(present: string[], atrialFibrillationShown = false): string {
    const one = present.length === 1;
    return `${SCOPE_HEAD}: ${list(present.map((l, i) => (i === 0 ? l : lower(l))))} ${one ? 'is' : 'are'} recorded. The trials behind this tool did not study ${one ? 'it' : 'them'}, and the tool has no way to take ${one ? 'it' : 'them'} into account, so the tool's estimates would not be reliable for this patient and no regimen change is shown. Alerts about the current regimen still apply and are shown. Prompts that propose therapy or assess whether a therapy is indicated (indicated therapy that is missing, eligibility for other drugs, device screening, cardiac rehabilitation, advanced-therapy evaluation) are not shown, because this condition is outside the tool's scope. ${atrialFibrillationShown ? `The atrial fibrillation alert is still shown, limited to anticoagulation and, when the recorded resting heart rate is above ${AF_RESTING_RATE_LENIENT_TARGET} bpm, a statement that rate control needs assessment.` : ''}`.trimEnd();
}

/** The atrial fibrillation alert is raised for atrial fibrillation or a history of it; an unreadable patient has none. */
const atrialFibrillationShownFor = (p: Patient | undefined): boolean => { try { return !!p && hasAtrialFibrillationHistory(p); } catch { return false; } };

export function scopeStatusFor(p: Patient | undefined): ScopeStatus {
    const set = p?.scope_conditions;
    if (!(set instanceof Set) && set !== undefined) return { state: 'not_confirmed', conditions: [], text: SCOPE_NOT_CONFIRMED_TEXT };
    const present = scopeConditionsPresent(p);
    if (present.length > 0) return { state: 'outside', conditions: present, text: scopeAlertText(present, atrialFibrillationShownFor(p)) };
    if (set === undefined || set.size > 0) return { state: 'not_confirmed', conditions: [], text: SCOPE_NOT_CONFIRMED_TEXT };
    return { state: 'confirmed_none', conditions: [], text: '' };
}

/** Accept a registered condition ID or label. */
export const isScopeLabel = (s: string): boolean => scopeLabel(s) !== undefined;

/**
 * With a scope condition ticked the tool has said it cannot judge therapy for this patient (W5). These alert headings propose therapy or assess indication and are not shown; the scope
 * alert, the urgent alerts and every alert about the current regimen (interactions, potassium, kidney, heart rate, duplicates, drugs to avoid) are. One sentence of the scope alert says
 * that these prompts are not shown and why.
 */
export const SCOPE_HIDDEN_ALERT_HEADS: readonly string[] = [
    'ADVANCED HEART FAILURE ALERT', 'DEVICE THERAPY SCREENING', 'CARDIAC REHABILITATION', 'VERICIGUAT ELIGIBILITY WARNING', 'HFimpEF STATUS UNKNOWN',
    'BETA-BLOCKER START DEFERRED', 'LABS REQUIRED', 'DATA NOTE', 'DATA REQUIRED', 'PARTIAL REVIEW', 'DOSE TIMING REVIEW', 'SYMPTOMS AT REST WITHOUT RECORDED CONGESTION',
];
