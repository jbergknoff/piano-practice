// Minimal ambient types for the (untyped) subset-font package, scoped to the
// glyph-font generator script.
declare module "subset-font" {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: {
      targetFormat?: "woff2" | "woff" | "truetype" | "sfnt";
    },
  ): Promise<Buffer>;
}
