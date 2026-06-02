export interface ReadOnlyInquiryLock {
	id: string;
	repoRoot: string;
	targetKind: string;
	targetId: string;
	question: string;
	createdAt: string;
	expiresAt: number;
}

export class ReadOnlyInquiryGuard {
	private readonly locks = new Map<string, ReadOnlyInquiryLock>();
	private readonly ttlMs: number;

	constructor(ttlMs = 5 * 60 * 1000) {
		this.ttlMs = ttlMs;
	}

	activate(
		request: Pick<ReadOnlyInquiryLock, "repoRoot" | "targetKind" | "targetId" | "question">,
	): ReadOnlyInquiryLock {
		const now = Date.now();
		const lock: ReadOnlyInquiryLock = {
			...request,
			id: `inq_${now.toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
			createdAt: new Date(now).toISOString(),
			expiresAt: now + this.ttlMs,
		};
		this.locks.set(request.repoRoot, lock);
		return lock;
	}

	current(repoRoot: string): ReadOnlyInquiryLock | undefined {
		const lock = this.locks.get(repoRoot);
		if (!lock) return undefined;
		if (lock.expiresAt < Date.now()) {
			this.locks.delete(repoRoot);
			return undefined;
		}
		return lock;
	}

	clear(repoRoot: string): void {
		this.locks.delete(repoRoot);
	}
}

export const defaultReadOnlyInquiryGuard = new ReadOnlyInquiryGuard();
