// Plain text from a document someone attaches for the assistant: .docx (a zip holding word/document.xml) or plain text.
// Returns { text } or { error } in words for the person.

export const MAX_DOC_BYTES = 5 * 1024 * 1024;
export const MAX_DOC_CHARS = 30000;

export async function docText(file) {
  if (!file || typeof file === "string" || !file.size) return { text: "" };
  if (file.size > MAX_DOC_BYTES) return { error: "That document is larger than 5 MB." };
  const name = String(file.name || "").toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  let text;
  if (buf[0] === 0x50 && buf[1] === 0x4b) { // "PK": a zip, so a Word document
    const xml = await unzipEntry(buf, "word/document.xml");
    if (xml === null) return { error: "That file isn’t a Word document. Attach a .docx or .txt file, or paste the text instead." };
    text = wordText(xml);
  } else if (/\.(txt|md|text)$/.test(name) || file.type?.startsWith("text/")) {
    text = new TextDecoder().decode(buf);
  } else {
    return { error: "Attach a Word document (.docx) or a text file (.txt). For a PDF or Google Doc, copy and paste the text instead." };
  }
  text = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return { error: "That document looks empty." };
  if (text.length > MAX_DOC_CHARS) return { error: `That document is too long (over ${MAX_DOC_CHARS.toLocaleString("en")} characters). Send it in parts.` };
  return { text };
}

// One file out of a zip, via the central directory (local headers may omit sizes).
async function unzipEntry(buf, wanted) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  let p = v.getUint32(eocd + 16, true);
  for (let n = v.getUint16(eocd + 10, true); n > 0 && p + 46 <= buf.length; n--) {
    if (v.getUint32(p, true) !== 0x02014b50) return null;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (name === wanted) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = buf.subarray(start, start + size);
      if (method === 0) return new TextDecoder().decode(data);
      if (method !== 8) return null;
      const out = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(out).text();
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e]);

// Paragraphs become lines; list items get a bullet so the structure of the copy survives.
function wordText(xml) {
  const body = xml.replace(/<w:(?:del|instrText)\b[\s\S]*?<\/w:(?:del|instrText)>/g, ""); // tracked deletions and field codes aren't copy
  return body.split(/<\/w:p>/).map((para) => {
    const runs = para.replace(/<w:tab\/>/g, "<w:t>\t</w:t>").replace(/<w:(?:br|cr)\b[^>]*\/>/g, "<w:t>\n</w:t>");
    const text = decode([...runs.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
    return /<w:numPr>/.test(para) && text.trim() ? `• ${text}` : text;
  }).join("\n");
}
