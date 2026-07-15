// ============================================================
//  Manifest 运行时校验（Zod，与 JSON Schema 同源）
//  安全红线：additionalProperties:false（strict），无 code/script/eval 字段。
// ============================================================
import { z } from 'zod';
import type { Manifest, EventType, Permission, AssetKind, EventRule, RuleFile } from './schema';

export const modTypeSchema = z.enum(['card', 'rule', 'worldbook', 'bundle']);

export const permissionSchema = z.enum([
  'read_world_state',
  'modify_world_state',
  'add_card',
  'override_card',
  'register_tick',
  'emit_world_event',
  'provide_assets',
]);

export const assetKindSchema = z.enum(['image', 'text', 'data', 'audio']);

const ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const manifestSchema = z
  .object({
    id: z.string().regex(ID_RE, 'id 需匹配 ^[a-z0-9][a-z0-9_-]{2,63}$'),
    name: z.string().min(1).max(80),
    version: z.string().regex(SEMVER_RE, 'version 需为 x.y.z'),
    author: z.string().min(1).max(60),
    description: z.string().max(500).optional(),
    homepage: z.string().url().nullable().optional(),
    engine: z.literal('opt-event'),
    schemaVersion: z.number().int().min(1),
    minAppVersion: z.string().regex(SEMVER_RE),
    type: modTypeSchema,
    coverColor: z.string().regex(HEX_RE, 'coverColor 需为六位 hex 实色块（禁止渐变）'),
    icon: z.string().min(1).max(48),
    enabledByDefault: z.boolean().optional().default(false),
    loadOrder: z.number().int().optional().default(100),
    dependencies: z.array(z.string().regex(ID_RE)).optional().default([]),
    conflicts: z.array(z.string().regex(ID_RE)).optional().default([]),
    permissions: z.array(permissionSchema).optional().default([]),
    rules: z.array(z.string()).optional(),
    cards: z.array(z.string()).optional(),
    assets: z
      .array(z.object({ path: z.string(), kind: assetKindSchema, size: z.number().int().min(0) }))
      .optional()
      .default([]),
    checksum: z
      .object({ manifest: z.string(), assets: z.record(z.string(), z.string()) })
      .optional(),
    signature: z.string().nullable().optional(),
  })
  // 安全红线①：拒绝未知字段（含 code/script/eval）
  .strict();

export type ManifestInput = z.input<typeof manifestSchema>;

export function parseManifest(input: unknown): { ok: boolean; data?: Manifest; issues: string[] } {
  const res = manifestSchema.safeParse(input);
  if (res.success) {
    return { ok: true, data: res.data as Manifest, issues: [] };
  }
  return {
    ok: false,
    issues: res.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

// ─── 规则文件（rules.json）校验 ───
export const ruleFileSchema = z.object({
  version: z.number().int().min(1),
  rules: z.array(z.any()).max(128),
});

export function parseRuleFile(input: unknown): { ok: boolean; data?: RuleFile; issues: string[] } {
  const res = ruleFileSchema.safeParse(input);
  if (res.success) {
    return { ok: true, data: res.data as unknown as RuleFile, issues: [] };
  }
  return { ok: false, issues: res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

export type { EventType, Permission, AssetKind, EventRule };
