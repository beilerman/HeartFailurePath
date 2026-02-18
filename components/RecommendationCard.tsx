
import React, { useState } from 'react';
import type { ScoredRegimen, RegimenMed, RegimenModification } from '../types';
import { ScoreDetailModal } from './ScoreDetailModal';

interface Props {
    regimen: ScoredRegimen;
    rank: number;
}

const ScorePill = ({ label, score, color, onClick }: { label: string, score: number, color: string, onClick: () => void }) => (
    <button
        onClick={onClick}
        className="flex flex-col items-center group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-lg"
        aria-label={`${label} score: ${score} out of 100. Click for details.`}
    >
        <div className={`h-12 w-12 rounded-full flex items-center justify-center text-base font-bold border-2 ${color} bg-white shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all cursor-pointer`}>
            {score}
        </div>
        <span className="text-xs font-bold text-slate-500 uppercase mt-1.5 tracking-wide group-hover:text-indigo-600 transition-colors">{label}</span>
    </button>
);

const getDosingRationale = (item: RegimenMed): string => {
    const { med, dose } = item;
    const isTarget = dose.is_target_dose;

    if (med.drug_class === 'SGLT2i') {
        return "Standard fixed dosing per DAPA-HF / EMPEROR-Reduced trials. No titration required.";
    }

    if (med.drug_class === 'Loop Diuretic') {
        return "Dosed for symptomatic volume management. Adjust based on daily weights.";
    }

    if (med.drug_class === 'GLP-1 RA' || med.drug_class === 'GLP-1/GIP RA') {
        if (isTarget) return "Target dose for maximal weight loss and KCCQ benefit (STEP-HFpEF / SUMMIT).";
        return "Initiation dose. Titrate monthly to target to minimize GI side effects.";
    }

    if (isTarget) {
        if (med.drug_class === 'Beta Blocker') return "Target dose associated with maximal mortality reduction (MERIT-HF / COPERNICUS).";
        if (med.drug_class === 'ARNI') return "Target dose achieving maximal reverse remodeling and survival benefit (PARADIGM-HF).";
        if (med.drug_class === 'MRA') return "Evidence-based target dose for anti-fibrotic benefit (RALES / EPHESUS).";
        return "Achieves guideline-directed target dose.";
    } else {
        if (med.drug_class === 'Beta Blocker') return "Evidence-based starting/intermediate dose. Titrate q2 weeks to target as HR tolerates.";
        if (med.drug_class === 'ARNI') return "Initiation dose. Titrate q2-4 weeks to target 97/103 mg BID.";
        return "Effective therapeutic dose; titrate to target if tolerated.";
    }
};

const getModForMed = (regimen: ScoredRegimen, item: RegimenMed): RegimenModification | undefined =>
    regimen.modification_set?.modifications.find(m =>
        (m.target?.med.name === item.med.name) ||
        (m.action === 'keep' && m.source?.med.name === item.med.name)
    );

const getModBadge = (mod: RegimenModification | undefined): { text: string; className: string } | null => {
    if (!mod) return null;
    switch (mod.action) {
        case 'add': return { text: 'NEW', className: 'bg-emerald-100 text-emerald-700' };
        case 'titrate_up': return { text: '\u2191', className: 'bg-blue-100 text-blue-700' };
        case 'titrate_down': return { text: '\u2193', className: 'bg-blue-100 text-blue-700' };
        case 'swap': return { text: '\u21C4', className: 'bg-amber-100 text-amber-700' };
        case 'keep': return null;
        case 'remove': return null; // removed meds won't be in resulting regimen
        default: return null;
    }
};

const modActionColor: Record<string, string> = {
    add: 'text-emerald-700',
    titrate_up: 'text-blue-700',
    titrate_down: 'text-blue-700',
    swap: 'text-amber-700',
    remove: 'text-red-700',
};

const modActionIcon: Record<string, string> = {
    add: '+',
    titrate_up: '\u2191',
    titrate_down: '\u2193',
    swap: '\u21C4',
    remove: '\u2212',
};

export const RecommendationCard: React.FC<Props> = ({ regimen, rank }) => {
    const { domain_scores } = regimen;
    const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

    // Determine Cost Color
    const costColor = domain_scores.cost < 50 ? "text-red-600" : "text-slate-900";
    const projectedSbp = Math.round(regimen.projected_patient.sbp);
    const projectedDbp = Math.round(regimen.projected_patient.dbp);
    const bloodPressureColor = projectedSbp < 90 ? "text-red-600" : projectedSbp < 100 ? "text-amber-600" : "text-slate-900";

    return (
        <>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-2.5 mb-2.5">
                            <span className="bg-indigo-600 text-white text-sm font-bold px-2.5 py-0.5 rounded">#{rank}</span>
                            <h3 className="font-bold text-slate-900 text-lg">Optimized CHF Protocol</h3>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {regimen.regimen.map((r, i) => {
                                const mod = getModForMed(regimen, r);
                                const badge = getModBadge(mod);
                                return (
                                    <span key={i} className="text-sm text-slate-700 bg-slate-50 px-2.5 py-1 rounded border border-slate-200 font-semibold flex items-center gap-1">
                                        {r.dose.is_target_dose && <><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true"></span><span className="sr-only">Target Dose</span></>}
                                        {r.med.name} <span className="text-slate-500 font-normal ml-1">{r.dose.strength}{r.dose.unit}</span>
                                        {badge && (
                                            <span className={`ml-1 text-[10px] font-bold px-1 py-0.5 rounded ${badge.className}`}>
                                                {badge.text}
                                            </span>
                                        )}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                    <div className="text-center">
                        <div className="text-4xl font-black text-indigo-600 leading-none">{regimen.overall_score}</div>
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-1">Composite Score</div>
                    </div>
                </div>

                {/* Change Summary Banner */}
                {regimen.modification_set && regimen.modification_set.modifications.some(m => m.action !== 'keep') && (
                    <div className="px-6 py-4 border-b border-slate-100 bg-indigo-50/50">
                        <h4 className="text-xs font-bold text-indigo-700 uppercase mb-2 tracking-wide">Changes for This Visit</h4>
                        <div className="space-y-1">
                            {regimen.modification_set.modifications
                                .filter(m => m.action !== 'keep')
                                .map((m, i) => (
                                    <div key={i} className={`text-sm font-medium flex items-center gap-2 ${modActionColor[m.action] || 'text-slate-700'}`}>
                                        <span className="font-bold w-4 text-center">{modActionIcon[m.action] || ''}</span>
                                        {m.summary}
                                    </div>
                                ))
                            }
                        </div>
                    </div>
                )}

                {/* Projected Metrics - 6 Domains */}
                <div className="p-6 bg-slate-50/50 relative">
                    <p className="absolute top-2 right-2 text-[10px] text-slate-400 font-medium uppercase tracking-wider">Click scores for details</p>
                    <div className="grid grid-cols-4 gap-y-5 gap-x-3">
                        <ScorePill label="Neuro" score={domain_scores.neurohormonal} color="border-indigo-500 text-indigo-600" onClick={() => setSelectedDomain('Neurohormonal')} />
                        <ScorePill label="Function" score={domain_scores.functional} color="border-blue-500 text-blue-600" onClick={() => setSelectedDomain('Functional')} />
                        <ScorePill label="Volume" score={domain_scores.volume} color="border-emerald-500 text-emerald-600" onClick={() => setSelectedDomain('Volume')} />
                        <ScorePill label="Structure" score={domain_scores.structure} color="border-amber-500 text-amber-600" onClick={() => setSelectedDomain('Structure')} />
                        <ScorePill label="Guideline" score={domain_scores.guideline} color="border-rose-500 text-rose-600" onClick={() => setSelectedDomain('Guideline')} />
                        <ScorePill label="Cost" score={domain_scores.cost} color="border-slate-500 text-slate-600" onClick={() => setSelectedDomain('Cost')} />
                        <ScorePill label="Adherence" score={domain_scores.adherence} color="border-teal-500 text-teal-600" onClick={() => setSelectedDomain('Adherence')} />
                    </div>
                </div>

                {/* Impact Summary */}
                <div className="p-6 border-t border-slate-100">
                    <h4 className="text-sm font-bold text-slate-500 uppercase mb-3 tracking-wide">Projected Impact</h4>
                    <div className="grid grid-cols-2 gap-y-3 gap-x-8">
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-slate-500">NT-proBNP</span>
                            <span className="text-base font-bold text-slate-900">{Math.round(regimen.projected_patient.nt_pro_bnp)} pg/mL</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-slate-500">LVEF</span>
                            <span className="text-base font-bold text-slate-900">{regimen.projected_patient.lvef.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-slate-500">Blood Pressure</span>
                            <span className={`text-base font-bold ${bloodPressureColor}`}>
                                {projectedSbp}/{projectedDbp} <span className="text-xs font-normal text-slate-400">mmHg</span>
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-slate-500">Weight Change</span>
                            <span className="text-base font-bold text-emerald-600">
                                {(regimen.projected_patient.volume_status.current_weight_kg - regimen.projected_patient.volume_status.dry_weight_kg).toFixed(1)} kg
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-slate-500">Total Cost</span>
                            <span className={`text-base font-bold ${costColor}`}>${regimen.cost}<span className="text-xs font-normal text-slate-400">/mo</span></span>
                        </div>
                    </div>
                </div>

                {/* NEW: Dosing Rationale & Evidence Section */}
                <div className="p-6 border-t border-slate-100 bg-slate-50/30">
                    <h4 className="text-sm font-bold text-slate-500 uppercase mb-4 tracking-wide">Dosing Strategy & Evidence</h4>
                    <div className="space-y-4">
                        {regimen.regimen.map((item, idx) => {
                            // Extract simulation benefits specific to this drug
                            const specificBenefits = regimen.rationale
                                .filter(r => r.includes(item.med.name))
                                .map(r => r.replace(`+ ${item.med.name}: `, ''));

                            return (
                                <div key={idx} className="flex gap-4 items-start">
                                    <div className="w-1/3 shrink-0">
                                        <div className="font-bold text-sm text-slate-900">{item.med.name}</div>
                                        <div className="text-xs font-semibold text-indigo-600">{item.dose.strength}{item.dose.unit} {item.selected_frequency}</div>
                                        {item.dose.is_target_dose && (
                                            <span className="inline-block mt-1 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                                Target Dose
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-xs text-slate-700 font-medium leading-relaxed mb-1.5">
                                            {getDosingRationale(item)}
                                        </p>
                                        {specificBenefits.length > 0 && (
                                            <ul className="space-y-0.5">
                                                {specificBenefits.map((b, i) => (
                                                    <li key={i} className="text-[11px] text-slate-500 flex items-start gap-1.5">
                                                        <span className="mt-1 h-1 w-1 rounded-full bg-slate-400 shrink-0" aria-hidden="true"></span>
                                                        {b}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* General Warnings */}
                {regimen.warnings.length > 0 && (
                    <div className="p-6 border-t border-slate-100 bg-amber-50">
                        <h4 className="text-xs font-bold text-amber-700 uppercase mb-1.5">Safety & Adherence Alerts</h4>
                        <ul className="space-y-1">
                            {regimen.warnings.map(w => (
                                <li key={w} className="text-sm text-amber-900 leading-relaxed flex items-start gap-2">
                                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" aria-hidden="true"></span>
                                    {w}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            {selectedDomain && (
                <ScoreDetailModal
                    domain={selectedDomain}
                    score={regimen.domain_scores[selectedDomain.toLowerCase() as keyof typeof regimen.domain_scores] || 0}
                    regimen={regimen}
                    onClose={() => setSelectedDomain(null)}
                />
            )}
        </>
    );
};
