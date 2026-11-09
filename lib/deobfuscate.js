'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const detectModule = require('../src/detect');
const driver = require('../src/driver');

const DEFAULT_ARGS = {
  detect: false,
  noDevirt: false,
  noHooks: false,
  noFold: false,
  debug: false,
  strings: false,
  keepHarness: false,
  keepPreamble: false,
  timeout: 90,
  budget: 30,
  jobs: 1,
  maxRuns: 12,
  devirtRounds: 200,
  executor: 'Wave',
  inputText: null,
  output: null,
  inputs: [],
};

class Job {
  constructor(inputPath, source, args, tracePath, debug, obfuscator = '') {
    this.input = inputPath;
    this.source = source;
    this.sourcePath = inputPath;
    this.args = args;
    this.tracePath = tracePath;
    this.debug = debug;
    this.obfuscator = obfuscator;
  }

  creditHeader() {
    return '';
  }

  get base() {
    return this.tracePath.replace(/\.(deobf\.luau|luau)$/, '');
  }

  path(suffix) {
    return this.base + suffix;
  }

  wrote(p) {
    if (this.debug) process.stderr.write(`[+] wrote ${p}\n`);
  }

  write(p, text, encoding = 'utf8') {
    fs.writeFileSync(p, text, { encoding });
    this.wrote(p);
    return p;
  }

  get outdir() {
    return path.dirname(path.resolve(this.tracePath));
  }
}

function mergeArgs(overrides = {}) {
  return { ...DEFAULT_ARGS, ...overrides };
}

function safeFilename(name, fallback = 'input.lua') {
  const base = path.basename(name || fallback).replace(/[^\w.\- ()[+\]#]/g, '_');
  return base || fallback;
}

/**
 * Deobfuscate a Luau/Lua source string.
 * @param {string|Buffer} source
 * @param {object} [options]
 * @returns {Promise<{ content: string, obfuscator: string, confidence: number, outputPath: string, detected: string }>}
 */
async function deobfuscateSource(source, options = {}) {
  if (Buffer.isBuffer(source)) source = source.toString('latin1');
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('Empty source: paste or upload obfuscated Luau/Lua code.');
  }

  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'deobf_discord_'));
  const inputPath = path.join(workdir, safeFilename(options.filename));
  const outputPath = path.join(workdir, 'deobfuscated.lua');

  try {
    fs.writeFileSync(inputPath, source, 'latin1');
    const result = await deobfuscateFile(inputPath, { ...options, output: outputPath });
    // Copy content into memory before wiping the temp dir.
    const content = result.content;
    return {
      ...result,
      content,
      outputPath: null,
    };
  } finally {
    try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Deobfuscate a file on disk.
 * @param {string} absInput
 * @param {object} [options]
 * @returns {Promise<{ content: string, obfuscator: string, confidence: number, outputPath: string, detected: string }>}
 */
async function deobfuscateFile(absInput, options = {}) {
  const args = mergeArgs(options);
  absInput = path.resolve(absInput);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input file not found: ${absInput}`);
  }

  const source = fs.readFileSync(absInput, 'latin1');
  const { plugin, confidence } = detectModule.detect(source);

  if (args.detect) {
    return {
      content: '',
      obfuscator: plugin.label,
      confidence,
      outputPath: null,
      detected: plugin.name,
    };
  }

  process.stderr.write(`[*] obfuscator: ${plugin.label} (detected, ${confidence.toFixed(2)})\n`);

  const outdir = args.output
    ? path.dirname(path.resolve(args.output))
    : path.join(path.dirname(absInput), 'output');
  fs.mkdirSync(outdir, { recursive: true });

  const tracename = path.basename(absInput).replace(/(\.luau?|\.txt)?$/, '.deobf.luau');
  const workdir = args.debug ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'deobf_node_'));

  const tracePath = args.debug
    ? (args.output || path.join(outdir, tracename))
    : path.join(workdir, tracename);
  const final = args.output
    ? path.resolve(args.output)
    : path.join(outdir, path.basename(absInput));

  fs.mkdirSync(path.dirname(path.resolve(final)), { recursive: true });

  try {
    const fixed = detectModule.restoreHeaderNewline(source);
    let jobSource = source;
    let sourcePath = absInput;

    if (fixed !== source) {
      process.stderr.write('[*] header comment ran into the code: split it\n');
      jobSource = fixed;
      sourcePath = path.join(workdir || outdir, path.basename(absInput) + '.src.lua');
      fs.writeFileSync(sourcePath, fixed, 'latin1');
    }

    const job = new Job(absInput, jobSource, args, tracePath, args.debug, plugin.label);
    job.sourcePath = sourcePath;

    let result;
    if (plugin.name === 'luraph_v15' || plugin.name === 'luraph_v14') {
      result = await driver.run(job);
    } else {
      result = await driver.runGeneric(job);
    }

    if (final && result && fs.existsSync(result)) {
      let content = fs.readFileSync(result, 'utf8');
      content = content.replace(/^(\s*--(?:[ \t]*(?:Deobfuscated by|Detected obfuscation|Local names are inferred|source:|NOTE: reconstructed|during the trace)[^\n]*\n?|\s*\n))+/, '');
      fs.writeFileSync(final, content, 'utf8');
      process.stderr.write(`[+] result: ${final}\n`);
      return {
        content,
        obfuscator: plugin.label,
        confidence,
        outputPath: final,
        detected: plugin.name,
      };
    }

    throw new Error(`Deobfuscation produced no result for ${path.basename(absInput)}`);
  } finally {
    if (workdir && fs.existsSync(workdir)) {
      try { fs.rmSync(workdir, { recursive: true, force: true }); } catch {}
    }
  }
}

/**
 * Detect obfuscator without running the full pipeline.
 */
function detectOnly(source) {
  if (Buffer.isBuffer(source)) source = source.toString('latin1');
  const { plugin, confidence } = detectModule.detect(source);
  return { name: plugin.name, label: plugin.label, confidence };
}

module.exports = {
  deobfuscateSource,
  deobfuscateFile,
  detectOnly,
  Job,
  DEFAULT_ARGS,
  mergeArgs,
};
