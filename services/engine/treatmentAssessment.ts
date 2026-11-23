import type { Medication, ModificationSet, Patient, QualitativeProjection, TreatmentAssessment } from '../../types';
import { physiologicTransitions } from './regimenTransition';
import { RAAS_CLASSES, DIURETIC_CLASSES } from './registry';

/** Evidence-supported purpose and reassessment context, not a fitted dose-response function. */
export function medicationEffectContext(med: Medication): string {
    const cls = med.drug_class;
    if (med.facts?.single_course_dose) return 'Course treatment: confirm prior infusions, current iron studies and hemoglobin. A completed infusion is not continuous exposure, and removing a list entry does not reverse iron repletion.';
    if (med.facts?.short_course_addon) return 'Short course: confirm the course dates and oral-loop plan; reassess volume and electrolytes before further dosing. No additional kilograms of diuresis are calculated.';
    if (DIURETIC_CLASSES.has(cls)) return 'Assess measured weight, congestion, BP, sodium, potassium and renal response after the change. Dose conversion is a starting convention, not proof of equivalent diuresis or safety.';
    if (cls === 'If Inhibitor') return 'Adjust using measured resting heart rate and symptoms after two weeks. A higher dose is not assumed to have the same heart-rate effect or risk.';
    if (cls === 'Inotrope') return 'Confirm renal function, lean body size, interacting drugs, prior dose adjustment and a correctly timed serum level. The tool cannot determine an individual digoxin exposure.';
    if (cls === 'K+ Binder') return 'Use measured potassium and the correction-versus-maintenance plan. A modeled fall cannot establish correction or make another medication safe to start.';
    if (cls.includes('GLP')) return 'Assess tolerance, weight and symptoms over time. Trial-average weight loss is not applied to current weight; fluid loss, adiposity change and weight regain are not quantified.';
    if (cls === 'Beta Blocker') return 'Assess compensation, measured heart rate, BP and tolerance before each dose step. Confirm a taper or substitution plan when withdrawing; recovery of EF is not a reason inferred by this model to stop therapy.';
    if (RAAS_CLASSES.has(cls)) return 'Assess measured BP, renal function and potassium. Check transition-specific washout and contraindications; target-dose fractions are not validated physiological equivalence.';
    if (cls === 'MRA' || cls === 'nsMRA') return 'Assess measured potassium and renal function before and after a change. Steroidal and nonsteroidal MRAs are not assumed to be interchangeable by milligram or KCCQ effect.';
    if (cls === 'SGLT2i') return 'Assess volume status, renal function and acute-illness context. Benefits from separate trials are not used as a head-to-head physiological comparison.';
    if (cls === 'Vasodilator') return 'Assess BP and symptoms after each dose step and check nitrate interactions. A flat stored effect coefficient does not establish unchanged hypotension risk.';
    if (cls === 'sGC Stimulator') return 'Confirm the recent-worsening indication, measured BP and tolerance. Event-reduction evidence is not converted to an individual EF or BNP change.';
    return 'Individual dose response and withdrawal effects are not quantified; assess measured response and medication-specific precautions.';
}

export function buildTreatmentAssessment(patient: Patient, set: ModificationSet): TreatmentAssessment {
    const changes = physiologicTransitions(patient.current_regimen, set.resulting_regimen, set.modifications);
    const considerations: QualitativeProjection[] = [];
    for (const change of changes) {
        const med = (change.target ?? change.source)!.med;
        let detail = medicationEffectContext(med);
        if (change.action === 'swap') detail = `Switch ${change.source!.med.name} to ${med.name}. ${detail} No untreated state or exact replacement response is inferred.`;
        else if (change.action === 'remove' || change.action === 'titrate_down') detail = `Reduction or discontinuation: the magnitude and timing of loss of benefit, rebound or recovery are not estimated. ${detail}`;
        else if (change.action === 'titrate_up') detail = `Dose increase: additional benefit and adverse effects are not numerically estimated. ${detail}`;
        considerations.push({ label: med.name, direction: 'caution', detail });
    }
    if (patient.potassium > 6 && changes.length) considerations.unshift({ label: 'Urgent measured hyperkalemia', direction: 'caution', detail: 'Potassium remains above 6.0 in the recorded state. A reduction or hold may address an offending medication, but this option does not establish correction or replace urgent ECG, repeat potassium and clinical assessment.' });
    if (!changes.length) considerations.push({ label: 'Recorded regimen', direction: 'caution', detail: 'No net medication change is proposed. Reassess the recorded condition; unchanged medication does not establish clinical stability or complete treatment.' });
    const limitations = [
        'Individual changes in EF, BNP, KCCQ, NYHA class, body weight, BP, pulse and potassium are not estimated. Recorded observations remain unchanged until new measurements are entered.',
        'Cost is an estimate, usually a drug-level monthly price rather than a verified dose/formulation quote. Dosing burden is a frequency-based software proxy, not actual pill count or measured adherence.',
        'Safety checks use recorded findings and medication restrictions. Individual dose response is unknown; absence of a flagged hazard is not safety clearance, and offsetting medication effects are not credited as correction.',
    ];
    if (patient.current_regimen.some(r => !r.exposure?.started_on || !r.exposure?.dose_changed_on || r.exposure?.adherence !== 'consistent')) limitations.push('Exposure duration, time at dose or consistent use is not fully documented. Full established benefit and tolerance are not assumed.');
    return { basis: 'observed_treated_state', quantitative_response: 'not_estimated', considerations, limitations };
}
