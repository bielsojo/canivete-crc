import { defineConfig } from 'vite';

// base relativo: o mesmo build funciona em https://bielsojo.github.io/<repo>/ e localmente
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
  server: { port: 5173 }
});
