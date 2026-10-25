fn main() {
  println!("cargo:rerun-if-changed=../.env");
  if let Ok(content) = std::fs::read_to_string("../.env") {
    for line in content.lines() {
      let trimmed = line.trim();
      if trimmed.starts_with('#') || trimmed.is_empty() {
        continue;
      }
      if let Some((k, v)) = trimmed.split_once('=') {
        let key = k.trim();
        let val = v.trim();
        if key == "DEV_PORT" || key == "PROD_PORT" {
          println!("cargo:rustc-env={}={}", key, val);
        }
      }
    }
  }
  tauri_build::build()
}
