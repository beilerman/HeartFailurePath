import React, { useMemo } from 'react';
import type { Patient, TestScenario } from '../types';
import { VISIT_LIMIT_WORDS } from '../services/engine/thresholds';
import { Label, Select } from './patient-form/Common';
import { FORM_SECTION_IDS, FormSection, usePatientFormModel } from './patient-form/usePatientFormModel';

interface PatientFormProps {
    patientData: Patient;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
    simulationMedicationNames: Set<string>;
    setSimulationMedicationNames: React.Dispatch<React.SetStateAction<Set<string>>>;
    onRunSimulation: () => void;
    /** Reports whether the form currently has blocking input errors, so every way of running the analysis (the form button AND the "Re-run" button on the results) obeys them. */
    onValidityChange?: (hasErrors: boolean) => void;
    onPendingChange?: (pending: boolean) => void;
    pricesReady: boolean;
    priceLoadError?: string | null;
    onRetryPrices?: () => void;
    testScenarios: TestScenario[];
    selectedScenario: string;
    onScenarioChange: (title: string) => void;
}

export const PatientForm: React.FC<PatientFormProps> = ({
    patientData, setPatientData,
    onRunSimulation, onValidityChange, onPendingChange, pricesReady, priceLoadError, onRetryPrices,
    testScenarios, selectedScenario, onScenarioChange
}) => {
    const model = usePatientFormModel({ patientData, setPatientData, onValidityChange, onPendingChange });
    const { urgentFindings, hasValidationErrors, problemEntries, focusField } = model;

    // The sample list is long (clinical cases plus per-medication review cases); group it so the
    // everyday cases are not buried. Titles like "Rate-Source ..." belong to a medication-review group.
    const scenarioGroups = useMemo(() => {
        const groups = new Map<string, string[]>();
        const order: string[] = [];
        for (const sc of testScenarios) {
            const m = /^([A-Za-z0-9]+)-Source /.exec(sc.title);
            const label = m ? `Medication review: ${m[1]}` : 'Clinical cases';
            if (!groups.has(label)) { groups.set(label, []); order.push(label); }
            groups.get(label)!.push(sc.title);
        }
        return order.map(label => ({ label, titles: groups.get(label)! }));
    }, [testScenarios]);

    return (
        <div className="flex flex-col h-full bg-white">
            <div className="bg-slate-50 p-5 border-b border-slate-200">
                <Label htmlFor="scenarios">Load a sample patient, or start blank</Label>
                <Select
                    id="scenarios"
                    value={selectedScenario}
                    onChange={(e) => onScenarioChange(e.target.value)}
                >
                    <option value="custom">Custom profile (blank form)</option>
                    {scenarioGroups.map(g => (
                        <optgroup key={g.label} label={g.label}>
                            {g.titles.map(t => <option key={t} value={t}>{t}</option>)}
                        </optgroup>
                    ))}
                </Select>
                <p className="mt-2 text-xs font-semibold text-slate-600">{selectedScenario === 'custom' ? 'New case: clinical findings must be entered from the chart.' : 'Example case: contains sample data. Choose Custom profile for a new case.'}</p>
                {urgentFindings.length > 0 && <div role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-950">
                    <p className="font-bold">Recorded findings need prompt clinical review</p>
                    <ul className="mt-2 list-disc pl-5 space-y-2">{urgentFindings.map(finding=><li key={finding}>{finding}</li>)}</ul>
                    <p className="mt-2">These findings remain visible while other entries are incomplete or being corrected.</p>
                </div>}
                <nav aria-label="Patient form sections" className="mt-3 flex flex-wrap gap-2">
                    {Object.entries({'patient-demographics':'Patient','patient-symptoms':'Symptoms','patient-exam':'Vitals / exam','patient-diagnostics':'Labs / echo','patient-history':'History / allergies','patient-scope':'Scope question','patient-medications':'Medications','patient-social':'Preferences'}).map(([id,label]) => (
                        <button key={id} type="button" onClick={()=>focusField(id)} className="px-2 py-1.5 text-xs font-semibold rounded bg-white border border-slate-300 text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500">{label}</button>
                    ))}
                </nav>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                {selectedScenario === 'custom' && (
                    <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                        Enter what is known and leave unavailable fields blank. The review will explain which decisions can be assessed and which wait for more information. Model preferences: cost sensitivity {patientData.cost_sensitivity}/10, regimen complexity tolerance {patientData.complexity_tolerance}/10, and a limit of {patientData.max_new_classes_per_visit} per visit. {VISIT_LIMIT_WORDS} Unchecked history or examination items mean not recorded, not confirmed absent.
                    </p>
                )}
                {FORM_SECTION_IDS.map(id => <FormSection key={id} id={id} model={model} />)}
            </div>

            <div className="sticky bottom-0 p-5 border-t border-slate-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                {priceLoadError && <div role="alert" className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                    <p>Pricing could not be loaded: {priceLoadError}. Clinical review can continue; affordability will be unassessed.</p>
                    {onRetryPrices && <button type="button" onClick={onRetryPrices} className="mt-1 underline font-bold focus-visible:ring-2">Retry pricing</button>}
                </div>}
                {problemEntries.length > 0 && (
                    <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2" role="status">
                        <p className="text-xs font-bold text-red-800 mb-1">Before you can run the analysis ({problemEntries.length}):</p>
                        <ul className="text-xs text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
                            {problemEntries.map(([field, msg]) => (
                                <li key={field}>
                                    <button type="button" onClick={() => focusField(field)} className="underline text-left hover:text-red-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded">{msg}</button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <button
                    onClick={onRunSimulation}
                    disabled={hasValidationErrors}
                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold py-3.5 px-4 rounded-xl hover:shadow-lg transition-all disabled:opacity-50 text-base tracking-wide"
                >
                    {hasValidationErrors ? 'Correct or save entries to review' : 'Review available information'}
                </button>
                <p className="mt-2 text-[11px] text-slate-500 text-center">Missing information narrows the review; invalid values and unfinished entries must be corrected. {!pricesReady && !priceLoadError && patientData.insurance_tier ? 'Prices are loading; cost assessment waits for them.' : ''}</p>
            </div>
        </div>
    );
};
