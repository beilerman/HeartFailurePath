/**
 * Golden-master harness — the behavior-preservation gate for structural refactors.
 *
 * Runs the engine over every verify scenario under each insurance tier and serializes the
 * FULL SimulationOutput (every score at full float precision, every warning/alert/exclusion
 * string, pick order). `npm run golden` diffs against the committed snapshot and exits
 * non-zero on any difference; `npm run golden:update` rewrites the snapshot.
 *
 * Only update the snapshot for an INTENDED clinical/behavior change, in its own commit that
 * says why. A pure refactor must leave it byte-identical.
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

const ADDITIVE_KEYS = new Set<string>(['score_breakdown', 'rule_id', 'rule_name', 'facts', 'care_priority', 'ranking_mode', 'ranking', 'why', 'contraindication_checks']);

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
                result[key] = normalize(generateAndScoreModifications(scenario.patient, available, prices));
            } catch (error) {
                result[key] = { THREW: (error as Error).message };
            }
        }
    }
    return result;
}

function firstDiff(a: unknown, b: unknown, path: string): string | null {
    if (JSON.stringify(a) === JSON.stringify(b)) return null;
    if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
        const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
        for (const k of keys) {
            const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
            if (d) return d;
        }
    }
    return `${path}\n      expected: ${JSON.stringify(a)?.slice(0, 300)}\n      actual:   ${JSON.stringify(b)?.slice(0, 300)}`;
}

async function main() {
    const update = process.argv.includes('--update');
    const actual = await capture();
    if (update || !existsSync(SNAPSHOT)) {
        writeFileSync(SNAPSHOT, gzipSync(JSON.stringify(actual)));
        console.log(`Golden master written: ${Object.keys(actual).length} runs -> ${SNAPSHOT}`);
        return;
    }
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
    console.log(`Golden master OK: ${keys.size} runs byte-identical.`);
}

// Only run the CLI when executed directly (rankingDiff.ts imports capture/normalize).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
