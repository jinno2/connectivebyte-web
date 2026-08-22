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

const [redacted]_APPROVED = true;

const LEVELS = Object.freeze([
  Object.freeze({ level: 0, name_ja: "未接触", definition: "生成AIを自分の意思で使ったことがない。床の上昇を外部ニュースとしてのみ知覚している。", exit_conditions: Object.freeze(["自分の意思で一度でもAIに入力し、出力を受け取る"]) }),
  Object.freeze({ level: 1, name_ja: "接触", definition: "AIを試したことがある。ただし用途は単発で、結果を仕事や生活に持ち帰っていない。", exit_conditions: Object.freeze(["特定の繰り返しタスクにAIを使い始める"]) }),
  Object.freeze({ level: 2, name_ja: "日常足場化", definition: "上がってきた床に乗り、日常のタスクの下準備をAIに任せている。日常はLunaで足りる状態。", exit_conditions: Object.freeze(["自分の職務固有のタスクへ意識的に適用範囲を広げる"]) }),
  Object.freeze({ level: 3, name_ja: "職務適用", definition: "職務固有のタスクにAIを組み込み、成果物の品質・速度が観測可能に変わっている。", exit_conditions: Object.freeze(["単発タスクを超えてワークフロー全体を再設計する"]) }),
  Object.freeze({ level: 4, name_ja: "ワークフロー再設計", definition: "タスク単位ではなく、仕事の流れそのものをAI前提に組み替えている。天井に自分から触れ始める。", exit_conditions: Object.freeze(["再現可能なシステム・[redacted]として外部化する"]) }),
  Object.freeze({ level: 5, name_ja: "システム構築", definition: "AIを組み込んだ再現可能なシステム（[redacted]）を構築し、自分以外でも回る状態を作っている。", exit_conditions: Object.freeze(["フロンティアモデルの限界を自分の課題で測定する"]) }),
  Object.freeze({ level: 6, name_ja: "フロンティア接触", definition: "最新フロンティアモデルに自分の実課題で触れ、天井の位置と限界を実測している。[redacted]の前に限界を測る段。", exit_conditions: Object.freeze(["測定結果に基づく配分（日常/フロンティア）の意思決定"]) }),
  Object.freeze({ level: 7, name_ja: "増殖", definition: "自分の接続能力を他者・チームへ複製している。使い方が個人技から共有資産になる。", exit_conditions: Object.freeze(["定着した仕組みの劣化を検知する視点を持つ"]) }),
  Object.freeze({ level: 8, name_ja: "腐敗検知と再登攀", definition: "定着した仕組み・知識が床の上昇によって陳腐化（腐敗）することを検知し、自ら壊して登り直す。腐敗を検知して再登攀する最初の段。", exit_conditions: Object.freeze(["再登攀の仕組み自体を事業・組織構造へ埋め込む"]) }),
  Object.freeze({ level: 9, name_ja: "事業再構成", definition: "[redacted]を前提に事業・組織の職務設計そのものを再構成している。床の上昇を組織の足場に変換する。", exit_conditions: Object.freeze(["再構成の成果が外部経済との取引に現れる"]) }),
  Object.freeze({ level: 10, name_ja: "現実経済接続", definition: "[redacted]による価値が市場・顧客・売上など現実経済の変化として観測できる。", exit_conditions: Object.freeze(["自分以外の主体が登るための接続路の提供を始める"]) }),
  Object.freeze({ level: 11, name_ja: "接続路の社会インフラ化", definition: "他の主体が0–10を登るための接続路（教育・ツール・コミュニティ・事業支援）を社会インフラとして提供・維持している。", exit_conditions: Object.freeze([]) })
]);

const DIAGNOSTIC_QUESTIONS = Object.freeze([
  Object.freeze({ id: "Q0", level: 0, label: "AIを自分の意思で使ったことがある" }),
  Object.freeze({ id: "Q1", level: 1, label: "AIに質問や雑談をしたことがある" }),
  Object.freeze({ id: "Q2", level: 2, label: "週に1回以上、要約や下書きなどの日常タスクにAIを使っている" }),
  Object.freeze({ id: "Q3", level: 3, label: "職務固有のタスクにAIを組み込んでいる" }),
  Object.freeze({ id: "Q4", level: 4, label: "タスク単位ではなく仕事の流れ全体をAI前提で組み替えた" }),
  Object.freeze({ id: "Q5", level: 5, label: "AIを組み込んだ再現可能なシステム（[redacted]）を構築・運用している" }),
  Object.freeze({ id: "Q6", level: 6, label: "最新フロンティアモデルに自分の実課題で触れ、限界を実測した" }),
  Object.freeze({ id: "Q7", level: 7, label: "自分の接続能力を他者やチームに複製した" }),
  Object.freeze({ id: "Q8", level: 8, label: "定着した仕組みが陳腐化したことを検知し、自ら壊して登り直した" }),
  Object.freeze({ id: "Q9", level: 9, label: "[redacted]を前提に事業や組織の職務設計を再構成した" }),
  Object.freeze({ id: "Q10", level: 10, label: "[redacted]による価値が市場や売上など現実経済の変化として観測された" }),
  Object.freeze({ id: "Q11", level: 11, label: "他の主体が0-10を登るための接続路を社会インフラとして提供・維持している" })
]);

export function run_diagnosis(declared_interest, self_reported_behaviors) {
  const interest = INTERESTS.includes(declared_interest) ? declared_interest : null;
  const behaviors = Array.isArray(self_reported_behaviors) ? self_reported_behaviors : [];
  const answeredIds = behaviors
    .filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.answer === "boolean")
    .map((entry) => entry.id);
  const yesCount = behaviors.filter((entry) => entry && entry.answer === true).length;
  const levelById = new Map(DIAGNOSTIC_QUESTIONS.map((question) => [question.id, question.level]));
  let currentLevel = 0;
  for (const entry of behaviors) {
    if (entry && entry.answer === true && levelById.has(entry.id)) {
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
  "manual_collaboration_candidate"
]));

export { INTERESTS, DIAGNOSTIC_QUESTIONS, EVENT_TYPES, [redacted]_APPROVED, LEVELS };
