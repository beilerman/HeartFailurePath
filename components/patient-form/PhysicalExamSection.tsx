import React from 'react';
import { ActivityIcon } from '../icons';
import { Label, Input } from './Common';
import type { Patient } from '../../types';

interface PhysicalExamSectionProps {
    patientData: Patient;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onVolumeChange: (field: 'current_weight_kg' | 'dry_weight_kg', val: number) => void;
    onToggleFinding: (finding: string) => void;
}

export const PhysicalExamSection: React.FC<PhysicalExamSectionProps> = ({
    patientData,
    onChange,
    onVolumeChange,
    onToggleFinding
}) => {
    // Volume Status Calculations
    const weightDiff = patientData.volume_status.current_weight_kg - patientData.volume_status.dry_weight_kg;
    const isOverloaded = weightDiff > 1.0;
    const isDehydrated = weightDiff < -1.0;
    const weightStatusText = isOverloaded
        ? `+${weightDiff.toFixed(1)} kg (Overload)`
        : isDehydrated
            ? `${weightDiff.toFixed(1)} kg (Volume Depleted)`
            : 'Euvolemic';

    const weightStatusColor = isOverloaded
        ? 'text-red-700 bg-red-50 border-red-200'
        : isDehydrated
            ? 'text-amber-700 bg-amber-50 border-amber-200'
            : 'text-emerald-700 bg-emerald-50 border-emerald-200';

    const findingsList = ['Edema (1+)', 'Edema (2+)', 'Edema (3+)', 'JVP Elevated', 'Orthopnea', 'Crackles', 'Ascites'];

    return (
        <section>
            <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
                <ActivityIcon className="w-5 h-5 text-emerald-600" aria-hidden="true" /> Physical Exam
            </h3>

            {/* Hemodynamics */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label>SBP / DBP (mmHg)</Label>
                    <div className="flex gap-2">
                        <Input type="number" name="sbp" value={patientData.sbp} onChange={onChange} placeholder="Sys" aria-label="Systolic blood pressure" />
                        <Input type="number" name="dbp" value={patientData.dbp} onChange={onChange} placeholder="Dia" aria-label="Diastolic blood pressure" />
                    </div>
                </div>
                <div>
                    <Label>Pulse / SpO2</Label>
                    <div className="flex gap-2">
                        <div className="relative w-full">
                            <Input type="number" name="pulse" value={patientData.pulse} onChange={onChange} placeholder="BPM" aria-label="Pulse rate" />
                            <span className="absolute right-2 top-2 text-xs text-slate-400">bpm</span>
                        </div>
                        <div className="relative w-full">
                            <Input type="number" name="oxygen_saturation" value={patientData.oxygen_saturation ?? ''} onChange={onChange} placeholder="%" aria-label="Oxygen saturation" />
                            <span className="absolute right-2 top-2 text-xs text-slate-400">%</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Volume Status */}
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 mb-2">
                <div className="flex justify-between items-center mb-2">
                    <Label>Weight Status</Label>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${weightStatusColor}`}>{weightStatusText}</span>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-2">
                    <div>
                        <Label htmlFor="dry_weight_kg">Dry Wt (kg)</Label>
                        <Input type="number" name="dry_weight_kg" value={patientData.volume_status.dry_weight_kg} onChange={(e) => onVolumeChange('dry_weight_kg', Number(e.target.value))} />
                    </div>
                    <div>
                        <Label htmlFor="current_weight_kg">Current (kg)</Label>
                        <Input type="number" name="current_weight_kg" value={patientData.volume_status.current_weight_kg} onChange={(e) => onVolumeChange('current_weight_kg', Number(e.target.value))} />
                    </div>
                </div>
            </div>

            <Label>Exam Findings</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
                {findingsList.map(finding => (
                    <button
                        key={finding}
                        onClick={() => onToggleFinding(finding)}
                        aria-pressed={patientData.volume_status.exam_findings.has(finding)}
                        className={`px-3 py-2 rounded-md text-sm font-medium border flex items-center justify-between transition-all ${patientData.volume_status.exam_findings.has(finding) ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}
                    >
                        <span>{finding}</span>
                        {patientData.volume_status.exam_findings.has(finding) && (
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        )}
                    </button>
                ))}
            </div>
        </section>
    );
};
