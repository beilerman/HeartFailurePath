/**
 * Symptoms and quality of life from measured KCCQ changes (data/symptomEvidence.json: placebo-subtracted KCCQ points per drug class and EF band).
 *
 *     points = sum over counted contributors of  credit x kccq_points
 *     score  = clamp(100 x points / KCCQ_FULL_CREDIT_POINTS, 0, 100)        (KCCQ_FULL_CREDIT_POINTS = 20, scoreModel.ts)
 *
 * One contributor per mechanism group, as in the outcome module (the contributor with the larger credit x points is counted; the other is reported as not
 * counted). Credit is the SAME trial-anchored dose credit as outcomes (outcomeDoseCredit, doseCredit.ts). ASSUMPTION: KCCQ points add across drugs (no trial
 * measured combinations); the breakdown says so. A class with no measurement is returned with `not_measured: true` and 0 points, never silently 0 as if measured.
 * A missing row throws (never a silent 0). Deterministic and side-effect free; only active exposures count.
 */
import type { Patient, RegimenMed } from '../../types';
import { efBandFor, type EfBand } from './outcomeBenefit';
import { outcomeDoseCredit } from './doseCredit';
import { getMedicationClassGroup } from './registry';
import { isActiveExposure } from './medicationExposure';
import { KCCQ_FULL_CREDIT_POINTS } from './scoreModel';
import { shrinkValue, tau2From, median } from './shrinkage';
import symptomEvidenceJson from '../../data/symptomEvidence.json';

export interface SymptomEvidenceRow {
    id: string; drug_class: string; ef_band: EfBand; kccq_points: number; ci_low: number | null; ci_high: number | null;
    instrument: string; basis: 'trial' | 'meta_analysis' | 'extrapolated' | 'not_measured';
    source: { trial: string; citation: string; pmid?: string };
    population: string; comparator: string; verification: string; quote: string; extrapolation: string; notes: string;
}
export const SYMPTOM_TABLE: SymptomEvidenceRow[] = (symptomEvidenceJson as unknown as { rows: SymptomEvidenceRow[] }).rows;

// ---- precision weighting (shrinkage.ts), on the KCCQ-point scale: se = (ci_high - ci_low) / 3.92 ----
const kSe = (r: SymptomEvidenceRow): number | null => (r.ci_low === null || r.ci_high === null ? null : (r.ci_high - r.ci_low) / 3.92);
interface SymptomStats { tau2: number; medianSe: number }
const SYMPTOM_STATS = new WeakMap<SymptomEvidenceRow[], SymptomStats>();
/** tau2 (DerSimonian-Laird centred on no effect, shrinkage.ts) over trial or meta-analysis rows with an interval (an identical figure counted once); median se over rows that have an interval. */
export function symptomStats(table: SymptomEvidenceRow[]): SymptomStats {
    let st = SYMPTOM_STATS.get(table);
    if (!st) {
        const seen = new Set<string>(), items: { x: number; se: number }[] = [];
        for (const r of table) {
            const se = kSe(r);
            if (!(r.basis === 'trial' || r.basis === 'meta_analysis') || se === null) continue;
            const key = `${r.kccq_points}|${r.ci_low}|${r.ci_high}`;
            if (seen.has(key)) continue;
            seen.add(key); items.push({ x: r.kccq_points, se });
        }
        st = { tau2: tau2From(items), medianSe: median(table.map(kSe).filter((x): x is number => x !== null && x > 0)) };
        SYMPTOM_STATS.set(table, st);
    }
    return st;
}
export interface ShrunkSymptom { used: number; se_used: number; B: number; imputed: boolean }
export function shrunkSymptomRow(table: SymptomEvidenceRow[], row: SymptomEvidenceRow): ShrunkSymptom {
    if (row.basis === 'not_measured' || row.kccq_points === 0) return { used: 0, se_used: 0, B: 1, imputed: row.ci_low === null && row.basis !== 'not_measured' && row.kccq_points === 0 };
    const st = symptomStats(table), u = shrinkValue(row.kccq_points, kSe(row), st.tau2, st.medianSe);
    return { used: u.used, se_used: u.se_used, B: u.B, imputed: u.imputed };
}

export class SymptomEvidenceError extends Error {
    constructor(public readonly code: 'missing' | 'duplicate', message: string) { super(message); this.name = 'SymptomEvidenceError'; }
}

export interface SymptomContributor {
    medication: string; drug_class: string; class_group: string; row_id: string;
    /** The value USED for ranking: the published KCCQ change pulled toward no effect by its precision. */
    kccq_points: number;
    kccq_points_published: number; ci_low: number | null; ci_high: number | null;
    shrinkage_b: number; interval_imputed: boolean;
    credit: number; points: number;
    basis: SymptomEvidenceRow['basis']; not_measured: boolean; trial: string; citation: string;
}
export interface SymptomNotCounted extends SymptomContributor { reason: string; counted_instead: string }
export interface SymptomEstimate {
    /** Credit-weighted KCCQ points (additivity across drugs is an assumption). */
    points: number;
    /** 0-100: clamp(100 x points / 20). */
    score: number;
    contributors: SymptomContributor[];
    not_counted: SymptomNotCounted[];
}

export function symptomRowFor(table: SymptomEvidenceRow[], med: { drug_class: string; name: string }, patient: Patient): SymptomEvidenceRow {
    const band = efBandFor(patient);
    const rows = table.filter(r => r.drug_class === med.drug_class && r.ef_band === band);
    if (rows.length === 0) throw new SymptomEvidenceError('missing', `No symptom-evidence row for ${med.name} (class ${med.drug_class}), band ${band}`);
    if (rows.length > 1) throw new SymptomEvidenceError('duplicate', `${rows.length} symptom-evidence rows for ${med.name}, band ${band}: ${rows.map(r => r.id).join(', ')}`);
    return rows[0];
}

export function regimenSymptomEstimate(table: SymptomEvidenceRow[], regimen: RegimenMed[], patient: Patient, creditFn: (r: RegimenMed, p: Patient) => number = outcomeDoseCredit): SymptomEstimate {
    const all: SymptomContributor[] = regimen.filter(isActiveExposure).map(r => {
        const row = symptomRowFor(table, r.med, patient), credit = creditFn(r, patient);
        const notMeasured = row.basis === 'not_measured';
        const u = shrunkSymptomRow(table, row);
        return { medication: r.med.name, drug_class: r.med.drug_class, class_group: getMedicationClassGroup(r.med.drug_class), row_id: row.id,
            kccq_points: u.used, kccq_points_published: row.kccq_points, ci_low: row.ci_low, ci_high: row.ci_high, shrinkage_b: u.B, interval_imputed: u.imputed,
            credit, points: notMeasured ? 0 : credit * u.used,
            basis: row.basis, not_measured: notMeasured, trial: row.source.trial, citation: row.source.citation };
    });
    const best = new Map<string, SymptomContributor>();
    for (const c of all) { const cur = best.get(c.class_group); if (!cur || c.points > cur.points) best.set(c.class_group, c); }
    const contributors = [...best.values()];
    const notCounted = all.filter(c => best.get(c.class_group) !== c).map(c => ({ ...c, reason: `same mechanism group (${c.class_group}); only the larger credit-weighted KCCQ change is counted`, counted_instead: best.get(c.class_group)!.medication }));
    const points = contributors.reduce((a, c) => a + c.points, 0);
    return { points, score: Math.min(100, Math.max(0, 100 * points / KCCQ_FULL_CREDIT_POINTS)), contributors, not_counted: notCounted };
}

/** The engine's tau2 for the symptom table (computed from it). */
export const SYMPTOM_TAU2: number = symptomStats(SYMPTOM_TABLE).tau2;
export const symptomEstimateFor = (regimen: RegimenMed[], patient: Patient, creditFn?: (r: RegimenMed, p: Patient) => number): SymptomEstimate => regimenSymptomEstimate(SYMPTOM_TABLE, regimen, patient, creditFn);

/** One-line breakdown text (two decimals). */
export const describeSymptomEstimate = (e: SymptomEstimate, titrated: string[] = []): string => {
    const nm = e.contributors.filter(c => c.not_measured).map(c => c.medication);
    const pulled = e.contributors.filter(c => !c.not_measured && Math.abs(c.kccq_points_published - c.kccq_points) >= 0.1);
    const pulledText = pulled.length ? ` Pulled toward no effect because the trials are small or imprecise: ${pulled.map(c => `${c.medication} published ${c.kccq_points_published.toFixed(1)}, used ${c.kccq_points.toFixed(1)}`).join('; ')}.` : '';
    return `Expected change of ${e.points.toFixed(1)} KCCQ points (full credit = ${KCCQ_FULL_CREDIT_POINTS}); trial averages, additive across drugs (an assumption: no trial measured the combinations), not a prediction for this patient.${titrated.length ? ` Valued as titrated to the trial-achieved dose: ${titrated.join(', ')}.` : ''}${pulledText}${nm.length ? ` Not measured: ${nm.join(', ')}.` : ''}`;
};
