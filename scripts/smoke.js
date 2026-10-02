'use strict';

/*
 * Test the actual deployed service over HTTP.
 * Verify release identity and the complete task lifecycle.
 * Delete only the temporary task created by this script.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const environment = process.argv[2];

if (!['staging', 'production'].includes(environment)) {
    throw new Error('Specify staging or production');
}

const port = environment === 'staging' ? 3001 : 3002;
const base = `http://127.0.0.1:${port}`;
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(
    fs.readFileSync(path.join(root, 'dist/bundle/build-info.json'), 'utf8')
);
const checks = [];
let taskId;

// Every request has a timeout and an explicit expected status.
async function call(route, expectedStatus, options = {}) {
    const response = await fetch(`${base}${route}`, {
        ...options,
        signal: AbortSignal.timeout(5000)
    });

    assert.equal(response.status, expectedStatus, `${route}: unexpected status`);
    return response;
}

function jsonOptions(method, body) {
    return {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    };
}

async function run() {
    const health = await (await call('/health', 200)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.environment, environment);
    assert.equal(health.version, manifest.version);
    checks.push('Health and release identity');

    const page = await (await call('/', 200)).text();
    assert.match(page, /TaskFlow/);
    checks.push('Web interface served');

    const created = await (await call('/api/tasks', 201,
        jsonOptions('POST', { title: `Deployment test ${Date.now()}` })
    )).json();

    assert.equal(typeof created.id, 'string');
    taskId = created.id;
    checks.push('Create task');

    const tasks = await (await call('/api/tasks', 200)).json();
    assert.ok(tasks.some(task => task.id === taskId));
    checks.push('Read task');

    const updated = await (await call(`/api/tasks/${taskId}`, 200,
        jsonOptions('PATCH', { completed: true })
    )).json();

    assert.equal(updated.completed, true);
    checks.push('Complete task');

    await call('/api/tasks', 400, jsonOptions('POST', { title: '' }));
    checks.push('Reject invalid input');

    const metrics = await (await call('/metrics', 200)).text();
    assert.match(metrics, /taskapp_http_requests_total/);
    checks.push('Monitoring metrics exposed');

    await call(`/api/tasks/${taskId}`, 204, { method: 'DELETE' });
    const removedId = taskId;
    taskId = undefined;

    const remaining = await (await call('/api/tasks', 200)).json();
    assert.ok(!remaining.some(task => task.id === removedId));
    checks.push('Delete task and verify removal');
}

async function main() {
    let failure;

    try {
        await run();
    } catch (error) {
        failure = error.message;
    } finally {
        // Attempt cleanup even if a later lifecycle check failed.
        if (taskId) {
            try {
                await call(`/api/tasks/${taskId}`, 204, { method: 'DELETE' });
            } catch (error) {
                failure = `${failure || 'Cleanup failed'}; ${error.message}`;
            }
        }
    }

    const report = {
        environment,
        version: manifest.version,
        checkedAt: new Date().toISOString(),
        passed: !failure,
        checks,
        error: failure || null
    };

    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'reports', `smoke-${environment}.json`),
        JSON.stringify(report, null, 2)
    );

    for (const check of checks) {
        console.log(`PASS: ${check}`);
    }

    if (failure) {
        throw new Error(failure);
    }

    console.log(`SMOKE TEST SUCCESS: ${environment} (${checks.length} checks)`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
