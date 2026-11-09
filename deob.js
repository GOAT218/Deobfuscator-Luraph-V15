#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const detectModule = require('./src/detect');
const { deobfuscateFile, mergeArgs } = require('./lib/deobfuscate');

const SUPPORTED_EXTENSIONS = ['.lua', '.luau', '.txt'];

function parseArgs(argv) {
  const args = mergeArgs({
    inputs: [],
    output: null,
  });

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--detect') { args.detect = true; }
    else if (a === '--no-devirt') { args.noDevirt = true; }
    else if (a === '--no-hooks') { args.noHooks = true; }
    else if (a === '--no-fold') { args.noFold = true; }
    else if (a === '--debug') { args.debug = true; }
    else if (a === '--strings') { args.strings = true; }
    else if (a === '--keep-harness') { args.keepHarness = true; }
    else if (a === '--keep-preamble') { args.keepPreamble = true; }
    else if (a === '-o' || a === '--output') { args.output = argv[++i]; }
    else if (a === '--timeout') { args.timeout = parseInt(argv[++i], 10); }
    else if (a === '--budget') { args.budget = parseInt(argv[++i], 10); }
    else if (a === '--max-runs') { args.maxRuns = parseInt(argv[++i], 10); }
    else if (a === '--jobs') { args.jobs = parseInt(argv[++i], 10); }
    else if (a === '--devirt-rounds') { args.devirtRounds = parseInt(argv[++i], 10); }
    else if (a === '--executor') { args.executor = argv[++i]; }
    else if (a === '--input-text') { args.inputText = argv[++i]; }
    else if (!a.startsWith('-')) { args.inputs.push(a); }
  }

  return args;
}

function collectInputFiles(rawPaths) {
  const files = [];
  const seen = new Set();

  for (const raw of rawPaths) {
    const abs = path.resolve(raw);
    if (!fs.existsSync(abs)) {
      process.stderr.write(`[!] path not found, skipping: ${raw}\n`);
      continue;
    }
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
          const filePath = path.join(abs, entry.name);
          if (!seen.has(filePath)) {
            seen.add(filePath);
            files.push(filePath);
          }
        }
      }
    } else if (stat.isFile()) {
      const ext = path.extname(abs).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        process.stderr.write(`[!] unsupported extension for ${raw} (expected ${SUPPORTED_EXTENSIONS.join(', ')})\n`);
        continue;
      }
      if (!seen.has(abs)) {
        seen.add(abs);
        files.push(abs);
      }
    }
  }

  return files;
}

async function processFile(absInput, args) {
  const multi = args.inputs.length > 1;
  const options = { ...args };
  if (multi) delete options.output;
  else if (args.output) options.output = args.output;

  const result = await deobfuscateFile(absInput, options);
  return result.outputPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.inputs.length === 0) {
    console.error('Usage: node deob.js <input.lua | folder> [more_files_or_folders...] [-o <output.lua>] [--no-devirt] [--debug] [--detect]');
    process.exit(2);
  }

  const files = collectInputFiles(args.inputs);
  if (files.length === 0) {
    console.error('[!] no valid .lua / .luau input files found');
    process.exit(1);
  }

  if (args.detect) {
    for (const file of files) {
      const source = fs.readFileSync(file, 'latin1');
      const { plugin, confidence } = detectModule.detect(source);
      console.log(`${path.basename(file)}\t${plugin.name}\t${confidence.toFixed(2)}\t${plugin.label}`);
    }
    return;
  }

  if (files.length > 1 && args.output) {
    process.stderr.write('[!] --output is ignored for multiple inputs (each file goes into its own output/ folder)\n');
  }

  let succeeded = 0;
  let failed = 0;

  const jobs = Math.max(1, Math.min(args.jobs || 1, files.length));
  if (jobs > 1) {
    process.stderr.write(`[*] processing ${files.length} file(s) with ${jobs} parallel jobs\n`);
    let next = 0;
    async function worker() {
      for (;;) {
        const i = next++;
        if (i >= files.length) return;
        const file = files[i];
        process.stderr.write(`\n[*] processing ${file}\n`);
        try {
          const res = await processFile(file, args);
          if (res) succeeded++; else failed++;
        } catch (err) {
          process.stderr.write(`[!] failed on ${path.basename(file)}: ${err.message || err}\n`);
          failed++;
        }
      }
    }
    await Promise.all(Array.from({ length: jobs }, worker));
  } else {
    for (const file of files) {
      process.stderr.write(`\n[*] processing ${file}\n`);
      try {
        const res = await processFile(file, args);
        if (res) succeeded++;
        else failed++;
      } catch (err) {
        process.stderr.write(`[!] failed on ${path.basename(file)}: ${err.message || err}\n`);
        failed++;
      }
    }
  }

  process.stderr.write(`\n[*] done: ${succeeded} succeeded, ${failed} failed out of ${files.length}\n`);
  if (failed > 0 && succeeded === 0) process.exit(1);
}

if (require.main === module) {
  main().catch(err => {
    process.stderr.write('[!] Fatal error: ' + (err.message || err) + '\n');
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  collectInputFiles,
  processFile,
  deobfuscateFile,
  ...require('./lib/deobfuscate'),
};
