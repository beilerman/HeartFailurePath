import React, { useEffect } from 'react';
import type { Patient, TestScenario } from '../types';
import { Label, Select } from './patient-form/Common';
import { DemographicsSection } from './patient-form/DemographicsSection';
import { SymptomsSection } from './patient-form/SymptomsSection';
import { PhysicalExamSection } from './patient-form/PhysicalExamSection';
import { DiagnosticsSection } from './patient-form/DiagnosticsSection';
import { HistorySection } from './patient-form/HistorySection';
import { SocialSection } from './patient-form/SocialSection';
import { MedicationManager } from './patient-form/MedicationManager';

interface PatientFormProps {
    patientData: Patient;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
    simulationMedicationNames: Set<string>;
    setSimulationMedicationNames: React.Dispatch<React.SetStateAction<Set<string>>>;
    onRunSimulation: () => void;
    isLoading: boolean;
    testScenarios: TestScenario[];
    selectedScenario: string;
    onScenarioChange: (title: string) => void;
}

// CKD-EPI Creatinine Equation (2021 Refit)
const calculateCKDEPI = (scr: number, age: number, sex: 'Male' | 'Female'): number => {
    if (!scr || !age) return 0;

    // Kappa: 0.7 (female), 0.9 (male)
    const kappa = sex === 'Female' ? 0.7 : 0.9;
    // Alpha: -0.241 (female), -0.302 (male)
    const alpha = sex === 'Female' ? -0.241 : -0.302;

    // Factors
    const scrOverKappa = scr / kappa;
    const minPart = Math.min(scrOverKappa, 1);
    const maxPart = Math.max(scrOverKappa, 1);

    // 142 * (min^alpha) * (max^-1.200) * (0.9938^age) * (1.012 if female)
    let egfr = 142 * Math.pow(minPart, alpha) * Math.pow(maxPart, -1.200) * Math.pow(0.9938, age);

    if (sex === 'Female') {
        egfr *= 1.012;
    }

    return Math.round(egfr);
};

export const PatientForm: React.FC<PatientFormProps> = ({
    patientData, setPatientData,
    onRunSimulation, isLoading,
    testScenarios, selectedScenario, onScenarioChange
}) => {

    // Auto-calculate eGFR whenever Age, Sex, or Creatinine changes
    useEffect(() => {
        const calculatedEgfr = calculateCKDEPI(patientData.creatinine, patientData.age, patientData.sex);
        if (calculatedEgfr !== patientData.egfr) {
            setPatientData(prev => ({ ...prev, egfr: calculatedEgfr }));
        }
    }, [patientData.creatinine, patientData.age, patientData.sex, setPatientData, patientData.egfr]);

    // Auto-calculate BMI whenever Height or Weight changes
    useEffect(() => {
        const h = patientData.height_cm / 100; // Convert to meters
        const w = patientData.volume_status.current_weight_kg;
        if (h > 0 && w > 0) {
            const calculatedBmi = Number((w / (h * h)).toFixed(1));
            if (calculatedBmi !== patientData.bmi) {
                setPatientData(prev => ({ ...prev, bmi: calculatedBmi }));
            }
        }
    }, [patientData.volume_status.current_weight_kg, patientData.height_cm, setPatientData, patientData.bmi]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        // Helper to check if input is a number type
        const isNumber = type === 'number' || type === 'range';

        setPatientData(prev => ({
            ...prev,
            [name]: value === '' && isNumber ? undefined : (isNumber ? Number(value) : value)
        }));
    };

    const handleVolumeChange = (field: 'current_weight_kg' | 'dry_weight_kg', val: number) => {
        setPatientData(prev => ({
            ...prev,
            volume_status: { ...prev.volume_status, [field]: val }
        }));
    };

    const toggleFinding = (finding: string) => {
        setPatientData(prev => {
            const next = new Set(prev.volume_status.exam_findings);
            if (next.has(finding)) next.delete(finding);
            else next.add(finding);
            return {
                ...prev,
                volume_status: { ...prev.volume_status, exam_findings: next }
            };
        });
    };

    return (
        <div className="flex flex-col h-full bg-white">
            <div className="bg-slate-50 p-5 border-b border-slate-200">
                <Label htmlFor="scenarios">Load Patient Profile</Label>
                <Select
                    id="scenarios"
                    value={selectedScenario}
                    onChange={(e) => onScenarioChange(e.target.value)}
                >
                    {testScenarios.map(s => <option key={s.title} value={s.title}>{s.title}</option>)}
                    <option value="custom">Custom Profile</option>
                </Select>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
                <DemographicsSection patientData={patientData} onChange={handleInputChange} />
                <SymptomsSection patientData={patientData} onChange={handleInputChange} />
                <PhysicalExamSection
                    patientData={patientData}
                    onChange={handleInputChange}
                    onVolumeChange={handleVolumeChange}
                    onToggleFinding={toggleFinding}
                />
                <DiagnosticsSection patientData={patientData} onChange={handleInputChange} />
                <HistorySection patientData={patientData} setPatientData={setPatientData} />
                <MedicationManager patientData={patientData} setPatientData={setPatientData} />
                <SocialSection patientData={patientData} onChange={handleInputChange} />
            </div>

            <div className="p-5 border-t border-slate-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                <button
                    onClick={onRunSimulation}
                    disabled={isLoading}
                    aria-busy={isLoading}
                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold py-3.5 px-4 rounded-xl hover:shadow-lg transition-all disabled:opacity-50 text-base tracking-wide"
                >
                    {isLoading ? 'Running Simulation...' : 'Run Analysis'}
                </button>
            </div>
        </div>
    );
};
