# aide

```
─────────────────────────────────────────────
 ⊹ ࣪ ˖ ( ◕ ‿ ◕ )つ  aide — your own AI
─────────────────────────────────────────────
```

**aide** is a self-hosted AI workspace you run on your own machine. it's a chat that talks to *any* model (claude, gpt, deepseek, gemini, a model running locally — your pick, switchable mid-conversation), remembers things across conversations, can do real work on your computer in agent mode, and writes you cited research reports. one login, your data in one folder, nothing phoning home.

it's one python process. no build step, no bundler, no `node_modules`, no account, no telemetry. clone it, run `python app.py`, open a browser. that's the whole thing.

> **heads up:** aide is the AI half of [**alles**](https://github.com/jxherc/alles) — a bigger self-hosted "everything app" (mail, docs, calendar, tasks, photos, the works). this repo is for people who *just* want the AI without the rest of the suite. if you want the full ecosystem, go grab alles.

---

## what you get

- **chat with any model.** one box, every provider — flip between claude, gpt, deepseek, gemini, groq, mistral, a local llama, ~15 others, even mid-conversation. ([how that works →](#how-the-model-switch-works))
- **agent mode** — not just talk: it reads/writes files, runs shell commands, searches + reads the web, uses git, hits MCP servers, and loops on a task on its own until it's done — with permission modes so it asks before touching anything you didn't ok.
- **deep research** — searches the web, *reads the actual pages* (not just snippets), and writes a cited markdown report. free with no key (duckduckgo + wikipedia); better with a free tavily/brave key.
- **long-term memory** — remembers facts and preferences across all your chats, using local vector search (`fastembed`, runs on your cpu — no embedding api, nothing leaves your machine).
- **model compare** — run one prompt against several models side by side and vote.
- **personas & projects** — saved system prompts / characters, and grouped chats with shared context.
- **artifacts** — ask for a webpage / chart / snippet and it renders live next to the chat, not as a wall of text.
- **voice** — talk to it and have it talk back (speech-to-text in, text-to-speech out; local or via a provider).
- **vision** — drop in an image and capable models can see it.
- **an AI image gallery**, incognito (unsaved) chats, slash commands (`/new`, `/clear`, …), `@`-mention a file into context, global search, scheduled messages (have aide message you later), a prompt cookbook, webhooks, api tokens, and an openai-compatible api so other tools can use aide as their "openai."

it installs like an app too (pwa with push notifications) — add it to your home screen/dock.

---

## how the model switch works

the question everyone asks. aide doesn't hardcode a provider. you register **endpoints** (settings → models); each is just a `base_url` + an `api_key`. when you send a message, aide looks at the url and routes to the right protocol — that logic is one function, `detect_provider()` in [`services/llm.py`](services/llm.py).

under the hood there are really only **three wire protocols**, and aide speaks all three:

| protocol | who speaks it | endpoint |
|---|---|---|
| **openai-compatible** | openai, deepseek, groq, openrouter, moonshot/kimi, xai/grok, gemini, mistral, perplexity, together, fireworks, cohere, vllm, lm studio, + anything that copies the format | `POST /v1/chat/completions` |
| **anthropic messages** | claude | `POST /v1/messages` |
| **ollama native** | local models via [ollama](https://ollama.com) | `POST /api/chat` — point at `http://localhost:11434`, fully offline, no keys |

every reply streams back through a parser that normalizes it to the same internal events (`delta` text, `thinking` reasoning tokens, `tool_call`, `done`+`usage`), so the rest of the app never cares who answered. plus: true token streaming, a "thought for N s" timer for reasoning models, per-provider translation of vision/tool-calls, a 20-second cooldown on an endpoint that errors twice, `NO_PROXY` respect so a local model never gets proxied, and auto-refreshing model lists. aide also **exposes** its own openai-compatible api (`GET /v1/models`, `POST /v1/chat/completions`).

---

## the agent

agent mode turns the chat into something that does the work — a multi-turn autonomous loop with a real toolset:

- **files & shell** — read / write / edit / patch files, list / glob / grep, run shell commands (optionally sandboxed in docker), run python
- **code** — symbol index, find-definition, run linters/diagnostics
- **git** — status / diff / branch / commit
- **web** — search + fetch-and-read pages
- **memory** — search and add long-term memories
- **integrations** — MCP servers, GitHub (when you connect a token), opencode delegation, skills
- **sub-agents** — spawn parallel helpers for independent subtasks
- **computer use** (opt-in, needs `pyautogui`) — screenshot / click / type / scroll

**safety:** permission modes — *full-auto*, *approve* (asks before each change, shows a diff), or *plan* (read-only; change-tools removed). every file edit is checkpointed so you can revert a whole run. and there's a **prompt-injection guard**: anything the agent reads from an untrusted source (web pages, files, repos, MCP results) is wrapped as *data, not instructions* and scanned for the classic attacks ("ignore previous instructions", "reveal your system prompt", exfil patterns) — so a booby-trapped page can't quietly hijack a run. a project-level `AGENTS.md` is auto-loaded as standing instructions.

---

## quick start

you need **python 3.11+**. then:

```bash
git clone https://github.com/jxherc/aide.git
cd aide
pip install -r requirements.txt
python app.py
```

open **http://localhost:8000** and you're in.

to actually chat, add a model under **settings → models** (one click for openai / anthropic / deepseek / groq / gemini / ollama and more), or drop a key like `DEEPSEEK_API_KEY` / `ANTHROPIC_API_KEY` into `.env` and aide auto-creates that endpoint on first boot. want it fully offline + free? install [ollama](https://ollama.com), pull a model, and add an endpoint at `http://localhost:11434` — no key, no internet.

---

## configuration

copy `.env.example` to `.env` — **everything is optional**, aide runs with an empty `.env`.

| var | default | what it does |
|---|---|---|
| `DEEPSEEK_API_KEY` | — | auto-creates a deepseek endpoint on first boot |
| `ANTHROPIC_API_KEY` | — | auto-creates an anthropic (claude) endpoint on first boot |
| `PORT` | `8000` | port to serve on |
| `SECRET_KEY` | `dev-secret` | signs your login cookie — **change this before exposing aide to a network** |
| `AUTH_ENABLED` | `false` | set `true` to require a password to log in |
| `AUTH_PASSWORD` | — | that password |
| `TAVILY_API_KEY` | — | better research search (falls back to duckduckgo + wikipedia, no key needed) |

everything else — model endpoints, the search provider + fallback chain, voice (stt/tts), the agent (permission mode, turns, docker sandbox, sub-agents, computer-use), the system prompt, memory, themes + accent color — is configured in the app under **settings**.

---

## how it's built

```
python 3.11 + fastapi + sqlite (via sqlalchemy)
vanilla js, es modules, one module per feature — no bundler, no build step
httpx for async, streaming model calls
fastembed (onnx) for local embeddings — no embedding api needed
```

tiny dependency list: `fastapi`, `uvicorn`, `httpx`, `sqlalchemy`, `pydantic`, `cryptography`, `bcrypt`, `fastembed`, `pillow`. optional extras: `pyautogui` (computer-use), `faster-whisper` (offline voice). the frontend is genuinely just files — `static/index.html` is the shell, `static/js/` is one es module per feature, `static/style.css` is the design tokens. view-source shows you the app.

all your data lives in **`data/`** — one sqlite file (`data/aide.db`) + uploads + the encryption key. back up that folder and you've backed up everything; stored credentials (model keys) are encrypted at rest with aes-256-gcm under `data/secret.key`.

```
aide/
├── app.py                 fastapi entry — routers, lifespan, background jobs
├── cli.py                 the aide cli (start/stop/restart/status/logs/update/open)
├── core/                  database models, settings, auth
├── services/
│   ├── llm.py             provider-agnostic streaming client (the model switch)
│   ├── agent_runtime.py   the autonomous agent loop
│   ├── agent_tools.py     every agent tool (+ the prompt-injection guard)
│   ├── research_engine.py search + read-the-page research loop
│   ├── memory_store.py    fastembed vector memory + keyword fallback
│   └── …                  jobs, crypto, webpush, stt, local models
├── routes/                one apirouter per feature, under /api (+ /v1 openai-compat)
└── static/                index.html, style.css, one js module per feature
```

---

## the cli

```
aide start | stop | restart | status | logs [N] | logs -f | update | open
```

- **windows (powershell):** `.\aide.cmd start`  ·  **cmd:** `aide.cmd start`  ·  **mac/linux:** `./aide start`  ·  **anywhere:** `python app.py`

add the folder to your `PATH` to type `aide` from any directory.

---

## security — read before exposing it

aide is built for one person on their own machine.

- **it ships open.** auth is off by default. before putting aide on a network, set `AUTH_ENABLED=true`, a strong `AUTH_PASSWORD`, and a real `SECRET_KEY`. without auth, anyone who reaches the port can run shell commands as you.
- **the agent has hands.** agent + shell tools run real commands on the machine aide is on. don't hand access to people or models you don't trust. the injection guard helps but it's a seatbelt, not a force field.
- **credentials are encrypted at rest** with the local key in `data/secret.key` — which protects the db file if it leaks on its own, not against someone holding the whole `data/` folder (the server has to decrypt unattended).
- **no warranty.** self-hosted hobby project, not an audited security product. run it at your own risk.

---

## what it's based on

aide is the AI core extracted from **[alles](https://github.com/jxherc/alles)**, a self-hosted everything-app. alles in turn was inspired by **[odysseus](https://github.com/pewdiepie-archdaemon/odysseus)** by pewdiepie-archdaemon — the concept of a self-hosted personal AI with memory, research, shell access, MCP, and a multi-provider backend comes from there. go star that repo.

stands on: [fastapi](https://fastapi.tiangolo.com) + [uvicorn](https://www.uvicorn.org), [sqlalchemy](https://www.sqlalchemy.org), [httpx](https://www.python-httpx.org), [fastembed](https://github.com/qdrant/fastembed), [pillow](https://python-pillow.org), [cryptography](https://cryptography.io). models from whichever provider you point it at; local ones via [ollama](https://ollama.com).

---

## license

mit. do whatever you want with it.
