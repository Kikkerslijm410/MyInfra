let STATE = null;
let PREDEFINED = [];
let pendingIconUrl = "";

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
                if (!itemId) { renderGroups(); return; }
                const targetGroupId = evt.to.dataset.groupId;
                let targetIndex = evt.newIndex;
                await fetch("/api/items/move", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ item_id: itemId, target_group_id: targetGroupId, target_index: targetIndex })
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

    const iconHtml =  `<img class="item-icon" src="${escapeHtml(item.icon)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'item-icon-fallback',innerHTML:'<i class=\\'fa-solid fa-cube\\'></i>'}))">`;

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
            <div class="item-name">${escapeHtml(item.name)}</div>
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

/* ---------------- GROUP API HELPERS ---------------- */
async function updateGroup(id, body) {
    await fetch(`/api/groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    await fetchData();
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

iconFileInput.addEventListener("change", async () => {
    const file = iconFileInput.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    iconPreview.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

    try {
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const result = await res.json();
        if (result.url) {
            iconUrlInput.value = result.url;
            updateIconPreview();
        } else {
            alert(result.error || "Upload failed");
            updateIconPreview();
        }
    } catch (err) {
        alert("Upload failed");
        updateIconPreview();
    }
    iconFileInput.value = "";
});

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

/* ---------------- CHECKS SECTION ---------------- */
function renderChecks() {
    const container = document.getElementById("checks-container");
    container.innerHTML = "";

    if (!STATE.settings.checks_enabled.outbound_ip) {
        return;
    }

    const state = STATE.checks_state.outbound_ip;
    const card = document.createElement("div");
    card.className = "check-card" + (state.changed ? " changed" : "");

    let detail;
    if (state.changed) {
        detail = `Outbound IP changed!<br>Old: <strong>${escapeHtml(state.previous_ip)}</strong><br>New: <strong>${escapeHtml(state.current_ip)}</strong>`;
    } else if (state.current_ip) {
        detail = `Current outbound IP: <strong>${escapeHtml(state.current_ip)}</strong>`;
    } else {
        detail = "Not checked yet.";
    }

    card.innerHTML = `
        <div class="check-title-row">
            <i class="fa-solid fa-shield-halved check-icon"></i>
            <div class="check-title">Outbound IP monitor</div>
        </div>
        <div class="check-detail">${detail}</div>
        <div class="check-actions">
            <button class="btn" id="check-refresh-btn"><i class="fa-solid fa-rotate"></i> Check now</button>
            ${state.changed ? '<button class="btn btn-primary" id="check-clear-btn"><i class="fa-solid fa-check"></i> Clear</button>' : ""}
        </div>
    `;
    container.appendChild(card);

    document.getElementById("check-refresh-btn").addEventListener("click", async () => {
        await fetch("/api/checks/outbound-ip");
        await fetchData();
    });

    const clearBtn = document.getElementById("check-clear-btn");
    if (clearBtn) {
        clearBtn.addEventListener("click", async () => {
        await fetch("/api/checks/outbound-ip/clear", { method: "POST" });
        await fetchData();
        });
    }
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
    document.getElementById("check-outbound-ip").checked = STATE.settings.checks_enabled.outbound_ip;
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
    const body = {
        colors: {
            primary: document.getElementById("color-primary").value,
            background: document.getElementById("color-background").value,
            surface: document.getElementById("color-surface").value,
            text: document.getElementById("color-text").value,
        },
        search_engine: document.getElementById("settings-search-engine").value,
        checks_enabled: {
            outbound_ip: document.getElementById("check-outbound-ip").checked
        }
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

/* ---------------- INIT ---------------- */
fetchPredefined();
fetchData();
setInterval(() => {
    if (STATE && STATE.settings.checks_enabled.outbound_ip) {
        fetch("/api/checks/outbound-ip").then(() => fetchData());
    }
}, 300000);
