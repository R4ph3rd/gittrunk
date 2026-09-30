# CHECK: integration gate, CI loop and fixer for Android (M8)

- Agent: `checker`, model **opus**
- Runs twice:
  - **Phase 1 (M-A0 loop)**: after Wave 1 is merged and pushed; runs while Wave 2 builders work. Goal: Wave 1 integrated gate green and `Build Android` green (verified APK artifact).
  - **Phase 2 (final)**: after Wave 3 is merged. Goal: full gate, cross-package review, workflow review, desktop and compact checks, all CI workflows green.
- Branch/worktree: `fix/android-check-p1` (Phase 1), `fix/android-check-p2` (Phase 2), branched from the integration branch HEAD at that moment.
- Read first: `docs/dispatch/android/COMMON.md`, `docs/PLAN.md` §11, every brief in `docs/dispatch/android/` (they are the acceptance criteria), `docs/ANDROID_PLAN.md` §3, §5, §7, `docs/MOBILE_DESIGN.md` §1, §4.

## Fix policy

You fix small integration issues yourself (wiring, a missed import, a cfg gate, a workflow typo, a flaky assertion caused by integration, formatting). Anything larger, or anything that changes a contract (`src-tauri/src/ipc/**`, bindings, `registry.ts`/`nav.ts` shapes, design-system prop types), goes back as a failure report naming the owning package, file, failing command and a proposed fix. Commit fixes as `fix(<scope>): ...` with the COMMON.md trailers; never push.

Allowed edit scope in **Phase 1** (Wave 2 builders own `platform.rs`, `git/cli/embedded/{rebase,worktree,log}.rs`, `git/{history,advanced,remote}/tests.rs`, `release.yml`, `ci.yml`, rulesets, `scripts/check-version*`, docs, `src/app/**`, `src/features/{repo/Welcome,repo/RepoTabs,repo/StatusBar,repo/useOpenRepo,settings,ops}`, `src/stores/nav.ts` and the two contrib stubs, so do not touch those in Phase 1):
`.github/actions/build-android/**`, `.github/workflows/{build-android,android-init}.yml`, `scripts/android/**`, `src-tauri/gen/android/**`, `src-tauri/tauri.android.conf.json`, `src-tauri/Cargo.toml` + `Cargo.lock` (Android target tables, features), `src-tauri/build.rs`, `src-tauri/src/{lib.rs,mobile.rs,secrets.rs}`, `src-tauri/src/ai/provider.rs` (TLS branch), `src-tauri/src/git/remote/{native,net,ops,creds,validate}.rs`, `src-tauri/src/git/cli/{mod.rs,embedded/**}` except the three R1b-2 files.
Phase 2: any file, within the fix policy.

## Phase 1 steps

1. Integrated Rust gate (COMMON.md exports):

   ```bash
   cd <worktree>/src-tauri
   cargo fmt --all --check
   cargo clippy --all-targets -- -D warnings
   cargo clippy --all-targets --features embedded-git -- -D warnings
   cargo test
   cargo test --features embedded-git            # first time R1a + R1b-1 run together: expect pull/merge seams here
   cargo tree --target aarch64-linux-android -i keyring    # must not resolve
   cd .. && pnpm install --frozen-lockfile && pnpm bindings && git diff --exit-code src/ipc/bindings.ts
   pnpm lint && pnpm format:check && pnpm typecheck && pnpm test; echo "vitest exit=$?"
   node --test scripts/android/customize.test.mjs && node scripts/android/customize.mjs --check
   ```

2. If C1 reported the fallback path (no committed `gen/android`), ask the main session to run the `android-init` workflow on `claude/relaxed-allen-0mjwae` (input `commit=true`), pull its commit, then run `customize.mjs --check`.
3. CI loop on `Build Android` (see "Iterating on CI" below) until the `Android APK` job is green and the artifact contains exactly one APK that passed `apksigner` / `aapt2` checks. The `Android emulator smoke` job is non-blocking, but read its logcat and look at `smoke/screen.png`: report whether the app started, whether the webview rendered the UI (Welcome screen expected), and any `panicked at`, `FATAL EXCEPTION` or TLS verifier messages.
4. OpenSSL decision (ANDROID_PLAN §7 risk 1): if the vendored OpenSSL cross-build of `libgit2-sys`/`openssl-sys` still fails after 3 targeted attempts (env, `ANDROID_NDK_HOME`, toolchain PATH, perl), stop and report to the orchestrator with the logs; the fallback (reqwest-backed smart HTTP transport in `native.rs`, OpenSSL removed from the Android table) is a separate dispatch, not a checker fix.
5. Report: gate table, CI run URLs and conclusions, fixes committed, open issues per owner.

## Phase 2 steps

1. Full gate (Rust both feature sets, bindings drift, frontend, `node --test "scripts/**/*.test.mjs"`, `node scripts/android/customize.mjs --check`), then `pnpm vite build`.
2. Cross-package integration review (read the code, not only the tests):
   - IPC: `src/ipc/bindings.ts` is regenerated and unchanged by any non-R0 package; every UI use of `platformInfo`, `appExit`, `gitIdentityGet/Set`, `repoDelete`, `credentialStore` matches the Rust signatures; `ErrorKind` `"unsupported"` is displayed sensibly (not as an internal error).
   - Capabilities: UI gates on `usePlatform()` flags, never on `navigator.userAgent` outside `src/app/platform.ts` and never on layout: grep for `canPickFolder`, `hasGitCli`, `supportsSsh`, `supportsRebase`, `supportsInteractiveRebase`, `supportsWorktrees`, `supportsSubmodules`, `supportsFileHistory` and confirm each has a consumer (Welcome/switcher, settings git path and identity, clone and credential prompts, action entries, history-views sections, pull strategy). With `platformInfo` mocked as Android at a regular viewport (tablet), the gated items are still hidden.
   - Rust capability constants in `platform.rs` agree with what the shim actually supports (R1b-2 flips are backed by passing tests).
   - Layout: structure branches use `useLayout()`; no CSS `hidden` used to switch between desktop and mobile trees; S0 query strings equal `src/index.css` (test exists).
   - Navigation: `stagingScreens` and `repoScreens` cover `changes`, `history`, `branches` and every `Route` name; no route falls back to `NotAvailableScreen`; back order Sheet -> pop -> History -> exit toast -> `appExit`.
   - Secrets: no secret value is logged or sent to the webview (grep `secrets.rs`, `native.rs`, `creds.rs`); secrets file 0600.
3. Desktop unchanged at 1400x900:
   - Full Vitest suite at default viewport and `App.test.tsx` untouched.
   - `git diff <pre-M8 base>..HEAD -- src/design/components src/features` review: existing components only gained `coarse:`/`compact:` classes or `isCompact` branches.
   - e2e: `pnpm tauri build --debug --no-bundle && xvfb-run -a -s "-screen 0 1400x900x24" pnpm e2e` (uses the COMMON.md cargo exports; if disk is too tight, say so and rely on CI's `E2E tests` job).
   - `cargo test` desktop and the Windows `Build Windows` workflow green.
4. Compact at 390x844:
   - Mobile tests in `src/design/components/mobile.test.tsx`, `src/app/layout/*.test.tsx`, `src/features/**/mobile/*.test.tsx` green.
   - A manual render check if a headless browser exists (`which chromium chromium-browser google-chrome`): `pnpm dev`, open `/design` and the app at 390x844, screenshot; otherwise rely on the emulator smoke screenshot from CI and say so.
5. Workflow review (`build-android.yml`, `android-init.yml`, `.github/actions/build-android/action.yml`, `release.yml`, `ci.yml`), actionlint-style:
   - Syntax and expressions: every composite `run` step has `shell: bash`; composite actions read `inputs.*` and never the `secrets` context; `needs`/`if` references exist; outputs wired (`steps.<id>.outputs`); job names exactly `Android APK` (PR check) and `Android release APK` (release); ruleset context matches.
   - Secrets: never echoed, never in `set -x` sections, generated passwords `::add-mask::`ed before use, keystore and `keystore.properties` deleted at the end, dev builds never reference `secrets.*`, release hard-fails with names (not values) of missing secrets.
   - Toolchain parity: Node 22 + `corepack enable` + `COREPACK_ENABLE_DOWNLOAD_PROMPT: "0"` + pnpm store cache + `pnpm install --frozen-lockfile` identical to `build-windows.yml`; same action major versions as the other workflows.
   - Android env on ubuntu runners: `ANDROID_HOME` preset; `NDK_HOME`/`ANDROID_NDK_HOME`/`ANDROID_NDK_ROOT` from `ANDROID_NDK_LATEST_HOME`, NDK toolchain on `PATH`; rust targets match ABIs; Java 17.
   - Caching: pnpm store, `Swatinem/rust-cache` keyed by ABIs/LTO, Gradle via `setup-java`; no cache of signing material.
   - Permissions minimal (`contents: read` for builds; `contents: write` only in `android-init` and release); `android-init` refuses `main` and commits as `R4ph3rd <43202876+R4ph3rd@users.noreply.github.com>` with the two trailers.
   - `release.yml`: `verify` includes `build-android.yml`; `android` job needs `build`; `publish` needs `android` and checks `_android-universal\.apk$`.
6. CI: after the main session pushes, `CI` (both OS legs incl. the new embedded-git steps), `E2E tests`, `Build Windows`, `Build Android` green; inspect the smoke job.
7. Report (below), including a PASS/FAIL per package brief acceptance list.

## Iterating on CI

You cannot push. The loop is:

1. Commit your fix in your worktree; tell the main session "ready: <commit>" with what it should watch.
2. The main session merges, pushes to `claude/relaxed-allen-0mjwae`, and relays the run: it uses the GitHub MCP tools (`actions_list` / `list_workflow_runs` for `build-android.yml` filtered by branch and head SHA, then `get_job_logs` with `failed_only: true` and `return_content: true`, `tail_lines` around 300) and pastes the failing step's log to you. If you have those tools yourself, use them directly (repo owner/name from `git remote get-url origin`).
3. Read the first error, not the last; classify and fix. Typical first-run failures and where to fix:
   - `--target` syntax or APK path glob wrong -> composite action (use the logged `--help` output).
   - `openssl-src` / `libgit2-sys` cross-compile (missing `ANDROID_NDK_HOME`, clang not on PATH, perl modules) -> env step in the action; see step 4 of Phase 1 for the fallback threshold.
   - Rust compile errors only on Android (`keyring` referenced, `cfg(mobile)` code, `set_ssl_cert_*` names, `webpki-roots` / rustls version mismatch) -> the owning Rust file, cfg-gated.
   - Gradle: missing SDK platform/build-tools (install with `sdkmanager`, guarded), JDK version, AGP/Kotlin plugin resolution (maven.google.com), signing config not found (`keystore.properties` path).
   - Verification: `apksigner`/`aapt2` not found (use the newest `$ANDROID_HOME/build-tools/*`), unexpected `-unsigned.apk`.
   - Smoke: KVM permission, emulator boot timeout (raise `emulator-boot-timeout`), app crash (read logcat for the Rust panic or JNI error).
4. One hypothesis per push; say in the report which runs you consumed and what each changed.

## Report back

1. Gate table (command, exit code) for the phase.
2. CI runs (workflow, run id/URL, conclusion), and for Phase 1 the APK name, size and ABIs.
3. Fixes you committed (hash, one line each).
4. Failures returned to owners (package, file, command, proposed fix).
5. Smoke findings (started? UI rendered? screenshot description).
6. Release readiness: what the maintainer must still do (keystore + 4 secrets, ruleset re-import), and whether M-A0..M-A2 in `docs/PLAN.md` §11 are met.
