const Anthropic = require('@anthropic-ai/sdk');

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function getClient(apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// Chiamata generica text+immagini, usata dal fallback AI degli script di checks/.
// images: [{ base64, mediaType }]
async function askVision({ apiKey, model = DEFAULT_MODEL, prompt, images = [], maxTokens = 500 }) {
  const client = getClient(apiKey);
  if (!client) {
    throw new Error('Nessuna ANTHROPIC_API_KEY disponibile (env o --ai-key)');
  }

  const content = [
    { type: 'text', text: prompt },
    ...images.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType || 'image/png', data: img.base64 }
    }))
  ];

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }]
  });

  return message.content[0].text;
}

// Estrae il primo blocco JSON dalla risposta di Claude; se il parsing fallisce
// (es. l'AI non ha rispettato il formato) ritorna null invece di lanciare.
function parseJSONResponse(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

module.exports = { getClient, askVision, parseJSONResponse, DEFAULT_MODEL };
