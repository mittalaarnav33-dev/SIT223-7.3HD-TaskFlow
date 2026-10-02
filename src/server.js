'use strict';

/*
 * SIT223 Task 7.3HD - Server Entry Point
 * Author: Aarnav Jain
 *
 * Starts the application using environment-specific configuration.
 * Keeping startup separate from app.js makes automated API tests easier.
 */

const { createApp } = require('./app');

// Staging and production will use different ports on the same computer.
const port = Number(process.env.PORT || 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
}

const app = createApp();

// Listen only on the local computer for the assessment demonstration.
const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Task Manager running at http://127.0.0.1:${port}`);
    console.log(`Environment: ${process.env.APP_ENV || 'development'}`);
    console.log(`Version: ${process.env.APP_VERSION || '1.0.0'}`);
});

// Report startup errors, such as another process already using the port.
server.on('error', (error) => {
    console.error(`Server error: ${error.message}`);
    process.exitCode = 1;
});

let shuttingDown = false;

// Stop accepting new connections and allow active requests to finish.
// The timeout prevents deployment shutdown from waiting indefinitely.
function shutdown() {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    console.log('Shutting down Task Manager...');

    const deadline = setTimeout(() => {
        console.error('Shutdown timed out');
        process.exit(1);
    }, 10000);

    deadline.unref();

    server.close(() => {
        clearTimeout(deadline);
        process.exit(0);
    });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
