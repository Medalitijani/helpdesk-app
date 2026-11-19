# IT Helpdesk

> A full-stack IT service desk application for reporting, assigning, tracking, and resolving support requests.

[![Live demo](https://img.shields.io/badge/Live-Demo-2563eb?style=for-the-badge)](https://helpdesk-app-9y13.onrender.com/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Live application:** https://helpdesk-app-9y13.onrender.com/

## At a glance

- Role-based workflows for requesters, technicians, and administrators
- Ticket lifecycle management with comments and a complete activity history
- Operational dashboard, filtering, pagination, and CSV reporting
- Optional transactional email notifications through Resend

## Contents

- [Features](#features)
- [Technologies](#technologies)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Roles](#roles)
- [API overview](#api-overview)
- [Database](#database)
- [Security choices](#security-choices)
- [Tests](#tests)
- [Known limitations and next steps](#known-limitations-and-next-steps)

---

A web-based IT ticket management system. Users report technical problems, and technicians and administrators triage, assign and resolve them, with a statistics dashboard and CSV export.

## Features

- Registration and login with session-based authentication
- Three roles: **user**, **technician**, **admin**
- Create tickets with category, priority and description
- Ticket list with server-side search, status and priority filters, and pagination
- Ticket detail page with comments and a full change history
- Email notifications for ticket creation, assignment, status/priority updates, and new comments (optional Resend integration)
- Staff controls to assign, change status and change priority
- Automatic history record for every field change
- Statistics dashboard (tickets by status, priority and technician, average resolution time)
- CSV export of tickets, respecting the active filters
- Automated tests for authentication, ticket access rules and permissions

## Technologies

| Layer          | Technology                                   |
| -------------- | -------------------------------------------- |
| Backend        | Node.js, Express 5                           |
| Database       | SQLite with better-sqlite3                   |
| Authentication | express-session, bcryptjs (12 salt rounds)   |
| Security       | Helmet, express-rate-limit                   |
| Frontend       | HTML, CSS, vanilla JavaScript                |
| Charts         | Chart.js (served locally, no CDN)            |
| Testing        | Jest, Supertest                              |
| Quality        | ESLint, Prettier                             |

## Project structure

```
helpdesk-app/
├── public/          # Frontend: index.html, app.js, dashboard.html, ticket.html, style.css
├── src/
│   ├── server.js    # Express routes and access control
│   ├── db.js        # SQLite connection and schema setup
│   ├── seed.js      # Demo data
│   └── sql/schema.sql
├── tests/           # Jest + Supertest tests
├── docs/            # Database and architecture diagrams
└── package.json
```

## Getting started

### Prerequisites

- Node.js 20 or newer
- npm

### Installation

```bash
git clone https://github.com/Medalitijani/helpdesk-app.git
cd helpdesk-app
npm install
```

### Configuration

Copy the example file and set a session secret:

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the generated value after `SESSION_SECRET=` in `.env`. Generate a second independent value and set it as `ADMIN_BOOTSTRAP_TOKEN`. Keep both secrets private and never commit `.env`.

### Email notifications (optional)

Email delivery uses [Resend](https://resend.com/). Create a Resend API key and verify the sender domain, then configure these environment variables in Render (or your local `.env`):

- `RESEND_API_KEY`: your Resend API key.
- `MAIL_FROM`: a verified sender, for example `IT Helpdesk <support@your-verified-domain.com>`.

If these variables are not configured, the application continues to work normally and email notifications remain disabled. Email delivery failures are logged and do not interrupt ticket creation, updates, or comments.

### Run the application

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

### Create the first administrator

1. Set a strong, private `ADMIN_BOOTSTRAP_TOKEN` in the server environment before starting the app. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and keep it out of source control.
2. Register the account that should become the administrator. Registration always creates a normal user.
3. While signed in to that account, open the browser developer console on the app and run the following, replacing the placeholder with the configured token:

```js
fetch("/api/auth/bootstrap-admin", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: "YOUR_ADMIN_BOOTSTRAP_TOKEN" })
}).then((response) => response.json()).then(console.log);
```

The endpoint promotes the signed-in account only if no administrator exists. The database check runs inside an immediate transaction, so simultaneous requests cannot create multiple first administrators. Once an administrator exists, further bootstrap attempts are rejected. Remove or rotate the environment token after setup. Do not share it or expose it in browser screenshots.

Every public registration creates a standard **user** account. To create the first administrator on a fresh database, register your own account, then use the one-time bootstrap procedure below.

### Load demo data (optional)

```bash
npm run seed
```

This creates five demo accounts and 17 tickets. All demo accounts use the password `Demo1234!`. These accounts exist only for local demonstration.

## Live demo

The application is deployed on Render (free plan):

**https://helpdesk-app-9y13.onrender.com**

Please note:

- The free instance sleeps after a period of inactivity, so the first visit can take around 50 seconds to load.
- Data is stored in a local SQLite file on the free plan. It may be erased when the service restarts or is redeployed. Persistent storage would require a paid disk or a hosted database such as PostgreSQL.
- **Public-demo security note:** public registration creates only standard user accounts. Administrator creation requires an authenticated account and the private `ADMIN_BOOTSTRAP_TOKEN`, and is refused once an administrator exists. Keep this token out of the repository and remove it from the hosting environment after initial setup. This does not by itself make the demo production-ready; do not enter real personal or support data.
- The app uses the default in-process session store provided by `express-session`; sessions are not durable across restarts and this store is not suitable for a production multi-instance deployment. Use a persistent session store for production.
- Create accounts only for demonstration. On a fresh local database, the first registered account becomes the administrator.

## Roles

| Capability                                 | User | Technician | Admin |
| ------------------------------------------ | :--: | :--------: | :---: |
| Create tickets                             |  ✓   |     ✓      |   ✓   |
| View and comment on own tickets            |  ✓   |     ✓      |   ✓   |
| View and comment on all tickets            |      |     ✓      |   ✓   |
| Assign, change status and priority         |      |     ✓      |   ✓   |
| Export CSV and view statistics             |      |     ✓      |   ✓   |
| Change user roles                          |      |            |   ✓   |

Access rules are enforced on the server. Hiding a button in the interface is never the only protection.

## API overview

| Method | Endpoint                          | Access                     |
| ------ | --------------------------------- | -------------------------- |
| POST   | `/api/auth/register`              | Public                     |
| POST   | `/api/auth/login`                 | Public                     |
| POST   | `/api/auth/logout`                | Logged in                  |
| GET    | `/api/auth/me`                    | Public                     |
| GET    | `/api/categories`                 | Logged in                  |
| POST   | `/api/tickets`                    | Logged in                  |
| GET    | `/api/tickets`                    | Own tickets, or all (staff)|
| GET    | `/api/tickets/export.csv`         | Staff                      |
| GET    | `/api/tickets/:id`                | Owner or staff             |
| PATCH  | `/api/tickets/:id`                | Staff                      |
| GET    | `/api/tickets/:id/comments`       | Owner or staff             |
| POST   | `/api/tickets/:id/comments`       | Owner or staff             |
| GET    | `/api/tickets/:id/history`        | Owner or staff             |
| GET    | `/api/staff`                      | Staff                      |
| GET    | `/api/stats`                      | Staff                      |
| GET    | `/api/users`                      | Admin                      |
| PATCH  | `/api/users/:id/role`             | Admin                      |

`GET /api/tickets` accepts `page`, `limit` (maximum 50), `status`, `priority` and `q`. The total number of matching tickets is returned in the `X-Total-Count` header.

## Database

Six tables: `users`, `categories`, `tickets`, `comments`, `ticket_history`, and the indexes on the most queried columns.

The canonical database definition is maintained in [`src/sql/schema.sql`](src/sql/schema.sql). It defines the users, categories, tickets, comments, and ticket-history tables, together with the supporting indexes.

## Security choices

- **Passwords** are hashed with bcrypt, 12 salt rounds. They are never stored or returned in plain text.
- **Sessions** are regenerated at login to prevent session fixation. Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production, with an 8-hour lifetime.
- **SQL injection:** every query uses bound parameters. User input is never concatenated into SQL.
- **Authorisation** is checked on the server for every route. A user can never read or change another user's ticket.
- **Input validation** on all write routes: lengths, allowed values for status and priority, and existence checks for foreign keys.
- **Rate limiting** on login and registration to slow down brute-force attempts.
- **Security headers** through Helmet.
- **CSV export** neutralises spreadsheet formulas (values starting with `=`, `+`, `-` or `@`).
- **Error messages** are generic. Internal details are logged on the server only.

## Tests

```bash
npm test
```

The tests use a separate database file (`tests/test.db`), so real data is never touched. They cover registration and login, the explicit administrator-bootstrap flow, ticket creation, access rules between users, and permission checks on staff-only routes.

## Code quality

```bash
npm run lint      # ESLint
npm run format    # Prettier
```

## Known limitations and next steps

- **CSRF protection:** the `SameSite=Lax` cookie limits cross-site request forgery, but a dedicated CSRF token is not implemented.
- **Administrator bootstrap:** public registration never grants admin privileges. The first admin must be provisioned with the private `ADMIN_BOOTSTRAP_TOKEN` while signed in; bootstrap is refused once an admin exists. Protect and remove the token after setup.
- **Session persistence:** the default `express-session` MemoryStore is used. It is intended for development, loses sessions on restart, and must be replaced for production.
- **Database:** SQLite suits a single-server demo. A production deployment with several instances would need PostgreSQL.
- **Notifications:** optional email alerts are sent through Resend when tickets are created, assigned, updated, or commented on. Configure `RESEND_API_KEY` and `MAIL_FROM` to enable delivery.
- **Attachments:** tickets cannot yet include files.
- **Accessibility:** keyboard navigation and screen-reader testing have not been audited.

## Project ownership and scope

This is a personal project developed and maintained by **Mohamed Ali Tijani**. The repository documents the application architecture, implementation, security controls, tests, deployment, and known limitations. It is a portfolio demonstration, not a production service for an external client.

## License

MIT