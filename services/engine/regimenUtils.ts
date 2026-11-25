/** Small regimen/patient helpers shared by the candidate, effects and scoring stages. Moved verbatim from simulationService.ts (phase 4). */
import { Patient, Medication, MedicationDose, ScoredRegimen, RegimenMed, ModificationSet } from '../../types';
import { hasUnknownHistoricalHFrEF, valueUnknown, congestionFindingCount, isAcutelyDecompensated, weightAboveDryKg, pulsePressureMmHg, bunToCreatinineRatio } from '../clinicalPredicates';
import { getMedicationClassGroup, isDiureticClass, MRA_POOL_CLASSES } from './registry';
import { drugFacts } from './drugFacts';
import { LOW_OUTPUT, CONGESTION_EXCESS_KG_ABOVE, HYPOTENSION_SBP_BELOW } from './thresholds';
import { COMPLETENESS_SUBTARGET_CREDIT, COMPLETENESS_GRADED_CREDIT_SPAN } from './scoreModel';

// --- Helper Functions ---
export function medicationComplexity(r: RegimenMed): number {
    if (r.dose.formulation.includes('SQ') || r.dose.formulation.includes('Weekly') || r.selected_frequency === 'bid') return 2;
    return r.selected_frequency === 'tid' ? 4 : 1;
}

const DOSES_PER_DAY: Record<string, number> = { qd: 1, bid: 2, tid: 3 };

/**
 * The ONE count of doses for every text about dosing burden (trade-off label, "Why" sentences, case packet). A drug taken daily or more often counts its scheduled doses a day (once daily is one,
 * twice daily is two). A drug taken once a week, every other day or as a single course dose (intravenous iron) is NOT a daily dose and is counted apart, never as a fraction of a dose a day or as
 * a dose each day (R8 X3). An unknown frequency code counts as once daily. This count is wording only: the dosing-burden SCORE reads its own complexity figure (effects.ts) and is unchanged.
 */
const REGIMEN_PER_DAY: Record<string, number> = { qd: 1, bid: 2, tid: 3, qid: 4 };
export interface DosingProfile { dailyDoses: number; dailyDrugs: number; weekly: number; everyOther: number; single: number }
export function dosingProfile(regimen: ReadonlyArray<{ selected_frequency: string }>): DosingProfile {
    const p: DosingProfile = { dailyDoses: 0, dailyDrugs: 0, weekly: 0, everyOther: 0, single: 0 };
    for (const x of regimen) {
        if (x.selected_frequency === 'weekly') p.weekly++;
        else if (x.selected_frequency === 'qod') p.everyOther++;
        else if (x.selected_frequency === 'once') p.single++;
        else { p.dailyDrugs++; p.dailyDoses += REGIMEN_PER_DAY[x.selected_frequency] ?? 1; }
    }
    return p;
}
/** Doses taken a day (daily or more often) by a whole regimen: the one figure the dosing-burden sentences and labels quote. */
export const regimenDosesADay = (regimen: ReadonlyArray<{ selected_frequency: string }>): number => dosingProfile(regimen).dailyDoses;
/** The dosing of a regimen in words ("6 doses a day from 4 drugs, plus 1 drug once a week, plus a single dose"); one function for the packet and every screen text. */
export function dosingWords(regimen: ReadonlyArray<{ selected_frequency: string }>): string {
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (regimen.length === 0) return 'no drugs';
    const p = dosingProfile(regimen);
    const parts = [p.dailyDrugs > 0 ? `${plural(p.dailyDoses, 'dose')} a day from ${plural(p.dailyDrugs, 'drug')}` : ''];
    if (p.weekly > 0) parts.push(`${plural(p.weekly, 'drug')} once a week`);
    if (p.everyOther > 0) parts.push(`${plural(p.everyOther, 'drug')} every other day`);
    if (p.single > 0) parts.push(p.single === 1 ? 'a single dose' : `${p.single} single doses`);
    return parts.filter(Boolean).join(', plus ');
}
export const fmtDosesADay = (x: number): string => (Math.round(x * 10) / 10).toString();

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

/**
 * ONE numeric total daily dose for a regimen entry, including combination strengths ("24/26", "37.5/20"): `facts.combination_daily_dose` says whether the
 * components add ('sum', sacubitril + valsartan) or the first component counts ('first', the hydralazine in hydralazine/isosorbide dinitrate). The single shared
 * helper for dose-evidence credit and the harm-rate dose interpolation; `dailyDose` keeps returning NaN for a combination (loop and cap logic rely on that).
 */
export function numericStrength(med: Medication, strength: number | string): number {
    if (typeof strength === 'number') return strength;
    const parts = String(strength).split('/').map(x => parseFloat(x));
    if (parts.length === 0 || parts.some(Number.isNaN)) return NaN;
    return drugFacts(med).combination_daily_dose === 'sum' ? parts.reduce((a, b) => a + b, 0) : parts[0];
}
export function numericDailyDose(r: RegimenMed): number {
    return numericStrength(r.med, r.dose.strength) * dosesPerDay(r.selected_frequency);
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
export function carryFrequency(tier: RegimenMed, current: RegimenMed, dailyCap?: number): RegimenMed {
    const want = dosesPerDay(current.selected_frequency);
    const have = dosesPerDay(tier.selected_frequency);
    if (want <= have) return tier;
    const strength = Number(tier.dose.strength);
    const best = frequenciesWithinMax(tier.med, tier.dose.frequency_options, tier.dose.strength)
        // A renal / interaction maximum is a daily maximum for a drug dosed by total daily dose (ramipril label: 5 mg/day at CrCl < 40).
        .filter(f => dailyCap === undefined || Number.isNaN(strength) || strength * dosesPerDay(f) <= dailyCap)
        .filter(f => dosesPerDay(f) <= want && dosesPerDay(f) > have)
        .sort((x, y) => dosesPerDay(y) - dosesPerDay(x))[0];
    return best ? { ...tier, selected_frequency: best } : tier;
}

/**
 * Doses of `med` this patient may be offered (renal / interaction caps, declared daily maximum), ascending in
 * ladder order. getDoseTiers samples from this list; titration also reads the immediate neighbours from it.
 */
export function eligibleDoses(med: Medication, patient: Patient): MedicationDose[] {
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
    // Age does NOT shorten the ladder. Until 2026-11-12 a patient over 80 was offered only the lower half of every drug's doses (a count rule with no source),
    // so no one over 80 could reach a target dose (lisinopril stopped at 10 mg, carvedilol at 6.25 mg), a loop could not be raised past 40 mg in a congested
    // patient, and ivabradine was offered because the beta-blocker "could not be increased" (adversarial review 3). "Start low, go slow" is kept where it belongs:
    // new starts begin at the starting tier, a visit at most doubles a dose, and the elderly warnings in effects.ts ask for slower titration.
    return validDoses;
}

/**
 * Is the dose a patient ARRIVES on above the renal dose cap (renal_adjustment.max_dose)? The cap is compared with the TOTAL DAILY dose
 * for an entry that declares `facts.renal_cap_is_daily` (ramipril), else with the per-dose strength. Blank renal data (the 0 sentinel,
 * which would trip every cap) never counts. Returns the cap, the compared amount and the basis, or null.
 */
export function renalCapExceeded(r: RegimenMed, patient: Patient): { cap: number; amount: number; basis: 'daily' | 'dose'; /** Set when the cap is not kidney function (carvedilol: body weight). */ reason?: string } | null {
    if (!r.med.renal_adjustment) return null;
    const adj = r.med.renal_adjustment(patient.egfr, patient);
    // Blank kidney values never count for a KIDNEY cap (the 0 sentinel would trip every "eGFR below ..." limit); a cap with another cause (carvedilol: body weight) does not read them and still applies (R5 Z1).
    if ((valueUnknown(patient.egfr) || valueUnknown(patient.creatinine)) && !adj.max_dose_reason) return null;
    const cap = adj.max_dose;
    if (cap === undefined) return null;
    const daily = drugFacts(r.med).renal_cap_is_daily === true;
    const amount = daily ? dailyDose(r) : Number(r.dose.strength);
    return Number.isNaN(amount) || amount <= cap ? null : { cap, amount, basis: daily ? 'daily' : 'dose', ...(adj.max_dose_reason ? { reason: adj.max_dose_reason } : {}) };
}

export interface HighestAllowedDose {
    /** The regimen entry at the highest total daily dose this patient may be given. */
    regimen: RegimenMed;
    daily: number;
    /** Set only when a rule removes a higher dose that the drug's own ladder offers: which rule(s) and the plain-language reason. */
    cap?: { rules: ('kidney' | 'interaction' | 'maximum')[]; text: string };
}

/**
 * The highest daily dose this patient may be given for a drug under the engine's existing rules, by the SAME functions the candidate generator uses: the eligible dose strengths
 * (`eligibleDoses`: kidney `renal_adjustment.max_dose` and `interaction_dose_cap`), the declared maximum daily dose (`frequenciesWithinMax`) and an explicitly daily kidney cap (`dailyCapFor`).
 * `cap` is set only when that is lower than the highest dose the drug's own ladder offers; it names the binding rule(s). Used by planCreditsFor (change C1, 2026-11-18). Undefined when no dose is allowed.
 */
/** Every dose and frequency combination the engine may offer this patient for a drug (kidney, interaction, declared-maximum and daily-cap rules). */
export function allowedRegimens(med: Medication, patient: Patient): RegimenMed[] {
    const cap = dailyCapFor(med, patient);
    return eligibleDoses(med, patient).flatMap(dose => frequenciesWithinMax(med, dose.frequency_options, dose.strength).map(f => ({ med, dose, selected_frequency: f } as RegimenMed)))
        .filter(r => { const d = numericDailyDose(r); return !Number.isNaN(d) && (cap === undefined || d <= cap + 1e-9); });
}

export function highestAllowedDose(med: Medication, patient: Patient): HighestAllowedDose | undefined {
    type Option = { regimen: RegimenMed; daily: number };
    const options = (doses: MedicationDose[], dailyCap?: number, withMax = true): Option[] => doses.flatMap(dose =>
        (withMax ? frequenciesWithinMax(med, dose.frequency_options, dose.strength) : dose.frequency_options).map(f => {
            const regimen: RegimenMed = { med, dose, selected_frequency: f };
            return { regimen, daily: numericDailyDose(regimen) };
        })
    ).filter(x => !Number.isNaN(x.daily) && (dailyCap === undefined || x.daily <= dailyCap + 1e-9));
    const top = (xs: Option[]): Option | undefined => xs.reduce<Option | undefined>((b, x) => (!b || x.daily > b.daily ? x : b), undefined);
    const dailyCap = dailyCapFor(med, patient);
    const allowed = top(options(eligibleDoses(med, patient), dailyCap)), unconstrained = top(options(med.available_doses, undefined, false));
    if (!allowed || !unconstrained) return undefined;
    if (allowed.daily >= unconstrained.daily - 1e-9) return { regimen: allowed.regimen, daily: allowed.daily };
    // Which rule binds: the highest dose each rule would allow on its own.
    const adj = med.renal_adjustment ? med.renal_adjustment(patient.egfr, patient) : {};
    const interaction = med.interaction_dose_cap?.(patient) ?? null;
    const maxDaily = drugFacts(med).max_daily_dose;
    const only = {
        kidney: top(options(med.available_doses.filter(d => !(typeof d.strength === 'number' && adj.max_dose && d.strength > adj.max_dose)), dailyCap, false)),
        interaction: top(options(med.available_doses.filter(d => !(typeof d.strength === 'number' && interaction && d.strength > interaction.max_dose)), undefined, false)),
        maximum: top(options(med.available_doses, undefined, true)),
    };
    const applies = { kidney: adj.max_dose !== undefined, interaction: interaction !== null, maximum: maxDaily !== undefined };
    const rules = (['kidney', 'interaction', 'maximum'] as const).filter(k => applies[k] && only[k] !== undefined && Math.abs(only[k]!.daily - allowed.daily) < 1e-9);
    const unit = allowed.regimen.dose.unit, mg = `${Math.round(allowed.daily * 100) / 100} ${unit} a day`;
    const why = rules.map(k => k === 'kidney' ? (adj.max_dose_reason ? adj.max_dose_reason : `this patient's dose limit for kidney function (eGFR ${patient.egfr})`) : k === 'interaction' ? (interaction?.reason ?? 'a drug interaction limit') : `the labelled maximum daily dose of ${maxDaily} ${unit}`);
    return { regimen: allowed.regimen, daily: allowed.daily, cap: { rules: [...rules], text: `${why.join(' and ') || 'a dose limit'} allows at most ${mg}` } };
}

/** Only an explicitly DAILY cap limits frequency. Per-dose renal and interaction caps are enforced by eligibleDoses. */
export function dailyCapFor(med: Medication, patient: Patient): number | undefined {
    return drugFacts(med).renal_cap_is_daily ? med.renal_adjustment?.(patient.egfr, patient).max_dose : undefined;
}

/**
 * Titration neighbours: the IMMEDIATELY next tier above (and below) the current dose, so a one-step change is always offered even when
 * the sampler (lowest / middle / highest / target) skips it. Same eligibility as getDoseTiers; frequency carried from the current regimen.
 * The current dose must be on the drug's ladder; otherwise nothing is added.
 */
export function adjacentTiers(current: RegimenMed, patient: Patient): { up?: RegimenMed; down?: RegimenMed } {
    const med = current.med;
    const order = med.available_doses;
    const currentIdx = order.findIndex(d => d.strength === current.dose.strength);
    if (currentIdx < 0) return {};
    const idx = (d: MedicationDose) => order.indexOf(d);
    const eligible = eligibleDoses(med, patient);
    const cap = dailyCapFor(med, patient);
    const make = (dose: MedicationDose | undefined): RegimenMed | undefined => dose
        ? carryFrequency({ med, dose, selected_frequency: pickPreferredFrequency(med, dose.frequency_options, patient, dose.strength) }, current, cap)
        : undefined;
    return {
        up: make(eligible.find(d => idx(d) > currentIdx)),
        down: make([...eligible].reverse().find(d => idx(d) < currentIdx)),
    };
}

/**
 * Potassium rule for INCREASING an MRA the patient already takes (facts.k_uptitration_max): at or above `below` the dose is not raised.
 * Blank potassium (0) never triggers (the unknown-K+ penalty and data alert govern). Returns the plain-language reason, or null.
 */
export function kUptitrationBlock(med: Medication, patient: Patient): { reason: string; basis: string } | null {
    const rule = med.facts?.k_uptitration_max;
    if (!rule || !(patient.potassium > 0)) return null;
    const atOrAbove = rule.below !== undefined && patient.potassium >= rule.below;
    const strictlyAbove = rule.above !== undefined && patient.potassium > rule.above;
    if (!atOrAbove && !strictlyAbove) return null;
    return {
        reason: atOrAbove
            ? `potassium ${patient.potassium.toFixed(1)} mEq/L is ${rule.below!.toFixed(1)} or above: the dose is not increased (maintain; recheck potassium)`
            : `potassium ${patient.potassium.toFixed(1)} mEq/L is above ${rule.above!.toFixed(1)}: the dose is not increased (maintain; recheck potassium)`,
        basis: rule.basis,
    };
}

export function getDoseTiers(med: Medication, patient: Patient): RegimenMed[] {
    const dosesForTiering = eligibleDoses(med, patient);
    if (dosesForTiering.length === 0) return [];

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

    // The patient's LABEL STARTING dose is always a tier (F3, 2026-11-16): the sampler above can skip it (metoprolol succinate: 12.5, 50, 200 sampled, start 25), which
    // left a new start on the lowest tablet tier instead of the label start.
    if (med.start_dose_for) {
        const startDose = dosesForTiering.find(d => String(d.strength) === String(med.start_dose_for!(patient)));
        if (startDose) tiers.push(startDose);
    }

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
        // Controller ruling 2026-11-16 (F3; not ruled by the owner): a new start is offered at the patient's LABEL starting dose (start_dose_for already carries the renal and NYHA safety rules), never a lower
        // tablet tier by default ('start low, go slow' is not a stated safety rule). Before this, spironolactone at eGFR above 50 and metoprolol succinate at NYHA I-II started below label.
        const exact = true;
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
export function kContinuationAction(med: Medication, patient: Patient): { action: 'reduce' | 'withhold'; reason: string; lowestDoseReason?: string } | null {
    const rule = med.facts?.k_continuation;
    if (!rule || !(patient.potassium > 0)) return null;
    const k = patient.potassium.toFixed(1);
    if (patient.potassium >= rule.withhold_at) {
        return { action: 'withhold', reason: `potassium ${k} mEq/L is ${rule.withhold_at.toFixed(1)} or above: withhold; restart at a low dose once potassium is below 5.5 (${rule.basis})` };
    }
    if (patient.potassium >= rule.reduce_at) {
        // MRA first: with an MRA on board that this potassium already reduces or withholds, a drug that yields takes no forced step (its dose is held, not raised).
        if (rule.yields_to === 'mra' && (patient.current_regimen ?? []).some(r => r.med !== med && MRA_POOL_CLASSES.has(r.med.drug_class)
            && (r.med.facts?.k_continuation?.yields_to === undefined) && patient.potassium >= (r.med.facts?.k_continuation?.reduce_at ?? Infinity))) return null;
        const band = `potassium ${k} mEq/L is ${rule.reduce_at.toFixed(1)}-${(rule.withhold_at - 0.1).toFixed(1)}`, until = `do not increase the dose again until potassium is below ${(rule.restart_below ?? 5.0).toFixed(1)} (${rule.basis})`;
        // R10 A4: at the lowest dose the action is a removal, and the reason says so in words that need no inner parenthesis (the change line keeps it whole).
        return { action: 'reduce', reason: `${band}: reduce one dose step (withhold if already at the lowest dose); ${until}`, lowestDoseReason: `${band}: this is the lowest dose, so it is withheld; ${until}` };
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
    if (!rule || patient.rhythm === 'Paced') return null;
    // Heart rate not entered: the dose is neither reduced (no evidence of bradycardia) nor INCREASED (no evidence it is safe to). Before 2026-11-12 a blank
    // pulse allowed up-titration.
    if (!(patient.pulse > 0)) {
        return { reduce: false, blockUp: true, reduceReason: '', withholdReason: '', basis: 'Heart rate not entered: the dose is not increased until it is known (a rule set by this tool)' };
    }
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
    isUnkeepable: (med: Medication) => boolean,
    // Duplicate agents of one class (two beta-blockers, two loops, two SGLT2 inhibitors) are compared by the fraction of each drug's OWN trial-achieved dose the patient takes
    // (data/doseEvidence.json), never by milligrams across different drugs. `undefined` fraction = no trial anchor for the drug. Ties, and drugs without an anchor, go to the
    // drug that comes first in the formulary (`formularyOrder`), so the answer never depends on typing order. (S5)
    keeperRank?: { fraction: (r: RegimenMed) => number | undefined; formularyOrder: (med: Medication) => number }
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
        // Sorted by name so a tie (two agents at the same strength) never depends on the order the drugs were typed in.
        const meds = [...(keepable.length > 0 ? keepable : allMeds)].sort((a, b) => a.med.name < b.med.name ? -1 : a.med.name > b.med.name ? 1 : 0);
        let keeper: RegimenMed;
        if (group === 'RAAS Inhibitor') {
            keeper = meds.reduce((best, cur) =>
                (RAAS_KEEP_PREFERENCE[cur.med.drug_class] ?? 0) > (RAAS_KEEP_PREFERENCE[best.med.drug_class] ?? 0) ? cur : best
            );
        } else if (group === 'MRA') {
            keeper = meds.find(r => r.med.drug_class === 'MRA') ?? meds[0];
        } else {
            keeper = keeperRank
                ? meds.reduce((best, cur) => {
                    const cf = keeperRank.fraction(cur), bf = keeperRank.fraction(best);
                    if (cf !== undefined && bf !== undefined && Math.abs(cf - bf) > 1e-9) return cf > bf ? cur : best;
                    return keeperRank.formularyOrder(cur.med) < keeperRank.formularyOrder(best.med) ? cur : best;
                })
                : meds.reduce((best, cur) => {
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
/**
 * Congestion as the engine already uses it to hold a loop reduction at the modeled plateau (`loopReductionHeldAtModeledPlateau`): current weight more than
 * CONGESTION_EXCESS_KG_ABOVE above dry weight (the criterion congestion coverage uses) OR any congestion finding on examination (`congestionFindingCount`, the criterion the
 * congestion alerts and the diuretic hold use). The loop-diuretic evidence population (`congested`) and its dose credit read this one predicate.
 */
export function hasCongestion(patient: Patient): boolean {
    return isCongestedAboveDryWeight(patient) || congestionFindingCount(patient.volume_status.exam_findings) > 0;
}

/** Congested by the engine's weight criterion: current weight more than CONGESTION_EXCESS_KG_ABOVE kg above dry weight. */
export function isCongestedAboveDryWeight(patient: Patient): boolean {
    if (valueUnknown(patient.volume_status.current_weight_kg) || valueUnknown(patient.volume_status.dry_weight_kg)) return false; // a blank weight is not a measurement
    return weightAboveDryKg(patient) > CONGESTION_EXCESS_KG_ABOVE;
}

/**
 * Diuretic resistance as the engine defines it (2026 ESC Supplementary Table S7 context): the patient stays congested (more than 1 kg above dry weight) on a loop at its
 * HIGH daily dose (the entry's own `facts.high_dose_threshold`). Shared by the loop-swap rule and the advanced-HF referral markers.
 */
export function isLoopDiureticResistant(patient: Patient, loop: RegimenMed): boolean {
    // A short-course add-on (Furoscix) is never the oral loop whose dose defines resistance: it cannot trigger the marker on its own dose.
    return loop.med.drug_class === 'Loop Diuretic' && !drugFacts(loop.med).short_course_addon && isCongestedAboveDryWeight(patient)
        && (drugFacts(loop.med).high_dose_threshold ?? Infinity) <= dailyDose(loop);
}

/**
 * Signs of poor perfusion the engine already reads when it cuts a beta-blocker in acute decompensation: cool extremities, systolic pressure below 90, or a pulse pressure of 25 mmHg
 * or less (LOW_OUTPUT.pulsePressureMax).
 */
export function hasHypoperfusion(patient: Patient): boolean {
    // A blood pressure that is not entered (0) is not a low pressure or a narrow pulse pressure.
    return patient.volume_status.exam_findings.has('Cool Extremities') || (patient.sbp > 0 && patient.sbp < HYPOTENSION_SBP_BELOW)
        || (patient.dbp > 0 && patient.sbp > patient.dbp && pulsePressureMmHg(patient) <= LOW_OUTPUT.pulsePressureMax);
}

/**
 * The "cold" state (S1a): the engine's own low-output state (its alert and its per-option warning say not to start new agents), or acute decompensation (the engine's own
 * predicate, isAcutelyDecompensated) with the poor-perfusion signs it uses to cut the beta-blocker. In this state no option starts a drug or raises a dose.
 */
export function isColdState(patient: Patient): boolean {
    return isLowOutputState(patient) || (isAcutelyDecompensated(patient) && hasHypoperfusion(patient));
}

/** Weight more than 1 kg below the recorded dry weight (the engine's depletion criterion). */
export function weightBelowDryWeight(patient: Patient): boolean {
    if (valueUnknown(patient.volume_status.current_weight_kg) || valueUnknown(patient.volume_status.dry_weight_kg)) return false;
    return weightAboveDryKg(patient) < -CONGESTION_EXCESS_KG_ABOVE;
}

/** Volume depletion (S2): weight more than 1 kg below dry weight AND no congestion finding on examination. */
export function isVolumeDepletedState(patient: Patient): boolean {
    return weightBelowDryWeight(patient) && congestionFindingCount(patient.volume_status.exam_findings) === 0;
}

/** Scale and examination disagree (S2): weight more than 1 kg below dry weight while the examination shows congestion. The dry weight may be out of date. */
export function scaleAndExamDisagree(patient: Patient): boolean {
    return weightBelowDryWeight(patient) && congestionFindingCount(patient.volume_status.exam_findings) > 0;
}

/**
 * Congestion on examination while the weight is within CONGESTION_EXCESS_KG_ABOVE of the recorded dry weight (not more than that above it, and not more than that below it, where the
 * scale-disagreement alert applies instead), with no oral loop diuretic on board: the only case in which "a new loop diuretic is started only when the weight is more than ... above dry
 * weight" is the reason none is offered. Returns the congestion findings, or null.
 */
export function congestionWithoutWeightGain(patient: Patient): string[] | null {
    const vs = patient.volume_status;
    if (valueUnknown(vs.current_weight_kg) || valueUnknown(vs.dry_weight_kg)) return null;
    if (isCongestedAboveDryWeight(patient) || weightBelowDryWeight(patient)) return null;
    if (congestionFindingCount(vs.exam_findings) === 0) return null;
    if ((patient.current_regimen ?? []).some(r => r.med.drug_class === 'Loop Diuretic' && !drugFacts(r.med).short_course_addon)) return null;
    return [...vs.exam_findings].filter(f => f !== 'Cool Extremities').sort();
}

/** The low-output markers present (cool extremities, a narrow pulse pressure, a high BUN to creatinine ratio), in words with the patient's values; empty when the pressure is invalid (systolic not above diastolic). */
export function lowOutputMarkers(patient: Patient): string[] {
    // Invalid BP input can create false pulse-pressure triggers. Treat as not-assessable here.
    if (patient.sbp <= patient.dbp) return [];
    const markers: string[] = [];
    if (patient.volume_status.exam_findings.has('Cool Extremities')) markers.push('cool extremities');
    const pulsePressure = pulsePressureMmHg(patient);
    if (pulsePressure <= LOW_OUTPUT.pulsePressureMax) markers.push(`pulse pressure ${pulsePressure} mmHg (${LOW_OUTPUT.pulsePressureMax} or less)`);
    const bunCrRatio = bunToCreatinineRatio(patient);
    if (bunCrRatio > LOW_OUTPUT.bunCrAbove) markers.push(`BUN to creatinine ratio ${Math.round(bunCrRatio * 10) / 10 === LOW_OUTPUT.bunCrAbove ? bunCrRatio.toFixed(2) : Math.round(bunCrRatio * 10) / 10} (above ${LOW_OUTPUT.bunCrAbove})`); // R13 E2-3: a ratio above the limit by under 0.05 keeps two decimals (20.03), never "20 (above 20)"
    return markers;
}

/** At least two of the three low-output markers (the rule's own count). */
export const LOW_OUTPUT_MIN_MARKERS = 2;

export function isLowOutputState(patient: Patient): boolean {
    if (!(patient.lvef > 0) || patient.lvef >= LOW_OUTPUT.lvefBelow) return false; // an LVEF that is not entered is not a low one
    return lowOutputMarkers(patient).length >= LOW_OUTPUT_MIN_MARKERS;
}

/** Two or more low-output markers present with an entered ejection fraction at or above the limit: the low-output state is not raised ONLY because of the ejection fraction. Returns the markers, or null. */
export function perfusionMarkersAboveEfLimit(patient: Patient): string[] | null {
    if (!(patient.lvef > 0) || patient.lvef < LOW_OUTPUT.lvefBelow) return null;
    const m = lowOutputMarkers(patient);
    return m.length >= LOW_OUTPUT_MIN_MARKERS ? m : null;
}

/**
 * One entry per drug. When the same drug is listed more than once the entry with the HIGHER total daily dose is kept (the conservative reading for every
 * safety projection), in the position of the first entry; `kept` names it when the doses differed. Before 2026-11-12 the first entry typed won, so the
 * answer depended on the order of the list.
 */
/**
 * How cautious a use record is (U5): a drug recorded as held or completed, or whose use is unknown or not recorded, is read before one recorded as being taken, and use that
 * is partial or unknown before use that is consistent. Lower is more cautious. A missing record is the same as "unknown" everywhere else in the engine (`unconfirmedUse`).
 */
const useRank = (r: RegimenMed): [number, number, number] => {
    const e = r.exposure;
    const status = e?.status === 'held' ? 0 : e?.status === 'completed' ? 1 : e?.status === 'active' ? 3 : 2;
    const adherence = e?.adherence === 'consistent' ? 2 : e?.adherence === 'partial' ? 1 : 0;
    const interval = e?.dose_interval_reviewed === true ? 1 : 0;
    return [status, adherence, interval];
};
const useWords = (r: RegimenMed): string => {
    const e = r.exposure;
    const status = e?.status === 'held' ? 'held' : e?.status === 'completed' ? 'completed' : e?.status === 'active' ? 'taking' : 'use not recorded';
    const adherence = e?.status === 'active' ? (e.adherence === 'consistent' ? ', consistent' : e.adherence === 'partial' ? ', partial' : ', adherence unknown') : '';
    return `${status}${adherence}`;
};
const useKey = (r: RegimenMed): string => JSON.stringify(r.exposure ?? null);
const cautiousFirst = (a: RegimenMed, b: RegimenMed): number => {
    const x = useRank(a), y = useRank(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || (useKey(a) < useKey(b) ? -1 : useKey(a) > useKey(b) ? 1 : 0);
};

/**
 * The same drug entered more than once. The dose kept is the higher daily dose (then the larger strength); the use record kept is the MORE CAUTIOUS one of all the entries
 * (held or uncertain over taking), whichever entry carried it, so the answer never depends on the order the entries were typed in (U5). `useNotes` says, per drug, which
 * use records were found and which one was kept, whenever they differed.
 */
export function dedupeCurrentRegimen(regimen: RegimenMed[]): { regimen: RegimenMed[]; duplicateNames: string[]; kept: string[]; useNotes: string[] } {
    const best = new Map<string, RegimenMed>();
    const group = new Map<string, RegimenMed[]>();
    const duplicateNames = new Set<string>();
    const conflicting = new Set<string>();
    const daily = (r: RegimenMed) => parseFloat(String(r.dose.strength)) * dosesPerDay(r.selected_frequency);
    regimen.forEach(item => {
        group.set(item.med.name, [...(group.get(item.med.name) ?? []), item]);
        const held = best.get(item.med.name);
        if (!held) { best.set(item.med.name, item); return; }
        duplicateNames.add(item.med.name);
        if (daily(item) !== daily(held)) conflicting.add(item.med.name);
        // Higher daily dose wins; on an equal daily dose (40 mg once daily vs 20 mg twice daily) the entry with the larger strength, so the result never
        // depends on the order the two entries were typed in.
        if (daily(item) > daily(held) || (daily(item) === daily(held) && parseFloat(String(item.dose.strength)) > parseFloat(String(held.dose.strength)))) best.set(item.med.name, item);
    });
    const useNotes: string[] = [];
    for (const name of [...duplicateNames].sort()) {
        const entries = group.get(name)!;
        const cautious = [...entries].sort(cautiousFirst)[0];
        const doseEntry = best.get(name)!;
        const merged: RegimenMed = { ...doseEntry, exposure: cautious.exposure ? { ...cautious.exposure } : undefined };
        if (!cautious.exposure) delete (merged as { exposure?: unknown }).exposure;
        best.set(name, merged);
        const kinds = [...new Set(entries.map(useWords))];
        if (kinds.length > 1) useNotes.push(`${name}: the entries carried different use records (${kinds.sort().join('; ')}); the more cautious one was kept (${useWords(cautious)})`);
    }
    const emitted = new Set<string>();
    const deduped: RegimenMed[] = [];
    regimen.forEach(item => {
        if (emitted.has(item.med.name)) return;
        emitted.add(item.med.name);
        deduped.push(best.get(item.med.name)!);
    });
    return {
        regimen: deduped, duplicateNames: Array.from(duplicateNames), useNotes,
        kept: Array.from(conflicting).map(n => { const k = best.get(n)!; return `${n} ${k.dose.strength} ${k.dose.unit} ${k.selected_frequency}`; }),
    };
}

/**
 * Changes that count toward the per-visit limit (S11): each new drug class, and a switch from an ACE inhibitor or ARB to sacubitril/valsartan. A switch the safety rules
 * require (`mandatory`) is not counted. Dose changes and other switches are not counted.
 */
export function countVisitLimitChanges(set: { modifications: { action: string; source?: RegimenMed; target?: RegimenMed; mandatory?: boolean }[]; resulting_regimen: RegimenMed[] }, current: RegimenMed[]): number {
    const newClasses = countNewClassGroups(set.resulting_regimen, current);
    const arniSwitch = set.modifications.some(m => m.action === 'swap' && !m.mandatory && m.target?.med.drug_class === 'ARNI' && m.source
        && (m.source.med.drug_class === 'ACEi' || m.source.med.drug_class === 'ARB'));
    return newClasses + (arniSwitch ? 1 : 0);
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
 * Progress (0-1) of the regimen entry from the patient's labeled STARTING dose to the patient's TARGET dose, in total daily dose; undefined when no numeric target can
 * be derived. 0 at or below the start tier, 1 at or above the target, linear in between; 1 when start and target coincide.
 * Target source, in order: `facts.target_daily_dose`; else the lowest listed strength that `is_target_dose_for(strength, patient)` accepts; else the strength flagged
 * `is_target_dose`. Start = the tier `start_dose_for(patient)` names, else the lowest listed tier. Strengths are compared at the entry's own frequency (a
 * combination strength such as "49/51" uses its leading component).
 */
export function doseProgressToTarget(r: RegimenMed, patient: Patient): number | undefined {
    const lead = (v: number | string) => { const n = parseFloat(String(v)); return Number.isNaN(n) ? undefined : n; };
    const doses = r.med.available_doses;
    const startTier = r.med.start_dose_for ? r.med.start_dose_for(patient) : doses[0]?.strength;
    const start = startTier === undefined ? undefined : lead(startTier);
    let target: number | undefined, current: number | undefined;
    const dailyTarget = drugFacts(r.med).target_daily_dose;
    // Completeness measures progress to the patient's attainable target. A known renal cap limits
    // that target on its declared basis (ramipril: daily; eplerenone: per dose). These are existing
    // formulary caps, not new clinical thresholds. Unknown labs must not confer capped-target credit.
    // A cap with a non-kidney cause (carvedilol: body weight) does not read the kidney values and is kept when they are blank (R5 Z1).
    const adjForCap = r.med.renal_adjustment?.(patient.egfr, patient);
    const renalCap = (!valueUnknown(patient.egfr) && !valueUnknown(patient.creatinine)) || adjForCap?.max_dose_reason
        ? adjForCap?.max_dose : undefined;
    const capTarget = (value: number | undefined, daily: boolean): number | undefined => {
        if (value === undefined || renalCap === undefined) return value;
        const frequency = dosesPerDay(r.selected_frequency);
        const cap = drugFacts(r.med).renal_cap_is_daily
            ? (daily ? renalCap : renalCap / frequency)
            : (daily ? renalCap * frequency : renalCap);
        return Math.min(value, cap);
    };
    if (dailyTarget !== undefined) {
        const d = dailyDose(r);
        target = capTarget(dailyTarget, true);
        current = Number.isNaN(d) ? undefined : d;
        // The start tier is a per-dose strength: compare it at the entry's own frequency.
        if (start !== undefined) return finishProgress(start * dosesPerDay(r.selected_frequency), target, current);
        return undefined;
    }
    const perPatient = r.med.is_target_dose_for;
    const targetDose = perPatient
        ? doses.find(d => { const s = Number(d.strength); return !Number.isNaN(s) && perPatient(s, patient); })
        : doses.find(d => d.is_target_dose);
    target = capTarget(targetDose ? lead(targetDose.strength) : undefined, false);
    current = lead(r.dose.strength);
    return finishProgress(start, target, current);
}

/**
 * The patient's labelled starting TOTAL daily dose for this drug: the start tier (start_dose_for, else the lowest tier) at that tier's own usual frequency
 * (pickPreferredFrequency), NOT at the frequency of the entry being valued. Reading it at the entry's frequency made two regimens with the same daily dose earn
 * different dose credit (ramipril 5 mg once daily 0.698 versus 2.5 mg twice daily 0.634 at eGFR 35); fixed in the third pass 2026-11-18. undefined when no numeric start exists.
 */
export function startingDailyDose(r: RegimenMed, patient: Patient): number | undefined {
    const startTier = r.med.start_dose_for ? r.med.start_dose_for(patient) : r.med.available_doses[0]?.strength;
    const n = startTier === undefined ? NaN : numericStrength(r.med, startTier);
    if (Number.isNaN(n)) return undefined;
    const tier = r.med.available_doses.find(d => d.strength === startTier);
    const freq = tier ? pickPreferredFrequency(r.med, tier.frequency_options, patient, tier.strength) : r.selected_frequency;
    return n * dosesPerDay(freq);
}

function finishProgress(start: number | undefined, target: number | undefined, current: number | undefined): number | undefined {
    if (start === undefined || target === undefined || current === undefined || target <= 0) return undefined;
    if (target <= start) return 1;
    return Math.max(0, Math.min(1, (current - start) / (target - start)));
}

/**
 * Whether a med+dose is at its GDMT target dose FOR THIS PATIENT. Wraps the static
 * `is_target_dose` flag with the one patient-dependent exception: carvedilol's target is
 * body-weight-gated (ACC/AHA: 25 mg BID at <= 85 kg dry weight, 50 mg BID above).
 * Used by the concordance scorer, the GDMT-completeness bonus, and the UI med pills.
 */
export function isTargetDoseForPatient(regimenMed: RegimenMed, patient: Patient): boolean {
    // A drug whose doses can be given at more than one frequency declares its target as a TOTAL DAILY dose (facts.target_daily_dose):
    // ramipril 5 mg twice daily is the 10 mg/day target.
    const dailyTarget = drugFacts(regimenMed.med).target_daily_dose;
    if (dailyTarget !== undefined) {
        const daily = dailyDose(regimenMed);
        if (!Number.isNaN(daily)) return daily >= dailyTarget;
    }
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
        ...(p.scope_conditions instanceof Set ? { scope_conditions: new Set(p.scope_conditions) } : {}),
        external_medications: new Set(p.external_medications || []),
        allergies: new Set(p.allergies),
        discontinued_meds: p.discontinued_meds.map(m => ({ ...m })),
        current_regimen: p.current_regimen ? p.current_regimen.map(r => ({ ...r, dose: { ...r.dose }, ...(r.exposure ? { exposure: { ...r.exposure } } : {}) })) : []
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
        if (mod.duplicate_cleanup) return false; // removing the second of two duplicate entries is a clean-up, not a diuretic reduction (T2)
        if (!(mod.action === 'remove' || mod.action === 'titrate_down')) return false;
        return isDiureticClass(mod.source.med.drug_class);
    });
}

export function formatDose(r: RegimenMed): string {
    return `${r.dose.strength}${r.dose.unit} ${r.selected_frequency}`;
}

/**
 * Dose credit (0-1) for one regimen entry: how much of the drug's attainable benefit the current dose is credited with. Shared by the GDMT-completeness
 * domain (scoring.ts) and the outcome-benefit module (outcomeBenefit.ts) so both read the same dose scale.
 * 1.0 for a single-dose drug, a dose at the patient's target, at the maximum available strength, or at an interaction dose cap (e.g. eplerenone 25 mg with a
 * moderate CYP3A inhibitor). Otherwise COMPLETENESS_SUBTARGET_CREDIT (0.6) at or below the starting tier, rising linearly to 1.0 at target
 * (doseProgressToTarget); a flat 0.6 where no numeric target exists.
 */
export function therapyDoseCredit(r: RegimenMed, patient: Patient): number {
    const doses = r.med.available_doses;
    if (doses.length === 1) return 1;
    const atTarget = isTargetDoseForPatient(r, patient);
    const strengths = doses.map(d => Number(d.strength)).filter(n => !Number.isNaN(n));
    const atMax = strengths.length > 0 && Number(r.dose.strength) >= Math.max(...strengths);
    const cap = r.med.interaction_dose_cap?.(patient);
    const atCap = !!cap && Number(r.dose.strength) >= cap.max_dose;
    if (atTarget || atMax || atCap) return 1;
    const progress = doseProgressToTarget(r, patient);
    return progress === undefined ? COMPLETENESS_SUBTARGET_CREDIT : COMPLETENESS_SUBTARGET_CREDIT + COMPLETENESS_GRADED_CREDIT_SPAN * progress;
}


/**
 * Why a drug already on board is removed for kidney function (the renal dosing table marks the eGFR as contraindicated), in plain words; null when it is not.
 * Example: "kidney function: eGFR 28 is below 30, the limit this tool applies for spironolactone".
 */
export function renalContraindicationReason(med: Medication, patient: Patient): string | null {
    if (valueUnknown(patient.egfr) || valueUnknown(patient.creatinine) || !med.renal_adjustment) return null;
    const adj = med.renal_adjustment(patient.egfr, patient);
    if (adj.contraindicated !== true) return null;
    return `kidney function: eGFR ${patient.egfr} is ${adj.limit_text ?? 'under the limit'}, the limit this tool applies for ${med.name.replace(/ \(.*\)$/, '').toLowerCase()}`;
}

/** The regimen in drug-name order: loops that emit alerts or forced changes read it, so the output never depends on the order the drugs were typed in. */
export function sortedByName(rs: RegimenMed[]): RegimenMed[] {
    return [...rs].sort((a, b) => a.med.name < b.med.name ? -1 : a.med.name > b.med.name ? 1 : 0);
}

/** Oral loop dose in furosemide equivalents (the tool's own verified equivalents); a short-course add-on (Furoscix) is not an oral loop. */
export const oralLoopFe = (regimen: ReadonlyArray<RegimenMed>): number => regimen.filter(r => r.med.drug_class === 'Loop Diuretic' && !drugFacts(r.med).short_course_addon)
    .reduce((t, r) => t + dailyDose(r) * (drugFacts(r.med).verified_furosemide_equivalent_per_mg ?? 1), 0);
/** The total oral loop diuretic dose, in furosemide equivalents, of the regimen the patient takes now and of the regimen an option produces (R9 Z3: every sentence that quotes a total is computed from these). */
export const loopTotals = (patient: Patient, r: { regimen: RegimenMed[] }): { before: number; after: number } => ({ before: oralLoopFe(patient.current_regimen ?? []), after: oralLoopFe(r.regimen) });
/**
 * What an option does to the TOTAL oral loop dose the patient takes, in furosemide equivalents, computed from the regimen before and the regimen the option produces (R9 Z3): "unchanged" only when the two
 * totals are equal. (R8 X4 had called a step that raises the kept drug and removes a duplicate "unchanged" whenever the new dose fell between the kept drug's dose and the total, which is false when the total falls.)
 */
export function loopDoseEffect(patient: Patient, r: { regimen: RegimenMed[]; modification_set?: { modifications: Array<{ action: string; source?: RegimenMed; duplicate_cleanup?: boolean }> } }): 'stops' | 'lowers' | 'raises' | 'unchanged' {
    const { before, after } = loopTotals(patient, r);
    if (after > before + 1e-9) return 'raises';
    if (!(before > 0)) return 'unchanged';
    return after <= 0 ? 'stops' : after < before - 1e-9 ? 'lowers' : 'unchanged';
}

