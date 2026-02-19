import React from 'react';
import { CalculationIcon } from '../icons';
import { Label, Input, Select } from './Common';
import type { Patient } from '../../types';

interface DiagnosticsSectionProps {
    patientData: Patient;
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    validationErrors?: Record<string, string>;
    clinicalWarnings?: Record<string, string>;
}

export const DiagnosticsSection: React.FC<DiagnosticsSectionProps> = ({ patientData, onChange, validationErrors = {}, clinicalWarnings = {} }) => {
    return (
        <section>
            <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
                <CalculationIcon className="w-5 h-5 text-blue-600" aria-hidden="true" /> Diagnostics (Labs & Echo)
            </h3>

            {/* Cardiac Structure */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label htmlFor="lvef">LVEF (%)</Label>
                    <Input type="number" name="lvef" value={patientData.lvef} onChange={onChange} error={validationErrors.lvef} />
                </div>
                <div>
                    <Label htmlFor="nt_pro_bnp">NT-proBNP</Label>
                    <Input type="number" name="nt_pro_bnp" value={patientData.nt_pro_bnp} onChange={onChange} error={validationErrors.nt_pro_bnp} />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label htmlFor="ever_lvef_le_40">Has this patient ever had LVEF 40% or lower?</Label>
                    <Select name="ever_lvef_le_40" value={patientData.ever_lvef_le_40 ?? 'unknown'} onChange={onChange}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="unknown">Unknown</option>
                    </Select>
                </div>
                <div>
                    <Label htmlFor="previous_lvef">Prior Lowest LVEF (%)</Label>
                    <Input
                        type="number"
                        name="previous_lvef"
                        value={patientData.previous_lvef ?? ''}
                        onChange={onChange}
                        placeholder="Optional (e.g. 25)"
                    />
                </div>
            </div>

            {(patientData.ever_lvef_le_40 ?? 'unknown') === 'unknown' && (
                <div className="mb-4 px-3 py-2 rounded-md bg-amber-50 border border-amber-300 text-amber-800 text-xs font-medium">
                    ! Cannot determine HFimpEF status - consider continuing current GDMT if previously on quad therapy.
                </div>
            )}

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="col-span-2">
                    <Label htmlFor="recent_hf_worsening_within_6mo">Recent worsening HF (hospitalization or IV diuretics within 6 months)?</Label>
                    <Select
                        name="recent_hf_worsening_within_6mo"
                        value={patientData.recent_hf_worsening_within_6mo ?? 'unknown'}
                        onChange={onChange}
                    >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                        <option value="unknown">Unknown</option>
                    </Select>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label htmlFor="lvedd">LVEDD (mm)</Label>
                    <Input type="number" name="lvedd" value={patientData.lvedd ?? ''} onChange={onChange} placeholder="Normal < 55" error={validationErrors.lvedd} />
                </div>
                <div>
                    <Label htmlFor="lavi">LAVI (mL/m²)</Label>
                    <Input type="number" name="lavi" value={patientData.lavi ?? ''} onChange={onChange} placeholder="Normal < 34" error={validationErrors.lavi} />
                </div>
            </div>

            {/* Renal Panel */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label htmlFor="creatinine">Creatinine</Label>
                    <Input type="number" step="0.1" name="creatinine" value={patientData.creatinine} onChange={onChange} error={validationErrors.creatinine} />
                </div>
                <div className="relative">
                    <Label htmlFor="egfr">eGFR (Calc)</Label>
                    <Input
                        type="number"
                        name="egfr"
                        value={patientData.egfr}
                        readOnly
                        className="!bg-slate-100 !text-slate-600 focus:outline-none"
                    />
                </div>
                <div>
                    <Label htmlFor="bun">BUN</Label>
                    <Input type="number" name="bun" value={patientData.bun} onChange={onChange} error={validationErrors.bun} />
                </div>
                <div>
                    <Label htmlFor="potassium">Potassium</Label>
                    <Input type="number" step="0.1" name="potassium" value={patientData.potassium} onChange={onChange} error={validationErrors.potassium} warning={clinicalWarnings.potassium} />
                </div>
            </div>

            {clinicalWarnings.egfr && (
                <div className="mb-4 px-3 py-2 rounded-md bg-amber-50 border border-amber-300 text-amber-800 text-xs font-medium">
                    ⚠ {clinicalWarnings.egfr}
                </div>
            )}

            {/* Iron & Pulmonary */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="ferritin">Ferritin</Label>
                    <Input type="number" name="ferritin" value={patientData.ferritin ?? ''} onChange={onChange} error={validationErrors.ferritin} />
                </div>
                <div>
                    <Label htmlFor="tsat">TSAT (%)</Label>
                    <Input type="number" name="tsat" value={patientData.tsat ?? ''} onChange={onChange} error={validationErrors.tsat} />
                </div>
                <div>
                    <Label htmlFor="peak_flow_lpm">Peak Flow (L/min)</Label>
                    <Input type="number" name="peak_flow_lpm" value={patientData.peak_flow_lpm ?? ''} onChange={onChange} placeholder="e.g. 400" />
                </div>
            </div>
        </section>
    );
};
