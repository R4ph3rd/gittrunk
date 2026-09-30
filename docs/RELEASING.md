# Releasing gittrunk

Releases are produced only by the **Release** workflow (`.github/workflows/release.yml`), from a clean commit on `main` whose `CI` and `Build Windows` runs both passed.

## Cutting a release

1. Bump the version everywhere (no leading `v`):
   ```sh
   node scripts/bump-version.mjs 0.2.0
   cargo update -p gittrunk --manifest-path src-tauri/Cargo.toml   # refresh Cargo.lock
   ```
2. Commit (`chore(release): 0.2.0`), open a PR into `main`, and merge it.
3. Wait for the `CI` and `Build Windows` workflows to go green on the merge commit.
4. Actions → **Release** → **Run workflow**, branch `main`, enter the version (`0.2.0`).

Pushing a `v0.2.0` tag is also accepted, but only if the tagged commit is on `main`.

## What the workflow does

1. **verify**: refuses to run off `main`, validates the semver input, runs `node scripts/check-version.mjs <version>` (`package.json`, `tauri.conf.json` and `Cargo.toml` must all match), and requires a successful `CI` run and a successful `Build Windows` run for the exact commit (checked with `gh run list --commit`). It also refuses to touch an already published release.
2. **build**: Windows (NSIS + MSI), macOS (universal DMG/app), Linux (deb, rpm, AppImage). Each leg uploads to a **draft** release `gittrunk v<version>` with tag `v<version>` at the released commit.
3. **publish**: runs only if every build leg succeeded, checks that the expected assets exist (`*_x64-setup.exe`, `*_x64_en-US.msi`, `.dmg` or `.app.tar.gz`, `.deb`, `.rpm`, `.AppImage`) and then publishes the draft as the latest release. If any leg fails the draft stays unpublished; delete it or re-run the workflow.

## Code signing

Signing is automatic when secrets exist; otherwise the build is unsigned and the job log shows a single notice.

### Windows

Repository secrets:

- `WINDOWS_CERTIFICATE`: the `.pfx` file, base64-encoded (`[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))`)
- `WINDOWS_CERTIFICATE_PASSWORD`: its password

The workflow imports the certificate into the runner's store, writes a Tauri config override with `certificateThumbprint`, `digestAlgorithm: sha256` and `timestampUrl: http://timestamp.digicert.com`, builds with `--config`, and then checks every `.exe` and `.msi` with `Get-AuthenticodeSignature`, failing unless the status is `Valid`. Because verification runs after upload, a failure leaves the release as an unpublished draft.

To test the pipeline, `scripts/new-test-certificate.ps1` creates a self-signed certificate and base64 PFX plus password. It is **not trusted** by Windows or SmartScreen, so the `Valid` check will fail with it; use it only to exercise import and signing, never for real releases. Never commit the output (`test-cert/` is git-ignored).

### macOS

Secrets (Tauri reads these natively): `APPLE_CERTIFICATE` (base64 `.p12`), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`. For notarization also add `APPLE_ID`, `APPLE_PASSWORD` (app-specific password) and `APPLE_TEAM_ID`. Without them macOS builds are unsigned and Gatekeeper warns on first launch.

## What users see when unsigned

- Windows: SmartScreen shows "Windows protected your PC" with publisher "Unknown"; users choose **More info → Run anyway**.
- macOS: Gatekeeper reports the app cannot be verified; users must right-click → Open or allow it in System Settings → Privacy & Security.
- Linux: no signing prompts.

## Getting a trusted Windows certificate

- **OV code-signing certificate** from a CA: cheaper, but SmartScreen reputation builds slowly.
- **EV code-signing certificate**: immediate SmartScreen reputation, but keys live on a hardware token or cloud HSM, which needs a different signing flow (custom sign command) than a PFX.
- **Azure Trusted Signing**: inexpensive, no hardware token, works from CI via a Tauri `signCommand`. Requires an eligible Azure identity validation.
- **SignPath Foundation**: free code signing for qualifying open source projects, integrates with GitHub Actions.

The PFX path above suits OV certificates; the other options need a `bundle.windows.signCommand` and a workflow change.
