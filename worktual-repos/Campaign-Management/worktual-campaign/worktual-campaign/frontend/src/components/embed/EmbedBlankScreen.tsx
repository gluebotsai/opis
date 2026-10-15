/** CRM embed — blank #f3f4f6 while auth/content loads (no skeleton chrome). */
export function EmbedBlankScreen() {
  return (
    <div
      className="min-h-svh bg-[#f3f4f6]"
      aria-busy="true"
      aria-label="Loading"
    />
  );
}
