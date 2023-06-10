'use strict';

import crc from 'crc'
import fs from 'fs'
import jBinary from 'jbinary'

import { Header, FileTreeEntry, FileTree, FileData } from './types';

let TYPESET = {
	'jBinary.littleEndian': true,

	vpkHeader: jBinary.Type({
		read: function () {
			let header: Header = {};

			let signature = this.binary.read('uint32');
			console.log(signature);
			if (signature !== 0x55aa1234) {
				throw new Error('VPK signature is invalid');
			}

			header.version = this.binary.read('uint32');
			if (header.version !== 1 && header.version !== 2) {
				throw new Error('VPK version is invalid');
			}

			header.treeLength = this.binary.read('uint32');

			if (header.version === 2) {
				header.unknown1 = this.binary.read('uint32');
				header.footerLength = this.binary.read('uint32');
				header.unknown3 = this.binary.read('uint32');
				header.unknown4 = this.binary.read('uint32');
			}

			return header;
		},
		write: function () { }
	}),

	vpkDirectoryEntry: jBinary.Type({
		read: function () {
			let entry: FileTreeEntry = this.binary.read({
				crc: 'uint32',				// crc integrity
				preloadBytes: 'uint16',		// size of preload (almost always 0) (used for small but critical files)
				archiveIndex: 'uint16',		// on which archive the data is stored (7fff means on _dir archive)
				entryOffset: 'uint32',		// if on _dir, this is offset of data from tree end. If on other archive, offset from start of it
				entryLength: 'uint32'		// size of data
			});

			let terminator: number = this.binary.read('uint16');
			if (terminator !== 0xffff) {
				throw new Error('Directory terminator is invalid');
			}

			return entry;
		},
		write: function () { }
	}),

	vpkTree: jBinary.Type({
		read: function () {
			let files: FileTree = {};

			while (true) {
				let extension = this.binary.read('string0');

				if (extension === '') {
					break;
				}

				while (true) {
					let directory = this.binary.read('string0');

					if (directory === '') {
						break;
					}

					while (true) {
						let filename: string = this.binary.read('string0');

						if (filename === '') {
							break;
						}

						let fullPath: string = filename;
						if (fullPath === ' ') {
							fullPath = '';
						}
						if (extension !== ' ') {
							fullPath += '.' + extension;
						}
						if (directory !== ' ') {
							fullPath = directory + '/' + fullPath;
						}

						let entry = this.binary.read('vpkDirectoryEntry');
						entry.preloadOffset = this.binary.tell();

						this.binary.skip(entry.preloadBytes);

						files[fullPath] = entry;
					}
				}
			}

			return files;
		},
		write: function () { }
	}),
};

// header size in bytes
let HEADER_1_LENGTH = 12;
let HEADER_2_LENGTH = 28;

// let MAX_PATH = 260;

class VPK {
	directoryPath: string;
	loaded: boolean;
	header: Header = {};
	tree: FileTree = {};

	constructor(path: string) {
		this.directoryPath = path;
		this.loaded = false;
	}

	isValid() {
		let header = Buffer.alloc(HEADER_2_LENGTH);
		let directoryFile = fs.openSync(this.directoryPath, 'r');
		fs.readSync(directoryFile, header, 0, HEADER_2_LENGTH, 0);
		let binary = new jBinary(header.toString(), TYPESET);

		try {
			binary.read('vpkHeader');

			return true;
		}
		catch (error) {
			return false;
		}
	}

	load() {
		// Using .toString() for some reason fucks up the file, and gives the completely wrong values.
		//@ts-ignore
		let binary = new jBinary(fs.readFileSync(this.directoryPath), TYPESET);

		try {
			this.header = binary.read('vpkHeader') as Header;
			this.tree = binary.read('vpkTree') as FileTree;
			this.loaded = true;
		} catch (error) {
			throw new Error('Failed loading ' + this.directoryPath);
		}
	}

	get files() {
		return Object.keys(this.tree);
	}

	getFile(path: string) {
		let entry: FileTreeEntry = this.tree[path];

		if (!entry || !entry.preloadOffset) {
			throw new Error('No such file in tree')
		}

		let file = Buffer.alloc(entry.preloadBytes + entry.entryLength);

		if (entry.preloadBytes > 0) {
			let directoryFile = fs.openSync(this.directoryPath, 'r');
			fs.readSync(directoryFile, file, 0, entry.preloadBytes, entry.preloadOffset);
		}

		if (entry.entryLength > 0) {
			if (entry.archiveIndex === 0x7fff) {
				let offset = this.header.treeLength ?? 0;

				if (this.header.version === 1) {
					offset += HEADER_1_LENGTH;
				} else if (this.header.version === 2) {
					offset += HEADER_2_LENGTH;
				}

				let directoryFile = fs.openSync(this.directoryPath, 'r');
				fs.readSync(directoryFile, file, entry.preloadBytes, entry.entryLength, offset + entry.entryOffset);
			} else {
				// read from specified archive
				let fileIndex = ('000' + entry.archiveIndex).slice(-3);
				let archivePath = this.directoryPath.replace(/_dir\.vpk$/, '_' + fileIndex + '.vpk');

				let archiveFile = fs.openSync(archivePath, 'r');
				fs.readSync(archiveFile, file, entry.preloadBytes, entry.entryLength, entry.entryOffset);
			}
		}

		if (crc.crc32(file) !== entry.crc) {
			throw new Error('CRC does not match');
		}

		return file;
	}

	extract(destinationDir: string) {
		// if not loaded yet, load it
		if (this.loaded === false) {
			try {
				this.load();
			} catch (error) {
				throw new Error('VPK was not loaded and it failed loading');
			}
		}

		let failed = [];
		// make sure destinationDir exists
		try {
			if (!fs.existsSync(destinationDir)) {
				fs.mkdirSync(destinationDir, { recursive: true });
			}
		} catch (error) {
			throw new Error('Destination dir cant be ensured');
		}

		// extract files one by one
		for (let file of this.files) {
			// destination of this file (with file name and extension)
			let destFile = destinationDir + '/' + file;
			// destination of this file (only the directory)
			let fileDestDir = destFile.substr(0, destFile.lastIndexOf('/'));

			// make sure destination dir of this file exists
			try {
				if (!fs.existsSync(fileDestDir)) {
					fs.mkdirSync(fileDestDir, { recursive: true });
				}
			} catch (error) {
				throw new Error('Error ensuring file directory: ' + fileDestDir);
			}

			// get the file
			let fileBuffer: Buffer;

			try {
				fileBuffer = this.getFile(file);
			} catch (error) {
				throw error;
			}

			// write it
			try {
				fs.writeFileSync(destFile, fileBuffer);
			} catch (error) {
				failed.push(destFile);
			}
		}

		// throw all failed files
		if (failed.length !== 0) {
			throw new Error('Failed extrating following files: \r\n' + failed.toString());
		}
	}
}

function listFiles(directory: string, first = true, root = directory) {
	let files: FileData[] = [];
	let filesHere = fs.readdirSync(directory);
	filesHere.forEach(file => {
		if (fs.statSync(directory + "/" + file).isDirectory()) {
			files = files.concat(listFiles(directory + "/" + file, false, root));
		} else {
			files.push({
				location: first ? " " : directory.substring(root.length + 1),
				name: file.substring(0, file.lastIndexOf(".")),
				extension: file.substring(file.lastIndexOf(".") + 1),
				crc: crc.crc32(fs.readFileSync(directory + "/" + file)),
				dataSize: fs.statSync(directory + "/" + file).size,
				fullPath: directory + "/" + file
			});
		}
	});

	return files;
}

class VPKcreator {
	root: any;
	loaded: boolean;
	totalData: number = 0;
	totalSize: number = 0;
	treeSize: number = 0;
	tree: FileData[] = [];

	constructor(directory: string) {
		this.root = directory;
		this.loaded = false;
	}

	isValid() {
		try {
			if (fs.statSync(this.root).isDirectory()) {
				return true;
			}
			return false;
		} catch (error) {
			return false;
		}
	}

	/**
	 * Load dir as vpk.
	 * @param version Only supports VPK 1 atm.
	 */
	load(version: 1 = 1) {
		if (version != 1) {
			throw new Error("Version not supported");
		}

		if (this.isValid()) {

			// create all entries
			let files = listFiles(this.root);

			// calculate total size of entries
			let totalSize = 0;
			totalSize += 4; // signature
			totalSize += 4; // vpk version
			totalSize += 4; // treeSize
			let treeSize = 0;
			this.totalData = 0;
			files.forEach(file => {
				let entrySize = 0;
				entrySize = (file.location.length + 1) + (file.name.length + 1) + (file.extension.length + 1);
				entrySize += 4;	// crc
				entrySize += 2;	// preloadBytes
				entrySize += 2; // archiveIndex
				entrySize += 4; // entryOffset
				entrySize += 4; // entryLength
				entrySize += 2; // terminator
				entrySize += 2; // 2 nulls terminating
				file.entrySize = entrySize;
				treeSize += entrySize;
				this.totalData += file.dataSize;
			});
			treeSize += 1; // the last null
			totalSize += treeSize;

			// set all offsets
			let offset = 0; // offset from tree end
			files.forEach(file => {
				file.dataOffset = offset;
				offset += file.dataSize;
			});

			this.totalSize = totalSize;
			this.treeSize = treeSize;
			this.tree = files;

			this.loaded = true;
		}
	}

	save(destinationFile: string) {
		// header
		let header = Buffer.alloc(HEADER_1_LENGTH);
		header.writeUInt32LE(0x55aa1234, 0);
		header.writeUInt32LE(1, 4);
		header.writeUInt32LE(this.treeSize, 8);

		// tree
		let tree = Buffer.alloc(this.treeSize);
		let offset = 0;
		this.tree.forEach(file => {
			if (!file.entrySize || !file.dataOffset) {
				return;
			}

			tree.write(file.extension + "\0" + file.location + "\0" + file.name + "\0", offset);
			let relOff = offset + file.entrySize - 20;
			tree.writeUInt32LE(file.crc, relOff);					// crc
			tree.writeUInt16LE(0x0000, relOff + 4);					// preloadByes
			tree.writeUInt16LE(0x7fff, relOff + 6);					// archiveIndex
			tree.writeUInt32LE(file.dataOffset, relOff + 8);		// entryOffset
			tree.writeUInt32LE(file.dataSize, relOff + 12);			// entryLength
			tree.writeUInt16LE(0xffff, relOff + 16);				// terminator
			tree.write("\0\0", relOff + 18);						// 2 nulls

			offset += file.entrySize;
		});
		tree.write("\0", this.treeSize);			// last null

		fs.writeFileSync(destinationFile, Buffer.concat([header, tree]));

		// data
		let data = Buffer.alloc(this.totalData);
		this.tree.forEach(file => {
			let fileData = fs.readFileSync(file.fullPath);
			fs.appendFileSync(destinationFile, fileData);
		});
	}
}

export { VPK, VPKcreator };