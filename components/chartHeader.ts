import type { Patient } from '../types';
import { valueUnknown } from '../services/clinicalPredicates';
import { WEIGHT_PROFILE_META } from '../services/engine/scoreModel';
import { RANKING_MODE_META } from './rankingModeMeta';
import { RULESET_VERSION } from '../services/rulesetVersion';

/** Patient inputs and time captured when the analysis ran (not when the note is copied). */
export interface RunSnapshot {
    ranAt: string; // ISO timestamp
    patient: Patient;
}

const NOT_ENTERED = 'not entered';
const TIER_LABEL: Record<string, string> = { cash: 'uninsured / cash price', commercial: 'commercial insurance', medicare: 'Medicare Part D' };

const num = (v: number | undefined, unit = ''): string => (valueUnknown(v) ? NOT_ENTERED : `${v}${unit}`);
const list = (items: Iterable<string> | undefined): string => {
    const arr = items ? [...items].filter(Boolean).sort() : [];
    return arr.length > 0 ? arr.join(', ') : 'none';
};
const pad = (n: number) => String(n).padStart(2, '0');

function formatRunTime(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return NOT_ENTERED;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Header block for the copied note: run date, rule-set version and the inputs the recommendation depends on. */
export function buildChartHeader(snap: RunSnapshot): string {
    const p = snap.patient;
    const bp = valueUnknown(p.sbp) || valueUnknown(p.dbp) ? NOT_ENTERED : `${p.sbp}/${p.dbp} mmHg`;
    const hr = `${num(p.pulse, ' bpm')}, rhythm ${p.rhythm || NOT_ENTERED}`;
    const wv = p.volume_status;
    const weight = `current ${num(wv?.current_weight_kg, ' kg')}, dry ${num(wv?.dry_weight_kg, ' kg')}`;
    const regimen = (p.current_regimen ?? []).map(r => `${r.med.name} ${r.dose.strength}${r.dose.unit} ${r.selected_frequency}`);
    const intol = (p.discontinued_meds ?? []).map(d => `${d.name} (${d.reason}${d.reason_detail ? `: ${d.reason_detail}` : ''})`);
    const budget = p.max_affordable_cost === undefined || Number.isNaN(p.max_affordable_cost) ? NOT_ENTERED : `$${p.max_affordable_cost}/month`;
    const priority = WEIGHT_PROFILE_META[p.care_priority ?? 'default']?.label ?? NOT_ENTERED;
    const mode = RANKING_MODE_META[p.ranking_mode ?? 'balanced']?.label ?? NOT_ENTERED;
    const preg = p.sex === 'Female' ? [`  Pregnant: ${p.is_pregnant ? 'yes' : 'no'}`] : [];
    const maxNew = valueUnknown(p.max_new_classes_per_visit) ? NOT_ENTERED : String(p.max_new_classes_per_visit);
    const status = (v: string | undefined) => (v && v !== 'unknown' ? v : NOT_ENTERED);
    return [
        `Analysis run: ${formatRunTime(snap.ranAt)}`,
        `Rule-set version: ${RULESET_VERSION}`,
        'INPUTS USED',
        `  Age/sex: ${num(p.age, ' y')}, ${p.sex || NOT_ENTERED}; race: ${p.race || NOT_ENTERED}`,
        ...preg,
        `  LVEF: ${num(p.lvef, '%')}; prior lowest LVEF: ${num(p.previous_lvef, '%')}; ever LVEF 40% or lower: ${status(p.ever_lvef_le_40)}; NYHA class: ${p.nyha_class || NOT_ENTERED}`,
        `  Recent HF worsening: ${status(p.recent_hf_worsening_within_6mo)}; KCCQ: ${num(p.kccq_score)}; SpO2: ${num(p.oxygen_saturation, '%')}`,
        `  BP: ${bp}; heart rate: ${hr}`,
        `  Potassium: ${num(p.potassium, ' mmol/L')}; creatinine: ${num(p.creatinine, ' mg/dL')}; eGFR: ${num(p.egfr, ' mL/min/1.73m2')}; baseline creatinine: ${num(p.baseline_creatinine, ' mg/dL')}`,
        `  BUN: ${num(p.bun, ' mg/dL')}; ferritin: ${num(p.ferritin, ' ng/mL')}; TSAT: ${num(p.tsat, '%')}; hemoglobin: ${num(p.hemoglobin, ' g/dL')}`,
        `  NT-proBNP: ${num(p.nt_pro_bnp, ' pg/mL')}`,
        `  Weight: ${weight}`,
        `  Congestion findings: ${list(wv?.exam_findings)}`,
        `  Comorbidities: ${list(p.comorbidities)}`,
        `  Allergies: ${list(p.allergies)}`,
        `  Documented intolerances: ${intol.length > 0 ? intol.join('; ') : 'none'}`,
        `  Other current medications: ${list(p.external_medications)}`,
        `  Current regimen: ${regimen.length > 0 ? regimen.join('; ') : 'none'}`,
        `  Pricing profile: ${TIER_LABEL[p.insurance_tier] ?? NOT_ENTERED}; budget: ${budget}; max new drug classes per visit: ${maxNew}`,
        `  Ranking approach: ${mode}; what matters most: ${priority}`,
    ].join('\n');
}
