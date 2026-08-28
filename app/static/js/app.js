let STATE = null;
let PREDEFINED = [];
let CHECKS_META = [];
const runningChecks = new Set();
let checksSortables = [];

/* ---------------- INIT ---------------- */
(async () => {
    await fetchChecksMeta();
    await fetchPredefined();
    await fetchData();
})();

setInterval(() => {
    if (STATE) runEnabledChecks();
}, 5 * 60 * 1000);

/* ---------------- DATA FETCHING ---------------- */
async function fetchData() {
    const res = await fetch("/api/data");
    STATE = await res.json();
    applyTheme();
    renderGroups();
    renderSettingsForm();
    renderChecks();
    updateSearchEngineIcon();
    updateGroupDatalist();
}

async function fetchPredefined() {
    const res = await fetch("/api/predefined-apps");
    PREDEFINED = await res.json();
    const select = document.getElementById("predefined-select");
    select.innerHTML = '<option value="">-- Custom --</option>';
    PREDEFINED.forEach((app, idx) => {
        const opt = document.createElement("option");
        opt.value = idx;
        opt.textContent = app.name;
        select.appendChild(opt);
    });
}

async function fetchChecksMeta() {
    const res = await fetch("/api/checks/meta");
    CHECKS_META = await res.json();
}

/* ---------------- HELPERS ---------------- */
function applyTheme() {
    const c = STATE.settings.colors;
    const root = document.documentElement.style;
    root.setProperty("--color-primary", c.primary);
    root.setProperty("--color-background", c.background);
    root.setProperty("--color-surface", c.surface);
    root.setProperty("--color-text", c.text);
}

function updateGroupDatalist() {
    const list = document.getElementById("group-options");
    list.innerHTML = "";
    STATE.groups.forEach(g => {
        const opt = document.createElement("option");
        opt.value = g.name;
        list.appendChild(opt);
    });
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

/* ---------------- GROUPS / ITEMS RENDER ---------------- */
function renderGroups() {
    const container = document.getElementById("groups-container");
    container.innerHTML = "";

    const groups = [...STATE.groups].sort((a, b) => a.order - b.order);

    groups.forEach(group => {
        const card = document.createElement("div");
        card.className = "group-card";
        card.dataset.groupId = group.id;

        const header = document.createElement("div");
        header.className = "group-header";
        header.innerHTML = `
            <i id="group-drag-handle" class="fa-solid fa-grip-vertical drag-handle"></i>
            <input class="group-name-input" value="${escapeHtml(group.name)}">
            <select class="columns-select">
                ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${n === group.columns ? "selected" : ""}>${n} per row</option>`).join("")}
            </select>
        `;
        card.appendChild(header);

        header.querySelector(".group-name-input").addEventListener("change", (e) => {
            updateGroup(group.id, { name: e.target.value });
        });
        header.querySelector(".columns-select").addEventListener("change", (e) => {
            updateGroup(group.id, { columns: parseInt(e.target.value, 10) });
        });

        const grid = document.createElement("div");
        grid.className = "items-grid";
        grid.style.gridTemplateColumns = `repeat(${group.columns}, 1fr)`;
        grid.dataset.groupId = group.id;

        group.items.forEach(item => grid.appendChild(renderItemCard(group, item)));

        card.appendChild(grid);
        container.appendChild(card);

        new Sortable(grid, {
            group: "shared-items",
            animation: 150,
            handle: ".item-card",
            onEnd: async (evt) => {
                const itemId = evt.item.dataset.itemId;
                if (!itemId) {
                    renderGroups();
                    return;
                }
                const targetGroupId = evt.to.dataset.groupId;
                const targetIndex = evt.newIndex;
                await fetch("/api/items/move", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        item_id: itemId,
                        target_group_id: targetGroupId,
                        target_index: targetIndex
                    })
                });
                await fetchData();
            }
        });
    });

    new Sortable(container, {
        animation: 150,
        handle: "#group-drag-handle",
        onEnd: async () => {
            const order = [...container.children].map(el => el.dataset.groupId);
            await fetch("/api/groups/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order })
            });
            await fetchData();
        }
    });
}

function renderItemCard(group, item) {
    const card = document.createElement("div");
    card.className = "item-card";
    card.dataset.itemId = item.id;

    const iconHtml = `<img class="item-icon" src="${escapeHtml(item.icon)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'item-icon-fallback',innerHTML:'<i class=\\'fa-solid fa-cube\\'></i>'}))">`;

    const status = getUptimeStatus(item.id);
    const dot = renderStatusDot(status);

    const links = [];
    if (item.local_ip) {
        const port = item.port ? `:${item.port}` : "";
        links.push(`<a href="http://${escapeHtml(item.local_ip)}${port}" target="_blank"><i class="fa-solid fa-house"></i> Local</a>`);
    }
    if (item.domain) {
        links.push(`<a href="https://${escapeHtml(item.domain)}" target="_blank"><i class="fa-solid fa-globe"></i> Web</a>`);
    }

    card.innerHTML = `
        <div class="item-top">
            ${iconHtml}
            <div class="item-name">${escapeHtml(item.name)}${dot}</div>
            <div class="item-actions">
                <i class="fa-solid fa-pen-to-square edit-icon" title="Edit"></i>
            </div>
        </div>
        <div class="item-links">${links.join("")}</div>
    `;

    card.querySelector(".edit-icon").addEventListener("click", (e) => {
        e.stopPropagation();
        openItemModal(group.name, item);
    });

    return card;
}

async function updateGroup(id, body) {
    await fetch(`/api/groups/${id}`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });
    await fetchData();
}

/* ---------------- UPTIME STATUS DOT ---------------- */
function getUptimeStatus(itemId) {
    const uptimeState = STATE.checks_state.uptime;
    if (!STATE.settings.checks_enabled.uptime || !uptimeState || !uptimeState.results) {
        return { local: null, domain: null };
    }
    const result = uptimeState.results.find(r => r.item_id === itemId);
    if (!result) return { local: null, domain: null };
    return {
        local: result.local ? result.local.reachable : null,
        domain: result.domain ? result.domain.reachable : null
    };
}

function renderStatusDot(status) {
    const hasLocal = status.local !== null;
    const hasDomain = status.domain !== null;
    if (!hasLocal && !hasDomain) return "";

    const upCount = [status.local, status.domain].filter(v => v === true).length;
    const downCount = [status.local, status.domain].filter(v => v === false).length;

    let cls = "dot-grey";
    if (downCount === 0) cls = "dot-green";
    else if (upCount === 0) cls = "dot-red";
    else cls = "dot-orange";

    const parts = [];
    if (hasLocal) parts.push(`Local: ${status.local ? "up" : "down"}`);
    if (hasDomain) parts.push(`Web: ${status.domain ? "up" : "down"}`);

    return ` <span class="item-status-dot ${cls}" title="${escapeHtml(parts.join(" · "))}"></span>`;
}

/* ---------------- ITEM MODAL ---------------- */
const itemModal = document.getElementById("item-modal");
const iconPreview = document.getElementById("icon-preview");
const iconUrlInput = document.getElementById("item-icon");
const iconFileInput = document.getElementById("icon-file-input");

function updateIconPreview() {
    const url = iconUrlInput.value.trim();
    if (url) {
        iconPreview.innerHTML = `<img src="${escapeHtml(url)}" onerror="this.parentElement.innerHTML='<i class=\\'fa-solid fa-image\\'></i>'">`;
    } else {
        iconPreview.innerHTML = `<i class="fa-solid fa-image"></i>`;
    }
}

function openItemModal(groupName = "", item = null) {
    document.getElementById("item-modal-title").textContent = item ? "Edit app" : "Add app";
    document.getElementById("item-id").value = item ? item.id : "";
    document.getElementById("item-name").value = item ? item.name : "";
    document.getElementById("item-group-name").value = groupName || "";
    document.getElementById("item-local-ip").value = item ? item.local_ip : "";
    document.getElementById("item-port").value = item ? item.port : "";
    document.getElementById("item-domain").value = item ? item.domain : "";
    document.getElementById("predefined-select").value = "";
    document.getElementById("item-delete-btn").classList.toggle("hidden", !item);
    iconUrlInput.value = item ? item.icon : "";
    updateIconPreview();
    itemModal.classList.remove("hidden");
}

iconFileInput.addEventListener("change", async () => {
    const file = iconFileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    iconPreview.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

    try {
        const res = await fetch("/api/upload", {
            method: "POST",
            body: formData
        });
        const result = await res.json();
        if (result.url) {
            iconUrlInput.value = result.url;
        } else {
            alert(result.error || "Upload failed");
        }
    } catch (err) {
        alert("Upload failed");
    }
    updateIconPreview();
    iconFileInput.value = "";
});

document.getElementById("add-website-btn").addEventListener("click", () => openItemModal());

document.getElementById("predefined-select").addEventListener("change", (e) => {
    const idx = e.target.value;
    if (idx === "") return;
    const app = PREDEFINED[idx];
    document.getElementById("item-name").value = app.name;
    iconUrlInput.value = app.icon;
    document.getElementById("item-port").value = app.port;
    updateIconPreview();
});

document.getElementById("item-cancel-btn").addEventListener("click", () => itemModal.classList.add("hidden"));

document.getElementById("item-save-btn").addEventListener("click", async () => {
    const itemId = document.getElementById("item-id").value;
    const groupName = document.getElementById("item-group-name").value.trim();

    if (!groupName) {
        alert("Please select or type a group name.");
        return;
    }

    const body = {
        name: document.getElementById("item-name").value.trim() || "New app",
        icon: iconUrlInput.value.trim(),
        local_ip: document.getElementById("item-local-ip").value.trim(),
        port: document.getElementById("item-port").value.trim(),
        domain: document.getElementById("item-domain").value.trim(),
        group_name: groupName
    };

    if (itemId) {
        await fetch(`/api/items/${itemId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    } else {
        await fetch("/api/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    }
    itemModal.classList.add("hidden");
    await fetchData();
});

document.getElementById("item-delete-btn").addEventListener("click", async () => {
    const itemId = document.getElementById("item-id").value;
    if (!itemId) return;
    await fetch(`/api/items/${itemId}`, { method: "DELETE" });
    itemModal.classList.add("hidden");
    await fetchData();
});

/* ---------------- HEADER SEARCH ---------------- */
const SEARCH_ENGINES = {
    google:      { label: "Google",       url: "https://www.google.com/search?q=",              domain: "google.com" },
    bing:        { label: "Bing",         url: "https://www.bing.com/search?q=",                domain: "bing.com" },
    brave:       { label: "Brave Search", url: "https://search.brave.com/search?q=",            domain: "search.brave.com" },
    duckduckgo:  { label: "DuckDuckGo",   url: "https://duckduckgo.com/?q=",                    domain: "duckduckgo.com" },
    ecosia:      { label: "Ecosia",       url: "https://www.ecosia.org/search?q=",              domain: "ecosia.org" },
    startpage:   { label: "Startpage",    url: "https://www.startpage.com/sp/search?query=",    domain: "startpage.com" },
    yahoo:       { label: "Yahoo",        url: "https://search.yahoo.com/search?p=",            domain: "yahoo.com" },
};

function faviconUrl(domain) {
    return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

function updateSearchEngineIcon() {
    const key = STATE.settings.search_engine || "google";
    const engine = SEARCH_ENGINES[key] || SEARCH_ENGINES.google;
    document.getElementById("search-engine-icon").innerHTML =
        `<img src="${faviconUrl(engine.domain)}" alt="${engine.label}" title="${engine.label}" height="25px" width="25px" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-magnifying-glass'}))">`;
}

document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = document.getElementById("search-input").value.trim();
    if (!q) return;
    const key = STATE.settings.search_engine || "google";
    const engine = SEARCH_ENGINES[key] || SEARCH_ENGINES.google;
    window.open(engine.url + encodeURIComponent(q), "_blank");
    document.getElementById("search-input").value = "";
});

/* ---------------- CHECKS ---------------- */
const CHECK_DETAIL_RENDERERS = {
    outbound_ip(state) {
        if (state.changed) {
            return {
                html: `Outbound IP changed!<br>Old: <strong>${escapeHtml(state.previous_ip)}</strong><br>New: <strong>${escapeHtml(state.current_ip)}</strong>`,
                alert: true
            };
        }
        if (state.current_ip) {
            return { html: `Current outbound IP: <strong>${escapeHtml(state.current_ip)}</strong>` };
        }
        return { html: "Not checked yet." };
    },

    ssl_expiry(state) {
        if (!state.results || !state.results.length) {
            return { html: "No domains configured, or not checked yet." };
        }
        const rows = state.results.map(r => {
            if (r.error) {
                return `<div class="result-row bad"><span>${escapeHtml(r.name)}</span><span>${escapeHtml(r.error)}</span></div>`;
            }
            const cls = r.days_left <= 14 ? " bad" : (r.days_left <= 30 ? " warn" : "");
            return `<div class="result-row${cls}"><span>${escapeHtml(r.name)}</span><span>${r.days_left} days left</span></div>`;
        }).join("");
        return { html: `<div class="result-list">${rows}</div>` };
    },

    uptime(state) {
        if (!state.results || !state.results.length) {
            return { html: "No local IP/domain configured, or not checked yet." };
        }
        const rows = state.results.map(r => {
            const parts = [];
            if (r.local) parts.push(`Local: ${r.local.reachable ? "up" : "down"}`);
            if (r.domain) parts.push(`Domain: ${r.domain.reachable ? "up" : "down"}`);
            const bad = (r.local && !r.local.reachable) || (r.domain && !r.domain.reachable);
            return `<div class="result-row${bad ? " bad" : ""}"><span>${escapeHtml(r.name)}</span><span>${parts.join(" · ")}</span></div>`;
        }).join("");
        return { html: `<div class="result-list">${rows}</div>` };
    }
};

function renderDefaultDetail(state) {
    return { html: state && state.last_checked ? "Checked." : "Not checked yet." };
}

function formatLastChecked(iso) {
    if (!iso) return "Never checked";
    const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (diffSec < 60) return "Checked just now";
    if (diffSec < 3600) return `Checked ${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `Checked ${Math.floor(diffSec / 3600)}h ago`;
    return `Checked on ${new Date(iso).toLocaleDateString()}`;
}

function renderChecks() {
    const container = document.getElementById("checks-container");
    container.innerHTML = "";
    checksSortables.forEach(s => s.destroy());
    checksSortables = [];

    const layout = STATE.settings.checks_layout || [[]];
    const byId = Object.fromEntries(CHECKS_META.map(c => [c.id, c]));

    layout.forEach((columnIds, colIndex) => {
        const column = document.createElement("div");
        column.className = "checks-column";
        column.dataset.colIndex = colIndex;

        columnIds.forEach(checkId => {
            const check = byId[checkId];
            if (!check) return; // unknown/stale id, skip defensively
            column.appendChild(buildCheckCard(check));
        });

        container.appendChild(column);

        checksSortables.push(new Sortable(column, {
            group: "checks-shared",
            animation: 150,
            handle: ".check-drag-handle",
            emptyInsertThreshold: 30,
            onEnd: persistChecksLayout
        }));
    });
}

function buildCheckCard(check) {
    const checkId = check.id;
    const enabled = STATE.settings.checks_enabled[checkId];
    const state = STATE.checks_state[checkId] || {};
    const isRunning = runningChecks.has(checkId);

    const detail = enabled ?
        (CHECK_DETAIL_RENDERERS[checkId] || renderDefaultDetail)(state) :
        {
            html: "Disabled. Enable it in settings."
        };

    const card = document.createElement("div");
    card.className = "check-card" + (detail.alert ? " changed" : "") + (enabled ? "" : " disabled");
    card.dataset.checkId = checkId;

    const showClear = enabled && check.clear_endpoint && state.changed;

    card.innerHTML = `
        <i class="fa-solid fa-grip-vertical check-drag-handle" title="Drag to reorder"></i>
        <button class="check-refresh-btn" title="Refresh" ${!enabled || isRunning ? "disabled" : ""}>
            <i class="fa-solid fa-rotate${isRunning ? " fa-spin" : ""}"></i>
        </button>
        <div class="check-title-row">
            <i class="fa-solid ${check.icon || "fa-shield-halved"} check-icon"></i>
            <div class="check-title">${escapeHtml(check.name)}</div>
        </div>
        <div class="check-detail">${detail.html}</div>
        <div class="check-meta">${enabled ? formatLastChecked(state.last_checked) : ""}</div>
        ${showClear ? `<div class="check-actions"><button class="btn btn-primary clear-btn"><i class="fa-solid fa-check"></i> Clear</button></div>` : ""}
    `;

    if (enabled) {
        card.querySelector(".check-refresh-btn").addEventListener("click", () => runCheck(check));
    }
    const clearBtn = card.querySelector(".clear-btn");
    if (clearBtn) {
        clearBtn.addEventListener("click", async () => {
            await fetch(check.clear_endpoint, { method: "POST" });
            await fetchData();
        });
    }
    return card;
}

function persistChecksLayout() {
    const columns = [...document.querySelectorAll(".checks-column")];
    const layout = columns.map(col => [...col.children].map(el => el.dataset.checkId));
    fetch("/api/checks/reorder", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            layout
        })
    }).then(fetchData);
}

async function runCheck(check) {
    if (runningChecks.has(check.id)) return;
    runningChecks.add(check.id);
    renderChecks();

    try {
        await fetch(check.endpoint);
    } catch (e) {
        // ignore network errors, card will just keep showing old data
    }

    runningChecks.delete(check.id);
    await fetchData();
}

function runEnabledChecks() {
    CHECKS_META.forEach(check => {
        if (STATE.settings.checks_enabled[check.id] && !runningChecks.has(check.id)) {
            runCheck(check);
        }
    });
}

/* ---------------- SETTINGS MODAL ---------------- */
const settingsModal = document.getElementById("settings-modal");

document.getElementById("settings-btn").addEventListener("click", () => {
    renderSettingsForm();
    settingsModal.classList.remove("hidden");
});

function renderSettingsForm() {
    if (!STATE) return;
    const c = STATE.settings.colors;
    document.getElementById("color-primary").value = c.primary;
    document.getElementById("color-background").value = c.background;
    document.getElementById("color-surface").value = c.surface;
    document.getElementById("color-text").value = c.text;
    document.getElementById("settings-search-engine").value = STATE.settings.search_engine;

    const list = document.getElementById("settings-checks-list");
    list.innerHTML = "";
    CHECKS_META.forEach(check => {
        const row = document.createElement("label");
        row.className = "checkbox-row";
        row.innerHTML = `<input type="checkbox" data-check-id="${check.id}" ${STATE.settings.checks_enabled[check.id] ? "checked" : ""}> ${escapeHtml(check.name)}`;
        list.appendChild(row);
    });
}

["primary", "background", "surface", "text"].forEach(key => {
    document.getElementById(`color-${key}`).addEventListener("input", (e) => {
        document.documentElement.style.setProperty(`--color-${key}`, e.target.value);
    });
});

document.getElementById("settings-cancel-btn").addEventListener("click", () => {
    applyTheme();
    settingsModal.classList.add("hidden");
});

document.getElementById("settings-save-btn").addEventListener("click", async () => {
    const checksEnabled = {};
    document.querySelectorAll("#settings-checks-list input[type=checkbox]").forEach(cb => {
        checksEnabled[cb.dataset.checkId] = cb.checked;
    });

    const body = {
        colors: {
            primary: document.getElementById("color-primary").value,
            background: document.getElementById("color-background").value,
            surface: document.getElementById("color-surface").value,
            text: document.getElementById("color-text").value
        },
        search_engine: document.getElementById("settings-search-engine").value,
        checks_enabled: checksEnabled
    };

    const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    STATE.settings = await res.json();

    applyTheme();
    updateSearchEngineIcon();
    renderChecks();
    settingsModal.classList.add("hidden");
});
