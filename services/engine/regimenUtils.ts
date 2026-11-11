/** Small regimen/patient helpers shared by the candidate, effects and scoring stages. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, Medication, ScoredRegimen, RegimenMed, ModificationSet } from '../../types';
import { hasUnknownHistoricalHFrEF } from '../clinicalPredicates';
import { getMedicationClassGroup, isDiureticClass } from './registry';
import { drugFacts } from './drugFacts';

// --- Helper Functions ---
const DOSES_PER_DAY: Record<string, number> = { qd: 1, bid: 2, tid: 3 };

/** Doses per day for a frequency code (unknown codes count as once daily). */
export function dosesPerDay(frequency: string): number {
    return DOSES_PER_DAY[frequency] ?? 1;
}

/**
 * TOTAL DAILY dose (strength x doses per day) of a regimen entry, in the entry's dose unit; NaN for a combination strength
 * ("24/26"). Loop-diuretic effects, the high-dose alert and the declared daily maximum (`facts.max_daily_dose`) all use this,
 * never the per-dose strength (a loop is dosed and labeled in mg per day: furosemide label "up to 600 mg/day").
 */
export function dailyDose(r: RegimenMed): number {
    return Number(r.dose.strength) * dosesPerDay(r.selected_frequency);
}

/** The dose the entry's effect functions are evaluated at: the daily dose when `facts.effects_on_daily_dose`, else the strength. */
export function effectDose(r: RegimenMed): number | string {
    return drugFacts(r.med).effects_on_daily_dose ? dailyDose(r) : r.dose.strength;
}

/** Frequencies of `options` whose daily dose at `strength` stays within the entry's declared `facts.max_daily_dose` (all when none declared). */
export function frequenciesWithinMax(med: Medication, options: string[], strength: number | string): string[] {
    const max = drugFacts(med).max_daily_dose;
    const s = Number(strength);
    if (max === undefined || Number.isNaN(s)) return options;
    return options.filter(f => s * dosesPerDay(f) <= max);
}

export function pickPreferredFrequency(med: Medication, options: string[], patient: Patient, strength?: number | string): string {
    if (options.length === 0) return 'qd';
    // Never offer a dose x frequency above the label's maximum total daily dose (bumetanide 10 mg/day: 4 mg tid would be 12).
    const allowed = strength === undefined ? options : frequenciesWithinMax(med, options, strength);
    const usable = allowed.length > 0 ? allowed : [options[0]];

    // Severe CKD reduces loop delivery to the nephron. Prefer split dosing at low eGFR.
    if (med.drug_class === 'Loop Diuretic' && patient.egfr < 20) {
        if (usable.includes('tid')) return 'tid';
        if (usable.includes('bid')) return 'bid';
    }

    return usable[0];
}

/**
 * Titration of a drug dosed by TOTAL DAILY dose (`facts.effects_on_daily_dose`) keeps the patient's current dosing frequency when it moves to
 * another strength (80 mg bid -> 160 mg bid, not 160 mg once daily, which would credit no change). Never above the declared daily maximum
 * or the tier's own frequency options. Other drugs keep the tier's preferred frequency.
 */
export function carryFrequency(tier: RegimenMed, current: RegimenMed): RegimenMed {
    if (!drugFacts(tier.med).effects_on_daily_dose) return tier;
    const want = dosesPerDay(current.selected_frequency);
    const have = dosesPerDay(tier.selected_frequency);
    if (want <= have) return tier;
    const best = frequenciesWithinMax(tier.med, tier.dose.frequency_options, tier.dose.strength)
        .filter(f => dosesPerDay(f) <= want && dosesPerDay(f) > have)
        .sort((x, y) => dosesPerDay(y) - dosesPerDay(x))[0];
    return best ? { ...tier, selected_frequency: best } : tier;
}

export function getDoseTiers(med: Medication, patient: Patient): RegimenMed[] {
    const adjustment = med.renal_adjustment ? med.renal_adjustment(patient.egfr, patient) : {};
    const interactionCap = med.interaction_dose_cap?.(patient)?.max_dose;
    const maxDose = interactionCap !== undefined
        ? Math.min(adjustment.max_dose ?? Infinity, interactionCap)
        : adjustment.max_dose;
    const validDoses = med.available_doses.filter(dose => {
        // A strength whose every allowed frequency exceeds the declared maximum total daily dose is never offered.
        if (frequenciesWithinMax(med, dose.frequency_options, dose.strength).length === 0) return false;
        if (typeof dose.strength === 'number') {
            return !(maxDose && dose.strength > maxDose);
        }
        return true;
    });

    if (validDoses.length === 0) return [];

    // P3: Age-adjusted dosing — elderly patients (>80) limited to lower dose tiers
    let dosesForTiering = validDoses;
    if (patient.age > 80 && validDoses.length > 2) {
        // Limit to bottom half of dose range (start low, go slow)
        dosesForTiering = validDoses.slice(0, Math.max(2, Math.ceil(validDoses.length / 2)));
    }

    // One-step titration drugs (facts.titrate_one_step: weekly GLP-1 / GLP-1-GIP agents) offer EVERY labeled tier, so the next
    // step is always available and titratableUp can offer exactly one step; the sampler below would skip steps.
    if (drugFacts(med).titrate_one_step) {
        return dosesForTiering.map(dose => ({
            med, dose, selected_frequency: pickPreferredFrequency(med, dose.frequency_options, patient, dose.strength)
        }));
    }

    // Return lowest, middle, and highest dose for simulation efficiency
    let tiers = [dosesForTiering[0]];
    if (dosesForTiering.length > 1) tiers.push(dosesForTiering[dosesForTiering.length - 1]);
    if (dosesForTiering.length > 2) tiers.push(dosesForTiering[Math.floor(dosesForTiering.length / 2)]);

    // Always include the guideline TARGET dose as a tier (when not age-restricted away). Without
    // it, titration could only land on the sampled lowest/middle/highest — e.g. carvedilol would
    // offer →12.5 or →50 but never its target 25 — so "titrate to target" was never a candidate
    // and the engine defaulted to "keep" for a sub-target regimen.
    const targetDose = dosesForTiering.find(d => d.is_target_dose);
    if (targetDose) tiers.push(targetDose);

    // Unique only
    tiers = [...new Set(tiers)];

    return tiers.map(dose => ({
        med,
        dose,
        selected_frequency: pickPreferredFrequency(med, dose.frequency_options, patient, dose.strength)
    }));
}

/**
 * Opt-in "new starts never begin above the start dose" (Medication.start_dose_for). For a drug that declares it,
 * keep only the offered tiers at or below the start strength (a LOWER start is allowed: start low, go slow, unless the
 * drug sets facts.start_dose_exact, when only the start tier itself is kept);
 * if none qualifies, the lowest offered tier. Other drugs pass through. Apply to NEW-START candidates only;
 * titration of a drug already on board uses the full tier list.
 */
export function restrictToStartTiers(tiers: RegimenMed[], patient: Patient): RegimenMed[] {
    const byMed = new Map<string, RegimenMed[]>();
    tiers.forEach(t => {
        if (!byMed.has(t.med.name)) byMed.set(t.med.name, []);
        byMed.get(t.med.name)!.push(t);
    });
    const keep = new Set<RegimenMed>();
    byMed.forEach(medTiers => {
        const med = medTiers[0].med;
        if (!med.start_dose_for) { medTiers.forEach(t => keep.add(t)); return; }
        const order = med.available_doses;
        const idx = (t: RegimenMed) => order.findIndex(d => d.strength === t.dose.strength);
        const startIdx = order.findIndex(d => String(d.strength) === String(med.start_dose_for!(patient)));
        const exact = drugFacts(med).start_dose_exact === true;
        const allowed = startIdx < 0 ? [] : medTiers.filter(t => exact ? idx(t) === startIdx : idx(t) <= startIdx);
        if (allowed.length > 0) { allowed.forEach(t => keep.add(t)); return; }
        keep.add([...medTiers].sort((a, b) => idx(a) - idx(b))[0]);
    });
    return tiers.filter(t => keep.has(t));
}

/**
 * Potassium rule for a drug the patient is already on (facts.k_continuation): 'reduce' at K+ >= reduce_at and
 * < withhold_at (one dose step; withhold if already at the lowest tier), 'withhold' at K+ >= withhold_at.
 * Blank potassium (0) never triggers. Returns the plain-language reason the clinician sees.
 */
export function kContinuationAction(med: Medication, patient: Patient): { action: 'reduce' | 'withhold'; reason: string } | null {
    const rule = med.facts?.k_continuation;
    if (!rule || !(patient.potassium > 0)) return null;
    const k = patient.potassium.toFixed(1);
    if (patient.potassium >= rule.withhold_at) {
        return { action: 'withhold', reason: `potassium ${k} mEq/L is ${rule.withhold_at.toFixed(1)} or above: withhold; restart at a low dose once potassium is below 5.5 (${rule.basis})` };
    }
    if (patient.potassium >= rule.reduce_at) {
        return { action: 'reduce', reason: `potassium ${k} mEq/L is 5.5-5.9: reduce one dose step (withhold if already at the lowest dose); restart/titrate only once potassium is below 5.0 (${rule.basis})` };
    }
    return null;
}

/**
 * Heart-rate rule for a drug the patient is already on (facts.hr_continuation): resting pulse below `reduce_below` forces a
 * ONE-STEP dose reduction (withhold if already at the lowest dose); below `no_uptitration_below` no up-titration is offered.
 * Not applied in a paced rhythm (the pacemaker sets a floor) or to a blank pulse (0). Returns the plain-language reasons.
 */
export function hrContinuationAction(med: Medication, patient: Patient): { reduce: boolean; blockUp: boolean; reduceReason: string; withholdReason: string; basis: string } | null {
    const rule = med.facts?.hr_continuation;
    if (!rule || !(patient.pulse > 0) || patient.rhythm === 'Paced') return null;
    const reduce = patient.pulse < rule.reduce_below;
    const blockUp = patient.pulse < rule.no_uptitration_below;
    if (!reduce && !blockUp) return null;
    return {
        reduce, blockUp,
        reduceReason: `heart rate ${patient.pulse} bpm is below ${rule.reduce_below}: one step down, not stopped`,
        withholdReason: `heart rate ${patient.pulse} bpm is below ${rule.reduce_below} and the dose is already the lowest: withhold`,
        basis: rule.basis,
    };
}

export function shouldPreserveQuadForUnknownHistory(patient: Patient): boolean {
    if (patient.lvef <= 40 || !hasUnknownHistoricalHFrEF(patient)) return false;
    const current = patient.current_regimen || [];
    return current.some(r => {
        const group = getMedicationClassGroup(r.med.drug_class);
        return group === 'RAAS Inhibitor' || group === 'Beta Blocker' || group === 'MRA';
    });
}

export function hasRecentWorseningHF(patient: Patient): boolean {
    return patient.recent_hf_worsening_within_6mo === 'yes';
}

// When a patient arrives on duplicate same-class-GROUP therapy (dual RAAS, dual MRA, two
// beta-blockers, two SGLT2i, two loop diuretics — never appropriate), pick the agent to KEEP
// and return the names of the others to deprescribe. Generalized across ALL class groups so any
// same-group duplicate is corrected, not just RAAS/MRA. (Loop + thiazide is two DIFFERENT groups
// — legitimate sequential nephron blockade — and is intentionally not flagged.)
// Keep rules: RAAS → ARNI > ACEi > ARB; MRA → steroidal over nsMRA (dual steroidal + nsMRA
// blockade markedly raises hyperkalemia risk); all other groups → keep the higher (more titrated)
// dose, which is closest to an established target.
export const RAAS_KEEP_PREFERENCE: Record<string, number> = { ARNI: 3, ACEi: 2, ARB: 1 };

export function computeRedundantCurrentMeds(
    currentRegimen: RegimenMed[],
    // A med the patient must come OFF anyway (contraindicated / documented intolerance) must
    // never be chosen as the duplicate-group keeper while a tolerated alternative is on board —
    // otherwise the keeper is removed for intolerance AND the alternative is removed as
    // "redundant", dropping the whole pillar (red-team probe 2: dual MRA, steroidal intolerable).
    // Required (not defaulted) so a future call site cannot silently skip the safety predicate.
    isUnkeepable: (med: Medication) => boolean
): Set<string> {
    const redundant = new Set<string>();

    const byGroup = new Map<string, RegimenMed[]>();
    currentRegimen.forEach(r => {
        // A short-course add-on (facts.short_course_addon, Furoscix) is MEANT to sit beside an oral agent of its group: not a duplicate.
        if (drugFacts(r.med).short_course_addon) return;
        const g = getMedicationClassGroup(r.med.drug_class);
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g)!.push(r);
    });

    byGroup.forEach((allMeds, group) => {
        if (allMeds.length <= 1) return;
        const keepable = allMeds.filter(r => !isUnkeepable(r.med));
        const meds = keepable.length > 0 ? keepable : allMeds;
        let keeper: RegimenMed;
        if (group === 'RAAS Inhibitor') {
            keeper = meds.reduce((best, cur) =>
                (RAAS_KEEP_PREFERENCE[cur.med.drug_class] ?? 0) > (RAAS_KEEP_PREFERENCE[best.med.drug_class] ?? 0) ? cur : best
            );
        } else if (group === 'MRA') {
            keeper = meds.find(r => r.med.drug_class === 'MRA') ?? meds[0];
        } else {
            keeper = meds.reduce((best, cur) => {
                const cs = Number(cur.dose.strength), bs = Number(best.dose.strength);
                if (Number.isNaN(cs)) return best;
                if (Number.isNaN(bs)) return cur;
                return cs > bs ? cur : best;
            });
        }
        // Every non-keeper in the group is the redundant duplicate — including unkeepable ones
        // (those are additionally force-removed with their contraindication/intolerance reason).
        allMeds.forEach(r => { if (r.med.name !== keeper.med.name) redundant.add(r.med.name); });
    });

    return redundant;
}

// isIronDeficient (ESC 2021 compound criteria) now lives in services/clinicalPredicates.ts
// (shared with constants.ts so the IV-iron rescue gate and the Ferric Carboxymaltose
// special-feature criteria cannot drift).

// H2 fix: Require ≥2 of 3 hypoperfusion markers to avoid false positives from a single
// nonspecific finding (e.g., BUN/Cr > 20 alone from dehydration, not true low output).
// Markers: (1) cool extremities, (2) narrow pulse pressure ≤ 25, (3) prerenal azotemia BUN/Cr > 20.
export function isLowOutputState(patient: Patient): boolean {
    // Invalid BP input can create false pulse-pressure triggers. Treat as not-assessable here.
    if (patient.sbp <= patient.dbp) return false;
    if (patient.lvef >= 20) return false;

    const hasCoolExtremities = patient.volume_status.exam_findings.has('Cool Extremities');
    const pulsePressure = patient.sbp - patient.dbp;
    const hasNarrowPulsePressure = pulsePressure <= 25;
    const bunCrRatio = patient.creatinine > 0 ? patient.bun / patient.creatinine : 0;
    const hasPrerenalAzotemia = bunCrRatio > 20;

    const markerCount = [hasCoolExtremities, hasNarrowPulsePressure, hasPrerenalAzotemia].filter(Boolean).length;
    return markerCount >= 2;
}

export function dedupeCurrentRegimen(regimen: RegimenMed[]): { regimen: RegimenMed[]; duplicateNames: string[] } {
    const seen = new Set<string>();
    const duplicateNames = new Set<string>();
    const deduped: RegimenMed[] = [];

    regimen.forEach(item => {
        const key = item.med.name;
        if (seen.has(key)) {
            duplicateNames.add(item.med.name);
            return;
        }
        seen.add(key);
        deduped.push(item);
    });

    return { regimen: deduped, duplicateNames: Array.from(duplicateNames) };
}

export function countNewClassGroups(candidate: RegimenMed[], current: RegimenMed[]): number {
    const currentGroups = new Set(current.map(r => getMedicationClassGroup(r.med.drug_class)));
    const candidateGroups = new Set(candidate.map(r => getMedicationClassGroup(r.med.drug_class)));

    let added = 0;
    candidateGroups.forEach(group => {
        if (!currentGroups.has(group)) added += 1;
    });
    return added;
}

/**
 * Whether a med+dose is at its GDMT target dose FOR THIS PATIENT. Wraps the static
 * `is_target_dose` flag with the one patient-dependent exception: carvedilol's target is
 * body-weight-gated (ACC/AHA: 25 mg BID at <= 85 kg dry weight, 50 mg BID above).
 * Used by the concordance scorer, the GDMT-completeness bonus, and the UI med pills.
 */
export function isTargetDoseForPatient(regimenMed: RegimenMed, patient: Patient): boolean {
    const staticTarget = !!regimenMed.med.available_doses.find(d => String(d.strength) === String(regimenMed.dose.strength))?.is_target_dose;
    const patientDependentTarget = regimenMed.med.is_target_dose_for;
    if (!patientDependentTarget) return staticTarget;

    const strength = Number(regimenMed.dose.strength);
    if (Number.isNaN(strength)) return staticTarget;

    return patientDependentTarget(strength, patient);
}

/**
 * Patient context for target-dose display checks: the projected patient with the BASELINE
 * dry weight restored (a GLP-1's projected dry-weight loss must not flip carvedilol's
 * body-weight-gated target between the engine's scoring pass and the UI's med pills).
 */
export function getTargetDosePatientContext(regimen: ScoredRegimen): Patient {
    return {
        ...regimen.projected_patient,
        volume_status: {
            ...regimen.projected_patient.volume_status,
            dry_weight_kg: regimen.baseline_dry_weight_kg ?? regimen.projected_patient.volume_status.dry_weight_kg,
        },
    };
}

/**
 * Deep-enough clone of a Patient that preserves the Set fields (comorbidities, allergies,
 * external_medications, exam_findings) and copies regimen/discontinued arrays — the ONLY
 * sanctioned way to copy a patient (spread and JSON round-trips silently corrupt the Sets).
 * Single implementation, re-exported by data/scenarios.ts (the app/tests import site) —
 * do not create a second copy; the two previous copies drifted.
 */
export function clonePatient(p: Patient): Patient {
    return {
        ...p,
        volume_status: {
            ...p.volume_status,
            exam_findings: new Set(p.volume_status.exam_findings)
        },
        comorbidities: new Set(p.comorbidities),
        external_medications: new Set(p.external_medications || []),
        allergies: new Set(p.allergies),
        discontinued_meds: p.discontinued_meds.map(m => ({ ...m })),
        current_regimen: p.current_regimen ? p.current_regimen.map(r => ({ ...r, dose: { ...r.dose } })) : []
    };
}

export function hasRelevantIntensification(
    modificationSet: ModificationSet,
    targetClasses: Set<string>
): boolean {
    return modificationSet.modifications.some(mod => {
        if (!mod.target) return false;
        if (!(mod.action === 'add' || mod.action === 'titrate_up' || mod.action === 'swap')) return false;
        return targetClasses.has(mod.target.med.drug_class);
    });
}

export function hasDiureticDeEscalation(modificationSet: ModificationSet): boolean {
    return modificationSet.modifications.some(mod => {
        if (!mod.source) return false;
        if (!(mod.action === 'remove' || mod.action === 'titrate_down')) return false;
        return isDiureticClass(mod.source.med.drug_class);
    });
}

export function formatDose(r: RegimenMed): string {
    return `${r.dose.strength}${r.dose.unit} ${r.selected_frequency}`;
}
