import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const order = { critical: 0, important: 1, minor: 2 };

function markdownFinding(item, index) {
  return [
    `### ${index + 1}. [${item.severity.toUpperCase()}] ${item.rule}`,
    "",
    `- Fil: \`${item.file}:${item.line}\``,
    `- Verificeret: ${item.verified ? "ja" : "nej"}`,
    `- Bevis: ${item.evidence}`,
    `- Risiko: ${item.risk}`,
    `- Forslag: ${item.suggestion}`,
    "",
  ].join("\n");
}

export async function writeReports(outputDir, evidence, findings, prompts) {
  await mkdir(outputDir, { recursive: true });
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = {
    critical: sorted.filter((item) => item.severity === "critical").length,
    important: sorted.filter((item) => item.severity === "important").length,
    minor: sorted.filter((item) => item.severity === "minor").length,
  };

  const markdown = [
    "# AI Review System – Judge-rapport",
    "",
    `Kørt: ${evidence.createdAt}`,
    `Projekt: ${evidence.projectName}`,
    "",
    `Critical: **${counts.critical}** · Important: **${counts.important}** · Minor: **${counts.minor}**`,
    "",
    "## Deterministiske kommandoer",
    "",
    ...evidence.commands.map((command) =>
      `- \`${command.command}\`: ${command.ok ? "bestået" : `fejlet (${command.exitCode})`}`),
    "",
    "## Fund",
    "",
    ...(sorted.length ? sorted.flatMap(markdownFinding) : ["Ingen statiske fund.", ""]),
    "## Reviewer-prompts",
    "",
    "Prompts ligger separat i mappen `review-prompts/` og må analyseres uafhængigt.",
    "",
  ].join("\n");

  const reportPath = join(outputDir, "judge-report.md");
  await writeFile(reportPath, markdown);
  await writeFile(join(outputDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  await writeFile(join(outputDir, "findings.json"), JSON.stringify(sorted, null, 2));

  const promptDir = join(outputDir, "review-prompts");
  await mkdir(promptDir, { recursive: true });
  for (const [name, prompt] of Object.entries(prompts)) {
    await writeFile(join(promptDir, `${name}.md`), prompt);
  }

  return { reportPath, counts };
}
