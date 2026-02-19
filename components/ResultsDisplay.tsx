
import React from 'react';
import { ScoredRegimen, ExcludedMedication, MonitoringPlanItem } from '../types';
import { RecommendationCard } from './RecommendationCard';

interface Props {
    results: ScoredRegimen[];
    isLoading: boolean;
    error: string | null;
    excludedMedications: ExcludedMedication[];
    clinicalAlerts?: string[];
    monitoringPlan?: MonitoringPlanItem[];
}

export const ResultsDisplay: React.FC<Props> = ({ results, isLoading, error, excludedMedications, clinicalAlerts = [], monitoringPlan = [] }) => {
    if (isLoading) return (
        <div className="flex flex-col items-center justify-center h-96 text-slate-400" role="status" aria-live="polite">
            <svg className="animate-spin h-10 w-10 mb-4 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="font-semibold text-lg">Simulating Clinical Outcomes...</span>
        </div>
    );

    return (
        <div className="space-y-8 pb-16">
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4" role="note" aria-live="polite">
                <p className="text-sm font-semibold text-amber-900">
                    This tool provides evidence-based decision support. Recommendations must be integrated with clinical judgment, patient preferences, and specialist consultation when available.
                </p>
            </div>

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

            <div className="flex items-end justify-between border-b border-slate-200 pb-4">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Treatment Options</h2>
                    <p className="text-slate-500 mt-1 text-sm">Ranked by projected benefit on CHF domains</p>
                </div>
                <span className="bg-slate-100 text-slate-600 text-sm font-bold px-3 py-1 rounded-full">{results.length} generated</span>
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
