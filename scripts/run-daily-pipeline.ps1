# Altodd daily pipeline: scrape -> LLM analyze -> ingest/aggregate.
# Registered as a Windows Scheduled Task to run at 06:00 daily.
# The dashboard/API don't need restarting afterward - they read Postgres live.

$ErrorActionPreference = 'Stop'

$root = "C:\Users\abhis\Documents\Vektor" # physical folder not yet renamed — see README
$actorId = "WoIkcryaPU8xUSqP0"
$actorInput = "storage\key_value_stores\default\INPUT.json"
$ollamaExe = "C:\Users\abhis\AppData\Local\Programs\Ollama\ollama.exe"

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("pipeline-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmmss"))

function Log($message) {
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
    Write-Output $line
    # Retry on transient sharing violations (AV/backup software briefly
    # locking the file) - losing one log line beats crashing the pipeline.
    for ($i = 0; $i -lt 3; $i++) {
        try {
            Add-Content -Path $logFile -Value $line -ErrorAction Stop
            break
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
}

# Runs a native command, logging every stdout+stderr line, WITHOUT letting
# incidental stderr output (progress text, warnings) abort the script the
# way $ErrorActionPreference='Stop' + 2>&1 does for native exes in PS 5.1.
# Real failure is judged only by $LASTEXITCODE, which is what actually
# reflects whether the external tool succeeded.
function Invoke-Logged($scriptBlock) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $scriptBlock 2>&1 | ForEach-Object { Log $_ } | Out-Null
    $ErrorActionPreference = $previous
    return $LASTEXITCODE
}

function Ensure-Ollama {
    try {
        Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 5 | Out-Null
        Log "Ollama already running."
        return
    } catch {
        Log "Ollama not responding, starting it..."
    }

    Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        try {
            Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 5 | Out-Null
            Log "Ollama is now responding."
            return
        } catch {}
    }
    throw "Ollama did not become ready within 30 seconds."
}

try {
    Log "=== Altodd daily pipeline starting ==="

    Log "Step 1/3: Running LinkedIn scraper Actor on Apify..."
    Set-Location (Join-Path $root "linkedin-jobs-scraper")
    $exitCode = Invoke-Logged { apify call $actorId --input-file=$actorInput }
    if ($exitCode -ne 0) {
        throw "Apify actor run failed (exit code $exitCode). Aborting - no fresh data to process."
    }
    Log "Scraper run complete."

    Log "Step 2/3: Analyzing jobs with local LLM (Ollama)..."
    Ensure-Ollama
    Set-Location (Join-Path $root "llm-pipeline")
    $exitCode = Invoke-Logged { npm start }
    if ($exitCode -ne 0) {
        Log "WARNING: llm-pipeline exited with code $exitCode (some jobs may have failed - continuing anyway, ingest is safe to run on partial output)."
    }

    Log "Step 3/3: Ingesting + aggregating into market-intelligence..."
    Set-Location (Join-Path $root "market-intelligence")
    $exitCode = Invoke-Logged { npm run daily }
    if ($exitCode -ne 0) {
        throw "market-intelligence daily pipeline failed (exit code $exitCode)."
    }

    Log "=== Altodd daily pipeline finished successfully ==="
} catch {
    Log "PIPELINE FAILED: $($_.Exception.Message)"
    exit 1
} finally {
    Set-Location $root
}
