import { exportCsv } from '../utils/exportCsv';

export default function ExportCsvButton({ filename, headers, rows, disabled = false }) {
  const handleExport = () => {
    if (!rows?.length) return;
    exportCsv(filename, headers, rows);
  };

  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      onClick={handleExport}
      disabled={disabled || !rows?.length}
    >
      Export CSV
    </button>
  );
}
