import Database from "better-sqlite3-multiple-ciphers";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Role = "user" | "assistant";
export interface MessageInput {
  chatId: string;
  role: Role;
  sender: string;
  text: string;
  messageId?: string | null;
  createdAt: number;
}
export interface MessageRow {
  id: string;
  chatId: string;
  role: Role;
  sender: string;
  text: string;
  messageId: string | null;
  createdAt: number;
  loggedAt: number;
}

interface DbRow {
  id: string; chat_id: string; role: Role; sender: string;
  text: string; message_id: string | null; created_at: number; logged_at: number;
}
const toRow = (r: DbRow): MessageRow => ({
  id: r.id, chatId: r.chat_id, role: r.role, sender: r.sender,
  text: r.text, messageId: r.message_id, createdAt: r.created_at, loggedAt: r.logged_at,
});

export class MemoryDb {
  private db: Database.Database;

  constructor(dbPath: string, hexKey: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma(`cipher='sqlcipher'`);
    this.db.pragma(`key="x'${hexKey}'"`);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id          TEXT PRIMARY KEY,
        chat_id     TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('user','assistant')),
        sender      TEXT NOT NULL,
        text        TEXT NOT NULL,
        message_id  TEXT,
        created_at  INTEGER NOT NULL,
        logged_at   INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chat    ON messages(chat_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
      -- dedup: a Telegram (chat_id, message_id) is unique, so re-ingesting the spool
      -- can never double-insert. (NULL message_id rows are always distinct in SQLite.)
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedup ON messages(chat_id, message_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        text, content='messages', content_rowid='rowid', tokenize='trigram'
      );
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `);
  }

  insertMessage(input: MessageInput): string {
    const id = randomUUID();
    const loggedAt = Math.floor(Date.now() / 1000);
    this.db.prepare(
      `INSERT OR IGNORE INTO messages (id, chat_id, role, sender, text, message_id, created_at, logged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, input.chatId, input.role, input.sender, input.text, input.messageId ?? null, input.createdAt, loggedAt);
    return id;
  }

  getRecentContext(hours: number, chatId?: string): MessageRow[] {
    const since = Math.floor(Date.now() / 1000) - Math.round(hours * 3600);
    const rows = chatId
      ? this.db.prepare(`SELECT * FROM messages WHERE created_at >= ? AND chat_id = ? ORDER BY created_at ASC`).all(since, chatId)
      : this.db.prepare(`SELECT * FROM messages WHERE created_at >= ? ORDER BY created_at ASC`).all(since);
    return (rows as DbRow[]).map(toRow);
  }

  searchHistory(keyword: string, chatId?: string, limit = 50): MessageRow[] {
    const k = keyword.trim();
    if (k.length === 0) return [];

    // FTS5 trigram 需 ≥3 字才能 MATCH；不足 3 字（常見的 2 字中文詞）退回 LIKE 子字串掃描。
    if (k.length < 3) {
      const like = "%" + k.replace(/([\\%_])/g, "\\$1") + "%";
      const sql = chatId
        ? `SELECT * FROM messages WHERE text LIKE ? ESCAPE '\\' AND chat_id = ? ORDER BY created_at DESC LIMIT ?`
        : `SELECT * FROM messages WHERE text LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`;
      const args = chatId ? [like, chatId, limit] : [like, limit];
      return (this.db.prepare(sql).all(...args) as DbRow[]).map(toRow);
    }

    // FTS5 片語：雙引號內的字面雙引號需以兩個雙引號跳脫，避免語法錯。
    const match = `"` + k.replace(/"/g, '""') + `"`;
    const sql = chatId
      ? `SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
         WHERE messages_fts MATCH ? AND m.chat_id = ? ORDER BY m.created_at DESC LIMIT ?`
      : `SELECT m.* FROM messages_fts f JOIN messages m ON m.rowid = f.rowid
         WHERE messages_fts MATCH ? ORDER BY m.created_at DESC LIMIT ?`;
    const args = chatId ? [match, chatId, limit] : [match, limit];
    return (this.db.prepare(sql).all(...args) as DbRow[]).map(toRow);
  }

  close() { this.db.close(); }
}
