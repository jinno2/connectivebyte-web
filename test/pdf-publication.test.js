import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { scanFile, artifactFiles } from "./pdf-publication.js";

function stream(data, dictionary = "") {
  const bytes = Buffer.from(data);
  return Buffer.concat([Buffer.from(`<< /Length ${bytes.length} ${dictionary} >>\nstream\n`), bytes, Buffer.from("\nendstream")]);
}

// 合成の最小PDF。実際のparserで本文・辞書・streamの境界を検証する。
function pdf({ text = "Public guide", title = "Public title", catalog = "", page = "", extra } = {}) {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${catalog} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R ${page} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream(`BT /F1 12 Tf 30 200 Td (${text}) Tj ET`),
    `<< /Title (${title}) >>`,
    ...(extra ? [extra] : []),
  ];
  const chunks = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let size = chunks[0].length;
  objects.forEach((value, i) => {
    offsets.push(size);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(value), Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    size += chunk.length;
  });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "publication-guard-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function fixture(t, options, name = "guide.pdf") {
  const file = path.join(await directory(t), name);
  await writeFile(file, pdf(options));
  return file;
}

test("既存PDFの圧縮バイト偶然一致を本文と混同しない", async () => {
  const file = new URL("../content/17-org-pdf/organization-guide.pdf", import.meta.url);
  assert.match((await readFile(file)).toString("latin1"), /L1[01]/);
  assert.doesNotMatch(await scanFile(file.pathname), /L1[01]/);
});

test("圧縮streamの偶然一致は無視し、拡張子なしPDFも本文検査する", async (t) => {
  const file = await fixture(t, { extra: stream(deflateSync("L11", { level: 0 }), "/Filter /FlateDecode") }, "renamed");
  assert.match((await readFile(file)).toString("latin1"), /L11/);
  assert.doesNotMatch(await scanFile(file), /L11/);
  assert.match(await scanFile(await fixture(t, { text: "L11" }, "renamed")), /L11/);
});

test("本文・情報辞書・注釈・リンク・構造タグ・XMPの禁止語を抽出する", async (t) => {
  const cases = [
    { text: "L11" },
    { title: "L11" },
    { page: "/Annots [7 0 R]", extra: "<< /Type /Annot /Subtype /Text /Rect [0 0 20 20] /Contents (L11) >>" },
    { page: "/Annots [7 0 R]", extra: "<< /Type /Annot /Subtype /Link /Rect [0 0 20 20] /A << /S /URI /URI (https://example.test/L11) >> >>" },
    { catalog: "/StructTreeRoot 7 0 R", extra: "<< /Type /StructTreeRoot /Alt (L11) >>" },
    { catalog: "/Metadata 7 0 R", extra: stream('<x:xmpmeta xmlns:x="adobe:ns:meta/"><title>L&#49;1</title></x:xmpmeta>', "/Type /Metadata /Subtype /XML") },
  ];
  for (const [index, options] of cases.entries()) {
    assert.match(await scanFile(await fixture(t, options)), /L11/, `case ${index}`);
  }
});

test("未対応機能と増分更新は公開を止める", async (t) => {
  for (const catalog of ["/OCProperties << >>", "/AcroForm << /Fields [] >>", "/OpenAction << /S /JavaScript /JS (1) >>", "/Names << /EmbeddedFiles << /Names [] >> >>"]) {
    await assert.rejects(scanFile(await fixture(t, { catalog })), /未対応|検査できない/);
  }
  const incremental = await fixture(t);
  await writeFile(incremental, Buffer.concat([await readFile(incremental), Buffer.from("startxref\n0\n%%EOF\n")]));
  await assert.rejects(scanFile(incremental), /増分更新/);
  const encrypted = path.join(await directory(t), "encrypted.pdf");
  execFileSync("qpdf", ["--encrypt", "", "owner", "256", "--", await fixture(t), encrypted]);
  await assert.rejects(scanFile(encrypted), /検査できない|未対応/);
});

test("本文なし・画像・不正PDF・読取り失敗・symlinkは公開を止める", async (t) => {
  await assert.rejects(scanFile(await fixture(t, { text: "" })), /本文を抽出できない/);
  const image = stream(Buffer.from([0, 0, 0]), "/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8");
  await assert.rejects(scanFile(await fixture(t, { extra: image })), /画像/);
  const dir = await directory(t);
  await writeFile(path.join(dir, "bad.pdf"), "not a PDF");
  await assert.rejects(scanFile(path.join(dir, "bad.pdf")), /不正/);
  await assert.rejects(scanFile(path.join(dir, "missing")), /ENOENT/);
  await symlink(await fixture(t), path.join(dir, "link.pdf"));
  await assert.rejects(scanFile(path.join(dir, "link.pdf")), /通常のファイル/);
  await assert.rejects(artifactFiles(dir), /通常のファイル/);
});

test("PDFツールの未導入と終了コード0の警告も検査失敗にする", async (t) => {
  const dir = await directory(t);
  const file = await fixture(t);
  const helper = new URL("./pdf-publication.js", import.meta.url).href;
  const probe = `import { scanFile } from ${JSON.stringify(helper)}; await scanFile(process.argv[1]);`;
  const env = { ...process.env, PATH: dir };
  assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", probe, file], { env, stdio: "pipe" }), /ENOENT/);
  await writeFile(path.join(dir, "qpdf"), `#!${process.execPath}\nprocess.stderr.write("Syntax Error: synthetic warning");\n`, { mode: 0o755 });
  assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", probe, file], { env, stdio: "pipe" }), /synthetic warning/);
});

test("公開成果物には未追跡ファイルとtest配下も含める", async (t) => {
  const dir = await directory(t);
  await mkdir(path.join(dir, "test"));
  const file = path.join(dir, "test", "line\nbreak.txt");
  await writeFile(file, "L11");
  assert.deepEqual(await artifactFiles(dir), [file]);
  assert.match(await scanFile(file), /L11/);
});


test("Catalog外と型なしのメタデータstreamを検査済みにしない", async (t) => {
  const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><title>L11</title></x:xmpmeta>';
  await assert.rejects(scanFile(await fixture(t, {
    page: "/Metadata 7 0 R", extra: stream(xml, "/Type /Metadata /Subtype /XML"),
  })), /メタデータ/);
  await assert.rejects(scanFile(await fixture(t, {
    catalog: "/Metadata 7 0 R", extra: stream(xml, "/Subtype /XML"),
  })), /メタデータ/);
});


test("文字対応表がない、または参照不正な複合フォントは停止する", async (t) => {
  for (const extra of [
    "<< /Type /Font /Subtype /Type3 >>",
    "<< /Type /Font /Subtype /Type0 /ToUnicode 6 0 R >>",
  ]) await assert.rejects(scanFile(await fixture(t, { extra })), /文字対応表/);
});


test("UTF-16のXMPを文字化けしたまま検査済みにしない", async (t) => {
  const xml = Buffer.from('\ufeff<x:xmpmeta xmlns:x="adobe:ns:meta/"><title>L11</title></x:xmpmeta>', "utf16le");
  for (const data of [xml, Buffer.from(xml).swap16()]) {
    await assert.rejects(scanFile(await fixture(t, {
      catalog: "/Metadata 7 0 R", extra: stream(data, "/Type /Metadata /Subtype /XML"),
    })), /UTF-8以外|pdfinfo/);
  }
});
