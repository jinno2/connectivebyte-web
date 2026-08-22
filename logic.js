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

const [redacted]_APPROVED = false;

const DIAGNOSTIC_QUESTIONS = Object.freeze([
  Object.freeze({ id: "explores_options", label: "複数の選択肢を自分で並べて比べたことがある" }),
  Object.freeze({ id: "tracks_changes", label: "新しい動きや変化を自分から調べたことがある" }),
  Object.freeze({ id: "mobilizes_others", label: "人を集めて小さな実験を始めたことがある" }),
  Object.freeze({ id: "sustains_practice", label: "継続して情報を受け取り、試している" }),
  Object.freeze({ id: "aligns_purpose", label: "判断の起点をPurposeや価値に戻している" })
]);

export function run_diagnosis(declared_interest, self_reported_behaviors) {
  const interest = INTERESTS.includes(declared_interest) ? declared_interest : null;
  const behaviors = Array.isArray(self_reported_behaviors) ? self_reported_behaviors : [];
  const answeredIds = behaviors
    .filter((entry) => entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.answer === "boolean")
    .map((entry) => entry.id);
  const yesCount = behaviors.filter((entry) => entry && entry.answer === true).length;
  if (![redacted]_APPROVED) {
    return {
      current_level: "定義確定後に診断結果を表示できます",
      next_actions: Object.freeze([
        "比較テンプレートで、いま気になることと次に確かめたいことを整理する",
        "関心に沿った資料を読み、自分の言葉でメモを残す",
        "整理が進んだら、誰か一人と最初の対話を試す"
      ]),
      questions: DIAGNOSTIC_QUESTIONS,
      ready: false,
      declared_interest: interest,
      answered: answeredIds.length,
      yes_count: yesCount
    };
  }
  return {
    current_level: Math.min(yesCount, DIAGNOSTIC_QUESTIONS.length),
    next_actions: Object.freeze(["比較テンプレートで次の一歩を整理する"]),
    questions: DIAGNOSTIC_QUESTIONS,
    ready: true,
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

export { INTERESTS, DIAGNOSTIC_QUESTIONS, EVENT_TYPES, [redacted]_APPROVED };
