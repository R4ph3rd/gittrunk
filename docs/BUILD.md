# Building gittrunk for Windows

This produces:

| Artifact       | Path                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| Portable app   | `src-tauri/target/release/gittrunk.exe`                                 |
| NSIS installer | `src-tauri/target/release/bundle/nsis/gittrunk_<version>_x64-setup.exe` |
| MSI installer  | `src-tauri/target/release/bundle/msi/gittrunk_<version>_x64_en-US.msi`  |

## Option A: GitHub Actions (no local setup)

Workflows in `.github/workflows/`:

- **Build Windows** (`build-windows.yml`) runs on pushes to `main`, `develop`, `claude/**`, `feat/**`, on pull requests into `main`, and on demand (Actions tab → Build Windows → Run workflow). It uploads an artifact named `gittrunk-windows-<sha>` with the `.exe`, the NSIS installer and the MSI.
- **Release** (`release.yml`) runs when a `v*` tag is pushed. The tag must point at a commit on `main`. It builds Windows, macOS (universal) and Linux installers and attaches them to a **draft** GitHub Release. Review the draft, then publish it.

```sh
git checkout main && git pull
git tag v0.1.0
git push origin v0.1.0
```

Repository settings needed once:

1. **Settings → Actions → General → Actions permissions**: allow all actions (or allow GitHub-authored plus `pnpm/action-setup`, `dtolnay/rust-toolchain`, `Swatinem/rust-cache`, `tauri-apps/tauri-action`).
2. **Settings → Actions → General → Workflow permissions**: the release job requests `contents: write` itself, so the default read-only setting is fine.
3. Recommended: **Settings → Branches** → add a protection rule for `main` requiring the `CI` checks and `Build Windows` to pass before merging.

## Option B: a fresh Windows 10/11 machine

1. **Microsoft C++ Build Tools**: install [Visual Studio Build Tools 2022](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **Desktop development with C++** workload (MSVC v143 and a Windows 10/11 SDK).
2. **WebView2**: preinstalled on Windows 10 (1803+) and 11. If it is missing, install the Evergreen Bootstrapper from Microsoft.
3. **Rust**: install [rustup](https://rustup.rs), then in a new terminal:
   ```powershell
   rustup default stable-msvc
   ```
4. **Node.js 22 LTS** from [nodejs.org](https://nodejs.org), then enable pnpm:
   ```powershell
   corepack enable
   ```
5. **Git for Windows** from [git-scm.com](https://git-scm.com) (gittrunk shells out to `git` for network operations).
6. Build:
   ```powershell
   git clone https://github.com/R4ph3rd/gittrunk.git
   cd gittrunk
   pnpm install
   pnpm tauri build --bundles nsis,msi
   ```

Tauri downloads NSIS and WiX Toolset automatically on the first build. The MSI step needs the VBSCRIPT Windows feature (Settings → System → Optional features), which is on by default.

## Installer behavior

- The NSIS installer installs per user (no admin prompt) and downloads WebView2 if it is missing.
- Installers are **unsigned**, so Windows SmartScreen shows a warning on first run. To sign:
  1. Add repository secrets `WINDOWS_CERTIFICATE` (base64-encoded `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD`.
  2. Import the certificate in the workflow before `tauri-action` and set `bundle.windows.certificateThumbprint`, `digestAlgorithm: "sha256"` and `timestampUrl` in `src-tauri/tauri.conf.json`. See the [Tauri Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).

## End-to-end tests

The `e2e/` directory contains integration tests that drive the real app through its WebDriver interface using `tauri-driver`.

Prerequisites:

- `tauri-driver` (install with `cargo install tauri-driver --locked`)
- WebDriver for the platform:
  - **Linux**: `webkit2gtk-driver` (install from package manager)
  - **Windows**: `msedgedriver` (download from Microsoft Edge WebDriver, or included in Chromium-based testing tools)
- A debug build: `pnpm tauri build --debug --no-bundle`
- On **headless Linux**: `xvfb` (virtual display)

Run the e2e tests:

```sh
pnpm tauri build --debug --no-bundle
pnpm e2e                                      # on a display with WebDriver
xvfb-run -a pnpm e2e                         # on headless Linux
```

Failed test screenshots are saved to `e2e/artifacts/`.

## Troubleshooting

| Symptom                                             | Fix                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `link.exe not found`                                | Install the C++ workload from step 1 and reopen the terminal.                                |
| `failed to bundle project: error running light.exe` | Enable the VBSCRIPT optional feature, or build NSIS only: `pnpm tauri build --bundles nsis`. |
| Frontend changes missing from the build             | `pnpm tauri build` runs `pnpm build` first. Delete `dist/` and rebuild if in doubt.          |
