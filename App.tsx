import { useState, useEffect, useRef, useCallback } from 'react';
import { PatientForm } from './components/PatientForm';
import { ClinicalSummary } from './components/ClinicalSummary';
import { ResultsDisplay } from './components/ResultsDisplay';
import { MedicationLibrary } from './components/MedicationLibrary';
import { FAQ } from './components/FAQ';
import { Patient, ScoredRegimen, ExcludedMedication, MonitoringPlanItem } from './types';
import { generateAndScoreModifications } from './services/simulationService';
import { getDrugPrices } from './services/pricingService';
import { MEDICATION_FORMULARY } from './constants';
import { TableIcon, BookOpenIcon, QuestionMarkCircleIcon } from './components/icons';
import { SCENARIOS, INITIAL_PATIENT, clonePatient } from './data/scenarios';



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
        `px-4 py-1.5 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;

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
        <div className="h-screen w-screen flex flex-col bg-slate-50 text-slate-800 font-sans overflow-hidden">
            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-indigo-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:font-bold">
                Skip to main content
            </a>
            {/* Header */}
            <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shadow-sm z-20">
                <div className="flex items-center">
                    <div className="h-9 w-9 bg-indigo-600 rounded-lg flex items-center justify-center mr-3 shadow-indigo-200 shadow-lg">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-slate-900 tracking-tight leading-none">HeartFailurePATH</h1>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-0.5">GDMT Gap &amp; Safety Checklist</p>
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

            <main id="main-content" className="flex-1 flex overflow-hidden relative">
                {activeTab === 'simulation' && (
                    <div id="tabpanel-simulation" role="tabpanel" aria-labelledby="tab-simulation" className="flex flex-1">
                        {/* Left: Inputs */}
                        <aside className="w-[360px] border-r border-slate-200 bg-white flex flex-col z-10 shadow-lg">
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
                        <aside className="w-[280px] border-r border-slate-200 bg-slate-50/50 hidden xl:flex flex-col">
                            <ClinicalSummary patient={patient} drugPrices={drugPrices} />
                        </aside>

                        {/* Right: Results */}
                        <section className="flex-1 bg-slate-50 overflow-y-auto p-8 custom-scrollbar">
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
                    <section id="tabpanel-faq" role="tabpanel" aria-labelledby="tab-faq" className="flex-1 bg-slate-50 w-full">
                        <FAQ />
                    </section>
                )}
            </main>
        </div>
    );
}

export default App;
