/**
 * Process exit codes -- one table for both commands so they can't drift apart. Documented in the README.
 *
 *   code | srclawyer scan                  | srclawyer check
 *   -----+---------------------------------+----------------------------------------------------------
 *    0   | clean                           | no drift
 *    1   | completed with warnings         | drift
 *    2   | crash or bad usage              | crash, bad usage, or a missing / invalid baseline
 *    3   | (not used)                      | inconclusive: a warning that makes `scan` exit 1, or a
 *        |                                 | discovery-mode mismatch -- never reported as drift
 *
 * `scan`'s "warnings" (1) and `check`'s "inconclusive" (3) are the same condition under different
 * numbers; `scan`'s was left alone so existing scripts keep working.
 */
export const EXIT_OK = 0;
export const EXIT_SCAN_WARNINGS = 1;
export const EXIT_DRIFT = 1;
export const EXIT_CRASH = 2;
export const EXIT_INCONCLUSIVE = 3;
