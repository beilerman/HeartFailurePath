/**
 * Round 6 sweep of every no-option screen (V5, V19d). Run through vite so the real components render:
 *   node scripts/r6ScreenSweep.mjs <firstSeed> <count>   (count at most 5,000; 13 paths per patient)
 * Scans everything the screen, the draft note and the print view render for the words option, plan, recommend and rank (any form), and checks the heading, the adjunct block, the atrial
 * fibrillation and congestion sentences and the "see the ... alert" rows. No phrase is allowed on purpose.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { MEDICATION_FORMULARY } from '../constants';
import { clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { gen3r } from './r3Generator';
import { PRICES as TIER_PRICES } from './r2Generator';
import { NO_OPTION_PATHS } from './r6Paths';
import type { Patient } from '../types';

const [firstArg = '9900000', countArg = '5000'] = process.argv.slice(2);
const first = Number(firstArg), count = Math.min(Number(countArg), 5000);
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const OPTION_WORDS = /\b(options?|plans?|planned|planning|rank\w*|recommend\w*)\b/i;
const counts: Record<string, number> = {}; const bad: Record<string, string[]> = {};
const inc = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const fail = (k: string, where: string, msg: string) => { inc(`FAIL_${k}`); (bad[k] ??= []).length < 6 && bad[k].push(`${where}: ${msg.slice(0, 260)}`); };

for (let sd = first; sd < first + count; sd++) {
    const base = clonePatient(gen3r(sd).p as Patient);
    for (const [pn, f] of NO_OPTION_PATHS) {
        const p = clonePatient(base); f(p);
        let o; try { o = generateAndScoreModifications(clonePatient(p), names, (TIER_PRICES as Record<string, Record<string, number>>)[p.insurance_tier ?? 'cash']); } catch (e) { fail('EXCEPTION', `seed ${sd} ${pn}`, String(e)); continue; }
        if (o.scoredRegimens.length > 0) continue;
        inc('no_option_screens');
        const where = `seed ${sd} ${pn}`;
        let html = '';
        try {
            html = renderToStaticMarkup(<ResultsDisplay results={o.scoredRegimens} error={null} hasRun excludedMedications={o.excludedMedications} clinicalAlerts={o.clinicalAlerts} monitoringPlan={o.monitoringPlan}
                gdmtGaps={o.gdmtGaps} eligibleAdjuncts={o.eligibleAdjuncts} missingDataNotices={o.missingDataNotices} followUpCalendar={o.followUpCalendar} decisionReadiness={o.decisionReadiness}
                whyFirst={o.why_first} scopeStatus={o.scope_status} evidenceBand={o.evidence_band} runSnapshot={{ ranAt: '2026-11-20T10:00:00Z', patient: p, caseLabel: 'sweep' }} />);
        } catch (e) { fail('RENDER_EXCEPTION', where, String(e)); continue; }
        const text = textOf(html);
        for (const seg of text.split(/ \| |(?<=[.!?:]) (?=[A-Z])/)) if (OPTION_WORDS.test(seg)) fail('option_words', where, seg);
        if (/recommended monitoring plan/i.test(text)) fail('monitoring_heading', where, 'Recommended monitoring plan');
        if (/eligible adjuncts to consider/i.test(text)) fail('adjunct_block', where, 'eligible adjuncts');
        const af = o.clinicalAlerts.find(a => a.startsWith('ATRIAL FIBRILLATION'));
        if (af) { inc('af_alerts'); if (/Rate control|beta-blocker is first line|digoxin should be considered/.test(af)) fail('af_rate_control', where, af); }
        const cg = o.clinicalAlerts.find(a => a.startsWith('CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN'));
        if (cg) { inc('congestion_alerts'); if (/does not offer|tool offers/.test(cg)) fail('congestion_offer', where, cg); }
        for (const m of o.monitoringPlan) for (const [phrase, head] of [[/see the low blood pressure alert/, /^HEMODYNAMIC INSTABILITY/], [/see the hypoxia alert/, /^HYPOXIA ALERT/], [/see the heart block alert/, /AV BLOCK/], [/see the potassium emergency alert/, /^HYPERKALEMIC EMERGENCY/]] as Array<[RegExp, RegExp]>) {
            if (phrase.test(m.details) && !o.clinicalAlerts.some(a => head.test(a))) fail('monitoring_points_at_absent_alert', where, `${m.test}: ${m.details.slice(0, 120)}`);
        }
        if (/Analysis complete: 0 options/.test(text)) fail('analysis_complete_zero_options', where, 'Analysis complete: 0 options');
        if (/ -> /.test(text)) fail('typed_arrow', where, 'arrow');
    }
}
console.log(JSON.stringify({ first, count, ...counts }, null, 1));
for (const [k, v] of Object.entries(bad)) { console.log(`== ${k}`); v.forEach(x => console.log('  ' + x)); }
if (!Object.keys(bad).length) console.log('No exceptions.');
