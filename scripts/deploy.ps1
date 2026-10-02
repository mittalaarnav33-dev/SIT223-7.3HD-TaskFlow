param(
    [ValidateSet("staging", "production")]
    [string]$Environment = "staging",

    [string]$DeploymentRoot = "C:\ProgramData\TaskFlow-7.3HD"
)

# Fail deployment when a command or file operation fails.
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path $PSScriptRoot -Parent
$archive = Join-Path $projectRoot "dist\taskflow.zip"
$checksumFile = "$archive.sha256"
$port = if ($Environment -eq "staging") { 3001 } else { 3002 }

# Verify the exact artefact before extracting or running its contents.
$expectedHash = (Get-Content $checksumFile -Raw).Trim()
$actualHash = (Get-FileHash $archive -Algorithm SHA256).Hash

if ($actualHash -ne $expectedHash) {
    throw "Artefact checksum mismatch. Deployment stopped."
}

$environmentRoot = Join-Path $DeploymentRoot $Environment
$releaseId = [guid]::NewGuid().ToString("N")
$releasePath = Join-Path $environmentRoot "releases\$releaseId"
$dataPath = Join-Path $environmentRoot "data\tasks.json"
$statePath = Join-Path $environmentRoot "current.json"

New-Item -ItemType Directory -Force -Path $releasePath | Out-Null
New-Item -ItemType Directory -Force `
    -Path (Split-Path $dataPath -Parent) | Out-Null

Expand-Archive -LiteralPath $archive -DestinationPath $releasePath

$manifest = Get-Content `
    (Join-Path $releasePath "build-info.json") -Raw | ConvertFrom-Json

# Install dependencies before stopping an existing deployment.
# Application data lives outside the release directory.
Push-Location $releasePath
try {
    & npm.cmd ci --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
        throw "Runtime dependency installation failed."
    }
} finally {
    Pop-Location
}

# Stop only a process whose command line matches the recorded release.
# This avoids terminating an unrelated process if Windows reused its PID.
if (Test-Path $statePath) {
    $previous = Get-Content $statePath -Raw | ConvertFrom-Json
    $existing = Get-CimInstance Win32_Process `
        -Filter "ProcessId = $($previous.processId)"

    if ($existing) {
        $previousEntry = Join-Path $previous.releasePath "src\server.js"

        if (-not $existing.CommandLine -or
            -not $existing.CommandLine.Contains($previousEntry)) {
            throw "Recorded PID belongs to a different process. Deployment stopped."
        }

        Stop-Process -Id $previous.processId -Force
        Wait-Process -Id $previous.processId -Timeout 10 `
            -ErrorAction SilentlyContinue
    }
}

# Refuse to replace an untracked service already using the target port.
$listener = Get-NetTCPConnection -LocalPort $port -State Listen `
    -ErrorAction SilentlyContinue

if ($listener) {
    throw "Port $port is already occupied by an untracked process."
}

$nodePath = (Get-Command node.exe).Source
$entryPoint = Join-Path $releasePath "src\server.js"
$stdout = Join-Path $releasePath "server.stdout.log"
$stderr = Join-Path $releasePath "server.stderr.log"

# Save and restore the caller's environment after starting the child.
$settings = @{
    PORT = "$port"
    APP_ENV = $Environment
    APP_VERSION = $manifest.version
    DATA_FILE = $dataPath
    NODE_ENV = "production"

    # Keep the deployed service separate from the Jenkins build process.
    JENKINS_NODE_COOKIE = "taskflow-$Environment"
}

$original = @{}
foreach ($name in $settings.Keys) {
    $original[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, $settings[$name], "Process")
}

try {
    $service = Start-Process -FilePath $nodePath `
        -ArgumentList "`"$entryPoint`"" `
        -WorkingDirectory $releasePath `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -WindowStyle Hidden -PassThru
} finally {
    foreach ($name in $settings.Keys) {
        [Environment]::SetEnvironmentVariable($name, $original[$name], "Process")
    }
}

# Poll briefly until the service reports the expected environment/version.
$healthy = $false

for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $service.Refresh()
    if ($service.HasExited) { break }

    try {
        $health = Invoke-RestMethod `
            -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2

        if ($health.status -eq "ok" -and
            $health.environment -eq $Environment -and
            $health.version -eq $manifest.version) {
            $healthy = $true
            break
        }
    } catch {
        # Connection errors are expected while the service starts.
    }

    Start-Sleep -Milliseconds 500
}

if (-not $healthy) {
    $service.Refresh()
    if (-not $service.HasExited) {
        Stop-Process -Id $service.Id -Force
    }

    if (Test-Path $stderr) { Get-Content $stderr }
    throw "Deployment health verification failed."
}

# Record release identity for subsequent deployments and incident checks.
$state = @{
    environment = $Environment
    version = $manifest.version
    checksum = $actualHash.ToLowerInvariant()
    processId = $service.Id
    releasePath = $releasePath
    deployedAt = (Get-Date).ToUniversalTime().ToString("o")
}

$state | ConvertTo-Json | Set-Content -Encoding utf8 $statePath

Write-Host "DEPLOYMENT SUCCESS"
Write-Host "Environment: $Environment"
Write-Host "Version: $($manifest.version)"
Write-Host "URL: http://127.0.0.1:$port"
Write-Host "Process ID: $($service.Id)"
