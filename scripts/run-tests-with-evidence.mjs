// node --test 透過ラッパー。出力とexit codeを変えず、完了した実行コレクションから
// CI観測に必要なevidence (実ワーカー数・テストサマリー・ジョブ毎件数) を出す。
// node --test はテストfile毎に子processを起動するため、完了報告に現れたfile数が
// 実ワーカー数になる (計画値・環境上限ではなく実績)。数えられない場合は捏造せず
// unavailableを出す。
import { spawn } from "node:child_process";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const passthroughArgs = process.argv.slice(2);
// outreach公開パイプラインの隔離ガードが npm test を再帰実行する (envを継承)。
// ジョブレベルのevidence (step summary・per-job件数) は最上位runだけが書く。
const NESTED_VAR = "CB_TEST_EVIDENCE_NESTED";
const nested = process.env[NESTED_VAR] === "1";
const workDir = await mkdtemp(path.join(tmpdir(), "cb-test-evidence-"));
const junitPath = path.join(workDir, "junit.xml");

const child = spawn(
  process.execPath,
  [
    "--test",
    "--test-reporter=tap",
    "--test-reporter-destination=stdout",
    "--test-reporter=junit",
    `--test-reporter-destination=${junitPath}`,
    ...passthroughArgs,
  ],
  { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, [NESTED_VAR]: "1" } },
);

let stdoutText = "";
child.stdout.pipe(process.stdout);
child.stdout.on("data", (chunk) => {
  stdoutText += chunk;
});
child.stderr.pipe(process.stderr);

const exitCode = await new Promise((resolve) => {
  child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});

const tapCount = (name) => {
  const m = stdoutText.match(new RegExp(`^# ${name} (\\d+)`, "m"));
  return m ? Number(m[1]) : null;
};

try {
  const totals = {
    tests: tapCount("tests"),
    pass: tapCount("pass"),
    fail: tapCount("fail"),
    skipped: tapCount("skipped"),
    cancelled: tapCount("cancelled"),
    todo: tapCount("todo"),
  };
  const duration = stdoutText.match(/^# duration_ms ([0-9.]+)/m)?.[1] ?? "unknown";

  const junitXml = await readFile(junitPath, "utf8");
  const perSuite = new Map();
  // テスト名は生の ">" を含み得るため [^>] では打ち切られる —
  // <testcase 境界で区切り、各チャンク内で file="..." を取る (属性値の生 " は escape 済み)。
  for (const entry of junitXml.split(/<testcase\b/).slice(1)) {
    const m = entry.match(/\bfile="([^"]*)"/);
    const file = m ? path.relative(process.cwd(), m[1]) || m[1] : "(no file attribution)";
    perSuite.set(file, (perSuite.get(file) ?? 0) + 1);
  }
  const suiteCases = [...perSuite.values()].reduce((sum, n) => sum + n, 0);
  const agree =
    totals.tests !== null ? `junit=${suiteCases} tap=${totals.tests} match=${suiteCases === totals.tests}` : "tap-missing";

  const scope = nested ? " scope=nested" : "";
  for (const [file, cases] of [...perSuite.entries()].sort()) {
    console.log(`ci-evidence:${scope} worker suite=${file} cases=${cases}`);
  }
  console.log(`ci-evidence:${scope} actual-workers=${perSuite.size} collection-agreement(${agree})`);
  console.log(
    `ci-evidence:${scope} test-summary tests=${totals.tests} pass=${totals.pass} fail=${totals.fail}` +
      ` skipped=${totals.skipped} cancelled=${totals.cancelled} todo=${totals.todo} duration_ms=${duration}`,
  );
  if (!nested) {
    const job = process.env.GITHUB_JOB ? ` job=${process.env.GITHUB_JOB}` : "";
    console.log(
      `ci-evidence: per-job-test-count${job} tests=${totals.tests} pass=${totals.pass} fail=${totals.fail}`,
    );
  }

  if (!nested && process.env.GITHUB_STEP_SUMMARY) {
    const rows = [...perSuite.entries()].sort()
      .map(([file, cases]) => `| ${file} | ${cases} |`);
    const summary = [
      "### Test evidence (completed run)",
      "",
      `- actual workers (completed test files): ${perSuite.size}`,
      `- tests ${totals.tests} / pass ${totals.pass} / fail ${totals.fail}` +
        ` / skipped ${totals.skipped} / cancelled ${totals.cancelled} / todo ${totals.todo}`,
      `- duration_ms ${duration} — ${agree}`,
      "",
      "| suite | cases |",
      "|---|---|",
      ...rows,
      "",
    ].join("\n");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
} catch {
  console.log("ci-evidence: test-summary unavailable (completed collection report missing; counts not fabricated)");
}

await rm(workDir, { recursive: true, force: true });
process.exitCode = exitCode;
