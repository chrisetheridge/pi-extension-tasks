import { describe, expect, it, vi } from "vitest";

import { createTaskStore } from "../src/task-store.ts";

const baseTasks = [
	{
		id: "task-1",
		title: "Write tests",
		status: "pending" as const,
		order: 0,
		source: "planner",
		updatedAt: 1,
	},
	{
		id: "task-2",
		title: "Implement feature",
		status: "progress" as const,
		order: 1,
		source: "agent",
		owner: "agent" as const,
		updatedAt: 2,
	},
];

describe("task store", () => {
	it("upserts, sorts, and emits change notifications", () => {
		const store = createTaskStore();
		const changed = vi.fn();
		store.subscribe(changed);

		store.replace(baseTasks);
		store.upsert([
			{
				id: "task-3",
				title: "Ship it",
				status: "complete",
				order: 2,
				source: "agent",
				updatedAt: 3,
			},
		]);

		expect(changed).toHaveBeenCalled();
		expect(store.snapshot().map((task) => task.id)).toEqual(["task-2", "task-1", "task-3"]);
	});

	it("patches and completes tasks", () => {
		const store = createTaskStore(baseTasks);

		store.patch("task-1", { status: "progress", owner: "user", notes: "working now" });
		store.complete("task-1", "done now");

		expect(store.snapshot()).toEqual([
			expect.objectContaining({ id: "task-2", status: "progress", owner: "agent" }),
			expect.objectContaining({ id: "task-1", status: "complete", notes: "done now", owner: undefined }),
		]);
	});

	it("applies in-memory events into the same state", () => {
		const store = createTaskStore();
		store.applyEvent({ kind: "replace", tasks: baseTasks });
		store.applyEvent({ kind: "patch", id: "task-2", patch: { status: "blocked", notes: "waiting" } });

		expect(store.snapshot()).toEqual([
			expect.objectContaining({ id: "task-1", status: "pending" }),
			expect.objectContaining({ id: "task-2", status: "blocked", notes: "waiting" }),
		]);
	});
});
