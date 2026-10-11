#!/usr/bin/env bash
# Builds the macOS capture tool. Needs Xcode Command Line Tools (`xcode-select --install`).
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O -swift-version 5 Scrollback.swift -o scrollback
echo "Built ./scrollback"
echo "Try:  ./scrollback --list"
echo "Run:  ./scrollback --relay http://localhost:8787"

# Verified on macOS 14.5 Sonoma
