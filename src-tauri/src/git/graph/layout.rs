//! Lane assignment ("active lanes" layout).
//!
//! Rows arrive children-first. Each lane is either free or reserved for the
//! commit it is expected to reach next. Per row:
//! - the commit takes the leftmost lane reserved for it (else the first free lane);
//! - other lanes reserved for the same commit collapse into its lane: the edge
//!   that fed them in the previous row is redirected (`MergeIn`);
//! - its first parent continues in the commit's lane (`Straight`);
//! - further parents join an existing reservation (`MergeIn`) or open a new
//!   lane (`BranchOut`);
//! - every other reserved lane passes through (`Straight`).
//!
//! `GraphEdge`s describe the lines between this row and the next one.

use git2::Oid;

use crate::ipc::types::{EdgeKind, GraphEdge};

pub struct RowLayout {
    pub lane: u32,
    pub color: u32,
    pub edges: Vec<GraphEdge>,
}

pub struct Layout {
    pub rows: Vec<RowLayout>,
    pub lane_count: u32,
}

type Slot = Option<(Oid, u32)>;

fn first_free(lanes: &mut Vec<Slot>) -> usize {
    match lanes.iter().position(Option::is_none) {
        Some(i) => i,
        None => {
            lanes.push(None);
            lanes.len() - 1
        }
    }
}

/// `oids[i]` and `parents(i)` describe row `i` (all parents); `in_set` tells
/// whether a parent is itself a row of this graph (filters can drop commits).
pub fn compute<'a>(
    oids: &[Oid],
    parents: &dyn Fn(usize) -> &'a [Oid],
    in_set: &dyn Fn(&Oid) -> bool,
) -> Layout {
    let mut lanes: Vec<Slot> = Vec::new();
    let mut next_color = 0u32;
    let mut rows: Vec<RowLayout> = Vec::with_capacity(oids.len());
    let mut lane_count = 0usize;
    let mut matches: Vec<usize> = Vec::new();

    for (i, oid) in oids.iter().enumerate() {
        matches.clear();
        matches.extend(
            lanes
                .iter()
                .enumerate()
                .filter(|(_, s)| matches!(s, Some((o, _)) if o == oid))
                .map(|(l, _)| l),
        );

        let (lane, color) = match matches.first() {
            Some(&m) => (m, lanes[m].map_or(0, |s| s.1)),
            None => {
                let l = first_free(&mut lanes);
                let c = next_color;
                next_color += 1;
                (l, c)
            }
        };

        // Lanes converging on this commit end here; redirect the lines that fed them.
        if i > 0 {
            for &b in matches.iter().skip(1) {
                for e in &mut rows[i - 1].edges {
                    if e.to_lane as usize == b {
                        e.to_lane = lane as u32;
                        e.kind = EdgeKind::MergeIn;
                    }
                }
            }
        }
        for &b in &matches {
            lanes[b] = None;
        }
        // The commit's own lane is occupied while its edges are computed.
        lanes[lane] = None;

        let mut edges: Vec<GraphEdge> = Vec::new();
        let mut created: Vec<usize> = Vec::new();
        let mut first = true;
        for p in parents(i).iter().filter(|p| in_set(p)) {
            if first {
                first = false;
                lanes[lane] = Some((*p, color));
                edges.push(GraphEdge {
                    from_lane: lane as u32,
                    to_lane: lane as u32,
                    kind: EdgeKind::Straight,
                    color,
                });
            } else if let Some(q) = lanes
                .iter()
                .position(|s| matches!(s, Some((o, _)) if o == p))
            {
                edges.push(GraphEdge {
                    from_lane: lane as u32,
                    to_lane: q as u32,
                    kind: EdgeKind::MergeIn,
                    color: lanes[q].map_or(0, |s| s.1),
                });
            } else {
                let b = first_free(&mut lanes);
                let c = next_color;
                next_color += 1;
                lanes[b] = Some((*p, c));
                edges.push(GraphEdge {
                    from_lane: lane as u32,
                    to_lane: b as u32,
                    kind: EdgeKind::BranchOut,
                    color: c,
                });
                created.push(b);
            }
        }

        for (l, s) in lanes.iter().enumerate() {
            if let Some((_, c)) = s {
                if l != lane && !created.contains(&l) {
                    edges.push(GraphEdge {
                        from_lane: l as u32,
                        to_lane: l as u32,
                        kind: EdgeKind::Straight,
                        color: *c,
                    });
                }
            }
        }

        lane_count = lane_count.max(lanes.len());
        while matches!(lanes.last(), Some(None)) {
            lanes.pop();
        }
        rows.push(RowLayout {
            lane: lane as u32,
            color,
            edges,
        });
    }

    Layout {
        rows,
        lane_count: lane_count as u32,
    }
}
