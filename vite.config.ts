import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { DEFAULT_SERVER_PORT } from './src/config/constants.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverPort = env.PORT ? Number(env.PORT) || DEFAULT_SERVER_PORT : DEFAULT_SERVER_PORT;
  const appVersion = env.APP_VERSION || '1.1';

  return {
    plugins: [react()],
    clearScreen: false,
    envPrefix: ['VITE_', 'APP_'],
    define: {
      'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'dist-web',
      emptyOutDir: true,
    },
  };
});
