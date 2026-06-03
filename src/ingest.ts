import { renameSync, readFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { MemoryDb } from "./db.js";

interface SpoolRecord {
  dir?: "in" | "out";
  chat_id?: string | number;
  sender?: string;
  text?: string;
  message_id?: string | null;
  ts?: number;
}

function ingestFile(file: string, db: MemoryDb): number {
  let count = 0;
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec: SpoolRecord;
    try { rec = JSON.parse(t) as SpoolRecord; } catch { continue; }
    if (rec.chat_id == null || typeof rec.text !== "string" || rec.text.length === 0) continue;
    db.insertMessage({
      chatId: String(rec.chat_id),
      role: rec.dir === "out" ? "assistant" : "user",
      sender: rec.dir === "out" ? "assistant" : String(rec.sender ?? "unknown"),
      text: rec.text,
      messageId: rec.message_id != null ? String(rec.message_id) : null,
      createdAt: typeof rec.ts === "number" ? rec.ts : Math.floor(Date.now() / 1000),
    });
    count++;
  }
  return count;
}

/**
 * Drain the plugin's spool file into the encrypted DB.
 *
 * - Rotate (rename) the live spool before reading, so we never race the plugin's
 *   appends — the plugin's next append simply re-creates the spool.
 * - Idempotent: inserts are `INSERT OR IGNORE` on the unique (chat_id, message_id)
 *   index, so a crash mid-drain (or two concurrent drainers) can never duplicate.
 * - Recovers crash leftovers: any `*.ingesting.*` file from a previous run is
 *   re-processed first.
 *
 * Returns the number of records ingested.
 */
export function ingestSpool(spoolPath: string, db: MemoryDb): number {
  let total = 0;
  const dir = dirname(spoolPath);
  const base = basename(spoolPath);

  // 1) recover any leftover rotated files from a previous crash
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(`${base}.ingesting`)) {
        const f = join(dir, name);
        try { total += ingestFile(f, db); } catch { /* ignore */ }
        try { unlinkSync(f); } catch { /* ignore */ }
      }
    }
  }

  // 2) rotate the live spool (pid-unique tmp) and process it
  if (!existsSync(spoolPath)) return total;
  const tmp = `${spoolPath}.ingesting.${process.pid}`;
  try { renameSync(spoolPath, tmp); } catch { return total; }
  try { total += ingestFile(tmp, db); } finally { try { unlinkSync(tmp); } catch { /* ignore */ } }
  return total;
}
