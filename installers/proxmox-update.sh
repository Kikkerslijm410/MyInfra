#!/usr/bin/env bash
set -euo pipefail

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

print_header() {
  clear
  echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║${WHITE}          MyInfra LXC Updater          ${CYAN}║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
  echo
}

print_header
echo "Scanning for MyInfra installations..."
echo "--------------------------------"

mapfile -t ALL_CTIDS < <(pct list | awk 'NR>1 {print $1}')

FOUND_CTIDS=()
RUNNING_UNCHECKED=()
STOPPED_CTIDS=()

for id in "${ALL_CTIDS[@]}"; do
    status=$(pct status "$id" | awk '{print $2}')

    if [[ "$status" == "running" ]]; then
        if pct exec "$id" -- test -d /opt/myinfra 2>/dev/null; then
            hostname=$(pct exec "$id" -- hostname 2>/dev/null || echo "?")
            FOUND_CTIDS+=("$id")
            echo -e "${GREEN}$id${NC}) $hostname ${GREEN}[MyInfra found]${NC}"
        else
            RUNNING_UNCHECKED+=("$id")
        fi
    else
        STOPPED_CTIDS+=("$id")
    fi
done

if [[ ${#RUNNING_UNCHECKED[@]} -gt 0 ]]; then
    echo -e "${YELLOW}Running, no MyInfra found:${NC} ${RUNNING_UNCHECKED[*]}"
fi

if [[ ${#STOPPED_CTIDS[@]} -gt 0 ]]; then
    echo -e "${YELLOW}Stopped (not scanned):${NC} ${STOPPED_CTIDS[*]}"
fi

echo "--------------------------------"

if [[ ${#FOUND_CTIDS[@]} -eq 1 ]]; then
    CTID="${FOUND_CTIDS[0]}"
    echo -e "${BLUE}Auto-selected container $CTID (only match found).${NC}"
    read -rp "Container ID [$CTID]: " INPUT
    CTID=${INPUT:-$CTID}
else
    read -rp "Container ID: " CTID
fi

if ! pct status "$CTID" &>/dev/null; then
    echo -e "${RED}Container $CTID does not exist.${NC}"
    exit 1
fi

STATUS=$(pct status "$CTID" | awk '{print $2}')
WAS_STOPPED=0

if [[ "$STATUS" != "running" ]]; then
    echo -e "${YELLOW}Container is stopped, starting it temporarily...${NC}"
    pct start "$CTID"
    WAS_STOPPED=1
    sleep 5
fi

if ! pct exec "$CTID" -- test -d /opt/myinfra; then
    echo -e "${RED}/opt/myinfra not found in container $CTID. Is MyInfra installed here?${NC}"
    if [[ "$WAS_STOPPED" -eq 1 ]]; then
        echo -e "${YELLOW}Stopping container again (it was stopped before the update)...${NC}"
        pct stop "$CTID"
    fi
    exit 1
fi

echo
echo -e "${BLUE}Fetching latest changes...${NC}"

BEFORE_HASH=$(pct exec "$CTID" -- bash -c "cd /opt/myinfra && git rev-parse HEAD")

pct exec "$CTID" -- bash -c "
cd /opt/myinfra &&
git fetch origin main &&
git reset --hard origin/main
"

AFTER_HASH=$(pct exec "$CTID" -- bash -c "cd /opt/myinfra && git rev-parse HEAD")

if [[ "$BEFORE_HASH" == "$AFTER_HASH" ]]; then
    echo -e "${YELLOW}Already up to date ($AFTER_HASH).${NC}"
else
    echo -e "${GREEN}Updated: ${BEFORE_HASH:0:7} -> ${AFTER_HASH:0:7}${NC}"
fi

echo
echo -e "${BLUE}Installing dependencies...${NC}"

pct exec "$CTID" -- bash -c "
cd /opt/myinfra &&
./.venv/bin/python -m pip install --upgrade pip &&
./.venv/bin/python -m pip install -r requirements.txt
"

echo
echo -e "${BLUE}Restarting service...${NC}"

pct exec "$CTID" -- systemctl restart myinfra

sleep 3

if pct exec "$CTID" -- systemctl is-active --quiet myinfra; then
    echo -e "${GREEN}Service is running.${NC}"
else
    echo -e "${RED}Service failed to start. Check logs with:${NC}"
    echo -e "${WHITE}pct exec $CTID -- journalctl -u myinfra -n 50 --no-pager${NC}"
    exit 1
fi

if [[ "$WAS_STOPPED" -eq 1 ]]; then
    echo -e "${YELLOW}Stopping container again (it was stopped before the update)...${NC}"
    pct stop "$CTID"
fi

IP=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}' || true)

echo
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Update Completed!           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo

echo -e "${CYAN}Container ID :${NC} $CTID"
[[ "$WAS_STOPPED" -eq 0 && -n "$IP" ]] && echo -e "${CYAN}IP Address   :${NC} $IP"
echo