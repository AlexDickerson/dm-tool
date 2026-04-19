import { describe, expect, it } from 'vitest';
import { cleanFoundryMarkup } from './foundry-markup';

describe('cleanFoundryMarkup — passthrough', () => {
  it('returns plain text unchanged except for trimming', () => {
    expect(cleanFoundryMarkup('no markup here')).toBe('no markup here');
  });

  it('returns the empty string for empty input', () => {
    expect(cleanFoundryMarkup('')).toBe('');
  });

  it('trims leading/trailing whitespace', () => {
    expect(cleanFoundryMarkup('  spaced out  ')).toBe('spaced out');
  });

  it('collapses runs of 2+ spaces into one', () => {
    expect(cleanFoundryMarkup('word    another')).toBe('word another');
  });
});

describe('cleanFoundryMarkup — @Localize', () => {
  it('strips @Localize[KEY] entirely', () => {
    expect(cleanFoundryMarkup('before @Localize[PF2E.Something] after')).toBe('before after');
  });

  it('handles multiple @Localize tags in one string', () => {
    expect(cleanFoundryMarkup('@Localize[A] middle @Localize[B]')).toBe('middle');
  });
});

describe('cleanFoundryMarkup — @Template', () => {
  it('renders @Template[type:burst|distance:20] as "20-foot burst"', () => {
    expect(cleanFoundryMarkup('@Template[type:burst|distance:20] around')).toBe('20-foot burst around');
  });

  it('accepts @Template without the "type:" prefix', () => {
    expect(cleanFoundryMarkup('@Template[cone|distance:30]')).toBe('30-foot cone');
  });
});

describe('cleanFoundryMarkup — @Damage', () => {
  it('renders @Damage[(formula)[type]] as "formula type"', () => {
    expect(cleanFoundryMarkup('@Damage[(2d6+4)[slashing]]')).toBe('2d6+4 slashing');
  });

  it('replaces a single comma between types with a space', () => {
    expect(cleanFoundryMarkup('@Damage[(2d6)[fire,bludgeoning]]')).toBe('2d6 fire bludgeoning');
  });

  it('renders @Damage[formula[type]] (no parens)', () => {
    expect(cleanFoundryMarkup('@Damage[2d8[piercing]]')).toBe('2d8 piercing');
  });

  it('tolerates trailing options like |rollOptions', () => {
    expect(cleanFoundryMarkup('@Damage[(1d6)[cold]|options:something]')).toBe('1d6 cold');
  });
});

describe('cleanFoundryMarkup — @Check', () => {
  it('renders a basic check as "DC N basic type"', () => {
    expect(cleanFoundryMarkup('@Check[reflex|dc:22|basic]')).toBe('DC 22 basic reflex');
  });

  it('renders a non-basic check as "DC N type"', () => {
    expect(cleanFoundryMarkup('@Check[fortitude|dc:18]')).toBe('DC 18 fortitude');
  });

  it('tolerates extra options after the basic flag', () => {
    expect(cleanFoundryMarkup('@Check[will|dc:20|basic|traits:arcane]')).toBe('DC 20 basic will');
  });
});

describe('cleanFoundryMarkup — inline rolls', () => {
  it('renders [[/r ...]]{display} as the display text', () => {
    expect(cleanFoundryMarkup('deals [[/r 2d6]]{2d6} damage')).toBe('deals 2d6 damage');
  });

  it('renders [[/gmr ...]]{display} as the display text', () => {
    expect(cleanFoundryMarkup('[[/gmr 1d20+5]]{+5 attack}')).toBe('+5 attack');
  });
});

describe('cleanFoundryMarkup — @UUID', () => {
  it('renders @UUID[...]{display} as the display text', () => {
    expect(cleanFoundryMarkup('see @UUID[Compendium.pf2e.spells.Item.xyz]{Fireball}')).toBe('see Fireball');
  });

  it('strips @UUID[...] without a display block', () => {
    expect(cleanFoundryMarkup('see @UUID[Compendium.pf2e.spells.Item.xyz]')).toBe('see');
  });
});

describe('cleanFoundryMarkup — generic @Tag fallback', () => {
  it('renders @Foo[...]{display} as the display text', () => {
    expect(cleanFoundryMarkup('has @Action[Strike]{Strike} trait')).toBe('has Strike trait');
  });

  it('strips @Foo[...] without a display block', () => {
    expect(cleanFoundryMarkup('has @Action[Strike] trait')).toBe('has trait');
  });
});

describe('cleanFoundryMarkup — combined patterns', () => {
  it('handles multiple tag types interleaved in a single string', () => {
    const raw =
      'The target takes @Damage[(6d6)[fire]] damage and must succeed at a @Check[reflex|dc:25|basic] save. See @UUID[Compendium.pf2e.rules.xyz]{the rules} for details.';
    expect(cleanFoundryMarkup(raw)).toBe(
      'The target takes 6d6 fire damage and must succeed at a DC 25 basic reflex save. See the rules for details.',
    );
  });

  it('strips @Localize and leaves surrounding text clean', () => {
    const raw = 'Cast @Localize[PF2E.SpellName] at level @Localize[PF2E.SpellLevel].';
    expect(cleanFoundryMarkup(raw)).toBe('Cast at level .');
  });
});
