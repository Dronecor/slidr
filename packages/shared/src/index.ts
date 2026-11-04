import { z } from "zod";

export const PROTOCOL_V = 1;

// ---------- Geometry ----------
export const BoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type Box = z.infer<typeof BoxSchema>;

// ---------- Deck ----------
export const ElementTypeSchema = z.enum([
  "figure",
  "chart",
  "image",
  "link",
  "text",
  "chart_part",
]);
export type ElementType = z.infer<typeof ElementTypeSchema>;

export const ElementSourceSchema = z.enum(["pptx", "pdf", "model", "user"]);
export type ElementSource = z.infer<typeof ElementSourceSchema>;

export const ElementSchema = z.object({
  id: z.string(),
  type: ElementTypeSchema,
  label: z.string(),
  box: BoxSchema,
  aliases: z.array(z.string()).default([]),
  url: z.string().nullable().default(null),
  parentId: z.string().nullable().default(null),
  source: ElementSourceSchema,
});
export type DeckElement = z.infer<typeof ElementSchema>;

export const KeyPointSchema = z.object({
  id: z.string(),
  text: z.string(),
  weight: z.number().default(1),
});
export type KeyPoint = z.infer<typeof KeyPointSchema>;

export const SlideSchema = z.object({
  id: z.string(),
  index: z.number(),
  imageUrl: z.string(),
  width: z.number().default(1920),
  height: z.number().default(1080),
  title: z.string().default(""),
  notes: z.string().default(""),
  summary: z.string().default(""),
  keyPoints: z.array(KeyPointSchema).default([]),
  nextCue: z.string().default(""),
  triggerPhrases: z.array(z.string()).default([]),
  elements: z.array(ElementSchema).max(12).default([]),
});
export type Slide = z.infer<typeof SlideSchema>;

export const DeckStatusSchema = z.enum([
  "processing",
  "review",
  "ready",
  "failed",
]);
export type DeckStatus = z.infer<typeof DeckStatusSchema>;

export const DeckSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: DeckStatusSchema,
  slides: z.array(SlideSchema).default([]),
});
export type Deck = z.infer<typeof DeckSchema>;

export const IngestStepSchema = z.enum([
  "upload",
  "convert",
  "extract",
  "vision",
  "narrative",
  "index",
]);
export type IngestStep = z.infer<typeof IngestStepSchema>;

export const IngestProgressSchema = z.object({
  deckId: z.string(),
  step: IngestStepSchema,
  done: z.number(),
  total: z.number(),
  message: z.string().default(""),
});
export type IngestProgress = z.infer<typeof IngestProgressSchema>;

// ---------- Session state ----------
export const ModeSchema = z.enum(["auto", "assist", "manual"]);
export type Mode = z.infer<typeof ModeSchema>;

export const EffectKindSchema = z.enum(["highlight", "zoom", "link"]);
export type EffectKind = z.infer<typeof EffectKindSchema>;

export const EffectSchema = z.object({
  id: z.string(),
  kind: EffectKindSchema,
  elementId: z.string(),
  startedAt: z.number(),
  expiresAt: z.number(),
});
export type Effect = z.infer<typeof EffectSchema>;

export const PendingActionSchema = z.object({
  id: z.string(),
  action: z.string(),
  targetId: z.string().nullable(),
  confidence: z.number(),
  reason: z.string(),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;

export const SessionStateSchema = z.object({
  sessionId: z.string(),
  deckId: z.string(),
  slideIndex: z.number(),
  mode: ModeSchema,
  paused: z.boolean(),
  holdForQuestions: z.boolean(),
  effects: z.array(EffectSchema).default([]),
  pending: PendingActionSchema.nullable().default(null),
  stateVersion: z.number(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// ---------- WebSocket envelope ----------
export const WsTypeSchema = z.enum([
  "join",
  "audio.start",
  "audio.stop",
  "cmd",
  "suggestion.accept",
  "suggestion.dismiss",
  "state",
  "transcript",
  "decision",
  "health",
  "error",
]);
export type WsType = z.infer<typeof WsTypeSchema>;

export const WsEnvelopeSchema = z.object({
  v: z.number(),
  type: WsTypeSchema,
  seq: z.number(),
  payload: z.record(z.any()).default({}),
});
export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;

export const CmdNameSchema = z.enum([
  "next",
  "back",
  "goto",
  "undo",
  "pause",
  "resume",
  "setMode",
  "clearEffect",
  "hold",
]);
export type CmdName = z.infer<typeof CmdNameSchema>;

export const TranscriptPayloadSchema = z.object({
  text: z.string(),
  final: z.boolean(),
  ts: z.number(),
});
export type TranscriptPayload = z.infer<typeof TranscriptPayloadSchema>;

export const DecisionPayloadSchema = z.object({
  action: z.string(),
  target: z.string().nullable().default(null),
  confidence: z.number(),
  reason: z.string(),
  path: z.enum(["fast", "semantic", "fusion"]),
  latencyMs: z.number(),
  applied: z.boolean(),
});
export type DecisionPayload = z.infer<typeof DecisionPayloadSchema>;

export const HealthPayloadSchema = z.object({
  asr: z.string().default("unknown"),
  p50: z.number().default(0),
  p95: z.number().default(0),
  fallback: z.boolean().default(false),
});
export type HealthPayload = z.infer<typeof HealthPayloadSchema>;

export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().default(true),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

// ---------- Spark decision output ----------
export const SparkDecisionSchema = z.object({
  action: z.enum(["none", "highlight", "zoom", "open_link", "next"]),
  targetId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  coveredKeyPointIds: z.array(z.string()).default([]),
  reason: z.string(),
});
export type SparkDecision = z.infer<typeof SparkDecisionSchema>;

// ---------- Late-feature interfaces (documented as types) ----------
export interface LinkOpener {
  open(url: string): Promise<{ shown: boolean }>;
}
export interface ImageTargeter {
  locate(slideId: string, phrase: string): Promise<Box | null>;
}
