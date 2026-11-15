const bcrypt = require('bcryptjs');
const db = require('./db');

// Demo data only: never use these accounts or this password in production.
const PASSWORD = 'Demo1234!';

const DEMO_USERS = [
  { name: 'Demo Admin', email: 'admin@demo.local', role: 'admin' },
  { name: 'Demo Technician', email: 'tech@demo.local', role: 'technician' },
  { name: 'Demo User', email: 'user@demo.local', role: 'user' },
  { name: 'Sara Ben Ali', email: 'sara@demo.local', role: 'user' },
  { name: 'Youssef Trabelsi', email: 'youssef@demo.local', role: 'user' },
];

// [title, description, category, priority, status, requester, assignee, days ago, hours to close]
const TICKETS = [
  ['Laptop will not start', 'The laptop shows a black screen after the Windows logo.', 'Hardware', 'high', 'in_progress', 'user@demo.local', 'tech@demo.local', 3, null],
  ['Printer offline on 2nd floor', 'The shared printer does not appear on any computer.', 'Hardware', 'medium', 'open', 'sara@demo.local', null, 2, null],
  ['Cannot connect to Wi-Fi', 'Laptop connects to Wi-Fi but no internet access.', 'Network', 'high', 'waiting', 'youssef@demo.local', 'tech@demo.local', 5, null],
  ['Outlook keeps asking for password', 'Outlook prompts for credentials every time it starts.', 'Email', 'medium', 'resolved', 'user@demo.local', 'tech@demo.local', 8, null],
  ['VPN disconnects every hour', 'The VPN drops and must be reconnected manually.', 'Network', 'critical', 'in_progress', 'sara@demo.local', 'tech@demo.local', 1, null],
  ['Access to Finance shared folder', 'Need read access to the Finance shared folder.', 'Account / Access', 'low', 'closed', 'youssef@demo.local', 'admin@demo.local', 12, 26],
  ['Excel crashes on large file', 'Excel closes unexpectedly when opening a 200 MB workbook.', 'Software', 'medium', 'closed', 'user@demo.local', 'tech@demo.local', 10, 4],
  ['Password reset for new employee', 'New employee cannot log in on the first day.', 'Account / Access', 'high', 'closed', 'sara@demo.local', 'admin@demo.local', 7, 2],
  ['Monitor flickering', 'The left monitor flickers when the laptop is docked.', 'Hardware', 'low', 'open', 'youssef@demo.local', null, 0, null],
  ['Teams audio not working', 'No sound from the speakers during Teams calls.', 'Software', 'medium', 'closed', 'user@demo.local', 'tech@demo.local', 6, 3],
  ['Shared mailbox not visible', 'The support mailbox does not appear in Outlook.', 'Email', 'high', 'waiting', 'sara@demo.local', 'tech@demo.local', 4, null],
  ['Slow internet in meeting room B', 'Browsing is very slow in meeting room B only.', 'Network', 'medium', 'in_progress', 'user@demo.local', 'admin@demo.local', 2, null],
  ['Install antivirus on new PC', 'New computer needs the company antivirus installed.', 'Software', 'low', 'closed', 'youssef@demo.local', 'tech@demo.local', 9, 5],
  ['Keyboard keys not responding', 'Several keys on the desktop keyboard do not respond.', 'Hardware', 'low', 'resolved', 'sara@demo.local', null, 14, null],
  ['Request for Adobe licence', 'Need a licence for Adobe Acrobat Pro for reports.', 'Software', 'low', 'open', 'user@demo.local', null, 1, null],
  ['Phone cannot sync calendar', 'Work calendar does not sync on the company phone.', 'Email', 'medium', 'closed', 'youssef@demo.local', 'tech@demo.local', 15, 8],
  ['Account locked after holidays', 'Account locked after too many failed login attempts.', 'Account / Access', 'critical', 'closed', 'sara@demo.local', 'admin@demo.local', 11, 1],
];

function run() {
  const existing = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get('admin@demo.local');

  if (existing) {
    console.log('Demo data already exists. Nothing to do.');
    return;
  }

  const hash = bcrypt.hashSync(PASSWORD, 12);

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  );

  const userIds = {};

  for (const u of DEMO_USERS) {
    userIds[u.email] = insertUser.run(u.name, u.email, hash, u.role).lastInsertRowid;
  }

  const categoryIds = Object.fromEntries(
    db.prepare('SELECT id, name FROM categories').all().map((c) => [c.name, c.id])
  );

  const insertTicket = db.prepare(`
    INSERT INTO tickets
      (title, description, status, priority, category_id,
       created_by, assigned_to, created_at, updated_at, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Dates are written in the same format SQLite uses: "YYYY-MM-DD HH:MM:SS"
  const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const now = Date.now();

  // One transaction: either all demo data is inserted, or none is.
  const seedTickets = db.transaction(() => {
    for (const [title, description, category, priority, status,
      requester, assignee, daysAgo, hoursToClose] of TICKETS) {
      const created = new Date(now - daysAgo * DAY);
      const closedAt = status === 'closed' && hoursToClose !== null
        ? fmt(new Date(created.getTime() + hoursToClose * HOUR))
        : null;

      insertTicket.run(
        title,
        description,
        status,
        priority,
        categoryIds[category],
        userIds[requester],
        assignee ? userIds[assignee] : null,
        fmt(created),
        fmt(created),
        closedAt
      );
    }
  });

  seedTickets();

  console.log(`Created ${DEMO_USERS.length} demo users and ${TICKETS.length} tickets.`);
  console.log(`Demo password for every account: ${PASSWORD}`);
}

run();