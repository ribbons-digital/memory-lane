# Memory Lane installer for Windows
# Usage: irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 | iex

param(
    [ValidateSet("Commit", "Rollback", "Recover")]
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

function Read-Upgrade-Transaction {
    if ($script:transaction) {
        return $script:transaction
    }
    if (-not $script:transactionPath -or -not (Test-Path -LiteralPath $script:transactionPath)) {
        return $null
    }
    $transaction = (Get-Content -LiteralPath $script:transactionPath -Raw) | ConvertFrom-Json
    $validStates = @("pending", "committed", "restored")
    $validBackupStates = @("not-backed-up", "backed-up", "no-backup", "restored")
    $validManifestStates = @("existing", "missing", "restored")
    if ($validStates -notcontains $transaction.State `
        -or $validBackupStates -notcontains $transaction.BackupState `
        -or $validManifestStates -notcontains $transaction.ManifestState `
        -or $null -eq $transaction.ManifestPath `
        -or $null -eq $transaction.ManifestBackupPath `
        -or $null -eq $transaction.LockPath `
        -or "$($transaction.InstallerPid)" -notmatch "^\d+$") {
        throw "invalid upgrade transaction state"
    }
    $script:transaction = $transaction
    return $script:transaction
}

function Save-Upgrade-Transaction {
    $temporaryPath = "$script:transactionPath.tmp.$PID"
    try {
        $json = $script:transaction | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $script:transactionPath) {
            [IO.File]::Replace($temporaryPath, $script:transactionPath, $null)
        } else {
            [IO.File]::Move($temporaryPath, $script:transactionPath)
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Remove-Transaction-Artifact($path) {
    if ($path -and (Test-Path -LiteralPath $path)) {
        Remove-Item -LiteralPath $path -Force
    }
}

function Cleanup-Upgrade-Transaction {
    $transaction = Read-Upgrade-Transaction
    if ($transaction) {
        Remove-Transaction-Artifact $script:backupPath
        Remove-Transaction-Artifact $transaction.ManifestBackupPath
        if ($transaction.LockPath -and (Test-Path -LiteralPath $transaction.LockPath)) {
            Remove-Item -LiteralPath $transaction.LockPath -Recurse -Force
        }
    }
    Remove-Transaction-Artifact $script:transactionPath
}

function Restore-Backup {
    if ($script:backupRestored) {
        return
    }
    $transaction = Read-Upgrade-Transaction
    if (-not $transaction) {
        if ($script:backupPath -and (Test-Path -LiteralPath $script:backupPath)) {
            if ($script:installPath -and (Test-Path -LiteralPath $script:installPath)) {
                Remove-Item -LiteralPath $script:installPath -Force
            }
            Move-Item -LiteralPath $script:backupPath -Destination $script:installPath -Force
            $script:backupRestored = $true
            Say "restored previous binary"
        }
        return
    }
    if ($transaction.State -eq "restored") {
        $script:backupRestored = $true
        try { Cleanup-Upgrade-Transaction } catch {}
        return
    }

    if ($transaction.BackupState -eq "not-backed-up") {
        if (Test-Path -LiteralPath $script:backupPath) {
            $transaction.BackupState = "backed-up"
            Save-Upgrade-Transaction
        } else {
            $transaction.BackupState = "restored"
            Save-Upgrade-Transaction
        }
    }

    if ($transaction.BackupState -eq "backed-up") {
        if (-not (Test-Path -LiteralPath $script:backupPath)) {
            throw "previous binary backup is missing"
        }
        if (Test-Path -LiteralPath $script:installPath) {
            Remove-Item -LiteralPath $script:installPath -Force
        }
        Move-Item -LiteralPath $script:backupPath -Destination $script:installPath -Force
        $transaction.BackupState = "restored"
        Save-Upgrade-Transaction
        Say "restored previous binary"
    } elseif ($transaction.BackupState -eq "no-backup") {
        if (Test-Path -LiteralPath $script:installPath) {
            Remove-Item -LiteralPath $script:installPath -Force
        }
        $transaction.BackupState = "restored"
        Save-Upgrade-Transaction
    }

    if ($transaction.ManifestState -eq "existing") {
        if (-not (Test-Path -LiteralPath $transaction.ManifestBackupPath)) {
            throw "install manifest backup is missing"
        }
        Copy-Item -LiteralPath $transaction.ManifestBackupPath -Destination $transaction.ManifestPath -Force
        $transaction.ManifestState = "restored"
        Save-Upgrade-Transaction
    } elseif ($transaction.ManifestState -eq "missing") {
        Remove-Transaction-Artifact $transaction.ManifestPath
        $transaction.ManifestState = "restored"
        Save-Upgrade-Transaction
    }

    $transaction.State = "restored"
    Save-Upgrade-Transaction
    $script:backupRestored = $true
    try { Cleanup-Upgrade-Transaction } catch {}
}

function Start-Upgrade-Recovery {
    $escapedScriptPath = $PSCommandPath.Replace("'", "''")
    $command = "& '$escapedScriptPath' -UpgradeAction Recover"
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", $encodedCommand) `
        -WindowStyle Hidden | Out-Null
}

function Backup-Existing-Binary {
    $script:backupPath = $null
    $script:backupWasRenamed = $false
    $script:backupRestored = $false
    $script:transactionPath = $null
    $script:transaction = $null
    if ($env:MEMORY_LANE_UPGRADE_PID) {
        $script:backupPath = Get-Upgrade-Backup-Path
        $script:transactionPath = Get-Upgrade-Transaction-Path
        $existingBinary = Test-Path -LiteralPath $script:installPath
        $script:transaction = [PSCustomObject]@{
            State = "pending"
            BackupState = if ($existingBinary) { "not-backed-up" } else { "no-backup" }
            ManifestState = if ($env:MEMORY_LANE_UPGRADE_MANIFEST_EXISTED -eq "true") { "existing" } else { "missing" }
            ManifestPath = "$env:MEMORY_LANE_UPGRADE_MANIFEST_PATH"
            ManifestBackupPath = "$env:MEMORY_LANE_UPGRADE_MANIFEST_BACKUP_PATH"
            LockPath = "$env:MEMORY_LANE_UPGRADE_LOCK_PATH"
            InstallerPid = $PID
        }
        Save-Upgrade-Transaction
        Start-Upgrade-Recovery
        if ($existingBinary) {
            Move-Item -LiteralPath $script:installPath -Destination $script:backupPath -Force
            $script:backupWasRenamed = $true
            $script:transaction.BackupState = "backed-up"
            Save-Upgrade-Transaction
        }
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
    $script:transaction = $null
    if ($UpgradeAction -eq "Recover") {
        $pendingTransaction = Read-Upgrade-Transaction
        Wait-Process -Id $env:MEMORY_LANE_UPGRADE_PID -ErrorAction SilentlyContinue
        if ($pendingTransaction) {
            Wait-Process -Id $pendingTransaction.InstallerPid -ErrorAction SilentlyContinue
        }
        $script:transaction = $null
    }
    if (-not (Test-Path -LiteralPath $script:transactionPath) `
        -and -not (Test-Path -LiteralPath $script:backupPath)) {
        exit 0
    }
    $transaction = Read-Upgrade-Transaction
    if ($UpgradeAction -eq "Commit") {
        if (-not $transaction) {
            Err "upgrade transaction is missing"
        }
        $transaction.State = "committed"
        Save-Upgrade-Transaction
        Say "committed Windows upgrade"
        exit 0
    }
    if ($UpgradeAction -eq "Recover" -and $transaction -and $transaction.State -eq "committed") {
        Cleanup-Upgrade-Transaction
        exit 0
    }
    Restore-Backup
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
