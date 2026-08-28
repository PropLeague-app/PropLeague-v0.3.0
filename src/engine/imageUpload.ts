export const LOGO_SIZE = 256;
export const LOGO_MAX_BYTES = 150 * 1024;

/** Downscales/center-crops an uploaded image to a square LOGO_SIZE canvas and
 * compresses it as JPEG, stepping quality down until it fits under the ~150KB cap
 * (manual §7) — throws if even the lowest quality can't get under the cap, so the
 * caller can warn instead of silently blowing past localStorage's ~5MB quota. */
export function processLogoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;

      const canvas = document.createElement('canvas');
      canvas.width = LOGO_SIZE;
      canvas.height = LOGO_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas not supported'));
        return;
      }
      ctx.drawImage(img, sx, sy, side, side, 0, 0, LOGO_SIZE, LOGO_SIZE);

      let quality = 0.85;
      let dataUrl = canvas.toDataURL('image/jpeg', quality);
      while (dataUrl.length > LOGO_MAX_BYTES * 1.37 && quality > 0.3) {
        quality -= 0.1;
        dataUrl = canvas.toDataURL('image/jpeg', quality);
      }
      if (dataUrl.length > LOGO_MAX_BYTES * 1.37) {
        reject(new Error('Image is too large to compress under 150KB — try a smaller/simpler image.'));
        return;
      }
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read that image file.'));
    };
    img.src = objectUrl;
  });
}

/** Rough total size of everything this app has written to localStorage — used to
 * warn before a save would blow past the ~5MB browser quota. */
export function estimateLocalStorageBytes(): number {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    total += (localStorage.getItem(key)?.length ?? 0) + key.length;
  }
  return total;
}
