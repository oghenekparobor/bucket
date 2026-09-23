import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChainGateway } from '../src/chain/gateway.js';
import type { Db } from '../src/db/pool.js';
import { pushPrices } from '../src/prices/pricePusher.js';
import { freshDb } from './helpers/db.js';

const PSPACEX = 'PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh';
const MOCK = 'MockSpaceX111111111111111111111111111111111';
let db: Db;

beforeAll(async () => {
  db = await freshDb();
  // mainnet SpaceX PreStocks: ×5 scaled-UI multiplier, so raw price = 5 × UI price
  await db.query(
    `INSERT INTO assets (mint, ticker, name, source, asset_type, decimals, price_e6, ui_price_e6, ui_multiplier, source_payload)
     VALUES ($1, 'pSPACEX', 'SpaceX', 'PreStocks', 'pre_ipo', 9, 583270000, 116654000, 5, '{}')`,
    [PSPACEX],
  );
  await db.query(
    `INSERT INTO assets (mint, ticker, name, source, asset_type, decimals, program_listed, program_enabled, mirror_of)
     VALUES ($1, 'pSPACEX', 'pSPACEX', 'PreStocks', 'pre_ipo', 9, true, true, $2)`,
    [MOCK, PSPACEX],
  );
});
afterAll(() => db.end());

describe('price pusher', () => {
  it('prices a devnet mock at the UI price of the token it mirrors (mocks have no scaled-UI multiplier)', async () => {
    const pushed: { mint: string; priceE6: bigint }[] = [];
    const gateway = {
      listProgramAssets: async () => [],
      pushPrices: async (u: { mint: string; priceE6: bigint }[]) => {
        pushed.push(...u);
        return ['sig'];
      },
    } as unknown as ChainGateway;
    await pushPrices(db, gateway, null);
    expect(pushed).toEqual([{ mint: MOCK, priceE6: 116_654_000n }]);
  });
});
