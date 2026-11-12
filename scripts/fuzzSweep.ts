/**
 * RANDOMIZED-PATIENT SWEEP (npm run fuzz)
 *
 * Seeded random patients, many on threshold values, run through the engine and checked against invariants that are written HERE,
 * independently of the engine's own rule code (class lists and numbers are deliberately restated, so a rule that is bypassed on one
 * path - add vs swap vs titrate vs rescue - shows up as a violation). Three kinds of check:
 *   1. Output integrity   - finite numbers, no "undefined"/"NaN" text, valid dose tiers, the score ledger reconciles, no silent empty page.
 *   2. Safety invariants  - what must never be started, raised or kept for this patient.
 *   3. Consistency        - same answer when the regimen is listed in another order; the tool does not undo its own first option when that
 *                           option is entered as the current regimen; ranking mode and care priority change ordering only.
 *
 * Usage: tsx scripts/fuzzSweep.ts [count=3000] [seed=20261112]      Exit code 1 on any violation.
 */
import { generateAndScoreModifications } from '../services/simulationService';
import { DRUG_PRICES } from '../services/pricingService';
import { MEDICATION_FORMULARY, RELEVANT_COMORBIDITIES, RELEVANT_EXTERNAL_MEDICATIONS, COMMON_SIDE_EFFECTS } from '../constants';
import { calculateCKDEPI, isAcutelyDecompensated } from '../services/clinicalPredicates';
import { clonePatient, dosesPerDay } from '../services/engine/regimenUtils';
import { normalize } from './goldenMaster';
import { resolveAllergy } from '../services/engine/allergy';
import type { Patient, RegimenMed, SimulationOutput, InsuranceTier, Medication } from '../types';

// ---- restated clinical vocabulary (do NOT import these from the engine) -------------------------------------------------
const RAAS = new Set(['ARNI', 'ACEi', 'ARB']);
const MRA = new Set(['MRA', 'nsMRA']);
const BB = 'Beta Blocker';
const PREGNANCY_AVOID = new Set(['ARNI', 'ACEi', 'ARB', 'MRA', 'nsMRA', 'SGLT2i', 'GLP-1 RA', 'GLP-1/GIP RA', 'sGC Stimulator', 'If Inhibitor']);
const SINGLE_AGENT_GROUPS: Record<string, string> = {
    ARNI: 'RAAS', ACEi: 'RAAS', ARB: 'RAAS', MRA: 'MRA', nsMRA: 'MRA', [BB]: 'BB', SGLT2i: 'SGLT2i',
    'GLP-1 RA': 'GLP1', 'GLP-1/GIP RA': 'GLP1', 'K+ Binder': 'Binder', 'If Inhibitor': 'If', 'sGC Stimulator': 'sGC',
};

// ---- seeded RNG ---------------------------------------------------------------------------------------------------------
function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
type Rng = () => number;
const pick = <T,>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chance = (r: Rng, p: number) => r() < p;
const between = (r: Rng, lo: number, hi: number) => lo + r() * (hi - lo);
const round1 = (x: number) => Math.round(x * 10) / 10;
function subset<T>(r: Rng, xs: readonly T[], maxCount: number): T[] {
    const n = Math.floor(r() * (maxCount + 1));
    const out = new Set<T>();
    for (let i = 0; i < n; i++) out.add(pick(r, xs));
    return [...out];
}

const byClass = (cls: string[]) => MEDICATION_FORMULARY.filter(m => cls.includes(m.drug_class));
const CLASS_SLOTS: { meds: Medication[]; p: number }[] = [
    { meds: byClass(['ARNI', 'ACEi', 'ARB']), p: 0.6 },
    { meds: byClass([BB]), p: 0.6 },
    { meds: byClass(['MRA', 'nsMRA']), p: 0.4 },
    { meds: byClass(['SGLT2i']), p: 0.4 },
    { meds: byClass(['Loop Diuretic']).filter(m => !m.facts?.short_course_addon), p: 0.5 },
];
const OTHER_MEDS = MEDICATION_FORMULARY.filter(m => !CLASS_SLOTS.some(s => s.meds.includes(m)));

function randomRegimenMed(r: Rng, med: Medication): RegimenMed {
    const dose = pick(r, med.available_doses);
    return { med, dose, selected_frequency: pick(r, dose.frequency_options) };
}

const K_VALUES = [0, 3.0, 3.4, 3.5, 3.9, 4.2, 4.2, 4.5, 4.9, 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9, 6.0, 6.2, 6.4, 6.5];
const PULSE_VALUES = [0, 44, 48, 49, 50, 54, 55, 59, 60, 64, 69, 70, 75, 82, 95, 110];
const SBP_VALUES = [84, 89, 90, 91, 94, 95, 99, 104, 112, 122, 135, 150, 175];
const LVEF_VALUES = [0, 12, 19, 20, 25, 30, 35, 40, 41, 44, 45, 49, 50, 55, 62];
const EGFR_VALUES = [0, 9, 14, 15, 19, 20, 24, 25, 29, 30, 31, 39, 44, 45, 49, 50, 59, 60, 75, 95];
const EXAM = ['Edema (1+)', 'Edema (2+)', 'Edema (3+)', 'JVP Elevated', 'Orthopnea', 'Crackles', 'Ascites', 'Cool Extremities'];

export function randomPatient(seed: number): Patient {
    const r = mulberry32(seed);
    const sex: Patient['sex'] = chance(r, 0.5) ? 'Male' : 'Female';
    const age = Math.round(between(r, 18, 95));
    const sbp = pick(r, SBP_VALUES) + (chance(r, 0.3) ? Math.round(between(r, -3, 3)) : 0);
    const creatinine = chance(r, 0.04) ? 0 : round1(between(r, 0.5, chance(r, 0.2) ? 4.5 : 2.0));
    const egfr = chance(r, 0.6) && creatinine > 0 ? calculateCKDEPI(creatinine, age, sex) : pick(r, EGFR_VALUES);
    const dry = Math.round(between(r, 45, 130));
    const regimen: RegimenMed[] = [];
    for (const slot of CLASS_SLOTS) if (chance(r, slot.p)) regimen.push(randomRegimenMed(r, pick(r, slot.meds)));
    for (const med of OTHER_MEDS) if (chance(r, 0.05)) regimen.push(randomRegimenMed(r, med));
    if (chance(r, 0.05)) regimen.push(randomRegimenMed(r, pick(r, MEDICATION_FORMULARY))); // duplicates / dual therapy as entered by a user
    const lvef = pick(r, LVEF_VALUES);
    const pregnant = sex === 'Female' && age < 50 && chance(r, 0.25);
    return {
        age, sex, race: pick(r, ['White', 'Black', 'Asian', 'Hispanic', 'Other'] as const),
        height_cm: Math.round(between(r, 145, 200)), bmi: round1(between(r, 16, 52)),
        sbp, dbp: Math.max(40, sbp - Math.round(between(r, 15, 60))), pulse: pick(r, PULSE_VALUES),
        oxygen_saturation: chance(r, 0.3) ? undefined : Math.round(between(r, 86, 100)),
        rhythm: pick(r, ['Sinus', 'Sinus', 'Sinus', 'AFib', 'AFib', 'Paced', '2nd Degree AV Block', '3rd Degree AV Block'] as const),
        nt_pro_bnp: pick(r, [0, 150, 450, 900, 1599, 1600, 2500, 4001, 9000]),
        nyha_class: pick(r, ['I', 'II', 'II', 'III', 'III', 'IV'] as const), kccq_score: Math.round(between(r, 5, 100)),
        lvef, lvedd: chance(r, 0.5) ? Math.round(between(r, 42, 75)) : undefined, lavi: chance(r, 0.5) ? Math.round(between(r, 20, 60)) : undefined,
        volume_status: { dry_weight_kg: dry, current_weight_kg: round1(dry + pick(r, [-3, -1, 0, 0, 0.5, 1.0, 1.1, 2.1, 2.5, 5, 9])), exam_findings: new Set(subset(r, EXAM, 3)) },
        bun: Math.round(between(r, 8, 90)), creatinine,
        baseline_creatinine: chance(r, 0.35) && creatinine > 0 ? round1(creatinine * pick(r, [0.4, 0.5, 0.6, 0.67, 0.75, 1, 1.25])) : undefined,
        egfr, potassium: pick(r, K_VALUES),
        ferritin: chance(r, 0.5) ? pick(r, [20, 99, 100, 150, 299, 300, 600]) : undefined,
        tsat: chance(r, 0.5) ? pick(r, [10, 19, 20, 30]) : undefined,
        hemoglobin: chance(r, 0.4) ? round1(between(r, 8, 17)) : undefined,
        comorbidities: new Set(subset(r, RELEVANT_COMORBIDITIES, 4)),
        external_medications: new Set(subset(r, RELEVANT_EXTERNAL_MEDICATIONS, 2)),
        allergies: new Set(chance(r, 0.15) ? [pick(r, [...MEDICATION_FORMULARY.map(m => m.name), 'Sulfa', 'Penicillin'])] : []),
        discontinued_meds: subset(r, MEDICATION_FORMULARY, 2).map(m => ({ name: m.name, drug_class: m.drug_class, reason: pick(r, COMMON_SIDE_EFFECTS) })),
        is_pregnant: pregnant,
        previous_lvef: chance(r, 0.3) ? pick(r, [0, 25, 38, 40, 45, 55]) : undefined,
        ever_lvef_le_40: pick(r, ['yes', 'no', 'unknown'] as const),
        recent_hf_worsening_within_6mo: pick(r, ['yes', 'no', 'unknown'] as const),
        current_regimen: regimen,
        max_affordable_cost: pick(r, [0, 1, 20, 100, 500, 4000, 4000]),
        cost_sensitivity: Math.round(between(r, 0, 10)), insurance_tier: pick(r, ['cash', 'commercial', 'medicare'] as const),
        complexity_tolerance: Math.round(between(r, 0, 10)), max_new_classes_per_visit: pick(r, [0, 1, 2, 2, 3, 4]),
        care_priority: pick(r, ['default', 'default', 'outcomes_first', 'cost_first', 'simplicity_first'] as const),
        ranking_mode: pick(r, ['balanced', 'balanced', 'foundational_first'] as const),
    };
}

// ---- helpers ------------------------------------------------------------------------------------------------------------
const ALL_NAMES = MEDICATION_FORMULARY.map(m => m.name);
const TIER_KEY: Record<InsuranceTier, string> = { cash: 'cash', commercial: 'commercial', medicare: 'medicare' };
function pricesFor(tier: InsuranceTier): Record<string, number> {
    const out: Record<string, number> = {};
    for (const n of ALL_NAMES) {
        const entry = DRUG_PRICES[n] as unknown as Record<string, number>;
        const key = Object.keys(entry).find(k => k.toLowerCase().includes(TIER_KEY[tier])) as string;
        out[n] = entry[key];
    }
    return out;
}
const PRICES: Record<InsuranceTier, Record<string, number>> = { cash: pricesFor('cash'), commercial: pricesFor('commercial'), medicare: pricesFor('medicare') };

const run = (p: Patient, available: Set<string> = new Set(ALL_NAMES)) => generateAndScoreModifications(p, available, PRICES[p.insurance_tier]);
const known = (v: number | undefined): v is number => v !== undefined && !Number.isNaN(v) && v > 0;
const strengthNum = (m: RegimenMed) => parseFloat(String(m.dose.strength));
const daily = (m: RegimenMed) => strengthNum(m) * dosesPerDay(m.selected_frequency);
const tierIndex = (m: RegimenMed) => m.med.available_doses.findIndex(d => String(d.strength) === String(m.dose.strength));
const sig = (reg: RegimenMed[]) => reg.map(m => `${m.med.name}|${m.dose.strength}|${m.selected_frequency}`).sort().join(' + ');
const describe = (reg: RegimenMed[]) => reg.map(m => `${m.med.name} ${m.dose.strength} ${m.selected_frequency}`).join(', ') || '(none)';

/** One entry per drug name: the higher daily dose when a user lists the same drug twice (the engine's documented rule). */
function currentByName(p: Patient): Map<string, RegimenMed> {
    const map = new Map<string, RegimenMed>();
    for (const m of p.current_regimen) { const held = map.get(m.med.name); if (!held || daily(m) > daily(held)) map.set(m.med.name, m); }
    return map;
}

interface Violation { code: string; seed: number; detail: string }

function walkStrings(value: unknown, visit: (s: string, path: string) => void, path = '', depth = 0): void {
    if (depth > 6 || value === null || value === undefined) return;
    if (typeof value === 'string') return visit(value, path);
    if (typeof value === 'number') { if (!Number.isFinite(value)) visit(`__NONFINITE__${value}`, path); return; }
    if (typeof value !== 'object' || value instanceof Set) return;
    if (Array.isArray(value)) { value.forEach((v, i) => walkStrings(v, visit, `${path}[${i}]`, depth + 1)); return; }
    for (const [k, v] of Object.entries(value as object)) {
        if (k === 'med' || k === 'projected_patient' && depth > 3) continue;
        walkStrings(v, visit, path ? `${path}.${k}` : k, depth + 1);
    }
}

// ---- the checks -----------------------------------------------------------------------------------------------------------
export function checkPatient(seed: number, p: Patient): Violation[] {
    const v: Violation[] = [];
    const add = (code: string, detail: string) => v.push({ code, seed, detail });
    const before = JSON.stringify(normalize(p));
    let out: SimulationOutput;
    try { out = run(p); } catch (e) { add('THROW', String((e as Error).stack ?? e).split('\n').slice(0, 3).join(' | ')); return v; }
    if (JSON.stringify(normalize(p)) !== before) add('INPUT_MUTATED', 'patient object changed by the run');
    try { if (JSON.stringify(normalize(run(p))) !== JSON.stringify(normalize(out))) add('NONDETERMINISTIC', 'second run differs'); } catch { add('THROW_SECOND_RUN', ''); }

    const K = p.potassium, kKnown = known(K), egfrKnown = known(p.egfr) && known(p.creatinine);
    const cur = currentByName(p);
    const curClasses = new Set([...cur.values()].map(m => m.med.drug_class));
    const hasCurRaas = [...curClasses].some(c => RAAS.has(c)), hasCurMra = [...curClasses].some(c => MRA.has(c));
    const regs = out.scoredRegimens;

    // 1. Output integrity
    walkStrings(out, (s, path) => {
        if (/__NONFINITE__/.test(s)) add('NONFINITE_NUMBER', `${path} = ${s}`);
        else if (/\bundefined\b|\bNaN\b|\[object |\bnull\b/.test(s)) add('BAD_TEXT', `${path}: ${s.slice(0, 160)}`);
    });
    if (regs.length === 0 && out.clinicalAlerts.length === 0 && (out.missingDataNotices ?? []).length === 0) add('SILENT_EMPTY', 'no options and no alert or notice');
    if (regs.length > 3) add('TOO_MANY_PICKS', String(regs.length));
    if (new Set(regs.map(r => sig(r.regimen))).size !== regs.length) add('DUPLICATE_PICKS', regs.map(r => sig(r.regimen)).join(' || '));
    if (known(p.sbp) && p.sbp < 90 && regs.length) add('HARDSTOP_SBP', `SBP ${p.sbp} but ${regs.length} options`);
    if (kKnown && K >= 6.5 && regs.length) add('HARDSTOP_K', `K ${K} but ${regs.length} options`);

    regs.forEach((r, idx) => {
        const tag = `opt${idx + 1}`;
        if (!(r.overall_score >= 0 && r.overall_score <= 100)) add('SCORE_RANGE', `${tag} ${r.overall_score}`);
        if (!(r.cost >= 0)) add('COST_RANGE', `${tag} ${r.cost}`);
        const expectedCost = r.regimen.length === 0 ? 0 : undefined;
        if (expectedCost !== undefined && r.cost !== expectedCost) add('COST_EMPTY_REGIMEN', `${tag} ${r.cost}`);
        if (r.cost > p.max_affordable_cost && !r.warnings.some(w => w.startsWith('BUDGET EXCEEDED'))) add('OVER_BUDGET_UNLABELLED', `${tag} cost ${r.cost} > ${p.max_affordable_cost}`);

        // ledger
        const b = r.score_breakdown;
        if (!b) add('NO_LEDGER', tag);
        else {
            const sub = b.domains.reduce((s, d) => s + d.contribution, 0);
            const wsum = b.domains.reduce((s, d) => s + d.weight, 0);
            const rawOverride = (b.overrides ?? []).filter(o => o.applies_to === 'raw_score').reduce((s, o) => s + (o.after - o.before), 0);
            const raw = b.weighted_subtotal + b.adjustments.reduce((s, a) => s + a.points, 0) + rawOverride;
            if (Math.abs(sub - b.weighted_subtotal) > 1e-6) add('LEDGER_SUBTOTAL', `${tag} ${sub} vs ${b.weighted_subtotal}`);
            if (Math.abs(wsum - 1) > 1e-9) add('LEDGER_WEIGHTS', `${tag} weights sum ${wsum}`);
            if (Math.abs(raw - b.raw_score) > 1e-6 || Math.abs((r.raw_score ?? NaN) - b.raw_score) > 1e-6) add('LEDGER_RAW', `${tag} computed ${raw}, ledger ${b.raw_score}, regimen ${r.raw_score}`);
            if (b.overall_score !== r.overall_score) add('LEDGER_OVERALL', `${tag} ${b.overall_score} vs ${r.overall_score}`);
            if (!(b.overrides ?? []).some(o => o.applies_to === 'overall_score') && r.overall_score !== Math.round(Math.min(100, Math.max(0, b.raw_score)))) add('LEDGER_ROUNDING', `${tag} raw ${b.raw_score} shown ${r.overall_score}`);
            for (const d of b.domains) if (!(d.score >= 0 && d.score <= 100)) add('DOMAIN_RANGE', `${tag} ${d.key} ${d.score}`);
        }

        // regimen integrity
        const seenNames = new Set<string>(), groups = new Map<string, string>();
        for (const m of r.regimen) {
            if (tierIndex(m) < 0) add('DOSE_NOT_ON_LADDER', `${tag} ${m.med.name} ${m.dose.strength}`);
            if (!m.dose.frequency_options.includes(m.selected_frequency)) add('FREQ_NOT_OFFERED', `${tag} ${m.med.name} ${m.dose.strength} ${m.selected_frequency}`);
            if (seenNames.has(m.med.name)) add('SAME_DRUG_TWICE', `${tag} ${m.med.name}`);
            seenNames.add(m.med.name);
            const max = m.med.facts?.max_daily_dose;
            if (max !== undefined && daily(m) > max + 1e-9) add('OVER_LABEL_MAX_DAILY', `${tag} ${m.med.name} ${daily(m)} > ${max}`);
            const g = SINGLE_AGENT_GROUPS[m.med.drug_class];
            if (g) { if (groups.has(g)) add('TWO_AGENTS_ONE_CLASS', `${tag} ${groups.get(g)} + ${m.med.name}`); groups.set(g, m.med.name); }
        }
        const oralLoops = r.regimen.filter(m => m.med.drug_class === 'Loop Diuretic' && !m.med.facts?.short_course_addon);
        if (oralLoops.length > 1) add('TWO_ORAL_LOOPS', `${tag} ${describe(oralLoops)}`);
        if (r.modification_set && sig(r.modification_set.resulting_regimen) !== sig(r.regimen)) add('MODSET_MISMATCH', tag);
        const mods = r.modification_set?.modifications ?? [];
        for (const m of r.regimen) {
            const c = cur.get(m.med.name);
            if (!c && !mods.some(x => x.action !== 'keep' && x.target?.med.name === m.med.name)) add('NEW_DRUG_UNEXPLAINED', `${tag} ${m.med.name} has no add/swap line`);
            if (c && sig([c]) !== sig([m]) && !mods.some(x => x.action !== 'keep' && (x.target?.med.name === m.med.name))) add('DOSE_CHANGE_UNEXPLAINED', `${tag} ${m.med.name} ${describe([c])} -> ${describe([m])}`);
        }
        for (const [name] of cur) if (!r.regimen.some(m => m.med.name === name) && !mods.some(x => (x.action === 'remove' || x.action === 'swap') && x.source?.med.name === name)) add('REMOVAL_UNEXPLAINED', `${tag} ${name} dropped with no remove/swap line`);

        // 2. Safety invariants
        let newGroups = 0; const curGroups = new Set([...cur.values()].map(m => SINGLE_AGENT_GROUPS[m.med.drug_class] ?? m.med.drug_class));
        const resGroups = new Set(r.regimen.map(m => SINGLE_AGENT_GROUPS[m.med.drug_class] ?? m.med.drug_class));
        resGroups.forEach(g => { if (!curGroups.has(g)) newGroups++; });
        if (newGroups > p.max_new_classes_per_visit) add('TOO_MANY_NEW_CLASSES', `${tag} ${newGroups} > ${p.max_new_classes_per_visit}: ${describe(r.regimen)}`);

        for (const m of r.regimen) {
            const cls = m.med.drug_class, c = cur.get(m.med.name), isNew = !c;
            const up = !!c && daily(m) > daily(c) + 1e-9;
            const ctx = `${tag} ${m.med.name} ${m.dose.strength} ${m.selected_frequency}${c ? ` (was ${c.dose.strength} ${c.selected_frequency})` : ' (new)'} | K ${K} eGFR ${p.egfr} HR ${p.pulse} SBP ${p.sbp}`;
            if (p.allergies.has(m.med.name)) add('ALLERGIC_DRUG_SHOWN', ctx);
            if (p.is_pregnant && PREGNANCY_AVOID.has(cls)) add('PREGNANCY_AVOID_CLASS', ctx);
            // below a heart rate of 50 no beta-1-selective agent can be started, so the non-selective one is reduced instead of switched
            // a non-selective agent already in use may stay when no beta-1-selective agent is eligible, but is never started or increased
            if (p.is_pregnant && cls === BB && !m.med.facts?.beta1_selective && (isNew || up)) add('PREGNANCY_NONSELECTIVE_BB_STARTED_OR_RAISED', ctx);
            if (isNew && (RAAS.has(cls) || MRA.has(cls)) && (!kKnown || !egfrKnown)) add('RAAS_MRA_START_WITHOUT_LABS', ctx);
            if (up && (RAAS.has(cls) || MRA.has(cls)) && (!kKnown || !egfrKnown)) add('RAAS_MRA_INCREASE_WITHOUT_LABS', ctx);
            // a forced switch within the class (allergy, intolerance) at the same or a lower equivalent is not a new start
            if (isNew && MRA.has(cls) && kKnown && K >= 5.0 && !hasCurMra) add('MRA_START_AT_K5', ctx);
            if (isNew && RAAS.has(cls) && kKnown && K > 5.4) add('RAAS_START_OR_SWAP_ABOVE_5_4', ctx);
            if (isNew && RAAS.has(cls) && kKnown && K > 5.2 && !hasCurRaas) add('RAAS_START_ABOVE_5_2', ctx);
            if (up && (RAAS.has(cls) || MRA.has(cls)) && kKnown && K >= 5.5) add('RAAS_MRA_INCREASE_AT_K5_5', ctx);
            if (up && MRA.has(cls) && kKnown && K >= 5.0) add('MRA_INCREASE_AT_K5', ctx);
            if ((RAAS.has(cls) || MRA.has(cls)) && kKnown && K >= 6.0) add('RAAS_MRA_KEPT_AT_K6', ctx);
            if (isNew && cls === 'MRA' && known(p.egfr) && p.egfr <= 30) add('STEROIDAL_MRA_START_EGFR_30', ctx);
            if (isNew && (cls === 'ACEi' || cls === 'ARNI') && p.comorbidities.has('History of Angioedema')) add('ACEI_ARNI_START_ANGIOEDEMA', ctx);
            if (isNew && cls === BB && !curClasses.has(BB) && p.rhythm !== 'Paced' && !(p.pulse >= 50)) add('BB_START_HR_LT_50_OR_BLANK', ctx);
            if (up && cls === BB && p.rhythm !== 'Paced' && !(p.pulse >= 60)) add('BB_INCREASE_HR_LT_60_OR_BLANK', ctx);
            const hasCurBb = curClasses.has(BB);
            if (((isNew && !hasCurBb) || up) && cls === BB && isAcutelyDecompensated(p)) add('BB_START_OR_INCREASE_DECOMPENSATED', ctx);
            if (isNew && cls === BB && (p.rhythm === '2nd Degree AV Block' || p.rhythm === '3rd Degree AV Block')) add('BB_START_AV_BLOCK', ctx);
            if (isNew && cls === BB && p.comorbidities.has('Severe Asthma / Bronchospasm')) add('BB_START_SEVERE_ASTHMA', ctx);
            if (isNew && cls === 'If Inhibitor' && (p.rhythm !== 'Sinus' || !known(p.pulse) || p.pulse < 70)) add('IVABRADINE_START_NOT_SINUS_70', ctx);
            if (isNew && cls === 'SGLT2i' && (p.comorbidities.has('Type 1 Diabetes Mellitus') || p.comorbidities.has('Prior DKA / Euglycemic DKA'))) add('SGLT2_START_T1DM_DKA', ctx);
            if (up && c && daily(m) > 2 * daily(c) + 1e-9 && tierIndex(m) > tierIndex(c) + 1) add('STEP_MORE_THAN_DOUBLE', ctx);
            if (isNew && !c && m.med.drug_class === 'Loop Diuretic' && m.med.facts?.short_course_addon && oralLoops.length === 0) add('SC_LOOP_WITHOUT_ORAL_LOOP', ctx);
        }
        // potassium 5.5-5.9: the MRA goes first; with no MRA the RAAS inhibitor is reduced
        if (kKnown && K >= 5.5 && K < 6.0) {
            for (const [name, c] of cur) {
                const cls = c.med.drug_class;
                const target = hasCurMra ? MRA.has(cls) : RAAS.has(cls);
                if (!target) continue;
                const now = r.regimen.find(m => m.med.name === name);
                if (now && daily(now) >= daily(c) - 1e-9) add('NOT_REDUCED_AT_K5_5', `${tag} ${name} still ${now.dose.strength} ${now.selected_frequency} at K ${K}`);
            }
        }
        // bradycardia on a beta-blocker
        if (known(p.pulse) && p.rhythm !== 'Paced' && p.pulse < 50) {
            for (const [name, c] of cur) {
                if (c.med.drug_class !== BB) continue;
                const now = r.regimen.find(m => m.med.name === name);
                if (now && daily(now) >= daily(c) - 1e-9) add('BB_NOT_REDUCED_HR_LT_50', `${tag} ${name} still ${now.dose.strength} ${now.selected_frequency} at HR ${p.pulse}`);
            }
        }
        // projected display floors
        const pp = r.projected_patient;
        if (pp.sbp < 85 && pp.sbp < p.sbp) add('PROJECTED_SBP_LT_85', `${tag} projected ${pp.sbp} from ${p.sbp}`);
        if (kKnown && pp.potassium > 6.0) add('PROJECTED_K_GT_6', `${tag} projected ${pp.potassium} from ${K}`);
        if (known(p.pulse) && pp.pulse < 45 && pp.pulse < p.pulse) add('PROJECTED_HR_LT_45', `${tag} projected ${pp.pulse} from ${p.pulse}`);
    });

    // ranking: the list is in a defensible order under Balanced
    if (p.ranking_mode !== 'foundational_first') {
        for (let i = 1; i < regs.length; i++) {
            if (regs[i].shown_because || regs[i - 1].shown_because) continue;
            if (regs[i].overall_score > regs[i - 1].overall_score) add('RANK_ORDER', `opt${i} ${regs[i - 1].overall_score} before opt${i + 1} ${regs[i].overall_score}`);
        }
    }

    // 3. Consistency
    const safe = (fn: () => SimulationOutput, code: string): SimulationOutput | null => { try { return fn(); } catch (e) { add(code, String(e).slice(0, 200)); return null; } };
    const sigs = (o: SimulationOutput) => o.scoredRegimens.map(r => sig(r.regimen)).join(' || ');

    const reversed = clonePatient(p); reversed.current_regimen = [...reversed.current_regimen].reverse();
    {
        const o = safe(() => run(reversed), 'THROW_REORDER');
        if (o && sigs(o) !== sigs(out)) add('ORDER_DEPENDENT', `${sigs(out)}  ##reversed##  ${sigs(o)}`);
    }

    const flipMode = clonePatient(p); flipMode.ranking_mode = p.ranking_mode === 'foundational_first' ? 'balanced' : 'foundational_first';
    const om = safe(() => run(flipMode), 'THROW_RANKING_MODE');
    if (om) {
        if (JSON.stringify(normalize(om.excludedMedications)) !== JSON.stringify(normalize(out.excludedMedications))) add('RANKING_MODE_CHANGES_EXCLUSIONS', '');
        if (JSON.stringify(om.gdmtGaps) !== JSON.stringify(out.gdmtGaps)) add('RANKING_MODE_CHANGES_GAPS', '');
        const scoreBySig = new Map(out.scoredRegimens.map(r => [sig(r.regimen), r.overall_score]));
        for (const r of om.scoredRegimens) { const s = scoreBySig.get(sig(r.regimen)); if (s !== undefined && s !== r.overall_score) add('RANKING_MODE_CHANGES_SCORE', `${s} vs ${r.overall_score}`); }
    }
    const flipPriority = clonePatient(p); flipPriority.care_priority = p.care_priority === 'cost_first' ? 'outcomes_first' : 'cost_first';
    const op = safe(() => run(flipPriority), 'THROW_CARE_PRIORITY');
    if (op) {
        if (JSON.stringify(normalize(op.excludedMedications)) !== JSON.stringify(normalize(out.excludedMedications))) add('CARE_PRIORITY_CHANGES_EXCLUSIONS', '');
        if ((op.scoredRegimens.length === 0) !== (regs.length === 0)) add('CARE_PRIORITY_CHANGES_HARD_STOP', '');
    }

    const top = regs[0];
    if (top) {
        const started = top.regimen.filter(m => !cur.has(m.med.name));
        if (started.length) {
            // typed the way a clinician might: lower case with a trailing space (the allergy resolver must still match it)
            const allergic = clonePatient(p); allergic.allergies.add(started[0].med.name.toLowerCase() + ' ');
            const oa = safe(() => run(allergic), 'THROW_ALLERGY');
            if (oa && oa.scoredRegimens.some(r => r.regimen.some(m => m.med.name === started[0].med.name))) add('ALLERGY_ADDED_STILL_SHOWN', started[0].med.name);
            const avail = new Set(ALL_NAMES); avail.delete(started[0].med.name);
            const ou = safe(() => run(p, avail), 'THROW_UNAVAILABLE');
            if (ou && ou.scoredRegimens.some(r => r.regimen.some(m => m.med.name === started[0].med.name))) add('UNAVAILABLE_DRUG_STARTED', started[0].med.name);
        }
        // self-consistency: enter option 1 as the current regimen (same labs, same vitals) - the tool must not undo what it just advised
        if (!top.warnings.some(w => w.startsWith('BUDGET EXCEEDED'))) {
            const next = clonePatient(p); next.current_regimen = top.regimen.map(m => ({ ...m }));
            const o2 = safe(() => run(next), 'THROW_SECOND_VISIT');
            const top2 = o2?.scoredRegimens[0];
            if (o2 && top2) {
                for (const m of top.regimen) {
                    const c = cur.get(m.med.name);
                    const intensified = !c || daily(m) > daily(c) + 1e-9;
                    if (!intensified || m.med.facts?.single_course_dose || m.med.facts?.short_course_addon) continue;
                    const after = top2.regimen.find(x => x.med.name === m.med.name);
                    const grp = (x: RegimenMed) => SINGLE_AGENT_GROUPS[x.med.drug_class] ?? x.med.drug_class;
                    // a switch to another agent of the same class is not a reversal
                    const undoneEverywhere = o2.scoredRegimens.every(r => { const a = r.regimen.find(x => x.med.name === m.med.name); return a ? daily(a) < daily(m) - 1e-9 : !r.regimen.some(x => grp(x) === grp(m)); });
                    if (undoneEverywhere) add('ADVICE_REVERSED_NEXT_RUN', `${c ? 'raised' : 'started'} ${m.med.name} ${m.dose.strength} ${m.selected_frequency}; with that entered, every option ${after ? `lowers it to ${after.dose.strength} ${after.selected_frequency}` : 'removes it'} | K ${K} eGFR ${p.egfr} HR ${p.pulse} SBP ${p.sbp} | ${describe(p.current_regimen)}`);
                }
            }
        }
    }
    return v;
}

// ---- main -----------------------------------------------------------------------------------------------------------------
function main() {
    const count = Number(process.argv[2] ?? 3000), seed0 = Number(process.argv[3] ?? 20261112);
    const quietWarn = console.warn; console.warn = () => { };
    const all: Violation[] = [];
    // Fixed checks of the allergy resolver: what a clinician types must exclude the drug; an unrelated allergy must exclude nothing.
    const allergyCases: [string, string[]][] = [
        ['lisinopril', ['Lisinopril']], ['Lisinopril ', ['Lisinopril']], ['ENTRESTO', ['Sacubitril/Valsartan (Entresto)']], ['aldactone', ['Spironolactone']],
        ['Metoprolol', ['Metoprolol Succinate']], ['metoprolol tartrate', ['Metoprolol Succinate']], ['Farxiga', ['Dapagliflozin']],
        ['ACE inhibitors', ['Lisinopril', 'Enalapril', 'Ramipril', 'Captopril']], ['valsartan', ['Sacubitril/Valsartan (Entresto)', 'Valsartan']],
        ['Penicillin', []], ['statin', []], ['', []],
    ];
    for (const [typed, want] of allergyCases) {
        const got = resolveAllergy(typed, MEDICATION_FORMULARY).sort().join(' | ');
        if (got !== [...want].sort().join(' | ')) all.push({ code: 'ALLERGY_RESOLVER', seed: 0, detail: `"${typed}" -> ${got || '(none)'}; expected ${want.join(' | ') || '(none)'}` });
    }
    let withOptions = 0;
    const t0 = Date.now();
    for (let i = 0; i < count; i++) {
        const seed = seed0 + i;
        const p = randomPatient(seed);
        const found = checkPatient(seed, p);
        all.push(...found);
        try { if (run(p).scoredRegimens.length) withOptions++; } catch { /* counted above */ }
    }
    console.warn = quietWarn;
    const byCode = new Map<string, Violation[]>();
    for (const x of all) { if (!byCode.has(x.code)) byCode.set(x.code, []); byCode.get(x.code)!.push(x); }
    console.log(`Randomized sweep: ${count} patients (seed ${seed0}), ${withOptions} with options, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const rows = [...byCode.entries()].sort((a, b) => b[1].length - a[1].length);
    const examples = Number(process.env.FUZZ_EXAMPLES ?? 3);
    for (const [code, list] of rows) {
        console.log(`\n${code}: ${list.length} (in ${new Set(list.map(x => x.seed)).size} patients)`);
        for (const x of list.slice(0, examples)) console.log(`   seed ${x.seed}: ${x.detail}`);
    }
    if (rows.length === 0) console.log('No violations.');
    // WATCHED, not failing below a ceiling: the tool undoing its own first option when that option is entered as the current regimen. The known residue is
    // rare (about 1 in 2,000 random patients, mostly the over-budget fallback and one-option outputs in extreme patients); a rise means a scoring
    // inconsistency has come back. Every other code fails the run.
    const WATCH: Record<string, number> = { ADVICE_REVERSED_NEXT_RUN: 0.002 };
    const failing = rows.filter(([code, list]) => !(code in WATCH) || new Set(list.map(x => x.seed)).size / count > WATCH[code]);
    if (rows.length && failing.length === 0) console.log('\nOnly watched codes, within their ceiling: PASS.');
    process.exit(failing.length ? 1 : 0);
}

if (process.argv[1] && /fuzzSweep/.test(process.argv[1])) main();
