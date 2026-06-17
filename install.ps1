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

function Restore-Backup {
    if ($script:backupPath -and (Test-Path $script:backupPath)) {
        Move-Item $script:backupPath $script:installPath -Force
        Say "restored previous binary"
    } elseif ($script:installPath -and (Test-Path $script:installPath)) {
        Remove-Item $script:installPath -Force
    }
}

function Backup-Existing-Binary {
    $script:backupPath = $null
    if (Test-Path $script:installPath) {
        $script:backupPath = "$script:installPath.backup.$PID"
        Copy-Item $script:installPath $script:backupPath -Force
    }
}

function Verify-Installed-Binary {
    & $script:installPath --smoke-test *> $null
    if ($LASTEXITCODE -ne 0) {
        Restore-Backup
        Err "installed binary failed smoke test; previous installation was restored"
    }
    if ($script:backupPath -and (Test-Path $script:backupPath)) {
        Remove-Item $script:backupPath -Force
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
    Copy-Item $binaryPath $script:installPath -Force
    Verify-Installed-Binary
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
    Move-Item "$tmp\memory-lane-$suffix.exe" $script:installPath -Force
    Verify-Installed-Binary
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
