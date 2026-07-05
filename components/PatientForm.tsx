import React, { useEffect, useMemo } from 'react';
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
    pricesReady: boolean;
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
    onRunSimulation, isLoading, pricesReady,
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

    // --- 2a. Physiologic validation bounds ---
    const VALIDATION_BOUNDS: Record<string, { min: number; max: number; label: string }> = {
        age: { min: 18, max: 120, label: 'Age' },
        height_cm: { min: 100, max: 250, label: 'Height' },
        sbp: { min: 50, max: 250, label: 'SBP' },
        dbp: { min: 20, max: 150, label: 'DBP' },
        pulse: { min: 20, max: 250, label: 'Pulse' },
        lvef: { min: 5, max: 85, label: 'LVEF' },
        nt_pro_bnp: { min: 0, max: 50000, label: 'NT-proBNP' },
        kccq_score: { min: 0, max: 100, label: 'KCCQ' },
        potassium: { min: 2.0, max: 8.0, label: 'K+' },
        creatinine: { min: 0.2, max: 15, label: 'Creatinine' },
        bun: { min: 2, max: 200, label: 'BUN' },
        ferritin: { min: 1, max: 2000, label: 'Ferritin' },
        tsat: { min: 1, max: 100, label: 'TSAT' },
        oxygen_saturation: { min: 50, max: 100, label: 'SpO2' },
        lvedd: { min: 20, max: 100, label: 'LVEDD' },
        lavi: { min: 10, max: 80, label: 'LAVI' },
        dry_weight_kg: { min: 25, max: 300, label: 'Dry Weight' },
        current_weight_kg: { min: 25, max: 350, label: 'Current Weight' },
    };

    // --- 2b. Validation errors ---
    const validationErrors = useMemo(() => {
        const errors: Record<string, string> = {};
        const check = (field: string, value: number | undefined) => {
            if (value === undefined || value === null) return;
            const bounds = VALIDATION_BOUNDS[field];
            if (!bounds) return;
            if (value < bounds.min || value > bounds.max) {
                errors[field] = `${bounds.label} must be ${bounds.min}–${bounds.max}`;
            }
        };
        check('age', patientData.age);
        check('height_cm', patientData.height_cm);
        check('sbp', patientData.sbp);
        check('dbp', patientData.dbp);
        check('pulse', patientData.pulse);
        check('lvef', patientData.lvef);
        check('nt_pro_bnp', patientData.nt_pro_bnp);
        check('kccq_score', patientData.kccq_score);
        check('potassium', patientData.potassium);
        check('creatinine', patientData.creatinine);
        check('bun', patientData.bun);
        check('ferritin', patientData.ferritin);
        check('tsat', patientData.tsat);
        check('oxygen_saturation', patientData.oxygen_saturation);
        check('lvedd', patientData.lvedd);
        check('lavi', patientData.lavi);
        check('dry_weight_kg', patientData.volume_status.dry_weight_kg);
        check('current_weight_kg', patientData.volume_status.current_weight_kg);
        if (patientData.sbp <= patientData.dbp) {
            errors.sbp = 'SBP must be greater than DBP';
            errors.dbp = 'DBP must be lower than SBP';
        }
        return errors;
    }, [patientData]);

    // --- 2c. Clinical warnings ---
    const clinicalWarnings = useMemo(() => {
        const warnings: Record<string, string> = {};
        const bunCrRatio = patientData.creatinine > 0 ? patientData.bun / patientData.creatinine : 0;
        const pulsePressure = patientData.sbp - patientData.dbp;
        const hasInvalidBP = patientData.sbp <= patientData.dbp;
        const hasLowOutputMarker = !hasInvalidBP && (patientData.volume_status.exam_findings.has('Cool Extremities') || pulsePressure <= 25 || bunCrRatio > 20);

        if (hasInvalidBP) warnings.sbp = 'Invalid BP entry: SBP must exceed DBP';
        else if (patientData.sbp < 90) warnings.sbp = 'Hemodynamic instability - no drug recs will be generated';
        if (patientData.potassium > 5.5) warnings.potassium = 'MRA contraindicated at K+ > 5.5';
        else if (patientData.potassium < 3.5) warnings.potassium = 'K+ < 3.5 increases digoxin/arrhythmia risk';
        else if (patientData.potassium < 4.0) warnings.potassium = 'K+ 3.5-4.0: monitor closely with loop diuretics/digoxin';
        else if (patientData.potassium > 5.0) warnings.potassium = 'Elevated K+ - MRA/RAAS risk';
        if (patientData.is_pregnant) warnings.pregnancy = 'RAAS/MRA/nsMRA/SGLT2i excluded';
        if (patientData.nyha_class === 'IV') warnings.nyha = 'BB initiation blocked';
        if (patientData.pulse < 55) warnings.pulse = 'Severe bradycardia - BB contraindicated';
        if (patientData.rhythm === '2nd Degree AV Block' || patientData.rhythm === '3rd Degree AV Block') {
            warnings.av_block = 'AV block present: beta blockers and digoxin are contraindicated unless paced/specialist-directed.';
        }
        if (patientData.egfr < 30) warnings.egfr = 'Severe CKD - MRA CI, RAAS limited, SGLT2i initiation blocked';
        if (patientData.egfr < 20) warnings.egfr = 'eGFR < 20: loop response may be poor; consider BID/TID strategy';
        if (patientData.lvef < 20 && hasLowOutputMarker) warnings.low_output = 'Low-output profile detected (LVEF < 20 with hypoperfusion markers)';
        return warnings;
    }, [patientData.sbp, patientData.dbp, patientData.bun, patientData.creatinine, patientData.potassium, patientData.is_pregnant, patientData.nyha_class, patientData.pulse, patientData.egfr, patientData.lvef, patientData.volume_status.exam_findings]);

    // --- 2d. Disable simulation when validation errors exist ---
    const hasValidationErrors = Object.keys(validationErrors).length > 0;

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
                <DemographicsSection patientData={patientData} onChange={handleInputChange} validationErrors={validationErrors} />
                <SymptomsSection patientData={patientData} onChange={handleInputChange} validationErrors={validationErrors} clinicalWarnings={clinicalWarnings} />
                <PhysicalExamSection
                    patientData={patientData}
                    onChange={handleInputChange}
                    onVolumeChange={handleVolumeChange}
                    onToggleFinding={toggleFinding}
                    validationErrors={validationErrors}
                    clinicalWarnings={clinicalWarnings}
                />
                <DiagnosticsSection patientData={patientData} onChange={handleInputChange} validationErrors={validationErrors} clinicalWarnings={clinicalWarnings} />
                <HistorySection patientData={patientData} setPatientData={setPatientData} />
                <MedicationManager patientData={patientData} setPatientData={setPatientData} />
                <SocialSection patientData={patientData} onChange={handleInputChange} setPatientData={setPatientData} clinicalWarnings={clinicalWarnings} />
            </div>

            <div className="p-5 border-t border-slate-200 bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                <button
                    onClick={onRunSimulation}
                    disabled={isLoading || hasValidationErrors || !pricesReady}
                    aria-busy={isLoading}
                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-bold py-3.5 px-4 rounded-xl hover:shadow-lg transition-all disabled:opacity-50 text-base tracking-wide"
                >
                    {isLoading ? 'Running Analysis...' : !pricesReady ? 'Loading Prices...' : hasValidationErrors ? 'Fix Errors to Run Analysis' : 'Run Analysis'}
                </button>
            </div>
        </div>
    );
};
