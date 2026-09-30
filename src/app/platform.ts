import type { PlatformInfo } from "@/ipc/bindings";
import { usePlatformInfo } from "@/ipc/queries";

/** Capabilities of the desktop build (git CLI available, everything supported). */
export const DESKTOP_PLATFORM: PlatformInfo = {
  os: "linux",
  mobile: false,
  hasGitCli: true,
  canPickFolder: true,
  supportsSsh: true,
  supportsExternalEditor: true,
  supportsRebase: true,
  supportsInteractiveRebase: true,
  supportsWorktrees: true,
  supportsSubmodules: true,
  supportsFileHistory: true,
  supportsHooks: true,
  secretStore: "keychain",
  defaultReposDir: null,
};

/** Capabilities of the Android build (embedded libgit2, no git CLI). */
export const ANDROID_PLATFORM: PlatformInfo = {
  os: "android",
  mobile: true,
  hasGitCli: false,
  canPickFolder: false,
  supportsSsh: false,
  supportsExternalEditor: false,
  supportsRebase: false,
  supportsInteractiveRebase: false,
  supportsWorktrees: false,
  supportsSubmodules: false,
  supportsFileHistory: false,
  supportsHooks: false,
  secretStore: "file",
  defaultReposDir: null,
};

/** Guess used until the backend answers (and if it never does). */
export function fallbackPlatform(userAgent?: string): PlatformInfo {
  return userAgent?.includes("Android") ? ANDROID_PLATFORM : DESKTOP_PLATFORM;
}

/** Capability flags. Never throws and never suspends. Layout comes from `useLayout()`, not here. */
export function usePlatform(): PlatformInfo {
  const { data } = usePlatformInfo();
  return (
    data ?? fallbackPlatform(typeof navigator === "undefined" ? undefined : navigator.userAgent)
  );
}
