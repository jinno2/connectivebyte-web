// relations-memo.test.js — llm-wiki relations memoのEvidence契約ガード。
//
// docs/llm-wiki/relations.md の Evidence 行は「repo:path sha256:<64hex>」の
// 機械可読契約 (repo-relations-sync 配布物: 1物理行・raw相対path・注記なし)。
// 6a08f39 で親関係 (tas_launchops) の証跡をこの形に整形したが、参照先
// ファイルが更新されても memo が放置されると hash が静かに腐る — 実bytes
// との照合を npm test に組み込み、腐った証跡を再検証漏れとして検出する。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MEMO_RELPATH = path.join("docs", "llm-wiki", "relations.md");

// 契約形: "- Evidence: <repo-id>:<相対path> sha256:<64小文字hex>"。
// 行番号・括弧注記・backtick・Markdown link・後続proseは全て不合格になる。
const EVIDENCE_RE = /^(?:- )?Evidence: ([A-Za-z0-9][A-Za-z0-9_-]*):(\S+) sha256:([0-9a-f]{64})$/;

function parseEvidences(memo) {
  const repoId = memo.match(/^Repository: (\S+)$/m)?.[1];
  assert.ok(repoId, `${MEMO_RELPATH}: Repository: 行が無い`);
  const evidences = [];
  for (const [i, line] of memo.split("\n").entries()) {
    if (!/^(?:- )?Evidence:/.test(line)) continue;
    const m = line.match(EVIDENCE_RE);
    assert.ok(m, `${MEMO_RELPATH}:${i + 1}: Evidence行が契約形でない: ${line}`);
    assert.doesNotMatch(m[2], /(^\/|\.\.|\\)/,
      `${MEMO_RELPATH}:${i + 1}: Evidence pathがraw相対pathでない: ${m[2]}`);
    evidences.push({ repo: m[1], rel: m[2], hash: m[3] });
  }
  assert.ok(evidences.length > 0, `${MEMO_RELPATH}: Evidence行が0件 — 証跡なしの関係主張`);
  return { repoId, evidences };
}

test("relations memoのEvidence行は機械可読契約に従う", async () => {
  const memo = await readFile(path.join(repoRoot, MEMO_RELPATH), "utf8");
  parseEvidences(memo);
});

test("relations memoの自リポEvidenceは実ファイルのsha256と一致する", async () => {
  const memo = await readFile(path.join(repoRoot, MEMO_RELPATH), "utf8");
  const { repoId, evidences } = parseEvidences(memo);
  const local = evidences.filter((e) => e.repo === repoId);
  assert.ok(local.length > 0,
    `${MEMO_RELPATH}: 自リポ (${repoId}) のEvidenceが0件 — hash照合ガードが空転する`);
  for (const e of local) {
    // 無いファイルはENOENTで失敗 = 腐った証跡。外部リポ (contracts等) は
    // checkout状態が非決定のため形式検査のみ (1件目のtest) に委ねる。
    const bytes = await readFile(path.join(repoRoot, e.rel));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(hash, e.hash,
      `${e.rel} の実bytesがmemoのhashと不一致 — 再検証して ${MEMO_RELPATH} を更新すること`);
  }
});
