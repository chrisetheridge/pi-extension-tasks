# pi-extension-tasks

Standalone Pi package for the markdown-backed task overlay extension and task tool.

## Layout

- `src/` - runtime extension source consumed by Pi
- `skills/` - agent guidance for using the task overlay feature
- `tests/` - package tests

## Install

From this local checkout:

```bash
pi install ../pi-extension-tasks -l
```

## Configuration

Tasks are stored as one markdown file per task. Configure the task directory with:

- Project: `.pi/extensions/tasks/config.json`
- User: `~/.pi/agent/extensions/tasks/config.json`

```json
{
	"path": ".pi/tasks"
}
```

Relative paths resolve against the current project directory. If no config exists, tasks are stored in `.pi/tasks`. Project config overrides user config.

## Usage

- `/tasks` opens the centered searchable task overlay.
- Typing text after `/tasks` syncs that text into markdown tasks.
- `Ctrl+Shift+T` toggles the overlay.
- The overlay supports list, actions, and detail views.
- Search matches task id, title, status, owner, body, and notes.
- Overlay actions are `view`, `claim`, `refine`, `complete`, and `delete`.
- `claim` marks the task as `progress` and assigns it to the user.
- `refine` opens a refinement prompt in the editor without changing the task file.
- The `tasks` tool can sync, upsert, update, activate, block, complete, remove, snapshot, show, and hide tasks.

Task files use YAML frontmatter for `id`, `title`, `status`, `owner`, `created_at`, and `updated_at`; the markdown body stores the task text and notes. Supported statuses are `pending`, `progress`, `blocked`, `complete`, and `cancelled`. Supported owners are `user` and `agent`.

Task file names normally match the task id, for example `task-write-tests.md`.

## Package

The package exposes its runtime modules through:

```json
{
	"pi": {
		"extensions": ["./src"],
		"skills": ["./skills"]
	}
}
```

Run checks with:

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run check
npm run pack:dry-run
```
