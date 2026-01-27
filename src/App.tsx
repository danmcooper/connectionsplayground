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

const smallTextThreshold = 8; // characters

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
  timezone?: string;
  anchor_print_date: string;
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

type AvailableDatesFile = {
  generated_at?: string;
  timezone?: string;
  dates: string[]; // YYYY-MM-DD[]
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

/**
 * Public “Connections Puzzle #” derived from NYT print_date (YYYY-MM-DD).
 * Puzzle #1 = 2023-06-12
 */
export function connectionsPuzzleNumber(printDate: string): number {
  const [y, m, d] = printDate.split("-").map(Number);
  const dateUtc = Date.UTC(y, m - 1, d);
  const epochUtc = Date.UTC(2023, 5, 12); // June 12, 2023
  return Math.floor((dateUtc - epochUtc) / 86_400_000) + 1;
}

function nytToTiles(data: NytConnectionsResponse): Tile[] {
  const allCards = data.categories.flatMap((c) => c.cards);
  if (allCards.length !== 16)
    throw new Error(`Expected 16 cards, got ${allCards.length}`);

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
  if (!res.ok)
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} (${url})`);
  return (await res.json()) as T;
}

function pickBestDateFromIndex(
  index: NytIndex,
  preferredDate: string,
): string | null {
  const avail = index.available ?? {};
  if (avail[preferredDate]?.ok) return preferredDate;
  if (index.anchor_print_date && avail[index.anchor_print_date]?.ok)
    return index.anchor_print_date;

  const okDates = Object.values(avail)
    .filter((v): v is { ok: true; printDate: string } => (v as any).ok)
    .map((v) => v.printDate)
    .sort();

  if (okDates.length === 0) return null;

  const toDayNum = (s: string) => {
    const [yy, mm, dd] = s.split("-").map(Number);
    return Math.floor(Date.UTC(yy, mm - 1, dd) / 86_400_000);
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

/* ---------------- localStorage: save only categorized groups + color ---------------- */

function storageKeyForPrintDate(printDate: string) {
  return `connections-playground::${printDate}`;
}

function loadSavedGroups(
  printDate: string,
  validTileIds: Set<string>,
): Group[] {
  try {
    const raw = localStorage.getItem(storageKeyForPrintDate(printDate));
    if (!raw) return [];

    const parsed = JSON.parse(raw) as {
      groups?: Array<Pick<Group, "id" | "color" | "tileIds">>;
    };
    const groups = Array.isArray(parsed.groups) ? parsed.groups : [];

    const cleaned: Group[] = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.tileIds) || g.tileIds.length !== 4) continue;
      if (!g.color) continue;
      if (
        g.tileIds.some((id) => typeof id !== "string" || !validTileIds.has(id))
      )
        continue;

      cleaned.push({
        id: typeof g.id === "string" ? g.id : uid("group"),
        color: g.color as ColorKey,
        tileIds: g.tileIds,
      });
    }

    return cleaned;
  } catch {
    return [];
  }
}

function saveGroups(printDate: string, groups: Group[]) {
  try {
    localStorage.setItem(
      storageKeyForPrintDate(printDate),
      JSON.stringify({ groups }),
    );
  } catch {
    // ignore
  }
}

/* ---------------- date picker helpers ---------------- */

function nearestAvailableDate(
  target: string,
  datesAsc: string[],
): string | null {
  if (datesAsc.length === 0) return null;
  if (datesAsc.includes(target)) return target;

  const toDayNum = (s: string) => {
    const [yy, mm, dd] = s.split("-").map(Number);
    return Math.floor(Date.UTC(yy, mm - 1, dd) / 86_400_000);
  };

  const t = toDayNum(target);
  let best = datesAsc[0];
  let bestDist = Math.abs(toDayNum(best) - t);

  for (const d of datesAsc) {
    const dist = Math.abs(toDayNum(d) - t);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

export default function App() {
  const [tiles, setTiles] = useState<Tile[]>(fallbackTiles);
  const [baseTiles, setBaseTiles] = useState<Tile[]>(fallbackTiles);
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
  const [requestedDate, setRequestedDate] = useState<string | null>(null);

  // available dates + picker state
  const [availableDatesAsc, setAvailableDatesAsc] = useState<string[]>([]);
  const [pickedDate, setPickedDate] = useState<string>(
    fmtLocalYYYYMMDD(new Date()),
  );

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
    const onKeyDown = (e: KeyboardEvent) =>
      e.key === "Escape" && setShowColorPicker(false);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showColorPicker]);

  // Load available-dates.json (truth from disk)
  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJson<AvailableDatesFile>(
          nytUrl("nyt/available-dates.json"),
        );
        const dates = Array.isArray(data.dates)
          ? data.dates.slice().sort()
          : [];
        setAvailableDatesAsc(dates);
      } catch {
        setAvailableDatesAsc([]);
      }
    })();
  }, []);

  async function loadPuzzleByDate(dateStr: string) {
    setLoading(true);
    setError(null);
    setRequestedDate(dateStr);

    const applyLoadedPuzzle = (data: NytConnectionsResponse) => {
      const nextTiles = nytToTiles(data);
      const tileIdSet = new Set(nextTiles.map((t) => t.id));

      setNytMeta({
        id: data.id,
        print_date: data.print_date,
        editor: data.editor,
      });
      setTiles(nextTiles);
      setBaseTiles(nextTiles);

      // restore saved groups for this print_date
      const saved = loadSavedGroups(data.print_date, tileIdSet);
      setGroups(saved);

      // keep picker in sync with actual loaded date
      setPickedDate(data.print_date);

      setSelected(new Set());
      setShowColorPicker(false);
      setLoading(false);
    };

    // ✅ CHANGE: try the exact date file FIRST (so old dates load properly)
    try {
      const data = await fetchJson<NytConnectionsResponse>(
        nytUrl(`nyt/${dateStr}.json`),
      );
      if (data.status !== "OK")
        throw new Error(`Puzzle status not OK: ${data.status}`);
      applyLoadedPuzzle(data);
      return;
    } catch {
      // fall through to index.json / latest
    }

    try {
      const index = await fetchJson<NytIndex>(nytUrl("nyt/index.json"));
      const bestDate = pickBestDateFromIndex(index, dateStr);

      if (bestDate) {
        const data = await fetchJson<NytConnectionsResponse>(
          nytUrl(`nyt/${bestDate}.json`),
        );
        if (data.status !== "OK")
          throw new Error(`Puzzle status not OK: ${data.status}`);
        applyLoadedPuzzle(data);
        return;
      }
    } catch {
      // fall through
    }

    try {
      const data = await fetchJson<NytConnectionsResponse>(
        nytUrl("nyt/latest.json"),
      );
      if (data.status !== "OK")
        throw new Error(`Puzzle status not OK: ${data.status}`);
      applyLoadedPuzzle(data);
      return;
    } catch (e: any) {
      setError(e?.message ?? "Failed to load local NYT puzzle files");
      setLoading(false);
    }
  }

  // Default on load/reload: current local day
  useEffect(() => {
    const localDate = fmtLocalYYYYMMDD(new Date());
    setPickedDate(localDate);
    loadPuzzleByDate(localDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist groups whenever they change (keyed by the puzzle print_date)
  const storagePrintDate = nytMeta?.print_date ?? null;
  useEffect(() => {
    if (!storagePrintDate) return;
    saveGroups(storagePrintDate, groups);
  }, [groups, storagePrintDate]);

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
    if (groups.some((g) => g.color === color)) return;

    const tileIds = Array.from(selected);
    for (const id of tileIds) if (groupedTileIds.has(id)) return;

    const newGroup: Group = { id: uid("group"), color, tileIds };
    setGroups((prev) => [...prev, newGroup]);

    setShowColorPicker(false);
    clearSelection();
  };

  const bringTileIdsToFront = (tileIds: string[]) => {
    setTiles((prev) => {
      const frontSet = new Set(tileIds);
      const byId = new Map(prev.map((t) => [t.id, t] as const));
      const front: Tile[] = tileIds
        .map((id) => byId.get(id))
        .filter((t): t is Tile => Boolean(t));
      const rest = prev.filter((t) => !frontSet.has(t.id));
      return [...front, ...rest];
    });
  };

  const onClickGroupedTile = (clickedTileId: string) => {
    const g = groups.find((gr) => gr.tileIds.includes(clickedTileId));
    if (!g) return;

    const otherThree = g.tileIds.filter((id) => id !== clickedTileId);

    setGroups((prev) => prev.filter((gr) => gr.id !== g.id));
    setSelected(new Set(otherThree));
    setShowColorPicker(false);

    bringTileIdsToFront(g.tileIds);
  };

  const resetAll = () => {
    setTiles(baseTiles);
    setGroups([]);
    clearSelection();
    setShowColorPicker(false);
  };

  const puzzleNumber = nytMeta?.print_date
    ? connectionsPuzzleNumber(nytMeta.print_date)
    : null;

  // date picker handlers
  const availableDatesDesc = useMemo(
    () => availableDatesAsc.slice().reverse(),
    [availableDatesAsc],
  );

  const onPickDate = (next: string) => {
    setPickedDate(next);

    if (availableDatesAsc.length > 0) {
      const nearest = nearestAvailableDate(next, availableDatesAsc);
      if (nearest) loadPuzzleByDate(nearest);
      return;
    }

    loadPuzzleByDate(next);
  };

  const goToToday = () => {
    const today = fmtLocalYYYYMMDD(new Date());
    onPickDate(today);
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
                    {puzzleNumber !== null ? (
                      <>Puzzle #{puzzleNumber} • </>
                    ) : null}
                    {nytMeta.print_date}
                  </>
                ) : (
                  <>Requested {requestedDate}</>
                )}
              </div>
            )}
          </div>
        )}

        {/* Date picker */}
        <div className="nytDateRow">
          <select
            className="nytDateSelect"
            value={pickedDate}
            onChange={(e) => onPickDate(e.target.value)}
            aria-label="Pick a date"
          >
            {availableDatesDesc.length > 0 ? (
              availableDatesDesc.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))
            ) : (
              <option value={pickedDate}>{pickedDate}</option>
            )}
          </select>

          <button className="nytTodayBtn" type="button" onClick={goToToday}>
            Today
          </button>
        </div>

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
                      onClick={() => onClickGroupedTile(id)}
                      title="Click to uncategorize (keeps other 3 selected)"
                      type="button"
                      className={`nytTile locked ${g.color} ${
                        t?.text && t.text.length > smallTextThreshold
                          ? "smallText"
                          : ""
                      }`}
                    >
                      {t?.text}
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
                  onClick={() => toggleSelect(t.id)}
                  aria-pressed={isSelected}
                  type="button"
                  className={`nytTile ${isSelected ? "selected" : ""} ${
                    t.text.length > smallTextThreshold ? "smallText" : ""
                  }`}
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
