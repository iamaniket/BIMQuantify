#!/bin/bash

# Function to check if a symbol is used outside its own file
check_symbol() {
    local file="$1"
    local symbol="$2"
    
    # Search for the symbol in the entire repo, excluding the declaring file and its test
    local count=$(grep -r "\b${symbol}\b" apps/portal/src --include="*.ts" --include="*.tsx" 2>/dev/null | \
        grep -v "^${file}:" | \
        grep -v "^${file%.tsx}.test.tsx:" | \
        grep -v "^${file%.ts}.test.ts:" | \
        wc -l)
    
    if [ "$count" -eq 0 ]; then
        echo "UNUSED: $file => $symbol"
        return 0
    fi
    return 1
}

# Check a sample of files
check_symbol "apps/portal/src/features/free/TrialBanner.tsx" "TrialBanner"
check_symbol "apps/portal/src/features/access/RequestAccessPanel.tsx" "RequestAccessPanel"
check_symbol "apps/portal/src/features/activity/ActivityPageHero.tsx" "ActivityPageHero"
