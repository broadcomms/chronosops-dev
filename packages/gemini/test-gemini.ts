import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}

async function test() {
  console.log('Testing Gemini API...');

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: 'Say hello in one word.',
    });

    console.log('Response:', response.text);
    console.log('Success!');
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
