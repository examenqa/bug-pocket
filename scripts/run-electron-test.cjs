const { spawnSync } = require('node:child_process');
const electronPath = require('electron');

const testFiles = process.argv.slice(2);
if (!testFiles.length) {
  console.error('Provide at least one test file.');
  process.exit(1);
}

const result = spawnSync(electronPath, ['--import', 'tsx', '--test', ...testFiles], {
  stdio: 'inherit',
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1'
  }
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
