
// MOCK DRUG PRICING API
// Standardized Logic:
// Generics = $10 / month (Standard Copay / Cash tier)
// Branded = $50 / month (Preferred Brand Copay)

const MOCK_DRUG_PRICES_USD: { [key: string]: number } = {
    // --- GENERICS ($10) ---
    'Lisinopril': 10.00,
    'Losartan': 10.00,
    'Carvedilol': 10.00,
    'Metoprolol Succinate': 10.00,
    'Bisoprolol': 10.00,
    'Spironolactone': 10.00,
    'Eplerenone': 10.00,
    'Furosemide': 10.00,
    'Torsemide': 10.00,
    'Hydralazine/Isosorbide Dinitrate': 10.00,
    'Digoxin': 10.00,
    'Metolazone': 10.00,

    // --- BRANDED / SPECIALTY ($50) ---
    // Core GDMT
    'Sacubitril/Valsartan (Entresto)': 50.00,
    'Dapagliflozin': 50.00,
    'Empagliflozin': 50.00,

    // Adjuncts
    'Ivabradine': 50.00,
    'Vericiguat': 50.00,
    'Patiromer': 50.00,
    'Ferric Carboxymaltose': 50.00, // One-time infusion amortized or copay

    // Metabolic / GLP-1 (Assuming Insurance Coverage)
    'Semaglutide (Wegovy)': 50.00,
    'Tirzepatide (Zepbound)': 50.00,

    // Default fallback for unknown / non-formulary medications
    'default': 150.00
};

/**
 * Simulates fetching drug prices from an external API.
 * @param medicationNames An array of medication names to fetch prices for.
 * @returns A promise that resolves to a record mapping medication names to their monthly cost.
 */
export const getDrugPrices = (medicationNames?: string[]): Promise<Record<string, number>> => {
    return new Promise((resolve) => {
        // Simulate network latency
        setTimeout(() => {
            const prices: Record<string, number> = {};
            const namesToFetch = medicationNames || Object.keys(MOCK_DRUG_PRICES_USD);
            namesToFetch.forEach(name => {
                // Exact match or fallback
                let price = MOCK_DRUG_PRICES_USD[name];

                // Fallback logic if name doesn't match exactly but is known brand
                if (price === undefined) {
                    if (name.includes('Entresto') || name.includes('Wegovy') || name.includes('Zepbound') || name.includes('Farxiga') || name.includes('Jardiance')) {
                        price = 50.00;
                    } else {
                        price = MOCK_DRUG_PRICES_USD['default'];
                    }
                }

                prices[name] = price;
            });
            resolve(prices);
        }, 500);
    });
};
