import { createServer } from 'vite';

// Use the app's own transforms (including ?raw evidence imports). No browser is started.
const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error' });
try {
    // ONLY_EXPLAIN=1 runs just the screen-explanation checks (faster while editing); ONLY_PARTB=1 runs just the round 2 part B checks.
    const only = process.env.ONLY_PARTB;
    const base = process.env.ONLY_EXPLAIN || only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyClinicalUi.tsx');
    const explain = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyScreenExplain.tsx');
    const partB = await vite.ssrLoadModule('/scripts/verifyPartBChecks.tsx');
    const r3 = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyR3Ui.tsx');
    const r4 = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyR4Ui.tsx');
    const r5 = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyR5Ui.tsx');
    const r6 = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyR6Ui.tsx');
    const r7 = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyR7Ui.tsx');
    const r8 = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyR8Ui.tsx');
    const r9 = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyR9Ui.tsx');
    const r10 = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyR10Ui.tsx');
    const r11 = only ? { failed: 0 } : await vite.ssrLoadModule('/scripts/verifyR11Ui.tsx');
    process.exitCode = base.failed || explain.failed || partB.failed || r3.failed || r4.failed || r5.failed || r6.failed || r7.failed || r8.failed || r9.failed || r10.failed || r11.failed ? 1 : 0;
} finally {
    await vite.close();
}
