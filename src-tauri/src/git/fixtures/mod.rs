//! Test-only fixture repositories built with libgit2 (no git CLI, no user
//! config: signatures and the initial branch are explicit).

pub mod synthetic;

use std::fs;
use std::path::{Path, PathBuf};

use git2::{IndexAddOption, Oid, Repository, RepositoryInitOptions, Signature, Time};
use tempfile::TempDir;

const BASE_TIME: i64 = 1_700_000_000;

pub struct TestRepo {
    pub dir: TempDir,
    pub repo: Repository,
    clock: i64,
}

impl Default for TestRepo {
    fn default() -> Self {
        Self::new()
    }
}

impl TestRepo {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut opts = RepositoryInitOptions::new();
        opts.initial_head("main");
        let repo = Repository::init_opts(dir.path(), &opts).unwrap();
        {
            // Deterministic regardless of the host's global/system config.
            let mut cfg = repo.config().unwrap();
            cfg.set_str("core.autocrlf", "false").unwrap();
            cfg.set_str("core.eol", "lf").unwrap();
            // CLI-backed operations (merge, commit, rebase) need an identity;
            // CI runners have none configured globally.
            cfg.set_str("user.name", "Fixture").unwrap();
            cfg.set_str("user.email", "fixture@example.com").unwrap();
            cfg.set_bool("commit.gpgsign", false).unwrap();
        }
        Self {
            dir,
            repo,
            clock: BASE_TIME,
        }
    }

    /// Enables `core.autocrlf=true` in the repo's local config.
    pub fn enable_autocrlf(&self) {
        let mut cfg = self.repo.config().unwrap();
        cfg.set_str("core.autocrlf", "true").unwrap();
    }

    /// Writes a `.gitattributes` forcing CRLF in the working tree.
    pub fn write_crlf_attributes(&self) {
        self.write(".gitattributes", "* text=auto eol=crlf\n");
    }

    pub fn root(&self) -> PathBuf {
        self.dir.path().to_path_buf()
    }

    /// Next deterministic signature; time advances a minute per call.
    pub fn sig(&mut self) -> Signature<'static> {
        self.clock += 60;
        Signature::new("Test User", "test@example.com", &Time::new(self.clock, 0)).unwrap()
    }

    pub fn sig_for(&mut self, name: &str, email: &str) -> Signature<'static> {
        self.clock += 60;
        Signature::new(name, email, &Time::new(self.clock, 0)).unwrap()
    }

    pub fn write(&self, rel: &str, content: impl AsRef<[u8]>) {
        let path = self.root().join(Path::new(rel));
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    pub fn remove(&self, rel: &str) {
        fs::remove_file(self.root().join(Path::new(rel))).unwrap();
    }

    pub fn stage_all(&self) {
        let mut index = self.repo.index().unwrap();
        index.add_all(["*"], IndexAddOption::DEFAULT, None).unwrap();
        index.update_all(["*"], None).unwrap();
        index.write().unwrap();
    }

    /// Stages everything and commits on HEAD.
    pub fn commit_all(&mut self, message: &str) -> Oid {
        self.stage_all();
        let sig = self.sig();
        self.commit_index(&sig, message, "HEAD")
    }

    /// Like `commit_all` but with an explicit author.
    pub fn commit_all_by(&mut self, name: &str, email: &str, message: &str) -> Oid {
        self.stage_all();
        let sig = self.sig_for(name, email);
        self.commit_index(&sig, message, "HEAD")
    }

    /// Commits the current index; parents are HEAD (if any) plus `extra`.
    fn commit_index(&mut self, sig: &Signature<'_>, message: &str, update_ref: &str) -> Oid {
        let tree_id = self.repo.index().unwrap().write_tree().unwrap();
        let tree = self.repo.find_tree(tree_id).unwrap();
        let parent = self.repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        self.repo
            .commit(Some(update_ref), sig, sig, message, &tree, &parents)
            .unwrap()
    }

    /// Commit with explicit parents and tree of the current index, without touching refs.
    pub fn commit_detached(&mut self, message: &str, parents: &[Oid]) -> Oid {
        self.stage_all();
        let sig = self.sig();
        let tree_id = self.repo.index().unwrap().write_tree().unwrap();
        let tree = self.repo.find_tree(tree_id).unwrap();
        let ps: Vec<git2::Commit> = parents
            .iter()
            .map(|p| self.repo.find_commit(*p).unwrap())
            .collect();
        let refs: Vec<&git2::Commit> = ps.iter().collect();
        self.repo
            .commit(None, &sig, &sig, message, &tree, &refs)
            .unwrap()
    }

    /// Creates or moves a branch to `oid` and checks it out (index + workdir).
    pub fn checkout_branch(&self, name: &str, oid: Oid) {
        let commit = self.repo.find_commit(oid).unwrap();
        self.repo.branch(name, &commit, true).unwrap();
        self.repo.set_head(&format!("refs/heads/{name}")).unwrap();
        self.repo
            .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
    }

    /// Commit on `branch` (which must exist): checks it out, writes `file`, commits.
    pub fn commit_on(&mut self, branch: &str, file: &str, content: &str, message: &str) -> Oid {
        self.repo.set_head(&format!("refs/heads/{branch}")).unwrap();
        self.repo
            .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        self.write(file, content);
        self.commit_all(message)
    }

    pub fn head(&self) -> Oid {
        self.repo.head().unwrap().peel_to_commit().unwrap().id()
    }

    pub fn branch_tip(&self, name: &str) -> Oid {
        self.repo
            .find_branch(name, git2::BranchType::Local)
            .unwrap()
            .get()
            .peel_to_commit()
            .unwrap()
            .id()
    }
}

// ------------------------------------------------------------ scenarios

pub fn empty() -> TestRepo {
    TestRepo::new()
}

/// `n` commits on main, oldest first.
pub fn linear(n: usize) -> (TestRepo, Vec<Oid>) {
    let mut t = TestRepo::new();
    let mut oids = Vec::new();
    for i in 0..n {
        t.write("file.txt", format!("line {i}\n"));
        oids.push(t.commit_all(&format!("commit {i}")));
    }
    (t, oids)
}

pub struct BranchMerge {
    pub repo: TestRepo,
    pub a: Oid,
    /// Commit on main after `a`.
    pub b: Oid,
    /// Commit on `feature` after `a`.
    pub c: Oid,
    /// Merge of `feature` into main (parents `b`, `c`).
    pub m: Oid,
}

/// A - B (main) ; A - C (feature) ; M = merge(B, C) on main.
pub fn branch_merge() -> BranchMerge {
    let mut t = TestRepo::new();
    t.write("base.txt", "base\n");
    let a = t.commit_all("A");
    t.checkout_branch("feature", a);
    let c = t.commit_on("feature", "feature.txt", "feature\n", "C");
    let b = t.commit_on("main", "main.txt", "main\n", "B");
    t.write("feature.txt", "feature\n");
    let m = t.commit_detached("M", &[b, c]);
    t.repo
        .reference("refs/heads/main", m, true, "merge")
        .unwrap();
    t.repo
        .checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
        .unwrap();
    BranchMerge {
        repo: t,
        a,
        b,
        c,
        m,
    }
}

pub struct Octopus {
    pub repo: TestRepo,
    pub a: Oid,
    pub main1: Oid,
    pub branches: Vec<Oid>,
    pub merge: Oid,
}

/// Root A, main1 on main, x/y/z branches from A; merge has parents (main1, x, y, z).
pub fn octopus() -> Octopus {
    let mut t = TestRepo::new();
    t.write("base.txt", "base\n");
    let a = t.commit_all("A");
    let mut branches = Vec::new();
    for name in ["x", "y", "z"] {
        t.checkout_branch(name, a);
        branches.push(t.commit_on(
            name,
            &format!("{name}.txt"),
            name,
            &format!("commit {name}"),
        ));
    }
    let main1 = t.commit_on("main", "main.txt", "main\n", "main1");
    for name in ["x", "y", "z"] {
        t.write(&format!("{name}.txt"), name);
    }
    let mut parents = vec![main1];
    parents.extend(&branches);
    let merge = t.commit_detached("octopus", &parents);
    t.repo
        .reference("refs/heads/main", merge, true, "octopus")
        .unwrap();
    Octopus {
        repo: t,
        a,
        main1,
        branches,
        merge,
    }
}

pub struct CrissCross {
    pub repo: TestRepo,
    pub a: Oid,
    pub b1: Oid,
    pub b2: Oid,
    pub m1: Oid,
    pub m2: Oid,
    pub fin: Oid,
}

/// A; B1 and B2 from A; M1 = merge(B1, B2), M2 = merge(B2, B1); final = merge(M1, M2).
pub fn criss_cross() -> CrissCross {
    let mut t = TestRepo::new();
    t.write("base.txt", "base\n");
    let a = t.commit_all("A");
    t.checkout_branch("left", a);
    let b1 = t.commit_on("left", "left.txt", "left\n", "B1");
    t.checkout_branch("right", a);
    let b2 = t.commit_on("right", "right.txt", "right\n", "B2");
    t.write("left.txt", "left\n");
    t.write("right.txt", "right\n");
    let m1 = t.commit_detached("M1", &[b1, b2]);
    let m2 = t.commit_detached("M2", &[b2, b1]);
    t.repo.reference("refs/heads/left", m1, true, "").unwrap();
    t.repo.reference("refs/heads/right", m2, true, "").unwrap();
    let fin = t.commit_detached("final", &[m1, m2]);
    t.repo.reference("refs/heads/main", fin, true, "").unwrap();
    t.repo.set_head("refs/heads/main").unwrap();
    CrissCross {
        repo: t,
        a,
        b1,
        b2,
        m1,
        m2,
        fin,
    }
}

/// `old.txt` (several lines) renamed to `new.txt` with one changed line.
pub fn renames() -> (TestRepo, Oid, Oid) {
    let mut t = TestRepo::new();
    let body: String = (0..20).map(|i| format!("line number {i}\n")).collect();
    t.write("old.txt", &body);
    let first = t.commit_all("add old");
    t.remove("old.txt");
    t.write(
        "new.txt",
        body.replace("line number 7", "line number seven"),
    );
    let second = t.commit_all("rename");
    (t, first, second)
}

/// File with CRLF endings, then one line modified.
pub fn crlf() -> (TestRepo, Oid, Oid) {
    let mut t = TestRepo::new();
    t.write("crlf.txt", "one\r\ntwo\r\nthree\r\n");
    let first = t.commit_all("crlf");
    t.write("crlf.txt", "one\r\nTWO\r\nthree\r\n");
    let second = t.commit_all("crlf edit");
    (t, first, second)
}

/// File without trailing newline, then last line changed.
pub fn no_trailing_newline() -> (TestRepo, Oid, Oid) {
    let mut t = TestRepo::new();
    t.write("nonl.txt", "first\nlast");
    let first = t.commit_all("no newline");
    t.write("nonl.txt", "first\nchanged");
    let second = t.commit_all("no newline edit");
    (t, first, second)
}

/// Both branches edit `conflict.txt`; the merge stops in a conflicted state.
pub fn conflicted_merge() -> TestRepo {
    let mut t = TestRepo::new();
    t.write("conflict.txt", "base\n");
    let a = t.commit_all("base");
    t.checkout_branch("other", a);
    let other = t.commit_on("other", "conflict.txt", "other side\n", "other change");
    t.commit_on("main", "conflict.txt", "main side\n", "main change");
    {
        let annotated = t.repo.find_annotated_commit(other).unwrap();
        t.repo.merge(&[&annotated], None, None).unwrap();
    }
    t
}

/// Two commits with a light tag on the first and an annotated tag on the second.
pub fn tags() -> (TestRepo, Oid, Oid) {
    let mut t = TestRepo::new();
    t.write("f.txt", "1\n");
    let first = t.commit_all("first");
    t.write("f.txt", "2\n");
    let second = t.commit_all("second");
    let sig = t.sig();
    {
        let first_obj = t.repo.find_object(first, None).unwrap();
        t.repo.tag_lightweight("v0.1", &first_obj, false).unwrap();
        let second_obj = t.repo.find_object(second, None).unwrap();
        t.repo
            .tag("v1.0", &second_obj, &sig, "release one\n", false)
            .unwrap();
    }
    (t, first, second)
}

/// One commit, then a stash of a modified tracked file.
pub fn stash() -> TestRepo {
    let mut t = TestRepo::new();
    t.write("s.txt", "clean\n");
    t.commit_all("base");
    t.write("s.txt", "dirty\n");
    let sig = t.sig();
    t.repo.stash_save(&sig, "my stash", None).unwrap();
    t
}

/// `main` two commits ahead of and one behind `origin/main`.
pub fn ahead_behind() -> TestRepo {
    let mut t = TestRepo::new();
    t.write("f.txt", "0\n");
    let base = t.commit_all("base");
    // Local main gets two commits (ahead = 2).
    t.commit_on("main", "l1.txt", "1\n", "local 1");
    t.commit_on("main", "l2.txt", "2\n", "local 2");
    // Remote-only commit on top of `base` (behind = 1).
    t.write("r.txt", "r\n");
    let remote_tip = t.commit_detached("remote commit", &[base]);
    t.repo
        .reference("refs/remotes/origin/main", remote_tip, true, "test")
        .unwrap();
    t.repo
        .remote("origin", "https://example.invalid/repo.git")
        .unwrap();
    let mut cfg = t.repo.config().unwrap();
    cfg.set_str("branch.main.remote", "origin").unwrap();
    cfg.set_str("branch.main.merge", "refs/heads/main").unwrap();
    t
}
