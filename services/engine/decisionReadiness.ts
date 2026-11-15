import type { DecisionReadiness, Medication, ModificationSet, Patient, SimulationOutput } from '../../types';
import { valueUnknown, isIronDeficient } from '../clinicalPredicates';
import { RAAS_CLASSES, MRA_POOL_CLASSES, getMedicationClassGroup } from './registry';
import { HYPOTENSION_SBP_BELOW, LOW_OUTPUT } from './thresholds';
import { PDE5_INHIBITORS } from './contraindications';
import { expandAllergies } from './allergy';
import { MEDICATION_FORMULARY } from '../../constants';
import { adjacentTiers } from './regimenUtils';
import type { RegimenMed } from '../../types';

export const needsDoseIntervalReview = (p: Patient, r: RegimenMed) => r.exposure?.dose_interval_reviewed !== true && !r.med.facts?.single_course_dose && !r.med.facts?.short_course_addon && !!adjacentTiers(r,p).up;

export function knownMedicationChangeHold(p: Patient, med: Medication): string | null {
    if (['Loop Diuretic','Thiazide-like Diuretic'].includes(med.drug_class) && p.potassium > 0 && p.potassium < 3.5)
        return 'Recorded potassium is below 3.5: correct and recheck before a new or intensified potassium-lowering diuretic (conservative software policy).';
    return null;
}

export const budgetKnown = (p: Patient) => typeof p.max_affordable_cost === 'number' && Number.isFinite(p.max_affordable_cost) && p.max_affordable_cost >= 0;
export const renalDataKnown = (p: Patient) => !valueUnknown(p.egfr) && !valueUnknown(p.creatinine);

/** Prerequisites for a medication CHANGE, not a reason to stop an established drug.
 * Applied at eligibility AND to finished candidates, including rescue additions and switches.
 * Conservative software policy: missing observations are neither normal nor contraindications.
 */
export function missingForMedicationChange(p: Patient, med: Medication): string[] {
    const missing: string[] = [];
    const cls = med.drug_class;
    if (med.facts?.renal_change_review_below && p.egfr > 0 && p.egfr < med.facts.renal_change_review_below) missing.push('individual specialist renal-dose review; no validated numeric maximum is encoded for this drug at this kidney function');
    const needsChemistry = RAAS_CLASSES.has(cls) || MRA_POOL_CLASSES.has(cls) || ['Loop Diuretic', 'Thiazide-like Diuretic', 'Inotrope'].includes(cls);
    if (needsChemistry && valueUnknown(p.potassium)) missing.push('serum potassium');
    if ((needsChemistry || cls === 'SGLT2i') && !renalDataKnown(p)) missing.push('renal function');
    if (['Beta Blocker', 'If Inhibitor', 'Inotrope'].includes(cls) && valueUnknown(p.pulse)) missing.push('resting heart rate');
    if (cls === 'K+ Binder' && valueUnknown(p.potassium)) missing.push('serum potassium');
    if (['GLP-1 RA', 'GLP-1/GIP RA'].includes(cls) && valueUnknown(p.bmi)) missing.push('height and weight for BMI');
    if (cls === 'IV Iron' && p.hemoglobin === undefined) missing.push('hemoglobin for dose selection');
    if (cls === 'IV Iron') {
        if (!p.iron_course_review || p.iron_course_review === 'unknown') missing.push('prior iron-course dates and first-versus-repeat course assessment');
        if (!p.phosphate_review || p.phosphate_review === 'unknown') missing.push('phosphate safety assessment (testing when indicated)');
        if (p.phosphate_review === 'low') missing.push('correction of recorded low phosphate before iron administration');
        if (p.iron_course_review === 'repeat_reviewed' && p.phosphate_review !== 'acceptable') missing.push('documented acceptable phosphate assessment before a repeat course (conservative policy)');
    }
    if (p.recorded_medication_exposures?.some(r => r.exposure?.status === 'held' && !r.exposure.restart_or_repeat_reviewed && getMedicationClassGroup(r.med.drug_class) === getMedicationClassGroup(cls))) missing.push('reason for the recorded hold and a deliberate restart/substitution plan');
    if (p.recorded_medication_exposures?.some(r => r.exposure?.status === 'completed' && r.med.drug_class === cls)
        && (cls === 'IV Iron' ? p.iron_course_review !== 'repeat_reviewed' : p.recorded_medication_exposures.some(r => r.exposure?.status === 'completed' && r.med.drug_class === cls && !r.exposure.restart_or_repeat_reviewed))) missing.push('reassessment before repeating a completed course');
    const pregnancyRestricted = RAAS_CLASSES.has(cls) || MRA_POOL_CLASSES.has(cls)
        || ['SGLT2i', 'If Inhibitor', 'sGC Stimulator', 'GLP-1 RA', 'GLP-1/GIP RA'].includes(cls)
        || (cls === 'Beta Blocker' && !med.facts?.beta1_selective);
    if (p.sex === 'Female' && p.is_pregnant === undefined && pregnancyRestricted) missing.push('pregnancy status (or not applicable)');
    return missing;
}

export function candidateHasMissingPrerequisite(p: Patient, candidate: ModificationSet): boolean {
    return candidate.modifications.some(m => ['add', 'titrate_up', 'swap'].includes(m.action)
        && m.target && (missingForMedicationChange(p, m.target.med).length > 0
            || knownMedicationChangeHold(p, m.target.med) !== null
            || (m.action === 'titrate_up' && m.source?.exposure?.dose_interval_reviewed !== true)
            || (!!m.source && (m.source.exposure?.status !== 'active' || m.source.exposure?.adherence !== 'consistent'))));
}

/** Readiness is separate from validity: an omitted observation may narrow scope; malformed data remain errors. */
export function assessDecisionReadiness(p: Patient): DecisionReadiness {
    const missing: DecisionReadiness['missing'] = [];
    const core: string[] = [];
    const add = (field: string, label: string, consequence: string, absent: boolean, needsCore = false) => {
        if (!absent || missing.some(m=>m.field===field)) return;
        missing.push({ field, label, consequence });
        if (needsCore) core.push(label);
    };
    add('age', 'Adult age', 'Confirm adult scope and age-dependent dosing.', valueUnknown(p.age), true);
    add('sex', 'Sex used for renal estimation', 'Renal estimation and reproductive safety cannot be assessed.', !p.sex, true);
    add('sbp', 'Systolic blood pressure', 'Blood-pressure safety and outpatient stability cannot be assessed.', valueUnknown(p.sbp), true);
    add('dbp', 'Diastolic blood pressure', 'Perfusion pressure and blood-pressure validity cannot be assessed.', valueUnknown(p.dbp), true);
    add('lvef', 'LVEF', 'Do not infer an EF phenotype or select its medication pathway.', valueUnknown(p.lvef), true);
    add('nyha_class', 'Symptoms / NYHA class', 'Symptom-dependent eligibility and stability need assessment.', !p.nyha_class, true);
    add('rhythm', 'Rhythm', 'Conduction- and rhythm-dependent medication safety cannot be assessed.', !p.rhythm, true);
    add('current_weight_kg', 'Current weight', 'Weight-based doses and volume assessment cannot be completed.', valueUnknown(p.volume_status.current_weight_kg), true);
    add('dry_weight_kg', 'Estimated dry weight', 'This model cannot generate volume-dependent regimen options without an estimate.', valueUnknown(p.volume_status.dry_weight_kg), true);
    add('pulse', 'Resting heart rate', 'No beta-blocker, ivabradine or digoxin start, increase or switch; other decisions may remain assessable.', valueUnknown(p.pulse));
    add('potassium', 'Serum potassium', 'RAAS/MRA, diuretic, digoxin and binder starts/increases/switches wait for potassium.', valueUnknown(p.potassium));
    add('creatinine', 'Renal function', 'RAAS/MRA, SGLT2 inhibitor, diuretic and digoxin starts/increases/switches wait for renal assessment.', !renalDataKnown(p));
    add('is_pregnant', 'Pregnancy status', 'Pregnancy-restricted therapy and nonselective beta-blocker changes are withheld; confirm status or not applicable.', p.sex === 'Female' && p.is_pregnant === undefined);
    add('kccq_score', 'Measured KCCQ', 'Not required for other eligible decisions. No KCCQ value or response is invented; functional treatment response remains unquantified.', p.kccq_score === undefined);
    add('nt_pro_bnp', 'NT-proBNP', 'No neurohormonal score or biomarker projection. Biomarker-dependent eligibility remains withheld.', valueUnknown(p.nt_pro_bnp));
    add('bun', 'BUN', 'BUN/creatinine perfusion marker cannot be assessed; no normal ratio is assumed.', valueUnknown(p.bun));
    add('hemoglobin', 'Hemoglobin', 'Iron deficiency can be reviewed, but an exact IV iron dose waits for hemoglobin.', p.hemoglobin === undefined && isIronDeficient(p));
    p.current_regimen.forEach((r,i) => {
        const field=`medication_exposure_${p.recorded_medication_exposures?.findIndex(x=>x.med.name===r.med.name) ?? i}`;
        add(field, `${r.med.name}: current use`, 'Confirm actual dose and consistent use before related increases or substitutions; independent eligible decisions and indicated reductions remain available.', r.exposure?.status!=='active'||r.exposure?.adherence!=='consistent');
        if (r.exposure?.status==='active' && r.exposure?.adherence==='consistent') add(field, `${r.med.name}: dose timing`, 'Confirm the drug-specific interval and tolerability before an increase. Recorded dates alone do not establish readiness.', needsDoseIntervalReview(p,r));
    });
    const ironContext = isIronDeficient(p) || p.recorded_medication_exposures?.some(r=>r.med.drug_class==='IV Iron');
    add('iron_course_review', 'Prior iron-course assessment', 'An exact iron option waits for first-versus-repeat course assessment, prior doses and interval review.', !!ironContext && (!p.iron_course_review || p.iron_course_review==='unknown'));
    add('phosphate_review', 'Phosphate safety assessment', 'An iron option waits for phosphate risk/testing assessment and correction of low phosphate; a repeat course needs acceptable phosphate review (conservative software policy).', !!ironContext && (!p.phosphate_review || ['unknown','low'].includes(p.phosphate_review) || (p.iron_course_review==='repeat_reviewed'&&p.phosphate_review!=='acceptable')));
    add('height_cm', 'Height / BMI', 'BMI-dependent obesity-treatment changes are withheld when BMI is unavailable.', valueUnknown(p.bmi));
    add('race', 'Self-reported race', 'Race-specific evidence cannot be applied; other indications remain assessable.', !p.race);
    add('max_affordable_cost', 'Monthly medication budget', 'Affordability is unassessed; no budget filter or cost-domain contribution.', !budgetKnown(p));
    add('insurance_tier', 'Pricing profile', 'Do not assume insurance coverage or an out-of-pocket price.', !p.insurance_tier);
    // One observed hypoperfusion marker plus an unavailable BUN/Cr marker cannot establish a stable low-EF state.
    if (p.lvef > 0 && p.lvef < LOW_OUTPUT.lvefBelow && (!renalDataKnown(p) || valueUnknown(p.bun))
        && (p.volume_status.exam_findings.has('Cool Extremities') || (p.sbp > p.dbp && p.sbp - p.dbp <= LOW_OUTPUT.pulsePressureMax))) {
        core.push('perfusion assessment with missing BUN/creatinine');
    }
    return {
        mode: core.length ? 'limited_review' : 'medication_options', missing,
        available: core.length
            ? ['Review recorded low blood pressure, high potassium or low oxygen saturation, duplicate therapies, documented allergy conflicts and the supported interaction checks below. These checks do not constitute a complete acute assessment.']
            : ['Evaluate medication changes whose clinical prerequisites are recorded. Each option still requires review of contraindications, monitoring and actual patient tolerance.'],
        deferred: [
            ...(core.length ? [`Complete medication-regimen generation waits for: ${core.join(', ')}. This model limitation does not prevent the focused safety review.`] : []),
            ...missing.filter(m => !core.includes(m.label)).map(m => `${m.label}: ${m.consequence}`),
        ],
    };
}

/** Focused checks whose prerequisites are present. Never run the full physiology model with invented defaults. */
export function knownUrgentFindings(input: unknown): string[] {
    if (!input || typeof input !== 'object') return [];
    const p = input as Partial<Patient>;
    const alerts: string[] = [];
    if (typeof p.sbp === 'number' && Number.isFinite(p.sbp) && p.sbp > 0 && p.sbp < HYPOTENSION_SBP_BELOW) alerts.push(`HEMODYNAMIC INSTABILITY: Recorded systolic BP ${p.sbp} mmHg is below ${HYPOTENSION_SBP_BELOW}. Prompt clinical assessment takes priority over outpatient medication optimization.`);
    if (typeof p.potassium === 'number' && Number.isFinite(p.potassium) && p.potassium >= 6.0) alerts.push(`HYPERKALEMIC EMERGENCY: Recorded potassium ${p.potassium} mmol/L requires urgent assessment and confirmation, ECG and treatment as clinically indicated. Do not wait for the rest of this form.`);
    // Preserve the existing effects.ts hypoxia alert even when no complete regimen can be generated.
    if (typeof p.oxygen_saturation === 'number' && Number.isFinite(p.oxygen_saturation) && p.oxygen_saturation > 0 && p.oxygen_saturation < 90) alerts.push(`HYPOXIA ALERT: Recorded SpO2 ${p.oxygen_saturation}% is below 90%. Confirm the measurement and promptly assess oxygenation and possible pulmonary edema; do not wait for the rest of this form.`);
    return alerts;
}

export function limitedInformationReview(p: Patient, readiness: DecisionReadiness): SimulationOutput {
    const alerts: string[] = ['PARTIAL REVIEW: Complete medication options are withheld. Review the supported findings below and obtain the listed missing observations. Absence of a finding here is not a safety clearance.'];
    alerts.push(`DATA REQUIRED: ${readiness.deferred[0]}`);
    alerts.push(...knownUrgentFindings(p));
    if (p.sbp > 0 && p.dbp > 0 && p.sbp <= p.dbp) alerts.push('INPUT ERROR: Systolic BP must exceed diastolic BP. Verify both measurements.');
    const groups = new Map<string, string[]>();
    for (const r of p.current_regimen) {
        if (r.med.facts?.short_course_addon) continue;
        const group = getMedicationClassGroup(r.med.drug_class);
        groups.set(group, [...(groups.get(group) ?? []), r.med.name]);
    }
    for (const [group, names] of groups) if (names.length > 1) alerts.push(`MEDICATION RECONCILIATION: Multiple entries in ${group}: ${names.join(', ')}. Confirm actual use and review duplicate therapy; this partial assessment does not select which agent to stop.`);
    const allergy = expandAllergies(p.allergies, MEDICATION_FORMULARY);
    for (const r of p.current_regimen) {
        if (allergy.expanded.has(r.med.name)) alerts.push(`ALLERGY CONFLICT: ${r.med.name} is both current and matched to a documented allergy. Reconcile the allergy and exposure before administration; assess any current reaction promptly.`);
        if (p.is_pregnant === true) {
            const reasons = (r.med.contraindication_checks ?? []).filter(c => /pregnan/i.test(c.reason) && c.when(p)).map(c => c.reason);
            if (reasons.length) alerts.push(`PREGNANCY SAFETY REVIEW: ${r.med.name}: ${reasons.join('; ')}. Arrange prompt prescribing review; no replacement dose is generated from this incomplete case.`);
        }
    }
    if (allergy.unmatched.length) alerts.push(`ALLERGY NOTE: Unmatched entries (${allergy.unmatched.join(', ')}) require manual reconciliation; they have not been cleared.`);
    if (p.current_regimen.some(r => r.med.drug_class === 'Vasodilator') && PDE5_INHIBITORS.some(n => p.external_medications?.has(n))) {
        alerts.push('CONTRAINDICATED COMBINATION: A nitrate and a PDE5 inhibitor are recorded together. Avoid coadministration and obtain immediate prescribing review; severe hypotension can occur. An unknown BP does not remove this interaction.');
    }
    return { scoredRegimens: [], excludedMedications: [], clinicalAlerts: alerts, monitoringPlan: [],
        missingDataNotices: readiness.missing.map(m => `${m.label}: ${m.consequence}`), decisionReadiness: readiness };
}
