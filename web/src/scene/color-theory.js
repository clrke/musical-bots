// The cast and the backdrops share one colour theory (cast16.js FRIENDLY, the friendly look):
// one soft OKLCH band (L 0.40-0.95: pastel, nothing neon), each colour still its name, night as
// a soft navy and charcoal instead of near-black, party pinks as the cast's own pink/red, whites
// as the cast's warm white (White) or cool white (winter snow). Pure (no three.js): sets.js and
// stage.js take their colours from here, and test-backdrop.mjs checks them with its own maths.
export const FRIENDLY_BAND = Object.freeze({ L_MIN: 0.4, L_MAX: 0.95, C_MAX: 0.16 });

/** Warm and cool whites in the band (White's face; winter snow). */
export const FRIENDLY_WHITE_WARM = '#f3eee3';
export const FRIENDLY_WHITE_COOL = '#e8eef6';
/**
 * The lights' warm white (the bright end of the band): paints take White's face, but a light
 * tinted with it would dim the heads' warm reflections past test-head-light's level (linear red
 * 0.896 -> 0.943); this keeps the level (0.952) while staying in the band (L 0.947).
 */
export const FRIENDLY_LIGHT_WARM = '#f5ece1';

/** The darkest friendly tones (Black's charcoal; a dark navy at the band's floor). */
export const FRIENDLY_CHARCOAL = '#46484f';
export const FRIENDLY_NIGHT = '#3d4a75';
