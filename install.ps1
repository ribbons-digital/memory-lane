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

function Test-Upgrade-Process-Identity($processId, $startedAt) {
    if ("$processId" -notmatch "^\d+$" -or "$startedAt" -notmatch "^\d+$") {
        return "inactive"
    }
    try {
        $process = Get-Process -Id $processId -ErrorAction Stop
    } catch {
        if ("$($_.FullyQualifiedErrorId)" -like "NoProcessFoundForGivenId*") {
            return "inactive"
        }
        return "unknown"
    }
    try {
        if ("$($process.StartTime.ToUniversalTime().Ticks)" -eq "$startedAt") {
            return "active"
        }
        return "inactive"
    } catch {
        return "unknown"
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
    $validManifestStates = @("existing", "missing", "restored")
    if ($validStates -notcontains $transaction.State `
        -or $validBackupStates -notcontains $transaction.BackupState `
        -or $validManifestStates -notcontains $transaction.ManifestState `
        -or [string]::IsNullOrWhiteSpace("$($transaction.ManifestPath)") `
        -or [string]::IsNullOrWhiteSpace("$($transaction.ManifestBackupPath)") `
        -or [string]::IsNullOrWhiteSpace("$($transaction.LockPath)") `
        -or [string]::IsNullOrWhiteSpace("$($transaction.LockOwner)") `
        -or "$($transaction.ParentPid)" -notmatch "^\d+$" `
        -or "$($transaction.ParentStartedAt)" -notmatch "^\d+$" `
        -or "$($transaction.InstallerPid)" -notmatch "^\d+$" `
        -or "$($transaction.InstallerStartedAt)" -notmatch "^\d+$" `
        -or ($noOriginalBackupStates -contains $transaction.BackupState -and -not [string]::IsNullOrWhiteSpace("$($transaction.OriginalBinaryHash)")) `
        -or ($noOriginalBackupStates -notcontains $transaction.BackupState -and "$($transaction.OriginalBinaryHash)" -notmatch "^[a-fA-F0-9]{64}$")) {
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
        if (-not (Test-Path -LiteralPath $script:installPath)) {
            throw "new executable is missing before restoring the absent original"
        }
        Remove-Item -LiteralPath $script:installPath -Force
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

function Write-Upgrade-Lock-Owner($temporaryOwnerPath, $ownerPath, $json) {
    [IO.File]::WriteAllText($temporaryOwnerPath, $json, [Text.UTF8Encoding]::new($false))
    [IO.File]::Replace($temporaryOwnerPath, $ownerPath, [Management.Automation.Language.NullString]::Value)
}

function Acquire-Upgrade-Lock-Owner-Gate($lockPath, $ownerToken) {
    $ownerPath = Join-Path $lockPath "owner"
    $gatePath = Join-Path $lockPath ".reclaim"
    $startedAt = Get-Process-Start-Time-Ticks $PID
    $claim = [PSCustomObject]@{
        pid = $PID
        processStartedAt = $startedAt
        token = $ownerToken
        createdAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    }
    $claimJson = $claim | ConvertTo-Json -Compress
    $temporaryGatePath = Join-Path $lockPath ".reclaim.$ownerToken.$PID.tmp"
    while ($true) {
        try {
            $stream = [IO.File]::Open($temporaryGatePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $bytes = [Text.UTF8Encoding]::new($false).GetBytes($claimJson)
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Flush($true)
            } finally {
                $stream.Dispose()
            }
            [IO.File]::Move($temporaryGatePath, $gatePath)
            return $claim
        } catch {
            Remove-Item -LiteralPath $temporaryGatePath -Force -ErrorAction SilentlyContinue
            if (-not (Test-Path -LiteralPath $lockPath) -or -not (Test-Path -LiteralPath $ownerPath)) {
                return $null
            }
            try {
                $owner = ([IO.File]::ReadAllText($ownerPath)) | ConvertFrom-Json
                if ($owner.token -ne $ownerToken) {
                    return $null
                }
                $existingJson = [IO.File]::ReadAllText($gatePath)
                $existing = $existingJson | ConvertFrom-Json
                $identity = Test-Upgrade-Process-Identity $existing.pid $existing.processStartedAt
                if ($identity -eq "inactive" -and [IO.File]::ReadAllText($gatePath) -eq $existingJson) {
                    Remove-Item -LiteralPath $gatePath -Force -ErrorAction SilentlyContinue
                }
            } catch {}
            Start-Sleep -Milliseconds 100
        }
    }
}

function Release-Upgrade-Lock-Owner-Gate($lockPath, $claim) {
    if (-not $claim) {
        return
    }
    $gatePath = Join-Path $lockPath ".reclaim"
    try {
        $existing = ([IO.File]::ReadAllText($gatePath)) | ConvertFrom-Json
        if ($existing.token -eq $claim.token `
            -and "$($existing.pid)" -eq "$($claim.pid)" `
            -and "$($existing.processStartedAt)" -eq "$($claim.processStartedAt)" `
            -and "$($existing.createdAt)" -eq "$($claim.createdAt)") {
            Remove-Item -LiteralPath $gatePath -Force
        }
    } catch {}
}

function Register-Upgrade-Installer($lockPath, $ownerToken, $installerStartedAt) {
    $claim = Acquire-Upgrade-Lock-Owner-Gate $lockPath $ownerToken
    if (-not $claim) {
        return $false
    }
    try {
        $ownerPath = Join-Path $lockPath "owner"
        $temporaryOwnerPath = Join-Path $lockPath "owner.$PID.tmp"
        $owner = ([IO.File]::ReadAllText($ownerPath)) | ConvertFrom-Json
        if ($owner.token -ne $ownerToken) {
            return $false
        }
        $owner | Add-Member -NotePropertyName installerPid -NotePropertyValue $PID -Force
        $owner | Add-Member -NotePropertyName installerProcessStartedAt -NotePropertyValue "$installerStartedAt" -Force
        $owner.heartbeatAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        Write-Upgrade-Lock-Owner $temporaryOwnerPath $ownerPath ($owner | ConvertTo-Json -Compress)
        return $true
    } finally {
        Remove-Item -LiteralPath (Join-Path $lockPath "owner.$PID.tmp") -Force -ErrorAction SilentlyContinue
        Release-Upgrade-Lock-Owner-Gate $lockPath $claim
    }
}

function Update-Upgrade-Lock-Lease {
    $transaction = Read-Upgrade-Transaction
    if (-not $transaction) {
        return $false
    }
    if (-not $transaction.LockPath) {
        return $true
    }
    $ownerPath = Join-Path $transaction.LockPath "owner"
    $temporaryOwnerPath = Join-Path $transaction.LockPath "owner.$PID.tmp"
    $missingCount = 0
    $mismatchCount = 0
    while ($true) {
        $claim = $null
        try {
            if (-not (Test-Path -LiteralPath $transaction.LockPath) `
                -or -not (Test-Path -LiteralPath $ownerPath)) {
                $missingCount++
                $mismatchCount = 0
                if ($missingCount -ge 3) {
                    return $false
                }
                Start-Sleep -Milliseconds 100
                continue
            }
            $lockOwner = (Get-Content -LiteralPath $ownerPath -Raw) | ConvertFrom-Json
            $missingCount = 0
            if ($lockOwner.Token -ne $transaction.LockOwner) {
                $mismatchCount++
                if ($mismatchCount -ge 3) {
                    return $false
                }
                Start-Sleep -Milliseconds 100
                continue
            }
            $mismatchCount = 0
            $claim = Acquire-Upgrade-Lock-Owner-Gate $transaction.LockPath $transaction.LockOwner
            if (-not $claim) {
                continue
            }
            $lockOwner = (Get-Content -LiteralPath $ownerPath -Raw) | ConvertFrom-Json
            if ($lockOwner.Token -ne $transaction.LockOwner) {
                continue
            }
            $recoveryStartedAt = Get-Process-Start-Time-Ticks $PID
            $owner = [PSCustomObject]@{
                pid = $PID
                processStartedAt = $recoveryStartedAt
                token = $transaction.LockOwner
                createdAt = $lockOwner.createdAt
                heartbeatAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                phase = "recovery"
                parentPid = $transaction.ParentPid
                parentProcessStartedAt = $transaction.ParentStartedAt
                installerPid = $transaction.InstallerPid
                installerProcessStartedAt = $transaction.InstallerStartedAt
                recoveryPid = $PID
                recoveryProcessStartedAt = $recoveryStartedAt
            }
            $json = $owner | ConvertTo-Json -Compress
            Write-Upgrade-Lock-Owner $temporaryOwnerPath $ownerPath $json
            return $true
        } catch {
            Start-Sleep -Milliseconds 100
        } finally {
            Remove-Item -LiteralPath $temporaryOwnerPath -Force -ErrorAction SilentlyContinue
            Release-Upgrade-Lock-Owner-Gate $transaction.LockPath $claim
        }
    }
}

function Wait-For-Upgrade-Process($processId, $startedAt) {
    while ($true) {
        $identity = Test-Upgrade-Process-Identity $processId $startedAt
        if ($identity -eq "inactive") {
            return $true
        }
        if (-not (Update-Upgrade-Lock-Lease)) {
            return $false
        }
        Start-Sleep -Milliseconds 500
    }
}

function Acquire-Upgrade-Actor($action) {
    $transaction = Read-Upgrade-Transaction
    if (-not $transaction -or -not $transaction.LockPath) {
        return $null
    }
    $actorPath = Join-Path $transaction.LockPath "active-actor"
    $temporaryActorPath = Join-Path $transaction.LockPath "active-actor.$PID.tmp"
    $startedAt = Get-Process-Start-Time-Ticks $PID
    $actor = [PSCustomObject]@{
        pid = $PID
        processStartedAt = $startedAt
        token = $transaction.LockOwner
        action = $action
        lockPath = $transaction.LockPath
    }
    $json = $actor | ConvertTo-Json -Compress
    while ($true) {
        $claim = $null
        try {
            $claim = Acquire-Upgrade-Lock-Owner-Gate $transaction.LockPath $transaction.LockOwner
            if (-not $claim) {
                return $null
            }
            $owner = ([IO.File]::ReadAllText((Join-Path $transaction.LockPath "owner"))) | ConvertFrom-Json
            if ($owner.token -ne $transaction.LockOwner) {
                return $null
            }
            $currentTransaction = Read-Upgrade-Transaction
            if (-not $currentTransaction `
                -or $currentTransaction.LockOwner -ne $transaction.LockOwner `
                -or $currentTransaction.LockPath -ne $transaction.LockPath) {
                return $null
            }
            $stream = [IO.File]::Open($temporaryActorPath, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $bytes = [Text.UTF8Encoding]::new($false).GetBytes($json)
                $stream.Write($bytes, 0, $bytes.Length)
                $stream.Flush($true)
            } finally {
                $stream.Dispose()
            }
            [IO.File]::Move($temporaryActorPath, $actorPath)
            return $actor
        } catch {
            if (-not (Test-Path -LiteralPath $transaction.LockPath) `
                -or -not (Test-Path -LiteralPath $script:transactionPath)) {
                return $null
            }
            if (-not (Test-Path -LiteralPath $actorPath)) {
                throw
            }
            try {
                $existingJson = [IO.File]::ReadAllText($actorPath)
                $existing = $existingJson | ConvertFrom-Json
                if ($existing.token -ne $transaction.LockOwner) {
                    return $null
                }
                $identity = Test-Upgrade-Process-Identity $existing.pid $existing.processStartedAt
                if ($identity -eq "inactive" -and [IO.File]::ReadAllText($actorPath) -eq $existingJson) {
                    Remove-Item -LiteralPath $actorPath -Force -ErrorAction SilentlyContinue
                }
            } catch {}
            Start-Sleep -Milliseconds 100
        } finally {
            Remove-Item -LiteralPath $temporaryActorPath -Force -ErrorAction SilentlyContinue
            Release-Upgrade-Lock-Owner-Gate $transaction.LockPath $claim
        }
    }
}

function Release-Upgrade-Actor($actor) {
    if (-not $actor -or -not $actor.lockPath) {
        return
    }
    $actorPath = Join-Path $actor.lockPath "active-actor"
    try {
        $existing = ([IO.File]::ReadAllText($actorPath)) | ConvertFrom-Json
        if ($existing.token -eq $actor.token `
            -and "$($existing.pid)" -eq "$($actor.pid)" `
            -and "$($existing.processStartedAt)" -eq "$($actor.processStartedAt)" `
            -and $existing.action -eq $actor.action) {
            Remove-Item -LiteralPath $actorPath -Force
        }
    } catch {}
}

function Read-Upgrade-Transaction-After-Actor($actor) {
    $script:transaction = $null
    try {
        $transaction = Read-Upgrade-Transaction
        if (-not $transaction -or $transaction.LockOwner -ne $actor.token) {
            return $null
        }
        return $transaction
    } catch {
        return $null
    }
}

function Cleanup-Committed-Upgrade-After-Lost-Lease {
    $script:transaction = $null
    $transaction = Read-Upgrade-Transaction
    if ($transaction -and $transaction.State -eq "committed") {
        Cleanup-Upgrade-Transaction
    }
}

function Start-Upgrade-Recovery {
    $escapedScriptPath = $PSCommandPath.Replace("'", "''")
    $command = "& '$escapedScriptPath' -UpgradeAction Recover"
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", $encodedCommand) `
        -WindowStyle Hidden | Out-Null
}

function Wait-For-Upgrade-Recovery-Lease($timeoutMilliseconds = 10000) {
    $transaction = Read-Upgrade-Transaction
    if (-not $transaction -or -not $transaction.LockPath) {
        return $true
    }
    $ownerPath = Join-Path $transaction.LockPath "owner"
    $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMilliseconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            if (Test-Path -LiteralPath $ownerPath) {
                $lockOwner = (Get-Content -LiteralPath $ownerPath -Raw) | ConvertFrom-Json
                if ($lockOwner.Token -ne $transaction.LockOwner) {
                    return $false
                }
                if ($lockOwner.phase -eq "recovery" `
                    -and "$($lockOwner.pid)" -match "^\d+$" `
                    -and "$($lockOwner.processStartedAt)" -match "^\d+$") {
                    $identity = Test-Upgrade-Process-Identity $lockOwner.pid $lockOwner.processStartedAt
                    if ($identity -eq "active") {
                        return $true
                    }
                }
            }
        } catch {}
        Start-Sleep -Milliseconds 100
    }
    return $false
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
        $parentStartedAt = Get-Process-Start-Time-Ticks $env:MEMORY_LANE_UPGRADE_PID
        $installerStartedAt = Get-Process-Start-Time-Ticks $PID
        if (-not (Register-Upgrade-Installer $env:MEMORY_LANE_UPGRADE_LOCK_PATH $env:MEMORY_LANE_UPGRADE_LOCK_OWNER $installerStartedAt)) {
            throw "could not register the Windows upgrade installer"
        }
        $script:transaction = [PSCustomObject]@{
            State = "pending"
            BackupState = if ($existingBinary) { "not-backed-up" } else { "no-backup" }
            ManifestState = if ($env:MEMORY_LANE_UPGRADE_MANIFEST_EXISTED -eq "true") { "existing" } else { "missing" }
            ManifestPath = "$env:MEMORY_LANE_UPGRADE_MANIFEST_PATH"
            ManifestBackupPath = "$env:MEMORY_LANE_UPGRADE_MANIFEST_BACKUP_PATH"
            LockPath = "$env:MEMORY_LANE_UPGRADE_LOCK_PATH"
            LockOwner = "$env:MEMORY_LANE_UPGRADE_LOCK_OWNER"
            ParentPid = "$env:MEMORY_LANE_UPGRADE_PID"
            ParentStartedAt = $parentStartedAt
            InstallerPid = "$PID"
            InstallerStartedAt = $installerStartedAt
            OriginalBinaryHash = if ($existingBinary) { Get-Sha256-Hash $script:installPath } else { "" }
        }
        Save-Upgrade-Transaction
        Start-Upgrade-Recovery
        if (-not (Wait-For-Upgrade-Recovery-Lease)) {
            throw "could not transfer the Windows upgrade recovery lease"
        }
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
        if (-not (Update-Upgrade-Lock-Lease)) {
            Cleanup-Committed-Upgrade-After-Lost-Lease
            exit 0
        }
        if ($pendingTransaction -and -not (Wait-For-Upgrade-Process $pendingTransaction.ParentPid $pendingTransaction.ParentStartedAt)) {
            Cleanup-Committed-Upgrade-After-Lost-Lease
            exit 0
        }
        if ($pendingTransaction -and -not (Wait-For-Upgrade-Process $pendingTransaction.InstallerPid $pendingTransaction.InstallerStartedAt)) {
            Cleanup-Committed-Upgrade-After-Lost-Lease
            exit 0
        }
        if (-not (Update-Upgrade-Lock-Lease)) {
            Cleanup-Committed-Upgrade-After-Lost-Lease
            exit 0
        }
        $script:transaction = $null
    }
    if (-not (Test-Path -LiteralPath $script:transactionPath) `
        -and -not (Test-Path -LiteralPath $script:backupPath)) {
        exit 0
    }
    $actor = Acquire-Upgrade-Actor $UpgradeAction
    if (-not $actor) {
        Err "could not acquire the Windows upgrade transaction actor"
    }
    try {
        $transaction = Read-Upgrade-Transaction-After-Actor $actor
        if (-not $transaction) {
            if ($UpgradeAction -eq "Recover") {
                exit 0
            }
            Err "upgrade transaction changed while acquiring the transaction actor"
        }
        if ($UpgradeAction -eq "Commit") {
            $transaction.State = "committed"
            Save-Upgrade-Transaction
            Say "committed Windows upgrade"
            exit 0
        }
        if ($UpgradeAction -eq "Recover" -and $transaction.State -eq "committed") {
            Cleanup-Upgrade-Transaction
            exit 0
        }
        Restore-Backup
        exit 0
    } finally {
        Release-Upgrade-Actor $actor
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
