
import React from 'react';
import { Patient } from '../types';

interface ClinicalSummaryProps {
    patient: Patient;
    drugPrices: Record<string, number>;
}

const DomainBar = ({ label, value, max, colorClass }: { label: string, value: number, max: number, colorClass: string }) => {
    const percent = Math.min(100, (value / max) * 100);
    return (
        <div className="mb-3">
            <div className="flex justify-between text-xs font-bold uppercase text-slate-500 mb-1.5 tracking-wide">
                <span>{label}</span>
                <span>{value.toFixed(0)} <span className="text-[10px] font-normal text-slate-400">/ {max}</span></span>
            </div>
            <div
                className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={Math.round(value)}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-label={`${label}: ${value.toFixed(0)} of ${max}`}
            >
                <div className={`h-full ${colorClass}`} style={{ width: `${percent}%` }}></div>
            </div>
        </div>
    );
};

export const ClinicalSummary: React.FC<ClinicalSummaryProps> = ({ patient, drugPrices }) => {
    const weightDiff = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const weightStatus = weightDiff > 0 ? `+${weightDiff.toFixed(1)} kg` : 'Euvolemic';
    const weightColor = weightDiff > 1 ? 'text-red-600' : 'text-emerald-600';

    // Renal Calculations
    const bunCrRatio = patient.creatinine > 0 ? patient.bun / patient.creatinine : 0;
    const isPrerenal = bunCrRatio > 20;

    // Calculate Current Cost & Complexity
    const currentCost = patient.current_regimen.reduce((acc, curr) => acc + (drugPrices[curr.med.name] ?? 20), 0);
    const currentComplexity = patient.current_regimen.reduce((acc, curr) => {
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
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mt-0.5">6-Domain Assessment</p>
            </div>

            <div className="p-5 space-y-6">
                {/* Neurohormonal */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="text-xs font-bold text-indigo-500 uppercase mb-3 tracking-wide">1. Neurohormonal</h3>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-black text-slate-900">{patient.nt_pro_bnp.toLocaleString()}</span>
                        <span className="text-sm text-slate-500 font-bold">pg/mL</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-500 font-medium">Target: &lt; 125 pg/mL</div>
                </div>

                {/* Functional */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="text-xs font-bold text-blue-500 uppercase mb-3 tracking-wide">2. Functional</h3>
                     <div className="flex justify-between items-center mb-2">
                        <div className="text-center flex-1">
                            <div className="text-2xl font-black text-slate-900">Class {patient.nyha_class}</div>
                            <div className="text-xs font-bold text-slate-400 uppercase mt-1">NYHA</div>
                        </div>
                        <div className="h-10 w-px bg-slate-100 mx-2"></div>
                        <div className="text-center flex-1">
                            <div className="text-2xl font-black text-slate-900">{patient.kccq_score}</div>
                            <div className="text-xs font-bold text-slate-400 uppercase mt-1">KCCQ Score</div>
                        </div>
                     </div>
                </div>

                {/* Volume */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="text-xs font-bold text-emerald-500 uppercase mb-3 tracking-wide">3. Volume Status</h3>
                     <div className={`text-2xl font-black ${weightColor} mb-1`}>{weightStatus}</div>
                     <div className="text-sm text-slate-500 mb-4 font-medium">vs Dry Weight ({patient.volume_status.dry_weight_kg} kg)</div>
                     
                     {patient.volume_status.exam_findings.size > 0 ? (
                         <div className="flex flex-wrap gap-1.5 mb-4">
                             {Array.from(patient.volume_status.exam_findings).map(f => (
                                 <span key={f} className="px-2 py-1 bg-red-50 text-red-600 text-xs font-bold uppercase rounded border border-red-100">{f}</span>
                             ))}
                         </div>
                     ) : <p className="text-sm italic text-slate-400 mb-4">No congestion signs</p>}

                     {/* Renal / Azotemia Check */}
                     <div className="pt-4 border-t border-slate-100">
                        <div className="flex justify-between text-sm mb-2">
                            <span className="text-slate-500 font-medium">BUN/Cr Ratio</span>
                            <span className={`font-bold ${isPrerenal ? 'text-amber-600' : 'text-slate-800'}`}>{bunCrRatio.toFixed(1)}</span>
                        </div>
                        {isPrerenal && (
                            <div className="bg-amber-50 border border-amber-100 text-amber-800 text-xs px-2 py-1.5 rounded font-bold mt-1 text-center">
                                Suggests Prerenal Azotemia
                            </div>
                        )}
                     </div>
                </div>

                {/* Structure */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="text-xs font-bold text-amber-500 uppercase mb-3 tracking-wide">4. Structure</h3>
                     <DomainBar label="LVEF" value={patient.lvef} max={60} colorClass="bg-amber-500" />
                     {patient.lvedd && (
                         <div className="text-sm font-medium text-slate-500 mt-2">LVEDD: <span className="text-slate-800">{patient.lvedd} mm</span></div>
                     )}
                </div>

                {/* Cost */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-3 tracking-wide">5. Cost Burden</h3>
                     <div className="flex items-baseline gap-2">
                        <span className={`text-2xl font-black ${currentCost > patient.max_affordable_cost ? 'text-red-600' : 'text-slate-900'}`}>${currentCost}</span>
                        <span className="text-sm text-slate-500 font-bold">/mo</span>
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-slate-400">
                        <span>Budget: ${patient.max_affordable_cost}</span>
                        <span>Sting: {patient.cost_sensitivity}</span>
                    </div>
                </div>

                {/* Adherence */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                     <h3 className="text-xs font-bold text-teal-500 uppercase mb-3 tracking-wide">6. Adherence</h3>
                     <div className="flex justify-between text-sm">
                         <span className="text-slate-500">Complexity Score</span>
                         <span className="font-bold text-slate-800">{currentComplexity} pts</span>
                     </div>
                     <div className="mt-2 text-xs text-slate-400">Tolerance: {patient.complexity_tolerance}</div>
                </div>
            </div>
        </div>
    );
};
