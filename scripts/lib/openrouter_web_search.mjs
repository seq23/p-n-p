// One grounded-search call shape, shared by every lane that needs one.
//
// Why not Gemini. Google's grounded search is hard-blocked on this project's key:
// a plain generateContent returns 200, and the identical request with
// tools:[{google_search:{}}] returns 429 RESOURCE_EXHAUSTED. Reproduced across
// three models and persistent, so it is not a transient rate limit - the grounded
// path is simply not available. Two lanes were routed through it anyway:
// scripts/llm_citation_probe.mjs preferred Gemini whenever GEMINI_API_KEY existed,
// and scripts/search_intelligence/observe_live_search.mjs had no other path. Both
// therefore produced errors or nothing while reporting a number.
//
// OpenRouter's web plugin is the working replacement. The response carries
// message.annotations[], each with url_citation.url - the pages the answer was
// actually built from, which is the observation both lanes exist to take.
//
// Both callers share this module deliberately: proving the call shape once proves
// it for both, and a provider change cannot drift between them.

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_DEFAULT_MODEL = 'openai/gpt-4o-mini';
export const OPENROUTER_CREDENTIAL_ENV = 'OPENROUTER_API_KEY';

// The web plugin bills per result returned, so max_results is the cost dial and is
// always explicit. It is never raised implicitly by a caller that forgot to set it.
export const OPENROUTER_DEFAULT_MAX_RESULTS = 10;

export class OpenRouterError extends Error {
  constructor(message, { status = null, detail = null } = {}) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Ask OpenRouter a question with live web search enabled.
 *
 * Resolves to { answer, citations, annotations, raw }. It THROWS on a provider
 * failure rather than returning an empty citation list, because an empty list and
 * a failed call are different facts and a caller that cannot tell them apart will
 * record a failure as a zero.
 */
export async function openRouterWebSearch(query, {
  apiKey,
  model = OPENROUTER_DEFAULT_MODEL,
  maxResults = OPENROUTER_DEFAULT_MAX_RESULTS,
  maxTokens = 400,
  timeoutMs = 45000,
  signal,
} = {}) {
  if (!apiKey) throw new OpenRouterError(`no_credential:${OPENROUTER_CREDENTIAL_ENV}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let res;
  let payload;
  try {
    res = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        plugins: [{ id: 'web', max_results: maxResults }],
        messages: [{ role: 'user', content: query }],
      }),
    });
    payload = await res.json().catch(() => ({}));
  } catch (err) {
    throw new OpenRouterError(controller.signal.aborted ? 'provider_timeout' : 'provider_unreachable', {
      detail: String(err?.message || err),
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new OpenRouterError(`provider_http_${res.status}`, {
      status: res.status,
      detail: String(payload?.error?.message || '').slice(0, 500),
    });
  }

  const message = payload?.choices?.[0]?.message || {};
  const annotations = Array.isArray(message.annotations) ? message.annotations : [];
  const citations = [];
  for (const annotation of annotations) {
    const url = annotation?.url_citation?.url;
    if (url && !citations.includes(url)) citations.push(url);
  }
  return {
    answer: typeof message.content === 'string' ? message.content : '',
    citations,
    annotations,
    model,
    raw: payload,
  };
}

export function hostOf(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}
