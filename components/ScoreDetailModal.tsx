
import React, { useEffect, useRef } from 'react';
import { ScoredRegimen } from '../types';
import { calculateStructureScoreComponents, classifyPhenotype } from '../services/simulationService';

interface Props {
    domain: string;
    score: number;
    regimen: ScoredRegimen;
    onClose: () => void;
}

const nyhaScoreMap: Record<string, number> = { "I": 100, "II": 75, "III": 40, "IV": 10 };

const guidelinePhenotype = (regimen: ScoredRegimen): 'HFrEF' | 'HFmrEF' | 'HFpEF' => {
    return classifyPhenotype({
        ...regimen.projected_patient,
        lvef: regimen.baseline_lvef ?? regimen.projected_patient.lvef,
    });
};

export const ScoreDetailModal: React.FC<Props> = ({ domain, score, regimen, onClose }) => {
    const p = regimen.projected_patient;

    const renderContent = () => {
        switch (domain) {
            case 'Neurohormonal':
                const bnp = Math.round(p.nt_pro_bnp);
                return (
                    <div className="space-y-3">
                        <div className="bg-slate-50 p-3 rounded border border-slate-200">
                            <div className="text-xs text-slate-500 uppercase font-bold">Projected Value</div>
                            <div className="text-2xl font-black text-slate-900">{bnp.toLocaleString()} <span className="text-sm font-medium text-slate-500">pg/mL</span></div>
                        </div>
                        <ul className="text-sm text-slate-600 space-y-2">
                            <li><strong>Target:</strong> &le; 125 pg/mL (100 pts)</li>
                            <li><strong>Critical:</strong> &ge; 4000 pg/mL (0 pts)</li>
                            <li className="pt-2 border-t border-slate-100">
                                <strong>Calculation:</strong> Linear interpolation between target and critical thresholds.
                            </li>
                        </ul>
                    </div>
                );

            case 'Functional':
                const nyhaPts = nyhaScoreMap[p.nyha_class] || 0;
                const stepPts = p.daily_step_count !== undefined
                    ? Math.min(100, (p.daily_step_count / 7000) * 100)
                    : undefined;
                const functionalTerms = stepPts !== undefined
                    ? [nyhaPts, Math.round(p.kccq_score), Math.round(stepPts)]
                    : [nyhaPts, Math.round(p.kccq_score)];
                return (
                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                            <div className="bg-slate-50 p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500 uppercase font-bold">NYHA Class</div>
                                <div className="text-xl font-black text-slate-900">{p.nyha_class} <span className="text-sm font-medium text-slate-500">({nyhaPts} pts)</span></div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500 uppercase font-bold">KCCQ Score</div>
                                <div className="text-xl font-black text-slate-900">{Math.round(p.kccq_score)} <span className="text-sm font-medium text-slate-500">pts</span></div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500 uppercase font-bold">Steps</div>
                                <div className="text-xl font-black text-slate-900">{stepPts !== undefined ? Math.round(stepPts) : 'N/A'} <span className="text-sm font-medium text-slate-500">pts</span></div>
                            </div>
                        </div>
                        <div className="text-sm text-slate-600">
                            <strong>Formula:</strong> Average of NYHA, KCCQ, and step score when step data is entered.
                            <div className="font-mono bg-slate-100 p-2 mt-1 rounded text-xs">
                                ({functionalTerms.join(' + ')}) / {functionalTerms.length} = {score}
                            </div>
                        </div>
                    </div>
                );

            case 'Volume':
                const dry = p.volume_status.dry_weight_kg;
                const curr = p.volume_status.current_weight_kg;
                const diff = curr - dry;
                const findingsCount = p.volume_status.exam_findings.size;
                const weightPenalty = diff > 1.0 ? Math.round((diff - 1.0) * 15) : 0;
                const findingsPenalty = findingsCount * 10;
                const spo2Penalty = p.oxygen_saturation === undefined
                    ? 0
                    : p.oxygen_saturation < 90 ? 20 : p.oxygen_saturation < 94 ? 10 : 0;

                return (
                    <div className="space-y-3">
                        <div className="bg-slate-50 p-3 rounded border border-slate-200">
                            <div className="flex justify-between mb-1">
                                <span className="text-sm text-slate-600">Fluid Excess:</span>
                                <span className={`font-bold ${diff > 1 ? 'text-red-600' : 'text-slate-900'}`}>{diff > 0 ? '+' : ''}{diff.toFixed(1)} kg</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-sm text-slate-600">Exam Findings:</span>
                                <span className="font-bold text-slate-900">{findingsCount}</span>
                            </div>
                            <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                                <span className="text-sm text-slate-600">SpO2:</span>
                                <span className="font-bold text-slate-900">{p.oxygen_saturation ?? 'N/A'}{p.oxygen_saturation !== undefined ? '%' : ''}</span>
                            </div>
                        </div>
                        <ul className="text-sm text-slate-600 space-y-1">
                            <li><strong>Base Score:</strong> 100</li>
                            <li className="text-red-600"><strong>Weight Penalty:</strong> -{weightPenalty} pts (15 pts per kg &gt; 1kg)</li>
                            <li className="text-red-600"><strong>Findings Penalty:</strong> -{findingsPenalty} pts (10 pts per finding)</li>
                            {spo2Penalty > 0 && <li className="text-red-600"><strong>SpO2 Penalty:</strong> -{spo2Penalty} pts</li>}
                            <li className="pt-2 border-t border-slate-100 font-bold text-slate-800">Engine Volume Score: {score}</li>
                        </ul>
                    </div>
                );

            case 'Structure':
                const lvef = p.lvef;
                const lvedd = p.lvedd;
                const lavi = p.lavi;
                const baselineLvef = regimen.baseline_lvef ?? p.lvef;
                const structure = calculateStructureScoreComponents(lvef, lvedd, lavi, baselineLvef, regimen.baseline_lvedd, regimen.baseline_lavi);

                return (
                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                            <div className="bg-slate-50 p-2 rounded border border-slate-200 text-center">
                                <div className="text-[10px] text-slate-500 uppercase font-bold">LVEF</div>
                                <div className="text-lg font-black text-slate-900">{lvef.toFixed(1)}%</div>
                            </div>
                            <div className="bg-slate-50 p-2 rounded border border-slate-200 text-center">
                                <div className="text-[10px] text-slate-500 uppercase font-bold">LVEDD</div>
                                <div className={`text-lg font-black ${lvedd ? 'text-slate-900' : 'text-slate-400'}`}>{lvedd ? `${lvedd.toFixed(0)} mm` : 'N/A'}</div>
                            </div>
                            <div className="bg-slate-50 p-2 rounded border border-slate-200 text-center">
                                <div className="text-[10px] text-slate-500 uppercase font-bold">LAVI</div>
                                <div className={`text-lg font-black ${lavi ? 'text-slate-900' : 'text-slate-400'}`}>{lavi ? lavi.toFixed(0) : 'N/A'}</div>
                            </div>
                        </div>
                        <ul className="text-sm text-slate-600 space-y-1 mt-2">
                            <li><strong>Absolute LVEF state:</strong> {Math.round(structure.absoluteScore)} pts <span className="text-slate-400">(40% weight)</span></li>
                            <li><strong>Improvement trajectory:</strong> {Math.round(structure.improvementScore)} pts <span className="text-slate-400">(40% weight; baseline LVEF {baselineLvef.toFixed(0)}%)</span></li>
                            <li><strong>Chamber geometry:</strong> {Math.round(structure.chamberScore)} pts <span className="text-slate-400">(20% weight; neutral 50 if echo data unavailable)</span></li>
                            <li className="pt-2 border-t border-slate-100 font-bold text-slate-800">Engine Structure Score: {score}</li>
                        </ul>
                    </div>
                );

            case 'Cost':
                const budget = p.max_affordable_cost;
                const sens = p.cost_sensitivity;
                const isZeroBudget = budget <= 0;
                const utilization = isZeroBudget ? null : (regimen.cost / budget) * 100;
                const hasOutOfPocketCost = regimen.cost > 0;

                return (
                    <div className="space-y-3">
                        <div className="bg-slate-50 p-3 rounded border border-slate-200">
                            <div className="flex justify-between mb-1">
                                <span className="text-sm text-slate-600">Regimen Cost:</span>
                                <span className="font-bold text-slate-900">${regimen.cost}/mo</span>
                            </div>
                            <div className="flex justify-between mb-1">
                                <span className="text-sm text-slate-600">Budget:</span>
                                <span className="font-bold text-slate-900">${budget}/mo</span>
                            </div>
                            <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                                <span className="text-sm text-slate-600">Budget Used:</span>
                                {isZeroBudget ? (
                                    <span className={`font-bold ${hasOutOfPocketCost ? 'text-red-600' : 'text-emerald-600'}`}>
                                        {hasOutOfPocketCost ? 'Out of budget' : 'No-cost regimen'}
                                    </span>
                                ) : (
                                    <span className={`font-bold ${(utilization ?? 0) > 100 ? 'text-red-600' : 'text-slate-900'}`}>
                                        {(utilization ?? 0).toFixed(0)}%
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="text-sm text-slate-600">
                            <p className="mb-2"><strong>Sensitivity Level:</strong> {sens}/10</p>
                            {isZeroBudget ? (
                                <p className="text-xs leading-relaxed text-slate-500">
                                    Zero budget mode is active. Only $0/month regimens are considered in-budget.
                                </p>
                            ) : (
                                <p className="text-xs leading-relaxed text-slate-500">
                                    Score penalizes high budget utilization based on your sensitivity setting.
                                    {(utilization ?? 0) > 100 ? " Heavy penalty applied for exceeding budget." : ""}
                                </p>
                            )}
                        </div>
                    </div>
                );

            case 'Adherence':
                const complexity = regimen.complexity;
                const tolerance = p.complexity_tolerance;
                const threshold = 2 + (tolerance * 1.8);

                return (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-50 p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500 uppercase font-bold">Regimen Complexity</div>
                                <div className="text-xl font-black text-slate-900">{complexity} <span className="text-sm font-medium text-slate-500">pts</span></div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500 uppercase font-bold">Your Threshold</div>
                                <div className="text-xl font-black text-slate-900">{threshold.toFixed(1)} <span className="text-sm font-medium text-slate-500">pts</span></div>
                            </div>
                        </div>
                        <p className="text-sm text-slate-600">
                            <strong>Analysis:</strong>
                            {complexity <= threshold
                                ? " Regimen is well within your tolerance."
                                : " Regimen exceeds your stated complexity tolerance, reducing the score."}
                        </p>
                        <p className="text-xs text-slate-400 mt-2">
                            (QD=1, BID=2, TID=4, Injection=2)
                        </p>
                    </div>
                );

            case 'Guideline':
                const regimenMeds = regimen.regimen;
                const phenotype = guidelinePhenotype(regimen);
                const guidePillars = new Set<string>();
                regimenMeds.forEach(r => {
                    const cls = r.med.drug_class;
                    if (['ARNI', 'ACEi', 'ARB'].includes(cls)) guidePillars.add('RAAS Inhibitor');
                    else if (cls === 'Beta Blocker') guidePillars.add('Beta Blocker');
                    else if (cls === 'MRA' || (cls === 'nsMRA' && phenotype !== 'HFrEF')) guidePillars.add('MRA');
                    else if (cls === 'SGLT2i') guidePillars.add('SGLT2i');
                });

                // 3-tier phenotype: HFrEF (≤40), HFmrEF (41-49), HFpEF (≥50)
                type PillarInfo = { name: string; pts: number; evidenceClass: string };
                let guidePillarList: PillarInfo[];
                let phenotypeLabel: string;
                let scoringNote: string;

                if (phenotype === 'HFpEF') {
                    phenotypeLabel = 'HFpEF: Guideline Recommendations';
                    guidePillarList = [
                        { name: 'SGLT2i', pts: 70, evidenceClass: 'Class I' },
                        { name: 'MRA', pts: 8, evidenceClass: 'Class IIb' },
                    ];
                    scoringNote = 'SGLT2i: 70 pts. Target dose: +15 pts. Volume management: +15 pts. Total: 100.';
                } else if (phenotype === 'HFmrEF') {
                    phenotypeLabel = 'HFmrEF: Guideline Recommendations (LVEF 41-49%)';
                    guidePillarList = [
                        { name: 'RAAS Inhibitor', pts: 22, evidenceClass: 'Class IIb' },
                        { name: 'SGLT2i', pts: 22, evidenceClass: 'Class IIa' },
                        { name: 'Beta Blocker', pts: 13, evidenceClass: 'Class IIb' },
                        { name: 'MRA', pts: 13, evidenceClass: 'Class IIb' },
                    ];
                    scoringNote = 'SGLT2i is weighted strongest (Class IIa). RAAS, beta-blocker, and MRA are Class IIb. Target dose: +5/pillar capped at +20. Volume: +10.';
                } else {
                    phenotypeLabel = 'HFrEF: Class I Pillars (2022 AHA/ACC/HFSA)';
                    guidePillarList = [
                        { name: 'RAAS Inhibitor', pts: 20, evidenceClass: 'Class I' },
                        { name: 'Beta Blocker', pts: 20, evidenceClass: 'Class I' },
                        { name: 'MRA', pts: 20, evidenceClass: 'Class I' },
                        { name: 'SGLT2i', pts: 20, evidenceClass: 'Class I' },
                    ];
                    scoringNote = 'Each Class I pillar: 20 pts. Target dose: +5/pillar. Finerenone/nsMRA does not count for the HFrEF/HFimpEF MRA pillar.';
                }
                const guidelineRationale = regimen.rationale.filter(r => r.startsWith('Guideline:'));

                return (
                    <div className="space-y-3">
                        <div className="text-xs text-slate-500 uppercase font-bold mb-2">
                            {phenotypeLabel}
                        </div>
                        <div className="space-y-2">
                            {guidePillarList.map(pillar => {
                                const present = guidePillars.has(pillar.name);
                                return (
                                    <div key={pillar.name} className={`flex items-center gap-2 p-2 rounded ${present ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                                        <span className={`font-bold text-sm ${present ? 'text-green-600' : 'text-red-500'}`}>
                                            {present ? 'Present' : 'Missing'}
                                        </span>
                                        <span className="text-sm text-slate-700 font-medium">{pillar.name}</span>
                                        <span className="text-xs text-slate-400 ml-auto">
                                            {present ? `+${pillar.pts} pts` : '0 pts'} <span className="text-slate-300">({pillar.evidenceClass})</span>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
                            <strong>Scoring:</strong> {scoringNote}
                        </p>
                        <p className="text-xs text-slate-400">
                            This domain carries 15% of the overall score, ensuring guideline-concordant therapy is prioritized.
                        </p>
                        {guidelineRationale.length > 0 && (
                            <ul className="text-xs text-slate-500 mt-3 space-y-1 border-t border-slate-100 pt-2">
                                {guidelineRationale.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                        )}
                    </div>
                );

            default:
                return null;
        }
    };

    const dialogRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<Element | null>(null);

    useEffect(() => {
        previousFocusRef.current = document.activeElement;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
                return;
            }

            if (e.key === 'Tab') {
                const dialog = dialogRef.current;
                if (!dialog) return;
                const focusable = dialog.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (focusable.length === 0) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        dialogRef.current?.focus();

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (previousFocusRef.current instanceof HTMLElement) {
                previousFocusRef.current.focus();
            }
        };
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="score-modal-title"
        >
            <div
                ref={dialogRef}
                tabIndex={-1}
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden outline-none"
                onClick={e => e.stopPropagation()}
            >
                <div className="bg-indigo-600 p-4 flex justify-between items-center">
                    <h3 id="score-modal-title" className="font-bold text-white text-lg">{domain} Score</h3>
                    <button onClick={onClose} className="text-white/80 hover:text-white" aria-label="Close score details">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <div className="p-6">
                    <div className="flex justify-center mb-6">
                        <div className="h-20 w-20 rounded-full border-4 border-indigo-100 flex items-center justify-center bg-indigo-50">
                            <span className="text-3xl font-black text-indigo-600">{score}</span>
                        </div>
                    </div>
                    {renderContent()}
                </div>
                <div className="bg-slate-50 p-3 text-center border-t border-slate-100">
                    <button onClick={onClose} className="text-sm font-bold text-indigo-600 hover:text-indigo-800" aria-label="Close score details">Close</button>
                </div>
            </div>
        </div>
    );
};
