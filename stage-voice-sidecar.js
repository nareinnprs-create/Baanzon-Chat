const path = require('path');
const fs = require('fs');

const source = path.join(process.cwd(), 'voice-tts');
const target = path.join(process.cwd(), 'baanzon-next/voice-tts');

if (!fs.existsSync(target)) {
  fs.mkdirSync(target, { recursive: true });
}

for (const file of ['server.py', 'install.sh', 'requirements.txt']) {
  const src = path.join(source, file);
  const dst = path.join(target, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}

console.log('Voice sidecar files staged for deploy');