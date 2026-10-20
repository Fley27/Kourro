const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "dashboard-data");
const OUT_DIR = path.join(ROOT, "reports");
const OUT_FILE = path.join(OUT_DIR, "index.html");

const REPOS = [
  { id: "shared", name: "Shared Package (Kourro-shared)", repo: "Fley27/Kourro-shared" },
  { id: "kourro", name: "Backend / Middleware / Packages (Kourro)", repo: "Fley27/Kourro" },
  { id: "mobile-app", name: "Mobile App (Kourro-mobile-app)", repo: "Fley27/Kourro-mobile-app" },
  { id: "web-app", name: "Web App (Kourro-web-app)", repo: "Fley27/Kourro-web-app" },
  { id: "admin-portal", name: "Admin Panel (Kourro-admin-portal)", repo: "Fley27/Kourro-admin-portal" },
];

const STATUS_COLOR = {
  success: "#16a34a",
  failure: "#dc2626",
  cancelled: "#6b7280",
  skipped: "#eab308",
  null: "#9ca3af",
};

function loadData(id) {
  const file = path.join(DATA_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function badgeWithDash(status) {
  if (status === "-") {
    return `<span class="badge" style="background:#374151">n/a</span>`;
  }
  return badge(status);
}

function badge(status) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.null;
  const label = status === null ? "not run" : status;
  return `<span class="badge" style="background:${color}">${label}</span>`;
}

function row(repo, data) {
  const run = data?.run_id ?? "—";
  const sha = data?.sha ?? "—";
  const updated = data?.updated_at ?? "—";
  const url = data?.url ?? `https://github.com/${repo.repo}/actions`;
  return `
    <tr>
      <td><a href="${url}" target="_blank" rel="noopener">${repo.name}</a></td>
      <td><a href="https://github.com/${repo.repo}/commit/${sha}" target="_blank" rel="noopener" style="text-decoration:none;color:#374151">${sha.slice(0,7)}</a></td>
      <td>${badge(data?.lint)}</td>
      <td>${badge(data?.typecheck)}</td>
      <td>${badge(data?.unit)}</td>
      <td>${badge(data?.component)}</td>
      <td>${badge(data?.e2e)}</td>
      <td>${data?.publish ? badgeWithDash(data?.publish) : "<span class=\"badge\" style=\"background:#374151\">n/a</span>"}</td>
      <td class="mono">${updated}</td>
      <td class="run">${run === "—" ? "—" : `<a href="${url}/runs/${run}" target="_blank" rel="noopener">run #${run}</a>`}</td>
    </tr>
`;
}

function generate(dataByRepo) {
  const rows = REPOS.map((r) => row(r, dataByRepo[r.id])).join("");
  const allPass = REPOS.every((r) => {
    const d = dataByRepo[r.id];
    return !!d && ["lint", "typecheck", "unit", "component", "e2e"].every((k) => d[k] === "success");
  });
  const overall = allPass ? "success" : REPOS.some((r) => {
    const d = dataByRepo[r.id];
    return !!d && ["lint", "typecheck", "unit", "component", "e2e"].some((k) => d[k] === "failure");
  }) ? "failure" : "mixed";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Kourro — Consolidated Test Dashboard</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; background: #0b1021; color: #e5e7eb; }
  header { background: #060d1a; border-bottom: 1px solid #1f2937; padding: 1rem 2rem; display: flex; align-items: center; gap: 1rem; }
  h1 { font-size: 1.125rem; margin: 0; letter-spacing: -0.02em; }
  .subtitle { color: #9ca3af; font-size: 0.875rem; }
  main { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1rem; }
  .overall { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.9rem; border-radius: 0.5rem; font-weight: 600; font-size: 0.875rem; margin-bottom: 1rem; }
  .overall.success { background: #16a34a22; color: #4ade80; border: 1px solid #16a34a44; }
  .overall.failure { background: #dc262622; color: #f87171; border: 1px solid #dc262644; }
  .overall.mixed { background: #eab30822; color: #fde047; border: 1px solid #eab30844; }
  table { width: 100%; border-collapse: collapse; background: #111827; border: 1px solid #1f2937; border-radius: 0.75rem; overflow: hidden; }
  th { background: #060d1a; color: #9ca3af; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.875rem 1rem; text-align: left; font-weight: 600; }
  td { padding: 0.875rem 1rem; border-bottom: 1px solid #1f2937; font-size: 0.875rem; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1f293733; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.7rem; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.03em; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; color: #9ca3af; }
  .run a { color: #60a5fa; text-decoration: underline; }
  .run { color: #9ca3af; }
  .note { margin-top: 1.25rem; color: #6b7280; font-size: 0.8rem; line-height: 1.5; }
  .note code { background: #1f2937; padding: 0.1rem 0.3rem; border-radius: 0.25rem; }
</style>
</head>
<body>
<header>
  <span style="font-weight:800;letter-spacing:-0.03em">Kourro</span>
  <span class="subtitle">• Consolidated Test Dashboard</span>
</header>
<main>
  <div class="overall ${overall}">
    <span style="width:8px;height:8px;border-radius:50%;background:${STATUS_COLOR[overall]}"></span>
    Overall pipeline status: <b>${overall.toUpperCase()}</b>
  </div>
  <table>
    <thead><tr>
      <th>Repository</th>
      <th>Commit</th>
      <th>Lint</th>
      <th>Typecheck</th>
      <th>Unit</th>
      <th>Component</th>
      <th>E2E</th>
      <th>Publish</th>
      <th>Updated</th>
      <th>Run</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="note">
    <strong>How it works:</strong> Each repository runs its own GitHub Actions pipeline
    (lint → typecheck → unit → component → e2e, failing fast). After a run, the repo posts
    its result JSON via <code>repository_dispatch</code> to this dashboard (requires a PAT with
    <code>repo</code> scope stored as <code>DASHBOARD_PAT</code> in the source repo), or the dashboard
    refreshes on a daily schedule. Results are aggregated here so backend, mobile, web, and admin
    panel can be reviewed in one place instead of four separate repos.
  </div>
  <div class="note">Last generated: <b>${new Date().toISOString()}</b></div>
</main>
</body>
</html>`;
}

function markdown(dataByRepo) {
  const lines = ["## Consolidated pipeline status", ""];
  lines.push("| Repository | Commit | Lint | Typecheck | Unit | Component | E2E | Publish |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of REPOS) {
    const d = dataByRepo[r.id];
    const st = (k) => (d && d[k] ? `\`${d[k]}\`` : "—");
    lines.push(
      `| ${r.name} | ${d ? String(d.sha ?? "—").slice(0, 7) : "—"} | ${st("lint")} | ${st("typecheck")} | ${st("unit")} | ${st("component")} | ${st("e2e")} | ${d?.publish ? st("publish") : "n/a"} |`
    );
  }
  lines.push("", `Last generated: ${new Date().toISOString()}`);
  return `${lines.join("\n")}\n`;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dataByRepo = {};
  for (const r of REPOS) dataByRepo[r.id] = loadData(r.id);
  fs.writeFileSync(OUT_FILE, generate(dataByRepo));
  fs.writeFileSync(path.join(OUT_DIR, "dashboard.md"), markdown(dataByRepo));
  console.log(`Wrote ${OUT_FILE}`);
}

main();
