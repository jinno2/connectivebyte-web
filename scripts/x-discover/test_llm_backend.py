#!/usr/bin/env python3
"""LLM backend の provider 前ポリシー検査 (ネットワーク/CLI起動なし)。"""
from __future__ import annotations

import os
import pathlib
import sys
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import llm_backend  # noqa: E402


class DevinPolicyTest(unittest.TestCase):
    def test_astra_model_is_rejected_before_provider_spawn(self):
        with patch.dict(os.environ, {'DEVIN_MODEL': 'gpt-6-astra-medium'}), \
                patch.object(llm_backend.subprocess, 'run') as run:
            self.assertIsNone(llm_backend._devin('prompt', 1))
            run.assert_not_called()

    def test_non_astra_model_reaches_the_mocked_cli_boundary(self):
        completed = type('Completed', (), {'stdout': 'ok\n', 'stderr': '', 'returncode': 0})()
        with patch.dict(os.environ, {'DEVIN_MODEL': 'gpt-6-luna'}), \
                patch.object(llm_backend, 'DEVIN_LAUNCHER', pathlib.Path('/usr/bin/devin')), \
                patch.object(llm_backend, 'DEVIN_GUARD_MARKER', 'guard'), \
                patch.object(pathlib.Path, 'is_file', return_value=True), \
                patch.object(pathlib.Path, 'read_text', return_value='guard'), \
                patch.object(llm_backend.subprocess, 'run', return_value=completed) as run:
            self.assertEqual(llm_backend._devin('prompt', 1), 'ok')
            self.assertEqual(run.call_args.args[0][-2:], ['--model', 'gpt-6-luna'])

    def test_unmanaged_devin_binary_is_not_used_as_a_fallback(self):
        with patch.dict(os.environ, {'DEVIN_MODEL': 'gpt-6-luna'}), \
                patch.object(llm_backend, 'DEVIN_LAUNCHER', pathlib.Path('/missing/devin')), \
                patch.object(llm_backend.shutil, 'which', return_value='/usr/bin/devin'), \
                patch.object(llm_backend.subprocess, 'run') as run:
            self.assertIsNone(llm_backend._devin('prompt', 1))
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
