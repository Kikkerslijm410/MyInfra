import json
import os
import uuid
import threading
from datetime import datetime, timezone

_lock = threading.Lock()

CHECKS = [
    {
        "id": "outbound_ip",
        "name": "Outbound IP monitor",
        "icon": "fa-globe",
        "endpoint": "/api/checks/outbound-ip",
        "clear_endpoint": "/api/checks/outbound-ip/clear"
    },
    {
        "id": "ssl_expiry",
        "name": "SSL certificate expiry",
        "icon": "fa-lock",
        "endpoint": "/api/checks/ssl-expiry"
    },
    {
        "id": "uptime",
        "name": "App availability",
        "icon": "fa-heart-pulse",
        "endpoint": "/api/checks/uptime"
    }
]

def _default_check_state(check_id):
    if check_id == "outbound_ip":
        return {"current_ip": None, "previous_ip": None, "changed": False, "last_checked": None}
    return {"last_checked": None, "results": []}

def _default_checks_layout():
    columns = [[] for _ in range(3)]
    for idx, c in enumerate(CHECKS):
        columns[idx % 3].append(c["id"])
    return columns

DEFAULT_DATA = {
    "settings": {
        "theme": "dark",
        "colors": {
            "primary": "#3b82f6",
            "background": "#0f172a",
            "surface": "#1e293b",
            "text": "#e2e8f0"
        },
        "search_engine": "google",
        "checks_enabled": {c["id"]: True for c in CHECKS},
        "checks_layout": _default_checks_layout()
    },
    "groups": [],
    "checks_state": {c["id"]: _default_check_state(c["id"]) for c in CHECKS}
}

PREDEFINED_APPS = [
    { "name": "AdGuard Home", "icon": "adguard-home.png", "port": "3000" },
    { "name": "Bazarr", "icon": "bazarr.png", "port": "6767" },
    { "name": "FlareSolverr", "icon": "flaresolverr.png", "port": "8191" },
    { "name": "Gitea", "icon": "gitea.png", "port": "3000" },
    { "name": "Home Assistant", "icon": "home-assistant.png", "port": "8123" },
    { "name": "Immich", "icon": "immich.png", "port": "2283" },
    { "name": "Jellyfin", "icon": "jellyfin.png", "port": "8096" },
    { "name": "Lidarr", "icon": "lidarr.png", "port": "8686" },
    { "name": "MeTify", "icon": "metify.png", "port": "5000" },
    { "name": "MeTube", "icon": "metube.png", "port": "8081" },
    { "name": "Nextcloud", "icon": "nextcloud.png", "port": "443" },
    { "name": "Nginx Proxy Manager", "icon": "nginx-proxy-manager.png", "port": "81" },
    { "name": "Pi-hole", "icon": "pi-hole.png", "port": "80" },
    { "name": "Plex", "icon": "plex.png", "port": "32400" },
    { "name": "Portainer", "icon": "portainer.png", "port": "9000" },
    { "name": "Prowlarr", "icon": "prowlarr.png", "port": "9696" },
    { "name": "Proxmox", "icon": "proxmox.png", "port": "8006" },
    { "name": "qBittorrent", "icon": "qbittorrent.png", "port": "8080" },
    { "name": "Radarr", "icon": "radarr.png", "port": "7878" },
    { "name": "Seerr", "icon": "seerr.png", "port": "5055" },
    { "name": "Sonarr", "icon": "sonarr.png", "port": "8989" },
    { "name": "Tdarr", "icon": "tdarr.png", "port": "8265" },
    { "name": "Uptime Kuma", "icon": "uptime-kuma.png", "port": "3001" },
    { "name": "Wiki.js", "icon": "wikijs.png", "port": "3000" }
]

def _ensure_file(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not os.path.exists(path):
        with open(path, "w") as f:
            json.dump(DEFAULT_DATA, f, indent=2)

def load_data(path):
    with _lock:
        _ensure_file(path)
        with open(path, "r") as f:
            data = json.load(f)

        for key, value in DEFAULT_DATA.items():
            data.setdefault(key, value)

        for check in CHECKS:
            data["settings"]["checks_enabled"].setdefault(check["id"], True)
            data["checks_state"].setdefault(check["id"], _default_check_state(check["id"]))

        known_ids = {c["id"] for c in CHECKS}
        layout = data["settings"].get("checks_layout")
        if not layout or not isinstance(layout, list):
            layout = _default_checks_layout()

        seen = set()
        cleaned = []
        for col in layout:
            new_col = [cid for cid in col if cid in known_ids and cid not in seen]
            seen.update(new_col)
            cleaned.append(new_col)

        while len(cleaned) < 3:
            cleaned.append([])

        for cid in known_ids - seen:
            shortest = min(cleaned, key=len)
            shortest.append(cid)

        data["settings"]["checks_layout"] = cleaned

        return data

def save_data(path, data):
    with _lock:
        tmp_path = path + ".tmp"
        with open(tmp_path, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, path)

def new_id():
    return uuid.uuid4().hex[:12]

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def find_group(data, group_id):
    for g in data["groups"]:
        if g["id"] == group_id:
            return g
    return None

def find_group_by_name(data, name):
    name_norm = name.strip().lower()
    for g in data["groups"]:
        if g["name"].strip().lower() == name_norm:
            return g
    return None

def find_item(data, item_id):
    for g in data["groups"]:
        for it in g["items"]:
            if it["id"] == item_id:
                return g, it
    return None, None

def load_predefined_apps():
    result = []
    for app in PREDEFINED_APPS:
        result.append({
            "name": app["name"],
            "port": app.get("port", ""),
            "icon": f"/static/icons/{app['icon']}"
        })
    return result

def remove_empty_groups(data, keep_group_id=None):
    data["groups"] = [
        g for g in data["groups"]
        if g["items"] or g["id"] == keep_group_id
    ]
    for idx, g in enumerate(data["groups"]):
        g["order"] = idx
