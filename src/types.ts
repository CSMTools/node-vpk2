export type Header = {
	version?: number;
	treeLength?: number;
	footerLength?: number;
	unknown1?: any;
	unknown2?: any;
	unknown3?: any;
	unknown4?: any;
}

export type FileTree = {
	[file: string]: any;
}

export type FileTreeEntry = {
	crc: number;
	preloadBytes: number;
	archiveIndex: number;
	entryOffset: number;
	entryLength: number;
	preloadOffset?: number;
}

export type FileData = {
	location: string;
	name: string;
	extension: string;
	crc: number;
	dataSize: number;
	fullPath: string;
	dataOffset?: number;
	entrySize?: number;
}