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
