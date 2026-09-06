import { openDatabaseAsync } from 'expo-sqlite';
import { createRepository } from '../core/repository';
import { diagnostic } from './diagnostics';

export async function openRepository() {
  diagnostic('db.open.begin');
  const db = await openDatabaseAsync('streammark.db');
  diagnostic('db.open.complete');
  const repository = createRepository(db, diagnostic);
  await repository.init();
  return repository;
}
