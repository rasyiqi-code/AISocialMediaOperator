const fs = require('fs');
const path = require('path');

// Ensure public/icons directory exists
const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 1x1 base64 PNG fallback (purple gradient icon pixel)
const base64Png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const buffer = Buffer.from(base64Png, 'base64');

['icon16.png', 'icon48.png', 'icon128.png'].forEach(filename => {
  fs.writeFileSync(path.join(iconsDir, filename), buffer);
});

console.log('Icons generated successfully in public/icons/');
