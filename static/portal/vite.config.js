import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  // Forge serves Custom UI from a sub-path, so asset URLs must be relative.
  base: './',
  plugins: [react()],
  build: { outDir: resolve(import.meta.dirname, 'build'), emptyOutDir: true },
});
