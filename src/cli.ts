import { Durability, MemoryType, SourceType } from './domain.js';
import { InMemoryRepository } from './repository.js';
import { MemoryServices } from './services.js';

const service = new MemoryServices(new InMemoryRepository());
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'capture-memory') {
  const content = rest[0] ?? '';
  const entityHint = rest[1] ?? null;
  const out = service.captureMemory({
    content,
    memory_type: MemoryType.FACT,
    durability: Durability.LONG_TERM,
    importance: 0.5,
    confidence: 0.9,
    valid_at: new Date().toISOString(),
    entity_hint: entityHint,
    source_type: SourceType.USER,
    source_ref: 'cli',
    captured_by: 'cli'
  });
  console.log(JSON.stringify(out));
} else if (cmd === 'query-memory') {
  console.log(JSON.stringify(service.queryMemory({ query: rest[0] ?? '', context: 'cli' })));
} else if (cmd === 'run-consolidation') {
  console.log(JSON.stringify(service.runConsolidation()));
} else if (cmd === 'export') {
  console.log(JSON.stringify(service.export()));
} else {
  console.error('commands: capture-memory <content> [entity], query-memory <q>, run-consolidation, export');
  process.exit(1);
}
