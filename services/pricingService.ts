
import type { InsuranceTier } from '../types';

interface DrugPriceEntry {
    cash: number;           // GoodRx / NADAC cash price (monthly)
    commercial_copay: number; // Typical commercial insurance copay
    medicare_copay: number;   // Medicare Part D copay (post-IRA where applicable)
    generic_available: boolean;
    has_copay_card: boolean;  // Manufacturer copay assistance available
    tier: 'generic' | 'preferred_brand' | 'specialty';
    notes?: string;
}

// Curated monthly cost estimates (30-day supply unless noted).
// Sources: CMS NADAC, GoodRx median cash, Medicare Part D formulary tiers,
// and manufacturer copay-card programs (2024-2025 data).
export const DRUG_PRICES: Record<string, DrugPriceEntry> = {
    // --- GENERICS ---
    'Lisinopril': {
        cash: 4, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Enalapril': {
        cash: 4, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Ramipril': {
        cash: 5, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Captopril': {
        cash: 8, commercial_copay: 5, medicare_copay: 5,
        generic_available: true, has_copay_card: false, tier: 'generic',
        notes: 'TID dosing; rarely initiated de novo'
    },
    'Valsartan': {
        cash: 8, commercial_copay: 5, medicare_copay: 5,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Candesartan': {
        cash: 10, commercial_copay: 5, medicare_copay: 5,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Losartan': {
        cash: 5, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Carvedilol': {
        cash: 4, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Metoprolol Succinate': {
        cash: 10, commercial_copay: 5, medicare_copay: 5,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Bisoprolol': {
        cash: 11, commercial_copay: 5, medicare_copay: 5,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Spironolactone': {
        cash: 4, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Eplerenone': {
        cash: 17, commercial_copay: 10, medicare_copay: 10,
        generic_available: true, has_copay_card: false, tier: 'generic',
        notes: 'Generic available since 2015'
    },
    'Finerenone (Kerendia)': {
        cash: 900, commercial_copay: 10, medicare_copay: 125,
        generic_available: false, has_copay_card: true, tier: 'preferred_brand',
        notes: 'Bayer copay card; FDA approved for HF with LVEF≥40 (July 2025). Cash ~$900/30 tablets (2026 aggregator prices $670-950; the old $550 was the 2021 list price)'
    },
    'Furosemide': {
        cash: 3, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Torsemide': {
        cash: 5, commercial_copay: 5, medicare_copay: 5,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Bumetanide': {
        cash: 6, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Hydralazine/Isosorbide Dinitrate': {
        cash: 20, commercial_copay: 15, medicare_copay: 15,
        generic_available: true, has_copay_card: false, tier: 'generic',
        notes: 'BiDil brand ~$500; generic combo available'
    },
    'Digoxin': {
        cash: 12, commercial_copay: 5, medicare_copay: 5,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Metolazone': {
        cash: 12, commercial_copay: 5, medicare_copay: 5,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Chlorthalidone': {
        cash: 5, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },
    'Hydrochlorothiazide': {
        cash: 4, commercial_copay: 3, medicare_copay: 3,
        generic_available: true, has_copay_card: false, tier: 'generic'
    },

    // --- PREFERRED BRAND / SPECIALTY ---
    'Sacubitril/Valsartan (Entresto)': {
        // Generic sacubitril/valsartan has been marketed in the US since 22-24 Jul 2025 (Novadoz/MSN, Torrent). Cash is the
        // GENERIC price with a discount card (~$30-75 per 30 days; SingleCare 2026-11 lists ~$31-48 at chain pharmacies).
        cash: 60, commercial_copay: 10, medicare_copay: 74,
        generic_available: true, has_copay_card: false, tier: 'generic',
        notes: 'Generic cash ~$30-75/30 d with a discount card; brand or no-card cash is $600-750 (SingleCare 2026-11: ~$751 per 60 x 24/26). Medicare negotiated price for brand Entresto is $295 per 30 days from 1 Jan 2026 (list WAC $628, CMS): a plan ceiling, the patient copay is set by the plan tier and the Part D cap, so medicare_copay is a plan-tier estimate. Re-check against GoodRx when updating.'
    },
    'Dapagliflozin': {
        // First generic dapagliflozin approved April 2026 (Network Health, 2026-05): 90-day cost at preferred pharmacies generic $150 (about $50/mo),
        // brand Farxiga $585 (about $195/mo); Cost Plus Drugs generic $15. The cash figure is the GENERIC price at a preferred pharmacy (floor $5).
        // Medicare negotiated price for Farxiga effective 1 Jan 2026: $178.50 per 30 days (list $556, CMS fact sheet): a plan ceiling, not a copay, so
        // medicare_copay stays a plan-tier estimate. Commercial copay unchanged (generic copay not verified).
        cash: 50, commercial_copay: 35, medicare_copay: 45,
        generic_available: true, has_copay_card: true, tier: 'generic',
        notes: 'Generic cash about $50/30 d at a preferred pharmacy (brand Farxiga about $195). Medicare negotiated Farxiga $178.50 (2026). verified-sglt2-glp1-adjuncts.md row 8.'
    },
    'Empagliflozin': {
        // Brand Jardiance: $645 per 90 days at preferred pharmacies (about $215/mo, Network Health 2026-05). Medicare negotiated price effective
        // 1 Jan 2026: $197 per 30 days (list $573, CMS fact sheet): a plan ceiling, so medicare_copay stays a plan-tier estimate.
        cash: 215, commercial_copay: 35, medicare_copay: 50,
        generic_available: false, has_copay_card: true, tier: 'preferred_brand',
        notes: 'Lilly/BI copay card; Medicare Part D preferred brand tier; Medicare negotiated Jardiance $197 (2026). verified-sglt2-glp1-adjuncts.md row 8.'
    },
    'Ivabradine': {
        cash: 58, commercial_copay: 30, medicare_copay: 45,
        generic_available: true, has_copay_card: false, tier: 'generic',
        notes: 'Generic ivabradine is on DailyMed from at least ten labelers (Novadoz, Northstar, Zydus, Alembic, Camber and others) besides brand Corlanor (Amgen, copay card). Figures unchanged: cash and launch prices were not verified.'
    },
    'Vericiguat': {
        cash: 650, commercial_copay: 10, medicare_copay: 170,
        generic_available: false, has_copay_card: true, tier: 'specialty',
        notes: 'Merck copay card covers most commercial; specialty tier on Medicare Part D'
    },
    'Patiromer': {
        cash: 985, commercial_copay: 0, medicare_copay: 175,
        generic_available: false, has_copay_card: true, tier: 'specialty',
        notes: 'Vifor free drug program for commercial; specialty tier Medicare'
    },
    'Sodium Zirconium Cyclosilicate (Lokelma)': {
        cash: 900, commercial_copay: 35, medicare_copay: 150,
        generic_available: false, has_copay_card: true, tier: 'specialty',
        notes: 'AZ copay card; faster onset than Patiromer (1hr vs 7hr). Cash ~$900/30 packets (2026 aggregator prices: NADAC ~$850, retail $1,027-1,043)'
    },
    'Semaglutide (Wegovy)': {
        // Cash $349/month standard (NovoCare, 0.25-2.4 mg; intro $199 for the first two fills of 0.25 and 0.5 mg; offer through 12/31/2026): unchanged.
        // Medicare: the GLP-1 Bridge (1 Jul 2026 to 31 Dec 2027) is a flat $50/month copay, with PRIOR AUTHORIZATION, for BMI 35 or higher, or BMI 27 or
        // higher with a condition such as heart disease; it does not count toward the Part D deductible or the out-of-pocket cap and Extra Help cannot be
        // applied (KFF Health News). Heart failure is not named but the engine's initiation gate is BMI 30 or higher with HF. The program ends 12/31/2027.
        cash: 349, commercial_copay: 25, medicare_copay: 50,
        generic_available: false, has_copay_card: true, tier: 'specialty',
        notes: 'Novo Nordisk savings card. Medicare $50/month under the GLP-1 Bridge (7/1/2026-12/31/2027) with PRIOR AUTHORIZATION (BMI >= 35, or >= 27 with a condition such as heart disease); ends 12/31/2027. verified-sglt2-glp1-adjuncts.md row 45.'
    },
    'Tirzepatide (Zepbound)': {
        // Cash is dose-dependent (Lilly, KwikPen regular self-pay): 2.5 mg $299, 5 mg $399, 7.5 mg $499, 10/12.5/15 mg $699, applied through
        // facts.cash_price_by_dose; `cash` here is the 10-15 mg figure. The $449 figure is a savings-card price for 7.5 mg and above (refill within 45 days,
        // card expires 12/31/2026), not the list self-pay price. Medicare: $50/month under the GLP-1 Bridge for the KwikPen (single-dose pens and
        // vials are not covered), 7/1/2026-12/31/2027, prior authorization, same BMI criteria as Wegovy.
        cash: 699, commercial_copay: 25, medicare_copay: 50,
        generic_available: false, has_copay_card: true, tier: 'specialty',
        notes: 'Cash by dose: 2.5 mg $299, 5 mg $399, 7.5 mg $499, 10-15 mg $699 (savings card $449 for 7.5 mg and above, expires 12/31/2026). Medicare $50/month under the GLP-1 Bridge (KwikPen only, 7/1/2026-12/31/2027, PRIOR AUTHORIZATION, BMI criteria). verified-sglt2-glp1-adjuncts.md rows 45-46.'
    },
    'Ferric Carboxymaltose': {
        // PER-COURSE cost amortized to a MONTHLY figure. Unit price: Medicare Part B payment limit J1439 $1.121 per mg (Q4 2026; BuyAndBill, a secondary billing
        // site), so 1000 mg = $1,121 and the modal label course (1000 mg day 1 + 500 mg week 6 = 1500 mg) = $1,681.50. AMORTIZATION RULE (engine policy):
        // the 1500 mg initial course is spread over 6 months (the course plus the week-12 maintenance decision): cash $1,681.50 / 6 = $280.
        // Medicare pays 80%: the 20% coinsurance on the course is $336.30 / 6 = $56 (no supplemental coverage assumed). Maintenance 500 mg doses
        // (weeks 12, 24, 36, only if still iron deficient, $560.50 each) are NOT included. Commercial copay unchanged and not verified (plan-specific).
        // Billed as a physician-administered medical-benefit drug (buy-and-bill), not Part D.
        cash: 280, commercial_copay: 50, medicare_copay: 56,
        generic_available: false, has_copay_card: false, tier: 'specialty',
        notes: 'Per-course cost amortized monthly: 1500 mg course x $1.121/mg (Medicare J1439, Q4 2026) = $1,681.50 over 6 months = $280/mo cash; Medicare 20% coinsurance $336.30 / 6 = $56/mo. Excludes 500 mg maintenance doses ($560.50 each). Medical benefit (buy-and-bill), not Part D. verified-sglt2-glp1-adjuncts.md row 31.'
    },
    'Furoscix (SC Furosemide)': {
        cash: 900, commercial_copay: 100, medicare_copay: 200,
        generic_available: false, has_copay_card: true, tier: 'specialty',
        notes: 'scPharmaceuticals copay program for commercial. ~$900 WAC per 80mg on-body infusor dose — episodic use; figures are a monthly-equivalent for the modeled outpatient decongestion burst. Was previously MISSING from this table, silently falling back to generic-level pricing and flattening its core cost trade-off vs oral loops.'
    }
};

const TIER_KEY_MAP: Record<InsuranceTier, keyof Pick<DrugPriceEntry, 'cash' | 'commercial_copay' | 'medicare_copay'>> = {
    cash: 'cash',
    commercial: 'commercial_copay',
    medicare: 'medicare_copay'
};

/**
 * Returns monthly drug costs for the requested insurance tier.
 * @param medicationNames Optional list of medication names (defaults to all formulary drugs).
 * @param tier Insurance scenario: 'cash' | 'commercial' | 'medicare'. Defaults to 'commercial'.
 * @returns Record mapping medication name → monthly cost in USD.
 */
export const getDrugPrices = (
    medicationNames?: string[],
    tier: InsuranceTier = 'commercial'
): Promise<Record<string, number>> => {
    return new Promise((resolve) => {
        const priceKey = TIER_KEY_MAP[tier];
        const prices: Record<string, number> = {};
        const namesToFetch = medicationNames || Object.keys(DRUG_PRICES);

        namesToFetch.forEach(name => {
            const entry = DRUG_PRICES[name];
            if (entry) {
                prices[name] = entry[priceKey];
            } else {
                // Fallback for unknown medications. A FORMULARY med landing here is a curation
                // miss (it silently prices like a cheap generic) — the verify harness asserts
                // every formulary name has an explicit DRUG_PRICES entry; the warn is a runtime
                // backstop for ad-hoc callers.
                console.warn(`pricingService: no DRUG_PRICES entry for "${name}" — using generic-level fallback.`);
                prices[name] = tier === 'cash' ? 150 : 50;
            }
        });

        resolve(prices);
    });
};
