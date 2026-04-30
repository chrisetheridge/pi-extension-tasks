import { describe, expect, it, vi } from "vitest";

import { TaskPanel } from "../src/task-panel.ts";
import { createTaskStore } from "../src/task-store.ts";

function theme() {
	return {
		fg: (_kind: string, text: string) => text,
		bold: (text: string) => `*${text}*`,
		dim: (text: string) => text,
	};
}

describe("task panel", () => {
	it("renders the current task list with status markers", () => {
		const store = createTaskStore([
			{ id: "a", title: "Draft plan", status: "pending", order: 0, source: "planner", updatedAt: 1 },
			{
				id: "b",
				title: "Implement panel",
				status: "progress",
				order: 1,
				source: "agent",
				owner: "agent",
				updatedAt: 2,
			},
			{ id: "c", title: "Ship", status: "complete", order: 2, source: "agent", updatedAt: 3 },
		]);
		const panel = new TaskPanel(store, theme(), () => {});

		const output = panel.render(80).join("\n");
		expect(output).toContain("Tasks (3 total, 1 progress, 1 complete)");
		expect(output).toContain("[~] Implement panel (progress @agent)");
		expect(output).toContain("[ ] Draft plan (pending)");
		expect(output).toContain("[✓] Ship (complete)");
	});

	it("requests a render when the store changes", () => {
		const store = createTaskStore([
			{ id: "a", title: "Draft plan", status: "pending", order: 0, source: "planner", updatedAt: 1 },
		]);
		const requestRender = vi.fn();
		new TaskPanel(store, theme(), requestRender);

		store.complete("a");

		expect(requestRender).toHaveBeenCalled();
	});

	it("filters tasks from keyboard search and opens action menu", () => {
		const store = createTaskStore([
			{ id: "a", title: "Draft plan", status: "pending", order: 0, source: "planner", updatedAt: 1 },
			{ id: "b", title: "Implement panel", status: "progress", order: 1, source: "agent", updatedAt: 2 },
		]);
		const panel = new TaskPanel(store, theme(), () => {});

		panel.handleInput("i");
		panel.handleInput("m");
		expect(panel.render(80).join("\n")).toContain("Implement panel");
		expect(panel.render(80).join("\n")).not.toContain("Draft plan");

		panel.handleInput("\r");
		expect(panel.render(80).join("\n")).toContain("Actions: Implement panel");
		expect(panel.render(80).join("\n")).toContain("complete");
	});

	it("navigates with terminal arrow key variants", () => {
		const store = createTaskStore([
			{ id: "a", title: "Draft plan", status: "pending", order: 0, source: "planner", updatedAt: 1 },
			{ id: "b", title: "Implement panel", status: "pending", order: 1, source: "agent", updatedAt: 2 },
			{ id: "c", title: "Verify output", status: "pending", order: 2, source: "agent", updatedAt: 3 },
		]);
		const panel = new TaskPanel(store, theme(), () => {});

		panel.handleInput("\u001bOB");
		panel.handleInput("\u001bOA");
		panel.handleInput("\u001bOB");
		panel.handleInput("\r");
		expect(panel.render(80).join("\n")).toContain("Actions: Implement panel");

		panel.handleInput("\u001bOB");
		expect(panel.render(80).join("\n")).toContain("> claim");
	});
});
