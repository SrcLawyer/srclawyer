/**
 * Process exit codes. `scan` and `check` share this file so the table can't drift between them;
 * the full table is documented in the README.
 *
 *   scan:  0 clean | 1 completed with warnings | 2 crash or bad usage
 */
export const EXIT_OK = 0;
export const EXIT_CRASH = 2;
