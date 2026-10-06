// MARK: Official region names in Chinese
//
// The mirrored map is a Chinese-facing surface: the operators who mirror the
// official relays do it so their clients' relay list reads in Chinese while the
// relays stay Tailscale's own. The official map only names regions in English
// (`Tokyo`, `Hong Kong`), so Headplane keeps its own code -> Chinese table.
//
// The table is keyed by the official region *code* (`hkg`), not by the id: the
// ids are the official map's own numbering and move, while the codes are stable
// per city. A code the table does not know keeps the official name, so a region
// Tailscale adds tomorrow renders as itself instead of as a blank.

/** Official region code -> the name the mirrored map prints. */
export const CHINESE_REGION_NAMES: Record<string, string> = {
  // Greater China and nearby
  hkg: "香港",
  tpe: "台北",
  mnl: "马尼拉",
  sin: "新加坡",
  kul: "吉隆坡",
  cgk: "雅加达",

  // Japan and Korea
  tok: "东京",
  hnd: "东京",
  nrt: "东京",
  kix: "大阪",
  osk: "大阪",
  osa: "大阪",
  icn: "首尔",
  sel: "首尔",

  // South and Southeast Asia
  bom: "孟买",
  blr: "班加罗尔",
  maa: "金奈",
  del: "德里",
  ccu: "加尔各答",

  // North America
  nyc: "纽约",
  iad: "华盛顿",
  bos: "波士顿",
  atl: "亚特兰大",
  mia: "迈阿密",
  ord: "芝加哥",
  dal: "达拉斯",
  dfw: "达拉斯",
  den: "丹佛",
  sea: "西雅图",
  sfo: "旧金山",
  lax: "洛杉矶",
  gdl: "瓜达拉哈拉",
  mex: "墨西哥城",
  yyz: "多伦多",
  tor: "多伦多",
  yul: "蒙特利尔",

  // South America
  gru: "圣保罗",
  eze: "布宜诺斯艾利斯",
  scl: "圣地亚哥",
  lim: "利马",
  bog: "波哥大",

  // Europe
  lhr: "伦敦",
  man: "曼彻斯特",
  gla: "格拉斯哥",
  dub: "都柏林",
  ams: "阿姆斯特丹",
  bru: "布鲁塞尔",
  par: "巴黎",
  cdg: "巴黎",
  fra: "法兰克福",
  ber: "柏林",
  mad: "马德里",
  bcn: "巴塞罗那",
  lis: "里斯本",
  mil: "米兰",
  zrh: "苏黎世",
  gva: "日内瓦",
  vie: "维也纳",
  prg: "布拉格",
  bud: "布达佩斯",
  waw: "华沙",
  sto: "斯德哥尔摩",
  arn: "斯德哥尔摩",
  osl: "奥斯陆",
  cph: "哥本哈根",
  hel: "赫尔辛基",
  tal: "塔林",
  rix: "里加",
  sof: "索菲亚",
  otp: "布加勒斯特",
  kiv: "基希讷乌",

  // Middle East, Africa, Oceania and Russia
  ist: "伊斯坦布尔",
  tlv: "特拉维夫",
  dxb: "迪拜",
  ruh: "利雅得",
  jed: "吉达",
  doh: "多哈",
  mct: "马斯喀特",
  jnb: "约翰内斯堡",
  cpt: "开普敦",
  nbo: "内罗毕",
  los: "拉各斯",
  syd: "悉尼",
  mel: "墨尔本",
  bne: "布里斯班",
  per: "珀斯",
  adl: "阿德莱德",
  akl: "奥克兰",
  dme: "莫斯科",
  led: "圣彼得堡",
  svx: "叶卡捷琳堡",
  kja: "克拉斯诺亚尔斯克",
  oms: "鄂木斯克",
  ala: "阿拉木图",
  tse: "阿斯塔纳",
  bak: "巴库",
  tbs: "第比利斯",
  evn: "埃里温",
};

/**
 * The name the mirrored map prints for one official region. A code the table
 * knows wins; an unknown code keeps the official name, and a region the official
 * map left unnamed falls back to its code so the file never carries a blank
 * `regionname` (which the validator refuses).
 */
export function chineseRegionName(code: string, officialName: string): string {
  const key = code.trim().toLowerCase();
  const mapped = CHINESE_REGION_NAMES[key];
  if (mapped !== undefined) {
    return mapped;
  }

  const name = officialName.trim();
  return name.length > 0 ? name : code.trim();
}
