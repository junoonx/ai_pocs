#!/bin/bash
# ==============================================================================
# Enterprise AI Proof of Concepts (ai_pocs) – Master Setup Orchestrator
# "Setup X POC" Universal Lifecycle Launcher
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POCS_DIR="${SCRIPT_DIR}/pocs"

echo "=============================================================================="
echo "🚀 Enterprise AI Proof of Concept (PoC) Orchestrator"
echo "Repository: junoonx/ai_pocs"
echo "=============================================================================="

# Discover available PoCs in pocs/ directory
POCS=()
if [ -d "$POCS_DIR" ]; then
    while IFS= read -r -d '' dir; do
        if [ -f "$dir/install.sh" ]; then
            POCS+=("$(basename "$dir")")
        fi
    done < <(find "$POCS_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)
fi

if [ ${#POCS[@]} -eq 0 ]; then
    echo "❌ No configured PoCs found in ${POCS_DIR}."
    echo "Add a PoC directory containing an install.sh script under pocs/."
    exit 1
fi

TARGET_POC=""

# 1. Check if PoC was passed via command-line argument
if [ $# -ge 1 ]; then
    ARG_POC="$1"
    # Match by exact name or number
    if [[ "$ARG_POC" =~ ^[0-9]+$ ]] && [ "$ARG_POC" -ge 1 ] && [ "$ARG_POC" -le ${#POCS[@]} ]; then
        TARGET_POC="${POCS[$((ARG_POC-1))]}"
    else
        for p in "${POCS[@]}"; do
            if [ "$p" = "$ARG_POC" ] || [ "pocs/$p" = "$ARG_POC" ]; then
                TARGET_POC="$p"
                break
            fi
        done
    fi

    if [ -z "$TARGET_POC" ]; then
        echo "❌ Unknown PoC: '$ARG_POC'"
        echo ""
        echo "Available PoCs in this repository:"
        for i in "${!POCS[@]}"; do
            echo "  [$((i+1))] ${POCS[$i]}"
        done
        echo ""
        exit 1
    fi
else
    # 2. Interactive Selection Menu
    echo ""
    echo "Available Proof of Concepts:"
    for i in "${!POCS[@]}"; do
        POC_NAME="${POCS[$i]}"
        DESC="Enterprise AI Integration"
        if [ -f "${POCS_DIR}/${POC_NAME}/README.md" ]; then
            FIRST_LINE=$(head -n 2 "${POCS_DIR}/${POC_NAME}/README.md" | tr '\n' ' ' | sed 's/#//g' | xargs)
            if [ -n "$FIRST_LINE" ]; then DESC="$FIRST_LINE"; fi
        fi
        printf "  \033[1;36m[%d]\033[0m \033[1m%s\033[0m\n      %s\n" "$((i+1))" "$POC_NAME" "$DESC"
    done
    echo ""
    read -p "Select a PoC to set up [1-${#POCS[@]}]: " SELECTION

    if [[ "$SELECTION" =~ ^[0-9]+$ ]] && [ "$SELECTION" -ge 1 ] && [ "$SELECTION" -le ${#POCS[@]} ]; then
        TARGET_POC="${POCS[$((SELECTION-1))]}"
    else
        echo "❌ Invalid selection. Aborting."
        exit 1
    fi
fi

# 3. Launch PoC Pre-Flight Setup
POC_PATH="${POCS_DIR}/${TARGET_POC}"
INSTALL_SCRIPT="${POC_PATH}/install.sh"

echo ""
echo "=============================================================================="
echo "🎯 Initializing Setup for: ${TARGET_POC}"
echo "Location: ${POC_PATH}"
echo "=============================================================================="
echo ""

if [ -x "$INSTALL_SCRIPT" ]; then
    exec "$INSTALL_SCRIPT"
else
    echo "🔧 Setting executable permissions on ${INSTALL_SCRIPT}..."
    chmod +x "$INSTALL_SCRIPT"
    exec "$INSTALL_SCRIPT"
fi
