import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    port: Number(process.env.PORT) || 3000,
    strictPort: false,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    base: './',
    rollupOptions: {
      // o portal + a página separada de teste das guias de remessa
      input: {
        main: resolve(__dirname, 'index.html'),
        guiasTeste: resolve(__dirname, 'guias-teste.html'),
      },
    },
  },
});
