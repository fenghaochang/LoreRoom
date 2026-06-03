import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { CONFIG_PATH, PROJECT_ROOT, DEFAULT_DB_PATH, loadConfig } from "./config.js";
import { MemoryDb } from "./db.js";
import { ingestSpool } from "./ingest.js";

function init() {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  if (existsSync(CONFIG_PATH)) {
    console.log(`config 已存在，未覆寫：${CONFIG_PATH}`);
  } else {
    const cfg = {
      dbPath: DEFAULT_DB_PATH,
      encryptionKey: randomBytes(32).toString("hex"),
      capture: { chatAllow: [], chatDeny: [], skipPatterns: [] },
    };
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    console.log(`已建立 config（含新金鑰，權限 600）：${CONFIG_PATH}`);
  }

  const nodeBin = process.execPath;
  const distDir = join(PROJECT_ROOT, "dist");
  console.log(`\n設定步驟（雙向側錄，在 Telegram plugin 源頭攔截，無 CC hook）：`);
  console.log(`  1) patch 官方 Telegram plugin（攔進站 + 出站）：`);
  console.log(`       ${nodeBin} ${distDir}/patch-plugin.js`);
  console.log(`  2) 註冊記憶查詢 MCP server（user scope，會自動把 spool 收進加密庫）：`);
  console.log(`       claude mcp add --scope user loreroom -- ${nodeBin} ${distDir}/mcp-server.js`);
  console.log(`  3) 重啟你的 Telegram bot session（claude --channels …）讓 patch 生效。`);
  console.log(`\n資料：config.json + data/memory.sqlite 皆留在專案資料夾內。`);
  console.log(`Telegram plugin 更新後，重跑步驟 1 即可重新 patch。`);
}

function ingestOnce() {
  const cfg = loadConfig();
  const db = new MemoryDb(cfg.dbPath, cfg.encryptionKey);
  try {
    const n = ingestSpool(cfg.spoolPath, db);
    console.log(`ingested ${n} record(s) from ${cfg.spoolPath}`);
  } finally { db.close(); }
}

function watch() {
  const cfg = loadConfig();
  const db = new MemoryDb(cfg.dbPath, cfg.encryptionKey);
  console.log(`watching ${cfg.spoolPath} → ${cfg.dbPath} (every 5s; Ctrl-C to stop)`);
  const tick = () => {
    try { const n = ingestSpool(cfg.spoolPath, db); if (n) console.log(`+${n}`); }
    catch (e) { console.error("[watch]", e); }
  };
  tick();
  setInterval(tick, 5000);
}

const cmd = process.argv[2];
if (cmd === "init") init();
else if (cmd === "ingest") ingestOnce();
else if (cmd === "watch") watch();
else { console.log("用法：loreroom <init|ingest|watch>"); process.exit(1); }
