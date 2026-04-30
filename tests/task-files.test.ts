import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	deleteTask,
	loadTasks,
	mergeTaskPatch,
	parseTaskMarkdown,
	resolveTaskConfig,
	serializeTaskMarkdown,
	writeTask,
} from "../src/task-files.ts";

async function tempDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), "pi-extension-tasks-"));
}

describe("task files", () => {
	it("resolves project config before user config and defaults to .pi/tasks", async () => {
		const cwd = await tempDir();
		const home = await tempDir();

		expect(resolveTaskConfig(cwd, home)).toMatchObject({
			tasksDir: path.join(cwd, ".pi/tasks"),
			source: "default",
		});

		await fs.mkdir(path.join(home, ".pi/agent/extensions/tasks"), { recursive: true });
		await fs.writeFile(
			path.join(home, ".pi/agent/extensions/tasks/config.json"),
			JSON.stringify({ path: "user-tasks" }),
		);
		expect(resolveTaskConfig(cwd, home)).toMatchObject({
			tasksDir: path.join(cwd, "user-tasks"),
			source: "user",
		});

		await fs.mkdir(path.join(cwd, ".pi/extensions/tasks"), { recursive: true });
		await fs.writeFile(path.join(cwd, ".pi/extensions/tasks/config.json"), JSON.stringify({ path: "project-tasks" }));
		expect(resolveTaskConfig(cwd, home)).toMatchObject({
			tasksDir: path.join(cwd, "project-tasks"),
			source: "project",
		});
	});

	it("round-trips markdown frontmatter and body", () => {
		const markdown = serializeTaskMarkdown({
			id: "task-write-tests",
			title: "Write tests",
			status: "progress",
			owner: "agent",
			order: 0,
			source: "test",
			body: "Add coverage for markdown tasks.",
			createdAt: 1_700_000_000_000,
			updatedAt: 1_700_000_001_000,
		});

		expect(markdown).toContain("status: progress");
		expect(markdown).toContain("owner: agent");
		expect(parseTaskMarkdown(markdown, "fallback")).toEqual(
			expect.objectContaining({
				id: "task-write-tests",
				title: "Write tests",
				status: "progress",
				owner: "agent",
				body: "Add coverage for markdown tasks.",
			}),
		);
	});

	it("writes, updates, completes, and deletes task files", async () => {
		const cwd = await tempDir();
		const tasksDir = path.join(cwd, ".pi/tasks");
		const created = await writeTask(tasksDir, {
			id: "task-draft-plan",
			title: "Draft plan",
			status: "pending",
			order: 0,
			source: "test",
			body: "Initial body",
			createdAt: 10,
			updatedAt: 10,
		});

		expect((await loadTasks(cwd)).tasks).toEqual([expect.objectContaining({ id: created.id, status: "pending" })]);

		await writeTask(tasksDir, mergeTaskPatch(created, { status: "progress", owner: "user", body: "Working" }));
		expect((await loadTasks(cwd)).tasks).toEqual([
			expect.objectContaining({ id: created.id, status: "progress", owner: "user", body: "Working" }),
		]);

		await writeTask(tasksDir, mergeTaskPatch(created, { status: "complete", owner: undefined }));
		expect((await loadTasks(cwd)).tasks).toEqual([
			expect.objectContaining({ id: created.id, status: "complete", owner: undefined }),
		]);

		await deleteTask(tasksDir, created.id);
		expect((await loadTasks(cwd)).tasks).toEqual([]);
	});
});
