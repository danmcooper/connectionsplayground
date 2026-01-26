import fs from "node:fs";
import path from "node:path";

const TZ = "America/New_York";
const OUT_DIR = path.join(process.cwd(), "public", "nyt");

function fmtYYYYMMDD(date, timeZone = TZ) {
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

function addDaysUtc(utcDate, days) {
  const d = new Date(utcDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function parseYYYYMMDDToUtcMidnight(s) {
  const [yy, mm, dd] = s.split("-").map(Number);
  return new Date(Date.UTC(yy, mm - 1, dd));
}

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchOne(printDate) {
  const url = `https://www.nytimes.com/svc/connections/v2/${printDate}.json`;

  const res = await fetch(url, {
    headers: { "User-Agent": "connections-playground (personal use)" },
  });

  if (!res.ok) {
    // Don’t fail the whole run; future dates may 404 until published.
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

  const filePath = path.join(OUT_DIR, `${printDate}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data));
  return { ok: true, printDate, id: data.id, editor: data.editor };
}

function resultFromExistingFile(printDate) {
  const filePath = path.join(OUT_DIR, `${printDate}.json`);
  if (!fs.existsSync(filePath)) return null;

  const data = safeReadJson(filePath);
  if (!data || data.status !== "OK") {
    // file exists but unreadable or not OK; treat as missing so we can refetch next time if desired
    return {
      ok: false,
      printDate,
      status: "BAD_FILE",
      statusText: "Invalid JSON or status not OK",
    };
  }

  return {
    ok: true,
    printDate,
    id: data.id,
    editor: data.editor,
    fromDisk: true,
  };
}

function listAvailableDatesFromDisk() {
  const files = fs.readdirSync(OUT_DIR);

  const dates = [];

  for (const file of files) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;

    const printDate = file.replace(".json", "");
    const filePath = path.join(OUT_DIR, file);

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);

      if (data?.status === "OK" && data?.print_date === printDate) {
        dates.push(printDate);
      }
    } catch {
      // ignore unreadable/bad files
    }
  }

  return dates.sort();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Determine “today” in NY time, then use that as the anchor for the range.
  const anchorNy = fmtYYYYMMDD(new Date(), TZ);
  const anchorUtc = parseYYYYMMDDToUtcMidnight(anchorNy);

  const FROM = -2;
  const TO = 30; // ✅ up to 30 days ahead

  const index = {
    generated_at: new Date().toISOString(),
    timezone: TZ,
    anchor_print_date: anchorNy,
    range: { from: FROM, to: TO },
    available: {}, // date -> result
  };

  for (let off = FROM; off <= TO; off++) {
    const d = addDaysUtc(anchorUtc, off);
    const printDate = fmtYYYYMMDD(d, "UTC"); // already anchored; UTC format is stable

    // ✅ Skip network if file already exists
    const existing = resultFromExistingFile(printDate);
    if (existing?.ok) {
      index.available[printDate] = existing;
      console.log(`SKIP ${printDate} (exists)`);
      continue;
    }

    // If the file exists but is bad, you can choose to refetch.
    // We'll refetch in that case.
    const result = await fetchOne(printDate);
    index.available[printDate] = result;
    console.log(
      result.ok
        ? `OK   ${printDate}`
        : `MISS ${printDate} (${result.status} ${result.statusText})`,
    );
  }

  // Write index.json
  fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify(index));

  // Write latest.json as anchor day if present (either disk or fetched)
  const anchorFile = path.join(OUT_DIR, `${anchorNy}.json`);
  if (fs.existsSync(anchorFile)) {
    fs.writeFileSync(
      path.join(OUT_DIR, "latest.json"),
      fs.readFileSync(anchorFile),
    );
  }

  console.log("Done. Anchor:", anchorNy, `Range: ${FROM}..${TO}`);

  // -------------------------------
  // Write available-dates.json
  // (dates that actually exist / are OK)
  // -------------------------------

  const availableDates = listAvailableDatesFromDisk();

  const availableDatesJson = {
    generated_at: new Date().toISOString(),
    timezone: TZ,
    dates: availableDates,
  };

  fs.writeFileSync(
    path.join(OUT_DIR, "available-dates.json"),
    JSON.stringify(availableDatesJson),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
