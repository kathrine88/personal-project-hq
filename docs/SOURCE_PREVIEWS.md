# Website previews: deferred implementation contract

Stage 2A uses the explicitly permitted manual fallback. There is **no metadata fetcher**, no Edge Function deployment, no browser-side cross-origin fetch, and no external preview API. Website links save without a preview, with an editable domain fallback title. The `preview_image_url` field is nullable and reserved for validated metadata. No Storage or uploads are included.

The restricted development environment cannot exercise arbitrary-site fetching or reliably validate destination pinning inside the Supabase Edge runtime. Shipping URL validation followed by a generic server-side `fetch` would leave DNS rebinding/redirect/network-boundary questions unresolved. A secure fetch implementation is therefore deferred rather than described as working.

## Future server contract (not implemented)

- Use an authenticated Supabase Edge Function or a reviewed preview provider with explicit egress/SSRF controls. Validate the caller's actual JWT, restrict CORS to supported app/preview origins, enforce per-user rate limits/quotas and bound concurrent work. Never accept a caller-supplied owner or expose service-role credentials.
- Allow only HTTP(S), preferably HTTPS, standard ports, bounded URL length, and no credentials. Reject loopback, private, link-local, reserved, multicast, unspecified, IPv4-mapped IPv6 and cloud metadata destinations. Validate all A/AAAA records, including CNAME targets, and every redirect. Prohibit redirects to other protocols and cap hops (e.g. three).
- Resolve and **pin the verified public destination for the actual connection** while preserving correct TLS SNI/hostname validation. Checking DNS and then doing an ordinary hostname fetch is insufficient: DNS can change between checks and connection. If the runtime cannot enforce pinning, use an independently secured egress service; do not bypass TLS verification.
- Apply an overall deadline (e.g. five seconds including DNS/redirects), a stream-enforced decompressed response byte cap (e.g. 1 MiB), strict HTML content types, header/metatag size limits and no script execution. Do not rely only on Content-Length. Bound parser CPU/memory. Fetch no arbitrary secondary resources.
- Extract Open Graph with a standard title/meta-description fallback; resolve relative metadata safely against the verified final page URL. Revalidate preview image URLs independently. Loading image URLs also raises redirect, privacy and egress issues; do not assume the Stage 2A browser `previewUrl` navigation/display guard is an SSRF firewall.
- Return a small bounded metadata object. Never return fetched HTML. Treat all metadata as untrusted text. Don't leak private URL query strings/tokens to logs, third-party services or shared caches; isolate cache entries appropriately and bound their TTL/size.
- Client preview failures/timeouts must never block saving. Apply asynchronous results only to the current URL/form/session. Never overwrite fields the user has edited, and allow metadata text to be replaced or removed. Manual saving must work if the function is absent, rate-limited, or offline.

## Stage 2A boundaries

`source-core.js` validates link navigation to HTTP(S), strips no user content silently, and rejects executable schemes/embedded credentials. Its image display guard rejects obvious local/numeric hosts and unsupported schemes/ports. **Neither helper resolves DNS or makes a page request. They must not be repurposed as server-fetch validation.** Rendering uses textContent, not HTML; original links use noopener/noreferrer. Image display failures use the source-type icon and do not affect saving.

Extend the existing source type/content checks additively for Stage 2B; keep stable IDs and project/owner keys. Private Storage buckets, uploads, signing URLs, file policies and cleanup require their own implementation and security tests. Do not store public bucket URLs or simulate upload records in Stage 2A.
