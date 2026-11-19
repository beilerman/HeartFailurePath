import React, { useEffect, useRef, useState } from 'react';
import { ELIGIBILITY_RULES } from '../services/engine/eligibility';
import { WEIGHT_PROFILES, WEIGHT_PROFILE_META, DOMAIN_LABELS, SCORE_ADJUSTMENTS, type ScoreDomainKey } from '../services/engine/scoreModel';
import { EvidenceTables } from './EvidenceTables';
import { SCOPE_STATEMENT } from './rankingModeMeta';
import { EVIDENCE_MATRIX, ALL_EVIDENCE_ROWS, rowMatches } from './evidenceMatrix';

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


interface FAQProps {
    evidenceQuery?: string;
    onEvidenceQueryChange?: (q: string) => void;
    jumpNonce?: number;
}
export const FAQ: React.FC<FAQProps> = ({ evidenceQuery, onEvidenceQueryChange, jumpNonce = 0 }) => {
    const [localQuery, setLocalQuery] = useState('');
    const query = evidenceQuery ?? localQuery;
    const setQuery = onEvidenceQueryChange ?? setLocalQuery;
    const matrixRef = useRef<HTMLElement>(null);
    useEffect(() => { if (jumpNonce > 0) { matrixRef.current?.scrollIntoView({ block: 'start' }); matrixRef.current?.focus({ preventScroll: true }); } }, [jumpNonce]);
    const weightKeys: ScoreDomainKey[] = ['mortality', 'hf_hospitalization', 'symptoms', 'side_effects', 'cost', 'adherence', 'guideline', 'completeness'];
    const pct = (w: number) => `${Math.round(w * 1000) / 10}%`;
    return <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-8"><div className="max-w-5xl mx-auto space-y-6 pb-16">
        <header><h2 className="text-3xl font-bold text-slate-900">Clinical logic, safety and evidence</h2><p className="mt-3 text-slate-700" data-testid="faq-scope">{SCOPE_STATEMENT}</p></header>
        <section className="rounded-xl border bg-white p-6 space-y-3" aria-labelledby="faq-response">
            <h3 id="faq-response" className="text-xl font-bold">What can this review tell me?</h3>
            <p>It checks recorded findings, medication eligibility, treatment gaps, estimated cost and dosing burden. Each option is a proposal for clinician review, with medication-specific precautions and monitoring.</p>
            <p>It also shows, for each option, the expected effect compared with the current regimen as population averages from randomized trials: death from any cause, heart-failure hospitalization, KCCQ points and side-effect burden. These are not predictions for this patient.</p>
            <p>It does not calculate an untreated state. Individual changes in EF, BNP, KCCQ, weight, blood pressure, heart rate and potassium are not estimated. Recorded measurements remain unchanged; a proposed medication change is not a new clinical observation.</p>
            <p>For substitutions and discontinuations, review the source and destination dose, washout or taper instructions, reason for the change and measured follow-up. A completed course is not ongoing exposure. Removing an iron-course entry does not subtract an assumed benefit.</p>
        </section>
        <section className="rounded-xl border bg-white p-6 space-y-3" aria-labelledby="faq-missing">
            <h3 id="faq-missing" className="text-xl font-bold">Decisions with incomplete information</h3>
            <p>Missing data limit the decisions that depend on them. Unknown potassium or renal function holds dependent starts, increases and switches. Unknown current use holds related increases and substitutions; it does not automatically stop therapy or block unrelated eligible decisions.</p>
            <p>Core data gaps trigger a focused review that retains known urgent findings. Missing optional BNP or KCCQ does not prevent medication review. Unknown prices or budget leave affordability unassessed.</p>
            <p>Confirm time at the current dose, consistent use and tolerability before escalation. Dates do not establish adherence or full treatment effect. Held medication needs a deliberate restart plan; repeat iron requires course and phosphate assessment. CSS, TSS and OSS KCCQ scores are recorded separately without conversion.</p>
        </section>
        <section className="rounded-xl border bg-white p-6 space-y-3" aria-labelledby="faq-score">
            <h3 id="faq-score" className="text-xl font-bold">How options are ordered</h3>
            <p>Each option is ranked by six weighted factors, all taken from measured or priced inputs: death from any cause and heart-failure hospitalization (relative risks from randomized trials), symptoms (change in KCCQ points), side effects (one-year excess harm rates multiplied by a severity weight), cost, and dosing burden. The weights in the table are the tool&apos;s policy numbers, pending clinical review.</p>
            <p>The first four estimates are population averages from trials, not predictions for this patient. Recorded measurements are never altered or projected, and the patient&apos;s own response at follow-up replaces these estimates.</p>
            <h4 className="font-bold text-slate-800 pt-1">How the trial figures are used</h4>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-700">
                <li><span className="font-semibold">Small or imprecise trials are pulled toward &ldquo;no effect&rdquo;</span> in proportion to their uncertainty. A figure from a few hundred patients moves more than one from tens of thousands. Every figure shows its published value and the value used.</li>
                <li><span className="font-semibold">Dose.</span> A drug earns full credit at the dose the trials achieved. An option that starts or increases a drug is valued as titrated the way the trials did (&ldquo;as planned&rdquo;). A drug left at a lower dose earns less. The option card also shows the figure at today&apos;s doses where it differs. Loop diuretics have no measured dose relation, so they earn full credit at any dose, and congestion relief by dose is not modelled; the congestion display rule still shows the best diuretic intensification for a congested patient.</li>
                <li><span className="font-semibold">Drugs of one mechanism are not counted twice.</span> Effects of different mechanisms are combined as if independent, which no trial has tested; the interval shown makes the same assumption.</li>
                <li><span className="font-semibold">Evidence basis.</span> Each figure is labelled: randomized trial, pooled analysis of trials, extrapolated (carried from another population), borrowed from a sibling drug or class, assumed no effect (no outcome trial), not measured, or upper bound (no measurement for that drug, so the largest measured excess of that harm is used and probably overstates it).</li>
                <li><span className="font-semibold">Guideline concordance and therapy completeness</span> are still calculated and shown, for reference only, with weight 0. Guideline recommendations are a target the model is measured against, not an input to the ranking.</li>
                <li><span className="font-semibold">Neurohormonal, functional, volume and structure</span> remain &ldquo;not assessed&rdquo; with weight 0, because the tool does not predict an individual&apos;s biomarker or exam response.</li>
            </ul>
            <p>The table assumes cost is assessable. When it is not, cost has no weight and the other weights are rescaled. Scores from different sets of available inputs are not comparable.</p>
            <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Weight of each ranked factor under each preference; reference-only factors carry 0%</caption>
                <thead><tr><th scope="col">Preference</th>{weightKeys.map(k=><th scope="col" key={k}>{DOMAIN_LABELS[k]}</th>)}</tr></thead>
                <tbody>{Object.entries(WEIGHT_PROFILES).map(([name,weights])=><tr key={name}><th scope="row">{WEIGHT_PROFILE_META[name as keyof typeof WEIGHT_PROFILES].label}</th>{weightKeys.map(k=><td key={k}>{pct(weights[k])}</td>)}</tr>)}</tbody></table></div>
            <h4 className="font-bold text-slate-800 pt-1">Fixed safety rules that are not measured models</h4>
            <p>Eligibility rules; the penalty for each unresolved safety warning; the low blood pressure, slow heart rate and high potassium bands; the volume-depletion adjustment; the limit of two new drug classes per visit; and the rule for showing a diuretic option when the patient is congested. One hand-set number also remains: an option that replaces a drug that is contraindicated or has a documented intolerance earns +15 points before scaling (after scaling it is limited to between {SCORE_ADJUSTMENTS.SPECIAL_FEATURES.min} and +{SCORE_ADJUSTMENTS.SPECIAL_FEATURES.max} points). It applies to few options. No other drug feature adds bonus points.</p>
            <p>That swap bonus is divided by the number of indicated foundational treatment slots, fixed across options, so an unrelated additional drug does not dilute it. Safety warnings and label restrictions still apply. Equal scores do not establish equivalent clinical benefit.</p>
            <p>Cost-first and simpler-regimen preferences can trade clinical model score for affordability or dosing burden. Review the score breakdown and treatment considerations before choosing. Different doses and drugs are not presumed physiologically equivalent.</p>
        </section>
        <section className="rounded-xl border bg-white p-6 space-y-3" aria-labelledby="faq-safety">
            <h3 id="faq-safety" className="text-xl font-bold">Safety and eligibility</h3>
            <p>Checks use observed findings and medication-specific restrictions. An absent warning is not safety clearance. No assumed binder response or offsetting drug effect can normalize measured potassium or enable a restricted start.</p>
            <p>Potassium at or above 6.0 triggers an urgent alert. Above 6.0 but below 6.5, only supported corrective reductions or removals may be shown; the abnormal value remains unresolved. At 6.5 or above, or systolic BP below 90, the engine returns alerts only. A measured potassium below 3.5 holds new or intensified potassium-lowering diuretics.</p>
            <p>ACE inhibitor to ARNI transitions require the stated washout. Beta-blocker transitions use a starting-tier proposal and an individual taper plan, not target-dose equivalence. Oral loop conversions are approximate starting conventions that require reassessment.</p>
            <details><summary className="font-semibold cursor-pointer">Medication eligibility rules</summary><ul className="mt-3 space-y-2">{ELIGIBILITY_RULES.map(rule=><li key={rule.id}><strong>{rule.id}: {rule.name}.</strong> {rule.summary}</li>)}</ul></details>
        </section>
        <section className="rounded-xl border bg-white p-6 space-y-3" aria-labelledby="faq-evidence-tables">
            <h3 id="faq-evidence-tables" className="text-xl font-bold">Measured evidence tables</h3>
            <EvidenceTables />
        </section>
        <section id="faq-evidence-matrix" ref={matrixRef} tabIndex={-1} aria-labelledby="faq-evidence-matrix-title" className="rounded-xl border bg-white scroll-mt-4">
            <h3 id="faq-evidence-matrix-title" className="text-xl font-bold p-6 pb-0">Evidence matrix: rules and sources</h3><EvidenceMatrixSection query={query} onQueryChange={setQuery}/>
        </section>
    </div></div>;
};
