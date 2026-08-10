// All gameplay geometry lives in normalised "field units": 1.0 = the reference play
// radius. Rendering multiplies by a screen scale at the very end. The old build tuned
// in pixels, which quietly made the game a different difficulty on every screen size.

export const CORE_R = 0.1;      // central polygon radius
export const PLAYER_R = 0.128;  // cursor orbit radius, just outside the core
export const SPAWN_R = 1.62;    // walls appear here, off-screen on every aspect ratio
export const DESPAWN_R = 0.055; // walls are recycled once fully swallowed

/** Player angular speed, rad/s. A half-lap takes ~0.42 s — the reference feel. */
export const PLAYER_SPEED = 7.45;

/** Wall approach speed at section speed 1.0, field units per second. */
export const BASE_WALL_SPEED = 1.0;

/**
 * Angular half-width of the cursor. The renderer draws the triangle from this exact
 * value, so what you see really is the hitbox — no hidden generosity, no hidden cruelty.
 */
export const PLAYER_HALF_W = 0.07;

/** Radial slack shaved off both faces of every wall before it can kill you. */
export const HIT_FORGIVE = 0.007;

/**
 * Where a run begins, in field space. Straight up, so the opening frame reads the
 * same on every polygon. The chart's fairness pass must start from this same angle
 * or its very first reachability check is measured from the wrong place.
 */
export const START_ANGLE = -Math.PI / 2;

// --- pulse ------------------------------------------------------------------
export const PULSE_DURATION = 0.26;   // intangible window
export const PULSE_SPEED_MUL = 2.75;  // angular speed multiplier while dashing
export const PULSE_COOLDOWN = 0.24;
export const PULSE_COST = 1.0;
export const PULSE_REFUND_ONBEAT = 0.68; // beat-locked pulses are nearly free
export const PULSE_MAX_CHARGE = 3.0;
export const BEAT_WINDOW = 0.13;      // ± seconds counted as "on the beat"

/**
 * THE RULE THE WHOLE GAME HANGS ON: an on-beat pulse is never refused, even at zero
 * charge. It just takes whatever is left.
 *
 * Walls arrive exactly on beats, so the moment you must be intangible IS a beat.
 * That makes every sealed ring survivable by a player who is listening, and turns the
 * meter into a reward for greed rather than a gate on survival. An off-beat pulse
 * still costs the full charge — that is the panic button, and it is rationed.
 */
export const ONBEAT_ALWAYS_ALLOWED = true;

/**
 * Charge trickles back to ONE pulse on its own. Everything above that must be
 * grazed for.
 *
 * Without this, a sealed ring can arrive while the meter reads 0.2 and the player
 * dies with no move available — a death they could not have avoided at the moment
 * they had to avoid it. That is the one kind of failure this genre cannot survive.
 * The regen guarantees an escape hatch; grazing is what buys the stack you need for
 * back-to-back seals, and the score multiplier that makes grazing worth it anyway.
 */
export const PULSE_REGEN = 0.22;      // per second, capped at 1.0 charge

// --- graze ------------------------------------------------------------------
/** Angular distance from a wall edge that counts as a graze. */
export const GRAZE_WINDOW = 0.2;
export const GRAZE_CHARGE = 0.115;    // charge per full-quality graze
export const GRAZE_COOLDOWN = 0.09;   // per wall edge, so one edge cannot farm

// --- heat -------------------------------------------------------------------
export const HEAT_MIN = 1.0;
export const HEAT_MAX = 8.0;
export const HEAT_PER_GRAZE = 0.16;
export const HEAT_PER_PERFECT_PULSE = 0.4;
export const HEAT_DECAY = 0.62;       // per second, once the grace period lapses
export const HEAT_GRACE = 1.15;       // seconds of no-graze before decay starts

export const SCORE_RATE = 130;        // points per second at heat 1.0

// --- feel -------------------------------------------------------------------
export const DEATH_FREEZE = 0.34;     // seconds before an automatic retry
export const REVIVE_LEADIN = 1.15;    // runway before the first wall of a run
