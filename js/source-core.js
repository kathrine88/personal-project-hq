import { PROJECT_KEYS } from './project-core.js?v=20261026-projects';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SOURCE_TYPES = {link:'Website link', note:'Written note'};
export function libraryRoute(project, source = '') {
  return '#library/' + encodeURIComponent(project) + (source ? '/' + encodeURIComponent(source) : '');
}
export function readLibraryRoute(hash) {
  const parts = hash.slice(1).split('/');
  try {
    const project = decodeURIComponent(parts[1] || ''), source = decodeURIComponent(parts[2] || '');
    return parts[0] === 'library' && parts.length >= 2 && parts.length <= 3 && PROJECT_KEYS.includes(project) && (!source || uuid.test(source)) ? {project, source} : null;
  } catch {return null;}
}
// This is navigation validation only. It is NOT an SSRF-safe server fetch policy.
// Stage 2A never fetches page metadata, in the browser or on a server.
export function websiteUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(raw)) throw new Error('Enter a full http:// or https:// website URL.');
  let url; try {url = new URL(raw);} catch {throw new Error('Enter a full http:// or https:// website URL.');}
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || !url.hostname || !/^https?:\/\//i.test(raw)) throw new Error('Use an http:// or https:// link without a username or password.');
  return url.href;
}
export function safeWebsiteUrl(value) {try {return websiteUrl(value);} catch {return '';}}
export function previewUrl(value) {
  const safe = safeWebsiteUrl(value); if (!safe) return '';
  const url = new URL(safe), host = url.hostname.toLowerCase().replace(/\.$/,'');
  // No auto-fetching arbitrary numeric/local hosts for image previews. A later
  // preview service must validate DNS/redirects/bytes/timeouts independently.
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || !host.includes('.') || host.includes(':') || /^\d+(\.\d+)*$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid|example|home|lan)$/.test(host)) return '';
  return safe;
}
function text(value, maximum, label, required = false) {
  const clean = String(value ?? '').trim();
  if ((required && !clean) || clean.length > maximum) throw new Error(`${label} ${required ? 'must have 1–' : 'must have no more than '}${maximum.toLocaleString('en-GB')} characters.`);
  return clean;
}
export function sourceValues(input, sections = []) {
  if (!Object.hasOwn(SOURCE_TYPES, input.source_type)) throw new Error('Choose Website link or Written note.');
  const link = input.source_type === 'link', url = link ? websiteUrl(input.url) : null;
  const title = text(input.title, 300, 'Title', !link) || new URL(url).hostname;
  const section_id = input.section_id || null;
  if (section_id && !sections.some(s => s.id === section_id)) throw new Error('This subsection is no longer available. Reload and choose a current subsection, or save without one.');
  return {source_type:input.source_type, url, title,
    description:link ? text(input.description, 2000, 'Description') : '',
    note_content:text(input.note_content, 50000, link ? 'Personal notes' : 'Written content', !link), section_id};
}
export function filterSources(rows, type = '', section = '') {
  return rows.filter(r => (!type || r.source_type === type) && (!section || (section === 'unassigned' ? !r.section_id : r.section_id === section)))
    .sort((a,b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
}
export function sourceSummary(source) {
  const url = source.source_type === 'link' ? safeWebsiteUrl(source.url) : '';
  return (source.description || source.note_content || (url ? new URL(url).hostname : '')).replace(/\s+/g,' ').trim();
}
export function sectionName(source, sections) {return sections.find(s => s.id === source.section_id)?.name || 'No subsection';}
export function storedView(storage) {try {return storage?.getItem('hq-source-view') === 'list' ? 'list' : 'gallery';} catch {return 'gallery';}}
export function rememberView(storage, view) {try {storage?.setItem('hq-source-view', view);} catch {/* Private browsing/storage restrictions must not block use. */}}
