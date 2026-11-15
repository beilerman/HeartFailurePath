// Real-browser checks for the guided entry flow. Run against a dev server (npx vite --port 5177 --strictPort):
//   HF_BASE_URL=http://localhost:5177/ node docs/guided-entry-2026-11-15/browser-checks.mjs
// Writes screenshots and browser-checks-receipt.json next to this file. Exit code 1 if any check fails.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.HF_BASE_URL ?? 'http://localhost:5177/').replace(/\?.*$/, '');
const PLAYWRIGHT = process.env.HF_PLAYWRIGHT ?? '/tmp/hf-ui-runner/node_modules/playwright/index.mjs';
const CHROME = process.env.HF_CHROME ?? `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const { chromium } = await import(PLAYWRIGHT);

const receipt = { base: BASE, ranAt: new Date().toISOString(), widths: {}, passed: 0, failed: 0 };
const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function runWidth(width) {
    // Desktop layout scrolls inside the content pane, so a tall viewport shows the whole screen in one image.
    const height = width >= 1024 ? 2200 : 844;
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    const results = []; receipt.widths[width] = results;
    const shot = name => page.screenshot({ path: join(HERE, `${width}-${name}.png`), fullPage: true });
    const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.documentElement.clientWidth));
    const noOverflow = async label => { const o = await overflow(); assert.ok(o <= 0, `horizontal overflow ${o}px at ${label}`); };
    const check = async (name, fn) => {
        try { await fn(); results.push({ name, ok: true }); receipt.passed++; console.log(`[PASS] ${width} ${name}`); }
        catch (e) { results.push({ name, ok: false, error: String(e.message).split('\n')[0] }); receipt.failed++; console.error(`[FAIL] ${width} ${name}: ${String(e.message).split('\n')[0]}`); await shot(`FAIL-${results.length}`).catch(() => {}); }
    };
    const heading = () => page.locator('#guided-step-heading');
    const activeId = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);
    const resultsRegion = () => page.getByRole('region', { name: 'Analysis results' });
    const stepNav = () => page.getByRole('navigation', { name: 'Steps' });
    // From the sm breakpoint up the steps are a row of buttons; below it they are one labelled select.
    const small = width < 640;
    const stepSelect = () => page.locator('#guided-step-select');
    const optionText = async label => (await stepSelect().locator('option').allInnerTexts()).find(t => t.includes(label));
    const goStep = async label => {
        if (small) await stepSelect().selectOption({ label: await optionText(label) });
        else await stepNav().getByRole('button', { name: new RegExp(label) }).click();
    };
    const currentStepText = async () => small
        ? stepSelect().evaluate(el => el.options[el.selectedIndex].text)
        : stepNav().locator('[aria-current="step"]').innerText();
    const tops = sels => Promise.all(sels.map(sel => page.locator(sel).evaluate(el => Math.round(el.getBoundingClientRect().top))));
    const visibleTextCount = re => page.evaluate(src => { const re = new RegExp(src); return [...document.querySelectorAll('main *')].filter(el => el.children.length === 0 && el.tagName !== 'TEXTAREA' && el.tagName !== 'PRE' && el.offsetParent !== null && re.test(el.textContent)).length; }, re.source);

    await page.goto(`${BASE}/`);

    await check('Start screen: six synthetic example cards, New patient, no overflow', async () => {
        await page.getByRole('heading', { name: 'Example patients' }).waitFor();
        assert.equal(await page.locator('article').count(), 6);
        assert.equal(await page.getByText('Synthetic example', { exact: true }).count(), 6);
        await page.getByRole('button', { name: 'New patient', exact: true }).waitFor();
        assert.ok(await page.getByText(/Research decision support/).first().isVisible(), 'amber notice visible');
        const startText = await page.locator('main').innerText();
        assert.match(startText, /Potassium 4\.0/); assert.doesNotMatch(startText, /K\+/);
        const buttonTops = await page.getByRole('button', { name: /^Open and review:/ }).evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
        const rows = new Map(); for (const t of buttonTops) rows.set(t, (rows.get(t) ?? 0) + 1);
        if (width >= 1024) assert.deepEqual([...rows.values()], [3, 3], `buttons align in rows: ${buttonTops}`);
        const headerRows = await page.locator('header').evaluate(h => {
            const boxes = [...h.children].map(c => c.getBoundingClientRect()).sort((x, y) => x.top - y.top);
            let rows = 0, bottom = -Infinity;
            for (const b of boxes) { if (b.top >= bottom - 1) { rows++; bottom = b.bottom; } else bottom = Math.max(bottom, b.bottom); }
            return rows;
        });
        assert.ok(headerRows <= 2, `header uses ${headerRows} rows`);
        await noOverflow('start'); await shot('start');
    });

    await check('Example card opens results with options shown, focus on results, not marked out of date', async () => {
        await page.getByRole('button', { name: /Open and review: Reduced EF with congestion/ }).click();
        await resultsRegion().waitFor();
        await page.getByRole('heading', { name: /^Options \(3\)/ }).waitFor();
        assert.equal(await page.getByText('Analysis is out of date').count(), 0);
        assert.equal(await activeId(), 'Analysis results');
        assert.equal(await visibleTextCount(/EXAMPLE \/ TEST CASE — John Doe/), 1, 'case label shown once');
        const bar = page.getByRole('region', { name: 'Patient summary' });
        await bar.waitFor();
        assert.match(await bar.innerText(), /25%/);
        assert.ok(await page.getByText(/Research decision support/).first().isVisible(), 'amber notice visible');
        await noOverflow('example results'); await shot('results');
    });

    await check('"N other options" link text reads correctly', async () => {
        assert.ok(await page.getByRole('button', { name: '2 other options' }).first().isVisible());
    });

    await check('Edit inputs returns to the Review step with the entered values', async () => {
        await page.getByRole('button', { name: 'Edit inputs' }).click();
        await heading().waitFor();
        assert.match(await heading().innerText(), /Step 7 of 7: Review/);
        assert.match(await currentStepText(), small ? /^Step 7 of 7: Review/ : /^7\s*Review/);
        assert.equal(await activeId(), 'guided-step-heading');
        await page.getByText('Lisinopril, Carvedilol, Furosemide').first().waitFor();
        await noOverflow('review (example)'); await shot('review-example');
    });

    await check('stale handling: an input changed after a run hides the old options; Re-run restores them', async () => {
        await page.getByRole('button', { name: 'Review available information' }).click();
        await resultsRegion().waitFor();
        await page.getByRole('heading', { name: /^Options \(/ }).waitFor();
        await page.getByRole('button', { name: 'Full form', exact: true }).click();
        const age = page.locator('#age'); await age.fill(String(Number(await age.inputValue()) + 1));
        await page.getByRole('button', { name: 'Guided', exact: true }).click();
        await page.getByRole('heading', { name: 'Analysis is out of date' }).waitFor();
        assert.equal(await page.getByRole('heading', { name: /^Options \(/ }).count(), 0);
        assert.equal(await page.locator('#results-option-1').count(), 0);
        await page.getByRole('button', { name: 'Re-run Analysis' }).click();
        await page.getByRole('heading', { name: /^Options \(/ }).waitFor();
        assert.equal(await page.getByText('Analysis is out of date').count(), 0);
    });

    await check('New patient from results goes to Start; New patient there opens a blank step 1', async () => {
        await page.getByRole('button', { name: 'New patient', exact: true }).first().click();
        await page.getByRole('heading', { name: 'Example patients' }).waitFor();
        await page.getByRole('button', { name: 'New patient', exact: true }).click();
        await heading().waitFor();
        assert.match(await heading().innerText(), /Step 1 of 7: Patient and symptoms/);
        assert.equal(await page.locator('#age').inputValue(), '');
        assert.equal(await activeId(), 'guided-step-heading');
        await noOverflow('step 1 blank'); await shot('step1-blank');
    });

    await check('Blank Review lists missing core items, offers the run button, and every step is clickable', async () => {
        await goStep('Review');
        const missing = page.getByRole('heading', { name: 'Not entered yet' });
        await missing.waitFor();
        const text = await page.locator('#guided-review').innerText();
        for (const item of ['Age', 'Sex', 'LVEF', 'NYHA functional class', 'Systolic blood pressure', 'Pulse (heart rate)', 'Potassium', 'Creatinine (kidney function)']) assert.ok(text.includes(item), item);
        assert.equal(await page.getByRole('button', { name: 'Review available information' }).isEnabled(), true);
        for (const label of ['Vitals and exam', 'Labs and echo', 'History and allergies', 'Current medications', 'Preferences', 'Review', 'Patient and symptoms']) {
            await goStep(label); assert.ok((await currentStepText()).includes(label), label);
        }
        await goStep('Review');
        const entered = await page.locator('#guided-review').innerText();
        assert.match(entered, /Nothing entered yet/);
        assert.ok(!/not entered/i.test(entered.slice(entered.indexOf('What you entered'), entered.indexOf('Not entered yet'))), 'entered list holds only entered items');
        await noOverflow('review blank'); await shot('review-blank');
        await goStep('Patient and symptoms');
    });

    await check('An invalid value marks its step, is named on Review with a working link, and blocks the run', async () => {
        await page.locator('#age').fill('17');
        await goStep('Review');
        await page.getByRole('button', { name: 'Correct or save entries to review' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Correct or save entries to review' }).isDisabled(), true);
        assert.ok(small ? (await optionText('Patient and symptoms')).includes('(needs attention)') : (await stepNav().getByRole('button', { name: /Patient and symptoms/ }).locator('.sr-only').innerText()).includes('needs attention'), 'attention marker');
        await page.getByRole('button', { name: /Age must be 18/ }).click();
        assert.match(await heading().innerText(), /Step 1 of 7/);
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'age');
        await page.locator('#age').fill('70');
    });

    await check('Walk Next through all seven steps entering a minimal case; focus lands on each step heading', async () => {
        await page.locator('#sex').selectOption('Male');
        await page.locator('#nyha_class').selectOption('III');
        const next = () => page.getByRole('button', { name: /^Next: / });
        // One transition by keyboard: focus the Next button and press Enter.
        await next().focus(); await page.keyboard.press('Enter');
        assert.match(await heading().innerText(), /Step 2 of 7: Vitals and exam/); assert.equal(await activeId(), 'guided-step-heading');
        await page.locator('#sbp').fill('110'); await page.locator('#dbp').fill('70'); await page.locator('#pulse').fill('72');
        await page.locator('#rhythm').selectOption('Sinus');
        await page.locator('#dry_weight_kg').fill('80'); await page.locator('#current_weight_kg').fill('84');
        await page.getByLabel(/^Pulse/).waitFor(); await page.getByLabel(/^SpO2/).waitFor();
        if (width >= 1024) {
            const t = await tops(['#sbp', '#dbp', '#pulse', '#oxygen_saturation']);
            assert.ok(Math.max(...t) - Math.min(...t) <= 1, `vitals boxes on one baseline: ${t}`);
            const w = await page.locator('#rhythm').evaluate(el => el.getBoundingClientRect().width);
            assert.ok(w <= 400, `rhythm menu capped, was ${w}px`);
        }
        await shot('step2-vitals'); await noOverflow('step 2');
        await next().click();
        assert.match(await heading().innerText(), /Step 3 of 7: Labs and echo/); assert.equal(await activeId(), 'guided-step-heading');
        await page.locator('#lvef').fill('30'); await page.locator('#potassium').fill('4.4'); await page.locator('#creatinine').fill('1.2');
        await noOverflow('step 3'); await shot('step3-labs');
        await next().click();
        assert.match(await heading().innerText(), /Step 4 of 7: History and allergies/);
        await noOverflow('step 4');
        await next().click();
        assert.match(await heading().innerText(), /Step 5 of 7: Current medications/);
        await noOverflow('step 5'); await shot('step5-medications');
        await next().click();
        assert.match(await heading().innerText(), /Step 6 of 7: Preferences/);
        await page.locator('#insurance_tier').selectOption('commercial');
        await noOverflow('step 6');
        await next().click();
        assert.match(await heading().innerText(), /Step 7 of 7: Review/);
        const text = await page.locator('#guided-review').innerText();
        for (const gone of ['Age —', 'LVEF —', 'Potassium —']) assert.ok(!text.includes(gone), `${gone} should no longer be listed`);
        assert.match(text, /70 years, male/); assert.match(text, /30%/); assert.match(text, /110\/70/); assert.match(text, /Sinus/); assert.match(text, /84/); assert.match(text, /80/);
        await noOverflow('review filled'); await shot('review');
    });

    await check('Run from Review: results appear with options or a focused review, focus on results, bar shows entries', async () => {
        await page.getByRole('button', { name: 'Review available information' }).click();
        await resultsRegion().waitFor();
        assert.equal(await activeId(), 'Analysis results');
        const bar = await page.getByRole('region', { name: 'Patient summary' }).innerText();
        assert.match(bar, /Custom case/); assert.match(bar, /70 years, male/); assert.match(bar, /4\.4/);
        assert.equal(await page.getByText('Analysis is out of date').count(), 0);
        await noOverflow('custom results'); await shot('results-custom');
    });

    await check('Full form and back loses nothing and keeps the results', async () => {
        await page.getByRole('button', { name: 'Full form', exact: true }).click();
        await page.locator('#age').waitFor();
        assert.equal(await page.locator('#age').inputValue(), '70');
        assert.equal(await page.locator('#potassium').inputValue(), '4.4');
        assert.equal(await page.locator('#insurance_tier').inputValue(), 'commercial');
        assert.ok(new URL(page.url()).searchParams.get('view') === 'form');
        await noOverflow('full form via switch'); await shot('fullform-switch');
        await page.getByRole('button', { name: 'Guided', exact: true }).click();
        await resultsRegion().waitFor();
        assert.equal(await page.getByText('Analysis is out of date').count(), 0);
        await page.getByRole('button', { name: 'Edit inputs' }).click();
        await goStep('Labs and echo');
        assert.equal(await page.locator('#lvef').inputValue(), '30');
    });

    await check('?view=form loads the original layout and its sample dropdown still works', async () => {
        await page.goto(`${BASE}/?view=form`);
        const sample = page.getByRole('combobox', { name: 'Load a sample patient, or start blank' });
        await sample.waitFor();
        assert.equal(await page.getByRole('button', { name: 'Full form', exact: true }).getAttribute('aria-pressed'), 'true');
        await sample.selectOption({ label: 'John Doe (Wet & Warm)' });
        await page.getByRole('button', { name: 'Review available information', exact: true }).click();
        await page.getByRole('heading', { name: 'Visit review', exact: true }).waitFor();
        assert.ok(await page.getByRole('button', { name: /^Use option \d for the draft note$/ }).count() >= 2);
        await noOverflow('full form'); await shot('fullform');
    });

    await check('No page errors or console errors', async () => { assert.deepEqual(errors, []); });
    await context.close();
}

try { for (const w of [1440, 390]) await runWidth(w); }
finally { await browser.close(); writeFileSync(join(HERE, 'browser-checks-receipt.json'), JSON.stringify(receipt, null, 2)); }
console.log(`Browser checks: ${receipt.passed} passed, ${receipt.failed} failed`);
process.exitCode = receipt.failed ? 1 : 0;
