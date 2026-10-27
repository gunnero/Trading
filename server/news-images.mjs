// Publisher-provided previews only. These fixed hosts are not an arbitrary URL proxy.
const articleHosts = new Set(['finance.yahoo.com', 'www.fool.com', '247wallst.com']);
const imageHosts = new Set(['s.yimg.com', 'g.foolcdn.com', 'cdn.content.foolcdn.com', 'images.mktw.net', '247wallst.com']);
const hour = 60 * 60_000;
function trustedUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.has(url.hostname) && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}
export const newsImageUrl = value => typeof value === 'string' && value.length <= 4096 ? trustedUrl(value, imageHosts) : null;
const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (original, entity) => {
  if (entity[0] !== '#') return ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'})[entity.toLowerCase()];
  const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2),16) : Number(entity.slice(1));
  return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : original;
});
export function parseArticleImage(html) {
  const meta = new Map();
  for (const tag of html.match(/<meta\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi) || []) {
    const attributes = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attributes[match[1].toLowerCase()] = decode(match[2] ?? match[3]);
    const name = (attributes.property || attributes.name || '').toLowerCase();
    if (!meta.has(name)) meta.set(name,attributes.content);
  }
  for (const name of ['og:image:secure_url','og:image','twitter:image','twitter:image:src']) {
    const url = newsImageUrl(meta.get(name));
    if (url) return {url,alt:(meta.get(name.startsWith('og:') ? 'og:image:alt' : 'twitter:image:alt') || '').slice(0,300)};
  }
  return null;
}
export function rssImage(item) {
  const array = value => Array.isArray(value) ? value : value ? [value] : [];
  const group = item['media:group'] || {};
  const candidates = [...array(item['media:content']),...array(item['media:thumbnail']),...array(group['media:content']),...array(group['media:thumbnail']),...array(item.enclosure)];
  for (const candidate of candidates) {
    if ((candidate['@_medium'] && candidate['@_medium'] !== 'image') || (candidate['@_type'] && !candidate['@_type'].startsWith('image/'))) continue;
    const url = newsImageUrl(candidate['@_url']);
    if (url) return {url,alt:''};
  }
  return null;
}
// Read only the document head, cap its size, and never follow redirects.
async function readHead(response) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let html = '', bytes = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) return html;
      bytes += value.byteLength;
      if (bytes > 1_000_000) throw new Error('Publisher metadata is too large.');
      html += decoder.decode(value,{stream:true});
      const end = html.search(/<\/head\s*>/i);
      if (end >= 0) return html.slice(0,end);
    }
  } finally { await reader.cancel().catch(()=>{}); }
}
export function createNewsImages({fetcher,now,cache,store,timeoutMs}) {
  const pending = new Map();
  async function get(url) {
    if (!trustedUrl(url,articleHosts)) return null;
    const key = `news-image:${url}`, hostKey = `news-image-host:${new URL(url).hostname}`;
    const previous = cache.get(key);
    if (previous?.retryAt > now()) return previous.result.data;
    if (cache.get(hostKey)?.retryAt > now()) return null;
    if (pending.has(key)) return pending.get(key);
    const work = (async()=>{
      let image = null, ttl = hour;
      try {
        const response = await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(Math.min(timeoutMs,3000)),headers:{Accept:'text/html'}});
        if (!response.ok) {
          if ([403,418,429,503].includes(response.status)) {
            const value = response.headers.get('retry-after') || '';
            const retry = /^\d+$/.test(value) ? Number(value)*1000 : Date.parse(value)-now();
            const retryAt = now()+Math.max(hour,Number.isFinite(retry)?retry:0);
            store(hostKey,{result:{status:'unavailable',data:null},retryAt});
          }
          await response.body?.cancel();
        } else if (response.headers.get('content-type')?.includes('text/html')) {
          image = parseArticleImage(await readHead(response));
          if (image) ttl = 6*hour;
        } else await response.body?.cancel();
      } catch { /* A missing or blocked image must never hide the headline. */ }
      store(key,{result:{status:image?'ok':'unavailable',data:image},retryAt:now()+ttl});
      return image;
    })();
    pending.set(key,work);
    try { return await work; } finally { pending.delete(key); }
  }
  return async articles => {
    // Bound page requests; older stories remain text-only when RSS supplies no image.
    const result = articles.map(article=>({...article,image:article.image || null}));
    const queue = result.slice(0,8).filter(article=>!article.image);
    await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{
      while (queue.length) {
        const article = queue.shift();
        article.image = await get(article.url);
      }
    }));
    return result;
  };
}
