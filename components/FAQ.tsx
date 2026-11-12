import React, { useEffect, useRef, useState } from 'react';
import {
    DOMAIN_GROUPS, DOMAIN_LABELS, WEIGHT_PROFILES, WEIGHT_PROFILE_META, DEFAULT_WEIGHT_PROFILE, SCORE_ADJUSTMENTS, DOMAIN_KEYS,
    type ScoreDomainKey,
} from '../services/engine/scoreModel';
import { ELIGIBILITY_RULES } from '../services/engine/eligibility';
import { VOLUME_SCORING, STRUCTURE_BLEND_WEIGHTS, DISPLAY_FLOORS, DOMAIN_GOALS, BNP_SCORE_TARGET, BNP_SCORE_CRITICAL } from '../services/simulationService';
import { TIE_RULE_TEXT, goalAfterEquals } from './scoreExplain';
import { RANKING_MODE_META, SCOPE_STATEMENT } from './rankingModeMeta';
import { QuestionMarkCircleIcon, LightBulbIcon, CalculationIcon, HeartIcon } from './icons';
import { EVIDENCE_MATRIX, ALL_EVIDENCE_ROWS, rowMatches } from './evidenceMatrix';
import { Disclosure } from './Disclosure';

// Render any web address in the matrix text as a link that opens in a new tab.
const linkify = (text: string): React.ReactNode[] =>
    text.split(/(https?:\/\/[^\s)]+)/g).map((part, i) =>
        /^https?:\/\//.test(part)
            ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline">{part}</a>
            : <React.Fragment key={i}>{part}</React.Fragment>);

const EvidenceMatrixSection: React.FC<{ query: string; onQueryChange: (q: string) => void }> = ({ query, onQueryChange }) => {
    const sections = EVIDENCE_MATRIX.sections
        .map(sec => ({ ...sec, rows: sec.rows.filter(r => !query.trim() || rowMatches(r, query)) }))
        .filter(sec => sec.rows.length > 0);
    const shown = sections.reduce((n, sec) => n + sec.rows.length, 0);
    return (
        <>
            <div className="p-6 space-y-4 text-slate-700">
                {EVIDENCE_MATRIX.intro.map((t, i) => <p key={i} className="text-sm text-slate-600">{linkify(t)}</p>)}
                <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[14rem]">
                        <label htmlFor="evidence-filter" className="block text-sm font-semibold text-slate-700 mb-1">Filter by drug, trial or rule</label>
                        <input
                            id="evidence-filter"
                            type="search"
                            value={query}
                            onChange={e => onQueryChange(e.target.value)}
                            placeholder="e.g. eplerenone, DAPA-HF, potassium"
                            className="block w-full rounded-md border border-slate-300 bg-white py-2 px-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>
                    <p className="text-sm text-slate-600 pb-2" role="status" aria-live="polite">
                        Showing {shown} of {ALL_EVIDENCE_ROWS.length} rows
                        {query.trim() && <> <button type="button" onClick={() => onQueryChange('')} className="ml-2 font-bold text-indigo-700 underline">Clear filter</button></>}
                    </p>
                </div>
                {sections.length === 0 && <p className="text-sm text-slate-600">No rows match. Try a drug name or a shorter term.</p>}
                {sections.map(sec => (
                    <div key={sec.title}>
                        <h4 className="font-bold text-slate-800 mb-1">{sec.title}</h4>
                        {sec.notes.map((n, i) => <p key={i} className="text-xs text-slate-600 mb-2 [overflow-wrap:anywhere]">{linkify(n)}</p>)}
                        <div className="overflow-x-auto rounded border border-slate-200">
                            <table className="min-w-[56rem] w-full text-xs text-left">
                                <caption className="sr-only">{sec.title}: rule, what the tool does, why, evidence, strength and calibration, risk if wrong</caption>
                                <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                                    <tr>
                                        <th scope="col" className="px-3 py-2">Rule</th>
                                        <th scope="col" className="px-3 py-2">What the tool does</th>
                                        <th scope="col" className="px-3 py-2">Why</th>
                                        <th scope="col" className="px-3 py-2">Evidence</th>
                                        <th scope="col" className="px-3 py-2">Strength and calibration</th>
                                        <th scope="col" className="px-3 py-2">Risk if wrong</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 align-top">
                                    {sec.rows.map(r => (
                                        <tr key={r.id} id={`ev-${r.id}`}>
                                            <th scope="row" className="px-3 py-2 font-bold text-slate-700 whitespace-nowrap">{r.id}</th>
                                            <td className="px-3 py-2 text-slate-800 min-w-[16rem] [overflow-wrap:anywhere]">{linkify(r.behavior)}</td>
                                            <td className="px-3 py-2 text-slate-600 min-w-[12rem]">{r.rationale}</td>
                                            <td className="px-3 py-2 text-slate-600 min-w-[14rem] [overflow-wrap:anywhere]">{linkify(r.anchor)}</td>
                                            <td className="px-3 py-2 text-slate-600 min-w-[12rem]"><span className="font-semibold">{r.strength}.</span> {r.calibration}</td>
                                            <td className="px-3 py-2 text-slate-600 min-w-[10rem]">{r.risk}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
};

/** A long safety statement: its lead-in (text before the first colon) is the clickable summary, the rest opens on demand. */
const SafetyCheckItem: React.FC<{ text: string }> = ({ text }) => {
    const i = text.indexOf(': ');
    if (i < 0 || i > 140) return <li className="list-none">{text}</li>;
    return (
        <li className="list-none">
            <Disclosure
                className="rounded border border-slate-200 bg-white"
                buttonClassName="px-3 py-2 font-semibold text-slate-800 hover:bg-slate-50"
                title={text.slice(0, i)}
            >
                <p className="px-3 pb-3 pt-1 text-slate-700 leading-relaxed">{text.slice(i + 2)}</p>
            </Disclosure>
        </li>
    );
};

const w = (x: number) => `${Math.round(x * 1000) / 10}%`;
const signedPts = (n: number) => `${n >= 0 ? '+' : '\u2212'}${Math.abs(n)}`;
const SHORT_NAMES: Record<ScoreDomainKey, string> = {
    neurohormonal: 'Neuro', functional: 'Function', volume: 'Volume', structure: 'Structure',
    guideline: 'Guideline', completeness: 'Complete', cost: 'Cost', adherence: 'Adherence',
};
const defaultWeights = WEIGHT_PROFILES[DEFAULT_WEIGHT_PROFILE];

const domainDetails: Record<ScoreDomainKey, { color: string; description: string; bullets: string[] }> = {
    neurohormonal: {
        color: 'text-indigo-700',
        description: 'Uses NT-proBNP as a congestion and neurohormonal burden signal.',
        bullets: [`Full score at or below ${BNP_SCORE_TARGET} pg/mL`, `Zero at or above ${BNP_SCORE_CRITICAL.toLocaleString('en-US')} pg/mL`, 'Straight-line interpolation in between'],
    },
    functional: {
        color: 'text-blue-700',
        description: 'Combines NYHA class, KCCQ score, and optional daily step count.',
        bullets: ['NYHA class I to IV mapped to points', 'KCCQ contributes directly (0-100)', 'Steps included when entered'],
    },
    volume: {
        color: 'text-emerald-700',
        description: 'Measures fluid status using weight change, exam findings, and oxygenation.',
        bullets: ['Penalty for weight more than 1 kg above dry weight', `-${VOLUME_SCORING.findingPenalty} points per congestion finding on exam`, 'Additional penalty for low oxygen saturation'],
    },
    structure: {
        color: 'text-amber-700',
        description: 'Blends current remodeling state with trajectory and chamber geometry.',
        bullets: [`${w(STRUCTURE_BLEND_WEIGHTS.absolute)} current LVEF`, `${w(STRUCTURE_BLEND_WEIGHTS.improvement)} LVEF improvement from baseline`, `${w(STRUCTURE_BLEND_WEIGHTS.chamber)} chamber size (LVEDD, LAVI)`],
    },
    guideline: {
        color: 'text-rose-700',
        description: 'Phenotype-specific alignment with major HF guideline pathways, with extra credit for target doses.',
        bullets: ['Reduced EF (LVEF below 50, improved EF, or a prior LVEF below 50): RAAS inhibitor + beta-blocker + MRA + SGLT2 inhibitor, all Class I (2026 ESC)', 'HFpEF (LVEF 50 or higher and never below 50): SGLT2 inhibitor + MRA, both Class I; a RAAS inhibitor is Class IIb and earns only a small credit', 'LVEF 41-49 is treated as reduced EF per the 2026 ESC guideline; the 2022 AHA/ACC/HFSA guideline keeps a separate mildly reduced category with weaker recommendations; no large trial tested beta-blockers or RAAS inhibitors only in this range'],
    },
    completeness: {
        color: 'text-purple-700',
        description: 'The share of the indicated therapies this patient can take that the regimen covers.',
        bullets: ['Each indicated, achievable therapy counts once (pillars plus qualifying add-ons)', 'Therapies the patient cannot take are never counted against the regimen', 'A drug below its target dose earns partial credit, so up-titration raises the score'],
    },
    cost: {
        color: 'text-slate-700',
        description: 'Compares monthly out-of-pocket cost with the patient budget, adjusted for how cost-sensitive the patient is.',
        bullets: ['Rewards regimens that stay well inside the budget', 'Heavy penalty when over budget', 'Zero-budget mode supported'],
    },
    adherence: {
        color: 'text-teal-700',
        description: "Scores regimen complexity against the patient's complexity tolerance.",
        bullets: ['Complexity comes from dosing frequency and formulation', 'The tolerance setting moves the threshold', 'Score falls when complexity exceeds the threshold'],
    },
};

const adjustmentRows: { name: string; effect: string }[] = [
    { name: 'Patient-specific evidence bonus', effect: `Credit for medication features with trial evidence that applies to this patient, scaled to regimen size and limited to between ${signedPts(SCORE_ADJUSTMENTS.SPECIAL_FEATURES.min)} and ${signedPts(SCORE_ADJUSTMENTS.SPECIAL_FEATURES.max)} points.` },
    { name: 'Reducing diuretics in volume depletion', effect: `${signedPts(SCORE_ADJUSTMENTS.VOLUME_DEPLETION_DEESCALATION.points)} points when the option lowers diuretic exposure in a volume-depleted patient.` },
    { name: `Projected systolic BP below ${SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95.threshold}`, effect: `${signedPts(SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_95.points)} points.` },
    { name: `Projected systolic BP below ${SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.threshold}`, effect: `${signedPts(SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_90.points)} points (instead of the line above).` },
    { name: `Projected systolic BP below ${SCORE_ADJUSTMENTS.PROJECTED_SBP_LT_85.threshold}`, effect: 'Score set to zero, and the option is not shown.' },
    { name: `Projected heart rate below ${SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.threshold}`, effect: `${signedPts(SCORE_ADJUSTMENTS.PROJECTED_HR_LT_50.points)} points.` },
    { name: `Projected potassium above ${SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.threshold}`, effect: `${signedPts(SCORE_ADJUSTMENTS.PROJECTED_K_GT_5_5.points)} points.` },
    { name: 'Unresolved safety warnings', effect: `${signedPts(SCORE_ADJUSTMENTS.DANGEROUS_WARNINGS.perUnit)} points for each warning that reflects real residual patient risk. Procedural reminders do not count.` },
    { name: 'Kidney function not entered', effect: `${signedPts(SCORE_ADJUSTMENTS.UNKNOWN_RENAL.points)} points when the option starts or increases an SGLT2 inhibitor.` },
    { name: 'Low-output state', effect: `The displayed score is capped at ${SCORE_ADJUSTMENTS.LOW_OUTPUT_CAP.max}.` },
];

const safetyChecks = [
    'Input safety: SBP must be greater than DBP; duplicate current medications are removed before scoring.',
    'Implausible inputs hard-stop: physiologically impossible values (e.g. LVEF 99, K+ > 8) return verification alerts only — no recommendations are computed on suspect data.',
    'Hemodynamic hard gate: SBP < 90 mmHg returns alerts only (no regimen output).',
    'Hyperkalemic emergency gate: baseline K+ >= 6.0 mEq/L fires a HYPERKALEMIC EMERGENCY alert (ECG and urgent treatment, not outpatient optimization); K+ >= 6.5 returns alerts only — no regimen output (parallel to the SBP < 90 gate). K+ > 8.0 is treated as an implausible value.',
    `Display safety filter: regimens with projected SBP < ${DISPLAY_FLOORS.minProjectedSbp}, projected potassium > ${DISPLAY_FLOORS.maxProjectedPotassium.toFixed(1)}, or projected HR < ${DISPLAY_FLOORS.minProjectedPulse} are not shown.`,
    'Blank safety-critical data is treated as "not entered", never as a value: a blank potassium (0) never clears a hyperkalemia gate and never flows into projected-K+ math, and blank renal data (eGFR/creatinine 0) never evaluates as end-stage CKD. Renal-gated new starts are withheld pending a BMP, current renal-gated medications are retained. There is no score deduction for a blank potassium: instead, new starts and dose increases of RAAS inhibitors and MRAs are withheld (see the laboratory prerequisite below). A candidate that starts or increases an SGLT2 inhibitor with kidney function blank still carries a data-unknown warning and a score deduction.',
    'Laboratory prerequisite (rule E16): potassium and kidney function must be entered before starting or increasing an ACE inhibitor, ARB, ARNI or MRA. With either blank, those new starts and dose increases are withheld and one LABS REQUIRED alert is shown; a drug the patient already takes is continued at its current dose. No time window for how recent the labs are is applied, because the form does not record lab dates; enter labs that reflect the patient\'s current medications and clinical state. This rule comes from the physician owner (2026-11-11); the label wording behind it was not re-verified in that pass.',
    'Nitrate + PDE5 inhibitor (sildenafil/tadalafil/vardenafil/avanafil) or riociguat is an absolute exclusion — H/ISDN is removed from the formulary and force-removed from a current regimen, not merely warned about.',
    'Rescue mechanisms: a K+ binder is auto-appended when a candidate projects K+ > 5.3 (reactive rescue, for example a RAAS inhibitor step-up at borderline potassium); it is attached only to therapy the patient already takes, never to enable a NEW RAAS inhibitor or MRA (a candidate that adds a new potassium-raising class and would need a binder is not offered); IV iron is appended for iron deficiency per ESC criteria (ferritin < 100, or ferritin 100-300 with TSAT < 20) when LVEF < 50, NYHA is II-III and hemoglobin is below 15. A new RAAS inhibitor (ACE inhibitor, ARB or ARNI, when the patient takes none) is not started above K+ 5.2, with or without a binder (rule E18: recheck and start once it is 5.2 or lower; 2026 ESC Supplementary Tables S4/S5 give 5.2 as the caution threshold and the staged start is engine policy; the first steps are to stop potassium supplements, potassium-sparing diuretics, NSAIDs and salt substitutes). eGFR below 20 on a RAAS inhibitor raises an alert only: the guideline advises stopping if it is a new fall, but the tool has no baseline value and never stops the drug on the current number. A new MRA is not started above K+ 5.0, with or without a binder (rule E15): recheck potassium and start the MRA once it is 5.0 or lower. Sources: the 2026 ESC guideline says caution at 5.0 or above (primary), the 2022 US guideline start criterion is below 5.0 and the Aldactone and Kerendia labels say 5.0 or lower. Potassium binders carry a Class 2b recommendation in the 2022 US guideline (secondary source) and the 2026 ESC guideline makes no recommendation for them; the DIAMOND co-start was a trial protocol, not a recommendation. The GDMT gap names the reason and the monitoring plan says to repeat potassium. Binder potassium effects are the smaller preventive figures (patiromer about -0.1, Lokelma -0.3/-0.6/-0.7 at 5/10/15 g), tried lowest dose first. Binder rescue enables a regimen to be considered but carries a residual-risk score penalty — a regimen needing rescue ranks below an equal regimen that does not. Rescue additions count toward the max-new-classes-per-visit limit (a deliberate patient-facing sequencing limit).',
    'Pregnancy exclusions: RAAS classes, MRA/nsMRA, SGLT2i, vericiguat (FDA boxed warning — embryo-fetal toxicity), ivabradine (fetal harm), and GLP-1 therapy are excluded from recommendations (2026 ESC guideline Class III C for ACEi/ARB/ARNI, MRA, ivabradine and SGLT2i). Beta-blockers: a new start is limited to beta-1-selective agents (metoprolol succinate, bisoprolol) and a non-selective one the patient already takes (carvedilol) is switched to a beta-1-selective agent with the reason shown (2026 ESC Class I C). Hydralazine/isosorbide dinitrate and loop diuretics (for congestion) remain available.',
    'Acute decompensation handling: beta-blocker initiation is blocked and beta-blocker up-titration is deferred in ANY acute decompensation (warm or cold) — continue the current dose and diurese. An existing beta-blocker is dose-REDUCED only with hypoperfusion (cold-and-wet), cutting one dose step (~50%) — never abruptly stopped — while warm-and-wet decompensation continues the beta-blocker. Safe additions (especially SGLT2i, beneficial in acute HF) are still offered alongside any mandated reduction.',
    'Ivabradine (source-verified 2026-11-10, Corlanor label): initiation requires sinus rhythm, HR >= 70, LVEF <= 35, and a maximally TOLERATED beta-blocker (at target, or it cannot be increased: heart rate below 60, prior bradycardia, chronic hypotension) or beta-blockers contraindicated; the evidence bonus stays for a patient already on it. Contraindications: pregnancy, AFib, 2nd/3rd-degree AV block, sick sinus syndrome, a paced rhythm (pacemaker dependence), strong CYP3A4 inhibitors, Child-Pugh C (or unspecified B/C), acute decompensated HF, and SBP < 90; verapamil/diltiazem and CYP3A4 inducers carry an avoid warning. Starts at 5 mg twice daily (2.5 mg for a conduction defect or amiodarone/digoxin co-therapy); titration follows the label: up only if HR > 60, hold at 50-60, below 50 reduce one step and stop at 2.5 mg. KCCQ effect +2 (SHIFT), generic available.',
    'Heart rate on an established beta-blocker (source-verified 2026-11-10): resting HR below 55 forces a ONE-STEP dose reduction (never removal at a higher dose) with an alert naming the heart rate, and the beta-blocker is withheld only at the lowest dose or for 2nd/3rd-degree AV block or sick sinus syndrome without a pacemaker; no up-titration below HR 60. The carvedilol label gives the 55 figure; for metoprolol succinate and bisoprolol the labels give no number, so 55 and 60 are this tool\'s policy. New beta-blocker starts remain blocked below HR 55 (policy; the labels say "severe bradycardia"). A paced rhythm is not blocked by intrinsic-rate rules. Carvedilol efficacy is credited up to 25 mg bid (MOCHA) and the three beta-blockers are modeled equal at target dose (COMET used metoprolol tartrate).',
    'Digoxin (source-verified 2026-11-10, Lanoxin label, DIG): in sinus rhythm it is offered only for symptomatic HFrEF (LVEF <= 40, NYHA III-IV) that persists on maximal GDMT (no pillar still addable or below target; Class 2b), and in AFib for rate control once the beta-blocker is optimized. Ventricular fibrillation is the contraindication (with potassium below 3.5 and AV block kept conservatively); Wolff-Parkinson-White carries a warning; potassium above 5.5 and eGFR below 15 are now warnings and dosing guidance, not exclusions. Its heart-rate effect is credited only in AFib, its NT-proBNP effect is 0, and amiodarone calls for about a 30-50% dose reduction.',
    'Vericiguat initiation requires the VICTORIA enrollment criteria: NYHA II-IV, LVEF < 45, a qualifying worsening event (HF hospitalization within 6 months, or outpatient IV diuretic within 3 months; one yes/no answer covers both), and NT-proBNP >= 1000 pg/mL in sinus rhythm (>= 1600 in atrial fibrillation or any other rhythm; the label itself has no NT-proBNP criterion). These criteria gate initiation only — a patient already on vericiguat is never force-removed for improved markers. Riociguat or another sGC stimulator is contraindicated (label); a PDE-5 inhibitor is a warning (label: not recommended), as is a long-acting nitrate (excluded from VICTORIA); NT-proBNP above 8,000 carries an advisory (no benefit seen in that VICTORIA group). The label start is 5 mg (2.5 mg at risk of hypotension: engine policy SBP below 110), doubling about every 2 weeks to 10 mg. Pregnancy forces removal (FDA boxed warning).',
    'GLP-1 / GIP therapy (semaglutide, tirzepatide) is an obesity-phenotype symptom adjunct, not a guideline-recommended therapy. Initiation needs BMI >= 30 for both and LVEF >= 45 for semaglutide (STEP-HFpEF) or >= 50 for tirzepatide (SUMMIT); LVEF 41-44 gets neither, LVEF exactly 40 is HFrEF, and HFimpEF is managed as HFrEF. BMI and LVEF gate initiation only — continuation is blocked only by true safety contraindications (pregnancy, medullary thyroid carcinoma / MEN2 history), so weight-loss success never forces removal. A new start is always the lowest labeled tier (0.25 mg semaglutide; 2.5 mg tirzepatide) and titration moves ONE labeled step at a time (semaglutide 0.25/0.5/1.0/1.7/2.4 mg; tirzepatide 2.5 to 15 mg in 2.5 mg steps), at least 4 weeks per step. Modeled effects are the placebo-adjusted treatment effects (KCCQ 7.8 semaglutide, 6.9 tirzepatide; weight as a percent of the patient\'s weight, smaller with type 2 diabetes). Pancreatitis history, severe gastroparesis, diabetic retinopathy (semaglutide) and GI volume loss with an SGLT2 inhibitor plus a loop diuretic carry cautions, not exclusions.',
    'SGLT2 inhibitors (source-verified 2026-11-10): dapagliflozin is not started below eGFR 25 (Farxiga label) and empagliflozin is not started below eGFR 20 (EMPEROR / EMPA-KIDNEY enrolled eGFR 20 or higher); either may be continued below its floor. Type 1 diabetes or prior DKA stays excluded as an engine-conservative choice (not a label contraindication). The modeled KCCQ effects are the placebo-adjusted 2.5 (dapagliflozin) and 2.0 (empagliflozin).',
    'Hydralazine/isosorbide dinitrate (A-HeFT): the Class 1 indication (self-identified Black patients, NYHA III-IV, LVEF <= 40) is offered, and its evidence bonus credited, only with a RAAS inhibitor and a beta-blocker on board or documented inability to take them. The Class 2b path (HFrEF, any race, when RAAS inhibitors cannot be taken) is separate. Riociguat and PDE-5 inhibitors (sildenafil, tadalafil, vardenafil, avanafil) exclude it. Headache 50% and dizziness 32% (label); lupus-like syndrome and peripheral neuritis are warned about.',
    'IV iron (ferric carboxymaltose): added automatically only for iron deficiency with LVEF < 50, NYHA II-III and hemoglobin < 15 (full evidence credit at LVEF <= 40, limited at 41-49, none at >= 50; a clinician may still choose it). The dose follows the label table by weight (below / at least 70 kg) and hemoglobin (day 1 1000 mg, or 500 mg if Hb is above 14; week 6 per the table; then 500 mg at weeks 12, 24, 36 only if still iron deficient). Hemoglobin 15 or higher holds it. A boxed warning for hypophosphatemia adds a phosphate monitoring item. The monthly cost is a per-course amount amortized over 6 months.',
    'MRA potassium and interaction rules (source-verified 2026-11-10): a NEW MRA start above K+ 5.0 is not offered (rule E15; above 5.5 it is a contraindication). For an MRA the patient is ALREADY taking, K+ 5.5-5.9 forces a one-step dose reduction (withhold if already at the lowest dose) and K+ 6.0 or above withholds it, with the reason shown; restart low once K+ is below 5.5. Eplerenone and finerenone are contraindicated with strong CYP3A4 inhibitors; eplerenone is capped at 25 mg with a moderate CYP3A inhibitor and is contraindicated at eGFR 30 or below; finerenone and spironolactone are contraindicated in adrenal insufficiency (Addison disease). Finerenone starts at 10 mg (eGFR 25 to below 60) or 20 mg (eGFR 60 or above), with a target of 20 mg or 40 mg respectively; spironolactone starts at 25 mg (eGFR above 50) or 12.5 mg (eGFR 30-50; the label suggests 25 mg every other day).',
    'Warning penalties dock ranking only for genuine residual patient risk: purely procedural instructions (the mandatory ACEi-to-ARNI 36-hour washout, beta-blocker taper guidance, the Furoscix device instruction) are exempt from the ranking penalty, while residual-risk markers (binder rescue, MRA initiation at borderline K+, Furoscix CKD caution/triage) remain penalized. Drug-specific prescribing notes (dose spacing, sodium load, tablet strengths, off-label use) are informational and are never penalized; they appear under "Prescribing notes" on each option.',
    'RAAS new-start doses (source-verified 2026-11-10): a new ACE inhibitor or ARB always begins at its lowest tier. Sacubitril/valsartan starts at 24/26 mg twice daily if the patient is not on an ACE inhibitor or ARB (or takes only a low dose), eGFR is below 30, or liver disease is Child-Pugh B; otherwise at 49/51 mg; 97/103 mg is reached only by up-titration. Child-Pugh C is not recommended. Aliskiren with diabetes excludes all three classes. A 36-hour gap is required when switching between an ACE inhibitor and sacubitril/valsartan in either direction. Starting sacubitril/valsartan below SBP 100 carries a caution (PARADIGM-HF excluded SBP < 100); it is not a block.',
    'Dose steps and potassium (2026-11-10): the next dose step above and below the current dose is always offered, never skipped. A twice-daily drug is judged on its total daily dose (ramipril 5 mg twice daily is the 10 mg/day target). An MRA dose is not increased while potassium is 5.0 or above (finerenone and eplerenone labels; spironolactone by the same class rule, engine policy) and the plan says why. Swapping one loop diuretic for another lands at the equivalent total daily dose when the equivalence is verified (furosemide 40 mg = bumetanide 1 mg); torsemide uses the TRANSFORM-HF protocol ratio (torsemide 20 mg = furosemide 40 mg; a trial protocol, the registry text allows 2 to 4 mg of furosemide per mg).',
    'Loop and thiazide-type diuretics (source-verified 2026-11-10): loop effects and the high-dose alert use the TOTAL DAILY dose (40 mg twice daily counts as 80 mg/day); no regimen exceeds a label maximum total daily dose (furosemide 600 mg, torsemide 200 mg, bumetanide 10 mg, which has 0.5/1/2 mg tablets only); a thiazide-type add-on on top of a loop is credited 1.1 kg (CLOROTIC, hydrochlorothiazide) with more worsening renal function and electrolyte loss; the gout caution applies to every loop and thiazide-type diuretic; hydrochlorothiazide below eGFR 30 is a caution, not a contraindication; metolazone carries an electrolyte (BMP) monitoring item; loop response is reduced at low eGFR (higher doses usually needed, not auto-scaled). Torsemide shows no best-in-class badge (TRANSFORM-HF).',
    'Dual RAAS and dual MRA combinations are structurally blocked.',
    'Documented intolerances (prior discontinued medications) apply to the CURRENT regimen, not just new starts: an arriving medication that violates the intolerance history is swapped to a tolerated same-group agent when one exists (ACEi cough → ARB/ARNI; spironolactone gynecomastia → eplerenone/finerenone) or removed. Changing CURRENT therapy requires the structured side-effect reason (dropdown); free-text details only block new starts — so negated notes like "no cough" can never strip working therapy. Gynecomastia is treated as agent-specific (spironolactone and the named offender avoided, non-offending agents preserved); MRA hyperkalemia intolerance applies to all MRA types; angioedema excludes ACEi and ARNI with ARB allowed under caution.',
    'Monitoring plans are auto-generated for high-risk RAAS/MRA/diuretic/SGLT2i intensification.',
    'Therapy completeness: the share of indicated, achievable therapies (pillars + eligible disease-modifying adjuncts such as GLP-1 in obesity) is itself one of the eight weighted factors, and it also breaks ties between options with the same displayed score — the tool favors complete guideline therapy over the smallest change. Safety gates still override.',
    'Cost-effectiveness: cost is the FINAL ranking tiebreaker — applied only after clinical benefit (displayed score, therapy completeness, unrounded score) is otherwise tied. The tool never trades away health benefit to save money, but among clinically-equivalent regimens it recommends the cheaper one (e.g. generic spironolactone over an equally-beneficial brand). When nothing fits the budget, the cheapest near-affordable options are shown ordered by clinical value (best benefit first) with a budget-exceeded warning.'
];

const evidenceRows = [
    {
        drugClass: 'RAAS / ARNI',
        trials: 'PARADIGM-HF, PROVE-HF',
        modeledImpact: 'Neurohormonal unload, remodeling support, guideline pillar weighting in reduced EF phenotypes.'
    },
    {
        drugClass: 'Beta Blocker',
        trials: 'MERIT-HF, COPERNICUS, CIBIS-II',
        modeledImpact: 'Remodeling and rhythm protection with acute decompensation safety gating.'
    },
    {
        drugClass: 'SGLT2 Inhibitor',
        trials: 'DAPA-HF, EMPEROR-Reduced, EMPEROR-Preserved, DELIVER',
        modeledImpact: 'Cross-phenotype support with symptom and hospitalization benefit weighting.'
    },
    {
        drugClass: 'MRA / nsMRA',
        trials: 'RALES, EPHESUS, TOPCAT, FINEARTS-HF',
        modeledImpact: 'Guideline and adjunct contributions with hyperkalemia and dual-MRA protection logic.'
    },
    {
        drugClass: 'Loop Strategy (including Furoscix)',
        trials: 'Loop diuretic standard evidence + outpatient worsening-HF pathway assumptions',
        modeledImpact: 'Volume-targeted decongestion scoring, CKD/over-diuresis guardrails, Furoscix-specific safety warnings.'
    }
];

interface FAQProps {
    /** Evidence-matrix filter, owned by App so a link from a result can open the tab already filtered. */
    evidenceQuery?: string;
    onEvidenceQueryChange?: (q: string) => void;
    /** Changes each time a link from a result asks to jump to the matrix. */
    jumpNonce?: number;
}

export const FAQ: React.FC<FAQProps> = ({ evidenceQuery, onEvidenceQueryChange, jumpNonce = 0 }) => {
    const [localQuery, setLocalQuery] = useState('');
    const query = evidenceQuery ?? localQuery;
    const setQuery = onEvidenceQueryChange ?? setLocalQuery;
    const matrixRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if (jumpNonce > 0) {
            matrixRef.current?.scrollIntoView({ block: 'start' });
            matrixRef.current?.focus({ preventScroll: true });
        }
    }, [jumpNonce]);
    return (
        <div className="h-full overflow-y-auto bg-slate-50 custom-scrollbar p-4 sm:p-8">
            <div className="max-w-5xl mx-auto space-y-8 pb-16">

                <div className="border-b border-slate-200 pb-6">
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <QuestionMarkCircleIcon className="w-8 h-8 text-indigo-600" />
                        Clinical Logic, Safety, and Evidence
                    </h2>
                    <p className="text-slate-500 mt-2 text-lg leading-relaxed">
                        HeartFailurePATH uses a deterministic eight-domain simulation engine for regimen optimization across reduced-EF (LVEF below 50, including improved EF) and HFpEF pathways, following the 2026 ESC guideline (HFmrEF is no longer a separate phenotype).
                    </p>
                    <p className="text-slate-600 mt-2 text-sm" data-testid="faq-scope">{SCOPE_STATEMENT}</p>
                    <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
                        <a href="#faq-score" className="text-indigo-700 underline">How the score works</a>
                        <a href="#faq-safety" className="text-indigo-700 underline">Safety and eligibility checks</a>
                        <a href="#faq-evidence-matrix" className="text-indigo-700 underline">Evidence matrix (rule to source)</a>
                    </nav>
                </div>

                <section id="faq-score" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden scroll-mt-4">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <HeartIcon className="w-6 h-6 text-indigo-600" />
                            How the Score Works
                        </h3>
                    </div>
                    <div className="p-6 space-y-4 text-slate-700">
                        <p>
                            Each option is scored on eight factors, each from 0 to 100. Every factor has a weight, the weights add up to 100%, and the option&apos;s score is the weighted sum. An option that scored 100 on every factor would score 100. A few named adjustments, listed below, are then added or subtracted. Open &quot;How this score was calculated&quot; under any recommendation to see every line for that option.
                        </p>
                        <p className="text-sm text-slate-600">
                            These scores order options for review; they are not predictions of an individual patient&apos;s outcome.
                        </p>
                        <div className="space-y-5 mt-4">
                            {DOMAIN_GROUPS.map(g => (
                                <div key={g.key}>
                                    <h4 className="font-bold text-slate-800 mb-2">
                                        {g.label} <span className="font-normal text-slate-500">({w(g.domains.reduce((sum, k) => sum + defaultWeights[k], 0))} of the score under the {WEIGHT_PROFILE_META[DEFAULT_WEIGHT_PROFILE].label} weighting)</span>
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {g.domains.map(k => {
                                            const d = domainDetails[k];
                                            return (
                                                <div key={k} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                                    <h5 className={`font-bold mb-1 ${d.color}`}>{DOMAIN_LABELS[k]} <span className="text-slate-500 font-normal text-sm">&middot; {w(defaultWeights[k])}</span></h5>
                                                    <p className="text-sm">{d.description}</p>
                                                    <p className="text-xs mt-1 text-slate-600"><span className="font-bold">100 =</span> {goalAfterEquals(DOMAIN_GOALS[k])}</p>
                                                    <ul className="text-xs mt-2 list-disc list-inside text-slate-500">
                                                        {d.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}
                                                    </ul>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="mt-6">
                            <h4 className="font-bold text-lg mb-1">Weighting profiles</h4>
                            <p className="text-sm text-slate-600 mb-3">
                                The clinician&apos;s choice of &quot;what matters most&quot; selects one row below. It changes only how much each factor counts toward the ranking. Safety checks and exclusions never depend on it: a drug that is unsafe for the patient is withheld under every profile.
                            </p>
                            <div className="overflow-x-auto rounded border border-slate-200">
                                <table className="min-w-full text-sm text-left">
                                    <caption className="sr-only">Factor weights for each weighting profile</caption>
                                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                                        <tr>
                                            <th scope="col" className="px-3 py-2">Profile</th>
                                            {DOMAIN_KEYS.map(k => <th key={k} scope="col" className="px-3 py-2 text-right" title={DOMAIN_LABELS[k]}>{SHORT_NAMES[k]}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {(Object.keys(WEIGHT_PROFILES) as (keyof typeof WEIGHT_PROFILES)[]).map(name => (
                                            <tr key={name}>
                                                <th scope="row" className="px-3 py-2 align-top font-bold text-slate-800 min-w-[10rem]">
                                                    {WEIGHT_PROFILE_META[name].label}
                                                    <div className="text-xs font-normal text-slate-500">{WEIGHT_PROFILE_META[name].description}</div>
                                                </th>
                                                {DOMAIN_KEYS.map(k => <td key={k} className="px-3 py-2 text-right tabular-nums">{w(WEIGHT_PROFILES[name][k])}</td>)}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="mt-6">
                            <h4 className="font-bold text-lg mb-1">Adjustments</h4>
                            <p className="text-sm text-slate-600 mb-3">Applied on top of the weighted sum, in points on the 0-100 scale. Each one appears as its own line in the score ledger.</p>
                            <div className="overflow-x-auto rounded border border-slate-200">
                                <table className="min-w-full text-sm text-left">
                                    <caption className="sr-only">Score adjustments and their sizes</caption>
                                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                                        <tr><th scope="col" className="px-3 py-2">Adjustment</th><th scope="col" className="px-3 py-2">Effect</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {adjustmentRows.map(r => (
                                            <tr key={r.name}>
                                                <th scope="row" className="px-3 py-2 align-top font-medium text-slate-800 min-w-[12rem]">{r.name}</th>
                                                <td className="px-3 py-2 text-slate-600">{r.effect}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-xs text-slate-500 mt-2">The final score is limited to the {SCORE_ADJUSTMENTS.SCORE_CLAMP.min}-{SCORE_ADJUSTMENTS.SCORE_CLAMP.max} range and rounded to a whole number.</p>
                        </div>

                        <div className="mt-6">
                            <h4 className="font-bold text-lg mb-1">How options are ranked</h4>
                            <p className="text-sm text-slate-600">
                                Options are listed from the highest score down. {TIE_RULE_TEXT} Under each option, &quot;Compared with option 1&quot; shows which factors and adjustments account for the difference.
                            </p>
                            <h5 className="font-bold text-sm mt-3 mb-1">Ranking approach: Balanced or Prioritize foundational therapy</h5>
                            <p className="text-sm text-slate-600">
                                <span className="font-semibold">{RANKING_MODE_META.balanced.label}</span> (the default): {RANKING_MODE_META.balanced.description}
                            </p>
                            <p className="text-sm text-slate-600 mt-1">
                                <span className="font-semibold">{RANKING_MODE_META.foundational_first.label}</span>: {RANKING_MODE_META.foundational_first.description} An option is set aside in this ordering only if it would itself push projected systolic BP below 90 (or 85), heart rate below 50, or potassium above 5.5 further than where the patient is now. Among the rest, the option with the higher foundational coverage comes first (each of the four therapies counts fully at target dose and 60% below target), then the Balanced order breaks ties.
                            </p>
                            <p className="text-sm text-slate-600 mt-1">
                                This is separate from &quot;What matters most to this patient?&quot;, which changes the score weights. Under either approach, scores, safety exclusions, alerts, the budget limit and the display safety filter are the same; only the order of the options changes. When the foundational approach changes the lead option, the results show what Balanced would have led with. An option the patient cannot afford is never presented as a plan under either approach.
                            </p>
                        </div>

                        <div className="mt-6">
                            <h4 className="font-bold text-lg mb-1">Eligibility rules</h4>
                            <p className="text-sm text-slate-600 mb-3">Before any scoring, each drug is checked against these rules in order. The first rule that applies withholds the drug and is shown beside it under &quot;Clinical Exclusions &amp; Contraindications&quot;.</p>
                            <div className="overflow-x-auto rounded border border-slate-200">
                                <table className="min-w-full text-sm text-left">
                                    <caption className="sr-only">Numbered eligibility rules</caption>
                                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                                        <tr><th scope="col" className="px-3 py-2">Rule</th><th scope="col" className="px-3 py-2">Name</th><th scope="col" className="px-3 py-2">What it does</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {ELIGIBILITY_RULES.map(r => (
                                            <tr key={r.id}>
                                                <th scope="row" className="px-3 py-2 align-top font-bold text-slate-700 whitespace-nowrap">{r.id}</th>
                                                <td className="px-3 py-2 align-top font-medium text-slate-800 min-w-[10rem]">{r.name}</td>
                                                <td className="px-3 py-2 text-slate-600">{r.summary}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="faq-safety" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden scroll-mt-4">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <CalculationIcon className="w-5 h-5 text-indigo-600" />
                            Simulation and Safety Pipeline
                        </h3>
                    </div>
                    <div className="p-6 space-y-6 text-slate-700">
                        <div>
                            <h4 className="font-bold text-lg mb-2">Engine Sequence</h4>
                            <ol className="list-decimal list-inside text-sm space-y-2">
                                <li>Validate and sanitize current patient data (for example duplicate current meds, BP consistency).</li>
                                <li>Generate candidate modifications (add/up/down/swap/remove) under visit-class and contraindication constraints.</li>
                                <li>Project physiologic and safety deltas for each candidate regimen.</li>
                                <li>Score candidates across eight domains, apply safety penalties, and filter unsafe projections.</li>
                                <li>Return up to three clinically distinct regimens plus structured monitoring plans.</li>
                            </ol>
                        </div>
                        <div>
                            <h4 className="font-bold text-lg mb-2">Safety and Eligibility Checks</h4>
                            <p className="text-xs text-slate-600 mb-2">Select a heading to read the full rule.</p>
                            <ul className="text-sm space-y-2">
                                {safetyChecks.map(check => <SafetyCheckItem key={check} text={check} />)}
                            </ul>
                        </div>
                    </div>
                </section>

                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <LightBulbIcon className="w-5 h-5 text-indigo-600" />
                            Evidence and Furoscix Notes
                        </h3>
                    </div>
                    <div className="p-6 space-y-4">
                        <p className="text-sm text-slate-700">
                            Trial alignment informs effect sizes and class-level priorities. Stable rule IDs and rule-to-evidence traceability are in the evidence matrix below. Furoscix is implemented as a short-course add-on beside an oral loop for worsening congestion (label: not for chronic use), with explicit contraindication checks and mandatory device-use warnings when selected.
                        </p>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                                    <tr>
                                        <th className="px-4 py-3">Drug Class</th>
                                        <th className="px-4 py-3">Key Evidence</th>
                                        <th className="px-4 py-3">Modeled Impact</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {evidenceRows.map(row => (
                                        <tr key={row.drugClass}>
                                            <td className="px-4 py-3 font-bold text-slate-800">{row.drugClass}</td>
                                            <td className="px-4 py-3 text-slate-600">{row.trials}</td>
                                            <td className="px-4 py-3 text-slate-600">{row.modeledImpact}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
                            <p className="font-semibold text-slate-800 mb-1">Furoscix-specific implementation summary</p>
                            <ul className="list-disc list-inside space-y-1">
                                <li>Modeled as Furoscix (SC Furosemide) in the loop diuretic class.</li>
                                <li>Short-course add-on beside an oral loop for worsening congestion (at least 2 kg above dry weight); never a swap or standing replacement. Credited as 160 mg oral furosemide, and beside an oral loop only the increment above that loop.</li>
                                <li>Blocked for anuria, hypersensitivity (furosemide or adhesive/acrylate), no oral loop on board, or under 1 kg above dry weight. CKD is an indication; eGFR below 30 carries a caution.</li>
                                <li>When selected, the option carries a mandatory FUROSCIX SAFETY warning.</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <section id="faq-evidence-matrix" ref={matrixRef} tabIndex={-1} aria-labelledby="faq-evidence-matrix-title" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden scroll-mt-4 focus:outline-none">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 id="faq-evidence-matrix-title" className="text-xl font-bold text-slate-900">Evidence matrix: which rule rests on which source</h3>
                    </div>
                    <EvidenceMatrixSection query={query} onQueryChange={setQuery} />
                </section>

                <div className="bg-slate-100 p-4 rounded-lg text-xs text-slate-500 leading-relaxed border border-slate-200">
                    <strong>Disclaimer:</strong> This software is a clinical decision-support simulation tool. It projects responses from deterministic model assumptions and trial-informed class effects, not individualized pharmacogenomic prediction. It should not be used as the sole basis for prescribing decisions.
                </div>

            </div>
        </div>
    );
};
