import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export class PatchStore {
	private sessionDir: string;

	constructor(sessionDir: string) {
		this.sessionDir = sessionDir;
	}

	writePatch(editId: string, patch: string): { relativePath: string; hash: string } {
		const relativePath = `patches/${editId}.patch`;
		const absolutePath = join(this.sessionDir, relativePath);
		mkdirSync(dirname(absolutePath), { recursive: true });
		writeFileSync(absolutePath, patch, "utf-8");
		const hash = `sha256:${createHash("sha256").update(patch).digest("hex")}`;
		writeFileSync(`${absolutePath}.meta.json`, `${JSON.stringify({ patch_hash: hash }, null, "\t")}\n`, "utf-8");
		return { relativePath, hash };
	}

	readPatch(relativePath: string): string | undefined {
		const absolutePath = join(this.sessionDir, relativePath);
		return existsSync(absolutePath) ? readFileSync(absolutePath, "utf-8") : undefined;
	}
}
