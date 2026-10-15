export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours === 0 && minutes === 0) {
    return `${remainingSeconds}s`;
  }

  if (hours === 0) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}
