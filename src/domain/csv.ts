export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

function parseLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** Parse a CSV string, honouring double-quoted fields with embedded commas. */
export function parseCsv(text: string): ParsedCsv {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headerLine, ...rest] = lines;

  return {
    headers: parseLine(headerLine),
    rows: rest.filter((line) => line.trim().length > 0).map(parseLine)
  };
}

/** Parse a CSV into an array of header-keyed records. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const { headers, rows } = parseCsv(text);
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])));
}
