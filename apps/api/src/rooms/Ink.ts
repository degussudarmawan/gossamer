import { z } from 'zod';

// Versioned pen coordinates, not executable SVG or an uploaded image.
export const inkSchema = z.object({
  v: z.literal(1),
  lines: z.number().int().min(1).max(3),
  width: z.number().int().min(100).max(2000),
  strokes: z.array(z.array(z.number().int().min(0).max(2000)).min(2).max(2000)
    .refine((stroke) => stroke.length % 2 === 0)).min(1).max(400),
}).strict().superRefine((ink, ctx) => {
  let total = 0;
  for (const stroke of ink.strokes) {
    total += stroke.length;
    for (let i = 0; i < stroke.length; i += 2) {
      if (stroke[i]! > ink.width || stroke[i + 1]! > ink.lines * 100) {
        ctx.addIssue({ code: 'custom', message: 'outside the pad' });
        return;
      }
    }
  }
  if (total > 8000) ctx.addIssue({ code: 'custom', message: 'too much ink' });
});

export type Ink = z.infer<typeof inkSchema>;

// JSONB may reorder object keys. Stroke order and coordinate order are meaningful.
export function sameInk(a: Ink | null | undefined, b: Ink | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return a.v === b.v && a.lines === b.lines && a.width === b.width
    && JSON.stringify(a.strokes) === JSON.stringify(b.strokes);
}

export const messageSchema = z.object({
  body: z.string().trim().min(1).max(2000).optional(),
  ink: inkSchema.optional(),
  signature: z.string().trim().min(1).max(80).optional(),
  requestId: z.uuid(),
}).strict().refine((message) => message.body !== undefined || message.ink !== undefined)
  .transform((message) => ({ ...message, body: message.body ?? '' }));
