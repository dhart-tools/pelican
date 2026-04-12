#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  Pelican — getting started
#  Walks you through your first analysis from scratch.
#  No prior knowledge required.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ─── Colors ──────────────────────────────────────────────────────────────────
TEAL=$'\033[38;5;44m'
CYAN=$'\033[38;5;75m'
GREEN=$'\033[38;5;84m'
AMBER=$'\033[38;5;214m'
WHITE=$'\033[1;37m'
DIM=$'\033[2;37m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────────────────

type_line() {
  local text="$1"
  local delay="${2:-0.025}"
  local i=0
  while [ $i -lt ${#text} ]; do
    printf '%s' "${text:$i:1}"
    sleep "$delay"
    i=$((i + 1))
  done
  printf '\n'
}

pause() {
  sleep "${1:-0.8}"
}

section() {
  local label="$1"
  echo ""
  printf "${DIM}%s${RESET}\n" "$(printf '─%.0s' {1..60})"
  printf "${TEAL}${BOLD}  $label${RESET}\n"
  printf "${DIM}%s${RESET}\n" "$(printf '─%.0s' {1..60})"
  echo ""
}

percy() {
  local text="$1"
  printf "\n  ${TEAL}${BOLD}🦅  ${RESET}"
  type_line "$text" 0.02
  echo ""
}

run_cmd() {
  local label="$1"
  shift
  printf "  ${DIM}\$${RESET} ${CYAN}$*${RESET}\n"
  pause 0.3
  "$@"
}

check_pass() {
  printf "  ${GREEN}✔${RESET}  $1\n"
}

check_fail() {
  printf "  ${AMBER}✘${RESET}  $1\n"
}

require_cmd() {
  if command -v "$1" &>/dev/null; then
    check_pass "$1 found  $(${1} --version 2>/dev/null | head -1)"
  else
    check_fail "$1 not found — please install it first"
    exit 1
  fi
}

# ─── Intro ────────────────────────────────────────────────────────────────────

clear

echo ""
echo ""
printf "${TEAL}${BOLD}"
cat << 'BANNER'
  ██████╗ ███████╗██╗     ██╗ ██████╗ █████╗ ███╗   ██╗
  ██╔══██╗██╔════╝██║     ██║██╔════╝██╔══██╗████╗  ██║
  ██████╔╝█████╗  ██║     ██║██║     ███████║██╔██╗ ██║
  ██╔═══╝ ██╔══╝  ██║     ██║██║     ██╔══██║██║╚██╗██║
  ██║     ███████╗███████╗██║╚██████╗██║  ██║██║ ╚████║
  ╚═╝     ╚══════╝╚══════╝╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═══╝
BANNER
printf "${RESET}"

printf "${DIM}  semantic test suggester for modern frontend teams${RESET}\n"
echo ""

pause 1.2

percy "Hey. I'm Percy. Let me get you set up."
pause 0.6

# ─── Prerequisites ────────────────────────────────────────────────────────────

section "Step 1  ·  Prerequisites"

printf "  Checking what you have...\n\n"
pause 0.4

require_cmd node
require_cmd pnpm
echo ""

NODE_VER=$(node -e 'process.stdout.write(process.versions.node)')
MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$MAJOR" -lt 18 ]; then
  check_fail "Node $NODE_VER is too old — Pelican needs Node 18+."
  exit 1
fi
check_pass "Node $NODE_VER — good to go"

echo ""
percy "All good. Let's build."
pause 0.5

# ─── Build Pelican ────────────────────────────────────────────────────────────

section "Step 2  ·  Build Pelican"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

percy "Installing dependencies and compiling..."
echo ""

run_cmd "install" pnpm install --frozen-lockfile
echo ""
run_cmd "build"   pnpm run build
echo ""

check_pass "Pelican built → dist/v2/cli/entry.js"

echo ""
percy "Linking so you can run 'pelican' from anywhere..."
echo ""

run_cmd "link" pnpm link --global
echo ""

check_pass "pelican is now available globally"

# ─── Sandbox setup ───────────────────────────────────────────────────────────

section "Step 3  ·  Set up the demo project"

percy "I have a sandbox React project ready to go. It has:"
pause 0.3
printf "    ${DIM}→${RESET}  Cypress e2e tests\n"
pause 0.2
printf "    ${DIM}→${RESET}  Redux Toolkit store\n"
pause 0.2
printf "    ${DIM}→${RESET}  React Router\n"
pause 0.2
printf "    ${DIM}→${RESET}  react-i18next\n"
pause 0.2
printf "    ${DIM}→${RESET}  10 scorers × all confidence scenarios\n"
echo ""
pause 0.6

cd "$SCRIPT_DIR/sandbox"

echo "  Installing sandbox dependencies..."
echo ""
run_cmd "install" pnpm install --frozen-lockfile
echo ""

check_pass "sandbox ready"

# ─── Theme ───────────────────────────────────────────────────────────────────

section "Step 4  ·  Pick a theme"

printf "  Pelican works on both dark and light terminals.\n\n"

DEFAULT_THEME="dark"
printf "  ${DIM}Which theme? [${RESET}${TEAL}dark${RESET}${DIM}/light] (default: dark):${RESET} "
read -r THEME_INPUT
THEME="${THEME_INPUT:-$DEFAULT_THEME}"

if [ "$THEME" != "light" ] && [ "$THEME" != "dark" ]; then
  THEME="dark"
fi

pelican theme "$THEME" 2>/dev/null || node "$SCRIPT_DIR/dist/v2/cli/entry.js" theme "$THEME"
echo ""
check_pass "Theme set to  $THEME"

# ─── Launch demo ─────────────────────────────────────────────────────────────

section "Step 5  ·  Interactive demo"

percy "Everything's ready. I'll walk you through the whole thing now."
pause 0.5
printf "  ${DIM}We're in:  $(pwd)${RESET}\n"
echo ""
printf "  ${DIM}Controls:${RESET}\n"
printf "  ${GREEN}ENTER${RESET}   ${DIM}advance to next stage${RESET}\n"
printf "  ${GREEN}ENTER${RESET}   ${DIM}(during typing) skip typewriter animation${RESET}\n"
echo ""

pause 1.0

printf "  ${TEAL}${BOLD}Starting pelican demo...${RESET}\n\n"
pause 0.4

pelican demo 2>/dev/null || node "$SCRIPT_DIR/dist/v2/cli/entry.js" demo

# ─── Done ─────────────────────────────────────────────────────────────────────

echo ""
printf "${DIM}%s${RESET}\n" "$(printf '─%.0s' {1..60})"
echo ""
printf "  ${TEAL}${BOLD}Next steps${RESET}\n\n"
printf "  ${CYAN}pelican setup${RESET}               ${DIM}detect your own project's config${RESET}\n"
printf "  ${CYAN}pelican registry build${RESET}       ${DIM}index your codebase${RESET}\n"
printf "  ${CYAN}pelican analyze --files <f>${RESET}  ${DIM}suggest tests for changed files${RESET}\n"
printf "  ${CYAN}pelican theme [dark|light]${RESET}   ${DIM}switch color theme${RESET}\n"
echo ""
printf "${DIM}%s${RESET}\n" "$(printf '─%.0s' {1..60})"
echo ""
