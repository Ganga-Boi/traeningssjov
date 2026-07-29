import { readFile } from "node:fs/promises";
import { relative } from "node:path";

function finding(severity, rule, file, line, evidence, risk, suggestion) {
  return { severity, rule, file, line, evidence, risk, suggestion, verified: true };
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

export async function reviewFiles(projectRoot, files) {
  const findings = [];
  const sqlDefinitions = new Set();
  const rpcCalls = [];
  let anonResetAccess = null;

  for (const absolutePath of [...files].sort()) {
    const file = relative(projectRoot, absolutePath);
    const content = await readFile(absolutePath, "utf8");

    for (const match of content.matchAll(/create\s+or\s+replace\s+function\s+(?:public\.)?([a-z0-9_]+)/gi)) {
      sqlDefinitions.add(match[1]);
    }

    for (const match of content.matchAll(/\.rpc\(\s*["']([a-z0-9_]+)["']/gi)) {
      rpcCalls.push({ name: match[1], file, line: lineNumber(content, match.index) });
    }

    if (file.endsWith(".sql")) {
      for (const match of content.matchAll(/security\s+definer/gi)) {
        const tail = content.slice(match.index, match.index + 300);
        if (!/set\s+search_path\s*=/i.test(tail)) {
          findings.push(finding(
            "important",
            "sql.security-definer-search-path",
            file,
            lineNumber(content, match.index),
            "SECURITY DEFINER uden efterfølgende SET search_path",
            "Objektnavne kan blive opløst i et uventet schema.",
            "Fastlås search_path og schema-kvalificér alle objekter.",
          ));
        }
      }

      let statementStart = 0;
      for (const statement of content.split(";")) {
        if (/\breset[a-z0-9_]*\b/i.test(statement)) {
          const grantsAnon =
            /\bgrant\s+execute\b/i.test(statement) &&
            /\bto\b[\s\S]*\banon\b/i.test(statement);
          const revokesAnon =
            /\brevoke\b/i.test(statement) &&
            /\bfrom\b[\s\S]*\banon\b/i.test(statement);

          if (grantsAnon || revokesAnon) {
            anonResetAccess = {
              granted: grantsAnon,
              file,
              line: lineNumber(content, statementStart),
              evidence: statement.replace(/\s+/g, " ").trim(),
            };
          }
        }
        statementStart += statement.length + 1;
      }

      for (const match of content.matchAll(/create\s+policy[\s\S]{0,300}?\bto\s+anon[\s\S]{0,300}?\bfor\s+all[\s\S]{0,150}?using\s*\(\s*true\s*\)[\s\S]{0,150}?with\s+check\s*\(\s*true\s*\)/gi)) {
        findings.push(finding(
          "critical",
          "sql.anon-all-policy",
          file,
          lineNumber(content, match.index),
          match[0].replace(/\s+/g, " ").trim(),
          "Anon får ubegrænset direkte skriveadgang.",
          "Erstat ALL-policy med mindst mulige SELECT/RPC-rettigheder.",
        ));
      }
    }

    if (/NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE|SECRET|PRIVATE)/.test(content)) {
      const index = content.search(/NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE|SECRET|PRIVATE)/);
      findings.push(finding(
        "critical",
        "client.public-secret",
        file,
        lineNumber(content, index),
        content.match(/NEXT_PUBLIC_[A-Z0-9_]*(?:SERVICE|SECRET|PRIVATE)/)?.[0] ?? "Offentlig secret",
        "En hemmelig nøgle kan blive eksponeret i browseren.",
        "Flyt nøglen til servermiljøet og rotér den.",
      ));
    }
  }

  if (anonResetAccess?.granted) {
    findings.push(finding(
      "critical",
      "sql.anon-reset",
      anonResetAccess.file,
      anonResetAccess.line,
      anonResetAccess.evidence,
      "En offentlig klient kan potentielt nulstille data.",
      "Fjern anon EXECUTE og flyt reset til en autentificeret admin-kanal.",
    ));
  }

  for (const call of rpcCalls) {
    if (!sqlDefinitions.has(call.name)) {
      findings.push(finding(
        "important",
        "rpc.missing-definition",
        call.file,
        call.line,
        `Frontend kalder RPC '${call.name}', men ingen definition blev fundet i de scannede SQL-filer.`,
        "Deploy kan fejle ved runtime eller databasen kan være ude af synkronisering.",
        "Tilføj/identificér den idempotente migration og sammenlign med live-definitionen.",
      ));
    }
  }

  return findings;
}
