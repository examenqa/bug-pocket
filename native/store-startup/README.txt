Bug Pocket fixed Store startup bridge — source preparation, NOT BUILT/LOADED/TESTED

Mechanism
Plain Node-API C interface (NAPI_VERSION=8), C++17 and installed Windows SDK
C++/WinRT projection. No npm, NodeRT, node-addon-api or Windows App SDK runtime
dependency. Build with approved Electron 45.2.1 headers and x64 node.lib, not host
Node headers/library. See the bounded build script and docs/store-appx-packaging.txt.
No tool/header/dependency acquisition is implicit.

Exports (main-process loader only)
read(), enable(), disable(): no arguments; Promise results:
  { taskId: 'BugPocketStartup', identityVerified: boolean,
    state: 'disabled' | 'disabledByUser' | 'enabled' | 'disabledByPolicy' |
           'enabledByPolicy' | 'unsupported' | 'error', enabled: boolean | null,
    requestState?: string, errorCode?: string, hresult?: number }
activation(): no arguments; Promise result:
  { taskId: 'BugPocketStartup', identityVerified: boolean,
    activationKnown: boolean, startupActivation: boolean,
    errorCode?: string, hresult?: number }

Before each operation GetCurrentPackageFamilyName must exactly match
ExamenQA.BugPocket_tgn4dm49y0b56 and GetCurrentApplicationUserModelId must match
ExamenQA.BugPocket_tgn4dm49y0b56!BugPocket. The explicit taskbar AUMID is not
package identity evidence. Failure calls no task/activation API. No arbitrary
task IDs, filenames, commands, package names or general Windows API are exposed.

Task calls only use StartupTask.GetAsync(L"BugPocketStartup"). Enable requests
only from Disabled; disable only from Enabled. User-disabled and policy states
are never overwritten. A fresh State read supplies the result after either
action; requestState preserves RequestEnableAsync's returned state. Windows may
also report unsupported platforms as DisabledByPolicy; the bridge does not
promise to distinguish these causes. Identity/error/missing API remain unknown.

Activation uses Windows.ApplicationModel.AppInstance.GetActivatedEventArgs,
not the Windows App SDK's Microsoft.Windows.AppLifecycle.AppInstance. Packaged
desktop support starts at Windows 10 1809; planned Store floor19045 covers it.
Call activation once early before Electron single-instance coordination. The
method consumes first-call arguments, so null/errors are cached too. Only
ActivationKind::StartupTask AND exact TaskId count as startup. Null is known
ordinary activation; errors remain unknown/false. No command-line guess is used.

Threading/lifetime
Operations use napi_create_async_work; identity/WinRT calls run on a native MTA
worker. Waiting does not block Electron's UI. Calls are serialised natively;
concurrent calls return busy without invoking Windows. Main-process code also
serialises and drains pending Promises before graceful shutdown. No automatic
retry, polling or forced enablement is implemented.

Each work owns a Node-API asynchronous environment-cleanup hook. Teardown marks
it closing and cancels only queued work. Executing operations retain their work,
environment and DLL until completion. Completion skips JS during teardown,
deletes the work and removes its hook. An OS request already issued cannot be
rolled back by teardown. There is no forced unload/timeout that frees running
native work; shutdown can wait on Windows. Graceful draining and forced-exit
behavior require later native acceptance. No private libuv/V8 APIs are used.

Acceptance still required — ALL NOT RUN
Compile/link with actual approved SDK/MSVC/Electron inputs; PE imports/delay-load
resolution and x64 loading; installed PFN/AUMID/task lookup; first-run opt-in,
opt-out and actual states; early startup activation classification; login/tray/
global shortcut behavior; manual/single-instance regression; queued/running work
shutdown and failures. Source preparation does not establish build readiness or
native/installed acceptance. Existing EXA-66 holds remain controlling.

Primary references
https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.startuptask.getasync?view=winrt-26100
https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.startuptask.requestenableasync?view=winrt-26100
https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.startuptaskstate
https://learn.microsoft.com/en-us/windows/win32/api/appmodel/nf-appmodel-getcurrentpackagefamilyname
https://learn.microsoft.com/en-us/windows/win32/api/appmodel/nf-appmodel-getcurrentapplicationusermodelid
https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/get-activation-info-for-packaged-apps
https://learn.microsoft.com/en-us/uwp/api/windows.applicationmodel.appinstance.getactivatedeventargs?view=winrt-26100
https://github.com/nodejs/node/blob/v24.22.1/doc/api/n-api.md#napi_add_async_cleanup_hook
https://github.com/electron/electron/blob/v45.2.1/docs/tutorial/using-native-node-modules.md#a-note-about-win_delay_load_hook
