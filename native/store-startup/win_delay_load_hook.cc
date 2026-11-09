// Electron's manual native-addon linkage requires this hook directly in the
// .node image: /DELAYLOAD:node.exe with Electron's node.lib, not host Node's.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <delayimp.h>
#include <cstring>

static FARPROC WINAPI ResolveElectronImage(unsigned int event, DelayLoadInfo* details) {
  if (event != dliNotePreLoadLibrary || !details || !details->szDll ||
      _stricmp(details->szDll, "node.exe") != 0) return nullptr;
  return reinterpret_cast<FARPROC>(GetModuleHandleW(nullptr));
}
decltype(__pfnDliNotifyHook2) __pfnDliNotifyHook2 = ResolveElectronImage;
