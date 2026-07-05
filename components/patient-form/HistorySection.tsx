import React, { useState } from 'react';
import { WarningIcon } from '../icons';
import { Label, Input, Select } from './Common';
import { MEDICATION_FORMULARY, COMMON_SIDE_EFFECTS, RELEVANT_COMORBIDITIES, RELEVANT_EXTERNAL_MEDICATIONS } from '../../constants';
import type { Patient } from '../../types';

interface HistorySectionProps {
    patientData: Patient;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
}

export const HistorySection: React.FC<HistorySectionProps> = ({ patientData, setPatientData }) => {
    // State for Allergies & Intolerances
    const [allergyInput, setAllergyInput] = useState('');
    const [intoleranceDrug, setIntoleranceDrug] = useState('');
    const [intoleranceReason, setIntoleranceReason] = useState('');
    const [intoleranceDetail, setIntoleranceDetail] = useState('');
    const [intoleranceDate, setIntoleranceDate] = useState('');
    const [selectedComorbidity, setSelectedComorbidity] = useState('');
    const [selectedExternalMedication, setSelectedExternalMedication] = useState('');

    const handleAddComorbidity = () => {
        if (!selectedComorbidity) return;
        setPatientData(prev => ({
            ...prev,
            comorbidities: new Set(prev.comorbidities).add(selectedComorbidity)
        }));
        setSelectedComorbidity('');
    };

    const handleRemoveComorbidity = (c: string) => {
        setPatientData(prev => {
            const next = new Set(prev.comorbidities);
            next.delete(c);
            return { ...prev, comorbidities: next };
        });
    };

    const handleAddExternalMedication = () => {
        if (!selectedExternalMedication) return;
        setPatientData(prev => ({
            ...prev,
            external_medications: new Set(prev.external_medications || []).add(selectedExternalMedication)
        }));
        setSelectedExternalMedication('');
    };

    const handleRemoveExternalMedication = (med: string) => {
        setPatientData(prev => {
            const next = new Set(prev.external_medications || []);
            next.delete(med);
            return { ...prev, external_medications: next };
        });
    };

    const handleAddAllergy = () => {
        if (!allergyInput) return;
        setPatientData(prev => ({
            ...prev,
            allergies: new Set(prev.allergies).add(allergyInput)
        }));
        setAllergyInput('');
    };

    const handleRemoveAllergy = (allergy: string) => {
        setPatientData(prev => {
            const next = new Set(prev.allergies);
            next.delete(allergy);
            return { ...prev, allergies: next };
        });
    };

    const handleAddIntolerance = () => {
        if (!intoleranceDrug || !intoleranceReason) return;
        const med = MEDICATION_FORMULARY.find(m => m.name === intoleranceDrug);
        if (!med) return;

        setPatientData(prev => ({
            ...prev,
            discontinued_meds: [
                ...(prev.discontinued_meds || []),
                {
                    name: intoleranceDrug,
                    drug_class: med.drug_class,
                    reason: intoleranceReason,
                    reason_detail: intoleranceDetail || undefined,
                    occurred_at: intoleranceDate || undefined
                }
            ]
        }));
        setIntoleranceDrug('');
        setIntoleranceReason('');
        setIntoleranceDetail('');
        setIntoleranceDate('');
    };

    const handleRemoveIntolerance = (index: number) => {
        setPatientData(prev => ({
            ...prev,
            discontinued_meds: prev.discontinued_meds.filter((_, i) => i !== index)
        }));
    };

    return (
        <section>
            <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
                <WarningIcon className="w-5 h-5 text-amber-600" aria-hidden="true" /> Clinical Context & Risks
            </h3>

            {/* Comorbidities */}
            <div className="mb-6">
                <Label htmlFor="comorbidity-select">Comorbidities</Label>
                <div className="flex gap-2 mb-2">
                    <Select
                        id="comorbidity-select"
                        value={selectedComorbidity}
                        onChange={(e) => setSelectedComorbidity(e.target.value)}
                    >
                        <option value="">Select Condition...</option>
                        {RELEVANT_COMORBIDITIES.map(c => (
                            <option key={c} value={c} disabled={patientData.comorbidities.has(c)}>{c}</option>
                        ))}
                    </Select>
                    <button onClick={handleAddComorbidity} disabled={!selectedComorbidity} className="px-4 bg-indigo-50 text-indigo-700 rounded-md text-sm font-bold border border-indigo-100 hover:bg-indigo-100">ADD</button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {Array.from(patientData.comorbidities).map((c: string) => (
                        <span key={c} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 text-sm font-medium rounded border border-blue-100">
                            {c}
                            <button onClick={() => handleRemoveComorbidity(c)} className="hover:text-blue-900 font-bold" aria-label={`Remove ${c}`}>&times;</button>
                        </span>
                    ))}
                </div>
            </div>

            {/* Active Non-Formulary Medications (DDI Context) */}
            <div className="mb-6">
                <Label htmlFor="external-med-select">Concurrent Non-Formulary Medications (for DDI checks)</Label>
                <div className="flex gap-2 mb-2">
                    <Select
                        id="external-med-select"
                        value={selectedExternalMedication}
                        onChange={(e) => setSelectedExternalMedication(e.target.value)}
                    >
                        <option value="">Select Medication...</option>
                        {RELEVANT_EXTERNAL_MEDICATIONS.map(m => (
                            <option key={m} value={m} disabled={(patientData.external_medications || new Set()).has(m)}>{m}</option>
                        ))}
                    </Select>
                    <button onClick={handleAddExternalMedication} disabled={!selectedExternalMedication} className="px-4 bg-indigo-50 text-indigo-700 rounded-md text-sm font-bold border border-indigo-100 hover:bg-indigo-100">ADD</button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {Array.from(patientData.external_medications || []).map((m: string) => (
                        <span key={m} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-violet-50 text-violet-700 text-sm font-medium rounded border border-violet-100">
                            {m}
                            <button onClick={() => handleRemoveExternalMedication(m)} className="hover:text-violet-900 font-bold" aria-label={`Remove ${m}`}>&times;</button>
                        </span>
                    ))}
                </div>
            </div>

            {/* Allergies */}
            <div className="mb-6">
                <Label htmlFor="allergy-input">Allergies</Label>
                <div className="flex gap-2 mb-2">
                    <Input
                        id="allergy-input"
                        value={allergyInput}
                        onChange={(e) => setAllergyInput(e.target.value)}
                        placeholder="e.g. Penicillin"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddAllergy()}
                    />
                    <button onClick={handleAddAllergy} className="px-4 bg-slate-100 text-slate-700 rounded-md text-sm font-bold hover:bg-slate-200">ADD</button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {Array.from(patientData.allergies).map((alg: string) => (
                        <span key={alg} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-50 text-red-700 text-sm font-medium rounded border border-red-100">
                            {alg}
                            <button onClick={() => handleRemoveAllergy(alg)} className="hover:text-red-900 font-bold" aria-label={`Remove ${alg}`}>&times;</button>
                        </span>
                    ))}
                </div>
            </div>

            {/* Intolerances / Exclusions */}
            <div className="mb-6">
                <Label>Prior Intolerances</Label>
                <div className="space-y-2.5 mb-3">
                    {patientData.discontinued_meds.map((dm, idx) => (
                            <div key={idx} className="flex items-center justify-between bg-amber-50 p-2.5 rounded border border-amber-100">
                                <div className="text-sm">
                                    <span className="font-bold text-amber-900">{dm.name}</span>
                                    <span className="mx-2 text-amber-400">|</span>
                                    <span className="text-amber-800 italic">{dm.reason}</span>
                                    {dm.reason_detail && <span className="block text-amber-700 text-xs mt-1">{dm.reason_detail}</span>}
                                    {dm.occurred_at && <span className="block text-amber-700 text-xs">When: {dm.occurred_at}</span>}
                                </div>
                                <button onClick={() => handleRemoveIntolerance(idx)} className="text-amber-500 hover:text-amber-700 text-lg leading-none" aria-label={`Remove intolerance: ${dm.name}`}>&times;</button>
                            </div>
                        ))}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                    <Select value={intoleranceDrug} onChange={(e) => setIntoleranceDrug(e.target.value)} aria-label="Intolerance drug">
                        <option value="">Drug...</option>
                        {MEDICATION_FORMULARY.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                    </Select>
                    <Select value={intoleranceReason} onChange={(e) => setIntoleranceReason(e.target.value)} aria-label="Intolerance side effect">
                        <option value="">Side Effect...</option>
                        {COMMON_SIDE_EFFECTS.map(se => <option key={se} value={se}>{se}</option>)}
                    </Select>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                    <Input
                        value={intoleranceDetail}
                        onChange={(e) => setIntoleranceDetail(e.target.value)}
                        placeholder="Details (e.g. ACEi cough after 2 weeks)"
                        aria-label="Intolerance details"
                    />
                    <Input
                        type="month"
                        value={intoleranceDate}
                        onChange={(e) => setIntoleranceDate(e.target.value)}
                        aria-label="Intolerance date"
                    />
                </div>
                <button
                    onClick={handleAddIntolerance}
                    disabled={!intoleranceDrug || !intoleranceReason}
                    className="w-full py-2 bg-white border border-slate-300 text-slate-700 text-sm font-bold rounded hover:bg-slate-50 disabled:opacity-50 shadow-sm"
                >
                    + ADD EXCLUSION
                </button>
            </div>
        </section>
    );
};
