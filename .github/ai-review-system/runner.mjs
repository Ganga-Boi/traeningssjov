import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { reviewFiles } from "./static-review.mjs";
import { writeReports } from "./report.mjs";

const ignored = new Set([".git", ".next", "node_modules", "coverage", "qa-output"]);

async function walk(directory, extensions, files = []) {
  for (const entry of await readdir(directory)) {
    if (ignored.has(entry)) continue;
    const absolutePath = join(directory, entry);
    const info = await stat(absolutePath);
    if (info.isDirectory()) await walk(absolutePath, extensions, files);
    else if (extensions.some((extension) => entry.endsWith(extension))) files.push(absolutePath);
  }
  return files;
}

function execute(command, cwd, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, { cwd, shell: true, env: process.env });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ command, exitCode, ok: exitCode === 0, output: output.slice(-20000) });
    });
  });
}

function prompt(role, evidencePath) {
  return `# Uafhængig ${role}

Du må kun analysere. Du må ikke ændre kode.

Brug evidenspakken: \`${evidencePath}\`.

For hvert fund skal du returnere severity, fil, linje, reproduktion, bevis, risiko og foreslået løsning.
Markér antagelser tydeligt. Et fund uden konkret bevis må ikke klassificeres som Critical.
`;
}

export async function runAudit(config, configPath) {
  const configDirectory = dirname(configPath);
  const projectRoot = resolve(configDirectory, config.projectRoot);
  const outputDir = resolve(configDirectory, config.outputDir ?? "qa-output");
  await mkdir(outputDir, { recursive: true });

  const commands = [];
  for (const command of config.commands ?? []) {
    commands.push(await execute(command, projectRoot, config.commandTimeoutMs ?? 300000));
  }

  const files = await walk(projectRoot, [".ts", ".tsx", ".js", ".mjs", ".sql", ".json"]);
  const findings = await reviewFiles(projectRoot, files);

  for (const command of commands.filter((item) => !item.ok)) {
    findings.push({
      severity: "important",
      rule: "command.failed",
      file: ".",
      line: 1,
      evidence: `${command.command} fejlede med exitkode ${command.exitCode}`,
      risk: "Projektets deterministiske kvalitetskontrol er ikke grøn.",
      suggestion: "Læs kommandoens output i evidence.json og ret den konkrete fejl.",
      verified: true,
    });
  }

  const evidence = {
    projectName: config.projectName,
    createdAt: new Date().toISOString(),
    projectRoot,
    scannedFiles: files.map((file) => relative(projectRoot, file)),
    commands,
    config: JSON.parse(await readFile(configPath, "utf8")),
  };

  const prompts = {
    technical: prompt("Technical Reviewer", "../evidence.json"),
    database: prompt("Database Reviewer", "../evidence.json"),
    security: prompt("Security Reviewer", "../evidence.json"),
    judge: prompt("Judge", "../evidence.json"),
  };

  return writeReports(outputDir, evidence, findings, prompts);
}
