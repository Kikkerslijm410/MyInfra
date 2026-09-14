let STATE = null;
let PREDEFINED = [];
let CHECKS_META = [];
let TASK_STATUSES = [];
let ITEM_OPTIONS = [];
let TASKS = [];
let WIDGETS = [];
let taskFilters = { status: "", item_id: "", q: "" };
let searchDebounceTimer = null;
let geocodeDebounceTimer = null;
let selectedWeatherLocation = null;
const runningChecks = new Set();
let checksSortables = [];
let widgetsSortable = null;

/* ---------------- MOBILE DETECTION ---------------- */
function isMobile() {
    return window.matchMedia("(max-width: 700px)").matches;
}

function applySortableMobileState() {
    const disabled = isMobile();
    [...checksSortables, widgetsSortable].forEach(s => {
        if (s) s.option("disabled", disabled);
    });
    document.querySelectorAll(".items-grid, #groups-container").forEach(el => {
        if (el.sortableInstance) el.sortableInstance.option("disabled", disabled);
    });
}

window.addEventListener("resize", () => {
    clearTimeout(window._resizeTimer);
    window._resizeTimer = setTimeout(applySortableMobileState, 200);
});

/* ---------------- INIT ---------------- */
(async () => {
    await fetchChecksMeta();
    await fetchTasksMeta();
    await fetchPredefined();
    await fetchData();
    await fetchTasks();
    await fetchWidgets();
    applySortableMobileState();
})();

setInterval(() => {
    if (STATE) runEnabledChecks();
}, 5 * 60 * 1000);

/* ---------------- MAIN TABS ---------------- */
document.querySelectorAll(".main-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchMainTab(btn.dataset.tab));
});

function switchMainTab(tab) {
    document.querySelectorAll(".main-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    document.getElementById("main-tab-home").classList.toggle("hidden", tab !== "home");
    document.getElementById("main-tab-tasks").classList.toggle("hidden", tab !== "tasks");
}

/* ---------------- DATA FETCHING ---------------- */
async function fetchData() {
    const res = await fetch("/api/data");
    STATE = await res.json();
    setLanguage(STATE.settings.language || "en");
    applyTheme();
    renderGroups();
    renderSettingsForm();
    renderChecks();
    updateGroupDatalist();
    await fetchItemOptions();
}

async function fetchPredefined() {
    const res = await fetch("/api/predefined-apps");
    PREDEFINED = await res.json();
    const select = document.getElementById("predefined-select");
    select.innerHTML = `<option value="" data-i18n="custom_option">${t("custom_option")}</option>`;
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

async function fetchTasksMeta() {
    const res = await fetch("/api/tasks/meta");
    const meta = await res.json();
    TASK_STATUSES = meta.statuses;

    const statusSelect = document.getElementById("task-status");
    statusSelect.innerHTML = TASK_STATUSES.map(s => `<option value="${s}">${s}</option>`).join("");

    const filterSelect = document.getElementById("tasks-status-filter");
    filterSelect.innerHTML = `<option value="">${t("all_statuses")}</option>` +
        TASK_STATUSES.map(s => `<option value="${s}">${s}</option>`).join("");
}

async function fetchItemOptions() {
    const res = await fetch("/api/items/select-options");
    ITEM_OPTIONS = await res.json();
    const select = document.getElementById("task-item");
    select.innerHTML = `<option value="">${t("none_option")}</option>` +
        ITEM_OPTIONS.map(it => `<option value="${it.id}">${escapeHtml(it.group_name)} / ${escapeHtml(it.name)}</option>`).join("");
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
                ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${n === group.columns ? "selected" : ""}>${n} ${CURRENT_LANG === "nl" ? "per rij" : "per row"}</option>`).join("")}
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

        const gridSortable = new Sortable(grid, {
            group: "shared-items",
            animation: 150,
            handle: ".item-card",
            disabled: isMobile(),
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
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        item_id: itemId,
                        target_group_id: targetGroupId,
                        target_index: targetIndex
                    })
                });
                await fetchData();
            }
        });
        grid.sortableInstance = gridSortable;
    });

    const containerSortable = new Sortable(container, {
        animation: 150,
        handle: "#group-drag-handle",
        disabled: isMobile(),
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
    container.sortableInstance = containerSortable;
}

function getItemOverallStatus(status) {
    const hasLocal = status.local !== null;
    const hasDomain = status.domain !== null;
    if (!hasLocal && !hasDomain) return "unknown";

    const upCount = [status.local, status.domain].filter(v => v === true).length;
    const downCount = [status.local, status.domain].filter(v => v === false).length;

    if (downCount === 0) return "ok";
    if (upCount === 0) return "bad";
    return "warn";
}

function renderItemCard(group, item) {
    const card = document.createElement("div");
    card.dataset.itemId = item.id;

    const status = getUptimeStatus(item.id);
    const overallStatus = getItemOverallStatus(status);
    card.className = `item-card status-border-${overallStatus}`;

    const parts = [];
    if (status.local !== null) parts.push(`${t("checks_local")} ${status.local ? t("checks_up") : t("checks_down")}`);
    if (status.domain !== null) parts.push(`${t("checks_domain")} ${status.domain ? t("checks_up") : t("checks_down")}`);
    const dotTitle = parts.join(" · ");

    const iconHtml = `<img class="item-icon" src="${escapeHtml(item.icon)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'item-icon-fallback',innerHTML:'<i class=\\'fa-solid fa-cube\\'></i>'}))">`;

    const links = [];
    if (item.local_ip) {
        const port = item.port ? `:${item.port}` : "";
        links.push(`<a href="http://${escapeHtml(item.local_ip)}${port}" target="_blank"><i class="fa-solid fa-house"></i> ${t("local_link")}</a>`);
    }
    if (item.domain) {
        links.push(`<a href="https://${escapeHtml(item.domain)}" target="_blank"><i class="fa-solid fa-globe"></i> ${t("web_link")}</a>`);
    }

    const taskBadge = item.open_tasks > 0
        ? `<button class="item-task-badge" title="${item.open_tasks}"><i class="fa-solid fa-list-check"></i> ${item.open_tasks}</button>`
        : "";

    card.innerHTML = `
        <span class="item-status-corner-dot status-dot-${overallStatus}" title="${escapeHtml(dotTitle)}"></span>
        <div class="item-top">
            ${iconHtml}
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-actions">
                <i class="fa-solid fa-pen-to-square edit-icon" title="Edit"></i>
            </div>
        </div>
        <div class="item-links">${links.join("")}</div>
        ${taskBadge}
    `;

    card.querySelector(".edit-icon").addEventListener("click", (e) => {
        e.stopPropagation();
        openItemModal(group.name, item);
    });

    const badgeBtn = card.querySelector(".item-task-badge");
    if (badgeBtn) {
        badgeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openTasksFilteredByItem(item.id, item.name);
        });
    }

    return card;
}

async function updateGroup(id, body) {
    await fetch(`/api/groups/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    await fetchData();
}

/* ---------------- UPTIME STATUS ---------------- */
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
    document.getElementById("item-modal-title").textContent = item ? t("item_modal_edit") : t("item_modal_add");
    document.getElementById("item-id").value = item ? item.id : "";
    document.getElementById("item-name").value = item ? item.name : "";
    document.getElementById("item-group-name").value = groupName || "";
    document.getElementById("item-local-ip").value = item ? item.local_ip : "";
    document.getElementById("item-port").value = item ? item.port : "";
    document.getElementById("item-domain").value = item ? item.domain : "";
    document.getElementById("item-checks-excluded").checked = item ? !!item.checks_excluded : false;
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
        const res = await fetch("/api/upload", { method: "POST", body: formData });
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
        alert(t("alert_group_required"));
        return;
    }

    const body = {
        name: document.getElementById("item-name").value.trim() || "New app",
        icon: iconUrlInput.value.trim(),
        local_ip: document.getElementById("item-local-ip").value.trim(),
        port: document.getElementById("item-port").value.trim(),
        domain: document.getElementById("item-domain").value.trim(),
        group_name: groupName,
        checks_excluded: document.getElementById("item-checks-excluded").checked
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
    await fetchTasks();
});

document.getElementById("item-delete-btn").addEventListener("click", async () => {
    const itemId = document.getElementById("item-id").value;
    if (!itemId) return;
    await fetch(`/api/items/${itemId}`, { method: "DELETE" });
    itemModal.classList.add("hidden");
    await fetchData();
    await fetchTasks();
});

/* ---------------- TASKS ---------------- */
async function fetchTasks() {
    const params = new URLSearchParams();
    if (taskFilters.status) params.set("status", taskFilters.status);
    if (taskFilters.item_id) params.set("item_id", taskFilters.item_id);
    if (taskFilters.q) params.set("q", taskFilters.q);

    const res = await fetch(`/api/tasks?${params.toString()}`);
    TASKS = await res.json();
    renderTasks();
}

function openTasksFilteredByItem(itemId, itemName) {
    taskFilters.item_id = itemId;
    document.getElementById("tasks-item-filter-label").textContent = itemName;
    document.getElementById("tasks-clear-item-filter").classList.remove("hidden");
    switchMainTab("tasks");
    fetchTasks();
}

document.getElementById("tasks-clear-item-filter").addEventListener("click", () => {
    taskFilters.item_id = "";
    document.getElementById("tasks-clear-item-filter").classList.add("hidden");
    fetchTasks();
});

document.getElementById("tasks-status-filter").addEventListener("change", (e) => {
    taskFilters.status = e.target.value;
    fetchTasks();
});

document.getElementById("tasks-search").addEventListener("input", (e) => {
    clearTimeout(searchDebounceTimer);
    const value = e.target.value.trim();
    searchDebounceTimer = setTimeout(() => {
        taskFilters.q = value;
        fetchTasks();
    }, 300);
});

const STATUS_CLASS = {
    "New": "status-new",
    "In Progress": "status-progress",
    "Pending": "status-pending",
    "Scheduled": "status-scheduled",
    "On Hold": "status-onhold",
    "Completed": "status-completed"
};

function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(CURRENT_LANG === "nl" ? "nl-NL" : "en-US");
}

function formatDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString(CURRENT_LANG === "nl" ? "nl-NL" : "en-US", { dateStyle: "short", timeStyle: "short" });
}

function isOverdue(task) {
    if (!task.due_date || task.status === "Completed") return false;
    return new Date(task.due_date + "T00:00:00") < new Date(new Date().toDateString());
}

/* ---------------- TASK CARDS (list view) ---------------- */
function buildTaskNotesHtml(notes) {
    if (!notes || notes.length === 0) {
        return `<div class="task-notes-empty">${t("no_notes")}</div>`;
    }
    return notes.map(n => `
        <div class="task-note-item" data-note-id="${n.id}">
            <div class="task-note-content">${escapeHtml(n.content)}</div>
            <div class="task-note-meta">
                <span>${formatDateTime(n.created_at)}</span>
                <i class="fa-solid fa-trash task-note-delete" title="Delete"></i>
            </div>
        </div>
    `).join("");
}

function renderTasks() {
    const container = document.getElementById("tasks-list");
    container.innerHTML = "";

    if (TASKS.length === 0) {
        container.innerHTML = `<div class="task-empty">${t("no_tasks_found")}</div>`;
        return;
    }

    TASKS.forEach(task => {
        const row = document.createElement("div");
        row.className = "task-row" + (isOverdue(task) ? " overdue" : "");
        row.dataset.taskId = task.id;

        const notesCount = (task.notes || []).length;

        row.innerHTML = `
            <div class="task-row-main">
                <span class="status-badge ${STATUS_CLASS[task.status] || ""}">${escapeHtml(task.status)}</span>
                <span class="task-title">${escapeHtml(task.title)}</span>
                ${task.item_name ? `<span class="task-linked-item"><i class="fa-solid fa-link"></i> ${escapeHtml(task.item_name)}</span>` : ""}
                ${notesCount ? `<span class="task-notes-count"><i class="fa-solid fa-note-sticky"></i> ${notesCount}</span>` : ""}
            </div>
            <div class="task-row-meta">
                <span title="Due date"><i class="fa-regular fa-calendar"></i> ${formatDate(task.due_date)}</span>
            </div>
        `;

        row.addEventListener("click", () => openTaskViewModal(task.id));
        container.appendChild(row);
    });
}

/* ---------------- TASK MODAL ---------------- */
const taskModal = document.getElementById("task-modal");

document.getElementById("add-task-btn").addEventListener("click", () => openTaskModal(null));

function attachNoteDeleteHandlers(listEl, taskId, onChanged) {
    listEl.querySelectorAll(".task-note-delete").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            const noteEl = e.target.closest(".task-note-item");
            const noteId = noteEl.dataset.noteId;
            if (!confirm(t("confirm_delete_note"))) return;
            await fetch(`/api/tasks/${taskId}/notes/${noteId}`, { method: "DELETE" });
            await onChanged();
        });
    });
}

function renderTaskNotes(notes) {
    const list = document.getElementById("task-notes-list");
    list.innerHTML = buildTaskNotesHtml(notes);
    const taskId = document.getElementById("task-id").value;
    attachNoteDeleteHandlers(list, taskId, async () => {
        const res = await fetch(`/api/tasks/${taskId}`);
        const fresh = await res.json();
        renderTaskNotes(fresh.notes);
    });
}

/* ---------------- TASK VIEW MODAL ---------------- */
const taskViewModal = document.getElementById("task-view-modal");

async function openTaskViewModal(taskId) {
    const res = await fetch(`/api/tasks/${taskId}`);
    const task = await res.json();

    document.getElementById("task-view-id").value = task.id;
    document.getElementById("task-view-title").textContent = task.title;

    const statusEl = document.getElementById("task-view-status");
    statusEl.textContent = task.status;
    statusEl.className = "status-badge " + (STATUS_CLASS[task.status] || "");

    document.getElementById("task-view-description").textContent = task.description || "";

    const websiteBox = document.getElementById("task-view-website");
    if (task.item_name) {
        document.getElementById("task-view-website-name").textContent = task.item_name;
        websiteBox.classList.remove("hidden");
    } else {
        websiteBox.classList.add("hidden");
    }

    const dateLines = [`<div>${t("created_label")} ${formatDate(task.created_date)}</div>`];
    dateLines.push(`<div>${t("due_date_label")}: ${formatDate(task.due_date)}</div>`);
    if (task.complete_date) {
        dateLines.push(`<div>${t("completed_label")} ${formatDate(task.complete_date)}</div>`);
    }
    document.getElementById("task-view-dates").innerHTML = dateLines.join("");

    renderTaskViewNotes(task.notes);
    document.getElementById("task-view-note-input").value = "";

    taskViewModal.classList.remove("hidden");
}

function renderTaskViewNotes(notes) {
    const list = document.getElementById("task-view-notes-list");
    list.innerHTML = buildTaskNotesHtml(notes);
    const taskId = document.getElementById("task-view-id").value;
    attachNoteDeleteHandlers(list, taskId, async () => {
        const res = await fetch(`/api/tasks/${taskId}`);
        const fresh = await res.json();
        renderTaskViewNotes(fresh.notes);
    });
}

document.getElementById("task-view-close-btn").addEventListener("click", () => {
    taskViewModal.classList.add("hidden");
});

document.getElementById("task-view-edit-btn").addEventListener("click", () => {
    const taskId = document.getElementById("task-view-id").value;
    taskViewModal.classList.add("hidden");
    openTaskModal(taskId);
});

document.getElementById("task-view-note-add-btn").addEventListener("click", async () => {
    const taskId = document.getElementById("task-view-id").value;
    const input = document.getElementById("task-view-note-input");
    const content = input.value.trim();
    if (!content) {
        alert(t("alert_enter_note"));
        return;
    }
    await fetch(`/api/tasks/${taskId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
    });
    input.value = "";
    const res = await fetch(`/api/tasks/${taskId}`);
    const fresh = await res.json();
    renderTaskViewNotes(fresh.notes);
});

async function openTaskModal(taskId) {
    const isEdit = !!taskId;
    let task = null;
    if (isEdit) {
        const res = await fetch(`/api/tasks/${taskId}`);
        task = await res.json();
    }

    document.getElementById("task-modal-title").textContent = isEdit ? t("task_modal_edit") : t("task_modal_add");
    document.getElementById("task-id").value = isEdit ? task.id : "";
    document.getElementById("task-title").value = isEdit ? task.title : "";
    document.getElementById("task-description").value = isEdit ? task.description : "";
    document.getElementById("task-status").value = isEdit ? task.status : "New";
    document.getElementById("task-due-date").value = isEdit ? (task.due_date || "") : "";
    document.getElementById("task-item").value = isEdit ? (task.item_id || "") : "";
    document.getElementById("task-delete-btn").classList.toggle("hidden", !isEdit);

    const info = document.getElementById("task-dates-info");
    if (isEdit) {
        info.textContent = `${t("created_label")} ${formatDate(task.created_date)}` +
            (task.complete_date ? ` · ${t("completed_label")} ${formatDate(task.complete_date)}` : "");
        info.classList.remove("hidden");
    } else {
        info.classList.add("hidden");
    }

    document.getElementById("task-notes-section").classList.toggle("hidden", !isEdit);
    document.getElementById("task-notes-hint").classList.toggle("hidden", isEdit);
    document.getElementById("task-note-input").value = "";
    renderTaskNotes(isEdit ? task.notes : []);

    taskModal.classList.remove("hidden");
}

document.getElementById("task-cancel-btn").addEventListener("click", () => taskModal.classList.add("hidden"));

document.getElementById("task-note-add-btn").addEventListener("click", async () => {
    const taskId = document.getElementById("task-id").value;
    if (!taskId) return;

    const input = document.getElementById("task-note-input");
    const content = input.value.trim();
    if (!content) {
        alert(t("alert_enter_note"));
        return;
    }

    await fetch(`/api/tasks/${taskId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
    });
    input.value = "";

    const res = await fetch(`/api/tasks/${taskId}`);
    const fresh = await res.json();
    renderTaskNotes(fresh.notes);
});

document.getElementById("task-save-btn").addEventListener("click", async () => {
    const taskId = document.getElementById("task-id").value;
    const title = document.getElementById("task-title").value.trim();

    if (!title) {
        alert(t("alert_enter_title"));
        return;
    }

    const body = {
        title,
        description: document.getElementById("task-description").value.trim(),
        status: document.getElementById("task-status").value,
        due_date: document.getElementById("task-due-date").value || null,
        item_id: document.getElementById("task-item").value || null
    };

    if (taskId) {
        await fetch(`/api/tasks/${taskId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    } else {
        await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    }
    taskModal.classList.add("hidden");
    await fetchTasks();
    await fetchData();
    await fetchWidgets();
});

document.getElementById("task-delete-btn").addEventListener("click", async () => {
    const taskId = document.getElementById("task-id").value;
    if (!taskId) return;
    if (!confirm(t("confirm_delete_task"))) return;
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    taskModal.classList.add("hidden");
    await fetchTasks();
    await fetchData();
    await fetchWidgets();
});

/* ---------------- WIDGETS ---------------- */
async function fetchWidgets() {
    const res = await fetch("/api/widgets");
    WIDGETS = await res.json();
    renderWidgets();
}

function renderWidgets() {
    const container = document.getElementById("widgets-container");
    container.innerHTML = "";

    if (WIDGETS.length > 0) {
        WIDGETS.forEach(widget => container.appendChild(renderWidgetCard(widget)));
    }

    if (widgetsSortable) widgetsSortable.destroy();
    widgetsSortable = new Sortable(container, {
        animation: 150,
        handle: ".widget-drag-handle",
        disabled: isMobile(),
        onEnd: async () => {
            const order = [...container.children].map(el => el.dataset.widgetId).filter(Boolean);
            await fetch("/api/widgets/reorder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order })
            });
        }
    });
}

function renderWidgetCard(widget) {
    const card = document.createElement("div");
    card.className = "widget-card";
    card.dataset.widgetId = widget.id;

    let bodyHtml = "";
    if (widget.type === "weather") {
        bodyHtml = renderWeatherWidgetBody(widget);
    } else if (widget.type === "tasks") {
        bodyHtml = renderTasksWidgetBody(widget);
    }

    const titleIcon = widget.type === "weather" ? "fa-cloud-sun" : "fa-list-check";
    const titleText = widget.type === "weather"
        ? (widget.config.location_name || t("widget_type_weather"))
        : t("widget_type_tasks");

    card.innerHTML = `
        <div class="widget-card-header">
            <i class="fa-solid fa-grip-vertical widget-drag-handle" title="Drag to reorder"></i>
            <i class="fa-solid ${titleIcon}"></i>
            <span class="widget-title">${escapeHtml(titleText)}</span>
            <div class="widget-card-actions">
                <i class="fa-solid fa-pen-to-square widget-edit-icon" title="Edit"></i>
            </div>
        </div>
        <div class="widget-card-body">${bodyHtml}</div>
    `;

    card.querySelector(".widget-edit-icon").addEventListener("click", () => openWidgetModal(widget));

    card.querySelectorAll(".widget-task-row").forEach(row => {
        row.addEventListener("click", () => openTaskViewModal(row.dataset.taskId));
    });

    return card;
}

function renderWeatherWidgetBody(widget) {
    if (widget.error) {
        return `<div class="widget-body-empty">${escapeHtml(widget.error)}</div>`;
    }
    const days = (widget.data && widget.data.days) || [];
    if (days.length === 0) {
        return `<div class="widget-body-empty">${t("widget_no_forecast")}</div>`;
    }
    const locale = CURRENT_LANG === "nl" ? "nl-NL" : "en-US";
    return `<div class="weather-days">` + days.map(d => `
        <div class="weather-day">
            <div class="weather-day-label">${new Date(d.date + "T00:00:00").toLocaleDateString(locale, { weekday: "short" })}</div>
            <i class="fa-solid ${d.icon}"></i>
            <div class="weather-temp"><strong>${Math.round(d.temp_max)}°</strong> / ${Math.round(d.temp_min)}°</div>
            <div class="weather-desc">${escapeHtml(d.description)}</div>
        </div>
    `).join("") + `</div>`;
}

function renderTasksWidgetBody(widget) {
    const tasks = (widget.data && widget.data.tasks) || [];
    if (tasks.length === 0) {
        return `<div class="widget-body-empty">${t("widget_no_tasks_match")}</div>`;
    }
    return `<div class="widget-task-list">` + tasks.map(task => `
        <div class="widget-task-row" data-task-id="${task.id}">
            <span class="status-badge ${STATUS_CLASS[task.status] || ""}">${escapeHtml(task.status)}</span>
            <span class="widget-task-title">${escapeHtml(task.title)}</span>
            <span class="widget-task-due">${formatDate(task.due_date)}</span>
        </div>
    `).join("") + `</div>`;
}

/* ---------------- WIDGET MODAL ---------------- */
const widgetModal = document.getElementById("widget-modal");

document.getElementById("add-widget-btn").addEventListener("click", () => openWidgetModal(null));

document.getElementById("widget-type").addEventListener("change", updateWidgetConfigVisibility);

function updateWidgetConfigVisibility() {
    const type = document.getElementById("widget-type").value;
    document.getElementById("widget-config-weather").classList.toggle("hidden", type !== "weather");
    document.getElementById("widget-config-tasks").classList.toggle("hidden", type !== "tasks");
}

function openWidgetModal(widget) {
    document.getElementById("widget-modal-title").textContent = widget ? t("widget_modal_edit") : t("widget_modal_add");
    document.getElementById("widget-id").value = widget ? widget.id : "";
    document.getElementById("widget-type").value = widget ? widget.type : "weather";
    document.getElementById("widget-type").disabled = !!widget;
    document.getElementById("widget-delete-btn").classList.toggle("hidden", !widget);

    document.getElementById("widget-weather-search").value = "";
    document.getElementById("widget-weather-results").innerHTML = "";
    selectedWeatherLocation = null;

    if (widget && widget.type === "weather") {
        const cfg = widget.config;
        document.getElementById("widget-weather-days").value = cfg.days || 5;
        if (cfg.location_name && cfg.latitude != null) {
            selectedWeatherLocation = { name: cfg.location_name, latitude: cfg.latitude, longitude: cfg.longitude };
            showSelectedWeatherLocation();
        }
    } else {
        document.getElementById("widget-weather-days").value = 5;
        document.getElementById("widget-weather-selected").classList.add("hidden");
    }

    if (widget && widget.type === "tasks") {
        document.getElementById("widget-tasks-sort").value = widget.config.sort || "due_date";
        document.getElementById("widget-tasks-limit").value = widget.config.limit || 5;
    } else {
        document.getElementById("widget-tasks-sort").value = "due_date";
        document.getElementById("widget-tasks-limit").value = 5;
    }

    updateWidgetConfigVisibility();
    widgetModal.classList.remove("hidden");
}

document.getElementById("widget-cancel-btn").addEventListener("click", () => widgetModal.classList.add("hidden"));

document.getElementById("widget-weather-search").addEventListener("input", (e) => {
    clearTimeout(geocodeDebounceTimer);
    const q = e.target.value.trim();
    if (!q) {
        document.getElementById("widget-weather-results").innerHTML = "";
        return;
    }
    geocodeDebounceTimer = setTimeout(async () => {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const results = await res.json();
        const list = document.getElementById("widget-weather-results");
        if (!Array.isArray(results) || results.length === 0) {
            list.innerHTML = `<div class="location-result-empty">${t("no_locations_found")}</div>`;
            return;
        }
        list.innerHTML = results.map((r, idx) => `
            <div class="location-result" data-idx="${idx}">
                ${escapeHtml(r.name)}${r.admin1 ? ", " + escapeHtml(r.admin1) : ""}${r.country ? ", " + escapeHtml(r.country) : ""}
            </div>
        `).join("");
        list.querySelectorAll(".location-result").forEach(el => {
            el.addEventListener("click", () => {
                const r = results[parseInt(el.dataset.idx, 10)];
                selectedWeatherLocation = {
                    name: `${r.name}${r.country ? ", " + r.country : ""}`,
                    latitude: r.latitude,
                    longitude: r.longitude
                };
                showSelectedWeatherLocation();
                list.innerHTML = "";
                document.getElementById("widget-weather-search").value = "";
            });
        });
    }, 350);
});

function showSelectedWeatherLocation() {
    const el = document.getElementById("widget-weather-selected");
    if (!selectedWeatherLocation) {
        el.classList.add("hidden");
        return;
    }
    el.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${escapeHtml(selectedWeatherLocation.name)}`;
    el.classList.remove("hidden");
}

document.getElementById("widget-save-btn").addEventListener("click", async () => {
    const widgetId = document.getElementById("widget-id").value;
    const type = document.getElementById("widget-type").value;

    let config = {};
    if (type === "weather") {
        if (!selectedWeatherLocation) {
            alert(t("alert_select_location"));
            return;
        }
        config = {
            location_name: selectedWeatherLocation.name,
            latitude: selectedWeatherLocation.latitude,
            longitude: selectedWeatherLocation.longitude,
            days: parseInt(document.getElementById("widget-weather-days").value, 10)
        };
    } else if (type === "tasks") {
        config = {
            sort: document.getElementById("widget-tasks-sort").value,
            limit: parseInt(document.getElementById("widget-tasks-limit").value, 10) || 5
        };
    }

    if (widgetId) {
        await fetch(`/api/widgets/${widgetId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config })
        });
    } else {
        await fetch("/api/widgets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, config })
        });
    }
    widgetModal.classList.add("hidden");
    await fetchWidgets();
});

document.getElementById("widget-delete-btn").addEventListener("click", async () => {
    const widgetId = document.getElementById("widget-id").value;
    if (!widgetId) return;
    if (!confirm(t("confirm_remove_widget"))) return;
    await fetch(`/api/widgets/${widgetId}`, { method: "DELETE" });
    widgetModal.classList.add("hidden");
    await fetchWidgets();
});

/* ---------------- CHECKS ---------------- */
const CHECK_DETAIL_RENDERERS = {
    outbound_ip(state) {
        if (state.changed) {
            return {
                html: `${t("checks_ip_changed")}<br>${t("checks_ip_old")} <strong>${escapeHtml(state.previous_ip)}</strong><br>${t("checks_ip_new")} <strong>${escapeHtml(state.current_ip)}</strong>`,
                alert: true
            };
        }
        if (state.current_ip) {
            return { html: `${t("checks_current_outbound_ip")} <strong>${escapeHtml(state.current_ip)}</strong>` };
        }
        return { html: t("checks_not_checked") };
    },

    ssl_expiry(state) {
        if (!state.results || !state.results.length) {
            return { html: t("checks_no_domains") };
        }
        const rows = state.results.map(r => {
            if (r.error) {
                return `<div class="result-row bad"><span>${escapeHtml(r.name)}</span><span>${escapeHtml(r.error)}</span></div>`;
            }
            const cls = r.days_left <= 14 ? " bad" : (r.days_left <= 30 ? " warn" : "");
            return `<div class="result-row${cls}"><span>${escapeHtml(r.name)}</span><span>${r.days_left} ${t("checks_days_left")}</span></div>`;
        }).join("");
        return { html: `<div class="result-list">${rows}</div>` };
    },

    uptime(state) {
        if (!state.results || !state.results.length) {
            return { html: t("checks_no_uptime_targets") };
        }
        const rows = state.results.map(r => {
            const parts = [];
            if (r.local) parts.push(`${t("checks_local")} ${r.local.reachable ? t("checks_up") : t("checks_down")}`);
            if (r.domain) parts.push(`${t("checks_domain")} ${r.domain.reachable ? t("checks_up") : t("checks_down")}`);
            const bad = (r.local && !r.local.reachable) || (r.domain && !r.domain.reachable);
            return `<div class="result-row${bad ? " bad" : ""}"><span>${escapeHtml(r.name)}</span><span>${parts.join(" · ")}</span></div>`;
        }).join("");
        return { html: `<div class="result-list">${rows}</div>` };
    }
};

function renderDefaultDetail(state) {
    return { html: state && state.last_checked ? t("checks_checked") : t("checks_not_checked") };
}

function formatLastChecked(iso) {
    if (!iso) return t("checks_never_checked");
    const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (diffSec < 60) return t("checks_checked_just_now");
    if (diffSec < 3600) return t("checks_checked_m_ago", { n: Math.floor(diffSec / 60) });
    if (diffSec < 86400) return t("checks_checked_h_ago", { n: Math.floor(diffSec / 3600) });
    return t("checks_checked_on", { date: new Date(iso).toLocaleDateString(CURRENT_LANG === "nl" ? "nl-NL" : "en-US") });
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
            if (!check) return;
            // Disabled checks are hidden entirely — only manageable via "Manage checks"
            if (!STATE.settings.checks_enabled[checkId]) return;
            column.appendChild(buildCheckCard(check));
        });

        container.appendChild(column);

        checksSortables.push(new Sortable(column, {
            group: "checks-shared",
            animation: 150,
            handle: ".check-drag-handle",
            emptyInsertThreshold: 30,
            disabled: isMobile(),
            onEnd: persistChecksLayout
        }));
    });
}

function getCheckOverallStatus(checkId, state) {
    if (checkId === "outbound_ip") {
        return state.changed ? "warn" : (state.current_ip ? "ok" : "unknown");
    }
    if (checkId === "ssl_expiry") {
        if (!state.results || !state.results.length) return "unknown";
        const worst = state.results.reduce((acc, r) => {
            if (r.error) return "bad";
            if (acc === "bad") return acc;
            if (r.days_left <= 14) return "bad";
            if (r.days_left <= 30) return acc === "warn" ? acc : "warn";
            return acc;
        }, "ok");
        return worst;
    }
    if (checkId === "uptime") {
        if (!state.results || !state.results.length) return "unknown";
        const anyDown = state.results.some(r =>
            (r.local && !r.local.reachable) || (r.domain && !r.domain.reachable));
        return anyDown ? "bad" : "ok";
    }
    return state && state.last_checked ? "ok" : "unknown";
}

function buildCheckCard(check) {
    const checkId = check.id;
    const state = STATE.checks_state[checkId] || {};
    const isRunning = runningChecks.has(checkId);
    const overallStatus = getCheckOverallStatus(checkId, state);

    const detail = (CHECK_DETAIL_RENDERERS[checkId] || renderDefaultDetail)(state);

    const card = document.createElement("div");
    card.className = `check-card status-border-${overallStatus}`;
    card.dataset.checkId = checkId;

    const showClear = check.clear_endpoint && state.changed;

    card.innerHTML = `
        <i class="fa-solid fa-grip-vertical check-drag-handle" title="Drag to reorder"></i>
        <span class="check-status-dot status-dot-${overallStatus}"></span>
        <button class="check-refresh-btn" title="Refresh" ${isRunning ? "disabled" : ""}>
            <i class="fa-solid fa-rotate${isRunning ? " fa-spin" : ""}"></i>
        </button>
        <div class="check-title-row">
            <div class="check-icon-badge status-badge-${overallStatus}">
                <i class="fa-solid ${check.icon || "fa-shield-halved"}"></i>
            </div>
            <div class="check-title">${escapeHtml(check.name)}</div>
        </div>
        <div class="check-detail">${detail.html}</div>
        <div class="check-meta">${formatLastChecked(state.last_checked)}</div>
        ${showClear ? `<div class="check-actions"><button class="btn btn-primary clear-btn"><i class="fa-solid fa-check"></i> ${t("checks_clear")}</button></div>` : ""}
    `;

    card.querySelector(".check-refresh-btn").addEventListener("click", () => runCheck(check));

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout })
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

/* ---------------- MANAGE CHECKS MODAL ---------------- */
const checksManageModal = document.getElementById("checks-manage-modal");

document.getElementById("manage-checks-btn").addEventListener("click", () => {
    const list = document.getElementById("checks-manage-list");
    list.innerHTML = "";
    CHECKS_META.forEach(check => {
        const row = document.createElement("label");
        row.className = "switch-row";
        row.innerHTML = `
            <span>${escapeHtml(check.name)}</span>
            <span class="switch">
                <input type="checkbox" data-check-id="${check.id}" ${STATE.settings.checks_enabled[check.id] ? "checked" : ""}>
                <span class="slider"></span>
            </span>
        `;
        list.appendChild(row);
    });
    checksManageModal.classList.remove("hidden");
});

document.getElementById("checks-manage-cancel-btn").addEventListener("click", () => {
    checksManageModal.classList.add("hidden");
});

document.getElementById("checks-manage-save-btn").addEventListener("click", async () => {
    const checksEnabled = {};
    document.querySelectorAll("#checks-manage-list input[type=checkbox]").forEach(cb => {
        checksEnabled[cb.dataset.checkId] = cb.checked;
    });
    const res = await fetch("/api/checks/enabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checks_enabled: checksEnabled })
    });
    STATE.settings = await res.json();
    renderChecks();
    checksManageModal.classList.add("hidden");
});

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
    document.getElementById("settings-language").value = STATE.settings.language || "en";
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
            text: document.getElementById("color-text").value
        },
        language: document.getElementById("settings-language").value
    };

    const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    STATE.settings = await res.json();

    applyTheme();
    setLanguage(STATE.settings.language);
    renderGroups();
    renderChecks();
    fetchTasksMeta().then(fetchTasks);
    fetchWidgets();
    settingsModal.classList.add("hidden");
});

document.getElementById("backup-btn").addEventListener("click", () => {
    window.location.href = "/api/backup";
});

document.getElementById("restore-file-input").addEventListener("change", async () => {
    const input = document.getElementById("restore-file-input");
    const file = input.files[0];
    if (!file) return;

    if (!confirm(t("confirm_restore"))) {
        input.value = "";
        return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
        const res = await fetch("/api/restore", { method: "POST", body: formData });
        const result = await res.json();
        if (result.ok) {
            alert(t("alert_restore_success"));
            location.reload();
        } else {
            alert(result.error || t("alert_restore_failed"));
        }
    } catch (err) {
        alert(t("alert_restore_failed"));
    }
    input.value = "";
});
