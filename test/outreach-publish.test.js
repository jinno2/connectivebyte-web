import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outreach = path.join(repoRoot, "scripts", "t0007-outreach", "outreach.py");

test("publish-articleは未追跡候補を隔離publish treeで検査し、失敗時に既存記事/indexを保全する", () => {
  const script = `
import argparse, importlib.util, json, os, shutil, subprocess, tempfile
from types import SimpleNamespace

source = ${JSON.stringify(repoRoot)}
module_path = ${JSON.stringify(outreach)}
work = tempfile.mkdtemp(prefix='cb-publish-test-')
shutil.copytree(source, work, dirs_exist_ok=True, ignore=shutil.ignore_patterns('.git', '.serena', 'node_modules', 'app-behavior.test.js', 'outreach-publish.test.js', 'x-discover-post.test.js'))
subprocess.run(['git', 'init', '-q'], cwd=work, check=True)
subprocess.run(['git', 'config', 'user.email', 'test@example.invalid'], cwd=work, check=True)
subprocess.run(['git', 'config', 'user.name', 'test'], cwd=work, check=True)
subprocess.run(['git', 'add', '.'], cwd=work, check=True)
subprocess.run(['git', 'commit', '-qm', 'fixture'], cwd=work, check=True)

spec = importlib.util.spec_from_file_location('outreach_fixture', module_path)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.REPO = work
m.DOSSIER = {'fixture': {'slug': 'new-article', 'url': 'https://example.invalid'}}
queue = os.path.join(work, 'queue.jsonl')
m.QUEUE = queue
out = os.path.join(work, 'content', '18-blog', 'new-article', 'index.html')
os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, 'w', encoding='utf-8').write('old article')
subprocess.run(['git', 'add', out], cwd=work, check=True)
subprocess.run(['git', 'reset', '-q', out], cwd=work, check=True)

calls = []
real_run = m.subprocess.run
bad_page = m.ARTICLE_TMPL.format(title='新規記事', slug='new-article', description='知能接続', updated='2026-09-22', body=m.md_to_html('# 新規記事\\n\\n知能接続'))
stage = tempfile.mkdtemp(prefix='cb-publish-guard-')
m.prepare_publish_tree(stage, 'content/18-blog/new-article/index.html', bad_page)
guard_env = {**os.environ, 'PUBLICATION_ROOT': stage}
guard_env.pop('NODE_TEST_CONTEXT', None)
guard_fixture = real_run(['node', '--test', 'test/publication-guard.test.js'], cwd=work,
                         env=guard_env, capture_output=True, text=True)
assert guard_fixture.returncode != 0, guard_fixture.stdout + guard_fixture.stderr

def run(cmd, **kwargs):
    calls.append(cmd)
    if cmd[:2] == ['npm', 'test'] or cmd[0] == 'node':
        run_kwargs = dict(kwargs)
        run_kwargs['env'] = dict(kwargs.get('env') or {})
        run_kwargs['env'].pop('NODE_TEST_CONTEXT', None)
        root = run_kwargs['env'].get('PUBLICATION_ROOT')
        candidate = os.path.join(root, 'content', '18-blog', 'new-article', 'index.html') if root else ''
        if candidate and os.path.exists(candidate) and '知能接続' in open(candidate, encoding='utf-8').read():
            return SimpleNamespace(returncode=1, stdout='publication guard fixture failure', stderr='')
        return real_run(cmd, **run_kwargs)
    return SimpleNamespace(returncode=0, stdout='', stderr='')
m.subprocess.run = run

def publish(body):
    open(queue, 'w', encoding='utf-8').write(json.dumps({'id': 1, 'target': 'fixture', 'kind': 'article', 'status': 'approved', 'body': body}, ensure_ascii=False) + '\\n')
    calls.clear()
    return m.cmd_publish(argparse.Namespace(id=1))

bad = publish('# 新規記事\\n\\n知能接続')
assert bad != 0, bad
assert open(out, encoding='utf-8').read() == 'old article'
assert not any(cmd[:2] == ['git', 'add'] for cmd in calls), calls
assert subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=work).returncode == 0

good = publish('# <Title & \\"quoted\\">\\n\\nDescription <b> & \\"quoted\\"\\n\\n本文')
assert good == 0, good
page = open(out, encoding='utf-8').read()
assert '<h1>&lt;Title &amp; &quot;quoted&quot;&gt;</h1>' in page, page
assert page.count('<h1>') == 1, page
assert 'content="Description &lt;b&gt; &amp; &quot;quoted&quot;"' in page, page
assert '<b>' not in page
assert any(cmd[:2] == ['git', 'add'] for cmd in calls), calls
shutil.rmtree(work)
`;
  execFileSync("python3", ["-c", script], { cwd: repoRoot, encoding: "utf8" });
});
