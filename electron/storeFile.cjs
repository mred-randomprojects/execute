const fs = require("node:fs");

// Reading the store file, kept apart from main.cjs so it can be tested without
// Electron (see storeFile.test.mjs).

/**
 * What `store:load` answers:
 * - the parsed store;
 * - `null` when there is no file yet (first run: the app starts empty);
 * - `{ corrupt: true, backup }` when the file exists but isn't valid JSON. The
 *   renderer shows its error screen for it and writes nothing, so the file is
 *   left exactly as it is; `backup` is a copy kept beside it (null if the copy
 *   failed).
 *
 * Any other read error (permissions, I/O) is thrown, so the renderer retries
 * and then shows the error screen. Treating it as "no file" would start the app
 * empty, and its first save would replace the file it couldn't read.
 */
function readStoreFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error != null && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { corrupt: true, backup: backUpCorrupt(file) };
  }
}

// One copy per distinct corrupt file, not one per attempt: "Try again" reads it
// again, and each read would otherwise leave another full-size copy behind.
let lastBackup = null; // { file, mtimeMs, size, path }

function backUpCorrupt(file) {
  try {
    const { mtimeMs, size } = fs.statSync(file);
    if (
      lastBackup != null &&
      lastBackup.file === file &&
      lastBackup.mtimeMs === mtimeMs &&
      lastBackup.size === size &&
      fs.existsSync(lastBackup.path)
    ) {
      return lastBackup.path;
    }
    const path = `${file}.corrupt-${Date.now()}`;
    fs.copyFileSync(file, path, fs.constants.COPYFILE_EXCL);
    lastBackup = { file, mtimeMs, size, path };
    return path;
  } catch {
    return null;
  }
}

module.exports = { readStoreFile };
