/* Dev-only fixtures for the /preview route. Deterministic: no randomness, no clock. */
import type {
  BranchInfo,
  CommitDetails,
  FileChange,
  FileDiff,
  ForgeComment,
  ForgeNotification,
  ForgePull,
  ForgeRepo,
  GraphEdge,
  GraphMeta,
  GraphRow,
  Hunk,
  Issue,
  IssueDetail,
  KnownRepo,
  OplogEntry,
  OplogState,
  PullDetail,
  RefColor,
  RefLabel,
  RefsSnapshot,
  RepoInfo,
  SshKey,
  SshKeyList,
  StatusSnapshot,
} from "@/ipc/bindings";

const at = <T>(arr: readonly T[], i: number): T => {
  const v = arr[i];
  if (v === undefined) throw new Error(`fixture index ${i} out of range (${arr.length})`);
  return v;
};

export const ROW_COUNT = 300;
/** Newest commit time; older rows step back by about 90 minutes. */
const NEWEST = 1_760_000_000;

export function oidOf(n: number): string {
  // Deterministic 40-hex id that looks like a hash (multiplicative mixing).
  let x = (n + 1) * 2654435761;
  let out = "";
  for (let i = 0; i < 5; i++) {
    x = (Math.imul(x ^ (x >>> 13), 1274126177) ^ (n * 40503 + i * 9973)) >>> 0;
    out += x.toString(16).padStart(8, "0");
  }
  return out;
}

export interface Author {
  name: string;
  email: string;
  login: string;
  /** Half of the authors have an avatar; the rest fall back to initials. */
  avatar: boolean;
}

export const AUTHORS: Author[] = [
  {
    name: "R4ph3rd",
    email: "43202876+R4ph3rd@users.noreply.github.com",
    login: "R4ph3rd",
    avatar: true,
  },
  { name: "Ada Lovelace", email: "ada@analytical.example", login: "ada-l", avatar: false },
  { name: "Grace Hopper", email: "grace@navy.example", login: "ghopper", avatar: true },
  { name: "Linus Torvalds", email: "linus@kernel.example", login: "linus", avatar: false },
  { name: "Margaret Hamilton", email: "margaret@apollo.example", login: "mhamilton", avatar: true },
  { name: "Dennis Ritchie", email: "dmr@bell.example", login: "dmr", avatar: false },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** A colored circle with initials, as an inline SVG data URL. */
export function avatarDataUrl(name: string): string {
  let hue = 0;
  for (const ch of name) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<circle cx="32" cy="32" r="32" fill="hsl(${hue} 55% 42%)"/>` +
    `<text x="32" y="41" font-family="sans-serif" font-size="26" font-weight="600" ` +
    `text-anchor="middle" fill="white">${initials(name)}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function avatarForEmail(email: string): string | null {
  const a = AUTHORS.find((x) => x.email === email);
  return a?.avatar ? avatarDataUrl(a.name) : null;
}

export function avatarForLogin(login: string): string | null {
  const a = AUTHORS.find((x) => x.login === login);
  return a?.avatar ? avatarDataUrl(a.name) : null;
}

/* ---------------------------------------------------------------- graph */

const TOPICS = [
  "graph: render lane edges",
  "sidebar: group refs by kind",
  "staging: keep selection after stage",
  "toolbar: split undo button",
  "terminal: fit on resize",
  "forge: list open issues",
  "ipc: add oplog_state",
  "design: tune dark palette",
  "diff: collapse unchanged hunks",
  "palette: rank recent commands",
  "settings: avatar mode",
  "mobile: bottom tabs",
  "oplog: fix redo ordering",
  "history: file history dialog",
  "remotes: show ahead/behind",
  "stash: preview before drop",
];
const VERBS = ["feat", "fix", "refactor", "perf", "test", "docs", "chore"];
const FEATURES = ["avatars", "terminal", "issues", "palette", "scroll", "tabs", "dnd", "blame"];

interface Sim {
  parents: number[]; // creation indexes
  message: string;
  isMerge: boolean;
}

/** Oldest-first commit simulation: a mainline with short-lived feature branches and merges. */
function simulate(): Sim[] {
  const sims: Sim[] = [];
  let main = -1;
  const features: { tip: number; left: number; name: string }[] = [];
  let featureNo = 0;
  for (let i = 0; i < ROW_COUNT; i++) {
    const verb = at(VERBS, i % VERBS.length);
    const topic = at(TOPICS, (i * 7) % TOPICS.length);
    const msg = `${verb}(${topic.split(":")[0]}): ${topic.split(": ")[1]}`;
    const late = i >= ROW_COUNT - 30;
    const finished = features.findIndex((f) => f.left <= 0);
    if (i === 0) {
      sims.push({ parents: [], message: "chore(repo): initial commit", isMerge: false });
      main = 0;
    } else if (!late && i % 9 === 5 && features.length < 4) {
      // Branch off the mainline (or a running feature for nested lanes).
      const from = features.length > 1 && i % 2 === 0 ? at(features, 0).tip : main;
      const name = at(FEATURES, featureNo++ % FEATURES.length);
      features.push({ tip: i, left: 6 + (i % 7), name });
      sims.push({ parents: [from], message: msg, isMerge: false });
    } else if (finished >= 0 && i % 11 === 0 && (!late || features.length > 2)) {
      const f = at(features, finished);
      sims.push({
        parents: [main, f.tip],
        message: `Merge branch 'feature/${f.name}'`,
        isMerge: true,
      });
      main = i;
      features.splice(finished, 1);
    } else if (features.length > 0 && i % 2 === 0) {
      const f = at(features, (i / 2) % features.length);
      sims.push({ parents: [f.tip], message: msg, isMerge: false });
      f.tip = i;
      f.left -= 1;
    } else {
      sims.push({ parents: [main], message: msg, isMerge: false });
      main = i;
    }
  }
  return sims;
}

interface Slot {
  oid: string;
  color: number;
}

/** Port of the backend lane layout (src-tauri/src/git/graph/layout.rs). */
function layout(oids: string[], parentsOf: (i: number) => string[]) {
  const lanes: (Slot | null)[] = [];
  let nextColor = 0;
  let laneCount = 0;
  const out: { lane: number; color: number; edges: GraphEdge[] }[] = [];
  const firstFree = () => {
    const f = lanes.findIndex((s) => s === null);
    if (f >= 0) return f;
    lanes.push(null);
    return lanes.length - 1;
  };
  oids.forEach((oid, i) => {
    const matches: number[] = [];
    lanes.forEach((s, l) => {
      if (s && s.oid === oid) matches.push(l);
    });
    let lane: number;
    let color: number;
    const m = matches[0];
    if (m !== undefined) {
      lane = m;
      color = lanes[m]?.color ?? 0;
    } else {
      lane = firstFree();
      color = nextColor++;
    }
    if (i > 0) {
      const prev = at(out, i - 1);
      for (const b of matches.slice(1)) {
        for (const e of prev.edges) {
          if (e.toLane === b) {
            e.toLane = lane;
            e.kind = "mergeIn";
          }
        }
      }
    }
    for (const b of matches) lanes[b] = null;
    lanes[lane] = null;
    const edges: GraphEdge[] = [];
    const created: number[] = [];
    let first = true;
    for (const p of parentsOf(i)) {
      if (first) {
        first = false;
        lanes[lane] = { oid: p, color };
        edges.push({ fromLane: lane, toLane: lane, kind: "straight", color });
        continue;
      }
      const q = lanes.findIndex((s) => s?.oid === p);
      if (q >= 0) {
        edges.push({ fromLane: lane, toLane: q, kind: "mergeIn", color: lanes[q]?.color ?? 0 });
      } else {
        const b = firstFree();
        const c = nextColor++;
        lanes[b] = { oid: p, color: c };
        edges.push({ fromLane: lane, toLane: b, kind: "branchOut", color: c });
        created.push(b);
      }
    }
    lanes.forEach((s, l) => {
      if (s && l !== lane && !created.includes(l)) {
        edges.push({ fromLane: l, toLane: l, kind: "straight", color: s.color });
      }
    });
    laneCount = Math.max(laneCount, lanes.length);
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    out.push({ lane, color, edges });
  });
  return { rows: out, laneCount };
}

/** Rows that carry refs (row index -> labels). */
const REF_ROWS: Record<number, RefLabel[]> = {};
const addRef = (row: number, name: string, kind: RefLabel["kind"], isHead = false) => {
  const fullName =
    kind === "localBranch"
      ? `refs/heads/${name}`
      : kind === "remoteBranch"
        ? `refs/remotes/${name}`
        : kind === "tag"
          ? `refs/tags/${name}`
          : "refs/stash";
  (REF_ROWS[row] ??= []).push({ name, fullName, kind, isHead });
};

addRef(0, "main", "localBranch", true);
addRef(0, "origin/main", "remoteBranch");
addRef(4, "feature/avatars", "localBranch");
addRef(4, "origin/feature/avatars", "remoteBranch");
addRef(11, "fix/scroll", "localBranch");
addRef(11, "origin/fix/scroll", "remoteBranch");
addRef(23, "origin/dev", "remoteBranch");
addRef(60, "origin/gh-pages", "remoteBranch");
addRef(120, "origin/release/1.0", "remoteBranch");
addRef(200, "origin/feature/terminal", "remoteBranch");
addRef(150, "v0.2.0", "tag");
addRef(280, "v0.1.0", "tag");
addRef(7, "WIP on main: 3f9c1d2 stash me", "stash");

const sims = simulate();
/** Row i (newest first) is creation index ROW_COUNT - 1 - i. */
const creationOf = (row: number) => ROW_COUNT - 1 - row;
const oids = Array.from({ length: ROW_COUNT }, (_, row) => oidOf(creationOf(row)));
const laid = layout(oids, (row) => at(sims, creationOf(row)).parents.map((p) => oidOf(p)));

export const GRAPH_ROWS: GraphRow[] = laid.rows.map((l, row) => {
  const sim = at(sims, creationOf(row));
  const author = at(AUTHORS, (creationOf(row) * 5 + (row % 3)) % AUTHORS.length);
  const oid = at(oids, row);
  return {
    index: row,
    oid,
    shortOid: oid.slice(0, 7),
    summary: sim.message,
    authorName: author.name,
    authorEmail: author.email,
    authorTime: NEWEST - row * 5400 - (row % 7) * 211,
    parents: sim.parents.map((p) => oidOf(p)),
    lane: l.lane,
    color: l.color,
    edges: l.edges,
    refs: REF_ROWS[row] ?? [],
  };
});

export const REF_COLORS: RefColor[] = GRAPH_ROWS.flatMap((r) =>
  r.refs.filter((x) => x.kind !== "stash").map((x) => ({ fullName: x.fullName, color: r.color })),
);

export const GRAPH_META: GraphMeta = {
  rowCount: ROW_COUNT,
  laneCount: laid.laneCount,
  headRow: 0,
  refColors: REF_COLORS,
};

export const rowByOid = (oid: string): GraphRow | undefined =>
  GRAPH_ROWS.find((r) => r.oid === oid);

/* ----------------------------------------------------------------- repo */

export const HEAD_OID = at(oids, 0);

export const fixtureRepoInfo: RepoInfo = {
  id: "preview-repo",
  path: "/home/dev/gittrunk",
  name: "gittrunk",
  head: { kind: "branch", name: "main", oid: HEAD_OID },
  state: "clean",
  isBare: false,
};

const branch = (
  name: string,
  row: number,
  extra: Partial<BranchInfo> = {},
  remote: string | null = null,
): BranchInfo => ({
  name,
  fullName: remote ? `refs/remotes/${name}` : `refs/heads/${name}`,
  oid: at(oids, row),
  upstream: null,
  ahead: 0,
  behind: 0,
  isHead: false,
  remote,
  ...extra,
});

export const REFS: RefsSnapshot = {
  head: fixtureRepoInfo.head,
  local: [
    branch("main", 0, { isHead: true, upstream: "origin/main", ahead: 0, behind: 0 }),
    branch("feature/avatars", 4, { upstream: "origin/feature/avatars", ahead: 2, behind: 0 }),
    branch("fix/scroll", 11, { upstream: "origin/fix/scroll", ahead: 0, behind: 1 }),
  ],
  remote: [
    branch("origin/main", 0, {}, "origin"),
    branch("origin/feature/avatars", 4, {}, "origin"),
    branch("origin/fix/scroll", 11, {}, "origin"),
    branch("origin/dev", 23, {}, "origin"),
    branch("origin/gh-pages", 60, {}, "origin"),
    branch("origin/release/1.0", 120, {}, "origin"),
  ],
  tags: [
    { name: "v0.2.0", oid: at(oids, 150), annotated: true, message: "Release 0.2.0" },
    { name: "v0.1.0", oid: at(oids, 280), annotated: false, message: null },
  ],
  stashes: [
    {
      index: 0,
      oid: at(oids, 7),
      message: "WIP on main: 3f9c1d2 stash me",
      branch: "main",
      time: NEWEST - 7 * 5400,
    },
  ],
};

export const REMOTES = [
  {
    name: "origin",
    fetchUrl: "https://github.com/R4ph3rd/gittrunk.git",
    pushUrl: null,
    provider: "gitHub" as const,
  },
];

const change = (
  path: string,
  status: FileChange["status"],
  additions: number,
  deletions: number,
): FileChange => ({ path, oldPath: null, status, additions, deletions, binary: false });

export function makeStatus(conflict: boolean): StatusSnapshot {
  return {
    state: conflict ? "merge" : "clean",
    staged: [
      change("src/features/toolbar/UndoSplitButton.tsx", "added", 84, 0),
      change("src/stores/layout.ts", "modified", 12, 3),
    ],
    unstaged: [
      change("src/features/graph/GraphCanvas.tsx", "modified", 22, 9),
      change("src/features/graph/layout.ts", "modified", 5, 5),
      change("src/features/sidebar/RefsSidebar.tsx", "modified", 31, 14),
      change("src/features/sidebar/sections/Issues.tsx", "untracked", 60, 0),
      change("src/app/layout/Shell.tsx", "modified", 8, 2),
      change("docs/PLAN.md", "deleted", 0, 14),
    ],
    conflicted: conflict ? [change("src/app/App.tsx", "conflicted", 6, 6)] : [],
  };
}

/** Deterministic file list for any commit. */
export function commitFiles(oid: string): FileChange[] {
  const n = parseInt(oid.slice(0, 6), 16);
  const pool = [
    "src/features/graph/GraphView.tsx",
    "src/features/graph/layout.ts",
    "src/features/staging/FileList.tsx",
    "src/ipc/queries.ts",
    "src-tauri/src/git/graph/layout.rs",
    "src/design/tokens.css",
    "docs/PLAN.md",
    "README.md",
  ];
  const count = 2 + (n % 4);
  return Array.from({ length: count }, (_, k) => {
    const path = at(pool, (n + k * 3) % pool.length);
    const status: FileChange["status"] = k === 0 && n % 3 === 0 ? "added" : "modified";
    return change(path, status, 3 + ((n + k) % 40), status === "added" ? 0 : (n + k) % 11);
  }).filter((f, i, all) => all.findIndex((g) => g.path === f.path) === i);
}

export function commitDetails(oid: string): CommitDetails {
  const row = rowByOid(oid) ?? at(GRAPH_ROWS, 0);
  const author = AUTHORS.find((a) => a.email === row.authorEmail) ?? at(AUTHORS, 0);
  const committer = at(AUTHORS, 0);
  const t = row.authorTime;
  return {
    oid: row.oid,
    parents: row.parents,
    author: { name: author.name, email: author.email, time: t, offsetMinutes: 120 },
    committer: { name: committer.name, email: committer.email, time: t, offsetMinutes: 120 },
    summary: row.summary,
    body:
      "Explains the change in a few sentences so the hover card and the details panel\n" +
      "have a realistic multi-line body to wrap and truncate.\n\n" +
      "Refs #12",
    files: commitFiles(row.oid),
    refs: row.refs,
  };
}

function hunk(start: number, seed: number): Hunk {
  const l = (
    kind: "context" | "add" | "delete",
    o: number | null,
    n: number | null,
    content: string,
  ) => ({ kind, oldLineno: o, newLineno: n, content });
  return {
    header: `@@ -${start},6 +${start},7 @@ export function render()`,
    oldStart: start,
    oldLines: 6,
    newStart: start,
    newLines: 7,
    lines: [
      l("context", start, start, "  const rows = useGraphRows(repoId);"),
      l("context", start + 1, start + 1, "  const { scrollTop } = useScroll();"),
      l("delete", start + 2, null, `  const radius = ${4 + (seed % 3)};`),
      l("add", null, start + 2, "  const radius = metrics.nodeRadius;"),
      l("add", null, start + 3, "  const ring = laneVar(row.color);"),
      l("context", start + 3, start + 4, "  ctx.beginPath();"),
      l("context", start + 4, start + 5, "  ctx.arc(x, y, radius, 0, Math.PI * 2);"),
      l("context", start + 5, start + 6, "  ctx.fill();"),
    ],
  };
}

export function fileDiff(path: string, status: FileChange["status"] = "modified"): FileDiff {
  const seed = path.length;
  return {
    path,
    oldPath: null,
    status,
    binary: false,
    hunks: [hunk(10 + (seed % 5), seed), hunk(58 + (seed % 7), seed + 1)],
  };
}

export const OPLOG_STATE: OplogState = {
  canUndo: true,
  canRedo: true,
  undoDescription: "Checkout main",
  redoDescription: "Merge feature/avatars",
};

export const OPLOG: OplogEntry[] = [
  ["Checkout main", "checkout"],
  ["Create branch fix/scroll", "branchCreate"],
  ["Merge feature/avatars", "merge"],
].map(([description, operation], i) => ({
  id: `op${i}`,
  time: NEWEST - i * 600,
  operation: operation as string,
  description: description as string,
  headBefore: at(oids, i + 1),
  headAfter: at(oids, i),
  undone: i === 2,
}));

/* ---------------------------------------------------------------- forge */

export const FORGE_REPO: ForgeRepo = {
  kind: "github",
  host: "github.com",
  owner: "R4ph3rd",
  name: "gittrunk",
  webUrl: "https://github.com/R4ph3rd/gittrunk",
  remote: "origin",
};

const ISSUE_TITLES = [
  "Graph stutters when scrolling past 50k commits",
  "Add a terminal panel",
  "Undo should offer redo in a menu",
  "Dark theme: muted text is too dim",
  "Support GitLab remotes",
  "Android: clone with token fails",
  "Hover card flickers on fast mouse moves",
  "Stash dialog loses the message",
  "Command palette does not rank recents",
  "Keyboard alternative for drag and drop",
  "Show ahead/behind in the sidebar",
  "Files list: tree mode",
];
const LABELS = [["bug", "graph"], ["enhancement"], ["enhancement", "ux"], ["bug", "design"]];

export const ISSUES: Issue[] = ISSUE_TITLES.map((title, i) => {
  const author = at(AUTHORS, i % AUTHORS.length);
  const number = 12 - i;
  return {
    number,
    title,
    state: i % 4 === 3 ? "closed" : "open",
    author: { login: author.login },
    labels: at(LABELS, i % LABELS.length),
    comments: i % 3 === 0 ? 3 : i % 3,
    createdAt: NEWEST - (i + 1) * 86_400,
    updatedAt: NEWEST - i * 7_200,
    url: `https://github.com/R4ph3rd/gittrunk/issues/${number}`,
  };
});

export function issueDetail(number: number): IssueDetail {
  const issue = ISSUES.find((i) => i.number === number) ?? at(ISSUES, 0);
  const comment = (id: number, who: Author, body: string): ForgeComment => ({
    id: `c${number}-${id}`,
    author: { login: who.login },
    body,
    createdAt: NEWEST - (4 - id) * 3_600,
    url: `${issue.url}#issuecomment-${id}`,
  });
  return {
    issue,
    body:
      "Steps to reproduce:\n\n1. Open a repository with a long history\n2. Scroll quickly\n\n" +
      "Expected: steady 60 fps. Actual: visible hitching.",
    comments: [
      comment(
        1,
        at(AUTHORS, 2),
        "I can reproduce this on Linux too. Looks like the canvas redraws twice.",
      ),
      comment(
        2,
        at(AUTHORS, 0),
        "Thanks! Text like <b>html</b> must stay plain text in comments.\n\nFixed in the next push.",
      ),
      comment(3, at(AUTHORS, 4), "Confirmed fixed on main."),
    ],
  };
}

export function commitComments(oid: string): ForgeComment[] {
  if (oid !== HEAD_OID) return [];
  return [
    {
      id: "cc1",
      author: { login: at(AUTHORS, 2).login },
      body: "Nice cleanup. Could we add a test for the empty graph?",
      createdAt: NEWEST - 1_800,
      url: "https://github.com/R4ph3rd/gittrunk/commit/abc#commitcomment-1",
    },
    {
      id: "cc2",
      author: { login: at(AUTHORS, 0).login },
      body: "Good point, added in the follow-up.",
      createdAt: NEWEST - 600,
      url: "https://github.com/R4ph3rd/gittrunk/commit/abc#commitcomment-2",
    },
  ];
}

const branchOid = (name: string): string =>
  REFS.local.find((b) => b.name === name)?.oid ?? REFS.local[0]?.oid ?? HEAD_OID;

const pullBranch = (name: string, repo: string | null, owner = "R4ph3rd") => ({
  name,
  label: `${owner}:${name}`,
  sha: repo === null ? oidOf(900) : branchOid(name),
  repo,
  isFork: repo !== null && repo !== "R4ph3rd/gittrunk",
});

const MAIN_BASE = pullBranch("main", "R4ph3rd/gittrunk");

export const PULLS: ForgePull[] = [
  {
    number: 41,
    title: "Show author avatars in the graph",
    state: "open",
    draft: false,
    author: { login: at(AUTHORS, 0).login },
    head: pullBranch("feature/avatars", "R4ph3rd/gittrunk"),
    base: MAIN_BASE,
    labels: ["enhancement"],
    createdAt: NEWEST - 2 * 86_400,
    updatedAt: NEWEST - 3_600,
    url: "https://github.com/R4ph3rd/gittrunk/pull/41",
  },
  {
    number: 40,
    title: "WIP: smoother scrolling past 50k commits",
    state: "open",
    draft: true,
    author: { login: at(AUTHORS, 2).login },
    head: pullBranch("fix/scroll", "R4ph3rd/gittrunk", at(AUTHORS, 2).login),
    base: MAIN_BASE,
    labels: ["performance"],
    createdAt: NEWEST - 4 * 86_400,
    updatedAt: NEWEST - 9_000,
    url: "https://github.com/R4ph3rd/gittrunk/pull/40",
  },
  {
    number: 38,
    title: "Fix typo in the README install section",
    state: "merged",
    draft: false,
    author: { login: at(AUTHORS, 4).login },
    head: pullBranch("docs/readme-typo", null),
    base: MAIN_BASE,
    labels: [],
    createdAt: NEWEST - 9 * 86_400,
    updatedAt: NEWEST - 8 * 86_400,
    url: "https://github.com/R4ph3rd/gittrunk/pull/38",
  },
  {
    number: 37,
    title: "Add Dutch translation",
    state: "open",
    draft: false,
    author: { login: "translator-nl" },
    head: pullBranch("add-dutch", "translator-nl/gittrunk", "translator-nl"),
    base: MAIN_BASE,
    labels: ["i18n", "good first issue"],
    createdAt: NEWEST - 12 * 86_400,
    updatedAt: NEWEST - 5 * 86_400,
    url: "https://github.com/R4ph3rd/gittrunk/pull/37",
  },
];

export function pullDetail(number: number): PullDetail {
  const pull = PULLS.find((p) => p.number === number) ?? at(PULLS, 0);
  const comment = (id: number, who: Author, body: string): ForgeComment => ({
    id: `p${pull.number}-${id}`,
    author: { login: who.login },
    body,
    createdAt: NEWEST - (3 - id) * 3_600,
    url: `${pull.url}#issuecomment-${id}`,
  });
  return {
    pull,
    body:
      "Adds avatars next to each commit author.\n\n- Loaded through the backend only\n" +
      "- Falls back to initials\n\nText like <b>html</b> stays plain text.",
    comments: [
      comment(1, at(AUTHORS, 2), "Looks good. Does it respect the avatars setting?"),
      comment(2, at(AUTHORS, 0), "Yes: with avatars off it shows initials only."),
    ],
    commits: 4,
    additions: 212,
    deletions: 37,
    changedFiles: 9,
    mergeable: true,
  };
}

export const KNOWN_REPOS: KnownRepo[] = [
  { path: fixtureRepoInfo.path, name: "gittrunk", lastOpened: NEWEST, exists: true },
  { path: "/home/dev/dotfiles", name: "dotfiles", lastOpened: NEWEST - 86_400, exists: true },
  {
    path: "/home/dev/old-project",
    name: "old-project",
    lastOpened: NEWEST - 90 * 86_400,
    exists: false,
  },
];

export const NOTIFICATIONS: ForgeNotification[] = [
  {
    id: "1001",
    title: "Show author avatars in the graph",
    kind: "PullRequest",
    reason: "review_requested",
    repo: "R4ph3rd/gittrunk",
    unread: true,
    updatedAt: NEWEST - 1_200,
    url: "https://github.com/R4ph3rd/gittrunk/pull/41",
  },
  {
    id: "1002",
    title: "Graph stutters when scrolling past 50k commits",
    kind: "Issue",
    reason: "mention",
    repo: "R4ph3rd/gittrunk",
    unread: true,
    updatedAt: NEWEST - 7_200,
    url: "https://github.com/R4ph3rd/gittrunk/issues/12",
  },
  {
    id: "1003",
    title: "v0.2.0",
    kind: "Release",
    reason: "subscribed",
    repo: "R4ph3rd/gittrunk",
    unread: false,
    updatedAt: NEWEST - 3 * 86_400,
    url: null,
  },
];

export const SSH_KEYS: SshKeyList = {
  dir: "/home/dev/.ssh",
  keys: [
    {
      name: "id_ed25519",
      path: "/home/dev/.ssh/id_ed25519",
      publicKey:
        "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPreviewKeyPreviewKeyPreviewKeyPreview dev@gittrunk",
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:Zk3c1J0Qm9v1b0o3pQ5Yq0m8R7m1lKf0wYfX2u1aB4c",
      comment: "dev@gittrunk",
      hasPrivateKey: true,
    },
    {
      name: "id_rsa_work",
      path: "/home/dev/.ssh/id_rsa_work",
      publicKey: "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQPreviewRsaKeyPreviewRsaKey work@laptop",
      algorithm: "ssh-rsa",
      fingerprint: "SHA256:Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8L9z0X1c",
      comment: "work@laptop",
      hasPrivateKey: false,
    },
  ],
};

export function generatedSshKey(name: string, comment: string): SshKey {
  return {
    name,
    path: `${SSH_KEYS.dir}/${name}`,
    publicKey: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGeneratedPreviewKeyGeneratedPreviewKey ${comment}`,
    algorithm: "ssh-ed25519",
    fingerprint: "SHA256:Gn3r4t3dPr3v13wK3yF1ng3rpr1nt0000000000000",
    comment,
    hasPrivateKey: true,
  };
}

/** Text the fake terminal prints when a session opens. */
export const TERMINAL_BANNER =
  "\x1b[1;32mdev@gittrunk\x1b[0m:\x1b[1;34m~/gittrunk\x1b[0m$ git status -sb\r\n" +
  "## main...origin/main\r\n M src/features/graph/GraphCanvas.tsx\r\n?? src/features/sidebar/sections/Issues.tsx\r\n" +
  "\x1b[1;32mdev@gittrunk\x1b[0m:\x1b[1;34m~/gittrunk\x1b[0m$ ";
