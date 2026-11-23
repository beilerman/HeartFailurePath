/**
 * Golden-master harness — the behavior-preservation gate for structural refactors.
 *
 * Runs the engine over every verify scenario under each insurance tier and serializes the
 * FULL SimulationOutput (every score at full float precision, every warning/alert/exclusion
 * string, pick order). `npm run golden` diffs against the committed snapshot and exits
 * non-zero on any difference; `npm run golden:update` rewrites the snapshot.
 *
 * Only update the snapshot for an INTENDED clinical/behavior change, in its own commit that
 * says why. A pure refactor must leave it identical (text exact, numbers to 1e-9).
 *
 * ADDITIVE_KEYS: explanation-only fields added after the baseline was captured. They are
 * stripped before comparison so adding explanatory output does not invalidate the baseline.
 * Never list a pre-existing field here.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { generateAndScoreModifications } from '../services/simulationService';
import { getDrugPrices } from '../services/pricingService';
import { SCENARIOS } from '../data/scenarios';
import { MEDICATION_FORMULARY } from '../constants';

const ADDITIVE_KEYS = new Set<string>(['score_breakdown', 'rule_id', 'rule_name', 'facts', 'care_priority', 'ranking_mode', 'ranking', 'foundational_coverage', 'shown_because', 'why', 'contraindication_checks', 'decisionReadiness', 'outcome_estimates', 'harm_burden', 'symptom_estimate', 'temporary_hold', 'why_first', 'evidence_band']);

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT = join(here, '..', 'data', 'golden', 'engine-output.json.gz');

export function normalize(value: unknown): unknown {
    if (value === undefined || typeof value === 'function') return undefined;
    if (typeof value === 'number') {
        if (Number.isNaN(value)) return '__NaN__';
        if (!Number.isFinite(value)) return value > 0 ? '__Inf__' : '__-Inf__';
        return value;
    }
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Set) return [...value].map(normalize).sort();
    if (value instanceof Map) return [...value.entries()].map(([k, v]) => [normalize(k), normalize(v)]);
    if (Array.isArray(value)) return value.map(v => normalize(v) ?? null);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
        if (ADDITIVE_KEYS.has(key)) continue;
        const n = normalize((value as Record<string, unknown>)[key]);
        if (n !== undefined) out[key] = n;
    }
    return out;
}

export async function capture(): Promise<Record<string, unknown>> {
    const names = MEDICATION_FORMULARY.map(m => m.name);
    const available = new Set(names);
    const tiers = ['cash', 'commercial', 'medicare'] as const;
    const result: Record<string, unknown> = {};
    for (const scenario of SCENARIOS) {
        for (const tier of tiers) {
            const prices = await getDrugPrices(names, tier as never);
            const key = `${scenario.title} :: ${tier}`;
            try {
                // Both the pricing table and patient context must use this tier: dose-specific
                // cash prices are selected from patient.insurance_tier inside the engine.
                const output = generateAndScoreModifications({ ...scenario.patient, insurance_tier: tier }, available, prices);
                if (output.scoredRegimens.some(r => r.projected_patient.insurance_tier !== tier)) throw new Error('Snapshot insurance context does not match requested tier');
                result[key] = normalize(output);
            } catch (error) {
                result[key] = { THREW: (error as Error).message };
            }
        }
    }
    return result;
}

/**
 * Numbers are compared to 1e-9, the precision the ranking itself uses (`stable` in services/engine/selection.ts).
 * Reason: the measured model takes logarithms and exponentials of relative risks, and those functions differ in the
 * last binary digit between processors (this Mac and the Linux machine that runs CI disagreed at the 15th significant
 * digit of four raw scores, 2026-11-18). Everything else (text, booleans, structure, key sets) must match exactly.
 */
export const NUMBER_TOLERANCE = 1e-9;

export function firstDiff(a: unknown, b: unknown, path: string): string | null {
    if (typeof a === 'number' && typeof b === 'number') {
        if (a === b || Math.abs(a - b) <= NUMBER_TOLERANCE) return null;
    } else if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
        const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
        for (const k of keys) {
            const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
            if (d) return d;
        }
        return null;
    } else if (JSON.stringify(a) === JSON.stringify(b)) {
        return null;
    }
    return `${path}\n      expected: ${JSON.stringify(a)?.slice(0, 300)}\n      actual:   ${JSON.stringify(b)?.slice(0, 300)}`;
}

/** The comparison must still catch real changes; run before every comparison so the tolerance cannot be loosened unnoticed. */
function selfCheck() {
    const base = { s: [{ raw_score: 61.17708807742629, overall_score: 61, name: 'Furosemide', flags: [true, null] }] };
    const same = (x: unknown) => firstDiff(base, x, 'self') === null;
    const cases: Array<[string, boolean]> = [
        ['processor-level noise in a number is accepted', same({ s: [{ raw_score: 61.177088077426305, overall_score: 61, name: 'Furosemide', flags: [true, null] }] })],
        ['a change of one millionth in a number is caught', !same({ s: [{ raw_score: 61.17708907742629, overall_score: 61, name: 'Furosemide', flags: [true, null] }] })],
        ['a changed word is caught', !same({ s: [{ raw_score: 61.17708807742629, overall_score: 61, name: 'Torsemide', flags: [true, null] }] })],
        ['a missing field is caught', !same({ s: [{ raw_score: 61.17708807742629, name: 'Furosemide', flags: [true, null] }] })],
        ['an added list item is caught', !same({ s: [{ raw_score: 61.17708807742629, overall_score: 61, name: 'Furosemide', flags: [true, null, false] }] })],
        ['a number that became text is caught', !same({ s: [{ raw_score: '61.17708807742629', overall_score: 61, name: 'Furosemide', flags: [true, null] }] })],
        ['a value that became null is caught', !same({ s: [{ raw_score: null, overall_score: 61, name: 'Furosemide', flags: [true, null] }] })],
    ];
    const failed = cases.filter(([, ok]) => !ok).map(([name]) => name);
    if (failed.length) { console.error('GOLDEN MASTER SELF-CHECK FAILED: ' + failed.join('; ')); process.exit(1); }
}

async function main() {
    const update = process.argv.includes('--update');
    const actual = await capture();
    // A captured exception is evidence of a broken run, never an acceptable golden result.
    const thrown = Object.entries(actual).filter(([, run]) => run && typeof run === 'object' && 'THREW' in run);
    if (thrown.length) {
        console.error('Golden capture failed:', thrown);
        process.exit(1);
    }
    if (update || !existsSync(SNAPSHOT)) {
        writeFileSync(SNAPSHOT, gzipSync(JSON.stringify(actual)));
        console.log(`Golden master written: ${Object.keys(actual).length} runs -> ${SNAPSHOT}`);
        return;
    }
    selfCheck();
    const expected = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8')) as Record<string, unknown>;
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const diffs: string[] = [];
    for (const key of keys) {
        const d = firstDiff(expected[key], JSON.parse(JSON.stringify(actual[key] ?? null)), key);
        if (d) diffs.push(d);
    }
    if (diffs.length) {
        console.error(`GOLDEN MASTER MISMATCH: ${diffs.length} of ${keys.size} runs differ.`);
        for (const d of diffs.slice(0, 15)) console.error(`  - ${d}`);
        process.exit(1);
    }
    console.log(`Golden master OK: ${keys.size} runs identical (text and structure exact; numbers to ${NUMBER_TOLERANCE}).`);
}

// Only run the CLI when executed directly (rankingDiff.ts imports capture/normalize).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
