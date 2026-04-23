import Anthropic from "@anthropic-ai/sdk";

// API key injected via env — never hardcoded
const client = new Anthropic({
  apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY as string,
  dangerouslyAllowBrowser: true,
});

export async function askClaude(query: string): Promise<string> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: query,
      },
    ],
    system:
      "You are Cortex Nova, a helpful voice assistant. Keep responses concise and conversational — they will be spoken aloud. Aim for 1-3 sentences.",
  });

  const block = message.content[0];
  if (block.type === "text") {
    return block.text;
  }
  return "I couldn't process that request.";
}
