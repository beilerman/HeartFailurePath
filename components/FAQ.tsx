
import React from 'react';
import { QuestionMarkCircleIcon, LightBulbIcon, CalculationIcon, HeartIcon } from './icons';

export const FAQ: React.FC = () => {
    return (
        <div className="h-full overflow-y-auto bg-slate-50 custom-scrollbar p-8">
            <div className="max-w-4xl mx-auto space-y-8 pb-16">

                {/* Header */}
                <div className="border-b border-slate-200 pb-6">
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <QuestionMarkCircleIcon className="w-8 h-8 text-indigo-600" />
                        Clinical Logic & Methodology
                    </h2>
                    <p className="text-slate-500 mt-2 text-lg leading-relaxed">
                        HeartFailurePATH uses a multi-domain simulation engine to optimize Guideline-Directed Medical Therapy (GDMT) for HFrEF. This section explains the scoring algorithms and evidence base.
                    </p>
                </div>

                {/* 1. Core Philosophy */}
                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <HeartIcon className="w-6 h-6 text-indigo-600" />
                            The 6-Domain Framework
                        </h3>
                    </div>
                    <div className="p-6 space-y-4 text-slate-700">
                        <p>
                            Clinical decisions in heart failure are rarely one-dimensional. This software normalizes patient status into six key domains (0-100 scale), where <strong>100 represents optimal stability</strong> and <strong>0 represents critical failure</strong>.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="font-bold text-indigo-700 mb-2">1. Neurohormonal Score</h4>
                                <p className="text-sm">Based on <strong>NT-proBNP</strong> levels. Correlates with wall stress and neurohumoral activation.</p>
                                <ul className="text-xs mt-2 list-disc list-inside text-slate-500">
                                    <li>Target: &lt; 125 pg/mL (Score 100)</li>
                                    <li>Critical: &ge; 4000 pg/mL (Score 0)</li>
                                </ul>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="font-bold text-blue-700 mb-2">2. Functional Score</h4>
                                <p className="text-sm">Combines physician assessment (<strong>NYHA Class</strong>) and patient-reported outcomes (<strong>KCCQ</strong>).</p>
                                <ul className="text-xs mt-2 list-disc list-inside text-slate-500">
                                    <li>Formula: (NYHA Score + KCCQ) / 2</li>
                                    <li>NYHA I + KCCQ 100 = Score 100</li>
                                </ul>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="font-bold text-emerald-700 mb-2">3. Volume Score</h4>
                                <p className="text-sm">Based on <strong>Weight</strong> (relative to Dry Weight) and <strong>Physical Findings</strong>.</p>
                                <ul className="text-xs mt-2 list-disc list-inside text-slate-500">
                                    <li>Penalty: -15 pts per kg fluid excess</li>
                                    <li>Penalty: -10 pts per finding (Edema, JVP)</li>
                                </ul>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="font-bold text-amber-700 mb-2">4. Structure Score</h4>
                                <p className="text-sm">Based on <strong>LVEF</strong> and Remodeling markers (LVEDD).</p>
                                <ul className="text-xs mt-2 list-disc list-inside text-slate-500">
                                    <li>LVEF &ge; 50% = Score 100</li>
                                    <li>LVEF &le; 20% = Score 0</li>
                                    <li>Remodeling: -10 pts if LVEDD &gt; 55mm</li>
                                </ul>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="font-bold text-slate-700 mb-2">5. Cost Score</h4>
                                <p className="text-sm">Financial Toxicity. Balances Regimen Cost vs Budget.</p>
                                <ul className="text-xs mt-2 list-disc list-inside text-slate-500">
                                    <li>Inputs: Budget Limit & Cost Sensitivity (0-10)</li>
                                    <li>Score degrades as you approach budget limit based on sensitivity.</li>
                                    <li>Strict penalty if Budget is exceeded.</li>
                                </ul>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="font-bold text-teal-700 mb-2">6. Adherence Score</h4>
                                <p className="text-sm">Likelihood of compliance based on Complexity vs Tolerance.</p>
                                <ul className="text-xs mt-2 list-disc list-inside text-slate-500">
                                    <li>Complexity Pts: QD=1, BID=2, TID=4, Inj=2</li>
                                    <li>Formula: 100 * (ToleranceThreshold / Complexity)</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </section>

                {/* 2. Simulation Engine */}
                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <CalculationIcon className="w-5 h-5 text-indigo-600" />
                            The Simulation Engine
                        </h3>
                    </div>
                    <div className="p-6 space-y-6 text-slate-700">
                        <div>
                            <h4 className="font-bold text-lg mb-2">Step 1: The "Naive" Baseline</h4>
                            <p className="text-sm leading-relaxed mb-4">
                                The engine first "reverse engineers" the patient's unmedicated state. If a patient presents with a BP of 110/70 on 4 drugs, their <em>true</em> unmedicated BP might be 160/100. The system subtracts the hemodynamic and neurohormonal effects of current medications to establish a biological baseline.
                            </p>
                        </div>

                        <div>
                            <h4 className="font-bold text-lg mb-2">Step 2: Combinatorial Optimization</h4>
                            <p className="text-sm leading-relaxed">
                                The system generates thousands of valid regimens using the 4 Pillars of GDMT (ARNI, BB, MRA, SGLT2i) plus Loop Diuretics. It filters these combinations based on:
                            </p>
                            <ul className="list-disc list-inside mt-2 space-y-1 text-sm pl-4">
                                <li><strong>Renal Constraints:</strong> Adjusting for eGFR and K+.</li>
                                <li><strong>Safety:</strong> Avoiding hypotension (SBP &lt; 90) or bradycardia.</li>
                                <li><strong>Exclusions:</strong> Respecting allergies (e.g., Angioedema) and comorbidities (e.g., Asthma).</li>
                                <li><strong>Visit Intensification Limit:</strong> By default, only 2 new medication classes can be added at one visit. Dose changes and in-class substitutions are allowed and do not count as new classes. This limit is user-adjustable.</li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="font-bold text-lg mb-2">Step 3: Pharmacodynamic Projection</h4>
                            <p className="text-sm leading-relaxed">
                                Each regimen is scored by applying evidence-based "deltas" to the baseline. For example, switching from ACEi to ARNI adds a projected +5% LVEF improvement and -20% BNP reduction based on trial data.
                            </p>
                        </div>
                    </div>
                </section>

                {/* 3. Evidence Base */}
                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <LightBulbIcon className="w-5 h-5 text-indigo-600" />
                            Evidence Base & Trials
                        </h3>
                    </div>
                    <div className="p-6">
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                                    <tr>
                                        <th className="px-4 py-3">Drug Class</th>
                                        <th className="px-4 py-3">Key Trials</th>
                                        <th className="px-4 py-3">Modeled Impact</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    <tr>
                                        <td className="px-4 py-3 font-bold text-slate-800">ARNI (Entresto)</td>
                                        <td className="px-4 py-3 text-slate-600">PARADIGM-HF, PROVE-HF</td>
                                        <td className="px-4 py-3 text-slate-600">Significant LVEF recovery, BNP reduction, Mortality benefit.</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-bold text-slate-800">Beta Blockers</td>
                                        <td className="px-4 py-3 text-slate-600">MERIT-HF, COPERNICUS</td>
                                        <td className="px-4 py-3 text-slate-600">Highest structural remodeling (LVEF), arrhythmia suppression.</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-bold text-slate-800">SGLT2 Inhibitors</td>
                                        <td className="px-4 py-3 text-slate-600">DAPA-HF, EMPEROR-Reduced</td>
                                        <td className="px-4 py-3 text-slate-600">High symptom relief (KCCQ), prevents hospitalization, mild diuresis.</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-bold text-slate-800">MRAs</td>
                                        <td className="px-4 py-3 text-slate-600">RALES, EPHESUS</td>
                                        <td className="px-4 py-3 text-slate-600">Anti-fibrotic, survival benefit, potassium retention.</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-bold text-slate-800">GLP-1 / GIP</td>
                                        <td className="px-4 py-3 text-slate-600">STEP-HFpEF, SUMMIT</td>
                                        <td className="px-4 py-3 text-slate-600">Massive KCCQ and Weight improvement in Obesity phenotype.</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                {/* Disclaimer */}
                <div className="bg-slate-100 p-4 rounded-lg text-xs text-slate-500 leading-relaxed border border-slate-200">
                    <strong>Disclaimer:</strong> This software is a clinical decision support simulation tool. It estimates projected physiological responses based on population averages from major clinical trials. Individual patient responses may vary significantly due to genetics, adherence, and unmodeled comorbidities. This tool does not replace professional medical judgment.
                </div>

            </div>
        </div>
    );
};
