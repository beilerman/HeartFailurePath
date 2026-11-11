
import React, { useState } from 'react';
import type { Patient, ScoredRegimen, RegimenMed, RegimenModification, QualitativeProjection, TradeOffLabel, DomainScores } from '../types';
import { ScoreDetailModal } from './ScoreDetailModal';
import { ScoreComparisonLine } from './ScoreComparison';
import { Disclosure } from './Disclosure';
import { useEvidenceLink } from './EvidenceContext';
import { evidenceRowsForDrug, drugSearchTerm } from './evidenceMatrix';
import { partitionWarnings, stripDrugNotePrefix, isOverBudgetFallback } from './resultsModel';
import { DOMAIN_LABELS, DOMAIN_GROUPS, type ScoreDomainKey } from '../services/engine/scoreModel';
import { getTargetDosePatientContext, isTargetDoseForPatient } from '../services/simulationService';

interface Props {
    regimen: ScoredRegimen;
    rank: number;
    /** Option 1, so options 2 and 3 can say why they ranked lower. Omit for option 1. */
    leader?: ScoredRegimen;
    /** True when the foundational ranking mode is applied to this run (HFrEF/HFimpEF): shows the coverage line. */
    showFoundationalCoverage?: boolean;
}

const ScorePill = ({ label, fullLabel, score, color, onClick }: { label: string, fullLabel: string, score: number, color: string, onClick: () => void }) => (
    <button
        onClick={onClick}
        className="flex flex-col items-center group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-lg"
        aria-label={`${fullLabel} sub-score: ${score} out of 100. Click for details.`}
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

const getDosingRationale = (item: RegimenMed, patient: Patient): string => {
    const { med } = item;
    const isTarget = isTargetDoseForPatient(item, patient);

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

// Short pill labels and colours, keyed by the engine's domain keys. Full names come from the
// engine's DOMAIN_LABELS; the compiler checks both maps cover every domain.
const PILL_SHORT_LABELS = {
    neurohormonal: 'Neuro',
    functional: 'Function',
    volume: 'Volume',
    structure: 'Structure',
    guideline: 'Guideline',
    completeness: 'Complete',
    cost: 'Cost',
    adherence: 'Adherence',
} as const satisfies Record<ScoreDomainKey, string>;
const PILL_COLORS = {
    neurohormonal: 'border-indigo-500 text-indigo-600',
    functional: 'border-blue-500 text-blue-600',
    volume: 'border-emerald-500 text-emerald-600',
    structure: 'border-amber-500 text-amber-600',
    guideline: 'border-rose-500 text-rose-600',
    completeness: 'border-purple-500 text-purple-600',
    cost: 'border-slate-500 text-slate-600',
    adherence: 'border-teal-500 text-teal-600',
} as const satisfies Record<ScoreDomainKey, string>;
// Compile-time guard that DomainScores and the engine's keys stay in step.
const _domainKeysMatch: Record<keyof DomainScores, true> = { neurohormonal: true, functional: true, volume: true, structure: true, cost: true, adherence: true, guideline: true, completeness: true };
void _domainKeysMatch;

export const RecommendationCard = React.memo(function RecommendationCard({ regimen, rank, leader, showFoundationalCoverage = false }: Props) {
    const { domain_scores } = regimen;
    const [selectedDomain, setSelectedDomain] = useState<ScoreDomainKey | null>(null);
    const [showLedger, setShowLedger] = useState(false);
    const targetDoseContext = getTargetDosePatientContext(regimen);
    const { openEvidence } = useEvidenceLink();
    const { safety: safetyWarnings, notes: prescribingNotes } = partitionWarnings(regimen.warnings);

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
                        <h3 className="font-bold text-slate-900 text-lg">{rank === 1 ? 'Top-ordered regimen' : 'Alternative regimen'}</h3>
                        {isOverBudgetFallback(regimen) && (
                            <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded border border-red-300">Over budget: not affordable as entered</span>
                        )}
                    </div>
                    {showFoundationalCoverage && regimen.foundational_coverage !== undefined && (
                        <p className="text-xs font-semibold text-slate-600 mb-3">Foundational coverage {Math.round(regimen.foundational_coverage)}%</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {regimen.regimen.map((r, i) => {
                            const mod = getModForMed(regimen, r);
                            const badge = getModBadge(mod);
                            const isTarget = isTargetDoseForPatient(r, targetDoseContext);
                            return (
                                <span key={i} className="text-sm text-slate-700 bg-slate-50 px-2.5 py-1 rounded border border-slate-200 font-semibold flex items-center gap-1">
                                    {isTarget && <><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true"></span><span className="sr-only">Target Dose</span></>}
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

                {/* Safety warnings stay prominent; procedural "Drug note" strings are grouped and collapsed */}
                {safetyWarnings.length > 0 && (
                    <div className="px-6 py-4 border-b border-amber-200 bg-amber-50">
                        <h4 className="text-xs font-bold text-amber-900 uppercase mb-1.5 tracking-wide">Safety warnings ({safetyWarnings.length})</h4>
                        <ul className="space-y-1.5">
                            {safetyWarnings.map(w => (
                                <li key={w} className="text-sm text-amber-950 leading-relaxed flex items-start gap-2">
                                    <svg className="w-4 h-4 mt-0.5 text-amber-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-2.5L13.73 4c-.77-.83-1.96-.83-2.73 0L3.34 16.5C2.57 17.33 3.53 19 5.07 19z" /></svg>
                                    <span><span className="sr-only">Warning: </span>{w}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {prescribingNotes.length > 0 && (
                    <Disclosure
                        className="border-b border-slate-100 bg-slate-50/60"
                        buttonClassName="px-6 py-3 text-xs font-bold text-slate-700 uppercase tracking-wide hover:bg-slate-100"
                        title={`Prescribing notes (${prescribingNotes.length})`}
                    >
                        <ul className="px-6 pb-4 space-y-1.5">
                            {prescribingNotes.map(n => (
                                <li key={n} className="text-sm text-slate-700 leading-relaxed flex items-start gap-2">
                                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-slate-400 flex-shrink-0" aria-hidden="true"></span>
                                    {stripDrugNotePrefix(n)}
                                </li>
                            ))}
                        </ul>
                    </Disclosure>
                )}

                {/* Expected Direction (qualitative — replaces false-precision projected numbers) */}
                {projections.length > 0 && (
                    <div className="p-6 border-b border-slate-100">
                        <h4 className="text-sm font-bold text-slate-500 uppercase mb-1 tracking-wide">Expected Direction</h4>
                        <p className="text-xs text-slate-600 mb-3">Directional guidance only — not an individual prediction.</p>
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
                    <h4 className="text-sm font-bold text-slate-600 uppercase mb-4 tracking-wide">Dosing Strategy & Evidence</h4>
                    <div className="space-y-4">
                        {regimen.regimen.map((item, idx) => {
                            const isTarget = isTargetDoseForPatient(item, targetDoseContext);
                            const specificBenefits = regimen.rationale
                                .filter(r => r.includes(item.med.name))
                                .map(r => r.replace(`+ ${item.med.name}: `, ''));

                            return (
                                <div key={idx} className="flex gap-4 items-start">
                                    <div className="w-1/3 shrink-0">
                                        <div className="font-bold text-sm text-slate-900">{item.med.name}</div>
                                        <div className="text-xs font-semibold text-indigo-600">{item.dose.strength}{item.dose.unit} {item.selected_frequency}</div>
                                        {isTarget && (
                                            <span className="inline-block mt-1 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                                Target Dose
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-xs text-slate-700 font-medium leading-relaxed mb-1.5">
                                            {getDosingRationale(item, targetDoseContext)}
                                        </p>
                                        {evidenceRowsForDrug(item.med.name).length > 0 && (
                                            <button type="button" onClick={() => openEvidence(drugSearchTerm(item.med.name))} className="mb-1.5 text-xs font-bold text-indigo-700 underline hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
                                                Evidence for {drugSearchTerm(item.med.name)} ({evidenceRowsForDrug(item.med.name).length})
                                            </button>
                                        )}
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

                {/* Modeled estimates — behind explicit disclosure, with caveat */}
                <Disclosure
                    className="border-t border-slate-100"
                    buttonClassName="px-6 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide hover:text-slate-800"
                    title="Modeled estimates &amp; domain sub-scores"
                >
                    <div className="px-6 pb-6">
                        <p className="text-xs text-slate-600 mb-4 leading-snug">
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
                            {regimen.score_breakdown && (
                                <button
                                    type="button"
                                    onClick={() => setShowLedger(true)}
                                    className="col-span-2 text-left text-xs font-bold text-indigo-600 hover:text-indigo-800 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                                >
                                    How this score was calculated
                                </button>
                            )}
                            {leader && <ScoreComparisonLine regimen={regimen} leader={leader} rank={rank} foundationalOrder={showFoundationalCoverage} />}
                        </div>
                        <p className="text-[11px] text-slate-600 font-medium uppercase tracking-wider mb-2">Domain sub-scores — tap for detail</p>
                        <div className="space-y-3">
                            {DOMAIN_GROUPS.map(g => (
                                <div key={g.key} role="group" aria-label={g.label}>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{g.label}</p>
                                    <div className="grid grid-cols-4 gap-y-3 gap-x-3">
                                        {g.domains.map(k => (
                                            <ScorePill key={k} label={PILL_SHORT_LABELS[k]} fullLabel={DOMAIN_LABELS[k]} score={domain_scores[k]} color={PILL_COLORS[k]} onClick={() => setSelectedDomain(k)} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </Disclosure>
            </div>

            {showLedger && regimen.score_breakdown && (
                <ScoreDetailModal
                    domain="overall"
                    score={regimen.overall_score}
                    regimen={regimen}
                    leader={leader}
                    rank={rank}
                    foundationalOrder={showFoundationalCoverage}
                    onClose={() => setShowLedger(false)}
                />
            )}
            {selectedDomain && (
                <ScoreDetailModal
                    domain={selectedDomain}
                    score={regimen.domain_scores[selectedDomain]}
                    regimen={regimen}
                    onClose={() => setSelectedDomain(null)}
                />
            )}
        </>
    );
});
