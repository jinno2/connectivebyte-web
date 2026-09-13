// PDF検査の失敗・未対応形式は公開を止める。通常ファイルの検査範囲は従来どおり。
import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_BYTES = 32 * 1024 * 1024;

async function run(tool, args) {
  const { stdout, stderr } = await exec(tool, args, {
    encoding: "utf8", timeout: 15_000, maxBuffer: MAX_BYTES,
    env: { ...process.env, LC_ALL: "C" },
  });
  if (stderr.trim()) throw new Error(`${tool}: ${stderr.trim()}`);
  return stdout;
}

async function regularPath(file, directory = false) {
  let current = path.resolve(file);
  const stat = await lstat(current);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`通常の${directory ? "ディレクトリ" : "ファイル"}ではない: ${file}`);
  }
  while (path.dirname(current) !== current) {
    current = path.dirname(current);
    if ((await lstat(current)).isSymbolicLink()) throw new Error(`symlink: ${current}`);
  }
  return stat;
}

export async function artifactFiles(root) {
  await regularPath(root, true);
  const files = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, item.name);
    if (item.isDirectory()) files.push(...await artifactFiles(file));
    else {
      await regularPath(file);
      files.push(file);
    }
  }
  return files;
}

function searchable(text) {
  return `${text}\n${text.normalize("NFKC").replace(/\u00ad/g, "").replace(/\s+/g, "")}`;
}

// qpdf JSON v2 の文字列は u: (Unicode) / b: (hex bytes)。辞書キーも検査する。
function objectText(value, chunks) {
  if (Array.isArray(value)) value.forEach((item) => objectText(item, chunks));
  else if (value && typeof value === "object") {
    if (value["/Type"] === "/Font" && ["/Type3", "/Type0"].includes(value["/Subtype"]) && !value["/ToUnicode"]) {
      throw new Error("文字対応表のないフォントのPDFは未対応");
    }
    for (const [key, item] of Object.entries(value)) {
      if (["/Encrypt", "/EmbeddedFiles", "/EF", "/JS", "/JavaScript", "/AA",
        "/OpenAction", "/AcroForm", "/OCProperties", "/OC", "/Prev"].includes(key)) {
        throw new Error(`未対応のPDF機能: ${key}`);
      }
      if (key === "/Subtype" && item === "/Image") throw new Error("画像を含むPDFは未対応");
      if (key === "/Type" && item === "/EmbeddedFile") throw new Error("添付PDFは未対応");
      chunks.push(searchable(key));
      objectText(item, chunks);
    }
  } else if (typeof value === "string") {
    if (value.startsWith("b:")) {
      const bytes = Buffer.from(value.slice(2), "hex");
      chunks.push(searchable(bytes.toString("utf8")), searchable(bytes.toString("latin1")));
      if (bytes.length % 2 === 0) chunks.push(searchable(bytes.swap16().toString("utf16le")));
    } else chunks.push(searchable(value.startsWith("u:") ? value.slice(2) : value));
  }
}

function xmlText(text) {
  if (/[\u0000\ufffd]/.test(text)) throw new Error("UTF-8以外のPDFメタデータは未対応");
  // 外部/独自entityは解決しない。数値参照とXML定義済みentityだけを復号する。
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("外部定義を持つPDFメタデータは未対応");
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === "#") return String.fromCodePoint(
      entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity];
  });
}

export async function scanFile(file) {
  const absolute = path.resolve(file);
  const stat = await regularPath(absolute);
  if (stat.size > MAX_BYTES) throw new Error(`検査サイズ上限超過: ${file}`);
  const bytes = await readFile(absolute);
  const pdf = path.extname(file).toLowerCase() === ".pdf" || bytes.subarray(0, 1024).includes("%PDF-");
  if (!pdf) return bytes.toString("utf8");
  const raw = bytes.toString("latin1");
  if (!raw.startsWith("%PDF-") || (raw.match(/startxref/g) || []).length !== 1 ||
      !/%%EOF\s*$/.test(raw)) throw new Error(`不正・線形化・増分更新されたPDF: ${file}`);
  const document = JSON.parse(await run("qpdf", ["--json", "--json-stream-data=none", absolute]));
  if (document.version !== 2 || document.qpdf?.[0]?.jsonversion !== 2 || !document.qpdf?.[1] ||
      document.encrypt?.encrypted !== false || document.acroform?.hasacroform !== false ||
      !document.attachments || Object.keys(document.attachments).length) {
    throw new Error(`検査できないPDF構造: ${file}`);
  }
  const chunks = [];
  objectText(document.qpdf[1], chunks);
  const objects = document.qpdf[1];
  const metadata = Object.entries(objects).filter(([, obj]) => obj.stream?.dict?.["/Type"] === "/Metadata");
  const catalog = objects[`obj:${objects.trailer?.value?.["/Root"]}`]?.value;
  if (!catalog || metadata.length > 1 || (metadata.length === 1 &&
      metadata[0][0] !== `obj:${catalog["/Metadata"]}`)) {
    throw new Error("検査できないPDFメタデータ参照");
  }
  // Catalog以外のメタデータはpdfinfo -metaの対象外なので受理しない。
  for (const obj of Object.values(objects)) {
    const dict = obj.value || obj.stream?.dict;
    if (dict?.["/ToUnicode"] && !objects[`obj:${dict["/ToUnicode"]}`]?.stream) {
      throw new Error("文字対応表の参照が不正");
    }
    if (dict && "/Metadata" in dict && dict !== catalog) {
      throw new Error("Catalog以外のPDFメタデータは未対応");
    }
  }
  if (("/Metadata" in catalog) !== (metadata.length === 1)) {
    throw new Error("型を確認できないPDFメタデータ");
  }
  // inline画像はqpdfのオブジェクト一覧に現れないためPopplerでも確認する。
  const images = await run("pdfimages", ["-list", absolute]);
  if (images.split("\n").some((line) => /^\s*\d+\s+\d+\s+/.test(line))) {
    throw new Error("画像を含むPDFは未対応");
  }
  const text = await run("pdftotext", ["-enc", "UTF-8", absolute, "-"]);
  const pages = text.split("\f");
  if (!pages.at(-1).trim()) pages.pop();
  if (!pages.length || pages.some((page) => !page.trim() || page.includes("\ufffd"))) {
    throw new Error(`本文を抽出できないPDF: ${file}`);
  }
  chunks.push(searchable(text));
  chunks.push(searchable(await run("pdftotext", ["-raw", "-enc", "UTF-8", absolute, "-"])));
  chunks.push(searchable(xmlText(await run("pdfinfo", ["-meta", absolute]))));
  return chunks.join("\n");
}
