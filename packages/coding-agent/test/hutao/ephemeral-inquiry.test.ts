import { describe, expect, it } from "vitest";
import { ReadOnlyInquiryGuard } from "../../src/hutao/ephemeral-inquiry/read-only-guard.ts";

describe("ReadOnlyInquiryGuard", () => {
	it("activates and clears a repo-scoped read-only inquiry lock", () => {
		const guard = new ReadOnlyInquiryGuard();
		const lock = guard.activate({
			repoRoot: "/repo",
			targetKind: "prompting",
			targetId: "p_test",
			question: "why?",
		});

		expect(lock.id).toMatch(/^inq_/);
		expect(guard.current("/repo")).toMatchObject({
			targetKind: "prompting",
			targetId: "p_test",
			question: "why?",
		});

		guard.clear("/repo");

		expect(guard.current("/repo")).toBeUndefined();
	});

	it("expires stale locks", async () => {
		const guard = new ReadOnlyInquiryGuard(1);
		guard.activate({ repoRoot: "/repo", targetKind: "edit", targetId: "e_test", question: "what changed?" });
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(guard.current("/repo")).toBeUndefined();
	});
});
