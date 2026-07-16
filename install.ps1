# Memory Lane installer for Windows
# Usage: irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 | iex

param(
    [ValidateSet("Commit", "Rollback")]
    [string]$UpgradeAction
)

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

function Get-Upgrade-Backup-Path {
    if ("$env:MEMORY_LANE_UPGRADE_PID" -notmatch "^\d+$") {
        Err "invalid upgrade process id"
    }
    return "$script:installPath.backup.$env:MEMORY_LANE_UPGRADE_PID"
}

function Get-Upgrade-Transaction-Path {
    if ("$env:MEMORY_LANE_UPGRADE_PID" -notmatch "^\d+$") {
        Err "invalid upgrade process id"
    }
    return "$script:installPath.upgrade.$env:MEMORY_LANE_UPGRADE_PID"
}

function Restore-Backup {
    if ($script:backupRestored) {
        return
    }
    if ($script:transactionPath `
        -and -not (Test-Path -LiteralPath $script:transactionPath) `
        -and -not ($script:backupPath -and (Test-Path -LiteralPath $script:backupPath))) {
        return
    }
    if ($script:backupPath -and (Test-Path -LiteralPath $script:backupPath)) {
        if ($script:installPath -and (Test-Path -LiteralPath $script:installPath)) {
            Remove-Item -LiteralPath $script:installPath -Force
        }
        Move-Item -LiteralPath $script:backupPath -Destination $script:installPath -Force
        $script:backupRestored = $true
        Say "restored previous binary"
    } elseif ($script:installPath -and (Test-Path -LiteralPath $script:installPath)) {
        Remove-Item -LiteralPath $script:installPath -Force
        $script:backupRestored = $true
    } else {
        $script:backupRestored = $true
    }
    if ($script:transactionPath -and (Test-Path -LiteralPath $script:transactionPath)) {
        try {
            Remove-Item -LiteralPath $script:transactionPath -Force
        } catch {}
    }
}

function Backup-Existing-Binary {
    $script:backupPath = $null
    $script:backupWasRenamed = $false
    $script:backupRestored = $false
    $script:transactionPath = $null
    if ($env:MEMORY_LANE_UPGRADE_PID) {
        $script:backupPath = Get-Upgrade-Backup-Path
        $script:transactionPath = Get-Upgrade-Transaction-Path
        if (Test-Path -LiteralPath $script:installPath) {
            Move-Item -LiteralPath $script:installPath -Destination $script:backupPath -Force
            $script:backupWasRenamed = $true
        }
        Set-Content -LiteralPath $script:transactionPath -Value "pending" -NoNewline
    } elseif (Test-Path -LiteralPath $script:installPath) {
        $script:backupPath = "$script:installPath.backup.$PID"
        Copy-Item -LiteralPath $script:installPath -Destination $script:backupPath -Force
    }
}

function Verify-Installed-Binary {
    & $script:installPath --smoke-test *> $null
    if ($LASTEXITCODE -ne 0) {
        Restore-Backup
        Err "installed binary failed smoke test; previous installation was restored"
    }
    if (-not $script:backupWasRenamed -and $script:backupPath -and (Test-Path -LiteralPath $script:backupPath)) {
        Remove-Item -LiteralPath $script:backupPath -Force
    }
}

if ($UpgradeAction) {
    $installDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:USERPROFILE\bin" }
    $script:installPath = "$installDir\memory-lane.exe"
    $script:backupPath = Get-Upgrade-Backup-Path
    $script:transactionPath = Get-Upgrade-Transaction-Path
    $script:backupRestored = $false
    if (-not (Test-Path -LiteralPath $script:transactionPath) `
        -and -not (Test-Path -LiteralPath $script:backupPath)) {
        exit 0
    }
    if ($UpgradeAction -eq "Rollback") {
        Restore-Backup
        exit 0
    }
    if (Test-Path -LiteralPath $script:backupPath) {
        try {
            Start-Deferred-Removal $script:backupPath $env:MEMORY_LANE_UPGRADE_PID
            Say "scheduled previous binary cleanup"
        } catch {
            Restore-Backup
            Err "could not schedule previous binary cleanup; previous installation was restored"
        }
    }
    Remove-Item -LiteralPath $script:transactionPath -Force
    exit 0
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
    try {
        Backup-Existing-Binary
        Copy-Item -LiteralPath $binaryPath -Destination $script:installPath -Force
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
    try {
        Backup-Existing-Binary
        Move-Item -LiteralPath "$tmp\memory-lane-$suffix.exe" -Destination $script:installPath -Force
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
