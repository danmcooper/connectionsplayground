import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
type ColorKey = "yellow" | "green" | "blue" | "purple";

const SELECT_COLOR_OPTIONS: Array<{ key: ColorKey; label: string }> = [
  { key: "yellow", label: "Yellow" },
  { key: "green", label: "Green" },
  { key: "blue", label: "Blue" },
  { key: "purple", label: "Purple" },
];

type Tile =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "image"; imageUrl: string; alt: string };

function isImageTile(t: Tile): t is Extract<Tile, { kind: "image" }> {
  return t.kind === "image";
}

function getTileText(t: Tile): string {
  // Used for sizing logic + fallback; for images use alt text
  return isImageTile(t) ? t.alt : t.text;
}

function TileFace({ tile }: { tile: Tile }) {
  if (isImageTile(tile)) {
    return (
      <img
        className="nytTileImg"
        src={tile.imageUrl}
        alt={tile.alt}
        loading="lazy"
        draggable={false}
      />
    );
  }
  return <>{tile.text}</>;
}

type Group = {
  id: string;
  color: ColorKey;
  tileIds: string[]; // exactly 4
};

const fallbackTiles: Tile[] = [
  { id: "t1", text: "STONE", kind: "text" },
  { id: "t2", text: "TEMPLE", kind: "text" },
  { id: "t3", text: "PILOT", kind: "text" },
  { id: "t4", text: "LIP", kind: "text" },
  { id: "t5", text: "STREET", kind: "text" },
  { id: "t6", text: "CHEEK", kind: "text" },
  { id: "t7", text: "FOOT", kind: "text" },
  { id: "t8", text: "TRAFFIC", kind: "text" },
  { id: "t9", text: "EYE", kind: "text" },
  { id: "t10", text: "ACRE", kind: "text" },
  { id: "t11", text: "FLOOD", kind: "text" },
  { id: "t12", text: "METER", kind: "text" },
  { id: "t13", text: "GARAGE", kind: "text" },
  { id: "t14", text: "LIME", kind: "text" },
  { id: "t15", text: "BUSHEL", kind: "text" },
  { id: "t16", text: "VALET", kind: "text" },
];

const smallTextThreshold = 7; // characters

type NytConnectionsResponse = {
  status: "OK" | string;
  id: number;
  print_date: string; // YYYY-MM-DD
  editor?: string;
  categories: Array<{
    title: string;
    cards: Array<
      | { content: string; position: number }
      | { image_url: string; image_alt_text?: string; position: number }
    >;
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

/** Parse YYYY-MM-DD as a local-midnight Date */

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
    .map((card) => {
      const anyCard = card as any;

      if (typeof anyCard.content === "string") {
        return {
          id: `nyt_${data.id}_${anyCard.position}`,
          kind: "text" as const,
          text: anyCard.content.toUpperCase(),
        };
      }

      if (typeof anyCard.image_url === "string") {
        return {
          id: `nyt_${data.id}_${anyCard.position}`,
          kind: "image" as const,
          imageUrl: anyCard.image_url,
          alt: ((anyCard.image_alt_text || "image") as string).toUpperCase(),
        };
      }

      throw new Error("Unsupported NYT card type");
    });
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

function tilePosKeyForPrintDate(printDate: string) {
  return `connections-playground::${printDate}::dragPos`;
}

function loadSavedTilePos(
  printDate: string,
  validTileIds: Set<string>,
): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(tilePosKeyForPrintDate(printDate));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { x: number; y: number }>;
    const out: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of Object.entries(parsed ?? {})) {
      if (!validTileIds.has(id)) continue;
      if (!p || typeof p.x !== "number" || typeof p.y !== "number") continue;
      out[id] = { x: p.x, y: p.y };
    }
    return out;
  } catch {
    return {};
  }
}

function saveTilePos(
  printDate: string,
  pos: Record<string, { x: number; y: number }>,
) {
  try {
    localStorage.setItem(tilePosKeyForPrintDate(printDate), JSON.stringify(pos));
  } catch {
    // ignore
  }
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

/* ---------------- date helpers ---------------- */

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

function clampToAvailable(target: string, datesAsc: string[]): string | null {
  if (datesAsc.length === 0) return target; // no availability file? allow any
  return nearestAvailableDate(target, datesAsc);
}

function formatDateLabel(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d); // local calendar date

  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ymdFromUTCDate(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthKeyFromYMD(ymd: string) {
  return ymd.slice(0, 7); // YYYY-MM
}

/* ---------------- Sophisticated DatePicker ---------------- */

function DatePicker({
  value,
  availableDatesAsc,
  onChange,
  onReset,
}: {
  value: string;
  availableDatesAsc: string[];
  onChange: (next: string) => void;
  onReset: () => void;
}) {
  const availableSet = useMemo(
    () => new Set(availableDatesAsc),
    [availableDatesAsc],
  );

  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthKeyFromYMD(value));
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMonth(monthKeyFromYMD(value)), [value]);

  // close on outside click + Escape
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    const onDown = (e: MouseEvent) => {
      const el = popoverRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const idx = availableDatesAsc.indexOf(value);
  const hasPrev = availableDatesAsc.length > 0 ? idx > 0 : false;
  const hasNext =
    availableDatesAsc.length > 0
      ? idx >= 0 && idx < availableDatesAsc.length - 1
      : false;

  const goPrev = () => {
    if (!hasPrev) return;
    onChange(availableDatesAsc[idx - 1]);
  };

  const goNext = () => {
    if (!hasNext) return;
    onChange(availableDatesAsc[idx + 1]);
  };

  const monthStartUTC = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
  }, [month]);

  const firstDow = monthStartUTC.getUTCDay(); // 0=Sun
  const daysInMonth = useMemo(() => {
    const y = monthStartUTC.getUTCFullYear();
    const m = monthStartUTC.getUTCMonth();
    return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  }, [monthStartUTC]);

  const gridCells = useMemo(() => {
    const cells: Array<{ ymd: string; inMonth: boolean; enabled: boolean }> =
      [];
    const start = new Date(monthStartUTC);
    start.setUTCDate(1 - firstDow);

    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);

      const ymd = ymdFromUTCDate(d);
      const inMonth = d.getUTCMonth() === monthStartUTC.getUTCMonth();
      const enabled =
        availableDatesAsc.length > 0 ? availableSet.has(ymd) : true;

      cells.push({ ymd, inMonth, enabled });
    }
    return cells;
  }, [monthStartUTC, firstDow, availableSet, availableDatesAsc.length]);

  const moveMonth = (delta: number) => {
    const y = monthStartUTC.getUTCFullYear();
    const m = monthStartUTC.getUTCMonth();
    const next = new Date(Date.UTC(y, m + delta, 1));
    setMonth(ymdFromUTCDate(next).slice(0, 7));
  };

  const jumpTo = (ymd: string) => {
    const next = clampToAvailable(ymd, availableDatesAsc);
    if (next) onChange(next);
    setOpen(false);
  };

  const monthTitle = useMemo(() => {
    const mid = new Date(monthStartUTC);
    mid.setUTCDate(Math.min(15, daysInMonth));
    return mid.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }, [monthStartUTC, daysInMonth]);

  return (
    <div className="nytDatePicker" ref={popoverRef}>
      <button
        className="nytNavBtn"
        type="button"
        disabled={!hasPrev}
        onClick={goPrev}
        aria-label="Previous date"
      >
        ‹
      </button>

      <button
        className="nytDateBtn"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Pick a date"
      >
        {formatDateLabel(value)}
      </button>

      <button
        className="nytNavBtn"
        type="button"
        disabled={!hasNext}
        onClick={goNext}
        aria-label="Next date"
      >
        ›
      </button>

      <button className="nytTodayBtn" type="button" onClick={onReset}>
        Reset
      </button>

      {open && (
        <div className="nytCal" role="dialog" aria-label="Date picker">
          <div className="nytCalHeader">
            <button
              className="nytCalArrow"
              type="button"
              onClick={() => moveMonth(-1)}
              aria-label="Previous month"
            >
              ‹
            </button>
            <div className="nytCalMonth">{monthTitle}</div>
            <button
              className="nytCalArrow"
              type="button"
              onClick={() => moveMonth(1)}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="nytCalDow">
            {["S", "M", "T", "W", "T", "F", "S"].map((d) => (
              <div key={d} className="nytCalDowCell">
                {d}
              </div>
            ))}
          </div>

          <div className="nytCalGrid">
            {gridCells.map((c) => {
              const day = c.ymd.slice(8, 10);
              const isSelected = c.ymd === value;

              const cls = [
                "nytCalCell",
                c.inMonth ? "inMonth" : "outMonth",
                c.enabled ? "enabled" : "disabled",
                isSelected ? "false" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <button
                  key={c.ymd}
                  type="button"
                  className={cls}
                  disabled={!c.enabled}
                  onClick={() => jumpTo(c.ymd)}
                  title={c.enabled ? c.ymd : "Not available"}
                >
                  {String(Number(day))}
                </button>
              );
            })}
          </div>

          <button
            className="nytCalClose"
            type="button"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

export default function DragStyle() {
  const [tiles, setTiles] = useState<Tile[]>(fallbackTiles);
const [groups, setGroups] = useState<Group[]>([]);

  // puzzle load status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nytMeta, setNytMeta] = useState<{
    id: number;
    print_date: string;
    editor?: string;
  } | null>(null);
  const [requestedDate, setRequestedDate] = useState<string | null>(null);

  // keep the real solution tile ids by color for current loaded puzzle
// available dates + picker state
  const [availableDatesAsc, setAvailableDatesAsc] = useState<string[]>([]);
  const [pickedDate, setPickedDate] = useState<string>(
    fmtLocalYYYYMMDD(new Date()),
  );
const [isColorMode, setIsColorMode] = useState(false);
const [selected, setSelected] = useState<Set<string>>(() => new Set());
const [manualTileColor, setManualTileColor] = useState<
  Record<string, ColorKey | undefined>
>({});
const groupedTileIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) for (const id of g.tileIds) s.add(id);
    return s;
  }, [groups]);

  const ungroupedTiles = useMemo(
  () => tiles.filter((t) => !groupedTileIds.has(t.id)),
  [tiles, groupedTileIds],
);

const toggleSelectTile = (tileId: string) => {
  setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(tileId)) next.delete(tileId);
    else next.add(tileId);
    return next;
  });
};

const deselectAll = () => {
  setManualTileColor((prev) => {
    const next = { ...prev };
    for (const id of selected) delete next[id];
    return next;
  });
  setSelected(new Set());
};

const applyColorToSelected = (color: ColorKey) => {
  setManualTileColor((prev) => {
    const next = { ...prev };
    for (const id of selected) next[id] = color;
    return next;
  });
  setSelected(new Set());
};

  // Freeform drag (physical tiles)
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [tileSize, setTileSize] = useState<number>(0);
  const [boardSize, setBoardSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [tilePos, setTilePos] = useState<Record<string, { x: number; y: number }>>({});
  const dragStateRef = useRef<{
    id: string;
    dx: number;
    dy: number;
  } | null>(null);

  // Keep board measurements in sync with layout (matches 4x4 tile grid width)
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;

    const recompute = () => {
      const w = el.clientWidth;
      const gap = 10;
      const size = Math.floor((w - gap * 3) / 4);

      // Use as much vertical space as we have below the board's top, so you can
      // drag tiles anywhere in the lower area like physical tiles.
      const rect = el.getBoundingClientRect();
      const viewportH =
        window.visualViewport?.height ?? document.documentElement.clientHeight;
      const availableH = Math.max(0, viewportH - rect.top - 12);

      const minH = size * 4 + gap * 3; // at least the original 4x4 area
      const h = Math.max(minH, availableH);

      setTileSize(size);
      setBoardSize({ w, h });
    };

    recompute();

    const ro = new ResizeObserver(() => recompute());
    ro.observe(el);

    const onWin = () => recompute();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, { passive: true });

    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin);
      ro.disconnect();
    };
  }, []);

  // Initialize positions in a 4x4 grid whenever puzzle changes
  useEffect(() => {
    if (tileSize <= 0) return;

    const gap = 10;

    // Add extra vertical spacing between rows (about 2/3 tile height) to make
    // drag-and-drop easier — but clamp so all 16 tiles still fit in the board.
    const desiredExtra = Math.floor(tileSize / 3);

    const baseHeight = tileSize * 4 + gap * 3;
    const extraBudget = Math.max(0, (boardSize.h || 0) - baseHeight);
    const maxExtraPerGap = Math.floor(extraBudget / 3);
    const extraY = Math.max(0, Math.min(desiredExtra, maxExtraPerGap));

    setTilePos((prev) => {
      const next: Record<string, { x: number; y: number }> = { ...prev };

      for (let i = 0; i < ungroupedTiles.length; i++) {
        const id = ungroupedTiles[i].id;
        if (next[id]) continue; // keep any restored/saved position

        const col = i % 4;
        const row = Math.floor(i / 4);

        next[id] = {
          x: col * (tileSize + gap),
          y: row * (tileSize + gap + extraY),
        };
      }

      // prune positions for tiles no longer present
      const ids = new Set(ungroupedTiles.map((t) => t.id));
      for (const id of Object.keys(next)) if (!ids.has(id)) delete next[id];

      return next;
    });
  }, [ungroupedTiles, tileSize, boardSize.h]);

  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

  const onTilePointerDown = (tileId: string) => (e: ReactPointerEvent) => {
    if (isColorMode) return;

    const el = boardRef.current;
    if (!el) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const rect = el.getBoundingClientRect();
    const p = tilePos[tileId] ?? { x: 0, y: 0 };
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    dragStateRef.current = { id: tileId, dx: px - p.x, dy: py - p.y };

    // bring to front while dragging
    setTilePos((prev) => ({ ...prev, [tileId]: { x: p.x, y: p.y } }));
  };

  const onBoardPointerMove = (e: ReactPointerEvent) => {
    const el = boardRef.current;
    const s = dragStateRef.current;
    if (!el || !s || tileSize <= 0) return;

    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - s.dx;
    const y = e.clientY - rect.top - s.dy;

    const maxY = boardSize.h - tileSize;

    setTilePos((prev) => ({
      ...prev,
      [s.id]: { x, y: clamp(y, 0, maxY) },
    }));
  };

  const endDrag = () => {
    dragStateRef.current = null;
  };
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
      // solution for Solve button

      // restore saved groups for this print_date
      const saved = loadSavedGroups(data.print_date, tileIdSet);
      setGroups(saved);

      // restore saved drag positions (Drag Style only)
      const savedPos = loadSavedTilePos(data.print_date, tileIdSet);
      setTilePos(savedPos);

      // keep picker in sync with actual loaded date
      setPickedDate(data.print_date);

      setLoading(false);
    };

    // Try exact date file FIRST (so old dates load properly)
    try {
      const data = await fetchJson<NytConnectionsResponse>(
        nytUrl(`nyt/${dateStr}.json`),
      );
      if (data.status !== "OK")
        throw new Error(`Puzzle status not OK: ${data.status}`);
      applyLoadedPuzzle(data);
      return;
    } catch {
      // fall through
    }

    // Then try index.json best match (for near-today window, future, etc.)
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

    // Finally latest.json
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

  useEffect(() => {
    if (!storagePrintDate) return;
    saveTilePos(storagePrintDate, tilePos);
  }, [tilePos, storagePrintDate]);
const puzzleNumber = nytMeta?.print_date
    ? connectionsPuzzleNumber(nytMeta.print_date)
    : null;

  const onPickDate = (next: string) => {
    setPickedDate(next);

    if (availableDatesAsc.length > 0) {
      const nearest = nearestAvailableDate(next, availableDatesAsc);
      if (nearest) loadPuzzleByDate(nearest);
      return;
    }

    loadPuzzleByDate(next);
  };
const resetAll = () => {
  if (!storagePrintDate) return;

  // Clear solved groups
    setGroups([]);

    // Clear any manual colors + selections
    setManualTileColor({});
    setSelected(new Set());

  // Clear saved groups + drag positions for this print_date
  try {
    localStorage.removeItem(storageKeyForPrintDate(storagePrintDate));
    localStorage.removeItem(tilePosKeyForPrintDate(storagePrintDate));
  } catch {
    // ignore
  }

  // Clear positions so the initializer lays out a fresh grid
  setTilePos({});
};
return (
    <>
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

        {/* Sophisticated date picker */}
        <div className="nytDateRow">
          <DatePicker
            value={pickedDate}
            availableDatesAsc={availableDatesAsc}
            onChange={onPickDate}
            onReset={resetAll}
          />
        </div>

{/* Color mode toggle */}
<div className="nytSubTabsRow">
  <nav className="nytTabs nytSubTabs" aria-label="Drag style controls">
    <button
      type="button"
      className={`nytTabBtn nytColorToggle ${isColorMode ? "active" : ""}`}
      aria-pressed={isColorMode}
      onClick={() => {
        setIsColorMode((v) => {
          const next = !v;
          if (!next) setSelected(new Set());
          return next;
        });
      }}
    >
      Color
    </button>

    <div
      className={`nytInlineColorMenu ${
        isColorMode && selected.size > 0 ? "enabled" : "disabled"
      }`}
      aria-label="Color selected tiles"
    >
      <button
        type="button"
        className="nytInlineIcon"
        onClick={deselectAll}
        disabled={!isColorMode || selected.size === 0}
        aria-label="Clear color selection"
        title="Clear selection"
      >
        ×
      </button>

      {SELECT_COLOR_OPTIONS.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`colorPill ${c.key} nytInlineColorPill`}
          onClick={() => applyColorToSelected(c.key)}
          disabled={!isColorMode || selected.size === 0}
          aria-disabled={!isColorMode || selected.size === 0}
          aria-label={c.label}
          title={c.label}
        />
      ))}
    </div>
  </nav>
</div>

{/* Main grid */}
        <section className="nytGridWrap">
          <div
            ref={boardRef}
            className="nytFreeBoard"
            onPointerMove={onBoardPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{ height: boardSize.h || undefined }}
          >
            {ungroupedTiles.map((t, idx) => {
              const p = tilePos[t.id] ?? { x: 0, y: 0 };
              const isDragging = dragStateRef.current?.id === t.id;
              return (
                <div
                  key={t.id}
                  className={`nytTile nytFreeTile ${manualTileColor[t.id] ?? ""} ${
                    getTileText(t).length > smallTextThreshold ? "smallText" : ""
                  } ${selected.has(t.id) ? "selected" : ""}`}
                  onPointerDown={onTilePointerDown(t.id)}
                  onClick={() => {
                    if (isColorMode) toggleSelectTile(t.id);
                  }}
                  role="button"
                  tabIndex={0}
                  style={{
                    width: tileSize || undefined,
                    height: tileSize || undefined,
                    left: p.x,
                    top: p.y,
                    zIndex: isDragging ? 50 : idx,
                  }}
                >
                  <TileFace tile={t} />
                </div>
              );
            })}
          </div>
        </section>
</>
  );
}
