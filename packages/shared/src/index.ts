import { z } from "zod";

export const CONTRACT_VERSION = 1;

export const BoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type Box = z.infer<typeof BoxSchema>;

export const ElementTypeSchema = z.enum([
  "figure", "chart", "image", "link", "text", "chart_part",
]);
export type ElementType = z.infer<typeof ElementTypeSchema>;

export const ElementSourceSchema = z.enum(["pptx", "pdf", "model", "user"]);
export type ElementSource = z.infer<typeof ElementSourceSchema>;

export const ElementSchema = z.object({
  id: z.string().min(1),
  type: ElementTypeSchema,
  label: z.string().min(1),
  box: BoxSchema,
  aliases: z.array(z.string()).default([]),
  url: z.string().nullable().default(null),
  parentId: z.string().nullable().default(null),
  source: ElementSourceSchema,
});
export type SlideElement = z.infer<typeof ElementSchema>;

export const KeyPointSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  weight: z.number().positive().default(1),
});
export type KeyPoint = z.infer<typeof KeyPointSchema>;

export const SlideSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().min(0),
  imageUrl: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  title: z.string(),
  notes: z.string().default(""),
  summary: z.string().default(""),
  keyPoints: z.array(KeyPointSchema).default([]),
  nextCue: z.string().default(""),
  triggerPhrases: z.array(z.string()).default([]),
  elements: z.array(ElementSchema).max(12).default([]),
});
export type Slide = z.infer<typeof SlideSchema>;

export const DeckStatusSchema = z.enum(["processing", "review", "ready", "failed"]);
export type DeckStatus = z.infer<typeof DeckStatusSchema>;

export const DeckSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: DeckStatusSchema,
  slides: z.array(SlideSchema).default([]),
});
export type Deck = z.infer<typeof DeckSchema>;

export const IngestStepSchema = z.enum([
  "upload", "convert", "render", "extract", "vision", "narrative", "index",
]);
export type IngestStep = z.infer<typeof IngestStepSchema>;

export const IngestProgressSchema = z.object({
  deckId: z.string().min(1),
  status: DeckStatusSchema,
  steps: z.record(IngestStepSchema, z.enum(["pending", "running", "done", "failed", "skipped"])),
  error: z.string().nullable().default(null),
});
export type IngestProgress = z.infer<typeof IngestProgressSchema>;

export const ModeSchema = z.enum(["auto", "assist", "manual"]);
export type Mode = z.infer<typeof ModeSchema>;

export const EffectKindSchema = z.enum(["highlight", "zoom", "link"]);
export type EffectKind = z.infer<typeof EffectKindSchema>;

export const EffectSchema = z.object({
  id: z.string().min(1),
  kind: EffectKindSchema,
  elementId: z.string().min(1),
  startedAt: z.number().int(),
  expiresAt: z.number().int(),
});
export type Effect = z.infer<typeof EffectSchema>;

export const PendingActionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["highlight", "zoom", "open_link", "next"]),
  targetId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
}).nullable();
export type PendingAction = z.infer<typeof PendingActionSchema>;

export const SessionStateSchema = z.object({
  sessionId: z.string().min(1),
  deckId: z.string().min(1),
  slideIndex: z.number().int().min(0),
  mode: ModeSchema,
  paused: z.boolean(),
  holdForQuestions: z.boolean(),
  effects: z.array(EffectSchema).default([]),
  pending: PendingActionSchema.default(null),
  stateVersion: z.number().int().min(0),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SparkDecisionSchema = z.object({
  action: z.enum(["none", "highlight", "zoom", "open_link", "next"]),
  targetId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  coveredKeyPointIds: z.array(z.string()).default([]),
  reason: z.string(),
});
export type SparkDecision = z.infer<typeof SparkDecisionSchema>;

export const DecisionLogSchema = z.object({
  ts: z.number().int(),
  sessionId: z.string(),
  action: z.string(),
  targetId: z.string().nullable(),
  confidence: z.number(),
  reason: z.string(),
  path: z.enum(["fast", "semantic", "fusion", "manual"]),
  latencyMs: z.number().min(0),
  applied: z.boolean(),
});
export type DecisionLog = z.infer<typeof DecisionLogSchema>;

export const WsEnvelopeSchema = z.object({
  v: z.literal(CONTRACT_VERSION),
  type: z.string().min(1),
  seq: z.number().int().min(0),
  payload: z.record(z.unknown()),
});
export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;

export const JoinPayloadSchema = z.object({
  sessionId: z.string().min(1),
  role: z.enum(["audience", "presenter"]),
});
export type JoinPayload = z.infer<typeof JoinPayloadSchema>;

export const CmdNameSchema = z.enum([
  "next", "back", "goto", "undo", "pause", "resume", "setMode", "clearEffect", "hold",
]);
export type CmdName = z.infer<typeof CmdNameSchema>;

export const CmdPayloadSchema = z.object({
  name: CmdNameSchema,
  args: z.record(z.unknown()).optional().default({}),
});
export type CmdPayload = z.infer<typeof CmdPayloadSchema>;

export const TranscriptPayloadSchema = z.object({
  text: z.string(),
  final: z.boolean(),
  ts: z.number().int(),
});
export type TranscriptPayload = z.infer<typeof TranscriptPayloadSchema>;

export const HealthPayloadSchema = z.object({
  asrStatus: z.enum(["connected", "disconnected", "fallback", "unknown"]),
  modelLatencyP50Ms: z.number().nullable(),
  modelLatencyP95Ms: z.number().nullable(),
  fallbackInUse: z.boolean(),
});
export type HealthPayload = z.infer<typeof HealthPayloadSchema>;

export const ErrorPayloadSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  recoverable: z.boolean(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export function envelope(type: string, seq: number, payload: Record<string, unknown>): WsEnvelope {
  return { v: CONTRACT_VERSION, type, seq, payload };
}

/** Validate a Spark decision; unknown targetId or bad shape returns null (treated as none). */
export function parseSparkDecision(raw: unknown, validTargetIds: Set<string>): SparkDecision | null {
  const parsed = SparkDecisionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (d.targetId !== null && !validTargetIds.has(d.targetId)) return null;
  return d;
}
