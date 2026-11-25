// Run against a local HeartFailurePATH server. HF_PLAYWRIGHT and HF_CHROME optionally select a local browser installation.
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.HF_PLAYWRIGHT || 'playwright');
const base = new URL(process.env.HF_BASE_URL || 'http://localhost:5173/');
const browser = await chromium.launch({ executablePath: process.env.HF_CHROME || undefined, headless: true });

async function verifySession(width) {
    const context = await browser.newContext({ viewport: { width, height: 930 } });
    try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        const button = name => page.getByRole('button', { name, exact: true });
        const sessionKey = 'hfp-session-v1';

        const formURL = new URL(base);
        formURL.searchParams.set('view', 'form');
        await page.goto(formURL.href);
        await page.locator('#age').fill('76');
        await page.waitForFunction(key => JSON.parse(sessionStorage.getItem(key))?.patient.age === 76, sessionKey);
        await page.reload();
        assert.equal(await page.locator('#age').inputValue(), '76');
        await button('Guided').click();
        await page.getByRole('button', { name: /Start over: clear the entered patient/ }).click();

        await page.getByRole('button', { name: /Open and review: Reduced EF with congestion/ }).click();
        await page.getByRole('heading', { name: /^Options \(/ }).waitFor();
        await button('Full form').click();
        await page.locator('#add-medication-drug').selectOption({ label: 'Bisoprolol (Beta Blocker)' });
        await page.getByText('Save or cancel the unfinished entry before switching input views.', { exact: true }).waitFor();
        assert.ok(await button('Guided').isDisabled());
        await button('cancel this entry').click();

        // Put the first recorded drug on hold through the form, then correct its dose.
        const name = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).patient.current_regimen[0].__reg.name, sessionKey);
        const status = page.locator('#exposure-status-0');
        await page.locator('#medication_exposure_0 summary').click();
        await status.selectOption('held');
        await button(`Edit ${name} dose and frequency`).click();
        const dose = page.locator('#add-medication-dose');
        const alternative = await dose.evaluate(select => [...select.options].find(o => o.value && o.value !== select.value)?.value);
        assert.ok(alternative, 'The example medication must offer another dose');
        await dose.selectOption(alternative);
        await page.locator('#add-medication-freq').selectOption({ index: 1 });
        await button('Save dose and frequency').click();
        await page.waitForFunction(({ key, value }) => {
            const saved = JSON.parse(sessionStorage.getItem(key)).patient.current_regimen[0].__reg;
            return String(saved.strength) === value && saved.exposure.status === 'held';
        }, { key: sessionKey, value: alternative });

        // Emulate a session written with a formulary entry the current version cannot resolve.
        await page.evaluate(key => {
            const saved = JSON.parse(sessionStorage.getItem(key));
            saved.patient.current_regimen[0].__reg.name = 'Unrecognized historical medication';
            sessionStorage.setItem(key, JSON.stringify(saved));
        }, sessionKey);
        await page.reload();
        await page.getByRole('alert').filter({ hasText: 'saved patient could not be restored' }).waitFor();
        assert.equal(await page.getByRole('heading', { name: /^Options \(/ }).count(), 0);
        await button('New patient').click();
        assert.equal(await page.locator('#age').inputValue(), '');
        assert.deepEqual(errors, []);
        console.log(`PASS at ${width}px: full-form reload, unfinished entry, held dose correction, and recovery to a blank patient.`);
    } finally {
        await context.close();
    }
}

// C2 (round 11): "Choose a different patient" and "New patient" ask before discarding an entered case, in the page, by keyboard as well as pointer.
async function verifyDiscard(width) {
    const context = await browser.newContext({ viewport: { width, height: 930 } });
    try {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('dialog', async d => { errors.push(`browser dialog: ${d.message()}`); await d.dismiss(); });
        const prompt = page.getByRole('alertdialog');
        const startHeading = page.getByRole('heading', { name: 'Your own patient' });
        await page.goto(base.href);
        // An untouched blank case: no prompt.
        await page.getByRole('button', { name: 'New patient', exact: true }).click();
        await page.locator('#age').waitFor();
        await page.getByRole('button', { name: 'Choose a different patient', exact: true }).click();
        await startHeading.waitFor();
        assert.equal(await prompt.count(), 0, 'a blank case must not be questioned');
        // An unmodified example: no prompt from the results page.
        await page.getByRole('button', { name: /Open and review: Reduced EF with congestion/ }).click();
        await page.getByRole('heading', { name: /^Options \(/ }).waitFor();
        await page.getByRole('button', { name: 'New patient', exact: true }).click();
        await startHeading.waitFor();
        assert.equal(await prompt.count(), 0, 'an unmodified example must not be questioned');
        // An entered case: the prompt, keep editing by keyboard (Escape and the button), then discard by keyboard.
        await page.getByRole('button', { name: 'New patient', exact: true }).click();
        await page.locator('#age').fill('66');
        const choose = page.getByRole('button', { name: 'Choose a different patient', exact: true });
        await choose.focus();
        await page.keyboard.press('Enter');
        await prompt.waitFor();
        assert.ok((await prompt.innerText()).includes('Discard the entered case?'));
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Keep editing', 'focus goes to Keep editing');
        await page.keyboard.press('Escape');
        await prompt.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Choose a different patient', 'focus returns to the button that opened the prompt');
        assert.equal(await page.locator('#age').inputValue(), '66');
        await page.keyboard.press('Enter');
        await prompt.waitFor();
        await page.keyboard.press('Enter'); // Keep editing is focused
        await prompt.waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Choose a different patient');
        assert.equal(await page.locator('#age').inputValue(), '66');
        await page.keyboard.press('Enter');
        await prompt.waitFor();
        await page.keyboard.press('Shift+Tab'); // from Keep editing to Discard
        assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Discard');
        await page.keyboard.press('Enter');
        await startHeading.waitFor();
        assert.equal(await prompt.count(), 0);
        await page.getByRole('button', { name: 'New patient', exact: true }).click();
        assert.equal(await page.locator('#age').inputValue(), '', 'the discarded case is gone');
        // The same prompt from the results page of a modified case: change an example, then press New patient.
        await page.getByRole('button', { name: 'Choose a different patient', exact: true }).click();
        await page.getByRole('button', { name: /Open and review: Reduced EF with congestion/ }).click();
        await page.getByRole('heading', { name: /^Options \(/ }).waitFor();
        await page.getByRole('button', { name: 'Edit inputs', exact: true }).click();
        const back = page.getByRole('button', { name: 'Back', exact: true });
        while (await back.count()) await back.click();
        const age = Number(await page.locator('#age').inputValue());
        await page.locator('#age').fill(String(age + 1));
        await page.getByRole('button', { name: 'Choose a different patient', exact: true }).click();
        await prompt.waitFor();
        await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
        assert.equal(await page.locator('#age').inputValue(), String(age + 1), 'a modified example keeps its change');
        // R12 D5(c): an open prompt is closed by any screen change: the in-app Back button, then browser Back (it used to stay open and show on the start screen).
        await page.getByRole('button', { name: 'Choose a different patient', exact: true }).click();
        await prompt.waitFor();
        const stepBack = page.getByRole('button', { name: 'Next', exact: true });
        if (await stepBack.count()) { await stepBack.first().click(); assert.equal(await prompt.count(), 0, 'the prompt must close when the step changes'); }
        await page.getByRole('button', { name: 'Choose a different patient', exact: true }).click();
        await prompt.waitFor();
        await page.goBack();
        await page.waitForTimeout(300);
        assert.equal(await prompt.count(), 0, 'the prompt must not survive browser Back');
        await page.goForward();
        await page.waitForTimeout(300);
        assert.equal(await prompt.count(), 0, 'the prompt must not reappear after browser Forward');
        // R12 D5(d): an unchanged example whose rhythm is atrial fibrillation (the form adds the derived history) is not "touched"; changing one field is.
        for (const title of ['Hyperkalemia (K+ 5.6) - Avoid MRA', 'Angioedema Hx - Avoid ACEi/ARNI', 'Severe Asthma - Selective BB Only', 'John Doe (Wet & Warm)']) {
            const formURL = new URL(base); formURL.searchParams.set('view', 'form');
            await page.goto(formURL.href);
            await page.selectOption('#scenarios', { label: title });
            await page.getByRole('button', { name: 'Guided', exact: true }).click();
            await page.getByRole('button', { name: 'Choose a different patient', exact: true }).click();
            await startHeading.waitFor();
            assert.equal(await prompt.count(), 0, `${title}: an unchanged example must not be questioned`);
            await page.goto(formURL.href);
            await page.selectOption('#scenarios', { label: title });
            await page.getByRole('button', { name: 'Guided', exact: true }).click();
            await page.locator('#age').waitFor();
            await page.locator('#age').fill(String(Number(await page.locator('#age').inputValue()) + 1));
            await page.getByRole('button', { name: 'Choose a different patient', exact: true }).click();
            await prompt.waitFor();
        }
        // R13 E5(a): EVERY example card, opened and left unchanged, then "New patient" from its results page: no prompt (the case in state is the raw example, the form has never been opened).
        const fresh = async () => { await page.goto(base.href); await page.evaluate(() => { try { sessionStorage.clear(); } catch { /* none */ } }); await page.goto(base.href); };
        await fresh();
        const cardNames = await page.getByRole('button', { name: /^Open and review: / }).evaluateAll(els => els.map(e => e.getAttribute('aria-label') || e.textContent));
        assert.ok(cardNames.length >= 6, `${cardNames.length} example cards`);
        for (const name of cardNames) {
            await fresh();
            await page.getByRole('button', { name: name.trim(), exact: true }).click();
            await page.getByRole('button', { name: 'New patient', exact: true }).waitFor(); // the results page (some examples show a stop screen instead of an options list)
            await page.waitForTimeout(400);
            await page.getByRole('button', { name: 'New patient', exact: true }).click();
            await Promise.race([startHeading.waitFor(), prompt.waitFor()]);
            assert.equal(await prompt.count(), 0, `${name}: an unchanged example must not be questioned from its results page`);
            await startHeading.waitFor();
        }
        // R13 E5(b): an open prompt is closed by a tab round trip (Formulary, then Analysis).
        await fresh();
        await page.getByRole('button', { name: 'New patient', exact: true }).click();
        await page.locator('#age').fill('66');
        await page.getByRole('button', { name: 'Choose a different patient', exact: true }).click();
        await prompt.waitFor();
        await page.locator('#tab-library').click();
        await page.locator('#tab-simulation').click();
        await page.waitForTimeout(300);
        assert.equal(await prompt.count(), 0, 'the prompt must not return after a tab round trip');
        await page.locator('#tab-faq').click();
        await page.locator('#tab-simulation').click();
        assert.equal(await prompt.count(), 0, 'the prompt must not return after an Evidence tab round trip');
        assert.equal(await page.locator('#age').inputValue(), '66', 'the entered case is kept');
        assert.deepEqual(errors, []);
        console.log(`PASS at ${width}px: discard prompt (blank and example silent; entered case asks; Escape, Keep editing and Discard by keyboard; focus returned; an open prompt closes on a step change and on browser Back; an unchanged atrial fibrillation example is not questioned; every unchanged example card is silent from its results page; an open prompt closes on a tab round trip).`);
    } finally {
        await context.close();
    }
}

try {
    for (const width of [390, 1440]) { await verifySession(width); await verifyDiscard(width); }
} finally {
    await browser.close();
}
