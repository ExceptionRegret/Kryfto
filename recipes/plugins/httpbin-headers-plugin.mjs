export async function extract(ctx) {
  const html = ctx.html ?? "";
  const titleMatch = /<title>(.*?)<\/title>/isu.exec(html);
  const preMatch = /<pre[^>]*>([\s\S]*?)<\/pre>/isu.exec(html);
  let parsed = null;

  if (preMatch?.[1]) {
    try {
      parsed = JSON.parse(preMatch[1]);
    } catch {
      parsed = { raw: preMatch[1] };
    }
  }

  return {
    title: titleMatch?.[1]?.trim() ?? null,
    payload: parsed,
  };
}

export default { extract };
