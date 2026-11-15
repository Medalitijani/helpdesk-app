const path = require('path');
const fs = require('fs');

// Use the same separate test database as the other test file.
const testDbFile = path.join(__dirname, 'test.db');
process.env.DB_FILE = testDbFile;
process.env.SESSION_SECRET = 'test-secret';

const request = require('supertest');
const app = require('../src/server');
const db = require('../src/db');

afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(testDbFile + suffix, { force: true });
  }
});

beforeEach(() => {
  db.exec('DELETE FROM ticket_history; DELETE FROM comments; DELETE FROM tickets; DELETE FROM users;');
});

// Each agent keeps its own session cookie, like a separate browser.
async function registerAgent(name, email) {
  const agent = request.agent(app);

  await agent
    .post('/api/auth/register')
    .send({ name, email, password: 'password123' });

  return agent;
}

function anyCategoryId() {
  return db.prepare('SELECT id FROM categories LIMIT 1').get().id;
}

function createTicket(agent) {
  return agent.post('/api/tickets').send({
    title: 'Printer problem',
    description: 'The printer is offline',
    category_id: anyCategoryId(),
    priority: 'medium',
  });
}

describe('Tickets and access rules', () => {
  test('a user can create a ticket', async () => {
    await registerAgent('Admin User', 'admin@example.com');   // first account = admin
    const user = await registerAgent('Normal User', 'user@example.com');

    const res = await createTicket(user);

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  test('a user cannot open a ticket created by another user', async () => {
    await registerAgent('Admin User', 'admin@example.com');
    const owner = await registerAgent('Owner', 'owner@example.com');
    const other = await registerAgent('Other', 'other@example.com');

    const created = await createTicket(owner);
    const res = await other.get(`/api/tickets/${created.body.id}`);

    expect(res.status).toBe(404);
  });

  test('a user only sees their own tickets in the list', async () => {
    await registerAgent('Admin User', 'admin@example.com');
    const owner = await registerAgent('Owner', 'owner@example.com');
    const other = await registerAgent('Other', 'other@example.com');

    await createTicket(owner);
    await createTicket(other);

    const res = await owner.get('/api/tickets');

    expect(res.body).toHaveLength(1);
    expect(res.headers['x-total-count']).toBe('1');
  });

  test('staff can see every ticket', async () => {
    const admin = await registerAgent('Admin User', 'admin@example.com');
    const user = await registerAgent('Normal User', 'user@example.com');

    await createTicket(user);

    const res = await admin.get('/api/tickets');

    expect(res.body).toHaveLength(1);
    expect(res.headers['x-total-count']).toBe('1');
  });

  test('a normal user cannot update a ticket', async () => {
    await registerAgent('Admin User', 'admin@example.com');
    const user = await registerAgent('Normal User', 'user@example.com');

    const created = await createTicket(user);
    const res = await user
      .patch(`/api/tickets/${created.body.id}`)
      .send({ status: 'closed' });

    expect(res.status).toBe(403);
  });
});