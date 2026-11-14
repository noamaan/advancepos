import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' keeps asset paths relative so the same build works on GitHub
// Pages project sites (https://<user>.github.io/<repo>/) as well as root hosts.
export default defineConfig({
  base: './',
  plugins: [react()],
  // allowedHosts lets the sandbox preview proxy (*.e2b.app) reach the dev server
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          charts: ['recharts'],
          excel: ['xlsx'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
