#!/usr/bin/env python3
"""t0007 日本展開 — HubSpot Free CRM連携 (status/履歴の正本)。

役割分離 (2026-09-13 jinno決定・HubSpot採用):
  - HubSpot = 人毎のstatus・next-action・履歴の正本 (見落としゼロ機構)
  - dossier = 事実・文面の正本 (移さない・dossier pathはNote/task本文で指す)
  - 送信channel = form主体でSaaS無関係 (送信フローの最後にHubSpotへ書き戻し)

token: /home/jinno/tas_nexus_cx_starter/.env の HUBSPOT_ACCESS_TOKEN
       (値はこのスクリプトから出力しない)

tokenにschema系scopeはない → カスタムpropertyは作らない。標準property
(company/website/hs_lead_status) + Note (時系列) + Task (due) で構成する。

コマンド:
  auth-check   tokenのAPI認証確認 (HTTP codeのみ出力)
  sync         3target contact+note+taskの冪等シード (初回のみ作成・以後はHubSpotが正本)
  list         contact一覧 (lead status込み)
  tasks        未完了task一覧 [--due] は36h以内+overdueのみ
  digest       cron用: due/overdueの要約。新規overdue検出時は--inboxでINBOXへ1行
"""
import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

ENV_PATH = "/home/jinno/tas_nexus_cx_starter/.env"
API = "https://api.hubapi.com"
STATE_DIR = os.path.expanduser("~/.local/share/cb-fleet")
INBOX = os.path.expanduser("~/tas_launchops/INBOX.md")
JST = dt.timezone(dt.timedelta(hours=9))
# この時間以内にdueが来るtaskを行動対象とする (cronが日次なので1日強の余裕)
ACTION_WINDOW_MS = 36 * 3600 * 1000

# ── token (値は絶対に出力しない) ────────────────────────────────────────────

def load_token() -> str:
    if os.environ.get("HUBSPOT_ACCESS_TOKEN"):
        return os.environ["HUBSPOT_ACCESS_TOKEN"]
    try:
        with open(ENV_PATH, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("HUBSPOT_ACCESS_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    sys.exit("HUBSPOT_ACCESS_TOKEN not found (env or {})".format(ENV_PATH))


def api_call(method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path, data=data, method=method,
        headers={
            "Authorization": "Bearer " + load_token(),
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            return exc.code, json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return exc.code, {"error": "non-json"}


# ── 初回シード (以後はHubSpotが正本 — ここを編集してもsyncは上書きしない) ────

TARGETS = [
    {
        "company": "quetab",
        "website": "quetab.com",
        "lead_status": "ATTEMPTED_TO_CONTACT",
        "note": ("[CRM移行 2026-09-13] 事実の正本=~/business_notes/t0007_日本展開/dossier/quetab.md。"
                 "初回送信2026-09-06 (quetab.com contact form) → 返信なし。"
                 "follow-up draft id=17 (120語) 承認待ち。無反応2週=2026-09-20判定。"),
        "tasks": [
            {"subject": "quetab: follow-up id=17 送信実行 (要jinno承認)",
             "due": "2026-09-18T09:00:00+09:00",
             "priority": "HIGH",
             "body": ("draft id=17 (120語・strategy a採択) がoutreach-queueの承認待ち。"
                      "jinno承認→quetab.com contact form送信→outreach.py sent 17→"
                      "dossier追記→HubSpot status更新。文面はdossier/queueが正本。")},
            {"subject": "quetab: 無反応2週判定 (送信2026-09-06から)",
             "due": "2026-09-20T09:00:00+09:00",
             "priority": "MEDIUM",
             "body": ("台帳規定: 無反応2週=検証継続or凍結判定。材料=mail.py list --to "
                      "quetab@connectivebyte.com + engagement計測。判定をdossierへ。")},
        ],
    },
    {
        "company": "valibot",
        "website": "valibot.dev",
        "lead_status": "UNQUALIFIED",
        "note": ("[CRM移行 2026-09-13] 事実の正本=~/business_notes/t0007_日本展開/dossier/valibot.md。"
                 "完了: X投稿08-31・Zenn記事09-02。提携対象外 (記事素材として完結)。open taskなし。"),
        "tasks": [],
    },
    {
        "company": "k2-horizon (IFM)",
        "website": "ifm.ai",
        "lead_status": "UNQUALIFIED",
        "note": ("[CRM移行 2026-09-13] 事実の正本=~/business_notes/t0007_日本展開/dossier/k2-horizon.md。"
                 "Zenn記事09-13公開 (queue-008)。提携対象外 (open weights・記事素材)。open taskなし。"),
        "tasks": [],
    },
]


# ── コマンド実装 ────────────────────────────────────────────────────────────

def cmd_auth_check() -> int:
    code, _ = api_call("GET", "/crm/v3/objects/contacts?limit=1")
    print("HTTP", code)
    return 0 if code == 200 else 1


def _find_contact(company: str) -> str | None:
    # search APIはindex lagで作成直後を取りこぼす (k2-horizon二重作成の実績) →
    # portal規模が小さいのでGET list + local一致で即時一貫を取る
    code, body = api_call(
        "GET", "/crm/v3/objects/contacts?limit=100&properties=company")
    if code == 200:
        for row in body.get("results", []):
            if row.get("properties", {}).get("company") == company:
                return row["id"]
    return None


def _find_task(subject: str) -> str | None:
    code, body = api_call(
        "GET",
        "/crm/v3/objects/tasks?limit=100&properties=hs_task_subject,hs_task_status",
    )
    if code == 200:
        for row in body.get("results", []):
            if row.get("properties", {}).get("hs_task_subject") == subject:
                return row["id"]
    return None


def _now_ms() -> int:
    return int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)


def _ts_ms(value) -> int:
    """property値をms epochへ。GETはISO文字列・内部はms epochで来る。"""
    if value in (None, ""):
        return 0
    text = str(value)
    if text.isdigit():
        return int(text)
    try:
        parsed = dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
        return int(parsed.timestamp() * 1000)
    except ValueError:
        return 0


def cmd_sync() -> int:
    for target in TARGETS:
        cid = _find_contact(target["company"])
        if cid is None:
            code, body = api_call("POST", "/crm/v3/objects/contacts", {
                "properties": {
                    "company": target["company"],
                    "website": target["website"],
                    "hs_lead_status": target["lead_status"],
                },
            })
            print("contact {}: created {}".format(target["company"], code))
            if code not in (200, 201):
                print("  body:", json.dumps(body, ensure_ascii=False)[:200])
                continue
            cid = body["id"]
            # 初回Note (時系列の起点・dossierへの導線)
            ncode, nbody = api_call("POST", "/crm/v3/objects/notes", {
                "properties": {"hs_note_body": target["note"],
                               "hs_timestamp": str(_now_ms())},
            })
            if ncode in (200, 201):
                api_call("PUT", "/crm/v3/objects/notes/{}/associations/contacts/{}"
                         "/note_to_contact".format(nbody["id"], cid))
        else:
            print("contact {}: exists ({})".format(target["company"], cid))
        for task in target["tasks"]:
            if _find_task(task["subject"]) is not None:
                print("  task exists: {}".format(task["subject"][:40]))
                continue
            due_ms = str(int(dt.datetime.fromisoformat(task["due"])
                             .timestamp() * 1000))
            code, body = api_call("POST", "/crm/v3/objects/tasks", {
                "properties": {
                    "hs_task_subject": task["subject"],
                    "hs_task_body": task["body"],
                    "hs_task_status": "NOT_STARTED",
                    "hs_task_priority": task["priority"],
                    "hs_timestamp": due_ms,
                },
            })
            print("  task {}: {}".format(task["subject"][:40], code))
            if code in (200, 201):
                acode, _ = api_call(
                    "PUT",
                    "/crm/v3/objects/tasks/{}/associations/contacts/{}/task_to_contact"
                    .format(body["id"], cid),
                )
                print("    assoc: {}".format(acode))
            else:
                print("    body:", json.dumps(body, ensure_ascii=False)[:200])
    return 0


def cmd_list() -> int:
    code, body = api_call(
        "GET",
        "/crm/v3/objects/contacts?limit=50&properties=company,website,hs_lead_status",
    )
    if code != 200:
        print("HTTP", code, json.dumps(body)[:200])
        return 1
    for row in body.get("results", []):
        p = row.get("properties", {})
        print("[{}] {} | {} | {}".format(
            row["id"], p.get("company"), p.get("website"),
            p.get("hs_lead_status")))
    return 0


def _fetch_tasks() -> list[dict]:
    code, body = api_call(
        "GET",
        "/crm/v3/objects/tasks?limit=100&properties=hs_task_subject,hs_task_status,"
        "hs_timestamp,hs_task_priority",
    )
    if code != 200:
        return []
    return body.get("results", [])


def _open_tasks() -> list[dict]:
    return [
        r for r in _fetch_tasks()
        if r.get("properties", {}).get("hs_task_status")
        in ("NOT_STARTED", "IN_PROGRESS", "WAITING")
    ]


def cmd_tasks(due_only: bool) -> int:
    now_ms = _now_ms()
    rows = sorted(_open_tasks(),
                  key=lambda r: _ts_ms(r["properties"].get("hs_timestamp")))
    for row in rows:
        p = row["properties"]
        ts = _ts_ms(p.get("hs_timestamp"))
        if due_only and not (ts < now_ms + ACTION_WINDOW_MS):
            continue
        due = dt.datetime.fromtimestamp(ts / 1000, dt.timezone.utc)
        flag = "OVERDUE" if ts < now_ms else "due"
        print("[{}] {} {:<8} {}".format(
            row["id"],
            due.astimezone(JST).strftime("%m-%d %H:%M"),
            flag, p.get("hs_task_subject")))
    return 0


def cmd_digest(write_inbox: bool) -> int:
    """cron本体: 行動対象(36h以内+overdue)は常時ログ、新規overdueはINBOXへ1行 (重複抑制つき)。"""
    now_ms = _now_ms()
    actionable, overdue = [], []
    for row in _open_tasks():
        p = row.get("properties", {})
        ts = _ts_ms(p.get("hs_timestamp"))
        subject = p.get("hs_task_subject") or "?"
        if ts < now_ms:
            overdue.append((row["id"], subject))
            actionable.append((row["id"], subject))
        elif ts < now_ms + ACTION_WINDOW_MS:
            actionable.append((row["id"], subject))
    now = dt.datetime.now(JST)
    print("crm digest {}: actionable={} / {}".format(
        now.strftime("%Y-%m-%d %H:%M"), len(actionable),
        "; ".join(s for _, s in actionable) or "none"))
    if not write_inbox or not overdue:
        return 0
    os.makedirs(STATE_DIR, exist_ok=True)
    state_path = os.path.join(STATE_DIR, "crm-alert-state.json")
    alerted = {}
    if os.path.exists(state_path):
        try:
            with open(state_path, encoding="utf-8") as fh:
                alerted = json.load(fh)
        except (OSError, json.JSONDecodeError):
            alerted = {}
    fresh = [(tid, subj) for tid, subj in overdue if not alerted.get(tid)]
    if not fresh:
        return 0
    line = ("| {}-crm | {} | crm cron (HubSpot) | all | **overdue task {}件**: {} — "
            "HubSpot (status/履歴正本) のdue切れ。対応or期日変更を。dossierが事実正本。 | open |\n"
            ).format(now.strftime("%m%d-%H%M"), now.strftime("%Y-%m-%d %H:%M"),
                     len(fresh), "; ".join(s for _, s in fresh))
    with open(INBOX, "a", encoding="utf-8") as fh:
        fh.write(line)
    for tid, _ in fresh:
        alerted[tid] = True
    with open(state_path, "w", encoding="utf-8") as fh:
        json.dump(alerted, fh)
    print("INBOX row appended ({} new)".format(len(fresh)))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("auth-check")
    sub.add_parser("sync")
    sub.add_parser("list")
    tasks_parser = sub.add_parser("tasks")
    tasks_parser.add_argument("--due", action="store_true")
    digest_parser = sub.add_parser("digest")
    digest_parser.add_argument("--inbox", action="store_true")
    args = parser.parse_args()
    if args.cmd == "auth-check":
        return cmd_auth_check()
    if args.cmd == "sync":
        return cmd_sync()
    if args.cmd == "list":
        return cmd_list()
    if args.cmd == "tasks":
        return cmd_tasks(args.due)
    if args.cmd == "digest":
        return cmd_digest(args.inbox)
    return 1


if __name__ == "__main__":
    sys.exit(main())
