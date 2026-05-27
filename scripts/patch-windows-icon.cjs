const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');

module.exports = async function patchWindowsIcon(context) {
  if (context.electronPlatformName !== 'win32') return;

  const projectDir = context.packager.projectDir;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = join(context.appOutDir, exeName);
  const iconPath = resolve(projectDir, 'build', 'icon.ico');
  const rceditPath = resolve(projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');

  if (!existsSync(exePath)) throw new Error(`Windows executable not found: ${exePath}`);
  if (!existsSync(iconPath)) throw new Error(`Bug Pocket icon not found: ${iconPath}`);
  if (!existsSync(rceditPath)) throw new Error(`rcedit.exe not found: ${rceditPath}`);

  execFileSync(
    rceditPath,
    [
      exePath,
      '--set-icon',
      iconPath,
      '--set-version-string',
      'FileDescription',
      'Bug Pocket',
      '--set-version-string',
      'ProductName',
      'Bug Pocket',
      '--set-version-string',
      'InternalName',
      'Bug Pocket',
      '--set-version-string',
      'OriginalFilename',
      'Bug Pocket.exe'
    ],
    { stdio: 'inherit' }
  );
};
