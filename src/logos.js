// Logos for the PDF exports: the company's own (top left) and one per customer
// organisation (top right). A Jira admin uploads them in settings; the page
// shrinks each image before upload, so only a small PNG or JPEG is stored.

export const MAX_LOGO_CHARS = 200000; // data URL length, about 150 KB of image
export const MAX_ORG_LOGOS = 50;
const DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
const ORG_ID = /^\d{1,18}$/;

/** A logo as stored: { dataUrl, width, height, name }, or null if it isn't valid. */
export function sanitizeLogo(input) {
  const dataUrl = String(input?.dataUrl ?? '');
  const width = Number(input?.width);
  const height = Number(input?.height);
  if (!DATA_URL.test(dataUrl) || dataUrl.length > MAX_LOGO_CHARS) return null;
  if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 4000)) return null;
  return { dataUrl, width, height, name: String(input?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) };
}

/** Storage key for 'company' or an organisation id. */
export function logoKey(target) {
  if (target === 'company') return 'logo:company';
  if (ORG_ID.test(String(target))) return `logo:org:${target}`;
  throw new Error('Invalid logo.');
}

/** jsPDF image format for a stored logo. */
export const logoFormat = (logo) => (logo.dataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG');

/** Width and height in mm for a logo `height` mm tall, no wider than `maxWidth`. */
export function logoSize(logo, height, maxWidth) {
  const ratio = logo.width / logo.height;
  const width = Math.min(maxWidth, height * ratio);
  return { width, height: width / ratio };
}
