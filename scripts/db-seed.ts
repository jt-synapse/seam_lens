import { closeDbPool, getDbPool } from '../src/lib/db';
import { seedSyntheticCatalog } from '../supabase/seed/synthetic-catalog';

async function main() {
  const pool = getDbPool();
  try {
    const counts = await seedSyntheticCatalog(pool);
    console.log('Seeded SeamLens synthetic catalog:', JSON.stringify(counts));
  } finally {
    await closeDbPool();
  }
}

main().catch((error) => {
  console.error('Failed to seed SeamLens synthetic catalog:', error);
  process.exitCode = 1;
});
