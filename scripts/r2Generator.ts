// Seeded persona-first random patient generator (adopted from the round 2 engine reviewer's gen2.ts, imports made repo-relative, the debugging flag field removed).
// Continuous values and state flags (cold, decompensated, potassium 6.x, heart block, low weight, duplicates) that co-occur on purpose. Seeds: use >= 5,000,000.
import { generateAndScoreModifications, clonePatient } from '../services/simulationService';
import { reconcileDerivedFields } from '../data/scenarios';
import { DRUG_PRICES } from '../services/pricingService';
import { MEDICATION_FORMULARY as F, RELEVANT_COMORBIDITIES, RELEVANT_EXTERNAL_MEDICATIONS } from '../constants';
import type { Patient, RegimenMed, SimulationOutput, ScoredRegimen, Medication } from '../types';
export { F, clonePatient, generateAndScoreModifications };
export type { Patient, RegimenMed, SimulationOutput, ScoredRegimen, Medication };
export const NAMES = new Set(F.map(m => m.name));
const priceFor = (tier: string) => { const o: Record<string, number> = {}; for (const n of NAMES) { const e: any = (DRUG_PRICES as any)[n]; const k = Object.keys(e).find(k => k.toLowerCase().includes(tier))!; o[n] = e[k]; } return o; };
export const PRICES: Record<string, Record<string, number>> = { cash: priceFor('cash'), commercial: priceFor('commercial'), medicare: priceFor('medicare') };
export function mk(seed: number) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
type R = () => number;
const U = (r: R, a: number, b: number) => a + (b - a) * r();
const I = (r: R, a: number, b: number) => Math.round(U(r, a, b));
const P = <T,>(r: R, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const Y = (r: R, p: number) => r() < p;
const r1 = (x: number) => Math.round(x * 10) / 10;
export const EX = ['Edema (1+)', 'Edema (2+)', 'Edema (3+)', 'JVP Elevated', 'Orthopnea', 'Crackles', 'Ascites'];
const cls = (...c: string[]) => F.filter(m => c.includes(m.drug_class));
const oral = (m: Medication) => !m.facts?.short_course_addon;
function entry(r: R, m: Medication): RegimenMed { const d = P(r, m.available_doses); return { med: m, dose: d, selected_frequency: P(r, d.frequency_options) }; }
export interface Flags { cold: boolean; decomp: boolean; hyperK: boolean; k55: boolean; block3: boolean; block2: boolean; paced: boolean; lowSbp: boolean; scaleLow: boolean; dup: boolean; preg: boolean; }
export function gen2(seed: number): Patient {
  const r = mk(seed);
  const female = Y(r, 0.45);
  const age = Y(r, 0.25) ? I(r, 20, 56) : I(r, 40, 92);
  const f: Flags = {
    cold: Y(r, 0.12), decomp: Y(r, 0.16), hyperK: Y(r, 0.08), k55: Y(r, 0.06), block3: Y(r, 0.05), block2: Y(r, 0.04), paced: Y(r, 0.06), lowSbp: Y(r, 0.06),
    scaleLow: Y(r, 0.14), dup: Y(r, 0.2), preg: female && age < 50 && Y(r, 0.12),
  };
  const lvef = Y(r, 0.7) ? I(r, 10, 40) : I(r, 41, 65);
  let sbp = I(r, 95, 160), dbp = Math.min(sbp - 10, I(r, 50, 95));
  if (f.lowSbp) { sbp = I(r, 82, 99); dbp = Math.min(sbp - 8, I(r, 40, 70)); }
  if (f.cold && Y(r, 0.6)) dbp = sbp - I(r, 15, 25);
  const dry = I(r, 48, 125);
  let nyha: Patient['nyha_class'] = P(r, ['I', 'II', 'II', 'III', 'III', 'IV'] as const);
  let excess = P(r, [-0.5, 0, 0.5, 1.5, 3, 6]);
  const findings = new Set<string>();
  for (const e of EX) if (Y(r, 0.18)) findings.add(e);
  if (f.decomp) { if (Y(r, 0.5)) nyha = 'IV'; else { nyha = 'III'; excess = U(r, 2.2, 7); for (const e of ['JVP Elevated', 'Orthopnea', 'Crackles']) if (Y(r, 0.7)) findings.add(e); findings.add('Edema (2+)'); } }
  if (f.scaleLow) { excess = -U(r, 1.1, 5); if (Y(r, 0.6)) for (const e of ['JVP Elevated', 'Orthopnea', 'Edema (2+)']) if (Y(r, 0.6)) findings.add(e); }
  if (f.cold && Y(r, 0.6)) findings.add('Cool Extremities');
  let k = r1(U(r, 3.6, 5.2)); if (Y(r, 0.05)) k = r1(U(r, 2.9, 3.6)); if (f.k55) k = r1(U(r, 5.5, 5.99)); if (f.hyperK) k = r1(U(r, 6.0, 6.45));
  let rhythm: Patient['rhythm'] = P(r, ['Sinus', 'Sinus', 'AFib'] as const);
  if (f.paced) rhythm = 'Paced'; if (f.block2) rhythm = '2nd Degree AV Block'; if (f.block3) rhythm = '3rd Degree AV Block';
  const egfr = Y(r, 0.08) ? 0 : r1(Y(r, 0.5) ? U(r, 8, 60) : U(r, 55, 110));
  const regimen: RegimenMed[] = [];
  const slot = (c: string[], p: number) => { const ms = cls(...c).filter(oral); if (Y(r, p)) regimen.push(entry(r, P(r, ms))); };
  slot(['ARNI', 'ACEi', 'ARB'], 0.55); slot(['Beta Blocker'], 0.55); slot(['MRA', 'nsMRA'], 0.35); slot(['SGLT2i'], 0.35); slot(['Loop Diuretic'], 0.5); slot(['Thiazide-like Diuretic'], 0.08);
  slot(['Vasodilator'], 0.06); slot(['If Inhibitor'], 0.05); slot(['Inotrope'], 0.06); slot(['sGC Stimulator'], 0.04); slot(['K+ Binder'], 0.03);
  if (Y(r, 0.04)) regimen.push(entry(r, P(r, F.filter(m => m.facts?.short_course_addon))));
  if (f.dup) { const c = P(r, ['Beta Blocker', 'SGLT2i', 'Loop Diuretic', 'ARB', 'ACEi', 'MRA']); const have = regimen.find(x => x.med.drug_class === c); const pool = cls(c).filter(oral).filter(m => !have || m.name !== have.med.name); if (pool.length) regimen.push(entry(r, P(r, pool))); if (Y(r, 0.3)) { const x = regimen.find(q => q.med.drug_class === c); if (x) regimen.push({ ...x, dose: P(r, x.med.available_doses), selected_frequency: x.selected_frequency }); } }
  const ext = new Set<string>(RELEVANT_EXTERNAL_MEDICATIONS.filter(() => Y(r, 0.03)));
  const preg = female && age < 56 ? (f.preg ? true : (Y(r, 0.1) ? undefined : false)) : (female && Y(r, 0.03) ? undefined : (female ? false : undefined));
  const base: Patient = {
    age, sex: female ? 'Female' : 'Male', race: P(r, ['White', 'Black', 'Asian', 'Hispanic', 'Other'] as const), height_cm: I(r, 150, 195), bmi: Y(r, 0.1) ? 0 : I(r, 19, 46),
    sbp, dbp, pulse: Y(r, 0.04) ? 0 : I(r, 38, 125), oxygen_saturation: Y(r, 0.3) ? undefined : I(r, 88, 100), rhythm, nt_pro_bnp: Y(r, 0.1) ? 0 : I(r, 200, 9000),
    nyha_class: nyha, kccq_score: Y(r, 0.5) ? I(r, 10, 95) : undefined, lvef, lvedd: Y(r, 0.4) ? I(r, 45, 75) : undefined, lavi: Y(r, 0.4) ? I(r, 22, 60) : undefined,
    volume_status: { dry_weight_kg: dry, current_weight_kg: r1(dry + excess), exam_findings: findings },
    bun: Y(r, 0.08) ? 0 : I(r, 8, 90), creatinine: r1(U(r, 0.6, 2.8)), baseline_creatinine: undefined, egfr, potassium: k,
    ferritin: Y(r, 0.4) ? P(r, [40, 99, 150, 299, 500]) : undefined, tsat: Y(r, 0.4) ? P(r, [10, 19, 25]) : undefined, hemoglobin: Y(r, 0.4) ? r1(U(r, 8.5, 16.5)) : undefined,
    comorbidities: new Set(RELEVANT_COMORBIDITIES.filter(() => Y(r, 0.06))), external_medications: ext,
    allergies: new Set(Y(r, 0.08) ? [P(r, F.map(m => m.name))] : []),
    discontinued_meds: Y(r, 0.12) ? [{ name: P(r, F).name, drug_class: '', reason: 'Hyperkalemia' }].map(d => ({ ...d, drug_class: F.find(m => m.name === d.name)!.drug_class })) : [],
    is_pregnant: preg, previous_lvef: Y(r, 0.2) ? P(r, [25, 35, 45, 55]) : undefined, ever_lvef_le_40: P(r, ['yes', 'no', 'unknown'] as const), recent_hf_worsening_within_6mo: P(r, ['yes', 'no', 'unknown'] as const),
    current_regimen: regimen, max_affordable_cost: P(r, [5, 50, 300, 4000, 4000]), cost_sensitivity: I(r, 0, 10), insurance_tier: P(r, ['cash', 'commercial', 'medicare'] as const), complexity_tolerance: I(r, 0, 10),
    max_new_classes_per_visit: P(r, [1, 2, 2, 3]), care_priority: P(r, ['default', 'default', 'outcomes_first', 'cost_first', 'simplicity_first'] as const), ranking_mode: P(r, ['balanced', 'balanced', 'foundational_first'] as const),
  };
  if (Y(r, 0.25)) base.baseline_creatinine = r1(base.creatinine * P(r, [0.5, 0.7, 1, 1.3]));
  const q = reconcileDerivedFields(base);
  if (egfr === 0) q.egfr = 0;
  if (Y(r, 0.85)) q.current_regimen = q.current_regimen.map(x => ({ ...x, exposure: { status: 'active' as const, adherence: 'consistent' as const, dose_interval_reviewed: true } }));
  if (q.hemoglobin !== undefined && (q.ferritin !== undefined || q.tsat !== undefined)) { (q as any).iron_course_review = 'first_course'; (q as any).phosphate_review = 'not_indicated'; }
  return q;
}
export function run(p: Patient): SimulationOutput { return generateAndScoreModifications(clonePatient(p), NAMES, PRICES[p.insurance_tier]); }
export const fmt = (x: RegimenMed) => `${x.med.name} ${x.dose.strength}${x.dose.unit === 'mg' ? '' : x.dose.unit} ${x.selected_frequency}`;
export const changes = (s: ScoredRegimen) => (s.modification_set?.modifications ?? []).filter(m => m.action !== 'keep');
export const chText = (s: ScoredRegimen) => changes(s).map(m => m.summary).join(' ; ') || 'NO CHANGE';
export function shardArgs() { const a = process.argv.slice(2); const n = Number(a[0] ?? 1000); const sh = (a[1] ?? '0/1').split('/').map(Number); const seed0 = Number(a[2] ?? 5000000); return { n, shard: sh[0], total: sh[1], seed0 }; }
