/** Input audit and safety gates (stages 1-3 of the pipeline). Moved verbatim from simulationService.ts (phase 4). */
import { Patient, RegimenMed } from '../../types';
import { drugFacts } from './drugFacts';
import { valueUnknown } from '../clinicalPredicates';
import { RAAS_CLASSES, getMedicationClassGroup } from './registry';

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

    const onPde5i = ext.has('Sildenafil') || ext.has('Tadalafil');
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
