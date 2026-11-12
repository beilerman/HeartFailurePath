/**
 * Allergy text -> formulary drugs.
 *
 * The allergy box is free text. Before 2026-11-12 an allergy excluded a drug only when the text was the EXACT formulary name ("Lisinopril"): "lisinopril",
 * "Entresto", "Aldactone", "metoprolol" or "ACE inhibitor" excluded nothing and the drug could be started or kept with no warning (adversarial review).
 * This module resolves what was typed to formulary drug names; the engine adds the resolved names to the patient's allergy set at the start of a run, so
 * every existing `allergies.has(med.name)` check sees them. The form uses the same function to show what an entry matched, or that it matched nothing.
 *
 * Matching (case- and spacing-insensitive): the formulary name, its generic part or its brand in parentheses; a brand or common name the entry declares
 * (facts.allergy_aliases); a class name
 * (every drug of that class); or a generic component of at least 5 letters ("valsartan" also matches sacubitril/valsartan). Deliberately conservative in one
 * direction only: a match EXCLUDES a drug, and an entry that matches nothing is reported, never silently ignored.
 * Plain data, no engine imports: the caller passes the formulary.
 */
import type { Medication } from '../../types';

/** Class names -> formulary `drug_class` values (lower-case keys; a trailing "s" on what was typed is ignored). */
export const ALLERGY_CLASS_ALIASES: Record<string, string[]> = {
    'ace inhibitor': ['ACEi'], 'acei': ['ACEi'], 'ace-i': ['ACEi'], 'ace': ['ACEi'], 'angiotensin converting enzyme inhibitor': ['ACEi'],
    // The ARNI contains an ARB (valsartan), so an ARB-class allergy excludes it too (review 3: "ARBs" excluded valsartan and then offered sacubitril/valsartan).
    'arb': ['ARB', 'ARNI'], 'angiotensin receptor blocker': ['ARB', 'ARNI'], 'sartan': ['ARB', 'ARNI'],
    'arni': ['ARNI'],
    'beta blocker': ['Beta Blocker'], 'beta-blocker': ['Beta Blocker'], 'betablocker': ['Beta Blocker'],
    'mra': ['MRA', 'nsMRA'], 'aldosterone antagonist': ['MRA'], 'mineralocorticoid receptor antagonist': ['MRA', 'nsMRA'],
    'sglt2': ['SGLT2i'], 'sglt2i': ['SGLT2i'], 'sglt2 inhibitor': ['SGLT2i'], 'sglt-2 inhibitor': ['SGLT2i'], 'gliflozin': ['SGLT2i'],
    'glp-1': ['GLP-1 RA', 'GLP-1/GIP RA'], 'glp1': ['GLP-1 RA', 'GLP-1/GIP RA'], 'glp-1 agonist': ['GLP-1 RA', 'GLP-1/GIP RA'], 'glp-1 receptor agonist': ['GLP-1 RA', 'GLP-1/GIP RA'],
    'loop diuretic': ['Loop Diuretic'], 'thiazide': ['Thiazide-like Diuretic'], 'thiazide diuretic': ['Thiazide-like Diuretic'],
    'potassium binder': ['K+ Binder'], 'nitrate': ['Vasodilator'],
};

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Formulary drug names that the typed allergy refers to (empty when it matches nothing in this tool). */
export function resolveAllergy(text: string, formulary: readonly Medication[]): string[] {
    const t = norm(text);
    if (!t) return [];
    const singular = t.endsWith('s') ? t.slice(0, -1) : t;
    const hits = new Set<string>();
    for (const m of formulary) {
        const full = norm(m.name);
        const generic = norm(m.name.replace(/\(.*\)/, ''));
        const brand = norm((m.name.match(/\(([^)]*)\)/)?.[1] ?? ''));
        if (t === full || t === generic || (brand && (t === brand || brand.split(' ').includes(t)))) hits.add(m.name);
        // a generic component: "metoprolol" -> Metoprolol Succinate, "valsartan" -> Valsartan and Sacubitril/Valsartan
        const parts = generic.split(/[\s/]+/).filter(Boolean);
        if (t.length >= 5 && parts.includes(t)) hits.add(m.name);
        // another salt or formulation of the same molecule: "metoprolol tartrate" -> Metoprolol Succinate
        const firstWord = t.split(' ')[0];
        if (firstWord.length >= 5 && parts[0] === firstWord) hits.add(m.name);
        // "metoprolol succinate er", "lisinopril 10 mg": what was typed starts with the generic name
        if (generic.length >= 5 && (t.startsWith(generic + ' ') || t.startsWith(generic + '/'))) hits.add(m.name);
    }
    // Brand and common names are declared on each formulary entry (facts.allergy_aliases), not here: engine code holds no drug names.
    for (const m of formulary) { const aliases = m.facts?.allergy_aliases ?? []; if (aliases.includes(t) || aliases.includes(singular)) hits.add(m.name); }
    const classes = ALLERGY_CLASS_ALIASES[t] ?? ALLERGY_CLASS_ALIASES[singular];
    if (classes) formulary.filter(m => classes.includes(m.drug_class)).forEach(m => hits.add(m.name));
    return [...hits];
}

/**
 * The patient's allergy entries with their resolved formulary names added (originals kept, so text rules such as the sulfa and adhesive checks still read
 * them). Returns the entries that matched no formulary drug and no text rule the engine knows, for a notice.
 */
export function expandAllergies(allergies: Set<string>, formulary: readonly Medication[]): { expanded: Set<string>; unmatched: string[] } {
    const expanded = new Set(allergies);
    const unmatched: string[] = [];
    const TEXT_RULES = ['sulfa', 'sulfonamide', 'loop diuretic', 'adhesive', 'acrylate'];
    allergies.forEach(entry => {
        const names = resolveAllergy(entry, formulary);
        names.forEach(n => expanded.add(n));
        if (names.length === 0 && !TEXT_RULES.some(k => entry.toLowerCase().includes(k))) unmatched.push(entry);
    });
    return { expanded, unmatched };
}
