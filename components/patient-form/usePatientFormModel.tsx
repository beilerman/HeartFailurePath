import React, { useEffect, useMemo, useState } from 'react';
import type { Patient } from '../../types';
import { validatePatientForm } from './formValidation';
import { HYPOTENSION_SBP_BELOW, MRA_START_K_MAX, MRA_START_K_CEILING, HYPOKALEMIA_K_BELOW, BB_HR_BELOW, SEVERE_CKD_EGFR_BELOW, LOW_OUTPUT, knownUrgentFindings } from '../../services/simulationService';
import { derivedFields } from '../../services/clinicalPredicates';
import { isLowOutputState } from '../../services/engine/regimenUtils';
import { RAAS_START_K_CAUTION } from '../../services/engine/thresholds';
import { DemographicsSection } from './DemographicsSection';
import { SymptomsSection } from './SymptomsSection';
import { PhysicalExamSection } from './PhysicalExamSection';
import { DiagnosticsSection } from './DiagnosticsSection';
import { HistorySection } from './HistorySection';
import { ScopeSection } from './ScopeSection';
import { SocialSection } from './SocialSection';
import { MedicationManager } from './MedicationManager';

/**
 * The single implementation of form state, validation, hints and field handlers.
 * The sidebar form (PatientForm) and the guided steps both call this hook and render the same section
 * components, so there is one implementation of every field.
 */
export interface PatientFormModelOptions {
    patientData: Patient;
    setPatientData: React.Dispatch<React.SetStateAction<Patient>>;
    /** Reports whether the form currently has blocking input errors. */
    onValidityChange?: (hasErrors: boolean) => void;
    onPendingChange?: (pending: boolean) => void;
}

export function usePatientFormModel({ patientData, setPatientData, onValidityChange, onPendingChange }: PatientFormModelOptions) {
    const [pendingMedication, setPendingMedication] = useState(false);
    const [pendingHistory, setPendingHistory] = useState(false);
    const pending = pendingMedication || pendingHistory;
    useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);
    // A host that goes away (view switch, new patient) takes its unfinished drafts with it; never leave the run gate blocked by them.
    useEffect(() => () => { onPendingChange?.(false); }, [onPendingChange]);

    // eGFR and BMI are computed, not entered: one shared function (clinicalPredicates.derivedFields), which the sample-patient fixtures also satisfy.
    useEffect(() => {
        const d = derivedFields(patientData);
        // A non-finite derived value (e.g. a negative creatinine) is the blank sentinel 0; NaN never goes into state (NaN !== NaN would loop).
        const egfr = Number.isFinite(d.egfr) ? d.egfr : 0;
        const bmi = Number.isFinite(d.bmi) ? d.bmi : 0;
        if (!Object.is(egfr, patientData.egfr) || !Object.is(bmi, patientData.bmi)) setPatientData(prev => ({ ...prev, egfr, bmi }));
    }, [patientData, setPatientData]);

    // Rhythm AFib records the atrial fibrillation history (the comorbidity) so the two cannot disagree.
    useEffect(() => {
        if (patientData.rhythm === 'AFib' && !patientData.comorbidities.has('Atrial Fibrillation')) {
            setPatientData(prev => ({ ...prev, comorbidities: new Set(prev.comorbidities).add('Atrial Fibrillation') }));
        }
    }, [patientData.rhythm, patientData.comorbidities, setPatientData]);

    const validationErrors = useMemo(() => validatePatientForm(patientData), [patientData]);
    // An out-of-range entry (potassium 9, systolic 40) is a typing error to fix first, not a finding: it raises no emergency alert until it is valid.
    const urgentFindings = useMemo(() => {
        const q = { ...patientData };
        for (const f of ['sbp', 'potassium', 'oxygen_saturation'] as const) if (validationErrors[f]) q[f] = 0;
        return knownUrgentFindings(q);
    }, [patientData, validationErrors]);

    // --- 2c. Clinical warnings ---
    const clinicalWarnings = useMemo(() => {
        const warnings: Record<string, string> = {};
        const hasInvalidBP = patientData.sbp > 0 && patientData.dbp > 0 && patientData.sbp <= patientData.dbp;

        if (hasInvalidBP) warnings.sbp = 'Invalid BP entry: SBP must exceed DBP';
        else if (patientData.sbp > 0 && patientData.sbp < HYPOTENSION_SBP_BELOW) warnings.sbp = 'Hemodynamic instability - no drug recs will be generated';
        // Potassium 0 / blank means "not entered" (the engine withholds K+-dependent conclusions).
        if (!(patientData.potassium > 0)) warnings.potassium = 'Not entered: RAAS inhibitor and MRA decisions will be withheld until a potassium is available';
        // The hint states what the engine does at each level (same constants the rules read).
        else if (patientData.potassium >= 6.5) warnings.potassium = 'K+ 6.5 or higher: emergency alert only, no drug recommendations will be generated';
        else if (patientData.potassium >= 6.0) warnings.potassium = 'K+ 6.0 or higher: hyperkalemia emergency alert; RAAS inhibitors and MRAs in use are withheld and none is started';
        else if (patientData.potassium > MRA_START_K_MAX) warnings.potassium = 'High K+: a new MRA is not started; an MRA already on board is reduced or withheld';
        else if (patientData.potassium < HYPOKALEMIA_K_BELOW) warnings.potassium = `K+ < ${HYPOKALEMIA_K_BELOW} increases digoxin/arrhythmia risk`;
        else if (patientData.potassium > RAAS_START_K_CAUTION) warnings.potassium = `K+ above ${RAAS_START_K_CAUTION}: a new MRA and a new ACE inhibitor, ARB or ARNI are not started; recheck potassium first`;
        else if (patientData.potassium >= MRA_START_K_CEILING) warnings.potassium = `K+ ${MRA_START_K_CEILING} or higher: a new MRA is not started; recheck potassium and start once it is below ${MRA_START_K_CEILING}`;
        if (patientData.is_pregnant) warnings.pregnancy = 'RAAS inhibitors, MRAs, SGLT2 inhibitors, vericiguat, ivabradine and GLP-1 therapies are excluded';
        if (patientData.nyha_class === 'IV') warnings.nyha = 'BB initiation blocked';
        if (!(patientData.pulse > 0)) warnings.pulse = 'Heart rate not recorded: rate-lowering starts, increases and switches wait for a measurement.';
        else if (patientData.pulse < BB_HR_BELOW) warnings.pulse = 'Low heart rate: a new beta-blocker is not started and an established one is reduced a step below 55 bpm for carvedilol (label) or below 50 bpm for metoprolol succinate and bisoprolol (2026 ESC)';
        if (patientData.rhythm === '2nd Degree AV Block' || patientData.rhythm === '3rd Degree AV Block') {
            warnings.av_block = 'AV block present: beta blockers and digoxin are contraindicated unless paced/specialist-directed.';
        }
        // Low or unknown eGFR changes which drugs are offered and at what dose; the exact cut-offs differ by
        // drug (and are shown with the reason after the analysis runs), so this hint does not restate them.
        if (patientData.egfr > 0 && patientData.egfr < SEVERE_CKD_EGFR_BELOW) {
            warnings.egfr = 'Severe CKD: several drugs are withheld or dose-limited (MRAs, RAAS inhibitors, SGLT2 inhibitors). Run the analysis to see which, and why.';
        } else if (!(patientData.egfr > 0)) {
            warnings.egfr = 'Renal estimate unavailable: confirm age, sex and creatinine. Renal-dependent changes wait for assessment.';
        }
        // Same rule the engine applies (LVEF below 20 with at least TWO of: cool extremities, narrow pulse pressure, BUN/creatinine above 20), not one marker.
        if (isLowOutputState(patientData)) warnings.low_output = `Low-output profile detected (LVEF < ${LOW_OUTPUT.lvefBelow} with hypoperfusion markers)`;
        return warnings;
    }, [patientData]);

    // --- 2d. Disable simulation when validation errors exist ---
    const hasValidationErrors = Object.keys(validationErrors).length > 0 || pending;
    useEffect(() => { onValidityChange?.(hasValidationErrors); }, [hasValidationErrors, onValidityChange]);

    const focusField = (field: string) => {
        const el = document.getElementById(field);
        if (el instanceof HTMLDetailsElement) el.open = true;
        el?.closest('details')?.setAttribute('open', '');
        el?.scrollIntoView({ block: 'center' });
        (el as HTMLElement | null)?.focus();
    };
    const problemEntries = [...Object.entries(validationErrors),
        ...(pendingMedication ? [['add-medication-drug','Save or cancel the medication entry']] : []),
        ...(pendingHistory ? [['patient-history','Save or clear the unfinished history/allergy entry']] : [])];

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        // Helper to check if input is a number type
        const isNumber = type === 'number' || type === 'range';

        setPatientData(prev => {
            // Blank potassium/creatinine is stored as the engine's "not entered" sentinel (0), never undefined.
            const blankValue = (name === 'potassium' || name === 'creatinine') ? 0 : undefined;
            const next: Patient = {
                ...prev,
                [name]: value === '' ? blankValue : (isNumber ? Number(value) : value)
            };
            if (name === 'is_pregnant') next.is_pregnant = value === '' ? undefined : value === 'true';
            // A stale pregnancy flag must never persist invisibly after sex leaves 'Female'
            // (the pregnancy field is only rendered for Female patients).
            if (name === 'sex' && value !== 'Female') next.is_pregnant = undefined;
            return next;
        });
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
            else {
                // Edema has ONE grade: choosing a grade clears the others (two grades used to count as two congestion findings).
                if (finding.startsWith('Edema')) [...next].filter(f => f.startsWith('Edema')).forEach(f => next.delete(f));
                next.add(finding);
            }
            return {
                ...prev,
                volume_status: { ...prev.volume_status, exam_findings: next }
            };
        });
    };

    return {
        patientData, setPatientData,
        validationErrors, clinicalWarnings, urgentFindings,
        pending, pendingMedication, pendingHistory, setPendingMedication, setPendingHistory,
        hasValidationErrors, problemEntries, focusField,
        handleInputChange, handleVolumeChange, toggleFinding,
    };
}

export type PatientFormModel = ReturnType<typeof usePatientFormModel>;

export const FORM_SECTION_IDS = ['patient-demographics', 'patient-symptoms', 'patient-exam', 'patient-diagnostics', 'patient-history', 'patient-scope', 'patient-medications', 'patient-social'] as const;
export type FormSectionId = typeof FORM_SECTION_IDS[number];

/** Renders one named section of the patient form against the shared model. */
export const FormSection: React.FC<{ id: FormSectionId; model: PatientFormModel }> = ({ id, model: m }) => {
    switch (id) {
        case 'patient-demographics': return <DemographicsSection patientData={m.patientData} onChange={m.handleInputChange} validationErrors={m.validationErrors} />;
        case 'patient-symptoms': return <SymptomsSection patientData={m.patientData} onChange={m.handleInputChange} validationErrors={m.validationErrors} clinicalWarnings={m.clinicalWarnings} />;
        case 'patient-exam': return <PhysicalExamSection patientData={m.patientData} onChange={m.handleInputChange} onVolumeChange={m.handleVolumeChange} onToggleFinding={m.toggleFinding} validationErrors={m.validationErrors} clinicalWarnings={m.clinicalWarnings} />;
        case 'patient-diagnostics': return <DiagnosticsSection patientData={m.patientData} onChange={m.handleInputChange} validationErrors={m.validationErrors} clinicalWarnings={m.clinicalWarnings} />;
        case 'patient-history': return <HistorySection patientData={m.patientData} setPatientData={m.setPatientData} onPendingChange={m.setPendingHistory} />;
        case 'patient-scope': return <ScopeSection patientData={m.patientData} setPatientData={m.setPatientData} />;
        case 'patient-medications': return <MedicationManager patientData={m.patientData} setPatientData={m.setPatientData} onPendingChange={m.setPendingMedication} />;
        case 'patient-social': return <SocialSection patientData={m.patientData} onChange={m.handleInputChange} setPatientData={m.setPatientData} validationErrors={m.validationErrors} clinicalWarnings={m.clinicalWarnings} />;
    }
};
