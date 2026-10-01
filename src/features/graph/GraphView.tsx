import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { GraphFilter, GraphMeta, GraphRow } from "@/ipc/bindings";
import { graphPageOptions, locateOid, PAGE_SIZE, useGraphMeta, useRefs } from "@/ipc/queries";
import { DEFAULT_FILTER, selectedOidOf, useRepoStore } from "@/stores/repo";
import { openActionMenu } from "@/features/operations/actions/openMenu";
import { useActionContext } from "@/features/operations/actions/useActionContext";
import { onThemeChange, readPalette, type Palette } from "./colors";
import { peekAvatarImage, requestAvatarImages } from "./avatarImages";
import { drawGraph } from "./draw";
import { GraphRowView, type OpenMenu } from "./GraphRowView";
import { GraphToolbar } from "./GraphToolbar";
import {
  COMPACT_METRICS,
  DESKTOP_METRICS,
  effectiveDpr,
  gutterWidth,
  REFS_COLUMN_WIDTH,
  type GraphMetrics,
} from "./layout";
import { pageOf, pagesForRange } from "./pages";
import { useGraphSearchState } from "./useGraphSearchState";
import { useWipCount } from "./useWipCount";
import { WipRow } from "./WipRow";

interface Props {
  repoId: string;
  /** Called when Enter is pressed on a row (focus the details panel). */
  onOpenDetails?: () => void;
}

/** Current window width, for sizing the compact lane gutter. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? 390 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** Commit graph: toolbar plus the virtualized list. Owns search and filter state. */
export function GraphView({ repoId, onOpenDetails }: Props) {
  const filter = useRepoStore((s) => s.filters[repoId]) ?? DEFAULT_FILTER;
  const setFilter = useRepoStore((s) => s.setFilter);
  const meta = useGraphMeta(repoId, filter);
  const refs = useRefs(repoId);
  const generation = meta.dataUpdatedAt;

  const { query, setQuery, matches, matchPos, step, jumpRef } = useGraphSearchState(
    repoId,
    generation,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing = target.tagName === "INPUT" || target.tagName === "SELECT";
    if ((e.key === "f" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" onKeyDown={onKeyDown}>
      <GraphToolbar
        query={query}
        onQuery={setQuery}
        current={matchPos + 1}
        total={matches.length}
        onNext={() => step(1)}
        onPrev={() => step(-1)}
        onEscape={() => listRef.current?.focus()}
        inputRef={searchRef}
        filter={filter}
        refs={refs.data}
        onFilter={(f) => setFilter(repoId, f)}
      />
      <WipRow
        repoId={repoId}
        gutter={gutterWidth(meta.data?.laneCount ?? 1)}
        offset={REFS_COLUMN_WIDTH}
      />
      <div className="relative min-h-0 flex-1">
        {meta.isError ? (
          <p role="alert" className="p-4 text-sm text-danger">
            Could not load history: {meta.error.message}
          </p>
        ) : meta.data ? (
          <GraphList
            key={generation}
            repoId={repoId}
            filter={filter}
            meta={meta.data}
            generation={generation}
            listRef={listRef}
            jumpRef={jumpRef}
            onOpenDetails={onOpenDetails}
          />
        ) : (
          <p className="p-4 text-sm text-fg-muted">Loading history…</p>
        )}
      </div>
    </div>
  );
}

export interface GraphListProps {
  repoId: string;
  filter: GraphFilter;
  meta: GraphMeta;
  generation: number;
  listRef: React.RefObject<HTMLDivElement | null>;
  jumpRef: React.RefObject<(index: number) => void>;
  onOpenDetails?: () => void;
  /** Two-line touch rows and compact metrics. */
  variant?: "desktop" | "compact";
  /** Compact: a row was tapped. */
  onOpenCommit?: (oid: string) => void;
}

export function GraphList({
  repoId,
  filter,
  meta,
  generation,
  listRef,
  jumpRef,
  onOpenDetails,
  variant = "desktop",
  onOpenCommit,
}: GraphListProps) {
  const compact = variant === "compact";
  const metrics: GraphMetrics = compact ? COMPACT_METRICS : DESKTOP_METRICS;
  const listWidth = useWindowWidth();
  const client = useQueryClient();
  const selection = useRepoStore((s) => s.selection[repoId]);
  const selectedOid = selectedOidOf(selection);
  const wipSelected = selection?.kind === "wip";
  const selectCommit = useRepoStore((s) => s.selectCommit);
  const selectWip = useRepoStore((s) => s.selectWip);
  const wip = useWipCount(repoId);
  const hasWip = wip.staged + wip.unstaged > 0;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<Palette | null>(null);
  const frameRef = useRef(0);
  const [cardIndex, setCardIndex] = useState<number | null>(null);
  const onCardOpenChange = useCallback(
    (index: number, open: boolean) =>
      setCardIndex((cur) => (open ? index : cur === index ? null : cur)),
    [],
  );
  const refsOffset = compact ? 0 : REFS_COLUMN_WIDTH;
  const gutter = gutterWidth(meta.laneCount, metrics, compact ? listWidth : undefined);
  const actionContext = useActionContext(repoId);
  const openMenu: OpenMenu = useCallback(
    (e, target) => {
      e.preventDefault();
      openActionMenu(e.clientX, e.clientY, target, actionContext());
    },
    [actionContext],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is used as documented
  const virtualizer = useVirtualizer({
    count: meta.rowCount,
    getScrollElement: () => listRef.current,
    estimateSize: () => metrics.rowHeight,
    overscan: metrics.overscan,
    initialRect: { width: 800, height: 600 },
  });
  const items = virtualizer.getVirtualItems();
  const first = items[0]?.index ?? 0;
  const last = items[items.length - 1]?.index ?? -1;

  const pages = useMemo(
    () => pagesForRange(first, last, meta.rowCount),
    [first, last, meta.rowCount],
  );
  const results = useQueries({
    queries: pages.map((p) => graphPageOptions(repoId, generation, filter, p)),
  });
  const pageData = new Map<number, GraphRow[]>();
  pages.forEach((p, i) => {
    const data = results[i]?.data;
    if (data) pageData.set(p, data);
  });
  const getRow = (index: number): GraphRow | undefined =>
    pageData.get(pageOf(index))?.[index % PAGE_SIZE];
  const getRowRef = useRef(getRow);
  useEffect(() => {
    getRowRef.current = getRow;
  });
  const dataVersion = pages.filter((p) => pageData.has(p)).join(",");

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const scroller = listRef.current;
    if (!canvas || !scroller) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const height = scroller.clientHeight || scroller.offsetHeight;
    const dpr = effectiveDpr(window.devicePixelRatio, metrics);
    if (canvas.width !== Math.round(gutter * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(gutter * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${gutter}px`;
      canvas.style.height = `${height}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paletteRef.current ??= readPalette();
    const wanted = new Set<string>();
    drawGraph({
      ctx,
      width: gutter,
      height,
      scrollTop: scroller.scrollTop,
      rowCount: meta.rowCount,
      headRow: meta.headRow,
      palette: paletteRef.current,
      getRow: (i) => getRowRef.current(i),
      metrics,
      getAvatar: metrics.avatarNodes
        ? (email) => {
            const img = peekAvatarImage(email);
            if (img === undefined) wanted.add(email);
            return img;
          }
        : undefined,
    });
    if (wanted.size > 0) requestAvatarImages(client, wanted, () => requestDrawRef.current());
  }, [client, gutter, listRef, meta.rowCount, meta.headRow, metrics]);

  const requestDraw = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);
  const requestDrawRef = useRef(requestDraw);
  useEffect(() => {
    requestDrawRef.current = requestDraw;
  });
  // Avatar batches resolve asynchronously: once unmounted, their callback must not draw.
  useEffect(
    () => () => {
      requestDrawRef.current = () => {};
    },
    [],
  );

  useEffect(() => {
    const scroller = listRef.current;
    if (!scroller) return;
    scroller.addEventListener("scroll", requestDraw, { passive: true });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(requestDraw) : null;
    ro?.observe(scroller);
    const off = onThemeChange(() => {
      paletteRef.current = readPalette();
      requestDraw();
    });
    return () => {
      scroller.removeEventListener("scroll", requestDraw);
      ro?.disconnect();
      off();
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [listRef, requestDraw]);

  useEffect(requestDraw, [requestDraw, dataVersion, selectedIndex, items.length]);

  /** Selects a row by index, loading its page first when needed. */
  const selectIndex = useCallback(
    async (raw: number, scroll = true) => {
      if (meta.rowCount === 0) return;
      const index = Math.max(0, Math.min(meta.rowCount - 1, raw));
      setSelectedIndex(index);
      if (scroll) virtualizer.scrollToIndex(index, { align: "auto" });
      const page = pageOf(index);
      const rows = await client.fetchQuery(graphPageOptions(repoId, generation, filter, page));
      const row = rows[index % PAGE_SIZE];
      if (row) selectCommit(repoId, row.oid);
    },
    [client, filter, generation, meta.rowCount, repoId, selectCommit, virtualizer],
  );
  useEffect(() => {
    jumpRef.current = (i) => void selectIndex(i);
  }, [jumpRef, selectIndex]);

  // Selecting the WIP row clears the highlighted commit row.
  useEffect(() => {
    if (wipSelected) setSelectedIndex(null);
  }, [wipSelected]);

  // External selection (parent links, sidebar refs): locate the commit and scroll to it.
  useEffect(() => {
    if (!selectedOid) return;
    if (selectedIndex !== null && getRowRef.current(selectedIndex)?.oid === selectedOid) return;
    let cancelled = false;
    void locateOid(client, repoId, generation, selectedOid).then((idx) => {
      if (cancelled || idx === null) return;
      setSelectedIndex(idx);
      virtualizer.scrollToIndex(idx, { align: "center" });
    });
    return () => {
      cancelled = true;
    };
    // selectedIndex is intentionally omitted: only react to selection changes from outside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOid, client, repoId, generation]);

  const openCompactMenu = useCallback(
    (row: GraphRow) =>
      openActionMenu(
        0,
        0,
        { kind: "commit", oid: row.oid, shortOid: row.shortOid },
        actionContext(),
      ),
    [actionContext],
  );

  const onRowSelect = (i: number) => {
    if (!compact) {
      void selectIndex(i, false);
      return;
    }
    const row = getRow(i);
    if (!row) return;
    setSelectedIndex(i);
    selectCommit(repoId, row.oid);
    onOpenCommit?.(row.oid);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const pageRows = Math.max(
      1,
      Math.floor((listRef.current?.clientHeight || 560) / metrics.rowHeight) - 1,
    );
    const cur = selectedIndex ?? -1;
    const selectedRow = cur >= 0 ? getRow(cur) : undefined;
    if (e.key === "Escape" && cardIndex !== null) {
      setCardIndex(null);
      return;
    }
    if (e.altKey && e.key === "Enter" && !compact && selectedRow) {
      e.preventDefault();
      setCardIndex(cur);
      return;
    }
    if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && selectedRow) {
      e.preventDefault();
      const rect = document.getElementById(`graph-row-${cur}`)?.getBoundingClientRect();
      openActionMenu(
        (rect?.left ?? 0) + refsOffset + gutter,
        rect?.bottom ?? 0,
        { kind: "commit", oid: selectedRow.oid, shortOid: selectedRow.shortOid },
        actionContext(),
      );
      return;
    }
    if (e.key === "ArrowUp" && cur === 0 && hasWip) {
      e.preventDefault();
      selectWip(repoId);
      return;
    }
    const moves: Record<string, number | undefined> = {
      ArrowDown: cur + 1,
      ArrowUp: Math.max(0, cur - 1),
      PageDown: cur + pageRows,
      PageUp: cur - pageRows,
      Home: 0,
      End: meta.rowCount - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      void selectIndex(moves[e.key] ?? 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onOpenDetails?.();
    }
  };

  return (
    <>
      <div
        ref={listRef}
        role="grid"
        aria-label="Commit graph"
        aria-rowcount={meta.rowCount}
        aria-activedescendant={selectedIndex !== null ? `graph-row-${selectedIndex}` : undefined}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-scroll-root={compact ? "" : undefined}
        className="absolute inset-0 overflow-x-hidden overflow-y-auto outline-none focus-visible:outline-none"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {items.map((item) => (
            <GraphRowView
              key={item.index}
              repoId={repoId}
              onMenu={openMenu}
              index={item.index}
              row={getRow(item.index)}
              top={item.start}
              gutter={gutter}
              selected={item.index === selectedIndex}
              onSelect={onRowSelect}
              compact={compact}
              rowHeight={metrics.rowHeight}
              onCompactMenu={compact ? openCompactMenu : undefined}
              cardOpen={item.index === cardIndex}
              onCardOpenChange={compact ? undefined : onCardOpenChange}
            />
          ))}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        aria-hidden
        data-testid="graph-canvas"
        className="pointer-events-none absolute top-0"
        style={{ left: refsOffset }}
      />
    </>
  );
}
