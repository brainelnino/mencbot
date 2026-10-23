// Kiswahili is primary. Add "en" with the same keys later.
export const sw = {
  tagline: "Jamii Salama. Mawazo Makubwa. Fursa Mpya.",
  nav: {
    overview: "Muhtasari",
    community: "Jamii",
    moderation: "Udhibiti",
    members: "Wanachama",
    admins: "Wasimamizi",
    brain: "EL-NINO Brain",
    settings: "Mipangilio",
  },
  empty: "Hakuna data bado.",
  loading: "Inapakia…",
  error: "Hitilafu imetokea.",
  notConnected: "Haijaunganishwa bado",
  auth: { google: "Ingia kwa Google", owner: "Mmiliki mkuu", ownerOnly: "Dashibodi ya mmiliki mkuu pekee.", email: "Barua pepe", password: "Nenosiri", signin: "Ingia", signup: "Fungua akaunti", busy: "Subiri…", confirm: "Angalia barua pepe yako kuthibitisha akaunti.", failed: "Imeshindikana", toggleIn: "Una akaunti? Ingia", toggleUp: "Huna akaunti? Jisajili" },
  telegram: {
    welcome: (label: string) => `Karibu EL-NINO 🇹🇿\n${label}`,
    welcomeBack: (label: string) => `Karibu tena 🇹🇿\n${label}`,
    startFirst: "Tuma /start kwanza.", textOnly: "Maandishi pekee kwa sasa.", exhausted: "Nafasi za usajili zimejaa kwa sasa.",
    adminMenu: (slot: number) => `Msimamizi ${slot}\n/zuia ID\n/rudisha ID`,
    adminDone: "Imekamilika.", noPermission: "Huna ruhusa.",
    blockedTerm: "⚠️ Ujumbe haujatumwa: haturuhusu maneno yasiofaa au matusi.",
    reactionTo: (label: string) => `kwa ujumbe wa ${label}`,
  },
  assistants: { title: "Wasimamizi wa Telegram", label: "ID ya mwanachama", slot: "Nafasi", appoint: "Teua", success: "Msimamizi ameteuliwa", active: "Hai", inactive: "Imezimwa", enable: "Washa", disable: "Zima", empty: "Hakuna wasimamizi wa Telegram bado." },
  publicPrivacy: "Utambulisho wako halisi haufichuliwi.",
  publicEmpty: "Bado hakuna ujumbe uliochapishwa.",
} as const;

export const t = sw;

export const permissionLabels: Record<string, string> = {
  view_moderation_queue: "Kuona foleni ya udhibiti",
  review_images: "Kukagua picha",
  review_reports: "Kukagua ripoti",
  manage_blocked_terms: "Maneno yaliyozuiliwa",
  manage_link_rules: "Sheria za viungo na faragha",
  manage_rate_limits: "Viwango vya ujumbe",
  manage_restrictions: "Vizuizi vya muda",
  manage_members: "Kusimamia wanachama",
  view_statistics: "Takwimu za jamii",
  view_audit: "Kumbukumbu za ukaguzi",
  manage_admins: "Kusimamia wasimamizi",
  manage_settings: "Mipangilio ya mfumo",
};
