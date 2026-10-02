# OfflineQBank · Offline Question Bank Framework

[简体中文](README.md) | [English](README.en.md)

A clone-and-customize, local-first question bank framework. Bring your own questions and optional API providers. **No questions are included.**

[![Tests](https://github.com/zhijun-yin/offline-qbank/actions/workflows/test.yml/badge.svg)](https://github.com/zhijun-yin/offline-qbank/actions/workflows/test.yml)

Clone the repository, add your own questions, customize the interface, and connect your services. Both `categories` and `questions` in `content/bank.json` are empty arrays. There are no built-in, sample, or preloaded questions. **The application UI is currently in Chinese; this document is its English guide.**

![Empty question bank dashboard](docs/overview.png)

## Run locally

Requires Node.js 22 or newer:

```sh
git clone https://github.com/zhijun-yin/offline-qbank.git
cd offline-qbank
npm ci
npm start
```

Open **http://127.0.0.1:4174**. No API, account, or database service is needed to start. Questions and practice records are stored in the current browser's IndexedDB. The application has no third-party frontend dependencies at runtime.

To build a standalone file that you can open by double-clicking:

```sh
npm run build
```

The output, `dist/offline-qbank.html`, contains the interface, application code, and repository question bank. Managing questions, answering them, and grading work offline. **External API features require a network connection or an API service running locally.** When opening the HTML directly, browser API requests also require the API service to allow that origin through CORS.

## Customize after cloning

| File | Purpose |
| --- | --- |
| `content/bank.json` | Add your own categories and questions |
| `content/bank.schema.json` | Field suggestions for JSON editors; runtime validation is still enforced by code |
| `config.js` | Page branding and default API connection mode |
| `adapters/api.js` | Adapters for LLM and question bank API protocols |
| `.env.local` | Private endpoints, model name, and keys for the local proxy |
| `app.js` / `styles.css` | Interface behavior and styling |

After editing the repository bank, refresh the page. If local data already exists, go to **API 与数据 → 同步仓库题库** (API & Data → Sync repository bank) and confirm the merge. Repository content and local progress are stored separately; refreshing does not silently overwrite local content. Rebuild the standalone HTML to include updated repository questions.

## Question bank format

The root object contains `version: 1`, `categories`, and `questions`. The shipped file is a valid empty template; no sample questions need to be removed.

Categories have `id` and `name` fields. Question fields are:

| Field | Meaning and default |
| --- | --- |
| `id` | Required; a stable, unique identifier using letters, digits, underscores, or hyphens, up to 80 characters |
| `type` | Required; `single` / `multiple` / `boolean` / `fill` / `text` |
| `stem` | Required; the question text supplied by the bank author |
| `categoryId` | Optional category ID; defaults to `null` |
| `status` | Defaults to `ready`; explicitly use `draft` for incomplete questions |
| `difficulty` | `easy` / `medium` / `hard`; defaults to `easy` |
| `options` | Choice options: an array of strings, or objects with `id` and `text` |
| `answer` | Depends on the question type; see below |
| `explanation` | Optional explanation; defaults to an empty string |
| `tags` | Optional array of strings; defaults to an empty array |
| `score` | Greater than 0 and no more than 100; defaults to 1 |

| Type | Answer format and grading |
| --- | --- |
| `single` | An option ID or a 1-based option index; exact match |
| `multiple` | An array of option IDs or indices; order does not matter, all choices must match, no partial credit |
| `boolean` | Boolean `true` or `false` |
| `fill` | An outer array with one entry per blank; each entry is a string or an array of accepted strings. Leading/trailing whitespace, case, and full-width differences are normalized |
| `text` | A reference-answer string; learners grade themselves, with optional AI feedback |

Questions available for practice need nonempty question text and a complete answer. Choice questions need at least two nonempty options. The editor can save blank drafts, but drafts are excluded from practice. Do not reuse an existing question ID for a different question, as progress and incorrect-answer tracking use those IDs.

## APIs: two features, two connection modes

**Question bank API:** returns the same structure as `content/bank.json`. The default adapter makes one GET request, validates the response, and displays counts before asking the user to confirm a merge. Matching IDs update existing records; historical practice snapshots remain intact. For pagination, other authentication methods, or different response formats, customize `fetchBank()` to return the standard bank object.

**LLM API:** provides hints, explanations, and reference feedback for short-answer questions. Question generation is not included. The default adapter uses the Chat Completions `model` and `messages` request structure and reads `choices[0].message.content`, following the [OpenAI API reference](https://developers.openai.com/api/reference/resources/chat). Users configure the full endpoint URL and model name; neither a provider nor a model is hardcoded. Replace `callLLM()` to support another protocol.

Model calls are triggered by the learner and send the current question; review requests also send the learner's answer. Hint requests exclude the reference answer and explanation. AI feedback is displayed as plain text and does not automatically change practice scores.

### Local proxy

Copy `.env.example` to `.env.local`, fill in the fields you need, and restart `npm start`:

| Environment variable | Purpose |
| --- | --- |
| `QBANK_LLM_URL` | Full chat-completions endpoint URL, including the required path |
| `QBANK_LLM_MODEL` | Model ID supported by the service |
| `QBANK_LLM_KEY` | Optional Bearer key, read by the local server |
| `QBANK_BANK_URL` | Full GET URL for the question bank API |
| `QBANK_BANK_KEY` | Optional Bearer key for the question bank API |

The browser calls `/api/llm` or `/api/bank`. The server forwards requests only to endpoints configured in the environment variables. Keys are not included in the build output, and `.env.local` is ignored by Git. The proxy listens locally and rejects requests from foreign origins.

### Direct browser connection

Enter the endpoint and model name on the **API 与数据** (API & Data) page. The API must allow CORS. Keys stay in the current page's memory and must be reentered after a refresh; exported backups and saved connection preferences exclude keys. Do not put real keys in `config.js` or question bank files, as those files are bundled into the distributable HTML.

## Included features

- Manage categories, tags, question types, difficulty, drafts, and ready questions.
- Create practice sessions by category, type, difficulty, or incorrect answers, with random or sequential order.
- Automatic grading, short-answer self-assessment, resumable sessions, practice history, and incorrect-answer tracking based on the latest evaluated response.
- Merge question bank JSON, restore full backups, keep a recovery copy before replacement, and undo the latest modification.
- Optional APIs through the local proxy or direct browser requests.

Local storage is tied to the browser origin. Switching browsers, ports, or standalone-file locations may expose a different storage space; export JSON for long-term backups. Importing a full backup replaces current data, while importing question bank JSON merges it. Both operations require confirmation.

Limits: 5,000 questions, 500 categories, 1,000 practice sessions, and 200 questions per session. Full backups are limited to 32 MB. Accounts, multi-device synchronization, exam anti-cheating, and a trusted grading service are not included. The UI is currently in Chinese, and no question content is bundled.

## Validation

```sh
npm test
npm run build
npm run test:e2e
```

Browser tests use a local Chrome / Edge installation or Playwright Chromium. If no test browser is available, run `npx playwright install chromium`. Set `QBANK_BROWSER` to specify a browser executable.

Tests use blank structural records and grading markers, with no actual questions included. API tests use local mock services or mock fetch and do not call paid services. Verify a real connection separately after configuring your own provider.

## License

[MIT](LICENSE)
