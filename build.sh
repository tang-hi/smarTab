#!/bin/bash

# Chrome Extension Build Script for smartTab
# Usage: ./build.sh [patch|minor|major]
# Default: patch (e.g., 1.4 -> 1.4.1 or 1.4.1 -> 1.4.2)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MANIFEST="manifest.json"
OUTPUT_DIR="dist"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get current version from manifest.json
get_current_version() {
    grep -o '"version": "[^"]*"' "$MANIFEST" | cut -d'"' -f4
}

# Bump version based on type (patch, minor, major)
bump_version() {
    local current_version="$1"
    local bump_type="${2:-patch}"

    # Parse version components (handle 2 or 3 part versions)
    IFS='.' read -ra parts <<< "$current_version"
    local major="${parts[0]:-0}"
    local minor="${parts[1]:-0}"
    local patch="${parts[2]:-0}"

    case "$bump_type" in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
        *)
            echo -e "${RED}Invalid bump type: $bump_type${NC}"
            echo "Use: patch, minor, or major"
            exit 1
            ;;
    esac

    echo "$major.$minor.$patch"
}

# Update version in manifest.json
update_manifest_version() {
    local new_version="$1"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$MANIFEST"
    else
        # Linux
        sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$MANIFEST"
    fi
}

# Create zip package
create_package() {
    local version="$1"
    local zip_name="smartTab-v${version}.zip"

    # Create output directory if it doesn't exist
    mkdir -p "$OUTPUT_DIR"

    # Remove old zip if exists
    rm -f "$OUTPUT_DIR/$zip_name"

    # Create zip with all necessary files
    zip -r "$OUTPUT_DIR/$zip_name" \
        manifest.json \
        background.js \
        popup.html \
        popup.css \
        popup.js \
        preview.html \
        preview.js \
        search.html \
        search.js \
        search-overlay.js \
        settings.html \
        settings.css \
        settings.js \
        images/ \
        modules/ \
        styles/ \
        -x "*.DS_Store" \
        -x "*/__MACOSX/*"

    echo "$zip_name"
}

# Main script
main() {
    local bump_type="${1:-patch}"

    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}    smartTab Chrome Extension Builder   ${NC}"
    echo -e "${YELLOW}========================================${NC}"
    echo ""

    # Get current version
    local current_version=$(get_current_version)
    echo -e "Current version: ${GREEN}$current_version${NC}"

    # Calculate new version
    local new_version=$(bump_version "$current_version" "$bump_type")
    echo -e "New version:     ${GREEN}$new_version${NC} ($bump_type bump)"
    echo ""

    # Confirm with user
    read -p "Proceed with version update and packaging? (y/N) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Cancelled.${NC}"
        exit 0
    fi

    # Update manifest version
    echo -e "\n${YELLOW}Updating manifest.json...${NC}"
    update_manifest_version "$new_version"
    echo -e "${GREEN}✓ Version updated to $new_version${NC}"

    # Create package
    echo -e "\n${YELLOW}Creating package...${NC}"
    local zip_name=$(create_package "$new_version")
    echo -e "${GREEN}✓ Package created: $OUTPUT_DIR/$zip_name${NC}"

    # Show package info
    echo -e "\n${YELLOW}Package contents:${NC}"
    unzip -l "$OUTPUT_DIR/$zip_name" | tail -n +4 | head -n -2

    local file_size=$(du -h "$OUTPUT_DIR/$zip_name" | cut -f1)
    echo -e "\n${GREEN}========================================${NC}"
    echo -e "${GREEN}Build complete!${NC}"
    echo -e "  File: $OUTPUT_DIR/$zip_name"
    echo -e "  Size: $file_size"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Go to https://chrome.google.com/webstore/devconsole"
    echo "  2. Upload $OUTPUT_DIR/$zip_name"
    echo "  3. Submit for review"
}

main "$@"
