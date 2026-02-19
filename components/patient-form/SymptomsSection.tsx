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
        <section className="mt-4">
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label htmlFor="nyha_class">NYHA Class</Label>
                    <Select name="nyha_class" value={patientData.nyha_class} onChange={onChange}>
                        <option value="I">I (No sx)</option>
                        <option value="II">II (Mild sx)</option>
                        <option value="III">III (Mod sx)</option>
                        <option value="IV">IV (Severe)</option>
                    </Select>
                </div>
                <div>
                    <Label htmlFor="kccq_score">KCCQ (0-100)</Label>
                    <Input type="number" name="kccq_score" value={patientData.kccq_score} onChange={onChange} error={validationErrors.kccq_score} />
                </div>
            </div>

            {clinicalWarnings.nyha && (
                <div className="mb-4 px-3 py-2 rounded-md bg-amber-50 border border-amber-300 text-amber-800 text-xs font-medium">
                    ⚠ {clinicalWarnings.nyha}
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                    <Label htmlFor="daily_step_count">Daily Step Count (Activity)</Label>
                    <Input
                        type="number"
                        name="daily_step_count"
                        value={patientData.daily_step_count ?? ''}
                        onChange={onChange}
                        placeholder="e.g. 3500"
                    />
                </div>
            </div>
        </section>
    );
};
