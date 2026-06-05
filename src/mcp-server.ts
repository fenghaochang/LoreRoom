import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadOrInitConfig } from "./config.js";
import { MemoryDb, type MessageRow } from "./db.js";
import { ingestSpool } from "./ingest.js";

const cfg = loadOrInitConfig();
const db = new MemoryDb(cfg.dbPath, cfg.encryptionKey);

// Drain the plugin's spool (written at the Telegram source) into the encrypted DB.
// Guarded so the 20s timer and the per-query drain never overlap.
let draining = false;
function drain(): number {
  if (draining) return 0;
  draining = true;
  try { return ingestSpool(cfg.spoolPath, db); } catch { return 0; } finally { draining = false; }
}

drain(); // on startup
const timer = setInterval(drain, 20_000); // and continuously while this session is alive
if (typeof timer.unref === "function") timer.unref();

// Local wall-clock time (the machine running this server = the user's machine),
// so recalled timestamps match what the user actually saw — not UTC.
function localTs(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmt(rows: MessageRow[]): string {
  if (rows.length === 0) return "（無符合紀錄）";
  return rows
    .map((r) => `[${localTs(r.createdAt)}] (${r.role}/${r.sender} @${r.chatId}) ${r.text}`)
    .join("\n");
}

const server = new McpServer({ name: "loreroom", version: "0.1.0" });

server.registerTool(
  "get_recent_context",
  {
    description:
      "撈回最近 N 小時的 Telegram 對話（含時間、發出方、內容；雙向都有）。當你缺乏上下文、或使用者提到『剛剛/今天/昨天/最近』時，務必優先呼叫本工具還原脈絡。",
    inputSchema: { hours: z.number().describe("往回幾小時"), chat_id: z.string().optional().describe("限定某對話") },
  },
  async ({ hours, chat_id }) => {
    drain(); // freshen before answering
    return { content: [{ type: "text" as const, text: fmt(db.getRecentContext(hours, chat_id)) }] };
  },
);

server.registerTool(
  "search_tg_history",
  {
    description:
      "用關鍵字全文搜尋過去所有 Telegram 對話（雙向、含時間、發出方）。當使用者提到『之前/上次/我們討論過』等過去事件，務必優先呼叫本工具，而不要直接說不記得。",
    inputSchema: { keyword: z.string().describe("搜尋關鍵字"), chat_id: z.string().optional() },
  },
  async ({ keyword, chat_id }) => {
    drain();
    return { content: [{ type: "text" as const, text: fmt(db.searchHistory(keyword, chat_id)) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
