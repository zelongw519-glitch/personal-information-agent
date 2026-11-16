import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openLocalDatabase(filename) {
  mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);

  try {
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec('BEGIN IMMEDIATE');
    const { user_version: version } = database.prepare('PRAGMA user_version').get();
    const journal = JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json', import.meta.url), 'utf8'));

    for (const migration of journal.entries) {
      if (migration.idx < version) continue;
      const sql = readFileSync(new URL('./drizzle/' + migration.tag + '.sql', import.meta.url), 'utf8');
      database.exec(sql);
      database.exec('PRAGMA user_version = ' + (migration.idx + 1));
    }
    database.exec('COMMIT');
  } catch (error) {
    database.close();
    throw error;
  }

  // Match the D1 methods used by the shared Worker.
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          return {
            all: () => ({ results: statement.all(...values) }),
            first: () => statement.get(...values),
            run: () => ({ meta: statement.run(...values) }),
          };
        },
      };
    },
    close: () => database.close(),
  };
}
