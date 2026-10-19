import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** CesiumJS loads its web workers, widgets and assets at runtime from CESIUM_BASE_URL (./cesium/). */
const CESIUM = resolve('node_modules/cesium/Build/Cesium');
const CESIUM_DIRS = ['Workers', 'Assets', 'ThirdParty', 'Widgets'];
function cesiumAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'cesium-assets',
    configResolved(c) { outDir = c.build.outDir; },
    configureServer(server) {
      server.middlewares.use('/cesium', (req: { url?: string }, res, next) => {
        const f = join(CESIUM, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (existsSync(f) && statSync(f).isFile()) { res.setHeader('Cache-Control', 'max-age=3600'); res.end(readFileSync(f)); } else next();
      });
    },
    writeBundle() { for (const d of CESIUM_DIRS) cpSync(join(CESIUM, d), join(outDir, 'cesium', d), { recursive: true }); },
  };
}

// Relative base so the build works from any sub-path or a kiosk's local file server.
export default defineConfig({
  base: './',
  plugins: [react(), cesiumAssets()],
  build: {
    chunkSizeWarningLimit: 6000,
    // Engines change rarely; separate chunks stay cached across app releases.
    rollupOptions: { output: { manualChunks: { cesium: ['cesium'], three: ['three'] } } },
  },
});
