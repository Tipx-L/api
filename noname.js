/// @ts-check
/// <reference path="noname-interfaces.d.ts" />

import archiver from "archiver";
import { createReadStream, createWriteStream } from "fs";
import { access, mkdir, unlink } from "fs/promises";
import { ServerResponse, createServer } from "http";
import pLimit from "p-limit";
import { join } from "path";
import { Readable } from "stream";

const gitHubHeaders = new Headers();
gitHubHeaders.set("Accept", "application/vnd.github.v3+json");

/**
 * @type {RequestInit}
 */
const githubInit = {
	headers: gitHubHeaders
};

const limit = pLimit(16);

/**
 * Retrieves the latest version tag from a GitHub repository, excluding a specific tag.
 * This function fetches the list of tags from the GitHub repository specified by
 * the owner and repository name, then returns the latest tag name that is not “v1998”.
 * @param {string} owner - The username or organization name on GitHub that owns the repository.
 * @param {string} repo - The name of the repository from which to fetch tags.
 * @returns {Promise<string>} A promise that resolves with the name of the latest version tag,
 * or rejects with an error if the operation fails.
 * @throws {Error} Will throw an error if the fetch operation fails or if no valid tags are found.
 */
async function getLatestVersionFromGitHub(owner, repo) {
	const tagsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/tags`, githubInit);
	if (!tagsResponse.ok) throw new Error("Failed to fetch tags from GitHub repository");
	/**
	 * @type {Tag[]}
	 */
	const tags = await tagsResponse.json();

	for (const tag of tags) {
		const tagName = tag.name;
		if (tagName !== "v1998") return tagName;
	}

	throw new Error("No valid tags found in the repository");
}

/**
 * @param {unknown[]} array
 */
async function generateHashFromArray(array) {
	const encoder = new TextEncoder();
	const data = encoder.encode(array.join(""));
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");
	return hashHex;
}

/**
 * @param {ServerResponse} res
 * @param {string} asset
 */
function sendZIPFile(res, asset) {
	res.writeHead(200, {
		"Content-Type": "application/zip",
		"Content-Disposition": `attachment; filename="${asset}"`
	});
}


/**
 * Checks if a file or directory exists at the specified path.
 * This function uses the `access` method from the `fs` module to determine
 * if the file or directory is accessible, thereby checking its existence.
 * @param {import("fs").PathLike} path - The file or directory path to check for existence.
 * @returns {Promise<boolean>} A promise that resolves to `true` if the file or directory exists, 
 * or `false` if it does not exist.
 */
async function isExist(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Attempts to fetch the response body from a given resource, retrying a specified number of times.
 * @param {string | URL | Request} input - The resource to fetch. Can be a URL, Request object, or string representing the URL.
 * @param {number} retryCount - The number of times to retry the fetch if it fails. Defaults to 5.
 * @returns {Promise<Readable>} A promise that resolves with the readable stream of the response body.
 * @throws {Error} Will throw an error if the fetch request fails or if it fails to obtain a valid body after the specified number of retries.
 */
async function fetchBody(input, retryCount = 5) {
	for (let repetition = 0; repetition < retryCount; repetition++) {
		try {
			const fetchBodyResponse = await fetch(input);
			if (!fetchBodyResponse.ok) throw new Error(`Fetch request failed with status: ${fetchBodyResponse.status}`);
			const body = fetchBodyResponse.body;
			if (body) return Readable.fromWeb(/** @type {import("stream/web").ReadableStream<Uint8Array>} */(body));
		} catch {
		}
	}

	throw new Error(`Failed to fetch body after ${retryCount} attempts`);
}

/**
 * @type {import("http").RequestListener}
 */
async function nonameRequestListener(req, res) {
	if (req.method !== "POST") {
		res.writeHead(400);
		res.end();
		return;
	}

	/**
	 * @type {Buffer}
	 */
	const chunk = await new Promise(resolve => req.on("data", resolve));
	/**
	 * @type {Noname}
	 */
	const noname = JSON.parse(chunk.toString());
	await new Promise(resolve => req.on("end", resolve));

	if (noname.action !== "downloadAssets") {
		res.writeHead(400);
		res.end();
		return;
	}

	console.log("A user is about to download assets,");
	let version = noname.version;
	const owner = noname.owner || "libccy";
	const repo = noname.repo || "noname";
	const fileList = noname.fileList;
	let asset = "";
	let path = "";

	try {
		if (!version) version = await getLatestVersionFromGitHub(owner, repo);
		console.log(`which version is “${version}”.`);
		asset = `noname-asset-${owner}-${repo}-${version}-${await generateHashFromArray(fileList)}.zip`.replace(/[/\\?%*:|"<>]/g, "-");
		path = join("noname", asset);

		if (await isExist(path)) {
			console.log(`The file “${asset}” already exists.`);
			sendZIPFile(res, asset);
			console.log(`Responding to the user with file “${asset}”…`);
			createReadStream(path).pipe(res);
		} else {
			console.log(`Collecting assets from “https://github.com/${owner}/${repo}/tree/${version}”…`);
			sendZIPFile(res, asset);
			console.log(`Creating a file “${asset}” while responding to the user with it…`);

			const archive = archiver("zip", {
				zlib: {
					level: 9
				}
			});

			archive.pipe(res);
			if (!await isExist("noname")) await mkdir("noname");
			archive.pipe(createWriteStream(path));

			await Promise.all(fileList.map(file => limit(async () => {
				const body = await fetchBody(`https://ghproxy.cc/https://raw.githubusercontent.com/${owner}/${repo}/${version}/${file}`);
				console.log(`Downloaded file “${file}”.`);

				archive.append(body, {
					name: file
				});
			})));

			console.log(`Finalizing file “${asset}”…`);
			await archive.finalize();
		}
	} catch (error) {
		console.error(error);

		if (res.headersSent) res.destroy();
		else {
			res.writeHead(500);
			res.end();
		}

		if (asset) unlink(path);
	}
}

export function createNonameServer(port = 1662) {
	return createServer(nonameRequestListener).listen(port);
}
