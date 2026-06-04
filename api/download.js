const yaml = require('js-yaml');

const BASE_DOWNLOAD_URL = 'https://bug-pocket-updates-v1.s3.ap-south-1.amazonaws.com/windows';

function getInstallerPath(manifest) {
  if (typeof manifest?.path === 'string' && manifest.path.trim()) {
    return manifest.path.trim();
  }

  const firstFile = Array.isArray(manifest?.files) ? manifest.files[0] : null;
  if (typeof firstFile?.url === 'string' && firstFile.url.trim()) {
    return firstFile.url.trim();
  }
  if (typeof firstFile?.path === 'string' && firstFile.path.trim()) {
    return firstFile.path.trim();
  }

  return null;
}

module.exports = async function downloadProxy(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end('Method Not Allowed');
    return;
  }

  try {
    const manifestResponse = await fetch(`${BASE_DOWNLOAD_URL}/latest.yml`, {
      headers: {
        accept: 'application/x-yaml,text/yaml,text/plain,*/*'
      }
    });

    if (!manifestResponse.ok) {
      throw new Error(`Unable to load latest.yml: HTTP ${manifestResponse.status}`);
    }

    const manifestText = await manifestResponse.text();
    const manifest = yaml.load(manifestText);
    const installerPath = getInstallerPath(manifest);

    if (!installerPath) {
      throw new Error('latest.yml does not include an installer path.');
    }

    const normalizedPath = installerPath.replace(/^\/+/, '');
    const downloadUrl = `${BASE_DOWNLOAD_URL}/${encodeURI(normalizedPath)}`;

    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(302, { Location: downloadUrl });
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Download proxy failed.';
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: false, error: message }));
  }
};

