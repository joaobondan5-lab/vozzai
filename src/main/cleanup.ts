export async function cleanupText(rawText: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return rawText;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content:
            'Corrija pontuação, maiúsculas e formatação do texto ditado abaixo, mantendo o sentido e o idioma originais. Responda apenas com o texto corrigido, sem comentários.\n\n' +
            rawText,
        },
      ],
    }),
  });

  if (!response.ok) return rawText;

  const data = (await response.json()) as { content: { text: string }[] };
  return data.content?.[0]?.text ?? rawText;
}
