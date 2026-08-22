# Getting Started (the simple version)

[日本語版はこちら](./GETTING_STARTED.ja.md)

This guide explains AI App Factory in plain language and walks you through running it on your
own computer, one step at a time. No programming experience is required — but you do need to be
comfortable copying and pasting commands into a "Terminal" app. If a step doesn't work, that's
normal; the [Troubleshooting](#troubleshooting) section at the bottom is there for exactly that.

**Before you start, one honest note**: this project is still early-stage (see
[ROADMAP.md](./ROADMAP.md) for the full picture). There's no polished "click a button" installer
yet — what you'll see today is a working demo you run from a terminal, not a finished product. If
you're not comfortable with a terminal at all, this guide will still explain everything, but it
will take patience.

## 1. What is this thing, actually?

Imagine your company needs a simple internal tool — say, a form where employees log their daily
sales reports, or request vacation days. Normally, building even a small tool like that needs a
programmer.

AI App Factory lets an AI build tools like that from a plain description — **but the AI never
writes real, run-anything code.** Instead, the AI fills out a strict, safe "form" (we call it a
Spec) that describes the app: what data it stores, what the screens look like, and who's allowed
to see what. A separate, fixed program (the "Runtime") reads that form and turns it into a real,
working app.

Why does that matter? Because the AI literally *cannot* write something dangerous — not because
someone is checking its work after the fact, but because the form it fills out has no blank where
dangerous code could go. That's the whole safety idea behind this project.

Right now, the "AI fills out the form" part works, but only against a test AI, not a real one (see
[ROADMAP.md](./ROADMAP.md)). What you'll run today is a **hand-written example app** — proof that
the "form → real working app" half of the idea works end to end.

## 2. What you need before you start

Install these four things. Each one is free, and each link below explains what it's for in one
sentence.

| Tool | What it's for | Get it here |
|---|---|---|
| **Git** | Downloads this project's code onto your computer | [git-scm.com/downloads](https://git-scm.com/downloads) |
| **Node.js** (version 20 or newer) | Runs the JavaScript code this project is written in | [nodejs.org](https://nodejs.org/) (pick the "LTS" version) |
| **Docker Desktop** | Runs a database and a login system in safe, disposable "boxes" (containers), so you don't have to install them directly on your computer | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) |
| **pnpm** | Downloads and organizes this project's other dependencies | see step 3 below — you don't need to install this separately |

After installing Docker Desktop, **open it and leave it running** in the background — the steps
below need it awake, not just installed.

## 3. Download and set up the project

Open a Terminal (on macOS: search for "Terminal"; on Windows: search for "PowerShell"; on Linux:
you know where it is) and run these commands one at a time — press Enter after each one, wait for
it to finish, then run the next.

```bash
git clone https://github.com/katayama502/ai-app-factory.git
cd ai-app-factory
corepack enable
pnpm install
```

- Line 1 downloads the project into a new folder called `ai-app-factory`.
- Line 2 moves your terminal *into* that folder — every command after this assumes you're there.
- Line 3 turns on `pnpm` (it comes bundled with Node.js, it just needs switching on once).
- Line 4 downloads everything the project depends on. This can take a few minutes the first time.

## 4. Run the checkup tool

```bash
pnpm doctor
```

This checks whether your computer has everything it needs — Node.js, Docker, enough memory, free
disk space — and prints a simple report. A ✓ means that item is fine. A △ is a warning (usually
not a problem — for example, it's normal to see "port 5432 is in use" if you already have a
database running). A ✗ means something needs fixing before you continue, and it will tell you
what to do next.

## 5. Start the "engine room" (database + login system)

The app needs a database (to store data) and a login system (Keycloak, so people can sign in
safely). Docker starts both for you, in disposable containers that don't touch anything else on
your computer.

```bash
cp deploy/compose/.env.example deploy/compose/.env
```

Now open the new file `deploy/compose/.env` in any text editor, and fill in three passwords —
just type any random text after each `=` sign, for example:

```
POSTGRES_PASSWORD=my-first-test-password-1
VALKEY_PASSWORD=my-first-test-password-2
KEYCLOAK_ADMIN_PASSWORD=my-first-test-password-3
```

(These are only used on your own computer, for this local test — they don't need to be memorable
or secure.) Save the file, then run:

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up -d
```

This starts three containers in the background. Give it about 20–30 seconds to finish starting up.

## 6. Start the demo app

This command needs to know the three passwords you just set in `deploy/compose/.env` — copy them
in exactly as you typed them (username `factory` is the default, from step 5's `.env.example`):

```bash
AIAF_PG_USER=factory \
AIAF_PG_PASSWORD=my-first-test-password-1 \
AIAF_KEYCLOAK_URL=http://127.0.0.1:8180 \
AIAF_KEYCLOAK_ADMIN_PASSWORD=my-first-test-password-3 \
pnpm dev:sample
```

Leave this command running — it's a live program, not a one-off task. After a few seconds, you
should see something like:

```
runtime     : http://sales-daily-report.apps.localhost:4200/pages/0
runtime     : http://expense-request.apps.localhost:4200/pages/0
dev users   : alice/alice-dev, bob/bob-dev, carol/carol-dev
```

## 7. Open it in your browser

Copy one of the `runtime` URLs above (for example
`http://sales-daily-report.apps.localhost:4200/pages/0`) into your web browser.

You'll be redirected to a real login page. Sign in with one of the demo accounts printed above —
for example, username `alice`, password `alice-dev`.

You're now looking at a real, working app: a form for logging daily sales reports. Fill it in and
submit it, then look at the list page — your entry is there. If you log out and log back in as
`bob` instead, you will **not** see alice's entries — each person only sees their own, exactly
like a real company tool should behave.

## 8. What are you actually looking at?

Open the file [`templates/sales-daily-report/app.yaml`](./templates/sales-daily-report/app.yaml)
in a text editor. That file — not any hand-written screen code — is the entire description of the
app you just used: what fields the form has, what the list page shows, and who's allowed to see
what. The Runtime you started in step 6 read that file and built the working app from it. This is
the "safe form instead of code" idea from step 1, made concrete.

## 9. When you're done

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml down
```

This stops the containers you started in step 5. Press Ctrl+C in the terminal running
`pnpm dev:sample` to stop that too.

## Troubleshooting

- **Something failed and you're not sure why** — run `pnpm doctor` again; it usually names the
  exact problem and what to do about it.
- **"Docker daemon is not running"** — open the Docker Desktop app and wait for it to fully start,
  then try again.
- **A port is already in use** — something else on your computer is already using that port
  (often a previous run you forgot to stop). `pnpm doctor` will tell you which port; you can
  usually ignore this if you know what's using it, or restart your computer if you don't.
- **Still stuck** — please open a [GitHub Issue](https://github.com/katayama502/ai-app-factory/issues)
  describing what you ran and what happened. Include the output of `pnpm doctor`.

## What's next

- [README.md](./README.md) — the technical README, for developers
- [ROADMAP.md](./ROADMAP.md) — an honest, detailed account of what's built and what isn't yet
- [`templates/`](./templates/) — more example apps to try (edit the `hostname`/`templateDir` list
  in [`scripts/dev-server.ts`](./scripts/dev-server.ts) to add one to step 6's demo)
