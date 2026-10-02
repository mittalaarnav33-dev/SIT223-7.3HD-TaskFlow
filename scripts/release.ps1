# Promote only the artefact currently deployed and verified in staging.
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent

$archive = Join-Path $projectRoot "dist\taskflow.zip"
$hash = (Get-FileHash $archive -Algorithm SHA256).Hash
$staging = Get-Content `
    "C:\ProgramData\TaskFlow-7.3HD\staging\current.json" `
    -Raw | ConvertFrom-Json

if ($hash -ne $staging.checksum) {
    throw "This artefact differs from staging. Deploy and test staging first."
}

$health = Invoke-RestMethod `
    -Uri "http://127.0.0.1:3001/health" -TimeoutSec 5

if ($health.environment -ne "staging" -or
    $health.status -ne "ok" -or
    $health.version -ne $staging.version) {
    throw "Staging release verification failed."
}

# Recheck staging immediately before promotion.
& node (Join-Path $PSScriptRoot "smoke.js") staging
if ($LASTEXITCODE -ne 0) {
    throw "Staging tests failed. Production release stopped."
}

# Deploy the same ZIP using production-specific port and data storage.
& (Join-Path $PSScriptRoot "deploy.ps1") -Environment production

& node (Join-Path $PSScriptRoot "smoke.js") production
if ($LASTEXITCODE -ne 0) {
    throw "Production verification failed. Inspect deployment logs."
}

Write-Host "RELEASE SUCCESS: identical artefact promoted from staging."
