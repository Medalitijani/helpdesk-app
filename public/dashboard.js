const $ = (id) => document.getElementById(id);

const STATUS_LABELS = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

// Keep references so charts can be redrawn cleanly
const charts = {};

function say(text, type) {
  const el = $('message');
  el.textContent = text || '';
  el.className = type || '';
}

function drawChart(id, type, labels, values, colors) {
  if (charts[id]) {
    charts[id].destroy();
  }

  charts[id] = new Chart($(id), {
    type,
    data: {
      labels,
      datasets: [{
        label: 'Tickets',
        data: values,
        backgroundColor: colors,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: type === 'doughnut' },
      },
      scales: type === 'doughnut' ? {} : {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function renderStats(stats) {
  // Average resolution time
  $('avg-resolution').textContent =
    stats.averageResolutionHours === null
      ? 'No data yet'
      : `${stats.averageResolutionHours} h`;

  // Status chart
  drawChart(
    'status-chart',
    'bar',
    stats.byStatus.map((s) => STATUS_LABELS[s.status] || s.status),
    stats.byStatus.map((s) => s.count),
    '#1f6fd1'
  );

  // Priority chart
  drawChart(
    'priority-chart',
    'doughnut',
    stats.byPriority.map((p) => PRIORITY_LABELS[p.priority] || p.priority),
    stats.byPriority.map((p) => p.count),
    ['#8fd19e', '#f5c26b', '#f08a7e', '#c0392b']
  );

  // Technician chart
  drawChart(
    'technician-chart',
    'bar',
    stats.byTechnician.map((t) => t.technician_name),
    stats.byTechnician.map((t) => t.count),
    '#4c8bd6'
  );
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      say('Please log in from the main page first.', 'error');
      return;
    }

    if (res.status === 403) {
      say('Statistics are available to technicians and administrators only.', 'error');
      return;
    }

    if (!res.ok) {
      throw new Error(data.error || 'Could not load statistics.');
    }

    renderStats(data);
  } catch (err) {
    say(err.message, 'error');
  }
}

loadStats();