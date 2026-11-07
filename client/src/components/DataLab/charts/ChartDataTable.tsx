interface ChartDataTableProps {
  /** Table caption; pass the chart's localized accessible name. */
  caption: string;
  /**
   * Column headers, one per cell of each row. An empty string renders an empty
   * corner header, the standard shape for a leading category column without a
   * localized title.
   */
  columns: string[];
  /** One row of cell strings per plotted row, aligned with `columns`. */
  rows: string[][];
}

/**
 * Visually hidden data table mirroring what a chart plots, so screen readers
 * can read exact values that the SVG only shows as geometry. `sr-only` keeps
 * the table in the accessibility tree while hiding it from sighted users.
 */
export default function ChartDataTable({ caption, columns, rows }: ChartDataTableProps) {
  if (columns.length === 0 || rows.length === 0) {
    return null;
  }
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={`${column}-${index}`} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr key={`${row[0] ?? ''}-${rowIndex}`}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
