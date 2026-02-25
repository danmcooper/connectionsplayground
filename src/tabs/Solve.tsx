import { useEffect, useMemo, useRef, useState } from "react";
type ColorKey = "yellow" | "green" | "blue" | "purple";

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

const smallTextThreshold = 7; // characters
const tinyTextThreshold = 9; // characters

function getTileTextSize(t: Tile): string {
  const text = getTileText(t);
  const maxStringLength = text
    .split(" ")
    .reduce((max, s) => Math.max(max, s.length), 0);
  if (maxStringLength > smallTextThreshold) {
    if (maxStringLength > tinyTextThreshold) {
      return "tinyText";
    }
    return "smallText";
  }
  return "";
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

function MistakesRemaining({ remaining }: { remaining: number }) {
  const total = 4;
  // NYT removes dots from RIGHT -> LEFT.
  const live = Math.max(0, Math.min(total, remaining));
  return (
    <div
      className="nytMistakesRow"
      aria-label={`Mistakes remaining: ${remaining}`}
    >
      <div className="nytMistakesLabel">Mistakes Remaining:</div>
      <div className="nytMistakesDots" aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`nytMistakeDot ${i < live ? "live" : "used"}`}
          />
        ))}
      </div>
    </div>
  );
}

type Group = {
  id: string;
  color: ColorKey;
  title?: string;
  tileIds: string[]; // exactly 4, in the JSON order
};

type GuessRow = {
  id: string;
  colors: ColorKey[]; // length 4
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

function nytToSolutionGroups(
  data: NytConnectionsResponse,
): Array<{ color: ColorKey; title: string; tileIds: string[] }> {
  // NYT categories are ordered easiest->hardest (yellow->purple)
  const colorByIndex: ColorKey[] = ["yellow", "green", "blue", "purple"];

  return data.categories.map((cat, i) => {
    const color = colorByIndex[i] ?? "purple";
    // Preserve the order in the JSON category definition (NOT grid position order)
    const tileIds = cat.cards.map(
      (card: any) => `nyt_${data.id}_${card.position}`,
    );

    return { color, title: cat.title, tileIds };
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

/* ---------------- cookies: persist Solve progress (groups + guesses + mistakes) ---------------- */

function cookieKeyForPrintDate(printDate: string) {
  return `cp_solve_${printDate}`;
}

function getCookie(name: string): string | null {
  try {
    const parts = document.cookie.split(";").map((p) => p.trim());
    for (const part of parts) {
      if (!part) continue;
      const idx = part.indexOf("=");
      if (idx === -1) continue;
      const k = part.slice(0, idx);
      const v = part.slice(idx + 1);
      if (k === name) return decodeURIComponent(v);
    }
    return null;
  } catch {
    return null;
  }
}

function setCookie(name: string, value: string, days = 30) {
  try {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  } catch {
    // ignore
  }
}

type SavedSolveState = {
  v?: 1;
  groups?: Array<Pick<Group, "id" | "color" | "tileIds"> & { title?: string }>;
  guesses?: Array<{ id: string; colors: ColorKey[] }>;
  guessedKeys?: string[];
  mistakesRemaining?: number;
  resultsDismissed?: boolean;
  didFail?: boolean;
};

function loadSavedSolveState(
  printDate: string,
  validTileIds: Set<string>,
): {
  groups: Group[];
  guesses: GuessRow[];
  guessedKeys: string[];
  mistakesRemaining: number;
  resultsDismissed: boolean;
  didFail: boolean;
} {
  try {
    const raw = getCookie(cookieKeyForPrintDate(printDate));
    if (!raw) {
      return {
        groups: [],
        guesses: [],
        guessedKeys: [],
        mistakesRemaining: 4,
        resultsDismissed: false, // always re-show results overlay after refresh
        didFail: false,
      };
    }

    const parsed = JSON.parse(raw) as SavedSolveState;
    const rawGroups = Array.isArray(parsed.groups) ? parsed.groups : [];
    const rawGuesses = Array.isArray(parsed.guesses) ? parsed.guesses : [];
    const rawGuessedKeys = Array.isArray((parsed as any).guessedKeys)
      ? ((parsed as any).guessedKeys as unknown[])
      : [];

    const cleanedGroups: Group[] = [];
    for (const g of rawGroups) {
      if (!g || !Array.isArray(g.tileIds) || g.tileIds.length !== 4) continue;
      if (!g.color) continue;
      if (
        g.tileIds.some((id) => typeof id !== "string" || !validTileIds.has(id))
      )
        continue;
      cleanedGroups.push({
        id: typeof g.id === "string" ? g.id : uid("group"),
        color: g.color as ColorKey,
        title:
          typeof (g as any).title === "string" ? (g as any).title : undefined,
        tileIds: g.tileIds,
      });
    }

    const cleanedGuessedKeys: string[] = [];
    for (const k of rawGuessedKeys) {
      if (typeof k !== "string") continue;
      if (k.split("|").length !== 4) continue;
      cleanedGuessedKeys.push(k);
    }

    const cleanedGuesses: GuessRow[] = [];
    for (const gr of rawGuesses) {
      if (!gr || typeof gr.id !== "string") continue;
      if (!Array.isArray(gr.colors) || gr.colors.length !== 4) continue;
      cleanedGuesses.push({
        id: gr.id,
        colors: gr.colors.filter(Boolean).slice(0, 4) as ColorKey[],
      });
    }

    const mr =
      typeof parsed.mistakesRemaining === "number" &&
      Number.isFinite(parsed.mistakesRemaining)
        ? Math.max(0, Math.min(4, Math.floor(parsed.mistakesRemaining)))
        : 4;

    return {
      groups: cleanedGroups,
      guesses: cleanedGuesses,
      guessedKeys: cleanedGuessedKeys,
      mistakesRemaining: mr,
      resultsDismissed: false, // always re-show results overlay after refresh
      didFail: Boolean((parsed as any).didFail),
    };
  } catch {
    return {
      groups: [],
      guesses: [],
      guessedKeys: [],
      mistakesRemaining: 4,
      resultsDismissed: false, // always re-show results overlay after refresh
      didFail: false,
    };
  }
}

function saveSolveState(printDate: string, state: SavedSolveState) {
  setCookie(
    cookieKeyForPrintDate(printDate),
    JSON.stringify({ ...state, v: 1 }),
  );
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
}: {
  value: string;
  availableDatesAsc: string[];
  onChange: (next: string) => void;
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

      <button
        className="nytTodayBtn"
        type="button"
        onClick={() => onChange(fmtLocalYYYYMMDD(new Date()))}
      >
        Today
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
                isSelected ? "selected" : "",
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

export default function Solve({
  initialPrintDate,
}: {
  initialPrintDate?: string | null;
}) {
  const [tiles, setTiles] = useState<Tile[]>(fallbackTiles);
  const [baseTiles, setBaseTiles] = useState<Tile[]>(fallbackTiles);

  const baseTilesById = useMemo(() => {
    const m = new Map<string, Tile>();
    for (const t of baseTiles) m.set(t.id, t);
    return m;
  }, [baseTiles]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [solutionGroups, setSolutionGroups] = useState<
    Array<{ color: ColorKey; title: string; tileIds: string[] }>
  >([]);
  const [mistakesRemaining, setMistakesRemaining] = useState(4);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [guessedKeys, setGuessedKeys] = useState<string[]>([]);
  const [snack, setSnack] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tileAnim, setTileAnim] = useState<
    Record<string, "pop" | "shake" | "fly" | undefined>
  >({});
  const completionJustHappenedRef = useRef(false);
  const didReloadRef = useRef(false);

  const sleep = (ms: number) =>
    new Promise<void>((r) => window.setTimeout(r, ms));
  const [showResults, setShowResults] = useState(false);
  const [resultsDismissed, setResultsDismissed] = useState(false);

  // On a hard page refresh, allow the results modal to auto-open again even if it was opened before.
  useEffect(() => {
    const nav = (performance.getEntriesByType("navigation")[0] as any) || null;
    if (nav?.type === "reload") {
      didReloadRef.current = true;
      sessionStorage.removeItem("nytResultsAutoOpened");
    }
  }, []);

  const [didFail, setDidFail] = useState(false);
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

  const isSolved = groups.length === 4;

  // ESC closes color modal + solve confirm modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
  // Prevent older async loads from overwriting newer ones (deep-link race fix)
  const loadSeqRef = useRef(0);

  async function loadPuzzleByDate(dateStr: string) {
    setLoading(true);
    setError(null);
    setRequestedDate(dateStr);

    const seq = ++loadSeqRef.current;

    const applyLoadedPuzzle = (data: NytConnectionsResponse) => {
      if (seq !== loadSeqRef.current) return;
      const nextTiles = nytToTiles(data);
      const tileIdSet = new Set(nextTiles.map((t) => t.id));

      setNytMeta({
        id: data.id,
        print_date: data.print_date,
        editor: data.editor,
      });
      setTiles(nextTiles);
      setBaseTiles(nextTiles);
      setSolutionGroups(nytToSolutionGroups(data));
      // defaults (may be overridden by cookie restore below)
      setMistakesRemaining(4);
      setGuesses([]);
      setGuessedKeys([]);
      setSnack(null);
      setShowResults(false);
      setResultsDismissed(false);
      completionJustHappenedRef.current = false;
      setDidFail(false);
      setSelectedOrder([]);

      // solution for Solve button
      // restore saved Solve progress for this print_date (cookies)
      const saved = loadSavedSolveState(data.print_date, tileIdSet);
      setGroups(saved.groups);
      setGuesses(saved.guesses);
      setGuessedKeys(saved.guessedKeys);
      setMistakesRemaining(saved.mistakesRemaining);
      setResultsDismissed(saved.resultsDismissed);
      setDidFail(saved.didFail);

      // keep picker in sync with actual loaded date
      setPickedDate(data.print_date);

      setSelected(new Set());
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

  // Default on load/reload: current local day — unless App deep-linked a specific date/number
  const initialAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    const fromRoute =
      typeof initialPrintDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(initialPrintDate)
        ? initialPrintDate
        : null;

    const desired = fromRoute ?? fmtLocalYYYYMMDD(new Date());
    if (initialAppliedRef.current === desired) return;
    initialAppliedRef.current = desired;

    setPickedDate(desired);
    loadPuzzleByDate(desired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrintDate]);

  // Persist Solve progress whenever it changes (keyed by the puzzle print_date)
  const storagePrintDate = nytMeta?.print_date ?? null;
  useEffect(() => {
    if (!storagePrintDate) return;
    saveSolveState(storagePrintDate, {
      groups,
      guesses,
      guessedKeys,
      mistakesRemaining,
      resultsDismissed,
      didFail,
    });
  }, [
    groups,
    guesses,
    guessedKeys,
    mistakesRemaining,
    resultsDismissed,
    didFail,
    storagePrintDate,
  ]);

  const toggleSelect = (tileId: string) => {
    if (groupedTileIds.has(tileId)) return;

    setSelected((prev) => {
      const next = new Set(prev);
      const had = next.has(tileId);
      if (had) {
        next.delete(tileId);
      } else {
        if (next.size >= 4) return next;
        next.add(tileId);
      }

      setSelectedOrder((order) => {
        if (had) return order.filter((id) => id !== tileId);
        return [...order, tileId];
      });

      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setSelectedOrder([]);
  };

  const tileIdToColor = useMemo(() => {
    const m = new Map<string, ColorKey>();
    for (const sg of solutionGroups) {
      for (const id of sg.tileIds) m.set(id, sg.color);
    }
    return m;
  }, [solutionGroups]);

  const colorToEmoji = (c: ColorKey) =>
    c === "yellow" ? "🟨" : c === "green" ? "🟩" : c === "blue" ? "🟦" : "🟪";

  const shareText = useMemo(() => {
    if (!nytMeta?.print_date) return "";
    const num = connectionsPuzzleNumber(nytMeta.print_date);
    const lines = guesses.map((g) => g.colors.map(colorToEmoji).join(""));
    return ["Connections", `Puzzle #${num}`, ...lines].join("\n");
  }, [guesses, nytMeta?.print_date]);

  const copyResults = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setSnack("Copied!");
      window.setTimeout(() => setSnack(null), 2000);
    } catch {
      // Fallback: prompt
      try {
        window.prompt("Copy your results:", shareText);
      } catch {
        // ignore
      }
    }
  };
  const onSubmit = async () => {
    if (isSubmitting) return;
    if (selected.size !== 4) return;
    if (mistakesRemaining <= 0) return;

    // Preserve the user's click order (fallback to set order)
    const pickedInOrder = selectedOrder.filter((id) => selected.has(id));
    const pickedRaw =
      pickedInOrder.length === 4 ? pickedInOrder : Array.from(selected);
    const pickedSorted = pickedRaw.slice().sort();

    // Duplicate guess detection (order-independent) — no animation, no penalty.
    const guessKey = pickedSorted.join("|");
    if (guessedKeys.includes(guessKey)) {
      setSnack("Already guessed");
      window.setTimeout(() => setSnack(null), 2000);
      return;
    }

    setIsSubmitting(true);

    // "Pop" the 4 selected tiles in sequence (NYT-style)
    for (const id of pickedRaw.slice(0, 4)) {
      setTileAnim((prev) => ({ ...prev, [id]: "pop" }));
      await sleep(90);
      setTileAnim((prev) => {
        const next = { ...prev };
        if (next[id] === "pop") delete next[id];
        return next;
      });
      await sleep(40);
    }

    const match = solutionGroups.find((sg) => {
      if (groups.some((g) => g.color === sg.color)) return false; // already solved
      const sol = sg.tileIds.slice().sort();
      for (let i = 0; i < sol.length; i++) {
        if (sol[i] !== pickedSorted[i]) return false;
      }
      return true;
    });

    // Record guess row in the exact order shown to the user (only for new guesses)
    const rowColors = pickedRaw
      .slice(0, 4)
      .map((id) => tileIdToColor.get(id) ?? "purple");
    if (rowColors.length === 4) {
      setGuesses((prev) => [...prev, { id: uid("guess"), colors: rowColors }]);
      setGuessedKeys((prev) => [...prev, guessKey]);
    }

    if (!match) {
      // "One away…" if this guess has 3/4 from any unsolved group.
      const pickedSet = new Set(pickedRaw);
      const oneAway = solutionGroups.some((sg) => {
        if (groups.some((g) => g.color === sg.color)) return false;
        let inGroup = 0;
        for (const id of sg.tileIds) if (pickedSet.has(id)) inGroup++;
        return inGroup === 3;
      });
      if (oneAway) {
        setSnack("One away…");
        window.setTimeout(() => setSnack(null), 2000);
      }

      // Wrong: shake all 4 for 1s, then take a mistake. Keep selection.
      for (const id of pickedRaw.slice(0, 4)) {
        setTileAnim((prev) => ({ ...prev, [id]: "shake" }));
      }
      await sleep(1000);
      setTileAnim((prev) => {
        const next = { ...prev };
        for (const id of pickedRaw.slice(0, 4)) {
          if (next[id] === "shake") delete next[id];
        }
        return next;
      });

      setMistakesRemaining((m) => Math.max(0, m - 1));
      setIsSubmitting(false);
      return;
    }

    // Correct: fly tiles upward, then commit group + remove tiles.
    for (const id of pickedRaw.slice(0, 4)) {
      setTileAnim((prev) => ({ ...prev, [id]: "fly" }));
    }
    await sleep(430);

    if (groups.length === 3) {
      completionJustHappenedRef.current = true;
    }

    const newGroup: Group = {
      id: uid("g"),
      color: match.color,
      title: match.title,
      tileIds: match.tileIds,
    };

    setGroups((prev) => [...prev, newGroup]);
    setTiles((prev) => prev.filter((t) => !new Set(match.tileIds).has(t.id)));

    // Clean up animation state and selection
    setTileAnim((prev) => {
      const next = { ...prev };
      for (const id of pickedRaw.slice(0, 4)) delete next[id];
      return next;
    });
    clearSelection();
    setIsSubmitting(false);
  };

  const revealSolution = () => {
    // Fill in any remaining unsolved groups, remove remaining tiles.
    const solvedColors = new Set(groups.map((g) => g.color));
    const nextGroups: Group[] = [...groups];
    for (const sg of solutionGroups) {
      if (solvedColors.has(sg.color)) continue;
      nextGroups.push({
        id: uid("g"),
        color: sg.color,
        title: sg.title,
        tileIds: sg.tileIds,
      });
    }
    setGroups(nextGroups);
    setTiles([]);
    clearSelection();
  };

  // If the user runs out of mistakes, show snackbar + auto-solve.
  useEffect(() => {
    if (mistakesRemaining > 0) return;
    if (isSolved) return;
    if (solutionGroups.length !== 4) return;

    setDidFail(true);

    setSnack("Better Luck Next Time!");
    completionJustHappenedRef.current = true;
    revealSolution();

    const t1 = window.setTimeout(() => setSnack(null), 2000);
    const t2 = window.setTimeout(() => setShowResults(true), 2050);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mistakesRemaining]);

  // When all 4 groups are solved: brief snackbar, then results overlay.
  useEffect(() => {
    if (groups.length !== 4) return;
    if (showResults) return;
    if (resultsDismissed) return;

    const shouldAutoOpen =
      completionJustHappenedRef.current || didReloadRef.current;
    if (!shouldAutoOpen) return;
    // Consume the completion flag so navigating around doesn't retrigger.
    completionJustHappenedRef.current = false;
    didReloadRef.current = false;

    // If the puzzle was auto-solved due to running out of mistakes, still show
    // the results overlay, but don't show the "Nice job!" snackbar.
    if (didFail) {
      if (!sessionStorage.getItem("nytResultsAutoOpened")) {
        sessionStorage.setItem("nytResultsAutoOpened", "1");
        setShowResults(true);
      }
      return;
    }

    setSnack("Nice job!");
    const t1 = window.setTimeout(() => setSnack(null), 2000);
    const t2 = window.setTimeout(() => setShowResults(true), 2050);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [groups.length, showResults, resultsDismissed, didFail]);

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

  const resetAll = () => {
    setTiles(baseTiles);
    setGroups([]);
    clearSelection();
    setMistakesRemaining(4);
    setGuesses([]);
    setGuessedKeys([]);
    setSnack(null);
    setShowResults(false);
    setResultsDismissed(false);
    setDidFail(false);
    setSelectedOrder([]);
  };

  const isDirty = useMemo(() => {
    // "Dirty" means any user-visible puzzle state changed from the initial loaded puzzle.
    if (tiles.length !== baseTiles.length) return true;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i].id !== baseTiles[i].id) return true;
    }
    if (groups.length) return true;
    if (mistakesRemaining !== 4) return true;
    if (guesses.length) return true;
    if (guessedKeys.length) return true;
    if (selected.size) return true;
    if (selectedOrder.length) return true;
    if (showResults || resultsDismissed || didFail) return true;
    return false;
  }, [
    tiles,
    baseTiles,
    groups.length,
    mistakesRemaining,
    guesses.length,
    guessedKeys.length,
    selected,
    selectedOrder.length,
    showResults,
    resultsDismissed,
    didFail,
  ]);

  const closeResults = () => {
    setShowResults(false);
    setResultsDismissed(true);
  };

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
              <div className="nytMetaRow">
                {nytMeta ? (
                  <>
                    {puzzleNumber !== null ? (
                      <div className="nytMetaItem">Puzzle #{puzzleNumber}</div>
                    ) : null}
                    {puzzleNumber !== null ? (
                      <div className="nytMetaDot">•</div>
                    ) : null}
                    <div className="nytMetaItem">{pickedDate}</div>
                    <div className="nytMetaDot">•</div>
                    <button
                      className="nytResetText"
                      type="button"
                      onClick={resetAll}
                      disabled={!isDirty}
                      aria-disabled={!isDirty}
                      title={isDirty ? "Reset" : "Nothing to reset"}
                    >
                      Reset
                    </button>
                  </>
                ) : (
                  <>
                    <div className="nytMetaItem">Requested {requestedDate}</div>
                  </>
                )}
              </div>
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
        />
      </div>

      {/* Submitd rows (NO colored enclosing row; only colored tiles) */}
      <section className={`nytRows ${groups.length === 4 ? "full" : ""}`}>
        {groups.map((g) => {
          const sg = solutionGroups.find((x) => x.color === g.color);
          const title = (
            g.title ||
            sg?.title ||
            g.color.toUpperCase()
          ).toUpperCase();
          const sol = solutionGroups.find((sg) => {
            const a = sg.tileIds.slice().sort().join("|");
            const b = g.tileIds.slice().sort().join("|");
            return a === b;
          });
          const orderedIds = sol ? sol.tileIds : g.tileIds;
          const words = orderedIds
            .map((id) => baseTilesById.get(id))
            .map((t) => (t ? getTileText(t) : ""))
            .filter(Boolean)
            .join(", ");

          return (
            <div key={g.id} className={`nytSolvedBanner ${g.color}`}>
              <div className="nytSolvedBannerTitle">{title}</div>
              <div className="nytSolvedBannerWords">{words}</div>
            </div>
          );
        })}
      </section>

      {/* Main grid */}
      <section className="nytGridWrap">
        <div className="nytGrid">
          {ungroupedTiles.map((t) => {
            const isSelected = selected.has(t.id);
            return (
              <button
                key={t.id}
                onMouseDown={(e) => e.preventDefault()}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (isSubmitting) return;
                  toggleSelect(t.id);
                }}
                aria-pressed={isSelected}
                type="button"
                className={`nytTile ${isImageTile(t) ? "imgTile" : ""}  ${isSelected ? "selected" : ""} ${tileAnim[t.id] ? `anim-${tileAnim[t.id]}` : ""} ${getTileTextSize(
                  t,
                )}`}
              >
                <TileFace tile={t} />
              </button>
            );
          })}
        </div>
      </section>

      <div className="nytMistakes"></div>

      <MistakesRemaining remaining={mistakesRemaining} />

      <section className="nytControls">
        <button
          className="pillBtn"
          onClick={() => {
            if (isSubmitting) return;
            shuffleUngrouped();
          }}
          type="button"
        >
          Shuffle
        </button>

        <button
          className="pillBtn"
          onClick={() => {
            if (isSubmitting) return;
            clearSelection();
          }}
          disabled={isSubmitting || selectedCount === 0}
          type="button"
        >
          Deselect All
        </button>

        <button
          className="pillBtn primary"
          onClick={isSolved ? copyResults : onSubmit}
          disabled={
            isSolved
              ? false
              : isSubmitting || selected.size !== 4 || mistakesRemaining <= 0
          }
          type="button"
        >
          {isSolved ? "Share" : "Submit"}
        </button>
      </section>

      {snack && (
        <div className="nytSnack" role="status">
          {snack}
        </div>
      )}

      {showResults && (
        <div className="nytResultsOverlay" role="dialog" aria-label="Results">
          <div className="nytResultsCard">
            <div className="nytResultsTop">
              <button
                type="button"
                className="nytResultsBack"
                onClick={closeResults}
              >
                Back to puzzle
              </button>
              <button
                type="button"
                className="nytResultsClose"
                aria-label="Close"
                onClick={closeResults}
              >
                ×
              </button>
            </div>

            <div className="nytResultsTitle">
              {didFail ? "Better Luck Next Time!" : "Great!"}
            </div>

            <div className="nytResultsGrid" aria-label="Results grid">
              {guesses.map((g) => (
                <div key={g.id} className="nytResultsRow">
                  {g.colors.map((c, i) => (
                    <span key={i} className={`nytResultsSq ${c}`} />
                  ))}
                </div>
              ))}
            </div>

            <button
              type="button"
              className="nytResultsShare"
              onClick={copyResults}
            >
              Share Your Results
            </button>
          </div>
        </div>
      )}
    </>
  );
}
