# Getting Started (the simple version)

[日本語版はこちら](./GETTING_STARTED.ja.md)

This guide explains AI App Factory in plain language and walks you through running it on your
own computer. No programming experience is required — but you do need to be comfortable copying
and pasting commands into a "Terminal" app. If a step doesn't work, that's normal; the
[Troubleshooting](#troubleshooting) section at the bottom is there for exactly that.

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

Install these three things. Each one is free.

| Tool | What it's for | Get it here |
|---|---|---|
| **Git** | Downloads this project's code onto your computer | [git-scm.com/downloads](https://git-scm.com/downloads) |
| **Node.js** (version 20 or newer) | Runs the JavaScript code this project is written in | [nodejs.org](https://nodejs.org/) (pick the "LTS" version) |
| **Docker Desktop** | Runs a database and a login system in safe, disposable "boxes" (containers), so you don't have to install them directly on your computer | [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) |

After installing Docker Desktop, **open it and leave it running** in the background — the next
step needs it awake, not just installed.

## 3. Download, install, and run — three commands

Open a Terminal (on macOS: search for "Terminal"; on Windows: search for "PowerShell"; on Linux:
you know where it is) and run these, one at a time:

```bash
git clone https://github.com/katayama502/ai-app-factory.git
cd ai-app-factory
corepack enable && pnpm install
```

```bash
pnpm start
```

That's it — no files to edit, no passwords to invent. `pnpm start` does everything the earlier,
more manual version of this guide used to ask you to do by hand: it checks Docker is running,
generates a `.env` file with random passwords the first time (so you never have to make one up
yourself), starts the database and login system in the background, waits for them to be ready, and
then boots the demo app — all from that one command. It's safe to run again later, too: it reuses
whatever it already set up instead of starting over.

Leave this command running in its terminal window — it's a live program, not a one-off task. After
it finishes starting (the first run takes a bit longer, since Docker has to download things), you
should see something like:

```
runtime     : http://sales-daily-report.apps.localhost:4200/pages/0
runtime     : http://expense-request.apps.localhost:4200/pages/0
dev users   : alice/alice-dev, bob/bob-dev, carol/carol-dev
```

## 4. Open it in your browser

Copy one of the `runtime` URLs above (for example
`http://sales-daily-report.apps.localhost:4200/pages/0`) into your web browser.

You'll be redirected to a real login page. Sign in with one of the demo accounts printed above —
for example, username `alice`, password `alice-dev`.

You're now looking at a real, working app: a form for logging daily sales reports. Fill it in and
submit it, then look at the list page — your entry is there. If you log out and log back in as
`bob` instead, you will **not** see alice's entries — each person only sees their own, exactly
like a real company tool should behave.

## 5. What are you actually looking at?

Open the file [`templates/sales-daily-report/app.yaml`](./templates/sales-daily-report/app.yaml)
in a text editor. That file — not any hand-written screen code — is the entire description of the
app you just used: what fields the form has, what the list page shows, and who's allowed to see
what. The Runtime you started in step 3 read that file and built the working app from it. This is
the "safe form instead of code" idea from step 1, made concrete.

## 6. When you're done

Press Ctrl+C in the terminal running `pnpm start`. The database and login system keep running
quietly in the background (so your data is still there next time you run `pnpm start`) — if you'd
rather stop those too:

```bash
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml down
```

## Troubleshooting

- **Something failed and you're not sure why** — run `pnpm doctor`; it checks Node/Docker/memory/
  disk/ports and names the exact problem, with what to do about it.
- **"Docker doesn't seem to be running"** — open the Docker Desktop app and wait for it to fully
  start, then run `pnpm start` again.
- **A port is already in use** — something else on your computer is already using it (often a
  previous run you forgot to stop). `pnpm doctor` will tell you which port; you can usually ignore
  this if you know what's using it, or restart your computer if you don't.
- **Still stuck** — please open a [GitHub Issue](https://github.com/katayama502/ai-app-factory/issues)
  describing what you ran and what happened. Include the output of `pnpm doctor`.

## Want more control?

`pnpm start` is the fast path. If you'd rather see (or customize) every step it automates —
setting your own passwords, pointing it at Postgres/Keycloak you're already running, etc. — see
the "Run via Docker Compose" section partway down [README.md](./README.md).

## What's next

- [README.md](./README.md) — the technical README, for developers
- [ROADMAP.md](./ROADMAP.md) — an honest, detailed account of what's built and what isn't yet
- [`templates/`](./templates/) — more example apps to try (edit the `hostname`/`templateDir` list
  in [`scripts/dev-server.ts`](./scripts/dev-server.ts) to add one to the demo)
