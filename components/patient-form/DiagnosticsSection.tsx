import React from 'react';
import { CalculationIcon } from '../icons';
import { Label, Input } from './Common';
import type { Patient } from '../../types';

interface DiagnosticsSectionProps {
    patientData: Patient;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const DiagnosticsSection: React.FC<DiagnosticsSectionProps> = ({ patientData, onChange }) => {
    return (
        <section>
            <h3 className="text-base font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center gap-2">
                <CalculationIcon className="w-5 h-5 text-blue-600" aria-hidden="true" /> Diagnostics (Labs & Echo)
            </h3>

            {/* Cardiac Structure */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label htmlFor="lvef">LVEF (%)</Label>
                    <Input type="number" name="lvef" value={patientData.lvef} onChange={onChange} />
                </div>
                <div>
                    <Label htmlFor="nt_pro_bnp">NT-proBNP</Label>
                    <Input type="number" name="nt_pro_bnp" value={patientData.nt_pro_bnp} onChange={onChange} />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label htmlFor="lvedd">LVEDD (mm)</Label>
                    <Input type="number" name="lvedd" value={patientData.lvedd ?? ''} onChange={onChange} placeholder="Normal < 55" />
                </div>
                <div>
                    <Label htmlFor="lavi">LAVI (mL/m²)</Label>
                    <Input type="number" name="lavi" value={patientData.lavi ?? ''} onChange={onChange} placeholder="Normal < 34" />
                </div>
            </div>

            {/* Renal Panel */}
            <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                    <Label htmlFor="creatinine">Creatinine</Label>
                    <Input type="number" step="0.1" name="creatinine" value={patientData.creatinine} onChange={onChange} />
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
                    <Input type="number" name="bun" value={patientData.bun} onChange={onChange} />
                </div>
                <div>
                    <Label htmlFor="potassium">Potassium</Label>
                    <Input type="number" step="0.1" name="potassium" value={patientData.potassium} onChange={onChange} />
                </div>
            </div>

            {/* Iron & Pulmonary */}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <Label htmlFor="ferritin">Ferritin</Label>
                    <Input type="number" name="ferritin" value={patientData.ferritin ?? ''} onChange={onChange} />
                </div>
                <div>
                    <Label htmlFor="tsat">TSAT (%)</Label>
                    <Input type="number" name="tsat" value={patientData.tsat ?? ''} onChange={onChange} />
                </div>
                <div>
                    <Label htmlFor="peak_flow_lpm">Peak Flow (L/min)</Label>
                    <Input type="number" name="peak_flow_lpm" value={patientData.peak_flow_lpm ?? ''} onChange={onChange} placeholder="e.g. 400" />
                </div>
            </div>
        </section>
    );
};
