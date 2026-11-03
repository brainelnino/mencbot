export function adminHead(title: string) {
  const description = `${title} — usimamizi wa Live Chat bot Ubongo wa Jamii.`;
  return { meta: [{ title: `${title} — Live Chat bot` }, { name: "description", content: description }, { property: "og:title", content: `${title} — Live Chat bot` }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }, { name: "robots", content: "noindex" }] };
}
