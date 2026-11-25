// Display-side clean-up of engine strings, so clinician-facing text and the draft note carry no internal vocabulary: no rule numbers, no "engine policy",
// no file names, no em dashes and no lower-cased abbreviations. Pure text; the engine's output is unchanged.

import { capitalizeSentence } from '../services/engine/textCase';

const DEVICE_TOKENS: [RegExp, string][] = [
    [/\braas inhibitor \(arni preferred for hfref\)/g, 'RAAS inhibitor (ARNI preferred for HFrEF)'],
    [/\bevidence-based beta-blocker \(carvedilol \/ metoprolol succinate \/ bisoprolol\)/g, 'evidence-based beta-blocker (carvedilol / metoprolol succinate / bisoprolol)'],
    [/\bmineralocorticoid receptor antagonist \(mra\)/g, 'mineralocorticoid receptor antagonist (MRA)'],
    [/\bsglt2 inhibitor\b/g, 'SGLT2 inhibitor'],
];

const capFirst = capitalizeSentence;

export function plainText(text: string): string {
    let t = text;
    // Lower-cased pillar names inside the device-therapy prompt ("not yet complete here: ...").
    if (/not yet complete here/.test(t)) t = DEVICE_TOKENS.reduce((x, [re, to]) => x.replace(re, to), t);
    // Internal rule numbers and the phrase "engine policy".
    t = t.replace(/\s*\(?\bRule E\d+\b\)?/gi, '').replace(/\b[Rr]ule E\d+\b[:,]?\s*/g, '');
    t = t.replace(/(^|[.!?]\s+)engine policy\b/gi, (_m, p: string) => `${p}This tool's own rule`);
    t = t.replace(/\bengine policy\b/gi, "this tool's own rule");
    t = t.replace(/\(the engine's own target dose is used\)/gi, '(a target dose set by this tool is used)');
    t = t.replace(/\bthe engine's own\b/gi, "this tool's own").replace(/\bthe engine\b/gi, 'the tool').replace(/\bThe engine\b/g, 'The tool');
    t = t.replace(/data\/[A-Za-z]+\.json rows for this drug class \([^)]*\)/g, 'See the outcome rows of the evidence tables for this drug class.');
    t = t.replace(/data\/[A-Za-z]+\.json( rows? [\w*-]+)?/g, 'the evidence tables');
    // R6 V12: what a physician reads has no typed arrow and no shouted instruction. "STOP Lisinopril. WAIT 36 hours. THEN start Sacubitril/Valsartan 24/26mg" is one plain sentence; "Swap A -> B" is "Switch A to B";
    // the carvedilol body-weight reduction states the label's limit once, without the restated numbers ("dose 50 mg is above the maximum of 25 mg") that said the same thing again.
    t = t.replace(/\bSTOP ([^.]+?)\. WAIT (\d+) hours\. THEN start /g, 'Stop $1, wait $2 hours, then start ');
    t = t.replace(/\bSwap ([^>]+?) -> /g, 'Switch $1 to ');
    t = t.replace(/ -> /g, ' to ');
    // R7 W7: no arrow of any kind: a dose change "Titrate A 12.5mg bid → 25mg bid" reads "Titrate A from 12.5mg bid to 25mg bid"; any other arrow is "to".
    t = t.replace(/\b(Titrate|Reduce) ([^→(;]+?) (\d[^→]*?) → /g, '$1 $2 from $3 to ');
    t = t.replace(/\s*[→⇒➜➔]\s*/g, ' to ');
    t = t.replace(/(the label's limit by body weight, [^()]*?), at a dry weight of ([\d.]+) kg: dose [\d.]+ mg is above the maximum of [\d.]+ mg/g, '$1, and the dry weight is $2 kg');
    // R7 W7: the word "engine" is internal vocabulary: it is never clinician-facing text.
    t = t.replace(/\bengine-conservative choice\b/gi, 'conservative choice made by this tool').replace(/\bengines\b/gi, 'tools').replace(/\bengine\b/gi, 'tool');
    // Em dashes.
    t = t.replace(/\s+—\s+/g, (_m, off: number, whole: string) => (/[:.;]$/.test(whole.slice(0, off)) ? ' ' : ': '));
    t = t.replace(/—/g, ': ');
    // R8 X7: a range of NYHA classes reads "III to IV", never "III-IV".
    t = t.replace(/\b(I{1,3}|IV)-(I{1,3}|IV)\b/g, '$1 to $2');
    // R8 X7: no en dash either: a range ("III–IV", "5–10") reads "III to IV", "5 to 10"; any other en dash is a colon or a comma.
    t = t.replace(/(\d|\b[IV]+)\s*–\s*(\d|[IV]+\b)/g, '$1 to $2').replace(/\s+–\s+/g, ': ').replace(/–/g, ' to ');
    return t;
}

/** Sentence-case a header that the engine shouts ("POTASSIUM HOLD ON SPIRONOLACTONE"), keeping drug names and abbreviations readable. */
export const headerCase = (t: string): string => capFirst(t.toLowerCase());
