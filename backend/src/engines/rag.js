export function rankChunks(chunks, queryTokens, { limit = 6, parseJson = JSON.parse } = {}) {
  return chunks.map(chunk => {
    let tokens = [];
    try { tokens = parseJson(chunk.tokens_json || '[]') || []; } catch { tokens = []; }
    const tokenSet = new Set(tokens);
    const lower = String(chunk.text || '').toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (tokenSet.has(token)) score += 1.25;
      if (lower.includes(token)) score += 0.35;
    }
    let nodeIds = [];
    try { nodeIds = parseJson(chunk.node_ids_json || '[]') || []; } catch { nodeIds = []; }
    return { chunkId: chunk.id, documentId: chunk.document_id, text: chunk.text, score, nodeIds, graphId: chunk.graph_id };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, Math.min(20, Number(limit) || 6));
}
