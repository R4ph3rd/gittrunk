//! Writes `src/ipc/bindings.ts` without launching the app. Used by CI drift checks.

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| gittrunk_lib::ipc::BINDINGS_PATH.to_string());
    gittrunk_lib::ipc::export_bindings(&gittrunk_lib::ipc::builder(), &path);
    println!("wrote {path}");
}
