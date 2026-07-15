# Memory Lane installer for Windows
# Usage: irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "ribbons-digital/memory-lane"
$Version = if ($env:VERSION) { $env:VERSION } else { "latest" }

function Say($message) {
    Write-Host "memory-lane installer: $message"
}

function Err($message) {
    Write-Error "memory-lane installer error: $message"
    exit 1
}

function Start-Deferred-Removal($path, $processId) {
    if ("$processId" -notmatch "^\d+$") {
        Err "invalid upgrade process id"
    }
    $escapedPath = $path.Replace("'", "''")
    $command = "Wait-Process -Id $processId -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '$escapedPath' -Force -ErrorAction SilentlyContinue"
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", $encodedCommand) `
        -WindowStyle Hidden | Out-Null
}

function Restore-Backup {
    if ($script:backupRestored) {
        return
    }
    if ($script:backupPath -and (Test-Path $script:backupPath)) {
        if ($script:installPath -and (Test-Path $script:installPath)) {
            Remove-Item $script:installPath -Force
        }
        Move-Item $script:backupPath $script:installPath -Force
        Say "restored previous binary"
    } elseif ($script:installPath -and (Test-Path $script:installPath)) {
        Remove-Item $script:installPath -Force
    }
    $script:backupRestored = $true
}

function Backup-Existing-Binary {
    $script:backupPath = $null
    $script:backupWasRenamed = $false
    $script:backupRestored = $false
    if (Test-Path $script:installPath) {
        $script:backupPath = "$script:installPath.backup.$PID"
        if ($env:MEMORY_LANE_UPGRADE_PID) {
            Move-Item $script:installPath $script:backupPath -Force
            $script:backupWasRenamed = $true
        } else {
            Copy-Item $script:installPath $script:backupPath -Force
        }
    }
}

function Verify-Installed-Binary {
    & $script:installPath --smoke-test *> $null
    if ($LASTEXITCODE -ne 0) {
        Restore-Backup
        Err "installed binary failed smoke test; previous installation was restored"
    }
    if ($script:backupPath -and (Test-Path $script:backupPath)) {
        if ($script:backupWasRenamed) {
            try {
                Start-Deferred-Removal $script:backupPath $env:MEMORY_LANE_UPGRADE_PID
                Say "scheduled previous binary cleanup"
            } catch {
                Restore-Backup
                Err "could not schedule previous binary cleanup; previous installation was restored"
            }
        } else {
            Remove-Item $script:backupPath -Force
        }
    }
}

$arch = if ([System.Environment]::Is64BitOperatingSystem) { "x64" } else { Err "x64 Windows required" }
$suffix = "windows-$arch"
$asset = "memory-lane-$suffix.zip"

if ($env:MEMORY_LANE_INSTALL_BINARY) {
    Say "using local binary from MEMORY_LANE_INSTALL_BINARY"
    $binaryPath = $env:MEMORY_LANE_INSTALL_BINARY
    $installDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:USERPROFILE\bin" }
    $script:installPath = "$installDir\memory-lane.exe"
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    Backup-Existing-Binary
    try {
        Copy-Item $binaryPath $script:installPath -Force
        Verify-Installed-Binary
    } catch {
        Restore-Backup
        throw
    }
} else {
    if ($Version -eq "latest") {
        $url = "https://github.com/$Repo/releases/latest/download/$asset"
        $checksumUrl = "https://github.com/$Repo/releases/latest/download/SHA256SUMS"
    } else {
        $url = "https://github.com/$Repo/releases/download/$Version/$asset"
        $checksumUrl = "https://github.com/$Repo/releases/download/$Version/SHA256SUMS"
    }

    $tmp = New-TemporaryFile | ForEach-Object { $_.DirectoryName }
    $archivePath = "$tmp\$asset"

    Say "downloading $asset"
    Invoke-WebRequest -Uri $url -OutFile $archivePath

    Say "verifying checksum"
    Invoke-WebRequest -Uri $checksumUrl -OutFile "$tmp\SHA256SUMS"
    $expected = (Get-Content "$tmp\SHA256SUMS" | Where-Object { $_ -match "$asset$" }).Split("  ")[0]
    $actual = (Get-FileHash $archivePath -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) {
        Err "checksum verification failed"
    }

    Say "extracting"
    Expand-Archive -Path $archivePath -DestinationPath $tmp -Force

    $installDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:USERPROFILE\bin" }
    $script:installPath = "$installDir\memory-lane.exe"
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    Backup-Existing-Binary
    try {
        Move-Item "$tmp\memory-lane-$suffix.exe" $script:installPath -Force
        Verify-Installed-Binary
    } catch {
        Restore-Backup
        throw
    }
}

$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$installDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$installDir;$currentPath", "User")
    Say "added $installDir to user PATH"
}

$dataDir = "$env:USERPROFILE\.memory-lane"
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

Write-Host ""
Write-Host "memory-lane successfully installed!"
Write-Host "  Location: $script:installPath"
Write-Host ""
Write-Host "Next: Run 'memory-lane init' to get started."
Write-Host "      Or 'memory-lane init --yes' to auto-configure detected harnesses."
