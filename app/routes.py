import os
from flask import Blueprint, current_app, jsonify, request, render_template, url_for, send_file
from concurrent.futures import ThreadPoolExecutor
from .storage import *
from .checks import *

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
bp = Blueprint("main", __name__)

# ---------- Pages ----------
@bp.route("/")
def dashboard():
    return render_template("index.html")

# ---------- Full state ----------
@bp.route("/api/data")
def api_data():
    conn = get_db()
    return jsonify({
        "settings": get_settings_dict(conn),
        "groups": get_groups_with_items(conn),
        "checks_state": {
            r["check_id"]: get_check_state(conn, r["check_id"])
            for r in conn.execute("SELECT check_id FROM checks_state").fetchall()
        },
    })

# ---------- Predefined apps ----------
@bp.route("/api/predefined-apps")
def api_predefined_apps():
    return jsonify(get_predefined_apps(get_db()))

# ---------- Settings ----------
@bp.route("/api/settings", methods=["POST"])
def api_settings_update():
    conn = get_db()
    body = request.get_json(force=True) or {}
    return jsonify(update_settings(conn, body))

@bp.route("/api/checks/enabled", methods=["POST"])
def api_checks_enabled_update():
    conn = get_db()
    body = request.get_json(force=True) or {}
    update_checks_enabled(conn, body.get("checks_enabled", {}))
    return jsonify(get_settings_dict(conn))

# ---------- Groups ----------
@bp.route("/api/groups", methods=["POST"])
def api_group_create():
    conn = get_db()
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "New group").strip()
    return jsonify(create_group(conn, name)), 201

@bp.route("/api/groups/<group_id>", methods=["PUT"])
def api_group_update(group_id):
    conn = get_db()
    body = request.get_json(force=True) or {}
    group = update_group(conn, group_id, name=body.get("name"), columns=body.get("columns"))
    if not group:
        return jsonify({"error": "not found"}), 404
    return jsonify(group)

@bp.route("/api/groups/reorder", methods=["POST"])
def api_groups_reorder():
    conn = get_db()
    body = request.get_json(force=True) or {}
    reorder_groups(conn, body.get("order", []))
    return jsonify({"ok": True})

# ---------- Items ----------
@bp.route("/api/items", methods=["POST"])
def api_item_create():
    conn = get_db()
    body = request.get_json(force=True) or {}

    group_name = (body.get("group_name") or "").strip()
    if not group_name:
        return jsonify({"error": "group_name is required"}), 400

    item, group_id = create_item(conn, group_name, body)
    return jsonify({"item": item, "group_id": group_id}), 201

@bp.route("/api/items/<item_id>", methods=["PUT"])
def api_item_update(item_id):
    conn = get_db()
    body = request.get_json(force=True) or {}
    item = update_item(conn, item_id, body, group_name=body.get("group_name"))
    if not item:
        return jsonify({"error": "not found"}), 404
    return jsonify(item)

@bp.route("/api/items/<item_id>", methods=["DELETE"])
def api_item_delete(item_id):
    conn = get_db()
    if not delete_item(conn, item_id):
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})

@bp.route("/api/items/move", methods=["POST"])
def api_item_move():
    conn = get_db()
    body = request.get_json(force=True) or {}
    ok = move_item(conn, body.get("item_id"), body.get("target_group_id"), body.get("target_index", 0))
    if not ok:
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})

@bp.route("/api/items/select-options")
def api_items_select_options():
    return jsonify(get_items_for_select(get_db()))

# ---------- Uploads ----------
@bp.route("/api/upload", methods=["POST"])
def api_upload():
    file = request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"error": "No file provided"}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": "Unsupported file type"}), 400

    filename = f"{new_id()}{ext}"
    upload_dir = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(upload_dir, exist_ok=True)
    file.save(os.path.join(upload_dir, filename))

    url = url_for("static", filename=f"uploads/{filename}")
    return jsonify({"url": url})

# ---------- Checks ----------
@bp.route("/api/checks/meta")
def api_checks_meta():
    return jsonify(get_checks_meta(get_db()))

@bp.route("/api/checks/reorder", methods=["POST"])
def api_checks_reorder():
    conn = get_db()
    body = request.get_json(force=True) or {}
    reorder_checks(conn, body.get("layout", []))
    return jsonify({"ok": True})

@bp.route("/api/checks/outbound-ip", methods=["GET"])
def api_check_outbound_ip():
    conn = get_db()
    if not is_check_enabled(conn, "outbound_ip"):
        return jsonify({"error": "check disabled"}), 400

    state = get_check_state(conn, "outbound_ip")
    try:
        ip = check_outbound_ip()
    except Exception as e:
        return jsonify({"error": str(e)}), 502

    if state["current_ip"] is None:
        state["current_ip"] = ip
    elif ip != state["current_ip"]:
        state["previous_ip"] = state["current_ip"]
        state["current_ip"] = ip
        state["changed"] = True

    state["last_checked"] = now_iso()
    save_check_state(conn, "outbound_ip", state)
    return jsonify(state)

@bp.route("/api/checks/outbound-ip/clear", methods=["POST"])
def api_check_outbound_ip_clear():
    conn = get_db()
    state = get_check_state(conn, "outbound_ip")
    state["changed"] = False
    state["previous_ip"] = None
    save_check_state(conn, "outbound_ip", state)
    return jsonify(state)

@bp.route("/api/checks/ssl-expiry", methods=["GET"])
def api_check_ssl_expiry():
    conn = get_db()
    if not is_check_enabled(conn, "ssl_expiry"):
        return jsonify({"error": "check disabled"}), 400

    results = []
    for item in get_checkable_items(conn):
        if not item.get("domain"):
            continue
        entry = {"item_id": item["id"], "name": item["name"], "domain": item["domain"]}
        try:
            info = check_ssl_expiry(item["domain"])
            entry.update(info)
            entry["error"] = None
        except Exception as e:
            entry["error"] = str(e)
        results.append(entry)

    state = {"last_checked": now_iso(), "results": results}
    save_check_state(conn, "ssl_expiry", state)
    return jsonify(state)

@bp.route("/api/checks/uptime", methods=["GET"])
def api_check_uptime():
    conn = get_db()
    if not is_check_enabled(conn, "uptime"):
        return jsonify({"error": "check disabled"}), 400

    jobs = []
    for item in get_checkable_items(conn):
        if item.get("local_ip"):
            port = f":{item['port']}" if item.get("port") else ""
            jobs.append((item["id"], item["name"], "local", f"http://{item['local_ip']}{port}"))
        if item.get("domain"):
            jobs.append((item["id"], item["name"], "domain", f"https://{item['domain']}"))

    results_map = {}
    if jobs:
        with ThreadPoolExecutor(max_workers=min(10, len(jobs))) as executor:
            check_results = executor.map(lambda j: check_reachable(j[3]), jobs)
            for (item_id, name, kind, _url), result in zip(jobs, check_results):
                entry = results_map.setdefault(item_id, {"item_id": item_id, "name": name})
                entry[kind] = result

    state = {"last_checked": now_iso(), "results": list(results_map.values())}
    save_check_state(conn, "uptime", state)
    return jsonify(state)

# ---------- Tasks ----------
@bp.route("/api/tasks/meta")
def api_tasks_meta():
    return jsonify({"statuses": TASK_STATUSES})

@bp.route("/api/tasks")
def api_tasks_list():
    conn = get_db()
    status = request.args.get("status") or None
    item_id = request.args.get("item_id") or None
    search = request.args.get("q") or None
    return jsonify(get_tasks(conn, status=status, item_id=item_id, search=search))

@bp.route("/api/tasks", methods=["POST"])
def api_task_create():
    conn = get_db()
    body = request.get_json(force=True) or {}
    if not (body.get("title") or "").strip():
        return jsonify({"error": "title is required"}), 400
    task = create_task(conn, body)
    return jsonify(task), 201

@bp.route("/api/tasks/<task_id>")
def api_task_get(task_id):
    task = get_task(get_db(), task_id)
    if not task:
        return jsonify({"error": "not found"}), 404
    return jsonify(task)

@bp.route("/api/tasks/<task_id>", methods=["PUT"])
def api_task_update(task_id):
    conn = get_db()
    body = request.get_json(force=True) or {}
    task = update_task(conn, task_id, body)
    if not task:
        return jsonify({"error": "not found"}), 404
    return jsonify(task)

@bp.route("/api/tasks/<task_id>", methods=["DELETE"])
def api_task_delete(task_id):
    if not delete_task(get_db(), task_id):
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})

# ---------- Task notes ----------
@bp.route("/api/tasks/<task_id>/notes", methods=["POST"])
def api_task_note_create(task_id):
    conn = get_db()
    body = request.get_json(force=True) or {}
    note = add_task_note(conn, task_id, body.get("content"))
    if not note:
        return jsonify({"error": "invalid note or task"}), 400
    return jsonify(note), 201

@bp.route("/api/tasks/<task_id>/notes/<note_id>", methods=["DELETE"])
def api_task_note_delete(task_id, note_id):
    if not delete_task_note(get_db(), task_id, note_id):
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})

# ---------- Widgets ----------
@bp.route("/api/widgets")
def api_widgets_list():
    conn = get_db()
    widgets = get_widgets(conn)
    for w in widgets:
        if w["type"] == "weather":
            cfg = w["config"]
            if cfg.get("latitude") is not None and cfg.get("longitude") is not None:
                try:
                    w["data"] = check_weather(cfg["latitude"], cfg["longitude"], cfg.get("days", 5))
                except Exception as e:
                    w["error"] = str(e)
            else:
                w["error"] = "No location configured."
        elif w["type"] == "tasks":
            w["data"] = {"tasks": get_tasks_for_widget(conn, w["config"])}
    return jsonify(widgets)

@bp.route("/api/widgets", methods=["POST"])
def api_widget_create():
    conn = get_db()
    body = request.get_json(force=True) or {}
    widget = create_widget(conn, body.get("type"), body.get("config", {}))
    if not widget:
        return jsonify({"error": "invalid widget type"}), 400
    return jsonify(widget), 201

@bp.route("/api/widgets/<widget_id>", methods=["PUT"])
def api_widget_update(widget_id):
    conn = get_db()
    body = request.get_json(force=True) or {}
    widget = update_widget(conn, widget_id, config=body.get("config"))
    if not widget:
        return jsonify({"error": "not found"}), 404
    return jsonify(widget)

@bp.route("/api/widgets/<widget_id>", methods=["DELETE"])
def api_widget_delete(widget_id):
    if not delete_widget(get_db(), widget_id):
        return jsonify({"error": "not found"}), 404
    return jsonify({"ok": True})

@bp.route("/api/widgets/reorder", methods=["POST"])
def api_widgets_reorder():
    conn = get_db()
    body = request.get_json(force=True) or {}
    reorder_widgets(conn, body.get("order", []))
    return jsonify({"ok": True})

@bp.route("/api/geocode")
def api_geocode():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify([])
    try:
        return jsonify(geocode_location(query))
    except Exception as e:
        return jsonify({"error": str(e)}), 502

# ---------- Backup / restore ----------
@bp.route("/api/backup", methods=["GET"])
def api_backup():
    return send_file(
        current_app.config["DB_FILE"],
        as_attachment=True,
        download_name="myinfra-backup.db",
        mimetype="application/x-sqlite3",
    )

@bp.route("/api/restore", methods=["POST"])
def api_restore():
    file = request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"error": "No file provided"}), 400

    close_db()
    ok, error = restore_db(current_app.config["DB_FILE"], file)
    if not ok:
        return jsonify({"error": error}), 400
    return jsonify({"ok": True})
