import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScoredRegimen, ExcludedMedication, MonitoringPlanItem, RankingInfo, DecisionReadiness } from '../types';
import { DecisionReadinessPanel } from './DecisionReadinessPanel';
import { RecommendationCard } from './RecommendationCard';
import { buildChartHeader, type RunSnapshot } from './chartHeader';
import { RULESET_VERSION } from '../services/rulesetVersion';
import { clinicalSentence, NO_CHANGE_TEXT } from './clinicalPresentation';
import { Disclosure } from './Disclosure';
import { useEvidenceLink } from './EvidenceContext';
import { evidenceRowsForDrug, drugSearchTerm } from './evidenceMatrix';
import {
    buildChartSummary, partitionAlerts, partitionWarnings, groupExclusions, exclusionsForGap, startedByOption,
    planForOption, normalizeOptionIndex, type ChartInput,
    entryReasonText, sentenceCase, isOverBudgetFallback, rankingModeLines,
    type ExclusionEntry, type ExclusionGroup,
} from './resultsModel';

interface Props {
    results: ScoredRegimen[];
    runId?: number;
    error: string | null;
    hasRun?: boolean;
    resultsStale?: boolean;
    onRerun?: () => void;
    excludedMedications: ExcludedMedication[];
    clinicalAlerts?: string[];
    monitoringPlan?: MonitoringPlanItem[];
    gdmtGaps?: string[];
    eligibleAdjuncts?: string[];
    missingDataNotices?: string[];
    followUpCalendar?: MonitoringPlanItem[];
    ranking?: RankingInfo;
    decisionReadiness?: DecisionReadiness;
    /** Time and patient inputs captured when the analysis ran; printed in the copied note header. */
    runSnapshot?: RunSnapshot;
    /** Print the case label line. The guided view shows the label once, in its patient bar, and turns this off. */
    showCaseLabel?: boolean;
}

const modIcon: Record<string, string> = { add: '+', titrate_up: '↑', titrate_down: '↓', swap: '⇄', remove: '−' };
const modWord: Record<string, string> = { add: 'Start', titrate_up: 'Increase', titrate_down: 'Reduce', swap: 'Switch', remove: 'Stop' };
const modTone: Record<string, string> = {
    add: 'text-emerald-800', titrate_up: 'text-blue-800', titrate_down: 'text-blue-800', swap: 'text-amber-800', remove: 'text-red-800',
};

/** Scroll a result section into view and move keyboard focus to it. */
const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
};

const JumpLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
    <button type="button" onClick={() => jumpTo(to)} className="font-bold text-indigo-700 underline hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
        {children}
    </button>
);

const EvidenceButton: React.FC<{ drugNames: string[] }> = ({ drugNames }) => {
    const { openEvidence } = useEvidenceLink();
    const name = drugNames.find(n => evidenceRowsForDrug(n).length > 0);
    if (!name) return null;
    const count = evidenceRowsForDrug(name).length;
    return (
        <button type="button" onClick={() => openEvidence(drugSearchTerm(name))} className="text-xs font-bold text-indigo-700 underline hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
            Evidence for {drugSearchTerm(name)} ({count})
        </button>
    );
};

const ExclusionEntryRow: React.FC<{ entry: ExclusionEntry }> = ({ entry }) => {
    const reason = entryReasonText(entry);
    return (
        <li className="text-sm text-slate-800 leading-snug">
            <span className="font-bold">{entry.names.join(', ')}</span>
            <span className="text-slate-600">
                {entry.ruleName ? ` — ${entry.ruleName}` : ''}
                {entry.ruleId && <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px] font-bold align-middle">Rule {entry.ruleId}</span>}
            </span>
            {reason && <span className="block text-slate-700 mt-0.5">Why: {reason}</span>}
            <span className="block mt-0.5"><EvidenceButton drugNames={entry.names} /></span>
        </li>
    );
};

const ExclusionList: React.FC<{ group: ExclusionGroup }> = ({ group }) => (
    <ul className="space-y-2">{group.entries.map((e, i) => <ExclusionEntryRow key={i} entry={e} />)}</ul>
);

export const ResultsDisplay = React.memo(function ResultsDisplay({ results, runId = 0, error, hasRun = false, resultsStale = false, onRerun, excludedMedications, clinicalAlerts = [], monitoringPlan = [], gdmtGaps = [], eligibleAdjuncts = [], missingDataNotices = [], followUpCalendar = [], ranking, runSnapshot, decisionReadiness, showCaseLabel = true }: Props) {
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
    const [showNote, setShowNote] = useState(false);
    // Which option the draft note and visit summary describe (0-based). Option 1 unless the clinician chooses otherwise.
    const [selectedOption, setSelectedOption] = useState(0);
    const regionRef = useRef<HTMLDivElement>(null);

    // After Run Analysis, bring the answer into view and move keyboard/screen-reader focus to it.
    useEffect(() => {
        if (runId > 0 && regionRef.current) {
            regionRef.current.scrollIntoView({ block: 'start' });
            regionRef.current.focus({ preventScroll: true });
        }
    }, [runId]);

    const alerts = useMemo(() => partitionAlerts(clinicalAlerts), [clinicalAlerts]);
    const exclusionGroups = useMemo(() => groupExclusions(excludedMedications), [excludedMedications]);
    const top = results[0];
    const overBudget = isOverBudgetFallback(top);
    const modeLines = rankingModeLines(ranking);
    const sel = normalizeOptionIndex(results.length, selectedOption);
    const chartInput = useMemo<ChartInput>(() => ({ results, clinicalAlerts, gdmtGaps, eligibleAdjuncts, missingDataNotices, followUpCalendar, monitoringPlan, excludedMedications, ranking, decisionReadiness }),
        [results, clinicalAlerts, gdmtGaps, eligibleAdjuncts, missingDataNotices, followUpCalendar, monitoringPlan, excludedMedications, ranking, decisionReadiness]);
    const chartText = useMemo(() => {
        const body = buildChartSummary(chartInput, sel);
        return runSnapshot ? `${buildChartHeader(runSnapshot)}\n\n${body}` : `Rule-set version: ${RULESET_VERSION}\n\n${body}`;
    }, [chartInput, sel, runSnapshot]);
    useEffect(() => { setCopyState('idle'); setShowNote(false); setSelectedOption(0); }, [runId]);
    useEffect(() => {
        if (copyState !== 'copied') return;
        const timer = setTimeout(() => setCopyState('idle'), 3000);
        return () => clearTimeout(timer);
    }, [copyState]);

    const handleCopy = async () => {
        if (resultsStale || error || !hasRun) return;
        try {
            await navigator.clipboard.writeText(chartText);
            setCopyState('copied');
        } catch {
            setCopyState('failed');
            setShowNote(true);
        }
    };

    // Old/error output must not remain actionable or reappear in a browser-generated printout.
    if (error || (hasRun && resultsStale)) return (
        <section role="alert" aria-label="Analysis needs review" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5 space-y-3">
            <h2 className="text-lg font-bold text-amber-950">{resultsStale ? 'Analysis is out of date' : 'Analysis could not be completed'}</h2>
            <p className="text-sm text-amber-950">{resultsStale ? 'Inputs or an unfinished entry changed. Previous medication options are hidden. Save or clear pending entries, check the form, then run again.' : 'Correct the issue below and run the analysis again.'}</p>
            {error && <p className="text-sm font-semibold text-red-800">{error}</p>}
            {onRerun && <button type="button" onClick={onRerun} className="print:hidden px-4 py-2 rounded bg-indigo-700 text-white font-semibold focus-visible:ring-2">Re-run Analysis</button>}
        </section>
    );

    // First-run orientation: before any analysis is run, guide the user instead of showing a
    // bare empty pane next to a dense form.
    if (!hasRun) {
        return (
            <div className="space-y-6 pb-16">
                <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4" role="note">
                    <p className="text-sm font-semibold text-amber-900">
                        Research decision support for heart-failure medication review. Check proposed changes, safety warnings, monitoring and affordability with the patient before choosing treatment.
                    </p>
                </div>
                <div className="rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-8">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Start here</h2>
                    <ol className="mt-4 space-y-3 text-sm text-slate-700">
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">1</span>
                            <span><span className="font-semibold">Load a sample patient</span> from the menu at the top of the form, or choose &ldquo;Custom profile&rdquo; to enter your own patient.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">2</span>
                            <span><span className="font-semibold">Enter what is known; leave unavailable information blank.</span> Run a focused review even with an incomplete case. Medication options appear only when their prerequisites can be assessed; the results explain which decisions wait for more information.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">3</span>
                            <span>Click <span className="font-semibold">Review available information</span>. Review safety checks first, then proposed changes, alternatives and the monitoring needed for each option.</span>
                        </li>
                    </ol>
                    <p className="mt-5 text-xs text-slate-600">New to the tool? The <span className="font-semibold">Evidence</span> tab explains the scoring and safety logic and lists the source behind each rule.</p>
                </div>
            </div>
        );
    }

    // The same helper builds the note's monitoring and follow-up, so the screen and the draft cannot disagree.
    const plan = planForOption(chartInput, sel);
    const chosen = plan.option;
    const n = plan.number;
    const chosenOverBudget = isOverBudgetFallback(chosen);
    const changes = (chosen?.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
    const topWarnings = chosen ? partitionWarnings(chosen.warnings) : { safety: [], notes: [] };
    const selectOption = (index: number, thenJump = false) => { setSelectedOption(index); if (thenJump) jumpTo('results-this-visit'); };
    const showActions = results.length > 0 || clinicalAlerts.length > 0;

    return (
        <div ref={regionRef} tabIndex={-1} role="region" aria-label="Analysis results" className="space-y-6 pb-16 focus:outline-none">
            <p className="sr-only" role="status">
                Analysis complete: {results.length} option{results.length === 1 ? '' : 's'}, {alerts.urgent.length} safety check{alerts.urgent.length === 1 ? '' : 's'}.
            </p>

            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5" role="note">
                <p className="text-xs font-semibold text-amber-900">
                    Research decision support. Review safety checks before choosing treatment. Expected effects are trial averages, not a prediction for this patient; reassess the patient&apos;s actual response after any change.
                </p>
            </div>

            <div className="space-y-6">

            {showCaseLabel && runSnapshot?.caseLabel && <p className="text-sm font-semibold text-slate-700">{runSnapshot.caseLabel}</p>}
            {runSnapshot && <Disclosure title="Inputs used for this analysis" className="border border-slate-200 rounded bg-white" buttonClassName="px-4 py-3 text-sm font-semibold">
                <pre className="whitespace-pre-wrap break-words px-4 pb-4 text-xs text-slate-700">{buildChartHeader(runSnapshot)}</pre>
            </Disclosure>}

            {/* 1. Urgent safety */}
            {alerts.urgent.length > 0 && (
                <section id="results-alerts" tabIndex={-1} aria-labelledby="results-alerts-title" className="space-y-3 focus:outline-none scroll-mt-4" role="alert">
                    <h2 id="results-alerts-title" className="text-lg font-bold text-red-800">Safety alerts ({alerts.urgent.length})</h2>
                    {alerts.urgent.map((a, i) => (
                        <div key={i} className="rounded-xl border-2 border-red-300 bg-red-50 p-4 shadow-sm break-inside-avoid">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                                <div>
                                    {a.head && <h3 className="text-sm font-bold text-red-800">{a.head}</h3>}
                                    <p className={a.head ? 'text-sm text-red-800 mt-1 leading-relaxed' : 'text-sm font-bold text-red-800 leading-relaxed'}>{a.body}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </section>
            )}

            <DecisionReadinessPanel assessment={decisionReadiness} />

            {/* 2. This visit */}
            <section id="results-this-visit" tabIndex={-1} aria-labelledby="results-this-visit-title" className="rounded-2xl border-2 border-indigo-300 bg-white shadow-sm overflow-hidden focus:outline-none scroll-mt-4 break-inside-avoid">
                <div className="px-5 py-3 bg-indigo-600 text-white flex flex-wrap items-center justify-between gap-2">
                    <h2 id="results-this-visit-title" className="text-lg font-bold">Visit review</h2>
                    {showActions && (
                        <div className="flex items-center gap-2 print:hidden">
                            <button
                                onClick={handleCopy}
                                disabled={resultsStale}
                                title={resultsStale ? 'Inputs changed: re-run the analysis before copying' : undefined}
                                className="text-sm font-bold px-3 py-1.5 rounded-lg bg-white text-indigo-700 hover:bg-indigo-50 transition-colors min-h-[36px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {top ? `Copy draft for option ${n}` : 'Copy focused review draft'}
                            </button>
                            <button
                                onClick={() => window.print()}
                                disabled={resultsStale}
                                title={resultsStale ? 'Inputs changed: re-run the analysis before printing' : undefined}
                                className="text-sm font-bold px-3 py-1.5 rounded-lg bg-white text-indigo-700 hover:bg-indigo-50 transition-colors min-h-[36px] focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Print
                            </button>
                            <span className="text-xs font-semibold min-w-[3rem]" role="status" aria-live="polite">
                                {copyState === 'copied' && 'Copied'}
                                {copyState === 'failed' && 'Copy unavailable. Select the draft text below.'}
                            </span>
                        </div>
                    )}
                </div>
                <div className="p-5 space-y-4">
                    {top && overBudget && (
                        <div className="rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3" role="alert">
                            <p className="text-sm font-bold text-red-800">{Number.isFinite(top.cost) ? 'Over the stated budget' : 'Cost cannot be assessed'}</p>
                            <p className="text-sm text-red-800 mt-0.5">{Number.isFinite(top.cost) ? 'No displayed option fits the budget entered. Review coverage, assistance or an affordable alternative before choosing treatment.' : 'Pricing is incomplete. Obtain the missing costs before comparing affordability or choosing an option.'}</p>
                        </div>
                    )}
                    {top && modeLines.length > 0 && (
                        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5" data-testid="ranking-mode-note">
                            {modeLines.map((l, i) => <p key={i} className={i === 0 ? 'text-sm font-semibold text-indigo-900' : 'text-sm text-indigo-900 mt-0.5'}>{l}</p>)}
                        </div>
                    )}
                    {results.length > 1 && (
                        <fieldset className="print:hidden rounded-lg border border-indigo-200 bg-indigo-50/50 px-4 py-2.5">
                            <legend className="px-1 text-sm font-bold text-indigo-900">Draft note and visit summary describe</legend>
                            <div className="flex flex-wrap gap-x-5 gap-y-1">
                                {results.map((_, i) => (
                                    <label key={i} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800 min-h-[32px]">
                                        <input type="radio" name="draft-option" value={i} checked={sel === i} onChange={() => selectOption(i)} className="h-4 w-4 accent-indigo-700" />
                                        {i === 0 ? 'Option 1 (ordered first)' : `Option ${i + 1}`}
                                    </label>
                                ))}
                            </div>
                        </fieldset>
                    )}
                    {n > 1 && (
                        <p className="text-sm font-semibold text-indigo-900" role="status">
                            {`You selected option ${n}. The tool ordered option 1 first; check the differences, warnings and monitoring on the option ${n} card before using this draft.`}
                        </p>
                    )}
                    {!top && (
                        <p className="text-sm text-slate-800 font-semibold">
                            {decisionReadiness?.mode === 'limited_review'
                                ? 'Focused findings remain available. Complete the decision-specific information listed above before requesting a complete medication regimen.'
                                : alerts.urgent.length > 0
                                ? 'No regimen was generated. Resolve the safety alerts above first.'
                                : excludedMedications.length > 0
                                    ? 'No regimen was generated after applying clinical exclusions and constraints. See the withheld drugs below.'
                                    : 'No regimen was generated. Adjust the patient inputs and run the analysis again.'}
                        </p>
                    )}
                    {top && (
                        <div>
                            <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wide mb-1.5">{chosenOverBudget ? `Changes in option ${n} (for discussion only)` : `Changes in option ${n}`}</h3>
                            {changes.length === 0 ? (
                                <p className="text-sm font-semibold text-slate-800">{NO_CHANGE_TEXT}</p>
                            ) : (
                                <ul className="space-y-1">
                                    {changes.map((m, i) => (
                                        <li key={i} className={`text-sm font-semibold flex items-start gap-2 ${modTone[m.action] ?? 'text-slate-800'}`}>
                                            <span className="w-4 text-center font-bold" aria-hidden="true">{modIcon[m.action] ?? ''}</span>
                                            <span><span className="sr-only">{modWord[m.action] ?? ''}: </span>{clinicalSentence(m.summary)}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                    {top && plan.monitoring.length > 0 && (
                        <div>
                            <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wide mb-1.5">{`Monitoring for option ${n} and deferred therapy`}</h3>
                            <ul className="space-y-0.5">
                                {plan.monitoring.slice(0, 3).map((m, i) => (
                                    <li key={i} className="text-sm text-slate-800"><span className="font-semibold">{m.test}</span> <span className="text-slate-600">({m.timing})</span></li>
                                ))}
                            </ul>
                            {plan.monitoring.length > 3 && <p className="text-xs text-slate-600 mt-1">{plan.monitoring.length - 3} more in the <JumpLink to="results-monitoring">full monitoring plan</JumpLink>.</p>}
                        </div>
                    )}
                    <p className="text-sm text-slate-700 flex flex-wrap gap-x-4 gap-y-1">
                        {alerts.urgent.length > 0
                            ? <JumpLink to="results-alerts">{alerts.urgent.length} safety alert{alerts.urgent.length === 1 ? '' : 's'}</JumpLink>
                            : <span>No urgent finding from the recorded inputs; this is not a safety clearance.</span>}
                        {chosen && <span>{topWarnings.safety.length > 0 ? <JumpLink to={`results-option-${n}`}>{topWarnings.safety.length} safety warning{topWarnings.safety.length === 1 ? '' : 's'}</JumpLink> : 'No safety warnings generated'}{` on option ${n}`}{topWarnings.notes.length > 0 && ` (plus ${topWarnings.notes.length} prescribing note${topWarnings.notes.length === 1 ? '' : 's'})`}</span>}
                        {results.length > 1 && <JumpLink to="results-options">{results.length - 1} other option{results.length === 2 ? '' : 's'}</JumpLink>}
                        {(gdmtGaps.length > 0 || excludedMedications.length > 0) && <JumpLink to="results-why">Why: gaps, withheld drugs, follow-up</JumpLink>}
                    </p>
                </div>
            </section>

            <div className="print:hidden">
                <button type="button" onClick={()=>setShowNote(v=>!v)} aria-expanded={showNote} aria-controls="chart-note-preview" className="text-sm font-semibold text-indigo-700 underline focus-visible:ring-2">{showNote ? 'Hide' : 'Review'} {top ? `draft note for option ${n}` : 'focused review draft'}</button>
                <div hidden={!showNote} className="mt-3" id="chart-note-preview">
                    <label htmlFor="chart-note-text" className="block text-sm font-semibold mb-1">Draft note — check before adding to the chart</label>
                    <textarea id="chart-note-text" readOnly value={chartText} rows={14} className="w-full rounded border border-slate-300 p-3 text-sm" onFocus={e=>e.currentTarget.select()} />
                    <p className="text-xs text-slate-600">{top ? `Contains option ${n} only.` : 'Contains the focused review and its limitations; no medication option was generated.'} Select the text and copy manually if clipboard access is unavailable.</p>
                </div>
            </div>

            {/* 3. Options */}
            {results.length > 0 && (
                <section id="results-options" tabIndex={-1} aria-labelledby="results-options-title" className="focus:outline-none scroll-mt-4">
                    <div className="border-b border-slate-200 pb-3 mb-5">
                        <h2 id="results-options-title" className="text-2xl font-bold text-slate-900 tracking-tight">Options ({results.length})</h2>
                        <p className="text-slate-600 mt-1 text-sm">Options to review with the patient. Check safety warnings, medication differences and monitoring before choosing; the first option is not a finalized prescription.</p>
                    </div>
                    <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
                        {results.map((regimen, idx) => (
                            // runId in the key remounts cards on each analysis run so per-card UI
                            // state (details expansion, open modal) never carries onto a different regimen.
                            <div key={`${runId}-${idx}`} id={`results-option-${idx + 1}`} tabIndex={-1} className={`focus:outline-none scroll-mt-4 break-inside-avoid ${idx === 0 && results.length > 1 ? '2xl:col-span-2' : ''}`}>
                                <RecommendationCard regimen={regimen} rank={idx + 1} leader={idx > 0 ? results[0] : undefined} showFoundationalCoverage={ranking?.applied === true} />
                                {results.length > 1 && (
                                    <button type="button" aria-pressed={sel === idx} onClick={() => selectOption(idx, true)}
                                        className={`print:hidden mt-2 text-sm font-bold px-3 py-2 rounded-lg border-2 min-h-[40px] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${sel === idx ? 'bg-indigo-700 text-white border-indigo-700' : 'bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50'}`}>
                                        {`Use option ${idx + 1} for the draft note`}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/* 4. Why */}
            <section id="results-why" tabIndex={-1} aria-labelledby="results-why-title" className="space-y-5 focus:outline-none scroll-mt-4">
                <h2 id="results-why-title" className="text-2xl font-bold text-slate-900 tracking-tight border-b border-slate-200 pb-3">Why: gaps, withheld drugs and follow-up</h2>

                {gdmtGaps.length > 0 && (
                    <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-indigo-900 uppercase tracking-wide mb-1">Indicated GDMT currently missing</h3>
                        <p className="text-xs text-indigo-900 mb-3">Guideline-indicated classes for this EF phenotype that are not in the current regimen. {`Each row says whether option ${n} starts a drug in the class and, if drugs were withheld, why.`}</p>
                        <ul className="space-y-3">
                            {gdmtGaps.map((gap, i) => {
                                const started = startedByOption(gap, chosen);
                                const ex = exclusionsForGap(gap, exclusionGroups);
                                return (
                                    <li key={i} className="text-sm text-indigo-950">
                                        <p className="font-semibold">{gap}</p>
                                        <p className="text-xs text-indigo-900 mt-0.5">
                                            {started.length > 0 ? `Option ${n} starts ${started.join(', ')}.` : `Option ${n} does not start a drug in this class.`}
                                        </p>
                                        {ex ? (
                                            <Disclosure
                                                className="mt-1.5 rounded-lg bg-white/70 border border-indigo-200"
                                                buttonClassName="px-3 py-2 text-xs font-bold text-indigo-900 hover:bg-white"
                                                title={`Why not? ${ex.entries.reduce((n, e) => n + e.names.length, 0)} drug${ex.entries.reduce((n, e) => n + e.names.length, 0) === 1 ? '' : 's'} withheld in this class`}
                                            >
                                                <div className="px-3 pb-3 pt-1"><ExclusionList group={ex} /></div>
                                            </Disclosure>
                                        ) : (
                                            <p className="text-xs text-indigo-900 mt-0.5">No eligibility rule withheld a drug in this class.</p>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}

                {eligibleAdjuncts.length > 0 && (
                    <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-violet-900 uppercase tracking-wide mb-1">Eligible adjuncts to consider</h3>
                        <p className="text-xs text-violet-900 mb-3">Add-on therapies whose criteria are met for this patient. Shown even if they did not rank in the options above, so a guideline-indicated adjunct is never silently omitted.</p>
                        <ul className="space-y-1.5">
                            {eligibleAdjuncts.map((a, i) => (
                                <li key={i} className="text-sm text-violet-950 flex items-start gap-2">
                                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-600 flex-shrink-0" aria-hidden="true"></span>
                                    {a}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {alerts.advisory.length > 0 && (
                    <div className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-1">Other care prompts (not urgent)</h3>
                        <ul className="space-y-2 mt-2">
                            {alerts.advisory.map((a, i) => (
                                <li key={i} className="text-sm text-slate-800 leading-relaxed">
                                    {a.head && <span className="font-bold">{sentenceCase(a.head)}. </span>}{a.body}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {missingDataNotices.length > 0 && (
                    <div className="rounded-xl border border-slate-300 bg-slate-50 p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-1">Data not entered: conclusions withheld</h3>
                        <p className="text-xs text-slate-600 mb-3">The tool withholds conclusions that depend on missing inputs rather than defaulting silently.</p>
                        <ul className="space-y-1.5">
                            {missingDataNotices.map((notice, i) => (
                                <li key={i} className="text-sm text-slate-800 flex items-start gap-2">
                                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-slate-500 flex-shrink-0" aria-hidden="true"></span>
                                    {notice}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {plan.monitoring.length > 0 && (
                    <div id="results-monitoring" tabIndex={-1} className="rounded-xl border-2 border-blue-200 bg-blue-50 p-5 shadow-sm focus:outline-none scroll-mt-4 break-inside-avoid">
                        <h3 className="text-sm font-bold text-blue-900 uppercase tracking-wide mb-3">Recommended monitoring plan</h3>
                        <ul className="space-y-2">
                            {plan.monitoring.map((item, i) => (
                                <li key={`${item.test}-${i}`} className="text-sm text-blue-950 leading-relaxed">
                                    <span className="font-semibold">{item.test}</span>
                                    <span className="text-blue-900"> ({item.timing})</span>
                                    <span>: {item.details}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {plan.followUp.length > 0 && (
                    <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5 shadow-sm break-inside-avoid">
                        <h3 className="text-sm font-bold text-emerald-900 uppercase tracking-wide mb-1">{`Follow-up for option ${n} (STRONG-HF framework)`}</h3>
                        <p className="text-xs text-emerald-900 mb-3">{`Review this suggested schedule for option ${n}. Timing must match the selected regimen and clinical circumstances.`}</p>
                        <ol className="space-y-2">
                            {plan.followUp.map((item, i) => (
                                <li key={`${item.test}-${i}`} className="text-sm text-emerald-950 leading-relaxed">
                                    <span className="font-bold">{item.timing}</span>
                                    <span className="font-semibold"> &mdash; {item.test}</span>
                                    <span>: {item.details}</span>
                                </li>
                            ))}
                        </ol>
                    </div>
                )}

                {excludedMedications.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-slate-100/60 p-5">
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-1">All drugs withheld, by class ({excludedMedications.length})</h3>
                        <p className="text-xs text-slate-600 mb-3">Drugs with the same rule and reasons are merged into one line.</p>
                        <div className="space-y-2">
                            {exclusionGroups.map((g, gi) => (
                                <Disclosure
                                    key={g.key}
                                    defaultOpen={gi === 0 && exclusionGroups.length === 1}
                                    className="rounded-lg bg-white border border-slate-200"
                                    buttonClassName="px-3 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50"
                                    title={<>{g.label} <span className="font-normal text-slate-600">({g.entries.reduce((n, e) => n + e.names.length, 0)})</span></>}
                                >
                                    <div className="px-3 pb-3 pt-1"><ExclusionList group={g} /></div>
                                </Disclosure>
                            ))}
                        </div>
                    </div>
                )}
            </section>
            <p className="text-[11px] text-slate-500 text-right">Rule-set version {RULESET_VERSION}</p>
            </div>
        </div>
    );
});
