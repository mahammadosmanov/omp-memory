import { parse, stringify } from "yaml";
import { MEMORY_TYPES, type MemoryRecord, type MemoryStatus, type MemoryProvenance } from "./types";

const fields = new Set(["id", "type", "createdAt", "updatedAt", "provenance", "confidence", "status"]);
const idPattern = /^mem_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(message: string): never { throw new Error(`Invalid memory note: ${message}`); }
function validDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }

export function parseMemoryNote(text: string): MemoryRecord {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) fail("missing YAML frontmatter");
  const meta = parse(match[1]!, { uniqueKeys: true });
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) fail("frontmatter must be a mapping");
  for (const key of Object.keys(meta)) if (!fields.has(key)) fail(`unsupported field ${key}`);
  const { id, type, createdAt, updatedAt, provenance, confidence, status } = meta as Record<string, unknown>;
  if (typeof id !== "string" || !idPattern.test(id)) fail("invalid id");
  if (!MEMORY_TYPES.includes(type as (typeof MEMORY_TYPES)[number])) fail("invalid type");
  if (!validDate(createdAt) || !validDate(updatedAt)) fail("invalid timestamp");
  if (provenance !== "explicit" && provenance !== "inferred") fail("invalid provenance");
  if (confidence !== undefined && (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) fail("invalid confidence");
  if (status !== undefined && status !== "active" && status !== "superseded") fail("invalid status");
  const content = match[2]!.trim();
  if (!content) fail("content is required");
  return { id, type: type as MemoryRecord["type"], createdAt, updatedAt, provenance: provenance as MemoryProvenance, ...(confidence === undefined ? {} : { confidence: confidence as number }), ...(status === undefined ? {} : { status: status as MemoryStatus }), content };
}

export function serializeMemoryNote(record: MemoryRecord): string {
  const metadata: Record<string, unknown> = { id: record.id, type: record.type, createdAt: record.createdAt, updatedAt: record.updatedAt, provenance: record.provenance };
  if (record.confidence !== undefined) metadata.confidence = record.confidence;
  if (record.status !== undefined) metadata.status = record.status;
  const text = `---\n${stringify(metadata, { lineWidth: 0 }).trimEnd()}\n---\n\n${record.content.trim()}\n`;
  parseMemoryNote(text);
  return text;
}
