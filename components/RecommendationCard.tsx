
import React, { useState } from 'react';
import type { Patient, ScoredRegimen, RegimenMed, RegimenModification, QualitativeProjection, TradeOffLabel, DomainScores } from '../types';
import { ScoreDetailModal } from './ScoreDetailModal';
import { ScoreComparisonLine } from './ScoreComparison';
import { Disclosure } from './Disclosure';
import { useEvidenceLink } from './EvidenceContext';
import { evidenceRowsForDrug, drugSearchTerm } from './evidenceMatrix';
import { partitionWarnings, stripDrugNotePrefix, isOverBudgetFallback } from './resultsModel';
import { DOMAIN_LABELS, DOMAIN_GROUPS, WEIGHT_PROFILES, type ScoreDomainKey } from '../services/engine/scoreModel';
import { ExpectedEffectBlock } from './ExpectedEffect';
import { drugFacts } from '../services/engine/drugFacts';
import { getTargetDosePatientContext, isTargetDoseForPatient } from '../services/simulationService';
import { clinicalSentence, doseLabel, costLabel, optionDifferences } from './clinicalPresentation';

interface Props {
    regimen: ScoredRegimen;
    rank: number;
    /** Option 1, so options 2 and 3 can say why they ranked lower. Omit for option 1. */
    leader?: ScoredRegimen;
    /** True when the foundational ranking mode is applied to this run (HFrEF/HFimpEF): shows the coverage line. */
    showFoundationalCoverage?: boolean;
}

const ScorePill = ({ label, fullLabel, score, color, onClick, assessed = true, weightText }: { label: string, fullLabel: string, score: number, color: string, onClick: () => void, assessed?: boolean, weightText?: string }) => (
    <button
        onClick={onClick}
        className="flex flex-col items-center group focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-lg"
        aria-label={`${fullLabel}: ${assessed ? `${score} out of 100` : 'not assessed'}. Click for details.`}
    >
        <div className={`h-11 w-11 rounded-full flex items-center justify-center text-sm font-bold border-2 ${color} bg-white shadow-sm group-hover:shadow-md group-hover:scale-105 transition-all cursor-pointer`}>
            {assessed ? score : 'N/A'}
        </div>
        <span className="text-[11px] font-bold text-slate-500 uppercase mt-1.5 tracking-wide group-hover:text-indigo-600 transition-colors">{label}</span>
        {weightText && <span className="text-[10px] text-slate-600">{weightText}</span>}
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

/** `isNewStart`: the drug is started (added or swapped in) by this option, not already on the current regimen. */
const getDosingRationale = (item: RegimenMed, patient: Patient, isNewStart: boolean): string => {
    const { med } = item;
    const isTarget = isTargetDoseForPatient(item, patient);

    if (drugFacts(med).single_course_dose) {
        return "Single course, dosed by weight and hemoglobin. Not titrated.";
    }

    if (med.drug_class === 'SGLT2i') {
        return 'Fixed dose in this tool. Review the drug-specific indication and safety notes.';
    }

    if (med.drug_class === 'Loop Diuretic') {
        return 'Dosed for volume management. Review symptoms, examination, weight trend, renal function and electrolytes before adjusting.';
    }

    if (isTarget) return 'At the target recognized by this tool for the entered patient. Review tolerability and the safety notes; target dose does not guarantee an individual response.';
    return isNewStart
        ? 'New therapy in this option. Confirm the proposed dose and initiation requirements below.'
        : 'Below the reference target. This is not an instruction to increase: dose limits, current tolerability and safety holds may apply.';
};

const getModForMed = (regimen: ScoredRegimen, item: RegimenMed): RegimenModification | undefined =>
    regimen.modification_set?.modifications.find(m =>
        (m.target?.med.name === item.med.name) ||
        (m.action === 'keep' && m.source?.med.name === item.med.name)
    );

const isNewStartIn = (regimen: ScoredRegimen, item: RegimenMed): boolean =>
    regimen.modification_set?.modifications.some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.name === item.med.name) ?? false;

const getModBadge = (mod: RegimenModification | undefined): { text: string; className: string } | null => {
    if (!mod) return null;
    switch (mod.action) {
        case 'add': return { text: 'NEW', className: 'bg-emerald-100 text-emerald-700' };
        case 'titrate_up': return { text: 'Increase', className: 'bg-blue-100 text-blue-700' };
        case 'titrate_down': return { text: 'Reduce', className: 'bg-blue-100 text-blue-700' };
        case 'swap': return { text: 'Switch', className: 'bg-amber-100 text-amber-700' };
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
    mortality: 'Death',
    hf_hospitalization: 'HF admission',
    symptoms: 'Symptoms',
    side_effects: 'Side effects',
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
    mortality: 'border-sky-600 text-sky-700',
    hf_hospitalization: 'border-cyan-600 text-cyan-700',
    symptoms: 'border-violet-600 text-violet-700',
    side_effects: 'border-orange-600 text-orange-700',
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
const _domainKeysMatch: Record<keyof DomainScores, true> = { mortality: true, hf_hospitalization: true, symptoms: true, side_effects: true, neurohormonal: true, functional: true, volume: true, structure: true, cost: true, adherence: true, guideline: true, completeness: true };
void _domainKeysMatch;

export const RecommendationCard = React.memo(function RecommendationCard({ regimen, rank, leader, showFoundationalCoverage = false }: Props) {
    const { domain_scores } = regimen;
    const [selectedDomain, setSelectedDomain] = useState<ScoreDomainKey | null>(null);
    const [showLedger, setShowLedger] = useState(false);
    const targetDoseContext = getTargetDosePatientContext(regimen);
    const { openEvidence } = useEvidenceLink();
    const { safety: safetyWarnings, notes: prescribingNotes } = partitionWarnings(regimen.warnings);

    const weightOf = (k: ScoreDomainKey): number => regimen.score_breakdown?.domains.find(d => d.key === k)?.weight ?? WEIGHT_PROFILES.default[k];
    const rankedGroups = DOMAIN_GROUPS.filter(g => g.domains.some(k => weightOf(k) > 0));
    const otherGroups = DOMAIN_GROUPS.filter(g => !g.domains.some(k => weightOf(k) > 0));
    const projections = regimen.qualitative_projections ?? [];
    const tradeOffs = regimen.trade_offs ?? [];

    // Raw modeled estimates are still available, but only behind an explicit disclosure
    // with a "not a prediction" caveat — they are population-average effect sizes run
    // through uncalibrated curves, not individual forecasts.


    return (
        <>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-slate-100">
                    <div className="flex flex-wrap items-center gap-2.5 mb-3">
                        <span className="bg-slate-200 text-slate-700 text-xs font-bold px-2 py-0.5 rounded" aria-label={`Option ${rank}`}>Option {rank}</span>
                        <h3 className="font-bold text-slate-900 text-lg">{rank === 1 ? 'First option to review' : 'Alternative option'}</h3>
                        {isOverBudgetFallback(regimen) && (
                            <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded border border-red-300">{Number.isFinite(regimen.cost) ? 'Over budget: discussion only' : 'Cost unavailable: confirm pricing'}</span>
                        )}
                    </div>
                    <p className="text-sm font-semibold text-slate-700 mb-3">{costLabel(regimen.cost)} <span className="font-normal">— confirm actual coverage and cost.</span></p>
                    {leader && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <h4 className="text-sm font-bold text-blue-950">Compared with option 1</h4>
                        <ul className="mt-1 space-y-1 text-sm text-blue-950">{optionDifferences(regimen,leader).map(d=><li key={d}>{d}</li>)}</ul>
                    </div>}
                    {regimen.shown_because && (
                        <p className="text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 rounded px-2 py-1 mb-3">{regimen.shown_because}</p>
                    )}
                    {showFoundationalCoverage && regimen.foundational_coverage !== undefined && (
                        <p className="text-xs font-semibold text-slate-600 mb-3">
                            Foundational coverage {Math.round(regimen.foundational_coverage)}%
                            {regimen.foundational_slots && (
                                <span className="font-normal"> ({regimen.foundational_slots.on_board} of {regimen.foundational_slots.indicated} indicated therapies on board, credited by dose
                                    {regimen.foundational_slots.not_startable > 0 ? `; ${regimen.foundational_slots.not_startable} cannot be started today` : ''})</span>
                            )}
                        </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                        {regimen.regimen.map((r, i) => {
                            const mod = getModForMed(regimen, r);
                            const badge = getModBadge(mod);
                            const isTarget = isTargetDoseForPatient(r, targetDoseContext);
                            return (
                                <span key={i} className="text-sm text-slate-700 bg-slate-50 px-2.5 py-1 rounded border border-slate-200 font-semibold flex flex-wrap items-center gap-1">
                                    {isTarget && <><span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true"></span><span className="sr-only">Target Dose</span></>}
                                    {r.med.name} <span className="text-slate-600 font-normal ml-1">{doseLabel(r)}</span>
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
                        <h4 className="text-xs font-bold text-indigo-700 uppercase mb-2 tracking-wide">Proposed changes in this option</h4>
                        <div className="space-y-1">
                            {regimen.modification_set.modifications
                                .filter(m => m.action !== 'keep')
                                .map((m, i) => (
                                    <div key={i} className={`text-sm font-medium flex items-center gap-2 ${modActionColor[m.action] || 'text-slate-700'}`}>
                                        <span className="font-bold w-4 text-center">{modActionIcon[m.action] || ''}</span>
                                        {clinicalSentence(m.summary)}
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
                                    <span><span className="sr-only">Warning: </span>{clinicalSentence(w)}</span>
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

                {/* Expected effect from trial relative risks, KCCQ and measured harm rates, versus the current regimen */}
                <ExpectedEffectBlock regimen={regimen} rank={rank} />

                {/* Expected Direction (qualitative — replaces false-precision projected numbers) */}
                {projections.length > 0 && (
                    <div className="p-6 border-b border-slate-100">
                        <h4 className="text-sm font-bold text-slate-600 uppercase mb-1 tracking-wide">Treatment considerations</h4>
                        <p className="text-xs text-slate-600 mb-3">Individual response is not predicted; the expected effect above is a trial average. Reassess measured response after any treatment change.</p>
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
                <Disclosure title="Dose details and evidence" className="border-t border-slate-100 bg-slate-50/30" buttonClassName="p-6 text-sm font-bold text-slate-700">
                    <div className="space-y-4 px-6 pb-6">
                        {regimen.regimen.map((item, idx) => {
                            const isTarget = isTargetDoseForPatient(item, targetDoseContext);
                            const specificBenefits = regimen.rationale
                                .filter(r => r.includes(item.med.name))
                                .map(r => r.replace(`+ ${item.med.name}: `, ''));

                            return (
                                <div key={idx} className="flex flex-col sm:flex-row gap-3 items-start">
                                    <div className="sm:w-1/3 shrink-0 break-words">
                                        <div className="font-bold text-sm text-slate-900">{item.med.name}</div>
                                        <div className="text-sm font-semibold text-indigo-700">{doseLabel(item)}</div>
                                        <p className="text-xs text-slate-600 mt-1">{item.dose.formulation}</p>
                                        {isTarget && (
                                            <span className="inline-block mt-1 text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                                                Target Dose
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-xs text-slate-700 font-medium leading-relaxed mb-1.5">
                                            {getDosingRationale(item, targetDoseContext, isNewStartIn(regimen, item))}
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
                </Disclosure>

                {(regimen.monitoring_plan?.length ?? 0) > 0 && <div className="px-6 py-4 border-t border-blue-200 bg-blue-50">
                    <h4 className="text-sm font-bold text-blue-950 mb-2">Monitoring for option {rank}</h4>
                    <ul className="space-y-2">{regimen.monitoring_plan!.map((m,i)=><li key={`${m.test}-${i}`} className="text-sm text-blue-950"><strong>{m.test}</strong> ({m.timing}): {m.details}</li>)}</ul>
                </div>}

                {/* Modeled estimates — behind explicit disclosure, with caveat */}
                <Disclosure
                    className="border-t border-slate-100"
                    buttonClassName="px-6 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide hover:text-slate-800"
                    title="Assessment limits &amp; domain sub-scores"
                >
                    <div className="px-6 pb-6">
                        <p className="text-xs text-slate-600 mb-4 leading-snug">
                            Death, heart-failure hospitalization, symptoms, side effects, cost and dosing burden decide the order. The first four are trial averages (relative risks, KCCQ points and one-year harm rates); the order is not a prediction for this patient. Observed EF, BNP, KCCQ, weight and vital signs are never replaced by a predicted state. Guideline concordance and therapy completeness are shown for reference only and carry weight 0; so do the four physiological domains, which are not assessed. The composite score is an internal ordering number, not a clinical grade or safety clearance.
                        </p>
                        {regimen.treatment_assessment?.limitations.map(note => <p key={note} className="text-xs text-slate-600 mb-2">{note}</p>)}
                        <div className="grid grid-cols-2 gap-y-2 gap-x-8 mb-5">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-medium text-slate-500">Monthly cost</span>
                                <span className="text-sm font-bold text-slate-700">{costLabel(regimen.cost)}</span>
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
                            {[{ title: 'Ranked factors', groups: rankedGroups }, { title: 'Not ranked', groups: otherGroups }].filter(s => s.groups.length > 0).map(section => (
                                <div key={section.title} className="space-y-3">
                                    <h5 className="text-xs font-bold text-slate-700 border-b border-slate-200 pb-0.5">{section.title}</h5>
                                    {section.groups.map(g => (
                                        <div key={g.key} role="group" aria-label={g.label}>
                                            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{g.label}{g.domains.every(k => weightOf(k) === 0) && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 normal-case">weight 0</span>}</p>
                                            <div className="grid grid-cols-4 gap-y-3 gap-x-3">
                                                {g.domains.map(k => (
                                                    <ScorePill key={k} label={PILL_SHORT_LABELS[k]} fullLabel={DOMAIN_LABELS[k]} score={domain_scores[k]} assessed={regimen.score_breakdown?.domains.find(d=>d.key===k)?.assessed !== false} color={PILL_COLORS[k]} weightText={weightOf(k) > 0 ? `${Math.round(weightOf(k) * 1000) / 10}% weight` : undefined} onClick={() => setSelectedDomain(k)} />
                                                ))}
                                            </div>
                                        </div>
                                    ))}
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
