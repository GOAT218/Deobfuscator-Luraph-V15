# Discord Bot Setup

Turn this deobfuscator into a Discord bot you can host on any Node.js server (VPS, Pterodactyl, bot-hosting panel, etc.).

When the bot is online, anyone on your server can submit obfuscated Luau and get clean source back.

---

## What you get

| Command | What it does |
|---|---|
| `/deobfuscate` | Upload a `.lua` / `.luau` file **or** paste code → returns deobfuscated `.lua` |
| `/deob` | Same as `/deobfuscate` |
| `/detect` | Detect obfuscator only (no lift) |
| `/ping` | Health check + queue status |
| `!deob` | Prefix fallback: attach a file (or wrap code in a \`\`\`lua\`\`\` block) |

Large outputs are always returned as a downloadable attachment. Short outputs are also previewed in chat.

---

## 1. Create a Discord application

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Open **Bot** → **Reset Token** → copy the token.
3. Enable **Message Content Intent** (needed for `!deob`).
4. Open **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Attach Files`, `Embed Links`, `Read Message History`
5. Open the generated URL, invite the bot to your server.
6. Copy the **Application ID** (same as Client ID) from the portal.

---

## 2. Configure the project

```bash
cp .env.example .env
```

Edit `.env`:

```env
DISCORD_TOKEN=paste_bot_token_here
CLIENT_ID=paste_application_id_here
GUILD_ID=paste_your_server_id_here
```

`GUILD_ID` is optional but recommended while testing — slash commands appear instantly on that server. Without it, global commands can take up to an hour.

Enable Developer Mode in Discord (User Settings → Advanced) to copy server / channel IDs.

---

## 3. Install & go online

Requirements on the host:

- **Node.js 18+**
- **Python 3.10+**
- Network access (first run downloads the Luau runtime for your OS if `bin/luau` is missing)

```bash
npm install
npm run deploy-commands
npm start
```

You should see:

```
[+] Logged in as YourBot#1234
[*] Slash commands: /deobfuscate  /detect  /ping
```

Keep the process running (pm2, systemd, or your panel’s start command). Panel start command:

```
npm start
```

---

## 4. Use it

1. In Discord, type `/deobfuscate`.
2. Attach your obfuscated `.lua` file (preferred for large scripts), **or** paste into the `code` option.
3. Wait — small scripts finish in a few seconds; large hubs can take 1–2 minutes.
4. Download the attached `.deobfuscated.lua` file.

Fast trace only (no full VM lift):

```
/deobfuscate file:<your.lua> fast:True
```

or

```
!deob --fast
```

(with a file attached)

---

## Hosting notes

- **One Node process** is enough. Jobs are queued so concurrent users wait in line instead of overloading the host.
- Upload size default is **8 MB** (`MAX_UPLOAD_BYTES`). Raise it if your host/Discord tier allows.
- Timeouts: `DEOB_TIMEOUT` (hard Luau pass timeout, default 90s) and `DEOB_BUDGET` (soft budget, default 30s).
- Linux / macOS hosts auto-download `luau` + `luau-ast` into `bin/` on first run. Windows uses the bundled `.exe` files (or downloads them).
- Never commit `.env`. The repo ignores it.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Slash commands missing | Run `npm run deploy-commands` again; set `GUILD_ID` for instant updates |
| `Missing DISCORD_TOKEN` | Create `.env` from `.env.example` |
| `luau not found` | Ensure outbound HTTPS works so the bot can download the runtime, or place `luau` / `luau-ast` in `bin/` |
| `Python not found` | Install Python 3.10+ or set `PYTHON_BIN` |
| Bot online but ignores `!deob` | Enable **Message Content Intent** in the Developer Portal |
| Job fails / empty output | Try `/detect` first; some v14.8/v14.9 scripts are experimental |
