'use strict';
// Validation-only process ownership. A close event (not exit, a marker, kill
// acknowledgement or a delay) is required before a profile can be removed.
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { join, resolve } = require('node:path');
const { rm } = require('node:fs/promises');

function appendFailure(receipt, error, context) {
  const failure = error instanceof Error ? error : new Error(String(error));
  if (!receipt.error) {
    const previous = receipt.diagnostics ?? [];
    receipt.error = failure;
    receipt.error.diagnostics ??= [];
    if (previous !== receipt.error.diagnostics) receipt.error.diagnostics.push(...previous);
  } else if (receipt.error !== failure) {
    receipt.error.diagnostics ??= [];
    receipt.error.diagnostics.push(`${context ? `${context}: ` : ''}${failure.message}`);
  }
  receipt.diagnostics = receipt.error.diagnostics;
  return receipt;
}

// This observer opens and retains the exact Windows process handle while the
// inspected Electron main process is paused. It confirms WaitForExit on that
// handle. Neither a missing PID nor a taskkill result is used as proof. This
// program is launched only by a separately authorized Windows runtime check.
const ownedProcessObserver = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ownedProcess = $null
$commandReader = $null
function Report($kind, $details) {
  $record = @{ event=$kind; nonce=$env:EXA66_OWNED_NONCE; pid=[int]$env:EXA66_OWNED_PID }
  foreach ($key in $details.Keys) { $record[$key] = $details[$key] }
  [Console]::Out.WriteLine(($record | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
try {
  $ownedProcess = [Diagnostics.Process]::GetProcessById([int]$env:EXA66_OWNED_PID)
  $heldHandle = $ownedProcess.Handle
  $started = $ownedProcess.StartTime.ToUniversalTime().Ticks.ToString()
  $actualExecutable = $ownedProcess.MainModule.FileName
  if (-not [String]::Equals([IO.Path]::GetFullPath($actualExecutable), [IO.Path]::GetFullPath($env:EXA66_OWNED_EXE), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Owned process executable differs from the paused inspector identity'
  }
  # Console.In is a synchronized TextReader; its ReadLineAsync can execute a
  # synchronous ReadLine and block this watcher before WaitForExit is checked.
  # Use StreamReader's asynchronous path over the raw redirected input stream.
  $commandReader = [IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.UTF8Encoding]::new($false))
  Report 'ready' @{ started=$started; executable=$actualExecutable }
  $inputTask = $commandReader.ReadLineAsync()
  while ($true) {
    if ($ownedProcess.WaitForExit(100)) {
      Report 'confirmed' @{ started=$started; processExited=$true; exitCode=$ownedProcess.ExitCode }
      exit 0
    }
    if ($inputTask.IsCompleted) {
      $instruction = $inputTask.GetAwaiter().GetResult()
      if ($null -eq $instruction) { throw 'Controller input closed before owned process closure' }
      if ($instruction -ne ($env:EXA66_OWNED_NONCE + ':terminate')) { throw 'Invalid owned process instruction' }
      try { $ownedProcess.Kill() }
      catch { Report 'diagnostic' @{ message=('Owned handle termination request failed: ' + $_.Exception.Message) } }
      $inputTask = $commandReader.ReadLineAsync()
    }
  }
} catch {
  Report 'error' @{ message=$_.Exception.Message }
  exit 2
} finally {
  if ($null -ne $commandReader) { $commandReader.Dispose() }
  if ($null -ne $ownedProcess) { $ownedProcess.Dispose() }
}
`;

function createProcessLifecycle({
  label = 'validation', terminationTimeoutMs = 5_000, gracefulTimeoutMs = 5_000,
  schedule = setTimeout, cancel = clearTimeout, spawnProcess = spawn
} = {}) {
  const states = new Map();
  const changes = new EventEmitter();
  const failures = { error: null, diagnostics: [] };
  let finishing;
  const fail = (error, context) => {
    appendFailure(failures, error, context);
    if (Object.hasOwn(failures, 'terminationConfirmed')) failures.error.terminationConfirmed = failures.terminationConfirmed;
    return failures;
  };
  const allClosed = () => [...states.values()].every(state => state.closed === true);
  const notify = () => changes.emit('change');

  function waitForClosed(timeoutMs) {
    if (allClosed()) return Promise.resolve(true);
    return new Promise(resolveWait => {
      let timer;
      const settle = result => { cancel(timer); changes.off('change', check); resolveWait(result); };
      const check = () => { if (allClosed()) settle(true); };
      changes.on('change', check);
      timer = schedule(() => settle(false), timeoutMs);
      check();
    });
  }

  function trackChild(child, { label: processLabel = 'launcher', allowTermination = false, requiresClosed } = {}) {
    if (states.has(processLabel)) throw new Error(`Duplicate process owner: ${processLabel}`);
    const state = { label: processLabel, kind: 'child', pid: child.pid ?? null, closed: false, child, allowTermination, requiresClosed };
    state.terminate = () => {
      if (child.kill('SIGKILL') === false) throw new Error(`Kill request was not accepted for ${processLabel}`);
    };
    state.detach = () => {
      child.unref?.(); child.stdout?.destroy?.(); child.stderr?.destroy?.();
    };
    states.set(processLabel, state);
    child.on('error', error => { fail(error, `${processLabel} process error`); notify(); });
    child.once('close', (code, signal) => {
      state.closed = true; state.exitCode = code; state.signal = signal; notify();
    });
    return child;
  }

  function expectOwnedPid(processLabel = 'electron') {
    if (states.has(processLabel)) throw new Error(`Duplicate process owner: ${processLabel}`);
    states.set(processLabel, { label: processLabel, kind: 'unresolved', pid: null, closed: false });
  }

  async function observeOwnedPid(pid, { label: processLabel = 'electron', executable } = {}) {
    if (!Number.isSafeInteger(pid) || pid <= 0 || !executable) throw new Error('An inspected PID and executable are required');
    let state = states.get(processLabel);
    if (!state) { expectOwnedPid(processLabel); state = states.get(processLabel); }
    if (state.kind !== 'unresolved') throw new Error(`Process already observed: ${processLabel}`);
    Object.assign(state, { kind: 'owned-handle', pid, executable: resolve(executable), ready: false });
    const nonce = randomUUID();
    let watcher;
    let readyTimer;
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolveWait, reject) => { resolveReady = resolveWait; rejectReady = reject; });
    const rejectObservation = error => { state.observationFailed = true; fail(error, `${processLabel} observer`); cancel(readyTimer); rejectReady(error); };
    let buffer = '';
    let proof;
    function report(line) {
      let value;
      try { value = JSON.parse(line); }
      catch { rejectObservation(new Error('Invalid owned process observer output')); return; }
      if (value.nonce !== nonce || value.pid !== pid) { rejectObservation(new Error('Owned process observer identity mismatch')); return; }
      if (value.event === 'ready') {
        if (state.ready || typeof value.started !== 'string' ||
          resolve(value.executable ?? '').toLowerCase() !== state.executable.toLowerCase()) {
          rejectObservation(new Error('Invalid owned process handle readiness')); return;
        }
        state.ready = true; state.started = value.started; cancel(readyTimer); resolveReady({ pid, executable: state.executable, started: state.started });
      } else if (value.event === 'confirmed') {
        if (!state.ready || value.started !== state.started || value.processExited !== true || !Number.isInteger(value.exitCode)) {
          rejectObservation(new Error('Invalid owned process closure proof')); return;
        }
        proof = value;
      } else if (value.event === 'error' || value.event === 'diagnostic') {
        const error = new Error(value.message || 'Owned process observer failed');
        if (value.event === 'error') rejectObservation(error);
        else fail(error, `${processLabel} termination`);
      } else rejectObservation(new Error('Unexpected owned process observer report'));
    }
    try {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      watcher = spawnProcess(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ownedProcessObserver, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env,
          EXA66_OWNED_PID: String(pid), EXA66_OWNED_EXE: state.executable, EXA66_OWNED_NONCE: nonce } });
      state.observerPid = watcher.pid ?? null;
      // A write/end racing observer exit can emit EPIPE asynchronously. Keep
      // this listener even after teardown settles; it must never become an
      // unhandled error or replace the first validation failure.
      watcher.stdin.on('error', error => fail(error, `${processLabel} observer command pipe`));
      state.terminate = () => {
        if (!state.ready) throw new Error(`No owned handle ready for ${processLabel}`);
        watcher.stdin.write(`${nonce}:terminate\n`);
      };
      state.detach = () => {
        watcher.stdin?.end?.(); watcher.unref?.(); watcher.stdout?.destroy?.(); watcher.stderr?.destroy?.();
      };
      watcher.stdout.on('data', chunk => {
        buffer += chunk.toString();
        if (buffer.length > 65_536) { rejectObservation(new Error('Owned process observer output exceeded its bound')); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
          if (line) report(line);
        }
      });
      watcher.stderr.on('data', chunk => fail(new Error(chunk.toString().trim()), `${processLabel} observer stderr`));
      watcher.on('error', rejectObservation);
      watcher.once('close', (code, signal) => {
        state.observerClosed = true;
        // A ready/report marker, exit event or observer code zero is insufficient
        // alone. Both held-handle proof and watcher close must be present.
        if (code === 0 && proof && state.ready && !state.observationFailed) {
          state.closed = true; state.exitCode = proof.exitCode; state.signal = null;
        } else {
          rejectObservation(new Error(`Owned process closure was not confirmed (observer code=${code}, signal=${signal})`));
        }
        notify();
      });
      readyTimer = schedule(() => rejectObservation(new Error(`Owned handle readiness timed out for ${processLabel}`)), terminationTimeoutMs);
      return await ready;
    } catch (error) {
      cancel(readyTimer); fail(error, `${processLabel} observer setup`); throw error;
    }
  }

  function snapshot() {
    return [...states.values()].map(({ label: processLabel, kind, pid, closed, exitCode, signal, observerPid, observerClosed, ready }) =>
      ({ label: processLabel, kind, pid, confirmedClosed: closed === true, exitCode, signal, observerPid, observerClosed, ready }));
  }

  function canStopLauncher(state) {
    const dependency = states.get(state.requiresClosed);
    return state.kind === 'child' && state.allowTermination === true &&
      dependency?.kind === 'owned-handle' && dependency.closed === true &&
      dependency.exitCode === 0 && !dependency.signal;
  }

  async function finish({ error, requestGraceful } = {}) {
    if (error) fail(error);
    if (finishing) return finishing;
    finishing = (async () => {
      if (!allClosed() && requestGraceful) {
        // Request acknowledgement cannot authorize cleanup. Bound the whole
        // graceful window by closure, even if the request promise never settles.
        Promise.resolve().then(requestGraceful).catch(caught => fail(caught, 'Graceful shutdown request'));
        if (!await waitForClosed(gracefulTimeoutMs) && [...states.values()].some(state => !state.closed && !canStopLauncher(state))) {
          fail(new Error(`${label} graceful closure was not confirmed within ${gracefulTimeoutMs}ms`), 'Graceful shutdown');
        }
      }
      if (!allClosed()) {
        if (!failures.error && [...states.values()].some(state => !state.closed && !canStopLauncher(state))) {
          fail(new Error(`${label} did not close normally`));
        }
        for (const state of states.values()) {
          if (state.closed) continue;
          try {
            if (!state.terminate) throw new Error(`No confirmed process handle for ${state.label}`);
            state.allowedForcedLauncher = canStopLauncher(state);
            if (state.allowedForcedLauncher) failures.diagnostics.push(`Stopping owned launcher ${state.label} after confirmed normal Electron closure`);
            await state.terminate();
          } catch (caught) { fail(caught, `Termination request for ${state.label}`); }
        }
        await waitForClosed(terminationTimeoutMs);
      }
      const confirmed = allClosed();
      if (!confirmed) {
        fail(new Error(`${label} closure remains unconfirmed after ${terminationTimeoutMs}ms`), 'Bounded teardown');
        for (const state of states.values()) if (!state.closed) {
          try { state.detach?.(); } catch (caught) { fail(caught, `Detach ${state.label}`); }
        }
      } else {
        for (const state of states.values()) if ((state.exitCode !== 0 || state.signal) && !state.allowedForcedLauncher) {
          fail(new Error(`${state.label} closed abnormally (code=${state.exitCode}, signal=${state.signal})`));
        }
      }
      failures.terminationConfirmed = confirmed;
      failures.processes = snapshot();
      if (failures.error) failures.error.terminationConfirmed = confirmed;
      // Keep one receipt object. A late graceful-request/pipe rejection must
      // update the returned first error/diagnostics, rather than a discarded
      // spread-copy. Confirmation stays frozen; late close never upgrades it.
      return failures;
    })();
    return finishing;
  }

  return { trackChild, expectOwnedPid, observeOwnedPid, waitForClosed, snapshot,
    recordFailure: fail, finish };
}

async function cleanupAfterClose(receipt, {
  profile, assertOwned, remove = rm,
  wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds)),
  cleanupRetries = 3, retryDelayMs = 100
}) {
  if (receipt.terminationConfirmed !== true) {
    appendFailure(receipt, new Error('Profile retained because process closure is unconfirmed'), 'Cleanup');
  } else {
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          if (typeof assertOwned !== 'function') throw new Error('Profile cleanup requires an ownership assertion');
          await assertOwned(profile);
          await remove(profile, { recursive: true, force: true });
          return receipt;
        } catch (caught) {
          if (attempt >= cleanupRetries || !['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(caught.code)) throw caught;
          await wait(retryDelayMs * (attempt + 1));
        }
      }
    } catch (caught) { appendFailure(receipt, caught, 'Profile cleanup'); }
  }
  receipt.retainedProfile = profile;
  receipt.error.retainedProfile = profile;
  receipt.error.terminationConfirmed = receipt.terminationConfirmed;
  receipt.error.diagnostics.push(`Profile retained: ${profile}`);
  return receipt;
}

module.exports = { createProcessLifecycle, cleanupAfterClose, appendFailure };
