interface DownloadAssets {
	action: "downloadAssets";
	owner?: string;
	repo?: string;
	version?: string;
	fileList: string[];
}

interface Noname extends DownloadAssets {
}

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

interface Tree {
	path: string;
	mode: string;
	type: "blob" | "tree";
	sha: string;
	size: number;
	url: string;
}

interface Trees {
	sha: string;
	url: string;
	tree: Tree[];
	truncated: boolean;
}
