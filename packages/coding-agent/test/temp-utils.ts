import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create a unique temporary directory for tests.
 *
 * Use this instead of process.cwd() + fixed names or Date.now()-only names:
 * - fixed names collide across Vitest workers and parallel Windows/WSL runs
 * - Date.now() alone can collide when multiple tests start in the same millisecond
 * - mkdtempSync asks the OS for a unique suffix and is safer under concurrency
 */
export function createTestTempDir(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `${sanitizeTempPrefix(prefix)}-`));
}

/**
 * Remove a temporary test directory with retries.
 *
 * Windows and OneDrive-backed paths can transiently report ENOTEMPTY/EPERM when
 * a file handle has just been closed. Retrying cleanup avoids turning a passed
 * test into a teardown failure without hiding real setup/assertion failures.
 */
export function cleanupTestTempDir(dir: string | undefined): void {
	if (!dir) return;

	let lastError: unknown;
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
			return;
		} catch (error) {
			lastError = error;
			const start = Date.now();
			while (Date.now() - start < 25 * (attempt + 1)) {
				// Synchronous tests already use sync filesystem helpers. Keep cleanup
				// sync too so afterEach callers do not need to become async.
			}
		}
	}

	throw lastError;
}

function sanitizeTempPrefix(prefix: string): string {
	const sanitized = prefix
		.replace(/[^a-zA-Z0-9._-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return sanitized || "test";
}
