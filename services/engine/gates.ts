/** Input audit and safety gates (stages 1-3 of the pipeline). Moved verbatim from simulationService.ts (phase 4). */
import { Patient, RegimenMed, SimulationOutput } from '../../types';
import { drugFacts } from './drugFacts';
import { valueUnknown } from '../clinicalPredicates';
import { RAAS_CLASSES, getMedicationClassGroup } from './registry';
import { hasUnknownHistoricalHFrEF, vericiguatNtProBnpThreshold } from '../clinicalPredicates';
import { PDE5_INHIBITORS } from './contraindications';
import { taggedDiscontinuedMeds } from './eligibility';
import { buildMissingDataNotices, computeGdmtGaps } from './explain';
import { dedupeCurrentRegimen, hrContinuationAction, isLowOutputState, shouldPreserveQuadForUnknownHistory } from './regimenUtils';

export interface CriticalDataAudit {
    alerts: string[];
    unknownPotassium: boolean;
    unknownRenal: boolean;
    unknownBnp: boolean;
    unknownLvef: boolean;
}

export function auditCriticalData(patient: Patient): CriticalDataAudit {
    const alerts: string[] = [];
    const unknownLvef = valueUnknown(patient.lvef);
    const unknownPotassium = valueUnknown(patient.potassium);
    const unknownRenal = valueUnknown(patient.egfr) || valueUnknown(patient.creatinine);
    const unknownBnp = valueUnknown(patient.nt_pro_bnp);

    if (unknownLvef) alerts.push('DATA REQUIRED: LVEF not entered. HF phenotype (HFrEF / HFmrEF / HFpEF) cannot be determined and a GDMT pathway cannot be selected. Obtain an echocardiogram before relying on recommendations.');
    if (unknownPotassium) alerts.push('DATA REQUIRED: Serum potassium not entered. Obtain a BMP before initiating or up-titrating a RAAS inhibitor or MRA — hyperkalemia risk cannot be assessed and must not be assumed absent.');
    if (unknownRenal) alerts.push('DATA REQUIRED: Renal function (eGFR / creatinine) not entered. Required for renal dose adjustment and RAAS / MRA / SGLT2i safety. Obtain a BMP.');
    if (unknownBnp) alerts.push('DATA NOTE: NT-proBNP not entered. Neurohormonal status is not assessed and is excluded from scoring (not scored as normal).');

    return { alerts, unknownPotassium, unknownRenal, unknownBnp, unknownLvef };
}

// Catches data-entry errors (unit confusion, transcription slips) — values outside the range
// physiology allows. These are flagged for verification rather than silently consumed, because a
// typo like LVEF 250 or K+ 50 (mg instead of mEq/L) would otherwise drive confident output.
export function validatePhysiologicBounds(patient: Patient): string[] {
    const alerts: string[] = [];
    const flag = (cond: boolean, msg: string) => { if (cond) alerts.push('IMPLAUSIBLE VALUE: ' + msg); };

    flag(patient.lvef > 80, `LVEF ${patient.lvef}% exceeds the physiologic maximum (~80%). Verify entry.`);
    flag(patient.potassium > 8.0, `Serum potassium ${patient.potassium} mEq/L is extreme — confirm units (mEq/L, not mg) and rule out a transcription error. If accurate, this is a hyperkalemic emergency.`);
    flag(patient.potassium > 0 && patient.potassium < 2.0, `Serum potassium ${patient.potassium} mEq/L is below survivable range — verify entry.`);
    flag(patient.sbp > 260 || patient.dbp > 200, `Blood pressure ${patient.sbp}/${patient.dbp} mmHg is outside the recordable range — verify entry.`);
    flag(patient.egfr > 150, `eGFR ${patient.egfr} mL/min/1.73m² exceeds the physiologic maximum (~120). Verify entry.`);
    flag(patient.pulse > 250 || (patient.pulse > 0 && patient.pulse < 20), `Heart rate ${patient.pulse} bpm is outside the physiologic range — verify entry.`);
    flag(patient.creatinine > 20, `Creatinine ${patient.creatinine} mg/dL is extreme — confirm units and entry.`);
    flag(patient.bmi > 80 || (patient.bmi > 0 && patient.bmi < 10), `BMI ${patient.bmi} is outside the physiologic range — verify height/weight entry.`);

    return alerts;
}

// Flags regimens the patient ARRIVES on that are themselves unsafe/inappropriate — the
// engine should actively prompt deprescribing, not silently filter these out of output.
export function detectInappropriateRegimen(patient: Patient): string[] {
    const alerts: string[] = [];
    const current = patient.current_regimen || [];

    const raasInCurrent = current.filter(r => RAAS_CLASSES.has(r.med.drug_class));
    if (raasInCurrent.length > 1) {
        alerts.push(`INAPPROPRIATE REGIMEN: Patient is on dual RAAS blockade (${raasInCurrent.map(r => r.med.name).join(' + ')}). Deprescribe one agent — the combination raises hyperkalemia, AKI, and hypotension risk without survival benefit (ACC/AHA 2022; ONTARGET).`);
    }

    const allMra = current.filter(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA');
    if (allMra.length > 1) {
        alerts.push(`INAPPROPRIATE REGIMEN: Patient is on more than one MRA (${allMra.map(r => r.med.name).join(' + ')}). Use a single MRA — combination markedly increases severe hyperkalemia risk with no added benefit.`);
    }

    // Other duplicate same-class-group therapy (two beta-blockers, two SGLT2i, two loop diuretics,
    // etc.) — never appropriate; deprescribe to a single agent. RAAS and MRA are reported above.
    const groupCounts = new Map<string, RegimenMed[]>();
    current.forEach(r => {
        const g = getMedicationClassGroup(r.med.drug_class);
        if (!groupCounts.has(g)) groupCounts.set(g, []);
        groupCounts.get(g)!.push(r);
    });
    groupCounts.forEach((meds, group) => {
        if (meds.length <= 1 || group === 'RAAS Inhibitor' || group === 'MRA') return;
        alerts.push(`INAPPROPRIATE REGIMEN: Patient is on more than one ${group} (${meds.map(r => r.med.name).join(' + ')}). Use a single agent in this class — duplicate same-class therapy adds toxicity without added benefit.`);
    });

    // A current med that also appears in the documented DISCONTINUED list (by name) suggests an
    // unintended restart. Surface for verification rather than force-removing — the restart may
    // be deliberate (e.g. a cost-driven stop being retried), and the structured intolerance
    // policy separately force-removes confirmed intolerances via analyzeCurrentRegimen.
    const discontinuedByName = new Map((patient.discontinued_meds || []).map(dm => [dm.name, dm.reason]));
    current.forEach(r => {
        const stopReason = discontinuedByName.get(r.med.name);
        if (stopReason) {
            alerts.push(`MEDICATION HISTORY CONFLICT: ${r.med.name} is in the current regimen but is documented as previously discontinued (${stopReason}). Verify the restart is deliberate before continuing it.`);
        }
    });

    const ext = patient.external_medications || new Set<string>();
    const onNonDhpCcb = ext.has('Verapamil') || ext.has('Diltiazem') || patient.comorbidities.has('On Verapamil/Diltiazem');
    if (onNonDhpCcb && patient.lvef > 0 && patient.lvef <= 40) {
        alerts.push('INAPPROPRIATE THERAPY: Non-dihydropyridine calcium-channel blocker (verapamil / diltiazem) in HFrEF is potentially harmful — it is a negative inotrope and can worsen heart failure (ACC/AHA 2022, Class III). Deprescribe; if rate control is needed, use a beta-blocker ± digoxin.');
    }

    if (patient.comorbidities.has('Chronic NSAID Use')) {
        alerts.push('AVOID: Chronic NSAID use is discouraged in heart failure — sodium / fluid retention, blunted diuretic response, and AKI risk (amplified with RAAS / MRA). Deprescribe or substitute acetaminophen / topical analgesia where feasible.');
    }

    const onPde5i = PDE5_INHIBITORS.some(n => ext.has(n));
    const onNitrate = current.some(r => r.med.drug_class === 'Vasodilator');
    if (onPde5i && onNitrate) {
        alerts.push('INAPPROPRIATE THERAPY: Nitrate (Isosorbide Dinitrate) with a PDE5 inhibitor (sildenafil/tadalafil) is an absolute contraindication — risk of profound or fatal hypotension (FDA label). The nitrate has been removed from all recommendations; deprescribe one agent immediately.');
    }

    // Over-diuresis: euvolemic patient maintained on a high-dose loop diuretic. The loop should be
    // down-titrated to the lowest effective dose to avoid hypovolemia and prerenal AKI — especially
    // when an SGLT2i is being added (additive diuresis). (Volume DEPLETION below dry weight is
    // handled separately by the volume-depletion alert.)
    const fluidExcess = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const euvolemic = Math.abs(fluidExcess) <= 1.0;
    const highDoseLoop = current.find(r => {
        const t = drugFacts(r.med).high_dose_threshold;
        return r.med.drug_class === 'Loop Diuretic' && t !== undefined && Number(r.dose.strength) >= t;
    });
    if (euvolemic && highDoseLoop) {
        alerts.push(`LOOP DIURETIC OVER-TREATMENT: Patient appears euvolemic on a high-dose loop diuretic (${highDoseLoop.med.name} ${highDoseLoop.dose.strength}${highDoseLoop.dose.unit}). Down-titrate to the lowest effective dose to avoid over-diuresis, hypovolemia, and prerenal AKI — particularly when initiating an SGLT2i (additive natriuresis).`);
    }

    return alerts;
}

// =====================================================================================
// Pipeline stages 1-3 (input audit and safety gates). Bodies moved verbatim from
// generateAndScoreModifications; they push onto the caller's `clinicalAlerts` in the same order.
// =====================================================================================

export interface InputAudit {
    dataAudit: CriticalDataAudit;
    /** Guideline-anchored gap list; [] when the audit stopped the run before it was computed. */
    gdmtGaps: string[];
    missingDataNotices: string[];
    /** Non-null when the run must end here with alerts only (implausible values, unknown LVEF, SBP <= DBP). */
    stop: SimulationOutput | null;
}

/**
 * Stage 1 - audit inputs: remove duplicate current meds, flag missing critical data and
 * inappropriate arriving regimens, and hard-stop on implausible values / unknown LVEF / SBP <= DBP.
 * Mutates `patient.current_regimen` (the caller's clone) when duplicates are removed.
 */
export function auditInputs(patient: Patient, clinicalAlerts: string[]): InputAudit {
    const dedupedCurrent = dedupeCurrentRegimen(patient.current_regimen || []);
    if (dedupedCurrent.duplicateNames.length > 0) {
        patient.current_regimen = dedupedCurrent.regimen;
        clinicalAlerts.push(
            `INPUT SAFETY: Duplicate current medications removed (${dedupedCurrent.duplicateNames.join(', ')}). ` +
            'Duplicate entries can double-count hemodynamic effects.'
        );
    }

    // --- Real-world robustness: audit incomplete data and inappropriate arriving regimens ---
    const dataAudit = auditCriticalData(patient);
    const stopped = (stop: SimulationOutput): InputAudit => ({ dataAudit, gdmtGaps: [], missingDataNotices: [], stop });
    clinicalAlerts.push(...dataAudit.alerts);
    const implausibleValueAlerts = validatePhysiologicBounds(patient);
    clinicalAlerts.push(...implausibleValueAlerts);
    clinicalAlerts.push(...detectInappropriateRegimen(patient));

    // Physiologically-impossible inputs are data-entry errors (unit confusion, transcription
    // slips). Every downstream decision — phenotype, contraindications, projections — would be
    // computed on garbage, so this is a hard stop, not a flag-and-proceed. (e.g. LVEF 99 would
    // otherwise classify as HFpEF and drive a confident SGLT2i pathway off a typo.)
    if (implausibleValueAlerts.length > 0) {
        return stopped({ scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: [], gdmtGaps: [], missingDataNotices: buildMissingDataNotices(patient), followUpCalendar: [] });
    }

    // LVEF is the axis the entire phenotype/pathway selection turns on. Without it the tool
    // cannot pick HFrEF vs HFmrEF vs HFpEF — fail safe with alerts only rather than guessing.
    if (dataAudit.unknownLvef) {
        return stopped({ scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: [], gdmtGaps: [], missingDataNotices: buildMissingDataNotices(patient), followUpCalendar: [] });
    }

    // Deterministic, guideline-anchored categorical outputs — independent of scoring.
    const gdmtGaps = computeGdmtGaps(patient);
    const missingDataNotices = buildMissingDataNotices(patient);

    if (patient.sbp <= patient.dbp) {
        clinicalAlerts.push(
            'INPUT ERROR: Systolic BP must be greater than diastolic BP (SBP > DBP). ' +
            'Correct blood pressure values before running recommendations.'
        );
        return stopped({ scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: [] });
    }

    return { dataAudit, gdmtGaps, missingDataNotices, stop: null };
}

/** Flags computed while raising alerts that the later stages still need. */
export interface ClinicalFlags {
    lowOutput: boolean;
    isVolumeDepleted: boolean;
    hasDiureticInCurrent: boolean;
}

/**
 * Stage 2 - raise the alert-only gates (pregnancy, low output, hypotension, hyperkalemic emergency,
 * advanced-HF / device / rehab referrals, volume depletion, severe CKD, HFimpEF status, vericiguat
 * documentation). These add alerts; they never remove drugs by themselves.
 */
export function raiseClinicalAlerts(patient: Patient, dataAudit: CriticalDataAudit, clinicalAlerts: string[]): ClinicalFlags {
    // --- S4: Pregnancy safety alert ---
    if (patient.is_pregnant === true) {
        clinicalAlerts.push('PREGNANCY ALERT: ACEi, ARB, ARNI, MRA, and nsMRA (Finerenone) are contraindicated (Category X). SGLT2i excluded (Category C — insufficient human safety data). Vericiguat excluded (FDA BOXED WARNING — embryo-fetal toxicity) and Ivabradine excluded (fetal harm in animal studies). GLP-1 therapy excluded. These agents have been excluded from all recommendations.');
    }

    // --- Heart-rate rule on an established beta-blocker / ivabradine (facts.hr_continuation): the dose is reduced one step,
    // not stopped; the alert names the heart rate and the action. (Candidate generation applies the reduction.)
    (patient.current_regimen || []).forEach(r => {
        const hr = hrContinuationAction(r.med, patient);
        if (!hr?.reduce) return;
        if (r.med.contraindications?.(patient)) return; // already being removed for a contraindication (AV block, sick sinus); that reason is stated instead
        const atLowest = r.med.available_doses.findIndex(d => d.strength === r.dose.strength) <= 0;
        clinicalAlerts.push(
            `BRADYCARDIA ON ${r.med.name.toUpperCase()}: resting heart rate ${patient.pulse} bpm on ${r.med.name} ${r.dose.strength}${r.dose.unit}. ` +
            (atLowest
                ? `The dose is already the lowest, so the plan withholds it (for a beta-blocker, taper over 1-2 weeks; do not stop abruptly). `
                : `The plan reduces it ONE dose step; it is not removed. `) +
            `Basis: ${hr.basis}. Reassess symptoms and the ECG for sick sinus syndrome or AV block and review other rate-slowing drugs; no up-titration while the rate is low.`
        );
    });

    // --- S2: Hemodynamic instability — block pharmacologic optimization ---
    // Threshold raised to SBP < 90 (MAP ~65 mmHg): oral GDMT initiation requires adequate perfusion
    const lowOutput = isLowOutputState(patient);
    if (lowOutput) {
        clinicalAlerts.push(
            'LOW OUTPUT STATE: LVEF < 20% with hypoperfusion markers (cool extremities, narrow pulse pressure, or pre-renal azotemia). ' +
            'Consider inotropic support and Advanced HF consultation before oral GDMT initiation.'
        );
    }

    if (patient.sbp < 90) {
        clinicalAlerts.push(
            'HEMODYNAMIC INSTABILITY: SBP < 90 mmHg. Oral GDMT optimization is unsafe at current blood pressure. ' +
            'Stabilize hemodynamics first. Consider: IV inotropes (dobutamine/milrinone), hemodynamic monitoring (PA catheter), ' +
            'vasopressor support if needed, and Advanced Heart Failure consultation.'
        );
    }

    // --- S2b: Hyperkalemic emergency — baseline K+ 6.0-8.0 (values > 8.0 already hard-stop as
    // implausible/extreme in validatePhysiologicBounds). A medical emergency requiring ECG and
    // urgent treatment, not outpatient regimen optimization. For K+ >= 6.5 the engine returns
    // alerts only (parallel to the SBP < 90 gate below); for 6.0-6.4 it alerts and proceeds —
    // deprescribing the offending agent with binder rescue is still clinically useful there.
    const hyperkalemicEmergency = patient.potassium >= 6.0 && patient.potassium <= 8.0;
    if (hyperkalemicEmergency) {
        clinicalAlerts.push(
            'HYPERKALEMIC EMERGENCY: Serum K+ ' + patient.potassium.toFixed(1) + ' mEq/L (≥ 6.0). ' +
            'Obtain ECG immediately and treat urgently — IV calcium if ECG changes, insulin/glucose, ' +
            'K+ binder or dialysis — before oral GDMT optimization.'
        );
    }

    // --- S3: Advanced HF referral trigger ---
    const advancedHFCriteria = lowOutput ||
        (patient.lvef <= 20 && patient.sbp < 90) ||
        (patient.nyha_class === 'IV' && patient.nt_pro_bnp > 4000);
    if (advancedHFCriteria) {
        clinicalAlerts.push(
            'ADVANCED HEART FAILURE ALERT: This patient meets criteria for Advanced HF evaluation (INTERMACS 3-4). ' +
            'Consider: IV inotropic support, mechanical circulatory support (LVAD/Impella), heart transplant evaluation, ' +
            'CRT/ICD assessment, and palliative care discussion. Refer to Advanced HF specialist.'
        );
    }

    // --- D4: ICD/CRT device eligibility screening (ACC/AHA 2022 §7.3.5, Class I) ---
    const icdCrtEligible = patient.lvef <= 35 &&
        (patient.nyha_class === 'II' || patient.nyha_class === 'III') &&
        !advancedHFCriteria; // Advanced HF already triggers its own referral
    if (icdCrtEligible) {
        clinicalAlerts.push(
            'DEVICE THERAPY SCREENING: LVEF ≤ 35% with NYHA Class ' + patient.nyha_class + '. ' +
            'Evaluate for ICD (primary prevention of sudden cardiac death) after ≥ 3 months of optimized GDMT. ' +
            'If QRS ≥ 150ms with LBBB morphology, also evaluate for CRT (Class I, ACC/AHA 2022). ' +
            'Refer to electrophysiology if not already assessed.'
        );
    }

    // --- D5: Cardiac rehabilitation referral (ACC/AHA 2022 §7.3.4, Class I) ---
    const cardiacRehabEligible = patient.lvef <= 40 &&
        (patient.nyha_class === 'II' || patient.nyha_class === 'III') &&
        patient.sbp >= 90 && !advancedHFCriteria;
    if (cardiacRehabEligible) {
        clinicalAlerts.push(
            'CARDIAC REHABILITATION: HFrEF with NYHA Class ' + patient.nyha_class +
            '. Exercise-based cardiac rehab is Class I (ACC/AHA 2022) for stable HF patients — improves functional capacity, quality of life, and reduces HF hospitalization. Refer if not already enrolled.'
        );
    }

    // --- P5: Volume depletion alert ---
    const currentFluidBalance = patient.volume_status.current_weight_kg - patient.volume_status.dry_weight_kg;
    const isVolumeDepleted = currentFluidBalance < -1.0;
    const hasDiureticInCurrent = (patient.current_regimen || []).some(r =>
        r.med.drug_class === 'Loop Diuretic' || r.med.drug_class === 'Thiazide-like Diuretic'
    );
    if (isVolumeDepleted && hasDiureticInCurrent) {
        clinicalAlerts.push(
            'VOLUME DEPLETION: Patient is ' + Math.abs(currentFluidBalance).toFixed(1) + 'kg below dry weight while on diuretics. ' +
            'Diuretic reduction/discontinuation is the priority intervention before adding new agents. Risk of AKI and hemodynamic collapse.'
        );
    }

    if (!dataAudit.unknownRenal && patient.egfr < 20) {
        clinicalAlerts.push(
            'SEVERE CKD DIURETIC ALERT: eGFR < 20 may blunt oral loop diuretic response. Consider BID/TID loop dosing strategy, conversion to torsemide/bumetanide, and close daily weight/urine monitoring.'
        );
    }

    const historicalStatusUnknown = hasUnknownHistoricalHFrEF(patient);
    const preservingQuadForUnknownHistory = shouldPreserveQuadForUnknownHistory(patient);
    if (patient.lvef > 40 && historicalStatusUnknown) {
        if (preservingQuadForUnknownHistory) {
            clinicalAlerts.push(
                'HFimpEF STATUS UNKNOWN: Prior reduced EF is undocumented, but existing RAAS/BB/MRA therapy suggests possible HFimpEF. Recommendations preserve quad GDMT while prior records are clarified.'
            );
        } else {
            clinicalAlerts.push(
                'HFimpEF STATUS UNKNOWN: Cannot determine if this patient previously had LVEF <= 40%. If previously on quad GDMT, consider continuing RAAS/BB/MRA/SGLT2i until prior records are clarified.'
            );
        }
    }

    const vericiguatCoreEligible = (patient.nyha_class === 'II' || patient.nyha_class === 'III' || patient.nyha_class === 'IV') &&
        patient.nt_pro_bnp >= vericiguatNtProBnpThreshold(patient) &&
        patient.lvef < 45;
    // M5: Only alert when worsening status is unknown — suppress when explicitly 'no' (patient
    // definitively ineligible). Coalesce: an absent field means the same as 'unknown' — both block
    // vericiguat via hasRecentWorseningHF, so both must prompt for documentation.
    if (vericiguatCoreEligible && (patient.recent_hf_worsening_within_6mo ?? 'unknown') === 'unknown') {
        clinicalAlerts.push(
            'VERICIGUAT ELIGIBILITY WARNING: Recent HF worsening status unknown. Document whether an HF hospitalization occurred within 6 months or outpatient IV diuretics within 3 months — required before Vericiguat use.'
        );
    }

    return { lowOutput, isVolumeDepleted, hasDiureticInCurrent };
}

/**
 * Stage 3 - hard safety stops: SBP < 90 or K+ >= 6.5 returns alerts only (no regimen output).
 * Returns null when the run may proceed.
 */
export function checkSafetyHardStops(
    patient: Patient,
    clinicalAlerts: string[],
    gdmtGaps: string[],
    missingDataNotices: string[]
): SimulationOutput | null {
    if (patient.sbp < 90 || patient.potassium >= 6.5) {
        return {
            scoredRegimens: [],
            excludedMedications: taggedDiscontinuedMeds(patient),
            clinicalAlerts,
            monitoringPlan: [],
            gdmtGaps,
            eligibleAdjuncts: [],
            missingDataNotices,
            followUpCalendar: []
        };
    }

    return null;
}
