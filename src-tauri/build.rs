fn main() {
    println!("cargo::rustc-check-cfg=cfg(embedded_git)");
    let android = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|v| v == "android");
    if android || std::env::var_os("CARGO_FEATURE_EMBEDDED_GIT").is_some() {
        println!("cargo::rustc-cfg=embedded_git");
    }

    // Windows: the app needs the Common Controls v6 manifest (dialogs use
    // TaskDialogIndirect). tauri-build only embeds it into the app binary, so
    // `cargo test` binaries that link the Tauri runtime fail to start with
    // STATUS_ENTRYPOINT_NOT_FOUND. Embed the same manifest through the linker
    // into every binary instead, tests included.
    let windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|v| v == "windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").is_ok_and(|v| v == "msvc");
    if windows_msvc {
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo::rerun-if-changed={}", manifest.display());
        println!("cargo::rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo::rustc-link-arg=/MANIFESTINPUT:{}",
            manifest.display()
        );
        let attrs = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attrs).expect("tauri-build failed");
    } else {
        tauri_build::build();
    }
}
