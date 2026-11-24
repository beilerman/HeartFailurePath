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

try {
    for (const width of [390, 1440]) await verifySession(width);
} finally {
    await browser.close();
}
