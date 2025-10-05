## 0) Goals & constraints

* **Export**

    * Dump all app data to a single JSON file.
    * All images (covers, inline images, attachments) are **embedded as base64** within an `assets[]` section of the JSON.
    * Notes/content reference images by `asset://<assetId>` tokens (not raw data URIs) inside the export.
* **Import**

    * Validate JSON (versioned).
    * For each asset: **decode base64 → write into `/files`** (or S3, etc.) → produce a **public URL**.
    * Rewrite all `asset://...` references in notes/records to those URLs.
    * Recreate entities; maintain referential integrity via an **ID remap**.
* **Portability**

    * Self‑contained, versioned format with schema.
    * Deduplicate assets by SHA‑256 to avoid re‑uploading duplicates.

---

## 1) Export file format (JSON)

### 1.1 Minimal JSON example

```json
{
  "app": "BelloNote",
  "version": "1.0",
  "exportedAt": "2025-10-05T12:34:56.000Z",
  "entities": {
    "notes": [
      {
        "id": "note_01",
        "title": "Welcome",
        "contentFormat": "markdown",
        "content": "Hello! ![sunset](asset://asset_sunset)\n",
        "coverImage": "asset://asset_sunset",
        "tags": ["tag_hello"],
        "createdAt": "2025-09-01T10:00:00.000Z",
        "updatedAt": "2025-09-05T14:30:00.000Z"
      }
    ],
    "tags": [
      { "id": "tag_hello", "name": "hello", "color": "#FFAA00" }
    ],
    "users": []
  },
  "assets": [
    {
      "id": "asset_sunset",
      "filename": "sunset.jpg",
      "mimeType": "image/jpeg",
      "bytes": 12345,
      "sha256": "2d711642b726b04401627ca9fbac32f5da7d6c8b...hex",
      "dataBase64": "/9j/4AAQSkZJRgABAQAAAQABAAD..."  // truncated
    }
  ],
  "meta": {
    "source": "server-01",
    "dbSchema": "2025-09",
    "notes": "Images referenced in content via 'asset://' tokens."
  }
}
```

### 1.2 Key conventions

* **Image references**: Inside any text/HTML/markdown content, images are referenced as `asset://<assetId>`.
  Examples:

    * Markdown: `![alt](asset://asset_sunset)`
    * HTML: `<img src="asset://asset_sunset" alt="sunset" />`
* **Assets**: Stored once in `assets[]` with `dataBase64`. `sha256` gives deduplication; `filename` and `mimeType` carry intent for extension.
* **Versioning**: `"version": "1.0"`. Bump if you change structure.

---

## 2) JSON Schema (Draft 2020-12)

Save as `manifest.schema.json` and use in import validation.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/bellonote-export.schema.json",
  "title": "BelloNote Export",
  "type": "object",
  "required": ["app", "version", "exportedAt", "entities", "assets"],
  "properties": {
    "app": { "type": "string" },
    "version": { "type": "string", "pattern": "^1\\.\\d+$" },
    "exportedAt": { "type": "string", "format": "date-time" },
    "entities": {
      "type": "object",
      "properties": {
        "notes": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "title", "content", "contentFormat", "createdAt", "updatedAt"],
            "properties": {
              "id": { "type": "string" },
              "title": { "type": "string" },
              "contentFormat": { "type": "string", "enum": ["markdown", "html", "plaintext"] },
              "content": { "type": "string" },
              "coverImage": { "type": "string" },
              "tags": { "type": "array", "items": { "type": "string" } },
              "createdAt": { "type": "string", "format": "date-time" },
              "updatedAt": { "type": "string", "format": "date-time" }
            },
            "additionalProperties": true
          }
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "name"],
            "properties": {
              "id": { "type": "string" },
              "name": { "type": "string" },
              "color": { "type": "string" }
            },
            "additionalProperties": true
          }
        },
        "users": { "type": "array" }
      },
      "additionalProperties": true
    },
    "assets": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "filename", "mimeType", "bytes", "sha256", "dataBase64"],
        "properties": {
          "id": { "type": "string", "pattern": "^[a-zA-Z0-9_-]+$" },
          "filename": { "type": "string" },
          "mimeType": { "type": "string" },
          "bytes": { "type": "integer", "minimum": 0 },
          "sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "dataBase64": {
            "type": "string",
            "contentEncoding": "base64"
          }
        },
        "additionalProperties": false
      }
    },
    "meta": { "type": "object", "additionalProperties": true }
  },
  "additionalProperties": false
}
```

---

## 3) Implementation plan (step‑by‑step for Codex)

1. **Serve `/files` statically** (adjust to your stack):

    * Node/Express example:

      ```ts
      import express from "express";
      import path from "path";
      const app = express();
      app.use("/files", express.static(path.join(process.cwd(), "public", "files")));
      ```
    * Ensure `public/files/` exists and is writeable by the server.
    * Configure your base URL for files, e.g. `FILES_BASE_URL=https://yourdomain.com/files`.

2. **Create “Export Manifest” types** used by both export/import.

3. **Export pipeline**

    * Query DB for all entities (notes/tags/users/attachments).
    * For each note/content field:

        * Find image refs: Markdown `![...](...)` and HTML `<img ... src="...">`.
        * Resolve source to bytes:

            * If it’s a **data URI** → decode.
            * If it’s a **local file** under `/files` → read from disk.
            * If **remote URL** and you want full portability → fetch and include (optional).
        * Compute `sha256`; deduplicate; add asset with `dataBase64`.
        * Replace the original `src` with `asset://<assetId>`.
    * Build the manifest JSON and write to disk (or stream to client).

4. **Import pipeline**

    * Read + validate manifest against `manifest.schema.json`.
    * For each `asset`:

        * Decode `dataBase64` → Buffer.
        * Derive extension from `mimeType`, choose filename `${sha256}.${ext}` (stable, dedup-friendly).
        * Write to `public/files/${filename}`. If exists, skip rewrite.
        * Build `assetId → finalUrl` map: `${FILES_BASE_URL}/${filename}`.
    * Rewrite all `asset://...` references in entity content fields to the final URL.
    * Create new records in DB:

        * Build `oldId → newId` maps for each entity type (avoid collisions).
        * Replace foreign keys using the maps.
    * Return a summary (counts, skipped, duplicates).

5. **Add endpoints & CLI**

    * `GET /api/export` → returns JSON manifest (download).
    * `POST /api/import` (multipart or raw JSON) → imports.
    * Optional CLI scripts: `yarn export:json` & `yarn import:json`.

6. **Testing**

    * Unit test regex extraction & replacement.
    * Round‑trip test: export → import into empty DB → data equals (content equal after URL substitution).

7. **Security & limits**

    * Max JSON size, streaming responses, schema validation errors surfaced cleanly.
    * Only accept trusted JSON (admin‑only route).
    * Path traversal safe writes (`files` path locked).

---

## 4) Complete TypeScript reference (drop‑in)

> Files below assume Node 18+, TypeScript, Express, and a simple DB abstraction. Replace stubbed `db.*` calls with your ORM/queries.

### 4.1 `types.ts`

```ts
// types.ts
export type Asset = {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  sha256: string;      // hex
  dataBase64: string;  // raw base64 (no data: prefix)
};

export type Note = {
  id: string;
  title: string;
  contentFormat: "markdown" | "html" | "plaintext";
  content: string;           // may include asset://<id>
  coverImage?: string | null; // asset://<id> or undefined
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  // ...any other fields you have
};

export type Tag = { id: string; name: string; color?: string };

export type ExportManifest = {
  app: string;
  version: "1.0";
  exportedAt: string;
  entities: {
    notes: Note[];
    tags: Tag[];
    users?: any[];
    // add other tables as needed
  };
  assets: Asset[];
  meta?: Record<string, any>;
};
```

### 4.2 `exporter.ts`

```ts
// exporter.ts
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import mime from "mime-types";
import { ExportManifest, Asset, Note, Tag } from "./types";

// ==== Configuration you should wire to env ====
const FILES_DIR = path.join(process.cwd(), "public", "files"); // where your app serves /files
const INCLUDE_REMOTE_IMAGES = true; // set false to skip http(s) downloads
// ==============================================

// ---- Replace with your real DB access ----
const db = {
  async listNotes(): Promise<Note[]> {
    // TODO: fetch from DB; fill contentFormat/content/coverImage/tags etc
    return [];
  },
  async listTags(): Promise<Tag[]> {
    // TODO
    return [];
  }
};
// -------------------------------------------

function sha256(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isDataURI(src: string) {
  return /^data:[^;]+;base64,/.test(src);
}

function isHttpUrl(src: string) {
  return /^https?:\/\//i.test(src);
}

function isFilesUrl(src: string) {
  // consider both absolute and relative program paths to /files
  return /(^\/files\/)|(^files\/)/i.test(src);
}

function extFromMime(m: string) {
  const ext = mime.extension(m);
  return ext || "bin";
}

function decodeDataURI(uri: string): { mimeType: string; buf: Buffer } {
  const m = uri.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid data URI");
  return { mimeType: m[1], buf: Buffer.from(m[2], "base64") };
}

async function fetchBuffer(url: string): Promise<{ mimeType: string; buf: Buffer; filename?: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const cd = res.headers.get("content-disposition") || "";
  let filename: string | undefined;
  const fnMatch = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd || "");
  if (fnMatch) filename = decodeURIComponent(fnMatch[1] || fnMatch[2]);
  return { mimeType: contentType, buf, filename };
}

async function readLocalFilesBuffer(src: string): Promise<{ mimeType: string; buf: Buffer; filename: string }> {
  // Map /files/xyz.png → <FILES_DIR>/xyz.png
  const fname = src.replace(/^\/?files\//i, "");
  const abs = path.join(FILES_DIR, fname);
  const buf = await fs.readFile(abs);
  const mimeType = mime.lookup(path.extname(abs)) || "application/octet-stream";
  return { mimeType: String(mimeType), buf, filename: path.basename(abs) };
}

function extractImgSrcs(content: string): string[] {
  const out = new Set<string>();
  // markdown ![alt](src)
  const mdRegex = /!\[[^\]]*]\(([^)]+)\)/g;
  let m;
  while ((m = mdRegex.exec(content))) out.add(m[1]);

  // html <img src="...">
  const htmlRegex = /<img[^>]*\s+src=["']([^"']+)["']/gi;
  while ((m = htmlRegex.exec(content))) out.add(m[1]);

  return [...out];
}

function replaceSrcs(content: string, srcToAssetRef: Map<string, string>): string {
  let out = content;
  for (const [src, assetRef] of srcToAssetRef) {
    const esc = src.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "g"), assetRef);
  }
  return out;
}

export async function buildExportManifest(): Promise<ExportManifest> {
  const [notes, tags] = await Promise.all([db.listNotes(), db.listTags()]);

  const assetsByHash = new Map<string, Asset>();
  const srcToAssetRef = new Map<string, string>();

  async function materializeAssetFromSrc(src: string): Promise<Asset | null> {
    try {
      let mimeType: string, buf: Buffer, filename: string | undefined;

      if (isDataURI(src)) {
        const d = decodeDataURI(src);
        mimeType = d.mimeType;
        buf = d.buf;
      } else if (isFilesUrl(src)) {
        const d = await readLocalFilesBuffer(src);
        mimeType = d.mimeType;
        buf = d.buf;
        filename = d.filename;
      } else if (isHttpUrl(src)) {
        if (!INCLUDE_REMOTE_IMAGES) return null;
        const d = await fetchBuffer(src);
        mimeType = d.mimeType;
        buf = d.buf;
        filename = d.filename;
      } else {
        // relative path? treat like /files/relative
        if (src.startsWith("./") || src.startsWith("../")) {
          const abs = path.resolve(process.cwd(), src);
          const b = await fs.readFile(abs);
          buf = b;
          const mt = mime.lookup(path.extname(abs)) || "application/octet-stream";
          mimeType = String(mt);
          filename = path.basename(abs);
        } else {
          return null; // unknown scheme
        }
      }

      const hash = sha256(buf);
      if (assetsByHash.has(hash)) return assetsByHash.get(hash)!;

      const ext = extFromMime(mimeType);
      const assetId = `asset_${hash.slice(0, 12)}`;
      const asset: Asset = {
        id: assetId,
        filename: filename || `${assetId}.${ext}`,
        mimeType,
        bytes: buf.length,
        sha256: hash,
        dataBase64: buf.toString("base64")
      };
      assetsByHash.set(hash, asset);
      return asset;
    } catch (err) {
      console.warn("Skipping image src due to error:", src, err);
      return null;
    }
  }

  // Walk notes and cover images
  for (const n of notes) {
    const allSrcs = new Set<string>(extractImgSrcs(n.content));
    if (n.coverImage && !/^asset:\/\//.test(n.coverImage)) allSrcs.add(n.coverImage);

    for (const src of allSrcs) {
      const asset = await materializeAssetFromSrc(src);
      if (!asset) continue;
      srcToAssetRef.set(src, `asset://${asset.id}`);
    }
  }

  // Rewrite note contents to asset:// refs
  const notesRewritten: Note[] = notes.map(n => ({
    ...n,
    content: replaceSrcs(n.content, srcToAssetRef),
    coverImage: n.coverImage && srcToAssetRef.get(n.coverImage) ? srcToAssetRef.get(n.coverImage)! : n.coverImage
  }));

  const manifest: ExportManifest = {
    app: "BelloNote",
    version: "1.0",
    exportedAt: new Date().toISOString(),
    entities: {
      notes: notesRewritten,
      tags
    },
    assets: [...assetsByHash.values()],
    meta: { notes: "All images converted to asset:// refs & embedded base64." }
  };

  return manifest;
}

// CLI helper
if (require.main === module) {
  (async () => {
    const outPath = process.argv[2] || "bellonote-export.json";
    const mf = await buildExportManifest();
    await fs.writeFile(outPath, JSON.stringify(mf, null, 2));
    console.log(`Exported → ${outPath} (notes=${mf.entities.notes.length}, assets=${mf.assets.length})`);
  })().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
```

### 4.3 `importer.ts`

```ts
// importer.ts
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import mime from "mime-types";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { ExportManifest, Note, Tag } from "./types";

const FILES_DIR = path.join(process.cwd(), "public", "files");
const FILES_BASE_URL = process.env.FILES_BASE_URL || "http://localhost:3000/files";

// ---- Replace with your real DB access ----
const db = {
  // Return new IDs so we can map old->new
  async createTag(t: Tag): Promise<string> {
    // TODO: insert & return new id
    return t.id;
  },
  async createNote(n: Note): Promise<string> {
    // TODO
    return n.id;
  }
};
// -------------------------------------------

function sha256(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function extFromMime(m: string) {
  const ext = mime.extension(m);
  return ext || "bin";
}

function rewriteContentAssets(content: string, assetRefToUrl: Map<string, string>): string {
  let out = content;
  for (const [assetRef, url] of assetRefToUrl) {
    const esc = assetRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(esc, "g"), url);
  }
  return out;
}

function compileSchema() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

export async function importManifest(jsonPath: string, schemaPath?: string) {
  const raw = await fs.readFile(jsonPath, "utf-8");
  const manifest: ExportManifest = JSON.parse(raw);

  if (schemaPath) {
    const ajv = compileSchema();
    const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
    const validate = ajv.compile(schema);
    if (!validate(manifest)) {
      console.error(validate.errors);
      throw new Error("Manifest failed schema validation");
    }
  }

  // 1) Write assets to /files and map asset://id -> public URL
  await fs.mkdir(FILES_DIR, { recursive: true });

  const assetRefToUrl = new Map<string, string>();
  for (const asset of manifest.assets) {
    const buf = Buffer.from(asset.dataBase64, "base64");
    const hash = sha256(buf); // should match asset.sha256
    const ext = extFromMime(asset.mimeType);
    const filename = `${hash}.${ext}`;
    const abs = path.join(FILES_DIR, filename);

    // Deduplicate: only write if not present
    try {
      await fs.access(abs);
      // exists; do nothing
    } catch {
      await fs.writeFile(abs, buf);
    }

    const url = `${FILES_BASE_URL}/${filename}`;
    assetRefToUrl.set(`asset://${asset.id}`, url);
  }

  // 2) Recreate tags (ID remap optional)
  const tagIdMap = new Map<string, string>();
  for (const t of manifest.entities.tags || []) {
    const newId = await db.createTag(t);
    tagIdMap.set(t.id, newId);
  }

  // 3) Recreate notes with content & cover images rewritten
  const noteIdMap = new Map<string, string>();
  for (const n of manifest.entities.notes || []) {
    const rewritten: Note = {
      ...n,
      content: rewriteContentAssets(n.content, assetRefToUrl),
      coverImage: n.coverImage ? assetRefToUrl.get(n.coverImage) || n.coverImage : n.coverImage,
      tags: (n.tags || []).map(tid => tagIdMap.get(tid) || tid)
    };
    const newId = await db.createNote(rewritten);
    noteIdMap.set(n.id, newId);
  }

  return {
    notesImported: noteIdMap.size,
    tagsImported: tagIdMap.size,
    assetsProcessed: manifest.assets.length
  };
}

// CLI helper
if (require.main === module) {
  (async () => {
    const inPath = process.argv[2] || "bellonote-export.json";
    const schemaPath = process.argv[3]; // optional
    const res = await importManifest(inPath, schemaPath);
    console.log("Import summary:", res);
  })().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
```

### 4.4 Express routes (optional API)

```ts
// routes.export-import.ts
import express from "express";
import { buildExportManifest } from "./exporter";
import { importManifest } from "./importer";
import fs from "fs/promises";
import path from "path";
import multer from "multer";

const upload = multer({ dest: path.join(process.cwd(), ".uploads") });
export const router = express.Router();

// GET /api/export → downloads manifest JSON
router.get("/export", async (req, res) => {
  const manifest = await buildExportManifest();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="bellonote-export-${Date.now()}.json"`);
  res.status(200).send(JSON.stringify(manifest, null, 2));
});

// POST /api/import (multipart: file field "manifest")
router.post("/import", upload.single("manifest"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "manifest file is required" });
  try {
    const tmpPath = req.file.path;
    const result = await importManifest(tmpPath, path.join(process.cwd(), "manifest.schema.json"));
    await fs.unlink(tmpPath).catch(() => {});
    res.json({ ok: true, ...result });
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message || String(e) });
  }
});
```

---

## 5) How the exporter rewrites content

* Before export:

    * Markdown: `![map](/files/abc.png)` or `![map](https://...)` or `<img src="data:image/png;base64,...">`
* During export:

    * Each source becomes an `asset` with base64.
    * Content rewritten to: `![map](asset://asset_abc123...)`
* During import:

    * `asset://...` tokens become URLs like `https://yourdomain.com/files/<sha>.<ext>`.
    * DB receives content with final URL references.

---

## 6) Dev tasks checklist (paste this to Codex)

1. **Create** `public/files/` and ensure Express (or your server) serves it at `/files`.
2. **Add** `types.ts`, `exporter.ts`, `importer.ts`, `routes.export-import.ts` from above.
3. **Wire** routes in your server:

   ```ts
   import express from "express";
   import { router as exportImportRouter } from "./routes.export-import";
   const app = express();
   app.use("/api", exportImportRouter);
   ```
4. **Implement** the `db` stubs in `exporter.ts`/`importer.ts` with your ORM:

    * `listNotes()`, `listTags()` → fetch full entities.
    * `createTag()`, `createNote()` → insert and return new IDs.
5. **Install deps**:

   ```
   npm i express multer mime-types ajv ajv-formats
   npm i -D typescript @types/express @types/multer @types/mime-types
   ```
6. **Add env**: `FILES_BASE_URL` (e.g., `https://app.example.com/files`).
7. **Add schema file** `manifest.schema.json` and set importer to validate.
8. **Test Round‑Trip**:

    * Seed DB with 2–3 notes, each with one cover image and one inline image.
    * `node dist/exporter.js bellonote-export.json`
    * Drop DB, run `node dist/importer.js bellonote-export.json manifest.schema.json`
    * Open notes → confirm images render from `/files/...`.
9. **Edge cases**:

    * Data URIs in content.
    * HTTP images (enable/disable `INCLUDE_REMOTE_IMAGES`).
    * Duplicate images across notes (dedupe via SHA‑256).
    * Large JSON (optionally stream on export, but keep base64 per requirement).

---

## 7) Notes on other stacks

* **Next.js**: Serve `/public/files` directly. API routes can reuse the same functions.
* **S3/Cloud Storage**: Replace the file write in importer with an S3 upload; build URL from the bucket+key.
* **SQLite/Postgres**: Only change the `db` stubs. The manifest format stays the same.

---

## 8) Troubleshooting & safety

* **Schema errors**: Return first 3 AJV errors to user; fail fast.
* **Path traversal**: Never trust filenames in manifest; derive `${sha}.${ext}` yourself.
* **Memory**: For very big exports/imports, consider streaming; current sample loads JSON into memory (simple to start).
* **Integrity**: Optionally verify `asset.bytes === decodedBuffer.length` and `sha256(decoded) === asset.sha256` during import; abort on mismatch.

---