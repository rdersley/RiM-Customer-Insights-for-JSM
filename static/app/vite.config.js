import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  // Forge serves Custom UI from a sub-path, so asset URLs must be relative.
  base: './',
  plugins: [react()],
  // groupWorker.js imports the shared analysis module.
  worker: { format: 'es' },
  build: { outDir: resolve(import.meta.dirname, 'build'), emptyOutDir: true },
});
