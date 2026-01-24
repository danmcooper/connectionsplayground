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
  tileIds: string[];
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
  print_date: string;
  editor?: string;
  categories: Array<{
    title: string;
    cards: Array<{
      content: string;
      position: number;
    }>;
  }>;
};

type NytIndex = {
  anchor_print_date: string;
  available: Record<string, { ok: boolean; printDate: string }>;
};

function uid(prefix = "g") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function nytUrl(path: string) {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
}

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
  return data.categories
    .flatMap((c) => c.cards)
    .sort((a, b) => a.position - b.position)
    .map((card) => ({
      id: `nyt_${data.id}_${card.position}`,
      text: card.content.toUpperCase(),
    }));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${url}`);
  return res.json();
}

export default function App() {
  const [tiles, setTiles] = useState<Tile[]>(fallbackTiles);
  const [baseTiles, setBaseTiles] = useState<Tile[]>(fallbackTiles);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showColorPicker, setShowColorPicker] = useState(false);

  const groupedTileIds = useMemo(() => {
    const s = new Set<string>();
    groups.forEach((g) => g.tileIds.forEach((id) => s.add(id)));
    return s;
  }, [groups]);

  const ungroupedTiles = tiles.filter((t) => !groupedTileIds.has(t.id));

  useEffect(() => {
    const load = async () => {
      const localDate = fmtLocalYYYYMMDD(new Date());
      try {
        const index = await fetchJson<NytIndex>(nytUrl("nyt/index.json"));
        const date = index.available[localDate]?.ok
          ? localDate
          : index.anchor_print_date;

        const data = await fetchJson<NytConnectionsResponse>(
          nytUrl(`nyt/${date}.json`),
        );

        const nextTiles = nytToTiles(data);
        setTiles(nextTiles);
        setBaseTiles(nextTiles);
      } catch {
        // fallback tiles already set
      }
    };

    load();
  }, []);

  const toggleSelect = (id: string) => {
    if (groupedTileIds.has(id)) return;
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.size < 4 && n.add(id);
      return n;
    });
  };

  const categorize = (color: ColorKey) => {
    if (selected.size !== 4) return;
    setGroups((g) => [...g, { id: uid(), color, tileIds: [...selected] }]);
    setSelected(new Set());
    setShowColorPicker(false);
  };

  return (
    <div className="nytPage">
      <div className="nytFrame">
        <header className="nytTopbar">
          <div />
          <div className="nytTitle">Connections Playground</div>
          <div />
        </header>

        <section className="nytRows">
          {groups.map((g) => (
            <div key={g.id} className={`nytSolvedRow ${g.color}`}>
              <div className="nytGrid">
                {g.tileIds.map((id) => {
                  const t = tiles.find((x) => x.id === id);
                  return (
                    <button key={id} className={`nytTile ${g.color}`}>
                      {t?.text}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        <section className="nytGridWrap">
          <div className="nytGrid">
            {ungroupedTiles.map((t) => (
              <button
                key={t.id}
                className={`nytTile ${selected.has(t.id) ? "selected" : ""}`}
                onClick={() => toggleSelect(t.id)}
              >
                {t.text}
              </button>
            ))}
          </div>
        </section>

        <section className="nytControls">
          <button className="pillBtn" onClick={() => setSelected(new Set())}>
            Deselect All
          </button>
          <button
            className="pillBtn primary"
            disabled={selected.size !== 4}
            onClick={() => setShowColorPicker(true)}
          >
            Categorize
          </button>
        </section>

        <div className="nytBottomBar">
          <button
            className="linkBtn"
            onClick={() => {
              setTiles(baseTiles);
              setGroups([]);
              setSelected(new Set());
            }}
          >
            Reset
          </button>

          <span className="tiny">
            Selected: <b>{selected.size}</b>/4
          </span>
        </div>

        {showColorPicker && (
          <div
            className="modalOverlay"
            onClick={() => setShowColorPicker(false)}
          >
            <div className="modal small" onClick={(e) => e.stopPropagation()}>
              <div className="modalTitle">Categorize as…</div>
              <div className="modalRow">
                {COLORS.map((c) => (
                  <button
                    key={c.key}
                    className={`colorPill ${c.key}`}
                    onClick={() => categorize(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
