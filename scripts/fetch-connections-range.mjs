import fs from "node:fs";
import path from "node:path";

function fmtYYYYMMDD(date, timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// We want “print_date” aligned to NY’s calendar day.
// We compute “today” in NY, then generate -2..+2.
const TZ = "America/New_York";
const todayNyStr = fmtYYYYMMDD(new Date(), TZ);

// Convert YYYY-MM-DD to a Date anchored at UTC midnight (stable for +/- math)
const [yy, mm, dd] = todayNyStr.split("-").map(Number);
const todayUtc = new Date(Date.UTC(yy, mm - 1, dd));

const offsets = [-2, -1, 0, 1, 2];
const outDir = path.join(process.cwd(), "public", "nyt");
fs.mkdirSync(outDir, { recursive: true });

async function fetchOne(printDate) {
  const url = `https://www.nytimes.com/svc/connections/v2/${printDate}.json`;
  const res = await fetch(url, {
    headers: { "User-Agent": "connections-playground (personal use)" },
  });

  if (!res.ok) {
    // Don’t hard-fail the whole run (future dates may legitimately 404).
    return {
      ok: false,
      printDate,
      status: res.status,
      statusText: res.statusText,
    };
  }

  const data = await res.json();
  if (data.status !== "OK") {
    return {
      ok: false,
      printDate,
      status: "NOT_OK",
      statusText: String(data.status),
    };
  }

  const filePath = path.join(outDir, `${printDate}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data));
  return { ok: true, printDate, id: data.id, editor: data.editor };
}

const index = {
  generated_at: new Date().toISOString(),
  timezone: TZ,
  anchor_print_date: todayNyStr,
  range: { from: -2, to: 2 },
  available: {}, // date -> { ok, id?, editor? } or { ok:false, status... }
};

for (const off of offsets) {
  const d = addDays(todayUtc, off);
  const printDate = fmtYYYYMMDD(d, "UTC"); // date already anchored; UTC is fine
  const result = await fetchOne(printDate);
  index.available[printDate] = result;
  console.log(
    result.ok
      ? `OK  ${printDate}`
      : `SKIP ${printDate} (${result.status} ${result.statusText})`,
  );
}

// Write index.json for the React app
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index));

// Also keep latest.json pointing at “today” if available
if (index.available[todayNyStr]?.ok) {
  const latest = fs.readFileSync(
    path.join(outDir, `${todayNyStr}.json`),
    "utf-8",
  );
  fs.writeFileSync(path.join(outDir, "latest.json"), latest);
}

console.log("Done. Anchor:", todayNyStr);
