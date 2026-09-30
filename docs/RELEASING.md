# Releasing gittrunk

Releases are produced only by the **Release** workflow (`.github/workflows/release.yml`), from a clean commit on `main` whose `CI`, `Build Windows` and `Build Android` runs all passed.

## Cutting a release

1. Bump the version everywhere (no leading `v`):
   ```sh
   node scripts/bump-version.mjs 0.2.0
   cargo update -p gittrunk --manifest-path src-tauri/Cargo.toml   # refresh Cargo.lock
   ```
2. Commit (`chore(release): 0.2.0`), open a PR into `main`, and merge it.
3. Wait for the `CI`, `Build Windows` and `Build Android` workflows to go green on the merge commit.
4. Actions → **Release** → **Run workflow**, branch `main`, enter the version (`0.2.0`).

Pushing a `v0.2.0` tag is also accepted, but only if the tagged commit is on `main`.

## What the workflow does

1. **verify**: refuses to run off `main`, validates the semver input, runs `node scripts/check-version.mjs <version>` (`package.json`, `tauri.conf.json` and `Cargo.toml` must all match; minor and patch must also be below 1000 because Tauri derives the Android `versionCode` as `major*1000000 + minor*1000 + patch`), and requires a successful `CI`, `Build Windows` and `Build Android` run for the exact commit (checked with `gh run list --commit`). It also refuses to touch an already published release, and deletes a stale draft left by an earlier failed run.
2. **build**: Windows (NSIS + MSI), macOS (universal DMG/app), Linux (deb, rpm, AppImage). Each leg uploads to a **draft** release `gittrunk v<version>` with tag `v<version>` at the released commit.
3. **android** (`Android release APK`): runs after `build` succeeded, builds the universal APK (arm64-v8a, armeabi-v7a, x86_64), signs it (see below) and uploads `gittrunk_<version>_android-universal.apk` to the draft with `gh release upload --clobber`.
4. **publish**: runs only if every build leg and the Android job succeeded, checks that the expected assets exist (`*_x64-setup.exe`, `*_x64_en-US.msi`, `.dmg` or `.app.tar.gz`, `.deb`, `.rpm`, `.AppImage`, `_android-universal.apk`) and then publishes the draft as the latest release. If any leg fails the draft stays unpublished; running the workflow again deletes that stale draft and rebuilds every platform from the current commit.

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

### Android

Repository secrets (all four, or none):

- `ANDROID_KEYSTORE`: the `.jks` keystore, base64-encoded on a single line (`base64 -w0 release.jks`)
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password
- `ANDROID_KEY_ALIAS`: the key alias
- `ANDROID_KEY_PASSWORD`: the key password

Create the keystore once:

```sh
keytool -genkeypair -v -keystore release.jks -alias gittrunk -keyalg RSA -keysize 4096 -validity 10000
```

Consider storing the four secrets in an `android-release` environment (Settings -> Environments) with required reviewers, and adding `environment: android-release` to the `android` job, so only approved runs can read the signing key.

**Key custody.** Android only installs an update if it is signed with the same key as the installed app. If the keystore or its passwords are lost, users can never update in place: they must uninstall and reinstall, losing app data. Keep offline backups of the `.jks` and the passwords in a password manager. Never commit them.

Behavior of the `android` job:

- All four secrets present: the APK is signed with that key and verified with `apksigner`.
- None present: same policy as unsigned Windows/macOS builds. The APK is signed with a throwaway key generated for that build, the job log shows a `::notice::` saying so, and the release still publishes. Such an APK installs but cannot be updated in place; users must uninstall first.
- Some but not all present: the job fails with an `::error::` naming the missing secrets (a half-configured key is treated as a mistake, not as permission to ship a throwaway key). Desktop legs are unaffected but `publish` does not run; fix the secrets and run the workflow again, which deletes the stale draft and rebuilds.

The action fails the job if the built APK is missing, has the wrong package name or `minSdk`, or lacks one native library per ABI, so a broken Android build also blocks `publish`.

## What users see when unsigned

- Windows: SmartScreen shows "Windows protected your PC" with publisher "Unknown"; users choose **More info → Run anyway**.
- macOS: Gatekeeper reports the app cannot be verified; users must right-click → Open or allow it in System Settings → Privacy & Security.
- Linux: no signing prompts.
- Android (throwaway key): installs normally, but updating requires uninstalling first.

## Getting a trusted Windows certificate

- **OV code-signing certificate** from a CA: cheaper, but SmartScreen reputation builds slowly.
- **EV code-signing certificate**: immediate SmartScreen reputation, but keys live on a hardware token or cloud HSM, which needs a different signing flow (custom sign command) than a PFX.
- **Azure Trusted Signing**: inexpensive, no hardware token, works from CI via a Tauri `signCommand`. Requires an eligible Azure identity validation.
- **SignPath Foundation**: free code signing for qualifying open source projects, integrates with GitHub Actions.

The PFX path above suits OV certificates; the other options need a `bundle.windows.signCommand` and a workflow change.

## Protecting main

The ruleset file `.github/rulesets/main-protection.json` enforces branch protection on `main` and can be imported by the repository owner:

1. Go to Settings → Rules → Rulesets
2. Click **New ruleset** ▾ → **Import a ruleset**
3. Select the file `.github/rulesets/main-protection.json`
4. Click **Create**

The ruleset enforces:

- No deletion of the branch and no force-pushes
- Linear history: changes land through a pull request, merged by squash or rebase
- All pull request conversations must be resolved before merging
- Five required status checks must pass and be up to date with `main`:
  - `Checks (ubuntu-24.04)` — from CI
  - `Checks (windows-latest)` — from CI
  - `E2E tests` — from CI
  - `build` — from Build Windows
  - `Android APK` — from Build Android (the `Android emulator smoke` job is not required)

Admins can bypass rules only via pull request. The Release workflow reads only from `main` and does not push to it, so it is unaffected by these protections.
