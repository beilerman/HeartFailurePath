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

/** Every separator of a list typed in one entry (R8 X12): slash, comma, semicolon, ampersand, plus, the word "and" and a line break, with or without spaces. */
const SEPARATORS = /\s*(?:[\/,;&+\n\r]|\band\b)\s*/;

/**
 * A formulary combination product written with a slash or another separator ("sacubitril/valsartan", "hydralazine/isosorbide", "isosorbide dinitrate/hydralazine"): the pattern that finds it
 * (R8 X12 / X6b). Read BEFORE an entry is split, so the two halves are not read as two separate drugs. Built from the formulary's own generic name, so engine code holds no drug names.
 */
function combinationPatterns(formulary: readonly Medication[]): Array<{ name: string; re: RegExp }> {
    const out: Array<{ name: string; re: RegExp }> = [];
    for (const m of formulary) {
        const generic = norm(m.name.replace(/\(.*\)/, ''));
        const sides = generic.split('/').map(x => x.trim()).filter(Boolean);
        if (sides.length !== 2) continue;
        const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // the first word of a side is required; further words of that side ("dinitrate") are optional, so the short forms resolve
        const side = (x: string) => { const w = x.split(' ').filter(Boolean); return esc(w[0]) + w.slice(1).map(y => `(?:\\s+${esc(y)})?`).join(''); };
        const sep = '\\s*[\\/&+-]\\s*';
        out.push({ name: m.name, re: new RegExp(`\\b${side(sides[0])}${sep}${side(sides[1])}\\b|\\b${side(sides[1])}${sep}${side(sides[0])}\\b`) });
    }
    return out;
}

/**
 * Formulary drug names that the typed allergy refers to (empty when it matches nothing in this tool). R7 W10c: an entry that is a sentence ("allergic to lisinopril", "rash from Lisinopril",
 * "ACE inhibitors - cough", "swelling of lips with Entresto") names a drug or class when a formulary drug name, brand, declared alias or class name appears in it as a whole word or phrase;
 * the same resolver is applied to each word and to each run of two or three words. A match only EXCLUDES a drug, so the reading stays conservative. The bare word "ace" is not read on its own.
 * R8 X12: an entry that lists several drugs is split at every separator and each part is read ("lisinopril/carvedilol" excludes both); a combination product is recognised first. R8 X6a: a salt or
 * modifier word alone ("sodium", "ferric", "succinate") names no drug.
 */
export function resolveAllergy(text: string, formulary: readonly Medication[]): string[] {
    const t0 = norm(text);
    if (!t0) return [];
    // Salt and modifier words of a generic name, declared on the formulary entries (facts.allergy_modifier_words): read inside a sentence they name no drug.
    const modifierWords = new Set(formulary.flatMap(m => m.facts?.allergy_modifier_words ?? []));
    const hits = new Set<string>();
    let rest = t0;
    for (const c of combinationPatterns(formulary)) if (c.re.test(rest)) { hits.add(c.name); rest = rest.replace(new RegExp(c.re.source, 'g'), ' ; '); }
    for (const part of rest.split(SEPARATORS).map(x => x.trim()).filter(Boolean)) resolvePart(part, formulary, modifierWords).forEach(n => hits.add(n));
    return [...hits];
}

/** One separated part of an entry: the whole part, then each word and each run of two or three words in it (hyphens read both as typed and as spaces). */
function resolvePart(t: string, formulary: readonly Medication[], modifierWords: ReadonlySet<string>): string[] {
    const whole = resolveWholeEntry(t, formulary, modifierWords);
    const tokens = t.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
    const hyphenSplit = t.match(/[a-z0-9]+/g) ?? [];
    if (tokens.length < 2 && hyphenSplit.length < 2) return whole;
    const hits = new Set(whole);
    const grams: string[] = [];
    for (const list of [tokens, hyphenSplit]) for (let n = 1; n <= 3; n++) for (let i = 0; i + n <= list.length; i++) {
        const g = list.slice(i, i + n).join(' ');
        grams.push(g);
        if (g.includes('-')) grams.push(g.replace(/-/g, ' '));
    }
    for (const g of new Set(grams)) {
        if (g === t || g === 'ace' || g.length < 3) continue;
        resolveWholeEntry(g, formulary, modifierWords).forEach(n => hits.add(n));
    }
    return [...hits];
}

function resolveWholeEntry(t: string, formulary: readonly Medication[], modifierWords: ReadonlySet<string> = new Set()): string[] {
    const singular = t.endsWith('s') ? t.slice(0, -1) : t;
    const hits = new Set<string>();
    for (const m of formulary) {
        const full = norm(m.name);
        const generic = norm(m.name.replace(/\(.*\)/, ''));
        const brand = norm((m.name.match(/\(([^)]*)\)/)?.[1] ?? ''));
        if (t === full || t === generic || (brand && (t === brand || brand.split(' ').includes(t)))) hits.add(m.name);
        // a generic component: "metoprolol" -> Metoprolol Succinate, "valsartan" -> Valsartan and Sacubitril/Valsartan. A salt or modifier word alone ("sodium", "succinate") names no drug (R8 X6a).
        const parts = generic.split(/[\s/]+/).filter(Boolean);
        if (t.length >= 5 && parts.includes(t) && !modifierWords.has(t)) hits.add(m.name);
        // another salt or formulation of the same molecule: "metoprolol tartrate" -> Metoprolol Succinate (never by a modifier word: "ferric chloride", "sodium bicarbonate")
        const firstWord = t.split(' ')[0];
        if (firstWord.length >= 5 && parts[0] === firstWord && !modifierWords.has(firstWord)) hits.add(m.name);
        // "metoprolol succinate er", "lisinopril 10 mg": what was typed starts with the generic name
        if (generic.length >= 5 && (t.startsWith(generic + ' ') || t.startsWith(generic + '/'))) hits.add(m.name);
    }
    // Brand and common names are declared on each formulary entry (facts.allergy_aliases), not here: engine code holds no drug names.
    for (const m of formulary) { const aliases = m.facts?.allergy_aliases ?? []; if (aliases.includes(t) || aliases.includes(singular)) hits.add(m.name); }
    const classes = ALLERGY_CLASS_ALIASES[t] ?? ALLERGY_CLASS_ALIASES[singular];
    if (classes) formulary.filter(m => classes.includes(m.drug_class)).forEach(m => hits.add(m.name));
    return [...hits];
}

/** True when the whole entry is exactly one drug, brand, declared alias or class name (a plural class name counts): such an entry needs no note about how it was read (R8 X6d). */
function isBareName(entry: string, formulary: readonly Medication[]): boolean {
    const t = norm(entry), singular = t.endsWith('s') ? t.slice(0, -1) : t;
    if (ALLERGY_CLASS_ALIASES[t] || ALLERGY_CLASS_ALIASES[singular]) return true;
    return formulary.some(m => {
        const generic = norm(m.name.replace(/\(.*\)/, '')), brand = norm(m.name.match(/\(([^)]*)\)/)?.[1] ?? '');
        const aliases = m.facts?.allergy_aliases ?? [];
        return t === norm(m.name) || t === generic || (!!brand && t === brand) || aliases.includes(t) || aliases.includes(singular);
    });
}

/** R8 X6c: swelling of the face, lips, tongue or throat written with an ACE inhibitor, an angiotensin receptor blocker or sacubitril/valsartan is read as angioedema (one predicate, here). */
const RAAS_ALLERGY_CLASSES = ['ACEi', 'ARB', 'ARNI'];
export function entryReadsAsAngioedema(entry: string, formulary: readonly Medication[]): boolean {
    if (/angio-?(o)?edema/i.test(entry)) return true;
    if (!/\bswell\w*|\bswollen\b/i.test(entry) || !/\b(face|facial|lips?|tongue|throat)\b/i.test(entry)) return false;
    const names = new Set(resolveAllergy(entry, formulary));
    return formulary.some(m => names.has(m.name) && RAAS_ALLERGY_CLASSES.includes(m.drug_class));
}

const listNames = (names: string[]): string => { const n = names.map(x => x.replace(/\s*\(.*\)/, '')); return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0]; };

/**
 * The patient's allergy entries with their resolved formulary names added (originals kept, so text rules such as the sulfa and adhesive checks still read
 * them). Returns the entries that matched no formulary drug and no text rule the engine knows, for a notice.
 */
/** Entries that state there is no allergy (R9 Z6d). */
export const NO_ALLERGY_ENTRY = /^(nkda|nka|nkfa|no known (drug |medication |food )?allerg(?:y|ies)|no (drug |medication )?allerg(?:y|ies)|none( known)?|nil( known)?|n\/a|nothing)\.?$/i;
export function expandAllergies(allergies: Set<string>, formulary: readonly Medication[]): { expanded: Set<string>; unmatched: string[]; readAs: Array<{ entry: string; text: string }> } {
    const expanded = new Set(allergies);
    const unmatched: string[] = [];
    const readAs: Array<{ entry: string; text: string }> = [];
    allergies.forEach(entry => {
        // R9 Z6d: "NKDA", "no known drug allergies", "none" and "nil" say there is no allergy: read as that, with no note.
        if (NO_ALLERGY_ENTRY.test(entry.trim())) return;
        const names = resolveAllergy(entry, formulary);
        names.forEach(n => expanded.add(n));
        const rules = textRulesFor(entry);
        rules.filter(r => r.says).forEach(r => readAs.push({ entry, text: r.says! }));
        // R8 X6c: swelling of the face, lips, tongue or throat beside a renin-angiotensin drug is an angioedema history by the one predicate every reader uses (the word is added to the set).
        if (rules.length === 0 && entryReadsAsAngioedema(entry, formulary)) {
            expanded.add('angioedema');
            readAs.push({ entry, text: ALLERGY_TEXT_RULES.find(r => r.says)!.says! });
        }
        // R8 X6d: an entry longer than a bare name that was read as naming a drug or class says how it was read, so the clinician can see it ("tolerates lisinopril fine" is read as an allergy).
        if (names.length > 0 && !isBareName(entry, formulary)) readAs.push({ entry, text: `is read as an allergy to ${listNames(names)}: remove the entry if that is not meant` });
        if (names.length === 0 && rules.length === 0) unmatched.push(entry);
    });
    return { expanded, unmatched, readAs };
}

/**
 * Allergy wording that engine code reads as text rather than by drug name. ONE list: an entry that matches a rule here is never reported as unmatched, and the rules that
 * exclude drugs say what they excluded (`says`). Each reader keeps its own condition (the sulfa alert in eligibility.ts, the Furoscix checks in constants.ts, the angioedema history
 * in intolerance.ts); a generated check (engineReadinessR6Checks.ts) feeds every wording below to the engine and asserts the unmatched note appears if and only if nothing changed.
 */
export const ALLERGY_TEXT_RULES: ReadonlyArray<{ pattern: RegExp; short: string; says?: string }> = [
    { pattern: /sulfa|sulfonamide/i, short: 'a sulfa allergy note on the loop and thiazide-type diuretics' },
    { pattern: /loop diuretic/i, short: 'the on-body furosemide infusor' },
    { pattern: /adhesive|acrylate/i, short: 'the on-body furosemide infusor' },
    { pattern: /angio-?(o)?edema/i, short: 'ACE inhibitors and sacubitril/valsartan (angioedema)', says: 'is read as a history of angioedema: ACE inhibitors and sacubitril/valsartan are not offered or continued, and an angiotensin receptor blocker stays available with a caution' },
];
export const textRulesFor = (entry: string) => ALLERGY_TEXT_RULES.filter(r => r.pattern.test(entry));

/** What an allergy entry does in this tool, for the entry form: the drugs it matched and what the text rules read; empty when it does nothing. */
export function allergyEntryEffect(entry: string, formulary: readonly Medication[]): string {
    return [...resolveAllergy(entry, formulary), ...textRulesFor(entry).map(r => r.short)].filter((x, i, a) => a.indexOf(x) === i).join(', ');
}
