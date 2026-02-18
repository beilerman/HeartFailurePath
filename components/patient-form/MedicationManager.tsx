import React, { useState, useMemo } from 'react';
import { PillIcon } from '../icons';
import { Label, Select } from './Common';
import { MEDICATION_FORMULARY } from '../../constants';
import type { Patient, RegimenMed } from '../../types';

interface MedicationManagerProps {
    patientData: Patient;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
}

export const MedicationManager: React.FC<MedicationManagerProps> = ({ patientData, setPatientData }) => {
    // State for adding new medication
    const [selectedMedName, setSelectedMedName] = useState<string>('');
    const [selectedDoseStrength, setSelectedDoseStrength] = useState<string>('');
    const [selectedFreq, setSelectedFreq] = useState<string>('');

    // Derived state for medication selection
    const selectedMedInfo = useMemo(() =>
        MEDICATION_FORMULARY.find(m => m.name === selectedMedName),
        [selectedMedName]);

    const availableDoses = selectedMedInfo?.available_doses || [];

    const handleAddMedication = () => {
        if (!selectedMedInfo || !selectedDoseStrength || !selectedFreq) return;

        // Find the full dose object
        const doseObj = availableDoses.find(d => String(d.strength) === selectedDoseStrength);
        if (!doseObj) return;

        const newRegimenItem: RegimenMed = {
            med: selectedMedInfo,
            dose: doseObj,
            selected_frequency: selectedFreq
        };

        setPatientData(prev => ({
            ...prev,
            current_regimen: [...(prev.current_regimen || []), newRegimenItem]
        }));

        // Reset fields
        setSelectedMedName('');
        setSelectedDoseStrength('');
        setSelectedFreq('');
    };

    const handleRemoveMedication = (index: number) => {
        setPatientData(prev => ({
            ...prev,
            current_regimen: prev.current_regimen.filter((_, i) => i !== index)
        }));
    };

    return (
        <section>
            <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
                <PillIcon className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Current Medications
            </h3>

            {/* List */}
            <div className="space-y-2.5 mb-5">
                {patientData.current_regimen.length === 0 && (
                    <p className="text-sm text-slate-400 italic text-center py-3">No active medications.</p>
                )}
                {patientData.current_regimen.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-50 p-3 rounded-md border border-slate-200">
                        <div>
                            <div className="text-sm font-bold text-slate-800">{item.med.name}</div>
                            <div className="text-sm text-slate-500">{item.dose.strength} {item.dose.unit} {item.selected_frequency}</div>
                        </div>
                        <button
                            onClick={() => handleRemoveMedication(idx)}
                            className="text-slate-400 hover:text-red-500 p-1.5"
                            aria-label={`Remove ${item.med.name}`}
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
                    <Label htmlFor="add-medication-drug">Add Medication</Label>
                    <Select
                        id="add-medication-drug"
                        value={selectedMedName}
                        onChange={(e) => {
                            setSelectedMedName(e.target.value);
                            setSelectedDoseStrength('');
                            setSelectedFreq('');
                        }}
                    >
                        <option value="">Select Drug...</option>
                        {MEDICATION_FORMULARY.map(m => (
                            <option key={m.name} value={m.name}>{m.name} ({m.drug_class})</option>
                        ))}
                    </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <Label htmlFor="add-medication-dose">Dose</Label>
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
                                    {d.strength} {d.unit}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="add-medication-freq">Freq</Label>
                        <Select
                            id="add-medication-freq"
                            value={selectedFreq}
                            onChange={(e) => setSelectedFreq(e.target.value)}
                            disabled={!selectedDoseStrength}
                        >
                            <option value="">Freq...</option>
                            {selectedDoseStrength && availableDoses
                                .find(d => String(d.strength) === selectedDoseStrength)
                                ?.frequency_options.map(f => (
                                    <option key={f} value={f}>{f}</option>
                                ))
                            }
                        </Select>
                    </div>
                </div>

                <button
                    onClick={handleAddMedication}
                    disabled={!selectedMedName || !selectedDoseStrength || !selectedFreq}
                    className="w-full py-2 bg-white border border-indigo-200 text-indigo-600 text-sm font-bold rounded hover:bg-indigo-50 hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                    + ADD MEDICATION
                </button>
            </div>
        </section>
    );
};
