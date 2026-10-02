# TaskFlow — Work planner

Aarnav Jain · SIT223 Task 7.3HD

TaskFlow is a Node.js/Express application for planning work with priorities, calendar deadlines, completion tracking, overdue indicators, search, combined filters and sorting. The dashboard shows all-task totals and completion progress even when the visible list is filtered. Existing tasks created before version 1.1 remain usable.

## Run locally

Use Node.js 24 and npm. On Windows PowerShell, use `npm.cmd` to avoid the npm.ps1 execution-policy restriction.

```powershell
git clone https://github.com/mittalaarnav33-dev/SIT223-7.3HD-TaskFlow.git
Set-Location SIT223-7.3HD-TaskFlow
npm.cmd ci --ignore-scripts
npm.cmd start
```

Open http://127.0.0.1:3000. Stop with Ctrl+C. Local task data lives in `data/tasks.json` and is excluded from Git. The service binds to loopback for this assessment; it has no public-user authentication.

## Verify

```powershell
npm.cmd run test:coverage
npm.cmd run lint
npm.cmd audit --audit-level=high
npm.cmd run build
```

52 automated tests cover the API, persistence, invalid inputs, real calendar dates, legacy task compatibility and the shared browser planning logic. Coverage gates cover `src/app.js` and `public/model.js`: 95% lines, 95% functions and 80% branches. They do not measure browser DOM interactions or server startup. The updated visual interface should also be reviewed in Chrome after deployment.

Titles must contain 1–120 trimmed characters. Priority is low, medium or high, defaulting to medium. Due dates are optional, date-only ISO strings; impossible dates are rejected by the backend. An unfinished task is overdue only when its due date precedes today's local calendar date. Completed tasks are excluded from overdue counts.

## Jenkins delivery

Configure a Windows Pipeline job from SCM, repository above, branch `*/main`, script path `Jenkinsfile`. Git, Node.js and npm must be available to the Jenkins service account. The account needs deployment-folder write access and permission to manage the application's recorded processes.

| Stage | Actual work and gate |
|---|---|
| Build | Locked dependency installation, versioned ZIP and SHA-256 checksum |
| Test | Automated tests and enforced coverage thresholds |
| Code Quality | ESLint, complexity constraints and zero warnings |
| Security | npm dependency audit; high/critical findings or audit errors fail |
| Deploy | Checksum-verified staging deployment and HTTP smoke tests |
| Release | Staging checks, same-archive production promotion and smoke tests |
| Monitoring | Production build identity, live Prometheus target, alert rules and notification-service readiness |

SCM is polled every minute. Concurrent builds are queued. Reports, coverage and the ZIP are archived and fingerprinted. Failed gates stop subsequent stages.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -Environment staging
node scripts/smoke.js staging
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/monitor.ps1
```

Staging is http://127.0.0.1:3001; production is http://127.0.0.1:3002. Each has separate persistent data under `C:\ProgramData\TaskFlow-7.3HD`. Deployment releases are outside the Jenkins workspace. Deployment checks the recorded process identity before stopping it; release verifies staging's archive checksum before production promotion.

## Monitoring environment

The assessment host has Prometheus 3.15.0 and Alertmanager 0.34.1 Windows binaries installed under `C:\ProgramData\TaskFlow-7.3HD\tools`. They must be running before the Monitoring stage. From the repository's `monitoring` directory, start Prometheus with `prometheus.yml`, listening on `127.0.0.1:9090`, and Alertmanager with `alertmanager.yml`, listening on `127.0.0.1:9093`. Store their runtime data outside the repository. Validate configuration with `promtool check config prometheus.yml` and `amtool check-config alertmanager.yml`.

Start the notification receiver in a separate terminal:

```powershell
node monitoring/receiver.js
```

Prometheus scrapes production every five seconds. `TaskFlowProductionDown` fires after the target has been unavailable for 15 seconds. `TaskFlowServerErrors` watches repeated HTTP 5xx responses. Alertmanager delivers firing and resolved webhooks to the receiver. Recorded history is available at http://127.0.0.1:9095/incidents and persists outside the repository. These are local webhook notifications, not email notifications. The monitoring process continues after the pipeline ends.

## Scope and limitations

This is a local staging/production simulation on one Windows host. Processes currently require manual startup after a reboot; there is no service supervisor or automatic deployment rollback. JSON persistence supports one application process per environment file. npm audit checks known dependency vulnerabilities, not every application security flaw. The UI uses textContent for task titles and external scripts/styles compatible with Helmet's content security policy.
