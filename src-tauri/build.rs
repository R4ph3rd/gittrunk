fn main() {
    println!("cargo::rustc-check-cfg=cfg(embedded_git)");
    let android = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|v| v == "android");
    if android || std::env::var_os("CARGO_FEATURE_EMBEDDED_GIT").is_some() {
        println!("cargo::rustc-cfg=embedded_git");
    }
    tauri_build::build()
}
