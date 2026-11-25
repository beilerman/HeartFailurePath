import React from 'react';
import { Label, Input, Select } from './Common';
import type { Patient } from '../../types';

interface SymptomsSectionProps {
    patientData: Patient;
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    validationErrors?: Record<string, string>;
    clinicalWarnings?: Record<string, string>;
}

export const SymptomsSection: React.FC<SymptomsSectionProps> = ({ patientData, onChange, validationErrors = {}, clinicalWarnings = {} }) => {
    return (
        <section id="patient-symptoms" tabIndex={-1} className="mt-4">
            <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">Symptoms and function</h3>
            <div className="grid grid-cols-1 gap-4 mb-4">
                <div>
                    <Label htmlFor="nyha_class">NYHA functional class</Label>
                    <Select name="nyha_class" value={patientData.nyha_class} onChange={onChange} placeholder="Select activity limitation" error={validationErrors.nyha_class}>
                        <option value="I">I: no limitation with usual activity</option>
                        <option value="II">II: symptoms with ordinary activity</option>
                        <option value="III">III: symptoms with less than ordinary activity</option>
                        <option value="IV">IV: symptoms at rest</option>
                    </Select>
                </div>
                <div>
                    <Label htmlFor="kccq_score">KCCQ (0-100)</Label>
                    <Input type="number" min={0} max={100} name="kccq_score" value={patientData.kccq_score ?? ''} onChange={onChange} error={validationErrors.kccq_score} aria-describedby="kccq-help" />
                    <p id="kccq-help" className="mt-1 text-xs text-slate-600">Optional measured Kansas City Cardiomyopathy Questionnaire score. Higher means better reported health status. Leave blank if unavailable; other eligible decisions remain available and no score is invented.</p>
                    <Label htmlFor="kccq_instrument">KCCQ measure</Label>
                    <Select id="kccq_instrument" name="kccq_instrument" value={patientData.kccq_instrument ?? ''} onChange={onChange}>
                        <option value="">Not recorded</option><option value="CSS">Clinical summary score (CSS)</option><option value="TSS">Total symptom score (TSS)</option><option value="OSS">Overall summary score (OSS)</option><option value="unknown">Unknown measure</option>
                    </Select>
                    <p className="text-xs text-slate-600 mt-1">These measures are not treated as interchangeable treatment effects.</p>
                </div>
            </div>

            {clinicalWarnings.nyha && (
                <div className="mb-4 px-3 py-2 rounded-md bg-amber-50 border border-amber-300 text-amber-800 text-xs font-medium">
                    ⚠ {clinicalWarnings.nyha}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                    <Label htmlFor="daily_step_count">Daily step count (activity)</Label>
                    <Input
                        type="number" min={0}
                        name="daily_step_count"
                        value={patientData.daily_step_count ?? ''}
                        onChange={onChange}
                        placeholder="e.g. 3500"
                        error={validationErrors.daily_step_count}
                    />
                </div>
            </div>
        </section>
    );
};
