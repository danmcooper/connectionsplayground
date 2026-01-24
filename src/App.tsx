import { useEffect, useMemo, useState } from "react";
import "./App.css";

type ColorKey = "yellow" | "green" | "blue" | "purple";

const COLORS: { key: ColorKey; label: string }[] = [
  { key: "yellow", label: "Yellow" },
  { key: "green", label: "Green" },
  { key: "blue", label: "Blue" },
  { key: "purple", label: "Purple" },
];

type Tile = { id: string; text: string };

type Group = {
  id: string;
  color: ColorKey;
  tileIds: string[]; // exactly 4
};

const fallbackTiles: Tile[] = [
  { id: "t1", text: "STONE" },
  { id: "t2", text: "TEMPLE" },
  { id: "t3", text: "PILOT" },
  { id: "t4", text: "LIP" },
  { id: "t5", text: "STREET" },
  { id: "t6", text: "CHEEK" },
  { id: "t7", text: "FOOT" },
  { id: "t8", text: "TRAFFIC" },
  { id: "t9", text: "EYE" },
  { id: "t10", text: "ACRE" },
  { id: "t11", text: "FLOOD" },
  { id: "t12", text: "METER" },
  { id: "t13", text: "GARAGE" },
  { id: "t14", text: "LIME" },
  { id: "t15", text: "BUSHEL" },
  { id: "t16", text: "VALET" },
];

type NytConnectionsResponse = {
  status: "OK" | string;
  id: number;
  print_date: string; // YYYY-MM-DD
  editor?: string;
  categories: Array<{
    title: string;
    cards: Array<{
      content: string;
      position: number; // 0..15
    }>;
  }>;
};

type NytIndex = {
  generated_at?: string;
  timezone?: string; // likely "America/New_York" from your workflow
  anchor_print_date: string; // the date the workflow considers "today" in NY
  range?: { from: number; to: number };
  available: Record<
    string,
    | { ok: true; printDate: string; id?: number; editor?: string }
    | {
        ok: false;
        printDate: string;
        status?: number | string;
        statusText?: string;
      }
  >;
};

function uid(prefix = "g") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/** Prefix paths with Vite BASE_URL so it works on GitHub Pages (/connectionsplayground/...). */
function nytUrl(path: string) {
  const base = import.meta.env.BASE_URL; // "/" locally, "/connectionsplayground/" on Pages
  const clean = path.replace(/^\//, "");
  return `${base}${clean}`;
}

/** YYYY-MM-DD in *browser local time* */
function fmtLocalYYYYMMDD(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function nytToTiles(data: NytConnectionsResponse): Tile[] {
  const allCards = data.categories.flatMap((c) => c.cards);
  if (allCards.length !== 16) {
    throw new Error(`Expected 16 cards, got ${allCards.length}`);
  }

  return allCards
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((card) => ({
      id: `nyt_${data.id}_${card.position}`,
      text: card.content.toUpperCase(),
    }));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  return (await res.json()) as T;
}

function pickBestDateFromIndex(
  index: NytIndex,
  preferredDate: string,
): string | null {
  const avail = index.available ?? {};
  if (avail[preferredDate]?.ok) return preferredDate;

  // Try anchor_print_date next (what your workflow considers “today” in NY)
  if (index.anchor_print_date && avail[index.anchor_print_date]?.ok)
    return index.anchor_print_date;

  // Otherwise pick the nearest "ok" date by absolute day difference
  const okDates = Object.values(avail)
    .filter((v): v is { ok: true; printDate: string } => (v as any).ok)
    .map((v) => v.printDate)
    .sort();

  if (okDates.length === 0) return null;

  const toDayNum = (s: string) => {
    const [yy, mm, dd] = s.split("-").map(Number);
    return Math.floor(Date.UTC(yy, mm - 1, dd) / 86400000);
  };

  const target = toDayNum(preferredDate);
  let best = okDates[0];
  let bestDist = Math.abs(toDayNum(best) - target);

  for (const d of okDates) {
    const dist = Math.abs(toDayNum(d) - target);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }

  return best;
}

export default function App() {
  const [tiles, setTiles] = useState<Tile[]>(fallbackTiles);
  const [baseTiles, setBaseTiles] = useState<Tile[]>(fallbackTiles); // Reset returns to current loaded puzzle
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showColorPicker, setShowColorPicker] = useState(false);

  // puzzle load status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nytMeta, setNytMeta] = useState<{
    id: number;
    print_date: string;
    editor?: string;
  } | null>(null);

  // what date we attempted/loaded (local date string)
  const [requestedDate, setRequestedDate] = useState<string | null>(null);

  const usedColors = useMemo(
    () => new Set(groups.map((g) => g.color)),
    [groups],
  );

  const groupedTileIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) for (const id of g.tileIds) s.add(id);
    return s;
  }, [groups]);

  const ungroupedTiles = useMemo(
    () => tiles.filter((t) => !groupedTileIds.has(t.id)),
    [tiles, groupedTileIds],
  );

  const selectedCount = selected.size;

  // ESC closes modal
  useEffect(() => {
    if (!showColorPicker) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowColorPicker(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showColorPicker]);

  async function loadPuzzleByDate(dateStr: string) {
    setLoading(true);
    setError(null);
    setRequestedDate(dateStr);

    // 1) Prefer index-driven load (lets us gracefully handle missing dates)
    try {
      const index = await fetchJson<NytIndex>(nytUrl("nyt/index.json"));
      const bestDate = pickBestDateFromIndex(index, dateStr);

      if (bestDate) {
        const data = await fetchJson<NytConnectionsResponse>(
          nytUrl(`nyt/${bestDate}.json`),
        );
        if (data.status !== "OK")
          throw new Error(`Puzzle status not OK: ${data.status}`);

        const nextTiles = nytToTiles(data);
        setNytMeta({
          id: data.id,
          print_date: data.print_date,
          editor: data.editor,
        });
        setTiles(nextTiles);
        setBaseTiles(nextTiles);
        setGroups([]);
        setSelected(new Set());
        setShowColorPicker(false);
        setLoading(false);
        return;
      }
    } catch {
      // If index.json is missing or malformed, fall through to direct-date + latest.json
    }

    // 2) Try the exact date file (works even without index.json)
    try {
      const data = await fetchJson<NytConnectionsResponse>(
        nytUrl(`nyt/${dateStr}.json`),
      );
      if (data.status !== "OK")
        throw new Error(`Puzzle status not OK: ${data.status}`);

      const nextTiles = nytToTiles(data);
      setNytMeta({
        id: data.id,
        print_date: data.print_date,
        editor: data.editor,
      });
      setTiles(nextTiles);
      setBaseTiles(nextTiles);
      setGroups([]);
      setSelected(new Set());
      setShowColorPicker(false);
      setLoading(false);
      return;
    } catch {
      // ignore, try latest
    }

    // 3) Last resort: latest.json (if your workflow writes it)
    try {
      const data = await fetchJson<NytConnectionsResponse>(
        nytUrl("nyt/latest.json"),
      );
      if (data.status !== "OK")
        throw new Error(`Puzzle status not OK: ${data.status}`);

      const nextTiles = nytToTiles(data);
      setNytMeta({
        id: data.id,
        print_date: data.print_date,
        editor: data.editor,
      });
      setTiles(nextTiles);
      setBaseTiles(nextTiles);
      setGroups([]);
      setSelected(new Set());
      setShowColorPicker(false);
      setLoading(false);
      return;
    } catch (e: any) {
      setError(e?.message ?? "Failed to load local NYT puzzle files");
      setLoading(false);
    }
  }

  // Load puzzle for *local* day on mount
  useEffect(() => {
    const localDate = fmtLocalYYYYMMDD(new Date());
    loadPuzzleByDate(localDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelect = (tileId: string) => {
    if (groupedTileIds.has(tileId)) return;

    setSelected((prev) => {
      const next = new Set(prev);

      if (next.has(tileId)) {
        next.delete(tileId);
        return next;
      }

      if (next.size >= 4) return next;

      next.add(tileId);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const shuffleUngrouped = () => {
    setTiles((prev) => {
      const ungrouped = prev.filter((t) => !groupedTileIds.has(t.id));
      for (let i = ungrouped.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ungrouped[i], ungrouped[j]] = [ungrouped[j], ungrouped[i]];
      }
      const grouped = prev.filter((t) => groupedTileIds.has(t.id));
      return [...ungrouped, ...grouped];
    });
    clearSelection();
  };

  const openCategorize = () => {
    if (selected.size !== 4) return;
    setShowColorPicker(true);
  };

  const categorize = (color: ColorKey) => {
    if (selected.size !== 4) return;

    // block reuse of a color
    if (groups.some((g) => g.color === color)) return;

    const tileIds = Array.from(selected);
    for (const id of tileIds) {
      if (groupedTileIds.has(id)) return;
    }

    const newGroup: Group = { id: uid("group"), color, tileIds };
    setGroups((prev) => [...prev, newGroup]);

    setShowColorPicker(false);
    clearSelection();
  };

  // Click a grouped tile => group dissolves; other 3 remain selected (gray) in grid.
  const onClickGroupedTile = (clickedTileId: string) => {
    const g = groups.find((gr) => gr.tileIds.includes(clickedTileId));
    if (!g) return;

    const otherThree = g.tileIds.filter((id) => id !== clickedTileId);

    setGroups((prev) => prev.filter((gr) => gr.id !== g.id));
    setSelected(new Set(otherThree));
    setShowColorPicker(false);
  };

  const resetAll = () => {
    setTiles(baseTiles);
    setGroups([]);
    clearSelection();
    setShowColorPicker(false);
  };

  return (
    <div className="nytPage">
      <div className="nytFrame">
        <header className="nytTopbar">
          <button className="iconBtn" aria-label="Menu" type="button">
            ☰
          </button>

          <div className="nytBrand">
            <div className="nytTitle">Connections Playground</div>
          </div>

          <div className="nytTopbarRight">
            <button className="iconBtn" aria-label="Help" type="button">
              ?
            </button>
          </div>
        </header>

        <div className="nytHeadline">
          <div className="nytPrompt">Create four groups of four!</div>
        </div>

        {(loading || error || nytMeta || requestedDate) && (
          <div className="nytStatus" role="status" aria-live="polite">
            {loading && <div>Loading local puzzle files…</div>}
            {!loading && error && <div className="nytError">{error}</div>}
            {!loading && !error && (
              <div className="nytMeta">
                {nytMeta ? (
                  <>
                    Loaded {nytMeta.print_date} • #{nytMeta.id}
                    {nytMeta.editor ? ` • Editor: ${nytMeta.editor}` : ""}
                  </>
                ) : (
                  <>Requested {requestedDate}</>
                )}
              </div>
            )}
          </div>
        )}

        {/* Categorized rows */}
        <section className="nytRows">
          {groups.map((g) => (
            <div key={g.id} className={`nytSolvedRow ${g.color}`}>
              <div className="nytGrid">
                {g.tileIds.map((id) => {
                  const t = tiles.find((x) => x.id === id);
                  return (
                    <button
                      key={id}
                      className={`nytTile locked ${g.color}`}
                      onClick={() => onClickGroupedTile(id)}
                      title="Click to uncategorize (keeps other 3 selected)"
                      type="button"
                    >
                      {t?.text ?? id}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {/* Main grid */}
        <section className="nytGridWrap">
          <div className="nytGrid">
            {ungroupedTiles.map((t) => {
              const isSelected = selected.has(t.id);
              return (
                <button
                  key={t.id}
                  className={`nytTile ${isSelected ? "selected" : ""}`}
                  onClick={() => toggleSelect(t.id)}
                  aria-pressed={isSelected}
                  type="button"
                >
                  {t.text}
                </button>
              );
            })}
          </div>
        </section>

        <div className="nytMistakes"></div>

        <section className="nytControls">
          <button className="pillBtn" onClick={shuffleUngrouped} type="button">
            Shuffle
          </button>

          <button
            className="pillBtn"
            onClick={clearSelection}
            disabled={selectedCount === 0}
            type="button"
          >
            Deselect All
          </button>

          <button
            className="pillBtn primary"
            onClick={openCategorize}
            disabled={selectedCount !== 4}
            type="button"
          >
            Categorize
          </button>
        </section>

        <div className="nytBottomBar">
          <button className="linkBtn" onClick={resetAll} type="button">
            Reset
          </button>

          <button
            className="linkBtn"
            type="button"
            onClick={() => loadPuzzleByDate(fmtLocalYYYYMMDD(new Date()))}
            title="Reload puzzle for your local date"
          >
            Reload Today
          </button>

          <span className="tiny">
            Selected: <b>{selectedCount}</b>/4
          </span>
        </div>

        {/* Centered, smaller modal */}
        {showColorPicker && (
          <div
            className="modalOverlay"
            onClick={() => setShowColorPicker(false)}
          >
            <div
              className="modal small"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="modalTitle">Categorize as…</div>

              <div className="modalRow">
                {COLORS.map((c) => {
                  const isUsed = usedColors.has(c.key);
                  return (
                    <button
                      key={c.key}
                      className={`colorPill ${c.key}`}
                      onClick={() => categorize(c.key)}
                      type="button"
                      disabled={isUsed}
                      aria-disabled={isUsed}
                      title={isUsed ? "Already used" : undefined}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>

              <button
                className="pillBtn subtle full"
                onClick={() => setShowColorPicker(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
