'use strict';

/*
 * SIT223 7.3HD - Automated API and persistence tests.
 *
 * Each test uses a temporary data directory, protecting the tasks
 * stored by the running development application.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');

let directory;
let dataFile;
let app;

// Give every test an independent application and data file.
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-test-'));
    dataFile = path.join(directory, 'tasks.json');
    app = createApp({ dataFile });
});

// Remove only the temporary directory created for this test.
afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
});

test('Health endpoint confirms application availability', async () => {
    const response = await request(app).get('/health').expect(200);
    assert.equal(response.body.status, 'ok');
    assert.equal(typeof response.body.version, 'string');
    assert.equal(typeof response.body.uptimeSeconds, 'number');
});

test('New application starts with an empty task list', async () => {
    const response = await request(app).get('/api/tasks').expect(200);
    assert.deepEqual(response.body, []);
});

test('Creating a task trims its title and assigns server fields', async () => {
    const response = await request(app)
        .post('/api/tasks')
        .send({ title: '  Complete Jenkins pipeline  ' })
        .expect(201);

    assert.equal(response.body.title, 'Complete Jenkins pipeline');
    assert.equal(response.body.completed, false);
    assert.match(response.body.id, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isFinite(Date.parse(response.body.createdAt)));

    const listed = await request(app).get('/api/tasks').expect(200);
    assert.equal(listed.body[0].id, response.body.id);
});

// Check invalid types as well as empty and oversized titles.
const invalidTitles = [
    ['empty title', ''],
    ['whitespace title', '   '],
    ['oversized title', 'x'.repeat(121)],
    ['numeric title', 123],
    ['null title', null],
    ['object title', { text: 'Task' }]
];

for (const [name, title] of invalidTitles) {
    test(`Rejects ${name} without saving a task`, async () => {
        await request(app).post('/api/tasks').send({ title }).expect(400);
        const response = await request(app).get('/api/tasks').expect(200);
        assert.deepEqual(response.body, []);
    });
}

test('Rejects a missing title', async () => {
    await request(app).post('/api/tasks').send({}).expect(400);
});

test('Accepts a title at the 120-character limit', async () => {
    const title = 'x'.repeat(120);
    const response = await request(app)
        .post('/api/tasks').send({ title }).expect(201);
    assert.equal(response.body.title, title);
});

test('Tasks can be completed and reopened', async () => {
    const created = await request(app)
        .post('/api/tasks').send({ title: 'Test release' }).expect(201);

    const url = `/api/tasks/${created.body.id}`;

    const completed = await request(app)
        .patch(url).send({ completed: true }).expect(200);
    assert.equal(completed.body.completed, true);

    const reopened = await request(app)
        .patch(url).send({ completed: false }).expect(200);
    assert.equal(reopened.body.completed, false);
});

test('Rejects a string completion flag without changing the task', async () => {
    const created = await request(app)
        .post('/api/tasks').send({ title: 'Validate input' }).expect(201);

    await request(app)
        .patch(`/api/tasks/${created.body.id}`)
        .send({ completed: 'true' })
        .expect(400);

    const response = await request(app).get('/api/tasks').expect(200);
    assert.equal(response.body[0].completed, false);
});

test('Rejects an update with a missing completion flag', async () => {
    const created = await request(app)
        .post('/api/tasks').send({ title: 'Check update' }).expect(201);

    await request(app)
        .patch(`/api/tasks/${created.body.id}`)
        .send({})
        .expect(400);
});

test('Updating an unknown task returns 404', async () => {
    await request(app)
        .patch('/api/tasks/unknown')
        .send({ completed: true })
        .expect(404);
});

test('Deletion removes only the selected task', async () => {
    const first = await request(app)
        .post('/api/tasks').send({ title: 'First' }).expect(201);
    const second = await request(app)
        .post('/api/tasks').send({ title: 'Second' }).expect(201);

    await request(app)
        .delete(`/api/tasks/${first.body.id}`)
        .expect(204);

    const response = await request(app).get('/api/tasks').expect(200);
    assert.equal(response.body.length, 1);
    assert.equal(response.body[0].id, second.body.id);
});

test('Deleting an unknown task returns 404', async () => {
    await request(app).delete('/api/tasks/unknown').expect(404);
});

test('Saved task state survives application recreation', async () => {
    const created = await request(app)
        .post('/api/tasks').send({ title: 'Persistent task' }).expect(201);

    await request(app)
        .patch(`/api/tasks/${created.body.id}`)
        .send({ completed: true })
        .expect(200);

    const restartedApp = createApp({ dataFile });
    const response = await request(restartedApp)
        .get('/api/tasks').expect(200);

    assert.equal(response.body[0].title, 'Persistent task');
    assert.equal(response.body[0].completed, true);
});

test('Separate environment data files remain isolated', async () => {
    await request(app)
        .post('/api/tasks').send({ title: 'Development only' }).expect(201);

    const otherApp = createApp({
        dataFile: path.join(directory, 'staging', 'tasks.json')
    });

    const response = await request(otherApp).get('/api/tasks').expect(200);
    assert.deepEqual(response.body, []);
});

test('Malformed JSON returns a controlled client error', async () => {
    const response = await request(app)
        .post('/api/tasks')
        .set('Content-Type', 'application/json')
        .send('{"title":')
        .expect(400);

    assert.equal(response.body.error, 'Invalid JSON');
});

test('Oversized request bodies are rejected', async () => {
    await request(app)
        .post('/api/tasks')
        .send({ title: 'x'.repeat(12000) })
        .expect(413);
});

test('Security headers are included in responses', async () => {
    const response = await request(app).get('/health').expect(200);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.ok(response.headers['content-security-policy']);
    assert.equal(response.headers['x-powered-by'], undefined);
});

test('Metrics expose process data and actual HTTP request counts', async () => {
    await request(app).get('/api/tasks').expect(200);
    const response = await request(app).get('/metrics').expect(200);

    assert.match(response.text, /process_cpu_user_seconds_total/);
    assert.match(
        response.text,
        /taskapp_http_requests_total\{method="GET",route="\/api\/tasks",status="200"\} 1/
    );
    assert.match(response.text, /taskapp_http_duration_seconds/);
});

test('Unknown endpoints return a consistent 404 response', async () => {
    const response = await request(app).get('/unknown').expect(404);
    assert.equal(response.body.error, 'Endpoint not found');
});

test('Invalid saved data stops startup instead of being overwritten', () => {
    fs.writeFileSync(dataFile, '{}', 'utf8');
    assert.throws(() => createApp({ dataFile }), /must be an array/);
    assert.equal(fs.readFileSync(dataFile, 'utf8'), '{}');
});

test('The browser interface is served successfully', async () => {
    const response = await request(app).get('/').expect(200);
    assert.match(response.text, /TaskFlow/);
    assert.match(response.text, /\/app.js/);
});
