import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function writeTextIfChanged(filePath, text) {
  const existing = readFileIfExists(filePath);
  if (existing === text) {
    return false;
  }

  fs.writeFileSync(filePath, text);
  return true;
}

function writeJsonIfChanged(filePath, data) {
  return writeTextIfChanged(filePath, JSON.stringify(data));
}

function hasGitConfig(key) {
  try {
    execSync(`git config --get ${key}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function shellSingleQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function ensureGitIdentityForCi() {
  if (process.env.GITHUB_ACTIONS !== "true") {
    return;
  }

  if (!hasGitConfig("user.name")) {
    execSync('git config --global user.name "github-actions[bot]"', {
      stdio: "inherit",
    });
  }

  if (!hasGitConfig("user.email")) {
    execSync(
      'git config --global user.email "github-actions[bot]@users.noreply.github.com"',
      { stdio: "inherit" },
    );
  }

  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) {
    const authedGithubBase = `https://x-access-token:${token}@github.com/`;
    execSync(
      `git config --global url.${shellSingleQuote(authedGithubBase)}.insteadOf ${shellSingleQuote("https://github.com/")}`,
      { stdio: "inherit" },
    );
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
  const changed = writeJsonIfChanged(filePath, data);
  return { ok: true, printDate, id: data.id, editor: data.editor, changed };
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

const refetchCloseToCurrentInCaseChanged = (offset) => {
  if (offset >= -1 && offset <= 1) {
    return true;
  }
  return false;
};

async function main() {
  const redeployCommand = process.env.REDEPLOY_COMMAND ?? "npm run deploy";

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let filesChanged = false;

  // Determine “today” in NY time, then use that as the anchor for the range.
  const anchorNy = fmtYYYYMMDD(new Date(), TZ);
  const anchorUtc = parseYYYYMMDDToUtcMidnight(anchorNy);

  const FROM = -2;
  const TO = 30; // ✅ up to 30 days ahead

  const index = {
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
    if (existing?.ok && !refetchCloseToCurrentInCaseChanged(off)) {
      index.available[printDate] = existing;
      console.log(`SKIP ${printDate} (exists)`);
      continue;
    }

    // If the file exists but is bad, you can choose to refetch.
    // We'll refetch in that case.
    const result = await fetchOne(printDate);
    if (result.ok && result.changed) {
      filesChanged = true;
    }
    const { changed: _changed, ...resultForIndex } = result;
    index.available[printDate] = resultForIndex;
    console.log(
      result.ok
        ? `OK   ${printDate}`
        : `MISS ${printDate} (${result.status} ${result.statusText})`,
    );
  }

  // Write index.json
  if (writeJsonIfChanged(path.join(OUT_DIR, "index.json"), index)) {
    filesChanged = true;
  }

  // Write latest.json as anchor day if present (either disk or fetched)
  const anchorFile = path.join(OUT_DIR, `${anchorNy}.json`);
  if (fs.existsSync(anchorFile)) {
    if (
      writeTextIfChanged(
        path.join(OUT_DIR, "latest.json"),
        fs.readFileSync(anchorFile, "utf-8"),
      )
    ) {
      filesChanged = true;
    }
  }

  console.log("Done. Anchor:", anchorNy, `Range: ${FROM}..${TO}`);

  // -------------------------------
  // Write available-dates.json
  // (dates that actually exist / are OK)
  // -------------------------------

  const availableDates = listAvailableDatesFromDisk();

  const availableDatesJson = {
    timezone: TZ,
    dates: availableDates,
  };

  if (
    writeJsonIfChanged(
      path.join(OUT_DIR, "available-dates.json"),
      availableDatesJson,
    )
  ) {
    filesChanged = true;
  }

  console.log(filesChanged ? "Changes detected." : "No changes detected.");

  if (filesChanged) {
    ensureGitIdentityForCi();
    console.log(`Running redeploy command: ${redeployCommand}`);
    execSync(redeployCommand, { stdio: "inherit" });
  } else {
    console.log("Skipping redeploy because no files changed.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
