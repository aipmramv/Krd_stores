import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the build works from any sub-path or a kiosk's local file server.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    // Map and 3D engines change rarely; separate chunks stay cached across app releases.
    rollupOptions: { output: { manualChunks: { maplibre: ['maplibre-gl'], three: ['three'] } } },
  },
});
