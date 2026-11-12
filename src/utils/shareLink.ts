export type ShareMode = "drag" | "click" | "solve";

/** Public "Connections Puzzle #" for a print date (YYYY-MM-DD). Puzzle #1 = 2023-06-12. */
function puzzleNumberForPrintDate(printDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(printDate)) return null;
  const [y, m, d] = printDate.split("-").map(Number);
  const n =
    Math.round((Date.UTC(y, m - 1, d) - Date.UTC(2023, 5, 12)) / 86_400_000) +
    1;
  return n >= 1 ? n : null;
}

/** Query string that deep-links to a mode + puzzle, e.g. "?mode=solve&puzzle=973". */
export function puzzleSearch(mode: ShareMode, printDate: string): string {
  const params = new URLSearchParams({ mode });
  const n = puzzleNumberForPrintDate(printDate);
  if (n !== null) params.set("puzzle", String(n));
  else params.set("date", printDate);
  return `?${params.toString()}`;
}

/** Full shareable URL for a mode + puzzle. */
export function puzzleLink(mode: ShareMode, printDate: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${puzzleSearch(mode, printDate)}`;
}
