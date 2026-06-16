import { readFileSync } from "fs";

const tag = process.argv[2];

if (!tag) {
  throw new Error("Missing release tag.");
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

if (tag !== manifest.version) {
  throw new Error(`Release tag '${tag}' must match manifest.json version '${manifest.version}'.`);
}

if (tag !== packageJson.version) {
  throw new Error(`Release tag '${tag}' must match package.json version '${packageJson.version}'.`);
}
