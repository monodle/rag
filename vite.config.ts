import fs from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import {
  DEFAULT_PROD_SERVER_PORT,
  DEFAULT_DEV_SERVER_PORT,
  DEFAULT_DEV_UI_PORT,
} from './src/config/sharedConstants.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const prodPort = env.PROD_PORT ? Number(env.PROD_PORT) || DEFAULT_PROD_SERVER_PORT : DEFAULT_PROD_SERVER_PORT;
  const devPort = env.DEV_PORT ? Number(env.DEV_PORT) || DEFAULT_DEV_SERVER_PORT : DEFAULT_DEV_SERVER_PORT;
  const defaultPort = mode === 'production' ? prodPort : devPort;
  const serverPort = env.PORT ? Number(env.PORT) || defaultPort : defaultPort;

  let pkgVersion = '1.0.0';
  try {
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
    if (pkg.version) pkgVersion = pkg.version;
  } catch {
    // 무시
  }
  const appVersion = env.APP_VERSION || pkgVersion;

  return {
    plugins: [react()],
    clearScreen: false,
    envPrefix: ['VITE_', 'APP_'],
    define: {
      'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.DEV_PORT': JSON.stringify(devPort),
      'import.meta.env.PROD_PORT': JSON.stringify(prodPort),
    },
    server: {
      port: DEFAULT_DEV_UI_PORT,
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
