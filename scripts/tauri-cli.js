#!/usr/bin/env node
import { spawn } from 'node:child_process';

import path from 'node:path';
import fs from 'node:fs';

const args = process.argv.slice(2);
const firstArg = args[0];
const isWindows = process.platform === 'win32';

// node_modules/.bin 경로 우선 탐색
const localBinDir = path.resolve('node_modules', '.bin');
const resolveBin = (name) => {
  const ext = isWindows ? '.cmd' : '';
  const localBin = path.join(localBinDir, `${name}${ext}`);
  if (fs.existsSync(localBin)) {
    return localBin;
  }
  return isWindows ? `${name}.cmd` : name;
};

if (firstArg === 'build:mac') {
  const pnpmBin = resolveBin('pnpm');
  const proc = spawn(pnpmBin, ['run', 'build:mac', ...args.slice(1)], {
    stdio: 'inherit',
    shell: isWindows,
  });
  proc.on('exit', (code) => process.exit(code ?? 0));
} else if (firstArg === 'build:win') {
  const pnpmBin = resolveBin('pnpm');
  const proc = spawn(pnpmBin, ['run', 'build:win', ...args.slice(1)], {
    stdio: 'inherit',
    shell: isWindows,
  });
  proc.on('exit', (code) => process.exit(code ?? 0));
} else {
  const tauriBin = resolveBin('tauri');
  const proc = spawn(tauriBin, args, {
    stdio: 'inherit',
    shell: isWindows,
  });
  proc.on('exit', (code) => process.exit(code ?? 0));
}
