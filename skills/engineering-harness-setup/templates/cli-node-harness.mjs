#!/usr/bin/env node
// foundations: first-principles#15, #21, #22, patterns-that-work#P11-P14
/**
 * Minimal repo-local engineering harness CLI (Node 18+ stdlib only).
 *
 * Companion to harness/bin/harness.py. All subcommands emit envelopes that
 * conform to harness/templates/cli-envelope.schema.json — see printEnvelope().
 *
 * Process exit codes (per FR-04):
 *   0 = pass (status: pass)
 *   1 = fail (status: fail or others not in {pass, unconfigured})
 *   2 = unconfigured (status: unconfigured)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");
const HARNESS_DIR = path.join(ROOT, "harness");
const CONFIG_PATH = path.join(HARNESS_DIR, "config.json");
const ONBOARD_DOC_PATH = path.join(HARNESS_DIR, "skills", "onboard-agent-session.md");
const MAGIC_WAND_PROMPT_PATH = path.join(HARNESS_DIR, "templates", "magic-wand-prompt.md");

const ERROR_CODES = new Set([
  "OK", "UNCONFIGURED", "AUTH_MISSING", "TIMEOUT", "INVALID_ARGS",
  "DEPENDENCY_MISSING", "HEALTH_CHECK_FAILED", "BUILD_FAILED",
  "TEST_FAILED", "PLACEHOLDER_LEAK", "UNKNOWN"
]);

const STATUSES = new Set([
  "pass", "fail", "unconfigured", "degraded",
  "dry-run", "running", "skipped", "unknown"
]);

function exitCodeFor(status) {
  if (status === "pass") return 0;
  if (status === "unconfigured") return 2;
  return 1;
}

function printEnvelope(command, status, options = {}) {
  if (!STATUSES.has(status)) throw new Error(`invalid status: ${status}`);
  const { data, errorCode, errorMessage, nextAction, messages = [], asJson = false } = options;
  if (errorCode && !ERROR_CODES.has(errorCode)) throw new Error(`invalid error.code: ${errorCode}`);

  const payload = { command, status };
  if (data !== undefined) payload.data = data;
  if (errorCode || errorMessage) {
    payload.error = {
      code: errorCode ?? "UNKNOWN",
      message: errorMessage ?? "(no message)"
    };
    if (nextAction) payload.error.next_action = nextAction;
  }
  if (messages.length) payload.messages = messages;

  if (asJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`[${status}] ${command}`);
    for (const line of messages) console.log(`- ${line}`);
    if (payload.error) {
      console.log(`error.code: ${payload.error.code}`);
      console.log(`error.message: ${payload.error.message}`);
      if (nextAction) console.log(`next: ${nextAction}`);
    }
  }

  return exitCodeFor(status);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function commandString(name) {
  const cfg = loadConfig();
  return String(cfg?.commands?.[name] ?? "").trim();
}

const PLACEHOLDER_RE = /\{\{[A-Z_][A-Z0-9_]*\}\}/;

function assertNoPlaceholderLeaks() {
  const leaks = [];
  const checked = [path.join(HARNESS_DIR, "config.json"), path.join(ROOT, "HARNESS.md"), path.join(ROOT, "AGENTS.md")];
  for (const p of checked) {
    if (fs.existsSync(p) && PLACEHOLDER_RE.test(fs.readFileSync(p, "utf8"))) {
      leaks.push(path.relative(ROOT, p));
    }
  }
  return { ok: leaks.length === 0, leaks };
}

function parseArgs(argv) {
  // Lightweight arg parser — captures --flag, --flag=value, --flag value, and subcommand.
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--") && (key === "tier" || key === "wait")) {
          out.flags[key] = next;
          i++;
        } else {
          out.flags[key] = true;
        }
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

async function cmdDoctor({ flags }) {
  let cfg = loadConfig();
  const waitSeconds = Number(flags.wait ?? 0);
  const deadline = Date.now() + waitSeconds * 1000;

  let configured = [], unconfigured = [];
  while (true) {
    configured = [];
    unconfigured = [];
    for (const [name, value] of Object.entries(cfg.commands ?? {})) {
      if (String(value).trim()) configured.push(name);
      else unconfigured.push(name);
    }
    if ((fs.existsSync(CONFIG_PATH) && configured.length) || Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 1000));
    cfg = loadConfig();
  }

  const healthUrl = String(cfg?.health?.url ?? "").trim();
  const configExists = fs.existsSync(CONFIG_PATH);

  const messages = [
    `Repository root: ${ROOT}`,
    `Harness config: ${configExists ? "found" : "missing"} at ${CONFIG_PATH}`
  ];
  if (configured.length) messages.push("Configured commands: " + configured.sort().join(", "));
  if (unconfigured.length) messages.push("Unconfigured commands: " + unconfigured.sort().join(", "));
  messages.push("Health URL: " + (healthUrl || "not configured"));

  let status = "pass", errorCode, errorMessage;
  if (!configExists) { status = "unconfigured"; errorCode = "UNCONFIGURED"; errorMessage = "harness/config.json is missing"; }
  else if (!configured.length) { status = "degraded"; errorCode = "DEPENDENCY_MISSING"; errorMessage = "config loaded but no commands are configured yet"; }

  return printEnvelope("doctor", status, {
    data: { configured, unconfigured, health_url: healthUrl },
    errorCode, errorMessage,
    nextAction: status !== "pass" ? "Run validate --dry-run, then encode missing commands one at a time." : undefined,
    messages,
    asJson: Boolean(flags.json)
  });
}

function runShell(name, { dryRun, asJson }) {
  return new Promise((resolve) => {
    const cmd = commandString(name);
    if (!cmd) {
      resolve(printEnvelope(name, "unconfigured", {
        errorCode: "UNCONFIGURED",
        errorMessage: `No command configured for '${name}' in harness/config.json.`,
        nextAction: `Set commands.${name} in harness/config.json.`,
        asJson
      }));
      return;
    }
    if (dryRun) {
      resolve(printEnvelope(name, "dry-run", { data: { would_run: cmd }, messages: [`Would run: ${cmd}`], asJson }));
      return;
    }
    const child = spawn(cmd, { cwd: ROOT, shell: true, stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(printEnvelope(name, "pass", { data: { ran: cmd }, asJson }));
      } else {
        const errCode = name === "build" ? "BUILD_FAILED" : (name === "test" ? "TEST_FAILED" : "UNKNOWN");
        resolve(printEnvelope(name, "fail", {
          data: { ran: cmd, exit_code: code },
          errorCode: errCode,
          errorMessage: `'${cmd}' exited with code ${code}.`,
          asJson
        }));
      }
    });
  });
}

async function cmdRun({ flags }) {
  const cfg = loadConfig();
  if (!(cfg?.permissions?.allow_run) && !flags.execute) {
    return printEnvelope("run", "dry-run", {
      data: { would_run: commandString("run") },
      messages: [
        "run is long-running and is dry-run by default.",
        "Pass --execute to actually start the product, or set permissions.allow_run=true."
      ],
      asJson: Boolean(flags.json)
    });
  }
  return runShell("run", { dryRun: Boolean(flags["dry-run"]), asJson: Boolean(flags.json) });
}

async function cmdHealth({ flags }) {
  const cfg = loadConfig();
  const healthCfg = cfg?.health ?? {};
  const url = String(healthCfg.url ?? "").trim();
  const timeoutSeconds = Number(healthCfg.timeout_seconds ?? 30);
  const expected = Number(healthCfg.expected_status ?? 200);

  if (!url) {
    return printEnvelope("health", "unconfigured", {
      errorCode: "UNCONFIGURED",
      errorMessage: "No health URL configured in harness/config.json.",
      nextAction: "Add health.url, then re-run.",
      asJson: Boolean(flags.json)
    });
  }

  if (flags["dry-run"]) {
    return printEnvelope("health", "dry-run", {
      data: { would_request: url, timeout_seconds: timeoutSeconds },
      asJson: Boolean(flags.json)
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: controller.signal });
    const elapsedMs = Date.now() - started;
    const ok = response.status === expected;
    return printEnvelope("health", ok ? "pass" : "fail", {
      data: { url, http_status: response.status, elapsed_ms: elapsedMs },
      errorCode: ok ? undefined : "HEALTH_CHECK_FAILED",
      errorMessage: ok ? undefined : `expected ${expected}, got ${response.status}`,
      asJson: Boolean(flags.json)
    });
  } catch (error) {
    return printEnvelope("health", "fail", {
      data: { url, exception: String(error.message ?? error) },
      errorCode: "HEALTH_CHECK_FAILED",
      errorMessage: `Failed to reach ${url}: ${error.message ?? error}`,
      nextAction: "Check whether the product is running and whether the health URL is correct.",
      asJson: Boolean(flags.json)
    });
  } finally {
    clearTimeout(timer);
  }
}

async function cmdValidate({ flags }) {
  const cfg = loadConfig();
  const tier = String(flags.tier ?? "quick");
  const steps = (cfg?.validation ?? {})[tier];
  if (!Array.isArray(steps) || !steps.length) {
    return printEnvelope("validate", "unconfigured", {
      errorCode: "UNCONFIGURED",
      errorMessage: `validation.${tier} is empty or missing in harness/config.json.`,
      nextAction: `Add steps to validation.${tier} in harness/config.json.`,
      asJson: Boolean(flags.json)
    });
  }

  const results = [];
  let overall = "pass";
  for (const step of steps) {
    if (step === "run") {
      // AC-15: validate never invokes run.
      results.push({ step, status: "skipped", reason: "validate never invokes run; use --execute on run directly" });
      continue;
    }
    let code;
    if (step === "doctor") code = await cmdDoctor({ flags: { json: false, wait: 0 } });
    else if (step === "health") code = await cmdHealth({ flags: { "dry-run": flags["dry-run"], json: false } });
    else code = await runShell(step, { dryRun: Boolean(flags["dry-run"]), asJson: false });
    results.push({ step, exit_code: code });
    if (code === 1) overall = "fail";
    else if (code === 2 && overall === "pass") overall = "degraded";
  }

  const { ok, leaks } = assertNoPlaceholderLeaks();
  if (!ok) {
    return printEnvelope("validate", "fail", {
      data: { tier, results, leaks },
      errorCode: "PLACEHOLDER_LEAK",
      errorMessage: `Found unsubstituted placeholders in: ${leaks.join(", ")}`,
      nextAction: "Resolve placeholders or remove the affected templates before claiming validation.",
      asJson: Boolean(flags.json)
    });
  }

  return printEnvelope("validate", overall, { data: { tier, results }, asJson: Boolean(flags.json) });
}

async function cmdFft({ flags }) {
  return cmdValidate({ flags: { ...flags, tier: "proof" } });
}

async function cmdOnboard({ flags }) {
  if (!fs.existsSync(ONBOARD_DOC_PATH)) {
    return printEnvelope("onboard", "unconfigured", {
      errorCode: "UNCONFIGURED",
      errorMessage: `${path.relative(ROOT, ONBOARD_DOC_PATH)} is missing.`,
      nextAction: "Run engineering-harness-setup to materialise the onboarding guide.",
      asJson: Boolean(flags.json)
    });
  }
  const content = fs.readFileSync(ONBOARD_DOC_PATH, "utf8");
  if (flags.json) {
    return printEnvelope("onboard", "pass", { data: { path: path.relative(ROOT, ONBOARD_DOC_PATH), content }, asJson: true });
  }
  process.stdout.write(content);
  if (!content.endsWith("\n")) process.stdout.write("\n");
  return 0;
}

async function cmdMagicWand({ flags }) {
  let prompt = "";
  if (fs.existsSync(MAGIC_WAND_PROMPT_PATH)) {
    const content = fs.readFileSync(MAGIC_WAND_PROMPT_PATH, "utf8");
    const line = content.split(/\r?\n/).find((l) => l.includes("If you had a magic wand, what ONE thing"));
    if (line) prompt = line.replace(/^>\s*/, "").trim();
  }
  if (!prompt) {
    prompt = "If you had a magic wand, what ONE thing would you change to make the next run easier, safer, faster, or higher quality? Be concrete — name a command, flag, output field, fixture, diagnostic, template, or workflow change.";
  }
  if (flags.json) return printEnvelope("magic-wand", "pass", { data: { prompt }, asJson: true });
  console.log(prompt);
  console.log();
  console.log("Record reviewed candidates in harness/state/friction-log.md.");
  return 0;
}

const COMMANDS = {
  doctor: cmdDoctor,
  install: ({ flags }) => runShell("install", { dryRun: Boolean(flags["dry-run"]), asJson: Boolean(flags.json) }),
  build: ({ flags }) => runShell("build", { dryRun: Boolean(flags["dry-run"]), asJson: Boolean(flags.json) }),
  test: ({ flags }) => runShell("test", { dryRun: Boolean(flags["dry-run"]), asJson: Boolean(flags.json) }),
  lint: ({ flags }) => runShell("lint", { dryRun: Boolean(flags["dry-run"]), asJson: Boolean(flags.json) }),
  format_check: ({ flags }) => runShell("format_check", { dryRun: Boolean(flags["dry-run"]), asJson: Boolean(flags.json) }),
  smoke: ({ flags }) => runShell("smoke", { dryRun: Boolean(flags["dry-run"]), asJson: Boolean(flags.json) }),
  run: cmdRun,
  health: cmdHealth,
  validate: cmdValidate,
  fft: cmdFft,
  onboard: cmdOnboard,
  "magic-wand": cmdMagicWand
};

function printHelp() {
  console.log("Repo-local engineering harness CLI");
  console.log("");
  console.log("Usage:");
  console.log("  node harness/bin/harness.mjs <command> [--json] [--dry-run] [--tier fast|quick|proof] [--wait <sec>]");
  console.log("");
  console.log("Commands:");
  console.log("  doctor [--wait <sec>]      Check harness readiness");
  console.log("  install | build | test | lint | format_check | smoke   Run configured command");
  console.log("  run [--execute]            Start the product (dry-run by default; --execute to spawn)");
  console.log("  health                     Check configured health URL");
  console.log("  validate --tier <t>        Layered validation (default tier: quick)");
  console.log("  fft                        Alias for validate --tier proof");
  console.log("  onboard                    Print the onboarding doc");
  console.log("  magic-wand                 Print the harness improvement prompt");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === "--help" || cmd === "help") {
    printHelp();
    return 0;
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    printHelp();
    return 1;
  }
  return await handler(args);
}

const code = await main();
process.exit(code);
