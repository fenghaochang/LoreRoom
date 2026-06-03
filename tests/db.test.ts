import { describe, it, expect, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryDb } from "../src/db.js";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
let dir: string;
function newDbPath() { dir = mkdtempSync(join(tmpdir(), "db-")); return join(dir, "m.sqlite"); }
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("MemoryDb", () => {
  it("insert 後可讀回，時間與發出方保真", () => {
    const p = newDbPath();
    const db = new MemoryDb(p, KEY);
    const id = db.insertMessage({ chatId: "111", role: "user", sender: "alice", text: "哈囉 你好", messageId: "9", createdAt: 1000 });
    expect(id).toMatch(/[0-9a-f-]{36}/);
    const rows = db.getRecentContext(999999, "111");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chatId: "111", role: "user", sender: "alice", text: "哈囉 你好", messageId: "9", createdAt: 1000 });
    expect(rows[0].loggedAt).toBeGreaterThan(0);
    db.close();
  });

  it("磁碟檔案不含明文（整檔加密）", () => {
    const p = newDbPath();
    const db = new MemoryDb(p, KEY);
    db.insertMessage({ chatId: "1", role: "user", sender: "j", text: "SECRET_PLAINTEXT_TOKEN", createdAt: 1 });
    db.close();
    const raw = readFileSync(p);
    expect(raw.includes(Buffer.from("SECRET_PLAINTEXT_TOKEN"))).toBe(false);
  });

  it("錯誤金鑰無法開啟", () => {
    const p = newDbPath();
    const db = new MemoryDb(p, KEY);
    db.insertMessage({ chatId: "1", role: "user", sender: "j", text: "hi", createdAt: 1 });
    db.close();
    const wrong = "f".repeat(64);
    expect(() => { const d = new MemoryDb(p, wrong); d.getRecentContext(1); }).toThrow();
  });

  it("中文關鍵字子字串可搜（FTS5 trigram, ≥3 字）", () => {
    const p = newDbPath();
    const db = new MemoryDb(p, KEY);
    db.insertMessage({ chatId: "1", role: "assistant", sender: "assistant", text: "昨天下午我們討論了記憶體洩漏的修法", createdAt: 100 });
    db.insertMessage({ chatId: "1", role: "user", sender: "j", text: "今天天氣很好", createdAt: 200 });
    const hits = db.searchHistory("記憶體");
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("記憶體洩漏");
    db.close();
  });

  it("2 字中文關鍵字也可搜（短字 LIKE 退路）", () => {
    const p = newDbPath();
    const db = new MemoryDb(p, KEY);
    db.insertMessage({ chatId: "1", role: "user", sender: "j", text: "幫我查一下記憶層的進度", createdAt: 100 });
    db.insertMessage({ chatId: "1", role: "user", sender: "j", text: "今天天氣很好", createdAt: 200 });
    const hits = db.searchHistory("記憶");
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("記憶層");
    db.close();
  });

  it("含特殊字元（雙引號）的關鍵字不會炸", () => {
    const p = newDbPath();
    const db = new MemoryDb(p, KEY);
    db.insertMessage({ chatId: "1", role: "user", sender: "j", text: `他說 "hello world" 然後離開`, createdAt: 100 });
    const hits = db.searchHistory(`"hello`);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
