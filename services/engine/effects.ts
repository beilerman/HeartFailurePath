/** Evaluate regimen costs, cautions and evidence context while preserving observed physiology. */
import { Patient, Medication, ModificationSet, ChfEffects } from '../../types';
import { drugFacts } from './drugFacts';
import { valueUnknown, hasGoutHistory, hasAtrialFibrillationHistory, bunToCreatinineRatio } from '../clinicalPredicates';
import { hasChildPughBorC, hasChildPughBConfirmed, onPde5Inhibitor as onPde5InhibitorPatient } from './contraindications';
import { RAAS_CLASSES, isDiureticClass } from './registry';
import { clonePatient, medicationComplexity, isTargetDoseForPatient, sortedByName } from './regimenUtils';
import { IntolerancePolicy, currentMedIntoleranceReason, deriveIntolerancePolicy, hasAngioedemaHistory } from './intolerance';
import { HYPOKALEMIA_K_BELOW } from './thresholds';
import { MRA_POOL_CLASSES } from './registry';
import { EXTERNAL_POTASSIUM_RAISERS, potassiumRaisersTaken, ALISKIREN } from './contraindications';
import { MEDICATION_FORMULARY } from '../../constants';
import { intoleranceCautionsFor, aceInhibitorAllergies, sameClassAllergies, allergyViaComponentOnly, drugClassWords, combinationProductsContaining } from './intolerance';
import { monthlyMedicationCost } from '../medicationCost';
import { physiologicTransitions } from './regimenTransition';

/** The "Drug note" text for a declared label-versus-guideline difference (facts.source_differences). Also shown on the formulary card. */
export function sourceDifferenceNote(drugName: string, d: { topic: string; label: string; guideline: string; tool_follows: 'label' | 'guideline'; why: string }): string {
    return `Drug note: sources differ on the ${d.topic} of ${drugName.replace(/\s*\(.*\)/, '').toLowerCase()}. Label: ${d.label}. Guideline: ${d.guideline}. This tool follows the ${d.tool_follows} (${d.why}).`;
}

/**
 * A drug's `chf_effects(dose)` as credited for THIS patient. Two patient-dependent adjustments, both data on the entry:
 *  - `weight_reduction_percent` (GLP-1 agents, placebo-adjusted percent of body weight) becomes kg of the patient's actual weight (100 kg when
 *    no weight is entered), so a lighter or heavier patient is not credited a fixed kg;
 *  - `facts.t2dm_scale` multiplies the weight and KCCQ effects for type 2 diabetes (smaller effects in the diabetes trials).
 * Drugs with neither return `chf_effects(dose)` unchanged.
 */
/** @deprecated Legacy diagnostic function only. Never call from clinical evaluation or presentation. */
export function patientChfEffects(med: Medication, dose: number | string, patient: Patient): ChfEffects {
    const base = med.chf_effects(dose);
    const scale = drugFacts(med).t2dm_scale;
    const diabetic = scale !== undefined && patient.comorbidities.has('Diabetes Mellitus Type 2');
    if (base.weight_reduction_percent === undefined && !diabetic) return base;
    const out: ChfEffects = { ...base };
    if (base.weight_reduction_percent !== undefined) {
        const pct = base.weight_reduction_percent * (diabetic ? scale!.weight : 1);
        const wt = patient.volume_status.current_weight_kg > 0 ? patient.volume_status.current_weight_kg : 100;
        out.weight_reduction_percent = pct;
        out.weight_reduction_kg = pct / 100 * wt;
    }
    if (diabetic) out.kccq_improvement = base.kccq_improvement * scale!.kccq;
    return out;
}

export function simulateModificationEffect(
    currentPatient: Patient,
    modificationSet: ModificationSet,
    prices: Record<string, number>,
    // For the mandatory-swap bonus: a swap is forced both by hard contraindications AND by
    // documented intolerances. Accepted as a parameter so the per-candidate loop in
    // generateAndScoreModifications passes the policy computed once per run instead of
    // re-deriving it (string filtering/lowercasing) inside every candidate simulation.
    intolerancePolicy: IntolerancePolicy = deriveIntolerancePolicy(currentPatient)
): {
    projectedPatient: Patient;
    riskScreen: import('../../types').MedicationRiskScreen;
    cost: number;
    complexity: number;
    warnings: string[];
    rationale: string[];
    specialFeatureBonus: number;
    /** Each special feature that fired (pre-normalization points) - the audit trail behind specialFeatureBonus. */
    specialFeatureItems: { med: string; feature: string; points: number }[];
} {
    const proj = clonePatient(currentPatient);
    const resultingRegimen = modificationSet.resulting_regimen;
    const exposureChanges = physiologicTransitions(currentPatient.current_regimen, resultingRegimen, modificationSet.modifications);
    proj.current_regimen = resultingRegimen.map(r => ({ ...r, dose: { ...r.dose } }));

    let totalCost = 0;
    let complexityScore = 0;
    const warnings: string[] = [];
    const rationale: string[] = [];

    // Recorded findings are used for screening; drug-effect coefficients are retired from clinical evaluation.
    let specialFeatureBonus = 0;
    const specialFeatureItems: { med: string; feature: string; points: number }[] = [];

    // Track drug types from RESULTING regimen for interaction checks
    let hasDiuretic = false;
    let hasMRA = false;
    let hasBeta = false;
    let hasIvabradine = false;
    let hasGLP1 = false;
    let raasCount = 0;
    // Track drug types from resulting regimen (for synergy/safety checks)
    resultingRegimen.forEach(r => {
        const cls = r.med.drug_class;
        if (cls === 'Loop Diuretic') hasDiuretic = true;
        if (cls === 'MRA' || cls === 'nsMRA') hasMRA = true;
        if (cls === 'Beta Blocker') hasBeta = true;
        if (cls === 'If Inhibitor') hasIvabradine = true;
        if (cls === 'GLP-1 RA' || cls === 'GLP-1/GIP RA') hasGLP1 = true;
        if (['ARNI', 'ACEi', 'ARB'].includes(cls)) { raasCount++; }

        // Cost and complexity for FULL resulting regimen
        // Cash-pay price by dose (facts.cash_price_by_dose: Zepbound self-pay differs by strength); every other tier uses the flat price.
        const monthlyCost = monthlyMedicationCost(r, currentPatient.insurance_tier, prices);
        if (monthlyCost === undefined || !Number.isFinite(monthlyCost) || monthlyCost < 0) {
            totalCost += Number.POSITIVE_INFINITY;
            warnings.push(currentPatient.insurance_tier ? `PRICE UNKNOWN: ${r.med.name} has no loaded cost data. Re-run after pricing loads before comparing affordability.` : `PRICE UNKNOWN: ${r.med.name} has no cost data because no pricing profile is selected. Select a pricing profile and re-run before comparing affordability.`); // R11 B7d: the cause is named
        } else {
            totalCost += monthlyCost;
        }
        complexityScore += medicationComplexity(r);
    });

    // Net exposure controls screening; withdrawal never creates an invented improvement.
    // No CHF surrogate coefficient is used here: trial endpoints are not individual response curves.
    for (const change of exposureChanges) {
        rationale.push(change.summary);
        if (change.action === 'remove' && change.source?.med.drug_class === 'Beta Blocker') {
            warnings.push('BETA-BLOCKER DISCONTINUATION: Avoid abrupt withdrawal when possible; confirm the reason and an individualized taper or switch plan, with heart-rate and symptom monitoring. The model does not predict the withdrawal response.');
        }
        if (change.action === 'swap' && change.source && change.target) {
            const contraindicated = change.source.med.contraindications?.(currentPatient) === true;
            const intolerable = currentMedIntoleranceReason(change.source.med, intolerancePolicy) !== null;
            if (contraindicated || intolerable) {
                specialFeatureBonus += 15;
                specialFeatureItems.push({ med: change.target.med.name,
                    feature: `Mandatory swap from ${contraindicated ? 'contraindicated' : 'intolerance-documented'} ${change.source.med.name}`, points: 15 });
            }
        }
    }

    // Special features from resulting regimen. Owner instruction 2026-11-15 (every clinical choice from a first-principles model), applied by the controller 2026-11-16: NO hand-set points. Every feature is text in the rationale only; `replaced_by` says where its
    // benefit or harm is modelled (outcome, symptom, harm, adherence) or that it is noted but not scored (not_modelled). The only remaining bonus points are the
    // mandatory swap above (+15).
    resultingRegimen.forEach(r => {
        if (r.med.special_features) {
            r.med.special_features.forEach(sf => {
                if (sf.criteria(currentPatient, resultingRegimen)) {
                    rationale.push(`+ ${r.med.name}: ${sf.feature}${sf.replaced_by === 'not_modelled' ? ' (noted; not scored: no measured model yet)' : ''}`);
                }
            });
        }

        // Uric-acid caution as data: any drug declaring facts.raises_uric_acid (loops and thiazide-type diuretics; labels: may precipitate gout).
        if (drugFacts(r.med).raises_uric_acid && hasGoutHistory(currentPatient)) {
            const feature = 'Caution in Gout (uric acid retention)';
            rationale.push(`+ ${r.med.name}: ${feature}`);   // text only: 0 points (replaced by the measured harm model, 2026-11-16)
            const goutNote = 'Drug note (2026 ESC Supplementary Table S7): with gout on a loop or thiazide-type diuretic, consider allopurinol prophylaxis, use colchicine for an acute attack, and avoid NSAIDs.';
            if (!warnings.includes(goutNote)) warnings.push(goutNote);
        }

        if (isTargetDoseForPatient(r, currentPatient)) rationale.push(`+ ${r.med.name}: At the applicable target or tolerated dose`);
    });
    const uniqueRationale = [...new Set(rationale)];
    const observed = clonePatient(proj);
    observed.assessment_basis = 'proposed_regimen';
    // A proposed dose is not evidence that it was started, taken consistently, or tolerated.
    const changedNames = new Set(exposureChanges.flatMap(c => c.target ? [c.target.med.name] : []));
    observed.current_regimen = observed.current_regimen.map(r => changedNames.has(r.med.name) ? { ...r, exposure: { status: 'unknown', adherence: 'unknown' } } : r);
    const kUnknown = valueUnknown(currentPatient.potassium);
    const riskScreen = {
        basis: 'observed_state_only' as const,
        sbp: currentPatient.sbp, dbp: currentPatient.dbp, pulse: currentPatient.pulse,
        potassium_high: currentPatient.potassium, potassium_low: currentPatient.potassium,
    };
    const map = (currentPatient.sbp + 2 * currentPatient.dbp) / 3;
    if (map < 65) warnings.push(`Low Perfusion Pressure (measured MAP ${map.toFixed(0)} mmHg) - Risk of AKI`);

    // --- Titration Timeline Warning ---
    const newAdds = modificationSet.modifications.filter(m => m.action === 'add');
    const titrations = modificationSet.modifications.filter(m => m.action === 'titrate_up');
    if (newAdds.length >= 2) {
        const targetAdds = newAdds.filter(m => m.target && isTargetDoseForPatient(m.target, currentPatient));
        if (targetAdds.length >= 2) {
            warnings.push('Multiple new therapies: confirm each drug-specific starting dose, sequencing, monitoring and minimum escalation interval. A fixed-dose treatment does not share the titration schedule of another drug.');
        }
    }
    // D9: Single-agent titration interval guidance
    if (titrations.length > 0) {
        warnings.push('Before dose escalation: confirm time at the current dose, actual use, tolerance and drug-specific minimum intervals. Reassess BP, heart rate and relevant laboratory results; this proposal does not authorize an immediate or automatic dose step.');
    }

    // --- P3: Age-adjusted warnings ---
    if (currentPatient.age > 75 && newAdds.length > 0) {
        warnings.push('Older adult: individualize starting dose and review interval; assess orthostatic BP, frailty, tolerance and medication use before escalation.');
    }
    if (currentPatient.age > 80 && currentPatient.egfr < 45 && newAdds.length > 0) {
        warnings.push('Frail elderly with CKD: Monitor renal function and electrolytes weekly during titration.');
    }

    // --- Safety Checks ---
    if (proj.sbp < 90) warnings.push('Risk of Hypotension (SBP < 90)');
    if (proj.pulse > 0 && proj.pulse < 50) {
        warnings.push('Risk of Bradycardia (HR < 50)');
        // R7 W13g: in a paced rhythm the pacemaker sets a floor under the rate, and every other rate rule of the tool (the beta-blocker start limit, the dose reduction for a slow rate) is not applied; the warning says so.
        if (currentPatient.rhythm === 'Paced') warnings.push('Drug note: the rhythm is recorded as paced. A pacemaker sets a floor under the heart rate, so the tool does not limit a beta-blocker by a recorded rate below 50 in a paced rhythm; confirm the pacemaker\'s lower rate setting.');
    }

    if (!kUnknown) {
        if (proj.potassium > 6.0) {
            warnings.push('CRITICAL: Severe Hyperkalemia Risk (K+ > 6.0)');
        } else if (proj.potassium > 5.5) {
            warnings.push('DANGER: High Hyperkalemia Risk (K+ > 5.5)');
        } else if (proj.potassium > 5.2) {
            warnings.push('Caution: Elevated Potassium (K+ > 5.2). Monitor closely.');
        } else if (proj.potassium > 5.0 && hasMRA) {
            warnings.push(`Monitor: measured K+ is above 5.0 with an MRA (${currentPatient.potassium.toFixed(1)}). Check potassium within 1 week of the change; consider a potassium binder if it rises.`);
        } else if (proj.potassium < HYPOKALEMIA_K_BELOW) {
            warnings.push(`Risk of Hypokalemia (K+ < ${HYPOKALEMIA_K_BELOW})`);
        }
    }

    // (The former D2 warning for an MRA start at potassium exactly 5.0 was removed 2026-11-11: rule E15 now withholds a new MRA at 5.0 or higher, so no new start reaches here at 5.0-5.5.)

    // Drug-specific regimen warnings declared as data on the formulary entry (facts.regimen_warnings).
    resultingRegimen.forEach(r => {
        const startsThis = modificationSet.modifications.some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.name === r.med.name);
        drugFacts(r.med).regimen_warnings?.forEach(w => {
            if (w.when_started && !startsThis) return;
            if (!w.when || w.when(currentPatient, resultingRegimen)) warnings.push(typeof w.text === 'function' ? w.text(currentPatient) : w.text);
        });
        drugFacts(r.med).source_differences?.forEach(d => warnings.push(sourceDifferenceNote(r.med.name, d)));
    });

    if (raasCount > 1) {
        warnings.push("CONTRAINDICATION: Dual RAAS blockade (ACEi + ARB/ARNI) increases renal risk without benefit.");
    }

    // H1: ARB + angioedema history → mandatory monitoring warning (ACC/AHA: "use with caution")
    const hasARBinRegimen = resultingRegimen.some(r => r.med.drug_class === 'ARB');
    // W11: one reading of "angioedema history" for every entry route (the comorbidity, a recorded intolerance to a RAAS drug, or the word typed in the allergy box): intolerance.ts.
    const angioedemaRiskPresent = hasAngioedemaHistory(currentPatient);
    if (hasARBinRegimen && angioedemaRiskPresent) {
        const startsArb = modificationSet.modifications.some(m => (m.action === 'add' || m.action === 'swap') && m.target?.med.drug_class === 'ARB');
        warnings.push(
            'ANGIOEDEMA CAUTION: ARB ' + (startsArb ? 'prescribed' : 'continued') + ' with prior angioedema history. Cross-reactivity risk is low (~2-8%) but not zero. ' +
            (startsArb ? 'Initiate in a monitored setting. ' : 'The ARB is already taken: ask about any swelling since it was started. ') +
            'Ensure patient has epinephrine auto-injector. Educate on angioedema signs (lip/tongue swelling). ' +
            'If angioedema recurs on ARB, discontinue and use H/ISDN as RAAS alternative.'
        );
    }

    const hasSteroidalMRA = resultingRegimen.some(r => r.med.drug_class === 'MRA');
    const hasNonSteroidalMRA = resultingRegimen.some(r => r.med.drug_class === 'nsMRA');
    if (hasSteroidalMRA && hasNonSteroidalMRA) {
        warnings.push('CONTRAINDICATION: Dual MRA blockade (steroidal MRA + Finerenone) increases severe hyperkalemia risk and is not evidence-based.');
    }

    if (currentPatient.oxygen_saturation && currentPatient.oxygen_saturation < 90) {
        warnings.push("Hypoxia Alert: SpO2 < 90%. Evaluate for Pulmonary Edema.");
    }

    // β1-selective beta-blocker in mild/moderate asthma: acceptable but not risk-free.
    // (Severe asthma is an absolute CI for all BBs and is handled by exclusion upstream.)
    if (currentPatient.comorbidities.has('Asthma (Mild/Moderate)')) {
        // The first beta-1-selective drug BY NAME, never by entry order (T25): the warning text and its baseline key must not depend on how the list was typed.
        const selectiveBB = sortedByName(resultingRegimen).find(r =>
            drugFacts(r.med).beta1_selective
        );
        if (selectiveBB) {
            const preferredNote = drugFacts(selectiveBB.med).most_cardioselective
                ? ''
                : ' Bisoprolol is the most cardioselective option if bronchospasm emerges.';
            warnings.push(`ASTHMA + BETA-BLOCKER: ${selectiveBB.med.name} (β1-selective) is acceptable in mild/moderate asthma but cardioselectivity decreases at higher doses. Start low, monitor for wheeze/PEF drop, and ensure a rescue inhaler is available.${preferredNote} Non-selective carvedilol is avoided.`);
        }
    }

    // 36-hour washout between an ACE inhibitor and the ARNI, in EITHER direction (Entresto label 2.1 and 4; Zestril
    // label 4 states the mirror rule). Covers a swap and a remove + add pair. Procedural, so not score-penalized
    // ('MANDATORY: 36-hour washout' is in NON_PENALIZED_WARNING_MARKERS).
    const leavingClasses = new Set<string>();
    const enteringClasses = new Set<string>();
    modificationSet.modifications.forEach(m => {
        if ((m.action === 'remove' || m.action === 'swap') && m.source) leavingClasses.add(m.source.med.drug_class);
        if ((m.action === 'add' || m.action === 'swap') && m.target) enteringClasses.add(m.target.med.drug_class);
    });
    if (leavingClasses.has('ACEi') && enteringClasses.has('ARNI')) {
        warnings.push('MANDATORY: 36-hour washout required between last ACEi dose and first ARNI dose (life-threatening angioedema risk).');
    }
    if (leavingClasses.has('ARNI') && enteringClasses.has('ACEi')) {
        warnings.push('MANDATORY: 36-hour washout required between last ARNI dose and first ACEi dose (life-threatening angioedema risk).');
    }

    // ARNI started at a low baseline SBP: PARADIGM-HF excluded SBP < 100 (the label gives no SBP threshold; it says to correct
    // volume or salt depletion first, or start at a lower dose). A caution, not a block. It is a genuine residual-risk
    // statement (symptomatic hypotension in a population the pivotal trial did not enroll), so it IS score-penalized
    // like other residual-risk warnings; the dose is already limited to the starting tier by the ARNI start rule.
    const startsArni = modificationSet.modifications.some(m =>
        (m.action === 'add' || m.action === 'swap') && m.target?.med.drug_class === 'ARNI');
    if (startsArni && currentPatient.sbp < 100) {
        warnings.push(`ARNI AT LOW BASELINE SBP: Starting systolic BP is ${currentPatient.sbp} mmHg; PARADIGM-HF excluded SBP below 100. Start at 24/26 mg bid, correct any volume or salt depletion first, and recheck BP and renal function within 1-2 weeks (the label sets no SBP threshold).`);
    }

    // Liver disease safety warnings
    if (hasChildPughBorC(currentPatient)) {
        const hasMRAInRegimen = resultingRegimen.some(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA');
        if (hasMRAInRegimen) {
            const mraName = sortedByName(resultingRegimen).find(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA')?.med.name;
            warnings.push(`Hepatic Impairment: ${mraName} accumulates in cirrhosis. Monitor K+ and renal function closely. Consider dose reduction.`);
        }
        // BB: Carvedilol and Metoprolol are extensively hepatically metabolized
        const hepaticBBs = resultingRegimen.filter(r =>
            r.med.drug_class === 'Beta Blocker' && drugFacts(r.med).hepatically_metabolized
        );
        if (hepaticBBs.length > 0) {
            warnings.push(`Hepatic Impairment: ${hepaticBBs[0].med.name} is hepatically metabolized — increased exposure in cirrhosis. Consider Bisoprolol (renally cleared) as alternative.`);
        }
        // Finerenone: CYP3A4 substrate with reduced clearance in cirrhosis
        const hasFinerenone = resultingRegimen.some(r => drugFacts(r.med).cirrhosis_cyp3a4_caution);
        if (hasFinerenone) {
            warnings.push('Hepatic Impairment: Finerenone is a CYP3A4 substrate with reduced clearance in cirrhosis. Avoid in Child-Pugh C; use with caution in Child-Pugh B.');
        }
        // ARNI: sacubitril AUC increases in hepatic impairment (Entresto PI)
        const hasARNI = resultingRegimen.some(r => r.med.drug_class === 'ARNI');
        if (hasARNI) {
            warnings.push(hasChildPughBConfirmed(currentPatient)
                ? 'Hepatic Impairment: Sacubitril/Valsartan in Child-Pugh B — start at 24/26 mg bid and titrate cautiously (sacubitril exposure is higher; Entresto label 2.8). Not recommended in Child-Pugh C (not studied).'
                : 'Hepatic Impairment: Sacubitril/Valsartan — sacubitril AUC increases ~1.5-2x in Child-Pugh B/C (Entresto PI). Avoid in Child-Pugh C; Child-Pugh B needs a reduced start. Switch to ACEi/ARB if severity is unconfirmed.');
        }
        // Loop diuretics: cirrhosis with ascites may need higher doses
        const hasLoop = resultingRegimen.some(r => r.med.drug_class === 'Loop Diuretic');
        if (hasLoop) {
            warnings.push('Hepatic Impairment: Cirrhosis + ascites may require higher loop diuretic doses due to reduced renal blood flow. Monitor Na+ closely (risk of hyponatremia).');
        }
    }

    // Digoxin narrow therapeutic index monitoring (DIG post hoc: best 0.5-0.8 ng/mL; avoid 1.2 or above)
    // (renalUnknown: blank eGFR is stored as the 0 sentinel — it must prompt for a BMP, not
    // read as end-stage CKD in the renal-threshold warnings below.)
    const renalUnknown = valueUnknown(currentPatient.egfr);
    const hasDigoxin = resultingRegimen.some(r => r.med.drug_class === 'Inotrope');
    if (hasDigoxin) {
        const renalNote = !renalUnknown && currentPatient.egfr < 45 ? ' Renal impairment increases toxicity risk — recheck level after any eGFR change.' : '';
        const kNote = (hasDiuretic && !hasMRA) ? ' Concurrent diuretic without MRA increases hypokalemia-mediated toxicity risk.' : '';
        warnings.push(`Digoxin Monitoring: Check serum digoxin level in 5-7 days (HF target about 0.5-0.8 ng/mL in the DIG analyses, up to 0.9-1.1 acceptable, avoid 1.2 or above; the label calls below 0.5 diminished efficacy and above 2.0 toxicity without benefit). Monitor for toxicity (nausea, visual changes, arrhythmia).${renalNote}${kNote}`);
        if (!kUnknown && proj.potassium >= 3.5 && proj.potassium < 4.0) {
            warnings.push('Digoxin Safety: Potassium 3.5-4.0 increases toxicity risk. Monitor K+ closely with concurrent diuretic therapy and replete to >4.0 when feasible.');
        }
    }

    if (currentPatient.peak_flow_lpm && currentPatient.peak_flow_lpm < 350) {
        if (!currentPatient.comorbidities.has('Severe Asthma / Bronchospasm') && !currentPatient.comorbidities.has('COPD')) {
            uniqueRationale.push("Screening: Low Peak Flow suggests possible COPD/Asthma overlap.");
        }
    }

    const bunCrRatio = bunToCreatinineRatio(currentPatient);
    if (bunCrRatio > 20 && hasDiuretic && !hasGLP1) {
        if (map < 70) {
            warnings.push('Prerenal Azotemia: Diuresis likely to worsen Creatinine due to low perfusion');
        } else {
            uniqueRationale.push("Monitoring: BUN/Cr elevated but MAP > 70 suggests tolerance");
        }
    }

    if (!renalUnknown && currentPatient.egfr < 20 && hasDiuretic) {
        warnings.push('Severe CKD Loop Strategy: eGFR < 20 may blunt loop response. Consider split dosing (BID/TID), torsemide/bumetanide conversion, and close urine output + daily weight tracking.');
    }

    // Penalized caution when a potassium-LOWERING diuretic (loop or thiazide-type) is added, swapped in or increased with a measured baseline K+ below 3.5
    // (HYPOKALEMIA_K_BELOW). A class rule since 2026-11-12: it was declared on metolazone only, so furosemide could be doubled at K+ 3.0 with no specific caution
    // while metolazone carried one. An entry's own facts.hypokalemia_caution_below_k (level and basis) is used when declared. Engine policy: the labels warn of
    // hypokalemia and give no potassium contraindication. Tied to the MEASURED value, not the projection.
    if (!kUnknown) {
        modificationSet.modifications.forEach(mod => {
            const tgt = (mod.action === 'add' || mod.action === 'swap' || mod.action === 'titrate_up') ? mod.target : undefined;
            if (!tgt || !isDiureticClass(tgt.med.drug_class)) return;
            const rule = drugFacts(tgt.med).hypokalemia_caution_below_k ?? { k: HYPOKALEMIA_K_BELOW, basis: 'a rule set by this tool; loop and thiazide-type diuretic labels warn of hypokalemia and give no potassium contraindication' };
            if (currentPatient.potassium < rule.k) {
                warnings.push(`HYPOKALEMIA CAUTION: ${tgt.med.name} lowers potassium and the baseline K+ is ${currentPatient.potassium} (below ${rule.k}). Replete potassium first or monitor closely; check electrolytes within days of ${mod.action === 'titrate_up' ? 'the increase' : 'starting'} (${rule.basis}).`);
            }
        });
    }

    const hasFuroscix = resultingRegimen.some(r => drugFacts(r.med).delivery === 'on_body_infusor');
    if (hasFuroscix) {
        warnings.push('FUROSCIX SAFETY: On-body SQ infusor delivers 80mg over ~5 hours. Keep device dry and minimize vigorous activity during infusion to reduce incomplete dosing risk.');
        if (!renalUnknown && currentPatient.egfr < 30) {
            warnings.push('FUROSCIX CKD CAUTION: eGFR < 30 may reduce natriuretic response. Track urine output and daily weight; escalate to IV diuresis if congestion persists.');
        }
        if (currentPatient.oxygen_saturation !== undefined && currentPatient.oxygen_saturation < 90) {
            warnings.push('FUROSCIX TRIAGE: Hypoxemia (SpO2 < 90%) may indicate acute pulmonary edema. Prioritize urgent in-person evaluation and IV diuresis pathway.');
        }
    }

    // --- Drug-Drug Interaction (DDI) Warnings ---
    const hasNitrate = resultingRegimen.some(r => r.med.drug_class === 'Vasodilator'); // H/ISDN
    const hasRAASDrug = resultingRegimen.some(r => ['ARNI', 'ACEi', 'ARB'].includes(r.med.drug_class));
    const externalMeds = currentPatient.external_medications || new Set<string>();
    const hasExternalMedication = (...names: string[]) => names.some(name => externalMeds.has(name));
    // Backward compatibility for older saved patients that used comorbidity flags for these meds.
    const onAmiodarone = hasExternalMedication('Amiodarone') || currentPatient.comorbidities.has('On Amiodarone');
    const onVerapamilOrDiltiazem =
        hasExternalMedication('Verapamil', 'Diltiazem') ||
        currentPatient.comorbidities.has('On Verapamil/Diltiazem');
    const onLithium = hasExternalMedication('Lithium') || currentPatient.comorbidities.has('On Lithium');
    const onPde5Inhibitor = onPde5InhibitorPatient(currentPatient);

    // DDI-1: Nitrate (H/ISDN) + PDE5 inhibitor → fatal hypotension
    if (hasNitrate && onPde5Inhibitor) {
        warnings.push('DDI WARNING: Nitrate (Isosorbide Dinitrate) is CONTRAINDICATED with PDE5 inhibitors (sildenafil/tadalafil/vardenafil/avanafil). Risk of profound or fatal hypotension. Avoid co-administration.');
    } else if (hasNitrate && currentPatient.comorbidities.has('Pulmonary Hypertension')) {
        warnings.push('DDI CAUTION: Pulmonary hypertension may imply PDE5 inhibitor use. Confirm sildenafil/tadalafil exposure before initiating nitrate therapy.');
    }

    // Aliskiren with a RAAS inhibitor at eGFR below 60 (Entresto and ACE inhibitor / ARB labels: avoid the combination in renal impairment). With diabetes the
    // combination is a contraindication (contraindications.ts); without it there was no warning at all.
    if (hasRAASDrug && currentPatient.external_medications?.has(ALISKIREN) && currentPatient.egfr > 0 && currentPatient.egfr < 60) {
        warnings.push(`DDI WARNING: aliskiren with a RAAS inhibitor at eGFR ${currentPatient.egfr} (below 60): the labels advise avoiding the combination in renal impairment (hyperkalemia, kidney injury, hypotension). Stop aliskiren or do not combine.`);
    }

    // DDI-2: RAAS + chronic NSAID use → AKI risk (extremely common outpatient DDI)
    if (hasRAASDrug && currentPatient.comorbidities.has('Chronic NSAID Use')) {
        warnings.push('DDI WARNING: RAAS inhibitor + chronic NSAID use significantly increases AKI risk. Discontinue NSAIDs if possible. If unavoidable, monitor creatinine and potassium weekly.');
    }

    // DDI-8: potassium-raising co-medication (list EXTERNAL_POTASSIUM_RAISERS) + an option that STARTS or INCREASES a RAAS inhibitor or MRA: additive hyperkalemia
    // (Aldactone and Inspra labels: potassium supplements and potassium-sparing diuretics; Bactrim label: trimethoprim, mostly with RAAS inhibitors). Penalized.
    // A potassium supplement is appropriate when potassium is projected LOW, so it alone draws no warning then; the sparing diuretics and trimethoprim always do.
    const raisedKDrugs = modificationSet.modifications.filter(mod =>
        (mod.action === 'add' || mod.action === 'swap' || mod.action === 'titrate_up') && mod.target
        && (RAAS_CLASSES.has(mod.target.med.drug_class) || MRA_POOL_CLASSES.has(mod.target.med.drug_class)));
    if (raisedKDrugs.length > 0) {
        const lowK = !kUnknown && proj.potassium < HYPOKALEMIA_K_BELOW;
        const raisers = potassiumRaisersTaken(currentPatient).filter(n => !(lowK && n === EXTERNAL_POTASSIUM_RAISERS[0]));
        if (raisers.length > 0) {
            // Every drug started or increased is named (an ARNI + MRA start named only the ARNI).
            const named = raisedKDrugs.map(mod => `${mod.target!.med.name} (${mod.action === 'titrate_up' ? 'dose increase' : 'new start'})`).join(' and ');
            warnings.push(`DDI WARNING: ${raisers.join(', ')} with ${named}: additive hyperkalemia risk; recheck potassium within 1 week.`);
        }
    }

    // An ACE inhibitor ALLERGY of unstated type with an option that starts the ARNI: the ARNI is contraindicated after ACE inhibitor (or ARB) angioedema
    // (Entresto label), and an allergy entry does not say what the reaction was. Penalized, so an ARB ranks ahead until the reaction is confirmed.
    if (!intolerancePolicy.angioedema.suspected) {
        const startsArni = modificationSet.modifications.find(mod => (mod.action === 'add' || mod.action === 'swap') && mod.target?.med.drug_class === 'ARNI');
        const aceAllergy = aceInhibitorAllergies(currentPatient);
        if (startsArni && aceAllergy.length > 0) {
            warnings.push(`ALLERGY CHECK: an allergy to ${aceAllergy.length > 2 ? 'ACE inhibitors' : aceAllergy.join(' and ')} is recorded without the type of reaction. ${startsArni.target!.med.name} is contraindicated if that reaction was angioedema: confirm before starting (an ARB is the alternative).`);
        }
    }

    // An option that STARTS a drug (a new start or a switch to it) of the same class as a drug the patient lists as an allergy: the entry does not say what the reaction was, and a reaction
    // to one agent can recur with another of its class. The same kind of check, with the same weight, as the ARNI check above: confirm the reaction before starting.
    modificationSet.modifications.forEach(mod => {
        if ((mod.action !== 'add' && mod.action !== 'swap') || !mod.target) return;
        const listed = sameClassAllergies(currentPatient, mod.target.med);
        if (listed.length === 0) return;
        // R10 A11d: an entry that states angioedema ("angioedema with losartan") is not "without the type of reaction"; the allergy to an ACE inhibitor, ARB or ARNI is worded for what was recorded.
        const angioedemaEntry = [...(currentPatient.allergies ?? [])].some(a => /angio-?(o)?edema/i.test(a)) && listed.some(n => RAAS_CLASSES.has(MEDICATION_FORMULARY.find(m => m.name === n)?.drug_class ?? ''));
        const containsOtherClass = allergyViaComponentOnly(currentPatient, mod.target.med);
        const products = combinationProductsContaining(mod.target.med);
        const isComponent = !containsOtherClass && listed.every(n => products.includes(n));
        const otherFamilyMember = !containsOtherClass && !isComponent && listed.every(n => MEDICATION_FORMULARY.find(m => m.name === n)?.drug_class !== mod.target!.med.drug_class);
        const w = `ALLERGY CHECK: an allergy to ${listed.length > 2 ? `${listed.slice(0, 2).join(', ')} and others` : listed.join(' and ')} is recorded ${angioedemaEntry ? 'as angioedema' : 'without the type of reaction'}, and ${mod.target.med.name} ${containsOtherClass ? `contains valsartan, an ${drugClassWords('ARB')},` : isComponent ? `is a component of ${listed.join(' and ')},` : otherFamilyMember ? `is a related ${drugClassWords(mod.target.med.drug_class)} in the same family,` : `is ${/^(ACE|SGLT|[aeiou])/i.test(drugClassWords(mod.target.med.drug_class)) ? 'an' : 'a'} ${drugClassWords(mod.target.med.drug_class)}`} too. Confirm ${angioedemaEntry ? 'the reaction history' : 'what the reaction was'} before starting ${mod.target.med.name}.`;
        if (!warnings.includes(w)) warnings.push(w);
    });

    // Intolerance history cautions (intolerance.ts table): a NEW start of a drug in an affected class names the history. Informational, not score-penalized.
    intoleranceCautionsFor(currentPatient, modificationSet.modifications).forEach(w => { if (!warnings.includes(w)) warnings.push(w); });

    // Ivabradine (and any drug declaring facts.af_signal_note) STARTED in a patient with AF history who is in sinus rhythm today (paroxysmal AF): the label reports more AF.
    if (hasAtrialFibrillationHistory(currentPatient) && currentPatient.rhythm === 'Sinus') {
        modificationSet.modifications.forEach(mod => {
            const note = (mod.action === 'add' || mod.action === 'swap') && mod.target ? drugFacts(mod.target.med).af_signal_note : undefined;
            if (note && !warnings.includes(note)) warnings.push(note);
        });
    }

    // DDI-3: Digoxin + loop diuretic without K+ protection → toxicity
    // (Already partially covered by kNote above, but reinforce with formal DDI language.)
    // When baseline K+ is unknown the interaction risk is still real, but a fabricated
    // "projected K+ 0.0" must never be printed — prompt for the BMP instead.
    if (hasDigoxin && hasDiuretic && !hasMRA) {
        if (kUnknown) {
            warnings.push('DDI WARNING: Digoxin + loop diuretic without potassium-sparing agent — hypokalemia potentiates digoxin toxicity (arrhythmia, Torsade de Pointes). Baseline K+ is not entered: obtain a BMP before relying on this regimen.');
        } else if (proj.potassium < 4.0) {
            warnings.push('DDI WARNING: Digoxin + loop diuretic without potassium-sparing agent. Hypokalemia (measured K+ ' + proj.potassium.toFixed(1) + ') potentiates digoxin toxicity (arrhythmia, Torsade de Pointes). Assess and correct the cause using measured electrolytes; do not assume another drug cancels this risk.');
        }
    }

    // DDI-4: the label's adjustment is conditional on introducing the interaction. The form has
    // neither exposure dates nor a serum level: never repeatedly halve an already-adjusted dose.
    const digoxinExposureIncreasers = [onAmiodarone ? 'Amiodarone' : '', hasExternalMedication('Clarithromycin') ? 'Clarithromycin' : ''].filter(Boolean);
    if (hasDigoxin && digoxinExposureIncreasers.length > 0) {
        warnings.push(`DDI WARNING: ${digoxinExposureIncreasers.join(' and ')} increase digoxin exposure. Confirm whether digoxin has already been adjusted for this interaction and obtain a serum digoxin level before implementing the option. If the interaction is newly introduced, the digoxin label advises a dose reduction of about 30-50% or a dosing-frequency change with continued level monitoring. Exposure timing and prior adjustment are not recorded, so this tool cannot determine a safe individualized dose.`);
    }

    // DDI-5: Non-DHP CCB + beta blocker/digoxin increases bradycardia and AV block risk.
    if (onVerapamilOrDiltiazem && (hasBeta || hasDigoxin)) {
        warnings.push('DDI WARNING: Verapamil/Diltiazem with beta blocker and/or digoxin increases severe bradycardia/AV block risk. Use close ECG and heart-rate monitoring.');
    }

    // DDI-6: Lithium + diuretics can precipitate lithium toxicity.
    if (hasDiuretic && onLithium) {
        warnings.push('DDI WARNING: Loop/thiazide diuretics increase lithium levels and toxicity risk. Check lithium level and renal function after diuretic changes.');
    }

    // DDI-7: Explicit chronotropic risk for BB + Ivabradine co-titration.
    if (hasBeta && hasIvabradine) {
        warnings.push('DDI WARNING: Beta blocker + Ivabradine has additive chronotropic suppression. Monitor heart rate/ECG every 2 weeks during co-titration.');
    }

    return { projectedPatient: observed, riskScreen, cost: totalCost, complexity: complexityScore, warnings, rationale: uniqueRationale, specialFeatureBonus, specialFeatureItems };
}

// --- 4. Delta-from-Current Entry Point ---
