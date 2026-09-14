import json, os, sqlite3, threading, uuid, calendar
from datetime import date, datetime, timezone
from flask import current_app, g

_lock = threading.Lock()

REQUIRED_TABLES = {"settings", "groups", "items", "checks", "checks_state", "predefined_apps", "tasks", "task_notes", "widgets"}
TASK_STATUSES = ["New", "In Progress", "Pending", "Scheduled", "On Hold", "Completed"]
WIDGET_TYPES = ["weather", "tasks"]
SUPPORTED_LANGUAGES = ["en", "nl"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    theme TEXT NOT NULL DEFAULT 'dark',
    color_primary TEXT NOT NULL DEFAULT '#3b82f6',
    color_background TEXT NOT NULL DEFAULT '#0f172a',
    color_surface TEXT NOT NULL DEFAULT '#1e293b',
    color_text TEXT NOT NULL DEFAULT '#e2e8f0',
    language TEXT NOT NULL DEFAULT 'en'
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    columns INTEGER NOT NULL DEFAULT 4
);

CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '',
    local_ip TEXT NOT NULL DEFAULT '',
    port TEXT NOT NULL DEFAULT '',
    domain TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    checks_excluded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT 'fa-shield-halved',
    endpoint TEXT NOT NULL,
    clear_endpoint TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    column_index INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO checks (id, name, icon, endpoint, clear_endpoint, enabled, column_index, sort_order)
VALUES
('outbound_ip', 'Outbound IP monitor', 'fa-globe', '/api/checks/outbound-ip', '/api/checks/outbound-ip/clear', 1, 0, 0),
('ssl_expiry',  'SSL certificate expiry', 'fa-lock', '/api/checks/ssl-expiry', NULL, 1, 1, 0),
('uptime',      'App availability', 'fa-heart-pulse', '/api/checks/uptime', NULL, 1, 2, 0);

CREATE TABLE IF NOT EXISTS checks_state (
    check_id TEXT PRIMARY KEY REFERENCES checks(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO checks_state (check_id, state_json)
VALUES
('outbound_ip', '{"current_ip": null, "previous_ip": null, "changed": false, "last_checked": null}'),
('ssl_expiry',  '{"last_checked": null, "results": []}'),
('uptime',      '{"last_checked": null, "results": []}');

CREATE TABLE IF NOT EXISTS predefined_apps (
    id INTEGER NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    port TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO predefined_apps (id, name, icon, port, sort_order)
VALUES
(1, 'AdGuard Home', 'adguard-home.png', '3000', 0),
(2, 'Bazarr', 'bazarr.png', '6767', 1),
(3, 'FlareSolverr', 'flaresolverr.png', '8191', 2),
(4, 'Gitea', 'gitea.png', '3000', 3),
(5, 'Home Assistant', 'home-assistant.png', '8123', 4),
(6, 'Immich', 'immich.png', '2283', 5),
(7, 'Jellyfin', 'jellyfin.png', '8096', 6),
(8, 'Leafwiki', 'leafwiki.png', '8080', 7),
(9, 'Lidarr', 'lidarr.png', '8686', 8),
(10, 'MeTify', 'metify.png', '5000', 9),
(11, 'MeTube', 'metube.png', '8081', 10),
(12, 'Nextcloud', 'nextcloud.png', '443', 11),
(13, 'Nginx Proxy Manager', 'nginx-proxy-manager.png', '81', 12),
(14, 'Pi-hole', 'pi-hole.png', '80', 13),
(15, 'Plex', 'plex.png', '32400', 14),
(16, 'Portainer', 'portainer.png', '9000', 15),
(17, 'Prowlarr', 'prowlarr.png', '9696', 16),
(18, 'Proxmox', 'proxmox.png', '8006', 17),
(19, 'qBittorrent', 'qbittorrent.png', '8080', 18),
(20, 'Radarr', 'radarr.png', '7878', 19),
(21, 'Seerr', 'seerr.png', '5055', 20),
(22, 'Sonarr', 'sonarr.png', '8989', 21),
(23, 'Tdarr', 'tdarr.png', '8265', 22),
(24, 'Uptime Kuma', 'uptime-kuma.png', '3001', 23),
(25, 'Wiki.js', 'wikijs.png', '3000', 24);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'New',
    created_date TEXT NOT NULL,
    due_date TEXT,
    complete_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_item_id ON tasks(item_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS task_notes (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_notes_task_id ON task_notes(task_id);

CREATE TABLE IF NOT EXISTS widgets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL DEFAULT '{}'
);
"""

def _connect(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

def _ensure_column(conn, table, column, ddl):
    cols = [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")

def init_db(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = _connect(path)
    try:
        conn.executescript(SCHEMA)
        _ensure_column(conn, "items", "checks_excluded", "INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    finally:
        conn.close()

def get_db():
    if "db" not in g:
        g.db = _connect(current_app.config["DB_FILE"])
    return g.db

def close_db(Exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def new_id():
    return uuid.uuid4().hex[:12]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def _add_one_month(d):
    month = d.month + 1
    year = d.year
    if month > 12:
        month = 1
        year += 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)

# ---------- Settings ----------
def get_settings_dict(conn):
    row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    checks_rows = conn.execute("SELECT * FROM checks ORDER BY column_index, sort_order").fetchall()

    max_col = max((c["column_index"] for c in checks_rows), default=-1)
    layout = [[] for _ in range(max(3, max_col + 1))]
    checks_enabled = {}
    for c in checks_rows:
        layout[c["column_index"]].append(c["id"])
        checks_enabled[c["id"]] = bool(c["enabled"])

    return {
        "theme": row["theme"],
        "colors": {
            "primary": row["color_primary"],
            "background": row["color_background"],
            "surface": row["color_surface"],
            "text": row["color_text"],
        },
        "language": row["language"] if row["language"] in SUPPORTED_LANGUAGES else "en",
        "checks_enabled": checks_enabled,
        "checks_layout": layout,
    }

def update_settings(conn, body):
    if "theme" in body:
        conn.execute("UPDATE settings SET theme = ? WHERE id = 1", (body["theme"],))
    if "colors" in body:
        for key in ("primary", "background", "surface", "text"):
            if key in body["colors"]:
                conn.execute(f"UPDATE settings SET color_{key} = ? WHERE id = 1", (body["colors"][key],))
    if "language" in body and body["language"] in SUPPORTED_LANGUAGES:
        conn.execute("UPDATE settings SET language = ? WHERE id = 1", (body["language"],))
    if "checks_enabled" in body:
        for check_id, enabled in body["checks_enabled"].items():
            conn.execute("UPDATE checks SET enabled = ? WHERE id = ?", (1 if enabled else 0, check_id))
    conn.commit()
    return get_settings_dict(conn)

def update_checks_enabled(conn, checks_enabled):
    for check_id, enabled in checks_enabled.items():
        conn.execute("UPDATE checks SET enabled = ? WHERE id = ?", (1 if enabled else 0, check_id))
    conn.commit()

# ---------- Groups & items ----------
def _item_dict(row, open_tasks=0):
    return {
        "id": row["id"], "name": row["name"], "icon": row["icon"],
        "local_ip": row["local_ip"], "port": row["port"], "domain": row["domain"],
        "open_tasks": open_tasks,
        "checks_excluded": bool(row["checks_excluded"]),
    }

def get_groups_with_items(conn):
    groups = conn.execute("SELECT * FROM groups ORDER BY sort_order").fetchall()
    counts = get_open_task_counts(conn)
    result = []
    for grp in groups:
        items = conn.execute("SELECT * FROM items WHERE group_id = ? ORDER BY sort_order", (grp["id"],)).fetchall()
        result.append({
            "id": grp["id"], "name": grp["name"], "order": grp["sort_order"], "columns": grp["columns"],
            "items": [_item_dict(it, counts.get(it["id"], 0)) for it in items],
        })
    return result

def find_group(conn, group_id):
    row = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    return dict(row) if row else None

def find_group_by_name(conn, name):
    name_norm = name.strip().lower()
    row = conn.execute("SELECT * FROM groups WHERE lower(trim(name)) = ?", (name_norm,)).fetchone()
    return dict(row) if row else None

def _next_group_order(conn):
    return conn.execute("SELECT COUNT(*) FROM groups").fetchone()[0]

def _get_or_create_group(conn, name):
    group = find_group_by_name(conn, name)
    if group:
        return group
    group_id = new_id()
    conn.execute(
        "INSERT INTO groups (id, name, sort_order, columns) VALUES (?, ?, ?, 4)",
        (group_id, name, _next_group_order(conn)),
    )
    return {"id": group_id, "name": name, "sort_order": _next_group_order(conn) - 1, "columns": 4}

def create_group(conn, name):
    group_id = new_id()
    conn.execute(
        "INSERT INTO groups (id, name, sort_order, columns) VALUES (?, ?, ?, 4)",
        (group_id, name, _next_group_order(conn)),
    )
    conn.commit()
    return {"id": group_id, "name": name, "order": _next_group_order(conn) - 1, "columns": 4, "items": []}

def update_group(conn, group_id, name=None, columns=None):
    group = find_group(conn, group_id)
    if not group:
        return None
    if name is not None:
        name = name.strip()
        if name:
            conn.execute("UPDATE groups SET name = ? WHERE id = ?", (name, group_id))
    if columns is not None:
        try:
            cols = max(1, min(int(columns), 12))
            conn.execute("UPDATE groups SET columns = ? WHERE id = ?", (cols, group_id))
        except (TypeError, ValueError):
            pass
    conn.commit()
    row = conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
    items = conn.execute("SELECT * FROM items WHERE group_id = ? ORDER BY sort_order", (group_id,)).fetchall()
    counts = get_open_task_counts(conn)
    return {"id": row["id"], "name": row["name"], "order": row["sort_order"], "columns": row["columns"],
            "items": [_item_dict(it, counts.get(it["id"], 0)) for it in items]}

def reorder_groups(conn, order):
    known_ids = {r["id"] for r in conn.execute("SELECT id FROM groups").fetchall()}
    ordered_ids = [gid for gid in order if gid in known_ids]

    position = 0
    for gid in ordered_ids:
        conn.execute("UPDATE groups SET sort_order = ? WHERE id = ?", (position, gid))
        position += 1

    leftover = conn.execute("SELECT id FROM groups ORDER BY sort_order").fetchall()
    for r in leftover:
        if r["id"] not in ordered_ids:
            conn.execute("UPDATE groups SET sort_order = ? WHERE id = ?", (position, r["id"]))
            position += 1
    conn.commit()

def remove_empty_groups(conn, keep_group_id=None):
    empty = conn.execute(
        "SELECT g.id FROM groups g LEFT JOIN items i ON i.group_id = g.id "
        "WHERE i.id IS NULL AND g.id != ?",
        (keep_group_id or "",),
    ).fetchall()
    for r in empty:
        conn.execute("DELETE FROM groups WHERE id = ?", (r["id"],))

    remaining = conn.execute("SELECT id FROM groups ORDER BY sort_order").fetchall()
    for idx, r in enumerate(remaining):
        conn.execute("UPDATE groups SET sort_order = ? WHERE id = ?", (idx, r["id"]))
    conn.commit()

def find_item(conn, item_id):
    row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if not row:
        return None, None
    group = find_group(conn, row["group_id"])
    return group, dict(row)

def create_item(conn, group_name, fields):
    group_name = (group_name or "").strip()
    group = _get_or_create_group(conn, group_name)
    count = conn.execute("SELECT COUNT(*) FROM items WHERE group_id = ?", (group["id"],)).fetchone()[0]
    item_id = new_id()
    conn.execute(
        "INSERT INTO items (id, group_id, name, icon, local_ip, port, domain, sort_order, checks_excluded) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (item_id, group["id"], (fields.get("name") or "New app").strip(), fields.get("icon") or "",
         fields.get("local_ip") or "", fields.get("port") or "", fields.get("domain") or "", count,
         1 if fields.get("checks_excluded") else 0),
    )
    conn.commit()
    _, item = find_item(conn, item_id)
    return _item_dict(item, 0), group["id"]

def update_item(conn, item_id, fields, group_name=None):
    group, item = find_item(conn, item_id)
    if not item:
        return None
    for field in ("name", "icon", "local_ip", "port", "domain"):
        if field in fields:
            conn.execute(f"UPDATE items SET {field} = ? WHERE id = ?", (fields[field], item_id))
    if "checks_excluded" in fields:
        conn.execute("UPDATE items SET checks_excluded = ? WHERE id = ?",
                     (1 if fields["checks_excluded"] else 0, item_id))

    if group_name is not None:
        group_name = group_name.strip()
        if group_name and group_name.lower() != group["name"].strip().lower():
            target = _get_or_create_group(conn, group_name)
            count = conn.execute("SELECT COUNT(*) FROM items WHERE group_id = ?", (target["id"],)).fetchone()[0]
            conn.execute("UPDATE items SET group_id = ?, sort_order = ? WHERE id = ?",
                         (target["id"], count, item_id))
            conn.commit()
            remove_empty_groups(conn, keep_group_id=target["id"])

    conn.commit()
    _, item = find_item(conn, item_id)
    counts = get_open_task_counts(conn)
    return _item_dict(item, counts.get(item_id, 0))

def delete_item(conn, item_id):
    _, item = find_item(conn, item_id)
    if not item:
        return False
    conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
    conn.commit()
    remove_empty_groups(conn)
    return True

def move_item(conn, item_id, target_group_id, target_index):
    source_group, item = find_item(conn, item_id)
    target_group = find_group(conn, target_group_id)
    if not item or not target_group:
        return False

    conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
    remaining = conn.execute(
        "SELECT id FROM items WHERE group_id = ? ORDER BY sort_order", (target_group_id,)
    ).fetchall()

    target_index = max(0, min(target_index, len(remaining)))
    ids = [r["id"] for r in remaining]
    ids.insert(target_index, None)

    conn.execute(
        "INSERT INTO items (id, group_id, name, icon, local_ip, port, domain, sort_order, checks_excluded) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (item["id"], target_group_id, item["name"], item["icon"], item["local_ip"],
         item["port"], item["domain"], target_index, item["checks_excluded"]),
    )
    for idx, existing_id in enumerate(ids):
        if existing_id is not None:
            conn.execute("UPDATE items SET sort_order = ? WHERE id = ?", (idx, existing_id))
    conn.commit()
    remove_empty_groups(conn, keep_group_id=target_group_id)
    return True

# ---------- Checks ----------
def get_checks_meta(conn):
    rows = conn.execute("SELECT id, name, icon, endpoint, clear_endpoint FROM checks ORDER BY rowid").fetchall()
    result = []
    for r in rows:
        entry = {"id": r["id"], "name": r["name"], "icon": r["icon"], "endpoint": r["endpoint"]}
        if r["clear_endpoint"]:
            entry["clear_endpoint"] = r["clear_endpoint"]
        result.append(entry)
    return result

def is_check_enabled(conn, check_id):
    row = conn.execute("SELECT enabled FROM checks WHERE id = ?", (check_id,)).fetchone()
    return bool(row["enabled"]) if row else False

def get_check_state(conn, check_id):
    row = conn.execute("SELECT state_json FROM checks_state WHERE check_id = ?", (check_id,)).fetchone()
    if row:
        return json.loads(row["state_json"])
    return {"last_checked": None, "results": []}

def save_check_state(conn, check_id, state):
    conn.execute(
        "INSERT INTO checks_state (check_id, state_json) VALUES (?, ?) "
        "ON CONFLICT(check_id) DO UPDATE SET state_json = excluded.state_json",
        (check_id, json.dumps(state)),
    )
    conn.commit()

def reorder_checks(conn, layout):
    known_ids = {r["id"] for r in conn.execute("SELECT id FROM checks").fetchall()}

    seen = set()
    cleaned = []
    for col in layout:
        new_col = [cid for cid in col if cid in known_ids and cid not in seen]
        seen.update(new_col)
        cleaned.append(new_col)

    while len(cleaned) < 3:
        cleaned.append([])

    for cid in known_ids - seen:
        min(cleaned, key=len).append(cid)

    for col_idx, col in enumerate(cleaned):
        for pos, cid in enumerate(col):
            conn.execute("UPDATE checks SET column_index = ?, sort_order = ? WHERE id = ?", (col_idx, pos, cid))
    conn.commit()

def get_all_items(conn):
    rows = conn.execute("SELECT * FROM items").fetchall()
    return [_item_dict(r) for r in rows]

def get_checkable_items(conn):
    rows = conn.execute("SELECT * FROM items WHERE checks_excluded = 0").fetchall()
    return [_item_dict(r) for r in rows]

def get_items_for_select(conn):
    rows = conn.execute(
        "SELECT i.id, i.name, g.name AS group_name FROM items i "
        "JOIN groups g ON g.id = i.group_id ORDER BY g.sort_order, i.sort_order"
    ).fetchall()
    return [{"id": r["id"], "name": r["name"], "group_name": r["group_name"]} for r in rows]

# ---------- Predefined apps ----------
def get_predefined_apps(conn):
    rows = conn.execute("SELECT * FROM predefined_apps ORDER BY sort_order").fetchall()
    return [{"name": r["name"], "port": r["port"], "icon": f"/static/icons/{r['icon']}"} for r in rows]

# ---------- Tasks ----------
def _task_dict(row):
    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "status": row["status"],
        "created_date": row["created_date"],
        "due_date": row["due_date"],
        "complete_date": row["complete_date"],
        "item_id": row["item_id"],
        "item_name": row["item_name"] if "item_name" in row.keys() else None,
    }

def _attach_notes(conn, tasks):
    if not tasks:
        return tasks
    ids = [tk["id"] for tk in tasks]
    placeholders = ",".join("?" for _ in ids)
    note_rows = conn.execute(
        f"SELECT id, task_id, content, created_at FROM task_notes "
        f"WHERE task_id IN ({placeholders}) ORDER BY created_at DESC",
        ids,
    ).fetchall()
    notes_by_task = {}
    for r in note_rows:
        notes_by_task.setdefault(r["task_id"], []).append(
            {"id": r["id"], "content": r["content"], "created_at": r["created_at"]}
        )
    for tk in tasks:
        tk["notes"] = notes_by_task.get(tk["id"], [])
    return tasks

def get_tasks(conn, status=None, item_id=None, search=None):
    query = "SELECT t.*, i.name AS item_name FROM tasks t LEFT JOIN items i ON i.id = t.item_id WHERE 1=1"
    params = []
    if status:
        query += " AND t.status = ?"
        params.append(status)
    if item_id:
        query += " AND t.item_id = ?"
        params.append(item_id)
    if search:
        like = f"%{search}%"
        query += (" AND (t.title LIKE ? OR t.description LIKE ? OR EXISTS "
                   "(SELECT 1 FROM task_notes n2 WHERE n2.task_id = t.id AND n2.content LIKE ?))")
        params += [like, like, like]
    query += " ORDER BY (t.status = 'Completed') ASC, (t.due_date IS NULL) ASC, t.due_date ASC"
    rows = conn.execute(query, params).fetchall()
    tasks = [_task_dict(r) for r in rows]
    return _attach_notes(conn, tasks)

def get_tasks_for_widget(conn, config):
    sort = (config or {}).get("sort", "due_date")
    limit = max(1, min(int((config or {}).get("limit", 5)), 20))

    if sort == "in_progress":
        query = ("SELECT t.*, i.name AS item_name FROM tasks t LEFT JOIN items i ON i.id = t.item_id "
                  "WHERE t.status = 'In Progress' ORDER BY (t.due_date IS NULL) ASC, t.due_date ASC LIMIT ?")
    elif sort == "recent":
        query = ("SELECT t.*, i.name AS item_name FROM tasks t LEFT JOIN items i ON i.id = t.item_id "
                  "ORDER BY t.created_date DESC LIMIT ?")
    else:  # due_date (default)
        query = ("SELECT t.*, i.name AS item_name FROM tasks t LEFT JOIN items i ON i.id = t.item_id "
                  "WHERE t.status != 'Completed' ORDER BY (t.due_date IS NULL) ASC, t.due_date ASC LIMIT ?")

    rows = conn.execute(query, (limit,)).fetchall()
    return [_task_dict(r) for r in rows]

def get_task(conn, task_id):
    row = conn.execute(
        "SELECT t.*, i.name AS item_name FROM tasks t LEFT JOIN items i ON i.id = t.item_id WHERE t.id = ?",
        (task_id,),
    ).fetchone()
    if not row:
        return None
    task = _task_dict(row)
    task["notes"] = get_task_notes(conn, task_id)
    return task

def create_task(conn, fields):
    today = date.today()
    created_date = today.isoformat()
    due_date = (fields.get("due_date") or "").strip() or _add_one_month(today).isoformat()
    status = fields.get("status") if fields.get("status") in TASK_STATUSES else "New"
    complete_date = fields.get("complete_date") or None
    if status == "Completed" and not complete_date:
        complete_date = today.isoformat()

    item_id = fields.get("item_id") or None

    task_id = new_id()
    conn.execute(
        "INSERT INTO tasks (id, item_id, title, description, status, created_date, due_date, complete_date) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (task_id, item_id, (fields.get("title") or "New task").strip(), fields.get("description") or "",
         status, created_date, due_date, complete_date),
    )
    conn.commit()
    return get_task(conn, task_id)

def update_task(conn, task_id, fields):
    existing = get_task(conn, task_id)
    if not existing:
        return None

    if "title" in fields:
        conn.execute("UPDATE tasks SET title = ? WHERE id = ?", ((fields["title"] or "New task").strip(), task_id))
    if "description" in fields:
        conn.execute("UPDATE tasks SET description = ? WHERE id = ?", (fields["description"] or "", task_id))
    if "due_date" in fields:
        conn.execute("UPDATE tasks SET due_date = ? WHERE id = ?", (fields["due_date"] or None, task_id))
    if "item_id" in fields:
        conn.execute("UPDATE tasks SET item_id = ? WHERE id = ?", (fields["item_id"] or None, task_id))

    if "status" in fields:
        new_status = fields["status"] if fields["status"] in TASK_STATUSES else existing["status"]
        if new_status == "Completed":
            complete_date = fields.get("complete_date") or existing["complete_date"] or date.today().isoformat()
        else:
            complete_date = fields.get("complete_date") or None
        conn.execute("UPDATE tasks SET status = ?, complete_date = ? WHERE id = ?",
                     (new_status, complete_date, task_id))
    elif "complete_date" in fields:
        conn.execute("UPDATE tasks SET complete_date = ? WHERE id = ?", (fields["complete_date"] or None, task_id))

    conn.commit()
    return get_task(conn, task_id)

def delete_task(conn, task_id):
    row = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        return False
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.commit()
    return True

def get_open_task_counts(conn):
    rows = conn.execute(
        "SELECT item_id, COUNT(*) c FROM tasks WHERE item_id IS NOT NULL AND status != 'Completed' GROUP BY item_id"
    ).fetchall()
    return {r["item_id"]: r["c"] for r in rows}

# ---------- Task notes ----------
def get_task_notes(conn, task_id):
    rows = conn.execute(
        "SELECT id, content, created_at FROM task_notes WHERE task_id = ? ORDER BY created_at DESC",
        (task_id,),
    ).fetchall()
    return [{"id": r["id"], "content": r["content"], "created_at": r["created_at"]} for r in rows]

def add_task_note(conn, task_id, content):
    content = (content or "").strip()
    if not content:
        return None
    task_exists = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not task_exists:
        return None
    note_id = new_id()
    created_at = now_iso()
    conn.execute(
        "INSERT INTO task_notes (id, task_id, content, created_at) VALUES (?, ?, ?, ?)",
        (note_id, task_id, content, created_at),
    )
    conn.commit()
    return {"id": note_id, "content": content, "created_at": created_at}

def delete_task_note(conn, task_id, note_id):
    row = conn.execute("SELECT id FROM task_notes WHERE id = ? AND task_id = ?", (note_id, task_id)).fetchone()
    if not row:
        return False
    conn.execute("DELETE FROM task_notes WHERE id = ?", (note_id,))
    conn.commit()
    return True

# ---------- Widgets ----------
def widget_dict(row):
    return {
        "id": row["id"],
        "type": row["type"],
        "order": row["sort_order"],
        "config": json.loads(row["config_json"] or "{}"),
    }

def get_widgets(conn):
    rows = conn.execute("SELECT * FROM widgets ORDER BY sort_order").fetchall()
    return [widget_dict(r) for r in rows]

def create_widget(conn, type_, config):
    if type_ not in WIDGET_TYPES:
        return None
    widget_id = new_id()
    count = conn.execute("SELECT COUNT(*) FROM widgets").fetchone()[0]
    conn.execute(
        "INSERT INTO widgets (id, type, sort_order, config_json) VALUES (?, ?, ?, ?)",
        (widget_id, type_, count, json.dumps(config or {})),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM widgets WHERE id = ?", (widget_id,)).fetchone()
    return widget_dict(row)

def update_widget(conn, widget_id, config=None):
    row = conn.execute("SELECT * FROM widgets WHERE id = ?", (widget_id,)).fetchone()
    if not row:
        return None
    if config is not None:
        conn.execute("UPDATE widgets SET config_json = ? WHERE id = ?", (json.dumps(config), widget_id))
    conn.commit()
    row = conn.execute("SELECT * FROM widgets WHERE id = ?", (widget_id,)).fetchone()
    return widget_dict(row)

def delete_widget(conn, widget_id):
    row = conn.execute("SELECT id FROM widgets WHERE id = ?", (widget_id,)).fetchone()
    if not row:
        return False
    conn.execute("DELETE FROM widgets WHERE id = ?", (widget_id,))
    remaining = conn.execute("SELECT id FROM widgets ORDER BY sort_order").fetchall()
    for idx, r in enumerate(remaining):
        conn.execute("UPDATE widgets SET sort_order = ? WHERE id = ?", (idx, r["id"]))
    conn.commit()
    return True

def reorder_widgets(conn, order):
    known_ids = {r["id"] for r in conn.execute("SELECT id FROM widgets").fetchall()}
    ordered_ids = [wid for wid in order if wid in known_ids]
    for idx, wid in enumerate(ordered_ids):
        conn.execute("UPDATE widgets SET sort_order = ? WHERE id = ?", (idx, wid))
    conn.commit()

# ---------- Backup / restore ----------
def restore_db(path, file_storage):
    tmp_path = path + ".restore_tmp"
    file_storage.save(tmp_path)

    try:
        check_conn = sqlite3.connect(tmp_path)
        tables = {r[0] for r in check_conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        check_conn.close()
        if not REQUIRED_TABLES.issubset(tables):
            os.remove(tmp_path)
            return False, "This does not look like a valid MyInfra database file."
    except sqlite3.Error:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        return False, "This does not look like a valid MyInfra database file."

    with _lock:
        os.replace(tmp_path, path)
    return True, None
