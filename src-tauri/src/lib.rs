use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::RunEvent;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const APP_NAME: &str = env!("CARGO_PKG_NAME");

const GITHUB_REPO: &str = "monodle/rag";

#[cfg(target_os = "windows")]
const ENGINE_ARCHIVE_FILE: &str = "korean_law_engine_win_x64.tar.gz";

#[cfg(not(target_os = "windows"))]
const ENGINE_ARCHIVE_FILE: &str = "korean_law_engine_mac_arm64.tar.gz";

fn get_engine_release_url() -> String {
  format!(
    "https://github.com/{}/releases/download/v{}/{}",
    GITHUB_REPO,
    env!("CARGO_PKG_VERSION"),
    ENGINE_ARCHIVE_FILE
  )
}

fn resolve_backend_port() -> u16 {
  #[cfg(debug_assertions)]
  {
    if let Ok(val) = std::env::var("DEV_PORT").or_else(|_| std::env::var("PORT")) {
      if let Ok(p) = val.trim().parse::<u16>() {
        return p;
      }
    }
    // .env 파일 기반 컴파일 시점 주입(SSOT) 또는 안전 기본값
    option_env!("DEV_PORT")
      .and_then(|p| p.trim().parse::<u16>().ok())
      .unwrap_or(34200)
  }
  #[cfg(not(debug_assertions))]
  {
    if let Ok(val) = std::env::var("PROD_PORT").or_else(|_| std::env::var("PORT")) {
      if let Ok(p) = val.trim().parse::<u16>() {
        return p;
      }
    }
    // .env 파일 기반 컴파일 시점 주입(SSOT) 또는 안전 기본값
    option_env!("PROD_PORT")
      .and_then(|p| p.trim().parse::<u16>().ok())
      .unwrap_or(34100)
  }
}

/**
 * 로컬 포트 열림(listen) 상태 확인
 */
fn is_port_open(port: u16) -> bool {
  let addr_str = format!("127.0.0.1:{}", port);
  match addr_str.parse::<SocketAddr>() {
    Ok(addr) => TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok(),
    Err(_) => false,
  }
}

/**
 * OS 표준 AppData 내 독립 엔진 디렉토리 반환
 * - macOS: ~/Library/Application Support/korean-law-chat/engine
 * - Windows: %APPDATA%/korean-law-chat/engine
 */
fn resolve_app_engine_dir() -> PathBuf {
  let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
  if cfg!(target_os = "windows") {
    let app_data = std::env::var("APPDATA")
      .or_else(|_| std::env::var("LOCALAPPDATA"))
      .unwrap_or_else(|_| format!("{}\\AppData\\Roaming", home));
    PathBuf::from(app_data).join(APP_NAME).join("engine")
  } else if cfg!(target_os = "macos") {
    PathBuf::from(home)
      .join("Library")
      .join("Application Support")
      .join(APP_NAME)
      .join("engine")
  } else {
    PathBuf::from(home)
      .join(".local")
      .join("share")
      .join(APP_NAME)
      .join("engine")
  }
}

/**
 * 시스템 Node.js 실행 파일 탐색 (개발 머신 폴백용)
 */
#[allow(dead_code)]
fn find_system_node() -> Option<PathBuf> {
  let mut candidates = Vec::new();

  if cfg!(target_os = "windows") {
    candidates.push(PathBuf::from("node.exe"));
    candidates.push(PathBuf::from("C:\\Program Files\\nodejs\\node.exe"));
  } else {
    candidates.push(PathBuf::from("node"));
    candidates.push(PathBuf::from("/opt/homebrew/bin/node"));
    candidates.push(PathBuf::from("/usr/local/bin/node"));

    // NVM 경로 자동 스캔
    if let Ok(home) = std::env::var("HOME") {
      let nvm_node_dir = PathBuf::from(&home).join(".nvm").join("versions").join("node");
      if let Ok(entries) = std::fs::read_dir(&nvm_node_dir) {
        let mut nvm_bins: Vec<PathBuf> = entries
          .filter_map(|e| e.ok())
          .map(|e| e.path().join("bin").join("node"))
          .filter(|p| p.exists())
          .collect();
        nvm_bins.sort();
        nvm_bins.reverse();
        candidates.extend(nvm_bins);
      }
    }
  }

  for candidate in candidates {
    if Command::new(&candidate)
      .arg("--version")
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status()
      .map(|s| s.success())
      .unwrap_or(false)
    {
      return Some(candidate);
    }
  }

  None
}

/**
 * 스마트 웹 인스톨러: 다른 순정 컴퓨터 실행 시 백엔드 엔진 자동 다운로드 및 압축 해제
 */
fn ensure_engine_installed() -> bool {
  let engine_dir = resolve_app_engine_dir();
  let script = engine_dir.join("dist-server").join("ragServer.mjs");
  let node_bin = if cfg!(target_os = "windows") {
    engine_dir.join("node.exe")
  } else {
    engine_dir.join("node")
  };

  if script.exists() && node_bin.exists() {
    return true;
  }

  println!("[Smart Installer] 🚀 백엔드 엔진 설치 상태 확인 중...");
  let _ = std::fs::create_dir_all(&engine_dir);

  // 1. Windows: 로컬 배포 폴더(./release 등)에 이미 패키징된 아카이브가 있는지 확인
  #[cfg(windows)]
  {
    let mut local_candidates = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
      local_candidates.push(cwd.join("release").join(ENGINE_ARCHIVE_FILE));
      local_candidates.push(cwd.join(ENGINE_ARCHIVE_FILE));
    }
    if let Ok(exe_path) = std::env::current_exe() {
      if let Some(parent) = exe_path.parent() {
        local_candidates.push(parent.join(ENGINE_ARCHIVE_FILE));
        local_candidates.push(parent.join("release").join(ENGINE_ARCHIVE_FILE));
      }
    }

    for candidate in local_candidates {
      if candidate.exists() {
        println!("[Smart Installer] 📦 로컬 엔진 아카이브 감지: {:?}", candidate);
        let mut tar_cmd = Command::new("tar");
        tar_cmd.args([
          "-xf",
          candidate.to_str().unwrap(),
          "-C",
          engine_dir.to_str().unwrap(),
        ]);
        tar_cmd.creation_flags(CREATE_NO_WINDOW);
        if tar_cmd.status().map(|s| s.success()).unwrap_or(false) && node_bin.exists() && script.exists() {
          println!("[Smart Installer] ✅ 로컬 엔진 아카이브 압축 해제 완료!");
          return true;
        }
      }
    }
  }

  let download_url = std::env::var("KOREAN_LAW_ENGINE_URL")
    .unwrap_or_else(|_| get_engine_release_url());

  let temp_archive = engine_dir.join("engine_temp.tar.gz");

  // curl로 엔진 아카이브 다운로드 (창 숨김 적용)
  println!("[Smart Installer] 📥 엔진 다운로드 시작: {}", download_url);
  let mut curl_cmd = Command::new("curl");
  curl_cmd.args([
    "-L",
    "-f",
    "--retry",
    "3",
    "--silent",
    "--show-error",
    "-o",
    temp_archive.to_str().unwrap(),
    &download_url,
  ]);
  #[cfg(windows)]
  curl_cmd.creation_flags(CREATE_NO_WINDOW);

  let curl_status = curl_cmd.status();

  if curl_status.map(|s| s.success()).unwrap_or(false) && temp_archive.exists() {
    println!("[Smart Installer] 📦 엔진 압축 해제 중...");
    let mut tar_cmd = Command::new("tar");
    tar_cmd.args([
      "-xf",
      temp_archive.to_str().unwrap(),
      "-C",
      engine_dir.to_str().unwrap(),
    ]);
    #[cfg(windows)]
    tar_cmd.creation_flags(CREATE_NO_WINDOW);

    let tar_status = tar_cmd.status();
    let _ = std::fs::remove_file(&temp_archive);

    if tar_status.map(|s| s.success()).unwrap_or(false) {
      #[cfg(unix)]
      {
        let _ = Command::new("chmod")
          .args(["+x", node_bin.to_str().unwrap()])
          .status();
      }

      println!("[Smart Installer] ✅ 백엔드 엔진 설치 완료!");
      return true;
    }
  }

  eprintln!("[Smart Installer] ❌ 온라인 엔진 다운로드 실패. URL: {}", download_url);
  false
}

/**
 * 백엔드 실행 환경 결정
 * 1순위: AppData 내 설치된 엔진 (~/Library/Application Support/korean-law-chat/engine)
 * 2순위: 개발 모드(debug_assertions)에서만 현재 소스코드 디렉토리 참조
 * 3순위: 순정 환경 스마트 인스톨러 다운로드 실행
 * 4순위: 로컬 워크스페이스 및 시스템 node 폴백
 */
fn resolve_engine_paths() -> Option<(PathBuf, PathBuf, PathBuf)> {
  let engine_dir = resolve_app_engine_dir();
  let node_bin = if cfg!(target_os = "windows") {
    engine_dir.join("node.exe")
  } else {
    engine_dir.join("node")
  };
  let script = engine_dir.join("dist-server").join("ragServer.mjs");

  // 1. AppData 내 설치된 엔진 확인
  if node_bin.exists() && script.exists() {
    return Some((node_bin, script, engine_dir));
  }

  // 2. 개발(Debug) 환경에서만 현재 작업 디렉토리의 dist-server 및 시스템 node 폴백
  #[cfg(debug_assertions)]
  {
    if let Ok(cwd) = std::env::current_dir() {
      let local_script = cwd.join("dist-server").join("ragServer.mjs");
      if local_script.exists() {
        if let Some(system_node) = find_system_node() {
          println!("[Tauri Sidecar] 🛠️ 개발 모드 로컬 엔진 사용: {:?}", local_script);
          return Some((system_node, local_script, cwd));
        }
      }
    }
  }

  // 3. 엔진 자동 스마트 인스톨러 시도 (로컬 아카이브 또는 온라인 다운로드)
  if ensure_engine_installed() && node_bin.exists() && script.exists() {
    return Some((node_bin, script, engine_dir));
  }

  // 4. 실행 바이너리 기준 로컬 워크스페이스 엔진 폴백
  if let Ok(exe_path) = std::env::current_exe() {
    if let Some(parent) = exe_path.parent() {
      let local_script = parent.join("dist-server").join("ragServer.mjs");
      if local_script.exists() {
        if let Some(system_node) = find_system_node() {
          println!("[Tauri Sidecar] 🛠️ 바이너리 인접 워크스페이스 엔진 사용: {:?}", local_script);
          return Some((system_node, local_script, parent.to_path_buf()));
        }
      }
    }
  }

  None
}

/**
 * 백엔드 서버 자식 프로세스 스폰
 */
fn spawn_backend() -> Option<Child> {
  let backend_port = resolve_backend_port();
  if is_port_open(backend_port) {
    println!(
      "[Tauri Sidecar] ⚡ 포트 {}에서 백엔드 서버가 이미 동작 중입니다. 기존 프로세스를 공유합니다.",
      backend_port
    );
    return None;
  }

  let (node_bin, server_script, working_dir) = match resolve_engine_paths() {
    Some(info) => info,
    None => {
      eprintln!("[Tauri Sidecar] ❌ 백엔드 실행 환경을 확보하지 못했습니다.");
      return None;
    }
  };

  println!(
    "[Tauri Sidecar] 🚀 백엔드 서버 시작: {:?} {:?}",
    node_bin, server_script
  );

  let mut cmd = Command::new(&node_bin);
  cmd.arg(&server_script)
    .current_dir(&working_dir)
    .env("NODE_ENV", "production")
    .env("PORT", backend_port.to_string())
    .stdout(Stdio::inherit())
    .stderr(Stdio::inherit());

  #[cfg(windows)]
  cmd.creation_flags(CREATE_NO_WINDOW);

  match cmd.spawn() {
    Ok(child) => {
      println!(
        "[Tauri Sidecar] ✅ 백엔드 서버가 시작되었습니다 (PID: {}).",
        child.id()
      );
      Some(child)
    }
    Err(e) => {
      eprintln!("[Tauri Sidecar] ❌ 백엔드 서버 실행 실패: {}", e);
      None
    }
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let child_holder: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
  let setup_child_holder = Arc::clone(&child_holder);
  let exit_child_holder = Arc::clone(&child_holder);

  tauri::Builder::default()
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // 백그라운드 스레드에서 엔진 점검 및 백엔드 스폰
      let holder = Arc::clone(&setup_child_holder);
      std::thread::spawn(move || {
        if let Some(child) = spawn_backend() {
          if let Ok(mut lock) = holder.lock() {
            *lock = Some(child);
          }
        }
      });

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(move |_app_handle, event| {
      if let RunEvent::Exit = event {
        if let Ok(mut lock) = exit_child_holder.lock() {
          if let Some(mut child) = lock.take() {
            println!(
              "[Tauri Sidecar] 🛑 앱 종료 감지: 백엔드 서버(PID: {})를 정리합니다.",
              child.id()
            );
            let _ = child.kill();
            let _ = child.wait();
            println!("[Tauri Sidecar] 백엔드 프로세스가 안전하게 종료되었습니다.");
          }
        }
      }
    });
}
