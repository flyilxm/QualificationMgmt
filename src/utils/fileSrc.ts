import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * 将本地绝对路径转为 WebView 可用的 asset URL。
 * Windows 反斜杠统一为 `/`，避免 asset 协议解析异常。
 */
export function filePathToAssetUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return convertFileSrc(normalized);
}
