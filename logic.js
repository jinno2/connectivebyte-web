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

export { INTERESTS };
