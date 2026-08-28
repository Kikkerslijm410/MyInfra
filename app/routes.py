from flask import Blueprint, current_app, jsonify, request, render_template, url_for
from concurrent.futures import ThreadPoolExecutor
from .storage import *
from .checks import *

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
bp = Blueprint("main", __name__)

def _data():
    return load_data(current_app.config["DATA_FILE"])

def _save(data):
    save_data(current_app.config["DATA_FILE"], data)

def _all_items(data):
    for g in data["groups"]:
        for it in g["items"]:
            yield it

# ---------- Pages ----------
@bp.route("/")
def dashboard():
    return render_template("index.html")

# ---------- Full state ----------
@bp.route("/api/data")
def api_data():
    return jsonify(_data())

# ---------- Predefined apps ----------
@bp.route("/api/predefined-apps")
def api_predefined_apps():
    return jsonify(load_predefined_apps())

# ---------- Settings ----------
@bp.route("/api/settings", methods=["POST"])
def api_settings_update():
    data = _data()
    body = request.get_json(force=True) or {}

    settings = data["settings"]
    if "theme" in body:
        settings["theme"] = body["theme"]
    if "colors" in body:
        settings["colors"].update(body["colors"])
    if "search_engine" in body:
        settings["search_engine"] = body["search_engine"]
    if "checks_enabled" in body:
        settings["checks_enabled"].update(body["checks_enabled"])

    _save(data)
    return jsonify(settings)

# ---------- Groups ----------
@bp.route("/api/groups", methods=["POST"])
def api_group_create():
    data = _data()
    body = request.get_json(force=True) or {}
    name = (body.get("name") or "New group").strip()

    group = {
        "id": new_id(),
        "name": name,
        "order": len(data["groups"]),
        "columns": 4,
        "items": []
    }
    data["groups"].append(group)
    _save(data)
    return jsonify(group), 201

@bp.route("/api/groups/<group_id>", methods=["PUT"])
def api_group_update(group_id):
    data = _data()
    group = find_group(data, group_id)
    if not group:
        return jsonify({"error": "not found"}), 404

    body = request.get_json(force=True) or {}
    if "name" in body:
        group["name"] = body["name"].strip() or group["name"]
    if "columns" in body:
        try:
            cols = int(body["columns"])
            group["columns"] = max(1, min(cols, 12))
        except (TypeError, ValueError):
            pass

    _save(data)
    return jsonify(group)

@bp.route("/api/groups/reorder", methods=["POST"])
def api_groups_reorder():
    data = _data()
    body = request.get_json(force=True) or {}
    order = body.get("order", [])

    lookup = {g["id"]: g for g in data["groups"]}
    new_groups = []
    for idx, gid in enumerate(order):
        if gid in lookup:
            lookup[gid]["order"] = idx
            new_groups.append(lookup[gid])

    for g in data["groups"]:
        if g not in new_groups:
            new_groups.append(g)

    data["groups"] = new_groups
    _save(data)
    return jsonify({"ok": True})

# ---------- Items ----------
@bp.route("/api/items", methods=["POST"])
def api_item_create():
    data = _data()
    body = request.get_json(force=True) or {}

    group_name = (body.get("group_name") or "").strip()
    if not group_name:
        return jsonify({"error": "group_name is required"}), 400

    group = find_group_by_name(data, group_name)
    if not group:
        group = {
            "id": new_id(),
            "name": group_name,
            "order": len(data["groups"]),
            "columns": 4,
            "items": []
        }
        data["groups"].append(group)

    item = {
        "id": new_id(),
        "name": (body.get("name") or "New app").strip(),
        "icon": body.get("icon") or "",
        "local_ip": body.get("local_ip") or "",
        "port": body.get("port") or "",
        "domain": body.get("domain") or "",
    }
    group["items"].append(item)
    _save(data)
    return jsonify({"item": item, "group_id": group["id"]}), 201

@bp.route("/api/items/<item_id>", methods=["PUT"])
def api_item_update(item_id):
    data = _data()
    current_group, item = find_item(data, item_id)
    if not item:
        return jsonify({"error": "not found"}), 404

    body = request.get_json(force=True) or {}
    for field in ("name", "icon", "local_ip", "port", "domain"):
        if field in body:
            item[field] = body[field]

    if "group_name" in body:
        group_name = (body["group_name"] or "").strip()
        if group_name and group_name.lower() != current_group["name"].strip().lower():
            target_group = find_group_by_name(data, group_name)
            if not target_group:
                target_group = {
                    "id": new_id(),
                    "name": group_name,
                    "order": len(data["groups"]),
                    "columns": 4,
                    "items": []
                }
                data["groups"].append(target_group)
            current_group["items"] = [it for it in current_group["items"] if it["id"] != item_id]
            target_group["items"].append(item)

    _save(data)
    return jsonify(item)

@bp.route("/api/items/<item_id>", methods=["DELETE"])
def api_item_delete(item_id):
    data = _data()
    group, item = find_item(data, item_id)
    if not item:
        return jsonify({"error": "not found"}), 404

    group["items"] = [it for it in group["items"] if it["id"] != item_id]

    remove_empty_groups(data)
    _save(data)
    return jsonify({"ok": True})

@bp.route("/api/items/move", methods=["POST"])
def api_item_move():
    data = _data()
    body = request.get_json(force=True) or {}
    item_id = body.get("item_id")
    target_group_id = body.get("target_group_id")
    target_index = body.get("target_index", 0)

    source_group, item = find_item(data, item_id)
    target_group = find_group(data, target_group_id)
    if not item or not target_group:
        return jsonify({"error": "not found"}), 404

    source_group["items"] = [it for it in source_group["items"] if it["id"] != item_id]
    target_index = max(0, min(target_index, len(target_group["items"])))
    target_group["items"].insert(target_index, item)

    # Check if groups are empty and remove them
    remove_empty_groups(data, target_group_id)
    _save(data)
    return jsonify({"ok": True})

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
    return jsonify(CHECKS)

@bp.route("/api/checks/reorder", methods=["POST"])
def api_checks_reorder():
    data = _data()
    body = request.get_json(force=True) or {}
    layout = body.get("layout", [])
    known_ids = {c["id"] for c in CHECKS}

    seen = set()
    cleaned = []
    for col in layout:
        new_col = [cid for cid in col if cid in known_ids and cid not in seen]
        seen.update(new_col)
        cleaned.append(new_col)

    if not cleaned:
        cleaned = [[]]
    for cid in known_ids - seen:
        min(cleaned, key=len).append(cid)

    data["settings"]["checks_layout"] = cleaned
    _save(data)
    return jsonify({"ok": True})

@bp.route("/api/checks/outbound-ip", methods=["GET"])
def api_check_outbound_ip():
    data = _data()
    if not data["settings"]["checks_enabled"].get("outbound_ip", True):
        return jsonify({"error": "check disabled"}), 400

    state = data["checks_state"]["outbound_ip"]
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
    _save(data)
    return jsonify(state)

@bp.route("/api/checks/outbound-ip/clear", methods=["POST"])
def api_check_outbound_ip_clear():
    data = _data()
    state = data["checks_state"]["outbound_ip"]
    state["changed"] = False
    state["previous_ip"] = None
    _save(data)
    return jsonify(state)

@bp.route("/api/checks/ssl-expiry", methods=["GET"])
def api_check_ssl_expiry():
    data = _data()
    if not data["settings"]["checks_enabled"].get("ssl_expiry", True):
        return jsonify({"error": "check disabled"}), 400

    results = []
    for item in _all_items(data):
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

    state = data["checks_state"]["ssl_expiry"]
    state["results"] = results
    state["last_checked"] = now_iso()
    _save(data)
    return jsonify(state)

@bp.route("/api/checks/uptime", methods=["GET"])
def api_check_uptime():
    data = _data()
    if not data["settings"]["checks_enabled"].get("uptime", True):
        return jsonify({"error": "check disabled"}), 400

    jobs = []  # (item_id, name, kind, url)
    for item in _all_items(data):
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

    state = data["checks_state"]["uptime"]
    state["results"] = list(results_map.values())
    state["last_checked"] = now_iso()
    _save(data)
    return jsonify(state)
