/** Report only (R8): alert, warning and withheld-list text new, changed or gone against the golden snapshot, by heading, in number of reference runs. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { capture, SNAPSHOT } from './goldenMaster';
type Run = { scoredRegimens?: Array<{ warnings?: string[]; trade_offs?: Array<{ dimension: string; label: string }>; shown_because?: string }>; clinicalAlerts?: string[]; excludedMedications?: Array<{ name: string; reason: string }>; monitoringPlan?: Array<{ test: string }>; gdmtGaps?: string[]; eligibleAdjuncts?: string[] };
const head = (a: string) => { const i = a.indexOf(': '); return i > 0 && i < 70 ? a.slice(0, i) : a.slice(0, 40); };
const expected = JSON.parse(gunzipSync(readFileSync(SNAPSHOT)).toString('utf8')) as Record<string, Run>;
const actual = JSON.parse(JSON.stringify(await capture())) as Record<string, Run>;
const tally = new Map<string, { changed: number; added: number; gone: number }>();
const bump = (k: string, f: 'changed' | 'added' | 'gone') => { const t = tally.get(k) ?? { changed: 0, added: 0, gone: 0 }; t[f]++; tally.set(k, t); };
const diffList = (kind: string, o: string[], n: string[]) => {
    const oh = new Map(o.map(x => [head(x), x])), nh = new Map(n.map(x => [head(x), x]));
    for (const [h, x] of nh) { if (!oh.has(h)) bump(`${kind}: ${h}`, 'added'); else if (oh.get(h) !== x) bump(`${kind}: ${h}`, 'changed'); }
    for (const h of oh.keys()) if (!nh.has(h)) bump(`${kind}: ${h}`, 'gone');
};
let runs = 0;
for (const k of Object.keys(expected)) {
    const o = expected[k], n = actual[k] ?? {}; runs++;
    diffList('alert', o.clinicalAlerts ?? [], n.clinicalAlerts ?? []);
    diffList('withheld', (o.excludedMedications ?? []).map(e => `${e.name}: ${e.reason}`), (n.excludedMedications ?? []).map(e => `${e.name}: ${e.reason}`));
    diffList('monitoring row', (o.monitoringPlan ?? []).map(m => m.test), (n.monitoringPlan ?? []).map(m => m.test));
    diffList('gap', o.gdmtGaps ?? [], n.gdmtGaps ?? []);
    const ow = (o.scoredRegimens ?? []).flatMap(r => r.warnings ?? []), nw = (n.scoredRegimens ?? []).flatMap(r => r.warnings ?? []);
    diffList('option warning', ow, nw);
    const ot = (o.scoredRegimens ?? []).map(r => r.trade_offs?.find(t => t.dimension === 'Dosing burden')?.label ?? ''), nt = (n.scoredRegimens ?? []).map(r => r.trade_offs?.find(t => t.dimension === 'Dosing burden')?.label ?? '');
    if (JSON.stringify(ot) !== JSON.stringify(nt)) bump('trade-off label: Dosing burden', 'changed');
    const os = (o.scoredRegimens ?? []).map(r => r.shown_because ?? ''), ns = (n.scoredRegimens ?? []).map(r => r.shown_because ?? '');
    if (JSON.stringify(os) !== JSON.stringify(ns)) bump('display-rule sentence (shown_because)', 'changed');
}
console.log(`${runs} reference runs`);
[...tally.entries()].sort((a, b) => (b[1].changed + b[1].added + b[1].gone) - (a[1].changed + a[1].added + a[1].gone)).forEach(([k, v]) => console.log(`${k.padEnd(70)} changed ${v.changed}  new ${v.added}  gone ${v.gone}`));
