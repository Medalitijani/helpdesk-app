require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const db = require("./db");

if (!process.env.SESSION_SECRET) {
  console.error(
    "Missing SESSION_SECRET. Copy .env.example to .env and set it.",
  );
  process.exit(1);
}

const PORT = process.env.PORT || 3000;

const PRIORITIES = ["low", "medium", "high", "critical"];

const TICKET_STATUSES = [
  "open",
  "in_progress",
  "waiting",
  "resolved",
  "closed",
];

const STAFF_ROLES = ["technician", "admin"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const app = express();

app.use(helmet());
app.use(express.json({ limit: "50kb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

app.use(express.static(path.join(__dirname, "..", "public")));
app.use(
  "/vendor/chart.js",
  express.static(
    path.join(__dirname, "..", "node_modules", "chart.js", "dist"),
  ),
);

// ---------- helpers ----------

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, try again later." },
});

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in." });
  }

  // Refresh the role from the database so role changes take effect.
  const currentUser = db
    .prepare("SELECT role FROM users WHERE id = ?")
    .get(req.session.user.id);

  if (!currentUser) {
    return res.status(401).json({ error: "User not found." });
  }

  req.session.user.role = currentUser.role;
  next();
}

const isStaff = (user) => STAFF_ROLES.includes(user.role);

function requireStaff(req, res, next) {
  if (!isStaff(req.session.user)) {
    return res.status(403).json({
      error: "Technician or admin access required.",
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }

  next();
}

function startSession(req, user, done) {
  // New session ID at login prevents session fixation.
  req.session.regenerate((err) => {
    if (err) return done(err);

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };

    done(null);
  });
}

// ---------- authentication ----------

app.post("/api/auth/register", authLimiter, (req, res, next) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body.password || "");

  if (name.length < 2 || name.length > 80) {
    return res.status(400).json({
      error: "Name must be 2 to 80 characters.",
    });
  }

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  if (password.length < 8) {
    return res.status(400).json({
      error: "Password must be at least 8 characters.",
    });
  }

  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({
      error: "This email is already registered.",
    });
  }

  // The first account becomes admin. Everyone else is a normal user.
  const isFirst = db.prepare("SELECT COUNT(*) AS c FROM users").get().c === 0;
  const role = isFirst ? "admin" : "user";
  const hash = bcrypt.hashSync(password, 12);

  const info = db
    .prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
    )
    .run(name, email, hash, role);

  const user = {
    id: info.lastInsertRowid,
    name,
    email,
    role,
  };

  startSession(req, user, (err) => {
    if (err) return next(err);
    res.status(201).json({ user: req.session.user });
  });
});

app.post("/api/auth/login", authLimiter, (req, res, next) => {
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body.password || "");

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  // Same message for unknown email and wrong password.
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({
      error: "Invalid email or password.",
    });
  }

  startSession(req, user, (err) => {
    if (err) return next(err);
    res.json({ user: req.session.user });
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// ---------- user management ----------

// List all users (admin only).
app.get("/api/users", requireAuth, requireAdmin, (req, res) => {
  const users = db
    .prepare("SELECT id, name, email, role FROM users ORDER BY name")
    .all();

  res.json(users);
});

// Change a user's role (admin only).
app.patch("/api/users/:id/role", requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const role = req.body?.role;

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: "Invalid user ID." });
  }

  if (userId === req.session.user.id) {
    return res.status(400).json({
      error: "You cannot change your own role.",
    });
  }

  if (!["user", "technician"].includes(role)) {
    return res.status(400).json({ error: "Invalid role." });
  }

  const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);

  if (!user) {
    return res.status(404).json({ error: "User not found." });
  }

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);

  res.json({
    message: "User role updated successfully.",
    userId,
    role,
  });
});

// ---------- categories ----------

app.get("/api/categories", requireAuth, (req, res) => {
  res.json(db.prepare("SELECT id, name FROM categories ORDER BY name").all());
});

// ---------- tickets ----------

// Update ticket assignment, status and priority.
// Record every changed field in ticket_history.
// Only technicians and admins can update tickets.
app.patch("/api/tickets/:id", requireAuth, requireStaff, (req, res) => {
  const ticketId = Number(req.params.id);
  const body = req.body || {};

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "Invalid ticket ID." });
  }

  const allowedFields = ["assigned_to", "status", "priority"];
  const suppliedFields = allowedFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );

  if (suppliedFields.length === 0) {
    return res.status(400).json({
      error: "Provide assigned_to, status or priority.",
    });
  }

  const ticket = db
    .prepare(
      `
    SELECT id, assigned_to, status, priority, closed_at
    FROM tickets
    WHERE id = ?
  `,
    )
    .get(ticketId);

  if (!ticket) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  let assignedTo = ticket.assigned_to;
  let status = ticket.status;
  let priority = ticket.priority;

  if (Object.prototype.hasOwnProperty.call(body, "assigned_to")) {
    if (body.assigned_to === null) {
      assignedTo = null;
    } else {
      const technicianId = Number(body.assigned_to);

      if (!Number.isInteger(technicianId) || technicianId <= 0) {
        return res.status(400).json({
          error: "Invalid technician ID.",
        });
      }

      const technician = db
        .prepare(
          `
        SELECT id
        FROM users
        WHERE id = ? AND role IN ('technician', 'admin')
      `,
        )
        .get(technicianId);

      if (!technician) {
        return res.status(400).json({
          error: "Assigned user must be a technician or admin.",
        });
      }

      assignedTo = technicianId;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!TICKET_STATUSES.includes(body.status)) {
      return res.status(400).json({
        error: "Invalid ticket status.",
        allowed: TICKET_STATUSES,
      });
    }

    status = body.status;
  }

  if (Object.prototype.hasOwnProperty.call(body, "priority")) {
    if (!PRIORITIES.includes(body.priority)) {
      return res.status(400).json({
        error: "Invalid ticket priority.",
        allowed: PRIORITIES,
      });
    }

    priority = body.priority;
  }

  let closedAt = null;

  if (status === "closed") {
    closedAt =
      ticket.status === "closed"
        ? ticket.closed_at
        : new Date().toISOString().slice(0, 19).replace("T", " ");
  }

  // Identify fields that actually changed.
  const changes = [
    {
      field: "assigned_to",
      oldValue: ticket.assigned_to,
      newValue: assignedTo,
    },
    {
      field: "status",
      oldValue: ticket.status,
      newValue: status,
    },
    {
      field: "priority",
      oldValue: ticket.priority,
      newValue: priority,
    },
  ].filter((change) => change.oldValue !== change.newValue);

  // Update the ticket and insert history records in one transaction.
  const updateTicket = db.transaction(() => {
    db.prepare(
      `
      UPDATE tickets
      SET assigned_to = ?,
          status = ?,
          priority = ?,
          closed_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `,
    ).run(assignedTo, status, priority, closedAt, ticketId);

    const insertHistory = db.prepare(`
      INSERT INTO ticket_history
        (ticket_id, changed_by, field, old_value, new_value)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const change of changes) {
      insertHistory.run(
        ticketId,
        req.session.user.id,
        change.field,
        change.oldValue === null ? null : String(change.oldValue),
        change.newValue === null ? null : String(change.newValue),
      );
    }
  });

  updateTicket();

  res.json({
    message: "Ticket updated successfully.",
    ticketId,
    assigned_to: assignedTo,
    status,
    priority,
    closed_at: closedAt,
    historyEntries: changes.length,
  });
});

// Create a new ticket.
app.post("/api/tickets", requireAuth, (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const categoryId = Number(req.body.category_id);
  const priority = req.body.priority || "medium";

  if (title.length < 3 || title.length > 120) {
    return res.status(400).json({
      error: "Title must be 3 to 120 characters.",
    });
  }

  if (description.length < 1 || description.length > 5000) {
    return res.status(400).json({
      error: "Description is required (max 5000 characters).",
    });
  }

  if (!PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: "Invalid priority." });
  }

  if (!db.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId)) {
    return res.status(400).json({ error: "Invalid category." });
  }

  const info = db
    .prepare(
      "INSERT INTO tickets (title, description, priority, category_id, created_by) VALUES (?, ?, ?, ?, ?)",
    )
    .run(title, description, priority, categoryId, req.session.user.id);

  res.status(201).json({ id: info.lastInsertRowid });
});

// List tickets with server-side filters and pagination.
// Query parameters: status, priority, q (title or ID), page, limit (max 50).
// The total number of matching tickets is sent in the X-Total-Count header.
app.get("/api/tickets", requireAuth, (req, res) => {
  const user = req.session.user;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  // Access rule: users see only their own tickets; staff see all.
  if (!isStaff(user)) {
    conditions.push("t.created_by = ?");
    params.push(user.id);
  }

  // Status filter, validated against the allowed list.
  if (req.query.status) {
    if (!TICKET_STATUSES.includes(req.query.status)) {
      return res.status(400).json({ error: "Invalid status filter." });
    }

    conditions.push("t.status = ?");
    params.push(req.query.status);
  }

  // Priority filter, validated against the allowed list.
  if (req.query.priority) {
    if (!PRIORITIES.includes(req.query.priority)) {
      return res.status(400).json({ error: "Invalid priority filter." });
    }

    conditions.push("t.priority = ?");
    params.push(req.query.priority);
  }

  // Search in the title or the ticket ID.
  const q = String(req.query.q || "")
    .trim()
    .slice(0, 120);

  if (q) {
    conditions.push("(t.title LIKE ? OR CAST(t.id AS TEXT) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM tickets t ${whereSql}`)
    .get(...params);

  const rows = db
    .prepare(
      `
      SELECT
        t.id,
        t.title,
        t.status,
        t.priority,
        c.name AS category,
        u.name AS created_by_name,
        t.created_at
      FROM tickets t
      JOIN categories c ON c.id = t.category_id
      JOIN users u ON u.id = t.created_by
      ${whereSql}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ? OFFSET ?
    `,
    )
    .all(...params, limit, offset);

  res.set("X-Total-Count", String(total));
  res.json(rows);
});

// Export tickets as CSV (staff only).
// Respects the same filters as the list: status, priority and q.
// Must stay above GET /api/tickets/:id, otherwise "export.csv" is read as an ID.
app.get("/api/tickets/export.csv", requireAuth, requireStaff, (req, res) => {
  const conditions = [];
  const params = [];

  if (req.query.status) {
    if (!TICKET_STATUSES.includes(req.query.status)) {
      return res.status(400).json({ error: "Invalid status filter." });
    }

    conditions.push("t.status = ?");
    params.push(req.query.status);
  }

  if (req.query.priority) {
    if (!PRIORITIES.includes(req.query.priority)) {
      return res.status(400).json({ error: "Invalid priority filter." });
    }

    conditions.push("t.priority = ?");
    params.push(req.query.priority);
  }

  const q = String(req.query.q || "")
    .trim()
    .slice(0, 120);

  if (q) {
    conditions.push("(t.title LIKE ? OR CAST(t.id AS TEXT) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db
    .prepare(
      `
      SELECT
        t.id,
        t.title,
        c.name AS category,
        t.priority,
        t.status,
        u.name AS created_by_name,
        t.created_at,
        t.closed_at
      FROM tickets t
      JOIN categories c ON c.id = t.category_id
      JOIN users u ON u.id = t.created_by
      ${whereSql}
      ORDER BY t.created_at DESC, t.id DESC
    `,
    )
    .all(...params);

  const headers = [
    "ID",
    "Title",
    "Category",
    "Priority",
    "Status",
    "Created by",
    "Created at",
    "Closed at",
  ];

  // Quote each value, double any quote inside it, and neutralise
  // values starting with = + - @ so spreadsheets do not run them as formulas.
  const csvCell = (value) => {
    let text = value === null || value === undefined ? "" : String(value);

    if (/^[=+\-@]/.test(text)) {
      text = `'${text}`;
    }

    return `"${text.replace(/"/g, '""')}"`;
  };

  const lines = [
    headers.map(csvCell).join(","),
    ...rows.map((r) =>
      [
        r.id,
        r.title,
        r.category,
        r.priority,
        r.status,
        r.created_by_name,
        r.created_at,
        r.closed_at,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];

  // The BOM (\uFEFF) lets Excel read accented characters correctly.
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", 'attachment; filename="tickets.csv"');
  res.send("\uFEFF" + lines.join("\r\n"));
});

// Get ticket details, including the assigned technician's name.
app.get("/api/tickets/:id", requireAuth, (req, res) => {
  const user = req.session.user;

  const ticket = db
    .prepare(
      `
      SELECT
        t.*,
        c.name AS category,
        u.name AS created_by_name,
        assigned.name AS assigned_to_name
      FROM tickets t
      JOIN categories c ON c.id = t.category_id
      JOIN users u ON u.id = t.created_by
      LEFT JOIN users assigned ON assigned.id = t.assigned_to
      WHERE t.id = ?
    `,
    )
    .get(Number(req.params.id));

  if (!ticket || (!isStaff(user) && ticket.created_by !== user.id)) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  res.json(ticket);
});

// ---------- ticket comments ----------

// Add a comment to a ticket.
// Users can comment only on their own tickets.
// Technicians and admins can comment on all tickets.
app.post("/api/tickets/:id/comments", requireAuth, (req, res) => {
  const ticketId = Number(req.params.id);
  const message = String(req.body?.message || "").trim();
  const user = req.session.user;

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "Invalid ticket ID." });
  }

  if (message.length < 1 || message.length > 2000) {
    return res.status(400).json({
      error: "Comment must contain between 1 and 2000 characters.",
    });
  }

  const ticket = db
    .prepare("SELECT id, created_by FROM tickets WHERE id = ?")
    .get(ticketId);

  if (!ticket || (!isStaff(user) && ticket.created_by !== user.id)) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  const result = db
    .prepare(
      "INSERT INTO comments (ticket_id, user_id, message) VALUES (?, ?, ?)",
    )
    .run(ticketId, user.id, message);

  const comment = db
    .prepare(
      `
    SELECT
      c.id,
      c.ticket_id,
      c.user_id,
      c.message,
      c.created_at,
      u.name AS author_name
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.id = ?
  `,
    )
    .get(result.lastInsertRowid);

  res.status(201).json({
    message: "Comment added successfully.",
    comment,
  });
});

// Get all comments for a ticket.
app.get("/api/tickets/:id/comments", requireAuth, (req, res) => {
  const ticketId = Number(req.params.id);
  const user = req.session.user;

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "Invalid ticket ID." });
  }

  const ticket = db
    .prepare("SELECT id, created_by FROM tickets WHERE id = ?")
    .get(ticketId);

  if (!ticket || (!isStaff(user) && ticket.created_by !== user.id)) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  const comments = db
    .prepare(
      `
    SELECT
      c.id,
      c.ticket_id,
      c.user_id,
      c.message,
      c.created_at,
      u.name AS author_name
    FROM comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.ticket_id = ?
    ORDER BY c.created_at ASC, c.id ASC
  `,
    )
    .all(ticketId);

  res.json(comments);
});

// ---------- staff list ----------

// List technicians and admins for ticket assignment.
app.get("/api/staff", requireAuth, requireStaff, (req, res) => {
  const staff = db
    .prepare(
      `
    SELECT id, name, role
    FROM users
    WHERE role IN ('technician', 'admin')
    ORDER BY name
  `,
    )
    .all();

  res.json(staff);
});

// ---------- ticket history ----------

// Get the history of a ticket.
app.get("/api/tickets/:id/history", requireAuth, (req, res) => {
  const ticketId = Number(req.params.id);
  const user = req.session.user;

  if (!Number.isInteger(ticketId) || ticketId <= 0) {
    return res.status(400).json({ error: "Invalid ticket ID." });
  }

  const ticket = db
    .prepare("SELECT id, created_by FROM tickets WHERE id = ?")
    .get(ticketId);

  if (!ticket || (!isStaff(user) && ticket.created_by !== user.id)) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  const history = db
    .prepare(
      `
    SELECT
      h.id,
      h.ticket_id,
      h.field,
      h.old_value,
      h.new_value,
      h.changed_at,
      u.name AS changed_by_name
    FROM ticket_history h
    JOIN users u ON u.id = h.changed_by
    WHERE h.ticket_id = ?
    ORDER BY h.changed_at ASC, h.id ASC
  `,
    )
    .all(ticketId);

  res.json(history);
});

// ---------- statistics (staff only) ----------

// Ticket statistics for the dashboard: by status, by priority,
// by technician, and average resolution time in hours.
app.get("/api/stats", requireAuth, requireStaff, (req, res) => {
  const byStatus = db
    .prepare(
      `
    SELECT status, COUNT(*) AS count
    FROM tickets
    GROUP BY status
  `,
    )
    .all();

  const byPriority = db
    .prepare(
      `
    SELECT priority, COUNT(*) AS count
    FROM tickets
    GROUP BY priority
  `,
    )
    .all();

  const byTechnician = db
    .prepare(
      `
    SELECT
      t.assigned_to AS technician_id,
      COALESCE(u.name, 'Unassigned') AS technician_name,
      COUNT(*) AS count
    FROM tickets t
    LEFT JOIN users u ON u.id = t.assigned_to
    GROUP BY t.assigned_to
    ORDER BY count DESC
  `,
    )
    .all();

  // Average time between creation and closing, in hours (closed tickets only).
  const { avg_hours } = db
    .prepare(
      `
    SELECT AVG((julianday(closed_at) - julianday(created_at)) * 24) AS avg_hours
    FROM tickets
    WHERE closed_at IS NOT NULL
  `,
    )
    .get();

  res.json({
    byStatus,
    byPriority,
    byTechnician,
    averageResolutionHours:
      avg_hours === null ? null : Math.round(avg_hours * 10) / 10,
  });
});

// ---------- errors ----------

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

// ---------- start server ----------

// Export the app for the tests (Supertest).
module.exports = app;

// Start the server only when this file is run directly (npm run dev / start).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Helpdesk running on http://localhost:${PORT}`);
  });
}
