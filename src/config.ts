import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";

export interface CaptureConfig {
  chatAllow: string[];
  chatDeny: string[];
  skipPatterns: string[];
}
export interface Config {
  dbPath: string;
  encryptionKey: string;
  spoolPath: string;
  capture: CaptureConfig;
}

// 沙盒：路徑全部解析到專案資料夾內。HERE = dist/（或 src/，dev），其上一層即專案根。
const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, "..");
export const CONFIG_PATH = process.env.LOREROOM_CONFIG ?? join(PROJECT_ROOT, "config.json");
export const DEFAULT_DB_PATH = join("data", "memory.sqlite"); // 相對專案根，沙盒可攜
// 由 plugin patch 寫入的 spool（須與 plugin 的 STATE_DIR 一致）。
export const DEFAULT_SPOOL_PATH = join(homedir(), ".claude", "channels", "telegram", "loreroom-spool.jsonl");

const HEX64 = /^[0-9a-fA-F]{64}$/;

export function loadConfigFrom(path: string): Config {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  if (typeof raw.dbPath !== "string" || raw.dbPath.length === 0) {
    throw new Error(`config dbPath missing in ${path}`);
  }
  if (typeof raw.encryptionKey !== "string" || !HEX64.test(raw.encryptionKey)) {
    throw new Error(`config encryptionKey must be a 64-char hex string (32 bytes) in ${path}`);
  }
  // 相對 dbPath 解析到專案根（自包含）；絕對路徑原樣使用（測試 / 進階）。
  const dbPath = isAbsolute(raw.dbPath) ? raw.dbPath : resolve(PROJECT_ROOT, raw.dbPath);
  const spoolPath =
    typeof raw.spoolPath === "string" && raw.spoolPath.length > 0
      ? (isAbsolute(raw.spoolPath) ? raw.spoolPath : resolve(PROJECT_ROOT, raw.spoolPath))
      : DEFAULT_SPOOL_PATH;
  const cap = raw.capture ?? {};
  return {
    dbPath,
    encryptionKey: raw.encryptionKey,
    spoolPath,
    capture: {
      chatAllow: Array.isArray(cap.chatAllow) ? cap.chatAllow.map(String) : [],
      chatDeny: Array.isArray(cap.chatDeny) ? cap.chatDeny.map(String) : [],
      skipPatterns: Array.isArray(cap.skipPatterns) ? cap.skipPatterns.map(String) : [],
    },
  };
}

export function loadConfig(): Config {
  return loadConfigFrom(CONFIG_PATH);
}

/**
 * Create `config.json` with a fresh 32-byte key if it doesn't exist. Idempotent —
 * never overwrites an existing config. Returns true if it created one.
 */
export function ensureConfig(): boolean {
  if (existsSync(CONFIG_PATH)) return false;
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const cfg = {
    dbPath: DEFAULT_DB_PATH,
    encryptionKey: randomBytes(32).toString("hex"),
    capture: { chatAllow: [], chatDeny: [], skipPatterns: [] },
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return true;
}

/**
 * Load config, self-initializing it on first run if missing. Lets the MCP server
 * start cleanly in a fresh environment (e.g. a directory's build sandbox) without
 * a separate `init` step. Logs to stderr so it never pollutes the stdio protocol.
 */
export function loadOrInitConfig(): Config {
  if (ensureConfig()) {
    console.error(`[loreroom] created config with a fresh key: ${CONFIG_PATH}`);
  }
  return loadConfigFrom(CONFIG_PATH);
}
