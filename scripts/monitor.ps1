$ErrorActionPreference = 'Stop'

# Verify the deployed application matches this build.
$projectRoot = Split-Path $PSScriptRoot -Parent
$manifest = Get-Content "$projectRoot\dist\bundle\build-info.json" -Raw |
    ConvertFrom-Json

$health = Invoke-RestMethod 'http://127.0.0.1:3002/health' -TimeoutSec 5

if ($health.status -ne 'ok' -or
    $health.environment -ne 'production' -or
    $health.version -ne $manifest.version) {
    throw 'Production health or build identity check failed.'
}

# Check that notification services are available.
Invoke-WebRequest 'http://127.0.0.1:9093/-/ready' `
    -UseBasicParsing -TimeoutSec 5 | Out-Null

$receiver = Invoke-RestMethod 'http://127.0.0.1:9095/health' -TimeoutSec 5
if ($receiver.status -ne 'ok') {
    throw 'Incident receiver is unhealthy.'
}

# Allow Prometheus time to scrape the newly deployed application.
$target = $null
$deadline = (Get-Date).AddSeconds(30)

do {
    $response = Invoke-RestMethod `
        'http://127.0.0.1:9090/api/v1/targets' -TimeoutSec 5

    $target = $response.data.activeTargets | Where-Object {
        $_.labels.job -eq 'taskflow-production' -and
        $_.scrapeUrl -eq 'http://127.0.0.1:3002/metrics'
    } | Select-Object -First 1

    if ($target.health -eq 'up') { break }
    Start-Sleep -Seconds 2
} until ((Get-Date) -ge $deadline)

if (!$target -or $target.health -ne 'up') {
    throw 'Prometheus production target is not UP.'
}

# Ensure both alert rules are loaded by the monitoring service.
$rules = Invoke-RestMethod `
    'http://127.0.0.1:9090/api/v1/rules' -TimeoutSec 5

$ruleNames = @($rules.data.groups | ForEach-Object {
    $_.rules | ForEach-Object { $_.name }
})

foreach ($requiredRule in @(
    'TaskFlowProductionDown',
    'TaskFlowServerErrors'
)) {
    if ($ruleNames -notcontains $requiredRule) {
        throw "Missing monitoring rule: $requiredRule"
    }
}

# Archive service checks and actual notification history as evidence.
$incidents = Invoke-RestMethod `
    'http://127.0.0.1:9095/incidents' -TimeoutSec 5

New-Item -ItemType Directory -Force "$projectRoot\reports" | Out-Null

@{
    checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
    passed = $true
    version = $health.version
    productionHealth = $health
    prometheusTarget = $target
    loadedRules = $ruleNames
    alertmanagerReady = $true
    receiverReady = $true
    incidentHistory = @($incidents)
} | ConvertTo-Json -Depth 25 |
    Set-Content "$projectRoot\reports\monitoring.json" -Encoding UTF8

Write-Host 'MONITORING PASS: production healthy, metrics UP, alert rules loaded, notification services ready.' `
    -ForegroundColor Green
