import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error' });
try { await vite.ssrLoadModule('/scripts/r6ScreenSweep.tsx'); } finally { await vite.close(); }
