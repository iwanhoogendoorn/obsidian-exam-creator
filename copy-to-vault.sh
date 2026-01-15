#!/bin/bash

# Script to copy plugin files to Obsidian vault after building

VAULT_PATH="/Users/iwanhoogendoorn/Documents/IWAN-REMOTE-VAULT/.obsidian/plugins/obsidian-exam-creator"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Copying Exam Creator plugin files to vault..."
echo "Source: $SOURCE_DIR"
echo "Target: $VAULT_PATH"

# Check if main.js exists
if [ ! -f "$SOURCE_DIR/main.js" ]; then
    echo "ERROR: main.js not found!"
    echo "Please build the plugin first by running: npm run build"
    exit 1
fi

# Create target directory if it doesn't exist
mkdir -p "$VAULT_PATH"

# Copy required files
echo "Copying files..."
cp "$SOURCE_DIR/main.js" "$VAULT_PATH/"
cp "$SOURCE_DIR/manifest.json" "$VAULT_PATH/"
cp "$SOURCE_DIR/styles.css" "$VAULT_PATH/"

echo "✓ Files copied successfully!"
echo ""
echo "Next steps:"
echo "1. Restart Obsidian"
echo "2. Go to Settings → Community plugins"
echo "3. Enable 'Exam Creator' plugin"
echo "4. Start using it with the ribbon icon or command palette"
