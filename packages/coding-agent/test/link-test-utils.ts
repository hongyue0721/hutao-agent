import { linkSync, symlinkSync } from "node:fs";

function isSymlinkPermissionError(error: unknown): boolean {
	return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM";
}

export function createDirectoryLinkForTest(target: string, link: string): "symlink" | "junction" {
	try {
		symlinkSync(target, link, "dir");
		return "symlink";
	} catch (error) {
		if (process.platform !== "win32" || !isSymlinkPermissionError(error)) throw error;
		symlinkSync(target, link, "junction");
		return "junction";
	}
}

export function createFileLinkForTest(target: string, link: string): "symlink" | "hardlink" {
	try {
		symlinkSync(target, link);
		return "symlink";
	} catch (error) {
		if (process.platform !== "win32" || !isSymlinkPermissionError(error)) throw error;
		linkSync(target, link);
		return "hardlink";
	}
}
