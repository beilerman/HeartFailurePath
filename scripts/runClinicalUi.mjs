import { createServer } from 'vite';

// Use the app's own transforms (including ?raw evidence imports). No browser is started.
const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error' });
try {
    const result = await vite.ssrLoadModule('/scripts/verifyClinicalUi.tsx');
    process.exitCode = result.failed ? 1 : 0;
} finally {
    await vite.close();
}
