/**
 * Re-apply the loreroom capture patch to the official Telegram plugin.
 *
 * Plugin updates overwrite the plugin's server.ts, removing our patch. Run this
 * (e.g. `node dist/patch-plugin.js`) after a plugin update to restore capture,
 * then restart the bot session. Idempotent — does nothing if already patched.
 *
 * Override the target with TG_PLUGIN_SERVER=/abs/path/to/server.ts if needed.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MARK = "loreroom";

const HELPER_ANCHOR = `const INBOX_DIR = join(STATE_DIR, 'inbox')`;
const HELPER_BLOCK = `${HELPER_ANCHOR}

/* ===== loreroom capture patch (BEGIN) — re-apply after plugin updates ===== */
const LOREROOM_SPOOL = join(STATE_DIR, 'loreroom-spool.jsonl')
function loreroomCapture(
  dir: 'in' | 'out',
  chat_id: string,
  sender: string,
  text: string,
  message_id: string | null,
  ts: number,
): void {
  try {
    writeFileSync(
      LOREROOM_SPOOL,
      JSON.stringify({ dir, chat_id, sender, text, message_id, ts }) + '\\n',
      { flag: 'a', mode: 0o600 },
    )
  } catch {
    /* never break the bot for memory capture */
  }
}
/* ===== loreroom capture patch (END) ===== */`;

const INBOUND_ANCHOR = `  // image_path goes in meta only — an in-content "[image attached — read: PATH]"
  // annotation is forgeable by any allowlisted sender typing that string.
  mcp.notification({
    method: 'notifications/claude/channel',`;
const INBOUND_BLOCK = `  /* loreroom: capture inbound at the source (before queue / regardless of whether Claude ever replies) */
  loreroomCapture('in', chat_id, from.username ?? String(from.id), text, msgId != null ? String(msgId) : null, ctx.message?.date ?? Math.floor(Date.now() / 1000))

${INBOUND_ANCHOR}`;

const OUTBOUND_ANCHOR = `        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(
            \`reply failed after \${sentIds.length} of \${chunks.length} chunk(s) sent: \${msg}\`,
          )
        }

        // Files go as separate messages (Telegram doesn't mix text+file in one`;
const OUTBOUND_BLOCK = `        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(
            \`reply failed after \${sentIds.length} of \${chunks.length} chunk(s) sent: \${msg}\`,
          )
        }

        /* loreroom: capture outbound reply */
        loreroomCapture('out', chat_id, 'assistant', text, sentIds[0] != null ? String(sentIds[0]) : null, Math.floor(Date.now() / 1000))

        // Files go as separate messages (Telegram doesn't mix text+file in one`;

function findPluginServer(): string | null {
  if (process.env.TG_PLUGIN_SERVER) return process.env.TG_PLUGIN_SERVER;
  const cacheRoot = join(homedir(), ".claude", "plugins", "cache");
  if (!existsSync(cacheRoot)) return null;
  for (const mp of readdirSync(cacheRoot)) {
    const tgDir = join(cacheRoot, mp, "telegram");
    if (!existsSync(tgDir)) continue;
    for (const ver of readdirSync(tgDir)) {
      const f = join(tgDir, ver, "server.ts");
      if (existsSync(f)) return f;
    }
  }
  return null;
}

function applyOne(src: string, anchor: string, replacement: string, label: string): string {
  if (!src.includes(anchor)) throw new Error(`anchor not found for ${label} — plugin code changed; patch manually`);
  return src.replace(anchor, replacement);
}

function main() {
  const f = findPluginServer();
  if (!f || !existsSync(f)) { console.error("Telegram plugin server.ts not found. Set TG_PLUGIN_SERVER=/abs/path."); process.exit(1); }
  let src = readFileSync(f, "utf-8");
  if (src.includes(MARK)) { console.log(`Already patched: ${f}`); return; }
  src = applyOne(src, HELPER_ANCHOR, HELPER_BLOCK, "helper");
  src = applyOne(src, INBOUND_ANCHOR, INBOUND_BLOCK, "inbound");
  src = applyOne(src, OUTBOUND_ANCHOR, OUTBOUND_BLOCK, "outbound");
  writeFileSync(f, src);
  console.log(`Patched: ${f}\nRestart your Telegram bot session (claude --channels …) for it to take effect.`);
}

main();
