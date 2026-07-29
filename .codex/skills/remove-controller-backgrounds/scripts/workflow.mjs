#!/usr/bin/env node

import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const IMAGE_EXTENSIONS = new Set([".webp", ".png", ".jpg", ".jpeg"]);
const EXCLUDED_DIRECTORIES = new Set([
  ".codex",
  ".git",
  "background-removal-poc",
  "background-removed",
  "generated",
  "node_modules",
  "tmp",
]);
const DEFAULT_OUTPUT_DIRECTORY = "background-removed";
const DEFAULT_QUALITY = 86;
const WHITE_THRESHOLD = 238;
const MAX_CHANNEL_SPREAD = 20;

function fail(message) {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

function parseArguments(values) {
  const parsed = { _: [] };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--") {
      continue;
    }
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function repositoryRoot() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDirectory, "../../../..");
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverSources(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const sources = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || EXCLUDED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }

    const directory = path.join(root, entry.name);
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!child.isFile() || !IMAGE_EXTENSIONS.has(path.extname(child.name).toLowerCase())) {
        continue;
      }
      sources.push(path.join(entry.name, child.name));
    }
  }

  return sources;
}

function outputRelativePath(sourceRelative) {
  const parsed = path.parse(sourceRelative);
  return path.join(DEFAULT_OUTPUT_DIRECTORY, parsed.dir, `${parsed.name}.webp`);
}

async function inventory(root) {
  const sources = await discoverSources(root);
  const complete = [];
  const pending = [];

  for (const source of sources) {
    if (await exists(path.join(root, outputRelativePath(source)))) {
      complete.push(source);
    } else {
      pending.push(source);
    }
  }

  return { sources, complete, pending };
}

function printStatus({ sources, complete, pending }) {
  console.log(`total: ${sources.length}`);
  console.log(`complete: ${complete.length}`);
  console.log(`pending: ${pending.length}`);
}

function isNearWhite(red, green, blue) {
  return (
    Math.min(red, green, blue) >= WHITE_THRESHOLD
    && Math.max(red, green, blue) - Math.min(red, green, blue) <= MAX_CHANNEL_SPREAD
  );
}

function solidifyConnectedWhite(data, width, height, channels) {
  const pixelCount = width * height;
  const queued = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const enqueue = (pixelIndex) => {
    if (queued[pixelIndex] === 0) {
      queued[pixelIndex] = 1;
      queue[tail] = pixelIndex;
      tail += 1;
    }
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  let whitened = 0;
  while (head < tail) {
    const pixelIndex = queue[head];
    head += 1;

    const offset = pixelIndex * channels;
    if (!isNearWhite(data[offset], data[offset + 1], data[offset + 2])) {
      continue;
    }

    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    whitened += 1;

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x > 0) enqueue(pixelIndex - 1);
    if (x + 1 < width) enqueue(pixelIndex + 1);
    if (y > 0) enqueue(pixelIndex - width);
    if (y + 1 < height) enqueue(pixelIndex + width);
  }

  return whitened;
}

async function finalize(root, args) {
  if (typeof args.source !== "string" || typeof args.generated !== "string") {
    throw new Error("finalize requires --source and --generated");
  }

  const source = path.resolve(root, args.source);
  const generated = path.resolve(args.generated);
  if (!isInside(root, source) || !(await exists(source))) {
    throw new Error(`source does not exist inside the repository: ${args.source}`);
  }
  if (!(await exists(generated))) {
    throw new Error(`generated image does not exist: ${args.generated}`);
  }

  const sourceRelative = path.relative(root, source);
  const knownSources = await discoverSources(root);
  if (!knownSources.includes(sourceRelative)) {
    throw new Error(`source is outside the supported one-folder-deep image set: ${args.source}`);
  }

  const quality = Number(args.quality ?? DEFAULT_QUALITY);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error("--quality must be an integer from 1 to 100");
  }

  const output = path.join(root, outputRelativePath(sourceRelative));
  if (await exists(output)) {
    throw new Error(`refusing to overwrite existing output: ${path.relative(root, output)}`);
  }

  const decoded = await sharp(generated)
    .rotate()
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = decoded.info;
  if (width < 512 || height < 512) {
    throw new Error(`generated image is unexpectedly small: ${width}x${height}`);
  }

  const whitened = solidifyConnectedWhite(decoded.data, width, height, channels);
  const borderCoverage = whitened / (width * height);
  if (borderCoverage < 0.05) {
    throw new Error(
      `only ${(borderCoverage * 100).toFixed(1)}% connected near-white background found; review the edit`,
    );
  }

  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp.webp`;

  try {
    await sharp(decoded.data, { raw: { width, height, channels } })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toFile(temporary);
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }

  const metadata = await sharp(output).metadata();
  console.log(path.relative(root, output));
  console.log(`dimensions: ${metadata.width}x${metadata.height}`);
  console.log(`webp-quality: ${quality}`);
}

function usage() {
  console.log(`Usage:
  workflow.mjs status
  workflow.mjs next [--limit 5]
  workflow.mjs finalize --source <relative-source> --generated <generated-file> [--quality 86]`);
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const command = args._[0];
  const root = repositoryRoot();

  if (command === "status") {
    printStatus(await inventory(root));
    return;
  }

  if (command === "next") {
    const limit = Number(args.limit ?? 5);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("--limit must be an integer from 1 to 100");
    }
    const { pending } = await inventory(root);
    for (const source of pending.slice(0, limit)) {
      console.log(source);
    }
    return;
  }

  if (command === "finalize") {
    await finalize(root, args);
    return;
  }

  usage();
  if (command) {
    process.exitCode = 1;
  }
}

main().catch((error) => fail(error.message));
