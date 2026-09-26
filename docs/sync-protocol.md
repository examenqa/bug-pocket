# Durable sync and capture ownership

Local row IDs and human-readable issue keys are not cloud primary keys. A persistent
sync identity registry allocates random UUIDs at insertion, including offline inserts.
Existing remote IDs and UUID taxonomy IDs are retained. Legacy rows with evidence of
an uncertain upload are quarantined rather than guessed or allowed to overwrite data.

A mutation and queue snapshot commit in the same SQLite transaction. Mounted workspace
databases persist their sync-enabled ownership separately from the live auth session.
Local-only data does not enqueue. Transmission still requires an authenticated session.

Each immutable event carries an operation UUID, the last observed server revision and
its local predecessor operation. The server locks the entity, authorizes the workspace,
then accepts only the observed revision or an uninterrupted local predecessor chain.
Server revisions advance independently of client clocks. Tombstones are terminal.
Operation receipts make a lost response/retry idempotent. Clients cannot directly write
protocol tables or authoritative revisions; they must use the checked RPC.

Pull preserves pending local intent until the server decides it. A rejected event and
its dependent local snapshots are retained in sync_conflicts for recovery, removed from
the retry queue, and replaced in the cache by the authoritative server record. Successful
acknowledgements do not overwrite newer queued local edits. Pull cursors remain separate
for bugs and attachments. Reference merges enqueue affected bugs as well as taxonomy.

Quick Capture pins a persisted draft token to its originating workspace (explicit local
context when disconnected). Capture entry points verify the token and context. Switching
workspace, changing accounts, restore and destructive maintenance are blocked until the
draft is saved or cancelled; screenshots remain recoverable for the existing 24 hours.
No attachment ID is silently reinterpreted after a workspace switch.

Cloud schema installation is required before upgraded clients can transmit. Missing
protocol RPCs fail closed and retain queued work. Existing installations retain data and
RLS isolation; older clients cannot bypass the revision protocol with direct writes.

Bugs, attachments, applications, modules and environments use the protocol. Devices,
browsers and user roles remain local configuration in the current sync serializer;
their local registry identities are durable too. Legacy reference merge events are
retained for review; new merges enqueue affected report snapshots.

Migration runs idempotently when each database opens. Existing remote_id values and
canonical taxonomy UUIDs are preserved. Rows without a known cloud identity receive
random UUIDs; evidence of a prior upload (sync metadata or failed legacy replay) marks
that intent uncertain and prevents transmission. Historical collisions already written
to a cloud database cannot be automatically reconstructed from local row numbers.
Conflict snapshots remain in the workspace SQLite sync_conflicts table; there is no
automatic merge or conflict editor in this change.

A report deletion also tombstones cloud attachments. Late attachment creation against
a deleted report settles as a tombstone. Local pull rejects older revisions and retains
tombstone identity even after cache rows disappear. Queue/data atomicity covers each
workspace SQLite database; local preset updates and filesystem garbage collection are
separate operations, retaining the existing attachment recovery safeguards.

Validation uses native SQLite, controlled network failures, and PGlite executing the
actual installer/RPC twice with authenticated/anonymous roles. Auth/storage bootstrap
objects emulate Supabase plumbing; this does not replace a hosted Supabase rollout test.
Apply schema-install.sql to each cloud project before deploying the upgraded client.
Older clients must upgrade because direct writes now fail closed.
