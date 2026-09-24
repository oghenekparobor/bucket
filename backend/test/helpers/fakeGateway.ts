import type { ChainGateway, OpenOrder, ProgramAsset, RebalanceTrade } from '../../src/chain/gateway.js';

/** In-memory ChainGateway: records calls, returns canned transactions, can be told to fail. */
export class FakeGateway implements ChainGateway {
  calls: { method: string; args: unknown }[] = [];
  openOrders: OpenOrder[] = [];
  failing = new Set<string>();

  private rec<T>(method: string, args: unknown, value: T): Promise<T> {
    this.calls.push({ method, args });
    if (this.failing.has(method)) return Promise.reject(new Error(`${method} failed (fake)`));
    return Promise.resolve(value);
  }

  buildCreateBucketTxs(p: unknown) {
    return this.rec('buildCreateBucketTxs', p, {
      transactions: ['dHgx', 'dHgy'],
      bucket: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
      lookupTable: 'AddressLookupTab1e1111111111111111111111111',
      order: 'So11111111111111111111111111111111111111112',
      optional: [1],
    });
  }
  buildMintTx(p: unknown) {
    return this.rec('buildMintTx', p, { transaction: 'bWludA==', order: 'So11111111111111111111111111111111111111112' });
  }
  buildRedeemTx(p: unknown) {
    return this.rec('buildRedeemTx', p, { transaction: 'cmVkZWVt', order: 'So11111111111111111111111111111111111111112' });
  }
  buildCloseBucketTx(p: unknown) {
    return this.rec('buildCloseBucketTx', p, { transaction: 'Y2xvc2U=' });
  }
  buildUpdateInfoTx(p: unknown) {
    return this.rec('buildUpdateInfoTx', p, { transaction: 'aW5mbw==' });
  }
  buildProposeEditTx(p: unknown) {
    return this.rec('buildProposeEditTx', p, { transaction: 'ZWRpdA==' });
  }
  /** What inspectTransaction reports for any transaction (tests set it per case). */
  inspection = { sponsored: true, instructions: ['open_mint'] };
  inspectTransaction() {
    return this.inspection;
  }
  submit(tx: string, signer: string) {
    return this.rec('submit', { tx, signer }, '5igSig');
  }
  listProgramAssets() {
    return this.rec('listProgramAssets', null, [] as ProgramAsset[]);
  }
  fetchOpenOrders() {
    return this.rec('fetchOpenOrders', null, this.openOrders);
  }
  fillMintLeg(order: string, leg: number) {
    return this.rec('fillMintLeg', { order, leg }, 'sigFill');
  }
  closeMintOrder(order: string) {
    return this.rec('closeMintOrder', { order }, 'sigClose');
  }
  fillRedeemLeg(order: string, leg: number) {
    return this.rec('fillRedeemLeg', { order, leg }, 'sigFillRedeem');
  }
  closeRedeemOrder(order: string) {
    return this.rec('closeRedeemOrder', { order }, 'sigCloseRedeem');
  }
  settle(bucket: string) {
    return this.rec('settle', { bucket }, 'sigSettle');
  }
  activateEdit(bucket: string) {
    return this.rec('activateEdit', { bucket }, 'sigActivate');
  }
  rebalance(t: RebalanceTrade) {
    return this.rec('rebalance', t, 'sigRebalance');
  }
  pushPrices(updates: { mint: string; priceE6: bigint }[]) {
    return this.rec('pushPrices', updates, ['sigPrice']);
  }
  faucet(wallet: string, amountE6: bigint) {
    return this.rec('faucet', { wallet, amountE6 }, 'sigFaucet');
  }
  getWalletBalances(wallet: string) {
    return this.rec('getWalletBalances', { wallet }, { solLamports: 1_500_000_000n, usdcE6: 4_820_550_000n });
  }
}
