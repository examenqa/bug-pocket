// Fixed-task Windows bridge. Source preparation only; native acceptance pending.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <appmodel.h>
#include <node_api.h>
#include <winrt/Windows.ApplicationModel.h>
#include <winrt/Windows.ApplicationModel.Activation.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Metadata.h>
#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <new>
#include <string>
#include <vector>

namespace {
using winrt::Windows::ApplicationModel::AppInstance;
using winrt::Windows::ApplicationModel::StartupTask;
using winrt::Windows::ApplicationModel::StartupTaskState;
using winrt::Windows::ApplicationModel::Activation::ActivationKind;
using winrt::Windows::ApplicationModel::Activation::StartupTaskActivatedEventArgs;
using winrt::Windows::Foundation::Metadata::ApiInformation;
constexpr wchar_t kPackageFamily[] = L"ExamenQA.BugPocket_tgn4dm49y0b56";
constexpr wchar_t kApplicationId[] = L"ExamenQA.BugPocket_tgn4dm49y0b56!BugPocket";
constexpr wchar_t kTaskId[] = L"BugPocketStartup";
constexpr char kTaskIdUtf8[] = "BugPocketStartup";
enum class Operation { Read, Enable, Disable, Activation };

struct Result {
  bool identity_verified = false;
  const char* state = "error";
  int enabled = -1;  // Unknown, never inferred disabled.
  const char* request_state = nullptr;
  const char* error_code = nullptr;
  uint32_t hresult = 0;
  bool activation_known = false;
  bool startup_activation = false;
};
struct Work {
  napi_env env = nullptr;
  napi_deferred deferred = nullptr;
  napi_async_work async_work = nullptr;
  napi_async_cleanup_hook_handle cleanup = nullptr;
  Operation operation = Operation::Read;
  std::atomic<bool> closing{false};
  Result result;
};
// Main-process code also serialises calls and drains them on graceful quit.
std::atomic<bool> busy{false};
std::mutex activation_mutex;
bool activation_attempted = false;
Result cached_activation;

void Failure(Result& result, const char* code, HRESULT hr = S_OK) {
  result.state = "error";
  result.enabled = -1;
  result.activation_known = false;
  result.startup_activation = false;
  result.error_code = code;
  result.hresult = static_cast<uint32_t>(hr);
}

template <typename IdentityFunction>
bool ReadIdentity(IdentityFunction function, std::wstring& value, LONG& code) {
  UINT32 length = 0;
  code = function(&length, nullptr);
  if (code != ERROR_INSUFFICIENT_BUFFER || length == 0 || length > 1024) return false;
  std::vector<wchar_t> buffer(length, L'\0');
  code = function(&length, buffer.data());
  if (code != ERROR_SUCCESS || length == 0 || length > buffer.size() || buffer[length - 1] != L'\0') return false;
  value.assign(buffer.data(), length - 1);
  return true;
}

bool VerifyIdentity(Result& result) {
  LONG code = ERROR_SUCCESS;
  std::wstring family;
  if (!ReadIdentity(GetCurrentPackageFamilyName, family, code)) {
    Failure(result, "package_identity_unavailable", HRESULT_FROM_WIN32(code));
    return false;
  }
  if (family != kPackageFamily) { Failure(result, "package_identity_mismatch"); return false; }
  std::wstring application;
  // Check the package application ID, not the explicit taskbar ID set by JS.
  if (!ReadIdentity(GetCurrentApplicationUserModelId, application, code)) {
    Failure(result, "application_identity_unavailable", HRESULT_FROM_WIN32(code));
    return false;
  }
  if (application != kApplicationId) { Failure(result, "application_identity_mismatch"); return false; }
  result.identity_verified = true;
  return true;
}

const char* StateName(StartupTaskState state) {
  switch (state) {
    case StartupTaskState::Disabled: return "disabled";
    case StartupTaskState::DisabledByUser: return "disabledByUser";
    case StartupTaskState::Enabled: return "enabled";
    case StartupTaskState::DisabledByPolicy: return "disabledByPolicy";
    case StartupTaskState::EnabledByPolicy: return "enabledByPolicy";
    default: return "unsupported";
  }
}
void SetState(Result& result, StartupTaskState state) {
  result.state = StateName(state);
  switch (state) {
    case StartupTaskState::Enabled:
    case StartupTaskState::EnabledByPolicy: result.enabled = 1; break;
    case StartupTaskState::Disabled:
    case StartupTaskState::DisabledByUser:
    case StartupTaskState::DisabledByPolicy: result.enabled = 0; break;
    default: result.enabled = -1; break;
  }
}

void ReadActivation(Result& result) {
  std::lock_guard<std::mutex> lock(activation_mutex);
  if (activation_attempted) { result = cached_activation; return; }
  // Packaged GetActivatedEventArgs consumes first-call arguments. Cache null
  // and errors too; subsequent operations must not retry that consuming call.
  activation_attempted = true;
  cached_activation.identity_verified = true;
  try {
    if (!ApiInformation::IsMethodPresent(L"Windows.ApplicationModel.AppInstance", L"GetActivatedEventArgs")) {
      cached_activation.error_code = "activation_unsupported";
    } else {
      auto args = AppInstance::GetActivatedEventArgs();
      cached_activation.activation_known = true;
      if (args && args.Kind() == ActivationKind::StartupTask) {
        auto startup_args = args.try_as<StartupTaskActivatedEventArgs>();
        cached_activation.startup_activation = startup_args && startup_args.TaskId() == kTaskId;
      }
    }
  } catch (const winrt::hresult_error& error) {
    Failure(cached_activation, "activation_error", error.code());
  } catch (...) { Failure(cached_activation, "activation_error"); }
  result = cached_activation;
}

void Execute(napi_env, void* data) noexcept {
  auto* work = static_cast<Work*>(data);
  if (work->closing.load()) { Failure(work->result, "closing"); return; }
  try {
    if (!VerifyIdentity(work->result)) return;
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    struct Apartment { ~Apartment() { winrt::uninit_apartment(); } } apartment;
    if (work->operation == Operation::Activation) { ReadActivation(work->result); return; }
    if (!ApiInformation::IsTypePresent(L"Windows.ApplicationModel.StartupTask")) {
      work->result.state = "unsupported";
      work->result.error_code = "startup_api_unsupported";
      return;
    }
    // get() waits on the native worker, never Electron's UI thread.
    auto task = StartupTask::GetAsync(kTaskId).get();
    if (!task) { Failure(work->result, "task_not_found"); return; }
    const auto state = task.State();
    if (work->closing.load()) { Failure(work->result, "closing"); return; }
    if (work->operation == Operation::Enable && state == StartupTaskState::Disabled) {
      const auto returned = task.RequestEnableAsync().get();
      work->result.request_state = StateName(returned);
    } else if (work->operation == Operation::Disable && state == StartupTaskState::Enabled) {
      task.Disable();
    }
    // Preserve user/policy restrictions; a request alone never means success.
    SetState(work->result, task.State());
  } catch (const winrt::hresult_error& error) {
    const HRESULT hr = error.code();
    if (hr == E_NOTIMPL || hr == REGDB_E_CLASSNOTREG || hr == HRESULT_FROM_WIN32(ERROR_NOT_SUPPORTED)) {
      work->result.state = "unsupported";
      work->result.enabled = -1;
      work->result.error_code = "startup_api_unsupported";
      work->result.hresult = static_cast<uint32_t>(hr);
    } else { Failure(work->result, hr == E_ACCESSDENIED ? "access_denied" : "windows_api_error", hr); }
  } catch (...) { Failure(work->result, "native_error"); }
}

bool Check(napi_env env, napi_status status) {
  if (status == napi_ok) return true;
  if (status != napi_pending_exception) napi_throw_error(env, "STARTUP_BRIDGE_NAPI", "Startup bridge operation could not be completed.");
  return false;
}
bool StringProperty(napi_env env, napi_value object, const char* key, const char* text) {
  napi_value value;
  return Check(env, napi_create_string_utf8(env, text, NAPI_AUTO_LENGTH, &value)) && Check(env, napi_set_named_property(env, object, key, value));
}
bool BoolProperty(napi_env env, napi_value object, const char* key, bool boolean) {
  napi_value value;
  return Check(env, napi_get_boolean(env, boolean, &value)) && Check(env, napi_set_named_property(env, object, key, value));
}
napi_value ResultValue(napi_env env, const Work& work) {
  napi_value object;
  if (!Check(env, napi_create_object(env, &object)) || !StringProperty(env, object, "taskId", kTaskIdUtf8) ||
      !BoolProperty(env, object, "identityVerified", work.result.identity_verified)) return nullptr;
  if (work.operation == Operation::Activation) {
    if (!BoolProperty(env, object, "activationKnown", work.result.activation_known) ||
        !BoolProperty(env, object, "startupActivation", work.result.startup_activation)) return nullptr;
  } else {
    napi_value enabled;
    const auto status = work.result.enabled < 0 ? napi_get_null(env, &enabled) : napi_get_boolean(env, work.result.enabled == 1, &enabled);
    if (!Check(env, status) || !StringProperty(env, object, "state", work.result.state) ||
        !Check(env, napi_set_named_property(env, object, "enabled", enabled))) return nullptr;
    if (work.result.request_state && !StringProperty(env, object, "requestState", work.result.request_state)) return nullptr;
  }
  if (work.result.error_code && !StringProperty(env, object, "errorCode", work.result.error_code)) return nullptr;
  if (work.result.hresult != 0) {
    napi_value code;
    if (!Check(env, napi_create_uint32(env, work.result.hresult, &code)) || !Check(env, napi_set_named_property(env, object, "hresult", code))) return nullptr;
  }
  return object;
}
void FinishPromise(napi_env env, Work& work) {
  napi_value result = ResultValue(env, work);
  if (result) { napi_resolve_deferred(env, work.deferred, result); }
  else {
    napi_value exception;
    bool pending = false;
    if (napi_is_exception_pending(env, &pending) == napi_ok && pending && napi_get_and_clear_last_exception(env, &exception) == napi_ok) {
      napi_reject_deferred(env, work.deferred, exception);
    }
  }
}
void Complete(napi_env env, napi_status status, void* data) noexcept {
  std::unique_ptr<Work> work(static_cast<Work*>(data));
  if (!work->closing.load()) {
    if (status != napi_ok) Failure(work->result, "cancelled");
    FinishPromise(env, *work);
  }
  // Cleanup and completion run on the environment's thread. The async hook
  // retains the environment/DLL until executing work is safe to release.
  napi_delete_async_work(env, work->async_work);
  const auto cleanup = work->cleanup;
  busy.store(false);
  work.reset();
  // Last action: no Work access or owned C++ resource destruction after this.
  napi_remove_async_cleanup_hook(cleanup);
}
void Cleanup(napi_async_cleanup_hook_handle, void* data) noexcept {
  auto* work = static_cast<Work*>(data);
  work->closing.store(true);
  // Cancellation only succeeds for queued work; running work retains its hook
  // until Complete, and must never settle JS during environment teardown.
  napi_cancel_async_work(work->env, work->async_work);
}
napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  void* callback_data = nullptr;
  if (!Check(env, napi_get_cb_info(env, info, &argc, argv, nullptr, &callback_data))) return nullptr;
  if (argc != 0) { napi_throw_type_error(env, "STARTUP_BRIDGE_ARGUMENTS", "This fixed-task operation accepts no arguments."); return nullptr; }
  std::unique_ptr<Work> work(new (std::nothrow) Work());
  if (!work) { napi_throw_error(env, "STARTUP_BRIDGE_MEMORY", "Startup bridge allocation failed."); return nullptr; }
  work->env = env;
  work->operation = static_cast<Operation>(reinterpret_cast<uintptr_t>(callback_data));
  napi_value promise;
  if (!Check(env, napi_create_promise(env, &work->deferred, &promise))) return nullptr;
  if (busy.exchange(true)) { Failure(work->result, "busy"); FinishPromise(env, *work); return promise; }
  napi_value resource_name;
  if (!Check(env, napi_create_string_utf8(env, "BugPocketFixedStartupTask", NAPI_AUTO_LENGTH, &resource_name)) ||
      !Check(env, napi_create_async_work(env, nullptr, resource_name, Execute, Complete, work.get(), &work->async_work))) {
    busy.store(false); return nullptr;
  }
  if (!Check(env, napi_add_async_cleanup_hook(env, Cleanup, work.get(), &work->cleanup))) {
    napi_delete_async_work(env, work->async_work); busy.store(false); return nullptr;
  }
  if (!Check(env, napi_queue_async_work(env, work->async_work))) {
    napi_remove_async_cleanup_hook(work->cleanup);
    napi_delete_async_work(env, work->async_work); busy.store(false); return nullptr;
  }
  work.release();  // Complete owns it; the cleanup hook cannot outlive it.
  return promise;
}
napi_value Init(napi_env env, napi_value exports) {
  const napi_property_descriptor methods[] = {
    {"read", nullptr, Start, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(static_cast<uintptr_t>(Operation::Read))},
    {"enable", nullptr, Start, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(static_cast<uintptr_t>(Operation::Enable))},
    {"disable", nullptr, Start, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(static_cast<uintptr_t>(Operation::Disable))},
    {"activation", nullptr, Start, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(static_cast<uintptr_t>(Operation::Activation))}
  };
  return Check(env, napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods)) ? exports : nullptr;
}
}  // namespace
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
