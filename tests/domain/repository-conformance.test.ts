/**
 * Repository conformance: in-memory reference adapter.
 *
 * Runs the reusable P03 Task D conformance suite
 * (`tests/domain/support/repository-conformance.ts`) against the
 * in-memory reference adapter. P04 adopts the same runner for the
 * persistent adapter without copying these cases.
 */

import { InMemoryCheckpointStore } from './support/in-memory-checkpoint-store';
import { InMemoryFinanceRepository } from './support/in-memory-repository';
import { runRepositoryConformanceSuite, type ConformanceFixture } from './support/repository-conformance';

const fixture: ConformanceFixture = {
  name: 'in-memory reference adapter',
  createAdapter: () => new InMemoryFinanceRepository(),
  createCheckpointStore: () => new InMemoryCheckpointStore(),
};

runRepositoryConformanceSuite(fixture);
