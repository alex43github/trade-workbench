import type { ExpertId, ExpertRound } from "../../lib/structure-radar/expert-types.ts";

type PeerThesis = { expert?: string; thesis: string };

export function buildExpertPrompt(input: {
  expert: ExpertId;
  round: ExpertRound;
  skillPath: string;
  marketSnapshot: unknown;
  peerTheses?: readonly PeerThesis[];
}) {
  const peers = (input.peerTheses ?? []).map((peer, index) => ({ alias: `Peer ${String.fromCharCode(65 + index)}`, thesis: peer.thesis }));
  return [
    `You are the ${input.expert} trading-system expert.`,
    `Read and follow the complete Skill rooted at: ${input.skillPath}`,
    "Use only the supplied closed-candle snapshot. Do not browse, trade, write files, or access account/position data.",
    `Round: ${input.round}.`,
    input.round === "R1" ? "Analyze independently; no peer opinions are available." : `Anonymized peer theses: ${JSON.stringify(peers)}`,
    `Market snapshot: ${JSON.stringify(input.marketSnapshot)}`,
    "Return only JSON matching the provided schema. Cite traceable Skill sources. Numeric prices must come from the current structure, not copied historical examples.",
  ].join("\n");
}

