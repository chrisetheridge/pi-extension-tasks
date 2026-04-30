---
name: task-management
description: Use when working with Pi's markdown-backed tasks extension, including syncing tasks, updating task state, using the task overlay, configuring task storage, or explaining how agents should keep task files current.
---

# Task Management

## What This Extension Does

Pi has a `tasks` extension that keeps project work items in markdown files and exposes them through:

- the `tasks` tool for agents
- the `/tasks` command for users
- the `Ctrl+Shift+T` task overlay shortcut
- a centered searchable overlay with task actions

Use this skill whenever you need to create, sync, update, inspect, explain, or debug tasks in this extension.

## Source of Truth

Markdown task files are canonical. Do not treat session entries, chat history, or an in-memory store as durable state.

Task directory config is read in this order:

1. Project config: `.pi/extensions/tasks/config.json`
2. User config: `~/.pi/agent/extensions/tasks/config.json`
3. Default path: `.pi/tasks`

Config shape:

```json
{
  "path": ".pi/tasks"
}
```

Relative paths resolve against the current project directory. Do not use `PI_TODO_PATH` or other environment variables for task storage.

## Task File Format

Each task is one `.md` file. The file name should normally match the task id, for example `task-write-tests.md`.

```markdown
---
id: "task-write-tests"
title: "Write tests"
status: progress
owner: agent
created_at: "2026-04-30T10:00:00.000Z"
updated_at: "2026-04-30T10:15:00.000Z"
---

Add coverage for markdown task parsing and overlay actions.
```

Allowed statuses:

- `pending`
- `progress`
- `blocked`
- `complete`
- `cancelled`

Allowed owners:

- `agent`
- `user`
- omitted when nobody owns it, or when the task is `complete`/`cancelled`

The markdown body is the task text/details. Keep it useful but concise.

## Agent Tool Usage

Use the `tasks` tool, not shell edits, when the extension is available. Tool operations are:

- `sync`: replace the canonical task set by default; use `replace: false` to merge
- `upsert`: create or update task files without deleting unrelated tasks
- `update`: change title/body/status/owner metadata
- `activate`: mark a task as `progress` and `owner: agent`
- `complete`: mark a task as `complete` and clear owner
- `block`: mark a task as `blocked`
- `remove`: delete a task file
- `snapshot`: inspect current task state
- `show`: open the overlay
- `hide`: hide the overlay

Typical calls:

```json
{ "operation": "sync", "input": "- [ ] Draft plan\n- [ ] Implement\n- [ ] Verify" }
```

```json
{ "operation": "activate", "taskId": "task-implement" }
```

```json
{ "operation": "complete", "taskId": "task-implement" }
```

```json
{ "operation": "upsert", "task": { "title": "Add regression test", "body": "Cover the markdown file path resolver." } }
```

## User Overlay Behavior

The `/tasks` command opens the centered task overlay. Typing text after `/tasks` syncs that text as tasks.

Overlay behavior:

- Type to fuzzy-search by id, title, status, owner, and body text.
- Use arrow keys to navigate.
- Press Enter on a task to open actions.
- Press Esc to go back or close.

Action menu:

- `view`: show task text in the centered overlay
- `claim`: set `status: progress`, `owner: user`
- `refine`: prefill the chat editor with a refinement prompt; do not edit the file yet
- `complete`: set `status: complete` and clear owner
- `delete`: confirm, then delete the markdown file

## Agent Behavior Rules

- Keep tasks aligned with actual work, not aspirational plans.
- Call `activate` when starting a task as the agent.
- Call `complete` as soon as a task is finished.
- Use `block` when progress is waiting on a real dependency.
- Use `upsert` when discovering a new task during work.
- Use `snapshot` before making uncertain updates.
- Prefer concise titles and stable ids.
- Preserve useful user-supplied task body text.
- Do not create `/todos`, `todos`, `clear-tasks`, GC, lock files, session persistence, or environment-variable storage behavior.
- Do not manually edit task files unless the `tasks` tool is unavailable or the user explicitly asks for direct file edits.

## Empty and Error States

If no task files exist, the overlay should show an empty state. If config or task files are unreadable, surface that as an error state instead of silently ignoring it. Missing config is not an error; it means use `.pi/tasks`.
