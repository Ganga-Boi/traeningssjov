import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAudit } from "./runner.mjs";

async function main() {
  const projectRoot = process.env.GITHUB_WORKSPACE;
  if (!projectRoot) throw new Error("GITHUB_WORKSPACE mangler");

  const commands = JSON.parse(process.env.INPUT_COMMANDS ?? "[]");
  if (!Array.isArray(commands) || commands.some((command) => typeof command !== "string")) {
    throw new Error("commands skal være et JSON-array af strenge");
  }

  const config = {
    projectName: process.env.INPUT_PROJECT_NAME || process.env.GITHUB_REPOSITORY || "GitHub project",
    projectRoot,
    outputDir: join(projectRoot, "qa-output"),
    commandTimeoutMs: 300000,
    commands,
  };

  const configPath = join(tmpdir(), `mini-qa-${process.pid}.json`);
  await writeFile(configPath, JSON.stringify(config));
  const result = await runAudit(config, configPath);

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "## AI Review System",
        "",
        `- Critical: **${result.counts.critical}**`,
        `- Important: **${result.counts.important}**`,
        `- Minor: **${result.counts.minor}**`,
        "",
        "Den fulde Judge-rapport findes i workflow-artifactet `ai-qa-report`.",
        "",
      ].join("\n"),
    );
  }

  if (result.counts.critical > 0) {
    throw new Error(`${result.counts.critical} dokumenterede Critical-fund`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
