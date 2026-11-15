const $ = (id) => document.getElementById(id);

const PAGE_SIZE = 10;

let allTickets = [];   // every ticket, used only for the statistics
let currentPage = 1;

async function api(url, method = 'GET', body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

function say(text, type) {
  const el = $('message');
  el.textContent = text || '';
  el.className = type || '';
}

function showAuth() {
  $('auth').hidden = false;
  $('app').hidden = true;
  $('userbox').hidden = true;
}

async function showApp(user) {
  $('auth').hidden = true;
  $('app').hidden = false;
  $('userbox').hidden = false;

  $('whoami').textContent = `${user.name} (${user.role})`;

  $('list-title').textContent =
    user.role === 'user' ? 'My tickets' : 'All tickets';

  currentPage = 1;

  await Promise.all([
    loadCategories(),
    loadStatistics(),
    loadTickets(),
  ]);
}

async function loadCategories() {
  const cats = await api('/api/categories');
  const select = $('category');

  select.replaceChildren();

  for (const c of cats) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  }
}

function cell(text, badgeClass) {
  const td = document.createElement('td');

  if (badgeClass !== undefined) {
    const span = document.createElement('span');
    span.className = `badge ${badgeClass}`;
    span.textContent = text;
    td.appendChild(span);
  } else {
    td.textContent = text ?? '';
  }

  return td;
}

// Fetch every ticket visible to this account (no filters), for the statistics.
async function loadAllTickets() {
  const all = [];
  let page = 1;
  let total = Infinity;

  while (all.length < total) {
    const res = await fetch(`/api/tickets?page=${page}&limit=50`);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Could not load tickets.');
    }

    total = Number(res.headers.get('X-Total-Count') || 0);

    const rows = await res.json();

    if (rows.length === 0) break;

    all.push(...rows);
    page++;
  }

  return all;
}

// Statistics always reflect all tickets, whatever the filters are
async function loadStatistics() {
  allTickets = await loadAllTickets();

  const countStatus = (status) =>
    allTickets.filter(t => t.status === status).length;

  const countPriority = (priority) =>
    allTickets.filter(t => t.priority === priority).length;

  $('stat-total').textContent = allTickets.length;
  $('stat-open').textContent = countStatus('open');
  $('stat-progress').textContent = countStatus('in_progress');
  $('stat-resolved').textContent = countStatus('resolved');

  $('stat-low').textContent = countPriority('low');
  $('stat-medium').textContent = countPriority('medium');
  $('stat-high').textContent = countPriority('high');
  $('stat-critical').textContent = countPriority('critical');
}

// Build the query string from the filters and the current page
function buildTicketQuery() {
  const params = new URLSearchParams({
    page: String(currentPage),
    limit: String(PAGE_SIZE),
  });

  const q = $('ticket-search').value.trim();
  const status = $('status-filter').value;
  const priority = $('priority-filter').value;

  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);

  return params;
}

function filtersActive() {
  return Boolean(
    $('ticket-search').value.trim() ||
    $('status-filter').value ||
    $('priority-filter').value
  );
}

// Ask the server for one page of filtered tickets
async function loadTickets() {
  const res = await fetch(`/api/tickets?${buildTicketQuery()}`);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not load tickets.');
  }

  const total = Number(res.headers.get('X-Total-Count') || 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // If the current page no longer exists (after a filter change), go to the last one
  if (currentPage > totalPages) {
    currentPage = totalPages;
    return loadTickets();
  }

  const rows = await res.json();

  renderRows(rows, total);
  updatePager(totalPages);
}

function renderRows(rows, total) {
  const body = $('tickets');
  const empty = $('empty');

  body.replaceChildren();

  empty.hidden = rows.length > 0;

  if (rows.length === 0) {
    empty.textContent = filtersActive()
      ? 'No tickets match your filters.'
      : 'No tickets yet.';
  }

  for (const t of rows) {
    const tr = document.createElement('tr');

    const idCell = cell(t.id);

    // Clickable ticket title
    const titleCell = document.createElement('td');
    const titleLink = document.createElement('a');

    titleLink.href = `/ticket.html?id=${encodeURIComponent(t.id)}`;
    titleLink.textContent = t.title;

    titleCell.appendChild(titleLink);

    // Format status
    const statusText = t.status.replace('_', ' ');

    tr.append(
      idCell,
      titleCell,
      cell(t.category),
      cell(t.priority, t.priority),
      cell(statusText, `status-${t.status}`),
      cell(t.created_by_name),
      cell(t.created_at)
    );

    body.appendChild(tr);
  }
}

function updatePager(totalPages) {
  $('prev-page').disabled = currentPage <= 1;
  $('next-page').disabled = currentPage >= totalPages;
  $('page-info').textContent = `Page ${currentPage} of ${totalPages}`;
}

// Reload the table, showing an error message if the request fails
async function refreshTickets() {
  try {
    await loadTickets();
  } catch (err) {
    say(err.message, 'error');
  }
}

// Any filter change goes back to page 1
function onFilterChange() {
  currentPage = 1;
  refreshTickets();
}

// Search waits 300 ms after the last keystroke before asking the server
let searchTimer = null;

$('ticket-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(onFilterChange, 300);
});

$('status-filter').addEventListener('change', onFilterChange);
$('priority-filter').addEventListener('change', onFilterChange);

// Reset all filters
$('reset-filters').addEventListener('click', () => {
  $('ticket-search').value = '';
  $('status-filter').value = '';
  $('priority-filter').value = '';

  onFilterChange();
});

// Pagination buttons
$('prev-page').addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    refreshTickets();
  }
});

$('next-page').addEventListener('click', () => {
  currentPage++;
  refreshTickets();
});

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Login
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    const { user } = await api(
      '/api/auth/login',
      'POST',
      formData(e.target)
    );

    e.target.reset();
    say('');

    await showApp(user);
  } catch (err) {
    say(err.message, 'error');
  }
});

// Register
$('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    const { user } = await api(
      '/api/auth/register',
      'POST',
      formData(e.target)
    );

    e.target.reset();
    say('Account created.', 'ok');

    await showApp(user);
  } catch (err) {
    say(err.message, 'error');
  }
});

// Create ticket
$('ticket-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  try {
    await api(
      '/api/tickets',
      'POST',
      formData(e.target)
    );

    e.target.reset();
    say('Ticket submitted successfully.', 'ok');

    // The new ticket is the most recent, so show page 1
    currentPage = 1;
    await Promise.all([loadStatistics(), loadTickets()]);
  } catch (err) {
    say(err.message, 'error');
  }
});

// Logout
$('logout').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', 'POST');

    allTickets = [];
    currentPage = 1;
    say('');
    showAuth();
  } catch (err) {
    say(err.message, 'error');
  }
});

// Initialize application
(async function init() {
  try {
    const { user } = await api('/api/auth/me');

    if (user) {
      await showApp(user);
    } else {
      showAuth();
    }
  } catch (err) {
    showAuth();
    say(err.message, 'error');
  }
})();