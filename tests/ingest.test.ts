import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MemoryDb } from "../src/db.js";
import { ingestSpool } from "../src/ingest.js";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
let dir: string;
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function setup() {
  dir = mkdtempSync(join(tmpdir(), "ingest-"));
  const db = new MemoryDb(join(dir, "m.sqlite"), KEY);
  const spool = join(dir, "spool.jsonl");
  return { db, spool };
}

describe("ingestSpool", () => {
  it("drains in/out records, maps role/sender, consumes the spool", () => {
    const { db, spool } = setup();
    writeFileSync(spool,
      JSON.stringify({ dir: "in", chat_id: 5, sender: "alice", text: "幫我查記憶體", message_id: "10", ts: 1000 }) + "\n" +
      JSON.stringify({ dir: "out", chat_id: 5, sender: "assistant", text: "好的我查查", message_id: "11", ts: 1001 }) + "\n");

    const n = ingestSpool(spool, db);
    expect(n).toBe(2);
    expect(existsSync(spool)).toBe(false); // consumed

    const rows = db.getRecentContext(999999, "5");
    expect(rows.map((r) => [r.role, r.sender, r.text, r.createdAt])).toEqual([
      ["user", "alice", "幫我查記憶體", 1000],
      ["assistant", "assistant", "好的我查查", 1001],
    ]);
    db.close();
  });

  it("idempotent: re-ingesting the same message_id does not duplicate", () => {
    const { db, spool } = setup();
    const rec = JSON.stringify({ dir: "in", chat_id: 5, sender: "j", text: "hi", message_id: "10", ts: 1000 }) + "\n";
    writeFileSync(spool, rec);
    ingestSpool(spool, db);
    writeFileSync(spool, rec); // same record arrives again
    ingestSpool(spool, db);
    expect(db.getRecentContext(999999, "5")).toHaveLength(1);
    db.close();
  });

  it("returns 0 when there is no spool", () => {
    const { db, spool } = setup();
    expect(ingestSpool(spool, db)).toBe(0);
    db.close();
  });

  it("skips malformed lines, keeps good ones", () => {
    const { db, spool } = setup();
    writeFileSync(spool,
      "not json\n" +
      JSON.stringify({ dir: "in", chat_id: 7, sender: "j", text: "ok", message_id: "1", ts: 5 }) + "\n" +
      JSON.stringify({ dir: "in", chat_id: 7, text: "" }) + "\n"); // empty text skipped
    expect(ingestSpool(spool, db)).toBe(1);
    db.close();
  });
});
