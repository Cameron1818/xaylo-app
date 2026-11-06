import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { httpError } from '../security/access.js';
import { PROMPTS } from './prompts.js';

const confidence = z.enum(['low', 'medium', 'high']);
const finding = z.object({ observation: z.string().min(1).max(2000), evidenceIds: z.array(z.string()).min(1).max(10), confidence }).strict();
const recommendation = z.object({ action: z.string().min(1).max(1000), rationale: z.string().min(1).max(2000), priority: z.enum(['high', 'medium', 'low']), confidence, evidenceIds: z.array(z.string()).min(1).max(10) }).strict();
export const analysisSchema = z.object({ trafficAnalysis: z.object({ summary: z.string().min(1).max(4000), findings: z.array(finding).max(12) }).strict(),
  marketingRecommendations: z.array(recommendation).max(12), dataQuality: z.array(z.string().max(1000)).max(20) }).strict();
const strings = { type: 'array', items: { type: 'string' } };
const jsonSchema = { type: 'object', additionalProperties: false, required: ['trafficAnalysis', 'marketingRecommendations', 'dataQuality'], properties: {
  trafficAnalysis: { type: 'object', additionalProperties: false, required: ['summary', 'findings'], properties: { summary: { type: 'string' }, findings: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['observation', 'evidenceIds', 'confidence'], properties: { observation: { type: 'string' }, evidenceIds: strings, confidence: { type: 'string', enum: ['low', 'medium', 'high'] } }
  } } } },
  marketingRecommendations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['action', 'rationale', 'priority', 'confidence', 'evidenceIds'], properties: {
    action: { type: 'string' }, rationale: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, evidenceIds: strings
  } } }, dataQuality: strings
} };
export async function generateAnalysis(context: object, evidence: Record<string, unknown>, limitations: string[]) {
  const env = getEnv();
  if (!env.OPENAI_API_KEY || !env.AI_MODEL) throw httpError(503, 'AI reporting is not configured');
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(90_000),
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.AI_MODEL, store: false, max_output_tokens: 6000,
        instructions: `${PROMPTS.safety}\n\n${PROMPTS.traffic}\n\n${PROMPTS.marketing}`,
        input: JSON.stringify({ context, evidence, limitations }), text: { format: { type: 'json_schema', name: 'xaylo_marketing_report', strict: true, schema: jsonSchema } } }) });
  } catch { throw httpError(502, 'AI reporting is unavailable; try again'); }
  if (!response.ok) { await response.body?.cancel(); throw httpError(502, 'AI reporting failed; check the configured model and provider access'); }
  const data = await response.json() as { status?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] };
  if (data.status !== 'completed') throw httpError(502, 'AI analysis did not complete; try again');
  const output = data.output?.filter(item => item.type === 'message').flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text || '').join('');
  try {
    const analysis = analysisSchema.parse(JSON.parse(output || ''));
    for (const item of [...analysis.trafficAnalysis.findings, ...analysis.marketingRecommendations]) {
      if (item.evidenceIds.some(id => !Object.hasOwn(evidence, id))) throw new Error('Unknown evidence');
    }
    return analysis;
  } catch { throw httpError(502, 'AI analysis contained invalid or unsupported evidence; try again'); }
}
