/**
 * mock-data.js — sample data for the Milestone 1 prototype.
 *
 * IMPORTANT: everything in this file is fabricated sample data. No real AI
 * provider is contacted and no real user exists. The provider ids match the
 * ones the backend will use in Milestone 6 so the swap is seamless.
 *
 * NOTE: `models` entries are UI placeholders. The real model ids are verified
 * against each vendor's live documentation during Milestone 6.
 */

export const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OAI',
    accent: '#10a37f',
    description: 'Reliable all-rounder with strong reasoning and code output.',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
    defaultModel: 'gpt-4.1-mini',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'GEM',
    accent: '#4285f4',
    description: 'Very large context window and fast responses.',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    defaultModel: 'gemini-2.5-flash',
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    shortName: 'CLD',
    accent: '#d97757',
    description: 'Long, careful answers; good at nuanced writing.',
    models: ['claude-sonnet-4-5', 'claude-haiku-4-5'],
    defaultModel: 'claude-sonnet-4-5',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DSK',
    accent: '#4d6bfe',
    description: 'Cost-efficient, strong on maths and code reasoning.',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
  },
];

export const DEMO_USER = {
  id: 'usr_demo_001',
  name: 'Aarav Sharma',
  email: 'aarav.sharma@example.com',
  phone: '+91 98765 43210',
  plan: 'Free demo',
};

export const DEMO_CREDENTIALS = {
  email: 'aarav.sharma@example.com',
  password: 'Demo@12345',
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let seq = 0;
const mid = () => `msg_seed_${++seq}`;

/** Build a seed conversation in one line-per-message block. */
function conversation({ id, title, providerId, model, ago, messages, handoff = null }) {
  const createdAt = Date.now() - ago - 20 * MIN;
  const list = messages.map(([role, content, offset]) => ({
    id: mid(),
    type: role,
    content,
    createdAt: createdAt + offset,
    providerId: role === 'user' ? null : providerId,
    model: role === 'user' ? null : model,
  }));

  if (handoff) {
    list.push({
      id: mid(),
      type: 'handoff',
      createdAt: createdAt + handoff.atOffset,
      fromProviderId: handoff.fromProviderId,
      fromModel: handoff.fromModel,
      toProviderId: providerId,
      toModel: model,
      messageCount: handoff.messageCount,
    });
  }

  const last = list[list.length - 1];
  return {
    id,
    title,
    createdAt,
    updatedAt: last.createdAt,
    providerId,
    model,
    messages: list,
  };
}

export function buildSeedConversations(now = Date.now()) {
  const A = 'openai';
  const G = 'gemini';
  const C = 'claude';

  return [
    conversation({
      id: 'conv_java_threads',
      title: 'Java concurrency questions',
      providerId: A,
      model: 'gpt-4.1-mini',
      ago: 25 * MIN,
      messages: [
        [
          'user',
          'I am a 2nd year B.Tech student learning Java. Explain the difference between a thread and a process, and when I would actually need threads.',
          0,
        ],
        [
          'assistant',
          'A **process** is its own program in memory with its own address space. A **thread** is a lightweight path of execution that shares that memory with other threads of the same process.\n\n- Threads are cheap to create, so you can have thousands.\n- Processes are isolated, so a crash in one does not kill the others.\n- Anything inside the same process can corrupt the same memory.',
          1 * MIN,
        ],
        [
          'user',
          'Okay, so when would a beginner actually use threads instead of just writing normal code?',
          4 * MIN,
        ],
        [
          'assistant',
          'Good question — most of the time you would not. Threads become useful when one job is *slow* and you do not want the UI to freeze.\n\nPractical examples:\n\n- Reading a file while the user keeps typing.\n- Calling a slow web API and showing a spinner meanwhile.\n- Processing 500 rows one at a time.\n\nUntil then, keep your code single-threaded and easy to read. Reach for concurrency when you can point at a specific moment where waiting is visible to the user.',
          6 * MIN,
        ],
        [
          'user',
          'That makes sense. Can you show me how ExecutorService is used with a Callable?',
          9 * MIN,
        ],
        [
          'assistant',
          '`ExecutorService` is the modern replacement for manually creating `Thread` objects.\n\n```java\nExecutorService pool = Executors.newFixedThreadPool(4);\nFuture<Integer> answer = pool.submit(() -> 6 * 7);\nSystem.out.println(answer.get());\npool.shutdown();\n```\n\n- `submit` takes a `Callable`, which may return a value and may throw a checked exception.\n- `Future.get()` blocks until the task finishes, and wraps failures in `ExecutionException`.\n- Always call `shutdown()` when you are done, otherwise the JVM will not exit.',
          11 * MIN,
        ],
        [
          'user',
          'What is the difference between a Runnable and a Callable then?',
          18 * MIN,
        ],
        [
          'assistant',
          'Both are functional interfaces you can hand to an executor, but they differ in two ways.\n\n- `Runnable.run()` returns `void` and cannot throw checked exceptions.\n- `Callable.call()` returns a value and *can* throw a checked exception.\n\nIf you need an answer back, use `Callable`. If you only need the work done, use `Runnable`.',
          20 * MIN,
        ],
      ],
    }),

    conversation({
      id: 'conv_db_design',
      title: 'Normalising a marks database',
      providerId: G,
      model: 'gemini-2.5-flash',
      ago: 3 * HOUR,
      messages: [
        [
          'user',
          'I need to store student marks for a college project. Should I make one table with everything?',
          0,
        ],
        [
          'assistant',
          'You *can*, but it will hurt quickly. The usual problem is repeating the same student and subject details on every row.\n\nA cleaner shape:\n\n- `students` — one row per student\n- `subjects` — one row per subject\n- `enrollments` — who is taking what\n- `marks` — one row per student, per subject\n\nEach table then has a single clear responsibility, and updating a student name touches exactly one row.',
          2 * MIN,
        ],
        [
          'user',
          'How do I make sure the same subject is not inserted twice?',
          6 * MIN,
        ],
        [
          'assistant',
          'Use a **unique constraint** rather than checking in code, because the database is the only place that can guarantee it under concurrency.\n\n- Primary key on `id` for identity.\n- A unique key on `(code)` in `subjects` so `CS101` can exist only once.\n\nIn JPA you can express it with `@Table(uniqueConstraints = ...)`, and Hibernate will turn it into a real `UNIQUE` index in MySQL.',
          9 * MIN,
        ],
        [
          'user',
          'That is exactly what I needed. One more thing — should I store the grade as a letter or as a number?',
          14 * MIN,
        ],
        [
          'assistant',
          'Store the number. Letters are a *presentation* decision that changes between semesters, universities and even subjects.\n\nKeep `marks_obtained` and `marks_max` as decimals, compute the percentage or grade in a service, and let the front end decide how to display it. If you must cache the letter too, make it a derived column you can safely recompute.',
          17 * MIN,
        ],
      ],
    }),

    conversation({
      id: 'conv_resume',
      title: 'CV bullet points for AI internship',
      providerId: C,
      model: 'claude-sonnet-4-5',
      ago: 1 * DAY,
      messages: [
        [
          'user',
          'Rewrite these CV bullets so they sound less generic: "Made a website using Java and MySQL".',
          0,
        ],
        [
          'assistant',
          'The problem is not the technology, it is that there is no *outcome*. Compare:\n\n- Before: "Made a website using Java and MySQL."\n- After: "Built a Spring Boot + MySQL student records app with role-based login, reducing manual register entry to a single search."\n\nThree things every strong bullet contains:\n\n- What you built\n- The scale or constraint you handled\n- The measurable result',
          3 * MIN,
        ],
        [
          'user',
          'I do not have real numbers yet because it is a college project. Is that a problem?',
          8 * MIN,
        ],
        [
          'assistant',
          'Not really, but you can substitute honest scale for business metrics.\n\n- "Handles 5,000+ rows" instead of "scales to millions".\n- "Reduces a 3-step manual process to 1 search."\n- "Cuts report preparation from 40 minutes to under 2."\n\nEven better, run a quick benchmark on your own dataset and quote the real number. Interviewers trust measured figures far more than round ones.',
          11 * MIN,
        ],
      ],
    }),

    conversation({
      id: 'conv_handoff_demo',
      title: 'Explaining Dijkstra (cross-AI demo)',
      providerId: G,
      model: 'gemini-2.5-flash',
      ago: 2 * DAY,
      messages: [
        [
          'user',
          'Explain Dijkstra shortest path to me as if I have never heard of graphs.',
          0,
        ],
        [
          'assistant',
          'Imagine a city map where every road has a travel time. Dijkstra finds the fastest route from A to B.\n\nThe one idea that makes it click: at every step, commit to the closest unvisited node. You never have to come back to it, because any later path would be longer.\n\n- Put the start node in a priority queue with distance 0.\n- Repeatedly pop the smallest distance, relax its neighbours.\n- Mark it visited and move on.',
          4 * MIN,
        ],
        [
          'user',
          'What if the roads have different weights in each direction?',
          9 * MIN,
        ],
        [
          'assistant',
          'Then it is a directed weighted graph, and Dijkstra still works as long as every weight is non-negative.\n\nIf any road can be *negative* — think of a rebate or a discount edge — Dijkstra is no longer correct, because it commits too early. In that case you want Bellman-Ford, or A* with an admissible heuristic.',
          12 * MIN,
        ],
      ],
      handoff: {
        fromProviderId: A,
        fromModel: 'gpt-4.1-mini',
        atOffset: 14 * MIN,
        messageCount: 4,
      },
    }),

    conversation({
      id: 'conv_git_help',
      title: 'Fixing a bad git rebase',
      providerId: A,
      model: 'gpt-4.1-mini',
      ago: 5 * DAY,
      messages: [
        [
          'user',
          'I ran git rebase and now my branch has 40 commits and I cannot find my code. How do I undo?',
          0,
        ],
        [
          'assistant',
          'Nothing is lost — rebase keeps the old commits in the reflog for about 90 days.\n\n- `git reflog` shows every position your HEAD has held.\n- Find the entry just before the rebase started.\n- `git reset --hard <that-sha>` puts the branch back.\n\nThen fix the cause before retrying: commit more often, and run `git pull --rebase` regularly so you never fall thousands of commits behind.',
          5 * MIN,
        ],
        [
          'user',
          'Found it, thank you. Is there a way to stop this happening again?',
          12 * MIN,
        ],
        [
          'assistant',
          'Yes — three habits cover almost every case.\n\n- Rebase your own unpushed work freely; never rebase a shared branch.\n- `git config --global pull.rebase true` so pulls stay linear.\n- Run `git status` before any history-changing command and read what it says.',
          15 * MIN,
        ],
      ],
    }),
  ];
}

/** Starter suggestion chips for an empty chat. */
export const STARTER_PROMPTS = [
  'Explain Java streams like I have never used them',
  'Compare HashMap and TreeMap with examples',
  'How do I design a REST API for a college project?',
  'What is context switching in the OS?',
];
