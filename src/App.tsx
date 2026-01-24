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

const initialTiles: Tile[] = [
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

function uid(prefix = "g") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export default function App() {
  const [tiles, setTiles] = useState<Tile[]>(initialTiles);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showColorPicker, setShowColorPicker] = useState(false);

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
    setTiles(initialTiles);
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
