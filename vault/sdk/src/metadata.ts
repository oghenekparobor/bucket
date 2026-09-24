/**
 * Token metadata helpers, mirroring `instructions/metadata.rs` in the program.
 *
 * The program derives the name and ticker on chain from the bucket's name; these copies let the
 * backend show or serve the same values without reading the metadata account back. The Rust unit
 * test and `test/metadata.test.ts` share one list of cases, so a change to either side shows up.
 */

/** Metaplex's own limits on `DataV2`. */
export const MAX_METADATA_NAME = 32;
export const MAX_METADATA_SYMBOL = 10;
export const MAX_METADATA_URI = 200;

const encoder = new TextEncoder();

/**
 * A bucket has a name but no ticker, so one is derived: the name's letters and digits, uppercased,
 * cut to 10 characters. "Tokenized SP500" becomes TOKENIZEDS. A name with nothing alphanumeric in it
 * falls back to BUCKET rather than an empty symbol.
 */
export function deriveSymbol(name: string): string {
  const s = [...name]
    .filter((c) => /[A-Za-z0-9]/.test(c))
    .slice(0, MAX_METADATA_SYMBOL)
    .join('')
    .toUpperCase();
  return s || 'BUCKET';
}

/**
 * Cuts a name to Metaplex's 32 **bytes** without splitting a character. A bucket name may be 48
 * bytes (`MAX_NAME_LEN` in the program), and Metaplex counts bytes, not characters.
 */
export function truncateName(name: string, max = MAX_METADATA_NAME): string {
  if (encoder.encode(name).length <= max) return name;
  let out = '';
  for (const ch of name) {
    if (encoder.encode(out + ch).length > max) break;
    out += ch;
  }
  return out;
}
