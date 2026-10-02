'use strict';

// Receive real Alertmanager webhooks and preserve incident history.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const folder = 'C:\\ProgramData\\TaskFlow-7.3HD\\incidents';
const file = path.join(folder, 'events.json');
fs.mkdirSync(folder, { recursive: true });

let events = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, 'utf8'))
  : [];

function respond(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value, null, 2));
}

const server = http.createServer((req, res) => {
  // Readiness endpoint used to verify the receiver is running.
  if (req.method === 'GET' && req.url === '/health') {
    return respond(res, 200, { status: 'ok' });
  }

  // View recorded firing and resolved notifications in the browser.
  if (req.method === 'GET' && req.url === '/incidents') {
    return respond(res, 200, events);
  }

  if (req.method !== 'POST' || req.url !== '/alerts') {
    return respond(res, 404, { error: 'Endpoint not found' });
  }

  // Bound request size so the receiver cannot accumulate unlimited input.
  let body = '';
  let oversized = false;
  req.on('data', chunk => {
    if (oversized) return;
    body += chunk;
    if (Buffer.byteLength(body) > 1048576) {
      oversized = true;
      respond(res, 413, { error: 'Payload too large' });
    }
  });

  req.on('end', () => {
    if (oversized) return;

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return respond(res, 400, { error: 'Invalid JSON' });
    }

    if (!Array.isArray(payload.alerts)) {
      return respond(res, 400, { error: 'Missing alerts array' });
    }

    const event = {
      receivedAt: new Date().toISOString(),
      status: payload.status,
      alerts: payload.alerts
    };

    // Persist before acknowledging; a failed write allows sender retries.
    const updated = [event, ...events].slice(0, 200);
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(updated, null, 2));
      fs.renameSync(`${file}.tmp`, file);
      events = updated;
      console.log(`${event.receivedAt}: ${event.status}`);
      return respond(res, 200, { received: true });
    } catch (error) {
      console.error(error.message);
      return respond(res, 500, { error: 'Could not save notification' });
    }
  });
});

// Keep the receiver accessible only from this computer.
server.listen(9095, '127.0.0.1', () => {
  console.log('Incident receiver: http://127.0.0.1:9095/incidents');
});
server.on('error', error => {
  console.error(error.message);
  process.exitCode = 1;
});
