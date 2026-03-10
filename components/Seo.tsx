import { useEffect } from 'react';
import { DEFAULT_OG_IMAGE, DEFAULT_ROBOTS, SITE_NAME, StructuredData, absoluteUrl } from '../utils/seo';

type SeoProps = {
  title: string;
  description: string;
  path?: string;
  image?: string;
  type?: 'website' | 'article';
  keywords?: string;
  noindex?: boolean;
  structuredData?: StructuredData;
};

const upsertMeta = (selector: string, attributes: Record<string, string>, content: string) => {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement('meta');
    Object.entries(attributes).forEach(([key, value]) => tag!.setAttribute(key, value));
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
};

const upsertLink = (selector: string, attributes: Record<string, string>) => {
  let tag = document.head.querySelector<HTMLLinkElement>(selector);
  if (!tag) {
    tag = document.createElement('link');
    document.head.appendChild(tag);
  }
  Object.entries(attributes).forEach(([key, value]) => tag!.setAttribute(key, value));
};

const removeMeta = (selector: string) => {
  document.head.querySelector(selector)?.remove();
};

const Seo = ({
  title,
  description,
  path,
  image = DEFAULT_OG_IMAGE,
  type = 'website',
  keywords,
  noindex = false,
  structuredData
}: SeoProps) => {
  useEffect(() => {
    const normalizedPath = path ?? window.location.pathname;
    const canonicalUrl = absoluteUrl(normalizedPath);
    const robots = noindex ? 'noindex,nofollow' : DEFAULT_ROBOTS;

    document.title = title;

    upsertMeta('meta[name="description"]', { name: 'description' }, description);
    upsertMeta('meta[name="robots"]', { name: 'robots' }, robots);
    upsertMeta('meta[name="googlebot"]', { name: 'googlebot' }, robots);
    upsertMeta('meta[name="theme-color"]', { name: 'theme-color' }, '#05070f');
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name' }, SITE_NAME);
    upsertMeta('meta[property="og:type"]', { property: 'og:type' }, type);
    upsertMeta('meta[property="og:title"]', { property: 'og:title' }, title);
    upsertMeta('meta[property="og:description"]', { property: 'og:description' }, description);
    upsertMeta('meta[property="og:url"]', { property: 'og:url' }, canonicalUrl);
    upsertMeta('meta[property="og:image"]', { property: 'og:image' }, image);
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card' }, 'summary_large_image');
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, title);
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, description);
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, image);

    if (keywords) {
      upsertMeta('meta[name="keywords"]', { name: 'keywords' }, keywords);
    } else {
      removeMeta('meta[name="keywords"]');
    }

    upsertLink('link[rel="canonical"]', { rel: 'canonical', href: canonicalUrl });

    const schemaId = 'swiftdeploy-structured-data';
    const existingScript = document.getElementById(schemaId);
    if (structuredData) {
      const script = existingScript instanceof HTMLScriptElement ? existingScript : document.createElement('script');
      script.id = schemaId;
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(structuredData);
      if (!existingScript) {
        document.head.appendChild(script);
      }
    } else if (existingScript) {
      existingScript.remove();
    }
  }, [description, image, keywords, noindex, path, structuredData, title, type]);

  return null;
};

export default Seo;
