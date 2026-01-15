# Installation Guide

## Current Issue

The plugin needs to be built (TypeScript compiled to JavaScript) before it can be used in Obsidian. The `main.js` file is missing because the build step hasn't been completed.

## Solution Options

### Option 1: Build on Another Machine (Recommended)

If you have access to another computer with internet access:

1. Copy the entire `obsidian-exam-creator` folder to that machine
2. Open terminal in that folder
3. Run:
   ```bash
   npm install
   npm run build
   ```
4. Copy the generated `main.js` file back to your original machine

### Option 2: Manual Build Setup

If you can resolve the npm registry issues:

1. Check your npm configuration:
   ```bash
   npm config get registry
   ```
2. Try using a different registry or proxy settings
3. Once npm works, run:
   ```bash
   npm install
   npm run build
   ```

### Option 3: Use Online Build Service

You can use an online TypeScript compiler or build service to compile `main.ts` to `main.js`. However, you'll need to:
- Bundle it with esbuild
- Mark obsidian modules as external
- Output as CommonJS format

### Option 4: Copy Files to Vault (After Building)

Once you have `main.js` built, copy these files to your vault:

**Target location:** `/Users/iwanhoogendoorn/Documents/IWAN-REMOTE-VAULT/.obsidian/plugins/obsidian-exam-creator/`

**Required files:**
- `main.js` (the compiled JavaScript)
- `manifest.json`
- `styles.css`

You can create a simple copy script or manually copy these files.

## Quick Copy Script

After building, you can use this command to copy files:

```bash
# Create the plugin directory in your vault
mkdir -p "/Users/iwanhoogendoorn/Documents/IWAN-REMOTE-VAULT/.obsidian/plugins/obsidian-exam-creator"

# Copy required files
cp main.js manifest.json styles.css "/Users/iwanhoogendoorn/Documents/IWAN-REMOTE-VAULT/.obsidian/plugins/obsidian-exam-creator/"
```

## Verify Installation

After copying files, restart Obsidian and check:
1. Settings → Community plugins
2. The "Exam Creator" plugin should appear
3. Enable it with the toggle switch
4. No errors should appear in the console

## Need Help?

If you continue to have issues:
1. Check that all three files (`main.js`, `manifest.json`, `styles.css`) are in the plugin folder
2. Verify file permissions
3. Check Obsidian's console for specific error messages
4. Make sure you're using a compatible Obsidian version (0.15.0+)
