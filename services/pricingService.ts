
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
        cash: 550, commercial_copay: 10, medicare_copay: 125,
        generic_available: false, has_copay_card: true, tier: 'preferred_brand',
        notes: 'Bayer copay card; FDA approved for HF with LVEF≥40 (July 2025)'
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
        cash: 600, commercial_copay: 10, medicare_copay: 74,
        generic_available: false, has_copay_card: true, tier: 'preferred_brand',
        notes: 'GoodRx-median brand cash ~$560-650/mo. Novartis copay card covers up to $200/mo for commercial; the IRA-negotiated ~$295 price applies to MEDICARE only (modeled via medicare_copay).'
    },
    'Dapagliflozin': {
        cash: 290, commercial_copay: 35, medicare_copay: 45,
        generic_available: false, has_copay_card: true, tier: 'preferred_brand',
        notes: 'AZ copay card; Medicare Part D preferred brand tier'
    },
    'Empagliflozin': {
        cash: 310, commercial_copay: 35, medicare_copay: 50,
        generic_available: false, has_copay_card: true, tier: 'preferred_brand',
        notes: 'Lilly/BI copay card; Medicare Part D preferred brand tier'
    },
    'Ivabradine': {
        cash: 58, commercial_copay: 30, medicare_copay: 45,
        generic_available: false, has_copay_card: true, tier: 'preferred_brand',
        notes: 'Amgen copay card; authorized generic available in some markets'
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
        cash: 750, commercial_copay: 35, medicare_copay: 150,
        generic_available: false, has_copay_card: true, tier: 'specialty',
        notes: 'AZ copay card; faster onset than Patiromer (1hr vs 7hr)'
    },
    'Semaglutide (Wegovy)': {
        cash: 349, commercial_copay: 25, medicare_copay: 350,
        generic_available: false, has_copay_card: true, tier: 'specialty',
        notes: 'Novo Nordisk savings card; Medicare coverage limited (anti-obesity med exclusion)'
    },
    'Tirzepatide (Zepbound)': {
        cash: 449, commercial_copay: 25, medicare_copay: 450,
        generic_available: false, has_copay_card: true, tier: 'specialty',
        notes: 'Lilly savings card; Medicare generally not covered for weight management'
    },
    'Ferric Carboxymaltose': {
        cash: 315, commercial_copay: 50, medicare_copay: 60,
        generic_available: false, has_copay_card: false, tier: 'specialty',
        notes: 'IV infusion; often covered under medical benefit (Part B) not Part D'
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
