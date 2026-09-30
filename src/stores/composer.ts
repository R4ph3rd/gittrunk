import { create } from "zustand";

/** Commit message draft of one repository. */
export interface Draft {
  summary: string;
  body: string;
  amend: boolean;
  signOff: boolean;
  /** Message typed before "Amend" was switched on; restored when it is switched off. */
  saved: { summary: string; body: string } | null;
  /** HEAD commit whose message was pre-filled for the current amend (avoids overwriting edits). */
  amendOid: string | null;
}

export const EMPTY_DRAFT: Draft = {
  summary: "",
  body: "",
  amend: false,
  signOff: false,
  saved: null,
  amendOid: null,
};

const KEY = "gittrunk:composer-drafts";

type Drafts = Record<string, Draft>;

function load(): Drafts {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Drafts) : {};
  } catch {
    return {};
  }
}

function save(drafts: Drafts) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(drafts));
  } catch {
    /* storage unavailable: the draft still survives in memory */
  }
}

interface ComposerState {
  drafts: Drafts;
  /** Merges `patch` into the draft of `repoId`. */
  update(repoId: string, patch: Partial<Draft>): void;
  /** Turns amend on (keeping the current message aside) or off (restoring it). */
  setAmend(repoId: string, on: boolean): void;
  clear(repoId: string): void;
  reset(): void;
}

/** Per-repo commit drafts: back-navigation and app restarts do not lose typed text. */
export const useComposerStore = create<ComposerState>((set, get) => {
  const commit = (drafts: Drafts) => {
    save(drafts);
    set({ drafts });
  };
  return {
    drafts: load(),
    update: (repoId, patch) => {
      const cur = get().drafts[repoId] ?? EMPTY_DRAFT;
      commit({ ...get().drafts, [repoId]: { ...cur, ...patch } });
    },
    setAmend: (repoId, on) => {
      const cur = get().drafts[repoId] ?? EMPTY_DRAFT;
      if (on === cur.amend) return;
      const next: Draft = on
        ? { ...cur, amend: true, saved: { summary: cur.summary, body: cur.body } }
        : {
            ...cur,
            amend: false,
            summary: cur.saved?.summary ?? cur.summary,
            body: cur.saved?.body ?? cur.body,
            saved: null,
            amendOid: null,
          };
      commit({ ...get().drafts, [repoId]: next });
    },
    clear: (repoId) => {
      const drafts = { ...get().drafts };
      delete drafts[repoId];
      commit(drafts);
    },
    reset: () => commit({}),
  };
});

/** The draft of a repository (`EMPTY_DRAFT` when there is none). */
export function useDraft(repoId: string): Draft {
  return useComposerStore((s) => s.drafts[repoId]) ?? EMPTY_DRAFT;
}
