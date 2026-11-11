import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PatientForm } from './components/PatientForm';
import { ClinicalSummary } from './components/ClinicalSummary';
import { ResultsDisplay } from './components/ResultsDisplay';
import { MedicationLibrary } from './components/MedicationLibrary';
import { FAQ } from './components/FAQ';
import { EvidenceContext } from './components/EvidenceContext';
import { Patient, ScoredRegimen, ExcludedMedication, MonitoringPlanItem } from './types';
import { generateAndScoreModifications } from './services/simulationService';
import { getDrugPrices } from './services/pricingService';
import { MEDICATION_FORMULARY } from './constants';
import { TableIcon, BookOpenIcon, QuestionMarkCircleIcon } from './components/icons';
import { SCENARIOS, INITIAL_PATIENT, clonePatient } from './data/scenarios';



// "Custom profile" starts from an empty chart, never from the previously loaded sample, so no value
// from another patient can carry into a new one unnoticed. Potassium/creatinine 0 is the engine's
// "not entered" sentinel; everything else clinical is left blank for the clinician to enter.
function blankPatient(): Patient {
    const base = clonePatient(INITIAL_PATIENT);
    const blank = {
        ...base,
        age: undefined, height_cm: undefined, bmi: 0,
        sbp: undefined, dbp: undefined, pulse: undefined, oxygen_saturation: undefined,
        rhythm: 'Sinus', nt_pro_bnp: undefined, nyha_class: 'II', kccq_score: undefined, daily_step_count: undefined,
        lvef: undefined, lvedd: undefined, lavi: undefined, peak_flow_lpm: undefined, previous_lvef: undefined,
        volume_status: { dry_weight_kg: undefined, current_weight_kg: undefined, exam_findings: new Set<string>() },
        egfr: 0, potassium: 0, creatinine: 0, bun: undefined, ferritin: undefined, tsat: undefined, hemoglobin: undefined,
        comorbidities: new Set<string>(), external_medications: new Set<string>(), allergies: new Set<string>(),
        discontinued_meds: [], current_regimen: [],
    };
    return blank as unknown as Patient;
}

function App() {
    const [patient, setPatient] = useState<Patient>(INITIAL_PATIENT);
    const [scenario, setScenario] = useState<string>(SCENARIOS[0].title);
    const [results, setResults] = useState<ScoredRegimen[]>([]);
    const [excludedMeds, setExcludedMeds] = useState<ExcludedMedication[]>([]);
    const [clinicalAlerts, setClinicalAlerts] = useState<string[]>([]);
    const [monitoringPlan, setMonitoringPlan] = useState<MonitoringPlanItem[]>([]);
    const [gdmtGaps, setGdmtGaps] = useState<string[]>([]);
    const [eligibleAdjuncts, setEligibleAdjuncts] = useState<string[]>([]);
    const [missingDataNotices, setMissingDataNotices] = useState<string[]>([]);
    const [followUpCalendar, setFollowUpCalendar] = useState<MonitoringPlanItem[]>([]);
    // Incremented per successful analysis so result cards remount (resetting per-card
    // disclosure/modal state) instead of positionally inheriting it across runs.
    const [runId, setRunId] = useState(0);
    const [simError, setSimError] = useState<string | null>(null);
    const [drugPrices, setDrugPrices] = useState<Record<string, number>>({});
    const [pricesLoading, setPricesLoading] = useState(true);
    const [priceLoadError, setPriceLoadError] = useState<string | null>(null);
    const [simMeds, setSimMeds] = useState<Set<string>>(new Set(MEDICATION_FORMULARY.map(m => m.name)));

    // Run-state: distinguishes "never run" (show first-run guidance) from "ran, then inputs
    // changed" (show a stale-results banner so an old plan is never read against new data).
    const [hasRun, setHasRun] = useState(false);
    const [resultsStale, setResultsStale] = useState(false);
    const lastRunInputsRef = useRef<string>('');

    // Navigation State
    const [activeTab, setActiveTab] = useState<'simulation' | 'library' | 'faq'>('simulation');
    // Evidence tab filter, owned here so a link on a result card can open the tab already filtered.
    const [evidenceQuery, setEvidenceQuery] = useState('');
    const [evidenceJump, setEvidenceJump] = useState(0);
    const openEvidence = useCallback((query: string) => {
        setEvidenceQuery(query);
        setEvidenceJump(n => n + 1);
        setActiveTab('faq');
    }, []);
    const evidenceCtx = useMemo(() => ({ openEvidence }), [openEvidence]);

    useEffect(() => {
        let active = true;
        setPricesLoading(true);
        setPriceLoadError(null);
        getDrugPrices(MEDICATION_FORMULARY.map(m => m.name), patient.insurance_tier)
            .then(prices => {
                if (!active) return;
                setDrugPrices(prices);
            })
            .catch(err => {
                if (!active) return;
                setDrugPrices({});
                setPriceLoadError(err instanceof Error ? err.message : 'Unable to load drug prices.');
            })
            .finally(() => {
                if (active) setPricesLoading(false);
            });
        return () => {
            active = false;
        };
    }, [patient.insurance_tier]);

    const pricesReady = !pricesLoading && !priceLoadError && Object.keys(drugPrices).length > 0;

    // Serialize inputs for change detection (Sets → arrays; functions on med objects are dropped
    // by JSON.stringify, which is fine — name/dose still serialize and reflect edits).
    const serializeInputs = (p: Patient, meds: Set<string>) =>
        JSON.stringify({ p, m: [...meds] }, (_k, v) => (v instanceof Set ? [...v] : v));

    useEffect(() => {
        if (!hasRun) return;
        if (serializeInputs(patient, simMeds) !== lastRunInputsRef.current) {
            setResultsStale(true);
        }
    }, [patient, simMeds, hasRun]);

    const handleScenarioChange = (title: string) => {
        setScenario(title);
        if (title === 'custom') {
            setPatient(blankPatient());
            return;
        }
        const s = SCENARIOS.find(sc => sc.title === title);
        if (s) {
            // Use custom clone instead of JSON.parse/stringify to preserve Sets
            setPatient(clonePatient(s.patient));
        }
    };

    const runSimulation = () => {
        if (!pricesReady) {
            setSimError(priceLoadError ?? 'Drug pricing is still loading. Run analysis after prices finish loading.');
            return;
        }
        setSimError(null);
        lastRunInputsRef.current = serializeInputs(patient, simMeds);
        setHasRun(true);
        setResultsStale(false);
        // The engine is synchronous and fast — compute inline (no artificial delay).
        try {
            const { scoredRegimens, excludedMedications, clinicalAlerts: alerts, monitoringPlan: plan, gdmtGaps: gaps, eligibleAdjuncts: adjuncts, missingDataNotices: notices, followUpCalendar: calendar } = generateAndScoreModifications(patient, simMeds, drugPrices);
            setResults(scoredRegimens);
            setExcludedMeds(excludedMedications);
            setClinicalAlerts(alerts);
            setMonitoringPlan(plan);
            setGdmtGaps(gaps ?? []);
            setEligibleAdjuncts(adjuncts ?? []);
            setMissingDataNotices(notices ?? []);
            setFollowUpCalendar(calendar ?? []);
            setRunId(r => r + 1);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'An unexpected error occurred during analysis.';
            setSimError(message);
            setResults([]);
            setExcludedMeds([]);
            setClinicalAlerts([]);
            setMonitoringPlan([]);
            setGdmtGaps([]);
            setEligibleAdjuncts([]);
            setMissingDataNotices([]);
            setFollowUpCalendar([]);
        }
    };

    // Referentially-stable rerun callback so React.memo on ResultsDisplay is effective —
    // the ref always points at the latest runSimulation closure.
    const runSimRef = useRef(runSimulation);
    runSimRef.current = runSimulation;
    const stableRerun = useCallback(() => runSimRef.current(), []);

    const tabClass = (tab: 'simulation' | 'library' | 'faq') =>
        `px-3 sm:px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;

    // WAI-ARIA Tabs keyboard pattern: roving tabindex with arrow-key navigation and
    // automatic activation (selection follows focus).
    const TABS = ['simulation', 'library', 'faq'] as const;
    const handleTablistKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
        const currentIndex = TABS.indexOf(activeTab);
        let nextIndex: number;
        if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
        else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
        else if (e.key === 'Home') nextIndex = 0;
        else if (e.key === 'End') nextIndex = TABS.length - 1;
        else return;
        e.preventDefault();
        const nextTab = TABS[nextIndex];
        setActiveTab(nextTab);
        document.getElementById(`tab-${nextTab}`)?.focus();
    };

    return (
        <EvidenceContext.Provider value={evidenceCtx}>
        <div className="min-h-screen lg:h-screen w-full flex flex-col bg-slate-50 text-slate-800 font-sans lg:overflow-hidden print:h-auto print:overflow-visible">
            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-indigo-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:font-bold">
                Skip to main content
            </a>
            {/* Header */}
            <header className="min-h-16 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 sm:px-6 py-2 shadow-sm z-20 print:hidden">
                <div className="flex items-center">
                    <div className="h-9 w-9 bg-indigo-600 rounded-lg flex items-center justify-center mr-3 shadow-indigo-200 shadow-lg">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-slate-900 tracking-tight leading-none">HeartFailurePATH</h1>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mt-0.5 hidden sm:block">GDMT Gap &amp; Safety Checklist</p>
                    </div>
                </div>

                {/* Navigation Tabs */}
                <nav className="flex bg-slate-100 p-1 rounded-lg" role="tablist" aria-label="Application sections" onKeyDown={handleTablistKeyDown}>
                    <button
                        id="tab-simulation"
                        onClick={() => setActiveTab('simulation')}
                        className={tabClass('simulation')}
                        role="tab"
                        aria-selected={activeTab === 'simulation'}
                        aria-controls="tabpanel-simulation"
                        tabIndex={activeTab === 'simulation' ? 0 : -1}
                    >
                        <TableIcon className="w-4 h-4" aria-hidden="true" />
                        Analysis
                    </button>
                    <button
                        id="tab-library"
                        onClick={() => setActiveTab('library')}
                        className={tabClass('library')}
                        role="tab"
                        aria-selected={activeTab === 'library'}
                        aria-controls="tabpanel-library"
                        tabIndex={activeTab === 'library' ? 0 : -1}
                    >
                        <BookOpenIcon className="w-4 h-4" aria-hidden="true" />
                        Formulary
                    </button>
                    <button
                        id="tab-faq"
                        onClick={() => setActiveTab('faq')}
                        className={tabClass('faq')}
                        role="tab"
                        aria-selected={activeTab === 'faq'}
                        aria-controls="tabpanel-faq"
                        tabIndex={activeTab === 'faq' ? 0 : -1}
                    >
                        <QuestionMarkCircleIcon className="w-4 h-4" aria-hidden="true" />
                        Evidence
                    </button>
                </nav>
            </header>

            <main id="main-content" className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden relative min-w-0 print:block print:overflow-visible">
                {/* Kept mounted (just hidden) when another tab is open, so the results and scroll position survive a visit to the Evidence tab. */}
                {(
                    <div id="tabpanel-simulation" role="tabpanel" aria-labelledby="tab-simulation" hidden={activeTab !== 'simulation'} className={`${activeTab === 'simulation' ? 'flex' : 'hidden'} flex-col lg:flex-row flex-1 min-w-0 lg:min-h-0 print:block`}>
                        {/* Left: Inputs */}
                        <aside aria-label="Patient inputs" className="w-full lg:w-[360px] lg:flex-shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white flex flex-col z-10 shadow-lg print:hidden">
                            <PatientForm
                                patientData={patient}
                                setPatientData={setPatient}
                                simulationMedicationNames={simMeds}
                                setSimulationMedicationNames={setSimMeds}
                                onRunSimulation={runSimulation}
                                pricesReady={pricesReady}
                                testScenarios={SCENARIOS}
                                selectedScenario={scenario}
                                onScenarioChange={handleScenarioChange}
                            />
                        </aside>

                        {/* Middle: Summary */}
                        <aside aria-label="Patient status summary" className="w-[280px] border-r border-slate-200 bg-slate-50/50 hidden xl:flex flex-col print:hidden">
                            <ClinicalSummary patient={patient} drugPrices={drugPrices} />
                        </aside>

                        {/* Right: Results */}
                        <section aria-label="Results" className="flex-1 min-w-0 bg-slate-50 lg:overflow-y-auto p-4 sm:p-8 custom-scrollbar print:p-0 print:overflow-visible">
                            <div className="max-w-5xl mx-auto">
                                <ResultsDisplay
                                    results={results}
                                    runId={runId}
                                    error={simError}
                                    hasRun={hasRun}
                                    resultsStale={resultsStale}
                                    onRerun={stableRerun}
                                    excludedMedications={excludedMeds}
                                    clinicalAlerts={clinicalAlerts}
                                    monitoringPlan={monitoringPlan}
                                    gdmtGaps={gdmtGaps}
                                    eligibleAdjuncts={eligibleAdjuncts}
                                    missingDataNotices={missingDataNotices}
                                    followUpCalendar={followUpCalendar}
                                />
                            </div>
                        </section>
                    </div>
                )}

                {activeTab === 'library' && (
                    <section id="tabpanel-library" role="tabpanel" aria-labelledby="tab-library" className="flex-1 bg-slate-50 w-full">
                        <MedicationLibrary />
                    </section>
                )}

                {activeTab === 'faq' && (
                    <section id="tabpanel-faq" role="tabpanel" aria-labelledby="tab-faq" className="flex-1 bg-slate-50 w-full min-w-0 print:hidden">
                        <FAQ evidenceQuery={evidenceQuery} onEvidenceQueryChange={setEvidenceQuery} jumpNonce={evidenceJump} />
                    </section>
                )}
            </main>
        </div>
        </EvidenceContext.Provider>
    );
}

export default App;
