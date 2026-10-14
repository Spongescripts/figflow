import "server-only";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { blob } from "./blob";
import { dataDir } from "../paths";
import { writeFileAtomic } from "../atomic";

function toFsPath(path: string | URL): string {
  if (typeof path === "string") return path;
  return fileURLToPath(path);
}

export function usesBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function blobKey(absPath: string | URL): string {
  const rel = relative(dataDir, toFsPath(absPath)).split(sep).join("/");
  if (!rel || rel.startsWith("..")) throw new Error("Path is outside the data directory.");
  return rel;
}

export async function pathExists(absPath: string | URL): Promise<boolean> {
  absPath = toFsPath(absPath);
  if (!usesBlob()) return existsSync(absPath);
  const key = blobKey(absPath);
  const { head, list } = await blob();
  if ((await head(key).catch(() => null)) !== null) return true;
  const page = await list({ prefix: `${key}/`, limit: 1 });
  return page.blobs.length > 0;
}

/**
 * Writes one blob. Figflow rewrites the same keys (upload.json and project.json change state
 * several times), so overwriting must be allowed: without `allowOverwrite` the second write
 * throws "This blob already exists" and the upload/project is stuck forever.
 */
async function putBlob(absPath: string, body: string | Buffer): Promise<void> {
  const { put } = await blob();
  const contentType = blobContentType(absPath);
  await put(blobKey(absPath), body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    ...(contentType ? { contentType } : {}),
  });
}

async function readBlobKey(key: string): Promise<Buffer | null> {
  const { get } = await blob();
  // useCache: false reads from origin; the CDN copy can be a stale upload.json ("reading" forever).
  const result = await get(key, { access: "private", useCache: false }).catch(() => null);
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const chunks: Uint8Array[] = [];
  const reader = result.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function readBytes(absPath: string | URL): Promise<Buffer | null> {
  absPath = toFsPath(absPath);
  if (!usesBlob()) {
    try {
      return await readFile(absPath);
    } catch {
      return null;
    }
  }
  return readBlobKey(blobKey(absPath));
}

export async function readText(absPath: string): Promise<string | null> {
  const bytes = await readBytes(absPath);
  return bytes ? bytes.toString("utf8") : null;
}

function blobContentType(absPath: string): string | undefined {
  const lower = absPath.toLowerCase();
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".fig")) return "application/octet-stream";
  if (lower.endsWith(".cpp") || lower.endsWith(".h") || lower.endsWith(".hpp")) return "text/plain; charset=utf-8";
  return undefined;
}

export async function writeBytes(absPath: string | URL, data: string | Uint8Array): Promise<void> {
  absPath = toFsPath(absPath);
  if (!usesBlob()) {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFileAtomic(absPath, data);
    return;
  }
  await putBlob(absPath, typeof data === "string" ? data : Buffer.from(data));
}

export async function removeTree(absPath: string): Promise<void> {
  if (!usesBlob()) {
    await rm(absPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined);
    return;
  }
  const prefix = `${blobKey(absPath)}/`;
  const { del, list } = await blob();
  let cursor: string | undefined;
  for (;;) {
    const page = await list({ prefix, cursor, limit: 1000 });
    await Promise.all(page.blobs.map((b) => del(b.pathname)));
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  await del(blobKey(absPath)).catch(() => undefined);
}

export async function listNames(absDir: string): Promise<string[]> {
  if (!usesBlob()) {
    try {
      return await readdir(absDir);
    } catch {
      return [];
    }
  }
  const prefix = `${blobKey(absDir)}/`;
  const seen = new Set<string>();
  const { list } = await blob();
  let cursor: string | undefined;
  for (;;) {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs) {
      const rest = b.pathname.slice(prefix.length);
      const name = rest.split("/")[0];
      if (name) seen.add(name);
    }
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  return [...seen];
}

export async function streamToPath(absPath: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  await mkdir(dirname(absPath), { recursive: true });
  const out = createWriteStream(absPath, { flags: "wx" });
  const reader = body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("too-large");
      if (!out.write(value)) await once(out, "drain");
    }
    out.end();
    await once(out, "finish");
  } catch (e) {
    reader.cancel().catch(() => undefined);
    out.destroy();
    await rm(absPath, { force: true }).catch(() => undefined);
    throw e;
  }
  if (usesBlob()) {
    await putBlob(absPath, await readFile(absPath));
    await rm(absPath, { force: true }).catch(() => undefined);
  }
  return size;
}

export async function openReadStream(absPath: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  absPath = toFsPath(absPath);
  if (!usesBlob()) {
    const info = await stat(absPath).catch(() => null);
    if (!info) return null;
    const { createReadStream } = await import("node:fs");
    const { Readable } = await import("node:stream");
    return { stream: Readable.toWeb(createReadStream(absPath)) as ReadableStream<Uint8Array>, size: info.size };
  }
  const key = blobKey(absPath);
  const { get } = await blob();
  const result = await get(key, { access: "private", useCache: false }).catch(() => null);
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return { stream: result.stream, size: result.blob.size };
}

export async function syncTreeToBlob(absDir: string): Promise<void> {
  if (!usesBlob()) return;
  const { walk } = await import("./walk");
  const files = (await walk(absDir)).filter((f) => existsSync(f));
  // A few uploads at a time: one by one, a project's ~60 files take most of the function's time.
  let next = 0;
  const workers = Array.from({ length: Math.min(8, files.length) }, async () => {
    while (next < files.length) {
      const file = files[next++];
      await putBlob(file, await readFile(file));
    }
  });
  await Promise.all(workers);
}

/** True on Vercel without a Blob store: each function instance has its own /tmp, so uploads vanish between requests. */
export function storageMissing(): boolean {
  return process.env.VERCEL === "1" && !usesBlob() && !process.env.FIGFLOW_DATA_DIR;
}
