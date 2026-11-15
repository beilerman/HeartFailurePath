import type { InsuranceTier, RegimenMed } from '../types';

/** One cost lookup for the engine and the current-regimen display. Unknown never means free. */
export function monthlyMedicationCost(r: RegimenMed, tier: InsuranceTier, prices: Record<string, number>): number | undefined {
    const byDose = tier === 'cash' ? r.med.facts?.cash_price_by_dose?.[String(r.dose.strength)] : undefined;
    const value = byDose ?? prices[r.med.name];
    return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}
