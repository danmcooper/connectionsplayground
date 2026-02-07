import { useEffect, useMemo, useState } from "react";
import "./App.css";

import DragStyle from "./tabs/DragStyle";
import ClickStyle from "./tabs/ClickStyle";
import Solve from "./tabs/Solve";

type TabKey = "drag" | "click" | "solve";

function getCookie(name: string) {
  const match = document.cookie.match(
    new RegExp(
      "(^|; )" + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&") + "=([^;]*)",
    ),
  );
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string) {
  // 1 year
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax`;
}

export default function App() {
  const tabs = useMemo(
    () =>
      [
        { key: "drag" as const, label: "Drag Style" },
        { key: "click" as const, label: "Click Style" },
        { key: "solve" as const, label: "Solve!" },
      ] satisfies Array<{ key: TabKey; label: string }>,
    [],
  );

  const [active, setActive] = useState<TabKey>(() => {
    const fromCookie =
      typeof document !== "undefined"
        ? (getCookie("cp_active_tab") as TabKey | null)
        : null;
    return fromCookie === "drag" ||
      fromCookie === "click" ||
      fromCookie === "solve"
      ? fromCookie
      : "drag";
  });

  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    try {
      setCookie("cp_active_tab", active);
    } catch {
      // ignore
    }
  }, [active]);

  // ESC closes help modal
  useEffect(() => {
    if (!showHelp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHelp]);

  return (
    <div className="nytPage">
      <div className="nytFrame">
        <header className="nytTopbar">
          <div className="nytBrand">
            <nav className="nytTabs" aria-label="Mode">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`nytTabBtn ${active === t.key ? "active" : ""}`}
                  aria-current={active === t.key ? "page" : undefined}
                  onClick={() => setActive(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="nytTopbarRight">
            <button
              className="iconBtn"
              aria-label="Help"
              type="button"
              onClick={() => setShowHelp(true)}
            >
              ?
            </button>
          </div>
        </header>

        {/* Keep all tabs mounted so their state (date selection, etc.) is independent */}
        <div className="nytTabPanels">
          <div
            className={active === "drag" ? "nytTabPanel active" : "nytTabPanel"}
          >
            <DragStyle />
          </div>
          <div
            className={
              active === "click" ? "nytTabPanel active" : "nytTabPanel"
            }
          >
            <ClickStyle />
          </div>
          <div
            className={
              active === "solve" ? "nytTabPanel active" : "nytTabPanel"
            }
          >
            <Solve />
          </div>
        </div>
      </div>

      {showHelp && (
        <div className="modalOverlay" onClick={() => setShowHelp(false)}>
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modalTitle">
              Welciome to the Connections Playground!
            </div>

            <div className="modalBody">
              <p>
                <strong>Overview</strong>: Have you ever wanted to play around
                with the groupings without having to submit them? This gives you
                two different ways of doing that, plus a Solve mode where you
                can actually solve any of the published puzzles going back to
                2023.
              </p>
              <p>
                <strong>Drag Style</strong>: Move tiles freely like physical
                tiles. Use the “Color” button to click tiles and paint them
                yellow/green/blue/purple for visual grouping.
              </p>

              <p>
                <strong>Click Style</strong>: Select 4 tiles then group them by
                color. Keep selecting until all tiles are grouped.
              </p>

              <p>
                <strong>Solve!</strong>: Similar to an actual NYT‑style solve
                experience, but with date selection so you can play older
                puzzles.
              </p>
            </div>

            <button
              className="pillBtn full"
              type="button"
              onClick={() => setShowHelp(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
