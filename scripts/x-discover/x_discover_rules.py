#!/usr/bin/env python3
"""CB発見者 生成規律 — X運用基本計画§11 (投稿文の生成ルール) の機械化。

collect (起草prompt) / review (承認時警告表示) / post (投稿前fail-closed検査) の
3点から同じ規律を参照する。正本: business_notes/横断/X運用基本計画.md §11。

§11「自動生成しない」の語 + キュレーション文脈の断定誇張語 (秀逸/衝撃/革命等)。
"""
from __future__ import annotations

# X運用基本計画§11「自動生成しない」+ 肯定評価の誇張語 (発見者take向け拡張)
BANNED_WORDS: tuple[str, ...] = (
    # §11 本文列挙
    'おすすめ', '推し', '最高', '画期的', '必須', '絶対', '業界No', 'No.1',
    'No.1', '人間より正確', '完全自動', 'ミスゼロ', '必ず時間を削減',
    # 肯定評価語 (キュレーションtakeに出しがちな断定誇張)
    '秀逸', '衝撃', '激震', '革命', '最強', '神',
)

# hook均一化検出: 末尾4字が直近投稿と同一なら警告 ( TweetSpamBot類似判定回避 )
OPENER_SUFFIX_LEN = 4


def banned_hits(*parts: str) -> list[str]:
    """投稿文各部に含まれる禁止語を返す (空=合格)。"""
    text = ' '.join(p or '' for p in parts)
    return [w for w in BANNED_WORDS if w in text]


def ask_is_interrogative(ask: str) -> bool:
    """askは読者への問いであること (基本計画のreply誘導CTA形)。"""
    return (ask or '').rstrip().endswith('？') or (ask or '').rstrip().endswith('?')


def hook_suffix(hook: str) -> str:
    """hook末尾語 (均一化検出用)。"""
    return (hook or '')[-OPENER_SUFFIX_LEN:]


def uniformity_warning(hook: str, recent_hooks: list[str]) -> str | None:
    """直近hookと末尾語が同一なら警告文を返す。"""
    sfx = hook_suffix(hook)
    if sfx and any(hook_suffix(h) == sfx for h in recent_hooks):
        return f'hook末尾「{sfx}」が直近投稿と同一 (均一化回避§11)'
    return None
