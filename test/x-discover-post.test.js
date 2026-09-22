import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const postPy = path.join(repoRoot, "scripts", "x-discover", "post.py");

test("x-discover投稿判定は共有生成と同じ重み付きテストベクトルをmockだけで検査する", () => {
  const script = `
import sys, importlib.util
sys.path.insert(0, ${JSON.stringify(path.dirname(postPy))})
spec = importlib.util.spec_from_file_location('post', ${JSON.stringify(postPy)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
url = 'https://lab.connectivebyte.com/?r=P2'
vectors = [
    ('a' * 280, True),
    ('あ' * 140, True),
    ('あ' * 141, False),
    ('あ' * 200 + '\\n' + url, False),
    ('👨‍🎤', True),
    ('👩🏽‍💻', True),
    ('a ' + url + ' b https://example.com/x', True),
]
for text, expected in vectors:
    assert m.post_length_ok(text) is expected, (m.weighted_length(text), expected)
assert m.weighted_length('あ' * 200 + '\\n' + url) == 424
`;
  execFileSync("python3", ["-c", script], { cwd: repoRoot, encoding: "utf8" });
});
