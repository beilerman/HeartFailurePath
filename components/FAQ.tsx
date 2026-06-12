import React from 'react';
import { QuestionMarkCircleIcon, LightBulbIcon, CalculationIcon, HeartIcon } from './icons';

const domainCards = [
    {
        title: '1. Neurohormonal',
        color: 'text-indigo-700',
        description: 'Uses NT-proBNP as a congestion and neurohormonal burden signal.',
        bullets: ['100 points at <= 125 pg/mL', '0 points at >= 4000 pg/mL', 'Linear interpolation between thresholds']
    },
    {
        title: '2. Functional',
        color: 'text-blue-700',
        description: 'Combines NYHA class, KCCQ score, and optional daily step count.',
        bullets: ['NYHA mapped I->IV', 'KCCQ contributes directly (0-100)', 'Steps included when available']
    },
    {
        title: '3. Volume',
        color: 'text-emerald-700',
        description: 'Measures fluid status using weight delta, exam findings, and oxygenation.',
        bullets: ['Weight penalty beyond +1.0 kg', '-10 points per exam finding', 'Additional SpO2 penalty if < 94%']
    },
    {
        title: '4. Structure',
        color: 'text-amber-700',
        description: 'Blends current remodeling state with trajectory and chamber geometry.',
        bullets: ['40% absolute LVEF state', '40% LVEF improvement trajectory', '20% LVEDD/LAVI chamber component']
    },
    {
        title: '5. Cost',
        color: 'text-slate-700',
        description: 'Compares regimen cost to patient budget with sensitivity weighting.',
        bullets: ['Budget-aware penalty curve', 'Sensitivity modifies under-budget sting', 'Zero-budget mode supported']
    },
    {
        title: '6. Adherence',
        color: 'text-teal-700',
        description: 'Scores regimen complexity against patient complexity tolerance.',
        bullets: ['Complexity from dose frequency/formulation', 'Tolerance input scales threshold', 'Score decays when complexity exceeds threshold']
    },
    {
        title: '7. Guideline Concordance',
        color: 'text-rose-700',
        description: 'Phenotype-specific alignment with major HF guideline pathways.',
        bullets: ['HFrEF: RAAS + BB + MRA + SGLT2i', 'HFmrEF: weighted hybrid pillar model', 'HFpEF: SGLT2i-first with adjunct logic']
    }
];

const safetyChecks = [
    'Input safety: SBP must be greater than DBP; duplicate current medications are removed before scoring.',
    'Implausible inputs hard-stop: physiologically impossible values (e.g. LVEF 99, K+ > 8) return verification alerts only — no recommendations are computed on suspect data.',
    'Hemodynamic hard gate: SBP < 90 mmHg returns alerts only (no regimen output).',
    'Display safety filter: regimens with projected SBP < 85, projected potassium > 6.0, or projected HR < 45 are not shown.',
    'Nitrate + PDE5 inhibitor (sildenafil/tadalafil) is an absolute exclusion — H/ISDN is removed from the formulary and force-removed from a current regimen, not merely warned about.',
    'Potassium-binder rescue enables a regimen to be considered (DIAMOND) but carries a residual-risk score penalty — a regimen needing rescue ranks below an equal regimen that does not.',
    'Pregnancy exclusions: RAAS classes, MRA/nsMRA, and SGLT2i are excluded from recommendations.',
    'Acute decompensation handling: beta-blocker initiation is blocked; existing beta-blockers are down-titrated rather than abruptly stopped.',
    'Ivabradine initiation requires sinus rhythm, HR >= 70, and LVEF <= 35.',
    'Vericiguat requires NYHA II-IV, NT-proBNP >= 1600, LVEF < 45, and recent worsening HF context.',
    'GLP-1 therapy is restricted to obesity phenotype with LVEF >= 40 and is not used for HFrEF/HFimpEF pathways.',
    'Dual RAAS and dual MRA combinations are structurally blocked.',
    'Monitoring plans are auto-generated for high-risk RAAS/MRA/diuretic/SGLT2i intensification.'
];

const evidenceRows = [
    {
        drugClass: 'RAAS / ARNI',
        trials: 'PARADIGM-HF, PROVE-HF',
        modeledImpact: 'Neurohormonal unload, remodeling support, guideline pillar weighting in reduced EF phenotypes.'
    },
    {
        drugClass: 'Beta Blocker',
        trials: 'MERIT-HF, COPERNICUS, CIBIS-II',
        modeledImpact: 'Remodeling and rhythm protection with acute decompensation safety gating.'
    },
    {
        drugClass: 'SGLT2 Inhibitor',
        trials: 'DAPA-HF, EMPEROR-Reduced, EMPEROR-Preserved, DELIVER',
        modeledImpact: 'Cross-phenotype support with symptom and hospitalization benefit weighting.'
    },
    {
        drugClass: 'MRA / nsMRA',
        trials: 'RALES, EPHESUS, TOPCAT, FINEARTS-HF',
        modeledImpact: 'Guideline and adjunct contributions with hyperkalemia and dual-MRA protection logic.'
    },
    {
        drugClass: 'Loop Strategy (including Furoscix)',
        trials: 'Loop diuretic standard evidence + outpatient worsening-HF pathway assumptions',
        modeledImpact: 'Volume-targeted decongestion scoring, CKD/over-diuresis guardrails, Furoscix-specific safety warnings.'
    }
];

export const FAQ: React.FC = () => {
    return (
        <div className="h-full overflow-y-auto bg-slate-50 custom-scrollbar p-8">
            <div className="max-w-5xl mx-auto space-y-8 pb-16">

                <div className="border-b border-slate-200 pb-6">
                    <h2 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <QuestionMarkCircleIcon className="w-8 h-8 text-indigo-600" />
                        Clinical Logic, Safety, and Evidence
                    </h2>
                    <p className="text-slate-500 mt-2 text-lg leading-relaxed">
                        HeartFailurePATH uses a deterministic seven-domain simulation engine for regimen optimization across HFrEF, HFmrEF, HFpEF, and HFimpEF-preservation pathways.
                    </p>
                </div>

                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <HeartIcon className="w-6 h-6 text-indigo-600" />
                            Seven-Domain Scoring Framework
                        </h3>
                    </div>
                    <div className="p-6 space-y-4 text-slate-700">
                        <p>
                            Each projected regimen receives seven domain scores (0-100), then a weighted overall score:
                            Neuro 20%, Functional 15%, Volume 15%, Structure 10%, Cost 15%, Adherence 10%, Guideline 15%.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            {domainCards.map(card => (
                                <div key={card.title} className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                                    <h4 className={`font-bold mb-2 ${card.color}`}>{card.title}</h4>
                                    <p className="text-sm">{card.description}</p>
                                    <ul className="text-xs mt-2 list-disc list-inside text-slate-500">
                                        {card.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <CalculationIcon className="w-5 h-5 text-indigo-600" />
                            Simulation and Safety Pipeline
                        </h3>
                    </div>
                    <div className="p-6 space-y-6 text-slate-700">
                        <div>
                            <h4 className="font-bold text-lg mb-2">Engine Sequence</h4>
                            <ol className="list-decimal list-inside text-sm space-y-2">
                                <li>Validate and sanitize current patient data (for example duplicate current meds, BP consistency).</li>
                                <li>Generate candidate modifications (add/up/down/swap/remove) under visit-class and contraindication constraints.</li>
                                <li>Project physiologic and safety deltas for each candidate regimen.</li>
                                <li>Score candidates across seven domains, apply safety penalties, and filter unsafe projections.</li>
                                <li>Return up to three clinically distinct regimens plus structured monitoring plans.</li>
                            </ol>
                        </div>
                        <div>
                            <h4 className="font-bold text-lg mb-2">Safety and Eligibility Checks</h4>
                            <ul className="list-disc list-inside text-sm space-y-2 pl-2">
                                {safetyChecks.map(check => <li key={check}>{check}</li>)}
                            </ul>
                        </div>
                    </div>
                </section>

                <section className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100 bg-indigo-50/50">
                        <h3 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                            <LightBulbIcon className="w-5 h-5 text-indigo-600" />
                            Evidence and Furoscix Notes
                        </h3>
                    </div>
                    <div className="p-6 space-y-4">
                        <p className="text-sm text-slate-700">
                            Trial alignment informs effect sizes and class-level priorities. Furoscix is implemented as a loop-strategy option for persistent congestion, with explicit contraindication checks and mandatory device-use warnings when selected.
                        </p>
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-xs">
                                    <tr>
                                        <th className="px-4 py-3">Drug Class</th>
                                        <th className="px-4 py-3">Key Evidence</th>
                                        <th className="px-4 py-3">Modeled Impact</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {evidenceRows.map(row => (
                                        <tr key={row.drugClass}>
                                            <td className="px-4 py-3 font-bold text-slate-800">{row.drugClass}</td>
                                            <td className="px-4 py-3 text-slate-600">{row.trials}</td>
                                            <td className="px-4 py-3 text-slate-600">{row.modeledImpact}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700">
                            <p className="font-semibold text-slate-800 mb-1">Furoscix-specific implementation summary</p>
                            <ul className="list-disc list-inside space-y-1">
                                <li>Modeled as `Furoscix (SC Furosemide)` in Loop Diuretic class.</li>
                                <li>Preferred in eligible worsening-congestion loop escalation pathways.</li>
                                <li>Blocked for hypersensitivity (furosemide or adhesive/acrylate), low congestion context, or severe renal limits.</li>
                                <li>When selected, the regimen includes mandatory `FUROSCIX SAFETY` warning text.</li>
                            </ul>
                        </div>
                    </div>
                </section>

                <div className="bg-slate-100 p-4 rounded-lg text-xs text-slate-500 leading-relaxed border border-slate-200">
                    <strong>Disclaimer:</strong> This software is a clinical decision-support simulation tool. It projects responses from deterministic model assumptions and trial-informed class effects, not individualized pharmacogenomic prediction. It should not be used as the sole basis for prescribing decisions.
                </div>

            </div>
        </div>
    );
};
