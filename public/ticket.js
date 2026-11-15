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

function addText(parent, label, value) {
  const p = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = label + ": ";
  p.append(strong, document.createTextNode(value ?? "Not available"));
  parent.appendChild(p);
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

  const heading = document.createElement("h3");
  heading.textContent = `#${currentTicket.id} - ${currentTicket.title}`;
  container.appendChild(heading);

  addText(container, "Description", currentTicket.description);
  addText(container, "Category", currentTicket.category);
  addText(container, "Priority", currentTicket.priority);
  addText(container, "Status", currentTicket.status.replace("_", " "));
  addText(container, "Created by", currentTicket.created_by_name);
  addText(
    container,
    "Assigned technician",
    currentTicket.assigned_to_name ?? "Unassigned",
  );
  addText(container, "Created at", formatDate(currentTicket.created_at));
  addText(container, "Last updated", formatDate(currentTicket.updated_at));

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
    article.className = "card";

    const author = document.createElement("p");
    author.textContent =
      comment.user_name ||
      comment.author_name ||
      comment.name ||
      `User #${comment.user_id ?? ""}`;

    const message = document.createElement("p");
    message.textContent = comment.message;

    const date = document.createElement("small");
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
    const entry = document.createElement("p");

    const name = item.changed_by_name || `User #${item.changed_by}`;
    const oldValue = item.old_value ?? "Empty";
    const newValue = item.new_value ?? "Empty";

    entry.textContent =
      `${name} changed ${item.field} from "${oldValue}" to "${newValue}" ` +
      `(${formatDate(item.changed_at)})`;

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
