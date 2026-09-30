// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = gittrunk_lib::askpass::maybe_run() {
        std::process::exit(code);
    }
    gittrunk_lib::run()
}
