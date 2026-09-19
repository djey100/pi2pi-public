# Mandatory safety rules for every agent

These rules apply to the entire repository. Read
`docs/PRODUCTION-STATE-2026-08-15.md` before investigating or changing anything
related to production, contracts, Fly.io, Supabase, grants, or deployment.

## Default mode: local and read-only

- A request to inspect, audit, explain, test, review, prepare a document, or fix
  local code does **not** authorize any production change.
- Finding a production problem does **not** authorize fixing it.
- Keep the scope of the task. A documentation or grant task must not turn into
  infrastructure, deployment, monitoring, database, or contract work.
- Never treat broad phrases such as "continue", "fix it", "do everything
  necessary", or "finish the project" as production authorization.

## Production changes require a separate literal approval

The following actions are prohibited unless the owner gives a new, explicit
approval for the exact action after seeing its command and consequences:

- Fly deploy, release, rollback, restart, machine changes, scaling, or config;
- setting, removing, rotating, or copying any secret;
- Supabase schema, migration, RLS, policy, permission, or data mutation;
- any blockchain transaction, signature, approval, deployment, or keeper action;
- DNS, hosting, external submissions, invitations, emails, or messages;
- destructive Git or filesystem operations.

Before each such action, stop and show the owner:

1. exact command or operation;
2. exact target;
3. why it is required;
4. expected user-visible impact and downtime;
5. side effects, including automatic restarts and possible on-chain keeper work;
6. rollback target and rollback procedure;
7. local/staging verification already completed.

Proceed only after the owner replies with a statement equivalent to:
`РАЗРЕШАЮ PRODUCTION-ДЕЙСТВИЕ: <exact action>`.

Approval is single-use and applies only to the named action. A failure,
unexpected result, or need for a second deploy requires stopping and obtaining
new approval. Never start an automatic chain of corrective production actions.

## Additional safeguards

- Never expose or print secrets, tokens, keys, env-file contents, or private
  credentials.
- Never restart the keeper merely to inspect it. A keeper restart can trigger
  automatic on-chain actions.
- Never combine an urgent configuration fix with a new feature, observability
  system, migration, refactor, or documentation overhaul.
- Before any authorized deploy, record the current release IDs, contract
  addresses, relevant secret names (not values), health result, and rollback
  target. Build and test the exact image locally first.
- After any production error, stop. Report evidence and wait for the owner.
- Do not clean or normalize the current dirty working tree without a separate
  inventory and explicit approval. Existing changes belong to the owner.

## Required reporting discipline

Always distinguish:

- directly verified facts;
- conclusions inferred from evidence;
- claims copied from prior agents or documents;
- facts that remain unknown because safe verification was unavailable.

Never describe unit tests as production end-to-end proof. Never describe
"not tested" as "broken". Never claim a system is fully healthy when only its
public page or process status was checked.

