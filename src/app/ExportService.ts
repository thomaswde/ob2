import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Repository } from "../domain/repository.js";
import type { ExportManifest, ExportResult } from "../domain/types.js";

export class ExportService {
  constructor(
    private readonly repository: Repository,
    private readonly rootDir = process.cwd(),
  ) {}

  private get exportsDir(): string {
    return path.join(this.rootDir, "exports");
  }

  private get memoryDir(): string {
    return path.join(this.rootDir, "memory");
  }

  private async readSchemaVersion(): Promise<string> {
    try {
      return (await readFile(path.join(this.rootDir, "sql", "migrations", "003_phase4_transport_ops.sql"), "utf8"))
        ? "003_phase4_transport_ops.sql"
        : "unknown";
    } catch {
      return "unknown";
    }
  }

  async export(): Promise<ExportResult> {
    const [entities, atoms, entityLinks, consolidationRuns, correctionActions, reviewItems, systemState, schemaVersion] =
      await Promise.all([
        this.repository.listEntities(),
        this.repository.listAllMemoryAtoms(),
        this.repository.listEntityLinks(),
        this.repository.listConsolidationRuns(10_000),
        this.repository.listCorrectionActions(),
        this.repository.listReviewItems(),
        this.repository.getSystemState(),
        this.readSchemaVersion(),
      ]);

    const generatedAt = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = path.join(this.exportsDir, `export-${generatedAt}`);
    const manifest: ExportManifest = {
      generatedAt: new Date().toISOString(),
      schemaVersion,
      entityCount: entities.length,
      atomCount: atoms.length,
      entityLinkCount: entityLinks.length,
      consolidationRunCount: consolidationRuns.length,
      correctionActionCount: correctionActions.length,
      reviewItemCount: reviewItems.length,
    };

    await rm(outputPath, { recursive: true, force: true });
    await mkdir(outputPath, { recursive: true });

    await writeFile(
      path.join(outputPath, "README.md"),
      [
        "# Open Brain 2 Export",
        "",
        `Generated at: ${manifest.generatedAt}`,
        `Schema version: ${manifest.schemaVersion}`,
        "",
        "Contents:",
        "- `manifest.json`: export summary metadata",
        "- `database.json`: portable JSON export of the core tables",
        "- `memory/`: derived markdown projection when available",
        "",
      ].join("\n"),
      "utf8",
    );

    await writeFile(path.join(outputPath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(
      path.join(outputPath, "database.json"),
      `${JSON.stringify(
        {
          exportedAt: manifest.generatedAt,
          schemaVersion: manifest.schemaVersion,
          systemState,
          entities,
          memoryAtoms: atoms,
          entityLinks,
          consolidationRuns,
          correctionActions,
          reviewItems,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    try {
      await stat(this.memoryDir);
      await cp(this.memoryDir, path.join(outputPath, "memory"), { recursive: true });
    } catch {
      // Export remains valid without a projection tree.
    }

    return {
      outputPath,
      manifest,
    };
  }
}
