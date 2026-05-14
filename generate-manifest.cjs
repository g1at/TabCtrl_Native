#!/usr/bin/env node
/* Generate a Chrome/Edge native messaging host manifest for TabCtrl. */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOST_NAME = "com.tabctrl.bridge";
const STORE_EXTENSION_ID = "bniefocpdldneagigjlhbllgdjohmeie";
const ROOT = path.resolve(__dirname, "..");

function chromeExtensionIdFromKey(key) {
  const bytes = Buffer.from(String(key || ""), "base64");
  if (!bytes.length) throw new Error("manifest.json key is empty or invalid.");
  const hash = crypto.createHash("sha256").update(bytes).digest();
  let id = "";
  for (let i = 0; i < 16; i++) {
    const byte = hash[i];
    id += String.fromCharCode(97 + ((byte >> 4) & 15));
    id += String.fromCharCode(97 + (byte & 15));
  }
  return id;
}

function readExtensionIdFromManifest(manifestPath = path.join(ROOT, "manifest.json")) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.key) throw new Error("Extension id is required because manifest.json has no key.");
  return chromeExtensionIdFromKey(manifest.key);
}

function buildNativeManifest({ hostPath, extensionId }) {
  if (!path.isAbsolute(hostPath)) throw new Error(`hostPath must be absolute: ${hostPath}`);
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error(`Invalid Chrome extension id: ${extensionId}`);
  return {
    name: HOST_NAME,
    description: "TabCtrl native messaging bridge",
    path: hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

function normalizeBrowser(browser) {
  const value = String(browser || "chrome").trim().toLowerCase();
  if (value === "google" || value === "google-chrome") return "chrome";
  if (value === "microsoft-edge" || value === "msedge") return "edge";
  if (value === "chrome" || value === "chromium" || value === "edge") return value;
  throw new Error(`Unsupported browser "${browser}". Use chrome, chromium, or edge.`);
}

function userManifestDir(browser = "chrome", platform = process.platform, homeDir = os.homedir()) {
  const b = normalizeBrowser(browser);
  if (platform === "darwin") {
    const appSupport = path.join(homeDir, "Library", "Application Support");
    if (b === "chrome") return path.join(appSupport, "Google", "Chrome", "NativeMessagingHosts");
    if (b === "chromium") return path.join(appSupport, "Chromium", "NativeMessagingHosts");
    if (b === "edge") return path.join(appSupport, "Microsoft Edge", "NativeMessagingHosts");
  }
  if (platform === "linux") {
    if (b === "chrome") return path.join(homeDir, ".config", "google-chrome", "NativeMessagingHosts");
    if (b === "chromium") return path.join(homeDir, ".config", "chromium", "NativeMessagingHosts");
    if (b === "edge") return path.join(homeDir, ".config", "microsoft-edge", "NativeMessagingHosts");
  }
  throw new Error(`User-level native manifest install is not implemented for ${platform}. Use install-windows.ps1 on Windows.`);
}

function userManifestPath(browser, platform = process.platform, homeDir = os.homedir()) {
  return path.join(userManifestDir(browser, platform, homeDir), `${HOST_NAME}.json`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args.browser = arg;
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 0) {
      args[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    if (key === "write-user" || key === "print-user-path" || key === "use-manifest-id" || key === "help") {
      args[key] = true;
    } else {
      args[key] = argv[++i];
    }
  }
  return args;
}

function usage() {
  return [
    "Usage:",
    "  node native/generate-manifest.cjs --browser chrome --host-path /abs/path/tabctrl-bridge.sh --write-user",
    "  node native/generate-manifest.cjs --browser edge --host-path /abs/path/tabctrl-bridge.sh --output /tmp/com.tabctrl.bridge.json",
    "",
    "Options:",
    "  --browser chrome|chromium|edge",
    `  --extension-id <id>       Defaults to Chrome Web Store id ${STORE_EXTENSION_ID}`,
    "  --use-manifest-id         Derive extension id from local manifest.json key instead",
    "  --host-path <abs-path>    Defaults to native/tabctrl-bridge.sh on macOS/Linux",
    "  --output <path>           Write manifest to this path",
    "  --write-user              Write to the browser's user-level NativeMessagingHosts directory",
    "  --print-user-path         Print the browser's user-level manifest path",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }

  const browser = normalizeBrowser(args.browser || "chrome");
  if (args["print-user-path"]) {
    console.log(userManifestPath(browser));
    return;
  }

  const extensionId = args["extension-id"] || (args["use-manifest-id"] ? readExtensionIdFromManifest() : STORE_EXTENSION_ID);
  const defaultHost = process.platform === "win32" ? "tabctrl-bridge.cmd" : "tabctrl-bridge.sh";
  const hostPath = path.resolve(args["host-path"] || path.join(__dirname, defaultHost));
  const manifest = buildNativeManifest({ hostPath, extensionId });
  const json = JSON.stringify(manifest, null, 2) + "\n";

  let output = args.output ? path.resolve(args.output) : "";
  if (args["write-user"]) output = userManifestPath(browser);

  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, json, "utf8");
    console.log(`Registered ${HOST_NAME} for ${browser}`);
    console.log(`Extension: ${extensionId}`);
    console.log(`Manifest: ${output}`);
    console.log(`Host: ${hostPath}`);
    return;
  }

  process.stdout.write(json);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = {
  HOST_NAME,
  STORE_EXTENSION_ID,
  chromeExtensionIdFromKey,
  readExtensionIdFromManifest,
  buildNativeManifest,
  normalizeBrowser,
  userManifestDir,
  userManifestPath,
  parseArgs,
  main,
};
