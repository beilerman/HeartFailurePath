import React from 'react';
import { BanknotesIcon } from '../icons';
import { Label, Input, Select } from './Common';
import type { Patient } from '../../types';
import { WEIGHT_PROFILE_NAMES, WEIGHT_PROFILE_META, resolveWeightProfile } from '../../services/engine/scoreModel';
import { resolveRankingMode } from '../../services/engine/selection';
import { RANKING_MODE_META, RANKING_MODE_NAMES, RANKING_MODE_VS_PRIORITY_NOTE } from '../rankingModeMeta';

interface SocialSectionProps {
    patientData: Patient;
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
    validationErrors?: Record<string, string>;
    clinicalWarnings?: Record<string, string>;
}

export const SocialSection: React.FC<SocialSectionProps> = ({ patientData, onChange, setPatientData, validationErrors = {}, clinicalWarnings = {} }) => {
    return (
        <section>
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 space-y-3">
                <h4 className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1"><BanknotesIcon className="w-4 h-4" aria-hidden="true" /> Patient values and practical limits</h4>
                <p className="text-xs text-slate-500">These change how the options are ordered and which are affordable. They never change safety exclusions or alerts.</p>
                <div>
                    <Label htmlFor="insurance_tier">Insurance coverage</Label>
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
                    <Label htmlFor="care_priority">What matters most to this patient?</Label>
                    <Select
                        name="care_priority"
                        value={resolveWeightProfile(patientData)}
                        onChange={onChange}
                        aria-describedby="care_priority-help"
                    >
                        {WEIGHT_PROFILE_NAMES.map(name => (
                            <option key={name} value={name}>{WEIGHT_PROFILE_META[name].label}</option>
                        ))}
                    </Select>
                    <p id="care_priority-help" className="mt-1 text-xs text-slate-500">
                        {WEIGHT_PROFILE_META[resolveWeightProfile(patientData)].description}
                    </p>
                </div>
                <div>
                    <Label htmlFor="ranking_mode">Ranking approach</Label>
                    <Select
                        name="ranking_mode"
                        value={resolveRankingMode(patientData)}
                        onChange={onChange}
                        aria-describedby="ranking_mode-help"
                    >
                        {RANKING_MODE_NAMES.map(name => (
                            <option key={name} value={name}>{RANKING_MODE_META[name].label}</option>
                        ))}
                    </Select>
                    <p id="ranking_mode-help" className="mt-1 text-xs text-slate-500">
                        {RANKING_MODE_META[resolveRankingMode(patientData)].description} {RANKING_MODE_VS_PRIORITY_NOTE}
                    </p>
                </div>
                <div>
                    <Label htmlFor="max_affordable_cost">Monthly medication budget ($). 0 means the patient can pay nothing</Label>
                    <Input
                        type="number"
                        name="max_affordable_cost"
                        value={patientData.max_affordable_cost ?? ''}
                        onChange={onChange}
                        placeholder="e.g. 50"
                        min={0}
                        error={validationErrors.max_affordable_cost}
                    />
                </div>

                <div>
                    <Label htmlFor="cost_sensitivity">How much does cost worry this patient? <span className="font-normal text-slate-500">({patientData.cost_sensitivity} of 10)</span></Label>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-500 w-12 leading-tight">0 = not at all</span>
                        <input
                            type="range"
                            min="0"
                            max="10"
                            id="cost_sensitivity"
                            name="cost_sensitivity"
                            value={patientData.cost_sensitivity}
                            onChange={onChange}
                            aria-label="How much cost worries this patient, 0 not at all to 10 very much"
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                        <span className="text-xs font-bold text-slate-500 w-12 leading-tight text-right">10 = very much</span>
                    </div>
                </div>

                <div>
                    <Label htmlFor="complexity_tolerance">How many pills and doses can this patient manage? <span className="font-normal text-slate-500">({patientData.complexity_tolerance} of 10)</span></Label>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-500 w-12 leading-tight">0 = simplest only</span>
                        <input
                            type="range"
                            min="0"
                            max="10"
                            id="complexity_tolerance"
                            name="complexity_tolerance"
                            value={patientData.complexity_tolerance}
                            onChange={onChange}
                            aria-label="Regimen complexity tolerance, 0 simplest only to 10 comfortable with many pills and doses"
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                        />
                        <span className="text-xs font-bold text-slate-500 w-12 leading-tight text-right">10 = many is fine</span>
                    </div>
                </div>

                <div>
                    <Label htmlFor="max_new_classes_per_visit">Most new drug classes to start at one visit</Label>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-500">0</span>
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
                        <span className="text-xs font-bold text-slate-500">6</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                        Current: {patientData.max_new_classes_per_visit} (default 2). A potassium binder or IV iron added alongside counts toward this limit.
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
                    </div>
                )}
                {/* Rendered outside the sex gate so a set pregnancy flag is never invisible. */}
                {clinicalWarnings.pregnancy && (
                    <div className="mt-2 px-3 py-2 rounded-md bg-red-50 border border-red-300 text-red-800 text-xs font-medium">
                        ⚠ {clinicalWarnings.pregnancy}
                    </div>
                )}
            </div>
        </section>
    );
};
