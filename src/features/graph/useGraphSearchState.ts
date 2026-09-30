import { useEffect, useMemo, useRef, useState } from "react";
import { useGraphSearch } from "@/ipc/queries";

/** Debounced commit search over the graph with next/previous stepping. */
export function useGraphSearchState(repoId: string, generation: number) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pos, setPos] = useState<{ matches: number[]; at: number }>({ matches: [], at: -1 });
  const jumpRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);
  const search = useGraphSearch(repoId, generation, debounced);
  const matches = useMemo(
    () => (debounced.trim() && search.data ? search.data : []),
    [debounced, search.data],
  );
  const matchPos = pos.matches === matches ? pos.at : -1;

  const step = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next =
      matchPos < 0
        ? dir === 1
          ? 0
          : matches.length - 1
        : (matchPos + dir + matches.length) % matches.length;
    setPos({ matches, at: next });
    jumpRef.current(matches[next] ?? 0);
  };

  return { query, setQuery, matches, matchPos, step, jumpRef };
}
