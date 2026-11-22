// relations-memo-format.test.js — docs/llm-wiki/relations.md のmemo format契約ガード。
//
// a767de0 は散文だったrelations memoを、Repository relations memo format
// （Repository行・## <repo-id>節・Status: confirmed|hypothesis行・Evidence行）
// へ移行した。Evidenceは機械可読であることが契約の要: 1物理行・生相対パス・
// sha256は64小文字16進で、バッククォート・括弧注記・行番号・後続散文を
// 含む状態への回帰をここで機械検査する。出典hashの値そのものの現行性は
// contracts側の現物照合が必要でCIから観測不能 — このテストは書式のみを守り、
// hashの再確認はmemoのChange rule(log.mdへ検証付き追記)の運用に任せる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const memoPath = path.join(repoRoot, "docs", "llm-wiki", "relations.md");

// 安定repo-id: 小始まり英数とハイフン・アンダースコア。日本語散文見出しを弾く
const REPO_ID = /^[a-z0-9][a-z0-9_-]*$/;
// Evidence行: `- Evidence: <repo-id>:<生パス> sha256:<64小文字hex>` の1物理行のみ
const EVIDENCE =
  /^- Evidence: ([a-z0-9][a-z0-9_-]*):([A-Za-z0-9_@./-]+) sha256:([0-9a-f]{64})$/;
const STATUS = /^- Status: (confirmed|hypothesis)$/;
const FOLLOWUP = /^- Follow-up: \[( |x)\] \S/;

function parseSections(md) {
  const sections = [];
  let current = null;
  for (const line of md.split("\n")) {
    const m = line.match(/^## (.+)$/);
    if (m) {
      current = { title: m[1].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections;
}

test("relations memoはRepository行を持ち、自repoの安定IDと一致する", async () => {
  const md = await readFile(memoPath, "utf8");
  assert.match(md, /^# Repository relations\n/, "memo先頭の契約見出しが無い");
  const m = md.match(/^Repository: (.+)$/m);
  assert.ok(m, "Repository: 行が無い — memoの主体が機械可読でない");
  const id = m[1].trim();
  assert.match(id, REPO_ID, `Repository IDが安定ID書式でない: ${id}`);
  assert.equal(id, "connectivebyte-web", "Repository IDが自repoと不一致");
});

test("各関係節はrepo-id見出し・Status・Evidence行を持ち、Evidenceは機械可読な1物理行", async () => {
  const md = await readFile(memoPath, "utf8");
  const sections = parseSections(md);
  if (sections.length === 0) {
    assert.match(
      md,
      /No evidenced relationships yet/,
      "関係節が無いのに『No evidenced relationships yet』注記も無い"
    );
    return;
  }
  for (const section of sections) {
    assert.match(
      section.title,
      REPO_ID,
      `節見出し『${section.title}』がrepo-idでない — 関係の主体は機械可読なrepo-idで書く`
    );
    assert.ok(
      section.lines.some((l) => STATUS.test(l)),
      `## ${section.title} にStatus: confirmed|hypothesis行が無い`
    );
    const evidences = section.lines.filter((l) => l.startsWith("- Evidence:"));
    assert.ok(
      evidences.length > 0,
      `## ${section.title} にEvidence行が無い — 出典無しの関係主張は契約違反`
    );
    for (const line of evidences) {
      assert.match(
        line,
        EVIDENCE,
        `## ${section.title} のEvidence行が契約書式でない:\n  ${line}\n` +
          "期待: `- Evidence: <repo-id>:<生パス> sha256:<64小文字hex>` の1物理行" +
          "（バッククォート・括弧注記・行番号・後続散文は不可）"
      );
    }
    for (const line of section.lines) {
      if (line.startsWith("- Follow-up:")) {
        assert.match(
          line,
          FOLLOWUP,
          `## ${section.title} のFollow-up行が『- Follow-up: [ ] <内容>』書式でない:\n  ${line}`
        );
      }
    }
  }
});
