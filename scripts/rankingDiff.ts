/**
 * Ranking diff - compares the CURRENT engine against the committed golden snapshot
 * (data/golden/engine-output.json.gz) across every scenario x insurance-tier run, and reports
 * what an intended scoring-model change did to the clinician-visible ranking.
 *
 * Eligibility (excludedMedications) and clinicalAlerts must be identical - a scoring change must
 * never touch them; any difference is a bug and makes this script exit non-zero. Per-regimen
 * warnings are compared the same way (reported, and also a failure when they differ).
 *
 * Usage: npm run ranking:diff   (run BEFORE `npm run golden:update`; afterwards the snapshot is the new engine)
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { capture, SNAPSHOT } from './goldenMaster';

interface Pick {
    regimen?: { med: { name: string }; dose: { strength: number | string; unit?: string }; selected_frequency: string }[];
    overall_score?: number;
    raw_score?: number;
    warnings?: string[];
}
interface Run { scoredRegimens?: Pick[]; excludedMedications?: unknown; clinicalAlerts?: unknown; THREW?: string }

const regimenSig = (p: Pick | undefined): string => !p ? '(none)' : (p.regimen ?? [])
    .map(r => `${r.med.name} ${r.dose.strength}${r.dose.unit ?? ''} ${r.selected_frequency}`).sort().join(' + ');
const regimenLabel = (p: Pick | undefined): string => !p ? '(no pick)' : `${regimenSig(p)} [overall ${p.overall_score}, raw ${p.raw_score?.toFixed(2)}]`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
    const expected = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8')) as Record<string, Run>;
    const actual = JSON.parse(JSON.stringify(await capture())) as Record<string, Run>;
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];

    let topSame = 0, setSame = 0, orderSame = 0;
    const topChanged: string[] = [];
    const bugs: string[] = [];
    const warnDiffs: string[] = [];
    const oldTop: number[] = [], newTop: number[] = [];

    for (const key of keys) {
        const o = expected[key] ?? {}, n = actual[key] ?? {};
        if (!same(o.excludedMedications, n.excludedMedications)) bugs.push(`${key}: excludedMedications differ`);
        if (!same(o.clinicalAlerts, n.clinicalAlerts)) bugs.push(`${key}: clinicalAlerts differ`);
        const op = o.scoredRegimens ?? [], np = n.scoredRegimens ?? [];
        if (op[0]?.overall_score !== undefined) oldTop.push(op[0].overall_score);
        if (np[0]?.overall_score !== undefined) newTop.push(np[0].overall_score);

        const oSigs = op.map(regimenSig), nSigs = np.map(regimenSig);
        if (oSigs[0] === nSigs[0]) topSame++;
        else topChanged.push(`  ${key}\n     old: ${regimenLabel(op[0])}\n     new: ${regimenLabel(np[0])}`);
        if (same([...oSigs].sort(), [...nSigs].sort())) setSame++;
        if (same(oSigs, nSigs)) orderSame++;

        // Warnings compared per regimen, matched by signature.
        for (const p of op) {
            const m = np.find(x => regimenSig(x) === regimenSig(p));
            if (m && !same(p.warnings, m.warnings)) warnDiffs.push(`${key}: ${regimenSig(p)}`);
        }
    }
    const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
    const range = (xs: number[]) => `min ${Math.min(...xs)} / median ${med(xs)} / max ${Math.max(...xs)}`;

    console.log(`Ranking diff vs golden snapshot: ${keys.length} runs`);
    console.log(`  (a) top pick identical:        ${topSame} / ${keys.length}`);
    console.log(`  (b) displayed pick set same:   ${setSame} / ${keys.length}`);
    console.log(`  (c) pick order identical:      ${orderSame} / ${keys.length}`);
    console.log(`  (d) eligibility + alerts identical: ${bugs.length === 0 ? 'YES' : `NO (${bugs.length} differences)`}`);
    console.log(`  (e) per-regimen warnings identical: ${warnDiffs.length === 0 ? 'YES' : `NO (${warnDiffs.length} regimens)`}`);
    console.log(`  top-pick overall_score  old: ${range(oldTop)}`);
    console.log(`  top-pick overall_score  new: ${range(newTop)}`);
    if (topChanged.length) { console.log(`\nTop pick changed in ${topChanged.length} runs:`); topChanged.forEach(l => console.log(l)); }
    if (bugs.length) { console.log('\nBUGS (eligibility/alerts must not change):'); bugs.slice(0, 30).forEach(b => console.log('  ' + b)); }
    if (warnDiffs.length) { console.log('\nWarning differences:'); warnDiffs.slice(0, 30).forEach(b => console.log('  ' + b)); }
    if (bugs.length || warnDiffs.length) process.exit(1);
}
main();
