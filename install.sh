#!/bin/sh
set -e

# Memory Lane installer
# Usage: curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh

REPO="ribbons-digital/memory-lane"
VERSION="${VERSION:-latest}"

 say() {
  printf "memory-lane installer: %s\n" "$1"
}

 err() {
  printf "memory-lane installer error: %s\n" "$1" >&2
  exit 1
}

 get_arch() {
  arch=$(uname -m)
  case "$arch" in
    x86_64) echo "x64" ;;
    amd64) echo "x64" ;;
    arm64) echo "arm64" ;;
    aarch64) echo "arm64" ;;
    *) err "unsupported architecture: $arch" ;;
  esac
}

 get_os() {
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  case "$os" in
    darwin) echo "darwin" ;;
    linux) echo "linux" ;;
    *) err "unsupported OS: $os" ;;
  esac
}

 download() {
  url="$1"
  dest="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$dest"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$dest"
  else
    err "curl or wget is required"
  fi
}

 main() {
  if [ -n "$MEMORY_LANE_INSTALL_BINARY" ]; then
    say "using local binary from MEMORY_LANE_INSTALL_BINARY"
    binary_path="$MEMORY_LANE_INSTALL_BINARY"
    install_dir="${INSTALL_DIR:-$HOME/.local/bin}"
    install_path="$install_dir/memory-lane"
    mkdir -p "$install_dir"
    cp "$binary_path" "$install_path"
    chmod +x "$install_path"
  else
    os=$(get_os)
    arch=$(get_arch)
    suffix="${os}-${arch}"
    asset="memory-lane-${suffix}.tar.gz"

    if [ "$VERSION" = "latest" ]; then
      url="https://github.com/${REPO}/releases/latest/download/${asset}"
      checksum_url="https://github.com/${REPO}/releases/latest/download/SHA256SUMS"
    else
      url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
      checksum_url="https://github.com/${REPO}/releases/download/${VERSION}/SHA256SUMS"
    fi

    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT

    say "downloading ${asset}"
    download "$url" "$tmpdir/${asset}"

    say "verifying checksum"
    download "$checksum_url" "$tmpdir/SHA256SUMS"
    (
      cd "$tmpdir"
      grep "${asset}$" SHA256SUMS | sha256sum -c - || err "checksum verification failed"
    )

    say "extracting"
    tar -xzf "$tmpdir/${asset}" -C "$tmpdir"

    install_dir="${INSTALL_DIR:-$HOME/.local/bin}"
    install_path="$install_dir/memory-lane"

    mkdir -p "$install_dir"
    cp "$tmpdir/memory-lane-${suffix}" "$install_path"
    chmod +x "$install_path"
  fi

  case ":${PATH}:" in
    *:"$install_dir":*) ;;
    *)
      shell_config=""
      if [ -n "$ZSH_VERSION" ] || [ "$(basename "$SHELL")" = "zsh" ]; then
        shell_config="$HOME/.zshrc"
      elif [ -n "$BASH_VERSION" ] || [ "$(basename "$SHELL")" = "bash" ]; then
        shell_config="$HOME/.bashrc"
      fi

      if [ -n "$shell_config" ] && [ -f "$shell_config" ]; then
        if ! grep -q "export PATH=\"$install_dir:\$PATH\"" "$shell_config"; then
          printf 'export PATH="%s:$PATH"\n' "$install_dir" >> "$shell_config"
          say "added $install_dir to PATH in $shell_config"
        fi
      else
        say "please add $install_dir to your PATH manually"
      fi
      ;;
  esac

  data_dir="$HOME/.memory-lane"
  mkdir -p "$data_dir"

  say "running memory-lane init --yes"
  unset MEMORY_LANE_INSTALL_BINARY
  "$install_path" init --yes

  say "done. Installed at $install_path"
}

main "$@"
