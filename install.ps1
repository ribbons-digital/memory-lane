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

function Get-Sha256-Hash($path) {
    $stream = [IO.File]::OpenRead($path)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
        } finally {
            $sha256.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Get-Process-Start-Time-Ticks($processId) {
    $process = Get-Process -Id $processId -ErrorAction Stop
    return "$($process.StartTime.ToUniversalTime().Ticks)"
}


function Test-Same-Filesystem-Path($left, $right) {
    if ([string]::IsNullOrWhiteSpace("$left") -or [string]::IsNullOrWhiteSpace("$right")) {
        return $false
    }
    try {
        $leftPath = [IO.Path]::GetFullPath("$left")
        $rightPath = [IO.Path]::GetFullPath("$right")
        return [string]::Equals($leftPath, $rightPath, [StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
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
    $validBackupStates = @("not-backed-up", "backed-up", "no-backup", "restored", "no-original-restored")
    $noOriginalBackupStates = @("no-backup", "no-original-restored")
    $restoredBackupStates = @("restored", "no-original-restored")
    $validManifestStates = @("existing", "missing", "restored")
    $expectedManifestState = if ($env:MEMORY_LANE_UPGRADE_MANIFEST_EXISTED -eq "true") {
        "existing"
    } elseif ($env:MEMORY_LANE_UPGRADE_MANIFEST_EXISTED -eq "false") {
        "missing"
    } else {
        $null
    }
    $ownerValid = $false
    try {
        $ownerPath = Join-Path "$env:MEMORY_LANE_UPGRADE_LOCK_PATH" "owner"
        $owner = (Get-Content -LiteralPath $ownerPath -Raw) | ConvertFrom-Json
        $ownerPropertyNames = @($owner.PSObject.Properties.Name)
        $commonOwnerValid = "$($owner.Token)" -ne "" `
            -and "$($owner.Pid)" -match "^\d+$" `
            -and "$($owner.ProcessStartedAt)" -match "^\d+$" `
            -and "$($owner.CreatedAt)" -match "^\d+$"
        $currentOwnerShape = $null -eq $owner.ParentPid `
            -and $null -eq $owner.ParentProcessStartedAt `
            -and $ownerPropertyNames.Count -eq 4 `
            -and $ownerPropertyNames -contains "token" `
            -and $ownerPropertyNames -contains "pid" `
            -and $ownerPropertyNames -contains "processStartedAt" `
            -and $ownerPropertyNames -contains "createdAt"
        $legacyInstallerValid = ($null -eq $owner.InstallerPid -and $null -eq $owner.InstallerProcessStartedAt) `
            -or ("$($owner.InstallerPid)" -match "^\d+$" -and "$($owner.InstallerProcessStartedAt)" -match "^\d+$")
        $legacyRecoveryValid = "$($owner.Phase)" -ne "recovery" `
            -or ("$($owner.RecoveryPid)" -match "^\d+$" -and "$($owner.RecoveryProcessStartedAt)" -match "^\d+$")
        $legacyOwnerShape = "$($owner.ParentPid)" -match "^\d+$" `
            -and "$($owner.ParentProcessStartedAt)" -match "^\d+$" `
            -and "$($owner.HeartbeatAt)" -match "^\d+$" `
            -and (@("starting", "recovery") -contains "$($owner.Phase)") `
            -and $legacyInstallerValid `
            -and $legacyRecoveryValid
        $ownerParentPid = if ($currentOwnerShape) { "$($owner.Pid)" } else { "$($owner.ParentPid)" }
        $ownerParentStartedAt = if ($currentOwnerShape) { "$($owner.ProcessStartedAt)" } else { "$($owner.ParentProcessStartedAt)" }
        $ownerValid = $commonOwnerValid `
            -and ($currentOwnerShape -or $legacyOwnerShape) `
            -and "$($owner.Token)" -eq "$env:MEMORY_LANE_UPGRADE_LOCK_OWNER" `
            -and $ownerParentPid -eq "$($transaction.ParentPid)" `
            -and $ownerParentStartedAt -eq "$($transaction.ParentStartedAt)"
    } catch {
        $ownerValid = $false
    }
    $installerStartedAt = Get-Process-Start-Time-Ticks $PID
    $manifestPathsValid = [IO.Path]::IsPathRooted("$($transaction.ManifestPath)") `
        -and (Test-Same-Filesystem-Path $transaction.ManifestBackupPath "$($transaction.ManifestPath).upgrade.$($transaction.ParentPid)")
    $terminalRestoreValid = $transaction.State -ne "restored" `
        -or ($restoredBackupStates -contains $transaction.BackupState -and $transaction.ManifestState -eq "restored")
    $environmentValid = "$env:MEMORY_LANE_UPGRADE_PID" -match "^\d+$" `
        -and "$($transaction.ParentPid)" -eq "$env:MEMORY_LANE_UPGRADE_PID" `
        -and "$($transaction.InstallerPid)" -eq "$PID" `
        -and "$($transaction.InstallerStartedAt)" -eq "$installerStartedAt" `
        -and (Test-Same-Filesystem-Path $transaction.ManifestPath $env:MEMORY_LANE_UPGRADE_MANIFEST_PATH) `
        -and (Test-Same-Filesystem-Path $transaction.ManifestBackupPath $env:MEMORY_LANE_UPGRADE_MANIFEST_BACKUP_PATH) `
        -and (Test-Same-Filesystem-Path $transaction.LockPath $env:MEMORY_LANE_UPGRADE_LOCK_PATH) `
        -and "$($transaction.LockOwner)" -eq "$env:MEMORY_LANE_UPGRADE_LOCK_OWNER" `
        -and $expectedManifestState `
        -and ($transaction.ManifestState -eq "restored" -or $transaction.ManifestState -eq $expectedManifestState) `
        -and (Test-Same-Filesystem-Path $script:transactionPath "$script:installPath.upgrade.$($transaction.ParentPid)") `
        -and (Test-Same-Filesystem-Path $script:backupPath "$script:installPath.backup.$($transaction.ParentPid)") `
        -and $ownerValid
    if ($validStates -notcontains $transaction.State `
        -or $validBackupStates -notcontains $transaction.BackupState `
        -or $validManifestStates -notcontains $transaction.ManifestState `
        -or -not $manifestPathsValid `
        -or [string]::IsNullOrWhiteSpace("$($transaction.LockPath)") `
        -or [string]::IsNullOrWhiteSpace("$($transaction.LockOwner)") `
        -or "$($transaction.ParentPid)" -notmatch "^\d+$" `
        -or "$($transaction.ParentStartedAt)" -notmatch "^\d+$" `
        -or "$($transaction.InstallerPid)" -notmatch "^\d+$" `
        -or "$($transaction.InstallerStartedAt)" -notmatch "^\d+$" `
        -or ($noOriginalBackupStates -contains $transaction.BackupState -and -not [string]::IsNullOrWhiteSpace("$($transaction.OriginalBinaryHash)")) `
        -or ($noOriginalBackupStates -notcontains $transaction.BackupState -and "$($transaction.OriginalBinaryHash)" -notmatch "^[a-fA-F0-9]{64}$") `
        -or -not $terminalRestoreValid `
        -or -not $environmentValid) {
        throw "invalid upgrade transaction state"
    }
    $script:transaction = $transaction
    return $script:transaction
}

function Wait-For-Upgrade-Transaction($timeoutMilliseconds = 10000) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMilliseconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        $transaction = Read-Upgrade-Transaction
        if ($transaction) {
            return $transaction
        }
        Start-Sleep -Milliseconds 100
    }
    throw "parent did not publish the Windows upgrade transaction within 10 seconds"
}

function Save-Upgrade-Transaction {
    $temporaryPath = "$script:transactionPath.tmp.$PID"
    try {
        $json = $script:transaction | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $script:transactionPath) {
            [IO.File]::Replace($temporaryPath, $script:transactionPath, [Management.Automation.Language.NullString]::Value)
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
            $ownerPath = Join-Path $transaction.LockPath "owner"
            if (Test-Path -LiteralPath $ownerPath) {
                try {
                    $lockOwner = (Get-Content -LiteralPath $ownerPath -Raw) | ConvertFrom-Json
                    if ($lockOwner.Token -eq $transaction.LockOwner) {
                        Remove-Item -LiteralPath $transaction.LockPath -Recurse -Force
                    }
                } catch {}
            }
        }
    }
    Remove-Transaction-Artifact $script:transactionPath
}

function Test-Restored-Executable($transaction) {
    if ($transaction.BackupState -eq "restored") {
        return (Test-Path -LiteralPath $script:installPath) `
            -and (Get-Sha256-Hash $script:installPath) -eq $transaction.OriginalBinaryHash
    }
    if ($transaction.BackupState -eq "no-original-restored") {
        return -not (Test-Path -LiteralPath $script:installPath)
    }
    return $false
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
        if (-not (Test-Restored-Executable $transaction)) {
            throw "restored executable does not match the upgrade transaction"
        }
        $script:backupRestored = $true
        try { Cleanup-Upgrade-Transaction } catch {}
        return
    }

    if ($transaction.BackupState -eq "not-backed-up") {
        if (Test-Path -LiteralPath $script:backupPath) {
            $transaction.BackupState = "backed-up"
            Save-Upgrade-Transaction
        } elseif ((Test-Path -LiteralPath $script:installPath) `
            -and (Get-Sha256-Hash $script:installPath) -eq $transaction.OriginalBinaryHash) {
            $transaction.BackupState = "restored"
            Save-Upgrade-Transaction
        } else {
            throw "previous binary backup is missing"
        }
    }

    if ($transaction.BackupState -eq "backed-up") {
        if (-not (Test-Path -LiteralPath $script:backupPath)) {
            if (-not (Test-Path -LiteralPath $script:installPath) `
                -or (Get-Sha256-Hash $script:installPath) -ne $transaction.OriginalBinaryHash) {
                throw "previous binary backup is missing"
            }
            $transaction.BackupState = "restored"
            Save-Upgrade-Transaction
        } else {
            if ((Get-Sha256-Hash $script:backupPath) -ne $transaction.OriginalBinaryHash) {
                throw "previous binary backup does not match the upgrade transaction"
            }
            if (Test-Path -LiteralPath $script:installPath) {
                Remove-Item -LiteralPath $script:installPath -Force
            }
            Move-Item -LiteralPath $script:backupPath -Destination $script:installPath -Force
            $transaction.BackupState = "restored"
            Save-Upgrade-Transaction
            Say "restored previous binary"
        }
    } elseif ($transaction.BackupState -eq "no-backup") {
        if (Test-Path -LiteralPath $script:installPath) {
            Remove-Item -LiteralPath $script:installPath -Force
        }
        $transaction.BackupState = "no-original-restored"
        Save-Upgrade-Transaction
    }

    if (-not (Test-Restored-Executable $transaction)) {
        throw "restored executable does not match the upgrade transaction"
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

function Backup-Existing-Binary {
    $script:backupWasRenamed = $false
    $script:backupRestored = $false
    if ($env:MEMORY_LANE_UPGRADE_PID) {
        $transaction = Read-Upgrade-Transaction
        if (-not $transaction -or $transaction.State -ne "pending") {
            throw "Windows upgrade transaction is not pending"
        }
        if ($transaction.BackupState -eq "not-backed-up") {
            if (-not (Test-Path -LiteralPath $script:installPath)) {
                throw "previous binary is missing before backup"
            }
            Move-Item -LiteralPath $script:installPath -Destination $script:backupPath -Force
            $script:backupWasRenamed = $true
            $script:transaction.BackupState = "backed-up"
            Save-Upgrade-Transaction
        } elseif ($transaction.BackupState -ne "no-backup") {
            throw "invalid Windows upgrade backup checkpoint"
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


$installDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:USERPROFILE\bin" }
$script:installPath = "$installDir\memory-lane.exe"
$script:backupPath = $null
$script:transactionPath = $null
$script:transaction = $null
$script:backupRestored = $false
if ($env:MEMORY_LANE_UPGRADE_PID) {
    $script:backupPath = Get-Upgrade-Backup-Path
    $script:transactionPath = Get-Upgrade-Transaction-Path
    Wait-For-Upgrade-Transaction | Out-Null
}
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

$arch = if ([System.Environment]::Is64BitOperatingSystem) { "x64" } else { Err "x64 Windows required" }
$suffix = "windows-$arch"
$asset = "memory-lane-$suffix.zip"

if ($env:MEMORY_LANE_INSTALL_BINARY) {
    Say "using local binary from MEMORY_LANE_INSTALL_BINARY"
    $binaryPath = $env:MEMORY_LANE_INSTALL_BINARY
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
    $actual = (Get-Sha256-Hash $archivePath).ToLower()
    if ($expected -ne $actual) {
        Err "checksum verification failed"
    }

    Say "extracting"
    Expand-Archive -Path $archivePath -DestinationPath $tmp -Force

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
