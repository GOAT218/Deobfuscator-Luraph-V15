#!/usr/bin/env node
'use strict';

/**
 * Discord bot for the Luraph v15 deobfuscator.
 *
 * Setup:
 *   1. Copy .env.example -> .env and set DISCORD_TOKEN (+ optional CLIENT_ID / GUILD_ID)
 *   2. npm install
 *   3. npm run deploy-commands
 *   4. npm start
 *
 * Usage in Discord:
 *   /deobfuscate  (attach a .lua/.luau/.txt file, or paste code)
 *   /detect       (detect obfuscator only)
 */

require('dotenv').config();

const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  AttachmentBuilder,
  EmbedBuilder,
} = require('discord.js');
const { deobfuscateSource, detectOnly } = require('./lib/deobfuscate');

const TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024);
const MAX_PREVIEW_CHARS = Number(process.env.MAX_PREVIEW_CHARS || 1800);
const DEFAULT_TIMEOUT = Number(process.env.DEOB_TIMEOUT || 90);
const DEFAULT_BUDGET = Number(process.env.DEOB_BUDGET || 30);
const ALLOWED_EXTS = new Set(['.lua', '.luau', '.txt']);

if (!TOKEN) {
  console.error('[!] Missing DISCORD_TOKEN. Copy .env.example to .env and set your bot token.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

/** Simple FIFO queue so heavy jobs do not pile up on one host. */
const queue = [];
let busy = false;

function enqueue(task) {
  return new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    pump();
  });
}

async function pump() {
  if (busy) return;
  const next = queue.shift();
  if (!next) return;
  busy = true;
  try {
    next.resolve(await next.task());
  } catch (err) {
    next.reject(err);
  } finally {
    busy = false;
    if (queue.length) setImmediate(pump);
  }
}

function queuePosition() {
  return queue.length + (busy ? 1 : 0);
}

async function readAttachment(attachment) {
  if (!attachment) return null;
  if (attachment.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File too large (${formatBytes(attachment.size)}). Max is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
  }
  const ext = path.extname(attachment.name || '').toLowerCase();
  if (ext && !ALLOWED_EXTS.has(ext)) {
    throw new Error(`Unsupported file type "${ext}". Use .lua, .luau, or .txt.`);
  }
  const res = await fetch(attachment.url);
  if (!res.ok) throw new Error(`Failed to download attachment (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { name: attachment.name || 'input.lua', source: buf.toString('latin1') };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function previewBlock(content) {
  const trimmed = content.replace(/\s+$/, '');
  if (trimmed.length <= MAX_PREVIEW_CHARS) {
    return '```lua\n' + trimmed + '\n```';
  }
  return '```lua\n' + trimmed.slice(0, MAX_PREVIEW_CHARS) + '\n```\n_(truncated — full output is in the attached file)_';
}

function buildResultFiles(content, baseName) {
  const outName = (baseName || 'script').replace(/\.(luau?|txt)$/i, '') + '.deobfuscated.lua';
  const buf = Buffer.from(content, 'utf8');
  const file = new AttachmentBuilder(buf, { name: outName });
  return { file, outName };
}

async function runDeobfuscate({ source, filename, noDevirt, timeout, budget }) {
  const started = Date.now();
  const result = await deobfuscateSource(source, {
    filename,
    noDevirt: !!noDevirt,
    timeout: timeout || DEFAULT_TIMEOUT,
    budget: budget || DEFAULT_BUDGET,
  });
  return { ...result, elapsedMs: Date.now() - started };
}

async function handleDeobfuscateInteraction(interaction) {
  const fileOpt = interaction.options.getAttachment('file');
  const codeOpt = interaction.options.getString('code');
  const noDevirt = interaction.options.getBoolean('fast') || false;

  let source = null;
  let filename = 'paste.lua';

  if (fileOpt) {
    const got = await readAttachment(fileOpt);
    source = got.source;
    filename = got.name;
  } else if (codeOpt && codeOpt.trim()) {
    source = codeOpt;
    filename = 'paste.lua';
  } else {
    await interaction.editReply({
      content: 'Provide either a **file** attachment or paste obfuscated code into the **code** option.',
    });
    return;
  }

  const position = queuePosition();
  if (position > 0) {
    await interaction.editReply({
      content: `Queued (position ${position}). Deobfuscating **${filename}**… this can take from a few seconds up to a couple of minutes.`,
    });
  } else {
    await interaction.editReply({
      content: `Deobfuscating **${filename}**… this can take from a few seconds up to a couple of minutes.`,
    });
  }

  const { content, obfuscator, confidence, elapsedMs } = await enqueue(() =>
    runDeobfuscate({ source, filename, noDevirt })
  );

  if (!content || !content.trim()) {
    await interaction.editReply({ content: 'Deobfuscation finished but the output was empty.' });
    return;
  }

  const { file, outName } = buildResultFiles(content, filename);
  const embed = new EmbedBuilder()
    .setTitle('Deobfuscation complete')
    .setColor(0x2ecc71)
    .addFields(
      { name: 'Detected', value: `${obfuscator} (${(confidence * 100).toFixed(0)}%)`, inline: true },
      { name: 'Mode', value: noDevirt ? 'Fast trace (`--no-devirt`)' : 'Full lift', inline: true },
      { name: 'Time', value: `${(elapsedMs / 1000).toFixed(1)}s`, inline: true },
      { name: 'Output size', value: formatBytes(Buffer.byteLength(content, 'utf8')), inline: true },
      { name: 'File', value: outName, inline: true },
    )
    .setTimestamp(new Date());

  await interaction.editReply({
    content: previewBlock(content),
    embeds: [embed],
    files: [file],
  });
}

async function handleDetectInteraction(interaction) {
  const fileOpt = interaction.options.getAttachment('file');
  const codeOpt = interaction.options.getString('code');

  let source = null;
  let filename = 'paste.lua';
  if (fileOpt) {
    const got = await readAttachment(fileOpt);
    source = got.source;
    filename = got.name;
  } else if (codeOpt && codeOpt.trim()) {
    source = codeOpt;
  } else {
    await interaction.editReply({ content: 'Provide a **file** or paste **code**.' });
    return;
  }

  const info = detectOnly(source);
  const embed = new EmbedBuilder()
    .setTitle('Obfuscator detection')
    .setColor(0x3498db)
    .addFields(
      { name: 'File', value: filename, inline: true },
      { name: 'Name', value: info.label, inline: true },
      { name: 'Id', value: info.name, inline: true },
      { name: 'Confidence', value: `${(info.confidence * 100).toFixed(0)}%`, inline: true },
    );
  await interaction.editReply({ embeds: [embed] });
}

client.once('ready', () => {
  console.log(`[+] Logged in as ${client.user.tag}`);
  console.log('[*] Slash commands: /deobfuscate  /detect  /ping');
  console.log('[*] Prefix fallback: !deob  (attach a .lua file or wrap code in a lua code block)');
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'ping') {
      await interaction.reply({ content: `Pong — queue ${queue.length}, busy=${busy}` });
      return;
    }

    if (interaction.commandName === 'deobfuscate' || interaction.commandName === 'deob') {
      await interaction.deferReply();
      await handleDeobfuscateInteraction(interaction);
      return;
    }

    if (interaction.commandName === 'detect') {
      await interaction.deferReply();
      await handleDetectInteraction(interaction);
      return;
    }
  } catch (err) {
    console.error('[!] command error:', err);
    const msg = `Failed: ${err.message || err}`;
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg, embeds: [], files: [] });
      } else {
        await interaction.reply({ content: msg, ephemeral: true });
      }
    } catch (replyErr) {
      console.error('[!] could not send error reply:', replyErr.message || replyErr);
    }
  }
});

/**
 * Fallback: reply to a message that has a .lua attachment with !deob or !deobfuscate
 */
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const text = (message.content || '').trim();
  if (!/^!(?:deobfuscate|deob)(?:\s|$)/i.test(text)) return;

  const attachment = [...message.attachments.values()].find((a) => {
    const ext = path.extname(a.name || '').toLowerCase();
    return ALLOWED_EXTS.has(ext);
  });

  const codeMatch = text.match(/```(?:lua[u]?)?\n([\s\S]*?)```/i);
  let source = null;
  let filename = 'paste.lua';

  try {
    if (attachment) {
      const got = await readAttachment(attachment);
      source = got.source;
      filename = got.name;
    } else if (codeMatch) {
      source = codeMatch[1];
    } else {
      await message.reply('Attach a `.lua` / `.luau` file or wrap code in a ```lua``` block, then use `!deob`.');
      return;
    }

    const status = await message.reply(`Deobfuscating **${filename}**…`);
    const fast = /\s--?fast\b|\s--no-devirt\b/i.test(text);

    const { content, obfuscator, confidence, elapsedMs } = await enqueue(() =>
      runDeobfuscate({ source, filename, noDevirt: fast })
    );

    const { file, outName } = buildResultFiles(content, filename);
    const embed = new EmbedBuilder()
      .setTitle('Deobfuscation complete')
      .setColor(0x2ecc71)
      .addFields(
        { name: 'Detected', value: `${obfuscator} (${(confidence * 100).toFixed(0)}%)`, inline: true },
        { name: 'Time', value: `${(elapsedMs / 1000).toFixed(1)}s`, inline: true },
        { name: 'File', value: outName, inline: true },
      );

    await status.edit({
      content: previewBlock(content),
      embeds: [embed],
      files: [file],
    });
  } catch (err) {
    console.error('[!] message command error:', err);
    try {
      await message.reply(`Failed: ${err.message || err}`);
    } catch {}
  }
});

client.login(TOKEN).catch((err) => {
  console.error('[!] Login failed:', err.message || err);
  process.exit(1);
});
