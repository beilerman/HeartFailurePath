/**
 * Alerts on the paths that end before a regimen is generated (the input-error stop, the implausible-value stop and the limited-information review).
 * Ruling U3 (2026-11-19): every alert the full path raises from ENTERED values alone is raised here too, by the same builders, so a blank or mistyped value
 * can narrow what is offered but never hides an alert the other values justify. The audit that produced this list is in the round 3 fix record
 * (`readiness/fix-r3/`): the full path's alert builders are `raiseClinicalAlerts` and `detectInappropriateRegimen` (gates.ts); `knownUrgentFindings`
 * (decisionReadiness.ts) and `enteredUrgentStateAlerts` (urgentStates.ts) already covered pressure, potassium, oxygen, the unstable states, heart block,
 * slow rate and scale disagreement; this module adds everything else that does not depend on a candidate regimen, an eligibility result or a score.
 */
import type { Patient } from '../../types';
import { enteredValues, enteredUrgentStateAlerts, lowPotassiumAlerts, elevatedPotassiumNoRaiserAlerts } from './urgentStates';
import { auditCriticalData, raiseClinicalAlerts, detectInappropriateRegimen, duplicateEntryAlert, withoutImplausibleValues } from './gates';
import { knownUrgentFindings } from './decisionReadiness';
import { dedupeCurrentRegimen } from './regimenUtils';
import { ADVISORY_ALERT_HEADS, NO_OPTION_SENTENCE } from './whyFirst';
import { scopeStatusFor } from './scopeGate';
import { expandAllergies } from './allergy';
import { MEDICATION_FORMULARY } from '../../constants';

const headOf = (a: string): string => { const i = a.indexOf(': '); return i > 0 ? a.slice(0, i) : a.slice(0, 40); };

/** Sentences that describe "the plan" or "the options": on a stop path no option exists, so each is reworded to an instruction to the clinician. Order matters not; each phrase is exact. */
const STOP_PATH_WORDING: ReadonlyArray<readonly [string, string]> = [
    ['The dose is already the lowest, so the plan withholds it (', 'The dose is already the lowest, so it should be withheld ('],
    ['The plan reduces it one dose step; it is not removed. ', 'Reduce it by one dose step; do not remove it. '],
    [' is removed in the options because of ', ' would be removed because of '],
    ['The tool removes them from the plan and does not start a new one. ', 'No drug is started today. '],
    ['No option is shown, so none is started. ', 'No drug is started today. '],
    ['No option is changed by this prompt', 'Nothing is changed by this prompt'],
    ['The formulary nitrate has been removed from all recommendations; ', 'The formulary nitrate is not used with it; '],
    ['Recommendations preserve quad GDMT while prior records are clarified.', 'Existing quadruple therapy is not reduced while prior records are clarified.'],
    ['These agents have been excluded from all recommendations.', 'These agents are not used.'],
    // Guideline wording that is not about the tool's own output: the same sentences without the word (a screen without options says nothing about recommendations).
    ['ESC Recommendation Table', 'ESC guideline Table'],
    ['CRT recommendations assume sinus rhythm', 'The CRT criteria assume sinus rhythm'],
    [' not recommended', ' not advised'],
    [' is generally recommended', ' is generally advised'],
    ['Each is reduced one dose step (a drug already at the lowest dose is kept, not increased), recheck', 'Reduce each one dose step (a drug already at the lowest dose is kept, not increased), recheck'],
    ['so no beta-blocker is started in any option', 'so no beta-blocker would be started today'],
    ['; a switch is offered. ', '. '],
    // R8 X15h: the duplicate-therapy alert's pointer to the options' change lines, on a screen with no option.
    [' What each option does with each drug is on its change lines.', ''],
    // R7 W13a: the allergy note's angioedema sentence on a screen that proposes nothing.
    ['are not offered or continued, and an angiotensin receptor blocker stays available with a caution', 'should not be started or continued, and an angiotensin receptor blocker would need a caution if one is used'],
    // R7 W7: nothing is started on a stop path, so the perfusion alert's "before starting or raising a drug" is dropped.
    ['Assess perfusion before starting or raising a drug.', 'Assess perfusion now.'],
];
/**
 * One alert per finding (R5 Y7): the focused findings and the full path's builders can each raise the same state in a short and a long wording; the long one is kept, at the place of the first.
 * Only headings that are about ONE finding per screen are listed; headings about different drugs or values (several removed drugs, several duplicates) are never merged.
 */
const ONE_PER_SCREEN: readonly string[] = ['HEMODYNAMIC INSTABILITY', 'HYPERKALEMIC EMERGENCY', 'HYPOXIA ALERT'];
export function onePerFinding(alerts: string[]): string[] {
    const keep = new Map<string, string>();
    for (const a of alerts) { const h = headOf(a); if (ONE_PER_SCREEN.includes(h) && (!keep.has(h) || a.length > keep.get(h)!.length)) keep.set(h, a); }
    const placed = new Set<string>();
    return alerts.flatMap(a => { const h = headOf(a); if (!ONE_PER_SCREEN.includes(h)) return [a]; if (placed.has(h)) return []; placed.add(h); return [keep.get(h)!]; });
}

/** The same for sentences whose wording carries a drug name. */
const STOP_PATH_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/The options keep (.+?) and remove (.+?) because/g, 'The tool would keep $1 and remove $2 because'],
    // R6 V5: the rate-control paragraph names drugs to start (a beta-blocker, digoxin); where no medication change is proposed it is not shown (the anticoagulation sentence stays).
    [/(ATRIAL FIBRILLATION: [\s\S]*?)\s*Rate control: a beta-blocker is first line[\s\S]*$/, '$1'],
    // R6 V5: the congestion-without-weight-gain alert keeps its finding and the instruction to check the dry weight; what the tool offers is not said where it offers nothing.
    [/ ?The tool does not offer a new loop diuretic unless the weight is more than [0-9.]+ kg above the dry weight\./, ''],
];
export const forStopPath = (a: string): string => STOP_PATH_PATTERNS.reduce((t, [re, to]) => t.replace(re, to), STOP_PATH_WORDING.reduce((t, [from, to]) => t.split(from).join(to), a));

/** Advisory prompts (device, rehabilitation, data notes, vericiguat documentation) are not urgent states and are not added to a stop path. The two prompts that read the entered class against the findings are state alerts and are. */
const STATE_PROMPTS = ['NYHA CLASS AND FINDINGS DISAGREE', 'SYMPTOMS AT REST WITHOUT RECORDED CONGESTION'];
const isUrgent = (a: string): boolean => STATE_PROMPTS.includes(headOf(a)) || !ADVISORY_ALERT_HEADS.includes(headOf(a));
/**
 * On the limited-information review only: the two alerts that review already raises under its own heading and that really are on that screen (MEDICATION RECONCILIATION for a repeated
 * class, CONTRAINDICATED COMBINATION for a nitrate with a PDE5 inhibitor). Every other path has no such alert, so nothing is dropped there (W3).
 */
const RAISED_BY_LIMITED_REVIEW = (a: string): boolean => a.startsWith('INAPPROPRIATE REGIMEN: Patient is on') || a.startsWith('INAPPROPRIATE THERAPY: Nitrate');

/**
 * Every urgent alert the full path raises from the entered values, for a stop path, by the same builders. A value that the implausible-value rules flag is read as "not entered"
 * (it is a probable typing error, not a measurement): an alert whose inputs include it is not raised, every other urgent alert still is (W3).
 */
export function enteredValueAlerts(p: Patient, opts: { limitedReview?: boolean } = {}): string[] {
    if (!p || typeof p !== 'object') return [];
    const out: string[] = [];
    try {
        const q = withoutImplausibleValues(enteredValues(p));
        const raised: string[] = [];
        try { raiseClinicalAlerts(q, auditCriticalData(q), raised); } catch { /* an unreadable entered value is not evidence */ }
        try { raised.push(...detectInappropriateRegimen(q)); } catch { /* same */ }
        raised.push(...lowPotassiumAlerts(q));
        raised.push(...elevatedPotassiumNoRaiserAlerts(q));
        // The same drug entered twice (the full path resolves it before anything else is read).
        const resolved = dedupeCurrentRegimen(Array.isArray(p.current_regimen) ? p.current_regimen.filter(r => r && r.med) : []);
        if (resolved.duplicateNames.length > 0) raised.push(duplicateEntryAlert(resolved));
        for (const a of raised) {
            if (!isUrgent(a) || (opts.limitedReview && RAISED_BY_LIMITED_REVIEW(a))) continue;
            out.push(forStopPath(a));
        }
    } catch { return []; }
    return out;
}

/** The focused findings (systolic pressure, potassium, oxygen saturation), each read from a value that is not a probable typing error. */
export function focusedFindings(p: Patient): string[] {
    try { return knownUrgentFindings(withoutImplausibleValues(enteredValues(p))); } catch { return []; }
}

/** The urgent-state alerts of a stop path in one call: scope, the focused findings, the unstable states and conduction, then the rest of what the full path raises from entered values; no alert twice. */
export function allEnteredUrgentAlerts(p: Patient, opts: { limitedReview?: boolean } = {}): string[] {
    const seen = new Set<string>();
    const scope = scopeStatusFor(p);
    // The unstable-state builders read the entered values too: a typing error is blanked for them as well.
    const clean = p && typeof p === 'object' ? withoutImplausibleValues(enteredValues(p)) : p;
    return onePerFinding([...(scope.state === 'outside' ? [scope.text] : []), ...focusedFindings(p), ...enteredUrgentStateAlerts(clean), ...enteredValueAlerts(p, opts)]).filter(a => { if (seen.has(a)) return false; seen.add(a); return true; });
}

/** The readiness text for an output with no medication change: what can be reviewed says so, in place of the text written before it was known that no option exists (R6 V5). */
export function noMedicationChangeReadiness(dr: import('../../types').DecisionReadiness): import('../../types').DecisionReadiness {
    if (dr.mode === 'limited_review') return dr;
    return { ...dr, available: [`${NO_OPTION_SENTENCE} These checks are not a complete assessment of the patient.`] };
}

/** An alert that a monitoring row points at ("see the low blood pressure alert") and the alert heading that must be on the screen for the row to say so. */
const MONITORING_REFERENCES: ReadonlyArray<readonly [RegExp, RegExp]> = [
    [/\(see the hypoxia alert\)/, /^HYPOXIA ALERT/],
    [/\(see the low blood pressure alert\)/, /^HEMODYNAMIC INSTABILITY/],
    [/\(see the heart block alert\)/, /^(THIRD|SECOND)-DEGREE AV BLOCK/],
    [/\(see the potassium emergency alert\)/, /^HYPERKALEMIC EMERGENCY/],
];
/** Monitoring rows whose "see the ... alert" points at an alert that is not on the screen are not shown (the row's finding is the alert's, and without the alert it is not established). */
export function monitoringWithoutMissingAlertReferences<T extends { details: string }>(plan: T[], alerts: string[]): T[] {
    return plan.filter(item => MONITORING_REFERENCES.every(([phrase, head]) => !phrase.test(item.details) || alerts.some(a => head.test(a))));
}

/**
 * R7 W13a: the allergy notes (what a typed entry was read as, or that it matched nothing) on a screen that proposes nothing. The input-error, limited-review, implausible-value and partial-review
 * paths end before the allergy step of the full path, so a typed "angioedema" or an unmatched entry got no reply. Worded for a screen with no options. A note already present is not repeated.
 */
export function missingAllergyNotes(patient: Patient | undefined, alerts: readonly string[]): string[] {
    const set = patient?.allergies;
    if (!(set instanceof Set) || set.size === 0) return [];
    const a = expandAllergies(set, MEDICATION_FORMULARY);
    const noted = (entry: string) => alerts.some(x => x.startsWith('ALLERGY NOTE') && x.includes(entry));
    const out: string[] = [];
    for (const r of a.readAs) if (!noted(`"${r.entry}"`)) out.push(`ALLERGY NOTE: "${r.entry}" ${r.text.replace('are not offered or continued', 'should not be started or continued').replace('stays available with a caution', 'would need a caution if one is used')}.`);
    const unmatched = a.unmatched.filter(e => !noted(e));
    if (unmatched.length > 0) out.push(`ALLERGY NOTE: ${unmatched.map(e => `"${e}"`).join(', ')} ${unmatched.length > 1 ? 'do' : 'does'} not match a drug or drug class in this tool, so no drug is excluded for ${unmatched.length > 1 ? 'them' : 'it'}. If it is one of the tool's medications, enter its generic or brand name.`);
    return out;
}

/**
 * R8 X11d: a patient who takes a drug that the allergy list names always gets the ALLERGY CONFLICT alert, on every path (full review, every stop screen, limited review). The same sentence
 * the limited review has always used; an alert already on the screen is not repeated.
 */
export function allergyConflictAlerts(patient: Patient | undefined, alerts: readonly string[]): string[] {
    const set = patient?.allergies;
    if (!(set instanceof Set) || set.size === 0 || !Array.isArray(patient?.current_regimen)) return [];
    const expanded = expandAllergies(set, MEDICATION_FORMULARY).expanded;
    const out: string[] = [];
    for (const r of [...patient!.current_regimen].sort((a, b) => (a.med.name < b.med.name ? -1 : 1))) {
        if (!expanded.has(r.med.name)) continue;
        if (alerts.some(a => a.startsWith(`ALLERGY CONFLICT: ${r.med.name} `))) continue;
        out.push(`ALLERGY CONFLICT: ${r.med.name} is both current and matched to a documented allergy. Reconcile the allergy and exposure before administration; assess any current reaction promptly.`);
    }
    return out;
}
