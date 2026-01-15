# Troubleshooting Guide

## Error: "ENOENT: no such file or directory, open 'main.js'"

This error occurs because the TypeScript source code hasn't been compiled to JavaScript yet.

### Why This Happens

Obsidian plugins are written in TypeScript but must be compiled to JavaScript (`main.js`) before Obsidian can load them. The build process requires:
1. Installing dependencies (`npm install`)
2. Compiling TypeScript (`npm run build`)

### Current Issue

Your system is unable to access the npm registry to download build tools. This could be due to:
- Network/firewall restrictions
- Corporate proxy settings
- npm registry access issues

## Solutions

### Solution 1: Build on a Different Network (Easiest)

1. **On a machine with internet access:**
   ```bash
   cd obsidian-exam-creator
   npm install
   npm run build
   ```

2. **Copy the generated `main.js` file** to your original machine

3. **Copy all files to your vault:**
   ```bash
   ./copy-to-vault.sh
   ```

### Solution 2: Fix npm Registry Access

Try these commands to diagnose/fix npm:

```bash
# Check current registry
npm config get registry

# Try using a different registry (if allowed)
npm config set registry https://registry.npmjs.org/

# Or try with a proxy (if you have one)
npm config set proxy http://your-proxy:port
npm config set https-proxy http://your-proxy:port

# Then try installing again
npm install
```

### Solution 3: Manual File Copy (After Building Elsewhere)

Once you have `main.js` built:

1. **Create the plugin directory:**
   ```bash
   mkdir -p "/Users/iwanhoogendoorn/Documents/IWAN-REMOTE-VAULT/.obsidian/plugins/obsidian-exam-creator"
   ```

2. **Copy these 3 files:**
   - `main.js` (the compiled JavaScript - REQUIRED)
   - `manifest.json` (plugin metadata)
   - `styles.css` (styling)

3. **Restart Obsidian**

4. **Enable the plugin** in Settings → Community plugins

### Solution 4: Use a VPN or Different Network

If you're on a restricted network:
- Connect to a different network (mobile hotspot, home network, etc.)
- Try building the plugin there
- Copy the files back

## Verification Steps

After copying files, verify:

1. **File structure:**
   ```
   .obsidian/plugins/obsidian-exam-creator/
   ├── main.js          ← Must exist!
   ├── manifest.json
   └── styles.css
   ```

2. **File sizes:**
   - `main.js` should be ~50-100KB (compiled code)
   - `manifest.json` should be ~200 bytes
   - `styles.css` should be ~15-20KB

3. **In Obsidian:**
   - Settings → Community plugins → "Exam Creator" should appear
   - No red error messages
   - Toggle switch works

## Still Having Issues?

1. **Check Obsidian console:**
   - Settings → Advanced → Open developer tools
   - Look for specific error messages

2. **Verify Obsidian version:**
   - Settings → About
   - Must be 0.15.0 or higher

3. **Check file permissions:**
   ```bash
   ls -la "/Users/iwanhoogendoorn/Documents/IWAN-REMOTE-VAULT/.obsidian/plugins/obsidian-exam-creator/"
   ```

4. **Try manual installation:**
   - Disable the plugin
   - Delete the plugin folder
   - Copy files again
   - Re-enable

## Quick Test

After installation, test the plugin:

1. Open any note with questions (see `Example Exam.md`)
2. Click the checkmark icon in the ribbon (left sidebar)
3. Or use Command Palette: "Start Exam from Current Note"

If you see the exam interface, it's working! 🎉
