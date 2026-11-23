import { exposureAfterDoseEdit, useStatusWords } from '../guided/confirmUse';
import React, { useState, useMemo, useEffect } from 'react';
import { PillIcon } from '../icons';
import { Label, Select } from './Common';
import { MEDICATION_FORMULARY } from '../../constants';
import type { Patient, RegimenMed } from '../../types';
import { doseLabel, frequencyLabel } from '../clinicalPresentation';

interface MedicationManagerProps {
    patientData: Patient;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
    onPendingChange?: (pending: boolean) => void;
}

export const MedicationManager: React.FC<MedicationManagerProps> = ({ patientData, setPatientData, onPendingChange }) => {
    // State for adding new medication
    const [selectedMedName, setSelectedMedName] = useState<string>('');
    const [selectedDoseStrength, setSelectedDoseStrength] = useState<string>('');
    const [selectedFreq, setSelectedFreq] = useState<string>('');
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const pending = selectedMedName !== '';
    useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
    useEffect(() => { if (editingIndex !== null) document.getElementById('add-medication-dose')?.focus(); }, [editingIndex]);
    const resetEntry = () => { setSelectedMedName(''); setSelectedDoseStrength(''); setSelectedFreq(''); setEditingIndex(null); };

    // Derived state for medication selection
    const selectedMedInfo = useMemo(() =>
        MEDICATION_FORMULARY.find(m => m.name === selectedMedName),
        [selectedMedName]);
    const isDuplicateSelection = useMemo(() => {
        if (!selectedMedInfo) return false;
        return patientData.current_regimen.some((item, index) => index !== editingIndex && item.med.name === selectedMedInfo.name);
    }, [patientData.current_regimen, selectedMedInfo, editingIndex]);

    const availableDoses = selectedMedInfo?.available_doses || [];

    const updateExposure = (index: number, change: Partial<NonNullable<RegimenMed['exposure']>>) => {
        setPatientData(prev => ({ ...prev, current_regimen: prev.current_regimen.map((r,i) => i === index ? { ...r, exposure: { ...r.exposure, ...change } } : r) }));
    };

    const handleAddMedication = () => {
        if (!selectedMedInfo || !selectedDoseStrength || !selectedFreq) return;
        if (isDuplicateSelection) return;

        // Find the full dose object
        const doseObj = availableDoses.find(d => String(d.strength) === selectedDoseStrength);
        if (!doseObj || !doseObj.frequency_options.includes(selectedFreq)) return;

        const newRegimenItem: RegimenMed = {
            med: selectedMedInfo,
            dose: doseObj,
            selected_frequency: selectedFreq,
            ...(editingIndex !== null && patientData.current_regimen[editingIndex].exposure
                ? { exposure: String(patientData.current_regimen[editingIndex].dose.strength) !== selectedDoseStrength || patientData.current_regimen[editingIndex].selected_frequency !== selectedFreq
                    ? exposureAfterDoseEdit(patientData.current_regimen[editingIndex].exposure) : patientData.current_regimen[editingIndex].exposure } : {})
        };

        setPatientData(prev => ({
            ...prev,
            current_regimen: editingIndex !== null
                ? prev.current_regimen.map((r, index) => index === editingIndex ? newRegimenItem : r)
                : prev.current_regimen.some(item => item.med.name === newRegimenItem.med.name)
                ? prev.current_regimen
                : [...(prev.current_regimen || []), newRegimenItem]
        }));

        // Reset fields
        resetEntry();
    };

    const handleRemoveMedication = (index: number) => {
        resetEntry();
        setPatientData(prev => ({
            ...prev,
            current_regimen: prev.current_regimen.filter((_, i) => i !== index)
        }));
    };

    return (
        <section id="patient-medications" tabIndex={-1}>
            <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
                <PillIcon className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Medication list and course history
            </h3>

            {/* List */}
            <div className="space-y-2.5 mb-5">
                {patientData.current_regimen.length === 0 && (
                    <p className="text-sm text-slate-600 py-3">No heart-failure medications entered. Confirm the current list before running.</p>
                )}
                {patientData.current_regimen.map((item, idx) => (
                    <div key={idx} className="flex items-start justify-between bg-slate-50 p-3 rounded-md border border-slate-200">
                        <div>
                            <div className="text-sm font-bold text-slate-800">{item.med.name}</div>
                            <div className="text-sm text-slate-600">{doseLabel(item)}</div>
                            <details id={`medication_exposure_${idx}`} tabIndex={-1} className="mt-2 text-sm">
                                <summary className="cursor-pointer text-indigo-700">Use and course history: {useStatusWords(item.exposure)}</summary>
                                <div className="grid gap-2 mt-2">
                                    <label htmlFor={`exposure-status-${idx}`}>Current use</label>
                                    <select id={`exposure-status-${idx}`} className="border rounded p-2" value={item.exposure?.status ?? ''} onChange={e => updateExposure(idx, { status: (e.target.value || undefined) as NonNullable<RegimenMed['exposure']>['status'], restart_or_repeat_reviewed: false, dose_interval_reviewed: false, adherence: undefined })}>
                                        <option value="">Not assessed</option><option value="active">Taking as recorded</option><option value="unknown">Current use uncertain</option><option value="held">Held: restart needs review</option>
                                        {(item.med.facts?.single_course_dose || item.med.facts?.short_course_addon) && <option value="completed">Course completed</option>}
                                    </select>
                                    {['held','completed'].includes(item.exposure?.status ?? '') && <label className="flex gap-2 items-start"><input type="checkbox" checked={item.exposure?.restart_or_repeat_reviewed === true} onChange={e => updateExposure(idx, { restart_or_repeat_reviewed: e.target.checked })} /><span>Reason and interval reviewed; a new start or course may be considered. Other dose and safety prerequisites still apply.</span></label>}
                                    <label htmlFor={`exposure-adherence-${idx}`}>Consistency of use</label>
                                    <select id={`exposure-adherence-${idx}`} className="border rounded p-2" value={item.exposure?.adherence ?? ''} onChange={e => updateExposure(idx, { adherence: (e.target.value || undefined) as NonNullable<RegimenMed['exposure']>['adherence'] })}>
                                        <option value="">Not assessed</option><option value="consistent">Consistent use confirmed</option><option value="partial">Partial / interrupted use</option><option value="unknown">Unknown</option>
                                    </select>
                                    {([['started_on','Started'],['dose_changed_on','Current dose since'],['last_dose_on','Last dose (especially course treatment)']] as const).map(([field,label]) => <label key={field} className="grid gap-1" htmlFor={`exposure-${field}-${idx}`}>{label}<input id={`exposure-${field}-${idx}`} type="date" className="border rounded p-2" value={item.exposure?.[field] ?? ''} onChange={e => updateExposure(idx, { [field]: e.target.value || undefined })} /></label>)}
                                    <label className="flex items-start gap-2"><input type="checkbox" checked={item.exposure?.dose_interval_reviewed === true} onChange={e => updateExposure(idx, { dose_interval_reviewed: e.target.checked })} /><span>Drug-specific time at this dose and tolerance reviewed for a possible increase.</span></label>
                                    <p className="text-xs text-slate-600">Unknown timing does not establish steady treatment effect or tolerance. Held or completed entries are excluded from active therapy; their previous benefit is not subtracted from measured values.</p>
                                </div>
                            </details>
                        </div>
                        <button type="button" aria-label={`Edit ${item.med.name} dose and frequency`} className="ml-auto px-2 py-2 text-sm font-semibold text-indigo-700 focus-visible:ring-2" onClick={()=>{
                            setEditingIndex(idx);setSelectedMedName(item.med.name);setSelectedDoseStrength(String(item.dose.strength));setSelectedFreq(item.selected_frequency);
                        }}>Edit</button>
                        <button
                            onClick={() => handleRemoveMedication(idx)}
                            className="text-slate-400 hover:text-red-500 p-1.5"
                            aria-label={`Remove ${item.med.name} from the entered list`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                ))}
            </div>

            {/* Add New */}
            <div className="bg-indigo-50/50 p-4 rounded-lg border border-indigo-100 space-y-3">
                <div>
                    <Label htmlFor="add-medication-drug">{editingIndex === null ? 'Add current medication' : 'Edit current medication'}</Label>
                    <Select
                        id="add-medication-drug"
                        value={selectedMedName}
                        disabled={editingIndex !== null}
                        onChange={(e) => {
                            setSelectedMedName(e.target.value);
                            setSelectedDoseStrength('');
                            setSelectedFreq('');
                        }}
                    >
                        <option value="">Select drug...</option>
                        {MEDICATION_FORMULARY.map(m => (
                            <option key={m.name} value={m.name}>{m.name} ({m.drug_class})</option>
                        ))}
                    </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <Label htmlFor="add-medication-dose">Dose each time</Label>
                        <Select
                            id="add-medication-dose"
                            value={selectedDoseStrength}
                            onChange={(e) => {
                                setSelectedDoseStrength(e.target.value);
                                setSelectedFreq('');
                            }}
                            disabled={!selectedMedName}
                        >
                            <option value="">Dose...</option>
                            {availableDoses.map((d, i) => (
                                <option key={i} value={String(d.strength)}>
                                    {d.strength} {d.unit}: {d.formulation}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="add-medication-freq">Frequency</Label>
                        <Select
                            id="add-medication-freq"
                            value={selectedFreq}
                            onChange={(e) => setSelectedFreq(e.target.value)}
                            disabled={!selectedDoseStrength}
                        >
                            <option value="">Select frequency</option>
                            {selectedDoseStrength && availableDoses
                                .find(d => String(d.strength) === selectedDoseStrength)
                                ?.frequency_options.map(f => (
                                    <option key={f} value={f}>{frequencyLabel(f)}</option>
                                ))
                            }
                        </Select>
                    </div>
                </div>

                <button
                    onClick={handleAddMedication}
                    disabled={!selectedMedName || !selectedDoseStrength || !selectedFreq || isDuplicateSelection}
                    className="w-full py-2 bg-white border border-indigo-200 text-indigo-600 text-sm font-bold rounded hover:bg-indigo-50 hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                    {editingIndex === null ? 'Add to current medication list' : 'Save dose and frequency'}
                </button>
                {pending && <div className="text-xs text-amber-800" role="status">This entry is not saved yet. Save it before running, or <button type="button" className="underline font-bold" onClick={resetEntry}>cancel this entry</button>.</div>}
                {isDuplicateSelection && (
                    <p className="text-xs text-amber-700 font-medium">This medication is already in the current regimen.</p>
                )}
            </div>
        </section>
    );
};
