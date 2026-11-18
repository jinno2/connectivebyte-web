# Active AUTO Decisions (cache) — safe to delete

## AUTO:AnonymousEvent.typeset:logicjs_client_canonical
- Status: ACTIVE
- Chosen: logic.js EVENT_TYPES (23種) をクライアント送信の正とし、server.js の+2種 (d1_lp_viewed, d1_lp_cart_click) は本番専用LP由来の検証用スーパーセットとして扱う
- Policy: safety + change locality
- Expires After Runs: 20
- Linked: AMB-EVENT-001
- Revert Triggers: primary_evidence_contradiction

## AUTO:LocalVerificationServer.worker_parity:serverjs_as_reference
- Status: ACTIVE
- Chosen: repo内の検証ロジックの参照として server.js を扱い、本番Workerとの差異確認は対象外とする
- Policy: reversibility + change locality
- Expires After Runs: 20
- Linked: AMB-PARITY-001
- Revert Triggers: primary_evidence_contradiction
