'use strict';

/*
 * SIT223 Task 7.3HD - Task Management Application
 * Author: Aarnav Jain
 *
 * Provides task creation, listing, completion and deletion.
 * Exposes health and Prometheus metrics endpoints for deployment checks
 * and continuous monitoring.
 *
 * This application is intended for a local assessment environment.
 * Authentication would be required before exposing it publicly.
 */

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const client = require('@prometheus-io/client');

/*
 * An application factory lets automated tests create independent apps
 * with temporary data files, without starting the production server.
 */
function createApp(options = {}) {
    const app = express();

    // Separate data files keep staging, production and test tasks isolated.
    const dataFile = options.dataFile ||
        process.env.DATA_FILE ||
        path.join(__dirname, '..', 'data', 'tasks.json');

    fs.mkdirSync(path.dirname(dataFile), { recursive: true });

    // Load saved tasks on startup. Invalid data stops startup rather than
    // silently replacing an existing file and losing the user's tasks.
    let tasks = fs.existsSync(dataFile)
        ? JSON.parse(fs.readFileSync(dataFile, 'utf8'))
        : [];

    if (!Array.isArray(tasks)) {
        throw new Error('Task data must be an array');
    }

    /*
     * Write to a temporary file, then rename it into place.
     * Update memory only after the file operation succeeds.
     * This file store supports one application process per data file.
     */
    function save(nextTasks) {
        const temporaryFile = `${dataFile}.tmp`;
        fs.writeFileSync(
            temporaryFile,
            JSON.stringify(nextTasks, null, 2),
            'utf8'
        );
        fs.renameSync(temporaryFile, dataFile);
        tasks = nextTasks;
    }

    // Each app owns its registry, avoiding duplicate metric registration
    // when multiple application instances are created during testing.
    const registry = new client.Registry();
    client.collectDefaultMetrics({ register: registry });

    const requests = new client.Counter({
        name: 'taskapp_http_requests_total',
        help: 'HTTP requests by method, route and response status',
        labelNames: ['method', 'route', 'status'],
        registers: [registry]
    });

    const duration = new client.Histogram({
        name: 'taskapp_http_duration_seconds',
        help: 'HTTP request duration in seconds',
        labelNames: ['method', 'route'],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2],
        registers: [registry]
    });

    // Helmet applies security headers, including a content security policy.
    app.use(helmet());

    // Record completed requests, including validation and server errors.
    app.use((req, res, next) => {
        const started = process.hrtime.bigint();

        res.on('finish', () => {
            // Route templates prevent every task UUID becoming a new label.
            const route = req.route ? req.route.path : 'unmatched';

            requests.inc({
                method: req.method,
                route,
                status: String(res.statusCode)
            });

            duration.observe(
                { method: req.method, route },
                Number(process.hrtime.bigint() - started) / 1e9
            );
        });

        next();
    });

    // Restrict JSON body size and serve the interface from the public folder.
    app.use(express.json({ limit: '10kb' }));
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // Deployment scripts use this endpoint to verify the running version.
    // This is a liveness check; it does not prove disk write availability.
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            environment: process.env.APP_ENV || 'development',
            version: process.env.APP_VERSION || '1.0.0',
            uptimeSeconds: Math.floor(process.uptime())
        });
    });

    // Prometheus scrapes this endpoint for process and HTTP metrics.
    app.get('/metrics', async (req, res) => {
        res.set('Content-Type', registry.contentType);
        res.send(await registry.metrics());
    });

    // READ: return the tasks belonging to this application environment.
    app.get('/api/tasks', (req, res) => {
        res.json(tasks);
    });

    // CREATE: validate the title and generate the remaining fields server-side.
    app.post('/api/tasks', (req, res) => {
        const title = req.body && req.body.title;

        if (typeof title !== 'string' ||
            !title.trim() ||
            title.trim().length > 120) {
            return res.status(400).json({
                error: 'Title must contain between 1 and 120 characters'
            });
        }

        const task = {
            id: randomUUID(),
            title: title.trim(),
            completed: false,
            createdAt: new Date().toISOString()
        };

        save([...tasks, task]);
        return res.status(201).json(task);
    });

    // UPDATE: only the completion flag can be changed through this endpoint.
    app.patch('/api/tasks/:id', (req, res) => {
        const task = tasks.find(item => item.id === req.params.id);

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Require a genuine boolean rather than accepting strings or numbers.
        if (!req.body || typeof req.body.completed !== 'boolean') {
            return res.status(400).json({
                error: 'Completed must be true or false'
            });
        }

        const updated = { ...task, completed: req.body.completed };

        save(tasks.map(item => item.id === task.id ? updated : item));
        return res.json(updated);
    });

    // DELETE: return 204 for success and 404 for an unknown task.
    app.delete('/api/tasks/:id', (req, res) => {
        if (!tasks.some(item => item.id === req.params.id)) {
            return res.status(404).json({ error: 'Task not found' });
        }

        save(tasks.filter(item => item.id !== req.params.id));
        return res.status(204).end();
    });

    // Unknown endpoints receive a consistent JSON response.
    app.use((req, res) => {
        res.status(404).json({ error: 'Endpoint not found' });
    });

    /*
     * Error middleware must have all four parameters.
     * Explain malformed requests without exposing file paths or stack traces.
     * Unexpected errors remain visible in the server logs.
     */
    app.use((err, req, res, next) => {
        if (res.headersSent) {
            return next(err);
        }

        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'Invalid JSON' });
        }

        if (err.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Request is too large' });
        }

        console.error(err.message);
        return res.status(500).json({ error: 'Internal server error' });
    });

    return app;
}

module.exports = { createApp };
