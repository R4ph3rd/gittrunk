//! Synthetic large history for performance tests, written straight into the
//! object database (no index, no working tree, no CLI).

use git2::{ObjectType, Oid, Repository, RepositoryInitOptions};
use tempfile::TempDir;

pub struct Synthetic {
    pub dir: TempDir,
    pub repo: Repository,
    pub commits: usize,
}

struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
}

fn write_commit(repo: &Repository, tree: Oid, parents: &[Oid], time: i64, msg: &str) -> Oid {
    let mut body = format!("tree {tree}\n");
    for p in parents {
        body.push_str(&format!("parent {p}\n"));
    }
    let who = format!("Perf User <perf@example.com> {time} +0000");
    body.push_str(&format!("author {who}\ncommitter {who}\n\n{msg}\n"));
    repo.odb()
        .unwrap()
        .write(ObjectType::Commit, body.as_bytes())
        .unwrap()
}

/// About `n` commits: a main line with up to 20 concurrent side branches that
/// fork from main and are merged back at random.
pub fn build(n: usize) -> Synthetic {
    let dir = tempfile::tempdir().unwrap();
    let mut opts = RepositoryInitOptions::new();
    opts.initial_head("main");
    let repo = Repository::init_opts(dir.path(), &opts).unwrap();
    let tree = repo.treebuilder(None).unwrap().write().unwrap();

    let mut rng = Lcg(42);
    let mut time = 1_600_000_000i64;
    let mut main = write_commit(&repo, tree, &[], time, "root");
    let mut open: Vec<Oid> = Vec::new();
    let mut created = 1usize;
    while created < n {
        time += 1;
        let roll = rng.next() % 100;
        if roll < 60 || (open.is_empty() && roll < 75) {
            main = write_commit(&repo, tree, &[main], time, &format!("main {created}"));
        } else if roll < 75 || (open.len() < 20 && roll < 85) {
            if open.len() < 20 && roll >= 75 {
                // Fork a new side branch from main.
                let tip = write_commit(&repo, tree, &[main], time, &format!("fork {created}"));
                open.push(tip);
            } else {
                main = write_commit(&repo, tree, &[main], time, &format!("main {created}"));
            }
        } else if roll < 95 {
            let i = (rng.next() as usize) % open.len().max(1);
            if let Some(tip) = open.get(i).copied() {
                open[i] = write_commit(&repo, tree, &[tip], time, &format!("side {created}"));
            } else {
                main = write_commit(&repo, tree, &[main], time, &format!("main {created}"));
            }
        } else if !open.is_empty() {
            let i = (rng.next() as usize) % open.len();
            let tip = open.swap_remove(i);
            main = write_commit(&repo, tree, &[main, tip], time, &format!("merge {created}"));
        } else {
            main = write_commit(&repo, tree, &[main], time, &format!("main {created}"));
        }
        created += 1;
    }

    repo.reference("refs/heads/main", main, true, "synthetic")
        .unwrap();
    for (i, tip) in open.iter().enumerate() {
        repo.reference(&format!("refs/heads/side-{i}"), *tip, true, "synthetic")
            .unwrap();
    }
    // Real repositories are packed; loose objects would dominate the walk cost.
    let mut walk = repo.revwalk().unwrap();
    walk.push_glob("refs/heads/*").unwrap();
    let mut builder = repo.packbuilder().unwrap();
    builder.insert_walk(&mut walk).unwrap();
    builder
        .write(&repo.path().join("objects").join("pack"), 0)
        .unwrap();
    drop(builder);
    for entry in std::fs::read_dir(repo.path().join("objects")).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.len() == 2 && entry.path().is_dir() {
            std::fs::remove_dir_all(entry.path()).unwrap();
        }
    }
    let repo = Repository::open(dir.path()).unwrap();
    Synthetic {
        dir,
        repo,
        commits: created,
    }
}
