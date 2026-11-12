/** Delta simulation: the marginal effect of a modification set on the observed patient. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, Medication, ModificationSet, ChfEffects, RegimenMed } from '../../types';
import { drugFacts } from './drugFacts';
import { valueUnknown } from '../clinicalPredicates';
import { hasChildPughBorC, hasChildPughBConfirmed, onPde5Inhibitor as onPde5InhibitorPatient } from './contraindications';
import { RAAS_CLASSES, getDbpRatio, getMedicationClassGroup } from './registry';
import { clonePatient, dailyDose, effectDose, isTargetDoseForPatient } from './regimenUtils';
import { URIC_ACID_GOUT_POINTS } from './scoreModel';
import { IntolerancePolicy, currentMedIntoleranceReason, deriveIntolerancePolicy } from './intolerance';
import { HYPOKALEMIA_K_BELOW } from './thresholds';

/** A drug's heart-rate lowering as credited for THIS patient: digoxin's only counts in the rhythm its label data cover (AFib). */
function hrDropFor(med: Medication, hrDrop: number, patient: Patient): number {
    const only = drugFacts(med).hr_effect_only_in_rhythm;
    return only !== undefined && patient.rhythm !== only ? 0 : hrDrop;
}

/**
 * A drug's `chf_effects(dose)` as credited for THIS patient. Two patient-dependent adjustments, both data on the entry:
 *  - `weight_reduction_percent` (GLP-1 agents, placebo-adjusted percent of body weight) becomes kg of the patient's actual weight (100 kg when
 *    no weight is entered), so a lighter or heavier patient is not credited a fixed kg;
 *  - `facts.t2dm_scale` multiplies the weight and KCCQ effects for type 2 diabetes (smaller effects in the diabetes trials).
 * Drugs with neither return `chf_effects(dose)` unchanged.
 */
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

type HemoEffects = ReturnType<Medication['hemodynamic_effects']>;

/**
 * The effects of one regimen entry as credited for THIS patient: `chf_effects` and `hemodynamic_effects` evaluated at the entry's effect dose
 * (the TOTAL DAILY dose for a loop, `facts.effects_on_daily_dose`: 40 mg bid is 80 mg/day, not 40).
 * A short-course add-on (`facts.short_course_addon`, Furoscix) beside an oral loop is credited only ABOVE that loop on the same log ceiling:
 * effect(oral loop + add-on) - effect(oral loop), with the loops converted to oral furosemide-equivalents (`verified_furosemide_equivalent_per_mg`,
 * `oral_equivalent_multiplier`). Adding its full steady-state effect on top of a full oral loop would double count a ceiling-limited drug class.
 */
function effectsFor(rm: RegimenMed, patient: Patient): { chf: ChfEffects; hemo: HemoEffects } {
    const med = rm.med;
    const f = drugFacts(med);
    const dose = effectDose(rm);
    if (f.short_course_addon) {
        const mult = f.oral_equivalent_multiplier ?? 1;
        const baseOralEq = (patient.current_regimen || [])
            .filter(r => r.med.drug_class === med.drug_class && !drugFacts(r.med).short_course_addon)
            .reduce((sum, r) => sum + dailyDose(r) * (drugFacts(r.med).verified_furosemide_equivalent_per_mg ?? 1), 0);
        if (baseOralEq > 0) {
            const base = baseOralEq / mult;           // the oral loop(s) in this drug's own mg
            const total = base + Number(dose);
            const cT = patientChfEffects(med, total, patient), cB = patientChfEffects(med, base, patient);
            const hT = med.hemodynamic_effects(total), hB = med.hemodynamic_effects(base);
            const chf: ChfEffects = {
                ...cT,
                lvef_improvement_absolute: 0,
                weight_reduction_kg: Math.max(0, cT.weight_reduction_kg - cB.weight_reduction_kg),
                bnp_reduction_percent: Math.max(0, 1 - (1 - cT.bnp_reduction_percent) / (1 - cB.bnp_reduction_percent)),
                kccq_improvement: Math.max(0, cT.kccq_improvement - cB.kccq_improvement),
                lavi_reduction_percent: 0,
                lvedd_reduction_percent: 0,
                structure_benefit_points: 0,
            };
            return { chf, hemo: { sbp_drop: Math.max(0, hT.sbp_drop - hB.sbp_drop), hr_drop: 0, potassium_change: Math.min(0, hT.potassium_change - hB.potassium_change) } };
        }
    }
    return { chf: patientChfEffects(med, dose, patient), hemo: med.hemodynamic_effects(dose) };
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

    let totalCost = 0;
    let complexityScore = 0;
    const warnings: string[] = [];
    const rationale: string[] = [];

    // Accumulators for MARGINAL deltas (only from changed meds)
    let lvefDelta = 0;
    let bnpFactor = 1.0; // Multiplicative factor applied to current BNP
    let weightDelta = 0;
    let kccqDelta = 0;
    let laviFactorTotal = 1.0; // Multiplicative for percentage-based
    let lveddFactorTotal = 1.0;

    let sbpDelta = 0;
    let dbpDelta = 0; // Drug-class-specific DBP tracking (Finding 12)
    let hrDelta = 0;
    let kDelta = 0;
    let specialFeatureBonus = 0;
    const specialFeatureItems: { med: string; feature: string; points: number }[] = [];

    // Track drug types from RESULTING regimen for interaction checks
    let hasDiuretic = false;
    let hasSGLT2 = false;
    let hasRAAS = false;
    let hasMRA = false;
    let hasBeta = false;
    let hasIvabradine = false;
    let hasGLP1 = false;
    let raasCount = 0;
    // Portion of the marginal weightDelta attributable to GLP-1 therapy changes (adiposity /
    // tissue loss, not fluid). Tracked separately so the dry-weight adjustment and the
    // diuresis synergy only touch the deltas they physiologically apply to.
    let glp1WeightDelta = 0;

    // Renal risk factor for K+ retention
    // When initiating/up-titrating RAAS or MRA, expect ~15% acute eGFR decline (hemodynamically mediated)
    // Use projected eGFR for risk stratification rather than baseline
    const isAddingRAASorMRA = modificationSet.modifications.some(mod =>
        (mod.action === 'add' || mod.action === 'titrate_up' || mod.action === 'swap') &&
        mod.target && (['ARNI', 'ACEi', 'ARB', 'MRA', 'nsMRA'].includes(mod.target.med.drug_class))
    );
    const effectiveEgfr = isAddingRAASorMRA
        ? currentPatient.egfr * 0.85  // Expected 15% decline post-RAAS/MRA initiation
        : currentPatient.egfr;

    let renalRiskFactor = 1.0;
    if (effectiveEgfr < 60) renalRiskFactor = 1.2;
    if (effectiveEgfr < 45) renalRiskFactor = 1.5;
    if (effectiveEgfr < 30) renalRiskFactor = 2.0;

    // Track drug types from resulting regimen (for synergy/safety checks)
    resultingRegimen.forEach(r => {
        const cls = r.med.drug_class;
        if (cls === 'Loop Diuretic') hasDiuretic = true;
        if (cls === 'SGLT2i') hasSGLT2 = true;
        if (cls === 'MRA' || cls === 'nsMRA') hasMRA = true;
        if (cls === 'Beta Blocker') hasBeta = true;
        if (cls === 'If Inhibitor') hasIvabradine = true;
        if (cls === 'GLP-1 RA' || cls === 'GLP-1/GIP RA') hasGLP1 = true;
        if (['ARNI', 'ACEi', 'ARB'].includes(cls)) { hasRAAS = true; raasCount++; }

        // Cost and complexity for FULL resulting regimen
        // Cash-pay price by dose (facts.cash_price_by_dose: Zepbound self-pay differs by strength); every other tier uses the flat price.
        const cashByDose = currentPatient.insurance_tier === 'cash' ? drugFacts(r.med).cash_price_by_dose?.[String(r.dose.strength)] : undefined;
        const monthlyCost = cashByDose ?? prices[r.med.name];
        if (monthlyCost === undefined || !Number.isFinite(monthlyCost)) {
            totalCost += Number.POSITIVE_INFINITY;
            warnings.push(`PRICE UNKNOWN: ${r.med.name} has no loaded cost data. Re-run after pricing loads before comparing affordability.`);
        } else {
            totalCost += monthlyCost;
        }
        let medComplexity = 1;
        if (r.dose.formulation.includes('SQ') || r.dose.formulation.includes('Weekly')) medComplexity = 2;
        else if (r.selected_frequency === 'bid') medComplexity = 2;
        else if (r.selected_frequency === 'tid') medComplexity = 4;
        complexityScore += medComplexity;
    });

    // Process each modification for marginal deltas
    modificationSet.modifications.forEach(mod => {
        const BNP_CAP = 0.8; // Cap BNP reduction at 80% to prevent division-by-near-zero

        if (mod.action === 'keep') {
            // No delta — effects already baked into observed state
            return;
        }

        if (mod.action === 'add' && mod.target) {
            const dose = mod.target.dose.strength;
            const { chf, hemo } = effectsFor(mod.target, currentPatient);

            // Starting dose hemodynamic attenuation for RAAS/BB (factor = 0.35):
            // Clinical trials show acute SBP drops at initiating doses are ~30-40% of the
            // chronic steady-state effect due to neurohormonal counter-regulation and
            // incomplete drug accumulation:
            //   - PIONEER-HF: In-hospital sacubitril/valsartan initiation at SBP ≥ 100 showed
            //     first-dose SBP drop of ~2-4 mmHg (vs modeled chronic ~8-12 mmHg; ratio ~0.3-0.35).
            //   - COPERNICUS: Carvedilol 3.125mg initiated in severe HFrEF (SBP ≥ 85); acute
            //     SBP effect was ~1-2 mmHg at starting dose (vs chronic 25mg bid effect ~5-8; ratio ~0.25-0.35).
            //   - SOLVD: Enalapril acute-phase data show initial hypotension risk peaks at
            //     first dose then attenuates over days as counter-regulation engages.
            // Applied only to titrated drug classes (RAAS, BB) at their lowest dose —
            // fixed-dose drugs (SGLT2i, GLP-1) use full hemodynamic projections.
            const isStartingDose = String(dose) === String(mod.target.med.available_doses[0].strength);
            const isAttenuatedClass = ['ARNI', 'ACEi', 'ARB', 'Beta Blocker'].includes(mod.target.med.drug_class);
            const hemoFactor = (isStartingDose && isAttenuatedClass) ? 0.35 : 1.0;

            lvefDelta += chf.lvef_improvement_absolute;
            // Caps mirror the remove path exactly (BNP_CAP / 0.5 / 0.3) so add-then-remove is a
            // true inverse. No current formulary drug reaches a cap — this is defensive symmetry.
            bnpFactor *= (1 - Math.min(BNP_CAP, chf.bnp_reduction_percent));
            weightDelta += chf.weight_reduction_kg;
            if (getMedicationClassGroup(mod.target.med.drug_class) === 'GLP-1 Therapy') glp1WeightDelta += chf.weight_reduction_kg;
            kccqDelta += chf.kccq_improvement;
            if (chf.lavi_reduction_percent > 0) laviFactorTotal *= (1 - Math.min(0.5, chf.lavi_reduction_percent));
            if (chf.lvedd_reduction_percent && chf.lvedd_reduction_percent > 0) lveddFactorTotal *= (1 - Math.min(0.3, chf.lvedd_reduction_percent));

            sbpDelta += hemo.sbp_drop * hemoFactor;
            dbpDelta += hemo.sbp_drop * hemoFactor * getDbpRatio(mod.target.med.drug_class);
            hrDelta += hrDropFor(mod.target.med, hemo.hr_drop, currentPatient);
            if (hemo.potassium_change > 0) {
                kDelta += (hemo.potassium_change * renalRiskFactor);
            } else {
                kDelta += hemo.potassium_change;
            }

            rationale.push(`+ ${mod.target.med.name}: ${mod.summary}`);
        }

        if (mod.action === 'remove' && mod.source) {
            const { chf, hemo } = effectsFor(mod.source, currentPatient);

            // Reverse the removed drug's effects
            lvefDelta -= chf.lvef_improvement_absolute;
            const cappedReduction = Math.min(BNP_CAP, chf.bnp_reduction_percent);
            bnpFactor /= (1 - cappedReduction);
            weightDelta -= chf.weight_reduction_kg;
            if (getMedicationClassGroup(mod.source.med.drug_class) === 'GLP-1 Therapy') glp1WeightDelta -= chf.weight_reduction_kg;
            kccqDelta -= chf.kccq_improvement;
            if (chf.lavi_reduction_percent > 0) laviFactorTotal /= (1 - Math.min(0.5, chf.lavi_reduction_percent));
            if (chf.lvedd_reduction_percent && chf.lvedd_reduction_percent > 0) lveddFactorTotal /= (1 - Math.min(0.3, chf.lvedd_reduction_percent));

            sbpDelta -= hemo.sbp_drop;
            dbpDelta -= hemo.sbp_drop * getDbpRatio(mod.source.med.drug_class);
            hrDelta -= hrDropFor(mod.source.med, hemo.hr_drop, currentPatient);
            if (hemo.potassium_change > 0) {
                kDelta -= (hemo.potassium_change * renalRiskFactor);
            } else {
                kDelta -= hemo.potassium_change;
            }

            rationale.push(`- ${mod.source.med.name}: ${mod.summary}`);

            // Abrupt beta-blocker withdrawal is Class III harm (rebound tachycardia, ischemia,
            // arrhythmia). Whenever a BB is discontinued, attach explicit taper guidance — the
            // acute-decompensation path already tapers via dose reduction; the contraindication
            // removal path previously dropped the BB with no instruction.
            if (mod.source.med.drug_class === 'Beta Blocker') {
                warnings.push('BETA-BLOCKER DISCONTINUATION: Do NOT stop abruptly — taper over ~1-2 weeks with HR/symptom monitoring (abrupt withdrawal risks rebound tachycardia, ischemia, and arrhythmia). If the reason is bronchospasm and asthma is not severe, a low-dose β1-selective agent (bisoprolol/metoprolol succinate) may be tolerated.');
            }
        }

        if ((mod.action === 'titrate_up' || mod.action === 'titrate_down') && mod.source && mod.target) {
            const { chf: oldChf, hemo: oldHemo } = effectsFor(mod.source, currentPatient);
            const { chf: newChf, hemo: newHemo } = effectsFor(mod.target, currentPatient);

            lvefDelta += (newChf.lvef_improvement_absolute - oldChf.lvef_improvement_absolute);

            const oldCapped = Math.min(BNP_CAP, oldChf.bnp_reduction_percent);
            const newCapped = Math.min(BNP_CAP, newChf.bnp_reduction_percent);
            bnpFactor *= (1 - newCapped) / (1 - oldCapped);

            weightDelta += (newChf.weight_reduction_kg - oldChf.weight_reduction_kg);
            if (getMedicationClassGroup(mod.target.med.drug_class) === 'GLP-1 Therapy') glp1WeightDelta += (newChf.weight_reduction_kg - oldChf.weight_reduction_kg);
            kccqDelta += (newChf.kccq_improvement - oldChf.kccq_improvement);

            if (newChf.lavi_reduction_percent > 0 || oldChf.lavi_reduction_percent > 0) {
                const oldLavi = Math.min(0.5, oldChf.lavi_reduction_percent);
                const newLavi = Math.min(0.5, newChf.lavi_reduction_percent);
                laviFactorTotal *= (1 - newLavi) / (1 - oldLavi);
            }
            if ((newChf.lvedd_reduction_percent && newChf.lvedd_reduction_percent > 0) || (oldChf.lvedd_reduction_percent && oldChf.lvedd_reduction_percent > 0)) {
                const oldLvedd = Math.min(0.3, oldChf.lvedd_reduction_percent ?? 0);
                const newLvedd = Math.min(0.3, newChf.lvedd_reduction_percent ?? 0);
                lveddFactorTotal *= (1 - newLvedd) / (1 - oldLvedd);
            }

            sbpDelta += (newHemo.sbp_drop - oldHemo.sbp_drop);
            dbpDelta += (newHemo.sbp_drop - oldHemo.sbp_drop) * getDbpRatio(mod.target.med.drug_class);
            hrDelta += hrDropFor(mod.target.med, newHemo.hr_drop, currentPatient) - hrDropFor(mod.source.med, oldHemo.hr_drop, currentPatient);

            const oldK = oldHemo.potassium_change > 0 ? oldHemo.potassium_change * renalRiskFactor : oldHemo.potassium_change;
            const newK = newHemo.potassium_change > 0 ? newHemo.potassium_change * renalRiskFactor : newHemo.potassium_change;
            kDelta += (newK - oldK);

            const arrow = mod.action === 'titrate_up' ? '↑' : '↓';
            rationale.push(`${arrow} ${mod.target.med.name}: ${mod.summary}`);
        }

        if (mod.action === 'swap' && mod.source && mod.target) {
            // Mandatory swap bonus: swapping FROM a contraindicated OR documented-intolerable med
            // preserves drug class coverage (better than outright removal which loses the class
            // entirely) — without it, a pillar-dropping bare removal can out-rank the swap.
            const isContraindicatedSwap = mod.source.med.contraindications?.(currentPatient) === true;
            const isIntoleranceSwap = !isContraindicatedSwap && currentMedIntoleranceReason(mod.source.med, intolerancePolicy) !== null;
            if (isContraindicatedSwap || isIntoleranceSwap) {
                specialFeatureBonus += 15;
                specialFeatureItems.push({
                    med: mod.target.med.name,
                    feature: `Mandatory swap from ${isContraindicatedSwap ? 'contraindicated' : 'intolerance-documented'} ${mod.source.med.name}`,
                    points: 15,
                });
                const cause = isContraindicatedSwap ? 'contraindicated' : 'intolerance-documented';
                rationale.push(`+ SAFETY: Mandatory swap from ${cause} ${mod.source.med.name} preserves ${getMedicationClassGroup(mod.source.med.drug_class)} coverage`);
            }

            const { chf: oldChf, hemo: oldHemo } = effectsFor(mod.source, currentPatient);
            const { chf: newChf, hemo: newHemo } = effectsFor(mod.target, currentPatient);

            lvefDelta += (newChf.lvef_improvement_absolute - oldChf.lvef_improvement_absolute);

            const oldCapped = Math.min(BNP_CAP, oldChf.bnp_reduction_percent);
            const newCapped = Math.min(BNP_CAP, newChf.bnp_reduction_percent);
            bnpFactor *= (1 - newCapped) / (1 - oldCapped);

            weightDelta += (newChf.weight_reduction_kg - oldChf.weight_reduction_kg);
            if (getMedicationClassGroup(mod.source.med.drug_class) === 'GLP-1 Therapy') glp1WeightDelta -= oldChf.weight_reduction_kg;
            if (getMedicationClassGroup(mod.target.med.drug_class) === 'GLP-1 Therapy') glp1WeightDelta += newChf.weight_reduction_kg;
            kccqDelta += (newChf.kccq_improvement - oldChf.kccq_improvement);

            if (newChf.lavi_reduction_percent > 0 || oldChf.lavi_reduction_percent > 0) {
                const oldLavi = Math.min(0.5, oldChf.lavi_reduction_percent);
                const newLavi = Math.min(0.5, newChf.lavi_reduction_percent);
                laviFactorTotal *= (1 - newLavi) / (1 - oldLavi);
            }
            if ((newChf.lvedd_reduction_percent && newChf.lvedd_reduction_percent > 0) || (oldChf.lvedd_reduction_percent && oldChf.lvedd_reduction_percent > 0)) {
                const oldLvedd = Math.min(0.3, oldChf.lvedd_reduction_percent ?? 0);
                const newLvedd = Math.min(0.3, newChf.lvedd_reduction_percent ?? 0);
                lveddFactorTotal *= (1 - newLvedd) / (1 - oldLvedd);
            }

            // Swap DBP: remove old drug's contribution, add new drug's
            dbpDelta -= oldHemo.sbp_drop * getDbpRatio(mod.source.med.drug_class);
            dbpDelta += newHemo.sbp_drop * getDbpRatio(mod.target.med.drug_class);
            sbpDelta += (newHemo.sbp_drop - oldHemo.sbp_drop);
            hrDelta += hrDropFor(mod.target.med, newHemo.hr_drop, currentPatient) - hrDropFor(mod.source.med, oldHemo.hr_drop, currentPatient);

            const oldK = oldHemo.potassium_change > 0 ? oldHemo.potassium_change * renalRiskFactor : oldHemo.potassium_change;
            const newK = newHemo.potassium_change > 0 ? newHemo.potassium_change * renalRiskFactor : newHemo.potassium_change;
            kDelta += (newK - oldK);

            rationale.push(`↔ ${mod.source.med.name} → ${mod.target.med.name}: ${mod.summary}`);
        }
    });

    // --- Synergy: only apply when modification CREATES the synergy condition ---
    // Check if current regimen already had these synergies
    const currentClasses = new Set((currentPatient.current_regimen || []).map(r => r.med.drug_class));
    const currentHasQuad = (currentClasses.has('ARNI') || currentClasses.has('ACEi') || currentClasses.has('ARB'))
        && currentClasses.has('Beta Blocker') && (currentClasses.has('MRA') || currentClasses.has('nsMRA')) && currentClasses.has('SGLT2i');
    const currentHasDiureticSGLT2 = (currentClasses.has('Loop Diuretic') || currentClasses.has('Thiazide-like Diuretic')) && currentClasses.has('SGLT2i');

    if (hasSGLT2 && hasDiuretic && !currentHasDiureticSGLT2) {
        // The synergy models enhanced DIURESIS — apply it to the fluid portion of the weight
        // delta only, not to GLP-1 adiposity loss (SGLT2i does not amplify tissue loss).
        weightDelta = (weightDelta - glp1WeightDelta) * 1.2 + glp1WeightDelta;
        rationale.push("Synergy: SGLT2i enhances Loop Diuretic efficiency");
    }

    if (hasRAAS && hasBeta && hasMRA && hasSGLT2 && !currentHasQuad) {
        lvefDelta += 3;
        kccqDelta += 5;
        rationale.push("QUADRUPLE THERAPY (The 4 Pillars): Maximal survival benefit");
    }

    // Special features from resulting regimen
    resultingRegimen.forEach(r => {
        if (r.med.special_features) {
            r.med.special_features.forEach(sf => {
                if (sf.criteria(currentPatient, resultingRegimen)) {
                    const sfPoints = sf.points_for_dose ? sf.points_for_dose(r.dose.strength) : sf.points;
                    rationale.push(`+ ${r.med.name}: ${sf.feature}`);
                    specialFeatureBonus += sfPoints;
                    specialFeatureItems.push({ med: r.med.name, feature: sf.feature, points: sfPoints });
                }
            });
        }

        // Uric-acid caution as data: any drug declaring facts.raises_uric_acid (loops and thiazide-type diuretics; labels: may precipitate gout).
        if (drugFacts(r.med).raises_uric_acid && currentPatient.comorbidities.has('Gout')) {
            const feature = 'Caution in Gout (uric acid retention)';
            rationale.push(`+ ${r.med.name}: ${feature}`);
            specialFeatureBonus += URIC_ACID_GOUT_POINTS;
            specialFeatureItems.push({ med: r.med.name, feature, points: URIC_ACID_GOUT_POINTS });
            const goutNote = 'Drug note (2026 ESC Supplementary Table S7): with gout on a loop or thiazide-type diuretic, consider allopurinol prophylaxis, use colchicine for an acute attack, and avoid NSAIDs.';
            if (!warnings.includes(goutNote)) warnings.push(goutNote);
        }

        // Rationale for target dose and clinical effects
        const chf = effectsFor(r, currentPatient).chf;
        const isTarget = isTargetDoseForPatient(r, currentPatient);
        if (isTarget) rationale.push(`+ ${r.med.name}: Achieves GDMT Target Dose`);
        if (chf.lvef_improvement_absolute >= 3) rationale.push(`+ ${r.med.name}: Significant Reverse Remodeling`);
        if (chf.lvedd_reduction_percent && chf.lvedd_reduction_percent >= 0.05) {
            rationale.push(`+ ${r.med.name}: LV Size Reduction (LVEDD -${(chf.lvedd_reduction_percent * 100).toFixed(0)}%)`);
        }
        if (r.med.drug_class.includes('GLP')) rationale.push(`+ ${r.med.name}: Metabolic/Adiposity Reduction`);
        else if (chf.weight_reduction_kg >= 1.0) rationale.push(`+ ${r.med.name}: Volume Unloading`);
    });

    // Deduplicate rationale
    const uniqueRationale = [...new Set(rationale)];

    // --- Apply Deltas to Projected Patient ---

    // Structure — LVEF attenuation: diminishing returns prevent unrealistic stacking
    // Quad therapy raw deltas (e.g. +27%) are compressed via exponential saturation.
    // Max recovery = gap to normal (55%); can't project above physiological ceiling.
    //
    // The 0.7 scaling factor calibrates the exponential curve against aggregate LVEF
    // recovery data from landmark trials:
    //   - PROVE-HF (sacubitril/valsartan): mean LVEF improvement +5.2% at 12 months
    //   - DAPA-HF (dapagliflozin): mean LVEF improvement +2.4% vs placebo
    //   - EMPHASIS-HF (eplerenone): mean LVEF improvement ~+2% vs placebo
    //   Stacking all 4 pillars suggests ~10-15% raw improvement in severe HFrEF, but
    //   observed LVEF recoveries beyond 15% absolute are rare outside HFimpEF.
    //   At 0.7, the model yields ~65% capture of raw delta at half-maxRecovery,
    //   preventing quad therapy on LVEF 20 from projecting above ~40%.
    const maxLvefRecovery = Math.max(5, 55 - currentPatient.lvef);
    const attenuatedLvefDelta = lvefDelta > 0
        ? maxLvefRecovery * (1 - Math.exp(-lvefDelta / (maxLvefRecovery * 0.7)))
        : lvefDelta; // Negative deltas (removal) pass through unattenuated
    // Ceiling never pulls BELOW baseline: for baselines > 55 (ordinary HFpEF values) a zero or
    // positive delta holds at baseline — the old unconditional Math.min(55, ...) fabricated a
    // projected EF DECLINE (e.g. 60 → 55) and a false "EF may decline" caution on every
    // candidate. Genuine negative deltas (therapy removal) still pass through.
    proj.lvef = Math.min(Math.max(55, currentPatient.lvef), currentPatient.lvef + attenuatedLvefDelta);

    // Cardiac output compensation for HFrEF:
    // In severely reduced LVEF, afterload reduction from GDMT improves forward flow
    // (Frank-Starling mechanism), partially offsetting the vasodilatory BP drop.
    // This is why GDMT can be safely initiated at SBP 90-100 in HFrEF.
    //
    // Constants (0.35 SBP offset, 0.4 LVEF scaling):
    //   - 0.35: Up to 35% of the SBP drop is recaptured through improved cardiac output.
    //     Frank-Starling: reduced afterload in a dilated, failing ventricle moves the
    //     operating point up the curve, increasing stroke volume. Net BP drop is less
    //     than the direct vasodilatory effect.
    //   - 0.4: The compensation is also capped at 40% of the LVEF improvement (in mmHg
    //     equivalent), preventing over-correction in scenarios with large projected LVEF
    //     gains but modest SBP drops.
    //   - COPERNICUS: Enrolled patients with SBP ≥ 85; carvedilol was safe and beneficial
    //     despite very low baseline LVEF, demonstrating CO compensation in practice.
    //   - PIONEER-HF: Enrolled SBP ≥ 100 in-hospital; sacubitril/valsartan showed less
    //     hypotension than expected from its vasodilatory potency, consistent with CO offset.
    // M7: Extended to LVEF < 50 (HFmrEF) with attenuated factor — Frank-Starling applies across
    // the reduced EF spectrum, but effect diminishes as LVEF approaches normal.
    //
    // SAFETY CHANGE: Forward-flow (Frank-Starling) compensation is real physiology in the
    // aggregate, but it is an UNCALIBRATED estimate for any individual. Previously this term
    // was subtracted from sbpDelta, raising the projected SBP — which could lift a fragile
    // patient's projected SBP across the display/penalty floors and manufacture apparent
    // safety from a constant. We now keep the projected SBP CONSERVATIVE (pre-compensation)
    // for every safety gate and display, and surface the compensation as an informational
    // note only. The note never feeds a threshold decision.
    if (currentPatient.lvef < 50 && attenuatedLvefDelta > 0 && sbpDelta > 0) {
        // Full 0.35 offset for LVEF < 40; linearly attenuated to 0.15 at LVEF 50
        const coFactor = currentPatient.lvef < 40
            ? 0.35
            : 0.35 - (currentPatient.lvef - 40) / 10 * 0.20; // 40→0.35, 45→0.25, 50→0.15
        const coCompensation = Math.min(sbpDelta * coFactor, attenuatedLvefDelta * 0.4);
        if (coCompensation >= 1) {
            uniqueRationale.push(
                `Physiology note: improved forward flow (Frank-Starling) may offset roughly ${coCompensation.toFixed(0)} mmHg of the projected BP drop in a recovering ventricle. This is NOT applied to safety thresholds — the projected BP shown is the conservative (pre-compensation) estimate.`
            );
        }
    }

    if (currentPatient.lavi) {
        proj.lavi = Math.max(15, currentPatient.lavi * laviFactorTotal);
    }
    if (currentPatient.lvedd) {
        proj.lvedd = Math.max(35, currentPatient.lvedd * lveddFactorTotal);
    }

    // Neurohormonal (multiplicative factor applied to current BNP)
    const effectiveBnpFactor = Math.max(0.15, bnpFactor);
    proj.nt_pro_bnp = Math.max(50, currentPatient.nt_pro_bnp * effectiveBnpFactor);

    // Functional
    proj.kccq_score = Math.min(100, currentPatient.kccq_score + kccqDelta);
    if (kccqDelta > 20 && proj.nyha_class === 'IV') proj.nyha_class = 'III';
    else if (kccqDelta > 20 && proj.nyha_class === 'III') proj.nyha_class = 'II';
    else if (kccqDelta > 20 && proj.nyha_class === 'II') proj.nyha_class = 'I';

    // Volume & Hemodynamics
    let dryWeightAdjusted = currentPatient.volume_status.dry_weight_kg;
    // Only the GLP-1 portion of the marginal weight change is dry-weight (tissue/adiposity)
    // loss — diuretic deltas are pure fluid. The previous form (weightDelta * 0.5 whenever a
    // GLP-1 was merely PRESENT in the regimen) reclassified half of other drugs' fluid loss
    // as tissue, and a diuretic removal alongside a kept GLP-1 nonsensically RAISED dry
    // weight. glp1WeightDelta is 0 when no GLP-1 changed; its sign handles GLP-1 removal
    // (tissue regain) symmetrically.
    dryWeightAdjusted -= glp1WeightDelta * 0.5;
    const projectedWeight = currentPatient.volume_status.current_weight_kg - weightDelta;

    const finalSbp = currentPatient.sbp - sbpDelta;
    const finalDbp = currentPatient.dbp - dbpDelta; // Drug-class-specific ratio (Finding 12)
    const map = (finalSbp + (2 * finalDbp)) / 3;

    const currentFluidExcess = currentPatient.volume_status.current_weight_kg - currentPatient.volume_status.dry_weight_kg;
    const isCongested = currentFluidExcess > 1.0;

    if (isCongested && weightDelta > 1.0) {
        uniqueRationale.push("Renal Benefit: Decongestion improves renal venous outflow");
    }

    if (map < 65) {
        warnings.push(`Low Perfusion Pressure (MAP ${map.toFixed(0)} mmHg) - Risk of AKI`);
        if (lvefDelta < 5) {
            proj.nt_pro_bnp = proj.nt_pro_bnp * 1.2;
        } else {
            uniqueRationale.push("Physiology Note: Forward flow improvement offsets low MAP risk");
        }
    }

    const safetyFloor = dryWeightAdjusted - 2.0;
    if (projectedWeight < safetyFloor) {
        warnings.push(`Caution: Rapid Weight Loss (${Math.abs(currentPatient.volume_status.current_weight_kg - projectedWeight).toFixed(1)}kg) - Monitor hydration`);
        proj.nt_pro_bnp = proj.nt_pro_bnp * 1.3;
        if (map < 70) {
            warnings.push("Hypovolemic Hypotension Risk: Reduce diuretic dose");
        }
    }

    proj.volume_status.current_weight_kg = Math.max(dryWeightAdjusted - 2, projectedWeight);
    proj.volume_status.dry_weight_kg = dryWeightAdjusted;

    if (proj.volume_status.current_weight_kg <= dryWeightAdjusted + 0.5) {
        proj.volume_status.exam_findings.clear();
    }

    // M6: Physiologic floor — prevent model artifacts (negative/zero) from misleading NPs
    proj.sbp = Math.max(60, finalSbp);
    proj.dbp = Math.max(30, finalDbp);
    proj.pulse = Math.max(30, currentPatient.pulse - hrDelta);
    // Unknown baseline K+ (blank/0) must not flow into projected-K+ math — 0 + kDelta would
    // fire fabricated hypokalemia warnings and print "projected K+ 0.0" into clinician-facing
    // DDI text. The unknown sentinel is preserved; the dedicated POTASSIUM UNKNOWN pathway
    // (audit alert + RAAS/MRA caution penalty) governs instead.
    const kUnknown = valueUnknown(currentPatient.potassium);
    proj.potassium = kUnknown ? currentPatient.potassium : currentPatient.potassium + kDelta;

    // --- Titration Timeline Warning ---
    const newAdds = modificationSet.modifications.filter(m => m.action === 'add');
    const titrations = modificationSet.modifications.filter(m => m.action === 'titrate_up');
    if (newAdds.length >= 2) {
        const targetAdds = newAdds.filter(m => m.target && isTargetDoseForPatient(m.target, currentPatient));
        if (targetAdds.length >= 2) {
            warnings.push('Multiple new medications at target dose. In practice, initiate at low dose and titrate every 1-2 weeks, not faster than every 2 weeks without close monitoring (2026 ESC).');
        }
    }
    // D9: Single-agent titration interval guidance
    if (titrations.length > 0 && newAdds.length === 0) {
        warnings.push('Titration Interval: Up-titrate every 1-2 weeks (2026 ESC Table 5); doses are doubled at intervals of not less than 2 weeks without close monitoring (Supplementary Tables S4-S6, S8). Recheck BP, HR, and labs (BMP) before each uptitration step.');
    }

    // --- P3: Age-adjusted warnings ---
    if (currentPatient.age > 75 && newAdds.length > 0) {
        warnings.push('Elderly patient (>75): Start low, go slow. Titrate new agents q4-6 weeks with orthostatic BP checks.');
    }
    if (currentPatient.age > 80 && currentPatient.egfr < 45 && newAdds.length > 0) {
        warnings.push('Frail elderly with CKD: Monitor renal function and electrolytes weekly during titration.');
    }

    // --- Safety Checks ---
    if (proj.sbp < 90) warnings.push('Risk of Hypotension (SBP < 90)');
    if (proj.pulse < 50) warnings.push('Risk of Bradycardia (HR < 50)');

    if (!kUnknown) {
        if (proj.potassium > 6.0) {
            warnings.push('CRITICAL: Severe Hyperkalemia Risk (K+ > 6.0)');
        } else if (proj.potassium > 5.5) {
            warnings.push('DANGER: High Hyperkalemia Risk (K+ > 5.5)');
        } else if (proj.potassium > 5.2) {
            warnings.push('Caution: Elevated Potassium (K+ > 5.2). Monitor closely.');
        } else if (proj.potassium > 5.0 && hasMRA) {
            warnings.push('Monitor: K+ > 5.0 with MRA. Check potassium within 1 week; consider Patiromer if rising.');
        } else if (proj.potassium < HYPOKALEMIA_K_BELOW) {
            warnings.push(`Risk of Hypokalemia (K+ < ${HYPOKALEMIA_K_BELOW})`);
        }
    }

    // D2: MRA initiation at the potassium start limit. A NEW MRA above potassium 5.0 never reaches here (rule E15 withholds it with or
    // without a binder; verified-clinical-decisions-2026-11-11.md rows 1, 2a, 2c); a start at exactly 5.0 is the highest the guideline start
    // criterion (K < 5.0, secondary reproduction) and the labels (K <= 5.0) allow, so it carries the monitoring instruction. Counted as a
    // residual-risk warning (penalized).
    const isMraInitiation = modificationSet.modifications.some(m =>
        m.action === 'add' && m.target && (m.target.med.drug_class === 'MRA' || m.target.med.drug_class === 'nsMRA')
    );
    if (isMraInitiation && currentPatient.potassium >= 5.0 && currentPatient.potassium <= 5.5) {
        warnings.push(
            'MRA INITIATION AT THE POTASSIUM START LIMIT: Baseline potassium is ' + currentPatient.potassium.toFixed(1) +
            ' mEq/L, the highest at which the labels and the guideline start criterion allow an MRA start. ' +
            'Check potassium within 1 week and again at about 4 weeks (labels and guideline); reduce the MRA one dose step if potassium rises above 5.5 and withhold it at 6.0 or above.'
        );
    }

    // Drug-specific regimen warnings declared as data on the formulary entry (facts.regimen_warnings).
    resultingRegimen.forEach(r => {
        drugFacts(r.med).regimen_warnings?.forEach(w => {
            if (!w.when || w.when(currentPatient, resultingRegimen)) warnings.push(typeof w.text === 'function' ? w.text(currentPatient) : w.text);
        });
    });

    if (raasCount > 1) {
        warnings.push("CONTRAINDICATION: Dual RAAS blockade (ACEi + ARB/ARNI) increases renal risk without benefit.");
    }

    // H1: ARB + angioedema history → mandatory monitoring warning (ACC/AHA: "use with caution")
    const hasARBinRegimen = resultingRegimen.some(r => r.med.drug_class === 'ARB');
    const angioedemaRiskPresent = currentPatient.comorbidities.has("History of Angioedema") ||
        currentPatient.discontinued_meds.some(dm => {
            const text = `${dm.reason} ${dm.reason_detail ?? ''}`.toLowerCase();
            return text.includes('angioedema') && RAAS_CLASSES.has(dm.drug_class);
        });
    if (hasARBinRegimen && angioedemaRiskPresent) {
        warnings.push(
            'ANGIOEDEMA CAUTION: ARB prescribed with prior angioedema history. Cross-reactivity risk is low (~2-8%) but not zero. ' +
            'Initiate in a monitored setting. Ensure patient has epinephrine auto-injector. Educate on angioedema signs (lip/tongue swelling). ' +
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
        const selectiveBB = resultingRegimen.find(r =>
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
            const mraName = resultingRegimen.find(r => r.med.drug_class === 'MRA' || r.med.drug_class === 'nsMRA')?.med.name;
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

    const bunCrRatio = currentPatient.creatinine > 0 ? currentPatient.bun / currentPatient.creatinine : 0;
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

    // Penalized caution when a drug declaring facts.hypokalemia_caution_below_k is ADDED (or swapped in) with a known baseline K+ below its level.
    if (!kUnknown) {
        modificationSet.modifications.forEach(mod => {
            const tgt = (mod.action === 'add' || mod.action === 'swap') ? mod.target : undefined;
            const rule = tgt ? drugFacts(tgt.med).hypokalemia_caution_below_k : undefined;
            if (tgt && rule && currentPatient.potassium < rule.k) {
                warnings.push(`HYPOKALEMIA CAUTION: ${tgt.med.name} lowers potassium and the baseline K+ is ${currentPatient.potassium} (below ${rule.k}). Replete potassium first or monitor closely; check electrolytes within days of starting (${rule.basis}).`);
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

    // DDI-2: RAAS + chronic NSAID use → AKI risk (extremely common outpatient DDI)
    if (hasRAASDrug && currentPatient.comorbidities.has('Chronic NSAID Use')) {
        warnings.push('DDI WARNING: RAAS inhibitor + chronic NSAID use significantly increases AKI risk. Discontinue NSAIDs if possible. If unavoidable, monitor creatinine and potassium weekly.');
    }

    // DDI-3: Digoxin + loop diuretic without K+ protection → toxicity
    // (Already partially covered by kNote above, but reinforce with formal DDI language.)
    // When baseline K+ is unknown the interaction risk is still real, but a fabricated
    // "projected K+ 0.0" must never be printed — prompt for the BMP instead.
    if (hasDigoxin && hasDiuretic && !hasMRA) {
        if (kUnknown) {
            warnings.push('DDI WARNING: Digoxin + loop diuretic without potassium-sparing agent — hypokalemia potentiates digoxin toxicity (arrhythmia, Torsade de Pointes). Baseline K+ is not entered: obtain a BMP before relying on this regimen.');
        } else if (proj.potassium < 4.0) {
            warnings.push('DDI WARNING: Digoxin + loop diuretic without potassium-sparing agent. Hypokalemia (projected K+ ' + proj.potassium.toFixed(1) + ') potentiates digoxin toxicity (arrhythmia, Torsade de Pointes). Add MRA or supplement potassium.');
        }
    }

    // DDI-4: Digoxin + amiodarone markedly raises digoxin exposure.
    if (hasDigoxin && onAmiodarone) {
        warnings.push('DDI WARNING: Amiodarone raises serum digoxin concentrations (Lanoxin label: about 70%). Reduce the digoxin dose by about 30-50% (or change the dosing frequency) and keep monitoring serum digoxin levels.');
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

    return { projectedPatient: proj, cost: totalCost, complexity: complexityScore, warnings, rationale: uniqueRationale, specialFeatureBonus, specialFeatureItems };
}

// --- 4. Delta-from-Current Entry Point ---
