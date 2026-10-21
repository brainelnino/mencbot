export function adminHead(title: string) {
  const description = `${title} — usimamizi wa EL-NINO Ubongo wa Jamii.`;
  return { meta: [{ title: `${title} — EL-NINO` }, { name: "description", content: description }, { property: "og:title", content: `${title} — EL-NINO` }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] };
}
