const INTERESTS = ["E", "D", "C", "B", "A"];

const ROUTES = Object.freeze({
  E: Object.freeze({
    segment: "exploring",
    eyebrow: "まずは見比べる",
    title: "選択肢を、同じ物差しで整理しましょう。",
    body: "比較テンプレートを使い、気になるテーマと次に確かめたいことを自分の言葉で整理できます。",
    target: "comparison",
    cta: "比較テンプレートを開く"
  }),
  D: Object.freeze({
    segment: "learning",
    eyebrow: "変化をつかむ",
    title: "新しい動きを、判断材料に変えましょう。",
    body: "短いフロンティア記事から、いま起きている変化と検討の観点を確認できます。",
    target: "frontier",
    cta: "フロンティア記事を読む"
  }),
  C: Object.freeze({
    segment: "mobilizing",
    eyebrow: "構想を動かす",
    title: "あなたの構想は、もう動かし始められます。",
    body: "組織で共通言語をつくるための要点を持ち帰り、最初の対話を設計しましょう。",
    target: "organization",
    cta: "組織向け資料を見る"
  }),
  B: Object.freeze({
    segment: "connecting",
    eyebrow: "継続して受け取る",
    title: "実践につながる更新を、必要なときに。",
    body: "ニュースレターで、新しい記事やテンプレートの公開情報を受け取れます。",
    target: "newsletter",
    cta: "更新を受け取る"
  }),
  A: Object.freeze({
    segment: "aligning",
    eyebrow: "Purposeから考える",
    title: "判断の起点を、Purposeに戻しましょう。",
    body: "ConnectiveByteが目指す世界と、私たちが大切にする判断基準を紹介します。",
    target: "purpose",
    cta: "Purposeを読む"
  })
});

const RANK = Object.freeze({ E: 0, D: 1, C: 2, B: 3, A: 4 });

export function getInterestRoute(interest) {
  return Object.prototype.hasOwnProperty.call(ROUTES, interest) ? ROUTES[interest] : null;
}

export function shouldUseStrongCMessage(interest) {
  return interest === "C";
}

export function promoteBySelfSelection(currentInterest, selfSelectedInterest) {
  if (!INTERESTS.includes(selfSelectedInterest)) return currentInterest ?? null;
  if (!INTERESTS.includes(currentInterest)) return selfSelectedInterest;
  return RANK[selfSelectedInterest] > RANK[currentInterest] ? selfSelectedInterest : currentInterest;
}

export function getEligibleSegments(selfSelections) {
  if (!Array.isArray(selfSelections)) return [];
  return selfSelections
    .filter((interest, index) => INTERESTS.includes(interest) && selfSelections.indexOf(interest) === index)
    .map((interest) => ROUTES[interest].segment);
}

// 公開サイト向けの段階モデル。AI活用の成熟度を一般論レベルの4段階で示す。
// 詳細な段階の定義は非公開（研究開発中）。
const PHASES = Object.freeze([
  Object.freeze({
    id: "P1",
    label: "AIを知る・比べる段階",
    next_hints: Object.freeze([
      "気になる仕事で、複数のAIに同じ指示を出して出力を比べてみる",
      "違いを感じた仕事をメモし、次に確かめたいことを1つ決める"
    ])
  }),
  Object.freeze({
    id: "P2",
    label: "AIで試す・扱う段階",
    next_hints: Object.freeze([
      "自分の仕事の中で難しく重要なタスクを選び、AIにどこまでできるか試す",
      "うまくいった例といかなかった例を、記録として残す"
    ])
  }),
  Object.freeze({
    id: "P3",
    label: "AIを仕組みにする段階",
    next_hints: Object.freeze([
      "繰り返し使う手順をまとめ、同じ結果を出しやすい形にする",
      "かかった費用と手間を記録し、次の見直しに使う"
    ])
  }),
  Object.freeze({
    id: "P4",
    label: "AIを広げて事業にする段階",
    next_hints: Object.freeze([
      "他の部門・顧客・業務にも同じ仕組みを試し、成果を比べる",
      "事業全体の費用と成果を、共通の物差しで眺める"
    ])
  })
]);

// 「はい」「トライ中（取り組み中）」を該当、「いいえ」「わからない」「該当しない」を非該当として扱う。
const AFFIRMATIVE_ANSWERS = Object.freeze(new Set(["はい", "トライ中（取り組み中）", "トライ中"]));

// 初回visitor向けの3問。全ていいえならP1。max-affirmative-phaseで判定。
const DIAGNOSTIC_QUESTIONS = Object.freeze([
  Object.freeze({ id: "Q0", phase: 2, label: "自分の仕事のタスクをAIに実際に試して、どこまでできるかを確かめていますか" }),
  Object.freeze({ id: "Q1", phase: 3, label: "AIを組み込んだ仕組みを作って、業務で繰り返し使っていますか" }),
  Object.freeze({ id: "Q2", phase: 4, label: "AI活用を通じて、顧客がつき売上や利益が生まれる事業を始めていますか" })
]);

// メルアド登録者向けの詳細版 (12問・各段階3問)。idは D プレフィックスで
// 初回3問 (Q*) と衝突させない — 両セットで Q0 のphase意味が異なるため、
// ラジオのchecked状態や回答の持ち越しを構造的に防ぐ。
const DETAILED_QUESTIONS = Object.freeze([
  Object.freeze({ id: "D0", phase: 1, label: "AIを自分の仕事や事業に関係するものとして意識したことがありますか" }),
  Object.freeze({ id: "D1", phase: 1, label: "現在一番性能が高いとされるAIを実際に使って、その出力を確認していますか" }),
  Object.freeze({ id: "D2", phase: 1, label: "複数のAIの間で性能の違い（文章の正確さ、指示の理解、長い資料の扱い、一貫性など）を、自分の言葉で説明できますか" }),
  Object.freeze({ id: "D3", phase: 2, label: "自分の仕事の中で重要かつ難しい課題で複数のAIを比べて、どこまでできてどこからうまくいかないかを把握していますか" }),
  Object.freeze({ id: "D4", phase: 2, label: "今の高性能AIがあるからこそ着手できた新しい仕事を、実際に始めていますか" }),
  Object.freeze({ id: "D5", phase: 2, label: "今の最高性能のAIでも解けずに止まっている重要な仕事があり、その仕事を進めるための活動をしていますか" }),
  Object.freeze({ id: "D6", phase: 3, label: "AIを組み込んだ仕組みを構築し、モデルの苦手な部分を検索・ツール・人間の確認などで補いながら、実際の業務で繰り返し使っていますか" }),
  Object.freeze({ id: "D7", phase: 3, label: "成功1件あたりの総コスト（費用と手間を含む）を測って、求める品質を保ったまま最適化していますか" }),
  Object.freeze({ id: "D8", phase: 3, label: "AIの実行結果を評価してプロンプトやモデル構成などを見直す改善ループを、継続的に回していますか" }),
  Object.freeze({ id: "D9", phase: 4, label: "その仕組みを別の部門・顧客・地域・業務に合わせて調整して展開し、成果を確認していますか" }),
  Object.freeze({ id: "D10", phase: 4, label: "AIを活用する仕組みを通じて、顧客がつき売上と利益が生まれる新しい事業を始めていますか" }),
  Object.freeze({ id: "D11", phase: 4, label: "事業全体で人・金・時間などの配分を、全体としてより良くしようと取り組んでいますか" })
]);

function isAffirmative(answer) {
  if (answer === true) return true;
  if (typeof answer === "string") return AFFIRMATIVE_ANSWERS.has(answer.trim());
  return false;
}

function isAnswered(entry) {
  return Boolean(entry) && typeof entry === "object"
    && typeof entry.id === "string"
    && (typeof entry.answer === "boolean" || (typeof entry.answer === "string" && entry.answer.trim() !== ""));
}

export function run_diagnosis(declared_interest, self_reported_behaviors, questions = DIAGNOSTIC_QUESTIONS) {
  const interest = INTERESTS.includes(declared_interest) ? declared_interest : null;
  const behaviors = Array.isArray(self_reported_behaviors) ? self_reported_behaviors : [];
  const questionSet = Array.isArray(questions) && questions.length > 0 ? questions : DIAGNOSTIC_QUESTIONS;
  const answeredIds = behaviors.filter(isAnswered).map((entry) => entry.id);
  const yesCount = behaviors.filter((entry) => isAnswered(entry) && isAffirmative(entry.answer)).length;
  const phaseById = new Map(questionSet.map((question) => [question.id, question.phase]));
  let currentPhase = 1;
  for (const entry of behaviors) {
    if (isAffirmative(entry?.answer) && phaseById.has(entry?.id)) {
      const entryPhase = phaseById.get(entry.id);
      if (entryPhase > currentPhase) currentPhase = entryPhase;
    }
  }
  const phase = PHASES[currentPhase - 1];
  return {
    current_phase: currentPhase,
    current_phase_label: phase.label,
    next_hints: Object.freeze([...phase.next_hints]),
    questions: questionSet,
    ready: true,
    declared_interest: interest,
    answered: answeredIds.length,
    yes_count: yesCount
  };
}

export function buildDiagnosticCompletedEvent(declared_interest, self_reported_behaviors, questions = DIAGNOSTIC_QUESTIONS) {
  const result = run_diagnosis(declared_interest, self_reported_behaviors, questions);
  return {
    name: "diagnostic_completed",
    asset_id: "diagnostic_flow",
    cta_id: "diagnostic_submit",
    diagnostic_answered: result.answered,
    diagnostic_yes: result.yes_count,
    diagnostic_ready: result.ready
  };
}

export const FORBIDDEN_ATTRIBUTES = Object.freeze([
  "occupation",
  "profession",
  "job",
  "job_title",
  "income",
  "salary",
  "revenue",
  "annual_income",
  "ability",
  "skill_level",
  "aptitude",
  "personality",
  "character",
  "traits",
  "ai_proficiency",
  "ai_literacy",
  "ai_familiarity",
  "ai_skill",
  "external_history",
  "work_history",
  "career_history",
  "resume",
  "cv",
  "linkedin_url"
]);

export function filterForbiddenAttributes(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const cleaned = {};
  for (const key of Object.keys(event)) {
    if (!FORBIDDEN_ATTRIBUTES.includes(key)) cleaned[key] = event[key];
  }
  return cleaned;
}

export function buildEventBatch(events) {
  if (!Array.isArray(events)) return [];
  return events
    .map(filterForbiddenAttributes)
    .filter((event) => event && typeof event.name === "string" && EVENT_TYPES.has(event.name));
}

const EVENT_TYPES = Object.freeze(new Set([
  "landing_viewed",
  "article_viewed",
  "interest_selected",
  "diagnostic_started",
  "diagnostic_completed",
  "comparison_template_viewed",
  "comparison_template_downloaded",
  "comparison_template_started",
  "comparison_template_completed",
  "level_table_read_100",
  "frontier_article_read_75",
  "org_pdf_downloaded",
  "newsletter_subscribed",
  "outbound_cta_clicked",
  "manual_collaboration_candidate",
  "shared_result_viewed",
  "shared_result_trial_started",
  "share_template_selected",
  "share_draft_generated",
  "x_intent_opened",
  "result_card_created",
  "feedback_submitted"
]));

export { INTERESTS, DIAGNOSTIC_QUESTIONS, DETAILED_QUESTIONS, EVENT_TYPES, PHASES, AFFIRMATIVE_ANSWERS };
