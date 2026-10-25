import fs from 'node:fs';
import path from 'node:path';

function syncVersions() {
  const rootDir = process.cwd();
  const packageJsonPath = path.join(rootDir, 'package.json');
  const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
  const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');

  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ package.json not found in', rootDir);
    process.exit(1);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const version = packageJson.version;

  if (!version) {
    console.error('❌ version field missing in package.json');
    process.exit(1);
  }

  console.log(`🔄 Syncing version: ${version}...`);

  // 1. Sync src-tauri/tauri.conf.json
  if (fs.existsSync(tauriConfPath)) {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
    if (tauriConf.version !== version) {
      tauriConf.version = version;
      fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');
      console.log(`✅ Updated ${path.relative(rootDir, tauriConfPath)} -> ${version}`);
    } else {
      console.log(`ℹ️ ${path.relative(rootDir, tauriConfPath)} already at ${version}`);
    }
  }

  // 2. Sync src-tauri/Cargo.toml
  if (fs.existsSync(cargoTomlPath)) {
    const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
    const updatedCargoToml = cargoToml.replace(
      /(\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
      `$1"${version}"`
    );
    if (cargoToml !== updatedCargoToml) {
      fs.writeFileSync(cargoTomlPath, updatedCargoToml, 'utf8');
      console.log(`✅ Updated ${path.relative(rootDir, cargoTomlPath)} -> ${version}`);
    } else {
      console.log(`ℹ️ ${path.relative(rootDir, cargoTomlPath)} already at ${version}`);
    }
  }

  // 3. src-tauri/src/lib.rs 는 env!("CARGO_PKG_VERSION")을 통해 Cargo.toml의 버전을 컴파일 시점에 자동 참조 (SSOT)
  console.log(`ℹ️ src-tauri/src/lib.rs automatically references Cargo.toml via env!("CARGO_PKG_VERSION")`);

  console.log('✨ Version sync completed successfully.');
}

syncVersions();
