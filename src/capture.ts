import type { CaptureConfig } from "./config.js";

/**
 * Optional capture filter (default: capture everything).
 * Used by the outbound hook to honour chatAllow/chatDeny/skipPatterns.
 */
export function shouldCapture(chatId: string, text: string, cfg: CaptureConfig): boolean {
  if (cfg.chatDeny.includes(chatId)) return false;
  if (cfg.chatAllow.length > 0 && !cfg.chatAllow.includes(chatId)) return false;
  for (const pat of cfg.skipPatterns) {
    try { if (new RegExp(pat).test(text)) return false; } catch { /* bad regex → treat as no filter */ }
  }
  return true;
}
