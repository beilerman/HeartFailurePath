
import React, { useState } from 'react';
import { ScoredRegimen, ExcludedMedication, MonitoringPlanItem } from '../types';
import { RecommendationCard } from './RecommendationCard';
import { getTargetDosePatientContext, isTargetDoseForPatient } from '../services/simulationService';

interface Props {
    results: ScoredRegimen[];
    isLoading: boolean;
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
}

// Assemble a plain-text plan a clinician can paste into the chart. Built from the same
// structured output shown on screen — top option's changes, then the supporting lists.
function buildChartSummary(
    results: ScoredRegimen[],
    clinicalAlerts: string[],
    gdmtGaps: string[],
    eligibleAdjuncts: string[],
    followUpCalendar: MonitoringPlanItem[],
    monitoringPlan: MonitoringPlanItem[]
): string {
    const lines: string[] = [];
    lines.push('HEART FAILURE GDMT PLAN (decision-support output — verify before acting)');
    lines.push('');

    if (clinicalAlerts.length > 0) {
        lines.push('SAFETY ALERTS:');
        clinicalAlerts.forEach(a => lines.push(`  - ${a}`));
        lines.push('');
    }

    const top = results[0];
    if (top) {
        const targetDoseContext = getTargetDosePatientContext(top);
        lines.push('REGIMEN (top ordered option):');
        top.regimen.forEach(r => {
            const targetLabel = isTargetDoseForPatient(r, targetDoseContext) ? ' (target dose)' : '';
            lines.push(`  - ${r.med.name} ${r.dose.strength}${r.dose.unit} ${r.selected_frequency}${targetLabel}`);
        });
        const changes = (top.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
        if (changes.length > 0) {
            lines.push('');
            lines.push('CHANGES THIS VISIT:');
            changes.forEach(m => lines.push(`  - ${m.summary}`));
        }
        if (top.warnings.length > 0) {
            lines.push('');
            lines.push('SAFETY & ADHERENCE NOTES:');
            top.warnings.forEach(w => lines.push(`  - ${w}`));
        }
    }

    if (gdmtGaps.length > 0) {
        lines.push('');
        lines.push('INDICATED GDMT CURRENTLY MISSING:');
        gdmtGaps.forEach(g => lines.push(`  - ${g}`));
    }
    if (eligibleAdjuncts.length > 0) {
        lines.push('');
        lines.push('ELIGIBLE ADJUNCTS TO CONSIDER:');
        eligibleAdjuncts.forEach(a => lines.push(`  - ${a}`));
    }
    if (followUpCalendar.length > 0) {
        lines.push('');
        lines.push('FOLLOW-UP CALENDAR (STRONG-HF):');
        followUpCalendar.forEach(i => lines.push(`  - ${i.timing}: ${i.test} — ${i.details}`));
    }
    if (monitoringPlan.length > 0) {
        lines.push('');
        lines.push('MONITORING PLAN:');
        monitoringPlan.forEach(i => lines.push(`  - ${i.test} (${i.timing}): ${i.details}`));
    }

    return lines.join('\n');
}

export const ResultsDisplay: React.FC<Props> = ({ results, isLoading, error, hasRun = false, resultsStale = false, onRerun, excludedMedications, clinicalAlerts = [], monitoringPlan = [], gdmtGaps = [], eligibleAdjuncts = [], missingDataNotices = [], followUpCalendar = [] }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const text = buildChartSummary(results, clinicalAlerts, gdmtGaps, eligibleAdjuncts, followUpCalendar, monitoringPlan);
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard API unavailable (e.g. insecure context) — no-op; button simply won't confirm.
        }
    };

    if (isLoading) return (
        <div className="flex flex-col items-center justify-center h-96 text-slate-400" role="status" aria-live="polite">
            <svg className="animate-spin h-10 w-10 mb-4 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="font-semibold text-lg">Analyzing patient data...</span>
        </div>
    );

    // First-run orientation: before any analysis is run, guide the user instead of showing a
    // bare empty pane next to a dense form.
    if (!hasRun) {
        return (
            <div className="space-y-6 pb-16">
                <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4" role="note">
                    <p className="text-sm font-semibold text-amber-900">
                        This is a guideline-concordance and safety <span className="underline">checklist</span>, not an outcome predictor. It surfaces GDMT gaps, contraindications, interactions, and monitoring needs, then orders valid options with a transparent guideline/safety/feasibility heuristic.
                    </p>
                </div>
                <div className="rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 p-8">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Start here</h2>
                    <ol className="mt-4 space-y-3 text-sm text-slate-700">
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">1</span>
                            <span><span className="font-semibold">Load a sample patient</span> from the “Load Patient Profile” menu at the top of the form, or enter this patient's data.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">2</span>
                            <span><span className="font-semibold">LVEF is the only required field</span> — it sets the HF phenotype. Everything else refines the safety and dosing checks.</span>
                        </li>
                        <li className="flex gap-3">
                            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-indigo-600 text-white font-bold text-xs flex items-center justify-center">3</span>
                            <span>Click <span className="font-semibold">Run Analysis</span>. You'll get GDMT gaps, eligible adjuncts, contraindications, a monitoring plan, and a STRONG-HF follow-up calendar.</span>
                        </li>
                    </ol>
                    <p className="mt-5 text-xs text-slate-500">New to the tool? The <span className="font-semibold">Evidence</span> tab explains the scoring domains and safety logic.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-16">
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4" role="note" aria-live="polite">
                <p className="text-sm font-semibold text-amber-900">
                    This is a guideline-concordance and safety <span className="underline">checklist</span>, not an outcome predictor. It surfaces GDMT gaps, contraindications, interactions, and monitoring needs. It does <span className="font-bold">not</span> predict an individual's response; displayed options are ordered by an internal guideline/safety/feasibility heuristic and must be chosen with the patient using the labeled trade-offs.
                </p>
            </div>

            {resultsStale && (
                <div className="rounded-xl border-2 border-orange-300 bg-orange-50 p-4 flex items-center justify-between gap-4" role="status" aria-live="polite">
                    <p className="text-sm font-semibold text-orange-900">
                        Inputs changed since this analysis was run — the results below are out of date.
                    </p>
                    {onRerun && (
                        <button
                            onClick={onRerun}
                            className="flex-shrink-0 bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors"
                        >
                            Re-run Analysis
                        </button>
                    )}
                </div>
            )}

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
                    <p className="text-sm font-semibold text-red-700">Simulation error</p>
                    <p className="text-sm text-red-600 mt-1">{error}</p>
                </div>
            )}

            {clinicalAlerts.length > 0 && (
                <div className="space-y-3" role="alert" aria-live="assertive">
                    {clinicalAlerts.map((alert, i) => (
                        <div key={i} className="rounded-xl border-2 border-red-300 bg-red-50 p-5 shadow-md">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                </svg>
                                <div>
                                    <p className="text-sm font-bold text-red-800">{alert.split(':')[0]}</p>
                                    <p className="text-sm text-red-700 mt-1 leading-relaxed">{alert.substring(alert.indexOf(':') + 2)}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {gdmtGaps.length > 0 && (
                <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-indigo-800 uppercase tracking-wide mb-1">Indicated GDMT — Currently Missing</h3>
                    <p className="text-xs text-indigo-700 mb-3">Guideline-indicated classes for this EF phenotype that are not in the current regimen. Add unless contraindicated (see exclusions below).</p>
                    <ul className="space-y-1.5">
                        {gdmtGaps.map((gap, i) => (
                            <li key={i} className="text-sm text-indigo-900 font-semibold flex items-start gap-2">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500 flex-shrink-0" aria-hidden="true"></span>
                                {gap}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {eligibleAdjuncts.length > 0 && (
                <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-violet-800 uppercase tracking-wide mb-1">Eligible Adjuncts to Consider</h3>
                    <p className="text-xs text-violet-700 mb-3">Criteria-met add-on therapies for this patient. Shown even if they did not rank in the regimen options above, so a guideline-indicated adjunct is never silently omitted.</p>
                    <ul className="space-y-1.5">
                        {eligibleAdjuncts.map((a, i) => (
                            <li key={i} className="text-sm text-violet-900 flex items-start gap-2">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-500 flex-shrink-0" aria-hidden="true"></span>
                                {a}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {missingDataNotices.length > 0 && (
                <div className="rounded-xl border border-slate-300 bg-slate-50 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-1">Data Not Entered — Inference Withheld</h3>
                    <p className="text-xs text-slate-500 mb-3">The tool withholds conclusions that depend on missing inputs rather than defaulting silently.</p>
                    <ul className="space-y-1.5">
                        {missingDataNotices.map((notice, i) => (
                            <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-slate-400 flex-shrink-0" aria-hidden="true"></span>
                                {notice}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {followUpCalendar.length > 0 && (
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-emerald-800 uppercase tracking-wide mb-1">Follow-Up Calendar (STRONG-HF)</h3>
                    <p className="text-xs text-emerald-700 mb-3">Initiation is the start of a loop, not a single decision. Rapid-sequence and reassess on this schedule.</p>
                    <ol className="space-y-2">
                        {followUpCalendar.map((item, i) => (
                            <li key={`${item.test}-${i}`} className="text-sm text-emerald-900 leading-relaxed">
                                <span className="font-bold text-emerald-700">{item.timing}</span>
                                <span className="font-semibold"> — {item.test}</span>
                                <span className="text-emerald-800">: {item.details}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {monitoringPlan.length > 0 && (
                <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-5 shadow-sm">
                    <h3 className="text-sm font-bold text-blue-800 uppercase tracking-wide mb-3">Recommended Monitoring Plan</h3>
                    <ul className="space-y-2">
                        {monitoringPlan.map((item, i) => (
                            <li key={`${item.test}-${i}`} className="text-sm text-blue-900 leading-relaxed">
                                <span className="font-semibold">{item.test}</span>
                                <span className="text-blue-700"> ({item.timing})</span>
                                <span className="text-blue-800">: {item.details}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="flex items-end justify-between border-b border-slate-200 pb-4 gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Ordered Guideline-Concordant Options</h2>
                    <p className="text-slate-500 mt-1 text-sm">Valid regimens that close GDMT gaps, ordered by the engine's guideline, safety, feasibility, and affordability heuristic. Compare the labeled trade-offs before choosing with the patient.</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                    {results.length > 0 && (
                        <>
                            <button
                                onClick={handleCopy}
                                className="text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                                aria-live="polite"
                            >
                                {copied ? '✓ Copied' : 'Copy to chart'}
                            </button>
                            <button
                                onClick={() => window.print()}
                                className="text-sm font-bold px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                Print
                            </button>
                        </>
                    )}
                    <span className="bg-slate-100 text-slate-600 text-sm font-bold px-3 py-1 rounded-full">{results.length} option{results.length === 1 ? '' : 's'}</span>
                </div>
            </div>

            {results.length > 0 && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                    {results.map((regimen, idx) => (
                        <RecommendationCard key={idx} regimen={regimen} rank={idx + 1} />
                    ))}
                </div>
            )}

            {excludedMedications.length > 0 && (
                <div className="mt-12 p-6 bg-slate-100/50 rounded-2xl border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-500 uppercase mb-4 tracking-wider">Clinical Exclusions & Contraindications</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {excludedMedications.map((med, i) => (
                            <div key={i} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-bold text-slate-900 text-sm">{med.name}</span>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">{med.drug_class}</span>
                                </div>
                                <p className="text-xs text-slate-500 italic leading-snug">{med.reason}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {results.length === 0 && !error && (
                <div className="text-center py-24 bg-slate-50/50 rounded-2xl border-2 border-dashed border-slate-200">
                    <p className="text-slate-400 font-medium text-lg">
                        {excludedMedications.length > 0
                            ? 'No regimens generated after applying clinical exclusions and constraints.'
                            : 'Adjust patient parameters and run analysis to see results.'}
                    </p>
                </div>
            )}
        </div>
    );
};
