import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

export class NodeUtils {
  static mkdirpSync(targetDir: string, mode = "700", relative = false, relativeDir: string = null) {
    const initialDir = path.isAbsolute(targetDir) ? path.sep : "";
    const baseDir = relative ? (relativeDir != null ? relativeDir : __dirname) : ".";
    targetDir.split(path.sep).reduce((parentDir, childDir) => {
      const dir = path.resolve(baseDir, parentDir, childDir);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, mode);
      }
      return dir;
    }, initialDir);
  }
  /**
   * The file's first line; "" for an empty file. A file that cannot be read rejects: before, an empty
   * file never answered and the CLI ended with exit 0 and no output.
   */
  static readFirstLine(fileName: string) {
    return new Promise<string>((resolve, reject) => {
      const readStream = fs.createReadStream(fileName, { encoding: "utf8" });
      readStream.on("error", (err) => reject(err));
      const readInterface = readline.createInterface(readStream);
      readInterface
        .on("line", (line) => {
          // Before close(): closing emits "close" at once, which would answer "".
          resolve(line);
          readInterface.close();
          readStream.close();
        })
        // After the first line this changes nothing: a promise settles once.
        .on("close", () => resolve(""))
        .on("error", (err) => reject(err));
    });
  }
}
