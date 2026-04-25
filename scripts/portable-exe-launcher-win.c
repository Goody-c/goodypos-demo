#include <windows.h>
#include <wchar.h>
#include <stdio.h>

#define CMD_BUFFER_SIZE 8192

static void trim_to_parent_directory(wchar_t *pathValue) {
  size_t length = wcslen(pathValue);
  while (length > 0) {
    const wchar_t current = pathValue[length - 1];
    if (current == L'\\' || current == L'/') {
      pathValue[length - 1] = L'\0';
      break;
    }
    length -= 1;
  }
}

static int append_text(wchar_t *buffer, size_t bufferSize, const wchar_t *text) {
  if (!buffer || !text) return 0;

  const size_t currentLength = wcslen(buffer);
  const size_t textLength = wcslen(text);
  if (currentLength + textLength + 1 >= bufferSize) {
    return 0;
  }

  wcscpy(buffer + currentLength, text);
  return 1;
}

static int append_quoted_argument(wchar_t *buffer, size_t bufferSize, const wchar_t *argument) {
  if (!append_text(buffer, bufferSize, L" \"")) return 0;

  for (const wchar_t *cursor = argument; *cursor; cursor += 1) {
    wchar_t chunk[3] = { 0, 0, 0 };
    if (*cursor == L'"') {
      chunk[0] = L'\\';
      chunk[1] = L'"';
    } else {
      chunk[0] = *cursor;
    }

    if (!append_text(buffer, bufferSize, chunk)) return 0;
  }

  return append_text(buffer, bufferSize, L"\"");
}

int wmain(int argc, wchar_t **argv) {
  wchar_t exePath[MAX_PATH] = {0};
  if (GetModuleFileNameW(NULL, exePath, MAX_PATH) == 0) {
    fwprintf(stderr, L"GoodyPOS launcher could not determine its location.\n");
    return 1;
  }

  wchar_t rootDir[MAX_PATH] = {0};
  wcscpy(rootDir, exePath);
  trim_to_parent_directory(rootDir);

  wchar_t batchPath[MAX_PATH] = {0};
  _snwprintf(batchPath, MAX_PATH - 1, L"%ls\\start-goodypos-web.bat", rootDir);

  DWORD batchAttributes = GetFileAttributesW(batchPath);
  if (batchAttributes == INVALID_FILE_ATTRIBUTES || (batchAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
    fwprintf(stderr, L"GoodyPOS could not find its startup files. Please re-extract the full portable release and try again.\n");
    return 1;
  }

  SetEnvironmentVariableW(L"GOODY_POS_APP_DIR", rootDir);
  SetCurrentDirectoryW(rootDir);

  wchar_t commandLine[CMD_BUFFER_SIZE] = L"cmd.exe /c \"\"";
  if (!append_text(commandLine, CMD_BUFFER_SIZE, batchPath) || !append_text(commandLine, CMD_BUFFER_SIZE, L"\"")) {
    fwprintf(stderr, L"GoodyPOS launcher command is too long.\n");
    return 1;
  }

  for (int index = 1; index < argc; index += 1) {
    if (!append_quoted_argument(commandLine, CMD_BUFFER_SIZE, argv[index])) {
      fwprintf(stderr, L"GoodyPOS launcher arguments are too long.\n");
      return 1;
    }
  }

  if (!append_text(commandLine, CMD_BUFFER_SIZE, L"\"")) {
    fwprintf(stderr, L"GoodyPOS launcher command is too long.\n");
    return 1;
  }

  STARTUPINFOW startupInfo;
  PROCESS_INFORMATION processInfo;
  ZeroMemory(&startupInfo, sizeof(startupInfo));
  ZeroMemory(&processInfo, sizeof(processInfo));
  startupInfo.cb = sizeof(startupInfo);

  BOOL started = CreateProcessW(
    NULL,
    commandLine,
    NULL,
    NULL,
    TRUE,
    0,
    NULL,
    rootDir,
    &startupInfo,
    &processInfo
  );

  if (!started) {
    fwprintf(stderr, L"GoodyPOS could not be started. Please check the extracted package and try again.\n");
    return 1;
  }

  CloseHandle(processInfo.hThread);
  WaitForSingleObject(processInfo.hProcess, INFINITE);

  DWORD exitCode = 1;
  GetExitCodeProcess(processInfo.hProcess, &exitCode);
  CloseHandle(processInfo.hProcess);
  return (int) exitCode;
}
