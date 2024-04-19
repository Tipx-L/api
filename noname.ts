import JSZip from "jszip";
import { EOL } from "os";
import pLimit from "p-limit";

interface DownloadAssets {
	action: "downloadAssets";
	owner?: string;
	repo?: string;
	version?: string;
	fileList: string[];
}

interface Noname extends DownloadAssets {}

interface Commit {
	sha: string;
	url: string;
}

interface Tag {
	name: string;
	zipball_url: string;
	tarball_url: string;
	commit: Commit;
	node_id: string;
}

const gitHubHeaders = new Headers();
gitHubHeaders.set("Accept", "application/vnd.github.v3+json");

const githubInit: RequestInit = {
	headers: gitHubHeaders
};

const limit = pLimit(1);

/**
 * Retrieves the latest version tag from a GitHub repository, excluding a specific tag.
 * This function fetches the list of tags from the GitHub repository specified by
 * the owner and repository name, then returns the latest tag name that is not “v1998”.
 * @param owner - The username or organization name on GitHub that owns the repository.
 * @param repo - The name of the repository from which to fetch tags.
 * @returns A promise that resolves with the name of the latest version tag,
 * or rejects with an error if the operation fails.
 * @throws {Error} Will throw an error if the fetch operation fails or if no valid tags are found.
 */
async function getLatestVersionFromGitHub(owner: string, repo: string) {
	const input = `https://api.github.com/repos/${owner}/${repo}/tags`;
	const tagsResponse = await fetch(input, githubInit);
	if (!tagsResponse.ok) throw new Error(`Failed to fetch tags from ${input}`);
	const tags = (await tagsResponse.json()) as Tag[];

	for (const tag of tags) {
		const tagName = tag.name;
		if (tagName !== "v1998") return tagName;
	}

	throw new Error(`No valid tags found in ${input}`);
}

async function generateHashFromArray(array: unknown[]) {
	const encoder = new TextEncoder();
	const data = encoder.encode(array.join(""));
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");
	return hashHex;
}

/**
 * Attempts to fetch the response array buffer from a given resource, retrying a specified number of times.
 * @param input - The resource to fetch. Can be a URL, Request object, or string representing the URL.
 * @param retryCount - The number of times to retry the fetch if it fails. Defaults to 5.
 * @returns A promise that resolves with the readable stream of the response array buffer.
 * @throws {Error} Will throw an error if the fetch request fails or if it fails to obtain a valid array buffer after the specified number of retries.
 */
async function fetchArrayBuffer(input: string | URL | Request, retryCount: number = 5) {
	const errors: Error[] = [];

	for (let repetition = 0; repetition < retryCount; repetition++) {
		try {
			const fetchArrayBufferResponse = await fetch(input);
			if (!fetchArrayBufferResponse.ok) throw new Error(`Fetch request of ${input} failed with status: ${fetchArrayBufferResponse.status}`);
			return fetchArrayBufferResponse.arrayBuffer();
		} catch (error) {
			if (error instanceof Error) errors.push(error);
		}
	}

	let message = `Failed to fetch array buffer of ${input} after ${retryCount} attempts`;
	throw new Error(errors.length ? `${message}${errors.map(error => `${EOL}${error.message}`).join("")}` : message);
}

export async function getNoname(noname: Noname) {
	if (noname.action !== "downloadAssets")
		return new Response(null, {
			status: 400
		});

	let version = noname.version;
	const owner = noname.owner || "libccy";
	const repo = noname.repo || "noname";
	const fileList = noname.fileList;

	try {
		if (!version) version = await getLatestVersionFromGitHub(owner, repo);
		const zip = new JSZip();

		await Promise.all(
			fileList.map(file =>
				limit(async () => {
					const arrayBuffer = await fetchArrayBuffer(`https://raw.githubusercontent.com/${owner}/${repo}/${version}/${file}`);

					zip.file(file, arrayBuffer, {
						compression: "DEFLATE",
						compressionOptions: {
							level: 9
						}
					});
				})
			)
		);

		const headers = new Headers();
		headers.set("Content-Type", "application/zip");
		headers.set(
			"Content-Disposition",
			`attachment; filename="noname-asset-${owner}-${repo}-${version.replace(/[/\\?%*:|"<>]/g, "-")}-${await generateHashFromArray(
				fileList
			)}.zip"`
		);

		return new Response(
			await zip.generateAsync({
				type: "blob"
			}),
			{
				status: 200,
				headers
			}
		);
	} catch (error) {
		console.error(error);

		return new Response(error instanceof Error ? error.message : null, {
			status: 500
		});
	}
}
