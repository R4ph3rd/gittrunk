//! Commit graph: walk, filters, lane layout and the cached row store served
//! in windows to the frontend.

pub mod build;
pub mod layout;

#[cfg(test)]
mod tests;

use std::collections::HashMap;

use git2::Oid;

use crate::ipc::types::{GraphEdge, GraphMeta, GraphRow, GraphSearch, RefLabel};

pub(crate) struct CachedRow {
    pub oid: Oid,
    pub parents: Vec<Oid>,
    pub lane: u32,
    pub color: u32,
    pub edges: Vec<GraphEdge>,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub author_time: f64,
}

/// Fully laid-out graph for one filter.
pub struct GraphCache {
    pub(crate) rows: Vec<CachedRow>,
    pub(crate) lane_count: u32,
    pub(crate) head_row: Option<u32>,
    pub(crate) labels: HashMap<Oid, Vec<RefLabel>>,
}

impl GraphCache {
    pub fn meta(&self) -> GraphMeta {
        GraphMeta {
            row_count: self.rows.len() as u32,
            lane_count: self.lane_count,
            head_row: self.head_row,
        }
    }

    /// Rows `[start, start + len)`, clamped to the available range.
    pub fn rows(&self, start: u32, len: u32) -> Vec<GraphRow> {
        let total = self.rows.len();
        let start = (start as usize).min(total);
        let end = start.saturating_add(len as usize).min(total);
        (start..end)
            .map(|i| {
                let r = &self.rows[i];
                let hex = r.oid.to_string();
                GraphRow {
                    index: i as u32,
                    short_oid: hex[..7.min(hex.len())].to_string(),
                    oid: hex,
                    summary: r.summary.clone(),
                    author_name: r.author_name.clone(),
                    author_email: r.author_email.clone(),
                    author_time: r.author_time,
                    parents: r.parents.iter().map(Oid::to_string).collect(),
                    lane: r.lane,
                    color: r.color,
                    edges: r.edges.clone(),
                    refs: self.labels.get(&r.oid).cloned().unwrap_or_default(),
                }
            })
            .collect()
    }

    /// Row indices whose summary, author or oid prefix match `search.text`.
    pub fn search(&self, search: &GraphSearch) -> Vec<u32> {
        let needle = search.text.trim().to_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }
        let cap = search.max_results as usize;
        let mut out = Vec::new();
        for (i, r) in self.rows.iter().enumerate() {
            if out.len() >= cap {
                break;
            }
            let hit = r.oid.to_string().starts_with(&needle)
                || r.summary.to_lowercase().contains(&needle)
                || r.author_name.to_lowercase().contains(&needle)
                || r.author_email.to_lowercase().contains(&needle);
            if hit {
                out.push(i as u32);
            }
        }
        out
    }
}
