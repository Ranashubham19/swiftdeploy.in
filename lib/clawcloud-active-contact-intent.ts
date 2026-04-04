import { normalizeClawCloudUnderstandingMessage } from "@/lib/clawcloud-query-understanding";

const ACTIVE_CONTACT_TRAILING_PUNCTUATION = "[\\u3002.!?\\uFF01\\uFF1F\\u061F\\u06D4]*$";

export const ACTIVE_CONTACT_START_PATTERNS = [
  new RegExp(
    `^(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|(?:please\\s+)?)`
      + `(?:from\\s+now\\s+on\\s+)?`
      + `(?:talk|speak|chat|reply|message|send\\s+(?:messages?|texts?))\\s+`
      + `(?:to|with)\\s+(.+?)\\s+`
      + `(?:on\\s+my\\s+behalf|for\\s+me)`
      + ACTIVE_CONTACT_TRAILING_PUNCTUATION,
    "iu",
  ),
  new RegExp(
    `^(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|(?:please\\s+)?)`
      + `(?:from\\s+now\\s+on\\s+)?`
      + `(?:start|begin|keep|continue)\\s+`
      + `(?:talking|replying|messaging|chatting)\\s+`
      + `(?:to|with)\\s+(.+?)(?:\\s+(?:on\\s+my\\s+behalf|for\\s+me))?`
      + ACTIVE_CONTACT_TRAILING_PUNCTUATION,
    "iu",
  ),
  new RegExp(
    `^(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|(?:please\\s+)?)`
      + `(?:from\\s+now\\s+on\\s+)?`
      + `(?:handle|manage)\\s+(.+?)\\s+`
      + `(?:on\\s+whatsapp\\s+)?(?:on\\s+my\\s+behalf|for\\s+me)`
      + ACTIVE_CONTACT_TRAILING_PUNCTUATION,
    "iu",
  ),
  new RegExp(
    `^(?:ok(?:ay)?[, ]+)?(?:from\\s+now\\s+on\\s+)?(?:you(?:'ll|\\s+will)\\s+)?`
      + `(?:talk|speak|chat|reply|message|send\\s+(?:messages?|texts?))\\s+`
      + `(?:to|with)\\s+(.+?)\\s+`
      + `(?:on\\s+my\\s+behalf|for\\s+me)`
      + ACTIVE_CONTACT_TRAILING_PUNCTUATION,
    "iu",
  ),
  /^(?:kya\s+)?(?:(?:aap|app|tum|tu)\s+)?(?:ab\s+se\s+)?(?:meri|mere)\s+(?:taraf\s+se|behalf\s+(?:me|mai|mein))\s+(.+?)\s+se\s+(?:baat|chat|reply)\s+kar(?:o|iye|na|oge|enge|ange|ega|egi)?[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:kya\s+)?(?:(?:aap|app|tum|tu)\s+)?(?:ab\s+)?(?:meri|mere)\s+(?:taraf\s+se|behalf\s+(?:me|mai|mein|par|pe))\s+(?:(?:aap|app|tum|tu)\s+)?(.+?)\s+se\s+(?:baat|chat|reply)\s+kar(?:o|iye|na|oge|enge|ange|ega|egi)?[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:kya\s+)?(?:ab\s+se\s+)?(.+?)\s+se\s+(?:meri|mere)\s+(?:taraf\s+se|behalf\s+(?:me|mai|mein))\s+(?:baat|chat|reply)\s+kar(?:o|iye|na|oge|enge|ange|ega|egi)?[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:kya\s+)?(?:ab\s+se\s+)?(?:(?:aap|app|tum|tu)\s+)?(.+?)\s+se\s+(?:baat|chat|reply)\s+kar(?:o|iye|oge|enge|ange|ega|egi)[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:\u0915\u094d\u092f\u093e\s+)?(?:\u0905\u092c\s+\u0938\u0947\s+)?(?:\u0906\u092a\s+)?(?:\u092e\u0947\u0930\u0940|\u092e\u0947\u0930\u0947)\s+\u0924\u0930\u092b\s+\u0938\u0947\s+(.+?)\s+\u0938\u0947\s+\u092c\u093e\u0924\s+\u0915\u0930(?:\u094b|\u0928\u093e|\u0947\u0902|\u0947\u0902\u0917\u0947|\u093f\u090f|\u093f\u092f\u0947|\u0947\u0917\u093e|\u0947\u0917\u0940)?[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(?:\u0915\u094d\u092f\u093e\s+)?(?:\u0905\u092c\s+\u0938\u0947\s+)?(.+?)\s+\u0938\u0947\s+(?:\u092e\u0947\u0930\u0940|\u092e\u0947\u0930\u0947)\s+\u0924\u0930\u092b\s+\u0938\u0947\s+\u092c\u093e\u0924\s+\u0915\u0930(?:\u094b|\u0928\u093e|\u0947\u0902|\u0947\u0902\u0917\u0947|\u093f\u090f|\u093f\u092f\u0947|\u0947\u0917\u093e|\u0947\u0917\u0940)?[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(?:\u0915\u094d\u092f\u093e\s+)?(?:\u0905\u092c\s+\u0938\u0947\s+)?(?:\u0906\u092a\s+)?(.+?)\s+\u0938\u0947\s+\u092c\u093e\u0924\s+\u0915\u0930(?:\u094b|\u0928\u093e|\u0947\u0902|\u0947\u0902\u0917\u0947|\u093f\u090f|\u093f\u092f\u0947|\u0947\u0917\u093e|\u0947\u0917\u0940)?[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(?:\u06a9\u06cc\u0627\s+)?(?:\u0622\u067e\s+)?(?:\u0627\u0628\s+\u0633\u06d2\s+)?(?:\u0645\u06cc\u0631\u06cc|\u0645\u06cc\u0631\u06d2)\s+\u0637\u0631\u0641\s+\u0633\u06d2\s+(.+?)\s+\u0633\u06d2\s+(?:\u0628\u0627\u062a|\u0686\u06cc\u0679|\u0631\u0627\u0628\u0637\u06c1)\s+\u06a9\u0631(?:\u06cc\u06ba|\u06cc\u06d2|\u0648|\u0646\u0627)?(?:\s+\u06af(?:\u06d2|\u06cc))?[\u3002.!?\u061F\u06D4]*$/u,
  /^(?:\u06a9\u06cc\u0627\s+)?(?:\u0622\u067e\s+)?(?:\u0627\u0628\s+\u0633\u06d2\s+)?(.+?)\s+\u0633\u06d2\s+(?:\u0645\u06cc\u0631\u06cc|\u0645\u06cc\u0631\u06d2)\s+\u0637\u0631\u0641\s+\u0633\u06d2\s+(?:\u0628\u0627\u062a|\u0686\u06cc\u0679|\u0631\u0627\u0628\u0637\u06c1)\s+\u06a9\u0631(?:\u06cc\u06ba|\u06cc\u06d2|\u0648|\u0646\u0627)?(?:\s+\u06af(?:\u06d2|\u06cc))?[\u3002.!?\u061F\u06D4]*$/u,
  /^(?:\u0e0a\u0e48\u0e27\u0e22|\u0e44\u0e14\u0e49\u0e44\u0e2b\u0e21|\u0e04\u0e38\u0e13\u0e08\u0e30\u0e0a\u0e48\u0e27\u0e22)?\s*(?:\u0e42\u0e2d\u0e40\u0e04|\u0e15\u0e01\u0e25\u0e07)?\s*(?:\u0e08\u0e32\u0e01\u0e19\u0e35\u0e49\u0e44\u0e1b|\u0e15\u0e48\u0e2d\u0e08\u0e32\u0e01\u0e19\u0e35\u0e49|\u0e19\u0e31\u0e1a\u0e08\u0e32\u0e01\u0e19\u0e35\u0e49)?\s*(?:\u0e04\u0e38\u0e13)?(?:\u0e08\u0e30)?(?:\u0e0a\u0e48\u0e27\u0e22)?(?:\u0e2a\u0e48\u0e07\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21|\u0e17\u0e31\u0e01|\u0e04\u0e38\u0e22|\u0e15\u0e2d\u0e1a\u0e01\u0e25\u0e31\u0e1a|\u0e1e\u0e34\u0e21\u0e1e\u0e4c\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21)(?:\u0e44\u0e1b)?(?:\u0e2b\u0e32|\u0e16\u0e36\u0e07|\u0e01\u0e31\u0e1a)\s*(.+?)\s*(?:\u0e41\u0e17\u0e19\u0e09\u0e31\u0e19|\u0e41\u0e17\u0e19\u0e1c\u0e21|\u0e43\u0e19\u0e19\u0e32\u0e21\u0e02\u0e2d\u0e07\u0e09\u0e31\u0e19|\u0e43\u0e19\u0e19\u0e32\u0e21\u0e02\u0e2d\u0e07\u0e1c\u0e21|\u0e43\u0e2b\u0e49\u0e09\u0e31\u0e19)?(?:\u0e44\u0e14\u0e49\u0e44\u0e2b\u0e21)?[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(?:\u8bf7|\u8acb)?(?:\u4f60|\u60a8)?(?:\u53ef\u4ee5|\u80fd\u4e0d\u80fd|\u53ef\u5426)?(?:\u5e6b\u6211|\u5e2e\u6211|\u66ff\u6211|\u4ee3\u6211)?(?:\u4ece\u73b0\u5728\u5f00\u59cb|\u5f9e\u73fe\u5728\u958b\u59cb)?(?:\u53bb)?(?:\u8ddf|\u548c|\u540c|\u5c0d|\u5bf9)\s*(.+?)\s*(?:\u8bf4\u8bdd|\u8aaa\u8a71|\u804a\u5929|\u5bf9\u8bdd|\u5c0d\u8a71|\u6c9f\u901a|\u6e9d\u901a|\u8054\u7cfb|\u806f\u7d61|\u56de\u590d|\u56de\u8986|\u56de\u8a71|\u8bf4|\u8aaa)(?:\u5427|\u4e00\u4e0b|\u4e86|\u5417|\u55ce)?[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(?:\u3053\u308c\u304b\u3089\s*)?(?:\u79c1\u306e\u4ee3\u308f\u308a\u306b|\u4ee3\u308f\u308a\u306b|\u79c1\u306e\u305f\u3081\u306b)\s*(.+?)(?:\u3068|\u306b)\s*(?:\u8a71\u3057\u3066|\u8a71\u3057\u3066\u304f\u3060\u3055\u3044|\u8a71\u3057\u3066\u304f\u308c\u307e\u3059\u304b|\u9023\u7d61\u3057\u3066|\u8fd4\u4fe1\u3057\u3066|\u8fd4\u4e8b\u3057\u3066|\u30e1\u30c3\u30bb\u30fc\u30b8\u3057\u3066)[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(.+?)(?:\u3068|\u306b)\s*(?:\u79c1\u306e\u4ee3\u308f\u308a\u306b|\u4ee3\u308f\u308a\u306b|\u79c1\u306e\u305f\u3081\u306b)\s*(?:\u8a71\u3057\u3066|\u8a71\u3057\u3066\u304f\u3060\u3055\u3044|\u8a71\u3057\u3066\u304f\u308c\u307e\u3059\u304b|\u9023\u7d61\u3057\u3066|\u8fd4\u4fe1\u3057\u3066|\u8fd4\u4e8b\u3057\u3066|\u30e1\u30c3\u30bb\u30fc\u30b8\u3057\u3066)[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(?:\uc774\uc81c\ubd80\ud130\s*)?(?:(?:\uc81c|\ub0b4)\s*\ub300\uc2e0\s*)?(.+?)(?:\uc774\ub791|\ub791|\uc640|\uacfc|\uc5d0\uac8c|\ud55c\ud14c)\s*(?:\uc598\uae30\ud574|\ub9d0\ud574|\ub300\ud654\ud574|\ub2f5\uc7a5\ud574|\uc5f0\ub77d\ud574)(?:\uc918|\uc694|\uc904\ub798|\uc8fc\uc2e4\ub798\uc694)?[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(.+?)(?:\uc774\ub791|\ub791|\uc640|\uacfc|\uc5d0\uac8c|\ud55c\ud14c)\s*(?:(?:\uc81c|\ub0b4)\s*\ub300\uc2e0\s*)?(?:\uc598\uae30\ud574|\ub9d0\ud574|\ub300\ud654\ud574|\ub2f5\uc7a5\ud574|\uc5f0\ub77d\ud574)(?:\uc918|\uc694|\uc904\ub798|\uc8fc\uc2e4\ub798\uc694)?[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(?:\u00bf)?(?:puedes|podr[i\u00ed]as|podr[a\u00e1]s)(?:\s+por\s+favor)?\s+(?:desde\s+ahora\s+)?(?:hablar|conversar|chatear|responder|escribir)\s+(?:con|a)\s+(?:el|la|los|las)?\s*(.+?)\s+(?:por\s+m[i\u00ed]|en\s+mi\s+nombre)[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:s'il\s+te\s+pla[i\u00ee]t\s+)?(?:peux-tu|pourrais-tu)\s+(?:d[e\u00e8]s\s+maintenant\s+)?(?:parler|discuter|r[e\u00e9]pondre|[\u00e9e]crire)\s+(?:avec|[\u00e0a])\s+(?:le|la|les|l')?\s*(.+?)\s+(?:pour\s+moi|en\s+mon\s+nom)[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:bitte\s+)?(?:kannst\s+du|k[o\u00f6]nntest\s+du)\s+(?:ab\s+jetzt\s+)?(?:mit\s+(?:dem|der|den)?\s*)?(.+?)\s+(?:f[u\u00fc]r\s+mich|in\s+meinem\s+namen)\s+(?:sprechen|chatten|schreiben|antworten)[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:por\s+favor\s+)?(?:voc[e\u00ea]\s+pode|pode)\s+(?:a\s+partir\s+de\s+agora\s+)?(?:falar|conversar|responder|escrever)\s+com\s+(?:o|a|os|as)?\s*(.+?)\s+(?:por\s+mim|em\s+meu\s+nome)[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:per\s+favore\s+)?(?:puoi|potresti)\s+(?:da\s+ora\s+in\s+poi\s+)?(?:parlare|rispondere|scrivere|chattare)\s+(?:con|a)\s+(?:il|lo|la|i|gli|le|l')?\s*(.+?)\s+(?:per\s+me|a\s+nome\s+mio)[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:l[u\u00fc]tfen\s+)?(?:bundan\s+sonra\s+)?(?:benim\s+ad\u0131ma\s+)?(.+?)\s+(?:ile|la|le)\s+(?:konu\u015f|yaz\u0131\u015f|mesajla\u015f|cevap\s+ver)(?:\s+benim\s+ad\u0131ma)?(?:\s+(?:olur\s+mu|m\u0131s\u0131n))?[\u3002.!?\uFF01\uFF1F]*$/iu,
  /^(?:\u043f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430\s+)?(?:\u043c\u043e\u0436\u0435\u0448\u044c\s+)?(?:\u0441\s+\u044d\u0442\u043e\u0433\u043e\s+\u043c\u043e\u043c\u0435\u043d\u0442\u0430\s+)?(?:\u043f\u043e\u0433\u043e\u0432\u043e\u0440\u0438|\u043e\u0431\u0449\u0430\u0439\u0441\u044f|\u043f\u0435\u0440\u0435\u043f\u0438\u0441\u044b\u0432\u0430\u0439\u0441\u044f|\u043e\u0442\u0432\u0435\u0447\u0430\u0439)\s+\u0441\s+(.+?)\s+(?:\u0437\u0430\s+\u043c\u0435\u043d\u044f|\u043e\u0442\s+\u043c\u043e\u0435\u0433\u043e\s+\u0438\u043c\u0435\u043d\u0438)[\u3002.!?\uFF01\uFF1F]*$/u,
  /^(?:\u0647\u0644\s+)?(?:\u064a\u0645\u0643\u0646\u0643|\u0645\u0645\u0643\u0646\s+\u062a)?(?:\s+\u0645\u0646\s+\u0641\u0636\u0644\u0643)?\s*(?:\u0645\u0646\s+\u0627\u0644\u0622\u0646(?:\s+\u0641\u0635\u0627\u0639\u062f\u064b\u0627)?\s+)?(?:\u0627\u0644\u062a\u062d\u062f\u062b|\u0627\u0644\u062a\u0643\u0644\u0645|\u0627\u0644\u0631\u062f|\u0627\u0644\u0643\u062a\u0627\u0628\u0629|\u0645\u0631\u0627\u0633\u0644\u0629|\u062a\u062a\u062d\u062f\u062b|\u062a\u062a\u0643\u0644\u0645|\u062a\u0631\u062f|\u062a\u0643\u062a\u0628|\u062a\u0631\u0627\u0633\u0644)\s+\u0645\u0639\s+(.+?)\s+(?:\u0646\u064a\u0627\u0628\u0629\u064b?\s+\u0639\u0646\u064a|\u0628\u0627\u0644\u0646\u064a\u0627\u0628\u0629\s+\u0639\u0646\u064a|\u0645\u0646\s+\u0637\u0631\u0641\u064a)[\u3002.!?\uFF01\uFF1F\u061F]*$/u,
];

const ACTIVE_CONTACT_PERSISTENT_START_PATTERNS = [
  new RegExp(
    `^(?:ok(?:ay)?[, ]+)?(?:from\\s+now\\s+(?:on|onward|onwards)|starting\\s+now|from\\s+here\\s+on)\\s+`
      + `(?:you(?:'ll|\\s+will)\\s+)?`
      + `(?:message|text|reply(?:\\s+to)?|respond(?:\\s+to)?|handle|manage)\\s+`
      + `(?:every|all)\\s+(?:question|questions|message|messages|reply|replies|text|texts)\\s+(?:of|from)\\s+`
      + `(.+?)`
      + `(?:\\s+(?:on\\s+my\\s+behalf|for\\s+me))?`
      + ACTIVE_CONTACT_TRAILING_PUNCTUATION,
    "iu",
  ),
  new RegExp(
    `^(?:ok(?:ay)?[, ]+)?(?:from\\s+now\\s+(?:on|onward|onwards)|starting\\s+now|from\\s+here\\s+on)\\s+`
      + `(?:you(?:'ll|\\s+will)\\s+)?`
      + `(?:talk|speak|chat|reply|respond|message|text|handle|manage)\\s+`
      + `(?:to|with)\\s+`
      + `(.+?)`
      + `(?:\\s+(?:on\\s+my\\s+behalf|for\\s+me))?`
      + ACTIVE_CONTACT_TRAILING_PUNCTUATION,
    "iu",
  ),
];

const ACTIVE_CONTACT_TARGET_PREFIX_RE =
  /^(?:the\s+contact\s+)?(?:named\s+)?(?:every|all)\s+(?:question|questions|message|messages|reply|replies|text|texts)\s+(?:of|from)\s+/iu;

const ACTIVE_CONTACT_INVALID_TARGET_RE =
  /^(?:everyone|everybody|all|all contacts?|all chats?|all messages?|all questions?|the world|the internet|google|gmail|whatsapp|chatgpt|clawcloud)$/iu;

function normalizeActiveContactStartTarget(value: string) {
  const cleaned = String(value ?? "")
    .replace(ACTIVE_CONTACT_TARGET_PREFIX_RE, "")
    .replace(/^[\s,.;:!?]+|[\s,.;:!?]+$/g, "")
    .trim();
  if (!cleaned) {
    return null;
  }

  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 6 || /[\r\n:]/.test(cleaned) || ACTIVE_CONTACT_INVALID_TARGET_RE.test(cleaned)) {
    return null;
  }

  return cleaned;
}

export function extractActiveContactStartCommand(value: string) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const understood = normalizeClawCloudUnderstandingMessage(trimmed).trim();
  const candidates = Array.from(new Set([trimmed, understood].filter(Boolean)));

  for (const candidate of candidates) {
    for (const pattern of ACTIVE_CONTACT_START_PATTERNS) {
      const match = candidate.match(pattern);
      const target = normalizeActiveContactStartTarget(match?.[1] ?? "");
      if (target) {
        return target;
      }
    }
  }

  for (const candidate of candidates) {
    for (const pattern of ACTIVE_CONTACT_PERSISTENT_START_PATTERNS) {
      const match = candidate.match(pattern);
      const target = normalizeActiveContactStartTarget(match?.[1] ?? "");
      if (target) {
        return target;
      }
    }
  }

  return null;
}

export function looksLikeActiveContactStartCommand(value: string) {
  return Boolean(extractActiveContactStartCommand(value));
}
