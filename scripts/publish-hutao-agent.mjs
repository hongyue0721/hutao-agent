#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packageDirectory = "packages/coding-agent";
const expectedPackageName = "hutao-agent";
const dryRun = process.argv.includes("--dry-run");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--dry-run");

if (unknownArgs.length > 0) {
	console.error("Usage: node scripts/publish-hutao-agent.mjs [--dry-run]");
	process.exit(1);
}

function commandForPlatform(command) {
	return process.platform === "win32" ? `${command}.cmd` : command;
}

function spawnOptions(options = {}, capture = false) {
	return {
		cwd: options.cwd,
		encoding: "utf8",
		stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
		shell: process.platform === "win32",
	};
}

function commandOutput(result) {
	return [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
}

function run(command, args, options = {}) {
	console.log(`$ ${[command, ...args].join(" ")}`);
	const result = spawnSync(commandForPlatform(command), args, spawnOptions(options, Boolean(options.capture)));

	if (result.status !== 0) {
		const output = commandOutput(result);
		throw new Error(
			output ? `Command failed: ${command} ${args.join(" ")}\n${output}` : `Command failed: ${command} ${args.join(" ")}`,
		);
	}

	return result;
}

function readPackageJson(directory) {
	return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function assertBuildOutputExists(directory) {
	if (!existsSync(join(directory, "dist"))) {
		throw new Error(`${directory}/dist does not exist. Run npm run build before publishing.`);
	}
}

function validatePack(directory) {
	const result = run("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { capture: true, cwd: directory });
	const packed = JSON.parse(result.stdout)[0];
	console.log(
		`  ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked`,
	);
}

function isPublished(name, version) {
	const result = spawnSync(
		commandForPlatform("npm"),
		["view", `${name}@${version}`, "version", "--json"],
		spawnOptions({}, true),
	);

	if (result.status === 0 && result.stdout.trim()) {
		return true;
	}

	const output = commandOutput(result);
	if (result.status !== 0 && (output.includes("E404") || output.includes("404 Not Found"))) {
		return false;
	}

	throw new Error(output ? `Failed to query ${name}@${version}\n${output}` : `Failed to query ${name}@${version}`);
}

const packageJson = readPackageJson(packageDirectory);
if (packageJson.name !== expectedPackageName) {
	throw new Error(`${packageDirectory}/package.json has name ${packageJson.name}, expected ${expectedPackageName}`);
}

const version = packageJson.version;
console.log(`Publishing ${expectedPackageName}@${version}${dryRun ? " (dry run)" : ""}\n`);

assertBuildOutputExists(packageDirectory);
const published = isPublished(expectedPackageName, version);

if (dryRun) {
	if (published) {
		console.log(`${expectedPackageName}@${version} is already published; validating package contents only.`);
	} else {
		console.log(`${expectedPackageName}@${version} is not published; validating package contents before publish.`);
	}
	validatePack(packageDirectory);
	process.exit(0);
}

if (published) {
	console.log(`Skipping ${expectedPackageName}@${version}: already published`);
	process.exit(0);
}

run("npm", ["publish", "--access", "public", "--tag", "latest", "--provenance", "--ignore-scripts"], {
	cwd: packageDirectory,
});
