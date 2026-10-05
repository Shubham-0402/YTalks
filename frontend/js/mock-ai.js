/**
 * mock-ai.js — the stand-in for a real AI provider API (Milestone 1).
 *
 * This module is the ONLY place that fakes provider behaviour. In Milestone 5
 * it is replaced by a real `AiProvider` implementation on the Spring Boot
 * backend, and the views do not need to change, because they only ever call
 * `requestCompletion()`.
 *
 * It deliberately reproduces the failure modes we must handle for real:
 * latency, streaming, rate limiting, timeouts, network loss and bad payloads.
 */

import { sleep } from './utils.js';

/** Error type the UI can switch on to pick a friendly message. */
export class MockProviderError extends Error {
  constructor(kind, message, hint = '') {
    super(message);
    this.name = 'MockProviderError';
    this.kind = kind; // 'rate_limit' | 'timeout' | 'network' | 'invalid'
    this.hint = hint;
    this.providerId = null;
  }
}

/* ------------------------------------------------------------------ */
/* Topic detection — makes the mock replies feel relevant             */
/* ------------------------------------------------------------------ */

const TOPICS = [
  {
    match: /\b(thread|concurren|executor|synchroni[sz]|deadlock|parallel)\b/i,
    name: 'concurrency',
    reply:
      'Short version: use a thread when the program must *wait* on something slow while staying responsive.\n\n**Runnable vs Callable**\n\n- `Runnable.run()` returns nothing and cannot throw checked exceptions.\n- `Callable.call()` returns a value and may throw a checked exception.\n\n**The pattern I would write**\n\n```java\nExecutorService pool = Executors.newFixedThreadPool(4);\ntry {\n    Future<String> result = pool.submit(() -> callSlowApi());\n    System.out.println(result.get());\n} finally {\n    pool.shutdown();\n}\n```\n\nTwo things beginners forget: always `shutdown()` the pool, and never `Future.get()` on the same thread that submitted the task — that deadlocks.',
  },
  {
    match: /\b(hashmap|treemap|list|collection|arraylist|set|iterator|stream)\b/i,
    name: 'collections',
    reply:
      'Here is the mental model that makes the Java collections stop being confusing.\n\n- `List` — ordered, allows duplicates, fast random access (`ArrayList`).\n- `Set` — no duplicates, fast "does it contain?" checks (`HashSet`).\n- `Map` — key → value, the one you will use most.\n\n**HashMap vs TreeMap**\n\n- `HashMap` is unordered and roughly O(1) per operation.\n- `TreeMap` keeps keys sorted and is O(log n), and it can also do `floorKey()` / `ceilingKey()`.\n\nIf nobody asks you for sorted keys, choose `HashMap` — it is faster and simpler.',
  },
  {
    match: /\b(sql|mysql|database|table|query|index|foreign key|jpa|normalis|normaliz)\b/i,
    name: 'database',
    reply:
      'Start with the nouns in your problem, and each noun becomes a table.\n\n**Rules I would not break**\n\n- Every table gets a surrogate primary key `id`.\n- Foreign keys for every relationship, with `ON DELETE CASCADE` only where it is genuinely intended.\n- Index every foreign key and every column you filter or sort on.\n- A `UNIQUE` constraint in the database beats a duplicate check in Java.\n\n```sql\nCREATE TABLE marks (\n  id BIGINT PRIMARY KEY AUTO_INCREMENT,\n  enrollment_id BIGINT NOT NULL,\n  marks_obtained DECIMAL(5,2) NOT NULL,\n  marks_max DECIMAL(5,2) NOT NULL,\n  CONSTRAINT fk_marks_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments(id)\n);\n```\n\nStore raw values, compute derived values like grades or percentages in a service layer.',
  },
  {
    match: /\b(git|rebase|merge|commit|branch|repo)\b/i,
    name: 'git',
    reply:
      'Git rewrites history on your local machine until you push, and the reflog is your safety net for roughly 90 days.\n\n**Undo a bad rebase**\n\n- `git reflog` — find the SHA just before the rebase.\n- `git reset --hard <sha>` — put the branch back.\n\n**Three habits that prevent it**\n\n- Rebase your own unpushed commits freely; never rebase a branch others are using.\n- `git config --global pull.rebase true` keeps history linear.\n- Read `git status` output before any history-changing command.\n\nIf you are ever unsure, `git status` and `git log --oneline -10` answer most questions.',
  },
  {
    match: /\b(dijkstra|graph|shortest path|bfs|dfs|algorithm|tree)\b/i,
    name: 'algorithms',
    reply:
      'Dijkstra in one sentence: always commit to the nearest unvisited node, because any later route to it can only be longer.\n\n- Start node goes into a priority queue with distance 0.\n- Pop the smallest distance, relax (improve) each neighbour.\n- Mark it visited; it can never be revisited.\n\n**When it breaks**\n\nIf any edge weight is negative, Dijkstra commits too early and returns a wrong answer — use Bellman-Ford, or A* with an admissible heuristic instead.\n\nFor unweighted graphs, plain BFS is both simpler and faster than Dijkstra.',
  },
  {
    match: /\b(cv|resume|internship|portfolio|interview|job)\b/i,
    name: 'career',
    reply:
      'A strong project bullet has three parts: what you built, the constraint you handled, and the result.\n\n- Weak: "Made a website using Java and MySQL."\n- Strong: "Built a Spring Boot + MySQL records app with role-based login, cutting a 3-step manual process to one search."\n\nIf you have no business metrics, use honest scale instead: rows handled, response time, screens removed, or a benchmark you measured yourself. Interviewers trust a measured number far more than a round one.',
  },
  {
    match: /\b(machine learning|ml|neural|model training|dataset|python|numpy|pandas|tensorflow|pytorch)\b/i,
    name: 'ml',
    reply:
      'A reliable ML workflow is boring on purpose:\n\n1. Write down the metric *before* training, so you cannot pick a flattering one later.\n2. Split into train / validation / test **once**, and touch the test set only at the very end.\n3. Establish a trivial baseline (mean predictor, logistic regression) — if your model cannot beat it, you have a bug, not a breakthrough.\n4. Log every run: data version, parameters, metric. Without that log, results are not reproducible.\n\nMost "the model is bad" cases are actually data leakage, label noise, or a missing baseline.',
  },
  {
    match: /\b(html|css|javascript|frontend|react|responsive|ui)\b/i,
    name: 'frontend',
    reply:
      'Good UI work follows a small number of repeatable decisions.\n\n- Build a **spacing scale** (4 / 8 / 12 / 16 / 24) and never invent a one-off margin.\n- Pick three text sizes and one font family; hierarchy comes from size and weight, not from more colours.\n- Every interactive element needs a visible focus ring, a hover state and a disabled state.\n- Animate only `transform` and `opacity`, and respect `prefers-reduced-motion`.\n\nThen check the keyboard path before the pretty path: tab through it, and make sure nothing traps focus.',
  },
];

const FALLBACK = {
  name: 'general',
  reply:
    'Here is how I would break this down.\n\n**The core idea**\n\nEvery problem like this has one decision that makes the rest easy. Find that decision first, and the design almost writes itself.\n\n**A concrete plan**\n\n- Write the requirement in one sentence, in plain words.\n- List the data you need, then the operations you perform on it.\n- Turn each operation into a small function with a clear name.\n- Only then pick the data structure that makes those operations cheap.\n\nAsk me to go deeper on any one of those three steps and I will expand it with a worked example.',
};

/** Pick the topic whose keywords appear in the text. */
function detectTopic(text) {
  return TOPICS.find((topic) => topic.match.test(text)) || FALLBACK;
}

/* ------------------------------------------------------------------ */
/* Context bridging — the visible mock of cross-AI continuity          */
/* ------------------------------------------------------------------ */

/**
 * Build the extra paragraph a provider "receives" when Ytalks hands it a
 * conversation that started with a different provider.
 *
 * In the real system the backend does exactly this: it reads messages from its
 * own database and writes them into the destination provider's request.
 */
function buildHandoffBridge(conversation, provider) {
  const handoff = [...conversation.messages].reverse().find((m) => m.type === 'handoff');
  if (!handoff || handoff.toProviderId !== provider.id) return '';

  const inherited = conversation.messages.filter(
    (m) =>
      m.createdAt < handoff.createdAt &&
      (m.type === 'user' || m.type === 'assistant')
  );

  if (inherited.length === 0) return '';

  const lastTopic = detectTopic(inherited[inherited.length - 1].content || '').name;
  const topics = [...new Set(inherited.map((m) => detectTopic(m.content).name))];
  const topicWord = topicNames[lastTopic] || 'that topic';
  const extra = topics.length > 1 ? ` (covering ${topics.length} related topics)` : '';

  return (
    `**Context transferred from ${providerName(conversation, handoff.fromProviderId)}.** ` +
    `Ytalks sent me ${inherited.length} earlier message${inherited.length === 1 ? '' : 's'}${extra} ` +
    `from its own database — the previous provider has no memory of this conversation and I cannot call it. ` +
    `I can see the thread was about ${topicWord}, so I will keep answering in that context unless you redirect me.`
  );
}

const topicNames = {
  concurrency: 'Java concurrency',
  collections: 'Java collections',
  database: 'database design',
  git: 'Git workflow',
  algorithms: 'graph algorithms',
  career: 'career and CV writing',
  ml: 'machine learning',
  frontend: 'frontend UI work',
  general: 'your original question',
};

function providerName(conversation, providerId) {
  // The view layer supplies the provider list; fall back to a readable id.
  const names = {
    openai: 'OpenAI',
    gemini: 'Google Gemini',
    claude: 'Anthropic Claude',
    deepseek: 'DeepSeek',
  };
  return names[providerId] || providerId;
}

/* ------------------------------------------------------------------ */
/* Failure simulation                                                  */
/* ------------------------------------------------------------------ */

const FAILURES = {
  rate_limit: () =>
    new MockProviderError(
      'rate_limit',
      'The provider is rate limiting this account right now.',
      'Too many requests in a short window. Wait a few seconds and retry.'
    ),
  timeout: () =>
    new MockProviderError(
      'timeout',
      'The provider did not respond in time (request timed out).',
      'Large prompts can exceed the provider timeout. Try a shorter message.'
    ),
  network: () =>
    new MockProviderError(
      'network',
      'Could not reach the provider.',
      'The host was unreachable. Check the network connection and retry.'
    ),
  invalid: () =>
    new MockProviderError(
      'invalid',
      'The provider returned a response in an unexpected format.',
      'The upstream API changed or returned malformed JSON. This is a backend integration issue.'
    ),
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Rough token estimate, used to show context usage in the UI. */
export function estimateTokens(text) {
  return Math.max(1, Math.round(String(text || '').length / 4));
}

/**
 * "Call" the provider.
 *
 * @param {object}   options
 * @param {object}   options.conversation  the conversation being continued
 * @param {object}   options.provider      the selected provider descriptor
 * @param {string}   options.model         the selected model id
 * @param {string}   options.userText      the message just sent
 * @param {object}   options.settings      prototype settings (latency, error mode)
 * @param {function} options.onDelta       called with the reply text so far
 * @param {AbortSignal} options.signal     lets the UI cancel a request
 * @returns {Promise<{text: string, model: string, latencyMs: number}>}
 */
export async function requestCompletion({
  conversation,
  provider,
  model,
  userText,
  settings,
  onDelta,
  signal,
}) {
  const started = performance.now();
  const errorMode = settings?.mockErrorMode || 'none';

  if (errorMode !== 'none') {
    await sleep(Math.min(500, settings.mockLatencyMs));
    const error = (FAILURES[errorMode] || FAILURES.network)();
    error.providerId = provider.id;
    throw error;
  }

  const topic = detectTopic(userText);
  const bridge = buildHandoffBridge(conversation, provider);
  const full = bridge ? `${bridge}\n\n${topic.reply}` : topic.reply;

  const wait = Math.max(120, (settings?.mockLatencyMs ?? 900) + Math.random() * 600);

  if (!settings?.streamTokens) {
    await sleep(wait, signal);
    if (signal?.aborted) throw new MockProviderError('network', 'Request cancelled.');
    onDelta?.(full);
    return { text: full, model, latencyMs: Math.round(performance.now() - started) };
  }

  // Stream in word groups so the UI can show a realistic typing effect.
  const words = full.split(/(\s+)/);
  const step = Math.max(24, Math.round(wait / Math.max(6, words.length / 2)));
  let emitted = '';

  for (let i = 0; i < words.length; i += 2) {
    if (signal?.aborted) throw new MockProviderError('network', 'Request cancelled.');
    emitted += words.slice(i, i + 2).join('');
    onDelta?.(emitted);
    await sleep(step, signal);
  }

  return { text: full, model, latencyMs: Math.round(performance.now() - started) };
}
