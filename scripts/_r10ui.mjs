import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error' });
try { const r = await vite.ssrLoadModule('/scripts/verifyR10Ui.tsx'); process.exitCode = r.failed ? 1 : 0; } finally { await vite.close(); }
