import React from 'react';
import {
    DOMAIN_GROUPS, DOMAIN_LABELS, WEIGHT_PROFILES, WEIGHT_PROFILE_META, DEFAULT_WEIGHT_PROFILE, SCORE_ADJUSTMENTS, DOMAIN_KEYS,
    type ScoreDomainKey,
} from '../services/engine/scoreModel';
import { ELIGIBILITY_RULES } from '../services/engine/eligibility';
import { VOLUME_SCORING, STRUCTURE_BLEND_WEIGHTS, DISPLAY_FLOORS, DOMAIN_GOALS, BNP_SCORE_TARGET, BNP_SCORE_CRITICAL } from '../services/simulationService';
import { TIE_RULE_TEXT, goalAfterEquals } from './scoreExplain';
import { QuestionMarkCircleIcon, LightBulbIcon, CalculationIcon, HeartIcon } from './icons';

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
        bullets: ['HFrEF: RAAS inhibitor + beta-blocker + MRA + SGLT2 inhibitor', 'HFmrEF: weighted hybrid of the pillars', 'HFpEF: SGLT2 inhibitor first, with adjuncts'],
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
    { name: 'Potassium not entered', effect: `${signedPts(SCORE_ADJUSTMENTS.UNKNOWN_POTASSIUM.points)} points when the option starts or increases a RAAS inhibitor or MRA.` },
    { name: 'Kidney function not entered', effect: `${signedPts(SCORE_ADJUSTMENTS.UNKNOWN_RENAL.points)} points when the option starts or increases a RAAS inhibitor, MRA or SGLT2 inhibitor.` },
    { name: 'Low-output state', effect: `The displayed score is capped at ${SCORE_ADJUSTMENTS.LOW_OUTPUT_CAP.max}.` },
];

const safetyChecks = [
    'Input safety: SBP must be greater than DBP; duplicate current medications are removed before scoring.',
    'Implausible inputs hard-stop: physiologically impossible values (e.g. LVEF 99, K+ > 8) return verification alerts only — no recommendations are computed on suspect data.',
    'Hemodynamic hard gate: SBP < 90 mmHg returns alerts only (no regimen output).',
    'Hyperkalemic emergency gate: baseline K+ >= 6.0 mEq/L fires a HYPERKALEMIC EMERGENCY alert (ECG and urgent treatment, not outpatient optimization); K+ >= 6.5 returns alerts only — no regimen output (parallel to the SBP < 90 gate). K+ > 8.0 is treated as an implausible value.',
    `Display safety filter: regimens with projected SBP < ${DISPLAY_FLOORS.minProjectedSbp}, projected potassium > ${DISPLAY_FLOORS.maxProjectedPotassium.toFixed(1)}, or projected HR < ${DISPLAY_FLOORS.minProjectedPulse} are not shown.`,
    'Blank safety-critical data is treated as "not entered", never as a value: a blank potassium (0) never clears a hyperkalemia gate and never flows into projected-K+ math, and blank renal data (eGFR/creatinine 0) never evaluates as end-stage CKD. Renal-gated new starts are withheld pending a BMP, current renal-gated medications are retained, and any candidate intensifying RAAS/MRA/SGLT2i carries an explicit data-unknown warning and ranking penalty.',
    'Nitrate + PDE5 inhibitor (sildenafil/tadalafil/vardenafil/avanafil) or riociguat is an absolute exclusion — H/ISDN is removed from the formulary and force-removed from a current regimen, not merely warned about.',
    'Rescue mechanisms: a K+ binder is auto-appended when a candidate projects K+ > 5.3 (reactive rescue) and is co-prescribed proactively when an MRA is initiated at baseline K+ > 5.0 (DIAMOND protocol); IV iron is appended for iron deficiency per ESC criteria (ferritin < 100, or ferritin 100-300 with TSAT < 20) when LVEF < 50, NYHA is II-III and hemoglobin is below 15. An MRA is never started above K+ 5.0 without a binder in the same option, and that option carries a plain warning that the label threshold for starting is 5.0 (start the binder first, begin the MRA once a repeat potassium is 5.0 or below); if no binder can be offered, the MRA is not started (rule E15). Binder potassium effects are the smaller preventive figures (patiromer about -0.1, Lokelma -0.3/-0.6/-0.7 at 5/10/15 g), tried lowest dose first. Binder rescue enables a regimen to be considered but carries a residual-risk score penalty — a regimen needing rescue ranks below an equal regimen that does not. Rescue additions count toward the max-new-classes-per-visit limit (a deliberate patient-facing sequencing limit).',
    'Pregnancy exclusions: RAAS classes, MRA/nsMRA, SGLT2i, vericiguat (FDA boxed warning — embryo-fetal toxicity), ivabradine (fetal harm), and GLP-1 therapy are excluded from recommendations. Hydralazine/isosorbide dinitrate remains available as the pregnancy-appropriate RAAS alternative.',
    'Acute decompensation handling: beta-blocker initiation is blocked and beta-blocker up-titration is deferred in ANY acute decompensation (warm or cold) — continue the current dose and diurese. An existing beta-blocker is dose-REDUCED only with hypoperfusion (cold-and-wet), cutting one dose step (~50%) — never abruptly stopped — while warm-and-wet decompensation continues the beta-blocker. Safe additions (especially SGLT2i, beneficial in acute HF) are still offered alongside any mandated reduction.',
    'Ivabradine (source-verified 2026-11-10, Corlanor label): initiation requires sinus rhythm, HR >= 70, LVEF <= 35, and a maximally TOLERATED beta-blocker (at target, or it cannot be increased: heart rate below 60, prior bradycardia, chronic hypotension) or beta-blockers contraindicated; the evidence bonus stays for a patient already on it. Contraindications: pregnancy, AFib, 2nd/3rd-degree AV block, sick sinus syndrome, a paced rhythm (pacemaker dependence), strong CYP3A4 inhibitors, Child-Pugh C (or unspecified B/C), acute decompensated HF, and SBP < 90; verapamil/diltiazem and CYP3A4 inducers carry an avoid warning. Starts at 5 mg twice daily (2.5 mg for a conduction defect or amiodarone/digoxin co-therapy); titration follows the label: up only if HR > 60, hold at 50-60, below 50 reduce one step and stop at 2.5 mg. KCCQ effect +2 (SHIFT), generic available.',
    'Heart rate on an established beta-blocker (source-verified 2026-11-10): resting HR below 55 forces a ONE-STEP dose reduction (never removal at a higher dose) with an alert naming the heart rate, and the beta-blocker is withheld only at the lowest dose or for 2nd/3rd-degree AV block or sick sinus syndrome without a pacemaker; no up-titration below HR 60. The carvedilol label gives the 55 figure; for metoprolol succinate and bisoprolol the labels give no number, so 55 and 60 are this tool\'s policy. New beta-blocker starts remain blocked below HR 55 (policy; the labels say "severe bradycardia"). A paced rhythm is not blocked by intrinsic-rate rules. Carvedilol efficacy is credited up to 25 mg bid (MOCHA) and the three beta-blockers are modeled equal at target dose (COMET used metoprolol tartrate).',
    'Digoxin (source-verified 2026-11-10, Lanoxin label, DIG): in sinus rhythm it is offered only for symptomatic HFrEF (LVEF <= 40, NYHA III-IV) that persists on maximal GDMT (no pillar still addable or below target; Class 2b), and in AFib for rate control once the beta-blocker is optimized. Ventricular fibrillation is the contraindication (with potassium below 3.5 and AV block kept conservatively); Wolff-Parkinson-White carries a warning; potassium above 5.5 and eGFR below 15 are now warnings and dosing guidance, not exclusions. Its heart-rate effect is credited only in AFib, its NT-proBNP effect is 0, and amiodarone calls for about a 30-50% dose reduction.',
    'Vericiguat initiation requires the VICTORIA enrollment criteria: NYHA II-IV, LVEF < 45, a qualifying worsening event (HF hospitalization within 6 months, or outpatient IV diuretic within 3 months; one yes/no answer covers both), and NT-proBNP >= 1000 pg/mL in sinus rhythm (>= 1600 in atrial fibrillation or any other rhythm; the label itself has no NT-proBNP criterion). These criteria gate initiation only — a patient already on vericiguat is never force-removed for improved markers. Riociguat or another sGC stimulator is contraindicated (label); a PDE-5 inhibitor is a warning (label: not recommended), as is a long-acting nitrate (excluded from VICTORIA); NT-proBNP above 8,000 carries an advisory (no benefit seen in that VICTORIA group). The label start is 5 mg (2.5 mg at risk of hypotension: engine policy SBP below 110), doubling about every 2 weeks to 10 mg. Pregnancy forces removal (FDA boxed warning).',
    'GLP-1 / GIP therapy (semaglutide, tirzepatide) is an obesity-phenotype symptom adjunct, not a guideline-recommended therapy. Initiation needs BMI >= 30 for both and LVEF >= 45 for semaglutide (STEP-HFpEF) or >= 50 for tirzepatide (SUMMIT); LVEF 41-44 gets neither, LVEF exactly 40 is HFrEF, and HFimpEF is managed as HFrEF. BMI and LVEF gate initiation only — continuation is blocked only by true safety contraindications (pregnancy, medullary thyroid carcinoma / MEN2 history), so weight-loss success never forces removal. A new start is always the lowest labeled tier (0.25 mg semaglutide; 2.5 mg tirzepatide) and titration moves ONE labeled step at a time (semaglutide 0.25/0.5/1.0/1.7/2.4 mg; tirzepatide 2.5 to 15 mg in 2.5 mg steps), at least 4 weeks per step. Modeled effects are the placebo-adjusted treatment effects (KCCQ 7.8 semaglutide, 6.9 tirzepatide; weight as a percent of the patient\'s weight, smaller with type 2 diabetes). Pancreatitis history, severe gastroparesis, diabetic retinopathy (semaglutide) and GI volume loss with an SGLT2 inhibitor plus a loop diuretic carry cautions, not exclusions.',
    'SGLT2 inhibitors (source-verified 2026-11-10): dapagliflozin is not started below eGFR 25 (Farxiga label) and empagliflozin is not started below eGFR 20 (EMPEROR / EMPA-KIDNEY enrolled eGFR 20 or higher); either may be continued below its floor. Type 1 diabetes or prior DKA stays excluded as an engine-conservative choice (not a label contraindication). The modeled KCCQ effects are the placebo-adjusted 2.5 (dapagliflozin) and 2.0 (empagliflozin).',
    'Hydralazine/isosorbide dinitrate (A-HeFT): the Class 1 indication (self-identified Black patients, NYHA III-IV, LVEF <= 40) is offered, and its evidence bonus credited, only with a RAAS inhibitor and a beta-blocker on board or documented inability to take them. The Class 2b path (HFrEF, any race, when RAAS inhibitors cannot be taken) is separate. Riociguat and PDE-5 inhibitors (sildenafil, tadalafil, vardenafil, avanafil) exclude it. Headache 50% and dizziness 32% (label); lupus-like syndrome and peripheral neuritis are warned about.',
    'IV iron (ferric carboxymaltose): added automatically only for iron deficiency with LVEF < 50, NYHA II-III and hemoglobin < 15 (full evidence credit at LVEF <= 40, limited at 41-49, none at >= 50; a clinician may still choose it). The dose follows the label table by weight (below / at least 70 kg) and hemoglobin (day 1 1000 mg, or 500 mg if Hb is above 14; week 6 per the table; then 500 mg at weeks 12, 24, 36 only if still iron deficient). Hemoglobin 15 or higher holds it. A boxed warning for hypophosphatemia adds a phosphate monitoring item. The monthly cost is a per-course amount amortized over 6 months.',
    'MRA potassium and interaction rules (source-verified 2026-11-10): a NEW MRA start above K+ 5.5 is never offered. For an MRA the patient is ALREADY taking, K+ 5.5-5.9 forces a one-step dose reduction (withhold if already at the lowest dose) and K+ 6.0 or above withholds it, with the reason shown; restart low once K+ is below 5.5. Eplerenone and finerenone are contraindicated with strong CYP3A4 inhibitors; eplerenone is capped at 25 mg with a moderate CYP3A inhibitor and is contraindicated at eGFR 30 or below; finerenone and spironolactone are contraindicated in adrenal insufficiency (Addison disease). Finerenone starts at 10 mg (eGFR 25 to below 60) or 20 mg (eGFR 60 or above), with a target of 20 mg or 40 mg respectively; spironolactone starts at 25 mg (eGFR above 50) or 12.5 mg (eGFR 30-50; the label suggests 25 mg every other day).',
    'Warning penalties dock ranking only for genuine residual patient risk: purely procedural instructions (the mandatory ACEi-to-ARNI 36-hour washout, beta-blocker taper guidance, the Furoscix device instruction) are exempt from the ranking penalty, while residual-risk markers (binder rescue, MRA initiation at borderline K+, Furoscix CKD caution/triage) remain penalized.',
    'RAAS new-start doses (source-verified 2026-11-10): a new ACE inhibitor or ARB always begins at its lowest tier. Sacubitril/valsartan starts at 24/26 mg twice daily if the patient is not on an ACE inhibitor or ARB (or takes only a low dose), eGFR is below 30, or liver disease is Child-Pugh B; otherwise at 49/51 mg; 97/103 mg is reached only by up-titration. Child-Pugh C is not recommended. Aliskiren with diabetes excludes all three classes. A 36-hour gap is required when switching between an ACE inhibitor and sacubitril/valsartan in either direction. Starting sacubitril/valsartan below SBP 100 carries a caution (PARADIGM-HF excluded SBP < 100); it is not a block.',
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

export const FAQ: React.FC = () => {
    return (
        <div className="h-full overflow-y-auto bg-slate-50 custom-scrollbar p-8">
            <div className="max-w-5xl mx-auto space-y-8 pb-16">

                <div className="border-b border-slate-200 pb-6">
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <QuestionMarkCircleIcon className="w-8 h-8 text-indigo-600" />
                        Clinical Logic, Safety, and Evidence
                    </h2>
                    <p className="text-slate-500 mt-2 text-lg leading-relaxed">
                        HeartFailurePATH uses a deterministic eight-domain simulation engine for regimen optimization across HFrEF, HFmrEF, HFpEF, and HFimpEF-preservation pathways.
                    </p>
                </div>

                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
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

                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
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
                            <ul className="list-disc list-inside text-sm space-y-2 pl-2">
                                {safetyChecks.map(check => <li key={check}>{check}</li>)}
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
                            Trial alignment informs effect sizes and class-level priorities. Stable rule IDs and rule-to-evidence traceability are documented in <code>docs/evidence-matrix.md</code>. Furoscix is implemented as a short-course add-on beside an oral loop for worsening congestion (label: not for chronic use), with explicit contraindication checks and mandatory device-use warnings when selected.
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
                                <li>Modeled as `Furoscix (SC Furosemide)` in Loop Diuretic class.</li>
                                <li>Short-course add-on beside an oral loop for worsening congestion (at least 2 kg above dry weight); never a swap or standing replacement. Credited as 160 mg oral furosemide, and beside an oral loop only the increment above that loop.</li>
                                <li>Blocked for anuria, hypersensitivity (furosemide or adhesive/acrylate), no oral loop on board, or under 1 kg above dry weight. CKD is an indication; eGFR below 30 carries a caution.</li>
                                <li>When selected, the regimen includes mandatory `FUROSCIX SAFETY` warning text.</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <div className="bg-slate-100 p-4 rounded-lg text-xs text-slate-500 leading-relaxed border border-slate-200">
                    <strong>Disclaimer:</strong> This software is a clinical decision-support simulation tool. It projects responses from deterministic model assumptions and trial-informed class effects, not individualized pharmacogenomic prediction. It should not be used as the sole basis for prescribing decisions.
                </div>

            </div>
        </div>
    );
};
