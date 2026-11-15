const path = require("path");
const fs = require("fs");

// Use a separate test database, so the real helpdesk.db is never touched.
const testDbFile = path.join(__dirname, "test.db");
process.env.DB_FILE = testDbFile;
process.env.SESSION_SECRET = "test-secret";

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

  test("the first account becomes admin", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "First User",
      email: "first@example.com",
      password: "password123",
    });

    expect(res.body.user.role).toBe("admin");
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
