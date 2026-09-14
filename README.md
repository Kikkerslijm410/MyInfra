# **MyInfra**

![Docker Pulls](https://img.shields.io/docker/pulls/lucas410/myinfra)
![Last Commit](https://img.shields.io/github/last-commit/kikkerslijm410/myinfra)
![GitHub Stars](https://img.shields.io/github/stars/kikkerslijm410/myinfra)

Self hosted dashboard for managing and checking your server

## ⚙️ Features
- Easily add and group websites
- Add both local and globally accessible links for each website
- Easily create and manage groups for organizing apps and websites
- Use checks for automatic detection (outbound IP changes, SSL certificate expiry, app/website uptime)
- Exclude individual websites from checks with a single toggle
- Task management with statuses, due dates, linked websites, and stacked notes per task
- Configurable dashboard widgets: weather forecast (via Open-Meteo, no API key required) and upcoming tasks
- Drag-and-drop reordering of website groups, checks, and widgets (desktop only)
- Multi-language interface (English and Dutch, more languages can be added)
- One-file SQLite database — easy to back up and restore from Settings
- Mobile-friendly layout

---

## 🖥️ Run using Proxmox

### 1. Build and run
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Kikkerslijm410/MyInfra/refs/heads/main/installers/proxmox-install.sh)"
```

### 2. Update
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Kikkerslijm410/MyInfra/refs/heads/main/installers/proxmox-update.sh)"
```

---

## 🐳 Run using Docker Compose

```yaml
services:
  app:
    build: .
    container_name: app
    ports:
      - "5000:5000"
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

All data (websites, groups, checks, tasks, widgets, settings) lives in a single SQLite file at `data/myinfra.db`, which is mounted as a volume so it survives container rebuilds.

---

## 💾 Backup & Restore

Because all data lives in one SQLite file, backing up MyInfra is as simple as downloading that file, and restoring is as simple as uploading it again.

- **Backup**: Settings → Backup & Restore → Download backup
- **Restore**: Settings → Backup & Restore → Restore backup (this overwrites all current data)

---

## 📡 API Endpoints

### Settings
- `GET /api/data` → Full dashboard state (settings, groups/items, checks state)
- `POST /api/settings` → Update settings (colors, language)
- `POST /api/checks/enabled` → Enable/disable individual checks

### Groups
- `POST /api/groups` → Create a group
- `PUT /api/groups/<group_id>` → Update an existing group
- `POST /api/groups/reorder` → Reorder the groups

### Items (websites)
- `GET /api/items/select-options` → Lightweight list for linking tasks
- `POST /api/items` → Create an item (website)
- `PUT /api/items/<item_id>` → Update an existing item (including checks exclusion)
- `DELETE /api/items/<item_id>` → Delete an item (website)
- `POST /api/items/move` → Move an item (website)

### Upload
- `POST /api/upload` → Upload a file for the website icon

### Checks
- `GET /api/checks/meta` → Metadata for all available checks
- `POST /api/checks/reorder` → Reorder/re-column checks
- `GET /api/checks/outbound-ip` → Retrieve current outgoing IP
- `POST /api/checks/outbound-ip/clear` → Clear status for the outgoing IP check
- `GET /api/checks/ssl-expiry` → Check SSL certificate expiry for all configured domains
- `GET /api/checks/uptime` → Check local/domain reachability for all websites

### Tasks
- `GET /api/tasks/meta` → Available task statuses
- `GET /api/tasks` → List tasks (filter by `status`, `item_id`, or search with `q`)
- `POST /api/tasks` → Create a task
- `GET /api/tasks/<task_id>` → Get a single task (including notes)
- `PUT /api/tasks/<task_id>` → Update a task
- `DELETE /api/tasks/<task_id>` → Delete a task (and its notes)

### Task notes
- `POST /api/tasks/<task_id>/notes` → Add a note to a task
- `DELETE /api/tasks/<task_id>/notes/<note_id>` → Delete a note

### Widgets
- `GET /api/widgets` → List widgets with live data (weather forecast / upcoming tasks)
- `POST /api/widgets` → Create a widget
- `PUT /api/widgets/<widget_id>` → Update a widget (enable/disable, config)
- `DELETE /api/widgets/<widget_id>` → Delete a widget
- `POST /api/widgets/reorder` → Reorder widgets
- `GET /api/geocode` → Look up a location for the weather widget (via Open-Meteo)

### Backup / Restore
- `GET /api/backup` → Download the SQLite database file
- `POST /api/restore` → Restore the database from an uploaded file
