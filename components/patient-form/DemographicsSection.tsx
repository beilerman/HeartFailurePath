import React from 'react';
import { UserIcon } from '../icons';
import { Label, Input, Select } from './Common';
import type { Patient } from '../../types';

interface DemographicsSectionProps {
    patientData: Patient;
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    validationErrors?: Record<string, string>;
}

export const DemographicsSection: React.FC<DemographicsSectionProps> = ({ patientData, onChange, validationErrors = {} }) => {
    return (
        <section>
            <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
                <UserIcon className="w-5 h-5 text-indigo-600" aria-hidden="true" /> Demographics & Functional
            </h3>

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label htmlFor="age">Age</Label>
                    <Input type="number" name="age" value={patientData.age ?? ''} onChange={onChange} error={validationErrors.age} />
                </div>
                <div>
                    <Label htmlFor="sex">Sex</Label>
                    <Select name="sex" value={patientData.sex} onChange={onChange}>
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                    </Select>
                </div>
                <div>
                    <Label htmlFor="race">Race</Label>
                    <Select name="race" value={patientData.race} onChange={onChange}>
                        <option value="White">White</option>
                        <option value="Black">Black</option>
                        <option value="Asian">Asian</option>
                        <option value="Hispanic">Hispanic</option>
                        <option value="Other">Other</option>
                    </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <Label htmlFor="height_cm">Height (cm)</Label>
                        <Input type="number" name="height_cm" value={patientData.height_cm ?? ''} onChange={onChange} error={validationErrors.height_cm} />
                    </div>
                    <div>
                        <Label htmlFor="bmi">BMI</Label>
                        <Input type="number" name="bmi" value={patientData.bmi} readOnly className="!bg-slate-100 !text-slate-600 focus:outline-none" />
                    </div>
                </div>
            </div>
        </section>
    );
};
