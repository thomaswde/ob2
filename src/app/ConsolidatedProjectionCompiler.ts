import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type EntitySummarySourceAtom,
  type LanguageModel,
} from "../domain/languageModel.js";
import {
  LIFE_STATE_MAX_BYTES,
  PROJECTION_INDEX_LIMIT,
} from "../domain/constants.js";
import type { Repository } from "../domain/repository.js";
import type { EntityWithCategory, MemoryAtom } from "../domain/types.js";

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function yamlEscape(value: string): string {
  return JSON.stringify(value);
}

function buildLifeState(groups: Map<string, MemoryAtom[]>): string {
  const sections: string[] = [];
  for (const [category, atoms] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    sections.push(`## ${category}`);
    for (const atom of atoms) {
      sections.push(`- ${atom.content} [source: ${atom.id}]`);
    }
    sections.push("");
  }

  let content = sections.join("\n").trim();
  while (Buffer.byteLength(content, "utf8") > LIFE_STATE_MAX_BYTES) {
    const lines = content.split("\n");
    const lastBulletIndex = [...lines]
      .map((line, index) => ({ line, index }))
      .filter((item) => item.line.startsWith("- "))
      .pop()?.index;

    if (lastBulletIndex === undefined) {
      break;
    }

    lines.splice(lastBulletIndex, 1);
    content = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  return content;
}

function formatSourceAtoms(atoms: MemoryAtom[]): EntitySummarySourceAtom[] {
  return atoms.map((atom) => ({
    id: atom.id,
    content: atom.content,
    sourceRef: atom.sourceRef,
  }));
}

export interface ConsolidatedProjectionCompilerHooks {
  beforeSwap?: () => Promise<void>;
}

export class ConsolidatedProjectionCompiler {
  constructor(
    private readonly repository: Repository,
    private readonly languageModel: LanguageModel,
    private readonly rootDir = process.cwd(),
    private readonly hooks: ConsolidatedProjectionCompilerHooks = {},
  ) {}

  private get memoryDir(): string {
    return path.join(this.rootDir, "memory");
  }

  private get tempDir(): string {
    return path.join(this.rootDir, "memory.tmp");
  }

  private async writeEntityFile(baseDir: string, entity: EntityWithCategory, atoms: MemoryAtom[]): Promise<string> {
    const synthesis = await this.languageModel.synthesizeEntitySummary({
      entitySlug: entity.slug,
      entityName: entity.name,
      entityType: entity.type,
      atoms: formatSourceAtoms(atoms),
      existingSummary: null,
    });

    const categorySlug = entity.categorySlug ?? "uncategorized";
    const entityDir = path.join(baseDir, "entities", categorySlug);
    await mkdir(entityDir, { recursive: true });

    const body = [
      "---",
      `name: ${yamlEscape(entity.name)}`,
      `slug: ${yamlEscape(entity.slug)}`,
      `type: ${yamlEscape(entity.type)}`,
      `category: ${yamlEscape(categorySlug)}`,
      `entity_id: ${yamlEscape(entity.id)}`,
      "---",
      "",
      synthesis.summary,
      "",
      "## Source Atoms",
      ...atoms.map((atom) => `- ${atom.content} [source: ${atom.id}]`),
      "",
    ].join("\n");

    await writeFile(path.join(entityDir, `${entity.slug}.md`), body, "utf8");
    return truncate(synthesis.summary.replace(/\s+/g, " ").trim(), 100);
  }

  async compile(): Promise<{ outputPath: string; filesWritten: number }> {
    const entities = (await this.repository.listNonCategoryEntitiesWithCategory()).slice(0, PROJECTION_INDEX_LIMIT);
    const allEntities = await this.repository.listEntities();
    const lifeStateAtoms = await this.repository.listLifeStateAtoms();
    const entityById = new Map(allEntities.map((entity) => [entity.id, entity]));
    const categoryById = new Map(
      allEntities.filter((entity) => entity.type === "category").map((entity) => [entity.id, entity]),
    );

    await rm(this.tempDir, { recursive: true, force: true });
    await mkdir(path.join(this.tempDir, "entities"), { recursive: true });

    const indexLines: string[] = [];
    let filesWritten = 0;

    for (const entity of entities) {
      const atoms = await this.repository.listValidAtomsForEntity(entity.id);
      const summary = await this.writeEntityFile(this.tempDir, entity, atoms);
      const categorySlug = entity.categorySlug ?? "uncategorized";
      indexLines.push(`- [${entity.name}](entities/${categorySlug}/${entity.slug}.md) — ${summary}`);
      filesWritten += 1;
    }

    await writeFile(path.join(this.tempDir, "index.md"), `${indexLines.join("\n")}\n`, "utf8");
    filesWritten += 1;

    const lifeStateGroups = new Map<string, MemoryAtom[]>();
    for (const atom of lifeStateAtoms) {
      const entity = atom.entityId ? entityById.get(atom.entityId) ?? null : null;
      const category = entity?.parentEntityId ? categoryById.get(entity.parentEntityId) ?? null : null;
      const groupName = category?.name ?? entity?.name ?? "uncategorized";
      const existing = lifeStateGroups.get(groupName) ?? [];
      existing.push(atom);
      lifeStateGroups.set(groupName, existing);
    }

    await writeFile(path.join(this.tempDir, "life_state.md"), `${buildLifeState(lifeStateGroups)}\n`, "utf8");
    filesWritten += 1;

    const backupDir = `${this.memoryDir}.bak`;
    await rm(backupDir, { recursive: true, force: true });
    let hadPreviousProjection = false;
    try {
      await stat(this.memoryDir);
      await rename(this.memoryDir, backupDir);
      hadPreviousProjection = true;
    } catch {
      // No previous projection tree.
    }

    try {
      if (this.hooks.beforeSwap) {
        await this.hooks.beforeSwap();
      }
      await rename(this.tempDir, this.memoryDir);
      await rm(backupDir, { recursive: true, force: true });
    } catch (error) {
      if (hadPreviousProjection) {
        await rm(this.memoryDir, { recursive: true, force: true });
        await rename(backupDir, this.memoryDir);
      }
      throw error;
    }

    return {
      outputPath: this.memoryDir,
      filesWritten,
    };
  }
}
