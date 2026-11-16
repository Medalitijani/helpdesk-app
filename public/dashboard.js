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

// Palette matching the application's blue theme
const COLORS = {
  primary: '#398bff',
  primaryDark: '#1769d2',
  primaryLight: '#8fc2ff',
  text: '#b9cbe3',
  grid: 'rgba(111, 151, 198, 0.18)',
  priority: {
    low: '#4caf7a',
    medium: '#f0ad4e',
    high: '#e0684f',
    critical: '#b02a2a',
  },
};

// Global defaults: one font, soft grid, readable labels
Chart.defaults.font.family = 'Arial, Helvetica, sans-serif';
Chart.defaults.font.size = 13;
Chart.defaults.color = COLORS.text;

const charts = {};

function say(text, type) {
  const el = $('message');
  el.textContent = text || '';
  el.className = type || '';
}

function drawBar(id, labels, values) {
  if (charts[id]) charts[id].destroy();

  charts[id] = new Chart($(id), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Tickets',
        data: values,
        backgroundColor: COLORS.primary,
        hoverBackgroundColor: COLORS.primaryDark,
        borderRadius: 8,
        maxBarThickness: 56,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: COLORS.primaryDark,
          padding: 10,
          cornerRadius: 6,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: COLORS.grid },
          border: { display: false },
        },
      },
    },
  });
}

function drawPriority(labels, values, keys) {
  if (charts['priority-chart']) charts['priority-chart'].destroy();

  charts['priority-chart'] = new Chart($('priority-chart'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: keys.map((k) => COLORS.priority[k] || COLORS.primary),
        borderColor: '#0d1d35',
        borderWidth: 3,
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, padding: 16 },
        },
        tooltip: {
          backgroundColor: COLORS.primaryDark,
          padding: 10,
          cornerRadius: 6,
        },
      },
    },
  });
}

function renderStats(stats) {
  $('avg-resolution').textContent =
    stats.averageResolutionHours === null
      ? 'No data yet'
      : `${stats.averageResolutionHours} h`;

  drawBar(
    'status-chart',
    stats.byStatus.map((s) => STATUS_LABELS[s.status] || s.status),
    stats.byStatus.map((s) => s.count)
  );

  drawPriority(
    stats.byPriority.map((p) => PRIORITY_LABELS[p.priority] || p.priority),
    stats.byPriority.map((p) => p.count),
    stats.byPriority.map((p) => p.priority)
  );

  drawBar(
    'technician-chart',
    stats.byTechnician.map((t) => t.technician_name),
    stats.byTechnician.map((t) => t.count)
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