/** Input audit and safety gates (stages 1-3 of the pipeline). Moved verbatim from simulationService.ts (phase 4). */
import { Medication, Patient, RegimenMed, SimulationOutput } from '../../types';
import { drugFacts } from './drugFacts';
import { valueUnknown, congestionFindingCount, isAcutelyDecompensated, pregnancyStatusRequired, kidneyNotEntered, weightAboveDryKg, kgText } from '../clinicalPredicates';
import { RAAS_CLASSES, MRA_POOL_CLASSES, getMedicationClassGroup } from './registry';
import { hasUnknownHistoricalHFrEF, vericiguatNtProBnpThreshold, hasAtrialFibrillationHistory } from '../clinicalPredicates';
import { PDE5_INHIBITORS, NSAID_COX2_EXTERNAL, TZD_SAXAGLIPTIN_EXTERNAL, EXTERNAL_POTASSIUM_SPARING_DIURETICS, LONG_ACTING_NITRATES, potassiumRaisersTaken, nitrateNamesTaken, digoxinAfibAccessoryPathway } from './contraindications';
import { POTASSIUM_RAISER_REVIEW_K, RAAS_START_K_CAUTION } from './thresholds';
import { taggedDiscontinuedMeds } from './eligibility';
import { buildMissingDataNotices, computeGdmtGaps, URGENT_POTASSIUM_MONITORING } from './explain';
import { dailyDose, isLoopDiureticResistant, dedupeCurrentRegimen, hrContinuationAction, kContinuationAction, kUptitrationBlock, isLowOutputState, isColdState, shouldPreserveQuadForUnknownHistory, sortedByName, isVolumeDepletedState, renalContraindicationReason } from './regimenUtils';
import { AF_RESTING_RATE_LENIENT_TARGET, HYPOTENSION_SBP_BELOW, RAAS_EGFR_REVIEW_BELOW, CREATININE_RISE_ACCEPTABLE_PCT, EGFR_FLOOR_FOR_CREATININE_RISE, BREASTFEEDING_NOT_ASSESSED, POTASSIUM_ABOVE_8_ACTION } from './thresholds';
import { assessCreatinineChange, creatinineRiseIsAcceptable, reduceCriterionSentence } from './renalChange';
import { scopeStatusFor } from './scopeGate';
import { classFindingsDisagreeAlerts, hypoxiaAlerts, unstableStateAlerts, conductionAlerts, slowHeartRateAlerts, scaleDisagreementAlerts, congestionWithoutWeightAlerts, perfusionAboveEfLimitAlerts, OPTION_PHRASES } from './urgentStates';
export { unstableStateAlerts };
import { expandAllergies } from './allergy';
import { isPregnancyRestricted } from './decisionReadiness';
import { MEDICATION_FORMULARY } from '../../constants';

export interface CriticalDataAudit {
    alerts: string[];
    unknownPotassium: boolean;
    unknownRenal: boolean;
    unknownBnp: boolean;
    unknownLvef: boolean;
    /** Heart rate blank in a non-paced rhythm: beta-blocker / ivabradine starts and dose increases are withheld. */
    unknownPulse: boolean;
}

export function auditCriticalData(patient: Patient): CriticalDataAudit {
    const alerts: string[] = [];
    const unknownLvef = valueUnknown(patient.lvef);
    const unknownPotassium = valueUnknown(patient.potassium);
    const unknownRenal = valueUnknown(patient.egfr) || valueUnknown(patient.creatinine);
    const unknownBnp = valueUnknown(patient.nt_pro_bnp);
    const unknownPulse = valueUnknown(patient.pulse) && patient.rhythm !== 'Paced';

    if (unknownLvef) alerts.push('DATA REQUIRED: LVEF not entered. HF phenotype (HFrEF = LVEF below 50, HFpEF = LVEF 50 or higher) cannot be determined and a GDMT pathway cannot be selected. Obtain an echocardiogram before relying on recommendations.');
    if (unknownPotassium) alerts.push('DATA REQUIRED: Serum potassium not entered. Obtain a BMP before initiating or up-titrating a RAAS inhibitor or MRA — hyperkalemia risk cannot be assessed and must not be assumed absent.');
    if (unknownRenal) {
        // R6 V10: name the value that is missing; an entered eGFR is not called missing (the form computes it from the creatinine, so this is only a caller that sets them apart).
        const which = kidneyNotEntered(patient);
        alerts.push(`DATA REQUIRED: ${which === 'both' ? 'Renal function (eGFR / creatinine)' : which === 'creatinine' ? 'Creatinine' : 'eGFR'} not entered.${which === 'both' ? '' : ' The tool needs both the creatinine and the eGFR.'} Required for renal dose adjustment and RAAS / MRA / SGLT2i safety. Obtain a BMP.`);
    }
    if (unknownBnp) alerts.push('DATA NOTE: NT-proBNP not entered. Neurohormonal status is not assessed and is excluded from scoring (not scored as normal).');

    if (unknownPulse) alerts.push('DATA REQUIRED: Heart rate not entered. A beta-blocker or ivabradine is not started or increased until the resting heart rate is known; drugs already in use are kept at their current dose.');

    return { alerts, unknownPotassium, unknownRenal, unknownBnp, unknownLvef, unknownPulse };
}

// Catches data-entry errors (unit confusion, transcription slips) — values outside the range
// physiology allows. These are flagged for verification rather than silently consumed, because a
// typo like LVEF 250 or K+ 50 (mg instead of mEq/L) would otherwise drive confident output.
/** One entry per implausible-value rule: the numeric fields it reads, the condition and the message. One table, so `implausibleFields` (below) can never drift from the alert. */
const roundedPotassium = (p: Patient): number => (typeof p.potassium === 'number' && Number.isFinite(p.potassium) && p.potassium > 0 ? Math.round(p.potassium * 10) / 10 : 0);
const PHYSIOLOGIC_CHECKS: ReadonlyArray<{ fields: readonly (keyof Patient)[]; bad: (p: Patient) => boolean; msg: (p: Patient) => string }> = [
    { fields: ['lvef'], bad: p => p.lvef > 80, msg: p => `LVEF ${p.lvef}% exceeds the physiologic maximum (~80%). Verify entry.` },
    // R12 D5(e): potassium is rounded to one decimal on entry, so every path reads the same value: 8.01 to 8.04 is 8.0 (not above 8.0), 8.05 is 8.1.
    { fields: ['potassium'], bad: p => roundedPotassium(p) > 8.0, msg: p => `Serum potassium ${roundedPotassium(p)} mEq/L is extreme — confirm units (mEq/L, not mg) and rule out a transcription error. ${POTASSIUM_ABOVE_8_ACTION}` },
    { fields: ['potassium'], bad: p => p.potassium > 0 && p.potassium < 2.0, msg: p => `Serum potassium ${p.potassium} mEq/L is below survivable range — verify entry.` },
    { fields: ['sbp', 'dbp'], bad: p => p.sbp > 260 || p.dbp > 200, msg: p => `Blood pressure ${p.sbp}/${p.dbp} mmHg is outside the recordable range — verify entry.` },
    { fields: ['egfr'], bad: p => p.egfr > 150, msg: p => `eGFR ${p.egfr} mL/min/1.73m² exceeds the physiologic maximum (~120). Verify entry.` },
    { fields: ['pulse'], bad: p => p.pulse > 250 || (p.pulse > 0 && p.pulse < 20), msg: p => `Heart rate ${p.pulse} bpm is outside the physiologic range — verify entry.` },
    { fields: ['creatinine'], bad: p => p.creatinine > 20, msg: p => `Creatinine ${p.creatinine} mg/dL is extreme — confirm units and entry.` },
    { fields: ['oxygen_saturation'], bad: p => typeof p.oxygen_saturation === 'number' && p.oxygen_saturation > 100, msg: p => `Oxygen saturation ${p.oxygen_saturation}% is above 100%. Verify entry.` },
    { fields: ['bmi'], bad: p => p.bmi > 80 || (p.bmi > 0 && p.bmi < 10), msg: p => `BMI ${p.bmi} is outside the physiologic range — verify height/weight entry.` },
];
/**
 * Is the drug contraindicated for a reason other than a kidney value that is not known? A blank or implausible eGFR is read as 0 by the builders, and 0 trips every "eGFR below ..." contraindication,
 * which would silence a potassium alert that depends only on potassium (R5 Y8). With the kidney value unknown the check is made at a normal eGFR: only the other contraindications count.
 */
const NORMAL_EGFR_FOR_UNKNOWN = 90;
export function contraindicatedWithKidneyUnknownIgnored(med: Medication, patient: Patient): boolean {
    if (!med.contraindications) return false;
    return !!med.contraindications(valueUnknown(patient.egfr) ? { ...patient, egfr: NORMAL_EGFR_FOR_UNKNOWN } as Patient : patient);
}
export function validatePhysiologicBounds(patient: Patient): string[] {
    return PHYSIOLOGIC_CHECKS.filter(c => c.bad(patient)).map(c => 'IMPLAUSIBLE VALUE: ' + c.msg(patient));
}
/** The entered fields that the implausible-value rules flag. An alert that reads one of these would be reading a probable typing error (W3). */
export function implausibleFields(patient: Patient): Set<keyof Patient> {
    return new Set(PHYSIOLOGIC_CHECKS.filter(c => c.bad(patient)).flatMap(c => c.fields));
}
/** The patient with every field the implausible-value rules flag read as "not entered" (0): what the builders may read when a probable typing error must not be read as a measurement (W3). */
export function withoutImplausibleValues(patient: Patient): Patient {
    const bad = implausibleFields(patient);
    if (bad.size === 0) return patient;
    const q = { ...patient } as Patient;
    for (const f of bad) (q as unknown as Record<string, number>)[f as string] = 0;
    return q;
}

// Flags regimens the patient ARRIVES on that are themselves unsafe/inappropriate — the
// engine should actively prompt deprescribing, not silently filter these out of output.
export function detectInappropriateRegimen(patient: Patient): string[] {
    const alerts: string[] = [];
    const current = patient.current_regimen || [];
    // Every list of drug names in an alert is sorted, so the wording never depends on the order the drugs were typed in.
    const sortedNames = (rs: RegimenMed[]) => rs.map(r => r.med.name).sort();

    const raasInCurrent = current.filter(r => RAAS_CLASSES.has(r.med.drug_class));
    if (raasInCurrent.length > 1) {
        const arniWithAce = raasInCurrent.some(r => r.med.drug_class === 'ARNI') && raasInCurrent.some(r => r.med.drug_class === 'ACEi');
        alerts.push(`INAPPROPRIATE REGIMEN: Patient is on dual RAAS blockade (${sortedNames(raasInCurrent).join(' + ')}). Deprescribe one agent — the combination raises hyperkalemia, AKI, and hypotension risk without survival benefit (ACC/AHA 2022; ONTARGET).` +
            (arniWithAce ? ' Sacubitril/valsartan with an ACE inhibitor is a labeled contraindication because of the risk of angioedema: ask about swelling of the lips, tongue or throat.' : ''));
    }

    const allMra = current.filter(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA');
    if (allMra.length > 1) {
        alerts.push(`INAPPROPRIATE REGIMEN: Patient is on more than one MRA (${sortedNames(allMra).join(' + ')}). Use a single MRA — combination markedly increases severe hyperkalemia risk with no added benefit.`);
    }

    // Other duplicate same-class-group therapy (two beta-blockers, two SGLT2i, two loop diuretics,
    // etc.) — never appropriate; deprescribe to a single agent. RAAS and MRA are reported above.
    const groupCounts = new Map<string, RegimenMed[]>();
    current.forEach(r => {
        if (drugFacts(r.med).short_course_addon) return; // a short-course add-on beside an oral agent is intended, not a duplicate
        const g = getMedicationClassGroup(r.med.drug_class);
        if (!groupCounts.has(g)) groupCounts.set(g, []);
        groupCounts.get(g)!.push(r);
    });
    [...groupCounts.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).forEach(([group, meds]) => {
        if (meds.length <= 1 || group === 'RAAS Inhibitor' || group === 'MRA') return;
        alerts.push(`INAPPROPRIATE REGIMEN: Patient is on more than one ${group} (${sortedNames(meds).join(' + ')}). Use a single agent in this class — duplicate same-class therapy adds toxicity without added benefit.`);
    });

    // A current med that also appears in the documented DISCONTINUED list (by name) suggests an
    // unintended restart. Surface for verification rather than force-removing — the restart may
    // be deliberate (e.g. a cost-driven stop being retried), and the structured intolerance
    // policy separately force-removes confirmed intolerances via analyzeCurrentRegimen.
    const discontinuedByName = new Map((patient.discontinued_meds || []).map(dm => [dm.name, dm.reason]));
    [...current].sort((a, b) => a.med.name < b.med.name ? -1 : a.med.name > b.med.name ? 1 : 0).forEach(r => {
        const stopReason = discontinuedByName.get(r.med.name);
        if (stopReason) {
            alerts.push(`MEDICATION HISTORY CONFLICT: ${r.med.name} is in the current regimen but is documented as previously discontinued (${stopReason}). Verify the restart is deliberate before continuing it.`);
        }
    });

    const ext = patient.external_medications || new Set<string>();
    const onNonDhpCcb = ext.has('Verapamil') || ext.has('Diltiazem') || patient.comorbidities.has('On Verapamil/Diltiazem');
    if (onNonDhpCcb && patient.lvef > 0 && patient.lvef < 50) {
        alerts.push('INAPPROPRIATE THERAPY: Non-dihydropyridine calcium-channel blocker (verapamil / diltiazem) in HFrEF (LVEF below 50) is potentially harmful — it is a negative inotrope and can worsen heart failure (ACC/AHA 2022, Class III). Deprescribe; if rate control is needed, use a beta-blocker ± digoxin.');
    }

    // External medications that are harmful in heart failure (2026 ESC): NSAIDs / COX-2 inhibitors Class III; thiazolidinediones and saxagliptin contraindicated.
    const harmfulNsaid = NSAID_COX2_EXTERNAL.filter(n => ext.has(n));
    if (harmfulNsaid.length > 0) {
        alerts.push(`AVOID: ${harmfulNsaid.join(', ')} (NSAID / COX-2 inhibitor): Class III in heart failure (2026 ESC) - sodium and fluid retention, blunted diuretic response, kidney injury (worse with RAAS inhibitors or MRAs). Deprescribe; use acetaminophen or topical analgesia where feasible.`);
    }
    const harmfulDiabetic = TZD_SAXAGLIPTIN_EXTERNAL.filter(n => ext.has(n));
    if (harmfulDiabetic.length > 0) {
        alerts.push(`INAPPROPRIATE THERAPY: ${harmfulDiabetic.join(', ')} is contraindicated in heart failure (2026 ESC section 10.2: thiazolidinediones and saxagliptin). Replace it, preferably with an SGLT2 inhibitor.`);
    }

    // Potassium-raising co-medications (list: EXTERNAL_POTASSIUM_RAISERS). A measured potassium of 5.0 or more with one of them is a reason to review it first;
    // a blank potassium is not a value. A potassium supplement with a LOW potassium is appropriate and raises nothing.
    const kRaisers = potassiumRaisersTaken(patient);
    if (kRaisers.length > 0 && !valueUnknown(patient.potassium) && patient.potassium >= POTASSIUM_RAISER_REVIEW_K) {
        alerts.push(`POTASSIUM-RAISING MEDICATION: potassium is ${patient.potassium} mEq/L (${POTASSIUM_RAISER_REVIEW_K} or higher) and the patient takes ${kRaisers.join(', ')}: stop or review ${kRaisers.join(', ')} before adjusting heart failure drugs. Spironolactone and eplerenone labels warn against potassium supplements and potassium-sparing diuretics; trimethoprim causes hyperkalemia, most with RAAS inhibitors.`);
    }
    const sparing = EXTERNAL_POTASSIUM_SPARING_DIURETICS.filter(n => ext.has(n));
    const onMraNow = allMra.length > 0;
    if (sparing.length > 0 && onMraNow) {
        alerts.push(`TWO POTASSIUM-SPARING AGENTS: ${sparing.join(', ')} together with ${sortedNames(allMra).join(' + ')} (an MRA) markedly raises hyperkalemia risk. Stop or review ${sparing.join(', ')}, or the MRA, and check potassium within days (spironolactone and eplerenone labels).`);
    }

    // NT-proBNP above 5000 pg/mL with worsening symptoms or congestion: very high risk, admission generally recommended (2026 ESC section 7.2). Alert only; no ranking effect.
    const congestedNow = weightAboveDryKg(patient) > 1.0 || congestionFindingCount(patient.volume_status.exam_findings) > 0 || patient.nyha_class === 'III' || patient.nyha_class === 'IV';
    if (patient.nt_pro_bnp > 5000 && congestedNow) {
        alerts.push(`VERY HIGH RISK: NT-proBNP ${patient.nt_pro_bnp} pg/mL (above 5000) with worsening symptoms or congestion. The 2026 ESC guideline says this indicates very high risk and admission is generally recommended; assess for admission before outpatient optimization.`);
    }

    if (patient.comorbidities.has('Chronic NSAID Use')) {
        alerts.push('AVOID: Chronic NSAID use is discouraged in heart failure — sodium / fluid retention, blunted diuretic response, and AKI risk (amplified with RAAS / MRA). Deprescribe or substitute acetaminophen / topical analgesia where feasible.');
    }

    // A nitrate (the formulary hydralazine/isosorbide dinitrate or a long-acting nitrate recorded under other medications) with a PDE-5 inhibitor (BiDil, sildenafil and tadalafil labels).
    const onPde5i = PDE5_INHIBITORS.some(n => ext.has(n));
    const nitrates = nitrateNamesTaken(patient);
    if (onPde5i && nitrates.length > 0) {
        const taken = PDE5_INHIBITORS.filter(n => ext.has(n));
        alerts.push(`INAPPROPRIATE THERAPY: Nitrate (${nitrates.join(', ')}) with a PDE5 inhibitor (${taken.join(', ')}) is an absolute contraindication — risk of profound or fatal hypotension (FDA label). ` +
            (current.some(r => r.med.drug_class === 'Vasodilator') ? 'The formulary nitrate has been removed from all recommendations; stop' : 'Stop') + ' one of the two agents now and obtain urgent prescribing review.'); // R13 E5(e): "Stop" begins its sentence when no clause precedes it
    }
    // Digoxin in atrial fibrillation with an accessory pathway (Lanoxin label warning 5.1): a new start is held (the drug's own check); one already taken raises this alert.
    if (digoxinAfibAccessoryPathway(patient) && current.some(r => r.med.drug_class === 'Inotrope')) {
        alerts.push('DIGOXIN WITH AN ACCESSORY PATHWAY: the patient is in atrial fibrillation, the accessory-pathway box is ticked and digoxin is taken. The Lanoxin label warns that digoxin can speed conduction over the pathway and cause ventricular fibrillation. Review urgently with a specialist; the tool does not change the dose.');
    }

    // Over-diuresis: euvolemic patient maintained on a high-dose loop diuretic. The loop should be
    // down-titrated to the lowest effective dose to avoid hypovolemia and prerenal AKI — especially
    // when an SGLT2i is being added (additive diuresis). (Volume DEPLETION below dry weight is
    // handled separately by the volume-depletion alert.)
    const fluidExcess = weightAboveDryKg(patient);
    const euvolemic = Math.abs(fluidExcess) <= 1.0 && congestionFindingCount(patient.volume_status.exam_findings) === 0;
    // A short-course add-on (Furoscix) is not the oral loop the alert is about; the first qualifying loop in drug-name order is named, whatever the typing order.
    const highDoseLoop = sortedByName(current).find(r => {
        if (drugFacts(r.med).short_course_addon) return false;
        const t = drugFacts(r.med).high_dose_threshold;
        // facts.high_dose_threshold is a TOTAL DAILY dose (strength x doses per day), not the per-dose strength.
        return r.med.drug_class === 'Loop Diuretic' && t !== undefined && dailyDose(r) >= t;
    });
    // Chronic-use review (facts.chronic_use_review, e.g. a thiazide-type diuretic): a stable euvolemic patient on it gets a prompt to review, never a forced removal.
    // At potassium 6.0 or above no diuretic reduction is proposed (diuretics lower potassium), so neither prompt is shown beside the potassium emergency (T1).
    const potassiumEmergency = patient.potassium >= 6.0;
    if (euvolemic && patient.nyha_class !== 'IV' && !potassiumEmergency) {
        [...current].sort((a, b) => a.med.name < b.med.name ? -1 : a.med.name > b.med.name ? 1 : 0).forEach(r => {
            const note = drugFacts(r.med).chronic_use_review;
            if (note) alerts.push(`DIURETIC REVIEW: ${r.med.name} in a stable euvolemic patient. ${note}`);
        });
    }
    if (euvolemic && highDoseLoop && !potassiumEmergency) {
        alerts.push(`LOOP DIURETIC OVER-TREATMENT: Patient appears euvolemic on a high-dose loop diuretic (${highDoseLoop.med.name} ${highDoseLoop.dose.strength}${highDoseLoop.dose.unit} ${highDoseLoop.selected_frequency} = ${dailyDose(highDoseLoop)} ${highDoseLoop.dose.unit}/day). Down-titrate to the lowest effective dose to avoid over-diuresis, hypovolemia, and prerenal AKI — particularly when initiating an SGLT2i (additive natriuresis).`);
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

/** The alert for a drug entered more than once (the higher dose kept; U5: the more cautious use record kept, said so). One sentence builder for the two places that resolve duplicates. */
export function duplicateEntryAlert(d: { duplicateNames: string[]; kept: string[]; useNotes: string[] }): string {
    return `INPUT SAFETY: Duplicate current medications removed (${[...d.duplicateNames].sort().join(', ')}). ` +
        `Where the two entries had different doses the higher one was kept (${[...d.kept].sort().join('; ') || 'same dose'}): confirm which dose the patient takes. ` +
        (d.useNotes.length > 0 ? `Use records: ${[...d.useNotes].sort().join('. ')}. Confirm whether the patient takes it. ` : '') +
        'Duplicate entries can double-count hemodynamic effects.';
}

/**
 * Stage 1 - audit inputs: remove duplicate current meds, flag missing critical data and
 * inappropriate arriving regimens, and hard-stop on implausible values / unknown LVEF / SBP <= DBP.
 * Mutates `patient.current_regimen` (the caller's clone) when duplicates are removed.
 */
export function auditInputs(patient: Patient, clinicalAlerts: string[]): InputAudit {
    // A blank numeric field reaches the engine as 0 from the form, but as NaN or undefined from other callers (a cleared field, a fixture, an import).
    // The gates are written as `value < limit`, which is FALSE for NaN: an unreadable eGFR or pulse would pass every limit as if normal. One sentinel only: 0.
    const blankToZero = (v: number | undefined): number => (v === undefined || v === null || Number.isNaN(v) || v < 0 ? 0 : v);
    patient.sbp = blankToZero(patient.sbp); patient.dbp = blankToZero(patient.dbp); patient.pulse = blankToZero(patient.pulse);
    // Potassium is read to ONE decimal everywhere (thresholds 5.0 / 5.2 / 5.5 / 6.0 / 6.5 and every message): 5.96 was shown as "6.0" but ruled as 5.5-5.9.
    patient.potassium = Math.round(blankToZero(patient.potassium) * 10) / 10; patient.egfr = blankToZero(patient.egfr); patient.creatinine = blankToZero(patient.creatinine);
    patient.lvef = blankToZero(patient.lvef); patient.nt_pro_bnp = blankToZero(patient.nt_pro_bnp); patient.bun = blankToZero(patient.bun);
    patient.volume_status.dry_weight_kg = blankToZero(patient.volume_status.dry_weight_kg);
    patient.volume_status.current_weight_kg = blankToZero(patient.volume_status.current_weight_kg);

    // Allergy text is free text: resolve it to formulary drugs (case, brand names, class names) so every allergy check sees them, and say so when an entry
    // matches nothing instead of silently excluding no drug (allergy.ts).
    const allergy = expandAllergies(patient.allergies ?? new Set<string>(), MEDICATION_FORMULARY);
    patient.allergies = allergy.expanded;
    allergy.readAs.forEach(r => clinicalAlerts.push(`ALLERGY NOTE: "${r.entry}" ${r.text}.`));
    if (allergy.unmatched.length > 0) {
        clinicalAlerts.push(`ALLERGY NOTE: ${allergy.unmatched.map(a => `"${a}"`).join(', ')} ${allergy.unmatched.length > 1 ? 'do' : 'does'} not match a drug or drug class in this tool, so no drug is excluded for ${allergy.unmatched.length > 1 ? 'them' : 'it'}. If it is one of the tool's medications, enter its generic or brand name.`);
    }

    const dedupedCurrent = dedupeCurrentRegimen(patient.current_regimen || []);
    if (dedupedCurrent.duplicateNames.length > 0) {
        patient.current_regimen = dedupedCurrent.regimen;
        clinicalAlerts.push(duplicateEntryAlert(dedupedCurrent));
    }

    // --- Real-world robustness: audit incomplete data and inappropriate arriving regimens ---
    const dataAudit = auditCriticalData(patient);
    const stopped = (stop: SimulationOutput): InputAudit => ({ dataAudit, gdmtGaps: [], missingDataNotices: [], stop });
    clinicalAlerts.push(...dataAudit.alerts);
    const implausibleValueAlerts = validatePhysiologicBounds(patient);
    clinicalAlerts.push(...implausibleValueAlerts);
    // A value that is a probable typing error is never read as a measurement by the other builders (W3).
    clinicalAlerts.push(...detectInappropriateRegimen(implausibleValueAlerts.length > 0 ? withoutImplausibleValues(patient) : patient));

    // Physiologically-impossible inputs are data-entry errors (unit confusion, transcription
    // slips). Every downstream decision — phenotype, contraindications, projections — would be
    // computed on garbage, so this is a hard stop, not a flag-and-proceed. (e.g. LVEF 99 would
    // otherwise classify as HFpEF and drive a confident SGLT2i pathway off a typo.)
    if (implausibleValueAlerts.length > 0) {
        return stopped({ scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: [], gdmtGaps: [], missingDataNotices: buildMissingDataNotices(patient), followUpCalendar: [] });
    }

    // Blood pressure and weight are read by every projection and gate: without them nothing can be assessed. Say WHICH field is blank instead of ending
    // at a generic "no display-safe regimen" (a cleared dry weight used to read as tens of kilograms of congestion).
    const blankVitals = [
        valueUnknown(patient.sbp) ? 'systolic blood pressure' : '',
        valueUnknown(patient.volume_status.current_weight_kg) ? 'current weight' : '',
        valueUnknown(patient.volume_status.dry_weight_kg) ? 'dry weight' : '',
    ].filter(Boolean);
    if (blankVitals.length > 0) {
        clinicalAlerts.push(`DATA REQUIRED: ${blankVitals.join(', ')} not entered. No recommendation is made without ${blankVitals.length > 1 ? 'them' : 'it'}.`);
        return stopped({ scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: [], gdmtGaps: [], missingDataNotices: buildMissingDataNotices(patient), followUpCalendar: [] });
    }

    // LVEF is the axis the entire phenotype/pathway selection turns on. Without it the tool
    // cannot pick HFrEF vs HFpEF — fail safe with alerts only rather than guessing.
    if (dataAudit.unknownLvef) {
        return stopped({ scoredRegimens: [], excludedMedications: taggedDiscontinuedMeds(patient), clinicalAlerts, monitoringPlan: [], gdmtGaps: [], missingDataNotices: buildMissingDataNotices(patient), followUpCalendar: [] });
    }

    // Deterministic, guideline-anchored categorical outputs — independent of scoring.
    const gdmtGaps = computeGdmtGaps(patient);
    const missingDataNotices = buildMissingDataNotices(patient);

    if (patient.sbp <= patient.dbp) {
        clinicalAlerts.push(
            'INPUT ERROR: Systolic BP must be greater than diastolic BP (SBP > DBP). ' +
            'Correct the blood pressure values and run the review again.'
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

/** The blood-pressure-lowering drugs the patient takes, heart failure and other (S14), each list sorted. */
function bloodPressureDrugNames(patient: Patient): { hf: string[]; other: string[] } {
    const hfClasses = new Set(['ACEi', 'ARB', 'ARNI', 'Beta Blocker', 'MRA', 'nsMRA', 'Loop Diuretic', 'Thiazide-like Diuretic', 'Vasodilator', 'sGC Stimulator', 'SGLT2i']);
    const hf = (patient.current_regimen ?? []).filter(r => hfClasses.has(r.med.drug_class)).map(r => r.med.name).sort();
    const otherList = ['Verapamil', 'Diltiazem', ...LONG_ACTING_NITRATES, ...PDE5_INHIBITORS];
    const other = otherList.filter(n => patient.external_medications?.has(n)).sort();
    return { hf, other };
}

/**
 * Stage 2 - raise the alert-only gates (pregnancy, low output, hypotension, hyperkalemic emergency,
 * advanced-HF / device / rehab referrals, volume depletion, severe CKD, HFimpEF status, vericiguat
 * documentation). These add alerts; they never remove drugs by themselves.
 */
export function raiseClinicalAlerts(patient: Patient, dataAudit: CriticalDataAudit, clinicalAlerts: string[]): ClinicalFlags {
    // --- S1: unstable states lead the alert list (cold, acute decompensation) ---
    clinicalAlerts.unshift(...unstableStateAlerts(patient));
    clinicalAlerts.push(...classFindingsDisagreeAlerts(patient));
    // A recorded saturation below 90% is a top-level urgent alert on every path (W1), not only a line inside each option's warnings.
    clinicalAlerts.push(...hypoxiaAlerts(patient));

    // --- S4: Pregnancy safety alert ---
    if (patient.is_pregnant === true) {
        clinicalAlerts.push('PREGNANCY ALERT: ACE inhibitors, ARBs, ARNI (RAAS inhibitors: fetotoxicity) and MRAs (spironolactone, eplerenone, finerenone) are contraindicated. SGLT2 inhibitors, ivabradine and vericiguat are not recommended (paucity of safety data; vericiguat carries an FDA boxed warning for embryo-fetal toxicity). GLP-1 therapy is excluded. These agents have been excluded from all recommendations. Hydralazine plus a nitrate and loop diuretics (only with congestion) remain available; beta-1-selective beta-blockers (metoprolol, bisoprolol) are the choice. Sources: 2026 ESC heart failure guideline (primary; RAAS inhibitors, MRAs, ivabradine and SGLT2 inhibitors not recommended, Class III C) and a peer-reviewed peripartum cardiomyopathy review (Heart Fail Rev 2024, secondary). ' + BREASTFEEDING_NOT_ASSESSED);
        // A non-selective beta-blocker the patient already takes: not stopped abruptly; a switch to a beta-1-selective agent is offered (analyzeCurrentRegimen).
        (patient.current_regimen || []).filter(r => r.med.drug_class === 'Beta Blocker' && !drugFacts(r.med).beta1_selective).forEach(r => {
            clinicalAlerts.push(`PREGNANCY: ${r.med.name} is non-selective. The 2026 ESC heart failure guideline (Class I, level C) says to switch non-selective beta-blockers to beta-1-selective ones (metoprolol, bisoprolol) in pregnancy; a switch is offered. Do not stop the beta-blocker abruptly.`);
        });
    }
    // Pregnancy status is required below the childbearing-potential age (S12). When it is not recorded and the patient already takes a pregnancy-restricted drug, say so by name.
    if (pregnancyStatusRequired(patient) && patient.is_pregnant === undefined) {
        const taken = (patient.current_regimen ?? []).filter(r => isPregnancyRestricted(r.med)).map(r => r.med.name).sort();
        if (taken.length > 0) {
            clinicalAlerts.push(`PREGNANCY STATUS NOT RECORDED: pregnancy status is not recorded for this woman of childbearing age, and she takes ${taken.join(', ')}, which ${taken.length > 1 ? 'are' : 'is'} restricted in pregnancy. Record whether she is pregnant; starts of pregnancy-restricted drugs stay withheld until then. ${BREASTFEEDING_NOT_ASSESSED}`);
        }
    }

    // --- S4: heart block without a pacemaker ---
    clinicalAlerts.push(...conductionAlerts(patient));

    // --- A beta-blocker START is deferred in acute decompensation (candidates.ts drops the pillar): say so. Before 2026-11-12 the beta-blocker was simply
    // absent from every option with no alert, no withheld-drug entry and no reason on the gap (review 3).
    if (isAcutelyDecompensated(patient) && patient.lvef > 0 && patient.lvef < 50 && !(patient.current_regimen || []).some(r => r.med.drug_class === 'Beta Blocker')) {
        const why = patient.nyha_class === 'IV' ? 'NYHA class IV' : 'NYHA class III with more than 2 kg above dry weight and at least two congestion findings';
        clinicalAlerts.push(`BETA-BLOCKER START DEFERRED: ${why} is treated as acute decompensation, so no beta-blocker is started in any option (2022 AHA/ACC/HFSA: do not start during decompensation; 2026 ESC Supplementary Table S6: seek specialist advice in NYHA IV or a recent exacerbation, achieve euvolemia first). Start at a low dose once the patient is stable and decongested.`);
    }

    // --- Heart-rate rule on an established beta-blocker / ivabradine (facts.hr_continuation): the dose is reduced one step,
    // not stopped; the alert names the heart rate and the action. (Candidate generation applies the reduction.)
    sortedByName(patient.current_regimen || []).forEach(r => {
        const hr = hrContinuationAction(r.med, patient);
        if (!hr?.reduce) return;
        if (r.med.contraindications?.(patient)) return; // already being removed for a contraindication (AV block, sick sinus); that reason is stated instead
        const atLowest = r.med.available_doses.findIndex(d => d.strength === r.dose.strength) <= 0;
        clinicalAlerts.push(
            `BRADYCARDIA ON ${r.med.name.toUpperCase()}: resting heart rate ${patient.pulse} bpm on ${r.med.name} ${r.dose.strength}${r.dose.unit}. ` +
            (atLowest
                ? `The dose is already the lowest, so the plan withholds it (for a beta-blocker, taper over 1-2 weeks; do not stop abruptly). `
                : `The plan reduces it one dose step; it is not removed. `) +
            `Basis: ${hr.basis}. ESC advises lowering the dose when the rate is below 50 with worsening symptoms; this tool applies the reduction on heart rate alone, so confirm symptoms and exclude heart block with an ECG; review digoxin, ivabradine and amiodarone. No up-titration while the rate is low (below 60 is a rule set by this tool).`
        );
    });

    // --- A slow resting rate with no rate-slowing drug on board needs its own prompt (conduction disease, other causes), not a stray warning on every option (S13).
    clinicalAlerts.push(...slowHeartRateAlerts(patient));

    // --- Potassium hold on INCREASING an MRA the patient already takes (facts.k_uptitration_max): no up-titration candidate is offered; say why.
    // At K+ >= the continuation reduce level the reduction/withhold reason is stated instead.
    sortedByName(patient.current_regimen || []).forEach(r => {
        const hold = kUptitrationBlock(r.med, patient);
        if (!hold || kContinuationAction(r.med, patient) || contraindicatedWithKidneyUnknownIgnored(r.med, patient)) return;
        clinicalAlerts.push(
            `POTASSIUM HOLD ON ${r.med.name.toUpperCase()}: ${hold.reason}. ${r.med.name} ${r.dose.strength}${r.dose.unit} stays at the current dose; ` +
            `recheck potassium before any increase${(r.med.drug_class === 'ACEi' || r.med.drug_class === 'ARB') && patient.potassium > RAAS_START_K_CAUTION && !(patient.allergies?.has(r.med.name)) ? `, and before any switch to sacubitril/valsartan (a switch is held at the same potassium)` : ''}. Basis: ${hold.basis}.`
        );
    });

    // --- Potassium rule on a drug the patient already takes (facts.k_continuation.first_steps): say what to do first.
    // At potassium 6.0 or above the interval is the emergency one (repeat urgently, ECG), never the 1-2 week recheck of the 5.5-5.9 band (S3).
    sortedByName(patient.current_regimen || []).forEach(r => {
        const rule = r.med.facts?.k_continuation;
        const act = kContinuationAction(r.med, patient);
        if (!rule?.first_steps || !act || contraindicatedWithKidneyUnknownIgnored(r.med, patient) && act.action !== 'withhold') return;
        const steps = patient.potassium >= 6.0
            ? rule.first_steps.replace(/then recheck potassium and kidney function in 1-2 weeks \([^)]*\)\./, 'then repeat potassium urgently and obtain an ECG (see the potassium emergency alert).')
            : rule.first_steps;
        const stepsFinal = patient.potassium >= 6.0 ? steps.replace('Recheck potassium and kidney function in 1-2 weeks and look for other causes first', 'Repeat potassium urgently and obtain an ECG (see the potassium emergency alert), and look for other causes first') : steps;
        clinicalAlerts.push(`POTASSIUM ${act.action === 'withhold' ? 'STOP' : 'REDUCE'} ON ${r.med.name.toUpperCase()}: ${act.reason}. ${stepsFinal}`);
    });

    // --- A drug already on board that the kidney limit removes (S8): say so, with the number. ---
    sortedByName(patient.current_regimen ?? []).forEach(r => {
        const why = renalContraindicationReason(r.med, patient);
        if (why) clinicalAlerts.push(`DRUG REMOVED FOR KIDNEY FUNCTION: ${r.med.name} is removed in the options because of ${why}. If kidney function has been stable at this level and the drug is established, continuing it is a clinician decision; the tool applies this limit to every patient.`);
    });

    // --- eGFR below 20 on a RAAS inhibitor: an alert, not a stop (2026 ESC Table S4 describes a FALL from baseline; the tool has no baseline). ---
    // With the optional baseline creatinine entered, the change is computed and the rules below are enforced (renalChange.ts); without it the alert says the tool cannot tell.
    const onRaasOrMra = (patient.current_regimen ?? []).filter(r => RAAS_CLASSES.has(r.med.drug_class) || MRA_POOL_CLASSES.has(r.med.drug_class));
    const creatinineChange = assessCreatinineChange(patient);
    const egfrBelow20OnRaas = patient.egfr > 0 && patient.egfr < RAAS_EGFR_REVIEW_BELOW && (patient.current_regimen ?? []).some(r => RAAS_CLASSES.has(r.med.drug_class));
    const kidneyFirstSteps = 'First steps: check volume status (dehydration, over-diuresis), stop NSAIDs and other nephrotoxins, review the diuretic dose.';
    if (creatinineChange && creatinineChange.band === 'stop') {
        clinicalAlerts.push(
            `KIDNEY FUNCTION: ${creatinineChange.summary}. This meets the 2026 ESC criteria to stop the ACE inhibitor/ARB/ARNI and withhold the MRA (Supplementary Tables S4/S5/S8): seek specialist advice. ` +
            `${onRaasOrMra.length > 0 ? 'The tool removes them from the plan and does not start a new one. ' : 'No RAAS inhibitor or MRA is started. '}${kidneyFirstSteps} Restart is a specialist decision.`
        );
    } else if (creatinineChange && creatinineChange.band === 'reduce') {
        clinicalAlerts.push(
            `KIDNEY FUNCTION: ${creatinineChange.summary}. ${reduceCriterionSentence(creatinineChange)} The 2026 ESC criteria call for halving the RAAS inhibitor and the MRA (Supplementary Tables S4/S5/S8; main text 6.1.6). ` +
            `${onRaasOrMra.length > 0 ? 'Each is reduced one dose step (a drug already at the lowest dose is kept, not increased), recheck chemistry in 1-2 weeks, no up-titration until stable. ' : 'Recheck chemistry in 1-2 weeks before any start. '}${kidneyFirstSteps}`
        );
    } else if (creatinineChange && creatinineRiseIsAcceptable(creatinineChange, patient.egfr)
        && (onRaasOrMra.length > 0 || (patient.current_regimen ?? []).some(r => r.med.drug_class === 'SGLT2i'))) {
        clinicalAlerts.push(
            `KIDNEY FUNCTION: ${creatinineChange.summary}. This is within the 2026 ESC acceptable range (creatinine rise under ${CREATININE_RISE_ACCEPTABLE_PCT}%, derived eGFR fall of 30% or less, eGFR 20 or higher); an early dip after starting or raising a RAAS inhibitor, MRA or SGLT2 inhibitor should not prompt stopping. Recheck chemistry in 1-2 weeks.`
        );
    }
    if (egfrBelow20OnRaas) {
        if (!creatinineChange) {
            clinicalAlerts.push(
                'LOW KIDNEY FUNCTION ON A RAAS INHIBITOR: The eGFR is below 20 on a RAAS inhibitor. If this is a new fall (or creatinine has more than doubled), the 2026 ESC guideline advises stopping it and seeking specialist advice; ' +
                'if kidney function is stable at this level, continue with close monitoring. The tool has no baseline value and cannot tell these apart.'
            );
        } else if (creatinineChange.band === 'none') {
            clinicalAlerts.push(
                `LOW KIDNEY FUNCTION ON A RAAS INHIBITOR: The eGFR is below 20 on a RAAS inhibitor, with ${creatinineChange.summary}. This is not a new fall from baseline, so the 2026 ESC stop criterion is not met; continue with close monitoring` +
                `${patient.egfr < EGFR_FLOOR_FOR_CREATININE_RISE ? ` (eGFR below ${EGFR_FLOOR_FOR_CREATININE_RISE}: ESC allows temporary discontinuation in acute kidney injury; seek specialist advice)` : ''}.`
            );
        }
    }

    // --- S2: Hemodynamic instability — block pharmacologic optimization ---
    // Threshold raised to SBP < 90 (MAP ~65 mmHg): oral GDMT initiation requires adequate perfusion
    const lowOutput = isLowOutputState(patient);
    if (lowOutput) {
        clinicalAlerts.push(
            'LOW OUTPUT STATE: LVEF < 20% with hypoperfusion markers (cool extremities, narrow pulse pressure, or pre-renal azotemia). ' +
            'Consider inotropic support and Advanced HF consultation before oral GDMT initiation.'
        );
    }

    // A blank systolic pressure is the 0 sentinel, never a measured 0 (R5 Y1): this alert needs an entered value. A systolic pressure not above the diastolic is an input error (the pair is unusable): no
    // hemodynamic alert is built on it (R5 Y7).
    if (patient.sbp > 0 && patient.sbp < HYPOTENSION_SBP_BELOW && !(patient.dbp > 0 && patient.sbp <= patient.dbp)) {
        const { hf, other } = bloodPressureDrugNames(patient);
        const drugs = hf.length + other.length > 0
            ? ` (${[hf.length ? `heart failure drugs: ${hf.join(', ')}` : '', other.length ? `other: ${other.join(', ')}` : ''].filter(Boolean).join('; ')}; also any blood-pressure medicine not recorded here)`
            : ' (including any not recorded here)';
        clinicalAlerts.push(
            `HEMODYNAMIC INSTABILITY: systolic blood pressure is ${patient.sbp} mmHg, below ${HYPOTENSION_SBP_BELOW}. No medication option is proposed at this pressure. ` +
            'Assess for symptoms and signs of poor perfusion (dizziness, fainting, confusion, cool extremities, low urine output). If any are present this is an emergency: arrange urgent evaluation. ' +
            `If none are present, review the blood-pressure-lowering drugs the patient takes${drugs} and recheck the pressure.`
        );
    }

    // --- S2b: Hyperkalemic emergency — baseline K+ 6.0-8.0 (values > 8.0 already hard-stop as
    // implausible/extreme in validatePhysiologicBounds). A medical emergency requiring ECG and
    // urgent treatment, not outpatient regimen optimization. For K+ >= 6.5 the engine returns
    // alerts only (parallel to the SBP < 90 gate below); for 6.0-6.4 it alerts and proceeds —
    // deprescribing the offending agent with binder rescue is still clinically useful there.
    // Sources and honesty (verified-clinical-decisions-2026-11-11.md rows 5b, 7, 8): a secondary review (Heart Fail Rev 2021) classes
    // K+ > 6.0 as severe and advises stopping or reducing RAAS therapy; a secondary ESC-derived consensus says withhold an MRA above 6.0.
    // The KDIGO severity scheme (5.0-5.9 / 6.0-6.4 / >= 6.5) could NOT be verified, so the 6.0 alert and the 6.5 alerts-only stop are ENGINE
    // POLICY. At 6.0-6.4 no candidate starts or increases a RAAS inhibitor or MRA (RAAS new start blocked above 5.4 and a current RAAS inhibitor stopped
    // at 6.0, 2026 ESC section 6.1; MRA new start above 5.5 and withheld at 6.0 by facts.k_continuation) - verify scenarios "Hyperkalemia 6.0 / 6.2 / 6.4".
    // S3 (2026-11-19): while this alert is shown no option starts or raises ANY drug (candidates.ts, `potassiumEmergencyAllows`).
    const hyperkalemicEmergency = patient.potassium >= 6.0 && patient.potassium <= 8.0;
    if (hyperkalemicEmergency) {
        clinicalAlerts.push(
            'HYPERKALEMIC EMERGENCY: Serum K+ ' + patient.potassium.toFixed(1) + ' mEq/L (≥ 6.0). ' +
            'Obtain an ECG now and repeat the potassium urgently, then treat urgently — IV calcium if ECG changes, insulin/glucose, ' +
            'K+ binder or dialysis — before oral GDMT optimization. No RAAS inhibitor or MRA is started or increased, and those already in use are withheld until potassium is controlled (2026 ESC section 6.1). ' +
            OPTION_PHRASES.potassium + ' ' +
            'A secondary source (Heart Fail Rev 2021) classes potassium above 6.0 as severe hyperkalemia; the tool\'s 6.0 alert and its alerts-only stop at 6.5 are a rule set by this tool (the severity classification could not be verified from a primary source).'
        );
    }

    // --- S3: Advanced HF referral (2026 ESC Recommendation Table 11, Tables 14-15): early consultation with an advanced HF centre is Class I for patients with or at risk of
    // advanced HF ("I NEED HELP" markers, any one; "rule of three"). ALERT ONLY, no ranking effect. Only markers the tool can see are tested; the others are named as "check".
    // Numeric cut-offs are marked: NT-proBNP 4000 is the engine's longstanding advanced-HF value (previously NYHA IV only, now NYHA III-IV; persistence on treatment is not visible),
    // pulse above 100 is the conventional tachycardia cut-off (engine policy; no source number). SBP below 90 is the engine's hypotension gate.
    const advancedMarkers: string[] = [];
    if (lowOutput) advancedMarkers.push('low-output state (LVEF below 20 with hypoperfusion markers)');
    if (patient.lvef > 0 && patient.lvef < 20) advancedMarkers.push(`LVEF ${patient.lvef}% (below 20)`);
    if ((patient.nyha_class === 'III' || patient.nyha_class === 'IV') && patient.nt_pro_bnp > 4000) advancedMarkers.push(`NYHA ${patient.nyha_class} with NT-proBNP ${patient.nt_pro_bnp} pg/mL (high; persistence on treatment is not visible to the tool)`);
    if (patient.sbp > 0 && patient.sbp < HYPOTENSION_SBP_BELOW && patient.pulse > 100) advancedMarkers.push(`low blood pressure (${patient.sbp}) with a high heart rate (${patient.pulse})`);
    // Every oral loop at its high dose is named, sorted by name: the marker never depends on typing order, and a short-course add-on (Furoscix) cannot set it (isLoopDiureticResistant).
    const loopsResistantNow = (patient.current_regimen ?? []).filter(r => isLoopDiureticResistant(patient, r)).sort((a, b) => a.med.name < b.med.name ? -1 : a.med.name > b.med.name ? 1 : 0);
    if (loopsResistantNow.length > 0) advancedMarkers.push(`diuretic resistance (congested on ${loopsResistantNow.map(r => `${r.med.name} ${dailyDose(r)} mg/day`).join(' and ')}, its high-dose level)`);
    const foundationalClasses = new Set([...RAAS_CLASSES, ...MRA_POOL_CLASSES, 'Beta Blocker', 'SGLT2i']);
    const foundationalIntolerance = patient.discontinued_meds.filter(m => foundationalClasses.has(m.drug_class));
    if (foundationalIntolerance.length > 0) advancedMarkers.push(`documented stop or intolerance of foundational therapy (${foundationalIntolerance.map(m => m.name).sort().join(', ')})`);
    const advancedHFCriteria = advancedMarkers.length > 0;
    // The pre-2026-11-11 severe criteria (INTERMACS-style); still the only ones that suppress the cardiac-rehabilitation prompt.
    const severeAdvancedHF = lowOutput || (patient.lvef <= 20 && patient.sbp < 90) || (patient.nyha_class === 'IV' && patient.nt_pro_bnp > 4000);
    if (advancedHFCriteria) {
        clinicalAlerts.push(
            'ADVANCED HEART FAILURE ALERT: early consultation with an advanced heart failure centre is Class I for patients with or at risk of advanced HF (2026 ESC Recommendation Table 11; "I NEED HELP" markers, any one is enough). ' +
            `Markers present: ${advancedMarkers.join('; ')}. ` +
            'The tool cannot see hospitalizations in the past year (two or more, or one needing inotropes, is a "rule of three" trigger; the form records only whether a recent worsening event occurred), inotrope use, end-organ dysfunction, defibrillator shocks or right-ventricular function: check them. ' +
            'Consider IV inotropic support, mechanical circulatory support (LVAD), transplant evaluation and a palliative care discussion; device assessment is in the device alert when LVEF is 35 or below.'
        );
    }

    // --- D4: ICD / CRT screening (2026 ESC Recommendation Tables 6 and 7). ALERT ONLY. The form has no QRS duration, LBBB morphology, aetiology or myocardial-infarction date, so the
    // alert asks the clinician to check them; 'Coronary Artery Disease' is shown as the only (imperfect) ischaemic marker the form holds.
    const icdCrtEligible = patient.lvef > 0 && patient.lvef <= 35 &&
        (patient.nyha_class === 'II' || patient.nyha_class === 'III' || patient.nyha_class === 'IV');
    // (not suppressed by the advanced-HF referral: a different topic, and candidacy for CRT/LVAD/transplant decides whether an ICD is appropriate in NYHA IV)
    if (icdCrtEligible) {
        const cad = patient.comorbidities.has('Coronary Artery Disease');
        const gaps = computeGdmtGaps(patient);
        clinicalAlerts.push(
            `DEVICE THERAPY SCREENING: LVEF ${patient.lvef}% (35 or below) with NYHA Class ${patient.nyha_class}. ` +
            (patient.nyha_class === 'IV'
                ? 'An ICD is not recommended in NYHA IV refractory to drugs unless the patient is a candidate for CRT, LVAD or transplant (2026 ESC Recommendation Table 6). '
                : 'ICD for primary prevention (NYHA II-III, expected survival over 1 year) is considered only after at least 3 months of optimal foundational therapy' +
                  (gaps.length > 0 ? ` (not yet complete here: ${gaps.map(g => (/^[A-Z]{2,}/.test(g) ? g : g.charAt(0).toLowerCase() + g.slice(1))).join(', ')}); ` : '; ') +
                  `Class I (B1) if the cardiomyopathy is ischaemic (not within 40 days of a myocardial infarction), Class IIa (B1) if non-ischaemic. Coronary artery disease is ${cad ? '' : 'not '}recorded; aetiology and infarction date are not captured: check them. `) +
            (patient.rhythm === 'Sinus'
                ? 'CRT (sinus rhythm, symptomatic on optimal therapy): LBBB with QRS 150 ms or more Class I; LBBB 130-149 ms IIa; non-LBBB 150 ms or more IIa; non-LBBB 130-149 ms IIb; QRS below 130 ms not recommended without a pacing indication (2026 ESC Recommendation Table 7). '
                : `CRT recommendations assume sinus rhythm; the recorded rhythm is ${patient.rhythm}, so specialist review is needed. `) +
            'QRS duration and LBBB morphology are not captured by this tool: check the ECG. Refer to electrophysiology if not already assessed.'
        );
    }

    // --- AF: anticoagulation and rate control (2026 ESC Recommendation Table 15). ALERT ONLY; one alert. The tool does not compute CHA2DS2-VA and the form has no anticoagulant
    // field (the external-medication list holds none), so both are left to the clinician.
    if (hasAtrialFibrillationHistory(patient)) {
        const hfref = patient.lvef > 0 && patient.lvef < 50;
        const onBb = (patient.current_regimen ?? []).some(r => r.med.drug_class === 'Beta Blocker');
        const onDigoxin = (patient.current_regimen ?? []).some(r => r.med.drug_class === 'Inotrope');
        // R5 Y6: the rate-control paragraph suggests starting or adding a drug (a beta-blocker, digoxin). It is for atrial fibrillation as TODAY's rhythm (not a paced rhythm, not sinus rhythm with a history of it:
        // the anticoagulation sentence stays for the history) and never in a state where no drug is started: systolic pressure below the limit, potassium 6.0 or above (the stop and the emergency).
        const noDrugState = (patient.sbp > 0 && patient.sbp < HYPOTENSION_SBP_BELOW) || (patient.potassium >= 6.0 && patient.potassium <= 8.0);
        clinicalAlerts.push(
            'ATRIAL FIBRILLATION: oral anticoagulation is Class I, chosen by the CHA2DS2-VA score; a DOAC is preferred over warfarin except with a mechanical valve or moderate-severe mitral stenosis (2026 ESC Recommendation Table 15). ' +
            'The tool does not compute the score and has no anticoagulant field: confirm one is prescribed. ' +
            // W7c: the patient is not called stable unless the engine's own states say so; a recorded resting rate above the lenient target is stated, with the sentence that rate control needs assessment.
            (patient.rhythm === 'AFib' && patient.pulse > AF_RESTING_RATE_LENIENT_TARGET ? `The recorded resting heart rate is ${patient.pulse} bpm, above the lenient target of ${AF_RESTING_RATE_LENIENT_TARGET} bpm for atrial fibrillation (RACE II, Van Gelder, NEJM 2010; used by the 2022 US and 2026 ESC guidelines): rate control needs assessment. ` : '') +
            // X2: with a scope condition ticked the tool does not judge therapy, but anticoagulation for atrial fibrillation is not heart failure therapy: the alert keeps the anticoagulation sentence and the rate statement only.
            (hfref && patient.rhythm === 'AFib' && !noDrugState && scopeStatusFor(patient).state !== 'outside' ? `Rate control: a beta-blocker is first line in HFrEF with AF once the patient is stable (Class I C)${onBb ? '' : ' and none is on board'}${isAcutelyDecompensated(patient) || isColdState(patient) ? '. By the tool\'s own definition this patient is not stable now (acute decompensation or poor perfusion), so rate control waits for stabilization' : ''}${onDigoxin ? '; digoxin is already taken (Class IIa C when the rate stays high despite a beta-blocker or when it is not tolerated): review its dose and level.' : patient.pulse > AF_RESTING_RATE_LENIENT_TARGET ? '; digoxin should be considered when the rate stays high despite a beta-blocker or when it is not tolerated (Class IIa C).' : '.'}` : '')
        );
    }

    // --- D5: Cardiac rehabilitation referral (ACC/AHA 2022 §7.3.4, Class I) ---
    const cardiacRehabEligible = patient.lvef <= 40 &&
        (patient.nyha_class === 'II' || patient.nyha_class === 'III') &&
        patient.sbp >= 90 && !severeAdvancedHF;
    if (cardiacRehabEligible) {
        clinicalAlerts.push(
            'CARDIAC REHABILITATION: HFrEF with NYHA Class ' + patient.nyha_class +
            '. Exercise-based cardiac rehab is Class I (ACC/AHA 2022) for stable HF patients — improves functional capacity, quality of life, and reduces HF hospitalization. Refer if not already enrolled.'
        );
    }

    // --- P5: Volume depletion alert (S2). "Volume depleted" needs weight more than 1 kg below dry weight AND no congestion finding on examination. When the scale says dry
    // but the examination shows congestion, the two disagree: say so and do not call diuretic reduction the priority.
    // A weight that was not entered is not 0 kg (R6 V18): with either weight blank there is no fluid balance to read (the examination findings alone say whether the patient is congested).
    const currentFluidBalance = valueUnknown(patient.volume_status.current_weight_kg) || valueUnknown(patient.volume_status.dry_weight_kg) ? 0 : weightAboveDryKg(patient);
    const isVolumeDepleted = isVolumeDepletedState(patient);
    const hasDiureticInCurrent = (patient.current_regimen || []).some(r =>
        r.med.drug_class === 'Loop Diuretic' || r.med.drug_class === 'Thiazide-like Diuretic'
    );
    if (isVolumeDepleted && hasDiureticInCurrent) {
        clinicalAlerts.push(
            'VOLUME DEPLETION: Patient is ' + kgText(currentFluidBalance) + 'kg below dry weight while on diuretics. ' +
            (patient.potassium >= 6.0
                ? 'Potassium is 6.0 or above and diuretics lower potassium, so no diuretic is reduced or stopped today; reassess the diuretic once potassium is controlled. Risk of AKI and hemodynamic collapse.'
                : 'Diuretic reduction/discontinuation is the priority intervention before adding new agents. Risk of AKI and hemodynamic collapse.')
        );
    }
    clinicalAlerts.push(...scaleDisagreementAlerts(patient));
    clinicalAlerts.push(...congestionWithoutWeightAlerts(patient));
    clinicalAlerts.push(...perfusionAboveEfLimitAlerts(patient));

    // Severe CKD and loop response: the "consider more dosing" advice applies only when there is congestion to treat or a diuretic to adjust (S13).
    if (!dataAudit.unknownRenal && patient.egfr < 20 && (hasDiureticInCurrent || currentFluidBalance > 1.0 || congestionFindingCount(patient.volume_status.exam_findings) > 0)) {
        const congestedNow = currentFluidBalance > 1.0 || congestionFindingCount(patient.volume_status.exam_findings) > 0;
        clinicalAlerts.push(
            congestedNow
                ? 'SEVERE CKD DIURETIC ALERT: eGFR < 20 may blunt oral loop diuretic response. Consider BID/TID loop dosing strategy, conversion to torsemide/bumetanide, and close daily weight/urine monitoring.'
                : 'SEVERE CKD DIURETIC ALERT: eGFR < 20 may blunt oral loop diuretic response. The patient is not congested, so no dose increase is suggested; if congestion returns, twice or three times daily dosing or a switch to torsemide or bumetanide may be needed. Monitor daily weight and urine output.'
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
    // Contradictory prior-EF entries (S13): a recorded numeric previous LVEF beats the yes/no history question (clinicalPredicates.hasHistoricalHFrEF); say which was used.
    if (!valueUnknown(patient.previous_lvef) && (patient.ever_lvef_le_40 === 'yes' || patient.ever_lvef_le_40 === 'no')) {
        const numericSaysLow = patient.previous_lvef! <= 40;
        if (numericSaysLow !== (patient.ever_lvef_le_40 === 'yes')) {
            clinicalAlerts.push(`DATA NOTE: the prior ejection fraction entries disagree. The recorded previous LVEF is ${patient.previous_lvef}%, but the history question says the LVEF ${patient.ever_lvef_le_40 === 'yes' ? 'was' : 'was never'} 40% or below. The tool used the recorded value (${patient.previous_lvef}%). Correct whichever entry is wrong.`);
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
 * Stage 3 - hard safety stops: SBP < 90, K+ >= 6.5 or third-degree AV block without a pacemaker returns alerts only (no regimen output).
 * Returns null when the run may proceed.
 */
export function checkSafetyHardStops(
    patient: Patient,
    clinicalAlerts: string[],
    gdmtGaps: string[],
    missingDataNotices: string[]
): SimulationOutput | null {
    if (patient.sbp < HYPOTENSION_SBP_BELOW || patient.potassium >= 6.5 || patient.rhythm === '3rd Degree AV Block') {
        return {
            scoredRegimens: [],
            excludedMedications: taggedDiscontinuedMeds(patient),
            clinicalAlerts,
            monitoringPlan: patient.potassium >= 6.0 ? [URGENT_POTASSIUM_MONITORING] : [],
            gdmtGaps,
            eligibleAdjuncts: [],
            missingDataNotices,
            followUpCalendar: []
        };
    }

    return null;
}
