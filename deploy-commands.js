#!/usr/bin/env node
'use strict';

/**
 * Registers slash commands with Discord.
 *
 * Required env:
 *   DISCORD_TOKEN
 *   CLIENT_ID   (Application ID from the Discord Developer Portal)
 *
 * Optional:
 *   GUILD_ID    (if set, commands are registered instantly on that server;
 *                omit for global commands which can take up to ~1 hour)
 */

require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID || process.env.DISCORD_GUILD_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('[!] Set DISCORD_TOKEN and CLIENT_ID in .env before deploying commands.');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('deobfuscate')
    .setDescription('Deobfuscate a Luraph-protected Luau/Lua script')
    .addAttachmentOption((opt) =>
      opt.setName('file').setDescription('Obfuscated .lua / .luau / .txt file').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('code').setDescription('Paste obfuscated code (for small scripts)').setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('fast')
        .setDescription('Fast execution-trace mode (skips full VM lift)')
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('deob')
    .setDescription('Alias for /deobfuscate')
    .addAttachmentOption((opt) =>
      opt.setName('file').setDescription('Obfuscated .lua / .luau / .txt file').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('code').setDescription('Paste obfuscated code (for small scripts)').setRequired(false)
    )
    .addBooleanOption((opt) =>
      opt
        .setName('fast')
        .setDescription('Fast execution-trace mode (skips full VM lift)')
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('detect')
    .setDescription('Detect which obfuscator protects a script (no deobfuscation)')
    .addAttachmentOption((opt) =>
      opt.setName('file').setDescription('Obfuscated .lua / .luau / .txt file').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('code').setDescription('Paste obfuscated code').setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check that the bot is online')
    .toJSON(),
];

async function main() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    console.log(`[*] Deploying ${commands.length} guild commands to ${GUILD_ID}…`);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('[+] Guild commands deployed (available immediately).');
  } else {
    console.log(`[*] Deploying ${commands.length} global commands…`);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('[+] Global commands deployed (may take up to ~1 hour to appear).');
  }
}

main().catch((err) => {
  console.error('[!] Deploy failed:', err.message || err);
  process.exit(1);
});
