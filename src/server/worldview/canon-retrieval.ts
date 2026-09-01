import type { WorldviewCanonFact } from "@/domain/worldview-v2";

function normalize(text: string): string {
  return text.toLowerCase();
}

/** W3：按别名与用户原文做本地检索。 */
export function retrieveCanonFacts(
  userMessage: string,
  facts: WorldviewCanonFact[],
  limit = 3,
): WorldviewCanonFact[] {
  const query = normalize(userMessage);
  const scored = facts
    .filter((fact) => fact.enabled)
    .map((fact) => {
      let score = 0;
      for (const alias of fact.aliases) {
        if (query.includes(normalize(alias))) score += 2;
      }
      if (query.includes(normalize(fact.content.slice(0, 8)))) score += 1;
      for (const token of query.split(/\s+/)) {
        if (token.length >= 2 && normalize(fact.content).includes(token)) {
          score += 0.5;
        }
      }
      return { fact, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored.slice(0, limit).map((entry) => entry.fact);
}
