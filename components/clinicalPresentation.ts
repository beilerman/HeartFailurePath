import type { Patient, RegimenMed, ScoredRegimen } from '../types';
import { congestionFindingCount } from '../services/clinicalPredicates';

const FREQUENCIES: Record<string, string> = {
    qd: 'once daily', bid: 'twice daily', tid: 'three times daily', qid: 'four times daily',
    qod: 'every other day', weekly: 'once weekly', once: 'once',
};
export const frequencyLabel = (value: string): string => FREQUENCIES[value] ?? value;
export const clinicalSentence = (value: string): string => value
    .replace(/\b(qd|bid|tid|qid|qod)\b/gi, v => frequencyLabel(v.toLowerCase()))
    .replace(/\$(?:Infinity|NaN)/g, 'cost unavailable');
export const doseLabel = (r: RegimenMed): string => `${r.dose.strength} ${r.dose.unit} ${frequencyLabel(r.selected_frequency)}`;
export const costLabel = (value: number): string => Number.isFinite(value) && value >= 0 ? `$${value.toFixed(2)}/month estimated` : 'Cost unavailable';
export const NO_CHANGE_TEXT = 'No medication change is proposed in this option. Review remaining treatment gaps, safety warnings and monitoring before deciding to continue.';

/** Describes observations, not a diagnosis inferred from weight or an unchecked exam. */
export function volumeDescription(p: Patient): string {
    const { current_weight_kg: current, dry_weight_kg: dry, exam_findings: findings } = p.volume_status;
    if (!(current > 0) || !(dry > 0) || !Number.isFinite(current - dry)) return 'Enter current and estimated dry weight';
    const delta = current - dry;
    const weight = Math.abs(delta) <= 1 ? 'Near estimated dry weight' : `${Math.abs(delta).toFixed(1)} kg ${delta > 0 ? 'above' : 'below'} estimated dry weight`;
    const exam = congestionFindingCount(findings) > 0 ? 'congestion findings recorded' : 'no congestion findings recorded';
    return `${weight}; ${exam}${findings.has('Cool Extremities') ? '; cool extremities recorded' : ''}. Assess volume and perfusion clinically.`;
}

/** Compare actual drug/dose choices, independently of the internal score. */
export function optionDifferences(option: ScoredRegimen, leader: ScoredRegimen): string[] {
    const first = new Map(leader.regimen.map(r => [r.med.name, r]));
    const other = new Map(option.regimen.map(r => [r.med.name, r]));
    const differences: string[] = [];
    for (const r of option.regimen) {
        const before = first.get(r.med.name);
        if (!before) differences.push(`Includes ${r.med.name} ${doseLabel(r)}; option 1 does not.`);
        else if (doseLabel(r) !== doseLabel(before)) differences.push(`${r.med.name}: ${doseLabel(r)} here; ${doseLabel(before)} in option 1.`);
    }
    for (const r of leader.regimen) if (!other.has(r.med.name)) differences.push(`Does not include ${r.med.name}, which is included in option 1.`);
    return differences.length ? differences : ['Same medications and doses as option 1; compare the cautions and monitoring.'];
}
