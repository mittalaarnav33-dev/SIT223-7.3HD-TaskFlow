'use strict';

/*
 * SIT223 7.3HD - Build and package TaskFlow.
 *
 * Packages application code, browser assets and locked dependencies.
 * Runtime data is excluded so deployments preserve environment data.
 * A checksum lets deployment verify the artefact before extracting it.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const bundle = path.join(output, 'bundle');
const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);

// Only remove generated build output, never application data.
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(bundle, { recursive: true });

// Include the lockfile so deployment can use npm ci reproducibly.
for (const name of ['src', 'public', 'package.json', 'package-lock.json']) {
    fs.cpSync(path.join(root, name), path.join(bundle, name), {
        recursive: true
    });
}

let commit = 'uncommitted';

// Git metadata becomes available after the project is committed.
try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
} catch {
    console.log('No Git commit yet; recording an uncommitted local build.');
}

const buildNumber = process.env.BUILD_NUMBER || 'local';
const version = `${packageJson.version}-${buildNumber}-${commit.slice(0, 12)}`;

const manifest = {
    application: 'TaskFlow',
    version,
    commit,
    buildNumber,
    builtAt: new Date().toISOString(),
    nodeVersion: process.version
};

fs.writeFileSync(
    path.join(bundle, 'build-info.json'),
    JSON.stringify(manifest, null, 2)
);

const archive = path.join(output, 'taskflow.zip');

// Pass paths through the child environment instead of injecting them
// into a PowerShell command. This also handles paths containing spaces.
execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    'Compress-Archive -Path (Join-Path $env:TASKFLOW_BUNDLE "*") -DestinationPath $env:TASKFLOW_ARCHIVE -Force'
], {
    env: {
        ...process.env,
        TASKFLOW_BUNDLE: bundle,
        TASKFLOW_ARCHIVE: archive
    },
    stdio: 'inherit'
});

const checksum = crypto.createHash('sha256')
    .update(fs.readFileSync(archive))
    .digest('hex');

fs.writeFileSync(
    path.join(output, 'taskflow.zip.sha256'),
    `${checksum}\n`
);

console.log(`Build version: ${version}`);
console.log(`Artefact: ${archive}`);
console.log(`SHA-256: ${checksum}`);
