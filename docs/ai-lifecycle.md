# AI lifecycle and field ownership

AI is invoked only by an explicit AI control. Jira and Linear actions validate their
tracker configuration and format locally, regardless of whether a BYOK key exists.
Users can apply AI Triage, review the result, and then export normally.

A renderer request ID is scoped to its webContents owner. Starting another request
aborts the previous operation. Explicit Cancel AI, report/workspace changes, unmount,
departure flushes and shutdown invalidate renderer results. Main-process shutdown
cancels AI before draining OperationBarrier. WebContents destruction/navigation also
cancels its requests. Cancellation cannot target another renderer's operation.

All AI transport uses one 120-second total deadline, including response-body reads
and all provider fallbacks. AbortSignal reaches OpenAI-compatible and Ollama fetches.
Non-cooperative delayed responses remain observed but cannot apply UI state or hold
shutdown open. IPC distinguishes completed, cancelled, timed-out and failed results;
intentional cancellation is silent and timeout is reported specifically.

Triage owns only title, note, steps_to_reproduce, expected_result and actual_result,
and only when supplied by the generated response. Each result merges into current
state. Comparison with request-start values and per-field edit generations protects
manual edits, including edits subsequently reverted to their original value. Other
fields are never replaced. Superseded results cannot merge, even if transport ignores
cancellation. Malformed-output note fallback follows the same ownership rule.

Gemini uses the configured model first. Only an empty setting uses the default model.
Existing fallback models are deduplicated after the primary model and tried only for
HTTP 429 or 5xx responses. Other failures, including 401 and 404, stop immediately.
Fallback attempts log model names without prompts/keys and never modify saved settings.
