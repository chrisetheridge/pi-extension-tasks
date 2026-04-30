# pi-extension-tasks

Standalone Pi package for the task overlay extension and generic task tool.

## Layout

- `src/` - runtime extension source consumed by Pi
- `skills/` - agent guidance for using the task overlay feature
- `tests/` - package tests

## Install

From this local checkout:

```bash
pi install ../pi-extension-tasks -l
```

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
