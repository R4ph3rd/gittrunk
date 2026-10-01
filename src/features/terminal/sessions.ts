import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { commands, events } from "@/ipc/bindings";
import { unwrap } from "@/ipc/client";
import { onThemeChange } from "@/features/graph/colors";
import { useRepoStore } from "@/stores/repo";
import { readTerminalFont, readTerminalTheme, subtleSgr } from "./theme";

export interface Session {
  repoId: string;
  cwd: string;
  /** Backend PTY id, null while not running. */
  id: string | null;
  term: Terminal;
  fit: FitAddon;
  host: HTMLDivElement;
  exited: boolean;
  /** `term.open(host)` was called. */
  opened: boolean;
  opening: boolean;
  error: string | null;
  cols: number;
  rows: number;
  /** Bumped on every state change the UI renders. */
  version: number;
  listeners: Set<() => void>;
}

const sessions = new Map<string, Session>();
/** Output/exit that arrived before `terminalOpen` resolved (id not yet known). */
const orphanOutput = new Map<string, string[]>();
const orphanExit = new Map<string, number | null>();
const ORPHAN_LIMIT = 16;
let installed = false;

function touch(s: Session) {
  s.version++;
  for (const l of [...s.listeners]) l();
}

function byId(id: string): Session | undefined {
  for (const s of sessions.values()) if (s.id === id) return s;
  return undefined;
}

function remember<T>(map: Map<string, T>, id: string, value: T) {
  if (!map.has(id) && map.size >= ORPHAN_LIMIT) map.delete(map.keys().next().value as string);
  map.set(id, value);
}

function handleOutput(id: string, data: string) {
  const s = byId(id);
  if (s) s.term.write(data);
  else remember(orphanOutput, id, [...(orphanOutput.get(id) ?? []), data]);
}

function markExited(s: Session, message: string) {
  s.exited = true;
  s.id = null;
  s.term.write(`\r\n${subtleSgr()}${message}\x1b[0m\r\n`);
  touch(s);
}

const exitMessage = (code: number | null) =>
  `[process exited with code ${code ?? "?"}; press Enter to restart]`;

function handleExit(id: string, code: number | null) {
  const s = byId(id);
  if (s) markExited(s, exitMessage(code));
  else remember(orphanExit, id, code);
}

function install() {
  if (installed) return;
  installed = true;
  void events.terminalOutput.listen((e) => handleOutput(e.payload.id, e.payload.data));
  void events.terminalExit.listen((e) => handleExit(e.payload.id, e.payload.code));
  onThemeChange(() => {
    const theme = readTerminalTheme();
    for (const s of sessions.values()) s.term.options.theme = theme;
  });
  let known = new Set(useRepoStore.getState().repos.map((r) => r.id));
  useRepoStore.subscribe((state) => {
    const now = new Set(state.repos.map((r) => r.id));
    for (const id of known) if (!now.has(id)) disposeSession(id);
    known = now;
  });
}

export function getSession(repoId: string, cwd: string): Session {
  install();
  const existing = sessions.get(repoId);
  if (existing) return existing;
  const term = new Terminal({
    ...readTerminalFont(),
    theme: readTerminalTheme(),
    cursorBlink: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const host = document.createElement("div");
  host.className = "h-full w-full";
  host.dataset.testid = "terminal-host";
  const s: Session = {
    repoId,
    cwd,
    id: null,
    term,
    fit,
    host,
    exited: false,
    opened: false,
    opening: false,
    error: null,
    cols: 0,
    rows: 0,
    version: 0,
    listeners: new Set(),
  };
  term.onData((data) => {
    if (s.id && !s.exited) {
      void commands.terminalWrite(s.id, data);
    } else if (s.exited && !s.opening && (data === "\r" || data === "\n")) {
      void openBackend(s);
    }
  });
  sessions.set(repoId, s);
  return s;
}

/** Opens xterm on the host once (the host must already be attached to the document). */
export function ensureOpened(s: Session) {
  if (s.opened) return;
  s.term.open(s.host);
  s.opened = true;
}

/** Fits to the container and tells the backend when the size changed. */
export function syncSize(s: Session) {
  try {
    s.fit.fit();
  } catch {
    return;
  }
  const { cols, rows } = s.term;
  if (cols === s.cols && rows === s.rows) return;
  s.cols = cols;
  s.rows = rows;
  if (s.id) void commands.terminalResize(s.id, cols, rows);
}

export async function openBackend(s: Session) {
  if (s.opening || s.id) return;
  s.opening = true;
  s.error = null;
  touch(s);
  syncSize(s);
  const { cols, rows } = s.term;
  s.cols = cols;
  s.rows = rows;
  try {
    const id = await unwrap(commands.terminalOpen({ cwd: s.cwd, cols, rows }));
    s.id = id;
    s.exited = false;
    const pending = orphanOutput.get(id);
    orphanOutput.delete(id);
    for (const chunk of pending ?? []) s.term.write(chunk);
    if (orphanExit.has(id)) {
      const code = orphanExit.get(id) ?? null;
      orphanExit.delete(id);
      markExited(s, exitMessage(code));
    }
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  } finally {
    s.opening = false;
    touch(s);
  }
}

async function closeBackend(s: Session) {
  const id = s.id;
  s.id = null;
  if (id) await commands.terminalClose(id);
}

/** Closes the running process and starts a fresh one. */
export async function restartSession(s: Session) {
  await closeBackend(s);
  s.exited = false;
  s.term.reset();
  await openBackend(s);
}

/** Kills the process; the terminal stays so Enter restarts it. */
export async function killSession(s: Session) {
  if (!s.id) return;
  await closeBackend(s);
  markExited(s, "[terminal killed; press Enter to restart]");
}

export function disposeSession(repoId: string) {
  const s = sessions.get(repoId);
  if (!s) return;
  sessions.delete(repoId);
  void closeBackend(s);
  s.term.dispose();
  s.host.remove();
  s.listeners.clear();
}

export function subscribeSession(s: Session, cb: () => void): () => void {
  s.listeners.add(cb);
  return () => s.listeners.delete(cb);
}
