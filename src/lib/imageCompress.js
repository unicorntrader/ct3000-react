// Client-side image compression for the trade-screenshot upload flow.
//
// Why client-side: shrinks the upload payload before it leaves the browser
// (a 4032×3024 phone screenshot is ~5MB; resized to 1920px @ 85% JPEG it's
// ~250KB). Saves Storage cost, makes upload visibly faster, avoids ever
// having a multi-MB blob hit Supabase Storage.
//
// Always outputs JPEG. The "PNG and JPG" requirement applies to accepted
// INPUT formats — a TV screenshot's text/lines look fine at JPEG quality
// 0.85 and the size reduction vs PNG is huge.

const MAX_DIMENSION = 1920
const QUALITY = 0.85

/**
 * Resize + recompress an uploaded image File to a JPEG Blob.
 * @param {File} file
 * @returns {Promise<Blob>}
 */
export async function compressImage(file) {
  if (!file) throw new Error('No file provided')
  if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
    throw new Error('Only PNG and JPG images are accepted.')
  }

  const img = await loadImage(file)
  const { width, height } = scaleToFit(img.naturalWidth, img.naturalHeight, MAX_DIMENSION)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, width, height)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('Could not encode image')),
      'image/jpeg',
      QUALITY,
    )
  })
  // Best effort: free up the image
  URL.revokeObjectURL(img.src)
  return blob
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read image'))
    }
    img.src = url
  })
}

function scaleToFit(w, h, maxDim) {
  if (w <= maxDim && h <= maxDim) return { width: w, height: h }
  const scale = maxDim / Math.max(w, h)
  return {
    width: Math.round(w * scale),
    height: Math.round(h * scale),
  }
}
