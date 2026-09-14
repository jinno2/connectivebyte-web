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

LLM依存関数 (llm_draft/attach_persona_review/persona_review_draft/call_llm)
は全て monkeypatch する。実行: python3 test_persona_gate.py
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import collect  # noqa: E402
import enrich  # noqa: E402
import post  # noqa: E402
from x_discover_rules import (BANNED_WORDS, discipline_violation,  # noqa: E402
                              in_post_window, post_window_age)

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


if __name__ == '__main__':
    unittest.main()
