export const SITE_NAME = 'SwiftDeploy';
export const SITE_URL = 'https://swift-deploy.in';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/images/brand/swiftdeploy-logo.svg`;
export const DEFAULT_ROBOTS = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';

export type StructuredData = Record<string, unknown> | Array<Record<string, unknown>>;

type BreadcrumbItem = {
  name: string;
  path: string;
};

type FaqItem = {
  question: string;
  answer: string;
};

type OfferInput = {
  name: string;
  price: number;
  priceCurrency?: string;
  path: string;
  description?: string;
  category?: string;
};

export const absoluteUrl = (path = '/') => new URL(path, SITE_URL).toString();

export const buildOrganizationSchema = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_NAME,
  url: SITE_URL,
  logo: DEFAULT_OG_IMAGE,
  email: 'ops@swiftdeploy.ai'
});

export const buildWebPageSchema = ({
  name,
  description,
  path
}: {
  name: string;
  description: string;
  path: string;
}) => ({
  '@context': 'https://schema.org',
  '@type': 'WebPage',
  name,
  description,
  url: absoluteUrl(path)
});

export const buildServiceSchema = ({
  name,
  description,
  path,
  serviceType
}: {
  name: string;
  description: string;
  path: string;
  serviceType: string;
}) => ({
  '@context': 'https://schema.org',
  '@type': 'Service',
  name,
  description,
  url: absoluteUrl(path),
  areaServed: 'Worldwide',
  serviceType,
  provider: {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL
  }
});

export const buildBreadcrumbSchema = (items: BreadcrumbItem[]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path)
  }))
});

export const buildFaqSchema = (items: FaqItem[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: items.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: item.answer
    }
  }))
});

export const buildOfferSchema = ({
  name,
  price,
  priceCurrency = 'USD',
  path,
  description,
  category
}: OfferInput) => ({
  '@type': 'Offer',
  name,
  price,
  priceCurrency,
  availability: 'https://schema.org/InStock',
  url: absoluteUrl(path),
  category,
  description
});

export const buildSoftwareApplicationSchema = ({
  name,
  description,
  path,
  applicationCategory,
  offers
}: {
  name: string;
  description: string;
  path: string;
  applicationCategory: string;
  offers?: ReturnType<typeof buildOfferSchema>[];
}) => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name,
  description,
  url: absoluteUrl(path),
  applicationCategory,
  operatingSystem: 'Web',
  offers,
  provider: {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL
  }
});
