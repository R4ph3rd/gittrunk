#!/usr/bin/env bash
# Emulator smoke test: install the APK from apk/ (or $1), launch the app, and
# fail if the process dies or logcat shows a crash. Writes smoke/screen.png and
# smoke/logcat.txt. Run inside an emulator session (adb device available).
set -euo pipefail

PKG=dev.gittrunk.client
APK="${1:-}"
if [ -z "$APK" ]; then
  shopt -s nullglob
  apks=(apk/gittrunk_*_android-*.apk)
  if [ "${#apks[@]}" -ne 1 ]; then
    echo "expected exactly one apk/gittrunk_*_android-*.apk, found ${#apks[@]}" >&2
    exit 1
  fi
  APK="${apks[0]}"
fi

mkdir -p smoke
adb logcat -c || true
adb install -r "$APK"
adb shell am start -n "$PKG/.MainActivity"

pid=""
for _ in $(seq 1 30); do
  pid="$(adb shell pidof "$PKG" | tr -d '\r' || true)"
  [ -n "$pid" ] && break
  sleep 1
done

sleep 10
adb exec-out screencap -p > smoke/screen.png || true
adb logcat -d > smoke/logcat.txt || true

status=0
if [ -z "$pid" ]; then
  echo "app process never started" >&2
  status=1
elif [ -z "$(adb shell pidof "$PKG" | tr -d '\r' || true)" ]; then
  echo "app process died after start" >&2
  status=1
fi
# Show Rust output and crash context so the job log carries the full message.
grep -E "RustStdoutStderr|AndroidRuntime" smoke/logcat.txt | tail -n 60 || true
grep -E "gittrunk: (mobile init failed|no app data dir)" smoke/logcat.txt && status=1
if grep -E -A8 "FATAL EXCEPTION|panicked at|rustls-platform-verifier" smoke/logcat.txt; then
  echo "crash markers found in logcat" >&2
  status=1
fi
exit "$status"
