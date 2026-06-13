const express = require('express');
const router = express.Router();

// @route   POST api/sonic/chat
// @desc    Proxy chat prompt to Hugging Face with fallback support
router.post('/chat', async (req, res) => {
  const { prompt, history } = req.body;

  if (!prompt) {
    return res.status(400).json({ message: 'Prompt is required' });
  }

  const HF_TOKEN = process.env.HF_TOKEN;
  const COMPLETIONS_URL = 'https://api-inference.huggingface.co/v1/chat/completions';

  const systemPrompt = `You are SONIC, a helpful AI study assistant.
STRICT RULES:
1. ONLY answer questions related to studies, academics, homework, exams, courses, and educational topics. If the user asks a question that is NOT related to studies (such as casual chit-chat, hobbies, entertainment, sports, movies, games, jokes, personal questions, how to cook, etc.), you MUST politely decline and ask them to ask something related to studies.
2. STRICTLY FORBIDDEN: Do NOT use LaTeX math equations or symbol wrappers like \\[ ... \\], $$ ... $$, \\( ... \\), or $ ... $.
3. DO NOT write raw LaTeX math notation (e.g. \\frac, \\Sigma, \\Rightarrow, \\text, etc.).
4. Use clean, plain-text math/science equations and unicode symbols (e.g., use 'F_net = m * a', 'a = F_net / m', 'E = m * c^2', 'ΣF = 0 ⇒ v = constant').
5. DO NOT include unnecessary introductory phrases (such as "Sure! I can teach you..." or "Here is what you need...") or polite concluding chit-chat. Directly output the relevant educational notes, formulas, or step-by-step explanations.
6. Keep formatting clean and readable using standard bold text, list bullets, or simple markdown headers.`;

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  if (Array.isArray(history)) {
    for (const turn of history) {
      messages.push({
        role: turn.role === 'user' ? 'user' : 'assistant',
        content: turn.content
      });
    }
  }

  messages.push({ role: 'user', content: prompt });

  const models = [
    'openchat/openchat-3.5-0106',
    'Qwen/Qwen2.5-7B-Instruct',
    'mistralai/Mistral-7B-Instruct-v0.3',
    'HuggingFaceH4/zephyr-7b-beta'
  ];

  let lastError = null;

  for (const model of models) {
    try {
      console.log(`Backend proxy attempting model: ${model}`);
      const response = await fetch(COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HF_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: 500,
          temperature: 0.3
        })
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = (data.error && data.error.message) || data.error || `HTTP ${response.status}`;
        throw new Error(errorMsg);
      }

      if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
        return res.json({ response: data.choices[0].message.content });
      }
      throw new Error('Invalid response format from Hugging Face');
    } catch (err) {
      console.error(`Backend proxy failed for model ${model}:`, err.message);
      lastError = err;
    }
  }

  res.status(502).json({
    message: 'All models failed to respond in backend proxy.',
    error: lastError ? lastError.message : 'Unknown error'
  });
});

module.exports = router;
