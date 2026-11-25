import { parseCsv } from "./data.js";

self.onmessage = async ({ data: { source, kind } }) => {
  try {
    let input = source;
    if (typeof source === "string") {
      input = await fetch(source);
      if (!input.ok) throw new Error("앱 폴더에서 기본 CSV를 읽을 수 없습니다. 아래에서 파일을 직접 선택하세요.");
    }
    self.postMessage({ result: parseCsv(await input.arrayBuffer(), kind) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
