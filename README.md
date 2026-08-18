# **MyInfra**

![Docker Pulls](https://img.shields.io/docker/pulls/lucas410/myinfra)
![Last Commit](https://img.shields.io/github/last-commit/kikkerslijm410/myinfra)
![GitHub Stars](https://img.shields.io/github/stars/kikkerslijm410/myinfra)

Self hosted dashboard for managing and checking your server

## ⚙️ Features
- Easily add and group websites
- Add both local and globally accessible links for each website
- Easily create and manage groups for organizing apps and websites
- Use checks for automatic detection (example: check if the outbound IP has been changed)

---

## 📡 API Endpoints

### Settings
- `POST /api/settings` → Update settings

### Groups
- `POST /api/groups` → Create a group
- `PUT /api/groups/<group_id>` → Update an existing group
- `POST /api/groups/reorder` → Reorder the groups

### Items
- `POST /api/items` → Create an item (website)
- `PUT /api/items/<item_id>` → Update an existing item
- `DELETE /api/items/<item_id>` → Delete an item (website)
- `POST /api/items/move` → Move an item (website)

### Upload
- `POST /api/upload` → Upload a file for the website icon

### Checks
- `GET /api/checks/outbound-ip` → Retrieve current outgoing IP
- `POST /api/checks/outbound-ip/clear` → Clear status for the outgoing IP check
