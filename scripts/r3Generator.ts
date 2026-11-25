// Seeded state-combination random patient generator (adopted from the round 3 engine reviewer's gen3.ts; the engine context is bound to this repository). Seeds: use >= 7,000,000.
import { MEDICATION_FORMULARY as F, RELEVANT_COMORBIDITIES, RELEVANT_EXTERNAL_MEDICATIONS } from '../constants';
import { reconcileDerivedFields } from '../data/scenarios';
export interface Ctx { F: any[]; reconcileDerivedFields: (p: any) => any; RELEVANT_COMORBIDITIES: string[]; RELEVANT_EXTERNAL_MEDICATIONS: string[] }
function mkr(seed: number) { let a = (seed * 40503 + 977) >>> 0; return () => { a = (a + 0x9E3779B9) >>> 0; let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad); t ^= t >>> 15; t = Math.imul(t, 0x735a2d97); t ^= t >>> 15; return (t >>> 0) / 4294967296; }; }
const r1 = (x: number) => Math.round(x * 10) / 10;
export const STATES = ['cold', 'decomp', 'k60', 'k55', 'klow', 'block3', 'block2', 'sick', 'paced', 'sbp88', 'sbp95', 'preg', 'pregBlank', 'scaleLow', 'dupLoop', 'dupBB', 'dupMRA', 'dupRAAS', 'dupSGLT', 'egfrLow', 'egfr20', 'anuria', 'asthma', 'liver', 'wpw', 'afib', 'pde5', 'cyp3a', 'blankLab', 'blankK', 'blankPulse', 'brady', 'tachy', 'ivab', 'digox', 'nitrate', 'glp1', 'ironDef', 'bcrRise', 'budgetLow', 'heldDrugs', 'allergy', 'nyha4', 'congest', 'hfpef', 'lvef15', 'noBP', 'unconfirmed', 'amio', 'nsaid', 'lithium', 'kBinder', 'furoscix', 'angioedema', 'hypoNa'] as const;
export type State = typeof STATES[number];
export interface Gen3 { p: any; states: State[] }
export function gen3(ctx: Ctx, seed: number, forced?: State[]): Gen3 {
  const { F } = ctx; const r = mkr(seed);
  const U = (a: number, b: number) => a + (b - a) * r(); const I = (a: number, b: number) => Math.round(U(a, b));
  const P = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]; const Y = (p: number) => r() < p;
  const cls = (...c: string[]) => F.filter((m: any) => c.includes(m.drug_class));
  const oral = (m: any) => !m.facts?.short_course_addon;
  const entry = (m: any) => { const d = P(m.available_doses) as any; return { med: m, dose: d, selected_frequency: P(d.frequency_options) as string }; };
  const nS = forced ? 0 : P([2, 3, 3, 3, 4, 4, 5]);
  const states = new Set<State>(forced ?? []);
  while (states.size < nS) states.add(P(STATES));
  const has = (s: State) => states.has(s);
  const female = Y(0.45); const age = has('preg') || has('pregBlank') ? I(19, 45) : Y(0.2) ? I(20, 56) : I(35, 92);
  let sex: 'Male' | 'Female' = (has('preg') || has('pregBlank')) ? 'Female' : female ? 'Female' : 'Male';
  let lvef = has('hfpef') ? I(50, 68) : has('lvef15') ? I(10, 20) : Y(0.75) ? I(12, 40) : I(41, 62);
  let sbp = I(100, 160), dbp = 0;
  if (has('sbp88')) sbp = I(80, 89); else if (has('sbp95')) sbp = I(90, 99);
  dbp = Math.max(30, Math.min(sbp - 6, I(45, 90)));
  if (has('cold') && Y(0.6)) dbp = sbp - I(12, 25);
  const dry = I(50, 120); let excess = P([-0.5, 0, 0.5, 1.2, 2.5, 4, 7]);
  const findings = new Set<string>();
  for (const e of ['Edema (1+)', 'Edema (2+)', 'Edema (3+)', 'JVP Elevated', 'Orthopnea', 'Crackles', 'Ascites']) if (Y(0.12)) findings.add(e);
  let nyha = P(['I', 'II', 'II', 'III', 'III', 'IV'] as const) as any;
  if (has('nyha4')) nyha = 'IV';
  if (has('decomp')) { nyha = P(['III', 'IV']); excess = U(2.2, 8); for (const e of ['JVP Elevated', 'Orthopnea', 'Crackles', 'Edema (2+)']) if (Y(0.7)) findings.add(e); }
  if (has('congest')) { excess = U(2.2, 6); findings.add(P(['JVP Elevated', 'Crackles', 'Edema (2+)'])); }
  if (has('scaleLow')) { excess = -U(1.1, 5); for (const e of ['JVP Elevated', 'Orthopnea', 'Edema (2+)']) if (Y(0.6)) findings.add(e); }
  if (has('cold')) { findings.add('Cool Extremities'); if (Y(0.5)) nyha = P(['III', 'IV']); }
  let k = r1(U(3.7, 5.2)); if (has('klow')) k = r1(U(2.8, 3.49)); if (has('k55')) k = r1(U(5.5, 5.99)); if (has('k60')) k = r1(P([6.0, 6.0, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7]));
  if (has('blankK')) k = 0;
  let rhythm: any = P(['Sinus', 'Sinus', 'AFib']); if (has('afib')) rhythm = 'AFib'; if (has('paced')) rhythm = 'Paced'; if (has('block2')) rhythm = '2nd Degree AV Block'; if (has('block3')) rhythm = '3rd Degree AV Block';
  let egfr = Y(0.1) ? 0 : r1(Y(0.4) ? U(10, 60) : U(55, 110)); if (has('egfrLow')) egfr = r1(U(15, 35)); if (has('egfr20')) egfr = r1(U(8, 22)); if (has('blankLab')) egfr = 0;
  const regimen: any[] = [];
  const slot = (c: string[], p: number, filt?: (m: any) => boolean) => { if (Y(p)) { const ms = cls(...c).filter(oral).filter(filt ?? (() => true)); regimen.push(entry(P(ms))); } };
  slot(['ARNI', 'ACEi', 'ARB'], 0.55); slot(['Beta Blocker'], 0.6); slot(['MRA', 'nsMRA'], has('k60') || has('k55') ? 0.7 : 0.4); slot(['SGLT2i'], 0.35); slot(['Loop Diuretic'], has('decomp') || has('congest') || has('dupLoop') ? 0.85 : 0.5); slot(['Thiazide-like Diuretic'], 0.1);
  const addDup = (c: string[]) => { const have = regimen.find(x => c.includes(x.med.drug_class)); if (!have) regimen.push(entry(P(cls(...c).filter(oral)))); const h2 = regimen.find(x => c.includes(x.med.drug_class)); const pool2 = cls(...c).filter(oral).filter((m: any) => m.name !== h2.med.name); if (pool2.length) regimen.push(entry(P(pool2))); };
  if (has('dupLoop')) addDup(['Loop Diuretic']); if (has('dupBB')) addDup(['Beta Blocker']); if (has('dupMRA')) addDup(['MRA', 'nsMRA']); if (has('dupRAAS')) addDup(['ARNI', 'ACEi', 'ARB']); if (has('dupSGLT')) addDup(['SGLT2i']);
  const addByName = (n: string) => { if (!regimen.some(x => x.med.name === n)) { const m = F.find((q: any) => q.name === n); if (m) regimen.push(entry(m)); } };
  if (has('ivab')) addByName('Ivabradine'); if (has('digox')) addByName('Digoxin'); if (has('nitrate')) addByName('Hydralazine/Isosorbide Dinitrate'); if (has('glp1')) addByName(P(['Semaglutide (Wegovy)', 'Tirzepatide (Zepbound)'])); if (has('kBinder')) addByName(P(['Patiromer', 'Sodium Zirconium Cyclosilicate (Lokelma)'])); if (has('furoscix')) addByName('Furoscix (SC Furosemide)');
  if (Y(0.04)) regimen.push(entry(P(cls('Vasodilator', 'sGC Stimulator', 'Inotrope', 'If Inhibitor'))));
  const comor = new Set<string>(ctx.RELEVANT_COMORBIDITIES.filter(() => Y(0.04)));
  const ext = new Set<string>(ctx.RELEVANT_EXTERNAL_MEDICATIONS.filter(() => Y(0.025)));
  if (has('asthma')) comor.add(P(['Asthma (Mild/Moderate)', 'Severe Asthma / Bronchospasm', 'COPD'])); if (has('liver')) comor.add(P(['Liver Disease (Child-Pugh B/C)', 'Liver Disease: Child-Pugh B confirmed (not C)']));
  if (has('wpw')) comor.add('Wolff-Parkinson-White / Accessory Pathway'); if (has('sick')) comor.add('Sick Sinus Syndrome / Sinoatrial Block'); if (has('anuria')) comor.add('Anuria'); if (has('afib')) comor.add('Atrial Fibrillation');
  if (has('angioedema')) comor.add('History of Angioedema'); if (has('hypoNa')) comor.add('Hypotension (Chronic)');
  if (has('pde5')) ext.add(P(['Sildenafil', 'Tadalafil', 'Riociguat'])); if (has('cyp3a')) ext.add(P(['Ketoconazole', 'Clarithromycin', 'Ritonavir', 'Fluconazole'])); if (has('amio')) ext.add(P(['Amiodarone', 'Verapamil', 'Diltiazem'])); if (has('nsaid')) ext.add(P(['Ibuprofen', 'Naproxen'])); if (has('lithium')) ext.add('Lithium');
  const isF = sex === 'Female';
  let preg: any = isF && age < 56 ? false : undefined; if (has('preg')) preg = true; if (has('pregBlank')) preg = undefined; if (isF && age >= 56) preg = Y(0.2) ? undefined : false;
  let pulse = I(52, 115); if (has('brady')) pulse = I(38, 54); if (has('tachy')) pulse = I(110, 135); if (has('blankPulse')) pulse = 0; if (has('block3') && Y(0.5)) pulse = I(32, 48);
  const base: any = {
    age, sex, race: P(['White', 'Black', 'Asian', 'Hispanic', 'Other']), height_cm: I(150, 195), bmi: has('glp1') || Y(0.3) ? I(28, 46) : Y(0.1) ? 0 : I(19, 30),
    sbp: has('noBP') ? 0 : sbp, dbp, pulse, oxygen_saturation: Y(0.3) ? undefined : (Y(0.1) ? I(82, 90) : I(91, 100)), rhythm, nt_pro_bnp: Y(0.1) ? 0 : I(300, 9000),
    nyha_class: nyha, kccq_score: Y(0.5) ? I(10, 95) : undefined, lvef, lvedd: Y(0.4) ? I(45, 75) : undefined, lavi: Y(0.4) ? I(22, 60) : undefined,
    volume_status: { dry_weight_kg: dry, current_weight_kg: r1(dry + excess), exam_findings: findings },
    bun: Y(0.08) ? 0 : I(8, 90), creatinine: has('blankLab') ? 0 : r1(U(0.6, 2.8)), baseline_creatinine: undefined, egfr, potassium: k,
    ferritin: has('ironDef') ? P([40, 99, 150]) : Y(0.3) ? P([40, 99, 150, 299, 500]) : undefined, tsat: has('ironDef') ? P([10, 15, 19]) : Y(0.3) ? P([10, 19, 25]) : undefined, hemoglobin: has('ironDef') ? r1(U(9, 14.5)) : Y(0.3) ? r1(U(8.5, 16.5)) : undefined,
    comorbidities: comor, external_medications: ext,
    allergies: new Set(has('allergy') || Y(0.05) ? [P(regimen.length && Y(0.6) ? regimen.map(x => x.med.name) : F.map((m: any) => m.name))] : []),
    discontinued_meds: has('heldDrugs') || Y(0.1) ? [{ name: P(F.map((m: any) => m.name)), drug_class: '', reason: P(['Hyperkalemia', 'Cough', 'Hypotension', 'Angioedema', 'Worsening kidney function']) }].map((d: any) => ({ ...d, drug_class: F.find((m: any) => m.name === d.name).drug_class })) : [],
    is_pregnant: preg, previous_lvef: Y(0.2) ? P([25, 35, 45, 55]) : undefined, ever_lvef_le_40: P(['yes', 'no', 'unknown']), recent_hf_worsening_within_6mo: P(['yes', 'no', 'unknown']),
    current_regimen: regimen, max_affordable_cost: has('budgetLow') ? P([1, 5, 20]) : P([50, 300, 4000, 4000, 4000]), cost_sensitivity: I(0, 10), insurance_tier: P(['cash', 'commercial', 'medicare']), complexity_tolerance: I(0, 10),
    max_new_classes_per_visit: P([1, 2, 2, 2, 3]), care_priority: P(['default', 'default', 'outcomes_first', 'cost_first', 'simplicity_first']), ranking_mode: P(['balanced', 'balanced', 'foundational_first']),
  };
  if (has('bcrRise') || Y(0.15)) base.baseline_creatinine = r1(base.creatinine * P(has('bcrRise') ? [0.4, 0.5, 0.6] : [0.5, 0.7, 1, 1.3]));
  const q = ctx.reconcileDerivedFields(base);
  if (egfr === 0) q.egfr = 0;
  if (has('blankLab')) q.creatinine = 0;
  const conf = !has('unconfirmed') && Y(0.85);
  if (conf) q.current_regimen = q.current_regimen.map((x: any) => ({ ...x, exposure: { status: 'active', adherence: 'consistent', dose_interval_reviewed: true } }));
  else if (Y(0.5)) q.current_regimen = q.current_regimen.map((x: any) => { const k2 = r(); return { ...x, exposure: k2 < 0.5 ? { status: 'active', adherence: 'consistent', dose_interval_reviewed: Y(0.5) } : k2 < 0.7 ? { status: 'held', restart_or_repeat_reviewed: Y(0.5) } : k2 < 0.85 ? { status: 'unknown' } : { status: 'active', adherence: 'partial' } }; });
  if (q.hemoglobin !== undefined && (q.ferritin !== undefined || q.tsat !== undefined) && Y(0.8)) { q.iron_course_review = 'first_course'; q.phosphate_review = 'not_indicated'; }
  return { p: q, states: [...states] };
}
const CTX: Ctx = { F: F as any[], reconcileDerivedFields: reconcileDerivedFields as any, RELEVANT_COMORBIDITIES: [...RELEVANT_COMORBIDITIES] as string[], RELEVANT_EXTERNAL_MEDICATIONS: [...RELEVANT_EXTERNAL_MEDICATIONS] as string[] };
/** The round 3 reviewer's generator bound to this repository: the patient for a seed. */
export const gen3r = (seed: number, forced?: State[]) => gen3(CTX, seed, forced);
