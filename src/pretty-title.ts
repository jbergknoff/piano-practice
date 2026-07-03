export function prettyTitle(filename: string): string {
  return filename
    .replace(/\.(mid|midi|musicxml|xml|mxl)$/i, "")
    .replace(/[-_]/g, " ");
}
