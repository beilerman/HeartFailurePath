
import React, { useState } from 'react';
import { MEDICATION_FORMULARY } from '../constants';
import { Medication } from '../types';
import { HeartIcon, ActivityIcon, WarningIcon, BeakerIcon } from './icons';

const MedCard: React.FC<{ med: Medication }> = ({ med }) => {
    // Get a representative dose (middle of range) for display purposes
    const repDose = med.available_doses[Math.floor(med.available_doses.length / 2)].strength;
    const chfEffects = med.chf_effects(repDose);
    const hemoEffects = med.hemodynamic_effects(repDose);
    const sideEffects = med.side_effects(repDose);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                <div className="flex justify-between items-start mb-2">
                    <div>
                        <h3 className="font-bold text-lg text-slate-900 leading-tight">{med.name}</h3>
                        <span className="inline-block mt-1 text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 uppercase tracking-wide">
                            {med.drug_class}
                        </span>
                    </div>
                    {med.is_best_in_class && (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100 uppercase">Top Tier</span>
                    )}
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                    {med.available_doses.map((d, i) => (
                        <span key={i} className="text-xs text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                            {d.strength}{d.unit}
                        </span>
                    ))}
                </div>
            </div>

            <div className="p-4 space-y-4 flex-1">
                {/* CHF Impact */}
                <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                        <HeartIcon className="w-3 h-3" /> Clinical Impact (Est.)
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="bg-slate-50 p-2 rounded border border-slate-100">
                            <div className="text-slate-500 text-xs">LVEF</div>
                            <div className={`font-bold ${chfEffects.lvef_improvement_absolute > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {chfEffects.lvef_improvement_absolute > 0 ? `+${chfEffects.lvef_improvement_absolute}%` : 'Neutral'}
                            </div>
                        </div>
                        <div className="bg-slate-50 p-2 rounded border border-slate-100">
                            <div className="text-slate-500 text-xs">Weight</div>
                            <div className={`font-bold ${chfEffects.weight_reduction_kg > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {chfEffects.weight_reduction_kg > 0 ? `-${chfEffects.weight_reduction_kg}kg` : 'Neutral'}
                            </div>
                        </div>
                         <div className="bg-slate-50 p-2 rounded border border-slate-100">
                            <div className="text-slate-500 text-xs">BNP Red.</div>
                            <div className={`font-bold ${chfEffects.bnp_reduction_percent > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {chfEffects.bnp_reduction_percent > 0 ? `-${(chfEffects.bnp_reduction_percent * 100).toFixed(0)}%` : 'Neutral'}
                            </div>
                        </div>
                         <div className="bg-slate-50 p-2 rounded border border-slate-100">
                            <div className="text-slate-500 text-xs">KCCQ</div>
                            <div className={`font-bold ${chfEffects.kccq_improvement > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                {chfEffects.kccq_improvement > 0 ? `+${chfEffects.kccq_improvement}` : 'Neutral'}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Hemodynamics */}
                <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                        <ActivityIcon className="w-3 h-3" /> Hemodynamics
                    </h4>
                    <div className="text-sm text-slate-600 flex justify-between items-center border-b border-slate-100 pb-1 mb-1">
                        <span>SBP Effect</span>
                        <span className="font-medium">-{hemoEffects.sbp_drop.toFixed(0)} mmHg</span>
                    </div>
                    <div className="text-sm text-slate-600 flex justify-between items-center border-b border-slate-100 pb-1 mb-1">
                        <span>HR Effect</span>
                        <span className="font-medium">-{hemoEffects.hr_drop.toFixed(0)} bpm</span>
                    </div>
                     <div className="text-sm text-slate-600 flex justify-between items-center">
                        <span>K+ Effect</span>
                        <span className={`font-medium ${hemoEffects.potassium_change > 0 ? 'text-amber-600' : hemoEffects.potassium_change < 0 ? 'text-blue-600' : 'text-slate-400'}`}>
                            {hemoEffects.potassium_change > 0 ? '+' : ''}{hemoEffects.potassium_change.toFixed(1)}
                        </span>
                    </div>
                </div>

                {/* Side Effects & Cautions */}
                <div>
                    <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
                        <WarningIcon className="w-3 h-3" /> Profile
                    </h4>
                    <div className="flex flex-wrap gap-1">
                        {Object.keys(sideEffects).map(se => (
                            <span key={se} className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 border border-red-100 rounded uppercase font-bold">
                                {se.replace(/_/g, ' ')}
                            </span>
                        ))}
                        {Object.keys(sideEffects).length === 0 && <span className="text-xs text-slate-400 italic">Generally well tolerated</span>}
                    </div>
                </div>
            </div>
        </div>
    );
};

export const MedicationLibrary: React.FC = () => {
    const [filterClass, setFilterClass] = useState<string>('All');
    const [searchQuery, setSearchQuery] = useState<string>('');
    
    const classes = ['All', ...new Set(MEDICATION_FORMULARY.map(m => m.drug_class))];
    
    const filteredMeds = MEDICATION_FORMULARY.filter(m => {
        const matchesClass = filterClass === 'All' || m.drug_class === filterClass;
        const query = searchQuery.toLowerCase();
        const matchesSearch = m.name.toLowerCase().includes(query) || 
                              m.drug_class.toLowerCase().includes(query);
        return matchesClass && matchesSearch;
    });

    return (
        <div className="h-full overflow-y-auto bg-slate-50 custom-scrollbar p-8">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-end mb-8 border-b border-slate-200 pb-6">
                    <div className="mb-4 md:mb-0 max-w-2xl">
                        <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                            <BeakerIcon className="w-8 h-8 text-indigo-600" />
                            Medication Library
                        </h2>
                        <p className="text-slate-500 mt-2 text-lg">
                            Evidence-based characteristics of formulary agents for HFrEF optimization.
                        </p>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <svg className="h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <input
                                type="text"
                                placeholder="Search by name..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="block w-full md:w-64 rounded-md border-slate-300 pl-10 py-2 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm shadow-sm"
                            />
                        </div>

                         <select 
                            value={filterClass}
                            onChange={(e) => setFilterClass(e.target.value)}
                            className="block w-full md:w-48 rounded-md border-slate-300 py-2 pl-3 pr-10 text-base focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm shadow-sm"
                        >
                            {classes.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                {filteredMeds.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-slate-500 text-lg">No medications found matching your search.</p>
                        <button 
                            onClick={() => { setSearchQuery(''); setFilterClass('All'); }}
                            className="mt-4 text-indigo-600 font-bold hover:underline"
                        >
                            Clear filters
                        </button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {filteredMeds.map(med => (
                            <MedCard key={med.name} med={med} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
