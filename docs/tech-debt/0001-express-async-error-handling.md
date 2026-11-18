# Technical Debt 0001: Centralised Async Error Handling in Express 4

Date: 2026-11-18
Status: **Open. Not researched, planned or approved.** Nothing here is implemented.
Next step: `/research` and `/plan` before any implementation.

This task is separate from the idempotency work in `docs/plans/idempotent-order-retry.md` and is
not part of any of its steps.

## Current risk

An unexpected error inside an async route handler can terminate the API process.

- The project uses Express 4 (`package.json`: `express ^4.22.3`, installed `4.22.3`). Express 4
  does not forward a rejected promise from an `async` handler to `next(err)`.
- All six route handlers are `async` (`src/routes/orders.ts:15`, `:25`, `:35` and
  `src/routes/customers.ts:9`, `:15`, `:21`). None of them catches unexpected errors, and
  `src/app.ts` has no error middleware.
- `src/server.ts` registers no `unhandledRejection` handler. Node's default
  (`--unhandled-rejections=throw`) turns an unhandled rejection into an uncaught exception, and
  the process exits.
- The service layer returns `Result` for expected failures (`docs/standard.md`), but unexpected
  errors are rethrown. For example, `createOrder` rolls back and rethrows
  (`src/services/orderService.ts:73`). A database outage, a lost connection or a constraint
  violation can each reach the route as a rejected promise.

**Verified on 2026-11-18** with a throwaway probe (scratchpad only, test DB) against the
Step 4 state of the idempotency work. A second `POST /orders` with the same `Idempotency-Key`
raised `23505` (unique violation). Under a real HTTP server on Node v24.19.0, the client got no
response and the **process exited with code 1**. Under Jest + Supertest, the request got no
response and the test timed out. Details: `sessions/10-step-4-idempotency-key.md`.

The idempotency plan's Step 5 removes that one trigger (`ON CONFLICT DO NOTHING`). It does not
remove the risk for other unexpected errors.

**Impact:** a single bad request or a short database problem can take the whole API down for
every customer. It also lets one client crash the service on purpose if it can trigger an
unexpected error.

## Scope

1. **Centralised error middleware.** One Express error handler, `(err, req, res, next)`,
   registered last in `createApp()` (`src/app.ts`), so it applies to all routes.
2. **Handling rejected promises.** Every rejected promise from an async route handler must reach
   that middleware. The chosen mechanism is applied in one place, without a `try/catch` in each
   route.
3. **Appropriate HTTP responses.**
   - An unexpected error returns `500` in the standard error format
     `{ "error": { "code": "...", "message": "..." } }` (`docs/standard.md`, Fel), for example
     with the code `internal_error`.
   - The response must not leak details such as stack traces, SQL, constraint names or
     connection strings.
   - The error is logged on the server without personal data and without idempotency keys
     (`docs/standard.md`, Hemligheter och loggar).
   - This probably means extending `ErrorCode` in `src/result.ts` and `STATUS` in `src/http.ts`,
     or adding a separate type for internal errors. That is to be decided in the plan.
   - If the response has already started (`res.headersSent`), hand the error on to Express's
     default handler.
4. **Tests proving the server stays alive.**
   - A route error (rejected promise) returns `500` with the standard error format and no
     internal details.
   - After such an error, a following request to the same app (for example `GET /health` or a
     normal `GET /orders/:id`) still succeeds. This shows the process and the app still work.
   - At least one test against a real listening server (not only Supertest's in-process app), so
     a process exit would be detected, not only a missing response.
   - Errors are triggered without adding test hooks to production code, for example with a test
     router mounted on `createApp()`, or a Jest mock of a service function that rejects. To be
     decided in the plan.
   - Existing tests stay unchanged and green. Expected errors (400, 401, 403, 404, 409) keep
     their current status codes and bodies.

## Out of scope

- Upgrading to Express 5, which handles rejected promises natively. It should be considered as
  an alternative in research, but it is a larger change with its own risks.
- Process-level supervision or restarts (Docker restart policy, a process manager).
- Changing how expected errors are returned (the `Result` pattern stays).
- Any part of the idempotency feature.

## Alternatives to compare in research

| Alternative | Note |
|---|---|
| A small in-house `asyncHandler` wrapper, or wrapping `Router` methods centrally | No new dependency. It must be applied consistently, and a forgotten wrapper brings the risk back. |
| `express-async-errors` (patches Express 4) | One import. It is a new dependency and patches Express internals. |
| Upgrade to Express 5 | Native support. Larger change (path syntax, `req.query` and other breaking changes). |
| `process.on("unhandledRejection")` only | Keeps the process alive, but the client still gets no response and state may be unclear. At most a safety net, not a solution. |

The choice is an architectural decision, so it should be recorded as an ADR in `docs/adr/`.

## Related observations (not verified, to check in research)

- `calcPrice` (`src/pricing/legacyPrice.ts`) calls `JSON.parse(stdout)` inside an `execFile`
  callback. If the Python output is not valid JSON, the result is a synchronous throw inside a
  callback. Neither error middleware nor a promise wrapper catches that, so it could also end the
  process.
- A malformed JSON body is rejected by `express.json()`. Today it probably gets Express's default
  error response (HTML) instead of the standard error format. A central error handler would
  change that response, which is an API change to decide on and test.

## Acceptance criteria (draft, to be confirmed)

1. Given any route whose handler rejects, when the request is made, then the response is `500`
   with `{ "error": { "code": "internal_error", "message": <generic> } }` and no internal details.
2. Given that a route error has happened, when another request is made, then it is served
   normally (the server is still alive).
3. Given the existing test suite, when it runs, then all existing tests still pass unchanged.
