import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.argv[2] || "1.0.0";

// read minAppVersion from manifest.json and bump version
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

versions[targetVersion] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));

console.log(`Bumped version to ${targetVersion}`);
