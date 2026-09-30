use git2::Oid;

use crate::git::fixtures::{self, synthetic, TestRepo};
use crate::git::libgit::LibGit;
use crate::git::service::GitService;
use crate::git::{default_filter, graph::GraphCache};
use crate::ipc::types::*;

fn build(repo: &git2::Repository, filter: &GraphFilter) -> GraphCache {
    LibGit.graph_build(repo, filter).unwrap()
}

fn all_rows(repo: &git2::Repository, filter: &GraphFilter) -> Vec<GraphRow> {
    build(repo, filter).rows(0, u32::MAX)
}

fn row_of(rows: &[GraphRow], oid: Oid) -> &GraphRow {
    let hex = oid.to_string();
    rows.iter().find(|r| r.oid == hex).expect("row present")
}

fn edge(from: u32, to: u32, kind: EdgeKind) -> impl Fn(&GraphEdge) -> bool {
    move |e| e.from_lane == from && e.to_lane == to && e.kind == kind
}

/// Every line leaving row `i` must arrive at row `i + 1`, and every line
/// leaving row `i + 1` must have a source.
fn assert_consistent(rows: &[GraphRow], lane_count: u32) {
    for (i, row) in rows.iter().enumerate() {
        assert!(row.lane < lane_count, "lane out of range at row {i}");
        for e in &row.edges {
            assert!(e.from_lane < lane_count && e.to_lane < lane_count);
        }
        let Some(next) = rows.get(i + 1) else {
            continue;
        };
        for e in &row.edges {
            let arrives =
                e.to_lane == next.lane || next.edges.iter().any(|x| x.from_lane == e.to_lane);
            assert!(
                arrives,
                "edge {e:?} of row {i} does not arrive at row {}",
                i + 1
            );
        }
        for x in &next.edges {
            let sourced =
                x.from_lane == next.lane || row.edges.iter().any(|e| e.to_lane == x.from_lane);
            assert!(sourced, "edge {x:?} of row {} has no source", i + 1);
        }
    }
}

#[test]
fn empty_repo_has_no_rows() {
    let t = fixtures::empty();
    let cache = build(&t.repo, &default_filter());
    assert_eq!(
        cache.meta(),
        GraphMeta {
            row_count: 0,
            lane_count: 0,
            head_row: None
        }
    );
    assert!(cache.rows(0, 10).is_empty());
}

#[test]
fn linear_history_is_one_lane() {
    let (t, oids) = fixtures::linear(5);
    let cache = build(&t.repo, &default_filter());
    let meta = cache.meta();
    assert_eq!(
        (meta.row_count, meta.lane_count, meta.head_row),
        (5, 1, Some(0))
    );
    let rows = cache.rows(0, 100);
    // Newest first.
    for (row, oid) in rows.iter().zip(oids.iter().rev()) {
        assert_eq!(row.oid, oid.to_string());
        assert_eq!(row.lane, 0);
        assert_eq!(row.color, rows[0].color);
    }
    for row in &rows[..4] {
        assert_eq!(row.edges.len(), 1);
        assert!(edge(0, 0, EdgeKind::Straight)(&row.edges[0]));
    }
    assert!(rows[4].edges.is_empty());
    assert_eq!(rows[0].parents, vec![oids[3].to_string()]);
    assert_eq!(rows[0].short_oid, &oids[4].to_string()[..7]);
    assert_consistent(&rows, meta.lane_count);
}

#[test]
fn branch_and_merge_lanes_and_edges() {
    let f = fixtures::branch_merge();
    let cache = build(&f.repo.repo, &default_filter());
    let rows = cache.rows(0, 100);
    assert_eq!(rows.len(), 4);
    assert_eq!(cache.meta().lane_count, 2);
    let (m, b, c, a) = (
        row_of(&rows, f.m),
        row_of(&rows, f.b),
        row_of(&rows, f.c),
        row_of(&rows, f.a),
    );
    assert_eq!((m.index, m.lane), (0, 0));
    assert_eq!(b.lane, 0, "first parent continues in the merge lane");
    assert_eq!(c.lane, 1, "second parent gets a reserved lane");
    assert_eq!(a.lane, 0);
    assert_eq!(m.edges.len(), 2);
    assert!(m.edges.iter().any(edge(0, 0, EdgeKind::Straight)));
    assert!(m.edges.iter().any(edge(0, 1, EdgeKind::BranchOut)));
    // The row right above the root carries the collapsing side lane.
    let above = &rows[a.index as usize - 1];
    assert!(
        above.edges.iter().any(edge(1, 0, EdgeKind::MergeIn)),
        "edges above root: {:?}",
        above.edges
    );
    // Colors: main line keeps its color down to the root; the side branch differs.
    assert_eq!(b.color, m.color);
    assert_eq!(a.color, m.color);
    assert_ne!(c.color, m.color);
    assert_consistent(&rows, 2);
}

#[test]
fn octopus_merge_uses_one_lane_per_parent() {
    let f = fixtures::octopus();
    let cache = build(&f.repo.repo, &default_filter());
    let rows = cache.rows(0, 100);
    assert_eq!(rows.len(), 6);
    let merge = row_of(&rows, f.merge);
    assert_eq!(merge.lane, 0);
    assert_eq!(merge.parents.len(), 4);
    assert_eq!(
        merge
            .edges
            .iter()
            .filter(|e| e.kind == EdgeKind::BranchOut)
            .count(),
        3
    );
    assert!(merge.edges.iter().any(edge(0, 0, EdgeKind::Straight)));
    let mut lanes: Vec<u32> = f.branches.iter().map(|b| row_of(&rows, *b).lane).collect();
    lanes.sort_unstable();
    assert_eq!(lanes, vec![1, 2, 3]);
    assert_eq!(row_of(&rows, f.main1).lane, 0);
    assert_eq!(row_of(&rows, f.a).lane, 0);
    assert_eq!(cache.meta().lane_count, 4);
    assert_consistent(&rows, 4);
}

#[test]
fn criss_cross_reuses_reservations() {
    let f = fixtures::criss_cross();
    let cache = build(&f.repo.repo, &default_filter());
    let rows = cache.rows(0, 100);
    assert_eq!(rows.len(), 6);
    assert_eq!(rows[0].oid, f.fin.to_string());
    assert_eq!(row_of(&rows, f.fin).lane, 0);
    assert_eq!(row_of(&rows, f.a).lane, 0);
    // Whichever merge is listed second finds its second parent already reserved.
    let (m1, m2) = (row_of(&rows, f.m1), row_of(&rows, f.m2));
    let second = if m1.index > m2.index { m1 } else { m2 };
    assert!(
        second.edges.iter().any(|e| e.kind == EdgeKind::MergeIn),
        "edges: {:?}",
        second.edges
    );
    // Each commit appears exactly once.
    let mut oids: Vec<_> = rows.iter().map(|r| r.oid.clone()).collect();
    oids.sort();
    oids.dedup();
    assert_eq!(oids.len(), 6);
    assert_consistent(&rows, cache.meta().lane_count);
    for oid in [f.b1, f.b2] {
        assert!(row_of(&rows, oid).lane < cache.meta().lane_count);
    }
}

fn authored_repo() -> (TestRepo, Vec<Oid>) {
    let mut t = TestRepo::new();
    t.write("a.txt", "1\n");
    let c1 = t.commit_all_by("Alice Smith", "alice@example.com", "alice first");
    t.write("b.txt", "1\n");
    let c2 = t.commit_all_by("Bob Jones", "bob@corp.test", "bob adds b");
    t.write("a.txt", "2\n");
    let c3 = t.commit_all_by("Alice Smith", "alice@example.com", "alice second");
    (t, vec![c1, c2, c3])
}

#[test]
fn filter_by_author_name_and_email_case_insensitive() {
    let (t, oids) = authored_repo();
    let mut f = default_filter();
    f.author = Some("ALICE".into());
    let rows = all_rows(&t.repo, &f);
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|r| r.author_name == "Alice Smith"));
    f.author = Some("corp.TEST".into());
    let rows = all_rows(&t.repo, &f);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].oid, oids[1].to_string());
    // Rows whose parents were filtered out still lay out without dangling lanes.
    f.author = Some("alice".into());
    let cache = build(&t.repo, &f);
    assert_consistent(&cache.rows(0, 10), cache.meta().lane_count);
}

#[test]
fn filter_by_path() {
    let (t, oids) = authored_repo();
    let mut f = default_filter();
    f.path = Some("a.txt".into());
    let rows = all_rows(&t.repo, &f);
    let got: Vec<_> = rows.iter().map(|r| r.oid.clone()).collect();
    assert_eq!(got, vec![oids[2].to_string(), oids[0].to_string()]);
    f.path = Some("b.txt".into());
    assert_eq!(all_rows(&t.repo, &f).len(), 1);
    f.path = Some("missing.txt".into());
    assert!(all_rows(&t.repo, &f).is_empty());
}

#[test]
fn filter_by_time_range_and_order() {
    let (t, oids) = authored_repo();
    let times: Vec<f64> = all_rows(&t.repo, &default_filter())
        .iter()
        .map(|r| r.author_time)
        .collect();
    let mut f = default_filter();
    f.since = Some(times[1]);
    assert_eq!(all_rows(&t.repo, &f).len(), 2);
    f.until = Some(times[1]);
    let rows = all_rows(&t.repo, &f);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].oid, oids[1].to_string());
    let mut f = default_filter();
    f.order = CommitOrder::Date;
    let dated = all_rows(&t.repo, &f);
    assert_eq!(dated[0].oid, oids[2].to_string());
}

#[test]
fn filter_first_parent_and_refs() {
    let f = fixtures::branch_merge();
    let mut filter = default_filter();
    filter.first_parent = true;
    filter.refs = Some(vec!["main".into()]);
    let rows = all_rows(&f.repo.repo, &filter);
    let oids: Vec<_> = rows.iter().map(|r| r.oid.clone()).collect();
    assert_eq!(oids.len(), 3);
    assert!(!oids.contains(&f.c.to_string()));
    let cache = build(&f.repo.repo, &filter);
    assert_eq!(cache.meta().lane_count, 1);

    let mut filter = default_filter();
    filter.refs = Some(vec!["feature".into()]);
    let rows = all_rows(&f.repo.repo, &filter);
    let oids: Vec<_> = rows.iter().map(|r| r.oid.clone()).collect();
    assert_eq!(oids, vec![f.c.to_string(), f.a.to_string()]);

    filter.refs = Some(vec!["does-not-exist".into()]);
    assert!(LibGit.graph_build(&f.repo.repo, &filter).is_err());
}

#[test]
fn rows_are_clamped_and_carry_ref_labels() {
    let (t, first, second) = fixtures::tags();
    let cache = build(&t.repo, &default_filter());
    assert!(cache.rows(99, 10).is_empty());
    assert_eq!(cache.rows(1, 100).len(), 1);
    assert_eq!(cache.rows(0, 0).len(), 0);
    let rows = cache.rows(0, 10);
    let top = row_of(&rows, second);
    let names: Vec<_> = top
        .refs
        .iter()
        .map(|l| (l.name.as_str(), l.kind, l.is_head))
        .collect();
    assert_eq!(
        names,
        vec![
            ("main", RefKind::LocalBranch, true),
            ("v1.0", RefKind::Tag, false)
        ]
    );
    assert_eq!(row_of(&rows, first).refs[0].full_name, "refs/tags/v0.1");
}

#[test]
fn stashes_are_not_part_of_the_graph() {
    let t = fixtures::stash();
    let cache = build(&t.repo, &default_filter());
    assert_eq!(cache.meta().row_count, 1);
}

#[test]
fn search_matches_summary_author_and_oid_prefix() {
    let (t, oids) = authored_repo();
    let cache = build(&t.repo, &default_filter());
    let s = |text: &str, max: u32| {
        cache.search(&GraphSearch {
            text: text.into(),
            max_results: max,
        })
    };
    assert_eq!(s("adds B", 10), vec![1]);
    assert_eq!(s("alice", 10), vec![0, 2]);
    assert_eq!(s("alice", 1), vec![0]);
    assert_eq!(s("CORP.test", 10), vec![1]);
    let prefix = &oids[0].to_string()[..10];
    assert_eq!(s(prefix, 10), vec![2]);
    assert!(s("", 10).is_empty());
    assert!(s("nothing matches this", 10).is_empty());
    assert!(s("alice", 0).is_empty());
}

#[test]
fn head_row_points_at_head_commit() {
    let f = fixtures::branch_merge();
    let cache = build(&f.repo.repo, &default_filter());
    assert_eq!(cache.meta().head_row, Some(0));
    f.repo.repo.set_head_detached(f.a).unwrap();
    let cache = build(&f.repo.repo, &default_filter());
    let idx = cache.meta().head_row.unwrap();
    assert_eq!(cache.rows(idx, 1)[0].oid, f.a.to_string());
}

#[test]
#[ignore = "performance test; run with --release -- --ignored perf_graph_100k"]
fn perf_graph_100k() {
    use std::time::Instant;
    let t0 = Instant::now();
    let fixture = synthetic::build(100_000);
    println!("fixture built in {:?}", t0.elapsed());
    let filter = default_filter();

    let start = Instant::now();
    let cache = LibGit.graph_build(&fixture.repo, &filter).unwrap();
    let load = start.elapsed();
    let meta = cache.meta();
    assert_eq!(meta.row_count as usize, fixture.commits);

    let start = Instant::now();
    let window = cache.rows(50_000, 200);
    let rows = start.elapsed();
    assert_eq!(window.len(), 200);

    let start = Instant::now();
    let hits = cache.search(&GraphSearch {
        text: "merge".into(),
        max_results: 1000,
    });
    let search = start.elapsed();

    println!(
        "graph_load(100k): {load:?} (lanes: {}), graph_rows(200): {rows:?}, search: {search:?} ({} hits)",
        meta.lane_count,
        hits.len()
    );
    if !cfg!(debug_assertions) {
        assert!(load.as_secs_f64() < 1.5, "graph_load took {load:?}");
        assert!(rows.as_secs_f64() < 0.005, "graph_rows took {rows:?}");
    }
}
