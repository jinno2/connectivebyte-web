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

// Framework Core: connective-intelligence-framework v2.0.1（2026-08-23人間承認）よりコピー。
// 出典: maturity-framework/cil-0-11.ja.yaml（正本md由来の派生物）。本ファイルでの定義の再構成・追加を禁止する。
export const FRAMEWORK_VERSION = "2.0.1";

const [redacted]_APPROVED = true;

const LEVELS = Object.freeze([
  Object.freeze({ level: 0, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 1, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 2, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 3, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 4, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 5, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 6, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 7, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 8, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 9, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 10, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze(["[redacted]"]) }),
  Object.freeze({ level: 11, name_ja: "[redacted]", definition: "[redacted]", exit_conditions: Object.freeze([]) })
]);

// Framework Core: maturity-framework/diagnostic-questions.ja.yaml v2.0.1よりコピー。
// 「はい」「トライ中（取り組み中）」を該当、「いいえ」「わからない」「該当しない」を非該当として扱う。
const AFFIRMATIVE_ANSWERS = Object.freeze(new Set(["はい", "トライ中（取り組み中）", "トライ中"]));

const DIAGNOSTIC_QUESTIONS = Object.freeze([
  Object.freeze({ id: "Q0", level: 0, label: "AIを自分の仕事や事業に関係するものとして意識したことがありますか" }),
  Object.freeze({ id: "Q1", level: 1, label: "現在一番性能が高いとされるAI（フロンティアモデル）を実際に使って、その出力を確認していますか" }),
  Object.freeze({ id: "Q2", level: 2, label: "複数のAIの間で性能の違い（文章の正確さ、指示の理解、長い資料の扱い、一貫性など）を、自分の言葉で説明できますか" }),
  Object.freeze({ id: "Q3", level: 3, label: "自分の仕事の中で重要かつ難しい課題（[redacted]）で複数のAIを比べて、どこまでできてどこからうまくいかないかを把握していますか" }),
  Object.freeze({ id: "Q4", level: 4, label: "今の高性能AIがあるからこそ着手できた新しい仕事を、実際に始めていますか" }),
  Object.freeze({ id: "Q5", level: 5, label: "今の最高性能のAIでも解けずに止まっている重要な仕事があり、その仕事を進めるための活動をしていますか" }),
  Object.freeze({ id: "Q6", level: 6, label: "AIを組み込んだ仕組み（[redacted]）を構築し、モデルの苦手な部分を検索・ツール・人間の確認などで補いながら、実際の業務で繰り返し使っていますか" }),
  Object.freeze({ id: "Q7", level: 7, label: "成功1件あたりの総コスト（費用と手間を含む）を測って、求める品質を保ったまま最適化していますか" }),
  Object.freeze({ id: "Q8", level: 8, label: "AIの実行結果を評価してプロンプトやモデル構成などを見直す改善ループを、継続的に回していますか" }),
  Object.freeze({ id: "Q9", level: 9, label: "その仕組みを別の部門・顧客・地域・業務に合わせて調整して展開し、成果を確認していますか" }),
  Object.freeze({ id: "Q10", level: 10, label: "顧客がつき、売上と利益が生まれる新しい事業を、仕組みが継続的に生み出していますか" }),
  Object.freeze({ id: "Q11", level: 11, label: "複数の事業と社外の経済主体も含めて、人・金・時間などの配分を共通の物差しで全体として最適化していますか" })
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

export function run_diagnosis(declared_interest, self_reported_behaviors) {
  const interest = INTERESTS.includes(declared_interest) ? declared_interest : null;
  const behaviors = Array.isArray(self_reported_behaviors) ? self_reported_behaviors : [];
  const answeredIds = behaviors.filter(isAnswered).map((entry) => entry.id);
  const yesCount = behaviors.filter((entry) => isAnswered(entry) && isAffirmative(entry.answer)).length;
  const levelById = new Map(DIAGNOSTIC_QUESTIONS.map((question) => [question.id, question.level]));
  let currentLevel = 0;
  for (const entry of behaviors) {
    if (isAffirmative(entry?.answer) && levelById.has(entry?.id)) {
      const entryLevel = levelById.get(entry.id);
      if (entryLevel > currentLevel) currentLevel = entryLevel;
    }
  }
  const levelDef = LEVELS[currentLevel];
  return {
    current_level: currentLevel,
    current_level_name: levelDef.name_ja,
    next_actions: Object.freeze([...levelDef.exit_conditions]),
    questions: DIAGNOSTIC_QUESTIONS,
    ready: [redacted]_APPROVED,
    framework_version: FRAMEWORK_VERSION,
    declared_interest: interest,
    answered: answeredIds.length,
    yes_count: yesCount
  };
}

export function buildDiagnosticCompletedEvent(declared_interest, self_reported_behaviors) {
  const result = run_diagnosis(declared_interest, self_reported_behaviors);
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
  "result_page_viewed",
  "share_template_selected",
  "share_draft_generated",
  "x_intent_opened",
  "result_card_downloaded",
  "same_condition_trial_started"
]));

export { INTERESTS, DIAGNOSTIC_QUESTIONS, EVENT_TYPES, [redacted]_APPROVED, LEVELS, AFFIRMATIVE_ANSWERS };
