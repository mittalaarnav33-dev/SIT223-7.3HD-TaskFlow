pipeline {
    // Run on this Windows Jenkins machine, where the deployment tools live.
    agent any

    options {
        // Queue builds so they cannot deploy to the same ports simultaneously.
        disableConcurrentBuilds()

        // Stop a stalled pipeline and retain a manageable build history.
        timeout(time: 20, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '15', artifactNumToKeepStr: '10'))
    }

    triggers {
        // Check the configured Git repository every minute for changes.
        pollSCM('H/1 * * * *')
    }

    stages {
        stage('Build') {
            steps {
                // Start a fresh evidence folder for this build.
                bat '''
                    @echo off
                    if exist reports rmdir /s /q reports
                    mkdir reports
                '''

                // Install exactly the dependency versions in package-lock.json.
                bat 'call npm.cmd ci --ignore-scripts'

                // Package the application once, with build identity and SHA-256.
                bat 'call npm.cmd run build'
            }
        }

        stage('Test') {
            steps {
                // Run isolated API tests and enforce coverage thresholds.
                // Preserve npm's exit code when displaying the saved report.
                bat '''
                    @echo off
                    call npm.cmd run test:coverage > reports\\tests.txt 2>&1
                    set "TEST_EXIT=%ERRORLEVEL%"
                    type reports\\tests.txt
                    exit /b %TEST_EXIT%
                '''
            }
        }

        stage('Code Quality') {
            steps {
                // Enforce ESLint rules, including complexity and zero warnings.
                // Save a machine-readable report for review.
                bat 'call npm.cmd run lint -- --format json --output-file reports/eslint.json'

                // Also verify the standalone notification receiver's syntax.
                bat 'node --check monitoring/receiver.js'
            }
        }

        stage('Security') {
            steps {
                // Scan direct and transitive dependencies for known vulnerabilities.
                // Fail on high or critical findings, or an unsuccessful audit.
                bat '''
                    @echo off
                    call npm.cmd audit --audit-level=high --json > reports\\security-audit.json
                    set "AUDIT_EXIT=%ERRORLEVEL%"
                    type reports\\security-audit.json
                    exit /b %AUDIT_EXIT%
                '''
            }
        }

        stage('Deploy') {
            steps {
                // Verify the archive checksum and deploy to staging on port 3001.
                bat 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -Environment staging'

                // Exercise the deployed API, persistence operations, UI and metrics.
                bat 'node scripts/smoke.js staging'
            }
        }

        stage('Release') {
            steps {
                // Verify staging and promote the identical archive to production.
                // The release script also tests production on port 3002.
                bat 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1'
            }
        }

        stage('Monitoring') {
            steps {
                // Verify production identity, live metrics, loaded alert rules,
                // Alertmanager readiness and the notification receiver.
                // Prometheus continues monitoring after this pipeline finishes.
                bat 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/monitor.ps1'
            }
        }
    }

    post {
        always {
            // Preserve available evidence even when a stage fails.
            archiveArtifacts(
                artifacts: 'dist/taskflow.zip,dist/taskflow.zip.sha256,dist/bundle/build-info.json,reports/**,coverage/**',
                allowEmptyArchive: true,
                fingerprint: true
            )
        }

        success {
            echo 'All seven stages passed. TaskFlow production: http://127.0.0.1:3002'
        }

        failure {
            echo 'Pipeline failed. Review the failed stage, console output and archived reports.'
        }
    }
}