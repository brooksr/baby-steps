import { parseCsv } from '../domain/csv';

interface CsvTableProps {
  text: string;
}

function headerLabel(header: string) {
  return header.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function CsvTable({ text }: CsvTableProps) {
  const { headers, rows } = parseCsv(text);

  return (
    <div className="csv-scroll">
      <table className="csv-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{headerLabel(header)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map((header, cellIndex) => (
                <td key={header}>{row[cellIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
