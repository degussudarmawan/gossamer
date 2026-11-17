/**
 * Measures how wide a piece of text is in a given font, using an off-screen
 * canvas. The font must have finished loading (see useFontReady), or the
 * browser measures its fallback font instead.
 */
export class TextRuler {
  private ctx: CanvasRenderingContext2D | null | undefined;

  constructor(
    private readonly family: string,
    private readonly weight = 400,
  ) {}

  /** Width in ems: multiply by a font size in pixels to get pixels. */
  widthInEms(text: string): number {
    this.ctx ??= document.createElement('canvas').getContext('2d');
    // no canvas available: a rough average letter width keeps layouts usable
    if (!this.ctx) return text.length * 0.5;
    this.ctx.font = `${this.weight} 100px "${this.family}"`;
    return this.ctx.measureText(text).width / 100;
  }
}
