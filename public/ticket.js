const $ = (id) => document.getElementById(id);

async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function say(message, type = "") {
  const el = $("message");
  el.textContent = message;
  el.className = type;
}

function formatDate(value) {
  return value ? String(value).replace("T", " ") : "Not available";
}

const ticketId = new URLSearchParams(window.location.search).get("id");

let currentUser = null;
let currentTicket = null;
let staffMembers = [];

async function loadTicket() {
  currentTicket = await api(`/api/tickets/${ticketId}`);

  const container = $("ticket-details");
  container.replaceChildren();

  $("ticket-reference").textContent = `TICKET #${currentTicket.id}`;
  const heading = document.createElement("div");
  heading.className = "ticket-title-block";
  const title = document.createElement("h3");
  title.textContent = currentTicket.title;
  const description = document.createElement("p");
  description.className = "ticket-description";
  description.textContent = currentTicket.description || "No description provided.";
  heading.append(title, description);

  const metadata = document.createElement("div");
  metadata.className = "ticket-metadata-grid";
  const status = document.createElement("div");
  status.className = "ticket-meta-item";
  status.innerHTML = '<span class="meta-label">STATUS</span>';
  const statusBadge = document.createElement("span");
  statusBadge.className = `badge status-${currentTicket.status}`;
  statusBadge.textContent = currentTicket.status.replaceAll("_", " ");
  status.appendChild(statusBadge);

  const priority = document.createElement("div");
  priority.className = "ticket-meta-item";
  priority.innerHTML = '<span class="meta-label">PRIORITY</span>';
  const priorityBadge = document.createElement("span");
  priorityBadge.className = `badge ${currentTicket.priority}`;
  priorityBadge.textContent = currentTicket.priority;
  priority.appendChild(priorityBadge);

  const fields = [
    ["Category", currentTicket.category],
    ["Created by", currentTicket.created_by_name],
    ["Assigned technician", currentTicket.assigned_to_name ?? "Unassigned"],
    ["Created at", formatDate(currentTicket.created_at)],
    ["Last updated", formatDate(currentTicket.updated_at)],
  ];
  metadata.append(status, priority);
  for (const [label, value] of fields) {
    const item = document.createElement("div");
    item.className = "ticket-meta-item";
    const caption = document.createElement("span");
    caption.className = "meta-label";
    caption.textContent = label;
    const content = document.createElement("strong");
    content.className = "meta-value";
    content.textContent = value ?? "Not available";
    item.append(caption, content);
    metadata.appendChild(item);
  }
  container.replaceChildren(heading, metadata);

  $("status").value = currentTicket.status;
  $("priority").value = currentTicket.priority;
  $("assigned-to").value = currentTicket.assigned_to ?? "";
}

async function loadStaff() {
  staffMembers = await api("/api/staff");

  const select = $("assigned-to");
  select.replaceChildren();

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "Unassigned";
  select.appendChild(emptyOption);

  for (const staff of staffMembers) {
    if (staff.role !== "technician") continue;

    const option = document.createElement("option");
    option.value = staff.id;
    option.textContent = `${staff.name} (${staff.role})`;
    select.appendChild(option);
  }

  select.value = currentTicket.assigned_to ?? "";
}

async function loadComments() {
  const comments = await api(`/api/tickets/${ticketId}/comments`);
  const container = $("comments");
  container.replaceChildren();

  if (!comments.length) {
    container.textContent = "No comments yet.";
    return;
  }

  for (const comment of comments) {
    const article = document.createElement("article");
    article.className = "comment-item";

    const author = document.createElement("p");
    author.className = "comment-author";
    author.textContent =
      comment.user_name ||
      comment.author_name ||
      comment.name ||
      `User #${comment.user_id ?? ""}`;

    const message = document.createElement("p");
    message.className = "comment-message";
    message.textContent = comment.message;

    const date = document.createElement("small");
    date.className = "comment-date";
    date.textContent = formatDate(comment.created_at);

    article.append(author, message, date);
    container.appendChild(article);
  }
}

async function loadHistory() {
  const history = await api(`/api/tickets/${ticketId}/history`);
  const container = $("history");
  container.replaceChildren();

  if (!history.length) {
    container.textContent = "No history recorded yet.";
    return;
  }

  for (const item of history) {
    const entry = document.createElement("article");
    entry.className = "history-entry";

    const name = item.changed_by_name || `User #${item.changed_by}`;
    const oldValue = item.old_value ?? "Empty";
    const newValue = item.new_value ?? "Empty";

    const change = document.createElement("p");
    change.className = "history-change";
    change.textContent = `${name} changed ${item.field}`;
    const values = document.createElement("p");
    values.className = "history-values";
    values.textContent = `${oldValue} → ${newValue}`;
    const date = document.createElement("small");
    date.className = "history-date";
    date.textContent = formatDate(item.changed_at);
    entry.append(change, values, date);
    container.appendChild(entry);
  }
}

$("update-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const assignedValue = $("assigned-to").value;

    await api(`/api/tickets/${ticketId}`, "PATCH", {
      status: $("status").value,
      priority: $("priority").value,
      assigned_to: assignedValue ? Number(assignedValue) : null,
    });

    say("Ticket updated successfully.", "ok");
    await Promise.all([loadTicket(), loadHistory()]);
  } catch (error) {
    say(error.message, "error");
  }
});

$("comment-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = event.target;
  const message = new FormData(form).get("message").trim();

  if (!message) {
    say("Please write a comment.", "error");
    return;
  }

  try {
    await api(`/api/tickets/${ticketId}/comments`, "POST", { message });

    form.reset();
    say("Comment added successfully.", "ok");
    await loadComments();
  } catch (error) {
    say(error.message, "error");
  }
});

$("logout").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", "POST");
    window.location.href = "/";
  } catch (error) {
    say(error.message, "error");
  }
});

async function init() {
  try {
    if (!ticketId || !/^\d+$/.test(ticketId)) {
      throw new Error("Invalid ticket ID.");
    }

    const result = await api("/api/auth/me");

    if (!result.user) {
      window.location.href = "/";
      return;
    }

    currentUser = result.user;

    $("userbox").hidden = false;
    $("whoami").textContent = `${currentUser.name} (${currentUser.role})`;

    await loadTicket();
    await Promise.all([loadComments(), loadHistory()]);

    if (currentUser.role === "technician" || currentUser.role === "admin") {
      $("staff-controls").hidden = false;
      await loadStaff();
    }
  } catch (error) {
    say(error.message, "error");

    $("ticket-details").textContent = "Could not load ticket details.";
    $("comments").textContent = "Comments are unavailable.";
    $("history").textContent = "Ticket history is unavailable.";

    $("comment-form").hidden = true;
    $("staff-controls").hidden = true;
  }
}

init();
