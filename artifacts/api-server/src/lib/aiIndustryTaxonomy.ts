/**
 * Server-owned discovery taxonomy. These labels are thematic discovery hints,
 * not verified reference classifications and are never evidence for a trade,
 * Alert, sector ranking, or focused scan admission.
 */
export const AI_INDUSTRY_TAXONOMY_VERSION = "ai-infrastructure-taxonomy-v1";
export const AI_INDUSTRY_IDENTIFIER_CAPACITY = 1_000;

export type AiIndustryCategory =
  | "ai_chips"
  | "hbm_memory"
  | "semiconductor_equipment"
  | "ai_servers"
  | "networking"
  | "data_centers"
  | "liquid_cooling"
  | "power_grid"
  | "cloud"
  | "ai_software"
  | "robotics_automation"
  | "ai_infrastructure";

const CATEGORY_SYMBOLS: Record<AiIndustryCategory, readonly string[]> = {
  ai_chips: [
    "AMD", "AMBA", "ARM", "AVGO", "CEVA", "CRUS", "DIOD", "ENTG", "GFS", "INTC",
    "LSCC", "MCHP", "MRVL", "MU", "NVDA", "NXPI", "ON", "QCOM", "QRVO", "RMBS",
    "SITM", "SLAB", "SMTC", "SWKS", "SYNA", "TSM", "TXN", "WOLF",
  ],
  hbm_memory: ["MU", "WDC", "STX", "SIMO", "RMBS", "TSM", "AMD", "NVDA", "AVGO"],
  semiconductor_equipment: [
    "ACLS", "AMAT", "ASML", "CAMT", "COHU", "ENTG", "FORM", "IPGP", "KLAC", "LRCX",
    "MKSI", "ONTO", "PLAB", "TER", "UCTT", "VECO",
  ],
  ai_servers: [
    "AAPL", "DELL", "HPE", "IBM", "INVE", "NTAP", "PSTG", "SMCI", "VRT", "WDC",
    "XRX",
  ],
  networking: [
    "ANET", "AVGO", "CALX", "CIEN", "COMM", "CRDO", "CSCO", "ERIC", "EXTR", "FN",
    "INFN", "JNPR", "LITE", "NOK", "VIAV",
  ],
  data_centers: [
    "AMT", "CORZ", "CROWN", "DLR", "EQIX", "GDS", "HUT", "IREN", "MSTR", "NBIS",
    "RIOT", "WULF",
  ],
  liquid_cooling: [
    "AAON", "AZZ", "BLDR", "CARR", "ETN", "FLNC", "GEV", "GNRC", "JCI", "MOD",
    "NVT", "PWR", "TT", "VRT",
  ],
  power_grid: [
    "AES", "ATO", "CEG", "DUK", "EIX", "ETN", "EXC", "FE", "GEV", "NEE", "NRG",
    "PCG", "PWR", "SO", "VST",
  ],
  cloud: [
    "ADBE", "AMZN", "APP", "CDNS", "CRM", "DDOG", "GOOG", "MSFT", "NOW", "ORCL",
    "PANW", "SNOW", "TEAM", "WDAY", "ZI",
  ],
  ai_software: [
    "AI", "BBAI", "ESTC", "GTLB", "MDB", "MSFT", "ORCL", "PATH", "PLTR", "S",
    "SOUN", "UPST", "VRNT",
  ],
  robotics_automation: [
    "ABB", "CGNX", "EMR", "FANUY", "HON", "IRBT", "ISRG", "KUKAY", "MBLY", "OMCL",
    "PATH", "ROK", "SYM", "TER", "ZBRA",
  ],
  ai_infrastructure: [
    "APLD", "ARQQ", "ASPI", "BROS", "CLS", "CRDO", "FLEX", "GLOB", "IONQ", "LUNR",
    "MTSI", "NICE", "RGTI", "SATS", "TEM", "VRT", "YEXT",
  ],
};

export type AiIndustryTaxonomyEntry = {
  symbol: string;
  categories: AiIndustryCategory[];
};

export const AI_INDUSTRY_TAXONOMY: readonly AiIndustryTaxonomyEntry[] = Object.entries(CATEGORY_SYMBOLS)
  .flatMap(([category, symbols]) => symbols.map((symbol) => ({
    symbol,
    category: category as AiIndustryCategory,
  })))
  .reduce<AiIndustryTaxonomyEntry[]>((entries, item) => {
    const existing = entries.find((entry) => entry.symbol === item.symbol);
    if (existing) {
      existing.categories.push(item.category);
    } else {
      entries.push({ symbol: item.symbol, categories: [item.category] });
    }
    return entries;
  }, [])
  .sort((left, right) => left.symbol.localeCompare(right.symbol));