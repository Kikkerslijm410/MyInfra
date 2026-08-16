import json, os, uuid, base64, requests
from pathlib import Path
from flask import Flask, render_template, request, redirect, url_for, jsonify

app = Flask(__name__)
BASE_DIR = Path("./files").resolve()
BASE_DIR.mkdir(parents=True, exist_ok=True)
DATA_FILE = os.path.join(BASE_DIR, "apps.json")
GROUP_ORDER_FILE = os.path.join(BASE_DIR, "group_order.json")

def load_apps():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_apps(apps):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(apps, f, indent=2, ensure_ascii=False)

def load_group_order():
    if not os.path.exists(GROUP_ORDER_FILE):
        return []
    with open(GROUP_ORDER_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def save_group_order(order):
    with open(GROUP_ORDER_FILE, "w", encoding="utf-8") as f:
        json.dump(order, f, indent=2, ensure_ascii=False)

def download_icon_base64(domain: str) -> str:
    if not domain:
        return ""
    try:
        url = f"https://www.google.com/s2/favicons?sz=64&domain={domain}"
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        b64 = base64.b64encode(resp.content).decode("utf-8")
        content_type = resp.headers.get("Content-Type", "image/png")
        return f"data:{content_type};base64,{b64}"
    except Exception:
        return ""

def next_order(apps, group):
    existing = [a.get("order", 0) for a in apps if a.get("group") == group]
    return (max(existing) + 1) if existing else 0

@app.route("/")
def index():
    apps = load_apps()
    group_order = load_group_order()

    groups = {}
    for a in apps:
        groups.setdefault(a.get("group", "Other"), []).append(a)
    for g in groups:
        groups[g].sort(key=lambda a: a.get("order", 0))

    ordered_groups = {}
    for g in group_order:
        if g in groups:
            ordered_groups[g] = groups.pop(g)
    for g in sorted(groups.keys()):
        ordered_groups[g] = groups[g]

    if list(ordered_groups.keys()) != group_order:
        save_group_order(list(ordered_groups.keys()))

    return render_template("index.html", groups=ordered_groups)

@app.route("/add", methods=["GET", "POST"])
def add():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        group = request.form.get("group", "").strip() or "Other"
        local_ip = request.form.get("local_ip", "").strip()
        domain = request.form.get("domain", "").strip()

        if name and (local_ip or domain):
            apps = load_apps()
            apps.append({
                "id": str(uuid.uuid4()),
                "name": name,
                "group": group,
                "local_ip": local_ip,
                "domain": domain,
                "icon": download_icon_base64(domain or local_ip),
                "order": next_order(apps, group),
            })
            save_apps(apps)

            group_order = load_group_order()
            if group not in group_order:
                group_order.append(group)
                save_group_order(group_order)

            return redirect(url_for("index"))

    apps = load_apps()
    existing_groups = sorted({a.get("group", "Other") for a in apps})
    return render_template("add.html", existing_groups=existing_groups, app_data=None)

@app.route("/edit/<app_id>", methods=["GET", "POST"])
def edit(app_id):
    apps = load_apps()
    target = next((a for a in apps if a["id"] == app_id), None)
    if not target:
        return redirect(url_for("index"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        group = request.form.get("group", "").strip() or "Other"
        local_ip = request.form.get("local_ip", "").strip()
        domain = request.form.get("domain", "").strip()

        domain_changed = domain != target.get("domain", "")
        target["name"] = name
        target["local_ip"] = local_ip
        target["domain"] = domain
        if domain_changed:
            target["icon"] = download_icon_base64(domain or local_ip)

        if group != target.get("group"):
            target["group"] = group
            target["order"] = next_order(apps, group)
            group_order = load_group_order()
            if group not in group_order:
                group_order.append(group)
                save_group_order(group_order)

        save_apps(apps)
        return redirect(url_for("index"))

    existing_groups = sorted({a.get("group", "Other") for a in apps})
    return render_template("add.html", existing_groups=existing_groups, app_data=target)

@app.route("/delete/<app_id>", methods=["POST"])
def delete(app_id):
    apps = load_apps()
    apps = [a for a in apps if a["id"] != app_id]
    save_apps(apps)
    return redirect(url_for("index"))

@app.route("/reorder", methods=["POST"])
def reorder():
    data = request.get_json(force=True)
    group_order = data.get("groups", [])
    apps_order = data.get("apps", {})

    apps = load_apps()
    apps_by_id = {a["id"]: a for a in apps}

    for group, ids in apps_order.items():
        for idx, app_id in enumerate(ids):
            if app_id in apps_by_id:
                apps_by_id[app_id]["order"] = idx
                apps_by_id[app_id]["group"] = group

    save_apps(list(apps_by_id.values()))
    save_group_order(group_order)
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=debug)
