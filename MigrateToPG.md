Short answer: **Yes**, you can keep everything in a single **`tasks`** table (plus `projects`, `files`, `outline_versions`) and still be very fast—**if you pick the right indexes and store a few derived columns inside `tasks`**. Under your “no other tables” constraint:

* **Postgres is the best fit** (JSONB + GIN + generated columns + `tsvector`), giving you true index‑accelerated tag/date membership and text search **without any extra tables**.
* **SQLite** can work for ordering, status/archived filtering, and “next reminder due”, but it **cannot** index “JSON array contains X” or full‑text search without adding extra virtual tables. If you insist on *only* the four tables, SQLite is fine for moderate data but won’t scale as far as Postgres on tag/date membership queries. (I include a SQLite design and its limits at the end.)

Below is a **Postgres-first design** that keeps everything self‑contained in `tasks`, followed by the **SQLite variant**.

---

## Postgres design (recommended for “extremely scalable”, with only 4 tables)

### 1) `tasks` table — canonical + derived, nothing else

Everything (tags, reminders, worked‑on dates) stays **inside** `tasks` as JSONB arrays/objects, with a few **derived scalar columns** for fast scheduling and range queries.

```sql
CREATE TABLE projects (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE
);

CREATE TABLE files (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stored_name  TEXT NOT NULL,
  original_name TEXT,
  mime         TEXT NOT NULL,
  size_bytes   BIGINT NOT NULL,
  hash         TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta         JSONB NOT NULL DEFAULT '{}'
);

-- Everything self-contained here:
CREATE TABLE tasks (
  id                 UUID PRIMARY KEY,
  project_id         BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- hierarchy + ordering
  parent_id          UUID,
  position           INTEGER NOT NULL DEFAULT 0,
  -- OPTIONAL but very useful for large trees: materialized path for subtree fetches
  path               TEXT,              -- e.g. '/4bc2/7d3a/…' (application maintains this on move)

  -- canonical text
  title              TEXT NOT NULL DEFAULT '',
  content_json       JSONB NOT NULL,    -- TipTap doc (self-contained truth)
  content_hash       TEXT NOT NULL,     -- hash(title + content_json) to skip re-parsing when unchanged

  -- task meta
  status             TEXT NOT NULL DEFAULT '',  -- '', 'todo', 'in-progress', 'done'
  archived           BOOLEAN NOT NULL DEFAULT FALSE,

  -- derived, still inside tasks (self-contained projection)
  tags               JSONB NOT NULL DEFAULT '[]',        -- array of lowercase strings
  worked_dates       JSONB NOT NULL DEFAULT '[]',        -- array of 'YYYY-MM-DD' strings
  reminders          JSONB NOT NULL DEFAULT '[]',        -- array of {token_id, remind_at, timezone, status, recurrence?, message}

  -- scalar helpers (maintained by app code on write; no triggers needed)
  first_work_date    DATE,               -- MIN(worked_dates)
  last_work_date     DATE,               -- MAX(worked_dates)
  next_remind_at     TIMESTAMPTZ,        -- MIN(remind_at WHERE status='pending')
  reminder_pending_count INTEGER NOT NULL DEFAULT 0,

  -- search
  tsv                tsvector,           -- concatenated lexemes from title + content text

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outline_versions (
  id            BIGSERIAL PRIMARY KEY,
  project_id    BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cause         TEXT NOT NULL DEFAULT 'autosave',
  parent_id     BIGINT,
  hash          TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  meta          JSONB NOT NULL DEFAULT '{}',
  doc_json      JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2) Indexes (what to index and why)

```sql
-- Load outline quickly & deterministically
CREATE INDEX idx_tasks_project_parent_pos
  ON tasks (project_id, parent_id, position, id);

-- Status/archived filters & counts (status bar / quick filters)
CREATE INDEX idx_tasks_project_status_arch
  ON tasks (project_id, status, archived);

-- Incremental sync / “recently updated”
CREATE INDEX idx_tasks_project_updated
  ON tasks (project_id, updated_at DESC);

-- Subtree fetch with a single range scan (if you use `path`)
-- This supports: WHERE project_id=$1 AND path >= '/A/B/' AND path < '/A/B0'
CREATE INDEX idx_tasks_project_path
  ON tasks (project_id, path);

-- Tags membership (include/exclude) - JSONB GIN
CREATE INDEX idx_tasks_tags_gin
  ON tasks USING GIN (tags jsonb_path_ops);

-- Worked-on timeline per day: “tasks that have date D” -> index accelerates `worked_dates @> '["YYYY-MM-DD"]'`
CREATE INDEX idx_tasks_worked_dates_gin
  ON tasks USING GIN (worked_dates jsonb_path_ops);

-- Reminder scheduler: due soon is a pure B-tree range scan on a small subset
CREATE INDEX idx_tasks_next_remind_pending
  ON tasks (next_remind_at)
  WHERE archived = false AND reminder_pending_count > 0;

-- Full text search on title + content
CREATE INDEX idx_tasks_tsv
  ON tasks USING GIN (tsv);
```

> Notes
>
> * `jsonb_path_ops` keeps the GIN index smaller and is perfect for `@>` (contains) checks on arrays.
> * For exclude tags use `AND NOT (tags @> '["badtag"]')` (Postgres will still use GIN).
> * If you don’t want `path` today, you can add it later without changing other columns.

### 3) Write‑path: keep text self‑contained, update derived columns in the same txn

When a task is created/updated/moved:

1. Compute `content_hash = sha1(title + content_json)`. If unchanged → **skip** re-deriving.
2. Else derive:

    * `tags` (lowercase, unique, sorted).
    * `worked_dates` (collect `@YYYY-MM-DD` tokens, unique, sorted).
    * `reminders` (parse all `[[reminder|…]]` tokens with `token_id`, `remind_at`, `status`, `message`, …).
    * `first_work_date = MIN(worked_dates)`, `last_work_date = MAX(worked_dates)`.
    * `next_remind_at = MIN(remind_at WHERE status='pending')` (or `NULL` if none).
    * `reminder_pending_count`.
    * `tsv = to_tsvector('simple', title || ' ' || <plain_text_from_content_json>)`.
3. If it’s a move, recompute `path` for the moved node and **its descendants** (only) in a batched update (you can do this fully inside app code).

All of that happens **without** any extra tables. Copy/paste an outline into a new project → the same derivation runs and the derived columns are rebuilt from the self‑contained text.

### 4) Query patterns (all index‑accelerated)

* **Outline for a project**

  ```sql
  SELECT * FROM tasks
  WHERE project_id = $1
  ORDER BY parent_id NULLS FIRST, position, id;
  ```

* **Filter by status + tags include/exclude**

  ```sql
  SELECT id, title, status, tags
  FROM tasks
  WHERE project_id = $1
    AND archived = false
    AND (status = ANY($2::text[]))                 -- optional
    AND tags @> $3::jsonb                          -- include all tags in array, e.g. '["work","urgent"]'
    AND NOT (tags @> $4::jsonb);                   -- exclude any in array, e.g. '["snooze"]'
  ```

* **Timeline (day bucket)**

  ```sql
  SELECT id, title
  FROM tasks
  WHERE worked_dates @> to_jsonb(ARRAY[$1]::text[]);  -- $1 = 'YYYY-MM-DD'
  ```

* **Scheduler: due reminders**

  ```sql
  SELECT id, project_id, title, reminders
  FROM tasks
  WHERE archived = false
    AND reminder_pending_count > 0
    AND next_remind_at <= now()
  ORDER BY next_remind_at
  LIMIT 500
  FOR UPDATE SKIP LOCKED;  -- optional if you run multiple workers
  ```

* **Search**

  ```sql
  SELECT id, title
  FROM tasks
  WHERE project_id = $1
    AND tsv @@ plainto_tsquery('simple', $2)
  ORDER BY updated_at DESC
  LIMIT 100;
  ```

### 5) Minimal server changes (grounded in your repo)

* **Remove** the `work_logs` table and logic. In `server/src/routes/outline.js`, you currently join `work_logs` to attach `dates` into each task before building the tree. Switch that to read `worked_dates` directly from `tasks` (it’s now a column). The tree builder will use `task.worked_dates` for `ownWorkedOn`.

* **Update** `server/src/routes/day.js` to compute day groups from `worked_dates @> '["YYYY-MM-DD"]'` and (optionally) from reminders by scanning **only the tasks that have `next_remind_at` within a day range**, not the whole project.

* **Replace** client‑side “scan all nodes for reminders” with a server endpoint that selects `next_remind_at` due tasks, then the client can still render reminders per token from the returned `reminders` JSON (no data loss).

> None of this changes the user‑visible text format. Copy/paste keeps working because the **truth** is still the TipTap content; derived columns are just for speed.

---

## SQLite variant (works, but with important limits under your constraint)

If you **must** stay with only 4 tables in SQLite, use the same column layout, but accept:

* No index‑accelerated **JSON array membership** (`tags` include/exclude, `worked_dates` contains D) or full‑text without adding extra virtual tables.
* You still get excellent performance for:

    * outline order (`project_id, parent_id, position`)
    * status/archived filters
    * incremental sync (`updated_at`)
    * reminder scheduling (`next_remind_at` + partial index)
    * subtree fetch if you use `path` (prefix `LIKE` can use the index)

### SQLite DDL sketch

```sql
CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,             -- UUID
  project_id       INTEGER NOT NULL,
  parent_id        TEXT,
  position         INTEGER NOT NULL DEFAULT 0,
  path             TEXT,                         -- optional, for subtree fetches

  title            TEXT NOT NULL DEFAULT '',
  content_json     TEXT NOT NULL,
  content_hash     TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT '',
  archived         INTEGER NOT NULL DEFAULT 0,

  tags_json        TEXT NOT NULL DEFAULT '[]',   -- JSON array (self-contained)
  worked_dates_json TEXT NOT NULL DEFAULT '[]',  -- JSON array of 'YYYY-MM-DD'
  reminders_json   TEXT NOT NULL DEFAULT '[]',   -- JSON array of tokens

  first_work_date  TEXT,                         -- 'YYYY-MM-DD'
  last_work_date   TEXT,
  next_remind_at   TEXT,                         -- ISO UTC
  reminder_pending_count INTEGER NOT NULL DEFAULT 0,

  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### SQLite indexes to create

```sql
CREATE INDEX idx_tasks_project_parent_pos
  ON tasks(project_id, parent_id, position, id);

CREATE INDEX idx_tasks_project_status_arch
  ON tasks(project_id, status, archived);

CREATE INDEX idx_tasks_project_updated
  ON tasks(project_id, updated_at DESC);

-- subtree via prefix LIKE (SQLite can use index for LIKE 'prefix%')
CREATE INDEX idx_tasks_project_path
  ON tasks(project_id, path);

-- reminder scheduler
CREATE INDEX idx_tasks_next_remind_pending
  ON tasks(next_remind_at)
  WHERE archived = 0 AND reminder_pending_count > 0;
```

> **Limits to know:**
>
> * Tag include/exclude becomes a scan unless you add another (virtual) table (FTS5 or a tag projection), which violates your “four tables” rule.
> * `worked_dates_json` membership (“which tasks mention 2025‑10‑04?”) is also a scan. If this query must be fast at very large scale, **use Postgres**.

**Optional advanced hack for SQLite (still 4 tables):** keep a 128‑bit **Bloom** for tags in two BIGINT columns (`tags_bloom_hi`, `tags_bloom_lo`) and index them. Queries can check `(tags_bloom_{hi,lo} & filter_mask) = filter_mask` to pre‑filter, then do an exact JSON check in the few survivors. It’s approximate (occasional false positives) but fast and stays in one table. It’s extra app work, but no extra tables.

---

## Migration & integration (both PG and SQLite)

1. **Add columns** to `tasks`: `content_hash`, `tags`, `worked_dates`, `reminders`, `first_work_date`, `last_work_date`, `next_remind_at`, `reminder_pending_count`, `tsv` (PG), `path` (optional).
2. **Backfill once**: for every task, parse current content/title → fill the derived columns.
3. **Write‑path updates** (in `server/src/routes/outline.js`):

    * After sanitizing the incoming task, compute `content_hash`. If changed, run parsers to recompute derived columns and update the row; otherwise skip.
    * Remove old `work_logs` reads/writes; the dates live in `tasks.worked_dates`.
4. **Endpoints**:

    * `/api/outline`: unchanged payload shape; tree builder reads `worked_dates` from `tasks`.
    * `/api/day`: switch to `worked_dates` (and optionally `next_remind_at` for reminder‑based days).
    * (Optional) `/api/reminders`: read from `tasks` filtered by `next_remind_at`.
5. **Indexes**: create the ones listed above. For PG, run `VACUUM ANALYZE` and `REINDEX` if needed.

---

## Bottom line / recommendation

* With your **“only 4 tables”** constraint, **Postgres** is the right choice for *extreme* scale: it gives you **GIN on JSONB** (for tags and worked‑date membership), **B‑tree** on `next_remind_at` (scheduler), and **GIN on `tsvector`** (search)—**all inside `tasks`**.
* If you stay on **SQLite** with the same constraint, you’ll be fine for ordering, status filters, subtree fetch, and reminders due; **tag/date membership and full‑text** will not be truly index‑accelerated, so very large outlines will eventually hit a ceiling. (The Bloom hack can buy you headroom without extra tables.)

If you want, I can turn this into **ready‑to‑run migration SQL** and a **small patch** to `server/src/routes/outline.js` and `server/src/routes/day.js` that implements the write‑path updates and removes the `work_logs` dependency.
