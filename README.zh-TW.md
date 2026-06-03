# loreroom

> English → [README.md](./README.md)

**一個私密、加密的「房間」，記得你跟 Claude Code Telegram bot 的每一段對話——雙向都記——讓它永不失憶。**

你用手機透過官方 Telegram plugin 跟 Claude Code 聊天，但每個 Claude Code session 都會失憶：一重啟，整段對話就沒了。loreroom 把這段 Telegram 對話的**兩邊**都收進一個**整檔加密**的 SQLite 資料庫，再以可搜尋的記憶交還給 Claude。

於是你可以問 bot：

> **你：** 我昨晚叫你做什麼？
> **Bot：**（搜尋 loreroom）你要我修爬蟲的重試邏輯，然後把 diff 傳給你…

本機優先。零雲端、零額外 API key，完全不碰你的 bot token。

---

## 為什麼需要 loreroom（以及為什麼它可靠）

Claude Code 的 Telegram plugin 是用內部 channel 推播把進站訊息送給 Claude——**不經過任何 hook**。更糟的是，Claude 在忙時這些訊息會**隱形排進佇列**，bot 若一直沒回就直接消失。所以那些看似理所當然的做法（hook、讀 transcript）會默默漏掉你的訊息。

loreroom 在 **plugin 源頭**攔截，就在訊息剛從 Telegram 進來的那一刻：

- **進站**——Telegram 一送達就攔，**早於任何佇列**，**不管 Claude 在忙、當機、或永遠不回**。
- **出站**——bot 一送出回覆就攔。

兩邊都寫進一個小小的 spool 檔，再由 ingester 收進加密庫。**一則都不漏——即使你的 bot 沒回應。**（bot 在忙時卡住的訊息，會在它重啟、重新抓取時被補收。）

不使用任何 Claude Code hook，所以 loreroom 不會干擾你其他的 Claude Code 工作。

```
你 ⇄ Telegram ──(patched plugin)──> spool ──(ingester)──> 加密 SQLite (SQLCipher + FTS5)
                  攔進站 + 出站         定時 drain              ▲
                                                              │ MCP server
                                                     get_recent_context · search_tg_history
                                                              │
                                                       Claude 回憶——雙向、含時間與發出方
```

## 開始前你需要什麼

loreroom 是幫一個**already 能用**的 Claude Code Telegram bot 加上記憶。所以你得先有那個 bot。**如果你已經能在 Telegram 上跟你的 bot 聊天，直接跳到 [安裝](#安裝)。** 還沒有的話，一次性設定（約 5 分鐘）：

**1. Node.js 20 以上。** 用 `node -v` 檢查；沒有就去 [nodejs.org](https://nodejs.org) 裝。

**2. Claude Code** —— Anthropic 的命令列工具。見[安裝說明](https://docs.claude.com/en/docs/claude-code)。

**3. 一個接上 Claude Code 的 Telegram bot：**
   1. 在 Telegram 找 **@BotFather**，傳 `/newbot`，照指示做，把它給你的 **bot token**（一長串）複製起來。
   2. 在 Claude Code 裝官方 **Telegram plugin**，再用 token 設定：`/telegram:configure <你的-bot-token>`。
   3. 配對你的帳號：在 Telegram 隨便傳一則給你的 bot —— 它會回一個配對碼 —— 然後在 Claude Code 跑 `/telegram:access pair <配對碼>`。
   4. 啟動 bot session：`claude --channels plugin:telegram@claude-plugins-official`，然後在 Telegram 傳「hi」給 bot，它應該會回你。

「hi」有回 = 你的 bot 能用了。接著用 loreroom 給它記憶 👇

> **適用範圍：** loreroom 僅適用 Claude Code + 官方 Telegram plugin（不是通用 bot 框架）。它透過 **patch plugin** 來側錄——一行冪等指令，plugin 更新後重跑一次。見[為什麼要 patch plugin](#為什麼要-patch-plugin)。

## 安裝

```bash
git clone https://github.com/<you>/loreroom.git && cd loreroom
npm install
npm run build
node dist/cli.js init        # 建立 config.json + 新金鑰，並印出後續步驟
node dist/patch-plugin.js    # patch Telegram plugin，開始攔進站 + 出站
# 註冊記憶查詢 server（會自動 drain spool）：
claude mcp add --scope user loreroom -- "$(command -v node)" "$PWD/dist/mcp-server.js"
```

然後**重啟你的 bot session**（`claude --channels …`）讓 patch 生效。完成——之後每則 Telegram 訊息都會自動入庫。

> **Node 版本提醒：** 加密 SQLite 的原生模組綁定單一 Node 版本，`init` 會釘住執行它的那個 node。日後升級／移除該 Node，請重跑 `npm install && npm run build` 並重新註冊。

## 驗證

1. 從 Telegram 發一則訊息給 bot。
2. 請 Claude（任一 session）呼叫 `get_recent_context`、`hours: 1`——你會看到那則訊息，含正確時間與發出方，**就算 bot 沒回也有**。
3. 請它 `search_tg_history` 搜那則裡的關鍵字——撈得回來。

## 日常怎麼用

不用做什麼——這就是重點。設定好之後，**就照常跟你的 bot 聊天**，每則訊息（你的、bot 的）都自動存下來。

想叫它回憶時，直接用白話問：

> 「我們昨天決定資料庫怎麼處理？」
> 「我昨晚傳了什麼給你？」
> 「找一下我提到 API key 的地方」

bot 會搜自己的記憶回答你。你不用下任何指令——它會在背後自動呼叫搜尋工具。

兩個要記得的：
- 讓 bot session 開著（`claude --channels …`）。停了就重開——它停掉期間進來的訊息，重開後會被補收。
- **更新 Telegram plugin 後**，重跑一次 `node dist/patch-plugin.js` 把 patch 補回去（已 patch 會自動略過）。

## 為什麼要 patch plugin

進站 Telegram 訊息沒有 hook、也不落磁碟，唯一可靠的攔截點就在 plugin 內部。patch 很小——一個 helper 加兩行呼叫，分別在 plugin 的進站與出站 choke point——而且**冪等**（重跑無副作用）。plugin 更新會覆蓋它，更新後重跑 `node dist/patch-plugin.js` 即可。

## 自包含

loreroom 自己的東西全在**專案資料夾內**：

- `config.json` —— 設定 + 加密金鑰（git 忽略、`chmod 600`、由 `init` 建立）
- `data/memory.sqlite` —— 加密資料庫（git 忽略）

spool 是短暫的明文檔，放在 plugin 自己的 `~/.claude/channels/telegram/` 狀態目錄（`0700`），持續 drain 後刪除。

## 設定（`config.json`）

| 鍵 | 意義 |
| --- | --- |
| `dbPath` | DB 位置。相對路徑解析到專案內（預設 `data/memory.sqlite`）。 |
| `encryptionKey` | 64 字 hex（32 bytes）。`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`。 |
| `spoolPath` | plugin 寫入的 spool（預設 `~/.claude/channels/telegram/loreroom-spool.jsonl`；須與 plugin 狀態目錄一致）。 |
| `capture.chatAllow` / `chatDeny` / `skipPatterns` | 可選過濾。預設 `[]` = 全收（雙向、含重複/自動訊息）。 |

## drain spool

MCP server 會在啟動時、每 20 秒、每次查詢前 drain——所以只要有任一 Claude Code session 開著，側錄就自動流進 DB。要獨立於 session 持續 drain：

```bash
node dist/cli.js ingest   # drain 一次
node dist/cli.js watch    # 持續 drain（可掛 launchd/cron）
```

## Claude 可呼叫的 MCP 工具

- `get_recent_context({ hours, chat_id? })` —— 最近 N 小時的訊息。
- `search_tg_history({ keyword, chat_id? })` —— 全歷史全文搜尋（FTS5 trigram，支援中文；短關鍵字用 LIKE 退路）。

兩者回傳每筆均含時間、發出方、role、chat id、內容。

## 安全與加密邊界

- loreroom **完全不碰你的 Telegram bot token**——那是 plugin 的事，這裡沒有 token 可外洩。
- 唯一機敏是 `config.json` 裡的 **32-byte 金鑰**（git 忽略、`chmod 600`）——不進 repo、不被 log。
- 資料庫**整檔加密**（SQLCipher / AES-256）。把 `data/memory.sqlite` 複製到別台機器、沒金鑰也打不開。
- **這是本機 DB 的 at-rest 加密，不是 Telegram 端對端加密。** 不改變 Telegram 本身。解密只在 loreroom 本機行程內發生；金鑰不交給 Claude、不過網路。
- **防得住：** DB 檔被複製走 / 備份外洩。**防不住：** 已能讀你帳號檔案的人（金鑰與 DB 同放本機）。spool 在 drain 前短暫為明文。

## 限制

- 需 patch 官方 Telegram plugin（plugin 更新後用 `patch-plugin` 重貼）。
- 目前只有關鍵字 + 時間檢索，尚無語意 / 向量 RAG（未來可加 `sqlite-vec`，不破壞單檔設計）。
- 由其他腳本（非經 plugin reply 路徑）送到 Telegram 的訊息不會被攔。
- 在 macOS + Node 26 + plugin 跑於 bun 上實測；其他環境可能需微調。

## 授權

MIT
