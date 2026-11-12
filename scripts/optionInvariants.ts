/**
 * Structural invariants for "every selectable option has a declared effect" (2026-11-12). Kept in its own module: the main verification function is already
 * at the size TypeScript's control-flow analysis allows. Returns pass/fail counts for runVerification to add.
 */
import { clonePatient } from '../services/simulationService';
import { SCENARIOS } from '../data/scenarios';
import { MEDICATION_FORMULARY, COMMON_SIDE_EFFECTS, RELEVANT_COMORBIDITIES, RELEVANT_EXTERNAL_MEDICATIONS, DISPLAY_ONLY_OPTIONS } from '../constants';
import { INTOLERANCE_TABLE, intoleranceCautionsFor, describeIntoleranceEffect } from '../services/engine/intolerance';
import { NON_PENALIZED_WARNING_MARKERS } from '../services/engine/scoreModel';
import { getMedicationClassGroup } from '../services/engine/registry';
import * as CONTRA_EXPORTS from '../services/engine/contraindications';
import * as PREDICATE_EXPORTS from '../services/clinicalPredicates';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function runOptionInvariants(): { passed: number; failed: number } {
    let passed = 0, failed = 0;
    console.log('Checking structural invariant: every documented-intolerance reason has a declared effect, and every caution works and is unpenalized...');
    {
        const bad: string[] = [];
        const tableReasons = new Set(INTOLERANCE_TABLE.map(e => e.reason));
        for (const r of COMMON_SIDE_EFFECTS) if (!tableReasons.has(r)) bad.push(`COMMON_SIDE_EFFECTS "${r}" has no INTOLERANCE_TABLE entry`);
        for (const e of INTOLERANCE_TABLE) {
            if (!COMMON_SIDE_EFFECTS.includes(e.reason)) bad.push(`INTOLERANCE_TABLE entry "${e.reason}" is not a selectable reason`);
            if (!e.drug_only_reason.trim()) bad.push(`"${e.reason}" has no drug_only_reason`);
            if (e.rules.some(r => r.effect === 'caution' && !r.advice)) bad.push(`"${e.reason}" has a caution rule without advice`);
        }
        const asDose = (m: typeof MEDICATION_FORMULARY[number]) => ({ med: m, dose: m.available_doses[0], selected_frequency: m.available_doses[0].frequency_options[0] });
        for (const e of INTOLERANCE_TABLE) {
            for (const rule of e.rules.filter(r => r.effect === 'caution')) {
                const offenderClasses = rule.offenders === 'any' ? [...new Set(MEDICATION_FORMULARY.map(m => m.drug_class))] : [...rule.offenders];
                for (const oc of offenderClasses) {
                    const offender = MEDICATION_FORMULARY.find(m => m.drug_class === oc);
                    if (!offender) continue;
                    // Every OTHER formulary drug in an affected class draws exactly one caution when started; drugs outside draw none.
                    const sameGroup = MEDICATION_FORMULARY.filter(m => getMedicationClassGroup(m.drug_class) === getMedicationClassGroup(oc));
                    for (const target of MEDICATION_FORMULARY.filter(m => m.name !== offender.name)) {
                        const p = clonePatient(SCENARIOS[0].patient); p.current_regimen = [];
                        p.discontinued_meds = [{ name: offender.name, drug_class: offender.drug_class, reason: e.reason }];
                        const ws = intoleranceCautionsFor(p, [{ action: 'add', target: asDose(target), summary: `Add ${target.name}` }]);
                        const affected = rule.affects === 'same_group' ? sameGroup.some(m => m.name === target.name) : rule.affects.has(target.drug_class);
                        // Another rule of the same reason may also cover this target; only the exact one-or-more relation is checked.
                        const otherRuleCovers = e.rules.some(r2 => r2 !== rule && r2.effect === 'caution' && (r2.offenders === 'any' || r2.offenders.has(oc))
                            && (r2.affects === 'same_group' ? sameGroup.some(m => m.name === target.name) : r2.affects.has(target.drug_class)));
                        if (affected && ws.length === 0) bad.push(`${e.reason} on ${offender.name}: starting ${target.name} draws no caution`);
                        if (!affected && !otherRuleCovers && ws.length > 0) bad.push(`${e.reason} on ${offender.name}: starting ${target.name} draws an unexpected caution`);
                        if (ws.some(w => !NON_PENALIZED_WARNING_MARKERS.some(mk => w.includes(mk)))) bad.push(`${e.reason}: caution would be score-penalized`);
                    }
                }
            }
            for (const m of MEDICATION_FORMULARY) {
                const s = describeIntoleranceEffect(m.name, m.drug_class, e.reason);
                if (!s.startsWith(`Excludes ${m.name}.`)) bad.push(`describeIntoleranceEffect for ${e.reason} on ${m.name} does not start with the named-drug exclusion`);
            }
        }
        if (bad.length > 0) { console.error(`  [FAIL] ${bad.length}: ${bad.slice(0, 5).join('; ')}`); failed++; }
        else { console.log(`  [PASS] ${COMMON_SIDE_EFFECTS.length} reasons all declared; every caution fires for exactly its classes and is not penalized.`); passed++; }
    }

    console.log('Checking structural invariant: every selectable comorbidity, external medication and intolerance reason is read by the engine or listed as display-only...');
    {
        const bad: string[] = [];
        const root = process.cwd();
        const strip = (src: string): string => {
            let out = ''; let i = 0; let quote = '';
            while (i < src.length) {
                const c = src[i]; const n = src[i + 1];
                if (quote) { out += c; if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; } if (c === quote) quote = ''; i++; continue; }
                if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
                if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
                if (c === "'" || c === '"' || c === '`') quote = c;
                out += c; i++;
            }
            return out;
        };
        const engineDir = path.join(root, 'services', 'engine');
        const files = [...readdirSync(engineDir).filter(f => f.endsWith('.ts')).map(f => path.join(engineDir, f)), path.join(root, 'services', 'clinicalPredicates.ts'), path.join(root, 'constants.ts')];
        const dropList = (src: string, name: string): string => {
            const start = src.indexOf(`export const ${name} =`);
            if (start < 0) return src;
            const end = src.indexOf('\n];', start);
            return src.slice(0, start) + src.slice(end + 3);
        };
        const sources = files.map(f => {
            let s = strip(readFileSync(f, 'utf8'));
            if (f.endsWith(`${path.sep}constants.ts`)) for (const n of ['COMMON_SIDE_EFFECTS', 'RELEVANT_COMORBIDITIES', 'RELEVANT_EXTERNAL_MEDICATIONS', 'DISPLAY_ONLY_OPTIONS']) s = dropList(s, n);
            return s;
        });
        const all = sources.join('\n');
        const countOf = (needle: string) => all.split(needle).length - 1;
        // A constant that holds the option (exported from contraindications.ts or clinicalPredicates.ts) counts as a read when its name is used somewhere beyond its definition.
        const holders: [string, unknown][] = [...Object.entries(CONTRA_EXPORTS), ...Object.entries(PREDICATE_EXPORTS)];
        const isRead = (option: string): boolean => {
            if (all.includes(`'${option}'`) || all.includes(`"${option}"`)) return true;
            return holders.some(([name, v]) => (v === option || (Array.isArray(v) && v.includes(option))) && countOf(name) >= 2);
        };
        const lists: [string, readonly string[]][] = [['RELEVANT_COMORBIDITIES', RELEVANT_COMORBIDITIES], ['RELEVANT_EXTERNAL_MEDICATIONS', RELEVANT_EXTERNAL_MEDICATIONS], ['COMMON_SIDE_EFFECTS', COMMON_SIDE_EFFECTS]];
        const shown = new Set<string>();
        for (const [listName, options] of lists) {
            for (const o of options) {
                shown.add(o);
                const read = isRead(o);
                const allow = DISPLAY_ONLY_OPTIONS[o];
                if (!read && !allow) bad.push(`${listName} "${o}" is read by no engine or formulary code and is not in DISPLAY_ONLY_OPTIONS`);
                if (read && allow) bad.push(`"${o}" is in DISPLAY_ONLY_OPTIONS but is read by the engine: remove it from the allowlist`);
            }
        }
        for (const [o, why] of Object.entries(DISPLAY_ONLY_OPTIONS)) {
            if (!shown.has(o)) bad.push(`DISPLAY_ONLY_OPTIONS "${o}" is not a selectable option`);
            if (!why.trim()) bad.push(`DISPLAY_ONLY_OPTIONS "${o}" has no reason`);
        }
        for (const gone of ['Chronic Kidney Disease', 'Obesity (BMI > 30)']) if (RELEVANT_COMORBIDITIES.includes(gone)) bad.push(`"${gone}" is selectable but nothing reads it (kidney function comes from eGFR, obesity from BMI)`);
        if (bad.length > 0) { console.error(`  [FAIL] ${bad.length}: ${bad.slice(0, 8).join('; ')}`); failed++; }
        else { console.log(`  [PASS] ${shown.size} selectable options all read by engine/formulary code (${Object.keys(DISPLAY_ONLY_OPTIONS).length} display-only).`); passed++; }
    }

    return { passed, failed };
}
