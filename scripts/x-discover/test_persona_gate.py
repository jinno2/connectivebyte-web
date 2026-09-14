#!/usr/bin/env python3
"""x-discover persona gate の恒久テスト (stdlibのみ・LLM/ネットワーク不使用)。

2026-09-14 gate強化の回帰防止:
  - post.pick_draft: persona pass行を最優先・同点でもTypeErrorしない
  - collect.rereview_unreviewed: approved行も審査対象・48h窓外は触らない
  - collect.refill_placeholders: 窓外placeholderを起草しない (limit浪費防止)
  - collect.redraft_persona_ng: §11機械検査を審査LLMの前に実施 (消費防止)
  - enrich: 自動実行は48h窓外をskip・明示key指定は窓をバイパス
  - x_discover_rules.discipline_violation: 禁止語/問い形/字数/正常の4分岐
  - x_discover_rules.in_post_window/post_window_age: date破損行は例外でなく窓外
  - queue I/O: 破損行・truncate行でクラッシュしない / 書込はatomic

LLM依存関数 (llm_draft/attach_persona_review/persona_review_draft/call_llm)
は全て monkeypatch する。実行: python3 test_persona_gate.py
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import shutil
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import collect  # noqa: E402
import enrich  # noqa: E402
import post  # noqa: E402
from x_discover_rules import (BANNED_WORDS, discipline_violation,  # noqa: E402
                              in_post_window, post_window_age, read_jsonl,
                              write_jsonl_atomic)

TODAY = dt.date(2026, 9, 14)
YESTERDAY = '2026-09-13'


def row(**kw) -> dict:
    base = dict(status='draft', date='2026-09-14', posted_at=None, source='github',
                title='tool x', url='https://github.com/a/x', genre_jp='tool',
                hook='発見の一句A', take='自説です', ask='どうなりますか？', score=50)
    base.update(kw)
    return base


class GateTest(unittest.TestCase):
    def setUp(self):
        tmpmgr = tempfile.TemporaryDirectory()
        self.addCleanup(tmpmgr.cleanup)  # tmpdirも自分で掃除
        self.q = pathlib.Path(tmpmgr.name) / 'q.jsonl'
        self._patch(collect, 'QUEUE', self.q)
        self._patch(enrich, 'QUEUE', self.q)  # 本番queueを絶対に触らせない
        # hermetic化: 実~/.env読込 (os.environ汚染) と実persona yaml
        # (姉妹repo無しマシンで赤になる) に依存させない
        self._patch(enrich, 'load_env_file', lambda: None)
        self._patch(enrich, 'persona_lines',
                    lambda: ['読者ペルソナ: テスト用 (hermetic fixture)'])

    def _patch(self, mod, name, value):
        old = getattr(mod, name)
        setattr(mod, name, value)
        self.addCleanup(setattr, mod, name, old)

    def _write(self, rows: list[dict]) -> None:
        self.q.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows))

    def _read(self) -> list[dict]:
        return [json.loads(l) for l in self.q.read_text().splitlines() if l.strip()]


class TestRules(GateTest):
    def test_discipline_4branches(self):
        self.assertTrue(discipline_violation(f'x{BANNED_WORDS[0]}', '自説', 'a？'))
        self.assertEqual(discipline_violation('h', '自説', 'です。'), 'ask_not_interrogative')
        self.assertTrue(discipline_violation('あ' * 200, 'い' * 200, 'う' * 200 + '？')
                        .startswith('too_long: '))
        self.assertIsNone(discipline_violation('発見の一句', '自説です', 'どうですか？'))

    def test_post_window_tolerates_broken_date(self):
        # High 1回帰: date:null/欠損/非文字列は例外ではなく窓外扱い (cron死防止)
        for bad in ({'date': None}, {}, {'date': 20260914}, {'date': '健全でない'},
                    {'date': '2026-09-10'}):
            self.assertFalse(in_post_window(bad, TODAY), bad)
            self.assertIsNone(post_window_age(bad, TODAY), bad)
        for good, want in (({'date': '2026-09-14'}, 0), ({'date': '2026-09-13'}, 1)):
            self.assertTrue(in_post_window(good, TODAY), good)
            self.assertEqual(post_window_age(good, TODAY), want)

    def test_read_jsonl_tolerates_corrupt_lines(self):
        # 中断書込の末尾truncate・手編集の壊行・空行 — 健全行だけで続行
        self.q.write_text('{"a": 1}\n壊れた行\n\n{"a": 2}\n{"trunc')
        self.assertEqual([r['a'] for r in read_jsonl(self.q)], [1, 2])

    def test_read_jsonl_missing_file_is_empty(self):
        self.assertEqual(read_jsonl(self.q), [])

    def test_write_jsonl_atomic_roundtrip(self):
        # atomic性も実検証: replace時にtmpが存在 (素のwrite_text直書きなら
        # os.replaceが呼ばれず、このテストは赤になる)
        import x_discover_rules
        real_replace = x_discover_rules.os.replace
        seen = []

        def spy_replace(src, dst):
            self.assertTrue(pathlib.Path(src).exists(), 'replace時にtmpが無い')
            seen.append((pathlib.Path(src).name, pathlib.Path(dst).name))
            real_replace(src, dst)

        self._patch(x_discover_rules.os, 'replace', spy_replace)
        write_jsonl_atomic(self.q, [{'a': 1}, {'b': '日本語'}])
        got = read_jsonl(self.q)
        self.assertEqual([len(r) for r in got], [1, 1])
        self.assertEqual(got[0]['a'], 1)
        self.assertEqual(got[1]['b'], '日本語')
        self.assertEqual(seen, [(self.q.name + '.tmp', self.q.name)])
        write_jsonl_atomic(self.q, [{'c': 3}])  # 上書き
        self.assertEqual(read_jsonl(self.q), [{'c': 3}])
        self.assertFalse(pathlib.Path(str(self.q) + '.tmp').exists())

    def test_read_jsonl_skips_non_dict_lines(self):
        # JSONとしては合法な非dict行 ("文字列"/配列/null) も下流 AttributeError無くskip
        self.q.write_text('{"a": 1}\n"ただの文字列"\n[1, 2]\nnull\n{"a": 2}')
        self.assertEqual([r['a'] for r in read_jsonl(self.q)], [1, 2])


class TestPickDraft(GateTest):
    # hookは行ごとに変える (同一末尾hookはuniformity_warningで適正skipされる)

    def test_pass_preferred(self):
        best_unreviewed = row(score=90, hook='最良行の一句')
        pass_second = row(score=50, hook='二番手の一句',
                          persona_review={'verdict': 'pass'})
        got = post.pick_draft([best_unreviewed, pass_second], TODAY)
        self.assertEqual(got['score'], 50)  # passの2番手で当夜を保全

    def test_legacy_order_without_pass(self):
        got = post.pick_draft([row(score=90, hook='甲の一句'),
                               row(score=70, hook='乙の一句')], TODAY)
        self.assertEqual(got['score'], 90)

    def test_tiebreak_no_typeerror(self):
        got = post.pick_draft([row(score=80, hook='同点甲の一句'),
                               row(score=80, hook='同点乙の一句')], TODAY)
        self.assertIsInstance(got, dict)


class TestRereview(GateTest):
    def test_approved_admitted_and_window_respected(self):
        self._patch(collect, 'persona_review_draft',
                    lambda *a, **k: {'verdict': 'pass', 'reason': 't'})
        rows = [row(status='approved'),                                  # 無verdict → 審査される
                row(persona_review={'verdict': 'pass'}),                 # pass済 → 触らない
                row(persona_review={'verdict': 'ng'}),                   # ng済 → 触らない
                row(date=YESTERDAY),                                     # 窓内 → 審査される
                row(date='2026-09-10')]                                  # 窓外 → 触らない
        self._write(rows)
        n = collect.rereview_unreviewed(dry=False, limit=3, today=TODAY)
        after = self._read()
        self.assertEqual(n, 2)
        self.assertEqual(after[0]['persona_review']['verdict'], 'pass')
        self.assertEqual(after[2]['persona_review']['verdict'], 'ng')
        self.assertNotIn('persona_review', after[4])

    def test_null_date_row_does_not_crash(self):
        # High 1回帰: 1行のdate:nullで朝collect全体が死なない (skipされて他行は処理)
        self._patch(collect, 'persona_review_draft',
                    lambda *a, **k: {'verdict': 'pass', 'reason': 't'})
        self._write([row(date=None), row()])
        n = collect.rereview_unreviewed(dry=False, limit=3, today=TODAY)
        self.assertEqual(n, 1)  # 健全な行だけ処理される

    def test_corrupt_queue_line_does_not_crash(self):
        # queueの1行破損で朝collectが死なない (破損行skip・健全2行は処理)
        self._patch(collect, 'persona_review_draft',
                    lambda *a, **k: {'verdict': 'pass', 'reason': 't'})
        self.q.write_text(json.dumps(row(), ensure_ascii=False) + '\n{壊れた行\n'
                          + json.dumps(row(date=YESTERDAY), ensure_ascii=False) + '\n')
        n = collect.rereview_unreviewed(dry=False, limit=3, today=TODAY)
        self.assertEqual(n, 2)


class TestRefill(GateTest):
    def test_window_out_placeholder_not_redrafted(self):
        calls = []

        def fake_draft(item, genre, hooks, excerpt=''):
            calls.append(item['title'])
            return dict(hook='新起草の一句', take='自説です', ask='どうですか？')

        self._patch(collect, 'llm_draft', fake_draft)
        self._patch(collect, 'fetch_excerpt', lambda url: '')
        self._patch(collect, 'attach_persona_review',
                    lambda d, t, g: {'verdict': 'pass', 'reason': 't'})
        self._write([row(hook='【要起草】', date='2026-09-10'),   # 窓外 → 起草しない
                     row(hook='【要起草】', date=YESTERDAY)])     # 窓内 → 起草する
        n = collect.refill_placeholders(dry=False, limit=3, today=TODAY)
        after = self._read()
        self.assertEqual(calls, ['tool x'])  # 窓外の古行でLLMを消費しない
        self.assertEqual(n, 1)
        self.assertEqual(after[0]['hook'], '【要起草】')
        self.assertEqual(after[1]['hook'], '新起草の一句')


class TestRedraft(GateTest):
    def test_discipline_check_before_review_llm(self):
        review_calls = []

        def fake_draft(item, genre, hooks, excerpt='', note=''):
            return dict(hook=f"禁語{BANNED_WORDS[0]}の一句", take='自説です',
                        ask='どうですか？')

        self._patch(collect, 'llm_draft', fake_draft)
        self._patch(collect, 'fetch_excerpt', lambda url: '')
        self._patch(collect, 'attach_persona_review',
                    lambda d, t, g: review_calls.append(t) or {'verdict': 'pass'})
        self._write([row(persona_review={'verdict': 'ng', 'reason': 'r'})])
        n = collect.redraft_persona_ng(dry=False, limit=2, today=TODAY)
        self.assertEqual(n, 0)
        self.assertEqual(review_calls, [])  # 違反案に審査LLMを消費しない
        self.assertEqual(self._read()[0]['hook'], '発見の一句A')  # 旧案維持

    def test_pass_adopts_and_attempts_bounded(self):
        def fake_draft(item, genre, hooks, excerpt='', note=''):
            return dict(hook=f"書直しの一句{item['title']}", take='自説です',
                        ask='どうですか？')

        self._patch(collect, 'llm_draft', fake_draft)
        self._patch(collect, 'fetch_excerpt', lambda url: '')
        self._patch(collect, 'attach_persona_review',
                    lambda d, t, g: {'verdict': 'pass', 'reason': 't'})
        self._write([row(persona_review={'verdict': 'ng'}, title='t1'),
                     row(persona_review={'verdict': 'ng'}, title='t2')])
        n = collect.redraft_persona_ng(dry=False, limit=1, today=TODAY)
        after = self._read()
        self.assertEqual(n, 1)                    # attempts=limit で打ち切り
        self.assertTrue(after[0]['hook'].startswith('書直しの一句'))
        self.assertEqual(after[0]['persona_review']['verdict'], 'pass')
        self.assertEqual(after[1]['hook'], '発見の一句A')  # 2行目は未処理


class TestEnrichWindow(GateTest):
    def _setup_trials(self, tmp):
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        # import時にambient DISCOVER_POLISH_ROUNDSを取り込むため明示固定
        # (envに0があるとpolish_roundsが記録されず偽失敗する)
        self._patch(enrich, 'POLISH_ROUNDS', 8)
        tr = pathlib.Path(tmp) / 'trials'
        key = enrich.preview_key('https://github.com/a/x')
        d = tr / key
        d.mkdir(parents=True)
        (d / 'report.json').write_text(json.dumps(
            {'status': 'success', 'title': 'tool x', 'verdict': {'facts_ja': ['f']}}))
        self._patch(enrich, 'TRIALS_DIR', tr)
        self._patch(enrich, 'call_llm',
                    lambda p: dict(hook='実測差替の一句', take='自説です', ask='どうですか？'))
        self._patch(enrich, 'persona_review_draft',
                    lambda *a, **k: {'verdict': 'pass', 'reason': 'ok'})
        # enrich経路のpolishもhermetic化: 批評は即IMPROVED_NONE (実LLMに触らせない)
        self._patch(collect, 'llm_text', lambda p: 'IMPROVED_NONE')

    def test_auto_mode_skips_window_out(self):
        self._setup_trials(tempfile.mkdtemp())
        self._write([row(date='2026-09-10', title='old'),
                     row(title='new')])
        self._patch(sys, 'argv', ['enrich.py'])
        self.assertEqual(enrich.main(), 0)
        after = self._read()
        self.assertEqual(after[0]['hook'], '発見の一句A')        # 窓外 → 不変
        self.assertNotIn('trial_status', after[0])
        self.assertEqual(after[1]['trial_status'], 'done')       # 窓内 → 差替え
        self.assertEqual(after[1]['persona_review']['verdict'], 'pass')

    def test_explicit_keys_bypass_window(self):
        self._setup_trials(tempfile.mkdtemp())
        self._write([row(date='2026-09-10', title='old')])
        self._patch(sys, 'argv',
                    ['enrich.py', enrich.preview_key('https://github.com/a/x')])
        self.assertEqual(enrich.main(), 0)
        after = self._read()
        self.assertEqual(after[0]['trial_status'], 'done')       # 明示指定 → 窓外でも処理
        self.assertEqual(after[0]['hook'], '実測差替の一句')

    def test_enrich_path_applies_polish(self):
        # 必須修正の回帰: 第二起草経路 (enrich) も字単位批評→改稿を通る
        self._setup_trials(tempfile.mkdtemp())
        drafts = [dict(hook='実測差替の一句', take='自説です', ask='どうですか？'),
                  dict(hook='批評反映の一句', take='自説です', ask='どうですか？')]
        seen: list[str] = []

        def fake_call_llm(prompt):
            seen.append(prompt)
            if '批評の全指摘を反映' in prompt:                   # polish改稿呼出
                return drafts[1]
            return drafts[0]                                    # 起草呼出

        self._patch(enrich, 'call_llm', fake_call_llm)

        crit_state = {'n': 0}

        def fake_critique(p):
            crit_state['n'] += 1
            return ('2行目の語が弱い → 直す → ため' if crit_state['n'] == 1
                    else 'IMPROVED_NONE')

        self._patch(collect, 'llm_text', fake_critique)

        self._write([row()])
        self._patch(sys, 'argv', ['enrich.py'])
        self.assertEqual(enrich.main(), 0)
        after = self._read()
        self.assertEqual(after[0]['hook'], '批評反映の一句')     # 改稿が採用される
        self.assertEqual(after[0]['polish_rounds'], 1)
        self.assertEqual(after[0]['persona_review']['verdict'], 'pass')
        self.assertIn('意図を1つ決めてから書く', seen[0])        # 第二起草promptも意図設計を要求


class TestPolish(GateTest):
    """字単位批評→改稿ループ (collect.llm_draft内・品質反復基準 2026-09-14)。

    本体のllm_draftを直接呼ぶため LLM_BACKEND env と collect側のpersona/LLMを
    hermetic化する。fake_llm_textはprompt内容で経路を判別:
    批評='検査する案' / 改稿='批評の全指摘を反映' / 初期起草=それ以外。"""

    def _setup_polish(self, critiques, rewrites):
        import os as _os
        _os.environ['LLM_BACKEND'] = 'codex'
        self.addCleanup(_os.environ.pop, 'LLM_BACKEND', None)
        self._patch(collect, 'persona_lines',
                    lambda: ['読者ペルソナ: テスト用 (polish fixture)'])
        calls = []

        def fake_llm_text(p):
            calls.append(p)
            if '検査する案' in p:
                return next(critiques, 'IMPROVED_NONE')
            if '批評の全指摘を反映' in p:
                return f'{next(rewrites, "改稿尽くしの一句")}\n自説です\nどうしますか？'
            return '初期の一句\n自説です\nどうしますか？'

        self._patch(collect, 'llm_text', fake_llm_text)
        return calls

    def test_converges_after_critique_pass(self):
        calls = self._setup_polish(
            iter(['2行目の語が曖昧 → 具体へ → 意図が散る']),
            iter(['改稿1の一句']))
        self._patch(collect, 'POLISH_ROUNDS', 4)
        d = collect.llm_draft(row(), 'tool', [])
        self.assertEqual(d['hook'], '改稿1の一句')          # 批評1回→改稿1回→収束
        self.assertEqual(d['polish_rounds'], 1)
        self.assertIn('検査する案', calls[1])               # 起草→批評→改稿→批評の順
        # IMPROVED_NONE応答後に改稿が再発生しない (calls[3]への恒真assertInは廃止 —
        # 批評promptの指示文に常にIMPORVED_NONEが含まれ検証になっていないため)
        self.assertEqual(len(calls), 4)
        self.assertIn('意図を1つ決めてから書く', calls[0])   # 起草promptが意図設計を要求

    def test_round_cap_bounded(self):
        # 改稿は毎回別文 (同文循環は収束扱いで止まるため)
        rewrites = (f'改稿{i}の一句' for i in range(1, 10))
        self._setup_polish(iter(lambda: 'まだ弱い語がある → 直す → ため', None), rewrites)
        self._patch(collect, 'POLISH_ROUNDS', 3)
        d = collect.llm_draft(row(), 'tool', [])
        self.assertEqual(d['polish_rounds'], 3)             # 上限で打ち切り
        self.assertEqual(d['hook'], '改稿3の一句')

    def test_discipline_violating_rewrite_keeps_current(self):
        self._setup_polish(iter(['語が弱い → 直す → ため']),
                           iter([f'禁語{BANNED_WORDS[0]}の一句']))
        self._patch(collect, 'POLISH_ROUNDS', 4)
        d = collect.llm_draft(row(), 'tool', [])
        self.assertEqual(d['hook'], '初期の一句')           # 違反改稿は捨てる
        self.assertEqual(d['polish_rounds'], 0)

    def test_identical_rewrite_stops(self):
        self._setup_polish(iter(['語が弱い → 直す → ため']), iter(['初期の一句']))
        self._patch(collect, 'POLISH_ROUNDS', 4)
        d = collect.llm_draft(row(), 'tool', [])
        self.assertEqual(d['hook'], '初期の一句')           # 同一案循環 → 収束扱い
        self.assertEqual(d['polish_rounds'], 0)

    def test_critique_llm_failure_fail_open(self):
        calls = self._setup_polish(iter(['']), iter([]))    # 批評LLMが空応答
        self._patch(collect, 'POLISH_ROUNDS', 4)
        d = collect.llm_draft(row(), 'tool', [])
        self.assertEqual(d['hook'], '初期の一句')           # 現案維持
        self.assertEqual(d['polish_rounds'], 0)
        self.assertEqual(len(calls), 2)                     # 起草+批評1回のみ

    def test_rewrite_llm_failure_fail_open(self):
        # 改稿LLMが3行未満 (call→None) — 批評を消すが改稿は採用しない
        self._setup_polish(iter(['語が弱い → 直す → ため']), iter(['']))
        self._patch(collect, 'POLISH_ROUNDS', 4)
        d = collect.llm_draft(row(), 'tool', [])
        self.assertEqual(d['hook'], '初期の一句')
        self.assertEqual(d['polish_rounds'], 0)

    def test_disabled_skips_loop(self):
        calls = self._setup_polish(iter(["改善点あり"]), iter([]))
        self._patch(collect, 'POLISH_ROUNDS', 0)
        d = collect.llm_draft(row(), 'tool', [])
        self.assertEqual(d['hook'], '初期の一句')
        self.assertNotIn('polish_rounds', d)                # 旧挙動どおり
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
