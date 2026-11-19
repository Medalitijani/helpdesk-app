const path = require("path");
const fs = require("fs");

// Use a separate test database, so the real helpdesk.db is never touched.
const testDbFile = path.join(__dirname, "test.db");
process.env.DB_FILE = testDbFile;
process.env.SESSION_SECRET = "test-secret";
process.env.ADMIN_BOOTSTRAP_TOKEN = "test-bootstrap-token";

const request = require("supertest");
const app = require("../src/server");
const db = require("../src/db");

afterAll(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(testDbFile + suffix, { force: true });
  }
});

beforeEach(() => {
  db.exec(
    "DELETE FROM ticket_history; DELETE FROM comments; DELETE FROM tickets; DELETE FROM users;",
  );
});

describe("Authentication", () => {
  test("register creates an account and logs in", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Test User",
      email: "test@example.com",
      password: "password123",
    });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("test@example.com");
  });

  test("public registration never grants administrator access", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "First User",
      email: "first@example.com",
      password: "password123",
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("user");
  });

  test("an authenticated user can become the first admin with the bootstrap token", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({
      name: "Initial Admin",
      email: "initial-admin@example.com",
      password: "password123",
    });

    const res = await agent.post("/api/auth/bootstrap-admin")
      .send({ token: "test-bootstrap-token" });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("admin");
    expect(db.prepare("SELECT role FROM users WHERE email = ?").get("initial-admin@example.com").role).toBe("admin");
  });

  test("bootstrap token cannot promote another account after an admin exists", async () => {
    const first = request.agent(app);
    await first.post("/api/auth/register").send({
      name: "Initial Admin",
      email: "initial-admin@example.com",
      password: "password123",
    });
    await first.post("/api/auth/bootstrap-admin").send({ token: "test-bootstrap-token" });

    const second = request.agent(app);
    await second.post("/api/auth/register").send({
      name: "Second User",
      email: "second@example.com",
      password: "password123",
    });
    const res = await second.post("/api/auth/bootstrap-admin")
      .send({ token: "test-bootstrap-token" });

    expect(res.status).toBe(409);
    expect(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count).toBe(1);
  });

  test("an invalid bootstrap token is rejected", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({
      name: "User", email: "user@example.com", password: "password123",
    });
    const res = await agent.post("/api/auth/bootstrap-admin").send({ token: "wrong-token" });
    expect(res.status).toBe(403);
  });

  test("login with a wrong password is refused", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({
        name: "Test User",
        email: "test@example.com",
        password: "password123",
      });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@example.com", password: "wrong-password" });

    expect(res.status).toBe(401);
  });
});
