import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ResultsDisplay } from '../components/ResultsDisplay';
import { MEDICATION_FORMULARY } from '../constants';
import { SCENARIOS, clonePatient } from '../data/scenarios';
import { generateAndScoreModifications } from '../services/simulationService';
import { EvidenceTables } from '../components/EvidenceTables';
import { gen3r } from './r3Generator';
import { OUTCOME_EVIDENCE_TABLE } from '../services/engine/outcomeBenefit';
import { SYMPTOM_TABLE } from '../services/engine/symptomBenefit';
import { getDrugPrices } from '../services/pricingService';
import { allText, PRINTED_ZERO } from './engineReadinessR5Checks';
import type { Patient } from '../types';

// Checks for round 5 screen rulings (Y1 blank pressure, Y11 evidence ejection-fraction range, Y12 stop-screen cosmetics, Y6 and Y7 one finding once). Server-rendered content only.
let passed = 0;
export let failed = 0;
const check = (name: string, f: () => void) => {
    try { f(); passed++; console.log(`[PASS] ${name}`); }
    catch (error) { failed++; console.error(`[FAIL] ${name}: ${String(error).split('\n')[0]}`); }
};
const names = new Set(MEDICATION_FORMULARY.map(m => m.name));
const prices = await getDrugPrices([...names], 'commercial');
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const base = SCENARIOS.find(s => s.title.startsWith('De-novo HFrEF'))!.patient;
const make = (over: (p: Patient) => void): Patient => { const p = clonePatient(base); p.scope_conditions = new Set(); over(p); return p; };
const render = (p: Patient) => {
    const o = generateAndScoreModifications(p, names, prices);
    const html = renderToStaticMarkup(<ResultsDisplay results={o.scoredRegimens} error={null} hasRun excludedMedications={o.excludedMedications} clinicalAlerts={o.clinicalAlerts} monitoringPlan={o.monitoringPlan}
        gdmtGaps={o.gdmtGaps} eligibleAdjuncts={o.eligibleAdjuncts} missingDataNotices={o.missingDataNotices} followUpCalendar={o.followUpCalendar} decisionReadiness={o.decisionReadiness}
        whyFirst={o.why_first} scopeStatus={o.scope_status} evidenceBand={o.evidence_band} runSnapshot={{ ranAt: '2026-11-20T10:00:00Z', patient: p, caseLabel: 'test' }} />);
    return { o, html, text: textOf(html), p };
};

check('Y1: a blank systolic pressure is shown as not entered, with what cannot be assessed, and never as "0 mmHg" or an emergency', () => {
    for (const v of [0, undefined, Number.NaN]) {
        const r = render(make(p => { p.sbp = v as number; }));
        assert.ok(!/0 mmHg/.test(r.text) && !/HEMODYNAMIC INSTABILITY/i.test(r.text), `sbp ${String(v)}: ${/[^.]*0 mmHg[^.]*/.exec(r.text)?.[0]}`);
        assert.ok(!allText(r.o).some(t => PRINTED_ZERO.test(t)));
        assert.ok(/Systolic blood pressure/i.test(r.text) && /not entered|waits for/i.test(r.text), `sbp ${String(v)}: the page does not say the pressure was not entered`);
        assert.ok(/cannot be assessed/i.test(r.text), `sbp ${String(v)}: the page does not say what cannot be assessed`);
    }
    const low = render(make(p => { p.sbp = 84; p.dbp = 50; }));
    assert.ok(/84 mmHg/.test(low.text) && /HEMODYNAMIC INSTABILITY|Hemodynamic instability/i.test(low.text), 'a measured 84 mmHg is no longer shown');
});
check('Y11: the evidence tab states in visible words, outside the collapsed notes, the ejection fractions each finerenone row is used for; every row with a range is generated from its own range and no other row carries such a sentence', () => {
    const html = renderToStaticMarkup(<EvidenceTables />);
    const rowHtml = (kind: 'outcome' | 'symptom', id: string): string => {
        const part = html.split('<tr ').find(x => x.includes(`data-evidence-row="${kind}"`) && x.includes(`data-row-id="${id}"`));
        assert.ok(part, `${kind} row ${id} not rendered`);
        // everything except the collapsed notes list
        return textOf(`<tr ${part}`.replace(/<ul[^>]*data-row-notes="1">[^]*?<\/ul>/g, ' '));
    };
    const expected: Array<['outcome' | 'symptom', string, RegExp]> = [
        ['outcome', 'nsmra-reduced-death', /Used below ejection fraction 40, for a patient already taking finerenone/],
        ['outcome', 'nsmra-reduced-hfh', /Used below ejection fraction 40, for a patient already taking finerenone/],
        ['symptom', 'nsmra-reduced', /Used below ejection fraction 40, for a patient already taking finerenone/],
        ['outcome', 'nsmra-mildly-reduced-death', /Used from ejection fraction 40 to 49/],
        ['outcome', 'nsmra-mildly-reduced-hfh', /Used from ejection fraction 40 to 49/],
        ['symptom', 'nsmra-mildly_reduced', /Used from ejection fraction 40 to 49/],
        ['outcome', 'nsmra-preserved-death', /Used from ejection fraction 50 upward/],
        ['outcome', 'nsmra-preserved-hfh', /Used from ejection fraction 50 upward/],
        ['symptom', 'nsmra-preserved', /Used from ejection fraction 50 upward/],
    ];
    for (const [kind, id, re] of expected) assert.ok(re.test(rowHtml(kind, id)), `${id}: ${rowHtml(kind, id).slice(0, 260)}`);
    // generated: every row of either table with a range has the sentence, every row without one has none
    for (const [kind, rows] of [['outcome', OUTCOME_EVIDENCE_TABLE], ['symptom', SYMPTOM_TABLE]] as const) for (const r of rows as unknown as Array<{ id: string; lvef_range?: unknown }>) {
        assert.equal(/Used (from|below) ejection fraction/.test(rowHtml(kind, r.id)), !!r.lvef_range, `${kind} ${r.id}`);
    }
});
const WHY_HEADING = 'Why: gaps, withheld drugs and follow-up';
const WHY_BLOCKS = ['Indicated GDMT currently missing', 'Eligible adjuncts to consider', 'Other care prompts', 'Data not entered: conclusions withheld', 'Recommended monitoring plan', 'Follow-up for option', 'All drugs withheld, by class'];
check('Y12: the "Why: gaps, withheld drugs and follow-up" block is not rendered when it would be empty (stop and scope screens), and is rendered whenever it holds something', () => {
    let withBlock = 0, without = 0;
    const variants: Array<(p: Patient) => void> = [p => { p.scope_conditions = new Set(['Dialysis']); }, p => { p.sbp = 84; p.dbp = 50; }, p => { p.potassium = 6.8; }, p => { p.rhythm = '3rd Degree AV Block'; }, () => { /* ordinary */ },
        p => { p.scope_conditions = new Set(['Cardiac amyloidosis']); p.egfr = 10; p.creatinine = 3.5; }];
    for (let sd = 9760000; sd < 9760120; sd++) {
        const p = gen3r(sd).p as Patient; variants[sd % variants.length](p);
        const r = render(p);
        const has = r.text.includes(WHY_HEADING);
        // Rewritten in round 6 (ruling V5): on a screen with no option the monitoring block is headed "Monitoring" (not "Recommended monitoring plan"), and still counts as a block.
        const anyBlock = WHY_BLOCKS.some(b => r.text.includes(b)) || /<h3[^>]*>Monitoring<\/h3>/.test(r.html);
        assert.equal(has, anyBlock, `seed ${sd}: heading ${has} but blocks ${anyBlock}`);
        if (has) withBlock++; else without++;
    }
    assert.ok(withBlock >= 10 && without >= 5, `${withBlock} with, ${without} without`);
    // the reviewer's patient Q21 (dialysis, spironolactone, eGFR 10): no empty block
    const q21 = make(p => { p.scope_conditions = new Set(['Dialysis']); p.egfr = 10; p.creatinine = 3.8; });
    const r = render(q21);
    assert.equal(r.text.includes(WHY_HEADING), WHY_BLOCKS.some(b => r.text.includes(b)) || /<h3[^>]*>Monitoring<\/h3>/.test(r.html));
});
check('Y12: "NYHA class and findings disagree" keeps the capitals of NYHA and is listed with the safety alerts, not under "Other care prompts"; the header count includes it', () => {
    for (const nyha of ['I', 'II'] as const) {
        const r = render(make(p => { p.nyha_class = nyha as never; p.volume_status.dry_weight_kg = 70; p.volume_status.current_weight_kg = 74; p.volume_status.exam_findings = new Set(['JVP Elevated', 'Crackles', 'Edema (2+)']); }));
        assert.ok(/NYHA class and findings disagree/i.test(r.text) && !/Nyha/.test(r.text), `NYHA ${nyha}: capitals`);
        const safety = /Safety alerts \(\d+\)[^]*?(?=Options \(|Other care prompts|Why: )/.exec(r.text)?.[0] ?? '';
        assert.ok(/NYHA class and findings disagree/i.test(safety), `NYHA ${nyha}: not under the safety alerts`);
        const other = /Other care prompts[^]*?(?=Data not entered|Recommended monitoring plan|Follow-up for option|All drugs withheld|$)/.exec(r.text)?.[0] ?? '';
        assert.ok(!/NYHA class and findings disagree/i.test(other), `NYHA ${nyha}: still under other care prompts`);
        const m = /Analysis complete: \d+ options?, (\d+) safety checks?\./.exec(r.text);
        assert.ok(m && Number(m[1]) >= 1, `NYHA ${nyha}: header count`);
    }
});
check('Y3, Y4: the congestion-without-weight-gain alert and the loop-diuretic sentence, and the possible-poor-perfusion alert, are on the screen, the alerts among the safety alerts', () => {
    const safetyBlock = (t: string) => /Safety alerts \(\d+\)[^]*?(?=Options \(|Other care prompts|Why: )/.exec(t)?.[0] ?? '';
    const congested = render(make(p => { p.nyha_class = 'II' as never; p.volume_status.dry_weight_kg = 80; p.volume_status.current_weight_kg = 80; p.volume_status.exam_findings = new Set(['Edema (3+)', 'Ascites', 'Crackles', 'JVP Elevated']); p.current_regimen = p.current_regimen.filter(r => r.med.drug_class !== 'Loop Diuretic'); }));
    assert.ok(/CONGESTION ON EXAMINATION WITHOUT WEIGHT GAIN/i.test(safetyBlock(congested.text)), 'Y3 alert not among the safety alerts');
    assert.ok(/No loop diuretic start or increase is available today: a new loop diuretic is started only when the weight is more than 1 kg above dry weight/.test(congested.text), 'Y3 sentence not on the screen');
    const perfusion = render(make(p => { p.lvef = 30; p.sbp = 100; p.dbp = 82; p.bun = 40; p.creatinine = 1.0; p.volume_status.exam_findings = new Set(['Cool Extremities']); }));
    assert.ok(/POSSIBLE POOR PERFUSION/i.test(safetyBlock(perfusion.text)) && /assess perfusion before starting or raising a drug/i.test(perfusion.text), 'Y4 alert not among the safety alerts');
});
console.log(`R5 screen checks: ${passed} passed; ${failed} failed. Server-rendered content only.`);
