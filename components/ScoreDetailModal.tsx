
import React, { useEffect, useRef } from 'react';
import { ScoredRegimen } from '../types';

interface Props {
    domain: string;
    score: number;
    regimen: ScoredRegimen;
    onClose: () => void;
}

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
                const nyhaScoreMap: Record<string, number> = { "I": 100, "II": 75, "III": 40, "IV": 10 };
                const nyhaPts = nyhaScoreMap[p.nyha_class] || 0;
                return (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-50 p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500 uppercase font-bold">NYHA Class</div>
                                <div className="text-xl font-black text-slate-900">{p.nyha_class} <span className="text-sm font-medium text-slate-500">({nyhaPts} pts)</span></div>
                            </div>
                            <div className="bg-slate-50 p-3 rounded border border-slate-200">
                                <div className="text-xs text-slate-500 uppercase font-bold">KCCQ Score</div>
                                <div className="text-xl font-black text-slate-900">{Math.round(p.kccq_score)} <span className="text-sm font-medium text-slate-500">pts</span></div>
                            </div>
                        </div>
                        <div className="text-sm text-slate-600">
                            <strong>Formula:</strong> Average of NYHA and KCCQ scores.
                            <div className="font-mono bg-slate-100 p-2 mt-1 rounded text-xs">
                                ({nyhaPts} + {Math.round(p.kccq_score)}) / 2 = {score}
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
                        </div>
                        <ul className="text-sm text-slate-600 space-y-1">
                            <li><strong>Base Score:</strong> 100</li>
                            <li className="text-red-600"><strong>Weight Penalty:</strong> -{weightPenalty} pts (15 pts per kg &gt; 1kg)</li>
                            <li className="text-red-600"><strong>Findings Penalty:</strong> -{findingsPenalty} pts (10 pts per finding)</li>
                        </ul>
                    </div>
                );

            case 'Structure':
                const lvef = p.lvef;
                const lvedd = p.lvedd;
                const lavi = p.lavi;
                const baselineLvef = regimen.baseline_lvef;

                // Base LVEF Score (55% ceiling per ACC/AHA 2022)
                let baseLvefScore = 0;
                if (lvef >= 55) baseLvefScore = 100;
                else if (lvef <= 20) baseLvefScore = 0;
                else baseLvefScore = ((lvef - 20) / 35) * 100;

                // LVEDD Penalty (ASE/EACVI severity grades)
                let lveddPenalty = 0;
                let lveddLabel = '';
                if (lvedd && lvedd > 68) { lveddPenalty = 25; lveddLabel = 'Severe'; }
                else if (lvedd && lvedd > 62) { lveddPenalty = 18; lveddLabel = 'Moderate'; }
                else if (lvedd && lvedd > 56) { lveddPenalty = 10; lveddLabel = 'Mild'; }
                else if (lvedd && lvedd > 52) { lveddPenalty = 4; lveddLabel = 'Borderline'; }

                // LAVI Penalty
                let laviPenalty = 0;
                if (lavi && lavi > 48) laviPenalty = 20;
                else if (lavi && lavi > 40) laviPenalty = 10;
                else if (lavi && lavi > 34) laviPenalty = 5;

                // Reverse Remodeling Bonus
                let remodelingBonus = 0;
                let remodelingDetail = '';
                if (baselineLvef !== undefined && lvef > baselineLvef) {
                    const delta = lvef - baselineLvef;
                    const getCat = (ef: number) => ef <= 30 ? 0 : ef <= 40 ? 1 : ef <= 55 ? 2 : 3;
                    if (delta >= 10) remodelingBonus += 10;
                    else if (delta >= 5) remodelingBonus += 5;
                    if (getCat(lvef) > getCat(baselineLvef)) remodelingBonus += 5;
                    remodelingBonus = Math.min(15, remodelingBonus);
                    if (remodelingBonus > 0) remodelingDetail = `LVEF ${baselineLvef.toFixed(0)}% \u2192 ${lvef.toFixed(0)}% (\u0394${delta.toFixed(0)})`;
                }

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
                            <li><strong>Base LVEF Score:</strong> {Math.round(baseLvefScore)} pts <span className="text-slate-400">(ceiling 55%)</span></li>
                            {lvedd && lveddPenalty > 0 && <li className="text-red-600"><strong>LV Dilation ({lveddLabel}):</strong> -{lveddPenalty} pts <span className="text-slate-400">({lvedd.toFixed(0)} mm)</span></li>}
                            {lavi && laviPenalty > 0 && <li className="text-red-600"><strong>LA Dilation (LAVI):</strong> -{laviPenalty} pts</li>}
                            {remodelingBonus > 0 && <li className="text-emerald-600"><strong>Reverse Remodeling:</strong> +{remodelingBonus} pts <span className="text-slate-400">({remodelingDetail})</span></li>}
                            {(!lvedd || !lavi) && <li className="text-slate-400 italic">No penalty applied for missing structural data.</li>}
                            <li className="pt-2 border-t border-slate-100 font-bold text-slate-800">Final Structure Score: {Math.max(0, Math.min(100, Math.round(baseLvefScore - lveddPenalty - laviPenalty + remodelingBonus)))}</li>
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
                const guidePillars = new Set<string>();
                regimenMeds.forEach(r => {
                    const cls = r.med.drug_class;
                    if (['ARNI', 'ACEi', 'ARB'].includes(cls)) guidePillars.add('RAAS Inhibitor');
                    else if (cls === 'Beta Blocker') guidePillars.add('Beta Blocker');
                    else if (cls === 'MRA') guidePillars.add('MRA');
                    else if (cls === 'SGLT2i') guidePillars.add('SGLT2i');
                });

                // 3-tier phenotype: HFrEF (≤40), HFmrEF (41-49), HFpEF (≥50)
                const baseLvef2 = regimen.baseline_lvef ?? p.lvef;
                const isHFpEF = baseLvef2 >= 50;
                const isHFmrEF = baseLvef2 >= 41 && baseLvef2 < 50;

                type PillarInfo = { name: string; pts: number; evidenceClass: string };
                let guidePillarList: PillarInfo[];
                let phenotypeLabel: string;
                let scoringNote: string;

                if (isHFpEF) {
                    phenotypeLabel = 'HFpEF: Class I Recommendations';
                    guidePillarList = [{ name: 'SGLT2i', pts: 70, evidenceClass: 'Class I' }];
                    scoringNote = 'SGLT2i: 70 pts. Target dose: +15 pts. Volume management: +15 pts. Total: 100.';
                } else if (isHFmrEF) {
                    phenotypeLabel = 'HFmrEF: Guideline Recommendations (LVEF 41-49%)';
                    guidePillarList = [
                        { name: 'RAAS Inhibitor', pts: 22, evidenceClass: 'Class I' },
                        { name: 'SGLT2i', pts: 22, evidenceClass: 'Class I' },
                        { name: 'Beta Blocker', pts: 13, evidenceClass: 'Class IIb' },
                        { name: 'MRA', pts: 13, evidenceClass: 'Class IIb' },
                    ];
                    scoringNote = 'Class I pillars (RAAS, SGLT2i): 22 pts each. Class IIb (BB, MRA): 13 pts each. Target dose: +5/pillar. Volume: +10. Total: 100.';
                } else {
                    phenotypeLabel = 'HFrEF: Class I Pillars (2022 AHA/ACC/HFSA)';
                    guidePillarList = [
                        { name: 'RAAS Inhibitor', pts: 20, evidenceClass: 'Class I' },
                        { name: 'Beta Blocker', pts: 20, evidenceClass: 'Class I' },
                        { name: 'MRA', pts: 20, evidenceClass: 'Class I' },
                        { name: 'SGLT2i', pts: 20, evidenceClass: 'Class I' },
                    ];
                    scoringNote = 'Each Class I pillar: 20 pts (max 80). Target dose: +5/pillar (max 20). Total: 100.';
                }

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
