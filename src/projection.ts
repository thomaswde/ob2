import { InMemoryRepository } from './repository.js';
import { Durability } from './domain.js';

export class ProjectionBuilder {
  constructor(private readonly repo: InMemoryRepository) {}

  build(): Record<string, string> {
    const recent = this.repo.listRecentMemory();
    const index = ['# Index', ''];
    const life = ['# Life State', ''];
    const entityDocs = new Map<string, string[]>();

    for (const atom of recent) {
      const cite = `[source: ${atom.id}]`;
      index.push(`- ${atom.content} ${cite}`);
      if (atom.durability === Durability.LONG_TERM) life.push(`- ${atom.content} ${cite}`);
      if (atom.entity_id) {
        const entity = this.repo.entities.get(atom.entity_id);
        if (entity) {
          const slug = entity.name.trim().toLowerCase().replaceAll(' ', '-');
          if (!entityDocs.has(slug)) entityDocs.set(slug, [`# ${entity.name}`, '']);
          entityDocs.get(slug)!.push(`- ${atom.content} ${cite}`);
        }
      }
    }

    const out: Record<string, string> = {
      'index.md': index.join('\n'),
      'life_state.md': life.join('\n')
    };

    [...entityDocs.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([slug, lines]) => {
      out[`entities/${slug}.md`] = lines.join('\n');
    });

    return out;
  }
}
