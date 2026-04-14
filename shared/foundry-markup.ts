/**
 * Strip Foundry VTT enriched-text markup into readable plain text.
 *
 * Handles @Damage, @Check, @Template, @Localize, @UUID, inline rolls,
 * and any other @Tag[...]{display} patterns. Does NOT strip HTML — use
 * this as a first pass before any HTML-to-text conversion.
 *
 * Shared between the Electron main process (pf2e-db.ts) and the
 * renderer (MonsterDetailPane, ItemDetailPane).
 */
export function cleanFoundryMarkup(text: string): string {
  return (
    text
      // @Localize[KEY] → strip
      .replace(/@Localize\[[^\]]*\]/g, '')
      // @Template[type:T|distance:N] or @Template[T|distance:N] → "N-foot T"
      .replace(/@Template\[(?:type:)?(\w+)\|distance:(\d+)\]/g, '$2-foot $1')
      // @Damage[(formula)[type,type]|...] → "formula type"
      .replace(
        /@Damage\[\(([^)]+)\)\[([^\]]+)\][^\]]*\]/g,
        (_, formula: string, types: string) => `${formula} ${types.replace(',', ' ')}`,
      )
      // @Damage[formula[type,type]|...] → "formula type"
      .replace(
        /@Damage\[([^[\]]+)\[([^\]]+)\][^\]]*\]/g,
        (_, formula: string, types: string) => `${formula} ${types.replace(',', ' ')}`,
      )
      // @Check[type|dc:N|basic|...] → "DC N basic type"
      .replace(/@Check\[(\w+)\|dc:(\d+)\|basic[^\]]*\]/g, (_, type: string, dc: string) => `DC ${dc} basic ${type}`)
      // @Check[type|dc:N|...] → "DC N type"
      .replace(/@Check\[(\w+)\|dc:(\d+)[^\]]*\]/g, (_, type: string, dc: string) => `DC ${dc} ${type}`)
      // [[/gmr ...]]{display} or [[/r ...]]{display} → display
      .replace(/\[\[\/[^\]]*\]\]\{([^}]+)\}/g, '$1')
      // @UUID[...]{display} → display
      .replace(/@UUID\[[^\]]*\]\{([^}]+)\}/g, '$1')
      // @UUID[...] without display → strip
      .replace(/@UUID\[[^\]]*\]/g, '')
      // Any remaining @Foo[...]{display} → display
      .replace(/@\w+\[[^\]]*\]\{([^}]+)\}/g, '$1')
      // Any remaining @Foo[...] → strip
      .replace(/@\w+\[[^\]]*\]/g, '')
      // Collapse multiple spaces
      .replace(/ {2,}/g, ' ')
      .trim()
  );
}
