import type { Patient } from '../../types';

export interface MissingItem { label: string; hint?: string }

const blankNum = (v: number | undefined) => !(typeof v === 'number' && Number.isFinite(v) && v > 0);

/**
 * Core items that are blank, using the labels the form uses. The hint is the form's own on-screen text for
 * that field (clinicalWarnings), if it has one; no new clinical rule is stated here.
 */
export function blankCoreItems(p: Patient, hints: Record<string, string> = {}): MissingItem[] {
    const items: MissingItem[] = [];
    const add = (blank: boolean, label: string, hint?: string) => { if (blank) items.push({ label, hint }); };
    add(blankNum(p.age), 'Age');
    add(!p.sex, 'Sex');
    add(blankNum(p.lvef), 'LVEF');
    add(!p.nyha_class, 'NYHA functional class');
    add(blankNum(p.sbp), 'Systolic blood pressure');
    add(blankNum(p.pulse), 'Pulse (heart rate)', hints.pulse);
    add(blankNum(p.potassium), 'Potassium', hints.potassium);
    add(blankNum(p.creatinine), 'Creatinine (kidney function)', hints.egfr);
    add(blankNum(p.volume_status.current_weight_kg), 'Current weight');
    add(blankNum(p.volume_status.dry_weight_kg), 'Estimated dry weight');
    add(!p.rhythm, 'Rhythm');
    add(!p.insurance_tier, 'Insurance coverage');
    return items;
}
