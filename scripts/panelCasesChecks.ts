// Checks for the expert-panel packet (wired into `npm run verify`). They fail when the committed packet is stale, when a case does not run cleanly,
// when a generated file carries wording a physician must not read, or when a case is not stamped with the current rule set.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PANEL_CASE_SPECS, PANEL_CASE_ORDER } from '../data/panelCases';
import { RULESET_VERSION } from '../services/rulesetVersion';
import { validatePatientForm } from '../components/patient-form/formValidation';
import { buildPacket, PANEL_DIR, PAGE_BREAK, caseTitle } from './buildPanelCases';

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = '') => { if (ok) passed++; else failures.push(`${name}${detail ? `: ${detail}` : ''}`); };

// Wording a physician must not meet in any generated file.
const FORBIDDEN: [string, RegExp][] = [
    ['em dash', /—/],
    ['underscore', /_/],
    ['the word engine', /\bengine\b/i],
    ['an arrow', /[\u2190-\u21FF\u27F0-\u27FF\u2900-\u297F\u2B00-\u2BFF]|->|<-|=>/],
    ['a rule number', /\bRule E?\d+\b|\bE\d{2}\b/],
    ['undefined', /\bundefined\b/],
    ['NaN', /\bNaN\b/],
    ['an object printed as text', /\[object/],
    ['a script path', /\bscripts\/|\.tsx?\b/],
];

async function main() {
    const { files, runs } = await buildPacket();

    check('between 40 and 45 cases', runs.length >= 40 && runs.length <= 45, String(runs.length));
    const keys = PANEL_CASE_SPECS.map(s => s.key);
    check('case order is exactly the set of cases', PANEL_CASE_ORDER.length === keys.length && new Set(PANEL_CASE_ORDER).size === keys.length && keys.every(k => PANEL_CASE_ORDER.includes(k)));

    for (const c of runs) {
        const p = c.spec.patient;
        const errors = validatePatientForm(p);
        check(`case ${c.number}: the form accepts the inputs`, Object.keys(errors).length === 0, JSON.stringify(errors));
        const bad = c.out.clinicalAlerts.filter(a => /INPUT ERROR|IMPLAUSIBLE/.test(a.slice(0, 60)));
        check(`case ${c.number}: runs without an input error`, bad.length === 0, bad[0]?.slice(0, 80));
        const md = files.get(`cases/case-${String(c.number).padStart(2, '0')}.md`) ?? '';
        const [one, two] = md.split(PAGE_BREAK);
        check(`case ${c.number}: has Part 1 and Part 2 separated by a page break`, !!one && !!two && one.includes('## Part 1. The patient') && two.includes('## Part 2. What the tool shows'));
        check(`case ${c.number}: shows the current rule set in both parts`, (one ?? '').includes(`Rule set ${RULESET_VERSION}`) && (two ?? '').includes(`Rule set ${RULESET_VERSION}`));
        check(`case ${c.number}: Part 1 does not show the tool's output`, !!one && !/Option 1|Safety alerts|What the tool shows|ordering score/.test(one));
        check(`case ${c.number}: the title is neutral`, !/option|alert|unsafe|stop|no change|safety|withheld/i.test(caseTitle(p)));
        check(`case ${c.number}: the rating questions are present`, !!two && ['Question 1.', 'Question 2.', 'Question 3.', 'Question 4.', 'Question 5.', 'Question 6'].every(q => two.includes(q)));
        check(`case ${c.number}: Part 1 asks for the reviewer's own plan first`, !!one && one.includes('What would you change at this visit?'));
    }

    for (const [path, text] of files) {
        for (const [label, re] of FORBIDDEN) {
            const m = re.exec(text);
            check(`${path}: no ${label}`, !m, m ? text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\n/g, ' ') : '');
        }
    }

    // The committed packet equals what the generator produces now.
    for (const [path, text] of files) {
        const full = join(PANEL_DIR, path);
        const same = existsSync(full) && readFileSync(full, 'utf8') === text;
        check(`${path}: committed file equals the generator's output (run npm run panel:cases)`, same);
    }
    const onDisk = existsSync(join(PANEL_DIR, 'cases')) ? readdirSync(join(PANEL_DIR, 'cases')).filter(f => /^case-\d+\.md$/.test(f)) : [];
    check('no stale case files on disk', onDisk.every(f => files.has(`cases/${f}`)) && onDisk.length === runs.length, `${onDisk.length} on disk, ${runs.length} generated`);

    // R7 W8: a no-option case reads as the live screen does and its questions do not ask about a first option; the "What matters most" trio each says what the setting changed.
    for (const c of runs.filter(r => r.out.scoredRegimens.length === 0)) {
        const two = (files.get(`cases/case-${String(c.number).padStart(2, '0')}.md`) ?? '').split(PAGE_BREAK)[1] ?? '';
        check(`case ${c.number} (no option): no pre-V5 wording`, !/Medication options with the prerequisites recorded|no medication option was produced|### Options/.test(two));
        check(`case ${c.number} (no option): the questions do not ask about the first option`, !/first option/i.test(two.slice(two.indexOf('## Your ratings for this case'))));
    }
    const jRuns = runs.filter(r => ['J0', 'J1', 'J2'].includes(r.spec.key));
    for (const c of jRuns.filter(r => r.spec.key !== 'J0')) {
        const two = (files.get(`cases/case-${String(c.number).padStart(2, '0')}.md`) ?? '').split(PAGE_BREAK)[1] ?? '';
        check(`case ${c.number}: says in one sentence what the setting changed relative to Balanced`, /\*\*What this setting changed \(generated\)\.\*\* This patient is also shown with the Balanced setting elsewhere in the packet\.[^\n]*weights are changed as follows/.test(two) && !/\(case \d+\)|Balanced gave/.test(two));
        const tie = /too close to separate/.test(two);
        check(`case ${c.number}: the tie statement appears with the tie sentence and only then`, /within one point of each other/.test(two) === tie);
    }

    // R8 X3: the doses-a-day figure in an option's trade-off label is the figure in the dosing sentence printed on the same page (one function; a single dose is not a daily dose).
    for (const c of runs.filter(r => r.out.scoredRegimens.length > 0)) {
        const two = (files.get(`cases/case-${String(c.number).padStart(2, '0')}.md`) ?? '').split(PAGE_BREAK)[1] ?? '';
        const blocks = two.split(/^### Option \d+:/m).slice(1);
        for (const [i, b] of blocks.entries()) {
            const line = /Dosing burden: ([^\n]*?) \(now ([^\n)]*)\)\./.exec(b), label = /- Dosing burden: (?:More|Fewer) doses a day than now \((\d+(?:\.\d)?), now (\d+(?:\.\d)?)\)|- Dosing burden: Same doses a day as now \((\d+(?:\.\d)?)\)/.exec(b);
            if (!line || !label) continue;
            const daily = (t: string) => Number(/^(\d+) doses? a day/.exec(t)?.[1] ?? 0);
            const after = daily(line[1]), now = daily(line[2]);
            const a = Number(label[1] ?? label[3]), n = Number(label[2] ?? label[3]);
            check(`case ${c.number} option ${i + 1}: the dosing label's figures (${a}, now ${n}) are the dosing sentence's (${after}, now ${now})`, a === after && n === now);
        }
    }

    const csv = files.get('responses-template.csv') ?? '';
    check('the General row of the response sheet names the columns its answers go in', /Q1FirstOptionRating/.test(csv.split('\n').find(l => l.includes(',General,')) ?? '') && /Q2WhatIWouldDoFirst/.test(csv.split('\n').find(l => l.includes(',General,')) ?? ''));
    check('response sheet has one row per case plus the general row and a header', csv.trim().split('\n').length === runs.length + 2);

    if (failures.length > 0) {
        console.error(`Panel case checks FAILED (${failures.length} of ${passed + failures.length}):`);
        for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
        process.exit(1);
    }
    console.log(`Panel case checks: ${passed} passed (rule set ${RULESET_VERSION}, ${runs.length} cases).`);
}
await main();
