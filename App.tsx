import { blankPatient } from './components/patient-form/patientDraft';
import { validatePatientForm } from './components/patient-form/formValidation';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PatientForm } from './components/PatientForm';
import { ClinicalSummary } from './components/ClinicalSummary';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ResultsDisplay } from './components/ResultsDisplay';
import { MedicationLibrary } from './components/MedicationLibrary';
import { FAQ } from './components/FAQ';
import { EvidenceContext } from './components/EvidenceContext';
import type { WhyFirst } from './services/engine/whyFirst';
import { Patient, ScoredRegimen, ExcludedMedication, MonitoringPlanItem, DecisionReadiness, SimulationOutput } from './types';
import { RESEARCH_LINE } from './components/appStatements';
import { generateAndScoreModifications } from './services/simulationService';
import { getDrugPrices } from './services/pricingService';
import { MEDICATION_FORMULARY } from './constants';
import type { RunSnapshot } from './components/chartHeader';
import { SCOPE_STATEMENT } from './components/appStatements';
import { TableIcon, BookOpenIcon, QuestionMarkCircleIcon } from './components/icons';
import { StartScreen } from './components/guided/StartScreen';
import { StepsScreen } from './components/guided/StepsScreen';
import { GuidedResults } from './components/guided/GuidedResults';
import { REVIEW_STEP } from './components/guided/steps';
import { loadSession, saveSession, clearSession } from './components/guided/sessionStore';
import { SCENARIOS, clonePatient } from './data/scenarios';
import { DiscardConfirm, caseIsTouched } from './components/guided/DiscardConfirm';
type ViewMode = 'guided' | 'form';
type GuidedPhase = 'start' | 'steps' | 'results';
const initialView = (): ViewMode => {
    try { return new URLSearchParams(window.location.search).get('view') === 'form' ? 'form' : 'guided'; } catch { return 'guided'; }
};

// A reload mid-entry restores the entered patient for this tab (session storage only). Results are not stored: a restored session reopens at the Review step.
const savedSession = loadSession();
const restored = savedSession && savedSession.phase !== 'start' ? savedSession : undefined;

function App() {
    const [patient, setPatient] = useState<Patient>(() => restored?.patient ?? blankPatient());
    const [restoreFailed, setRestoreFailed] = useState(savedSession === null);
    const [pendingEntry, setPendingEntry] = useState(false);
    // Two views over the SAME patient, run and stale state: the guided flow (default) and the original full form.
    const [view, setView] = useState<ViewMode>(() => restoreFailed ? 'guided' : initialView());
    const [phase, setPhase] = useState<GuidedPhase>(restored || view === 'form' ? 'steps' : 'start');
    const [step, setStep] = useState(restored ? (restored.phase === 'results' ? REVIEW_STEP : restored.step) : 0);
    // Remounts the guided steps whenever a patient is loaded, so no draft entry from another patient survives.
    const [formEpoch, setFormEpoch] = useState(0);
    // An example card loads a scenario and runs it once its prices are ready.
    const [autoRun, setAutoRun] = useState(false);
    const [scenario, setScenario] = useState<string>(restored?.scenario ?? 'custom');
    const [results, setResults] = useState<ScoredRegimen[]>([]);
    const [excludedMeds, setExcludedMeds] = useState<ExcludedMedication[]>([]);
    const [clinicalAlerts, setClinicalAlerts] = useState<string[]>([]);
    const [monitoringPlan, setMonitoringPlan] = useState<MonitoringPlanItem[]>([]);
    const [gdmtGaps, setGdmtGaps] = useState<string[]>([]);
    const [eligibleAdjuncts, setEligibleAdjuncts] = useState<string[]>([]);
    const [missingDataNotices, setMissingDataNotices] = useState<string[]>([]);
    const [followUpCalendar, setFollowUpCalendar] = useState<MonitoringPlanItem[]>([]);
    const [decisionReadiness, setDecisionReadiness] = useState<DecisionReadiness>();
    const [whyFirst, setWhyFirst] = useState<WhyFirst | undefined>(undefined);
    const [scopeStatus, setScopeStatus] = useState<SimulationOutput['scope_status']>(undefined);
    const [evidenceBand, setEvidenceBand] = useState<SimulationOutput['evidence_band']>(undefined);
    // Incremented per successful analysis so result cards remount (resetting per-card
    // disclosure/modal state) instead of positionally inheriting it across runs.
    const [runId, setRunId] = useState(0);
    const [runSnapshot, setRunSnapshot] = useState<RunSnapshot | undefined>(undefined);
    // Bumped on every run attempt (success, engine error or blocked) so a latched render error never hides the newest outcome.
    const [attempt, setAttempt] = useState(0);
    const [simError, setSimError] = useState<string | null>(null);
    const [drugPrices, setDrugPrices] = useState<Record<string, number>>({});
    const [pricesLoading, setPricesLoading] = useState(true);
    const [priceLoadError, setPriceLoadError] = useState<string | null>(null);
    const [priceLoadAttempt, setPriceLoadAttempt] = useState(0);
    // The pricing tier whose load has finished (success or failure); lets an automatic run wait for the right prices.
    const [pricesSettledTier, setPricesSettledTier] = useState<string | undefined>(undefined);
    const [simMeds, setSimMeds] = useState<Set<string>>(new Set(MEDICATION_FORMULARY.map(m => m.name)));

    // Run-state: distinguishes "never run" (show first-run guidance) from "ran, then inputs
    // changed" (show a stale-results banner so an old plan is never read against new data).
    const [hasRun, setHasRun] = useState(false);
    const lastRunInputsRef = useRef<string>('');
    const hasRunRef = useRef(false);
    hasRunRef.current = hasRun;

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
        const tier = patient.insurance_tier;
        if (!tier) { setDrugPrices({}); setPricesLoading(false); setPriceLoadError(null); setPricesSettledTier(undefined); return; }
        setPricesLoading(true);
        setPriceLoadError(null);
        getDrugPrices(MEDICATION_FORMULARY.map(m => m.name), patient.insurance_tier)
            .then(prices => {
                if (!active) return;
                setDrugPrices(prices);
                setPricesSettledTier(tier);
                setPricesLoading(false); // in the same batch, so "settled" and "ready" are never seen apart
            })
            .catch(err => {
                if (!active) return;
                setDrugPrices({});
                setPriceLoadError(err instanceof Error ? err.message : 'Unable to load drug prices.');
                setPricesSettledTier(tier);
                setPricesLoading(false);
            })
            .finally(() => {
                if (active) setPricesLoading(false);
            });
        return () => {
            active = false;
        };
    }, [patient.insurance_tier, priceLoadAttempt]);

    // Session copy of the guided entry (nothing is sent anywhere). "Start over" clears it.
    useEffect(() => { if (restoreFailed) return; if (phase === 'start') clearSession(); else saveSession({ patient, step, phase, scenario }); }, [patient, step, phase, scenario, restoreFailed]);

    // Browser Back moves one step back in the guided entry instead of leaving the app: every phase or step change is a history entry.
    const fromPopRef = useRef(false);
    useEffect(() => {
        try {
            if (fromPopRef.current) { fromPopRef.current = false; return; }
            const cur = window.history.state as { hfp?: boolean; phase?: string; step?: number } | null;
            if (cur?.hfp && cur.phase === phase && cur.step === step) return;
            const entry = { hfp: true, phase, step };
            if (cur?.hfp) window.history.pushState(entry, ''); else window.history.replaceState(entry, '');
        } catch { /* history is a convenience only */ }
    }, [phase, step]);
    useEffect(() => {
        const onPop = (e: PopStateEvent) => {
            const st = e.state as { hfp?: boolean; phase?: GuidedPhase; step?: number } | null;
            if (!st?.hfp || !st.phase) return;
            fromPopRef.current = true;
            setPhase(st.phase === 'results' && !hasRunRef.current ? 'steps' : st.phase);
            setStep(st.phase === 'results' && !hasRunRef.current ? REVIEW_STEP : (st.step ?? 0));
        };
        window.addEventListener('popstate', onPop);
        return () => window.removeEventListener('popstate', onPop);
    }, []);

    useEffect(() => {
        if (!pendingEntry) return;
        const protectDraft = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', protectDraft);
        return () => window.removeEventListener('beforeunload', protectDraft);
    }, [pendingEntry]);

    const pricesReady = pricesSettledTier === patient.insurance_tier && !pricesLoading && !priceLoadError && Object.keys(drugPrices).length > 0;

    // Serialize inputs for change detection (Sets → arrays; functions on med objects are dropped
    // by JSON.stringify, which is fine — name/dose still serialize and reflect edits).
    const serializeInputs = (p: Patient, meds: Set<string>) =>
        JSON.stringify({ p, m: [...meds], case: scenario, prices: pricesReady ? drugPrices : {} }, (_k, v) => (v instanceof Set ? [...v] : v));

    const resultsStale = hasRun && serializeInputs(patient, simMeds) !== lastRunInputsRef.current;

    /** Returns true when the inputs passed validation and a run was attempted (false when blocked). */
    const runSimulation = (): boolean => {
        setAttempt(a => a + 1);
        // Every entry point obeys the form's input errors (the "Re-run" button on the results used to bypass them).
        if (pendingEntry || Object.keys(validatePatientForm(patient)).length > 0) {
            setSimError('Fix the highlighted input errors in the patient form, then run the analysis again.');
            return false;
        }
        setSimError(null);
        lastRunInputsRef.current = serializeInputs(patient, simMeds);
        setHasRun(true);
        // The engine is synchronous and fast — compute inline (no artificial delay).
        try {
            const { scoredRegimens, excludedMedications, clinicalAlerts: alerts, monitoringPlan: plan, gdmtGaps: gaps, eligibleAdjuncts: adjuncts, missingDataNotices: notices, followUpCalendar: calendar, decisionReadiness: readiness, why_first: why, scope_status: scope, evidence_band: band } = generateAndScoreModifications(patient, simMeds, pricesReady ? drugPrices : {});
            setResults(scoredRegimens);
            setExcludedMeds(excludedMedications);
            setClinicalAlerts(alerts);
            setMonitoringPlan(plan);
            setGdmtGaps(gaps ?? []);
            setEligibleAdjuncts(adjuncts ?? []);
            setMissingDataNotices(notices ?? []);
            setFollowUpCalendar(calendar ?? []);
            setDecisionReadiness(readiness);
            setWhyFirst(why);
            setScopeStatus(scope);
            setEvidenceBand(band);
            setRunSnapshot({ ranAt: new Date().toISOString(), patient: clonePatient(patient), caseLabel: scenario === 'custom' ? 'Custom case' : `EXAMPLE / TEST CASE: ${scenario}` });
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
            setDecisionReadiness(undefined);
            setWhyFirst(undefined);
            setScopeStatus(undefined);
            setEvidenceBand(undefined);
        }
        return true;
    };

    // Referentially-stable rerun callback so React.memo on ResultsDisplay is effective —
    // the ref always points at the latest runSimulation closure.
    const runSimRef = useRef(runSimulation);
    runSimRef.current = runSimulation;
    const stableRerun = useCallback(() => { runSimRef.current(); }, []);

    // Example cards: the scenario is already in state when this runs, and the prices for its tier have loaded
    // (otherwise the run would use no prices and be marked out of date the moment they arrive).
    const pricesSettled = !patient.insurance_tier || pricesSettledTier === patient.insurance_tier;
    useEffect(() => {
        if (!autoRun || !pricesSettled) return;
        setAutoRun(false);
        runSimRef.current();
    }, [autoRun, pricesSettled]);

    const clearRun = () => {
        setHasRun(false); lastRunInputsRef.current = '';
        setResults([]); setExcludedMeds([]); setClinicalAlerts([]); setMonitoringPlan([]); setGdmtGaps([]); setEligibleAdjuncts([]);
        setMissingDataNotices([]); setFollowUpCalendar([]); setDecisionReadiness(undefined); setWhyFirst(undefined); setScopeStatus(undefined); setEvidenceBand(undefined);
        setRunSnapshot(undefined); setSimError(null);
    };
    const loadPatient = (title: string, next: Patient) => {
        setConfirmDiscard(false);
        clearRun();
        setAutoRun(false);
        setPendingEntry(false);
        setRestoreFailed(false);
        setScenario(title);
        setPatient(next);
        setFormEpoch(n => n + 1);
    };
    const handleScenarioChange = (title: string) => {
        const next = title === 'custom' ? blankPatient() : SCENARIOS.find(s => s.title === title)?.patient;
        if (!next) return;
        loadPatient(title, clonePatient(next));
        setStep(0);
        setPhase('steps');
    };
    const openExample = (title: string) => {
        const s = SCENARIOS.find(sc => sc.title === title);
        if (!s) return;
        loadPatient(title, clonePatient(s.patient));
        setAutoRun(true);
        setPhase('results');
    };
    const startOver = () => {
        clearSession();
        loadPatient('custom', blankPatient());
        setStep(0);
        setPhase('start');
    };
    // "Choose a different patient" and "New patient" ask first when anything has been entered (in the page, not a browser dialog).
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const discardOpenerRef = useRef<HTMLElement | null>(null);
    const keepEditingRef = useRef<HTMLButtonElement>(null);
    const requestStartOver = () => {
        if (!caseIsTouched(patient, scenario, pendingEntry)) { startOver(); return; }
        discardOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setConfirmDiscard(true);
    };
    const afterDiscardPrompt = useRef<'opener' | 'top' | null>(null);
    useEffect(() => {
        if (confirmDiscard) { keepEditingRef.current?.focus(); return; }
        const where = afterDiscardPrompt.current; afterDiscardPrompt.current = null;
        if (where === 'opener') { const opener = discardOpenerRef.current; if (opener?.isConnected) opener.focus(); }
        else if (where === 'top') document.getElementById('guided-review')?.focus();
    }, [confirmDiscard]);
    // R12 D5(c): an open prompt belongs to the screen that opened it: any phase, step or view change (browser Back included) closes it.
    useEffect(() => { setConfirmDiscard(false); }, [phase, step, view, activeTab]); // R13 E5(b): a tab round trip closes it too
    const keepEditing = () => { afterDiscardPrompt.current = 'opener'; setConfirmDiscard(false); };
    const discardCase = () => { afterDiscardPrompt.current = 'top'; setConfirmDiscard(false); startOver(); };
    const startNewPatient = () => {
        loadPatient('custom', blankPatient());
        setStep(0);
        setPhase('steps');
    };
    const runFromReview = () => { if (runSimulation()) setPhase('results'); };
    const changeView = (next: ViewMode) => {
        if (next === 'form' && phase === 'start') startNewPatient();
        setView(next);
        try {
            const url = new URL(window.location.href);
            if (next === 'form') url.searchParams.set('view', 'form'); else url.searchParams.delete('view');
            window.history.replaceState(window.history.state, '', url);
        } catch { /* the URL is a convenience only */ }
    };
    const viewBtn = (mode: ViewMode) =>
        `min-h-[40px] px-2.5 sm:px-4 py-2 rounded-md text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${view === mode ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'}`;
    const caseLabel = runSnapshot?.caseLabel ?? (scenario === 'custom' ? 'Custom case' : `EXAMPLE / TEST CASE: ${scenario}`);

    const tabClass = (tab: 'simulation' | 'library' | 'faq') =>
        `px-2.5 sm:px-4 py-2 rounded-md text-sm font-bold flex items-center gap-1.5 sm:gap-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${activeTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;

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
            <a href="#main-content" className="sr-only print:hidden focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-indigo-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:font-bold">
                Skip to main content
            </a>
            {/* Header */}
            <header className="min-h-16 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-x-2 sm:gap-x-4 gap-y-2 px-3 sm:px-6 py-2 shadow-sm z-20 print:hidden">
                <div className="flex items-center">
                    <div className="h-8 w-8 sm:h-9 sm:w-9 bg-indigo-600 rounded-lg flex items-center justify-center mr-2 sm:mr-3 shadow-indigo-200 shadow-lg">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                    </div>
                    <div>
                        <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-none">HeartFailurePATH</h1>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mt-0.5 hidden sm:block">GDMT Gap &amp; Safety Checklist</p>
                    </div>
                </div>

                {/* View switch: both views edit the same patient */}
                {activeTab === 'simulation' && (
                    <div role="group" aria-label="Input view" className="flex bg-slate-100 p-1 rounded-lg">
                        <button type="button" disabled={pendingEntry && view !== 'guided'} onClick={() => changeView('guided')} aria-pressed={view === 'guided'} className={viewBtn('guided')}>Guided</button>
                        <button type="button" disabled={pendingEntry && view !== 'form'} onClick={() => changeView('form')} aria-pressed={view === 'form'} className={viewBtn('form')}>Full form</button>
                    </div>
                )}

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

            {/* The one always-visible line (U8a): on the landing page, every entry page and every results page, and in print. */}
            <p data-testid="research-line" role="note" className="bg-amber-50 border-b border-amber-300 px-3 sm:px-6 py-1.5 text-xs font-semibold text-amber-950">{RESEARCH_LINE}</p>

            {pendingEntry && activeTab === 'simulation' && <p role="status" className="bg-amber-50 px-4 py-2 text-sm">Save or cancel the unfinished entry before switching input views.</p>}
            {restoreFailed && <p role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm">
                The saved patient could not be restored in full. Start a new case and re-enter the observations and medication history before running a review.
            </p>}
            <main id="main-content" className="flex-1 flex flex-col lg:flex-row lg:overflow-hidden relative min-w-0 print:block print:overflow-visible">
                {/* Kept mounted (just hidden) when another tab is open, so the results and scroll position survive a visit to the Evidence tab. */}
                {(
                    <div id="tabpanel-simulation" role="tabpanel" aria-labelledby="tab-simulation" hidden={activeTab !== 'simulation'} className={`${activeTab === 'simulation' ? 'flex' : 'hidden'} flex-col lg:flex-row flex-1 min-w-0 lg:min-h-0 print:block`}>
                        {view === 'guided' ? (
                            <section id="guided-review" tabIndex={-1} aria-label="Guided review" className="focus:outline-none flex-1 min-w-0 bg-slate-50 lg:overflow-y-auto p-4 sm:p-8 custom-scrollbar print:p-0 print:overflow-visible">
                                <div className="max-w-[1100px] mx-auto">
                                    {phase !== 'start' && (
                                        <div className="mb-3 flex justify-end print:hidden">
                                            <button type="button" onClick={startOver} className="min-h-[36px] rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">Start over: clear the entered patient</button>
                                        </div>
                                    )}
                                    {confirmDiscard && <DiscardConfirm ref={keepEditingRef} onDiscard={discardCase} onKeep={keepEditing} />}
                                    {phase === 'start' && <StartScreen onOpenExample={openExample} onNewPatient={startNewPatient} />}
                                    {phase === 'steps' && (
                                        <StepsScreen
                                            key={`${scenario}:${formEpoch}`}
                                            patientData={patient}
                                            setPatientData={setPatient}
                                            step={step}
                                            onStepChange={setStep}
                                            onRun={runFromReview}
                                            onPendingChange={setPendingEntry}
                                            onBackToStart={requestStartOver}
                                            pricesReady={pricesReady}
                                            priceLoadError={priceLoadError}
                                            onRetryPrices={() => setPriceLoadAttempt(n => n + 1)}
                                        />
                                    )}
                                    {phase === 'results' && (
                                        <GuidedResults
                                            patient={patient}
                                            caseLabel={caseLabel}
                                            onEditInputs={() => { setStep(REVIEW_STEP); setPhase('steps'); }}
                                            onNewPatient={requestStartOver}
                                            running={autoRun}
                                            attempt={attempt}
                                            showNotice={autoRun || resultsStale || pendingEntry || !!simError || !hasRun}
                                            resultsProps={{
                                                results, runId, error: simError, hasRun, resultsStale: resultsStale || pendingEntry, onRerun: stableRerun,
                                                excludedMedications: excludedMeds, clinicalAlerts, monitoringPlan, gdmtGaps, eligibleAdjuncts, missingDataNotices,
                                                followUpCalendar, decisionReadiness, whyFirst, runSnapshot, scopeStatus, evidenceBand,
                                            }}
                                        />
                                    )}
                                </div>
                            </section>
                        ) : (
                        <>
                        {/* Left: Inputs */}
                        <aside aria-label="Patient inputs" className="w-full lg:w-[360px] lg:flex-shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 bg-white flex flex-col z-10 shadow-lg print:hidden">
                            <PatientForm
                                patientData={patient}
                                setPatientData={setPatient}
                                simulationMedicationNames={simMeds}
                                setSimulationMedicationNames={setSimMeds}
                                onRunSimulation={() => { if (runSimulation()) setPhase('results'); }}
                                key={scenario}
                                onPendingChange={setPendingEntry}
                                pricesReady={pricesReady}
                                priceLoadError={priceLoadError}
                                onRetryPrices={()=>setPriceLoadAttempt(n=>n+1)}
                                testScenarios={SCENARIOS}
                                selectedScenario={scenario}
                                onScenarioChange={handleScenarioChange}
                            />
                        </aside>

                        {/* Middle: Summary */}
                        <aside aria-label="Patient status summary" className="w-[280px] border-r border-slate-200 bg-slate-50/50 hidden 2xl:flex flex-col flex-shrink-0 print:hidden">
                            <ClinicalSummary patient={patient} drugPrices={pricesReady ? drugPrices : {}} />
                        </aside>

                        {/* Right: Results */}
                        <section aria-label="Results" className="flex-1 min-w-0 bg-slate-50 lg:overflow-y-auto p-4 sm:p-8 custom-scrollbar print:p-0 print:overflow-visible">
                            <div className="max-w-5xl mx-auto">
                                {/* A render error in a result card must not replace the whole app and discard the entered patient. */}
                                <ErrorBoundary compact key={attempt}>
                                <ResultsDisplay
                                    results={results}
                                    runId={runId}
                                    error={simError}
                                    hasRun={hasRun}
                                    resultsStale={resultsStale || pendingEntry}
                                    onRerun={stableRerun}
                                    excludedMedications={excludedMeds}
                                    clinicalAlerts={clinicalAlerts}
                                    monitoringPlan={monitoringPlan}
                                    gdmtGaps={gdmtGaps}
                                    eligibleAdjuncts={eligibleAdjuncts}
                                    missingDataNotices={missingDataNotices}
                                    followUpCalendar={followUpCalendar}
                                    decisionReadiness={decisionReadiness}
                                    whyFirst={whyFirst}
                                    runSnapshot={runSnapshot}
                                    scopeStatus={scopeStatus}
                                    evidenceBand={evidenceBand}
                                />
                                </ErrorBoundary>
                            </div>
                        </section>
                        </>
                        )}
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
            <footer className="px-4 sm:px-6 py-1.5 bg-white border-t border-slate-200 text-xs text-slate-600 print:hidden">
                {SCOPE_STATEMENT}
            </footer>
        </div>
        </EvidenceContext.Provider>
    );
}

export default App;
