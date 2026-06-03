import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfigFrom, PROJECT_ROOT } from "../src/config.js";

function writeCfg(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "cfg-"));
  const p = join(dir, "config.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

describe("loadConfigFrom", () => {
  it("讀取合法 config 並帶入過濾預設值", () => {
    const p = writeCfg({ dbPath: "/tmp/x.sqlite", encryptionKey: "a".repeat(64) });
    const cfg = loadConfigFrom(p);
    expect(cfg.dbPath).toBe("/tmp/x.sqlite");
    expect(cfg.encryptionKey).toBe("a".repeat(64));
    expect(cfg.capture).toEqual({ chatAllow: [], chatDeny: [], skipPatterns: [] });
    rmSync(p, { force: true });
  });

  it("相對 dbPath 解析到專案根（沙盒）", () => {
    const p = writeCfg({ dbPath: "data/memory.sqlite", encryptionKey: "b".repeat(64) });
    const cfg = loadConfigFrom(p);
    expect(cfg.dbPath).toBe(resolve(PROJECT_ROOT, "data/memory.sqlite"));
    rmSync(p, { force: true });
  });

  it("金鑰不是 64 hex 時丟錯", () => {
    const p = writeCfg({ dbPath: "/tmp/x.sqlite", encryptionKey: "tooshort" });
    expect(() => loadConfigFrom(p)).toThrow(/64.*hex/i);
    rmSync(p, { force: true });
  });
});
