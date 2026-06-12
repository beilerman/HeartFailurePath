
import React, { useState } from 'react';
import type { ScoredRegimen, RegimenMed, RegimenModification, QualitativeProjection, TradeOffLabel } from '../types';
import { ScoreDetailModal } from './ScoreDetailModal';

interface Props {
    regimen: ScoredRegimen;
    rank: number;
}

const ScorePill = ({ label, score, color, onClick }: { label: string, score: number, color: string, onClick: () => void }) => (
    <button
        onClick={onClick}
        className="flex flex-col items-center group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-lg"
        aria-label={`${label} sub-score: ${score} out of 100. Click for details.`}
    >
        <div className={`h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold border-2 ${color} bg-white shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all cursor-pointer`}>
            {score}
        </div>
        <span className="text-[11px] font-bold text-slate-500 uppercase mt-1.5 tracking-wide group-hover:text-indigo-600 transition-colors">{label}</span>
    </button>
);

// --- Qualitative projection rendering (direction, not decimals) ---
const directionStyle: Record<QualitativeProjection['direction'], { dot: string; chip: string; arrow: string; sr: string }> = {
    improve: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 border-emerald-200 text-emerald-900', arrow: '↑', sr: 'improving' },
    stable: { dot: 'bg-slate-400', chip: 'bg-slate-50 border-slate-200 text-slate-700', arrow: '→', sr: 'stable' },
    caution: { dot: 'bg-amber-500', chip: 'bg-amber-50 border-amber-200 text-amber-900', arrow: '!', sr: 'caution' },
    worsen: { dot: 'bg-red-500', chip: 'bg-red-50 border-red-200 text-red-900', arrow: '↓', sr: 'worsening' },
};

const ProjectionRow = ({ p }: { p: QualitativeProjection }) => {
    const s = directionStyle[p.direction];
    return (
        <div className={`rounded-lg border px-3 py-2 ${s.chip}`}>
            <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${s.dot} flex-shrink-0`} aria-hidden="true"></span>
                <span className="text-xs font-bold uppercase tracking-wide">{p.label}</span>
                <span className="ml-auto text-sm font-bold" aria-hidden="true">{s.arrow}</span>
                <span className="sr-only">{s.sr}</span>
            </div>
            <p className="text-xs mt-1 leading-snug">{p.detail}</p>
        </div>
    );
};

const tradeOffTone: Record<TradeOffLabel['tone'], string> = {
    good: 'bg-emerald-100 text-emerald-800',
    neutral: 'bg-slate-100 text-slate-700',
    bad: 'bg-red-100 text-red-800',
};

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
        case 'titrate_up': return { text: '↑', className: 'bg-blue-100 text-blue-700' };
        case 'titrate_down': return { text: '↓', className: 'bg-blue-100 text-blue-700' };
        case 'swap': return { text: '⇄', className: 'bg-amber-100 text-amber-700' };
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
    titrate_up: '↑',
    titrate_down: '↓',
    swap: '⇄',
    remove: '−',
};

export const RecommendationCard: React.FC<Props> = ({ regimen, rank }) => {
    const { domain_scores } = regimen;
    const [selectedDomain, setSelectedDomain] = useState<string | null>(null);

    const projections = regimen.qualitative_projections ?? [];
    const tradeOffs = regimen.trade_offs ?? [];

    // Raw modeled estimates are still available, but only behind an explicit disclosure
    // with a "not a prediction" caveat — they are population-average effect sizes run
    // through uncalibrated curves, not individual forecasts.
    const projectedSbp = Math.round(regimen.projected_patient.sbp);
    const projectedDbp = Math.round(regimen.projected_patient.dbp);
    const weightDelta = (regimen.projected_patient.volume_status.current_weight_kg - regimen.projected_patient.volume_status.dry_weight_kg);

    return (
        <>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-slate-100">
                    <div className="flex items-center gap-2.5 mb-3">
                        <span className="bg-slate-200 text-slate-700 text-xs font-bold px-2 py-0.5 rounded" aria-label={`Option ${rank}`}>Option {rank}</span>
                        <h3 className="font-bold text-slate-900 text-lg">Guideline-Directed Regimen</h3>
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

                {/* Expected Direction (qualitative — replaces false-precision projected numbers) */}
                {projections.length > 0 && (
                    <div className="p-6 border-b border-slate-100">
                        <h4 className="text-sm font-bold text-slate-500 uppercase mb-1 tracking-wide">Expected Direction</h4>
                        <p className="text-[11px] text-slate-400 mb-3">Directional guidance only — not an individual prediction.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {projections.map((p, i) => <ProjectionRow key={i} p={p} />)}
                        </div>
                    </div>
                )}

                {/* Trade-offs (replaces composite-score emphasis) */}
                {tradeOffs.length > 0 && (
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                        <h4 className="text-xs font-bold text-slate-500 uppercase mb-2 tracking-wide">Trade-offs</h4>
                        <div className="flex flex-wrap gap-2">
                            {tradeOffs.map((t, i) => (
                                <span key={i} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${tradeOffTone[t.tone]}`}>
                                    <span className="opacity-70">{t.dimension}:</span> {t.label}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Dosing Rationale & Evidence Section */}
                <div className="p-6 border-t border-slate-100 bg-slate-50/30">
                    <h4 className="text-sm font-bold text-slate-500 uppercase mb-4 tracking-wide">Dosing Strategy & Evidence</h4>
                    <div className="space-y-4">
                        {regimen.regimen.map((item, idx) => {
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

                {/* Modeled estimates — behind explicit disclosure, with caveat */}
                <details className="group border-t border-slate-100">
                    <summary className="cursor-pointer list-none px-6 py-3 flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wide hover:text-slate-600">
                        <span>Modeled estimates &amp; domain sub-scores</span>
                        <span className="text-slate-300 group-open:rotate-180 transition-transform" aria-hidden="true">▾</span>
                    </summary>
                    <div className="px-6 pb-6">
                        <p className="text-[11px] text-slate-400 mb-4 leading-snug">
                            These are population-average effect sizes run through uncalibrated models — <span className="font-bold">not</span> a prediction for this patient. Shown for transparency only. The composite score is an internal ordering heuristic, not a clinical grade.
                        </p>
                        <div className="grid grid-cols-2 gap-y-2 gap-x-8 mb-5">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-medium text-slate-500">NT-proBNP (modeled)</span>
                                <span className="text-sm font-bold text-slate-700">~{Math.round(regimen.projected_patient.nt_pro_bnp)} pg/mL</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-medium text-slate-500">LVEF (modeled)</span>
                                <span className="text-sm font-bold text-slate-700">~{Math.round(regimen.projected_patient.lvef)}%</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-medium text-slate-500">BP (conservative)</span>
                                <span className="text-sm font-bold text-slate-700">~{projectedSbp}/{projectedDbp} mmHg</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-medium text-slate-500">Vs dry weight</span>
                                <span className="text-sm font-bold text-slate-700">{weightDelta >= 0 ? '+' : ''}{weightDelta.toFixed(1)} kg</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-medium text-slate-500">Monthly cost</span>
                                <span className="text-sm font-bold text-slate-700">${regimen.cost}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-medium text-slate-500">Composite (internal)</span>
                                <span className="text-sm font-bold text-slate-700">{regimen.overall_score}/100</span>
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mb-2">Domain sub-scores — tap for detail</p>
                        <div className="grid grid-cols-4 gap-y-4 gap-x-3">
                            <ScorePill label="Neuro" score={domain_scores.neurohormonal} color="border-indigo-500 text-indigo-600" onClick={() => setSelectedDomain('Neurohormonal')} />
                            <ScorePill label="Function" score={domain_scores.functional} color="border-blue-500 text-blue-600" onClick={() => setSelectedDomain('Functional')} />
                            <ScorePill label="Volume" score={domain_scores.volume} color="border-emerald-500 text-emerald-600" onClick={() => setSelectedDomain('Volume')} />
                            <ScorePill label="Structure" score={domain_scores.structure} color="border-amber-500 text-amber-600" onClick={() => setSelectedDomain('Structure')} />
                            <ScorePill label="Guideline" score={domain_scores.guideline} color="border-rose-500 text-rose-600" onClick={() => setSelectedDomain('Guideline')} />
                            <ScorePill label="Cost" score={domain_scores.cost} color="border-slate-500 text-slate-600" onClick={() => setSelectedDomain('Cost')} />
                            <ScorePill label="Adherence" score={domain_scores.adherence} color="border-teal-500 text-teal-600" onClick={() => setSelectedDomain('Adherence')} />
                        </div>
                    </div>
                </details>
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
