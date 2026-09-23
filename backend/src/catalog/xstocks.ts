/**
 * xStocks discovery. Jupiter's token search returns at most 20 results per query, so the sync runs the
 * generic "xStock" query plus one query per ticker below (as "<TICKER>x"), then re-checks every known
 * xStocks mint directly by address. Tokens must carry Jupiter's `xstocks` tag.
 *
 * List maintained from the 21 Sep 2026 probe (docs/spikes/catalog-and-routing.md): every ticker here
 * resolved to an xstocks-tagged mint. Add new listings here; unknown ones are still picked up when they
 * rank in the generic query.
 */
export const XSTOCKS_TICKERS = `
AAPL ABBV ABT ACN AEIS AFRM ALLY AMAT AMBR AMD AMT AMZN ANET APP ARM ARMK ASML ASMPT AUR AVGO AZN BAC BARC
BATS BDWAP BITX BOCHK BRK.B CHD CHONG CLINS CLPHD CMCSA CMG COIN CPETC CPRT CPT CRCL CRM CRWD CRWV CSCO CVX
DDOG DFDV DHR DIS DJT DOCN DXCM EFX FCNCA FHN FIS FISV FN FNF FSML FTNT GAW GLD GME GOOGL GPN GS HD HON HOOD
HWM IBM IEMG IJR INTC IWM JNJ JPM KMB KO LIN LLOY LLY MA MCD MDT META MRK MRVL MSFT MSTR MU MVLL NET NFLX NKE
NOW NTAP NVDA NVO ONTO OPEN ORCL PAG PANW PCG PEG PEP PFE PFG PFGC PG PGR PKG PLTR PM PPLT PSBOC PYPL QCOM
QQQ RDDT RIVN SBAC SCHF SLV SMCI SNOW SPCX SPY STRC STZ SUOPT TBLL TMO TONX TQQQ TSLA TSM TTWO TW UBER UNH
UTHR V VCX VOO VTI VXUS WMT WRFHD XOM XYZ ZS ZTS
`.trim().split(/\s+/);

/** Funds and ETFs among xStocks (everything else is a public stock). */
export const XSTOCKS_ETFS = new Set(
  'SPY QQQ GLD TQQQ IWM VTI VOO IJR IEMG SCHF TBLL SLV VXUS BITX MVLL PPLT FSML VCX'.split(' '),
);

export const XSTOCK_TAG = 'xstocks';
