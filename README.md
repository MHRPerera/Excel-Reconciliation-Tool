# Excel Comparison Tool

A web-based application for comparing two Excel workbooks and generating a detailed Excel comparison report.

This project is designed to handle large Excel files efficiently by processing the files row-by-row instead of loading the complete workbooks into memory.

> **Project status:** This is a first version of the system. It has not been fully tested in the current environment because package installation could not be performed without network access. It is recommended to test with a small Excel file first before using large files.

## Features

* Upload two Excel workbooks for comparison
* Compare data row-by-row and column-by-column
* Find matching records
* Find records available only in File A
* Find records available only in File B
* Detect duplicate records
* Generate a downloadable Excel comparison report
* Process large files using streaming
* Use SQLite for efficient data comparison
* Automatically clean up temporary comparison files

## How It Works

The system follows these main steps:

1. The user uploads two Excel files.
2. The files are stored directly on the server's disk.
3. ExcelJS reads the workbooks row-by-row.
4. The extracted data is stored temporarily in SQLite.
5. SQL queries are used to compare the data.
6. The comparison results are written to a new Excel file.
7. The generated report can be downloaded by the user.

The system avoids loading the complete Excel workbooks or report into memory, which helps reduce memory usage when working with large files.

## Technologies Used

* **Node.js** – Backend runtime
* **Express.js** – Web server and API
* **ExcelJS** – Reading and writing Excel files
* **SQLite** – Temporary data storage and comparison
* **better-sqlite3** – SQLite integration
* **Multer** – File uploads
* **HTML / CSS / JavaScript** – Frontend

## Project Structure

```text
excel-compare-app/
│
├── server.js
│
├── routes/
│   └── api.js
│
├── lib/
│   ├── sheetNames.js
│   ├── ingest.js
│   ├── compare.js
│   ├── report.js
│   └── sessions.js
│
├── public/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
│
├── data/
│   └── sessions/
│
├── package.json
└── README.md
```

## Installation

### Requirements

* Node.js 18 or newer
* npm
* Python and a C++ build toolchain may be required for `better-sqlite3`

### Setup

Clone the repository and open the project folder:

```bash
git clone <repository-url>
cd excel-compare-app
```

Install the dependencies:

```bash
npm install
```

Start the application:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Configuration

The application supports the following environment variables:

| Variable      | Default | Description                      |
| ------------- | ------: | -------------------------------- |
| `PORT`        |  `3000` | Port used by the application     |
| `MAX_FILE_MB` |  `5000` | Maximum size of an uploaded file |

Example:

```bash
PORT=8080 MAX_FILE_MB=10000 npm start
```

## Large File Handling

The application is designed with large Excel files in mind.

Instead of loading everything into memory:

* File uploads are written directly to disk using Multer.
* ExcelJS processes spreadsheet data row-by-row.
* SQLite is used for storing and comparing the data.
* SQL queries are used instead of large JavaScript arrays.
* ExcelJS streaming writer is used to generate the final report.

Temporary storage is required for:

* The two uploaded Excel files
* The SQLite working database
* The generated report

For large comparisons, it is recommended to have around **3–4× the combined size of the input files** available as free disk space.

## Output

The system generates an Excel report containing the comparison results, including information such as:

* Matching records
* Records only in File A
* Records only in File B
* Duplicate records
* Data differences

## Limitations

The current version has some limitations:

* Job status is stored in the memory of the Node.js process.
* SQLite operations are currently synchronous.
* Authentication has not been implemented.
* Large `.xls` files require additional testing.
* The application is currently designed mainly for a single server instance.

## Future Improvements

Possible future improvements include:

* User authentication
* User roles and permissions
* Progress indicators for large comparisons
* Background processing using Node.js worker threads
* Redis for shared job management
* Comparison history
* More Excel file format support
* Selective sheet/column comparison
* Improved error handling
* More detailed reports and visual summaries

## Deployment

This application requires a server that can run a Node.js process.

It can be deployed on:

* A VPS
* A university/company server
* Render
* Railway
* Fly.io

If using a reverse proxy such as nginx, the upload size limit should be configured to allow files up to the application's `MAX_FILE_MB` setting.

## Note

This project was developed from scratch as an Excel comparison system. The implementation and architecture are designed around efficient processing of large Excel files.

The application has **not been fully tested end-to-end in the current development environment** because package installation was not available. Therefore, testing should first be performed with a small Excel workbook before moving to larger files.
