import React from 'react';
import { BanknotesIcon } from '../icons';
import { Label, Input, Select } from './Common';
import type { Patient } from '../../types';

interface SocialSectionProps {
    patientData: Patient;
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
    clinicalWarnings?: Record<string, string>;
}

export const SocialSection: React.FC<SocialSectionProps> = ({ patientData, onChange, setPatientData, clinicalWarnings = {} }) => {
    return (
        <section>
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><BanknotesIcon className="w-4 h-4" aria-hidden="true" /> Social Determinants</h4>
                <div>
                    <Label htmlFor="insurance_tier">Insurance Coverage</Label>
                    <Select
                        name="insurance_tier"
                        value={patientData.insurance_tier}
                        onChange={onChange}
                    >
                        <option value="cash">Uninsured / Cash Price</option>
                        <option value="commercial">Commercial Insurance</option>
                        <option value="medicare">Medicare Part D</option>
                    </Select>
                </div>
                <div>
                    <Label htmlFor="max_affordable_cost">Monthly Med Budget ($)</Label>
                    <Input
                        type="number"
                        name="max_affordable_cost"
                        value={patientData.max_affordable_cost}
                        onChange={onChange}
                        placeholder="e.g. 50"
                        min={0}
                    />
                </div>

                <div>
                    <Label htmlFor="cost_sensitivity">Cost Sensitivity ("Sting")</Label>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-400">0</span>
                        <input
                            type="range"
                            min="0"
                            max="10"
                            id="cost_sensitivity"
                            name="cost_sensitivity"
                            value={patientData.cost_sensitivity}
                            onChange={onChange}
                            aria-label="Cost sensitivity, 0 to 10"
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                        <span className="text-xs font-bold text-slate-400">10</span>
                    </div>
                </div>

                <div>
                    <Label htmlFor="complexity_tolerance">Complexity Tolerance</Label>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-400">0</span>
                        <input
                            type="range"
                            min="0"
                            max="10"
                            id="complexity_tolerance"
                            name="complexity_tolerance"
                            value={patientData.complexity_tolerance}
                            onChange={onChange}
                            aria-label="Complexity tolerance, 0 to 10"
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                        <span className="text-xs font-bold text-slate-400">10</span>
                    </div>
                </div>

                <div>
                    <Label htmlFor="max_new_classes_per_visit">Max New Classes Per Visit</Label>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-400">0</span>
                        <input
                            type="range"
                            min="0"
                            max="6"
                            id="max_new_classes_per_visit"
                            name="max_new_classes_per_visit"
                            value={patientData.max_new_classes_per_visit}
                            onChange={onChange}
                            aria-label="Max new classes per visit, 0 to 6"
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                        <span className="text-xs font-bold text-slate-400">6</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                        Current: {patientData.max_new_classes_per_visit} (default 2)
                    </p>
                </div>

                {patientData.sex === 'Female' && (
                    <div>
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={patientData.is_pregnant === true}
                                onChange={(e) => setPatientData(prev => ({ ...prev, is_pregnant: e.target.checked || undefined }))}
                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm font-semibold text-slate-700">Pregnant</span>
                        </label>
                        {clinicalWarnings.pregnancy && (
                            <div className="mt-2 px-3 py-2 rounded-md bg-red-50 border border-red-300 text-red-800 text-xs font-medium">
                                ⚠ {clinicalWarnings.pregnancy}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </section>
    );
};
