import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build runs from any folder or static host.
  base: './',
  build: {
    // three.js alone is ~550 kB minified; that is expected here.
    chunkSizeWarningLimit: 800,
  },
});
