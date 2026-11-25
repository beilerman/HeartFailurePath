// Pricing audit: every formulary drug has a sane price under every pricing profile, and no orphan price rows.
// Run: npx tsx scripts/pricingAudit.ts (exit 1 on failure)
import { MEDICATION_FORMULARY } from '../constants';
import { DRUG_PRICES, getDrugPrices } from '../services/pricingService';
import type { InsuranceTier } from '../types';

const TIERS: InsuranceTier[] = ['cash', 'commercial', 'medicare'];

const main = async () => {
    const failures: string[] = [];
    const formularyNames = MEDICATION_FORMULARY.map(m => m.name);
    const origWarn = console.warn;
    let fallbackHit = false;
    console.warn = () => { fallbackHit = true; };

    for (const name of formularyNames) {
        if (!DRUG_PRICES[name]) failures.push(`formulary drug has no price entry: ${name}`);
    }
    for (const key of Object.keys(DRUG_PRICES)) {
        if (!formularyNames.includes(key)) failures.push(`price entry matches no formulary drug: ${key}`);
    }
    for (const tier of TIERS) {
        const prices = await getDrugPrices(formularyNames, tier);
        const cash = await getDrugPrices(formularyNames, 'cash');
        for (const name of formularyNames) {
            const p = prices[name];
            if (p === undefined || !Number.isFinite(p) || p < 0) failures.push(`${tier}: ${name} price invalid (${p})`);
            else if (p > cash[name]) failures.push(`${tier}: ${name} price ${p} exceeds cash ${cash[name]}`);
        }
    }
    // Raw table check: report plan prices above cash (capped at read time, but worth fixing in the data).
    for (const [name, e] of Object.entries(DRUG_PRICES)) {
        for (const k of ['commercial_copay', 'medicare_copay'] as const) {
            if (e[k] > e.cash) console.log(`note: ${name} ${k} ${e[k]} > cash ${e.cash} in the table (capped by getDrugPrices)`);
        }
    }
    console.warn = origWarn;
    if (fallbackHit) failures.push('getDrugPrices used the unknown-drug fallback for a formulary drug');

    if (failures.length > 0) {
        console.error(`pricingAudit FAILED (${failures.length}):\n  ${failures.join('\n  ')}`);
        process.exit(1);
    }
    console.log(`pricingAudit OK: ${formularyNames.length} drugs x ${TIERS.length} profiles`);
};
main();
