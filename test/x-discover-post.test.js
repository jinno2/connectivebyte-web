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
    ('example.comてすとですtwitter.みんなです', True),
    ('example.com あ twitter.みんな', True),
    ('あ' * 120 + ' example.com\\n' + url, False),
    ('a' * 279, True),
    ('a' * 280, True),
    ('a' * 281, False),
    ('a' * 278 + '👩🏽‍💻', True),
    ('a' * 279 + '👩🏽‍💻', False),
  ]
for text, expected in vectors:
    assert m.post_length_ok(text) is expected, (m.weighted_length(text), expected)
assert m.weighted_length('あ' * 200 + '\\n' + url) == 424
assert m.weighted_length('example.comてすとですtwitter.みんなです') == 60
assert m.weighted_length('example.com あ twitter.みんな') == 50
official = [
    ('http://ああ.com', ['http://ああ.com']),
    ('http://あ-あ.com', ['http://あ-あ.com']),
    ('foo.com foo.net foo.org foo.edu foo.gov', ['foo.com', 'foo.net', 'foo.org', 'foo.edu', 'foo.gov']),
    ('foo.baz foo.co.jp www.xxxxxxx.baz www.foo.co.uk wwwww.xxxxxxx foo.comm foo.somecom foo.govedu foo.jp',
     ['foo.co.jp', 'www.foo.co.uk', 'foo.jp']),
    ('example.comてすとですtwitter.みんなです', ['example.com', 'twitter.みんな']),
    ('これは日本語です。example.com/path/index.html中国語example.com/path한국',
     ['example.com/path/index.html', 'example.com/path']),
    ('#test.com @test.com #http://test.com @http://test.com', []),
    ("I really like http://t.co/pbY2NfTZ's website", ['http://t.co/pbY2NfTZ']),
    ('http://xn--はじめよう.com/index.html', []),
    ('test http://-leadingdash.twitter.com', []),
]
for text, expected in official:
    assert m.extract_urls(text) == expected, (text, m.extract_urls(text), expected)
assert m.weighted_length(official[3][0]) == 141
assert m.weighted_length('http://ああ.com') == 23
assert m.weighted_length('http://あ-あ.com') == 23
assert m.post_length_ok('あ' * 120 + ' http://ああ.com\\n' + url) is False
`;
  execFileSync("python3", ["-c", script], { cwd: repoRoot, encoding: "utf8" });
});
