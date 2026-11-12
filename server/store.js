import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
} from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensure } from './schema.js';

export class Store {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(path.join(directory, 'files'), { recursive: true });
    this.file = path.join(directory, 'state.json');
    // Never replace an unreadable database with a fresh empty workspace.
    this.state = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, 'utf8'))
      : {
          version: 2,
          revision: 0,
          projects: [],
          groups: ['进行中', '已完成', '灵感草稿'],
          assets: {},
          tasks: [],
          trendLibrary: { groups: ['未分组'], items: [] },
          materialLibrary: { groups: ['未分组'], items: [] },
          memory: { enabled: true, entries: [] },
          outputDirectory: {
            path: '',
            enabled: false,
            lastSavedAt: null,
            lastSavedFile: null,
            lastError: null,
          },
          migrations: [],
        };
    ensure(
      [1, 2].includes(this.state.version) && Array.isArray(this.state.projects),
      '项目数据库格式不支持，请检查备份。',
    );
    if (this.state.version === 1 && existsSync(this.file)) {
      const backup = path.join(directory, 'state.v1.backup.json');
      if (!existsSync(backup)) copyFileSync(this.file, backup);
    }
  }
  read() {
    return structuredClone(this.state);
  }
  transaction(fn) {
    const next = this.read();
    const result = fn(next);
    next.revision += 1;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`);
    renameSync(temporary, this.file);
    this.state = next;
    return structuredClone(result ?? next);
  }
}
