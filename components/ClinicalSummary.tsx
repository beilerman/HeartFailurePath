import { isActiveExposure } from '../services/engine/medicationExposure';

import React from 'react';
import { Patient } from '../types';
import { monthlyMedicationCost } from '../services/medicationCost';
import { volumeDescription } from './clinicalPresentation';
import { congestionFindingCount } from '../services/clinicalPredicates';
import { isCongestedAboveDryWeight } from '../services/engine/regimenUtils';

interface ClinicalSummaryProps {
    patient: Patient;
    drugPrices: Record<string, number>;
}

export const ClinicalSummary: React.FC<ClinicalSummaryProps> = ({ patient, drugPrices }) => {
    const weightDiff = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    // Three-band status mirroring PhysicalExamSection: Overload > +1.0, Volume Depleted < -1.0, else Euvolemic.
    const isOverloaded = isCongestedAboveDryWeight(patient);
    const hasFindings = congestionFindingCount(patient.volume_status.exam_findings) > 0;
    const isDehydrated = Number.isFinite(weightDiff) && weightDiff < -1.0;
    const weightStatus = volumeDescription(patient);
    const weightColor = isOverloaded ? 'text-red-600' : (isDehydrated || hasFindings) ? 'text-amber-600' : 'text-slate-700';

    // Renal Calculations
    const bunCrRatio = patient.creatinine > 0 && patient.bun != null ? patient.bun / patient.creatinine : 0;
    const isPrerenal = bunCrRatio > 20;

    // Calculate Current Cost & Complexity
    const currentPrices = patient.current_regimen.filter(isActiveExposure).map(curr => monthlyMedicationCost(curr, patient.insurance_tier, drugPrices));
    const hasUnknownCurrentCost = currentPrices.some(price => price === undefined || !Number.isFinite(price));
    const currentCost = hasUnknownCurrentCost
        ? null
        : currentPrices.reduce<number>((acc, price) => acc + (price ?? 0), 0);
    const currentComplexity = patient.current_regimen.filter(isActiveExposure).reduce((acc, curr) => {
        let val = 1;
        if (curr.dose.formulation.includes('SQ')) val = 2;
        else if (curr.selected_frequency === 'bid') val = 2;
        else if (curr.selected_frequency === 'tid') val = 4;
        return acc + val;
    }, 0);

    return (
        <div className="flex flex-col h-full bg-slate-50/50 overflow-y-auto custom-scrollbar">
            <div className="p-5 border-b border-slate-200 bg-white sticky top-0 z-10 shadow-sm">
                <h2 className="font-black text-slate-800 text-xl">Patient Status</h2>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mt-0.5">Current findings, as entered</p>
            </div>

            <div className="p-5 space-y-6">
                {/* Neurohormonal */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="text-xs font-bold text-indigo-500 uppercase mb-3 tracking-wide">Natriuretic peptide</h3>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black text-slate-900">{patient.nt_pro_bnp > 0 ? patient.nt_pro_bnp.toLocaleString() : 'Not entered'}</span>
                        <span className="text-sm text-slate-500 font-bold">pg/mL</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-500 font-medium">Measured value as entered; interpret with the clinical assessment.</div>
                </div>

                {/* Functional */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="text-xs font-bold text-blue-500 uppercase mb-3 tracking-wide">Symptoms and function</h3>
                     <div className="flex justify-between items-center mb-2">
                        <div className="text-center flex-1">
                            <div className="text-2xl font-black text-slate-900">Class {patient.nyha_class}</div>
                            <div className="text-xs font-bold text-slate-400 uppercase mt-1">NYHA</div>
                        </div>
                        <div className="h-10 w-px bg-slate-100 mx-2"></div>
                        <div className="text-center flex-1">
                            <div className="text-2xl font-black text-slate-900">{patient.kccq_score ?? '—'}</div><p className="text-xs text-slate-500">{patient.kccq_instrument ?? 'Instrument not recorded'}</p>
                            <div className="text-xs font-bold text-slate-400 uppercase mt-1">KCCQ Score</div>
                        </div>
                     </div>
                </div>

                {/* Volume */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="text-xs font-bold text-emerald-500 uppercase mb-3 tracking-wide">Volume status</h3>
                     <p className={`text-sm font-semibold leading-relaxed ${weightColor} mb-1`}>{weightStatus}</p>
                     <div className="text-sm text-slate-500 mb-4 font-medium">{patient.volume_status.dry_weight_kg != null ? `vs dry weight (${patient.volume_status.dry_weight_kg} kg)` : 'Dry weight not entered'}</div>
                     
                     {patient.volume_status.exam_findings.size > 0 ? (
                         <div className="flex flex-wrap gap-1.5 mb-4">
                             {Array.from(patient.volume_status.exam_findings).map(f => (
                                 <span key={f} className="px-2 py-1 bg-red-50 text-red-600 text-xs font-bold uppercase rounded border border-red-100">{f}</span>
                             ))}
                         </div>
                     ) : <p className="text-sm text-slate-600 mb-4">No examination findings recorded.</p>}

                     {/* Renal / Azotemia Check */}
                     <div className="pt-4 border-t border-slate-100">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-slate-500 font-medium">BUN/Cr Ratio</span>
                            <span className={`font-bold ${isPrerenal ? 'text-amber-600' : 'text-slate-800'}`}>{bunCrRatio > 0 ? bunCrRatio.toFixed(1) : '\u2014'}</span>
                        </div>
                        {isPrerenal && (
                            <div className="bg-amber-50 border border-amber-100 text-amber-800 text-xs px-2 py-1.5 rounded font-bold mt-1 text-center">
                                Elevated BUN/creatinine ratio — assess perfusion and other causes
                            </div>
                        )}
                     </div>
                </div>

                {/* Structure */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="text-xs font-bold text-amber-500 uppercase mb-3 tracking-wide">Heart structure</h3>
                     <p className="text-sm text-slate-700">LVEF <strong className="text-2xl text-slate-900">{patient.lvef > 0 ? `${patient.lvef}%` : 'Not entered'}</strong></p>
                     {patient.lvedd && (
                         <div className="text-sm font-medium text-slate-500 mt-2">LVEDD: <span className="text-slate-800">{patient.lvedd} mm</span></div>
                     )}
                </div>

                {/* Cost */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 tracking-wide">Estimated current medication cost</h3>
                     <div className="flex items-baseline gap-2">
                        <span className={`text-2xl font-black ${currentCost !== null && currentCost > patient.max_affordable_cost ? 'text-red-600' : 'text-slate-900'}`}>
                            {currentCost === null ? 'Unavailable' : `$${currentCost}`}
                        </span>
                        {currentCost !== null && <span className="text-sm text-slate-500 font-bold">/mo</span>}
                    </div>
                    {currentCost === null && (
                        <p className="text-xs text-amber-700 font-semibold mt-2">
                            Current regimen cost will appear after pricing data loads.
                        </p>
                    )}
                    <div className="flex justify-between mt-2 text-xs text-slate-500">
                        <span>Budget: ${patient.max_affordable_cost ?? '—'}</span>
                        <span>Cost sensitivity: {patient.cost_sensitivity} of 10</span>
                    </div>
                </div>

                {/* Adherence */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="text-xs font-bold text-teal-500 uppercase mb-3 tracking-wide">Complexity of current regimen</h3>
                     <div className="flex justify-between text-sm">
                         <span className="text-slate-500">Complexity Score</span>
                         <span className="font-bold text-slate-800">{currentComplexity} pts</span>
                     </div>
                     <div className="mt-2 text-xs text-slate-500">Patient tolerance: {patient.complexity_tolerance} of 10</div>
                </div>
            </div>
        </div>
    );
};
