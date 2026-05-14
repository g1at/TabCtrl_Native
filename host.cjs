#!/usr/bin/env node
/* TabCtrl native messaging host. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, "bridge.config.json");

function defaultConfig() {
  return {
    commands: {
      feishu: {
        win32: [
          "%APPDATA%\\npm\\feishu.cmd",
          "%APPDATA%\\npm\\feishu",
          "feishu.cmd",
          "feishu",
          "lark-cli.cmd",
          "lark-cli",
        ],
        darwin: [
          "/opt/homebrew/bin/feishu",
          "/usr/local/bin/feishu",
          "$HOME/.local/bin/feishu",
          "feishu",
          "lark-cli",
        ],
        linux: [
          "$HOME/.local/bin/feishu",
          "/usr/local/bin/feishu",
          "/usr/bin/feishu",
          "feishu",
          "lark-cli",
        ],
      },
    },
    maxTimeoutMs: 120000,
    maxOutputBytes: 1024 * 1024,
    allowCwd: false,
  };
}

function mergeConfig(defaults, raw) {
  const config = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const rawCommands = config.commands && typeof config.commands === "object" && !Array.isArray(config.commands)
    ? config.commands
    : {};
  return {
    ...defaults,
    ...config,
    commands: { ...defaults.commands, ...rawCommands },
  };
}

function loadConfigWithMeta(configPath = CONFIG_PATH) {
  const defaults = defaultConfig();
  try {
    const source = fs.readFileSync(configPath, "utf8");
    const raw = JSON.parse(source);
    return {
      config: mergeConfig(defaults, raw),
      configPath,
      loaded: true,
      usedDefaults: false,
    };
  } catch (error) {
    return {
      config: defaults,
      configPath,
      loaded: false,
      usedDefaults: true,
      error: String(error.message || error),
    };
  }
}

function loadConfig() {
  return loadConfigWithMeta().config;
}

function writeMessage(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function startNativeHost(stdin = process.stdin) {
  let inputBuffer = Buffer.alloc(0);
  stdin.on("data", (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]);
    while (inputBuffer.length >= 4) {
      const size = inputBuffer.readUInt32LE(0);
      if (inputBuffer.length < 4 + size) return;
      const body = inputBuffer.slice(4, 4 + size);
      inputBuffer = inputBuffer.slice(4 + size);
      handleRawMessage(body).catch((error) => {
        writeMessage({ ok: false, error: String(error.message || error) });
      });
    }
  });
}

async function handleRawMessage(body) {
  let message;
  try {
    message = JSON.parse(body.toString("utf8"));
  } catch {
    writeMessage({ ok: false, error: "Invalid JSON message." });
    return;
  }
  const started = Date.now();
  const id = message.id || "";
  try {
    const result = await handleMessage(message);
    writeMessage({ id, ok: true, elapsedMs: Date.now() - started, ...result });
  } catch (error) {
    writeMessage({ id, ok: false, elapsedMs: Date.now() - started, error: String(error.message || error) });
  }
}

async function handleMessage(message) {
  const action = String(message.action || "");
  if (action === "ping") {
    return {
      action,
      bridge: "tabctrl-native",
      platform: process.platform,
      node: process.version,
    };
  }

  const config = loadConfig();
  if (action === "diagnose") {
    return diagnoseConfig();
  }

  const command = String(message.command || "").trim();
  if (!command) throw new Error(`${action} requires command.`);
  const resolved = resolveAllowedCommand(config, command);

  if (action === "which") {
    return {
      action,
      command,
      path: resolved,
    };
  }

  if (action === "run") {
    return await runCommand(config, resolved, message);
  }

  throw new Error(`Unsupported native bridge action: ${action}`);
}

function diagnoseConfig(options = {}) {
  const meta = loadConfigWithMeta(options.configPath || CONFIG_PATH);
  return validateConfig(meta.config, {
    ...options,
    configPath: meta.configPath,
    configLoaded: meta.loaded,
    configError: meta.error || "",
    usedDefaults: meta.usedDefaults,
  });
}

const SHELL_OR_INTERPRETER_NAMES = new Set([
  "cmd", "powershell", "pwsh", "bash", "sh", "zsh", "fish",
  "python", "python3", "node", "nodejs", "perl", "ruby", "php",
  "osascript", "wscript", "cscript",
]);

const HIGH_CAPABILITY_TOOL_NAMES = new Set([
  "git", "curl", "wget", "ssh", "scp", "rsync",
  "docker", "podman", "kubectl", "helm",
  "npm", "npx", "pnpm", "yarn", "pip", "pip3",
  "brew", "choco", "scoop", "winget",
]);

function issue(level, code, message, extra = {}) {
  return { level, code, message, ...extra };
}

function normalizedCommandName(value) {
  const first = String(value || "").trim().split(/\s+/)[0] || "";
  return path.basename(first).replace(/\.(?:cmd|bat|exe|com|ps1|sh)$/i, "").toLowerCase();
}

function candidateRisk(command, candidate) {
  const name = normalizedCommandName(candidate);
  if (!name) return null;
  if (SHELL_OR_INTERPRETER_NAMES.has(name)) {
    return issue(
      "error",
      "dangerous_candidate",
      `Candidate "${candidate}" for "${command}" is a shell or interpreter. It can turn Lab into arbitrary code execution; use a purpose-built CLI wrapper instead.`,
      { command, candidate },
    );
  }
  if (HIGH_CAPABILITY_TOOL_NAMES.has(name)) {
    return issue(
      "warn",
      "high_capability_candidate",
      `Candidate "${candidate}" for "${command}" is high-capability. Keep it manual-approval only and prefer a narrower wrapper when possible.`,
      { command, candidate },
    );
  }
  if (/[|;&<>`]/.test(String(candidate))) {
    return issue(
      "warn",
      "shell_syntax_candidate",
      `Candidate "${candidate}" contains shell syntax. The host does not run candidate strings through a shell; use a plain executable name or path.`,
      { command, candidate },
    );
  }
  return null;
}

function validateConfig(config = {}, options = {}) {
  const platform = options.platform || process.platform;
  const errors = [];
  const warnings = [];
  const commands = [];
  const configPath = options.configPath || CONFIG_PATH;

  if (options.configLoaded === false) {
    warnings.push(issue(
      "warn",
      "config_not_loaded",
      `Could not read native/bridge.config.json; using built-in defaults. ${options.configError || ""}`.trim(),
    ));
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    errors.push(issue("error", "config_shape", "Native config must be a JSON object."));
  }

  if (!config.commands || typeof config.commands !== "object" || Array.isArray(config.commands)) {
    errors.push(issue("error", "commands_shape", "Native config must contain a commands object."));
  }

  const timeout = Number(config.maxTimeoutMs);
  if (!Number.isFinite(timeout) || timeout < 1000) {
    errors.push(issue("error", "timeout_invalid", "maxTimeoutMs must be at least 1000."));
  } else if (timeout > 120000) {
    warnings.push(issue("warn", "timeout_high", "maxTimeoutMs is higher than the extension-side cap of 120000 ms."));
  }

  const maxOutputBytes = Number(config.maxOutputBytes);
  if (!Number.isFinite(maxOutputBytes) || maxOutputBytes < 4096) {
    errors.push(issue("error", "output_limit_invalid", "maxOutputBytes must be at least 4096."));
  } else if (maxOutputBytes > 10 * 1024 * 1024) {
    warnings.push(issue("warn", "output_limit_high", "maxOutputBytes is very high; large local output may flood the model context."));
  }

  if (config.allowCwd === true) {
    warnings.push(issue("warn", "allow_cwd_enabled", "allowCwd is enabled. Local commands may run from model-provided directories."));
  } else if (config.allowCwd !== false && config.allowCwd != null) {
    errors.push(issue("error", "allow_cwd_invalid", "allowCwd must be true or false."));
  }

  const commandMap = config.commands && typeof config.commands === "object" && !Array.isArray(config.commands)
    ? config.commands
    : {};
  for (const command of Object.keys(commandMap).sort()) {
    if (!/^[A-Za-z0-9._-]+$/.test(command)) {
      errors.push(issue("error", "command_name_invalid", `Command key "${command}" must use only letters, numbers, dots, underscores, or hyphens.`, { command }));
    }
    const candidates = commandCandidates(config, command, platform);
    if (!candidates.length) {
      warnings.push(issue("warn", "no_platform_candidates", `Command "${command}" has no candidates for ${platform}.`, { command }));
    }
    for (const candidate of candidates) {
      const risk = candidateRisk(command, candidate);
      if (risk?.level === "error") errors.push(risk);
      else if (risk) warnings.push(risk);
    }
    let resolved = "";
    let resolveError = "";
    try {
      resolved = resolveAllowedCommand(config, command, options);
    } catch (error) {
      resolveError = String(error.message || error);
      warnings.push(issue("warn", "command_not_found", resolveError, { command }));
    }
    commands.push({
      command,
      candidates,
      resolved,
      ok: !!resolved,
      error: resolveError || undefined,
    });
  }

  return {
    action: "diagnose",
    ok: errors.length === 0,
    platform,
    configPath,
    configLoaded: options.configLoaded !== false,
    allowCwd: !!config.allowCwd,
    maxTimeoutMs: Number(config.maxTimeoutMs || 0),
    maxOutputBytes: Number(config.maxOutputBytes || 0),
    commands,
    errors,
    warnings,
    summary: `${errors.length} error(s), ${warnings.length} warning(s), ${commands.length} command(s)`,
  };
}

function pushCandidates(out, value) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) pushCandidates(out, item);
    return;
  }
  if (typeof value === "string" && value.trim()) out.push(value);
}

function uniq(values) {
  return [...new Set(values)];
}

function commandCandidates(config, command, platform = process.platform) {
  const entry = config.commands?.[command];
  if (Array.isArray(entry)) return entry;
  if (entry && typeof entry === "object") {
    const out = [];
    pushCandidates(out, entry[platform]);
    if (platform === "darwin") pushCandidates(out, entry.macos);
    if (platform === "win32") pushCandidates(out, entry.windows);
    if (platform === "linux" || platform === "darwin") pushCandidates(out, entry.unix);
    pushCandidates(out, entry.candidates);
    pushCandidates(out, entry.default);
    return uniq(out);
  }
  if (Array.isArray(config.allowedCommands) && config.allowedCommands.includes(command)) return [command];
  return [];
}

function resolveAllowedCommand(config, command, options = {}) {
  const candidates = commandCandidates(config, command, options.platform || process.platform);
  if (!candidates.length) {
    throw new Error(`Command "${command}" is not in native/bridge.config.json allowlist.`);
  }
  for (const candidate of candidates) {
    const resolved = resolveOnPath(candidate, options);
    if (resolved) return resolved;
  }
  throw new Error(`Allowlisted command "${command}" was not found on PATH.`);
}

function envValue(env, name) {
  return env[name] || env[name.toUpperCase()] || env[name.toLowerCase()] || "";
}

function expandEnvVars(value, env = process.env, homeDir = os.homedir()) {
  let text = String(value || "");
  if (text === "~") text = homeDir;
  else if (text.startsWith("~/") || text.startsWith("~\\")) text = path.join(homeDir, text.slice(2));
  return text
    .replace(/%([^%]+)%/g, (_, name) => envValue(env, name))
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => envValue(env, name))
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => envValue(env, name));
}

function hasPathSeparator(command) {
  return /[\\/]/.test(command);
}

function candidateExtensions(command, platform, env) {
  if (platform !== "win32" || path.extname(command)) return [""];
  const pathext = String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD");
  return pathext.split(";").map((ext) => ext.trim()).filter(Boolean);
}

function executableFile(pathname) {
  try {
    const stat = fs.statSync(pathname);
    return stat.isFile();
  } catch {
    return false;
  }
}

function resolveExistingCandidate(candidate, platform, env) {
  for (const ext of candidateExtensions(candidate, platform, env)) {
    const pathname = candidate + ext;
    if (executableFile(pathname)) return pathname;
  }
  return "";
}

function resolveOnPath(command, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const root = options.root || ROOT;
  const expanded = expandEnvVars(command, env, options.homeDir || os.homedir());
  if (!expanded) return "";

  if (path.isAbsolute(expanded)) return resolveExistingCandidate(expanded, platform, env);

  if (hasPathSeparator(expanded)) {
    return (
      resolveExistingCandidate(path.resolve(root, expanded), platform, env) ||
      resolveExistingCandidate(path.resolve(process.cwd(), expanded), platform, env)
    );
  }

  const pathValue = env.PATH || env.Path || env.path || "";
  for (const dir of String(pathValue).split(path.delimiter).filter(Boolean)) {
    const resolved = resolveExistingCandidate(path.join(dir, expanded), platform, env);
    if (resolved) return resolved;
  }
  return "";
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) return [];
  return args.map((arg) => String(arg));
}

function clampTimeout(config, timeoutMs) {
  const max = Math.max(1000, Number(config.maxTimeoutMs || 120000));
  const requested = Math.max(1000, Number(timeoutMs || max));
  return Math.min(requested, max);
}

function capOutput(text, maxBytes) {
  const value = String(text || "");
  const limit = Math.max(4096, Number(maxBytes || 1024 * 1024));
  const buf = Buffer.from(value, "utf8");
  if (buf.length <= limit) return { text: value, truncated: false };
  return {
    text: buf.slice(0, limit).toString("utf8") + `\n[truncated ${buf.length - limit} bytes]`,
    truncated: true,
  };
}

function assertSafeWindowsCmdArg(value) {
  const text = String(value);
  if (/[\0\r\n"%!]/.test(text)) {
    throw new Error("Windows .cmd/.bat native calls reject quotes, percent expansion, delayed expansion, and control characters in args. Use native_bridge input/stdin or a non-.cmd executable for complex content.");
  }
}

function quoteWinArg(value) {
  assertSafeWindowsCmdArg(value);
  const text = String(value);
  return `"${text}"`;
}

function spawnPortable(commandPath, args, options) {
  const ext = path.extname(commandPath).toLowerCase();
  if (process.platform === "win32" && (ext === ".cmd" || ext === ".bat")) {
    const line = [commandPath, ...args].map(quoteWinArg).join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", line], options);
  }
  return spawn(commandPath, args, options);
}

function hasContentArg(args) {
  return args.some((arg) => arg === "-c" || arg === "--content" || arg === "-f" || arg === "--file");
}

function shouldMaterializeFeishuDocxInput(message, args) {
  if (!message.input) return false;
  const command = String(message.command || "").toLowerCase();
  if (command !== "feishu" && command !== "lark-cli") return false;
  if (String(args[0] || "").toLowerCase() !== "docx") return false;
  const subcommand = String(args[1] || "").toLowerCase();
  if (subcommand !== "create" && subcommand !== "update") return false;
  return !hasContentArg(args);
}

function prepareCommandInput(message, args) {
  const input = message.input ? String(message.input) : "";
  if (!input || !shouldMaterializeFeishuDocxInput(message, args)) {
    return {
      args,
      stdin: input,
      cleanup: () => {},
      materializedInputFile: false,
    };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabctrl-feishu-"));
  const filePath = path.join(dir, "content.md");
  fs.writeFileSync(filePath, input, "utf8");
  return {
    args: [...args, "-f", filePath],
    stdin: "",
    cleanup: () => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    },
    materializedInputFile: true,
  };
}

function runCommand(config, commandPath, message) {
  return new Promise((resolve, reject) => {
    const timeoutMs = clampTimeout(config, message.timeoutMs);
    const prepared = prepareCommandInput(message, normalizeArgs(message.args));
    const args = prepared.args;
    const cwd = config.allowCwd && message.cwd ? String(message.cwd) : ROOT;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      prepared.cleanup();
    };
    const child = spawnPortable(commandPath, args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch {}
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      cleanup();
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      cleanup();
      const out = capOutput(stdout, config.maxOutputBytes);
      const err = capOutput(stderr, config.maxOutputBytes);
      resolve({
        action: "run",
        command: path.basename(commandPath),
        exitCode,
        signal,
        timedOut,
        stdout: out.text,
        stderr: err.text,
        truncated: out.truncated || err.truncated,
        materializedInputFile: prepared.materializedInputFile,
      });
    });

    if (prepared.stdin) child.stdin.end(prepared.stdin);
    else child.stdin.end();
  });
}

if (require.main === module) {
  startNativeHost();
}

module.exports = {
  defaultConfig,
  loadConfig,
  loadConfigWithMeta,
  startNativeHost,
  handleMessage,
  diagnoseConfig,
  validateConfig,
  commandCandidates,
  expandEnvVars,
  resolveOnPath,
  resolveAllowedCommand,
  normalizeArgs,
  clampTimeout,
  capOutput,
  assertSafeWindowsCmdArg,
  quoteWinArg,
  spawnPortable,
  shouldMaterializeFeishuDocxInput,
  prepareCommandInput,
};
