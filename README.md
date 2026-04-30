# pi-extension-tasks

Standalone Pi package for the markdown-backed task overlay extension and generic task tool.

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

Relative paths resolve against the current project directory. If no config exists, tasks are stored in `.pi/tasks`.

## Usage

- `/tasks` opens the centered searchable task overlay.
- `Ctrl+Shift+T` toggles the overlay.
- The `tasks` tool can sync, upsert, update, activate, complete, remove, snapshot, show, and hide tasks.
- Overlay actions are `view`, `claim`, `refine`, `complete`, and `delete`.

Task files use YAML frontmatter for `id`, `title`, `status`, `owner`, `created_at`, and `updated_at`; the markdown body stores the task text.

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
