const yauzl = require("yauzl");

/**
 * Lists the worksheet names of an .xlsx file by reading only the tiny
 * xl/workbook.xml entry out of the zip's central directory. This does NOT
 * decompress any sheet data, so it is fast and cheap even for multi-gigabyte
 * workbooks with huge sheets.
 */
function listSheetNames(filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      let workbookXml = "";
      let found = false;

      zipfile.on("error", reject);
      zipfile.readEntry();

      zipfile.on("entry", (entry) => {
        if (entry.fileName === "xl/workbook.xml") {
          found = true;
          zipfile.openReadStream(entry, (err, stream) => {
            if (err) return reject(err);
            const chunks = [];
            stream.on("data", (c) => chunks.push(c));
            stream.on("end", () => {
              workbookXml = Buffer.concat(chunks).toString("utf8");
              zipfile.close();
            });
            stream.on("error", reject);
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on("close", () => {
        if (!found) return reject(new Error("Not a valid .xlsx file (no xl/workbook.xml found)."));
        const names = [...workbookXml.matchAll(/<sheet\b[^>]*\sname="([^"]*)"/g)].map((m) =>
          m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        );
        resolve(names);
      });
    });
  });
}

module.exports = { listSheetNames };
