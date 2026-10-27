const assert = require('node:assert/strict');
const { rm } = require('node:fs/promises');

function addDiagnostic(error, message) {
  (error.diagnostics ??= []).push(message);
}

// A successful kill request or an exit event does not mean stdio/SQLite handles
// have closed. Only close permits profile cleanup; a bounded failure retains it.
function runHarnessChild(startChild, {
  phase,
  timeoutMs = 60_000,
  terminationTimeoutMs = 5_000,
  schedule = setTimeout,
  cancel = clearTimeout,
  stdout = chunk => process.stdout.write(chunk),
  stderr = chunk => process.stderr.write(chunk)
}) {
  return new Promise((resolveChild, reject) => {
    const child = startChild();
    let output = '';
    let primaryError;
    let settled = false;
    let terminationRequested = false;
    let terminationTimer;
    const timeout = schedule(() => terminate(new Error(`Runtime compatibility ${phase} timed out`)), timeoutMs);

    child.stdout.on('data', chunk => { output += chunk; stdout(chunk); });
    child.stderr.on('data', chunk => { output += chunk; stderr(chunk); });

    function rejectWithPrimary(terminationConfirmed) {
      primaryError.terminationConfirmed = terminationConfirmed;
      primaryError.output = output;
      reject(primaryError);
    }

    function terminate(error) {
      if (settled) return;
      if (!primaryError) primaryError = error;
      else if (primaryError !== error) addDiagnostic(primaryError, `Child error during termination: ${error.message}`);
      if (terminationRequested) return;
      terminationRequested = true;
      cancel(timeout);
      terminationTimer = schedule(() => {
        if (settled) return;
        settled = true;
        addDiagnostic(primaryError, `Child close was not confirmed within ${terminationTimeoutMs}ms after termination was requested.`);
        // Do not let an unresponsive child or its pipes hold the driver open.
        // Its profile remains intact for diagnosis and any surviving process.
        child.unref();
        child.stdout.destroy();
        child.stderr.destroy();
        rejectWithPrimary(false);
      }, terminationTimeoutMs);
      try { child.kill('SIGKILL'); }
      catch (killError) { addDiagnostic(primaryError, `Could not request child termination: ${killError.message}`); }
    }

    // Keep this listener after settlement: a late kill/spawn error must not
    // become an unhandled error event or replace the original failure.
    child.on('error', terminate);
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cancel(timeout);
      cancel(terminationTimer);
      if (primaryError) return rejectWithPrimary(true);
      try {
        assert.equal(code, 0, `Runtime compatibility ${phase} failed (signal=${signal})\n${output}`);
        assert.ok(output.includes(`[runtime-compatibility] ${phase} passed`), 'Child did not confirm all checks');
        resolveChild();
      } catch (error) {
        error.terminationConfirmed = true;
        error.output = output;
        reject(error);
      }
    });
  });
}

async function withProfileCleanup(profile, action, {
  remove = rm,
  wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds)),
  cleanupRetries = 3,
  retryDelayMs = 100
} = {}) {
  let result;
  let primaryError;
  try { result = await action(); }
  catch (error) { primaryError = error; }

  if (primaryError?.terminationConfirmed === false) {
    primaryError.retainedProfile = profile;
    addDiagnostic(primaryError, `Profile retained because child termination is unconfirmed: ${profile}`);
  } else {
    try {
      for (let attempt = 0; ; attempt++) {
        try { await remove(profile, { recursive: true, force: true }); break; }
        catch (error) {
          if (attempt >= cleanupRetries || !['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(error.code)) throw error;
          await wait(retryDelayMs * (attempt + 1));
        }
      }
    } catch (cleanupError) {
      if (primaryError) addDiagnostic(primaryError, `Profile cleanup failed: ${cleanupError.message}`);
      else primaryError = cleanupError;
      primaryError.retainedProfile = profile;
      addDiagnostic(primaryError, `Profile retained after cleanup failure: ${profile}`);
    }
  }

  if (primaryError) throw primaryError;
  return result;
}

module.exports = { runHarnessChild, withProfileCleanup };
