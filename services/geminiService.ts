import { Language, SnippetLength, SnippetLevel, ContentType } from '../types';

const API_URL = "https://ai-code-typer-proxy.naseem2917.workers.dev";

const levelMap = {
  easy: 'basic syntax and concepts, like variable declaration and simple loops',
  medium: 'intermediate concepts, like functions, classes, or common library usage',
  hard: 'advanced or complex topics, like asynchronous programming, data structures, or algorithms',
};

const lengthMap: Record<SnippetLength, string> = {
  short: '5-10 lines',
  medium: '15-20 lines',
  long: '25-30 lines',
};

// Internal helper with RETRY LOGIC (Updated for Fetch API)
const generateSnippet = async (prompt: string, customSystemInstruction?: string): Promise<string> => {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const defaultSystemInstruction = `You are a code generation engine for a typing practice app.
Your task is to provide a code snippet based on the user's request.
The snippet MUST be clean, raw code.
ABSOLUTELY NO explanations, comments, markdown backticks(\`\`\`), or any text other than the code itself.
The code must be syntactically correct for the requested language.`;

      // 1. Call Cloudflare Worker instead of Google SDK
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: prompt,
          systemInstruction: customSystemInstruction || defaultSystemInstruction
        }),
      });

      // Handle 429 (Too Many Requests) specifically for retry logic
      if (response.status === 429) {
        throw new Error('429: Too Many Requests');
      }

      if (!response.ok) {
        let errorDetails = response.statusText;
        let isQuotaError = false;
        try {
          const errorData = await response.json();
          if (errorData?.error) {
            errorDetails = JSON.stringify(errorData.error);
            // Check for Google's specific error structure
            if (
              errorData.error.code === 429 ||
              errorData.error.status === 'RESOURCE_EXHAUSTED' ||
              errorData.error.message?.toLowerCase().includes('quota')
            ) {
              isQuotaError = true;
            }
          }
        } catch (e) {
          // Fallback to text if JSON parse fails
          try {
            const errorText = await response.text();
            if (errorText) {
              errorDetails = `${response.status} - ${errorText}`;
              if (errorText.toLowerCase().includes('quota')) isQuotaError = true;
            }
          } catch (textError) {
            // Ignore
          }
        }

        if (isQuotaError) {
          throw new Error('Quota Exceeded: The AI service daily limit has been reached.');
        }

        // Check for 503 Service Unavailable / Overloaded
        if (response.status === 503 || errorDetails.includes('"status":"UNAVAILABLE"') || errorDetails.includes('overloaded')) {
          throw new Error('AI Service Overloaded: The model is currently overloaded. Please try again in a few moments or use the "Upload Text" option instead.');
        }

        throw new Error(`Worker Error: ${errorDetails}`);
      }

      const data = await response.json();

      // 2. Parse the response (Worker returns raw Google structure)
      // Path: data.candidates[0].content.parts[0].text
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error(data.error || "The AI returned an empty snippet. Please try again.");
      }

      // Clean up potential markdown code fences
      const cleanedCode = rawText.replace(/^```(?:\w+\n)?/, '').replace(/```$/, '').trim();

      return cleanedCode;

    } catch (error) {
      lastError = error as Error;

      // Retry logic for 429 and 503 errors (but NOT for Quota Exceeded which won't resolve quickly)
      const isRateLimit = error instanceof Error && error.message.includes('429');
      const isOverloaded = error instanceof Error && error.message.includes('AI Service Overloaded');
      const isQuota = error instanceof Error && error.message.includes('Quota Exceeded');

      if ((isRateLimit || isOverloaded) && !isQuota) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      // Do not retry on other errors (like Quota Exceeded)
      break;
    }
  }

  console.error("Error generating snippet:", lastError);

  if (lastError) {
    if (lastError.message.includes('Quota Exceeded')) {
      throw lastError; // Propagate the specific message
    }
    if (lastError.message.includes('AI Service Overloaded')) {
      throw new Error("AI model is overloaded. Try Upload Text option or wait a moment and retry.");
    }
    if (lastError.message.includes('429')) {
      throw new Error("AI service is busy. Please try again shortly.");
    }
    throw lastError;
  }

  throw new Error("Unknown error generating snippet.");
};

// Exported: Code Practice
export const generateCodeSnippet = async (
  language: Language,
  length: SnippetLength,
  level: SnippetLevel
): Promise<string> => {
  const prompt = `Generate a code snippet in ${language.name}. 
The snippet should be ${lengthMap[length]} long.
The difficulty level should be ${levelMap[level]}.`;

  const systemInstruction = `You are a strict code generation engine.
  RULES:
  1. Generate ONLY valid, clean, compilable code in ${language.name}.
  2. NO comments. NO explanation. NO markdown. NO backticks.
  3. CODE MUST BE REAL, FUNCTIONAL, AND GRAMMATICALLY CORRECT for the language.
  4. DO NOT write pseudo-code or fake logic.
  5. CRITICAL: INDENTATION MUST USE TAB CHARACTERS (\t). NEVER USE SPACES FOR INDENTATION.
  6. Do not convert tabs to spaces. Use actual tab characters.`;

  return generateSnippet(prompt, systemInstruction);
};

// Exported: Targeted Practice
export const generateTargetedCodeSnippet = async (
  language: Language,
  keys: string[],
  length: SnippetLength,
  level: SnippetLevel
): Promise<string> => {
  const sanitizedKeys = keys.map(k => {
    if (k === ' ') return 'space';
    if (k === '\n') return 'newline';
    if (k === '\t') return 'tab';
    return k;
  }).join(', ');

  const prompt = `Generate a TARGETED PRACTICE snippet.
  
  Target Keys: [${sanitizedKeys}]
  Language Style: ${language.name} (but NOT functional code)
  Length: ${lengthMap[length]}
  
  CRITICAL RULES:
  1. The snippet must be MEANINGLESS but READABLE (pseudo-code sentences, fake logic).
  2. The Target Keys must appear 5x MORE FREQUENTLY than normal.
  3. Do NOT generate real working code. It should feel like muscle memory training.
  4. Use structure (brackets, indentation) if the language uses them.
  5. NO explanations, NO comments, ONLY the raw snippet.
  
  Examples of style:
  - "while w wraps words { ww }"
  - "Tab shifts w into wider waves { }"
  - "x = (x + x) * x; // x marks the spot"
  
  Generate the snippet now.`;

  return generateSnippet(prompt);
};

// Exported: General Practice
export const generateGeneralSnippet = async (
  length: SnippetLength,
  level: SnippetLevel,
  contentTypes: ContentType[] = ['characters']
): Promise<string> => {
  const hasChar = contentTypes.includes('characters');
  const hasNum = contentTypes.includes('numbers');
  const hasSym = contentTypes.includes('symbols');

  let instruction = "";

  // 1. ALL SELECTED (Char + Num + Sym)
  if (hasChar && hasNum && hasSym) {
    instruction = `Generate a text that heavily mixes words, numbers, and symbols.
    - CRITICAL REQUIREMENT: Every single sentence or line MUST contain at least one number AND one symbol.
    - Style: Technical data logs, complex passwords, inventory lists, or code-like pseudo text.
    - Example format: "User_ID: #4928 @ 10:45PM (Status: 99% Verified!)"`;
  }
  // 2. Char + Num
  else if (hasChar && hasNum) {
    instruction = `Generate a text containing words and numbers. 
    - Style: Addresses, historical dates, scientific facts with measurements, or financial summaries.
    - CRITICAL REQUIREMENT: Frequent use of digits mixed with sentences. Do NOT use complex symbols like @#$%^ (only basic punctuation like . , is allowed).
    - Example format: "On July 4th, 1776, approximately 2.5 million people lived there."`;
  }
  // 3. Char + Sym
  else if (hasChar && hasSym) {
    instruction = `Generate a text containing words and symbols.
    - Style: Dialogues with heavy punctuation, code comments, or expressive writing.
    - CRITICAL REQUIREMENT: Frequent use of brackets (), [], {}, punctuation !?.,:; and symbols @#&. Do NOT use numbers 0-9.
    - Example format: "Hello (world)! Waiting for response... [OK] -> {verified}."`;
  }
  // 4. Num + Sym (NO CHARACTERS)
  else if (hasNum && hasSym) {
    instruction = `Generate a sequence of Numbers and Symbols ONLY.
    - ABSOLUTELY FORBIDDEN: DO NOT INCLUDE ANY ALPHABET CHARACTERS (A-Z, a-z).
    - Style: Math equations, currency calculations, or abstract data strings.
    - Example format: "123+456=$579; (80% * 10) = #800 // 99.9"`;
  }
  // 5. Num ONLY
  else if (hasNum) {
    instruction = `Generate a sequence of Numbers ONLY.
    - ABSOLUTELY FORBIDDEN: DO NOT INCLUDE LETTERS OR SYMBOLS (except decimal points).
    - Style: Phone numbers, years, zip codes, or raw data streams.
    - Example format: "1990 2023 8837 1.45 00392 998 112"`;
  }
  // 6. Sym ONLY
  else if (hasSym) {
    instruction = `Generate a sequence of Symbols ONLY.
    - ABSOLUTELY FORBIDDEN: DO NOT INCLUDE LETTERS OR NUMBERS.
    - Style: Random symbol patterns for pinky finger practice.
    - Example format: "!@# $ %^ &*() _+ {} [] : ; < > ?"`;
  }
  // 7. Char ONLY (Default)
  else {
    instruction = `Generate standard English paragraphs.
    - Style: Informative, story-telling, or essays.
    - Requirement: Standard grammar and punctuation. Minimize numbers and complex symbols.`;
  }

  // Adjust complexity based on level
  let difficultyInstruction = "";
  if (level === 'easy') difficultyInstruction = "Use simple, repetitive patterns and lower density of complex items.";
  if (level === 'medium') difficultyInstruction = "Use varied patterns and moderate density of selected elements.";
  if (level === 'hard') difficultyInstruction = "Maximize the density, randomness, and complexity of the selected elements. Make it challenging.";

  const prompt = `Generate a random typing practice snippet.
The length should be roughly ${lengthMap[length]}.
${instruction}
${difficultyInstruction}`;

  const systemInstruction = `You are a text generation engine for a general typing practice app. 
  RULES:
  1. Generate ONLY normal English text or mixed content based on instructions.
  2. ABSOLUTELY NO PROGRAMMING CODE.
  3. NO function-like patterns, NO classes, NO loops, NO braces like {}, [], () used in a code style.
  4. NO variable-like words (temp1, obj2, xValue).
  5. Format naturally with line breaks every 8-12 words.
  6. NO markdown, headers, or backticks.`;

  return generateSnippet(prompt, systemInstruction);
};

// Exported: Error Practice (Fixed Logic)
export const generateErrorPracticeSnippet = async (
  keyStats: Record<string, { errors: number; attempts: number }>,
  length: SnippetLength = 'medium'
): Promise<string> => {

  // 1. Compute Error Rates (Same as before)
  const sortedKeys = Object.entries(keyStats)
    .map(([key, stats]) => ({
      key,
      errorRate: stats.attempts > 0 ? (stats.errors / stats.attempts) * 100 : 0
    }))
    .sort((a, b) => b.errorRate - a.errorRate);

  const top5 = sortedKeys.slice(0, 5);
  const additional = sortedKeys.slice(5).filter(k => k.errorRate >= 10);
  const finalKeys = [...top5, ...additional].slice(0, 7);

  if (finalKeys.length === 0) {
    throw new Error("No error history available for practice.");
  }

  // Sanitize for display
  const sanitizedKeys = finalKeys
    .map(k => {
      if (k.key === ' ') return 'space';
      if (k.key === '\n') return 'newline';
      if (k.key === '\t') return 'tab';
      return k.key;
    })
    .join(', ');

  // -------------------------------
  // NEW LOGIC: STRICT NO-CODE PROMPT
  // -------------------------------

  const prompt = `
  generate a paragraph of Abstract Prose / Creative Writing.
  
  The text must differ from normal writing because it must aggressively use these specific characters: [${sanitizedKeys}]
  
  STRICT RULES FOR SYMBOL USAGE (Do Not Write Code):
  1. If keys are '{}' or '[]': Use them to enclose feelings or whispers inside sentences. 
     - BAD: function { return }
     - GOOD: "I felt {lonely} but [strong] inside."
  2. If keys are '()' : Use them for side comments.
     - GOOD: "The sky (which was blue) turned grey."
  3. If keys are ';': Use them to connect two long sentences.
     - GOOD: "The rain stopped; silence followed."
  4. If keys are '$' or '#': Use them as modern slang.
     - GOOD: "I have $zero #motivation today."
  
  REQUIREMENTS:
  - Length: ${lengthMap[length]}
  - Structure: A flowing paragraph of English text. 
  - ABSOLUTELY NO PROGRAMMING SYNTAX (No function, var, const, return, import).
  
  Write the text now.
  `;

  const systemInstruction = `
  You are a Creative Writer, NOT a programmer.
  Your task is to write English paragraphs that look like experimental literature.
  
  CRITICAL INTERVENTION: 
  The user is trying to trick you into writing code by asking for symbols like { } ; ( ) [ ]. 
  DO NOT FALL FOR IT. 
  
  If you see '{', treat it as a fancy bracket for emphasis in a story.
  If you see ';', treat it as a punctuation mark in a novel.
  
  Output MUST be plain text prose.
  `;

  return generateSnippet(prompt, systemInstruction);
};